import { Platform } from 'react-native';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { createTablesStatement } from '@/db/schema';
import {
  insertUrlItemAsync,
  listItemsAsync,
  updateItemMetadataAsync as updateItemMetadataInRepositoryAsync,
} from '@/db/itemsRepository';
import { ItemMetadataPatch, SaveUrlPayload, SavedItem } from '@/features/items/types';

const DATABASE_NAME = 'ai-memo.db';
const WEB_STORAGE_KEY = 'ai-memo.items';

let databasePromise: Promise<SQLiteDatabase> | null = null;
let memoryItems: SavedItem[] = [];

export async function initializeDatabase() {
  if (Platform.OS === 'web') {
    ensureWebStorageAvailable();
    return null;
  }

  const database = await getDatabaseAsync();
  await database.execAsync(createTablesStatement);
  return database;
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

export async function updateItemMetadataAsync(itemId: string, patch: ItemMetadataPatch) {
  if (Platform.OS === 'web') {
    updateWebItem(itemId, patch);
    return;
  }

  const database = await getDatabaseAsync();
  await updateItemMetadataInRepositoryAsync(database, itemId, patch);
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

function updateWebItem(itemId: string, patch: ItemMetadataPatch) {
  const nextItems = getWebItems().map((item) =>
    item.id === itemId
      ? {
          ...item,
          ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : null),
          ...(patch.title ? { title: patch.title } : null),
          ...(patch.summary ? { summary: patch.summary } : null),
          ...(patch.content ? { content: patch.content } : null),
          ...(patch.thumbnailUrl !== undefined ? { thumbnailUrl: patch.thumbnailUrl } : null),
          ...(patch.aiStatus ? { aiStatus: patch.aiStatus } : null),
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
