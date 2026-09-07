import { ItemMetadataPatch, SavedItem } from '@/features/items/types';

/**
 * patch의 항목과 items 테이블 컬럼의 대응.
 *
 * 이 목록이 유일한 기준입니다. 예전에는 같은 규칙이 세 군데에 복사돼 있었습니다.
 * 화면(store), 웹 저장소, SQL이 각자 판단하다 보니 서로 어긋났습니다.
 * 특히 SQL만 COALESCE를 써서, null로 지우면 화면에서는 사라지는데 DB에는 남았고
 * 목록을 다시 읽는 순간 되살아났습니다.
 */
export const ITEM_PATCH_COLUMNS = {
  sourceUrl: 'source_url',
  title: 'title',
  summary: 'summary',
  content: 'content',
  contentText: 'content_text',
  digest: 'digest',
  aiError: 'ai_error',
  userTitle: 'user_title',
  userCategory: 'user_category',
  imageUri: 'image_uri',
  userDeadline: 'user_deadline',
  thumbnailUrl: 'thumbnail_url',
  aiStatus: 'ai_status',
  userNote: 'user_note',
  extractedUrls: 'extracted_urls',
  sourceType: 'source_type',
  savedFrom: 'saved_from',
} as const satisfies Partial<Record<keyof ItemMetadataPatch, string>>;

export type ItemPatchField = keyof typeof ITEM_PATCH_COLUMNS;

export const ITEM_PATCH_FIELDS = Object.keys(ITEM_PATCH_COLUMNS) as ItemPatchField[];

/**
 * 규칙은 하나입니다. **patch에 값이 있으면 그 값으로 바꾸고, 없으면 그대로 둡니다.**
 *
 * '없음'의 기준은 undefined입니다. null은 '지우라'는 뜻이라 그대로 반영합니다.
 * 이 구분이 있어야 썸네일이나 메모를 비울 수 있습니다.
 */
export function applyItemPatch(item: SavedItem, patch: ItemMetadataPatch): SavedItem {
  const next: SavedItem = { ...item, updatedAt: patch.updatedAt };

  for (const field of ITEM_PATCH_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    (next as any)[field] = value;
  }

  return next;
}

/** SQL 파라미터로 넘길 형태. 배열은 컬럼에 그대로 못 넣습니다. */
export function serializeItemPatchValue(field: ItemPatchField, value: unknown) {
  if (field === 'extractedUrls') {
    return Array.isArray(value) ? JSON.stringify(value) : null;
  }
  return value as string | null;
}
