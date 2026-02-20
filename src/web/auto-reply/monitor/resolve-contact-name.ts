import { normalizeE164 } from "../../../utils.js";
import type { WebInboundMsg } from "../types.js";

/**
 * Resolve a display name for the sender in direct chats.
 * Priority: contactNames config → WhatsApp push-name → phone number → "contact".
 * Returns undefined for group chats (groups already have sender labels in the envelope).
 */
export function resolveDmSenderName(params: {
  msg: Pick<WebInboundMsg, "chatType" | "senderE164" | "from" | "senderName">;
  contactNames?: Record<string, string>;
}): string | undefined {
  if (params.msg.chatType === "group") {
    return undefined;
  }
  const raw = normalizeE164(params.msg.senderE164 ?? params.msg.from ?? "");
  // normalizeE164("") returns "+", so only treat it as a valid phone if it has digits.
  const phone = raw && raw.length > 1 ? raw : undefined;
  if (phone && params.contactNames?.[phone]) {
    return params.contactNames[phone];
  }
  const pushName = params.msg.senderName?.trim();
  if (pushName) {
    return pushName;
  }
  if (phone) {
    return phone;
  }
  return "contact";
}
