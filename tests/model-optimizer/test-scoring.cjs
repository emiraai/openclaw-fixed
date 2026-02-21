#!/usr/bin/env node
/**
 * test-scoring.cjs - Unit tests for scripts/scoring.cjs
 *
 * Tests latencyScore, throughputScore, correctnessScore, compositeScore,
 * availabilityScore, gradeLabel, scoreModel, rankModels, shouldRotate,
 * and all edge cases.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/test-scoring.cjs
 */
'use strict';

const assert = require('assert');

// Load the actual scoring module
const scoring = require('/host/home/openclaw/scripts/scoring.cjs');

const {
  latencyScore,
  throughputScore,
  correctnessScore,
  availabilityScore,
  compositeScore,
  gradeLabel,
  scoreModel,
  rankModels,
  shouldRotate,
  estimateTokens,
  calcThroughput,
  validateMath,
  validateInstruction,
  validateAvailability,
  DEFAULT_WEIGHTS,
} = scoring;

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log('  FAIL: ' + name + ' -- ' + e.message);
  }
}

function skip(name, reason) {
  skipped++;
  console.log('  SKIP: ' + name + ' -- ' + reason);
}

function assertInRange(val, min, max, msg) {
  assert.ok(typeof val === 'number', msg + ' (expected number, got ' + typeof val + ')');
  assert.ok(val >= min && val <= max, msg + ' (expected ' + min + '-' + max + ', got ' + val + ')');
}

// ===========================================================================
// TESTS: latencyScore - band-based interpolation
// ===========================================================================
console.log('\n=== latencyScore ===\n');

test('latencyScore(100) returns high score (>80)', function() {
  assertInRange(latencyScore(100), 80, 100, '100ms');
});

test('latencyScore(500) returns top band boundary (100)', function() {
  // 500ms is the boundary of the first band
  assert.strictEqual(latencyScore(500), 100);
});

test('latencyScore(2000) returns moderate score (>=50)', function() {
  assertInRange(latencyScore(2000), 50, 100, '2000ms');
});

test('latencyScore(5000) returns band score around 50', function() {
  assertInRange(latencyScore(5000), 25, 75, '5000ms');
});

test('latencyScore(15000) returns low score (<=25)', function() {
  assertInRange(latencyScore(15000), 0, 30, '15000ms');
});

test('latencyScore(30000) returns floor score of 10', function() {
  // Values beyond 20000ms hit the Infinity band. The lerp extrapolation
  // would produce a negative value, but Math.max(10, ...) clamps it.
  var score = latencyScore(30000);
  assert.strictEqual(score, 10, 'should be clamped to floor score of 10');
});

test('latencyScore monotonically decreasing', function() {
  var values = [0, 100, 500, 2000, 5000, 15000, 30000];
  var scores = values.map(function(v) { return latencyScore(v); });
  for (var i = 1; i < scores.length; i++) {
    assert.ok(scores[i] <= scores[i - 1],
      values[i] + 'ms (' + scores[i] + ') should be <= ' + values[i-1] + 'ms (' + scores[i-1] + ')');
  }
});

test('latencyScore(0) returns 100', function() {
  assert.strictEqual(latencyScore(0), 100);
});

// Edge cases: non-finite and invalid inputs return 0
test('latencyScore(-1) returns 0', function() {
  assert.strictEqual(latencyScore(-1), 0);
});

test('latencyScore(NaN) returns 0', function() {
  assert.strictEqual(latencyScore(NaN), 0);
});

test('latencyScore(Infinity) returns 0', function() {
  assert.strictEqual(latencyScore(Infinity), 0);
});

test('latencyScore(-Infinity) returns 0', function() {
  assert.strictEqual(latencyScore(-Infinity), 0);
});

test('latencyScore(null) returns 0', function() {
  assert.strictEqual(latencyScore(null), 0);
});

test('latencyScore(undefined) returns 0', function() {
  assert.strictEqual(latencyScore(undefined), 0);
});

test('latencyScore("string") returns 0', function() {
  assert.strictEqual(latencyScore("fast"), 0);
});

// ===========================================================================
// TESTS: throughputScore - band-based interpolation
// ===========================================================================
console.log('\n=== throughputScore ===\n');

