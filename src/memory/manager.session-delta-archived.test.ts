import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

const { watchMock } = vi.hoisted(() => ({
  watchMock: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock("chokidar", () => ({
  default: { watch: watchMock },
  watch: watchMock,
}));

vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "mock",
      model: "mock-embed",
      embedQuery: async () => [1, 0],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0]),
    },
  }),
}));

describe("memory session delta archived paths", () => {
  let manager: MemoryIndexManager | null = null;
  let workspaceDir = "";

  afterEach(async () => {
    watchMock.mockClear();
    vi.unstubAllEnvs();
    if (manager) {
      await manager.close();
      manager = null;
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("marks archived transcripts dirty and syncs without delta-threshold checks", async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memory-archived-delta-"));
    const stateDir = path.join(workspaceDir, "state");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });

    const cfg = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            experimental: { sessionMemory: true },
            sources: ["sessions"],
            provider: "openai",
            model: "mock-embed",
            store: { path: path.join(workspaceDir, "index.sqlite"), vector: { enabled: false } },
            sync: {
              watch: false,
              onSessionStart: false,
              onSearch: false,
              sessions: { deltaBytes: 999_999, deltaMessages: 999_999 },
            },
            query: { minScore: 0, hybrid: { enabled: false } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    } as OpenClawConfig;

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).not.toBeNull();
    if (!result.manager) {
      throw new Error("manager missing");
    }
    manager = result.manager as unknown as MemoryIndexManager;

    const archivedPath = path.join(sessionsDir, "session-1.jsonl.reset.2026-02-18T10-00-00.000Z");
    const inner = manager as unknown as {
      sessionPendingFiles: Set<string>;
      sessionsDirtyFiles: Set<string>;
      sessionsDirty: boolean;
      updateSessionDelta: (sessionFile: string) => Promise<unknown>;
      processSessionDeltaBatch: () => Promise<void>;
      sync: (params?: { reason?: string; force?: boolean }) => Promise<void>;
    };

    inner.sessionPendingFiles.add(archivedPath);
    const updateDeltaSpy = vi.spyOn(inner, "updateSessionDelta");
    const syncSpy = vi.fn(async () => undefined);
    inner.sync = syncSpy;

    await inner.processSessionDeltaBatch();

    expect(updateDeltaSpy).not.toHaveBeenCalled();
    expect(inner.sessionsDirtyFiles.has(archivedPath)).toBe(true);
    expect(inner.sessionsDirty).toBe(true);
    expect(syncSpy).toHaveBeenCalledWith({ reason: "session-delta" });
  });
});
