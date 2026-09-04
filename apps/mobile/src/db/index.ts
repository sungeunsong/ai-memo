import { Platform } from 'react-native';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { createTablesStatement } from '@/db/schema';
import {
  insertUrlItemAsync,
  listItemsAsync,
  updateItemMetadataAsync as updateItemMetadataInRepositoryAsync,
  updateItemSyncStatusAsync as updateItemSyncStatusInRepositoryAsync,
  deleteItemAsync as deleteItemInRepositoryAsync,
} from '@/db/itemsRepository';
import {
  getSyncQueueSummaryAsync as getSyncQueueSummaryInRepositoryAsync,
  insertSyncJobAsync,
  listRunnableSyncJobsAsync as listRunnableSyncJobsInRepositoryAsync,
  markSyncJobCompletedAsync as markSyncJobCompletedInRepositoryAsync,
  markSyncJobFailedAsync as markSyncJobFailedInRepositoryAsync,
  markSyncJobPendingAsync as markSyncJobPendingInRepositoryAsync,
  markSyncJobProcessingAsync as markSyncJobProcessingInRepositoryAsync,
  upsertSyncJobAsync as upsertSyncJobInRepositoryAsync,
} from '@/db/syncJobsRepository';
import {
  CreateSyncJobPayload,
  ItemMetadataPatch,
  SaveUrlPayload,
  SavedItem,
  SyncJob,
  SyncQueueSummary,
} from '@/features/items/types';

const DATABASE_NAME = 'ai-memo.db';
const WEB_STORAGE_KEY = 'ai-memo.items';
const WEB_SYNC_JOBS_STORAGE_KEY = 'ai-memo.sync-jobs';

let databasePromise: Promise<SQLiteDatabase> | null = null;
let memoryItems: SavedItem[] = [];
let memorySyncJobs: CreateSyncJobPayload[] = [];

export async function initializeDatabase() {
  if (Platform.OS === 'web') {
    ensureWebStorageAvailable();
    return null;
  }

  const database = await getDatabaseAsync();
  await database.execAsync(createTablesStatement);

  // 마이그레이션: 기존 테이블에 신규 컬럼이 없을 경우 추가
  const migrations = [
    'ALTER TABLE items ADD COLUMN user_note TEXT;',
    'ALTER TABLE items ADD COLUMN extracted_urls TEXT;',
    'ALTER TABLE items ADD COLUMN source_type TEXT DEFAULT "web";',
    'ALTER TABLE items ADD COLUMN saved_from TEXT DEFAULT "manual";',
    // 원문/본문/파생물 분리 (2026-09)
    'ALTER TABLE items ADD COLUMN content_text TEXT;',
    'ALTER TABLE items ADD COLUMN digest TEXT;',
    'ALTER TABLE items ADD COLUMN ai_error TEXT;',
    'ALTER TABLE items ADD COLUMN user_category TEXT;',
    'ALTER TABLE items ADD COLUMN image_uri TEXT;'
  ];

  for (const query of migrations) {
    try {
      await database.execAsync(query);
    } catch {
      // 이미 컬럼이 존재할 경우 발생하는 에러는 안전하게 무시합니다.
    }
  }

  return database;
}

const WEB_SETTINGS_KEY_PREFIX = 'ai-memo.setting.';
const memorySettings = new Map<string, string>();

/**
 * 앱 설정용 단순 key-value 저장소.
 * 냉장고 재료처럼 아이템에 속하지 않는 사용자 상태를 담습니다.
 */
export async function getSettingAsync(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.localStorage === 'undefined') {
      return memorySettings.get(key) ?? null;
    }
    return globalThis.localStorage.getItem(WEB_SETTINGS_KEY_PREFIX + key);
  }

  const database = await getDatabaseAsync();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setSettingAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.localStorage === 'undefined') {
      memorySettings.set(key, value);
      return;
    }
    globalThis.localStorage.setItem(WEB_SETTINGS_KEY_PREFIX + key, value);
    return;
  }

  const database = await getDatabaseAsync();
  await database.runAsync(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString()
  );
}