test('throughputScore(100) returns 100 (top band)', function() {
  assert.strictEqual(throughputScore(100), 100);
});

test('throughputScore(50) returns high score (>=80)', function() {
  assertInRange(throughputScore(50), 80, 100, '50 tok/s');
});

test('throughputScore(10) returns moderate score (>=40)', function() {
  assertInRange(throughputScore(10), 40, 60, '10 tok/s');
});

test('throughputScore(5) returns low band score (>=20)', function() {
  assertInRange(throughputScore(5), 20, 30, '5 tok/s');
});

test('throughputScore(1) returns near-floor score (10-25)', function() {
  assertInRange(throughputScore(1), 10, 25, '1 tok/s');
});

test('throughputScore(0) returns 10 (floor for zero throughput)', function() {
  assert.strictEqual(throughputScore(0), 10);
});

test('throughputScore monotonically increasing', function() {
  var values = [0, 1, 5, 10, 50, 100];
  var scores = values.map(function(v) { return throughputScore(v); });
  for (var i = 1; i < scores.length; i++) {
    assert.ok(scores[i] >= scores[i - 1],
      values[i] + ' tok/s (' + scores[i] + ') should be >= ' + values[i-1] + ' tok/s (' + scores[i-1] + ')');
  }
});

// Edge cases: null returns benefit-of-doubt (30), non-finite returns 10
test('throughputScore(null) returns 30 (benefit of doubt)', function() {
  assert.strictEqual(throughputScore(null), 30);
});

test('throughputScore(undefined) returns 30 (benefit of doubt)', function() {
  assert.strictEqual(throughputScore(undefined), 30);
});

test('throughputScore(-1) returns 10 (floor)', function() {
  assert.strictEqual(throughputScore(-1), 10);
});

test('throughputScore(NaN) returns 10 (floor for non-finite)', function() {
  assert.strictEqual(throughputScore(NaN), 10);
});

test('throughputScore(Infinity) returns 10 (floor for non-finite)', function() {
  assert.strictEqual(throughputScore(Infinity), 10);
});

// ===========================================================================
// TESTS: correctnessScore (single-test mode)
// ===========================================================================
console.log('\n=== correctnessScore (single) ===\n');

test('correctnessScore("4", "4") returns 100 (exact match)', function() {
  assert.strictEqual(correctnessScore("4", "4"), 100);
});

test('correctnessScore("four", "4") returns 100 (word match)', function() {
  assert.strictEqual(correctnessScore("four", "4"), 100);
});

test('correctnessScore("The answer is 4", "4") returns 80 (contains match)', function() {
  assert.strictEqual(correctnessScore("The answer is 4", "4"), 80);
});

test('correctnessScore("FOUR", "4") returns 100 (case-insensitive word)', function() {
  assert.strictEqual(correctnessScore("FOUR", "4"), 100);
});

test('correctnessScore("The answer is 5", "4") returns 15 (non-empty wrong)', function() {
  assert.strictEqual(correctnessScore("The answer is 5", "4"), 15);
});

test('correctnessScore with empty string returns 0', function() {
  assert.strictEqual(correctnessScore("", "4"), 0);
});

test('correctnessScore with null returns 0', function() {
  assert.strictEqual(correctnessScore(null, "4"), 0);
});

test('correctnessScore with undefined returns 0', function() {
  assert.strictEqual(correctnessScore(undefined, "4"), 0);
});

test('correctnessScore with no expected defaults to "4"', function() {
  // When expected is undefined, the implementation defaults to "4"
  var s = correctnessScore("4");
  assert.strictEqual(s, 100);
});

// ===========================================================================
// TESTS: correctnessScore (multi-test mode)
// ===========================================================================
console.log('\n=== correctnessScore (multi) ===\n');

test('correctnessScore with all-pass tests returns 100', function() {
  var tests = [
    { name: 'math', status: 'OK', response: 'The answer is 4' },
    { name: 'availability', status: 'OK', response: 'Hello world' },
  ];
  var result = correctnessScore(tests);
  assert.ok(typeof result === 'object', 'multi-test returns object');
  assert.strictEqual(result.score, 100);
});

