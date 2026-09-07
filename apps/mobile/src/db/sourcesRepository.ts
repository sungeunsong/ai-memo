import { SQLiteDatabase } from 'expo-sqlite';

import { ItemSource, ItemSourceKind } from '@/features/items/types';

type ItemSourceRow = {
  id: string;
  item_id: string;
  kind: string;
  source_url: string | null;
  raw_text: string | null;
  image_uri: string | null;
  created_at: string;
};

export async function insertItemSourceAsync(db: SQLiteDatabase, source: ItemSource) {
  await db.runAsync(
    `INSERT INTO item_sources (id, item_id, kind, source_url, raw_text, image_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    source.id,
    source.itemId,
    source.kind,
    source.sourceUrl,
    source.rawText,
    source.imageUri,
    source.createdAt
  );
}

/**
 * 아이템별 Source 목록.
 *
 * 목록 화면이 아이템마다 따로 물어보면 건수만큼 질의가 나갑니다.
 * 한 번에 읽어 아이템별로 묶어줍니다.
 */
export async function listItemSourcesAsync(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<ItemSourceRow>(
    `SELECT id, item_id, kind, source_url, raw_text, image_uri, created_at
     FROM item_sources
     ORDER BY created_at ASC`
  );

  const byItem = new Map<string, ItemSource[]>();
  for (const row of rows) {
    const source = mapItemSourceRow(row);
    const bucket = byItem.get(source.itemId);
    if (bucket) bucket.push(source);
    else byItem.set(source.itemId, [source]);
  }

  return byItem;
}

/** 링크 조각의 본문을 채웁니다. 보강할 때 긁어온 글을 캐시해 두는 자리입니다. */
export async function updateItemSourceTextAsync(
  db: SQLiteDatabase,
  sourceId: string,
  rawText: string | null
) {
  await db.runAsync(`UPDATE item_sources SET raw_text = ? WHERE id = ?`, rawText, sourceId);
}

export async function deleteItemSourceAsync(db: SQLiteDatabase, sourceId: string) {
  await db.runAsync(`DELETE FROM item_sources WHERE id = ?`, sourceId);
}

export async function deleteItemSourcesByItemAsync(db: SQLiteDatabase, itemId: string) {
  await db.runAsync(`DELETE FROM item_sources WHERE item_id = ?`, itemId);
}

/**
 * 같은 조각이 이미 붙어 있는지 봅니다.
 *
 * 같은 DM을 두 번 붙이면 AI가 같은 말을 두 번 읽고, 재정리 비용도 헛되이 나갑니다.
 * 링크는 주소로, 글은 내용으로 비교합니다.
 */
export async function hasSameItemSourceAsync(
  db: SQLiteDatabase,
  itemId: string,
  sourceUrl: string | null,
  rawText: string | null
) {
  if (sourceUrl) {
    const row = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM item_sources WHERE item_id = ? AND source_url = ? LIMIT 1`,
      itemId,
      sourceUrl
    );
    if (row) return true;
  }

  const trimmed = rawText?.trim();
  if (trimmed) {
    const row = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM item_sources WHERE item_id = ? AND TRIM(raw_text) = ? LIMIT 1`,
      itemId,
      trimmed
    );
    if (row) return true;
  }

  return false;
}

function mapItemSourceRow(row: ItemSourceRow): ItemSource {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: row.kind as ItemSourceKind,
    sourceUrl: row.source_url,
    rawText: row.raw_text,
    imageUri: row.image_uri,
    createdAt: row.created_at,
  };
}
