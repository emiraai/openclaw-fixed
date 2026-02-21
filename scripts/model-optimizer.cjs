#!/usr/bin/env node
/**
 * model-optimizer.cjs - OpenClaw Model Auto-Optimizer (Core Engine)
 *
 * Benchmarks all configured + discovered free models using a 3-test suite,
 * scores them on composite criteria (latency 40%, throughput 25%,
 * correctness 20%, availability 15%), and auto-rotates the primary model
 * when a significantly better option is found.
 *
 * Architecture: parallel benchmarks with semaphore, 3 tests per model
 * (math, instruction, availability), atomic config writes with timestamped
 * backups, append-only JSONL history, and gateway hot-reload via SIGUSR1.
 *
 * Usage:
 *   node model-optimizer.cjs [options]
 *
 * Options:
 *   --auto           Run benchmark and auto-rotate if improvement found
 *   --dry-run        Benchmark only, do not update config
 *   --discover       Include provider discovery (check env for new providers)
 *   --timeout <ms>   Per-request timeout (default: 30000)
 *   --concurrency <n> Max concurrent model tests (default: 10)
 *   --threshold <n>  Rotation threshold percentage (default: 10)
 *   --json           Output results as JSON only (for scripting)
 *   --verbose        Detailed per-test output
 *   --providers X    Comma-separated provider filter (e.g. nvidia,groq)
 *   --weights JSON   Custom scoring weights JSON string
 *   --config <path>  Config file path (env: OPENCLAW_CONFIG_PATH)
 *   --help           Show usage
 */
"use strict";

var https = require("https");
var http = require("http");
var fs = require("fs");
var path = require("path");

var scoring = require("./scoring.cjs");
var registry = require("./provider-registry.cjs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
var CONFIG_PATH = DEFAULT_CONFIG_PATH; // may be overridden by --config or env

if (process.env.OPENCLAW_CONFIG_PATH) {
  CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH;
}
var RESULTS_LATEST = "/tmp/model-optimizer-latest.json";
var RESULTS_HISTORY = "/tmp/model-optimizer-history.jsonl";
var VERSION = "1.0.0";

var DEFAULT_TIMEOUT = 30000;
var DEFAULT_CONCURRENCY = 10;
var DEFAULT_THRESHOLD = 10;
var MAX_FALLBACKS = 6;
var MIN_FALLBACKS = 3;
var RETRY_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Test Suite (3 prompts per model, per architecture spec)
// ---------------------------------------------------------------------------

var TEST_SUITE = [
  {
    name: "math",
    prompt: "What is 2+2? Reply with only the number.",
    maxTokens: 64,
    temperature: 0,
  },
  {
    name: "instruction",
    prompt: "List exactly 3 colors, one per line.",
    maxTokens: 128,
    temperature: 0,
  },
  {
    name: "availability",
    prompt: "Say hello.",
    maxTokens: 64,
    temperature: 0,
  },
];

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  var args = process.argv.slice(2);
  var opts = {
    auto: false,
    dryRun: false,
    discover: false,
    timeout: DEFAULT_TIMEOUT,
    concurrency: DEFAULT_CONCURRENCY,
    threshold: DEFAULT_THRESHOLD,
    json: false,
    verbose: false,
    providers: null,
    weights: null,
    help: false,
  };

  for (var i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--auto": opts.auto = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--discover": opts.discover = true; break;
      case "--json": opts.json = true; break;
      case "--verbose": opts.verbose = true; break;
      case "--help": case "-h": opts.help = true; break;
      case "--timeout": opts.timeout = parseInt(args[++i], 10) || DEFAULT_TIMEOUT; break;
      case "--concurrency": opts.concurrency = parseInt(args[++i], 10) || DEFAULT_CONCURRENCY; break;
      case "--threshold": opts.threshold = parseInt(args[++i], 10) || DEFAULT_THRESHOLD; break;
      case "--providers": opts.providers = (args[++i] || "").split(",").filter(Boolean); break;
      case "--weights":
        try { opts.weights = JSON.parse(args[++i]); } catch (e) {
          console.error("Invalid --weights JSON: " + e.message);
          process.exit(1);
        }
        break;
      case "--config":
        CONFIG_PATH = args[++i];
        break;
    }
  }

  return opts;
}

