import { create } from 'zustand';
import { Alert } from 'react-native';

import {
  addItemSourceAsync,
  getNextSyncRetryAtAsync,
  getSavedItemsAsync,
  getSyncQueueSummaryAsync,
  initializeDatabase,
  queueUpsertItemSyncAsync,
  hasSameItemSourceAsync,
  recoverStalledEnrichAsync,
  recoverStalledSyncJobsAsync,
  removeItemSourceAsync,
  updateItemSourceTextAsync,
  saveUrlItemWithSyncJobAsync,
  updateItemMetadataAsync,
  deleteItemAsync,
} from '@/db';
import {
  composeSourcesForAI,
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
  ItemSource,
  SavedItem,
  SyncWorkerResult,
} from '@/features/items/types';
import { STALLED_ENRICH_MESSAGE } from '@/features/items/staleEnrich';
import { applyItemPatch } from '@/features/items/patch';
import { classifySourceType } from '@/features/capture/normalizeSharedInput';
import { buildInitialSource, buildItemSource, toSourceKind } from '@/features/items/sources';
import { runSyncQueueOnce } from '@/sync/worker';

let initializationPromise: Promise<void> | null = null;
let syncWorkerPromise: Promise<void> | null = null;
let syncWakeupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 지금 보강을 돌리고 있는 아이템들.
 *
 * 보강은 이 프로세스 안에서만 살아 있습니다. 앱이 꺼지면 같이 죽고, 이 집합도
 * 함께 비워집니다. 그래서 'pending인데 여기 없다'는 건 시간과 무관하게 죽었다는
 * 뜻입니다. 예전에는 이걸 "5분 넘었으면 죽었겠지"라고 시간으로 짐작했는데,
 * 그 탓에 공유하고 1분 만에 돌아오면 끊긴 항목이 '요약 정리 중'인 채로
 * 아무것도 하지 않으면서 그 세션 내내 남아 있었습니다.
 */
const enrichingItemIds = new Set<string>();

/**
 * 남은 일감을 이어서 처리하기까지의 간격.
 * 워커는 한 번에 5건만 처리하므로 큐가 길면 여러 번 나눠 돕니다.
 */
const SYNC_CONTINUE_DELAY_MS = 1000;

/** 동기화가 미뤄졌을 때(주로 네트워크) 다시 시도하기까지의 간격. */
const SYNC_DEFERRED_DELAY_MS = 60 * 1000;

/**
 * 앱을 한 번 켤 때 이어서 돌릴 정리의 최대 건수.
 *
 * 대개는 한두 건입니다. 공유하고 인스타로 돌아가다 앱이 회수된 경우니까요.
 * 다만 밀린 것이 스무 건씩 쌓여 있을 때 그걸 다 돌리면 무료 할당량만 축내고,
 * 정작 사용자는 오래된 항목에 관심이 없을 수 있습니다. 남은 것은 다음 실행에
 * 이어서 하거나 사용자가 직접 재분석하면 됩니다.
 */
const MAX_AUTO_RESUME_PER_LAUNCH = 5;