export async function getSavedItemsAsync() {
  if (Platform.OS === 'web') {
    return getWebItems();
  }

  const database = await getDatabaseAsync();
  return listItemsAsync(database);
}

export async function saveUrlItemAsync(item: SaveUrlPayload) {
  if (Platform.OS === 'web') {
    saveWebItem(item);
    return item;
  }

  const database = await getDatabaseAsync();
  await insertUrlItemAsync(database, item);
  return item;
}

export async function deleteItemAsync(itemId: string) {
  if (Platform.OS === 'web') {
    deleteWebItem(itemId);
    return;
  }

  const database = await getDatabaseAsync();
  await deleteItemInRepositoryAsync(database, itemId);
}

export async function saveUrlItemWithSyncJobAsync(item: SaveUrlPayload, job: CreateSyncJobPayload) {
  if (Platform.OS === 'web') {
    saveWebItem(item);
    saveWebSyncJob(job);
    return item;
  }

  const database = await getDatabaseAsync();
  await database.withTransactionAsync(async () => {
    await insertUrlItemAsync(database, item);
    await insertSyncJobAsync(database, job);
  });

  return item;
}

export async function queueUpsertItemSyncAsync(item: SavedItem) {
  const syncJob = buildItemSyncJob(item);

  if (Platform.OS === 'web') {
    updateWebItemSyncStatus(item.id, 'queued', item.updatedAt);
    saveWebSyncJob(syncJob);
    return;
  }

  const database = await getDatabaseAsync();
  await database.withTransactionAsync(async () => {
    await updateItemSyncStatusInRepositoryAsync(database, item.id, 'queued', item.updatedAt);
    await upsertSyncJobInRepositoryAsync(database, syncJob);
  });
}

export async function updateItemMetadataAsync(itemId: string, patch: ItemMetadataPatch) {
  if (Platform.OS === 'web') {
    updateWebItem(itemId, patch);
    return;
  }

  const database = await getDatabaseAsync();
  await updateItemMetadataInRepositoryAsync(database, itemId, patch);
}

export async function updateItemSyncStatusAsync(
  itemId: string,
  syncStatus: SavedItem['syncStatus'],
  updatedAt: string
) {
  if (Platform.OS === 'web') {
    updateWebItemSyncStatus(itemId, syncStatus, updatedAt);
    return;
  }

  const database = await getDatabaseAsync();
  await updateItemSyncStatusInRepositoryAsync(database, itemId, syncStatus, updatedAt);
}

export async function getSyncQueueSummaryAsync() {
  if (Platform.OS === 'web') {
    return getWebSyncQueueSummary();
  }

  const database = await getDatabaseAsync();
  return getSyncQueueSummaryInRepositoryAsync(database);
}

export async function getRunnableSyncJobsAsync(limit: number) {
  if (Platform.OS === 'web') {
    return getWebRunnableSyncJobs(limit);
  }

  const database = await getDatabaseAsync();
  return listRunnableSyncJobsInRepositoryAsync(database, new Date().toISOString(), limit);
}

export async function markSyncJobProcessingAsync(
  jobId: string,
  attemptCount: number,
  updatedAt: string
) {
  if (Platform.OS === 'web') {
    updateWebSyncJob(jobId, {
      status: 'processing',
      attemptCount,
      updatedAt,
    });
    return;
  }

  const database = await getDatabaseAsync();
  await markSyncJobProcessingInRepositoryAsync(database, jobId, attemptCount, updatedAt);
}

export async function restoreSyncJobPendingAsync(jobId: string, updatedAt: string) {
  if (Platform.OS === 'web') {
    updateWebSyncJob(jobId, {
      status: 'pending',
      updatedAt,
    });
    return;
  }

  const database = await getDatabaseAsync();
  await markSyncJobPendingInRepositoryAsync(database, jobId, updatedAt);
}