function showHelp() {
  console.log("model-optimizer.cjs - OpenClaw Model Auto-Optimizer v" + VERSION);
  console.log("");
  console.log("Usage: node model-optimizer.cjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --auto           Run benchmark and auto-rotate if improvement found");
  console.log("  --dry-run        Benchmark only, do not update config");
  console.log("  --discover       Include provider discovery (check env for new providers)");
  console.log("  --timeout <ms>   Per-request timeout (default: " + DEFAULT_TIMEOUT + ")");
  console.log("  --concurrency <n> Max concurrent model tests (default: " + DEFAULT_CONCURRENCY + ")");
  console.log("  --threshold <n>  Rotation threshold percentage (default: " + DEFAULT_THRESHOLD + ")");
  console.log("  --json           Output results as JSON only");
  console.log("  --verbose        Detailed per-test output");
  console.log("  --providers X    Comma-separated provider filter");
  console.log("  --weights JSON   Custom scoring weights JSON");
  console.log("  --config <path>  Config file path (default: " + DEFAULT_CONFIG_PATH + ")");
  console.log("                   Also settable via OPENCLAW_CONFIG_PATH env var");
  console.log("  --help           Show this help");
}

// ---------------------------------------------------------------------------
// HTTP Request Layer
// ---------------------------------------------------------------------------