/** zustand의 set. 함수 밖으로 뺀 헬퍼들에 그대로 넘겨줍니다. */
type SetAppState = (
  partial:
    | Partial<AppStore>
    | AppStore
    | ((state: AppStore) => Partial<AppStore> | AppStore)
) => void;

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
  saveUrl: (
    input: string,
    savedFrom?: string,
    options?: { deferEnrich?: boolean }
  ) => Promise<SaveUrlResult>;
  saveImage: (
    sourceUri: string,
    savedFrom?: string,
    options?: { deferEnrich?: boolean }
  ) => Promise<SaveUrlResult>;
  selectItem: (itemId: string) => void;
  updateUserNote: (itemId: string, userNote: string) => Promise<void>;
  retryEnrichMetadata: (itemId: string) => Promise<void>;
  setItemTitle: (itemId: string, title: string | null) => Promise<void>;
  /** 기존 저장물에 정보 조각을 붙이고 AI 정리를 다시 돌립니다. */
  attachSourceToItem: (itemId: string, input: string) => Promise<{ ok: boolean; message?: string }>;
  /**
   * 스크린샷을 조각으로 붙입니다.
   * 인스타 DM은 복사도 전달도 안 되어서, 화면을 찍는 것이 유일한 통로입니다.
   */
  attachScreenshotsToItem: (
    itemId: string,
    imageUris: string[]
  ) => Promise<{ ok: boolean; added: number; skipped: number; message?: string }>;
  /** 잘못 붙인 조각을 떼고 남은 것 기준으로 다시 정리합니다. */
  detachSourceFromItem: (sourceId: string) => Promise<void>;
  /** 추가 입력 대기를 끝냅니다. input이 있으면 붙이고, 없으면 있는 대로 정리합니다. */
  resolveAwaitingInput: (itemId: string, input?: string) => Promise<void>;
  setItemCategory: (itemId: string, category: string | null) => Promise<void>;
  setItemDeadline: (itemId: string, deadline: string | null) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  resumeSync: () => Promise<void>;
  resumeEnrich: () => Promise<void>;
  reloadItems: () => Promise<void>;
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

        // 동기화 job은 앱이 꺼지면 'processing'에 갇힙니다.
        // 이쪽은 되돌려두면 아래 워커가 곧바로 다시 집어갑니다.
        const recoveredJobCount = await recoverStalledSyncJobsAsync();
        if (recoveredJobCount > 0) {
          console.log(`[Init] 중단된 동기화 ${recoveredJobCount}건을 대기로 되돌렸습니다.`);
        }

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

        // 끊겼던 정리는 사용자가 찾아 눌러주지 않아도 이어서 돌립니다.
        void recoverAndResumeStalledEnrich(set, get);
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
  async saveUrl(input, savedFrom = 'manual', options) {
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

      const base = buildFallbackItem(input, savedFrom);
      const firstSource = buildInitialSource(base);
      const fallbackItem: SavedItem = {
        ...base,
        syncStatus: 'queued' as const,
        // 덧붙일 내용을 기다리는 동안에는 AI를 돌리지 않습니다.
        // 'pending'으로 두면 회수 로직이 '앱이 죽어 끊긴 것'으로 보고 낚아챕니다.
        aiStatus: options?.deferEnrich ? 'awaiting_input' : base.aiStatus,
        sources: [firstSource],
      };

      const syncJob = buildItemSyncJob(fallbackItem);
      await saveUrlItemWithSyncJobAsync(fallbackItem, syncJob);
      await addItemSourceAsync(firstSource);

      set((state) => ({
        isSaving: false,
        items: [fallbackItem, ...state.items],
        selectedItemId: fallbackItem.id,
        syncQueuePendingCount: state.syncQueuePendingCount + 1,
        syncWorkerMessage: null,
      }));

      if (!options?.deferEnrich) {
        void runEnrichForItem(fallbackItem, set, get);
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
  async saveImage(sourceUri, savedFrom = 'manual', options) {
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

      const fallbackItem: SavedItem = {
        ...draft,
        imageUri: storedUri,
        thumbnailUrl: storedUri,
        syncStatus: 'queued' as const,
        // 스크린샷도 어디에 담을지 고르는 동안에는 AI를 돌리지 않습니다.
        aiStatus: options?.deferEnrich ? 'awaiting_input' : draft.aiStatus,
        sources: [],
      };
      const firstSource = buildInitialSource(fallbackItem);
      fallbackItem.sources = [firstSource];

      const syncJob = buildItemSyncJob(fallbackItem);
      await saveUrlItemWithSyncJobAsync(fallbackItem, syncJob);
      await addItemSourceAsync(firstSource);

      set((state) => ({
        isSaving: false,
        items: [fallbackItem, ...state.items],
        selectedItemId: fallbackItem.id,
        syncQueuePendingCount: state.syncQueuePendingCount + 1,
        syncWorkerMessage: null,
      }));

      if (!options?.deferEnrich) {
        void enrichSavedItemMetadata(
          fallbackItem.id,
          async () => {
            const base64 = await readImageForAnalysis(storedUri);
            return fetchImageMetadataPatch(base64 ?? '');
          },
          set,
          get
        );
      }
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
   * 사용자가 제목을 직접 고칩니다.
   * null을 넘기면 고친 것을 지우고 다시 AI 제목을 따릅니다.
   */
  async setItemTitle(itemId, title) {
    if (!get().isReady) {
      return;
    }

    const trimmed = title?.trim() ?? '';
    const patch: ItemMetadataPatch = {
      // 빈 문자열로 저장하면 제목이 사라진 것처럼 보입니다. 해제로 취급합니다.
      userTitle: trimmed ? trimmed : null,
      updatedAt: new Date().toISOString(),
    };

    await updateItemMetadataAsync(itemId, patch);

    const nextItems = get().items.map((item) =>
      item.id === itemId ? applyMetadataPatch(item, itemId, patch) : item
    );
    set({ items: nextItems });

    const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;
    if (itemToQueue) await queueUpsertItemSyncAsync(itemToQueue);
    void runSyncWorker(set, get);
  },
  /**
   * 기존 저장물에 정보 조각을 붙입니다.
   *
   * 릴스에는 정보가 일부만 있고 나머지는 나중에 DM으로 옵니다. 따로 저장하면
   * 하나의 정보가 둘로 쪼개져 검색이 무너지므로, 원래 저장물에 이어 붙입니다.
   */
  async attachSourceToItem(itemId, input) {
    if (!get().isReady) {
      return { ok: false, message: '로컬 저장소가 아직 준비되지 않았습니다.' };
    }

    const item = get().items.find((entry) => entry.id === itemId);
    if (!item) {
      return { ok: false, message: '붙일 저장물을 찾지 못했습니다.' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return { ok: false, message: '붙일 내용이 비어 있습니다.' };
    }

    try {
      const extractedUrl = trimmed.match(/https?:\/\/[^\s]+/)?.[0] ?? null;

      // 같은 DM을 두 번 붙이면 AI가 같은 말을 두 번 읽고 정리 비용도 헛되이 나갑니다.
      const duplicate = await hasSameItemSourceAsync(itemId, extractedUrl, trimmed);
      if (duplicate) {
        return { ok: false, message: '이미 붙어 있는 내용입니다.' };
      }

      const source = buildItemSource(
        itemId,
        toSourceKind(classifySourceType(extractedUrl, trimmed), Boolean(extractedUrl)),
        extractedUrl,
        trimmed
      );

      await addItemSourceAsync(source);
      set((state) => ({
        items: state.items.map((entry) =>
          entry.id === itemId ? { ...entry, sources: [...entry.sources, source] } : entry
        ),
      }));

      await reenrichFromSources(itemId, set, get);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '내용을 붙이지 못했습니다.';
      return { ok: false, message };
    }
  },
  /**
   * 스크린샷 여러 장을 한 번에 붙입니다.
   *
   * 긴 DM은 한 화면에 안 들어와서 두세 장으로 나눠 찍게 됩니다. 한 장씩 붙이면
   * 장마다 재정리가 돌아 AI 호출이 배로 나가고, 그동안 다음 장을 고를 수도 없습니다.
   * 글자 읽기는 장마다 필요하지만 종합은 마지막에 한 번이면 됩니다.
   */
  async attachScreenshotsToItem(itemId, imageUris) {
    if (!get().isReady) {
      return { ok: false, added: 0, skipped: 0, message: '로컬 저장소가 아직 준비되지 않았습니다.' };
    }

    const item = get().items.find((entry) => entry.id === itemId);
    if (!item) {
      return { ok: false, added: 0, skipped: 0, message: '붙일 저장물을 찾지 못했습니다.' };
    }

    let added = 0;
    let skipped = 0;

    try {
      for (const [index, imageUri] of imageUris.entries()) {
        // 공유로 받은 경로는 임시라 앱 폴더로 옮겨두지 않으면 나중에 못 엽니다.
        const storedUri = await persistImage(imageUri, `${itemId}_${Date.now()}_${index}`);

        // 글자를 먼저 읽습니다. 조각에 글이 남아야 검색에 잡힙니다.
        // DM에만 있는 전화번호나 제품명으로 찾을 수 있어야 하기 때문입니다.
        const base64 = await readImageForAnalysis(storedUri);
        const ocr = base64 ? await fetchImageMetadataPatch(base64, item.createdAt) : null;
        const extracted = ocr?.contentText?.trim() ?? '';

        // 같은 화면을 두 번 고르면 읽어낸 글도 같습니다. 이미 옮겨둔 파일은 지웁니다.
        if (extracted && (await hasSameItemSourceAsync(itemId, null, extracted))) {
          await deletePersistedImage(storedUri).catch(() => {});
          skipped += 1;
          continue;
        }

        const source = buildItemSource(itemId, 'screenshot', null, extracted || null, storedUri);
        await addItemSourceAsync(source);
        set((state) => ({
          items: state.items.map((entry) =>
            entry.id === itemId ? { ...entry, sources: [...entry.sources, source] } : entry
          ),
        }));
        added += 1;
      }

      // 종합은 마지막에 한 번만. 장마다 돌리면 호출이 장 수만큼 늘어납니다.
      if (added > 0) {
        await reenrichFromSources(itemId, set, get);
      }

      return { ok: added > 0, added, skipped };
    } catch (error) {
      // 도중에 실패해도 그때까지 붙인 것은 살립니다. 다시 고르게 만들 이유가 없습니다.
      if (added > 0) {
        await reenrichFromSources(itemId, set, get).catch(() => {});
      }
      const message = error instanceof Error ? error.message : '스크린샷을 붙이지 못했습니다.';
      return { ok: false, added, skipped, message };
    }
  },
  async detachSourceFromItem(sourceId) {
    if (!get().isReady) {
      return;
    }

    const owner = get().items.find((item) =>
      item.sources.some((source) => source.id === sourceId)
    );
    if (!owner) {
      return;
    }

    // 스크린샷 조각이면 파일도 지웁니다. 안 지우면 앱 폴더에 남아 용량만 먹습니다.
    const removed = owner.sources.find((source) => source.id === sourceId);
    if (removed?.imageUri) {
      await deletePersistedImage(removed.imageUri).catch(() => {});
    }

    await removeItemSourceAsync(sourceId);
    set((state) => ({
      items: state.items.map((item) =>
        item.id === owner.id
          ? { ...item, sources: item.sources.filter((source) => source.id !== sourceId) }
          : item
      ),
    }));

    // 떼어낸 내용이 요약에 남아 있으면 안 됩니다. 남은 것 기준으로 다시 만듭니다.
    await reenrichFromSources(owner.id, set, get);
  },
  /**
   * 추가 입력 대기를 끝냅니다.
   *
   * 붙일 내용이 있으면 붙인 뒤 한 번만 정리합니다. 붙이고 나서 따로 정리를
   * 돌리면 AI 호출이 두 번 나갑니다.
   */
  async resolveAwaitingInput(itemId, input) {
    if (!get().isReady) {
      return;
    }

    const trimmed = input?.trim();
    if (trimmed) {
      await get().attachSourceToItem(itemId, trimmed);
      return;
    }

    const item = get().items.find((entry) => entry.id === itemId);
    if (item) {
      await runEnrichForItem(item, set, get);
    }
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
      await runEnrichForItem(item, set, get);
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
  /**
   * 밀린 동기화를 이어서 돌립니다.
   *
   * 앱이 백그라운드에 있는 동안에는 재시도 타이머가 미뤄지거나 죽습니다.
   * 돌아왔을 때 한 번 깨워주지 않으면, 백오프가 잡아둔 시각이 지났는데도
   * 다음 저장 때까지 아무 일도 일어나지 않습니다.
   */
  async resumeSync() {
    if (!get().isReady) {
      return;
    }

    await runSyncWorker(set, get);
  },
  /**
   * 끊겼던 정리를 회수하고 이어서 돌립니다.
   *
   * 앱으로 돌아올 때마다 부릅니다. 공유하고 원래 앱으로 넘어가는 사이에 보강이
   * 끊기는 일이 잦은데, 실행할 때 한 번만 확인하면 그 세션 내내 '요약 정리 중'인
   * 채로 아무것도 하지 않는 항목이 남습니다. 사용자는 되고 있다고 믿습니다.
   */
  /**
   * DB를 다시 읽어 화면을 맞춥니다.
   * 백업 가져오기처럼 스토어를 거치지 않고 DB가 바뀐 뒤에 부릅니다.
   */
  async reloadItems() {
    if (!get().isReady) {
      return;
    }

    const [items, summary] = await Promise.all([
      getSavedItemsAsync(),
      getSyncQueueSummaryAsync(),
    ]);

    set({
      items,
      syncQueuePendingCount: summary.pendingCount,
      syncQueueFailedCount: summary.failedCount,
    });
  },
  async resumeEnrich() {
    if (!get().isReady) {
      return;
    }

    await recoverAndResumeStalledEnrich(set, get);
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
 * 끊긴 정리를 가려내고, 이어서 돌립니다.
 *
 * 가려내는 기준은 시간이 아니라 '지금 돌리고 있는가'입니다. 보강은 이 프로세스
 * 안에서만 살아 있으므로 그 판단은 정확합니다. 앱을 막 켠 참이면 돌리고 있는 것이
 * 하나도 없으니, 남아 있는 pending은 전부 죽은 것입니다.
 */
async function recoverAndResumeStalledEnrich(set: SetAppState, get: () => AppStore) {
  const recoveredCount = await recoverStalledEnrichAsync([...enrichingItemIds]);

  if (recoveredCount > 0) {
    console.log(`[Enrich] 중단된 AI 정리 ${recoveredCount}건을 회수했습니다.`);
    const items = await getSavedItemsAsync().catch(() => get().items);
    set({ items });
  }

  await resumeStalledEnrich(set, get);
}

/**
 * 앱이 꺼지며 끊겼던 정리를 이어서 돌립니다.
 *
 * 끊긴 원인은 "앱을 껐다"인데 그 뒷수습까지 사용자가 하는 건 이상합니다.
 * 공유하고 원래 앱으로 돌아가는 것이 이 앱의 정상적인 사용 흐름이라, 보강이
 * 끊기는 일은 사고가 아니라 자주 일어나는 일입니다.
 *
 * 대상은 '끊겨서' 실패한 것뿐입니다. 회수할 때 남긴 문구로 가려냅니다.
 * 할당량 초과나 응답 없음으로 실패한 건은 다시 걸어도 같은 이유로 실패할
 * 가능성이 높아, 켤 때마다 헛된 호출을 반복하게 됩니다.
 *
 * 한 건씩 차례로 돕니다. 한꺼번에 쏘면 무료 할당량의 분당 한도에 걸려
 * 살릴 수 있었던 것까지 연달아 실패합니다.
 *
 * 여기서 실패하면 aiError가 그 실패 사유로 바뀌므로, 다음 실행에서는 대상이
 * 아닙니다. 같은 항목을 켤 때마다 다시 시도하는 일은 생기지 않습니다.
 */
async function resumeStalledEnrich(set: SetAppState, get: () => AppStore) {
  // items는 최신순이라 방금 저장한 것부터 살립니다. 오래된 것일수록 덜 급합니다.
  const targets = get()
    .items.filter(
      (item) =>
        item.aiStatus === 'failed' &&
        item.aiError === STALLED_ENRICH_MESSAGE &&
        // 복귀 때마다 부르므로, 앞서 시작한 것이 아직 돌고 있으면 또 걸지 않습니다.
        !enrichingItemIds.has(item.id)
    )
    .slice(0, MAX_AUTO_RESUME_PER_LAUNCH);

  if (targets.length === 0) {
    return;
  }

  console.log(`[Init] 끊겼던 AI 정리 ${targets.length}건을 이어서 돌립니다.`);

  for (const item of targets) {
    try {
      await runEnrichForItem(item, set, get);
    } catch (error) {
      // 한 건이 실패해도 나머지는 계속합니다.
      // 실패 사유는 enrichSavedItemMetadata가 이미 아이템에 적어둡니다.
      console.error(`[Init] 이어서 돌린 정리가 실패했습니다. item: ${item.id}`, error);
    }
  }
}

/**
 * 링크에서 긁어온 본문을 첫 조각에 넣어둡니다.
 *
 * 링크 조각은 저장 시점에 주소만 있고 본문이 없습니다. 나중에 조각이 늘어
 * 다시 정리할 때, 이 본문이 없으면 링크를 또 긁어와야 합니다.
 * 한 번 긁은 글을 조각에 담아두면 재정리가 네트워크 없이 됩니다.
 */
async function cacheFetchedBodyIntoSource(
  itemId: string,
  patch: ItemMetadataPatch,
  get: () => AppStore
) {
  const body = patch.contentText?.trim();
  if (!body) return;

  const item = get().items.find((entry) => entry.id === itemId);
  const target = item?.sources.find((source) => source.sourceUrl && !source.rawText?.trim());
  if (!target) return;

  await updateItemSourceTextAsync(target.id, body).catch((error) => {
    // 캐시가 실패해도 보강 자체는 성공한 것입니다. 다음 재정리 때 다시 긁으면 됩니다.
    console.log('[Enrich] 조각 본문 캐시 실패:', error);
  });
}

/**
 * 붙어 있는 조각 전체를 종합해 AI 정리를 다시 만듭니다.
 *
 * 기존 요약에 새 내용을 이어 붙이는 대신 원본 조각들로 다시 만듭니다.
 * 이어 붙이면 "가격: 알 수 없음" 같은 옛 문장이 남은 채 새 문장이 덧대어져,
 * 읽는 사람이 어느 쪽이 맞는지 알 수 없게 됩니다.
 *
 * 사용자가 고친 값(userTitle 등)은 AI가 건드리지 않는 별도 컬럼이라 그대로 남습니다.
 */
async function reenrichFromSources(itemId: string, set: SetAppState, get: () => AppStore) {
  const item = get().items.find((entry) => entry.id === itemId);
  if (!item) return;

  // 조각이 하나뿐이면 예전과 똑같이 처리합니다. 굳이 다른 길로 갈 이유가 없습니다.
  if (item.sources.length <= 1) {
    await runEnrichForItem(item, set, get);
    return;
  }

  const composed = composeSourcesForAI(item.sources);
  if (!composed) {
    await runEnrichForItem(item, set, get);
    return;
  }

  await enrichSavedItemMetadata(
    itemId,
    // 날짜 해석의 기준은 지금이 아니라 저장한 때입니다.
    () => fetchTextMetadataPatch(composed, item.createdAt),
    set,
    get
  );
}

/**
 * 아이템 하나를 다시 보강합니다.
 *
 * 종류마다 AI에 넘길 재료가 달라서 여기서 갈래를 정합니다.
 * 사용자가 재분석을 누른 경우와 앱이 스스로 이어서 돌리는 경우가 이 함수를 공유합니다.
 * 화면에 어떻게 알릴지는(저장 중 표시, 실패 팝업) 부르는 쪽 사정이라 여기 두지 않습니다.
 */
async function runEnrichForItem(item: SavedItem, set: SetAppState, get: () => AppStore) {
  const itemId = item.id;

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
    return;
  }

  if (item.type === 'url' || activeUrl) {
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
    return;
  }

  // 링크가 없는 텍스트도 재분석 대상입니다.
  await enrichSavedItemMetadata(
    itemId,
    () => fetchTextMetadataPatch(item.rawInput, item.createdAt),
    set,
    get
  );
}

/**
 * 아이템 하나를 AI로 보강합니다.
 * 링크든 텍스트든 이후 처리(저장·스토어 반영·동기화 큐잉·실패 처리)가 동일해서
 * patch를 만드는 방법만 주입받습니다.
 */
async function enrichSavedItemMetadata(
  itemId: string,
  fetchPatch: () => Promise<ItemMetadataPatch>,
  set: SetAppState,
  get: () => AppStore
) {
  console.log(`[Enrich] 메타데이터 보강을 시작합니다. item: ${itemId}`);
  enrichingItemIds.add(itemId);

  // AI 단계와 저장·큐잉 단계를 나눠서 감쌉니다.
  // 예전에는 한 try가 셋을 다 덮고 있어서, 동기화 큐 쓰기가 실패하면
  // 멀쩡히 성공한 요약에 'AI 정리 실패' 도장이 찍혔습니다.
  // 화면에는 요약이 그대로 보이는데 뱃지만 빨간, 설명할 수 없는 상태가 됐습니다.
  let patch: ItemMetadataPatch;
  try {
    patch = await fetchPatch();
  } catch (error) {
    // 'failed'를 남기는 건 여기뿐입니다. AI 보강 자체가 실패한 경우입니다.
    console.error('[Enrich] 메타데이터 보강 실패, 기본 저장 유지:', error);
    const failurePatch: ItemMetadataPatch = {
      aiStatus: 'failed',
      aiError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    await updateItemMetadataAsync(itemId, failurePatch).catch(() => {});
    set((state) => ({
      items: state.items.map((item) => applyMetadataPatch(item, itemId, failurePatch)),
    }));
    // 아래 try의 finally를 거치지 않고 빠져나가는 길이라 여기서도 지웁니다.
    // 남겨두면 그 아이템은 영원히 '돌리는 중'으로 취급돼 회수 대상에서 빠집니다.
    enrichingItemIds.delete(itemId);
    void runSyncWorker(set, get);
    return;
  }

  try {
    await updateItemMetadataAsync(itemId, patch);
    await cacheFetchedBodyIntoSource(itemId, patch, get);

    const nextItems = get().items.map((item) => applyMetadataPatch(item, itemId, patch));
    const itemToQueue = nextItems.find((item) => item.id === itemId) ?? null;

    set({
      items: nextItems,
    });

    if (itemToQueue) {
      await queueUpsertItemSyncAsync({ ...itemToQueue, syncStatus: 'queued' });

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
    // 저장이나 큐잉이 실패한 경우입니다. AI는 성공했으므로 aiStatus는 건드리지 않습니다.
    //
    // 저장 전에 실패했다면 아이템은 'pending'으로 남고, 다음 실행 때
    // recoverStalledEnrichAsync가 사유를 적어 'failed'로 회수합니다.
    // 저장은 됐는데 큐잉만 실패했다면 화면과 DB는 이미 맞고, 저장 시점에 만들어둔
    // 큐 항목이 남아 있어 동기화는 (조금 오래된 payload로) 계속 진행됩니다.
    console.error('[Enrich] 보강 결과 저장/큐잉 실패. AI 결과는 유지합니다:', error);
  } finally {
    enrichingItemIds.delete(itemId);
    console.log('[Enrich] 메타데이터 보강 단계 완료. 동기화 워커를 구동합니다.');
    void runSyncWorker(set, get);
  }
}


function applyMetadataPatch(item: SavedItem, itemId: string, patch: ItemMetadataPatch) {
  if (item.id !== itemId) {
    return item;
  }

  return applyItemPatch(item, patch);
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
      userTitle: item.userTitle,
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



/**
 * 다음 워커 실행을 예약합니다.
 *
 * computeNextRetryAt이 30초에서 2시간까지 재시도 시각을 잡아두는데, 정작 그때
 * 워커를 깨우는 것이 없었습니다. 실행 계기가 전부 사용자 동작(저장·메모 수정·앱 시작)
 * 뿐이라, 실패한 항목은 다음 저장을 할 때까지 그대로 멈춰 있었습니다.
 */
async function scheduleNextSyncRun(
  result: SyncWorkerResult,
  pendingCount: number,
  set: SetAppState,
  get: () => AppStore
) {
  if (result.kind === 'deferred') {
    scheduleSyncWakeup(SYNC_DEFERRED_DELAY_MS, set, get);
    return;
  }

  // 한 번에 5건까지만 처리하므로 큐가 길면 남은 것이 있습니다.
  // 처리 중 갱신돼 결과를 적지 않은 job도 여기로 잡힙니다.
  //
  // 'idle'일 때는 이어가지 않습니다. 실행 대상이 없는데도 대기 건수가 남아 있다는 건
  // 앱이 꺼지며 'processing'에 갇힌 job이 섞여 있다는 뜻입니다(큐 요약은 그것도 대기로 셉니다).
  // 그걸 보고 1초마다 깨우면 아무 일도 못 하면서 영원히 돕니다. 그 job은 다음 실행 때 회수됩니다.
  if (result.kind === 'completed' && pendingCount > 0) {
    scheduleSyncWakeup(SYNC_CONTINUE_DELAY_MS, set, get);
    return;
  }

  const nextRetryAt = await getNextSyncRetryAtAsync().catch(() => null);
  if (!nextRetryAt) {
    return;
  }

  const target = Date.parse(nextRetryAt);
  if (Number.isNaN(target)) {
    return;
  }

  scheduleSyncWakeup(Math.max(SYNC_CONTINUE_DELAY_MS, target - Date.now()), set, get);
}

function scheduleSyncWakeup(
  delayMs: number,
  set: SetAppState,
  get: () => AppStore
) {
  if (syncWakeupTimer) {
    clearTimeout(syncWakeupTimer);
  }

  syncWakeupTimer = setTimeout(() => {
    syncWakeupTimer = null;
    void runSyncWorker(set, get);
  }, delayMs);
}

async function runSyncWorker(
  set: SetAppState,
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

      await scheduleNextSyncRun(result, summary.pendingCount, set, get);
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

