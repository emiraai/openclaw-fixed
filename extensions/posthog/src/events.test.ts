import { describe, expect, test, vi } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-0001"),
}));

import type {
  DiagnosticMessageProcessedEvent,
  PluginHookAfterToolCallEvent,
  PluginHookLlmOutputEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk";
import type { RunState } from "./types.js";
import { buildAiGeneration, buildAiSpan, buildAiTrace } from "./events.js";

describe("buildAiGeneration", () => {
  const baseRunState: RunState = {
    traceId: "trace-1",
    spanId: "span-1",
    startTime: Date.now() - 1500,
    model: "gpt-4o",
    provider: "openai",
    input: [{ role: "user", content: "hello" }],
    sessionKey: "telegram:123",
    channel: "telegram",
    agentId: "agent-1",
  };

  const baseOutput: PluginHookLlmOutputEvent = {
    runId: "run-1",
    sessionId: "sess-1",
    provider: "openai",
    model: "gpt-4o",
    assistantTexts: ["Hello! How can I help?"],
    usage: {
      input: 100,
      output: 25,
      cacheRead: 50,
      cacheWrite: 10,
      total: 185,
    },
  };

  test("maps all fields correctly with privacy off", () => {
    const result = buildAiGeneration(baseRunState, baseOutput, false);

    expect(result.event).toBe("$ai_generation");
    expect(result.distinctId).toBe("telegram:123");
    expect(result.properties.$ai_trace_id).toBe("trace-1");
    expect(result.properties.$ai_span_id).toBe("span-1");
    expect(result.properties.$ai_model).toBe("gpt-4o");
    expect(result.properties.$ai_provider).toBe("openai");
    expect(result.properties.$ai_input).toEqual([{ role: "user", content: "hello" }]);
    expect(result.properties.$ai_output_choices).toEqual(["Hello! How can I help?"]);
    expect(result.properties.$ai_input_tokens).toBe(100);
    expect(result.properties.$ai_output_tokens).toBe(25);
    expect(result.properties.$ai_latency).toBeGreaterThan(0);
    expect(result.properties.$ai_is_error).toBe(false);
    expect(result.properties.$ai_lib).toBe("posthog-openclaw");
    expect(result.properties.$ai_framework).toBe("openclaw");
    expect(result.properties.cache_read_input_tokens).toBe(50);
    expect(result.properties.cache_creation_input_tokens).toBe(10);
    expect(result.properties.$ai_channel).toBe("telegram");
    expect(result.properties.$ai_agent_id).toBe("agent-1");
  });

  test("redacts input/output in privacy mode", () => {
    const result = buildAiGeneration(baseRunState, baseOutput, true);

    expect(result.properties.$ai_input).toBeNull();
    expect(result.properties.$ai_output_choices).toBeNull();
    // Tokens should still be present
    expect(result.properties.$ai_input_tokens).toBe(100);
    expect(result.properties.$ai_output_tokens).toBe(25);
  });

  test("uses runId as distinctId when sessionKey missing", () => {
    const runState = { ...baseRunState, sessionKey: undefined };
    const result = buildAiGeneration(runState, baseOutput, false);
    expect(result.distinctId).toBe("run-1");
  });

  test("handles missing usage gracefully", () => {
    const output = { ...baseOutput, usage: undefined };
    const result = buildAiGeneration(baseRunState, output, false);
    expect(result.properties.$ai_input_tokens).toBeNull();
    expect(result.properties.$ai_output_tokens).toBeNull();
    expect(result.properties.cache_read_input_tokens).toBeNull();
    expect(result.properties.cache_creation_input_tokens).toBeNull();
  });
});

describe("buildAiSpan", () => {
  const baseToolEvent: PluginHookAfterToolCallEvent = {
    toolName: "web_search",
    params: { query: "weather today" },
    result: { results: ["sunny"] },
    durationMs: 320,
  };

  const baseToolCtx: PluginHookToolContext = {
    toolName: "web_search",
    sessionKey: "telegram:123",
    agentId: "agent-1",
  };

  test("maps tool call to span correctly", () => {
    const result = buildAiSpan("trace-1", "parent-span-1", baseToolEvent, baseToolCtx, false);

    expect(result.event).toBe("$ai_span");
    expect(result.distinctId).toBe("telegram:123");
    expect(result.properties.$ai_trace_id).toBe("trace-1");
    expect(result.properties.$ai_span_id).toBe("test-uuid-0001");
    expect(result.properties.$ai_parent_id).toBe("parent-span-1");
    expect(result.properties.$ai_span_name).toBe("web_search");
    expect(result.properties.$ai_latency).toBeCloseTo(0.32, 2);
    expect(result.properties.$ai_is_error).toBe(false);
    expect(result.properties.$ai_error).toBeNull();
    expect(result.properties.$ai_input_state).toContain("weather today");
    expect(result.properties.$ai_output_state).toContain("sunny");
  });

  test("redacts input/output state in privacy mode", () => {
    const result = buildAiSpan("trace-1", "parent-1", baseToolEvent, baseToolCtx, true);

    expect(result.properties.$ai_input_state).toBeNull();
    expect(result.properties.$ai_output_state).toBeNull();
    // Duration still present
    expect(result.properties.$ai_latency).toBeCloseTo(0.32, 2);
  });

  test("marks error spans correctly", () => {
    const errorEvent = { ...baseToolEvent, error: "timeout", result: undefined };
    const result = buildAiSpan("trace-1", undefined, errorEvent, baseToolCtx, false);

    expect(result.properties.$ai_is_error).toBe(true);
    expect(result.properties.$ai_error).toBe("timeout");
    expect(result.properties.$ai_parent_id).toBeNull();
  });

  test("handles missing durationMs", () => {
    const event = { ...baseToolEvent, durationMs: undefined };
    const result = buildAiSpan("trace-1", "parent-1", event, baseToolCtx, false);
    expect(result.properties.$ai_latency).toBeNull();
  });
});

describe("buildAiTrace", () => {
  test("maps message.processed to trace event", () => {
    const diagnosticEvent = {
      type: "message.processed" as const,
      ts: Date.now(),
      seq: 1,
      channel: "telegram",
      outcome: "completed" as const,
      durationMs: 2500,
      sessionKey: "telegram:123",
    } satisfies DiagnosticMessageProcessedEvent;

    const result = buildAiTrace("trace-1", diagnosticEvent);

    expect(result.event).toBe("$ai_trace");
    expect(result.distinctId).toBe("telegram:123");
    expect(result.properties.$ai_trace_id).toBe("trace-1");
    expect(result.properties.$ai_latency).toBeCloseTo(2.5, 2);
    expect(result.properties.$ai_is_error).toBe(false);
    expect(result.properties.$ai_error).toBeNull();
    expect(result.properties.$ai_channel).toBe("telegram");
  });

  test("marks error traces correctly", () => {
    const diagnosticEvent = {
      type: "message.processed" as const,
      ts: Date.now(),
      seq: 2,
      channel: "slack",
      outcome: "error" as const,
      error: "model rate limited",
      durationMs: 500,
      sessionKey: "slack:456",
    } satisfies DiagnosticMessageProcessedEvent;

    const result = buildAiTrace("trace-2", diagnosticEvent);

    expect(result.properties.$ai_is_error).toBe(true);
    expect(result.properties.$ai_error).toBe("model rate limited");
  });

  test("handles missing durationMs", () => {
    const diagnosticEvent = {
      type: "message.processed" as const,
      ts: Date.now(),
      seq: 3,
      channel: "discord",
      outcome: "completed" as const,
    } satisfies DiagnosticMessageProcessedEvent;

    const result = buildAiTrace("trace-3", diagnosticEvent);
    expect(result.properties.$ai_latency).toBeNull();
  });
});