function httpRequest(url, body, apiKey, timeoutMs) {
  return new Promise(function(resolve) {
    var u = new URL(url);
    var mod = u.protocol === "https:" ? https : http;
    var headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
    var data = JSON.stringify(body);
    headers["Content-Length"] = Buffer.byteLength(data);

    var start = performance.now();
    var ttft = null;
    var fullBody = "";
    var timedOut = false;

    var timer = setTimeout(function() {
      timedOut = true;
      req.destroy();
      resolve({ error: "TIMEOUT", latencyMs: timeoutMs, ttftMs: null, body: "", statusCode: 0 });
    }, timeoutMs);

    var req = mod.request(u, { method: "POST", headers: headers }, function(res) {
      res.on("data", function(chunk) {
        if (ttft === null) ttft = performance.now() - start;
        fullBody += chunk;
      });
      res.on("end", function() {
        if (timedOut) return;
        clearTimeout(timer);
        var latencyMs = performance.now() - start;
        if (res.statusCode >= 400) {
          resolve({ error: "HTTP " + res.statusCode, latencyMs: latencyMs, ttftMs: ttft, body: fullBody.slice(0, 500), statusCode: res.statusCode });
        } else {
          resolve({ error: null, latencyMs: latencyMs, ttftMs: ttft, body: fullBody, statusCode: res.statusCode });
        }
      });
    });

    req.on("error", function(e) {
      if (timedOut) return;
      clearTimeout(timer);
      var errMsg = e.message || String(e);
      if (errMsg.indexOf("ENOTFOUND") >= 0) errMsg = "DNS_FAIL";
      else if (errMsg.indexOf("ECONNREFUSED") >= 0) errMsg = "CONN_REFUSED";
      resolve({ error: errMsg, latencyMs: performance.now() - start, ttftMs: null, body: "", statusCode: 0 });
    });

    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Response Parsing (OpenAI, Anthropic, Responses API)
// ---------------------------------------------------------------------------

function extractResponse(body) {
  try {
    var d = JSON.parse(body);
    if (d.choices && d.choices[0]) {
      var c = d.choices[0];
      var text = (c.message && c.message.content) || c.text || (c.delta && c.delta.content) || "";
      var usage = d.usage || {};
      return {
        text: text.trim().slice(0, 500),
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    }
    if (d.content && d.content[0]) {
      return {
        text: (d.content[0].text || "").trim().slice(0, 500),
        promptTokens: (d.usage && d.usage.input_tokens) || 0,
        completionTokens: (d.usage && d.usage.output_tokens) || 0,
        totalTokens: ((d.usage && d.usage.input_tokens) || 0) + ((d.usage && d.usage.output_tokens) || 0),
      };
    }
    if (d.output && Array.isArray(d.output)) {
      var msg = d.output.find(function(o) { return o.type === "message"; });
      if (msg && msg.content) {
        var t = msg.content.map(function(cc) { return cc.text || ""; }).join("");
        return { text: t.trim().slice(0, 500), promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }
    }
    return { text: JSON.stringify(d).slice(0, 200), promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  } catch (_e) {
    return { text: (body || "").slice(0, 200), promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

// ---------------------------------------------------------------------------
// Single Test Execution (with 429 retry)
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function runSingleTest(model, test, timeoutMs) {
  var url = model.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  var body = {
    model: model.id,
    messages: [{ role: "user", content: test.prompt }],
    max_tokens: test.maxTokens || 64,
    temperature: test.temperature != null ? test.temperature : 0,
    stream: false,
  };

  var res = await httpRequest(url, body, model.apiKey, timeoutMs);

  // Retry once on HTTP 429 (rate limited)
  if (res.statusCode === 429) {
    await sleep(RETRY_DELAY_MS);
    res = await httpRequest(url, body, model.apiKey, timeoutMs);
  }

  if (res.error) {
    return {
      name: test.name,
      status: res.error === "TIMEOUT" ? "timeout" : "error",
      latencyMs: Math.round(res.latencyMs),
      ttftMs: res.ttftMs != null ? Math.round(res.ttftMs) : null,
      response: "",
      completionTokens: 0,
      httpStatus: res.statusCode || 0,
      error: res.error,
    };
  }

  var parsed = extractResponse(res.body);
  return {
    name: test.name,
    status: "ok",
    latencyMs: Math.round(res.latencyMs),
    ttftMs: res.ttftMs != null ? Math.round(res.ttftMs) : Math.round(res.latencyMs),
    response: parsed.text,
    completionTokens: parsed.completionTokens,
    httpStatus: res.statusCode,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Model Benchmark (run all 3 tests in parallel for one model)
// ---------------------------------------------------------------------------

async function benchmarkModel(model, timeoutMs) {
  var testPromises = TEST_SUITE.map(function(test) {
    return runSingleTest(model, test, timeoutMs);
  });

  var tests = await Promise.all(testPromises);

  return {
    provider: model.provider,
    modelId: model.provider + "/" + model.id,
    modelName: model.name,
    free: model.free !== false,
    tests: tests,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Parallel Benchmark with Semaphore (across models)
// ---------------------------------------------------------------------------

async function benchmarkAll(models, timeoutMs, maxConcurrent, quiet) {
  var results = [];
  var idx = 0;
  var total = models.length;

  async function worker() {
    while (idx < total) {
      var i = idx++;
      var model = models[i];
      if (!quiet) {
        process.stdout.write("\r  Benchmarking [" + (i + 1) + "/" + total + "] " + model.provider + "/" + model.id + "...          ");
      }
      results[i] = await benchmarkModel(model, timeoutMs);
    }
  }

  var workerCount = Math.min(maxConcurrent, total);
  var workers = [];
  for (var w = 0; w < workerCount; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (!quiet) {
    process.stdout.write("\r" + " ".repeat(80) + "\r");
  }

  return results;
}

// ---------------------------------------------------------------------------
// Config Management
// ---------------------------------------------------------------------------

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function createBackup() {
  var now = new Date();
  var ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") + "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  var backupPath = CONFIG_PATH + ".backup-" + ts;
  fs.copyFileSync(CONFIG_PATH, backupPath);
  return backupPath;
}

function atomicWriteConfig(cfg) {
  var tmpPath = CONFIG_PATH + ".tmp";
  var data = JSON.stringify(cfg, null, 2);
  JSON.parse(data); // validate JSON before writing
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, CONFIG_PATH);
}

function reloadGateway(quiet) {
  try {
    // Only signal PID 1 if we're in Docker (check /proc/1/cmdline)
    var isDocker = false;
    try {
      var cmdline = fs.readFileSync("/proc/1/cmdline", "utf8");
      isDocker = cmdline.indexOf("node") >= 0 || cmdline.indexOf("openclaw") >= 0;
    } catch (_) {
      // /proc not available (Windows, macOS) — not in Docker
    }
    if (!isDocker) {
      if (!quiet) console.log("  Skipping gateway reload (not running in Docker container).");
      return;
    }
    process.kill(1, "SIGUSR1");
    if (!quiet) console.log("  Gateway reload signal sent (SIGUSR1).");
  } catch (e) {
    if (!quiet) console.log("  Warning: Could not send SIGUSR1 to PID 1: " + e.message);
  }
}

// ---------------------------------------------------------------------------
// Fallback Selection
// ---------------------------------------------------------------------------

function buildFallbacks(rankedModels, primaryModelId) {
  var candidates = rankedModels.filter(function(m) {
    return m.composite > 0 && m.modelId !== primaryModelId;
  });

  // Stable sort: by score descending, then free first
  candidates.sort(function(a, b) {
    if (b.composite !== a.composite) return b.composite - a.composite;
    if (a.free && !b.free) return -1;
    if (!a.free && b.free) return 1;
    return 0;
  });

  return candidates.slice(0, MAX_FALLBACKS).map(function(m) { return m.modelId; });
}

// ---------------------------------------------------------------------------
// Human-Readable Output
// ---------------------------------------------------------------------------

function formatTable(rankedModels, failures, opts) {
  console.log("");
  console.log("  #  Score  Provider       Model                         Latency  TTFT     Tok/s  Tests  Free");
  console.log("  -- -----  -------------- ----------------------------- -------- -------- ------ ------ ----");

  for (var i = 0; i < rankedModels.length; i++) {
    var r = rankedModels[i];
    var testsPassed = r.successCount + "/" + r.totalTests;
    var freeStr = r.free ? "YES" : "NO";
    var latStr = r.avgLatencyMs != null ? r.avgLatencyMs + "ms" : "?";
    var ttftStr = r.avgTtftMs != null ? r.avgTtftMs + "ms" : "?";
    var tpsStr = r.tokPerSec != null ? String(r.tokPerSec) : "?";

    console.log(
      "  " + String(r.rank).padStart(2) +
      "  " + String(r.composite).padStart(5) +
      "  " + r.provider.padEnd(14) +
      " " + (r.modelName || r.modelId).slice(0, 29).padEnd(29) +
      " " + latStr.padEnd(8) +
      " " + ttftStr.padEnd(8) +
      " " + tpsStr.padEnd(6) +
      " " + testsPassed.padEnd(6) +
      " " + freeStr
    );
  }

  if (opts.verbose) {
    for (var j = 0; j < rankedModels.length; j++) {
      var m = rankedModels[j];
      console.log("\n  " + m.modelId + ":");
      console.log("    Latency:      " + m.latencyScore + "/100 (avg TTFT: " + (m.avgTtftMs || "?") + "ms)");
      console.log("    Throughput:   " + m.throughputScore + "/100 (" + (m.tokPerSec || "?") + " tok/s)");
      console.log("    Correctness:  " + m.correctnessScore + "/100 (" + JSON.stringify(m.tests) + ")");
      console.log("    Availability: " + m.availabilityScore + "/100 (" + m.successCount + "/" + m.totalTests + ")");
      console.log("    COMPOSITE:    " + m.composite + "/100");
    }
  }

  if (failures.length > 0) {
    console.log("\n  FAILED MODELS (" + failures.length + "):");
    for (var k = 0; k < failures.length; k++) {
      var f = failures[k];
      console.log("    x " + f.modelId + " (score: " + f.composite + ")");
    }
  }
}

// ---------------------------------------------------------------------------
// JSON Result Builder
// ---------------------------------------------------------------------------

function buildResultJSON(ranked, failures, rawResults, rotated, reason, backupPath, currentPrimary, newPrimary, fallbacks, elapsed) {
  return {
    timestamp: new Date().toISOString(),
    version: VERSION,
    elapsedMs: elapsed,
    totalModels: rawResults.length,
    testedModels: rawResults.length,
    workingModels: ranked.length,
    failedModels: failures.length,
    primary: {
      provider: ranked.length > 0 ? ranked[0].provider : null,
      modelId: newPrimary,
      score: ranked.length > 0 ? ranked[0].composite : 0,
      latencyMs: ranked.length > 0 ? ranked[0].avgLatencyMs : null,
      tokPerSec: ranked.length > 0 ? ranked[0].tokPerSec : null,
    },
    fallbacks: fallbacks,
    rotated: rotated,
    rotationReason: reason,
    configBackup: backupPath || null,
    rankings: ranked.map(function(r) {
      return {
        rank: r.rank,
        provider: r.provider,
        modelId: r.modelId,
        modelName: r.modelName,
        free: r.free,
        composite: r.composite,
        latencyScore: r.latencyScore,
        throughputScore: r.throughputScore,
        correctnessScore: r.correctnessScore,
        availabilityScore: r.availabilityScore,
        avgLatencyMs: r.avgLatencyMs,
        avgTtftMs: r.avgTtftMs,
        tokPerSec: r.tokPerSec,
        tests: r.tests,
      };
    }),
    failures: failures.map(function(f) {
      return {
        provider: f.provider,
        modelId: f.modelId,
        error: "All tests failed or scored 0",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  var opts = parseArgs();

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  // Load config
  var cfg = loadConfig();
  var currentPrimaryId = "";
  if (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model) {
    currentPrimaryId = cfg.agents.defaults.model.primary || "";
  }

  // Build testable model list
  var envKeys = null;
  if (opts.discover) {
    envKeys = {};
    var known = registry.getKnownProviders();
    for (var p = 0; p < known.length; p++) {
      var envKey = process.env[known[p].envVar];
      if (envKey) envKeys[known[p].name] = envKey;
    }
  }

  var models = registry.getTestableModels(cfg, envKeys);

  // Filter by provider
  if (opts.providers) {
    models = models.filter(function(m) { return opts.providers.indexOf(m.provider) >= 0; });
  }

  // Filter out models without API keys
  models = models.filter(function(m) { return m.apiKey; });

  if (models.length === 0) {
    if (!opts.json) console.error("No models available to benchmark. Check config or set provider API keys.");
    process.exit(1);
  }

  if (!opts.json) {
    console.log("\n=== OpenClaw Model Auto-Optimizer v" + VERSION + " ===");
    console.log("  Models: " + models.length + " | Timeout: " + opts.timeout + "ms | Concurrency: " + opts.concurrency);
    console.log("  Current primary: " + (currentPrimaryId || "(none)"));
    console.log("  Tests per model: " + TEST_SUITE.length + " (" + TEST_SUITE.map(function(t) { return t.name; }).join(", ") + ")");
    console.log("");
  }

  // Run benchmarks (parallel with semaphore)
  var startTime = Date.now();
  var rawResults = await benchmarkAll(models, opts.timeout, opts.concurrency, opts.json);
  var elapsed = Date.now() - startTime;

  // Score all results using the multi-test scoring engine
  var scoredResults = rawResults.map(function(raw) {
    return scoring.scoreModel(raw, opts.weights);
  });

  // Rank working models and separate failures
  var ranked = scoring.rankModels(scoredResults.filter(function(r) { return r.composite > 0; }));
  var failures = scoredResults.filter(function(r) { return r.composite <= 0; });

  // Display results
  if (!opts.json) {
    console.log("  Benchmarked " + models.length + " models in " + (elapsed / 1000).toFixed(1) + "s");
    console.log("  Working: " + ranked.length + " | Failed: " + failures.length);
    formatTable(ranked, failures, opts);
  }

  // Rotation decision
  var newPrimaryId = currentPrimaryId;
  var fallbackIds = [];
  if (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model) {
    fallbackIds = cfg.agents.defaults.model.fallbacks || [];
  }
  var rotated = false;
  var rotationReason = "No rotation needed";
  var backupPath = null;

  if (ranked.length > 0) {
    var newBest = ranked[0];
    var currentScored = ranked.find(function(r) { return r.modelId === currentPrimaryId; }) || null;
    var decision = scoring.shouldRotate(currentScored, newBest, opts.threshold);

    if (!opts.json) {
      console.log("\n  ROTATION DECISION:");
      console.log("    Best model:    " + newBest.modelId + " (score: " + newBest.composite + ")");
      console.log("    Current model: " + (currentPrimaryId || "(none)") + " (score: " + (currentScored ? currentScored.composite : 0) + ")");
      console.log("    Decision:      " + (decision.rotate ? "ROTATE" : "KEEP") + " - " + decision.reason);
    }

    var newFallbacks = buildFallbacks(ranked, decision.rotate ? newBest.modelId : currentPrimaryId);

    if (decision.rotate && !opts.dryRun && opts.auto) {
      // Create backup FIRST (safety invariant)
      try {
        backupPath = createBackup();
      } catch (e) {
        if (!opts.json) console.error("  CRITICAL: Backup failed (" + e.message + "). Aborting rotation.");
        rotationReason = "Backup failed: " + e.message;
        var abortResult = buildResultJSON(ranked, failures, rawResults, false, rotationReason, null, currentPrimaryId, currentPrimaryId, fallbackIds, elapsed);
        try { fs.writeFileSync(RESULTS_LATEST, JSON.stringify(abortResult, null, 2)); } catch (_e) {}
        if (opts.json) console.log(JSON.stringify(abortResult, null, 2));
        process.exit(1);
      }

      // Update config
      newPrimaryId = newBest.modelId;
      fallbackIds = newFallbacks;
      rotated = true;
      rotationReason = decision.reason;

      if (!cfg.agents) cfg.agents = {};
      if (!cfg.agents.defaults) cfg.agents.defaults = {};
      cfg.agents.defaults.model = {
        primary: newPrimaryId,
        fallbacks: fallbackIds,
      };

      try {
        atomicWriteConfig(cfg);
        if (!opts.json) {
          console.log("\n  CONFIG UPDATED:");
          console.log("    Backup: " + backupPath);
          console.log("    Primary: " + newPrimaryId);
          console.log("    Fallbacks: " + fallbackIds.join(", "));
        }
        reloadGateway(opts.json);
      } catch (e) {
        if (!opts.json) console.error("  ERROR writing config: " + e.message);
        rotated = false;
        rotationReason = "Config write failed: " + e.message;
      }
    } else if (decision.rotate && opts.dryRun) {
      rotationReason = "DRY RUN - would rotate: " + decision.reason;
      newPrimaryId = newBest.modelId;
      fallbackIds = newFallbacks;
      if (!opts.json) {
        console.log("\n  DRY RUN - would update to:");
        console.log("    Primary: " + newBest.modelId);
        console.log("    Fallbacks: " + newFallbacks.join(", "));
      }
    } else {
      rotationReason = decision.reason;
      // Still update fallback order if changed (non-disruptive reorder)
      if (!opts.dryRun && newFallbacks.length >= MIN_FALLBACKS) {
        var currentFallbacks = [];
        if (cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model) {
          currentFallbacks = cfg.agents.defaults.model.fallbacks || [];
        }
        var fallbacksChanged = JSON.stringify(newFallbacks) !== JSON.stringify(currentFallbacks);
        if (fallbacksChanged) {
          fallbackIds = newFallbacks;
          if (!cfg.agents) cfg.agents = {};
          if (!cfg.agents.defaults) cfg.agents.defaults = {};
          if (!cfg.agents.defaults.model) cfg.agents.defaults.model = {};
          cfg.agents.defaults.model.fallbacks = newFallbacks;
          try {
            backupPath = createBackup();
            atomicWriteConfig(cfg);
            if (!opts.json) console.log("\n  Fallback order updated (primary unchanged).");
          } catch (e) {
            if (!opts.json) console.log("  Warning: Could not update fallback order: " + e.message);
          }
        }
      }
    }
  } else {
    rotationReason = "No working models found. Config unchanged.";
    if (!opts.json) console.log("\n  WARNING: No working models found. Config unchanged.");
  }

  // Build and persist results
  var resultJSON = buildResultJSON(ranked, failures, rawResults, rotated, rotationReason, backupPath, currentPrimaryId, newPrimaryId, fallbackIds, elapsed);

  try { fs.writeFileSync(RESULTS_LATEST, JSON.stringify(resultJSON, null, 2)); } catch (_e) {}
  try { fs.appendFileSync(RESULTS_HISTORY, JSON.stringify(resultJSON) + "\n"); } catch (_e) {}

  if (opts.json) {
    console.log(JSON.stringify(resultJSON, null, 2));
  } else {
    console.log("\n  Results saved to " + RESULTS_LATEST);
    console.log("  History appended to " + RESULTS_HISTORY);
    console.log("");
  }
}

main().catch(function(e) {
  console.error("Model optimizer error: " + (e.message || e));
  process.exit(1);
});
