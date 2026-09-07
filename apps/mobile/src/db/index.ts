import { Platform } from 'react-native';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { createTablesStatement } from '@/db/schema';
import {
  deleteItemRowAsync as deleteItemRowInRepositoryAsync,
  insertUrlItemAsync,
  listItemUpdatedAtAsync as listItemUpdatedAtInRepositoryAsync,
  listItemsAsync,
  markStalledEnrichAsFailedAsync as markStalledEnrichAsFailedInRepositoryAsync,
  updateItemMetadataAsync as updateItemMetadataInRepositoryAsync,
  updateItemSyncStatusAsync as updateItemSyncStatusInRepositoryAsync,
  deleteItemAsync as deleteItemInRepositoryAsync,
} from '@/db/itemsRepository';
import {
  getNextSyncRetryAtAsync as getNextSyncRetryAtInRepositoryAsync,
  getSyncQueueSummaryAsync as getSyncQueueSummaryInRepositoryAsync,
  listRunnableSyncJobsAsync as listRunnableSyncJobsInRepositoryAsync,
  markSyncJobCompletedAsync as markSyncJobCompletedInRepositoryAsync,
  markSyncJobFailedAsync as markSyncJobFailedInRepositoryAsync,
  markSyncJobPendingAsync as markSyncJobPendingInRepositoryAsync,
  claimSyncJobAsync as claimSyncJobInRepositoryAsync,
  recoverStalledSyncJobsAsync as recoverStalledSyncJobsInRepositoryAsync,
  upsertSyncJobAsync as upsertSyncJobInRepositoryAsync,
} from '@/db/syncJobsRepository';
import {
  deleteItemSourceAsync as deleteItemSourceInRepositoryAsync,
  deleteItemSourcesByItemAsync as deleteItemSourcesByItemInRepositoryAsync,
  hasSameItemSourceAsync as hasSameItemSourceInRepositoryAsync,
  updateItemSourceTextAsync as updateItemSourceTextInRepositoryAsync,
  insertItemSourceAsync as insertItemSourceInRepositoryAsync,
  listItemSourcesAsync as listItemSourcesInRepositoryAsync,
} from '@/db/sourcesRepository';
import { applyItemPatch } from '@/features/items/patch';
import { STALLED_ENRICH_MESSAGE } from '@/features/items/staleEnrich';
import { STALLED_SYNC_JOB_THRESHOLD_MS } from '@/sync/retryPolicy';
import {
  CreateSyncJobPayload,
  ItemMetadataPatch,
  ItemSource,
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
    'ALTER TABLE items ADD COLUMN image_uri TEXT;',
    'ALTER TABLE items ADD COLUMN user_deadline TEXT;',
    // 사용자가 고친 제목 (2026-09)
    'ALTER TABLE items ADD COLUMN user_title TEXT;'
  ];

  return runWriteAsync(async (database) => {
    await database.execAsync(createTablesStatement);

    for (const query of migrations) {
      try {
        await database.execAsync(query);
      } catch {
        // 이미 컬럼이 존재할 경우 발생하는 에러는 안전하게 무시합니다.
      }
    }

    return database;
  });
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

  await runWriteAsync((database) =>
    database.runAsync(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString()
    )
  );
}

