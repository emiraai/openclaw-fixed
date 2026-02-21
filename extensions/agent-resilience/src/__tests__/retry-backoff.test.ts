import { describe, it, expect } from "vitest";
import {
  computeRetryDelay,
  isRetryableRound,
  RETRYABLE_REASONS,
  DEFAULT_RETRY_CONFIG,
} from "../retry-backoff.js";

describe("RETRYABLE_REASONS", () => {
  it("contains expected reason strings", () => {
    expect(RETRYABLE_REASONS).toContain("rate_limit");
    expect(RETRYABLE_REASONS).toContain("timeout");
    expect(RETRYABLE_REASONS).toContain("unknown");
  });
});

describe("computeRetryDelay", () => {
  it("returns base delay on first attempt", () => {
    const delay = computeRetryDelay(0, {
      baseDelayMs: 5_000,
      maxDelayMs: 120_000,
      maxRounds: 5,
    });
    expect(delay).toBe(5_000);
  });

  it("doubles delay with each attempt (exponential back-off)", () => {
    const cfg = { baseDelayMs: 1_000, maxDelayMs: 60_000, maxRounds: 5 };
    expect(computeRetryDelay(1, cfg)).toBe(2_000);
    expect(computeRetryDelay(2, cfg)).toBe(4_000);
    expect(computeRetryDelay(3, cfg)).toBe(8_000);
  });

  it("caps delay at maxDelayMs", () => {
    const cfg = { baseDelayMs: 1_000, maxDelayMs: 3_000, maxRounds: 10 };
    expect(computeRetryDelay(5, cfg)).toBe(3_000);
  });
});

describe("isRetryableRound", () => {
  it("returns true for retryable reasons within round limit", () => {
    expect(isRetryableRound("rate_limit", 0, DEFAULT_RETRY_CONFIG)).toBe(true);
    expect(isRetryableRound("timeout", 2, DEFAULT_RETRY_CONFIG)).toBe(true);
  });

  it("returns false when round exceeds maxRounds", () => {
    const cfg = { ...DEFAULT_RETRY_CONFIG, maxRounds: 2 };
    expect(isRetryableRound("rate_limit", 3, cfg)).toBe(false);
  });

  it("returns false for non-retryable reasons", () => {
    expect(isRetryableRound("invalid_api_key", 0, DEFAULT_RETRY_CONFIG)).toBe(false);
    expect(isRetryableRound("content_policy", 1, DEFAULT_RETRY_CONFIG)).toBe(false);
  });
});
