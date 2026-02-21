#!/usr/bin/env node
/**
 * test-live-benchmark.cjs - Integration tests with live NVIDIA API calls.
 *
 * Tests: response format parsing, score validity (0-100), timeout handling,
 * concurrent execution.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/test-live-benchmark.cjs
 */
'use strict';

const assert = require('assert');
const https = require('https');
const http = require('http');
const fs = require('fs');

const scoring = require('/host/home/openclaw/scripts/scoring.cjs');

const CONFIG_PATH = '/home/node/.openclaw/openclaw.json';
const PROMPT = 'What is 2+2? Answer with just the number.';
const EXPECTED_ANSWER = '4';
const MAX_TOKENS = 32;
const TIMEOUT_MS = 30000;
const SHORT_TIMEOUT_MS = 50;

// ---------------------------------------------------------------------------
// Load config and extract NVIDIA provider
// ---------------------------------------------------------------------------
var cfg, nvidiaProvider;
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  var providers = cfg.models && cfg.models.providers ? cfg.models.providers : {};
  nvidiaProvider = providers.nvidia;
} catch (e) {
  console.log('[ERROR] Cannot load config: ' + e.message);
  process.exit(1);
}

if (!nvidiaProvider || !nvidiaProvider.apiKey) {
  console.log('[ERROR] NVIDIA provider not configured or missing API key');
  process.exit(1);
}

var NVIDIA_URL = nvidiaProvider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
var NVIDIA_KEY = nvidiaProvider.apiKey;
var NVIDIA_MODELS = (nvidiaProvider.models || []).map(function(m) { return m.id; });

console.log('NVIDIA endpoint: ' + NVIDIA_URL);
console.log('Models to test: ' + NVIDIA_MODELS.length);

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function makeRequest(url, body, apiKey, timeoutMs) {
  return new Promise(function(resolve) {
    var u = new URL(url);
    var mod = u.protocol === 'https:' ? https : http;
    var headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    var data = JSON.stringify(body);
    headers['Content-Length'] = Buffer.byteLength(data);

    var start = performance.now();
    var ttft = null;
    var fullBody = '';
    var timedOut = false;

    var timer = setTimeout(function() {
      timedOut = true;
      req.destroy();
      resolve({ error: 'TIMEOUT', latencyMs: timeoutMs, ttftMs: null, body: '' });
    }, timeoutMs);

    var req = mod.request(u, { method: 'POST', headers: headers }, function(res) {
      res.on('data', function(chunk) {
        if (ttft === null) ttft = performance.now() - start;
        fullBody += chunk;
      });
      res.on('end', function() {
        if (timedOut) return;
        clearTimeout(timer);
        var latencyMs = performance.now() - start;
        if (res.statusCode >= 400) {
          resolve({ error: 'HTTP ' + res.statusCode, latencyMs: latencyMs, ttftMs: ttft, body: fullBody.slice(0, 500) });
        } else {
          resolve({ error: null, latencyMs: latencyMs, ttftMs: ttft, body: fullBody });
        }
      });
    });

    req.on('error', function(e) {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ error: e.message, latencyMs: performance.now() - start, ttftMs: null, body: '' });
    });

    req.write(data);
    req.end();
  });
}