/** 설정 전부. 백업에 담기 위한 통짜 조회입니다. */
export async function getAllSettingsAsync(): Promise<Record<string, string>> {
  if (Platform.OS === 'web') {
    if (typeof globalThis.localStorage === 'undefined') {
      return Object.fromEntries(memorySettings);
    }

    const result: Record<string, string> = {};
    for (let i = 0; i < globalThis.localStorage.length; i += 1) {
      const key = globalThis.localStorage.key(i);
      if (!key || !key.startsWith(WEB_SETTINGS_KEY_PREFIX)) continue;
      const value = globalThis.localStorage.getItem(key);
      if (value !== null) result[key.slice(WEB_SETTINGS_KEY_PREFIX.length)] = value;
    }
    return result;
  }

  const database = await getDatabaseAsync();
  const rows = await database.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings`
  );

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** 아이템별 최종 수정 시각. 가져올 때 어느 쪽이 최신인지 가리는 데 씁니다. */
export async function getItemUpdatedAtMapAsync(): Promise<Map<string, string>> {
  if (Platform.OS === 'web') {
    return new Map(getWebItems().map((item) => [item.id, item.updatedAt]));
  }

  const database = await getDatabaseAsync();
  return listItemUpdatedAtInRepositoryAsync(database);
}

/**
 * 가져온 아이템들을 한 트랜잭션으로 씁니다.
 *
 * 수백 건을 건건이 쓰면 그때마다 쓰기 락을 잡습니다. 무엇보다 중간에 실패하면
 * 절반만 들어간 상태로 남는데, 백업 복원에서 그건 가장 나쁜 결과입니다.
 * 통째로 성공하거나 통째로 없던 일이 되어야 합니다.
 *
 * 이미 있는 id는 지우고 다시 넣습니다. 컬럼이 스물세 개라 거대한 upsert 문을
 * 쓰는 것보다, 같은 트랜잭션 안의 삭제-삽입 한 쌍이 읽기 쉽습니다.
 */
export async function importItemsAsync(items: SavedItem[]) {
  if (Platform.OS === 'web') {
    for (const item of items) {
      deleteWebItem(item.id);
      saveWebItem(item);
    }
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      for (const item of items) {
        // 조각도 함께 교체합니다. 아이템만 갈아끼우면 옛 조각이 남아
        // 복원한 내용과 뒤섞입니다.
        await deleteItemSourcesByItemInRepositoryAsync(database, item.id);
        await deleteItemRowInRepositoryAsync(database, item.id);
        await insertUrlItemAsync(database, item);
        for (const source of item.sources) {
          await insertItemSourceInRepositoryAsync(database, source);
        }
      }
    })
  );
}

export async function getSavedItemsAsync(): Promise<SavedItem[]> {
  if (Platform.OS === 'web') {
    return getWebItems();
  }

  const database = await getDatabaseAsync();
  // Source는 별도 테이블이라 함께 읽어 붙입니다. 아이템마다 따로 물으면
  // 건수만큼 질의가 나가므로 한 번에 읽어 묶습니다.
  const [items, sourcesByItem] = await Promise.all([
    listItemsAsync(database),
    listItemSourcesInRepositoryAsync(database),
  ]);

  return items.map((item) => ({ ...item, sources: sourcesByItem.get(item.id) ?? [] }));
}

export async function addItemSourceAsync(source: ItemSource) {
  if (Platform.OS === 'web') {
    const items = getWebItems().map((item) =>
      item.id === source.itemId ? { ...item, sources: [...item.sources, source] } : item
    );
    saveWebItems(items);
    return;
  }

  await runWriteAsync((database) => insertItemSourceInRepositoryAsync(database, source));
}

export async function updateItemSourceTextAsync(sourceId: string, rawText: string | null) {
  if (Platform.OS === 'web') {
    const items = getWebItems().map((item) => ({
      ...item,
      sources: item.sources.map((source) =>
        source.id === sourceId ? { ...source, rawText } : source
      ),
    }));
    saveWebItems(items);
    return;
  }

  await runWriteAsync((database) =>
    updateItemSourceTextInRepositoryAsync(database, sourceId, rawText)
  );
}

export async function removeItemSourceAsync(sourceId: string) {
  if (Platform.OS === 'web') {
    const items = getWebItems().map((item) => ({
      ...item,
      sources: item.sources.filter((source) => source.id !== sourceId),
    }));
    saveWebItems(items);
    return;
  }

  await runWriteAsync((database) => deleteItemSourceInRepositoryAsync(database, sourceId));
}

/** 같은 조각이 이미 붙어 있는지. 같은 DM을 두 번 읽히지 않기 위한 검사입니다. */
export async function hasSameItemSourceAsync(
  itemId: string,
  sourceUrl: string | null,
  rawText: string | null
) {
  if (Platform.OS === 'web') {
    const item = getWebItems().find((entry) => entry.id === itemId);
    if (!item) return false;
    const trimmed = rawText?.trim();
    return item.sources.some(
      (source) =>
        (sourceUrl && source.sourceUrl === sourceUrl) ||
        (trimmed && source.rawText?.trim() === trimmed)
    );
  }

  const database = await getDatabaseAsync();
  return hasSameItemSourceInRepositoryAsync(database, itemId, sourceUrl, rawText);
}

export async function saveUrlItemAsync(item: SaveUrlPayload) {
  if (Platform.OS === 'web') {
    saveWebItem({ ...item, sources: [] });
    return item;
  }

  await runWriteAsync((database) => insertUrlItemAsync(database, item));
  return item;
}

export async function deleteItemAsync(itemId: string) {
  if (Platform.OS === 'web') {
    deleteWebItem(itemId);
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      await deleteItemSourcesByItemInRepositoryAsync(database, itemId);
      await deleteItemInRepositoryAsync(database, itemId);
    })
  );
}

/**
 * 앱이 꺼지면서 중단된 AI 보강을 실패로 회수합니다.
 * 회수한 건수를 돌려줍니다.
 */
export async function recoverStalledEnrichAsync(activeItemIds: string[], now = Date.now()) {
  const updatedAt = new Date(now).toISOString();

  if (Platform.OS === 'web') {
    const stalled = getWebItems().filter(
      (item) => item.aiStatus === 'pending' && !activeItemIds.includes(item.id)
    );
    stalled.forEach((item) =>
      updateWebItem(item.id, {
        aiStatus: 'failed',
        aiError: STALLED_ENRICH_MESSAGE,
        updatedAt,
      })
    );
    return stalled.length;
  }

  return runWriteAsync((database) =>
    markStalledEnrichAsFailedInRepositoryAsync(
      database,
      activeItemIds,
      STALLED_ENRICH_MESSAGE,
      updatedAt
    )
  );
}

/**
 * 앱이 꺼지며 'processing'에 갇힌 동기화 job을 회수합니다.
 * 회수한 건수를 돌려줍니다.
 */
export async function recoverStalledSyncJobsAsync(now = Date.now()) {
  const staleBefore = new Date(now - STALLED_SYNC_JOB_THRESHOLD_MS).toISOString();
  const updatedAt = new Date(now).toISOString();

  if (Platform.OS === 'web') {
    const stalled = getWebSyncJobs().filter(
      (job) => job.status === 'processing' && job.updatedAt <= staleBefore
    );
    stalled.forEach((job) => updateWebSyncJob(job.id, { status: 'pending', updatedAt }));
    return stalled.length;
  }

  return runWriteAsync((database) =>
    recoverStalledSyncJobsInRepositoryAsync(database, staleBefore, updatedAt)
  );
}

export async function saveUrlItemWithSyncJobAsync(item: SaveUrlPayload, job: CreateSyncJobPayload) {
  if (Platform.OS === 'web') {
    saveWebItem({ ...item, sources: [] } as SavedItem);
    saveWebSyncJob(job);
    return item;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      await insertUrlItemAsync(database, item);
      // job id가 sync_<itemId>로 고정이라 INSERT는 같은 아이템에 두 번 부르면
      // UNIQUE 위반으로 저장 전체를 되돌립니다. 지금은 그럴 경로가 없지만,
      // 큐를 다시 거는 쪽과 같은 함수를 쓰면 그 위험 자체가 없어집니다.
      await upsertSyncJobInRepositoryAsync(database, job);
    })
  );

  return item;
}

export async function queueUpsertItemSyncAsync(item: SavedItem) {
  const syncJob = buildItemSyncJob(item);

  if (Platform.OS === 'web') {
    updateWebItemSyncStatus(item.id, 'queued', item.updatedAt);
    saveWebSyncJob(syncJob);
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      await updateItemSyncStatusInRepositoryAsync(database, item.id, 'queued', item.updatedAt);
      await upsertSyncJobInRepositoryAsync(database, syncJob);
    })
  );
}

export async function updateItemMetadataAsync(itemId: string, patch: ItemMetadataPatch) {
  if (Platform.OS === 'web') {
    updateWebItem(itemId, patch);
    return;
  }

  await runWriteAsync((database) => updateItemMetadataInRepositoryAsync(database, itemId, patch));
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

  await runWriteAsync((database) =>
    updateItemSyncStatusInRepositoryAsync(database, itemId, syncStatus, updatedAt)
  );
}

export async function getSyncQueueSummaryAsync() {
  if (Platform.OS === 'web') {
    return getWebSyncQueueSummary();
  }

  const database = await getDatabaseAsync();
  return getSyncQueueSummaryInRepositoryAsync(database);
}

/**
 * 아직 때가 되지 않은 재시도 중 가장 이른 시각. 없으면 null입니다.
 * 백오프가 잡아둔 시각에 맞춰 워커를 깨우는 데 씁니다.
 */
export async function getNextSyncRetryAtAsync(now = Date.now()) {
  const nowIso = new Date(now).toISOString();

  if (Platform.OS === 'web') {
    const upcoming = getWebSyncJobs()
      .filter((job) => job.status === 'failed' && job.nextRetryAt && job.nextRetryAt > nowIso)
      .map((job) => job.nextRetryAt as string)
      .sort();

    return upcoming[0] ?? null;
  }

  const database = await getDatabaseAsync();
  return getNextSyncRetryAtInRepositoryAsync(database, nowIso);
}

export async function getRunnableSyncJobsAsync(limit: number) {
  if (Platform.OS === 'web') {
    return getWebRunnableSyncJobs(limit);
  }

  const database = await getDatabaseAsync();
  return listRunnableSyncJobsInRepositoryAsync(database, new Date().toISOString(), limit);
}

/**
 * job을 처리 중으로 잡고, 그 시점의 내용을 돌려줍니다.
 * 사이에 아이템이 삭제됐으면 null입니다.
 */
export async function claimSyncJobAsync(
  jobId: string,
  attemptCount: number,
  updatedAt: string
): Promise<SyncJob | null> {
  if (Platform.OS === 'web') {
    updateWebSyncJob(jobId, {
      status: 'processing',
      attemptCount,
      updatedAt,
    });
    return getWebSyncJobs().find((job) => job.id === jobId) ?? null;
  }

  // withTransactionAsync는 값을 돌려주지 않아 바깥 변수로 받습니다.
  let claimed: SyncJob | null = null;
  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      claimed = await claimSyncJobInRepositoryAsync(database, jobId, attemptCount, updatedAt);
    })
  );

  return claimed;
}

export async function restoreSyncJobPendingAsync(jobId: string, updatedAt: string) {
  if (Platform.OS === 'web') {
    updateWebSyncJob(jobId, {
      status: 'pending',
      updatedAt,
    });
    return;
  }

  await runWriteAsync((database) =>
    markSyncJobPendingInRepositoryAsync(database, jobId, updatedAt)
  );
}

/**
 * 동기화 성공을 기록합니다.
 *
 * 잡아둔 뒤 job이 갱신됐다면(보강이 끝나 새 payload가 큐잉된 경우) 아무것도 쓰지 않고
 * false를 돌려줍니다. 그 job은 새 내용으로 다시 전송돼야 합니다.
 */
export async function markSyncJobSyncedAsync(
  jobId: string,
  itemId: string,
  updatedAt: string,
  expectedUpdatedAt: string
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const job = getWebSyncJobs().find((entry) => entry.id === jobId);
    if (!job || job.updatedAt !== expectedUpdatedAt) {
      return false;
    }

    updateWebItemSyncStatus(itemId, 'synced', updatedAt);
    updateWebSyncJob(jobId, {
      status: 'completed',
      lastError: null,
      nextRetryAt: null,
      updatedAt,
    });
    return true;
  }

  let applied = false;
  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      // job을 먼저 씁니다. 갱신돼 있으면 아이템 상태도 건드리지 않아야 합니다.
      const changes = await markSyncJobCompletedInRepositoryAsync(
        database,
        jobId,
        updatedAt,
        expectedUpdatedAt
      );
      applied = changes > 0;

      if (applied) {
        await updateItemSyncStatusInRepositoryAsync(database, itemId, 'synced', updatedAt);
      }
    })
  );

  return applied;
}

/** 완료와 같은 이유로, 잡아둔 뒤 갱신되지 않았을 때만 실패를 기록합니다. */
export async function failSyncJobAttemptAsync(
  jobId: string,
  itemId: string,
  attemptCount: number,
  lastError: string,
  nextRetryAt: string | null,
  updatedAt: string,
  expectedUpdatedAt: string
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const job = getWebSyncJobs().find((entry) => entry.id === jobId);
    if (!job || job.updatedAt !== expectedUpdatedAt) {
      return false;
    }

    updateWebItemSyncStatus(itemId, 'failed', updatedAt);
    updateWebSyncJob(jobId, {
      status: 'failed',
      attemptCount,
      lastError,
      nextRetryAt,
      updatedAt,
    });
    return true;
  }

  let applied = false;
  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      const changes = await markSyncJobFailedInRepositoryAsync(
        database,
        jobId,
        attemptCount,
        lastError,
        nextRetryAt,
        updatedAt,
        expectedUpdatedAt
      );
      applied = changes > 0;

      if (applied) {
        await updateItemSyncStatusInRepositoryAsync(database, itemId, 'failed', updatedAt);
      }
    })
  );

  return applied;
}

/**
 * DB 쓰기를 한 줄로 세웁니다.
 *
 * expo-sqlite의 withTransactionAsync는 배타적이지 않습니다. 커넥션 하나를 공유하는데
 * 저장/보강/동기화 워커가 각자 BEGIN을 걸면, 뒤늦은 쪽의 BEGIN이 실패하고
 * 그 catch가 실행하는 ROLLBACK이 앞선 트랜잭션까지 되돌려 버립니다.
 * 그러면 앞선 쪽은 COMMIT에서 실패하고, 이어지는 ROLLBACK마저
 * 'cannot rollback - no transaction is active'로 터집니다. 양쪽 쓰기가 모두 사라집니다.
 *
 * 읽기는 BEGIN을 걸지 않아 이 문제를 일으키지 않으므로 줄을 세우지 않습니다.
 * 목록 조회가 쓰기 뒤에서 기다리면 화면만 느려집니다.
 */
let writeLock: Promise<void> = Promise.resolve();

function runWriteAsync<T>(task: (database: SQLiteDatabase) => Promise<T>): Promise<T> {
  const run = writeLock.then(async () => {
    const database = await getDatabaseAsync();
    return task(database);
  });

  // 앞 작업이 실패해도 뒤 작업은 실행돼야 하므로 체인에서는 에러를 흘려보냅니다.
  // 에러 자체는 run을 통해 호출자에게 그대로 전달됩니다.
  writeLock = run.then(
    () => undefined,
    () => undefined
  );

  return run;
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

/** 웹 저장소 통째 쓰기. Source처럼 여러 아이템을 한 번에 고칠 때 씁니다. */
function saveWebItems(items: SavedItem[]) {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryItems = items;
    return;
  }

  globalThis.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(items));
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
    item.id === itemId ? applyItemPatch(item, patch) : item
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
