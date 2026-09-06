import {
  claimSyncJobAsync,
  failSyncJobAttemptAsync,
  getRunnableSyncJobsAsync,
  markSyncJobSyncedAsync,
  restoreSyncJobPendingAsync,
} from '@/db';
import { SyncWorkerResult } from '@/features/items/types';
import { getSyncAdapter } from '@/sync/adapter';
import { computeNextRetryAt } from '@/sync/retryPolicy';

const SYNC_BATCH_LIMIT = 5;

export async function runSyncQueueOnce(): Promise<SyncWorkerResult> {
  const jobs = await getRunnableSyncJobsAsync(SYNC_BATCH_LIMIT);

  if (jobs.length === 0) {
    return {
      kind: 'idle',
      processedCount: 0,
    };
  }

  const adapter = getSyncAdapter();
  let processedCount = 0;

  for (const job of jobs) {
    const processingTimestamp = new Date().toISOString();
    const nextAttemptCount = job.attemptCount + 1;

    // 목록을 읽은 시점과 처리 시작 사이에 AI 보강이 끝나 payload가 갱신됐을 수 있습니다.
    // 상태를 바꾸면서 그 시점의 내용을 함께 받아, 읽어둔 옛 payload 대신 그걸 보냅니다.
    const claimedJob = await claimSyncJobAsync(job.id, nextAttemptCount, processingTimestamp);

    if (!claimedJob) {
      // 처리 직전에 아이템이 삭제된 경우입니다. 보낼 것이 없습니다.
      continue;
    }

    const result = await adapter.upsertItem(claimedJob);

    if (result.kind === 'deferred') {
      await restoreSyncJobPendingAsync(job.id, processingTimestamp);

      return {
        kind: 'deferred',
        processedCount,
        reason: result.reason,
      };
    }

    // 원격 호출을 기다리는 동안 새 payload가 큐잉됐다면 결과를 적지 않습니다.
    // 적어버리면 그 job은 완료로 닫히고 새 내용은 한 번도 전송되지 않습니다.
    // 아무것도 쓰지 않으면 다음 실행 때 갱신된 내용으로 다시 잡힙니다.
    const completedAt = new Date().toISOString();

    if (result.kind === 'retryable_error' || result.kind === 'fatal_error') {
      const retryAt =
        result.kind === 'retryable_error' ? computeNextRetryAt(nextAttemptCount) : null;
      const applied = await failSyncJobAttemptAsync(
        job.id,
        job.itemId,
        nextAttemptCount,
        result.reason,
        retryAt,
        completedAt,
        processingTimestamp
      );

      if (applied) {
        processedCount += 1;
      } else {
        console.log(`[SyncWorker] 처리 중 갱신된 job입니다. 결과를 적지 않습니다. job: ${job.id}`);
      }
      continue;
    }

    const applied = await markSyncJobSyncedAsync(
      job.id,
      job.itemId,
      completedAt,
      processingTimestamp
    );

    if (applied) {
      processedCount += 1;
    } else {
      console.log(`[SyncWorker] 처리 중 갱신된 job입니다. 결과를 적지 않습니다. job: ${job.id}`);
    }
  }

  return {
    kind: 'completed',
    processedCount,
  };
}
