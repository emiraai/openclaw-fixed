// Prevent duplicate processing when WebSocket reconnects or Feishu redelivers messages.
import { tryRecordMessagePersistent } from "./dedup-store.js";
import type { ResolvedFeishuAccount } from "./types.js";

const DEDUP_MAX_SIZE = 1_000;
// Memory cache key: `${accountId}:${messageId}` so multiple Feishu connections don't collide
const processedMessageIds = new Map<string, number>();

/**
 * Dedup check with persistent storage, per account.
 * Survives OpenClaw restarts and handles WebSocket reconnects properly.
 * Uses both memory cache (fast path) and disk storage (persistent).
 */
export async function tryRecordMessageAsync(
  account: ResolvedFeishuAccount,
  messageId: string,
): Promise<boolean> {
  const accountId = account.accountId ?? "default";
  const cacheKey = `${accountId}:${messageId}`;
  const now = Date.now();

  // First check memory cache (fast path)
  if (processedMessageIds.has(cacheKey)) {
    return false;
  }

  // Then check persistent store for this account
  const isNew = await tryRecordMessagePersistent(accountId, messageId);

  // Update memory cache so next check for this message skips disk (whether new or already processed)
  if (processedMessageIds.size >= DEDUP_MAX_SIZE) {
    const first = processedMessageIds.keys().next().value!;
    processedMessageIds.delete(first);
  }
  processedMessageIds.set(cacheKey, now);

  return isNew;
}
