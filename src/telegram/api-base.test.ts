import { mkdtemp, realpath, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTelegramApiBase,
  isCustomTelegramApi,
  isLocalBotApiFilePath,
  validateLocalFilePath,
} from "./api-base.js";

describe("getTelegramApiBase", () => {
  const originalEnv = process.env.TELEGRAM_API_ROOT;

  beforeEach(() => {
    delete process.env.TELEGRAM_API_ROOT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TELEGRAM_API_ROOT = originalEnv;
    } else {
      delete process.env.TELEGRAM_API_ROOT;
    }
  });

  it("returns default when no override or env var", () => {
    expect(getTelegramApiBase()).toBe("https://api.telegram.org");
  });

  it("returns default for undefined override", () => {
    expect(getTelegramApiBase(undefined)).toBe("https://api.telegram.org");
  });

  it("returns default for empty-string override", () => {
    expect(getTelegramApiBase("")).toBe("https://api.telegram.org");
  });

  it("returns default for whitespace-only override", () => {
    expect(getTelegramApiBase("   ")).toBe("https://api.telegram.org");
  });

  it("uses explicit override", () => {
    expect(getTelegramApiBase("http://localhost:8081")).toBe("http://localhost:8081");
  });

  it("strips trailing slashes from override", () => {
    expect(getTelegramApiBase("http://localhost:8081///")).toBe("http://localhost:8081");
  });

  it("trims whitespace from override", () => {
    expect(getTelegramApiBase("  http://localhost:8081  ")).toBe("http://localhost:8081");
  });

  it("falls back to TELEGRAM_API_ROOT env var", () => {
    process.env.TELEGRAM_API_ROOT = "http://my-server:8081";
    expect(getTelegramApiBase()).toBe("http://my-server:8081");
  });

  it("strips trailing slashes from env var", () => {
    process.env.TELEGRAM_API_ROOT = "http://my-server:8081/";
    expect(getTelegramApiBase()).toBe("http://my-server:8081");
  });

  it("explicit override takes priority over env var", () => {
    process.env.TELEGRAM_API_ROOT = "http://env-server:8081";
    expect(getTelegramApiBase("http://override-server:9090")).toBe("http://override-server:9090");
  });

  it("ignores empty env var and returns default", () => {
    process.env.TELEGRAM_API_ROOT = "   ";
    expect(getTelegramApiBase()).toBe("https://api.telegram.org");
  });
});

describe("isCustomTelegramApi", () => {
  it("returns false for default API base", () => {
    expect(isCustomTelegramApi("https://api.telegram.org")).toBe(false);
  });

  it("returns false for default with trailing slash", () => {
    expect(isCustomTelegramApi("https://api.telegram.org/")).toBe(false);
  });

  it("returns true for localhost", () => {
    expect(isCustomTelegramApi("http://localhost:8081")).toBe(true);
  });

  it("returns true for custom domain", () => {
    expect(isCustomTelegramApi("https://tg-api.example.com")).toBe(true);
  });
});

describe("isLocalBotApiFilePath", () => {
  it("returns true for absolute path", () => {
    expect(isLocalBotApiFilePath("/tmp/telegram-bot-api/file_0.oga")).toBe(true);
  });

  it("returns false for relative path", () => {
    expect(isLocalBotApiFilePath("voice/file_0.oga")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLocalBotApiFilePath("")).toBe(false);
  });
});

describe("validateLocalFilePath", () => {
  let baseDir: string;

  beforeEach(async () => {
    // Resolve to canonical path so Windows 8.3 short names don't mismatch realpath results.
    baseDir = await realpath(await mkdtemp(nodePath.join(tmpdir(), "tg-api-test-")));
    await mkdir(nodePath.join(baseDir, "subdir"), { recursive: true });
  });

  it("accepts a file inside the allowed directory", async () => {
    const filePath = nodePath.join(baseDir, "subdir", "voice.oga");
    await writeFile(filePath, "audio-data");

    const result = await validateLocalFilePath(filePath, baseDir);
    expect(result).toBe(filePath);
  });

  it("rejects a path that escapes the allowed directory via ..", async () => {
    // Create a real file outside the allowed dir so realpath resolves.
    const outsideFile = nodePath.join(tmpdir(), "secret.txt");
    await writeFile(outsideFile, "secret");

    const traversal = nodePath.join(baseDir, "subdir", "..", "..", nodePath.basename(outsideFile));

    await expect(validateLocalFilePath(traversal, baseDir)).rejects.toThrow(
      "escapes allowed directory",
    );
  });

  it("rejects a symlink that points outside the allowed directory", async () => {
    const outsideFile = nodePath.join(tmpdir(), "secret-target.txt");
    await writeFile(outsideFile, "secret");

    const link = nodePath.join(baseDir, "sneaky-link.txt");
    await symlink(outsideFile, link);

    await expect(validateLocalFilePath(link, baseDir)).rejects.toThrow("escapes allowed directory");
  });

  it("rejects a path to a non-existent file (realpath fails)", async () => {
    const missing = nodePath.join(baseDir, "does-not-exist.oga");
    await expect(validateLocalFilePath(missing, baseDir)).rejects.toThrow();
  });

  it("throws when localApiDataDir is not configured", async () => {
    const filePath = nodePath.join(baseDir, "subdir", "voice.oga");
    await writeFile(filePath, "audio-data");

    await expect(validateLocalFilePath(filePath)).rejects.toThrow(
      "localApiDataDir must be configured",
    );
    await expect(validateLocalFilePath(filePath, "")).rejects.toThrow(
      "localApiDataDir must be configured",
    );
    await expect(validateLocalFilePath(filePath, "   ")).rejects.toThrow(
      "localApiDataDir must be configured",
    );
  });
});
