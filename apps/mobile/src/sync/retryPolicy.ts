const RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;

/**
 * 동기화 job이 멈춘 것으로 간주하기까지의 시간.
 *
 * 워커는 job을 'processing'으로 바꾼 뒤 원격 호출을 기다립니다. 그 사이 앱이 꺼지면
 * 'processing'인 채로 남는데, 실행 대상 조회는 'pending'과 'failed'만 보기 때문에
 * 그 job은 영원히 다시 잡히지 않습니다. 대기 큐 숫자도 함께 굳습니다.
 *
 * 원격 호출에는 20초 시한이 걸려 있으므로 5분을 넘겼다면 진행 중이 아니라 끊긴 것입니다.
 */
export const STALLED_SYNC_JOB_THRESHOLD_MS = 5 * 60 * 1000;

export function computeNextRetryAt(attemptCount: number, now = Date.now()) {
  const delay =
    RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];

  return new Date(now + delay).toISOString();
}