export async function markSyncJobSyncedAsync(jobId: string, itemId: string, updatedAt: string) {
  if (Platform.OS === 'web') {
    updateWebItemSyncStatus(itemId, 'synced', updatedAt);
    updateWebSyncJob(jobId, {
      status: 'completed',
      lastError: null,
      nextRetryAt: null,
      updatedAt,
    });
    return;
  }

  const database = await getDatabaseAsync();
  await database.withTransactionAsync(async () => {
    await updateItemSyncStatusInRepositoryAsync(database, itemId, 'synced', updatedAt);
    await markSyncJobCompletedInRepositoryAsync(database, jobId, updatedAt);
  });
}

export async function failSyncJobAttemptAsync(
  jobId: string,
  itemId: string,
  attemptCount: number,
  lastError: string,
  nextRetryAt: string | null,
  updatedAt: string
) {
  if (Platform.OS === 'web') {
    updateWebItemSyncStatus(itemId, 'failed', updatedAt);
    updateWebSyncJob(jobId, {
      status: 'failed',
      attemptCount,
      lastError,
      nextRetryAt,
      updatedAt,
    });
    return;
  }

  const database = await getDatabaseAsync();
  await database.withTransactionAsync(async () => {
    await updateItemSyncStatusInRepositoryAsync(database, itemId, 'failed', updatedAt);
    await markSyncJobFailedInRepositoryAsync(
      database,
      jobId,
      attemptCount,
      lastError,
      nextRetryAt,
      updatedAt
    );
  });
}

async function getDatabaseAsync() {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

function ensureWebStorageAvailable() {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = [];
    memorySyncJobs = [];
  }
}

function getWebItems() {
  if (typeof globalThis.localStorage === 'undefined') {
    return [...memoryItems];
  }

  const raw = globalThis.localStorage.getItem(WEB_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as SavedItem[];
    return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    globalThis.localStorage.removeItem(WEB_STORAGE_KEY);
    return [];
  }
}

function saveWebItem(item: SavedItem) {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = [item, ...memoryItems];
    return;
  }

  const nextItems = [item, ...getWebItems()];
  globalThis.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(nextItems));
}

function deleteWebItem(itemId: string) {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = memoryItems.filter((item) => item.id !== itemId);
    return;
  }

  const nextItems = getWebItems().filter((item) => item.id !== itemId);
  globalThis.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(nextItems));

  // 관련 sync job도 제거
  const nextJobs = getWebSyncJobs().filter((job) => job.itemId !== itemId);
  globalThis.localStorage.setItem(WEB_SYNC_JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
}

