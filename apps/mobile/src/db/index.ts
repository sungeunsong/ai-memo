import { Platform } from 'react-native';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { createTablesStatement } from '@/db/schema';
import {
  mergeDomainDefinition,
  planFactMove,
  rewriteSerializedContentForMerge,
} from '@/features/taxonomy/merge';
import {
  deleteItemRowAsync as deleteItemRowInRepositoryAsync,
  listItemContentsAsync,
  updateItemContentAsync,
  insertUrlItemAsync,
  listItemUpdatedAtAsync as listItemUpdatedAtInRepositoryAsync,
  listItemsAsync,
  markStalledEnrichAsFailedAsync as markStalledEnrichAsFailedInRepositoryAsync,
  updateItemMetadataAsync as updateItemMetadataInRepositoryAsync,
  updateItemSyncStatusAsync as updateItemSyncStatusInRepositoryAsync,
  deleteItemAsync as deleteItemInRepositoryAsync,
  replaceUserCategoryAsync,
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
import {
  bumpDomainDefinitionUseAsync as bumpDomainUseInRepositoryAsync,
  updateDomainDefinitionLabelAsync,
  replaceDomainDefinitionAsync,
  deleteDomainDefinitionAsync,
  deleteFactDefinitionAsync,
  moveFactDefinitionAsync,
  bumpFactDefinitionUseAsync as bumpFactUseInRepositoryAsync,
  insertDomainDefinitionIfAbsentAsync,
  insertFactDefinitionIfAbsentAsync,
  upsertSeedDomainDefinitionAsync,
  upsertSeedFactDefinitionAsync,
  listDomainDefinitionsAsync,
  listFactDefinitionsAsync,
} from '@/db/taxonomyRepository';
import { isContentV2, migrateContentToV2 } from '@/features/items/contentV2';
import { applyItemPatch } from '@/features/items/patch';
import { SEED_DOMAINS, SEED_FACTS } from '@/features/taxonomy/seed';
import {
  CONFIRM_THRESHOLD,
  DomainDefinition,
  FactDefinition,
} from '@/features/taxonomy/types';
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
    'ALTER TABLE items ADD COLUMN user_title TEXT;',
    // 조각이 스크린샷을 담게 (2026-09)
    'ALTER TABLE item_sources ADD COLUMN image_uri TEXT;'
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
/**
 * 사전의 출발점을 심습니다. 이미 있는 것은 건드리지 않습니다.
 *
 * 앱을 켤 때마다 부르지만 ON CONFLICT DO NOTHING이라 여러 번 불려도 같습니다.
 * 사용자가 이름을 고쳐뒀다면 그 값이 유지됩니다.
 */
/**
 * 아이템의 구조화 데이터를 V2로 옮깁니다.
 *
 * 한 트랜잭션으로 처리합니다. 중간에 실패하면 통째로 없던 일이 되어, 절반만
 * 옮겨진 상태가 남지 않습니다. 그 상태는 화면에서 알아채기도 어렵고 되돌리기도
 * 어렵습니다.
 *
 * 이미 V2인 아이템은 건너뜁니다. contentVersion으로 판단하므로 몇 번을 실행해도
 * 결과가 같습니다. 실패해서 다시 돌릴 때 안심하고 부를 수 있어야 합니다.
 *
 * AI는 부르지 않습니다. V1 데이터가 이미 구조화되어 있어 기계적으로 옮겨집니다.
 * 원본은 legacy에 남겨, 나중에 더 잘게 쪼갤 때의 근거로 씁니다.
 */
export async function migrateItemContentsToV2Async(): Promise<{ migrated: number; skipped: number }> {
  if (Platform.OS === 'web') {
    const items = getWebItems();
    let migrated = 0;
    let skipped = 0;
    const next = items.map((item) => {
      const converted = migrateContentToV2(item.content);
      const serialized = JSON.stringify(converted);
      if (serialized === item.content) {
        skipped += 1;
        return item;
      }
      migrated += 1;
      return { ...item, content: serialized };
    });
    if (migrated > 0) saveWebItems(next);
    return { migrated, skipped };
  }

  let migrated = 0;
  let skipped = 0;

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      const rows = await listItemContentsAsync(database);

      for (const row of rows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.content || '{}');
        } catch {
          parsed = null;
        }

        if (isContentV2(parsed)) {
          skipped += 1;
          continue;
        }

        const converted = migrateContentToV2(row.content);
        if (!converted) {
          skipped += 1;
          continue;
        }

        await updateItemContentAsync(database, row.id, JSON.stringify(converted));
        migrated += 1;
      }
    })
  );

  return { migrated, skipped };
}

