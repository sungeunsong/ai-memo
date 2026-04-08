export type ItemType = 'url' | 'text';

export type AIStatus = 'pending' | 'completed' | 'failed';

export type SyncStatus = 'local_only' | 'queued' | 'synced' | 'failed';

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
