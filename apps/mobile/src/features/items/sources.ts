import { ItemSource, ItemSourceKind, SavedItem } from '@/features/items/types';

/**
 * 저장 시점의 출처 분류(item.sourceType)를 조각의 종류로 옮깁니다.
 *
 * classifySourceType은 화면 표시를 위해 잘게 나뉘어 있는데(instagram_post,
 * google_docs, parenting...), 조각 쪽은 "어디서 온 글인가"만 알면 됩니다.
 * 모르는 값은 링크가 있으면 url, 없으면 text로 봅니다.
 */
export function toSourceKind(sourceType: string, hasUrl: boolean): ItemSourceKind {
  if (sourceType.startsWith('instagram')) {
    return sourceType === 'instagram_dm' ? 'instagram_dm' : 'instagram_reel';
  }
  if (sourceType === 'youtube') return 'youtube';
  if (sourceType === 'notion') return 'notion';
  if (sourceType === 'image' || sourceType === 'screenshot') return 'screenshot';
  if (sourceType === 'manual_text') return 'text';
  return hasUrl ? 'url' : 'text';
}

export function buildItemSource(
  itemId: string,
  kind: ItemSourceKind,
  sourceUrl: string | null,
  rawText: string | null,
  imageUri: string | null = null,
  createdAt = new Date().toISOString()
): ItemSource {
  return {
    id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    itemId,
    kind,
    sourceUrl,
    rawText,
    imageUri,
    createdAt,
  };
}

/** 아이템이 만들어질 때 함께 다는 첫 조각. */
export function buildInitialSource(item: SavedItem): ItemSource {
  return buildItemSource(
    item.id,
    toSourceKind(item.sourceType, Boolean(item.sourceUrl)),
    item.sourceUrl,
    // 링크는 아직 본문을 안 긁었습니다. 보강이 끝나면 그때 채웁니다.
    item.sourceUrl ? null : item.rawInput,
    item.imageUri,
    item.createdAt
  );
}