test('correctnessScore with all-fail tests returns 0', function() {
  var tests = [
    { name: 'math', status: 'FAIL', response: '' },
    { name: 'availability', status: 'FAIL', response: '' },
  ];
  var result = correctnessScore(tests);
  assert.strictEqual(result.score, 0);
});

test('correctnessScore with mixed results', function() {
  var tests = [
    { name: 'math', status: 'OK', response: 'The answer is 4' },
    { name: 'availability', status: 'FAIL', response: '' },
  ];
  var result = correctnessScore(tests);
  assert.strictEqual(result.score, 50);
});

test('correctnessScore with empty test array returns 0', function() {
  var result = correctnessScore([]);
  assert.ok(typeof result === 'object');
  assert.strictEqual(result.score, 0);
});

// ===========================================================================
// TESTS: availabilityScore
// ===========================================================================
console.log('\n=== availabilityScore ===\n');

test('availabilityScore(1, 1) returns 100', function() {
  assert.strictEqual(availabilityScore(1, 1), 100);
});

test('availabilityScore(0, 1) returns 0', function() {
  assert.strictEqual(availabilityScore(0, 1), 0);
});

test('availabilityScore(1, 2) returns 50', function() {
  assert.strictEqual(availabilityScore(1, 2), 50);
});

test('availabilityScore with test array: all OK', function() {
  var tests = [
    { status: 'OK' },
    { status: 'OK' },
  ];
  assert.strictEqual(availabilityScore(tests), 100);
});

test('availabilityScore with test array: half OK', function() {
  var tests = [
    { status: 'OK' },
    { status: 'FAIL' },
  ];
  assert.strictEqual(availabilityScore(tests), 50);
});

test('availabilityScore with empty array returns 0', function() {
  assert.strictEqual(availabilityScore([]), 0);
});

test('availabilityScore with invalid args returns 0', function() {
  assert.strictEqual(availabilityScore(NaN, NaN), 0);
  assert.strictEqual(availabilityScore(0, 0), 0);
});

// ===========================================================================
// TESTS: compositeScore
// ===========================================================================
console.log('\n=== compositeScore ===\n');

test('compositeScore with all 100s returns weighted sum', function() {
  // Default weights: latency=0.4, throughput=0.25, correctness=0.2, availability=0.15
  // 100*0.4 + 100*0.25 + 100*0.2 + 100*0.15 = 40+25+20+15 = 100
  var s = compositeScore({ latency: 100, throughput: 100, correctness: 100, availability: 100 });
  assert.strictEqual(s, 100);
});

test('compositeScore with all 0s returns 0', function() {
  var s = compositeScore({ latency: 0, throughput: 0, correctness: 0, availability: 0 });
  assert.strictEqual(s, 0);
});

test('compositeScore with default weights (4 components)', function() {
  var s = compositeScore({ latency: 80, throughput: 60, correctness: 90, availability: 100 });
  // 80*0.4 + 60*0.25 + 90*0.2 + 100*0.15 = 32 + 15 + 18 + 15 = 80
  assert.strictEqual(s, 80);
});

test('compositeScore with custom weights', function() {
  var s = compositeScore(
    { latency: 100, throughput: 0, correctness: 0, availability: 0 },
    { latency: 1.0, throughput: 0, correctness: 0, availability: 0 }
  );
  assert.strictEqual(s, 100);
});

test('compositeScore with missing fields defaults to 0', function() {
  // Only correctness=100 * 0.2 = 20
  var s = compositeScore({ correctness: 100 });
  assert.strictEqual(s, 20);
});

test('compositeScore returns integer', function() {
  var s = compositeScore({ latency: 33, throughput: 33, correctness: 33, availability: 33 });
  assert.strictEqual(s, Math.round(s));
});

// ===========================================================================
// TESTS: gradeLabel
// ===========================================================================
console.log('\n=== gradeLabel ===\n');

test('gradeLabel(95) returns "Excellent"', function() {
  assert.strictEqual(gradeLabel(95), 'Excellent');
});

test('gradeLabel(90) returns "Excellent"', function() {
  assert.strictEqual(gradeLabel(90), 'Excellent');
});

test('gradeLabel(80) returns "Good"', function() {
  assert.strictEqual(gradeLabel(80), 'Good');
});

test('gradeLabel(60) returns "Fair"', function() {
  assert.strictEqual(gradeLabel(60), 'Fair');
});

