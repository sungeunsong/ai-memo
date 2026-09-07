import { SavedItem } from '@/features/items/types';

/**
 * 화면에서 '진행 중'으로 봐줄 시간.
 *
 * 끊긴 보강을 회수하는 판단은 시간으로 하지 않습니다. 앱이 지금 무엇을 돌리고
 * 있는지 알고 있으므로(store의 enrichingItemIds) 그쪽이 정확합니다.
 *
 * 다만 회수는 앱으로 돌아오는 시점에 돌기 때문에, 그 사이에 어떤 이유로든
 * 'pending'에 남은 항목이 화면에 있을 수 있습니다. 그때 재분석 버튼까지 막으면
 * 사용자가 손쓸 방법이 없어집니다. 그래서 버튼을 열어줄 기준으로만 씁니다.
 *
 * 한 건의 보강은 모든 네트워크 호출에 시한이 걸려 있어, 링크 수집 20초(폴백까지
 * 두 번)와 AI 호출 12초×3회를 다 쓰고 실패해도 1분 20초입니다.
 */
export const STALLED_ENRICH_THRESHOLD_MS = 5 * 60 * 1000;

export const STALLED_ENRICH_MESSAGE = 'AI 정리가 끝나기 전에 앱이 종료됐습니다.';

/** 진행 중인 보강과 끊긴 보강을 구분합니다. 둘 다 aiStatus는 'pending'입니다. */
export function isEnrichStalled(item: SavedItem, now = Date.now()) {
  if (item.aiStatus !== 'pending') {
    return false;
  }

  const updatedAt = Date.parse(item.updatedAt);
  // 시각을 읽을 수 없으면 진행 중이라고 볼 근거가 없습니다. 재분석은 열어둡니다.
  if (Number.isNaN(updatedAt)) {
    return true;
  }

  return now - updatedAt >= STALLED_ENRICH_THRESHOLD_MS;
}
