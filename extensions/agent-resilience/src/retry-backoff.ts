/**
 * Retryable-failure backoff logic for model fallback.
 *
 * Extracted from src/agents/model-fallback.ts on the dev branch.
 * This module provides the retry constants and pure helper functions
 * without modifying core files.
 */

/**
 * Reasons that qualify for automatic retry-with-backoff.
 * - rate_limit: explicit 429 / cooldown skip
 * - timeout:    request hung (commonly a silent rate limit from proxies)
 * - unknown:    no classifiable reason — often a timeout with empty error body
 */
export const RETRYABLE_REASONS = new Set<string>(["rate_limit", "timeout", "unknown"]);

export type RetryConfig = {
  /** Maximum number of retry rounds (default: 2). */
  maxRounds: number;
  /** Base delay in ms (actual = base × 2^round, default: 15000). */
  baseDelayMs: number;
  /** Hard ceiling for any single retry delay (default: 60000). */
  maxDelayMs: number;
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRounds: 2,
  baseDelayMs: 15_000,
  maxDelayMs: 60_000,
};

/**
 * Compute the delay for a given retry round with exponential backoff.
 */
export function computeRetryDelay(round: number, config?: Partial<RetryConfig>): number {
  const base = config?.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs;
  const max = config?.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs;
  return Math.min(base * 2 ** round, max);
}

/**
 * Determine whether a failed round should be retried.
 *
 * @param attempts - Array of attempt results with `reason` fields
 * @param round - Current retry round (0-indexed)
 * @param config - Retry configuration
 * @returns true if all attempts failed with retryable reasons and round < maxRounds
 */
export function isRetryableRound(
  attempts: Array<{ reason?: string }>,
  round: number,
  config?: Partial<RetryConfig>,
): boolean {
  const maxRounds = config?.maxRounds ?? DEFAULT_RETRY_CONFIG.maxRounds;
  if (round >= maxRounds) {
    return false;
  }
  if (attempts.length === 0) {
    return false;
  }
  return attempts.every((a) => RETRYABLE_REASONS.has(a.reason ?? "unknown"));
}

/**
 * Sleep helper for retry delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
