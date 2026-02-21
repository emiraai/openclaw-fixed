// Shared tool-risk constants.
// Keep these centralized so gateway HTTP restrictions, security audits, and ACP prompts don't drift.

/**
 * Tools denied via Gateway HTTP `POST /tools/invoke` by default.
 * These are high-risk because they enable session orchestration, control-plane actions,
 * or interactive flows that don't make sense over a non-interactive HTTP surface.
 */
export const DEFAULT_GATEWAY_HTTP_TOOL_DENY = [
  // Session orchestration — spawning agents remotely is RCE
  "sessions_spawn",
  // Cross-session injection — message injection across sessions
  "sessions_send",
  // Gateway control plane — prevents gateway reconfiguration via HTTP
  "gateway",
  // Interactive setup — requires terminal QR scan, hangs on HTTP
  "whatsapp_login",
] as const;

/**
 * SECURITY: Tools that can NEVER be re-enabled via gateway.tools.allow.
 * These are effectively RCE over HTTP and must remain permanently denied.
 */
export const NON_OVERRIDABLE_GATEWAY_HTTP_DENY = new Set<string>([
  "sessions_spawn",
  "sessions_send",
]);

/**
 * ACP tools that should always require explicit user approval.
 * ACP is an automation surface; we never want "silent yes" for mutating/execution tools.
 */
export const DANGEROUS_ACP_TOOL_NAMES = [
  "exec",
  "spawn",
  "shell",
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
] as const;

export const DANGEROUS_ACP_TOOLS = new Set<string>(DANGEROUS_ACP_TOOL_NAMES);
