import type { OpenClawConfig } from "../config/config.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import {
  buildBootstrapContextFiles,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
} from "./pi-embedded-helpers.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

const DEFAULT_BOOTSTRAP_RETRIEVAL_THRESHOLD_CHARS = 12_000;
const DEFAULT_BOOTSTRAP_RETRIEVAL_TOP_FILES = 4;
const DEFAULT_BOOTSTRAP_RETRIEVAL_CHUNKS_PER_FILE = 2;
const DEFAULT_BOOTSTRAP_RETRIEVAL_MAX_CHUNK_CHARS = 1_200;
const DEFAULT_BOOTSTRAP_RETRIEVAL_MAX_TOTAL_CHARS = 8_000;

const DEFAULT_BOOTSTRAP_RETRIEVAL_REQUIRED_FILES = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
]);

const KEYWORD_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "you",
]);

type BootstrapRetrievalMode = "off" | "auto" | "on";

type BootstrapRetrievalSettings = {
  mode: BootstrapRetrievalMode;
  thresholdChars: number;
  topFiles: number;
  chunksPerFile: number;
  maxChunkChars: number;
  maxTotalChars: number;
};

type BootstrapChunk = {
  text: string;
  score: number;
};

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

function resolveBootstrapRetrievalSettings(cfg?: OpenClawConfig): BootstrapRetrievalSettings {
  const raw = cfg?.agents?.defaults?.bootstrapRetrieval;
  const modeRaw = typeof raw?.mode === "string" ? raw.mode.trim().toLowerCase() : "";
  const mode: BootstrapRetrievalMode =
    modeRaw === "off" || modeRaw === "on" || modeRaw === "auto" ? modeRaw : "auto";
  const positiveInt = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

  return {
    mode,
    thresholdChars: positiveInt(
      raw?.thresholdChars,
      DEFAULT_BOOTSTRAP_RETRIEVAL_THRESHOLD_CHARS,
    ),
    topFiles: positiveInt(raw?.topFiles, DEFAULT_BOOTSTRAP_RETRIEVAL_TOP_FILES),
    chunksPerFile: positiveInt(raw?.chunksPerFile, DEFAULT_BOOTSTRAP_RETRIEVAL_CHUNKS_PER_FILE),
    maxChunkChars: positiveInt(raw?.maxChunkChars, DEFAULT_BOOTSTRAP_RETRIEVAL_MAX_CHUNK_CHARS),
    maxTotalChars: positiveInt(raw?.maxTotalChars, DEFAULT_BOOTSTRAP_RETRIEVAL_MAX_TOTAL_CHARS),
  };
}

function extractPromptKeywords(prompt: string): string[] {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

function countKeywordHits(text: string, keywords: string[]): number {
  if (keywords.length === 0) {
    return 0;
  }
  const lower = text.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) {
      continue;
    }
    let index = lower.indexOf(keyword);
    let hits = 0;
    while (index !== -1) {
      hits += 1;
      if (hits >= 4) {
        break;
      }
      index = lower.indexOf(keyword, index + keyword.length);
    }
    score += hits;
  }
  return score;
}

function chunkFileContent(content: string, maxChunkChars: number): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return [trimmed.slice(0, maxChunkChars)];
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    const next = `${current}\n\n${paragraph}`;
    if (next.length <= maxChunkChars) {
      current = next;
      continue;
    }
    chunks.push(current.slice(0, maxChunkChars));
    current = paragraph;
  }
  if (current) {
    chunks.push(current.slice(0, maxChunkChars));
  }
  return chunks;
}

function scoreFileChunks(params: {
  file: WorkspaceBootstrapFile;
  keywords: string[];
  chunksPerFile: number;
  maxChunkChars: number;
}): BootstrapChunk[] {
  const content = params.file.content ?? "";
  if (!content.trim()) {
    return [];
  }

  const chunks = chunkFileContent(content, params.maxChunkChars);
  const baseName = params.file.name.toLowerCase();
  const scored = chunks
    .map((chunk) => {
      const score = countKeywordHits(chunk, params.keywords);
      const fileNameBoost = countKeywordHits(baseName, params.keywords) > 0 ? 2 : 0;
      return { text: chunk, score: score + fileNameBoost };
    })
    .toSorted((a, b) => b.score - a.score);
  return scored.slice(0, params.chunksPerFile);
}

