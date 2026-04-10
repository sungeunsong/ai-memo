export type ItemType = 'url' | 'text';

export type AIStatus = 'pending' | 'completed' | 'failed';

export type SyncStatus = 'local_only' | 'queued' | 'synced' | 'failed';

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type SyncJobOperation = 'upsert_item';

export type SavedItem = {
  id: string;
  type: ItemType;
  sourceUrl: string | null;
  rawInput: string;
  title: string;
  summary: string;
  content: string;
  thumbnailUrl: string | null;
  aiStatus: AIStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type SaveUrlPayload = {
  id: string;
  type: ItemType;
  sourceUrl: string;
  rawInput: string;
  title: string;
  summary: string;
  content: string;
  thumbnailUrl: string | null;
  aiStatus: AIStatus;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type ItemMetadataPatch = {
  sourceUrl?: string | null;
  title?: string;
  summary?: string;
  content?: string;
  thumbnailUrl?: string | null;
  aiStatus?: AIStatus;
  updatedAt: string;
};

export type CreateSyncJobPayload = {
  id: string;
  itemId: string;
  operation: SyncJobOperation;
  payloadJson: string;
  status: SyncJobStatus;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncQueueSummary = {
  pendingCount: number;
  failedCount: number;
};

export type SyncJob = CreateSyncJobPayload;

export type SyncWorkerResult =
  | {
      kind: 'idle';
      processedCount: number;
    }
  | {
      kind: 'deferred';
      processedCount: number;
      reason: string;
    }
  | {
      kind: 'completed';
      processedCount: number;
    };