export async function seedTaxonomyAsync(now = Date.now()) {
  const stamp = new Date(now).toISOString();

  if (Platform.OS === 'web') {
    // 규칙(status·정책)은 앱이 소유하니 심고, 이름과 사용 이력은 그대로 둡니다.
    // 사용자가 고친 이름이 앱을 열 때마다 되돌아가면 고칠 이유가 없어집니다.
    const domains = getWebDomains();
    for (const seed of SEED_DOMAINS) {
      const found = domains.find((domain) => domain.key === seed.key);
      if (found) {
        found.status = 'confirmed';
        found.updatedAt = stamp;
        continue;
      }
      domains.push({ ...seed, status: 'confirmed', useCount: 0, createdAt: stamp, updatedAt: stamp });
    }
    saveWebDomains(domains);

    const facts = getWebFacts();
    for (const seed of SEED_FACTS) {
      const index = facts.findIndex(
        (fact) => fact.domainKey === seed.domainKey && fact.key === seed.key
      );
      const previous = index >= 0 ? facts[index] : null;
      const next: FactDefinition = {
        ...seed,
        status: 'confirmed',
        useCount: previous?.useCount ?? 0,
        createdAt: previous?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      if (index >= 0) facts[index] = next;
      else facts.push(next);
    }
    saveWebFacts(facts);
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      for (const domain of SEED_DOMAINS) {
        await upsertSeedDomainDefinitionAsync(database, {
          ...domain,
          status: 'confirmed',
          useCount: 0,
          createdAt: stamp,
          updatedAt: stamp,
        });
      }

      for (const fact of SEED_FACTS) {
        await upsertSeedFactDefinitionAsync(database, {
          ...fact,
          status: 'confirmed',
          useCount: 0,
          createdAt: stamp,
          updatedAt: stamp,
        });
      }
    })
  );
}

export async function getTaxonomyAsync(): Promise<{
  domains: DomainDefinition[];
  facts: FactDefinition[];
}> {
  if (Platform.OS === 'web') {
    // 많이 쓰인 순. 탭을 세우는 쪽이 이 순서를 그대로 씁니다.
    const domains = [...getWebDomains()].sort(
      (a, b) => b.useCount - a.useCount || a.key.localeCompare(b.key)
    );
    return { domains, facts: getWebFacts() };
  }

  const database = await getDatabaseAsync();
  const [domains, facts] = await Promise.all([
    listDomainDefinitionsAsync(database),
    listFactDefinitionsAsync(database),
  ]);
  return { domains, facts };
}

/** AI가 처음 만든 정의를 잠정으로 등록합니다. 이미 있으면 건드리지 않습니다. */
export async function registerProvisionalDefinitionsAsync(
  domain: DomainDefinition | null,
  facts: FactDefinition[]
) {
  if (Platform.OS === 'web') {
    if (domain) {
      const domains = getWebDomains();
      if (!domains.some((entry) => entry.key === domain.key)) {
        domains.push(domain);
        saveWebDomains(domains);
      }
    }

    if (facts.length > 0) {
      const stored = getWebFacts();
      let added = false;
      for (const fact of facts) {
        const exists = stored.some(
          (entry) => entry.domainKey === fact.domainKey && entry.key === fact.key
        );
        if (exists) continue;
        stored.push(fact);
        added = true;
      }
      if (added) saveWebFacts(stored);
    }
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      if (domain) await insertDomainDefinitionIfAbsentAsync(database, domain);
      for (const fact of facts) {
        await insertFactDefinitionIfAbsentAsync(database, fact);
      }
    })
  );
}

