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
  content_text: string | null;
  digest: string | null;
  ai_error: string | null;
  user_category: string | null;
  image_uri: string | null;
  user_deadline: string | null;
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
      id, type, source_url, raw_input, title, summary, content, content_text, digest, ai_error, user_category, image_uri, user_deadline,
      thumbnail_url, ai_status, sync_status, user_note, extracted_urls, source_type,
      saved_from, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.type,
    item.sourceUrl,
    item.rawInput,
    item.title,
    item.summary,
    item.content,
    item.contentText,
    item.digest,
    item.aiError,
    item.userCategory,
    item.imageUri,
    item.userDeadline,
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
      content_text,
      digest,
      ai_error,
      user_category,
      image_uri,
      user_deadline,
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
      content_text = COALESCE(?, content_text),
      digest = COALESCE(?, digest),
      ai_error = ?,
      -- COALESCE를 쓰면 null로 지정 해제가 불가능합니다.
      -- patch에 키가 있을 때만 덮어쓰도록 플래그로 구분합니다.
      user_category = CASE WHEN ? = 1 THEN ? ELSE user_category END,
      image_uri = COALESCE(?, image_uri),
      user_deadline = CASE WHEN ? = 1 THEN ? ELSE user_deadline END,
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
    patch.contentText ?? null,
    patch.digest ?? null,
    patch.aiError ?? null,
    patch.userCategory !== undefined ? 1 : 0,
    patch.userCategory ?? null,
    patch.imageUri ?? null,
    patch.userDeadline !== undefined ? 1 : 0,
    patch.userDeadline ?? null,
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

export async function deleteItemAsync(
  db: SQLiteDatabase,
  itemId: string
) {
  await db.runAsync(`DELETE FROM sync_jobs WHERE item_id = ?`, itemId);
  await db.runAsync(`DELETE FROM items WHERE id = ?`, itemId);
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
    contentText: row.content_text,
    digest: row.digest,
    aiError: row.ai_error,
    userCategory: row.user_category,
    imageUri: row.image_uri,
    userDeadline: row.user_deadline,
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
