import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";

/**
 * Resolve a directory to its real path, falling back to the original if it
 * doesn't exist yet.  This ensures that symlinked directories like `/tmp`
 * on macOS (which resolves to `/private/tmp`) are matched correctly when
 * compared against `fs.realpath()` results in `assertLocalMediaAllowed`.
 */
function safeRealpath(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function buildMediaLocalRoots(stateDir: string): string[] {
  const resolvedStateDir = path.resolve(stateDir);
  const preferredTmpDir = resolvePreferredOpenClawTmpDir();
  const roots = [
    safeRealpath(preferredTmpDir),
    path.join(resolvedStateDir, "media"),
    path.join(resolvedStateDir, "agents"),
    path.join(resolvedStateDir, "workspace"),
    path.join(resolvedStateDir, "sandboxes"),
  ];
  // On macOS, /tmp is a symlink to /private/tmp which differs from
  // os.tmpdir() (/var/folders/...).  Add /tmp's real path so that files
  // placed in /tmp are accepted.
  try {
    const slashTmpReal = fs.realpathSync("/tmp");
    if (!roots.includes(slashTmpReal)) {
      roots.push(slashTmpReal);
    }
  } catch {
    // /tmp doesn't exist (unlikely) — skip.
  }
  return roots;
}

export function getDefaultMediaLocalRoots(): readonly string[] {
  return buildMediaLocalRoots(resolveStateDir());
}

export function getAgentScopedMediaLocalRoots(
  cfg: OpenClawConfig,
  agentId?: string,
): readonly string[] {
  const roots = buildMediaLocalRoots(resolveStateDir());
  if (!agentId?.trim()) {
    return roots;
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspaceDir) {
    return roots;
  }
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!roots.includes(normalizedWorkspaceDir)) {
    roots.push(normalizedWorkspaceDir);
  }
  return roots;
}