function saveWebSyncJob(job: CreateSyncJobPayload) {
  if (typeof globalThis.localStorage === 'undefined') {
    memorySyncJobs = [job, ...memorySyncJobs];
    return;
  }

  const nextJobs = [job, ...getWebSyncJobs()];
  globalThis.localStorage.setItem(WEB_SYNC_JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
}

function updateWebSyncJob(
  jobId: string,
  patch: Partial<
    Pick<CreateSyncJobPayload, 'status' | 'attemptCount' | 'lastError' | 'nextRetryAt' | 'updatedAt'>
  >
) {
  const nextJobs = getWebSyncJobs().map((job) =>
    job.id === jobId
      ? {
          ...job,
          ...(patch.status ? { status: patch.status } : null),
          ...(patch.attemptCount !== undefined ? { attemptCount: patch.attemptCount } : null),
          ...(patch.lastError !== undefined ? { lastError: patch.lastError } : null),
          ...(patch.nextRetryAt !== undefined ? { nextRetryAt: patch.nextRetryAt } : null),
          ...(patch.updatedAt ? { updatedAt: patch.updatedAt } : null),
        }
      : job
  );

  if (typeof globalThis.localStorage === 'undefined') {
    memorySyncJobs = nextJobs;
    return;
  }

  globalThis.localStorage.setItem(WEB_SYNC_JOBS_STORAGE_KEY, JSON.stringify(nextJobs));
}

function updateWebItem(itemId: string, patch: ItemMetadataPatch) {
  const nextItems = getWebItems().map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : null),
          ...(patch.title ? { title: patch.title } : null),
          ...(patch.summary ? { summary: patch.summary } : null),
          ...(patch.content ? { content: patch.content } : null),
          ...(patch.contentText ? { contentText: patch.contentText } : null),
          ...(patch.digest ? { digest: patch.digest } : null),
          ...(patch.aiError !== undefined ? { aiError: patch.aiError } : null),
          ...(patch.userCategory !== undefined ? { userCategory: patch.userCategory } : null),
          ...(patch.imageUri ? { imageUri: patch.imageUri } : null),
          ...(patch.thumbnailUrl !== undefined ? { thumbnailUrl: patch.thumbnailUrl } : null),
          ...(patch.aiStatus ? { aiStatus: patch.aiStatus } : null),
          ...(patch.userNote !== undefined ? { userNote: patch.userNote } : null),
          ...(patch.extractedUrls !== undefined ? { extractedUrls: patch.extractedUrls } : null),
          ...(patch.sourceType ? { sourceType: patch.sourceType } : null),
          ...(patch.savedFrom ? { savedFrom: patch.savedFrom } : null),
          updatedAt: patch.updatedAt,
        }
      : item
  );

  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = nextItems;
    return;
  }

  globalThis.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(nextItems));
}

function updateWebItemSyncStatus(
  itemId: string,
  syncStatus: SavedItem['syncStatus'],
  updatedAt: string
) {
  const nextItems = getWebItems().map((item) =>
    item.id === itemId
      ? {
          ...item,
          syncStatus,
          updatedAt,
        }
      : item
  );

  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = nextItems;
    return;
  }

  globalThis.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(nextItems));
}

function getWebSyncJobs() {
  if (typeof globalThis.localStorage === 'undefined') {
    return [...memorySyncJobs];
  }

  const raw = globalThis.localStorage.getItem(WEB_SYNC_JOBS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as CreateSyncJobPayload[];
  } catch {
    globalThis.localStorage.removeItem(WEB_SYNC_JOBS_STORAGE_KEY);
    return [];
  }
}

function getWebRunnableSyncJobs(limit: number) {
  const now = new Date().toISOString();

  return getWebSyncJobs()
    .filter(
      (job) =>
        job.status === 'pending' ||
        (job.status === 'failed' && (!job.nextRetryAt || job.nextRetryAt <= now))
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

function getWebSyncQueueSummary(): SyncQueueSummary {
  return getWebSyncJobs().reduce<SyncQueueSummary>(
    (summary, job) => {
      if (job.status === 'failed') {
        summary.failedCount += 1;
        return summary;
      }

      if (job.status === 'pending' || job.status === 'processing') {
        summary.pendingCount += 1;
      }

      return summary;
    },
    {
      pendingCount: 0,
      failedCount: 0,
    }
  );
}

function buildItemSyncJob(item: SavedItem): CreateSyncJobPayload {
  return {
    id: `sync_${item.id}`,
    itemId: item.id,
    operation: 'upsert_item',
    payloadJson: JSON.stringify({
      itemId: item.id,
      type: item.type,
      sourceUrl: item.sourceUrl,
      rawInput: item.rawInput,
      title: item.title,
      summary: item.summary,
      content: item.content,
      thumbnailUrl: item.thumbnailUrl,
      aiStatus: item.aiStatus,
      syncStatus: item.syncStatus,
      userNote: item.userNote,
      extractedUrls: item.extractedUrls,
      sourceType: item.sourceType,
      savedFrom: item.savedFrom,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    nextRetryAt: null,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
  };
}
