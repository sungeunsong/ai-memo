import { create } from 'zustand';
import { Alert } from 'react-native';

import {
  getSavedItemsAsync,
  getSyncQueueSummaryAsync,
  initializeDatabase,
  queueUpsertItemSyncAsync,
  saveUrlItemWithSyncJobAsync,
  updateItemMetadataAsync,
  deleteItemAsync,
} from '@/db';
import {
  fetchMetadataPatch,
  fetchTextMetadataPatch,
  fetchImageMetadataPatch,
} from '@/features/metadata/service';
import { buildFallbackItem, buildFallbackImageItem, normalizeUrl } from '@/features/items/fallback';
import {
  persistImage,
  readImageForAnalysis,
  deletePersistedImage,
} from '@/features/capture/imageCapture';
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
  saveUrl: (input: string, savedFrom?: string) => Promise<SaveUrlResult>;
  saveImage: (sourceUri: string, savedFrom?: string) => Promise<SaveUrlResult>;
  selectItem: (itemId: string) => void;
  updateUserNote: (itemId: string, userNote: string) => Promise<void>;
  retryEnrichMetadata: (itemId: string) => Promise<void>;
  setItemCategory: (itemId: string, category: string | null) => Promise<void>;
  setItemDeadline: (itemId: string, deadline: string | null) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
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

        void runSyncWorker(set, get);
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
  async saveUrl(input, savedFrom = 'manual') {
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

      if (!input || !input.trim()) {
        throw new Error('저장할 내용을 입력해 주세요.');
      }

      const fallbackItem = {
        ...buildFallbackItem(input, savedFrom),
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

      if (fallbackItem.type === 'url' && fallbackItem.sourceUrl) {
        const sourceUrl = fallbackItem.sourceUrl;
        void enrichSavedItemMetadata(fallbackItem.id, () => fetchMetadataPatch(sourceUrl), set, get);
      } else {
        // 링크 없이 저장된 텍스트(인스타 DM 원문 등)도 요약·정리본·키워드를 뽑습니다.
        void enrichSavedItemMetadata(
          fallbackItem.id,
          () => fetchTextMetadataPatch(fallbackItem.rawInput),
          set,
          get
        );
      }
      void runSyncWorker(set, get);

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
  /**
   * 스크린샷 등 이미지를 저장합니다.
   *
   * 공유로 넘어온 URI는 임시 경로라 앱 폴더로 옮겨두지 않으면 나중에 못 엽니다.
   * 그래서 저장 시점에 리사이즈해서 복사한 뒤, 그 경로를 원본으로 삼습니다.
   */
  async saveImage(sourceUri, savedFrom = 'manual') {
    if (!get().isReady) {
      await get().initialize();
    }

    set({ isSaving: true, errorMessage: null });

    try {
      if (!get().isReady) {
        throw new Error('로컬 저장소를 준비하지 못했습니다. 다시 시도해 주세요.');
      }

      const draft = buildFallbackImageItem('', savedFrom);
      const storedUri = await persistImage(sourceUri, draft.id);

      const fallbackItem = {
        ...draft,
        imageUri: storedUri,
        thumbnailUrl: storedUri,
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

      void enrichSavedItemMetadata(
        fallbackItem.id,
        async () => {
          const base64 = await readImageForAnalysis(storedUri);
          return fetchImageMetadataPatch(base64 ?? '');
        },
        set,
        get
      );
      void runSyncWorker(set, get);

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '이미지 저장에 실패했습니다.';
      set({ isSaving: false, errorMessage: message });
      return { ok: false, message };
    }
  },
  selectItem(itemId) {
    set({
      selectedItemId: itemId,
    });
  },
  async updateUserNote(itemId, userNote) {
    const databaseReady = get().isReady;
    if (!databaseReady) {
      return;
    }

    const updatedAt = new Date().toISOString();
    await updateItemMetadataAsync(itemId, { userNote, updatedAt });

    const nextItems = get().items.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          userNote,
          updatedAt,
        };
      }
      return item;
    });

    set({
      items: nextItems,
    });

    const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;
    if (itemToQueue) {
      await queueUpsertItemSyncAsync(itemToQueue);

      set((state) => ({
        items: state.items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                syncStatus: 'queued',
              }
            : item
        ),
      }));
    }

    void runSyncWorker(set, get);
  },
  /**
   * 사용자가 카테고리를 직접 바꿉니다.
   * null을 넘기면 지정을 해제하고 다시 AI 분류를 따릅니다.
   */
  async setItemCategory(itemId, category) {
    if (!get().isReady) {
      return;
    }

    const patch: ItemMetadataPatch = {
      userCategory: category,
      updatedAt: new Date().toISOString(),
    };

    await updateItemMetadataAsync(itemId, patch);

    const nextItems = get().items.map((item) =>
      item.id === itemId ? { ...item, userCategory: category, updatedAt: patch.updatedAt } : item
    );
    set({ items: nextItems });

    const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;
    if (itemToQueue) {
      await queueUpsertItemSyncAsync(itemToQueue);
    }
    void runSyncWorker(set, get);
  },
  /**
   * 마감일을 직접 고칩니다. null이면 지정을 해제하고 AI 값을 따릅니다.
   */
  async setItemDeadline(itemId, deadline) {
    if (!get().isReady) return;

    const patch: ItemMetadataPatch = {
      userDeadline: deadline,
      updatedAt: new Date().toISOString(),
    };
    await updateItemMetadataAsync(itemId, patch);

    const nextItems = get().items.map((item) =>
      item.id === itemId ? { ...item, userDeadline: deadline, updatedAt: patch.updatedAt } : item
    );
    set({ items: nextItems });

    const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;
    if (itemToQueue) await queueUpsertItemSyncAsync(itemToQueue);
    void runSyncWorker(set, get);
  },
  async retryEnrichMetadata(itemId) {
    if (!get().isReady) {
      return;
    }

    const item = get().items.find((i) => i.id === itemId);
    if (!item) {
      return;
    }

    set({
      isSaving: true,
      errorMessage: null,
    });

    try {
      const initialPatch: ItemMetadataPatch = {
        aiStatus: 'pending',
        updatedAt: new Date().toISOString(),
      };
      await updateItemMetadataAsync(itemId, initialPatch);
      set((state) => ({
        items: state.items.map((i) => applyMetadataPatch(i, itemId, initialPatch)),
      }));

      // 지능형 URL 복구 파이프라인:
      // 과거 데이터 수집 오류 등으로 인해 item.sourceUrl이 '없음' 상태이더라도,
      // 원문(rawInput)에서 정규식으로 다시 링크를 추출하여 복구 시도를 지원합니다.
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const extractedUrls = item.rawInput.match(urlRegex);
      const activeUrl = item.sourceUrl || (extractedUrls && extractedUrls[0]) || null;

      if (item.type === 'image' && item.imageUri) {
        const imageUri = item.imageUri;
        await enrichSavedItemMetadata(
          itemId,
          async () => {
            const base64 = await readImageForAnalysis(imageUri);
            return fetchImageMetadataPatch(base64 ?? '', item.createdAt);
          },
          set,
          get
        );
      } else if (item.type === 'url' || activeUrl) {
        // 복원된 URL을 DB 및 Zustand 스토어에 바인딩
        if (activeUrl && !item.sourceUrl) {
          const urlPatch: ItemMetadataPatch = {
            sourceUrl: activeUrl,
            updatedAt: new Date().toISOString(),
          };
          await updateItemMetadataAsync(itemId, urlPatch);
          set((state) => ({
            items: state.items.map((i) => applyMetadataPatch(i, itemId, urlPatch)),
          }));
        }

        const targetUrl = activeUrl || item.sourceUrl!;
        // 재분석해도 날짜 해석의 기준은 '지금'이 아니라 '저장한 때'입니다.
        // 2026년에 저장한 공구를 2027년에 재분석하면 마감일이 밀려버립니다.
        await enrichSavedItemMetadata(
          itemId,
          () => fetchMetadataPatch(targetUrl, item.createdAt),
          set,
          get
        );
      } else {
        // 링크가 없는 텍스트도 재분석 대상입니다.
        await enrichSavedItemMetadata(
          itemId,
          () => fetchTextMetadataPatch(item.rawInput, item.createdAt),
          set,
          get
        );
      }

      set({ isSaving: false });
    } catch (error) {
      console.error('[Retry] 에러 발생:', error);
      // 모바일 폰 화면에 에러 팝업을 직접 띄워 실시간 디버깅을 돕습니다.
      Alert.alert(
        'AI 분석 오류 발생',
        error instanceof Error ? error.message : '알 수 없는 에러가 발생했습니다.'
      );

      const patch: ItemMetadataPatch = {
        aiStatus: 'failed',
        updatedAt: new Date().toISOString(),
      };
      await updateItemMetadataAsync(itemId, patch).catch(() => {});
      set((state) => ({
        items: state.items.map((i) => applyMetadataPatch(i, itemId, patch)),
        isSaving: false,
        errorMessage: error instanceof Error ? error.message : '재분석 중 오류가 발생했습니다.',
      }));
    }
  },
  clearError() {
    set({
      errorMessage: null,
    });
  },
  async deleteItem(itemId) {
    if (!get().isReady) return;
    try {
      // 아이템만 지우면 앱 폴더에 이미지가 남아 용량만 차지합니다.
      const target = get().items.find((item) => item.id === itemId);
      if (target?.imageUri) {
        await deletePersistedImage(target.imageUri);
      }

      await deleteItemAsync(itemId);
      const nextItems = get().items.filter((item) => item.id !== itemId);
      set({
        items: nextItems,
        selectedItemId: get().selectedItemId === itemId
          ? (nextItems[0]?.id ?? null)
          : get().selectedItemId,
      });
    } catch (error) {
      console.error('[Store] 삭제 중 에러 발생:', error);
    }
  },
}));