/** 쓰인 횟수를 올립니다. 임계치를 넘으면 확정으로 올라갑니다. */
export async function bumpTaxonomyUseAsync(domainKey: string, factKeys: string[]) {
  const stamp = new Date().toISOString();

  if (Platform.OS === 'web') {
    const domains = getWebDomains();
    const domain = domains.find((entry) => entry.key === domainKey);
    if (domain) {
      domain.useCount += 1;
      if (domain.useCount >= CONFIRM_THRESHOLD) domain.status = 'confirmed';
      domain.updatedAt = stamp;
      saveWebDomains(domains);
    }

    if (factKeys.length > 0) {
      const facts = getWebFacts();
      for (const key of factKeys) {
        const fact = facts.find((entry) => entry.domainKey === domainKey && entry.key === key);
        if (!fact) continue;
        fact.useCount += 1;
        if (fact.useCount >= CONFIRM_THRESHOLD) fact.status = 'confirmed';
        fact.updatedAt = stamp;
      }
      saveWebFacts(facts);
    }
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      await bumpDomainUseInRepositoryAsync(database, domainKey, CONFIRM_THRESHOLD, stamp);
      for (const key of factKeys) {
        await bumpFactUseInRepositoryAsync(database, domainKey, key, CONFIRM_THRESHOLD, stamp);
      }
    })
  );
}

/**
 * 분야를 만들거나, 이미 있으면 표시 이름을 바꿉니다.
 *
 * 두 일을 한 함수가 맡습니다. 없으면 만들고 있으면 이름만 고치는 동작이 원래부터
 * 하나였고(사전에 없는 분야의 이름을 고치려는 경우가 있어서), 사용자가 분야를
 * 직접 만들 때 필요한 것도 정확히 그것입니다.
 *
 * key는 그대로 둡니다. 아이템도 항목 정의도 전부 key로 물려 있어서, 이름을
 * 바꾸는 일이 저장된 것을 하나도 건드리지 않습니다. 아이템 안에 박힌 이름은
 * 저장 시점의 사본인데, 화면은 사전을 먼저 보므로 그쪽을 고칠 이유는 없습니다.
 *
 * 이름은 다음 정리 요청의 프롬프트에도 실립니다. 그래서 이름을 넓게 고쳐두면
 * 모델이 다음 글을 같은 분야로 모읍니다. 표시만 바꾸는 일이 아닙니다.
 */
export async function upsertDomainAsync(key: string, label: string): Promise<void> {
  const stamp = new Date().toISOString();

  // 사전에 없는 분야일 수 있습니다. 웹이 사전을 저장하기 전에 만들어진 아이템이
  // 그렇습니다. 그때는 이름만 바꿀 데가 없으니 정의부터 만들어 둡니다.
  // 없다고 그냥 돌아가면 사용자에게는 눌러도 아무 일이 없는 것으로 보입니다.
  const created: DomainDefinition = {
    key,
    label,
    status: 'provisional',
    useCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };

  if (Platform.OS === 'web') {
    const domains = getWebDomains();
    const domain = domains.find((entry) => entry.key === key);
    if (domain) {
      domain.label = label;
      domain.updatedAt = stamp;
    } else {
      domains.push(created);
    }
    saveWebDomains(domains);
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      await insertDomainDefinitionIfAbsentAsync(database, created);
      await updateDomainDefinitionLabelAsync(database, key, label, stamp);
    })
  );
}

