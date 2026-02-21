import type { DiagnosticEventPayload, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import type { PostHogPluginConfig, RunState } from "./types.js";
import { buildAiGeneration, buildAiSpan, buildAiTrace } from "./events.js";
import { generateSpanId, generateTraceId } from "./utils.js";

const DEFAULT_HOST = "https://us.i.posthog.com";
const STALE_RUN_MS = 5 * 60 * 1000;

export function registerPostHogHooks(api: OpenClawPluginApi, config: PostHogPluginConfig) {
  /** In-flight LLM runs keyed by runId */
  const runs = new Map<string, RunState>();
  /** Active trace IDs keyed by sessionKey */
  const traces = new Map<string, string>();
  /** Most recent generation spanId keyed by sessionKey, used as parent for tool spans */
  const generationSpans = new Map<string, string>();
  /** Last runId seen per sessionKey — a new runId means a new message cycle */
  const lastRunId = new Map<string, string>();
  /** Timestamp of last llm_output per sessionKey — used for session-mode timeout */
  const lastOutputAt = new Map<string, number>();

  let client: import("posthog-node").PostHog | null = null;
  let unsubscribe: (() => void) | null = null;

  function getOrCreateTraceId(sessionKey: string | undefined, runId: string): string {
    if (!sessionKey) {
      return generateTraceId();
    }

    if (config.traceBy === "session") {
      const existing = traces.get(sessionKey);
      const lastOutput = lastOutputAt.get(sessionKey);
      const timeoutMs = config.traceTimeout * 60_000;

      // Reuse trace if it exists and hasn't timed out
      if (existing && lastOutput && Date.now() - lastOutput < timeoutMs) {
        return existing;
      }

      // Otherwise start a new trace
      const traceId = generateTraceId();
      traces.set(sessionKey, traceId);
      return traceId;
    }

    // "message" mode (default) — split on runId change
    const prevRunId = lastRunId.get(sessionKey);
    const existing = traces.get(sessionKey);
    if (existing && prevRunId === runId) {
      return existing;
    }

    lastRunId.set(sessionKey, runId);
    const traceId = generateTraceId();
    traces.set(sessionKey, traceId);
    return traceId;
  }

  function cleanupStaleRuns() {
    const now = Date.now();
    for (const [runId, state] of runs) {
      if (now - state.startTime > STALE_RUN_MS) {
        runs.delete(runId);
      }
    }
  }

  // Register the background service that manages the PostHog client lifecycle
  api.registerService({
    id: "posthog",
    async start() {
      const { PostHog: PostHogClient } = await import("posthog-node");
      client = new PostHogClient(config.apiKey, {
        host: config.host || DEFAULT_HOST,
        flushAt: 20,
        flushInterval: 10_000,
      });

      // Subscribe to diagnostic events for $ai_trace capture
      unsubscribe = onDiagnosticEvent((evt: DiagnosticEventPayload) => {
        if (!client) return;

        if (evt.type === "message.processed") {
          const traceId = evt.sessionKey ? traces.get(evt.sessionKey) : undefined;
          if (traceId) {
            const traceEvent = buildAiTrace(traceId, evt);
            client.capture({
              distinctId: traceEvent.distinctId,
              event: traceEvent.event,
              properties: traceEvent.properties,
            });
            // In message mode, clean up trace state after completion.
            // In session mode, keep the trace alive for reuse across messages.
            if (evt.sessionKey && config.traceBy !== "session") {
              traces.delete(evt.sessionKey);
              generationSpans.delete(evt.sessionKey);
            }
          }
        }
      });
    },
    async stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (client) {
        await client.shutdown();
        client = null;
      }
      runs.clear();
      traces.clear();
      generationSpans.clear();
      lastRunId.clear();
      lastOutputAt.clear();
    },
  });

  // -- Lifecycle Hooks --

  api.on("llm_input", (event, ctx) => {
    cleanupStaleRuns();

    const traceId = getOrCreateTraceId(ctx.sessionKey, event.runId);
    const spanId = generateSpanId();

    // Build the input message array: system prompt + history + current prompt
    let input: unknown[] | null = null;
    if (!config.privacyMode) {
      input = [];
      if (event.systemPrompt) {
        input.push({ role: "system", content: event.systemPrompt });
      }
      input.push(...event.historyMessages, event.prompt);
    }

    runs.set(event.runId, {
      traceId,
      spanId,
      startTime: Date.now(),
      model: event.model,
      provider: event.provider,
      input,
      sessionKey: ctx.sessionKey,
      channel: ctx.messageProvider,
      agentId: ctx.agentId,
    });
  });

  api.on("llm_output", (event, ctx) => {
    if (!client) return;

    const runState = runs.get(event.runId);
    if (!runState) return;
    runs.delete(event.runId);

    // Track the generation spanId for tool call parenting.
    const sessionKey = ctx.sessionKey;
    if (sessionKey) {
      generationSpans.set(sessionKey, runState.spanId);
      if (config.traceBy === "session") {
        lastOutputAt.set(sessionKey, Date.now());
      }
    }

    const generation = buildAiGeneration(runState, event, config.privacyMode);
    client.capture({
      distinctId: generation.distinctId,
      event: generation.event,
      properties: generation.properties,
    });
  });

  api.on("after_tool_call", (event, ctx) => {
    if (!client) return;

    const traceId = ctx.sessionKey ? traces.get(ctx.sessionKey) : undefined;
    if (!traceId) return;

    const parentSpanId = ctx.sessionKey ? generationSpans.get(ctx.sessionKey) : undefined;

    const span = buildAiSpan(traceId, parentSpanId, event, ctx, config.privacyMode);
    client.capture({
      distinctId: span.distinctId,
      event: span.event,
      properties: span.properties,
    });
  });
}