/**
 * 아이템 하나를 AI로 보강합니다.
 * 링크든 텍스트든 이후 처리(저장·스토어 반영·동기화 큐잉·실패 처리)가 동일해서
 * patch를 만드는 방법만 주입받습니다.
 */
async function enrichSavedItemMetadata(
  itemId: string,
  fetchPatch: () => Promise<ItemMetadataPatch>,
  set: (
    partial:
      | Partial<AppStore>
      | AppStore
      | ((state: AppStore) => Partial<AppStore> | AppStore)
  ) => void,
  get: () => AppStore
) {
  console.log(`[SyncWorker] 메타데이터 보강을 시작합니다. item: ${itemId}`);
  try {
    const patch = await fetchPatch();
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
        contentText: itemToQueue.contentText,
        digest: itemToQueue.digest,
        aiError: itemToQueue.aiError,
        userCategory: itemToQueue.userCategory,
        imageUri: itemToQueue.imageUri,
        userDeadline: itemToQueue.userDeadline,
        thumbnailUrl: itemToQueue.thumbnailUrl,
        aiStatus: itemToQueue.aiStatus,
        syncStatus: 'queued',
        userNote: itemToQueue.userNote,
        extractedUrls: itemToQueue.extractedUrls,
        sourceType: itemToQueue.sourceType,
        savedFrom: itemToQueue.savedFrom,
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
  } catch (error) {
    console.error(`[SyncWorker] 메타데이터 보강 실패, 기본 저장 유지:`, error);
    const patch: ItemMetadataPatch = {
      aiStatus: 'failed',
      aiError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    await updateItemMetadataAsync(itemId, patch).catch(() => {});
    set((state) => ({
      items: state.items.map((item) => applyMetadataPatch(item, itemId, patch)),
    }));
  } finally {
    console.log('[SyncWorker] 메타데이터 보강 단계 완료. 동기화 워커를 구동합니다.');
    void runSyncWorker(set, get);
  }
}


function applyMetadataPatch(item: SavedItem, itemId: string, patch: ItemMetadataPatch) {
  if (item.id !== itemId) {
    return item;
  }

  return {
    ...item,
    ...(patch.sourceUrl !== undefined && patch.sourceUrl ? { sourceUrl: patch.sourceUrl } : null),
    ...(patch.title ? { title: patch.title } : null),
    ...(patch.summary ? { summary: patch.summary } : null),
    ...(patch.content ? { content: patch.content } : null),
    ...(patch.contentText ? { contentText: patch.contentText } : null),
    ...(patch.digest ? { digest: patch.digest } : null),
    // 실패 이유는 성공 시 null로 지워져야 하므로 undefined 여부로 판단합니다.
    ...(patch.aiError !== undefined ? { aiError: patch.aiError } : null),
    ...(patch.userCategory !== undefined ? { userCategory: patch.userCategory } : null),
    ...(patch.imageUri ? { imageUri: patch.imageUri } : null),
    ...(patch.userDeadline !== undefined ? { userDeadline: patch.userDeadline } : null),
    ...(patch.thumbnailUrl !== undefined ? { thumbnailUrl: patch.thumbnailUrl } : null),
    ...(patch.aiStatus ? { aiStatus: patch.aiStatus } : null),
    ...(patch.userNote !== undefined ? { userNote: patch.userNote } : null),
    ...(patch.extractedUrls !== undefined ? { extractedUrls: patch.extractedUrls } : null),
    ...(patch.sourceType ? { sourceType: patch.sourceType } : null),
    ...(patch.savedFrom ? { savedFrom: patch.savedFrom } : null),
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
      contentText: item.contentText,
      digest: item.digest,
      aiError: item.aiError,
      userCategory: item.userCategory,
      imageUri: item.imageUri,
      userDeadline: item.userDeadline,
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
  ) => void,
  get: () => AppStore
) {
  if (syncWorkerPromise) {
    console.log('[SyncWorker] 이미 동기화 워커가 구동 중입니다. 대기합니다.');
    return syncWorkerPromise;
  }

  syncWorkerPromise = (async () => {
    set({
      isSyncWorkerRunning: true,
    });
    console.log('[SyncWorker] 동기화 작업을 시작합니다...');

    try {
      const result = await runSyncQueueOnce();
      console.log(`[SyncWorker] 동기화 큐 1회 실행 완료. 결과: ${JSON.stringify(result)}`);
      
      // SQLite 로컬 DB로부터 동기화 결과가 실시간 반영된 최신 아이템 및 큐 개수를 로드합니다.
      const [items, summary] = await Promise.all([
        getSavedItemsAsync(),
        getSyncQueueSummaryAsync(),
      ]);
      console.log(`[SyncWorker] 로컬 DB 리로드 완료. 총 아이템 수: ${items.length}, 대기 큐: ${summary.pendingCount}건`);

      set((state) => ({
        items,
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
      console.error('[SyncWorker] 동기화 수행 중 예외 에러 발생:', error);
      const [items, summary] = await Promise.all([
        getSavedItemsAsync().catch(() => get().items),
        getSyncQueueSummaryAsync().catch(() => ({ pendingCount: 0, failedCount: 0 })),
      ]);

      set({
        items,
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

