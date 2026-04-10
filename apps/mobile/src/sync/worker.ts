import {
  failSyncJobAttemptAsync,
  getRunnableSyncJobsAsync,
  markSyncJobProcessingAsync,
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

    await markSyncJobProcessingAsync(job.id, nextAttemptCount, processingTimestamp);

    const result = await adapter.upsertItem(job);

    if (result.kind === 'deferred') {
      await restoreSyncJobPendingAsync(job.id, processingTimestamp);

      return {
        kind: 'deferred',
        processedCount,
        reason: result.reason,
      };
    }

    if (result.kind === 'retryable_error') {
      const retryAt = computeNextRetryAt(nextAttemptCount);
      await failSyncJobAttemptAsync(
        job.id,
        job.itemId,
        nextAttemptCount,
        result.reason,
        retryAt,
        processingTimestamp
      );
      processedCount += 1;
      continue;
    }

    if (result.kind === 'fatal_error') {
      await failSyncJobAttemptAsync(
        job.id,
        job.itemId,
        nextAttemptCount,
        result.reason,
        null,
        processingTimestamp
      );
      processedCount += 1;
      continue;
    }

    await markSyncJobSyncedAsync(job.id, job.itemId, processingTimestamp);
    processedCount += 1;
  }

  return {
    kind: 'completed',
    processedCount,
  };
}