/**
 * 두 분야를 하나로 합칩니다. fromKey가 사라지고 intoKey만 남습니다.
 *
 * 되돌릴 수 없습니다. 사라지는 쪽을 남겨두면 아이템이 어느 쪽을 가리키는지가
 * 흐려지고, 그 상태로 다음 정리가 돌면 다시 갈라집니다. 부르는 쪽에서 확인을
 * 받고 옵니다.
 *
 * 손대는 곳이 다섯입니다. 하나라도 빠지면 합친 뒤에 유령이 남습니다.
 * 아이템의 구조화 데이터, 사용자가 직접 지정한 분류, 분야 정의, 항목 정의,
 * 그리고 고정해둔 탭입니다. 마지막 하나는 화면이 들고 있어 부르는 쪽이 맡습니다.
 */
export async function mergeDomainsAsync(
  fromKey: string,
  into: { key: string; label: string }
): Promise<{ movedItems: number }> {
  if (fromKey === into.key) return { movedItems: 0 };

  const stamp = new Date().toISOString();

  if (Platform.OS === 'web') {
    let movedItems = 0;
    const items = getWebItems().map((item) => {
      const content = rewriteSerializedContentForMerge(item.content, fromKey, into);
      const category = item.userCategory === fromKey ? into.key : item.userCategory;

      if (!content && category === item.userCategory) return item;

      movedItems += 1;
      return {
        ...item,
        content: content ?? item.content,
        userCategory: category,
        updatedAt: stamp,
      };
    });
    if (movedItems > 0) saveWebItems(items);

    const facts = getWebFacts();
    const { move, drop } = planFactMove(
      facts.filter((fact) => fact.domainKey === fromKey),
      facts,
      into.key
    );
    const dropped = new Set(drop.map((fact) => `${fact.domainKey}.${fact.key}`));
    const movedKeys = new Set(move.map((fact) => fact.key));
    saveWebFacts(
      facts
        .filter((fact) => !dropped.has(`${fact.domainKey}.${fact.key}`))
        .map((fact) =>
          fact.domainKey === fromKey && movedKeys.has(fact.key)
            ? { ...fact, domainKey: into.key, updatedAt: stamp }
            : fact
        )
    );

    const domains = getWebDomains();
    const absorbed = domains.find((entry) => entry.key === fromKey);
    const surviving = domains.find((entry) => entry.key === into.key);
    if (surviving && absorbed) {
      Object.assign(surviving, mergeDomainDefinition(surviving, absorbed, CONFIRM_THRESHOLD, stamp));
    }
    saveWebDomains(domains.filter((entry) => entry.key !== fromKey));

    return { movedItems };
  }

  const database = await getDatabaseAsync();
  const allFacts = await listFactDefinitionsAsync(database);
  const { move, drop } = planFactMove(
    allFacts.filter((fact) => fact.domainKey === fromKey),
    allFacts,
    into.key
  );

  let movedItems = 0;

  await runWriteAsync((db) =>
    db.withTransactionAsync(async () => {
      const rows = await listItemContentsAsync(db);
      for (const row of rows) {
        const rewritten = rewriteSerializedContentForMerge(row.content, fromKey, into);
        if (!rewritten) continue;
        await updateItemContentAsync(db, row.id, rewritten);
        movedItems += 1;
      }

      await replaceUserCategoryAsync(db, fromKey, into.key, stamp);

      for (const fact of move) {
        await moveFactDefinitionAsync(db, fromKey, fact.key, into.key, stamp);
      }
      for (const fact of drop) {
        await deleteFactDefinitionAsync(db, fromKey, fact.key);
      }

      // 정의는 없을 수도 있습니다(사전에 등록되기 전의 분야). 아이템을 옮기는
      // 일이 본체이므로, 정의가 없다고 합치기 자체를 그만두지는 않습니다.
      const domains = await listDomainDefinitionsAsync(db);
      const absorbed = domains.find((entry) => entry.key === fromKey);
      const surviving = domains.find((entry) => entry.key === into.key);

      if (surviving && absorbed) {
        await replaceDomainDefinitionAsync(
          db,
          mergeDomainDefinition(surviving, absorbed, CONFIRM_THRESHOLD, stamp)
        );
      }
      await deleteDomainDefinitionAsync(db, fromKey);
    })
  );

  return { movedItems };
}

