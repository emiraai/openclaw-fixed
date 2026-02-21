import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as helpers from "../pi-embedded-helpers.js";
import { runEmbeddedPiAgent } from "./run.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedRunEmbeddedAttempt = vi.mocked(runEmbeddedAttempt);
const mockedIsThinkingImmutabilityError = vi.mocked(helpers.isThinkingImmutabilityError);

const THINKING_IMMUTABILITY_ERROR =
  "thinking or redacted_thinking blocks in the messages cannot be modified";

describe("runEmbeddedPiAgent thinking immutability recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns thinking_immutability error kind when immutability error is detected", async () => {
    mockedIsThinkingImmutabilityError.mockReturnValue(true);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        promptError: new Error(THINKING_IMMUTABILITY_ERROR),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    expect(result.meta.error?.kind).toBe("thinking_immutability");
    expect(result.meta.error?.message).toBe(THINKING_IMMUTABILITY_ERROR);
  });

  it("includes a user-friendly error payload for immutability errors", async () => {
    mockedIsThinkingImmutabilityError.mockReturnValue(true);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        promptError: new Error(THINKING_IMMUTABILITY_ERROR),
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    const payload = result.payloads?.[0];
    expect(payload?.isError).toBe(true);
    expect(payload?.text).toMatch(/\/new|\/reset/i);
  });

  it("does not trigger for unrelated prompt errors", async () => {
    mockedIsThinkingImmutabilityError.mockReturnValue(false);
    mockedRunEmbeddedAttempt.mockRejectedValueOnce(new Error("unexpected internal error"));

    await expect(
      runEmbeddedPiAgent({
        sessionId: "test-session",
        sessionKey: "test-key",
        sessionFile: "/tmp/session.json",
        workspaceDir: "/tmp/workspace",
        prompt: "hello",
        timeoutMs: 30000,
        runId: "run-1",
      }),
    ).rejects.toThrow("unexpected internal error");
  });
});
