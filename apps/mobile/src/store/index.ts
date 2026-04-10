import { create } from 'zustand';

import {
  getSavedItemsAsync,
  getSyncQueueSummaryAsync,
  initializeDatabase,
  queueUpsertItemSyncAsync,
  saveUrlItemWithSyncJobAsync,
  updateItemMetadataAsync,
} from '@/db';
import { fetchMetadataPatch } from '@/features/metadata/service';
import { buildFallbackUrlItem, normalizeUrl } from '@/features/items/fallback';
import {
  ItemMetadataPatch,
  SavedItem,
} from '@/features/items/types';
import { runSyncQueueOnce } from '@/sync/worker';

let initializationPromise: Promise<void> | null = null;
let syncWorkerPromise: Promise<void> | null = null;

type SaveUrlResult = {
  ok: boolean;
  message?: string;
};

type AppStore = {
  isReady: boolean;
  isInitializing: boolean;
  hasInitializationAttempted: boolean;
  isSaving: boolean;
  items: SavedItem[];
  selectedItemId: string | null;
  errorMessage: string | null;
  syncQueuePendingCount: number;
  syncQueueFailedCount: number;
  syncWorkerMessage: string | null;
  isSyncWorkerRunning: boolean;
  initialize: () => Promise<void>;
  saveUrl: (input: string) => Promise<SaveUrlResult>;
  selectItem: (itemId: string) => void;
  clearError: () => void;
};

export const useAppStore = create<AppStore>((set, get) => ({
  isReady: false,
  isInitializing: false,
  hasInitializationAttempted: false,
  isSaving: false,
  items: [],
  selectedItemId: null,
  errorMessage: null,
  syncQueuePendingCount: 0,
  syncQueueFailedCount: 0,
  syncWorkerMessage: null,
  isSyncWorkerRunning: false,
  async initialize() {
    if (get().isReady) {
      return;
    }

    if (initializationPromise) {
      return initializationPromise;
    }

    set({
      isInitializing: true,
      hasInitializationAttempted: true,
      errorMessage: null,
    });

    initializationPromise = (async () => {
      try {
        await initializeDatabase();
        const [items, syncQueueSummary] = await Promise.all([
          getSavedItemsAsync(),
          getSyncQueueSummaryAsync(),
        ]);

        set({
          isReady: true,
          isInitializing: false,
          items,
          selectedItemId: items[0]?.id ?? null,
          syncQueuePendingCount: syncQueueSummary.pendingCount,
          syncQueueFailedCount: syncQueueSummary.failedCount,
        });

        void runSyncWorker(set);
      } catch (error) {
        set({
          isReady: false,
          isInitializing: false,
          errorMessage: error instanceof Error ? error.message : '초기화에 실패했습니다.',
        });
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  },
  async saveUrl(input) {
    if (!get().isReady) {
      await get().initialize();
    }

    set({
      isSaving: true,
      errorMessage: null,
    });

    try {
      if (!get().isReady) {
        throw new Error('로컬 저장소를 준비하지 못했습니다. 다시 시도해 주세요.');
      }

      const normalizedUrl = normalizeUrl(input);
      const fallbackItem = {
        ...buildFallbackUrlItem(normalizedUrl, input),
        syncStatus: 'queued' as const,
      };
      const syncJob = buildItemSyncJob(fallbackItem);
      await saveUrlItemWithSyncJobAsync(fallbackItem, syncJob);

      set((state) => ({
        isSaving: false,
        items: [fallbackItem, ...state.items],
        selectedItemId: fallbackItem.id,
        syncQueuePendingCount: state.syncQueuePendingCount + 1,
        syncWorkerMessage: null,
      }));

      void enrichSavedItemMetadata(fallbackItem.id, fallbackItem.sourceUrl, set, get);
      void runSyncWorker(set);

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '저장에 실패했습니다.';

      set({
        isSaving: false,
        errorMessage: message,
      });

      return {
        ok: false,
        message,
      };
    }
  },
  selectItem(itemId) {
    set({
      selectedItemId: itemId,
    });
  },
  clearError() {
    set({
      errorMessage: null,
    });
  },
}));

async function enrichSavedItemMetadata(
  itemId: string,
  sourceUrl: string,
  set: (
    partial:
      | Partial<AppStore>
      | AppStore
      | ((state: AppStore) => Partial<AppStore> | AppStore)
  ) => void,
  get: () => AppStore
) {
  const patch = await fetchMetadataPatch(sourceUrl);
  await updateItemMetadataAsync(itemId, patch);

  const nextItems = get().items.map((item) => applyMetadataPatch(item, itemId, patch));
  const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;

  set({
    items: nextItems,
  });

  if (itemToQueue) {
    await queueUpsertItemSyncAsync({
      id: itemToQueue.id,
      type: itemToQueue.type,
      sourceUrl: itemToQueue.sourceUrl,
      rawInput: itemToQueue.rawInput,
      title: itemToQueue.title,
      summary: itemToQueue.summary,
      content: itemToQueue.content,
      thumbnailUrl: itemToQueue.thumbnailUrl,
      aiStatus: itemToQueue.aiStatus,
      syncStatus: 'queued',
      createdAt: itemToQueue.createdAt,
      updatedAt: itemToQueue.updatedAt,
    });

    set((state) => ({
      items: state.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              syncStatus: 'queued',
            }
          : item
      ),
      syncWorkerMessage: null,
    }));
  }

  void runSyncWorker(set);
}

function applyMetadataPatch(item: SavedItem, itemId: string, patch: ItemMetadataPatch) {
  if (item.id !== itemId) {
    return item;
  }

  return {
    ...item,
    ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : null),
    ...(patch.title ? { title: patch.title } : null),
    ...(patch.summary ? { summary: patch.summary } : null),
    ...(patch.content ? { content: patch.content } : null),
    ...(patch.thumbnailUrl !== undefined ? { thumbnailUrl: patch.thumbnailUrl } : null),
    ...(patch.aiStatus ? { aiStatus: patch.aiStatus } : null),
    updatedAt: patch.updatedAt,
  };
}

function buildItemSyncJob(item: SavedItem) {
  return {
    id: `sync_${item.id}`,
    itemId: item.id,
    operation: 'upsert_item' as const,
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
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
    status: 'pending' as const,
    attemptCount: 0,
    lastError: null,
    nextRetryAt: null,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
  };
}

async function runSyncWorker(
  set: (
    partial:
      | Partial<AppStore>
      | AppStore
      | ((state: AppStore) => Partial<AppStore> | AppStore)
  ) => void
) {
  if (syncWorkerPromise) {
    return syncWorkerPromise;
  }

  syncWorkerPromise = (async () => {
    set({
      isSyncWorkerRunning: true,
    });

    try {
      const result = await runSyncQueueOnce();
      const summary = await getSyncQueueSummaryAsync();

      set((state) => ({
        items: state.items,
        syncQueuePendingCount: summary.pendingCount,
        syncQueueFailedCount: summary.failedCount,
        syncWorkerMessage:
          result.kind === 'deferred'
            ? result.reason
            : result.kind === 'completed'
              ? null
              : state.syncWorkerMessage,
        isSyncWorkerRunning: false,
      }));
    } catch (error) {
      const summary = await getSyncQueueSummaryAsync();

      set({
        syncQueuePendingCount: summary.pendingCount,
        syncQueueFailedCount: summary.failedCount,
        syncWorkerMessage: error instanceof Error ? error.message : '동기화 워커 실행에 실패했습니다.',
        isSyncWorkerRunning: false,
      });
    } finally {
      syncWorkerPromise = null;
    }
  })();

  return syncWorkerPromise;
}