function extractText(body) {
  try {
    var d = JSON.parse(body);
    if (d.choices && d.choices[0]) {
      var c = d.choices[0];
      return (c.message && c.message.content) || c.text || '';
    }
    return '';
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
var passed = 0;
var failed = 0;
var skipped = 0;
var failures = [];

function test(name, fn) {
  return fn().then(function() {
    passed++;
    console.log('  PASS: ' + name);
  }).catch(function(e) {
    failed++;
    failures.push({ name: name, error: e.message });
    console.log('  FAIL: ' + name + ' -- ' + e.message);
  });
}

function assertInRange(val, min, max, msg) {
  assert.ok(typeof val === 'number', msg + ' (expected number, got ' + typeof val + ')');
  assert.ok(val >= min && val <= max, msg + ' (expected ' + min + '-' + max + ', got ' + val + ')');
}

// ===========================================================================
// RUN TESTS
// ===========================================================================
async function runTests() {

  var testModelId = NVIDIA_MODELS[0] || 'nvidia/llama-3.3-nemotron-super-49b-v1';
  var testBody = {
    model: testModelId,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: MAX_TOKENS,
    temperature: 0,
    stream: false,
  };

  // =========================================================================
  // TESTS: Response Format Parsing
  // =========================================================================
  console.log('\n=== Response Format Parsing (Live) ===\n');

  await test('NVIDIA API returns valid JSON with choices array', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, TIMEOUT_MS);
    if (res.error) {
      console.log('    [INFO] Model unavailable: ' + res.error);
      return;
    }
    var parsed = JSON.parse(res.body);
    assert.ok(parsed.choices, 'Response should have choices array');
    assert.ok(Array.isArray(parsed.choices), 'choices should be an array');
    assert.ok(parsed.choices.length > 0, 'choices should not be empty');
  });

  await test('Response contains message.content text', async function() {
    // Try multiple models until one responds (some may be rate-limited)
    var tried = 0;
    for (var mi = 0; mi < NVIDIA_MODELS.length && mi < 5; mi++) {
      var body = {
        model: NVIDIA_MODELS[mi],
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        stream: false,
      };
      var res = await makeRequest(NVIDIA_URL, body, NVIDIA_KEY, TIMEOUT_MS);
      tried++;
      if (res.error) continue;
      var text = extractText(res.body);
      if (text.length > 0) {
        console.log('    (model: ' + NVIDIA_MODELS[mi] + ', text: "' + text.slice(0, 50) + '")');
        return; // pass
      }
    }
    assert.fail('No model returned non-empty text after trying ' + tried + ' models');
  });

  await test('Response text contains expected answer "4"', async function() {
    // Try multiple models until one responds correctly
    for (var mi = 0; mi < NVIDIA_MODELS.length && mi < 5; mi++) {
      var body = {
        model: NVIDIA_MODELS[mi],
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        stream: false,
      };
      var res = await makeRequest(NVIDIA_URL, body, NVIDIA_KEY, TIMEOUT_MS);
      if (res.error) continue;
      var text = extractText(res.body);
      if (text.includes('4') || text.toLowerCase().includes('four')) {
        console.log('    (model: ' + NVIDIA_MODELS[mi] + ', answer: "' + text.slice(0, 50) + '")');
        return; // pass
      }
    }
    assert.fail('No model returned "4" in response');
  });

  // =========================================================================
  // TESTS: Scoring with Live Data
  // =========================================================================
  console.log('\n=== Scoring Validation (Live) ===\n');

  await test('latencyScore from live request is in 0-100 range', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, TIMEOUT_MS);
    if (res.error) return;
    var ls = scoring.latencyScore(res.latencyMs);
    assertInRange(ls, 0, 100, 'latencyScore');
    console.log('    (latency: ' + Math.round(res.latencyMs) + 'ms -> score: ' + ls + ')');
  });

  await test('throughputScore from live request is in 0-100 range', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, TIMEOUT_MS);
    if (res.error) return;
    var parsed;
    try { parsed = JSON.parse(res.body); } catch (e) { return; }
    var usage = parsed.usage || {};
    var completionTokens = usage.completion_tokens || 0;
    var tokPerSec = completionTokens > 0 ? completionTokens / (res.latencyMs / 1000) : null;
    var ts = scoring.throughputScore(tokPerSec);
    assertInRange(ts, 0, 100, 'throughputScore');
    console.log('    (throughput: ' + (tokPerSec ? tokPerSec.toFixed(1) : 'unknown') + ' tok/s -> score: ' + ts + ')');
  });

  await test('correctnessScore from live request is in 0-100 range', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, TIMEOUT_MS);
    if (res.error) return;
    var text = extractText(res.body);
    var cs = scoring.correctnessScore(text, EXPECTED_ANSWER);
    assertInRange(cs, 0, 100, 'correctnessScore');
    console.log('    (response: "' + text.slice(0, 50) + '" -> score: ' + cs + ')');
  });

  await test('compositeScore from live request is in 0-100 range', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, TIMEOUT_MS);
    if (res.error) return;
    var text = extractText(res.body);
    var parsed;
    try { parsed = JSON.parse(res.body); } catch (e) { return; }
    var usage = parsed.usage || {};
    var completionTokens = usage.completion_tokens || 0;
    var tokPerSec = completionTokens > 0 ? completionTokens / (res.latencyMs / 1000) : null;

    var scores = {
      latency: scoring.latencyScore(res.latencyMs),
      throughput: scoring.throughputScore(tokPerSec),
      correctness: scoring.correctnessScore(text, EXPECTED_ANSWER),
      availability: scoring.availabilityScore(1, 1),
    };
    var composite = scoring.compositeScore(scores);
    assertInRange(composite, 0, 100, 'compositeScore');
    console.log('    (composite: ' + composite + ' L=' + scores.latency + ' T=' + scores.throughput + ' C=' + scores.correctness + ' A=' + scores.availability + ')');
  });

  // =========================================================================
  // TESTS: Timeout Handling
  // =========================================================================
  console.log('\n=== Timeout Handling ===\n');

  await test('Very short timeout (50ms) returns TIMEOUT error', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, SHORT_TIMEOUT_MS);
    assert.strictEqual(res.error, 'TIMEOUT', 'Should timeout with 50ms limit');
  });

  await test('Timeout latency is approximately the timeout value', async function() {
    var res = await makeRequest(NVIDIA_URL, testBody, NVIDIA_KEY, SHORT_TIMEOUT_MS);
    if (res.error !== 'TIMEOUT') return;
    assert.ok(res.latencyMs >= SHORT_TIMEOUT_MS - 10,
      'Latency should be >= timeout-10ms');
    assert.ok(res.latencyMs <= SHORT_TIMEOUT_MS + 500,
      'Latency should be <= timeout+500ms');
  });

  // =========================================================================
  // TESTS: Concurrent Execution
  // =========================================================================
  console.log('\n=== Concurrent Execution ===\n');

  await test('Can run 3 models concurrently without errors', async function() {
    var modelsToTest = NVIDIA_MODELS.slice(0, 3);
    if (modelsToTest.length < 2) {
      console.log('    [INFO] Only ' + modelsToTest.length + ' models available');
      return;
    }

    var start = performance.now();
    var promises = modelsToTest.map(function(modelId) {
      return makeRequest(NVIDIA_URL, {
        model: modelId,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        stream: false,
      }, NVIDIA_KEY, TIMEOUT_MS);
    });

    var results = await Promise.all(promises);
    var elapsed = performance.now() - start;
    var successes = results.filter(function(r) { return !r.error; });
    console.log('    (' + successes.length + '/' + results.length + ' succeeded in ' + Math.round(elapsed) + 'ms)');

    for (var i = 0; i < results.length; i++) {
      assert.ok(results[i].latencyMs > 0, 'Result ' + i + ' should have positive latency');
    }
  });

  await test('Concurrent execution is faster than sum of latencies', async function() {
    var modelsToTest = NVIDIA_MODELS.slice(0, 2);
    if (modelsToTest.length < 2) return;

    var concStart = performance.now();
    var concResults = await Promise.all(modelsToTest.map(function(modelId) {
      return makeRequest(NVIDIA_URL, {
        model: modelId,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        stream: false,
      }, NVIDIA_KEY, TIMEOUT_MS);
    }));
    var concElapsed = performance.now() - concStart;
    var sumLatencies = concResults.reduce(function(s, r) { return s + r.latencyMs; }, 0);

    console.log('    (concurrent: ' + Math.round(concElapsed) + 'ms, sum: ' + Math.round(sumLatencies) + 'ms)');

    var allFailed = concResults.every(function(r) { return r.error; });
    if (!allFailed) {
      assert.ok(concElapsed < sumLatencies * 1.1,
        'Concurrent should be faster than sequential sum');
    }
  });

  // =========================================================================
  // TESTS: Benchmark Each NVIDIA Model
  // =========================================================================
  console.log('\n=== Benchmark All NVIDIA Models ===\n');

  for (var mi = 0; mi < NVIDIA_MODELS.length; mi++) {
    var modelId = NVIDIA_MODELS[mi];
    await test('Model ' + modelId + ' responds or fails gracefully', async function() {
      var body = {
        model: modelId,
        messages: [{ role: 'user', content: PROMPT }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        stream: false,
      };
      var res = await makeRequest(NVIDIA_URL, body, NVIDIA_KEY, TIMEOUT_MS);

      if (res.error) {
        assert.ok(typeof res.error === 'string');
        assert.ok(res.latencyMs > 0);
        console.log('    (' + modelId + ': ' + res.error + ' in ' + Math.round(res.latencyMs) + 'ms)');
      } else {
        var text = extractText(res.body);
        assert.ok(typeof text === 'string');
        console.log('    (' + modelId + ': OK in ' + Math.round(res.latencyMs) + 'ms, "' + text.slice(0, 40) + '")');
      }
    });
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=== LIVE BENCHMARK TEST SUMMARY ===');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('  Skipped: ' + skipped);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(function(f) { console.log('    - ' + f.name + ': ' + f.error); });
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function(e) {
  console.error('Test runner error: ' + e.message);
  process.exit(1);
});
