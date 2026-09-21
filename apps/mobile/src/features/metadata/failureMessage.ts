/**
 * 실패 사유를 사람이 읽을 말로 바꿉니다.
 *
 * 사유를 화면에 띄우기 시작한 날(2026-09-21) 바로 이런 것이 떴습니다.
 *
 *   AI 요약 실패
 *   프록시에 닿지 못했습니다: Failed to fetch (1ms 만에 실패)
 *
 * 앞 절반은 우리가 쓴 말이라 읽히는데, 뒤는 브라우저가 뱉은 영어입니다. 쓰는 사람에게
 * 'Failed to fetch'는 아무 정보가 아니고, '1ms'는 오히려 틀린 인상을 줍니다 — 요청이
 * 1밀리초 만에 끝난 게 아니라 나가지도 못한 것입니다.
 *
 * 그렇다고 사유를 통째로 뭉개면 안 됩니다. 이번 장애의 핵심이 "실패했다는 것만 알고
 * 왜인지는 어디에도 없었다"였습니다. 원본은 콘솔에 그대로 남기고, **화면에 나가는
 * 문자열만** 안정된 문구로 바꿉니다.
 */

/**
 * 연결 자체가 안 된 것을 알리는 말들. 플랫폼마다 다릅니다.
 *
 * 웹만 보고 'Failed to fetch'만 넣으면 안드로이드에서 그대로 샙니다. 사파리는 또
 * 'Load failed'라고만 합니다 — 아이폰 웹이 주 사용 환경이라 이건 꼭 필요합니다.
 */
const NETWORK_FAILURE_MARKERS = [
  'Failed to fetch', // 크롬·엣지
  'Load failed', // 사파리
  'NetworkError', // 파이어폭스
  'Network request failed', // 리액트 네이티브
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION',
];

/** 화면에 띄울 사유의 길이 상한. 넘치면 상세 화면이 사유 상자로 뒤덮입니다. */
const MAX_REASON_LENGTH = 160;

export function isNetworkFailureMessage(raw: string): boolean {
  return NETWORK_FAILURE_MARKERS.some((marker) => raw.includes(marker));
}

/**
 * `fetchWithTimeout`이 던질 문장을 만듭니다.
 *
 * 걸린 시간은 시한을 다시 잴 때 쓰려고 남겨둔 값입니다(`## AI 프록시`의 '12초 타임아웃
 * 재측정'). 다만 연결이 아예 안 된 경우의 1ms는 잴 것이 없었다는 뜻이라 화면에서는
 * 뺍니다. 콘솔에는 부르는 쪽에서 원본 그대로 찍습니다.
 */
export function describeFetchFailure(rawReason: string, elapsedMs: number): string {
  if (isNetworkFailureMessage(rawReason)) {
    return '연결하지 못했습니다. 인터넷이 끊겼거나 그 주소가 막혀 있습니다.';
  }

  return clampReason(`${rawReason} (${elapsedMs}ms 만에 실패)`);
}

/**
 * 저장물의 `aiError`에 넣을 최종 문구.
 *
 * 실패를 적는 자리가 둘(`fetchMetadataPatch`의 catch, store의 `enrichItem` catch)이라
 * 두 곳에서 같은 함수를 씁니다. 한쪽만 고치면 경로에 따라 말투가 달라집니다.
 */
export function toUserFacingEnrichError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();

  if (!trimmed) {
    // 사유가 비면 화면의 실패 사유 상자가 아예 안 뜹니다. 그게 이번에 고친 문제라,
    // 빈 값으로 되돌아가지 않도록 여기서 막습니다.
    return '알 수 없는 이유로 정리하지 못했습니다. 재분석을 눌러보세요.';
  }

  if (isNetworkFailureMessage(trimmed)) {
    return 'AI 정리 서버에 닿지 못했습니다. 잠시 뒤 재분석을 눌러보세요.';
  }

  return clampReason(trimmed);
}

function clampReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) {
    return reason;
  }

  return `${reason.slice(0, MAX_REASON_LENGTH).trimEnd()}…`;
}
