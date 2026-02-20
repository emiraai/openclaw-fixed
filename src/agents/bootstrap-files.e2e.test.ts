import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun, resolveBootstrapFilesForRun } from "./bootstrap-files.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

function registerExtraBootstrapFileHook() {
  registerInternalHook("agent:bootstrap", (event) => {
    const context = event.context as AgentBootstrapHookContext;
    context.bootstrapFiles = [
      ...context.bootstrapFiles,
      {
        name: "EXTRA.md",
        path: path.join(context.workspaceDir, "EXTRA.md"),
        content: "extra",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
    ];
  });
}

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("applies bootstrap hook overrides", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    expect(files.some((file) => file.path === path.join(workspaceDir, "EXTRA.md"))).toBe(true);
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("returns context files for hook-adjusted bootstrap files", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const extra = result.contextFiles.find(
      (file) => file.path === path.join(workspaceDir, "EXTRA.md"),
    );

    expect(extra?.content).toBe("extra");
  });

  it("uses retrieval excerpts when bootstrapRetrieval.mode=on", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-retrieval-");
    const result = await resolveBootstrapContextForRun({
      workspaceDir,
      config: {
        agents: {
          defaults: {
            bootstrapRetrieval: {
              mode: "on",
              topFiles: 2,
              chunksPerFile: 1,
              maxChunkChars: 400,
              maxTotalChars: 700,
            },
          },
        },
      },
      retrievalPrompt: "sessions_send and message routing behavior",
    });

    expect(result.contextFiles.length).toBeGreaterThan(0);
    expect(result.contextFiles.length).toBeLessThanOrEqual(2);
    const totalChars = result.contextFiles.reduce((sum, file) => sum + file.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(700);
  });

  it("auto mode falls back to full injection when prompt is empty", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-auto-");
    const autoResult = await resolveBootstrapContextForRun({
      workspaceDir,
      config: {
        agents: {
          defaults: {
            bootstrapRetrieval: {
              mode: "auto",
              thresholdChars: 1,
            },
          },
        },
      },
    });
    const fullResult = await resolveBootstrapContextForRun({
      workspaceDir,
      config: {
        agents: {
          defaults: {
            bootstrapRetrieval: {
              mode: "off",
            },
          },
        },
      },
    });

    expect(autoResult.contextFiles).toEqual(fullResult.contextFiles);
  });
});