function pickBootstrapRetrievalContext(params: {
  bootstrapFiles: WorkspaceBootstrapFile[];
  retrievalPrompt: string;
  settings: BootstrapRetrievalSettings;
  warn?: (message: string) => void;
}): EmbeddedContextFile[] {
  const keywords = extractPromptKeywords(params.retrievalPrompt);
  const existingFiles = params.bootstrapFiles.filter((file) => !file.missing);
  if (existingFiles.length === 0) {
    return buildBootstrapContextFiles(params.bootstrapFiles, {
      maxChars: params.settings.maxChunkChars,
      totalMaxChars: params.settings.maxTotalChars,
      warn: params.warn,
    });
  }

  const scoredByFile = existingFiles.map((file) => {
    const chunks = scoreFileChunks({
      file,
      keywords,
      chunksPerFile: params.settings.chunksPerFile,
      maxChunkChars: params.settings.maxChunkChars,
    });
    const bestScore = chunks[0]?.score ?? 0;
    return { file, chunks, bestScore };
  });

  const required = scoredByFile.filter((entry) =>
    DEFAULT_BOOTSTRAP_RETRIEVAL_REQUIRED_FILES.has(entry.file.name),
  );
  const ranked = scoredByFile
    .filter((entry) => !DEFAULT_BOOTSTRAP_RETRIEVAL_REQUIRED_FILES.has(entry.file.name))
    .toSorted((a, b) => b.bestScore - a.bestScore);

  const selected: Array<(typeof scoredByFile)[number]> = [];
  for (const entry of required) {
    if (selected.length >= params.settings.topFiles) {
      break;
    }
    selected.push(entry);
  }
  for (const entry of ranked) {
    if (selected.length >= params.settings.topFiles) {
      break;
    }
    selected.push(entry);
  }

  let totalChars = 0;
  const contextFiles: EmbeddedContextFile[] = [];
  for (const entry of selected) {
    const candidateChunks = entry.chunks.length > 0 ? entry.chunks : [{ text: "", score: 0 }];
    for (let index = 0; index < candidateChunks.length; index += 1) {
      const chunk = candidateChunks[index];
      if (!chunk.text.trim()) {
        continue;
      }
      const nextChars = totalChars + chunk.text.length;
      if (nextChars > params.settings.maxTotalChars) {
        continue;
      }
      totalChars = nextChars;
      const suffix = candidateChunks.length > 1 ? `#excerpt-${index + 1}` : "";
      contextFiles.push({
        path: `${entry.file.path}${suffix}`,
        content: chunk.text,
      });
    }
  }

  if (contextFiles.length === 0) {
    return buildBootstrapContextFiles(params.bootstrapFiles, {
      maxChars: params.settings.maxChunkChars,
      totalMaxChars: params.settings.maxTotalChars,
      warn: params.warn,
    });
  }

  params.warn?.(
    `bootstrap retrieval selected ${contextFiles.length} excerpt(s) from ${selected.length} file(s) (maxTotal=${params.settings.maxTotalChars})`,
  );
  return contextFiles;
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );

  return applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  retrievalPrompt?: string;
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const maxChars = resolveBootstrapMaxChars(params.config);
  const totalMaxChars = resolveBootstrapTotalMaxChars(params.config);
  const retrieval = resolveBootstrapRetrievalSettings(params.config);
  const prompt = params.retrievalPrompt?.trim() ?? "";
  const totalRawChars = bootstrapFiles.reduce(
    (sum, file) => sum + (file.missing ? 0 : (file.content?.trimEnd().length ?? 0)),
    0,
  );
  const shouldUseRetrieval =
    retrieval.mode === "on" ||
    (retrieval.mode === "auto" && Boolean(prompt) && totalRawChars > retrieval.thresholdChars);

  const contextFiles = shouldUseRetrieval
    ? pickBootstrapRetrievalContext({
        bootstrapFiles,
        retrievalPrompt: prompt,
        settings: {
          ...retrieval,
          maxTotalChars: Math.min(retrieval.maxTotalChars, totalMaxChars),
          maxChunkChars: Math.min(retrieval.maxChunkChars, maxChars),
        },
        warn: params.warn,
      })
    : buildBootstrapContextFiles(bootstrapFiles, {
        maxChars,
        totalMaxChars,
        warn: params.warn,
      });
  return { bootstrapFiles, contextFiles };
}
