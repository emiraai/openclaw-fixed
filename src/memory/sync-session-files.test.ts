import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionEntry, sessionPathForFile, type SessionFileEntry } from "./session-files.js";
import { syncSessionFiles } from "./sync-session-files.js";

describe("syncSessionFiles", () => {
  let tmpDir = "";
  let stateDir = "";
  let sessionsDir = "";
  let db: DatabaseSync;
  let activeFile = "";
  let archivedFile = "";
  let activeEntry: SessionFileEntry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sync-session-files-"));
    stateDir = path.join(tmpDir, "state");
    sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);

    activeFile = path.join(sessionsDir, "active.jsonl");
    archivedFile = path.join(sessionsDir, "active.jsonl.reset.2026-02-18T10-00-00.000Z");
    await fs.writeFile(
      activeFile,
      '{"type":"message","message":{"role":"user","content":"active message"}}\n',
      "utf-8",
    );
    await fs.writeFile(
      archivedFile,
      '{"type":"message","message":{"role":"assistant","content":"archived message"}}\n',
      "utf-8",
    );

    const loadedActive = await buildSessionEntry(activeFile);
    if (!loadedActive) {
      throw new Error("active session entry missing");
    }
    activeEntry = loadedActive;

    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)").run(
      activeEntry.path,
      "sessions",
      activeEntry.hash,
      Math.floor(activeEntry.mtimeMs),
      activeEntry.size,
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("indexes newly discovered archived paths in dirty mode, then dedupes unchanged runs", async () => {
    const indexedPaths: string[] = [];
    const runWithConcurrency = async <T>(
      tasks: Array<() => Promise<T>>,
      _concurrency: number,
    ): Promise<T[]> => await Promise.all(tasks.map(async (task) => await task()));

    const indexFile = async (entry: SessionFileEntry): Promise<void> => {
      indexedPaths.push(entry.path);
      db.prepare(
        "INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)",
      ).run(entry.path, "sessions", entry.hash, Math.floor(entry.mtimeMs), entry.size);
      db.prepare("INSERT OR REPLACE INTO chunks (id, path, source) VALUES (?, ?, ?)").run(
        `${entry.path}#chunk`,
        entry.path,
        "sessions",
      );
    };

    const runSync = async () =>
      await syncSessionFiles({
        agentId: "main",
        db,
        needsFullReindex: false,
        batchEnabled: false,
        concurrency: 4,
        runWithConcurrency,
        indexFile,
        vectorTable: "chunks_vec",
        ftsTable: "chunks_fts",
        ftsEnabled: false,
        ftsAvailable: false,
        model: "mock-embed",
        dirtyFiles: new Set([activeFile]),
      });

    await runSync();
    expect(indexedPaths).toEqual([sessionPathForFile(archivedFile)]);

    await runSync();
    expect(indexedPaths).toEqual([sessionPathForFile(archivedFile)]);
  });
});
