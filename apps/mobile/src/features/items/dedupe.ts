import { SavedItem } from '@/features/items/types';

/**
 * 같은 것을 두 번 담았는지 알아보기 위한 열쇠.
 *
 * 같은 릴스를 두 번 공유하면 지금은 별개 저장물 두 개가 되고, 각각 따로 AI 정리가
 * 돕니다. 돈이 두 번 나가고 목록에도 같은 것이 둘 남습니다.
 *
 * 문제는 주소가 매번 다르게 온다는 것입니다. 인스타 공유 링크에는 `?stkn=...`처럼
 * 공유할 때마다 새로 붙는 꼬리표가 있어서, 글자 그대로 비교하면 같은 릴스가 영영
 * 다른 것으로 보입니다.
 */

/**
 * 주소에서 지워도 되는 꼬리표.
 *
 * 공유 경로나 유입 경로를 적어두는 값들입니다. 같은 글을 가리키는데 값만 달라지므로
 * 비교에서는 방해만 됩니다. 반대로 `v`(유튜브 영상 id)처럼 무엇을 가리키는지 정하는
 * 값은 절대 건드리면 안 됩니다.
 */
const TRACKING_PARAMS = [
  'stkn',
  'igsh',
  'igshid',
  'si',
  'feature',
  'fbclid',
  'gclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

/** 이보다 짧은 글은 우연히 같을 수 있어 같은 것으로 보지 않습니다. */
const MIN_TEXT_KEY_LENGTH = 8;

function normalizeUrlForCompare(raw: string): string | null {
  try {
    const url = new URL(raw.trim());

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // 같은 곳을 가리키는데 주소만 다른 경우들을 하나로 모읍니다.
    url.hostname = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
    url.protocol = 'https:';
    url.hash = '';
    TRACKING_PARAMS.forEach((key) => url.searchParams.delete(key));

    // 끝의 빗금은 뜻이 없습니다. 인스타는 붙여 보내고 직접 복사하면 없는 식이라
    // 같은 글이 둘로 갈립니다.
    const pathname = url.pathname.replace(/\/+$/, '');

    // 남은 질의는 순서까지 맞춥니다. 붙는 순서가 매번 같다는 보장이 없습니다.
    const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([key, value]) => `${key}=${value}`).join('&');

    return `${url.hostname}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

function normalizeTextForCompare(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return collapsed.length >= MIN_TEXT_KEY_LENGTH ? `text:${collapsed}` : null;
}

/**
 * 이 저장물이 가리키는 것들.
 *
 * 하나가 아닙니다. 릴스에 DM 스크린샷을 붙였다면 그 저장물은 릴스로도, 조각의
 * 링크로도 찾아져야 합니다. 나중에 같은 릴스를 다시 공유했을 때 "이미 담아뒀다"고
 * 말할 수 있으려면 조각까지 봐야 합니다.
 */
export function buildItemDedupeKeys(item: SavedItem): string[] {
  const keys = new Set<string>();

  const urls = [item.sourceUrl, ...item.sources.map((source) => source.sourceUrl)];

  urls.forEach((url) => {
    if (!url) return;
    const key = normalizeUrlForCompare(url);
    if (key) keys.add(key);
  });

  // 링크가 하나도 없는 글 메모만 본문으로 비교합니다. 링크가 있는 저장물까지
  // 본문으로 비교하면, 같은 링크를 저장한 메모끼리 엉뚱하게 묶입니다.
  if (keys.size === 0) {
    const textKey = normalizeTextForCompare(item.rawInput);
    if (textKey) keys.add(textKey);
  }

  return [...keys];
}

/**
 * 방금 담은 것과 같아 보이는 기존 저장물.
 *
 * 막지 않고 알려주기만 합니다. 같은 링크를 일부러 다시 담는 경우가 있고, 무엇보다
 * 판단이 틀렸을 때 사용자가 손쓸 방법이 없어집니다.
 *
 * 최근 것부터 돌려줍니다. 목록이 최신순이라 그대로 두면 됩니다.
 */
export function findDuplicateItems(items: SavedItem[], target: SavedItem): SavedItem[] {
  const targetKeys = new Set(buildItemDedupeKeys(target));

  if (targetKeys.size === 0) {
    return [];
  }

  return items.filter(
    (item) =>
      item.id !== target.id &&
      buildItemDedupeKeys(item).some((key) => targetKeys.has(key))
  );
}
