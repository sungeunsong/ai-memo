import { SavedItem } from '@/features/items/types';

/**
 * AI 보강이 멈춘 것으로 간주하기까지의 시간.
 *
 * 보강은 메모리에서만 돌기 때문에 앱이 꺼지면 그대로 사라지는데,
 * DB에 적어둔 'pending'은 남습니다. 그 상태로는 '요약 정리 중'이 영원히 돌고
 * 재분석 버튼까지 막혀서 사용자가 손쓸 방법이 없어집니다.
 *
 * 한 건의 보강은 이제 모든 네트워크 호출에 시한이 걸려 있습니다.
 * 링크 수집 20초(폴백까지 두 번) + AI 호출 30초×3회를 다 쓰고 실패해도 2분 반입니다.
 * 5분을 넘겼다면 진행 중이 아니라 끊긴 것입니다.
 */
export const STALLED_ENRICH_THRESHOLD_MS = 5 * 60 * 1000;

export const STALLED_ENRICH_MESSAGE =
  'AI 정리가 끝나기 전에 앱이 종료됐습니다. 재분석을 눌러 다시 시도해 주세요.';

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