test('gradeLabel(40) returns "Poor"', function() {
  assert.strictEqual(gradeLabel(40), 'Poor');
});

test('gradeLabel(10) returns "Unusable"', function() {
  assert.strictEqual(gradeLabel(10), 'Unusable');
});

// ===========================================================================
// TESTS: DEFAULT_WEIGHTS
// ===========================================================================
console.log('\n=== DEFAULT_WEIGHTS ===\n');

test('DEFAULT_WEIGHTS sums to 1.0', function() {
  var sum = DEFAULT_WEIGHTS.latency + DEFAULT_WEIGHTS.throughput +
            DEFAULT_WEIGHTS.correctness + DEFAULT_WEIGHTS.availability;
  assert.ok(Math.abs(sum - 1.0) < 0.001, 'Weights sum should be 1.0, got ' + sum);
});

test('DEFAULT_WEIGHTS has all 4 components', function() {
  assert.ok(typeof DEFAULT_WEIGHTS.latency === 'number');
  assert.ok(typeof DEFAULT_WEIGHTS.throughput === 'number');
  assert.ok(typeof DEFAULT_WEIGHTS.correctness === 'number');
  assert.ok(typeof DEFAULT_WEIGHTS.availability === 'number');
});

// ===========================================================================
// TESTS: validateMath
// ===========================================================================
console.log('\n=== validateMath ===\n');

test('validateMath("4") returns true', function() {
  assert.strictEqual(validateMath("4"), true);
});

test('validateMath("four") returns true', function() {
  assert.strictEqual(validateMath("four"), true);
});

test('validateMath("The answer is 4.") returns true', function() {
  assert.strictEqual(validateMath("The answer is 4."), true);
});

test('validateMath("5") returns false', function() {
  assert.strictEqual(validateMath("5"), false);
});

test('validateMath("") returns false', function() {
  assert.strictEqual(validateMath(""), false);
});

test('validateMath(null) returns false', function() {
  assert.strictEqual(validateMath(null), false);
});

// ===========================================================================
// TESTS: validateAvailability
// ===========================================================================
console.log('\n=== validateAvailability ===\n');

test('validateAvailability("Hello") returns true', function() {
  assert.strictEqual(validateAvailability("Hello"), true);
});

test('validateAvailability("") returns false', function() {
  assert.strictEqual(validateAvailability(""), false);
});

test('validateAvailability("   ") returns false', function() {
  assert.strictEqual(validateAvailability("   "), false);
});

test('validateAvailability(null) returns false', function() {
  assert.strictEqual(validateAvailability(null), false);
});

// ===========================================================================
// TESTS: estimateTokens
// ===========================================================================
console.log('\n=== estimateTokens ===\n');

test('estimateTokens("hello world") returns > 0', function() {
  assert.ok(estimateTokens("hello world") > 0);
});

test('estimateTokens("") returns 0', function() {
  assert.strictEqual(estimateTokens(""), 0);
});

test('estimateTokens(null) returns 0', function() {
  assert.strictEqual(estimateTokens(null), 0);
});

test('estimateTokens estimates ~4 chars per token', function() {
  var text = "a".repeat(100);
  var tokens = estimateTokens(text);
  assert.strictEqual(tokens, 25); // 100/4 = 25
});

// ===========================================================================
// TESTS: calcThroughput
// ===========================================================================
console.log('\n=== calcThroughput ===\n');

test('calcThroughput with completionTokens and latencyMs', function() {
  var result = calcThroughput({ completionTokens: 100, latencyMs: 1000 });
  assert.strictEqual(result, 100); // 100 tokens / 1 second
});

test('calcThroughput estimates from response text', function() {
  var result = calcThroughput({ response: "a".repeat(40), latencyMs: 1000 });
  assert.ok(result > 0, 'should estimate throughput from response');
});

test('calcThroughput returns null for zero latency', function() {
  assert.strictEqual(calcThroughput({ completionTokens: 10, latencyMs: 0 }), null);
});

test('calcThroughput returns null for null input', function() {
  assert.strictEqual(calcThroughput(null), null);
});

// ===========================================================================
// TESTS: scoreModel
// ===========================================================================
console.log('\n=== scoreModel ===\n');

