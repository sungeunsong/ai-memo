import { create } from 'zustand';

import {
  getSavedItemsAsync,
  initializeDatabase,
  saveUrlItemAsync,
  updateItemMetadataAsync,
} from '@/db';
import { fetchMetadataPatch } from '@/features/metadata/service';
import { buildFallbackUrlItem, normalizeUrl } from '@/features/items/fallback';
import { ItemMetadataPatch, SavedItem } from '@/features/items/types';

let initializationPromise: Promise<void> | null = null;

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
        const items = await getSavedItemsAsync();

        set({
          isReady: true,
          isInitializing: false,
          items,
          selectedItemId: items[0]?.id ?? null,
        });
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
      const fallbackItem = buildFallbackUrlItem(normalizedUrl, input);
      await saveUrlItemAsync(fallbackItem);

      set((state) => ({
        isSaving: false,
        items: [fallbackItem, ...state.items],
        selectedItemId: fallbackItem.id,
      }));

      void enrichSavedItemMetadata(fallbackItem.id, fallbackItem.sourceUrl, set);

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
  ) => void
) {
  const patch = await fetchMetadataPatch(sourceUrl);

  await updateItemMetadataAsync(itemId, patch);

  set((state) => ({
    items: state.items.map((item) => applyMetadataPatch(item, itemId, patch)),
  }));
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
