/**
 * Strips OpenClaw-injected inbound metadata blocks from a user-role message
 * text before it is displayed in any UI surface (TUI, webchat, macOS app).
 *
 * Background: `buildInboundUserContextPrefix` in `inbound-meta.ts` prepends
 * structured metadata blocks (Conversation info, Sender info, reply context,
 * etc.) directly to the stored user message content so the LLM can access
 * them. These blocks are AI-facing only and must never surface in user-visible
 * chat history.
 */

/**
 * Sentinel strings that identify the start of an injected metadata block.
 * Must stay in sync with `buildInboundUserContextPrefix` in `inbound-meta.ts`.
 */
const INBOUND_META_SENTINELS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Thread starter (untrusted, for context):",
  "Replied message (untrusted, for context):",
  "Forwarded message context (untrusted metadata):",
  "Chat history since last reply (untrusted, for context):",
] as const;

// Pre-compiled fast-path regex — avoids line-by-line parse when no blocks present.
const SENTINEL_FAST_RE = new RegExp(
  INBOUND_META_SENTINELS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
);

/**
 * Remove injected inbound metadata blocks from `text`.
 *
 * Each block has the shape:
 *
 * ```
 * <sentinel-line>
 * ```json
 * { … }
 * ```
 * ```
 *
 * @param text    - The message text to strip.
 * @param opts.prefixOnly - When `true`, only strip blocks that appear before
 *   any real content (leading-prefix mode). Once real content is seen,
 *   sentinel blocks are left intact. Default: `false` (strip all occurrences).
 *
 * Returns the original string reference unchanged when no metadata is present
 * (fast path — zero allocation).
 */
export function stripInboundMetadata(text: string, opts?: { prefixOnly?: boolean }): string {
  if (!text || !SENTINEL_FAST_RE.test(text)) {
    return text;
  }

  const prefixOnly = opts?.prefixOnly === true;
  const lines = text.split("\n");
  const result: string[] = [];
  let inMetaBlock = false;
  let inFencedJson = false;
  // Tracks whether any real content has been collected (used for prefixOnly mode).
  let seenContent = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of a metadata block.
    // In prefixOnly mode: only strip if no real content has been seen yet.
    if (
      !inMetaBlock &&
      (!prefixOnly || !seenContent) &&
      INBOUND_META_SENTINELS.some((s) => line.startsWith(s))
    ) {
      inMetaBlock = true;
      inFencedJson = false;
      continue;
    }

    if (inMetaBlock) {
      if (!inFencedJson && line.trim() === "```json") {
        inFencedJson = true;
        continue;
      }
      if (inFencedJson) {
        if (line.trim() === "```") {
          inMetaBlock = false;
          inFencedJson = false;
        }
        continue;
      }
      // Blank separator lines between consecutive blocks are dropped.
      if (line.trim() === "") {
        continue;
      }
      // Unexpected non-blank line outside a fence — treat as user content.
      inMetaBlock = false;
    }

    result.push(line);
    if (line.trim()) {
      seenContent = true;
    }
  }

  return result.join("\n").replace(/^\n+/, "");
}
