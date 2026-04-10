const RETRY_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;

export function computeNextRetryAt(attemptCount: number, now = Date.now()) {
  const delay =
    RETRY_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)];

  return new Date(now + delay).toISOString();
}
