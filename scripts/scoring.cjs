#!/usr/bin/env node
/**
 * scoring.cjs - Quality scoring engine for model benchmarks.
 *
 * Converts raw benchmark results into composite scores (0-100)
 * using weighted criteria: latency (40%), throughput (25%),
 * correctness (20%), availability (15%).
 *
 * Supports both single-prompt scoring (legacy bench-models.cjs compat)
 * and multi-test scoring (model-optimizer 3-test suite).
 */
"use strict";

const DEFAULT_WEIGHTS = {
  latency: 0.40,
  throughput: 0.25,
  correctness: 0.20,
  availability: 0.15,
};

// ---------------------------------------------------------------------------
// Latency scoring (TTFT in ms, lower is better)
// ---------------------------------------------------------------------------

const LATENCY_BANDS = [
  { max: 500, score: 100 },
  { max: 1000, score: 90 },
  { max: 2000, score: 75 },
  { max: 5000, score: 50 },
  { max: 10000, score: 25 },
  { max: Infinity, score: 10 },
];

function lerp(value, lo, hi, loScore, hiScore) {
  if (hi <= lo) return loScore;
  const t = (value - lo) / (hi - lo);
  return loScore - t * (loScore - hiScore);
}

/**
 * Score latency (TTFT) on 0-100 scale with linear interpolation.
 * @param {number|null} ttftMs
 * @returns {number}
 */
