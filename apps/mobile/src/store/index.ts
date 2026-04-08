import { create } from 'zustand';

import { getSavedItemsAsync, initializeDatabase, saveUrlItemAsync } from '@/db';
import { buildFallbackUrlItem, normalizeUrl } from '@/features/items/fallback';
import { SavedItem } from '@/features/items/types';

type SaveUrlResult = {
  ok: boolean;
  message?: string;
};

type AppStore = {
  isReady: boolean;
  isInitializing: boolean;
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
  isSaving: false,
  items: [],
  selectedItemId: null,
  errorMessage: null,
  async initialize() {
    if (get().isReady || get().isInitializing) {
      return;
    }

    set({
      isInitializing: true,
      errorMessage: null,
    });

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
        isInitializing: false,
        errorMessage: error instanceof Error ? error.message : '초기화에 실패했습니다.',
      });
    }
  },
  async saveUrl(input) {
    set({
      isSaving: true,
      errorMessage: null,
    });

    try {
      const normalizedUrl = normalizeUrl(input);
      const fallbackItem = buildFallbackUrlItem(normalizedUrl);
      await saveUrlItemAsync(fallbackItem);

      set((state) => ({
        isSaving: false,
        items: [fallbackItem, ...state.items],
        selectedItemId: fallbackItem.id,
      }));

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
