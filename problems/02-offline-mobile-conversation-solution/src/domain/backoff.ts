export interface RetryConfig {
  /** Total attempts allowed per message before it becomes `failed`. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryConfig = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30_000 };

/**
 * Delay before the next attempt, given how many attempts have already been made (>= 1).
 * Deterministic exponential backoff so tests are exact. A production client would add jitter.
 */
export function backoffDelay(attemptsMade: number, cfg: RetryConfig): number {
  const exp = Math.max(0, attemptsMade - 1);
  return Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** exp);
}
