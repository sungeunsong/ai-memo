import { SQLiteDatabase } from 'expo-sqlite';

import { ItemMetadataPatch, SaveUrlPayload, SavedItem } from '@/features/items/types';

type ItemRow = {
  id: string;
  type: 'url' | 'text';
  source_url: string | null;
  raw_input: string;
  title: string;
  summary: string;
  content: string;
  thumbnail_url: string | null;
  ai_status: 'pending' | 'completed' | 'failed';
  sync_status: 'local_only' | 'queued' | 'synced' | 'failed';
  user_note: string | null;
  extracted_urls: string | null;
  source_type: string;
  saved_from: string;
  created_at: string;
  updated_at: string;
};

export async function insertUrlItemAsync(db: SQLiteDatabase, item: SaveUrlPayload) {
  await db.runAsync(
    `INSERT INTO items (
      id, type, source_url, raw_input, title, summary, content, thumbnail_url,
      ai_status, sync_status, user_note, extracted_urls, source_type, saved_from,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.type,
    item.sourceUrl,
    item.rawInput,
    item.title,
    item.summary,
    item.content,
    item.thumbnailUrl,
    item.aiStatus,
    item.syncStatus,
    item.userNote,
    JSON.stringify(item.extractedUrls),
    item.sourceType,
    item.savedFrom,
    item.createdAt,
    item.updatedAt
  );
}

export async function listItemsAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT
      id,
      type,
      source_url,
      raw_input,
      title,
      summary,
      content,
      thumbnail_url,
      ai_status,
      sync_status,
      user_note,
      extracted_urls,
      source_type,
      saved_from,
      created_at,
      updated_at
    FROM items
    ORDER BY created_at DESC`
  );

  return rows.map(mapItemRow);
}

export async function updateItemMetadataAsync(
  db: SQLiteDatabase,
  itemId: string,
  patch: ItemMetadataPatch
) {
  await db.runAsync(
    `UPDATE items
    SET
      source_url = COALESCE(?, source_url),
      title = COALESCE(?, title),
      summary = COALESCE(?, summary),
      content = COALESCE(?, content),
      thumbnail_url = COALESCE(?, thumbnail_url),
      ai_status = COALESCE(?, ai_status),
      user_note = COALESCE(?, user_note),
      extracted_urls = COALESCE(?, extracted_urls),
      source_type = COALESCE(?, source_type),
      saved_from = COALESCE(?, saved_from),
      updated_at = ?
    WHERE id = ?`,
    patch.sourceUrl ?? null,
    patch.title ?? null,
    patch.summary ?? null,
    patch.content ?? null,
    patch.thumbnailUrl ?? null,
    patch.aiStatus ?? null,
    patch.userNote ?? null,
    patch.extractedUrls ? JSON.stringify(patch.extractedUrls) : null,
    patch.sourceType ?? null,
    patch.savedFrom ?? null,
    patch.updatedAt,
    itemId
  );
}

export async function updateItemSyncStatusAsync(
  db: SQLiteDatabase,
  itemId: string,
  syncStatus: SavedItem['syncStatus'],
  updatedAt: string
) {
  await db.runAsync(
    `UPDATE items
    SET
      sync_status = ?,
      updated_at = ?
    WHERE id = ?`,
    syncStatus,
    updatedAt,
    itemId
  );
}

function mapItemRow(row: ItemRow): SavedItem {
  let extractedUrls: string[] = [];
  if (row.extracted_urls) {
    try {
      extractedUrls = JSON.parse(row.extracted_urls);
    } catch {
      extractedUrls = [];
    }
  }

  return {
    id: row.id,
    type: row.type,
    sourceUrl: row.source_url,
    rawInput: row.raw_input,
    title: row.title,
    summary: row.summary,
    content: row.content,
    thumbnailUrl: row.thumbnail_url,
    aiStatus: row.ai_status,
    syncStatus: row.sync_status,
    userNote: row.user_note,
    extractedUrls: extractedUrls,
    sourceType: row.source_type,
    savedFrom: row.saved_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
