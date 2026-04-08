import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

import { createTablesStatement } from '@/db/schema';
import { insertUrlItemAsync, listItemsAsync } from '@/db/itemsRepository';
import { SaveUrlPayload } from '@/features/items/types';

const DATABASE_NAME = 'ai-memo.db';

let databasePromise: Promise<SQLiteDatabase> | null = null;

export async function initializeDatabase() {
  const database = await getDatabaseAsync();
  await database.execAsync(createTablesStatement);
  return database;
}

export async function getSavedItemsAsync() {
  const database = await getDatabaseAsync();
  return listItemsAsync(database);
}

export async function saveUrlItemAsync(item: SaveUrlPayload) {
  const database = await getDatabaseAsync();
  await insertUrlItemAsync(database, item);
  return item;
}

async function getDatabaseAsync() {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}
