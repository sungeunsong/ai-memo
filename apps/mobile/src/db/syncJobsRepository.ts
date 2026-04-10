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

export async function markSyncJobProcessingAsync(
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

export async function markSyncJobCompletedAsync(db: SQLiteDatabase, jobId: string, updatedAt: string) {
  await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'completed',
      last_error = NULL,
      next_retry_at = NULL,
      updated_at = ?
    WHERE id = ?`,
    updatedAt,
    jobId
  );
}

export async function markSyncJobFailedAsync(
  db: SQLiteDatabase,
  jobId: string,
  attemptCount: number,
  lastError: string,
  nextRetryAt: string | null,
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE sync_jobs
    SET
      status = 'failed',
      attempt_count = ?,
      last_error = ?,
      next_retry_at = ?,
      updated_at = ?
    WHERE id = ?`,
    attemptCount,
    lastError,
    nextRetryAt,
    updatedAt,
    jobId
  );
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
