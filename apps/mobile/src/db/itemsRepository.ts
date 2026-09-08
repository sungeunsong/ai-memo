import { SQLiteDatabase } from 'expo-sqlite';

import {
  ITEM_PATCH_COLUMNS,
  ITEM_PATCH_FIELDS,
  serializeItemPatchValue,
} from '@/features/items/patch';

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
  user_title: string | null;
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
      id, type, source_url, raw_input, title, summary, content, content_text, digest, ai_error, user_title, user_category, image_uri, user_deadline,
      thumbnail_url, ai_status, sync_status, user_note, extracted_urls, source_type,
      saved_from, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    item.userTitle,
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
      user_title,
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
  // 바꿀 항목만 골라 SET 절을 만듭니다.
  //
  // 예전에는 컬럼을 전부 나열하고 COALESCE로 걸렀는데, 그러면 null을 넘겨도
  // 값이 남습니다. 화면 쪽은 null을 '지우기'로 읽고 있어서 둘이 어긋났습니다.
  // 여기에 없는 항목은 아예 건드리지 않으므로 두 해석이 같아집니다.
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  for (const field of ITEM_PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    assignments.push(`${ITEM_PATCH_COLUMNS[field]} = ?`);
    values.push(serializeItemPatchValue(field, value));
  }

  assignments.push('updated_at = ?');
  values.push(patch.updatedAt);

  await db.runAsync(
    `UPDATE items SET ${assignments.join(', ')} WHERE id = ?`,
    ...values,
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

/**
 * 끊긴 AI 보강을 실패로 회수합니다.
 *
 * 보강은 앱 프로세스 안에서만 살아 있으므로, 지금 돌리고 있는 것이 무엇인지는
 * 앱이 정확히 압니다. 'pending인데 돌리고 있지 않다'면 시간과 무관하게 죽은 것입니다.
 * activeItemIds가 비어 있다면(앱을 막 켠 경우) 남아 있는 pending은 모두 죽은 것입니다.
 */
export async function markStalledEnrichAsFailedAsync(
  db: SQLiteDatabase,
  activeItemIds: string[],
  aiError: string,
  updatedAt: string
) {
  // NOT IN ()은 SQL 문법 오류라 목록이 비면 조건 자체를 뺍니다.
  const exclusion =
    activeItemIds.length > 0
      ? ` AND id NOT IN (${activeItemIds.map(() => '?').join(', ')})`
      : '';

  const result = await db.runAsync(
    `UPDATE items
    SET
      ai_status = 'failed',
      ai_error = ?,
      updated_at = ?
    WHERE ai_status = 'pending'${exclusion}`,
    aiError,
    updatedAt,
    ...activeItemIds
  );

  return result.changes;
}

/**
 * 가져오기로 덮어쓸 때 쓰는 아이템 단독 삭제.
 *
 * deleteItemAsync와 달리 sync_jobs는 건드리지 않습니다. 이 삭제는 곧바로
 * 이어지는 INSERT와 한 트랜잭션 안에서 짝을 이루는 '교체'의 일부라,
 * 전송 큐까지 함께 지울 이유가 없습니다.
 */
/** 마이그레이션 대상 훑기. content만 읽으면 되므로 통짜로 안 읽습니다. */
export async function listItemContentsAsync(db: SQLiteDatabase) {
  return db.getAllAsync<{ id: string; content: string }>(
    `SELECT id, content FROM items`
  );
}

/** 구조화 데이터만 바꿉니다. updated_at은 건드리지 않습니다. */
export async function updateItemContentAsync(
  db: SQLiteDatabase,
  itemId: string,
  content: string
) {
  await db.runAsync(`UPDATE items SET content = ? WHERE id = ?`, content, itemId);
}

export async function deleteItemRowAsync(db: SQLiteDatabase, itemId: string) {
  await db.runAsync(`DELETE FROM items WHERE id = ?`, itemId);
}

/** 아이템별 최종 수정 시각. 가져올 때 어느 쪽이 최신인지 가리는 데 씁니다. */
export async function listItemUpdatedAtAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: string; updated_at: string }>(
    `SELECT id, updated_at FROM items`
  );

  return new Map(rows.map((row) => [row.id, row.updated_at]));
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
    userTitle: row.user_title,
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
    // Source는 별도 테이블이라 여기서는 비워둡니다. 목록을 읽는 쪽에서 채웁니다.
    sources: [],
  };
}