test('scoreModel produces valid composite score', function() {
  var raw = {
    provider: 'nvidia',
    modelId: 'test-model',
    modelName: 'Test Model',
    free: true,
    tests: [
      { name: 'math', status: 'OK', response: '4', latencyMs: 300, ttftMs: 200, completionTokens: 5 },
      { name: 'availability', status: 'OK', response: 'Hello', latencyMs: 250, ttftMs: 150, completionTokens: 3 },
    ],
  };
  var result = scoreModel(raw);
  assert.ok(typeof result.composite === 'number');
  assertInRange(result.composite, 0, 100, 'composite');
  assert.strictEqual(result.provider, 'nvidia');
  assert.strictEqual(result.modelId, 'test-model');
  assert.ok(result.free === true);
});

test('scoreModel with all-failed tests returns low score', function() {
  var raw = {
    provider: 'test',
    modelId: 'fail-model',
    modelName: 'Fail Model',
    tests: [
      { name: 'math', status: 'FAIL', response: '', latencyMs: 0, ttftMs: null },
    ],
  };
  var result = scoreModel(raw);
  assert.ok(result.composite <= 20, 'all-fail should score low');
});

// ===========================================================================
// TESTS: rankModels
// ===========================================================================
console.log('\n=== rankModels ===\n');

test('rankModels sorts by composite score descending', function() {
  var models = [
    { composite: 50, modelId: 'B' },
    { composite: 90, modelId: 'A' },
    { composite: 70, modelId: 'C' },
  ];
  var ranked = rankModels(models);
  assert.strictEqual(ranked[0].modelId, 'A');
  assert.strictEqual(ranked[1].modelId, 'C');
  assert.strictEqual(ranked[2].modelId, 'B');
});

test('rankModels assigns rank numbers starting at 1', function() {
  var models = [
    { composite: 80 },
    { composite: 60 },
  ];
  var ranked = rankModels(models);
  assert.strictEqual(ranked[0].rank, 1);
  assert.strictEqual(ranked[1].rank, 2);
});

test('rankModels does not mutate input array', function() {
  var models = [
    { composite: 50 },
    { composite: 90 },
  ];
  var ranked = rankModels(models);
  assert.strictEqual(models[0].composite, 50); // original unchanged
  assert.ok(!models[0].rank); // no rank added to original
});

// ===========================================================================
// TESTS: shouldRotate
// ===========================================================================
console.log('\n=== shouldRotate ===\n');

test('shouldRotate when new best is significantly better', function() {
  var current = { composite: 50, modelId: 'old' };
  var best = { composite: 80, modelId: 'new' };
  var result = shouldRotate(current, best, 10);
  assert.strictEqual(result.rotate, true);
});

test('shouldRotate false when improvement is below threshold', function() {
  var current = { composite: 80, modelId: 'old' };
  var best = { composite: 82, modelId: 'new' };
  var result = shouldRotate(current, best, 10);
  assert.strictEqual(result.rotate, false);
});

test('shouldRotate true when current is null (failed)', function() {
  var best = { composite: 70, modelId: 'new' };
  var result = shouldRotate(null, best, 10);
  assert.strictEqual(result.rotate, true);
});

test('shouldRotate false when same model is best', function() {
  var current = { composite: 80, modelId: 'same' };
  var best = { composite: 80, modelId: 'same' };
  var result = shouldRotate(current, best, 10);
  assert.strictEqual(result.rotate, false);
});

test('shouldRotate false when no working models', function() {
  var current = { composite: 80, modelId: 'old' };
  var result = shouldRotate(current, null, 10);
  assert.strictEqual(result.rotate, false);
});

test('shouldRotate true when free alternative is adequate', function() {
  var current = { composite: 60, modelId: 'paid', free: false };
  var best = { composite: 55, modelId: 'free', free: true };
  var result = shouldRotate(current, best, 10);
  assert.strictEqual(result.rotate, true);
  assert.ok(result.reason.includes('Free'), 'reason should mention free');
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n=== SCORING TEST SUMMARY ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('  Skipped: ' + skipped);
if (failures.length > 0) {
  console.log('\n  Failures:');
  failures.forEach(function(f) { console.log('    - ' + f.name + ': ' + f.error); });
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
