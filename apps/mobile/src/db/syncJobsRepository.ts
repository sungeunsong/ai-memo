import { SQLiteDatabase } from 'expo-sqlite';

import { CreateSyncJobPayload, SyncJob, SyncQueueSummary } from '@/features/items/types';

type SyncQueueSummaryRow = {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  count: number;
};

type SyncJobRow = {
  id: string;
  item_id: string;
  operation: 'upsert_item';
  payload_json: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertSyncJobAsync(db: SQLiteDatabase, job: CreateSyncJobPayload) {
  await db.runAsync(
    `INSERT INTO sync_jobs (
      id, item_id, operation, payload_json, status, attempt_count,
      last_error, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    job.id,
    job.itemId,
    job.operation,
    job.payloadJson,
    job.status,
    job.attemptCount,
    job.lastError,
    job.nextRetryAt,
    job.createdAt,
    job.updatedAt
  );
}

export async function upsertSyncJobAsync(db: SQLiteDatabase, job: CreateSyncJobPayload) {
  await db.runAsync(
    `INSERT INTO sync_jobs (
      id, item_id, operation, payload_json, status, attempt_count,
      last_error, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_id = excluded.item_id,
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      status = excluded.status,
      attempt_count = excluded.attempt_count,
      last_error = excluded.last_error,
      next_retry_at = excluded.next_retry_at,
      updated_at = excluded.updated_at`,
    job.id,
    job.itemId,
    job.operation,
    job.payloadJson,
    job.status,
    job.attemptCount,
    job.lastError,
    job.nextRetryAt,
    job.createdAt,
    job.updatedAt
  );
}

export async function getSyncQueueSummaryAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<SyncQueueSummaryRow>(
    `SELECT status, COUNT(*) as count
    FROM sync_jobs
    WHERE status IN ('pending', 'processing', 'failed')
    GROUP BY status`
  );

  return rows.reduce<SyncQueueSummary>(
    (summary, row) => {
      if (row.status === 'failed') {
        summary.failedCount += Number(row.count);
        return summary;
      }

      summary.pendingCount += Number(row.count);
      return summary;
    },
    {
      pendingCount: 0,
      failedCount: 0,
    }
  );
}

export async function listRunnableSyncJobsAsync(
  db: SQLiteDatabase,
  nowIso: string,
  limit: number
) {
  const rows = await db.getAllAsync<SyncJobRow>(
    `SELECT
      id,
      item_id,
      operation,
      payload_json,
      status,
      attempt_count,
      last_error,
      next_retry_at,
      created_at,
      updated_at
    FROM sync_jobs
    WHERE
      status = 'pending'
      OR (
        status = 'failed'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      )
    ORDER BY created_at ASC
    LIMIT ?`,
    nowIso,
    limit
  );

  return rows.map(mapSyncJobRow);
}

/**
 * job을 'processing'으로 잡으면서 그 시점의 내용을 함께 읽어옵니다.
 *
 * 큐에서 목록을 읽은 뒤 처리를 시작하기 전에 AI 보강이 끝나면 같은 id에
 * 새 payload가 덮어써집니다. 읽어둔 payload를 그대로 보내면 방금 만들어진
 * 요약이 아니라 저장 직후의 빈 껍데기를 보내게 됩니다. 상태 전환과 읽기를
 * 붙여두면 그 사이에 낀 갱신을 놓치지 않습니다.
 */
export async function claimSyncJobAsync(
  db: SQLiteDatabase,
  jobId: string,
  attemptCount: number,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'processing',
      attempt_count = ?,
      updated_at = ?
    WHERE id = ?`,
    attemptCount,
    updatedAt,
    jobId
  );

  const row = await db.getFirstAsync<SyncJobRow>(
    `SELECT
      id,
      item_id,
      operation,
      payload_json,
      status,
      attempt_count,
      last_error,
      next_retry_at,
      created_at,
      updated_at
    FROM sync_jobs
    WHERE id = ?`,
    jobId
  );

  return row ? mapSyncJobRow(row) : null;
}

/**
 * 아직 때가 되지 않은 재시도 중 가장 이른 시각을 돌려줍니다.
 * 그 시각에 맞춰 워커를 깨우기 위한 값입니다.
 */
export async function getNextSyncRetryAtAsync(db: SQLiteDatabase, nowIso: string) {
  const row = await db.getFirstAsync<{ next_retry_at: string | null }>(
    `SELECT MIN(next_retry_at) as next_retry_at
    FROM sync_jobs
    WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at > ?`,
    nowIso
  );

  return row?.next_retry_at ?? null;
}

export async function markSyncJobPendingAsync(
  db: SQLiteDatabase,
  jobId: string,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'pending',
      updated_at = ?
    WHERE id = ?`,
    updatedAt,
    jobId
  );
}

/**
 * 처리 중 job이 갱신되지 않았을 때만 완료로 적습니다.
 *
 * 원격 호출을 기다리는 동안 같은 id에 새 payload가 큐잉될 수 있습니다.
 * 그걸 모르고 완료 도장을 찍으면 새 payload는 한 번도 전송되지 않고 사라집니다.
 * updated_at이 잡아둘 때 그대로여야만 씁니다.
 */
export async function markSyncJobCompletedAsync(
  db: SQLiteDatabase,
  jobId: string,
  updatedAt: string,
  expectedUpdatedAt: string
) {
  const result = await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'completed',
      last_error = NULL,
      next_retry_at = NULL,
      updated_at = ?
    WHERE id = ? AND updated_at = ?`,
    updatedAt,
    jobId,
    expectedUpdatedAt
  );

  return result.changes;
}

/** 완료와 같은 이유로, 잡아둔 뒤 갱신되지 않았을 때만 실패로 적습니다. */
export async function markSyncJobFailedAsync(
  db: SQLiteDatabase,
  jobId: string,
  attemptCount: number,
  lastError: string,
  nextRetryAt: string | null,
  updatedAt: string,
  expectedUpdatedAt: string
) {
  const result = await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'failed',
      attempt_count = ?,
      last_error = ?,
      next_retry_at = ?,
      updated_at = ?
    WHERE id = ? AND updated_at = ?`,
    attemptCount,
    lastError,
    nextRetryAt,
    updatedAt,
    jobId,
    expectedUpdatedAt
  );

  return result.changes;
}

/**
 * 앱이 꺼지며 'processing'에 갇힌 job을 다시 실행 대상으로 되돌립니다.
 * 시도 횟수는 그대로 두어 백오프가 이어지게 합니다.
 */
export async function recoverStalledSyncJobsAsync(
  db: SQLiteDatabase,
  staleBefore: string,
  updatedAt: string
) {
  const result = await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'pending',
      updated_at = ?
    WHERE status = 'processing' AND updated_at <= ?`,
    updatedAt,
    staleBefore
  );

  return result.changes;
}

function mapSyncJobRow(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    itemId: row.item_id,
    operation: row.operation,
    payloadJson: row.payload_json,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