/**
 * 빈 분야를 지웁니다. 그 분야의 항목 정의도 함께 사라집니다.
 *
 * 글이 들어 있는 분야에는 쓰지 않습니다. 그 경우는 합치기가 맡습니다. 여기서까지
 * 글을 옮기면 되돌릴 수 없는 길이 두 개가 되고, 둘의 동작이 조금씩 달라집니다.
 * 글이 남아 있는데 정의만 지우면 그 글들은 이름 없는 분야를 가리키게 됩니다.
 *
 * 항목 정의를 같이 지우는 이유는, 남겨두면 주인 없는 정의가 프롬프트에 계속
 * 실려 모델에게 없는 분야를 가르치기 때문입니다.
 */
export async function deleteDomainAsync(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    saveWebDomains(getWebDomains().filter((domain) => domain.key !== key));
    saveWebFacts(getWebFacts().filter((fact) => fact.domainKey !== key));
    return;
  }

  await runWriteAsync((database) =>
    database.withTransactionAsync(async () => {
      const facts = await listFactDefinitionsAsync(database);
      for (const fact of facts) {
        if (fact.domainKey !== key) continue;
        await deleteFactDefinitionAsync(database, key, fact.key);
      }
      await deleteDomainDefinitionAsync(database, key);
    })
  );
}

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

/*
 * 웹의 사전 저장소.
 *
 * 예전에는 웹에서 사전을 통째로 건너뛰었습니다(빈 목록 반환). 그래서 웹에서
 * 저장한 글은 AI가 만든 분야가 어디에도 남지 않았고, 다음 요청의 프롬프트에도
 * 실리지 않아 같은 대상이 매번 다른 이름으로 들어왔습니다. 이름을 고치거나
 * 합치는 일은 애초에 가리킬 대상이 없었습니다.
 *
 * 아이템과 설정이 이미 localStorage에 있으니 사전도 같은 자리에 둡니다.
 * 정의는 몇십 개 수준이라 통짜로 읽고 쓰는 것으로 충분합니다.
 */
const WEB_TAXONOMY_DOMAINS_KEY = 'ai-memo.taxonomy-domains';
const WEB_TAXONOMY_FACTS_KEY = 'ai-memo.taxonomy-facts';

let memoryDomains: DomainDefinition[] = [];
let memoryFacts: FactDefinition[] = [];

function readWebList<T>(storageKey: string, fallback: T[]): T[] {
  if (typeof globalThis.localStorage === 'undefined') return [...fallback];

  const raw = globalThis.localStorage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    globalThis.localStorage.removeItem(storageKey);
    return [];
  }
}

function getWebDomains(): DomainDefinition[] {
  return readWebList(WEB_TAXONOMY_DOMAINS_KEY, memoryDomains);
}

function saveWebDomains(domains: DomainDefinition[]) {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryDomains = domains;
    return;
  }
  globalThis.localStorage.setItem(WEB_TAXONOMY_DOMAINS_KEY, JSON.stringify(domains));
}

function getWebFacts(): FactDefinition[] {
  return readWebList(WEB_TAXONOMY_FACTS_KEY, memoryFacts);
}

function saveWebFacts(facts: FactDefinition[]) {
  if (typeof globalThis.localStorage === 'undefined') {
    memoryFacts = facts;
    return;
  }
  globalThis.localStorage.setItem(WEB_TAXONOMY_FACTS_KEY, JSON.stringify(facts));
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
