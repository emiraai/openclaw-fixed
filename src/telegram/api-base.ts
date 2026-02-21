/**
 * Resolve the Telegram Bot API base URL.
 *
 * Priority: explicit override > `TELEGRAM_API_ROOT` env var > default.
 * Strips trailing slashes so callers can do `${apiBase}/bot${token}/...`.
 */

import { realpath } from "node:fs/promises";
import nodePath from "node:path";

const DEFAULT_API_BASE = "https://api.telegram.org";

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getTelegramApiBase(override?: string): string {
  if (override?.trim()) {
    return normalize(override);
  }
  const env = process.env.TELEGRAM_API_ROOT?.trim();
  if (env) {
    return normalize(env);
  }
  return DEFAULT_API_BASE;
}

/**
 * Returns true when the resolved API base is NOT the default Telegram cloud API,
 * i.e. a local or custom Bot API server is in use.
 */
export function isCustomTelegramApi(apiBase: string): boolean {
  return normalize(apiBase) !== DEFAULT_API_BASE;
}

/**
 * Returns true when a file_path from getFile looks like an absolute disk path
 * (local Bot API server returns these instead of relative paths).
 */
export function isLocalBotApiFilePath(filePath: string): boolean {
  return filePath.startsWith("/");
}

/**
 * Validate that an absolute file path returned by a local Bot API server
 * actually lives under an allowed data directory.  Resolves symlinks and
 * normalizes `..` to prevent path-traversal attacks (a compromised local
 * server could otherwise trick us into reading arbitrary files).
 *
 * @param filePath  The raw `file_path` from `getFile`.
 * @param allowedDir  Explicit data directory (from config `localApiDataDir`).
 *                    Required — there is no default; callers must configure it.
 * @returns The resolved real path if it is inside the allowed directory.
 * @throws If `allowedDir` is not set, or the path escapes the allowed directory.
 */
export async function validateLocalFilePath(
  filePath: string,
  allowedDir?: string,
): Promise<string> {
  if (!allowedDir?.trim()) {
    throw new Error(
      "localApiDataDir must be configured when using a local Bot API server with disk reads",
    );
  }
  // Resolve symlinks on both sides so Windows 8.3 short names (e.g.
  // RUNNER~1) don't cause a false mismatch against the long-form realpath.
  const resolvedBase = await realpath(nodePath.resolve(allowedDir.trim()));
  const real = await realpath(filePath);
  const normalBase = resolvedBase.endsWith("/") ? resolvedBase : `${resolvedBase}/`;
  if (!real.startsWith(normalBase) && real !== resolvedBase) {
    throw new Error(
      `Local Bot API file path escapes allowed directory: ${filePath} resolved to ${real} (allowed: ${resolvedBase})`,
    );
  }
  return real;
}