function latencyScore(ttftMs) {
  if (ttftMs === null || ttftMs === undefined || !Number.isFinite(ttftMs) || ttftMs < 0) return 0;

  let prevMax = 0;
  let prevScore = 100;
  for (const band of LATENCY_BANDS) {
    if (ttftMs <= band.max) {
      const hi = band.max === Infinity ? 20000 : band.max;
      return Math.max(10, Math.round(lerp(ttftMs, prevMax, hi, prevScore, band.score) * 10) / 10);
    }
    prevMax = band.max;
    prevScore = band.score;
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Throughput scoring (tokens/sec, higher is better)
// ---------------------------------------------------------------------------

const THROUGHPUT_BANDS = [
  { min: 100, score: 100 },
  { min: 50, score: 90 },
  { min: 20, score: 75 },
  { min: 10, score: 50 },
  { min: 5, score: 25 },
  { min: 0, score: 10 },
];

const THROUGHPUT_UNKNOWN = 30;

/**
 * Score throughput (tok/s) on 0-100 scale with linear interpolation.
 * Returns 30 for unknown throughput (benefit of doubt).
 * @param {number|null} tokPerSec
 * @returns {number}
 */
function throughputScore(tokPerSec) {
  if (tokPerSec === null || tokPerSec === undefined) return THROUGHPUT_UNKNOWN;
  if (!Number.isFinite(tokPerSec) || tokPerSec <= 0) return 10;

  let prevMin = Infinity;
  let prevScore = 100;
  for (const band of THROUGHPUT_BANDS) {
    if (tokPerSec >= band.min) {
      if (prevMin === Infinity) return 100;
      return Math.round(lerp(tokPerSec, band.min, prevMin, band.score, prevScore) * 10) / 10;
    }
    prevMin = band.min;
    prevScore = band.score;
  }
  return 10;
}

// ---------------------------------------------------------------------------
// Correctness scoring (test validation)
// ---------------------------------------------------------------------------

/**
 * Validate math test: response should contain "4".
 * @param {string} response
 * @returns {boolean}
 */
function validateMath(response) {
  if (!response) return false;
  return /\b4\b/.test(response) || /\bfour\b/i.test(response);
}

/**
 * Validate instruction test: response should have ~3 lines each being a color.
 * @param {string} response
 * @returns {boolean}
 */
function validateInstruction(response) {
  if (!response) return false;
  const lines = response.trim().split(/\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length < 2 || lines.length > 8) return false;
  var colorRe = /^[\d.)\-*\s]*(red|blue|green|yellow|orange|purple|pink|white|black|brown|gray|grey|violet|indigo|cyan|magenta|teal|gold|silver|crimson|scarlet|navy|lime|olive|maroon|coral|turquoise|lavender|beige|tan|amber|aqua|ivory|salmon|ruby|emerald|sapphire|rose|sky|mint|peach|plum|cherry|copper|bronze|khaki|cream|charcoal|burgundy|fuchsia|periwinkle|mauve|taupe|rust)/i;
  var colorCount = lines.filter(function(l) { return colorRe.test(l); }).length;
  return colorCount >= 2;
}

/**
 * Validate availability test: any non-empty response is a pass.
 * @param {string} response
 * @returns {boolean}
 */
function validateAvailability(response) {
  return typeof response === "string" && response.trim().length > 0;
}

var TEST_VALIDATORS = {
  math: validateMath,
  instruction: validateInstruction,
  availability: validateAvailability,
};

/**
 * Score correctness from multi-test results.
 * @param {Array<{name: string, status: string, response: string}>} tests
 * @returns {{score: number, details: Object}}
 */
function correctnessScoreMulti(tests) {
  var passed = 0;
  var details = {};
  var total = 0;

  for (var i = 0; i < tests.length; i++) {
    var test = tests[i];
    var validator = TEST_VALIDATORS[test.name];
    if (!validator) continue;
    total++;
    if (test.status === "ok" || test.status === "OK") {
      var valid = validator(test.response || "");
      details[test.name] = valid ? "pass" : "fail";
      if (valid) passed++;
    } else {
      details[test.name] = "error";
    }
  }

  var score = total > 0 ? Math.round((passed / total) * 100) : 0;
  return { score: score, details: details };
}

/**
 * Score correctness from a single response (legacy compat for bench-models.cjs).
 * @param {string} response
 * @param {string} [expected="4"]
 * @returns {number} 0-100
 */
function correctnessScoreSingle(response, expected) {
  if (!response || typeof response !== "string") return 0;
  if (typeof expected !== "string") expected = "4";

  var clean = response.toLowerCase().trim().replace(/[.,!?;:'"]/g, "").trim();
  var exp = expected.toLowerCase().trim();

  if (clean === exp) return 100;
  if (exp === "4" && (clean === "four" || clean === "4")) return 100;
  if (/\b4\b/.test(clean) || /\bfour\b/.test(clean)) return 80;
  if (clean.includes(exp)) return 85;
  if (clean.length > 0) return 15;
  return 0;
}

/**
 * Unified correctness scorer.
 * Accepts either an array of tests (multi-test) or (response, expected) args (single-test).
 * @param {Array|string} testsOrResponse
 * @param {string} [expected]
 * @returns {{score: number, details: Object}|number}
 */
function correctnessScore(testsOrResponse, expected) {
  if (Array.isArray(testsOrResponse)) {
    return correctnessScoreMulti(testsOrResponse);
  }
  return correctnessScoreSingle(testsOrResponse, expected);
}

/**
 * Score availability based on test success count.
 * Accepts either (tests[]) or (successes, attempts).
 * @param {Array|number} testsOrSuccesses
 * @param {number} [attempts]
 * @returns {number} 0-100
 */
function availabilityScore(testsOrSuccesses, attempts) {
  if (Array.isArray(testsOrSuccesses)) {
    var tests = testsOrSuccesses;
    if (tests.length === 0) return 0;
    var succeeded = tests.filter(function(t) {
      return t.status === "ok" || t.status === "OK";
    }).length;
    return Math.round((succeeded / tests.length) * 100);
  }
  // Legacy (successes, attempts) signature
  var successes = testsOrSuccesses;
  if (!Number.isFinite(successes) || !Number.isFinite(attempts) || attempts <= 0) return 0;
  return Math.round((successes / attempts) * 100);
}

// ---------------------------------------------------------------------------
// Throughput estimation helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count from response text when provider doesn't report usage.
 * Rough heuristic: ~4 chars per token.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

/**
 * Calculate tok/s for a single test result.
 * @param {{completionTokens?: number, response?: string, latencyMs: number}} test
 * @returns {number|null}
 */
function calcThroughput(test) {
  if (!test || !test.latencyMs || test.latencyMs <= 0) return null;
  var tokens = test.completionTokens;
  if (!tokens || tokens <= 0) {
    tokens = estimateTokens(test.response);
    if (tokens <= 0) return null;
  }
  return tokens / (test.latencyMs / 1000);
}

// ---------------------------------------------------------------------------
// Composite scoring for the full model-optimizer pipeline
// ---------------------------------------------------------------------------

/**
 * Score a single model from its raw benchmark results (multi-test format).
 * @param {Object} rawResult - { provider, modelId, modelName, free, tests[], timestamp }
 * @param {Object} [weights] - custom weights
 * @returns {Object} scored result
 */
function scoreModel(rawResult, weights) {
  var w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});
  var tests = rawResult.tests || [];

  // Compute averages from successful tests
  var successfulTests = tests.filter(function(t) {
    return t.status === "ok" || t.status === "OK";
  });

  var avgTtft = null;
  var avgLatency = null;
  if (successfulTests.length > 0) {
    var ttfts = successfulTests.filter(function(t) { return t.ttftMs != null; }).map(function(t) { return t.ttftMs; });
    avgTtft = ttfts.length > 0 ? ttfts.reduce(function(a, b) { return a + b; }, 0) / ttfts.length : null;
    avgLatency = successfulTests.reduce(function(a, t) { return a + t.latencyMs; }, 0) / successfulTests.length;
  }

  // Throughput average
  var avgTokPerSec = null;
  if (successfulTests.length > 0) {
    var throughputs = successfulTests.map(calcThroughput).filter(function(t) { return t !== null; });
    if (throughputs.length > 0) {
      avgTokPerSec = throughputs.reduce(function(a, b) { return a + b; }, 0) / throughputs.length;
    }
  }

  var latScore = latencyScore(avgTtft);
  var tpScore = throughputScore(avgTokPerSec);
  var corr = correctnessScoreMulti(tests);
  var availScore = availabilityScore(tests);

  var composite = Math.round(
    (latScore * w.latency + tpScore * w.throughput + corr.score * w.correctness + availScore * w.availability) * 10
  ) / 10;

  return {
    provider: rawResult.provider,
    modelId: rawResult.modelId,
    modelName: rawResult.modelName,
    free: rawResult.free !== false,
    composite: composite,
    latencyScore: latScore,
    throughputScore: tpScore,
    correctnessScore: corr.score,
    availabilityScore: availScore,
    avgLatencyMs: avgLatency !== null ? Math.round(avgLatency) : null,
    avgTtftMs: avgTtft !== null ? Math.round(avgTtft) : null,
    tokPerSec: avgTokPerSec !== null ? Math.round(avgTokPerSec * 10) / 10 : null,
    tests: corr.details,
    successCount: successfulTests.length,
    totalTests: tests.length,
  };
}

/**
 * Rank scored results by composite score (highest first).
 * @param {Array<Object>} scoredResults
 * @returns {Array<Object>} sorted with rank field
 */
function rankModels(scoredResults) {
  var sorted = scoredResults.slice().sort(function(a, b) { return b.composite - a.composite; });
  return sorted.map(function(r, i) { return Object.assign({}, r, { rank: i + 1 }); });
}

/**
 * Decide whether to rotate the primary model.
 * @param {Object|null} currentPrimary - scored result for current primary
 * @param {Object} newBest - highest-scoring model
 * @param {number} [threshold=10] - % improvement required
 * @returns {{rotate: boolean, reason: string}}
 */
function shouldRotate(currentPrimary, newBest, threshold) {
  if (threshold == null) threshold = 10;

  if (!newBest || newBest.composite <= 0) {
    return { rotate: false, reason: "No working models found in benchmark" };
  }

  if (!currentPrimary || currentPrimary.composite <= 0) {
    return {
      rotate: true,
      reason: "Current primary failed all tests; rotating to " + newBest.modelId,
    };
  }

  if (currentPrimary.modelId === newBest.modelId) {
    return { rotate: false, reason: "Current primary is already the best model" };
  }

  var improvementPct =
    ((newBest.composite - currentPrimary.composite) / currentPrimary.composite) * 100;

  if (improvementPct > threshold) {
    return {
      rotate: true,
      reason:
        "New best (" + newBest.modelId + ") scores " +
        Math.round(improvementPct) + "% higher than current (" +
        currentPrimary.modelId + ")",
    };
  }

  if (!currentPrimary.free && newBest.free && newBest.composite >= 50) {
    return {
      rotate: true,
      reason:
        "Free alternative (" + newBest.modelId +
        ") scores adequately (" + newBest.composite +
        ") vs paid current",
    };
  }

  return {
    rotate: false,
    reason:
      "Current primary performing adequately (within " + threshold +
      "% of best, improvement: " + (Math.round(improvementPct * 10) / 10) + "%)",
  };
}

/**
 * Legacy composite score from individual scores object.
 * @param {Object} scores - { latency, throughput, correctness, availability }
 * @param {Object} [weights]
 * @returns {number} 0-100
 */
function compositeScore(scores, weights) {
  var w = Object.assign({}, DEFAULT_WEIGHTS, weights || {});
  var lat = Number(scores.latency) || 0;
  var thr = Number(scores.throughput) || 0;
  var cor = Number(scores.correctness) || 0;
  var avl = Number(scores.availability) || 0;
  return Math.round(lat * w.latency + thr * w.throughput + cor * w.correctness + avl * w.availability);
}

/**
 * Grade label from composite score.
 * @param {number} score
 * @returns {string}
 */
function gradeLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 30) return "Poor";
  return "Unusable";
}

module.exports = {
  // Core individual scorers
  latencyScore: latencyScore,
  throughputScore: throughputScore,
  correctnessScore: correctnessScore,
  availabilityScore: availabilityScore,
  compositeScore: compositeScore,
  gradeLabel: gradeLabel,
  DEFAULT_WEIGHTS: DEFAULT_WEIGHTS,
  // Multi-test pipeline (model-optimizer)
  scoreModel: scoreModel,
  rankModels: rankModels,
  shouldRotate: shouldRotate,
  estimateTokens: estimateTokens,
  calcThroughput: calcThroughput,
  // Test validators (exported for testing)
  validateMath: validateMath,
  validateInstruction: validateInstruction,
  validateAvailability: validateAvailability,
};
