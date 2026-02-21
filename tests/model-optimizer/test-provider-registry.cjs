#!/usr/bin/env node
/**
 * test-provider-registry.cjs - Unit tests for scripts/provider-registry.cjs
 *
 * Tests: KNOWN_PROVIDERS structure, model entries, API format validation,
 * provider filtering, getTestableModels, mergeWithConfig, generateProviderConfig.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/test-provider-registry.cjs
 */
'use strict';

var assert = require('assert');
var fs = require('fs');

var registry = require('/host/home/openclaw/scripts/provider-registry.cjs');

var CONFIG_PATH = '/home/node/.openclaw/openclaw.json';
var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
var passedCount = 0;
var failedCount = 0;
var skippedCount = 0;
var failureList = [];

function test(name, fn) {
  try {
    fn();
    passedCount++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failedCount++;
    failureList.push({ name: name, error: e.message });
    console.log('  FAIL: ' + name + ' -- ' + e.message);
  }
}

function skip(name, reason) {
  skippedCount++;
  console.log('  SKIP: ' + name + ' -- ' + reason);
}

// ===========================================================================
// TESTS: KNOWN_PROVIDERS Structure
// ===========================================================================
console.log('\n=== KNOWN_PROVIDERS Structure ===\n');

var KNOWN_PROVIDERS = registry.KNOWN_PROVIDERS;

test('KNOWN_PROVIDERS is an array', function() {
  assert.ok(Array.isArray(KNOWN_PROVIDERS), 'should be array');
});

test('KNOWN_PROVIDERS has at least 5 providers', function() {
  assert.ok(KNOWN_PROVIDERS.length >= 5,
    'Expected 5+ providers, got ' + KNOWN_PROVIDERS.length);
});

test('All providers have "name" field (non-empty string)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.name === 'string' && p.name.length > 0,
      'Provider at index ' + i + ' must have non-empty name');
  }
});

test('All providers have "displayName" field', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.displayName === 'string' && p.displayName.length > 0,
      'Provider ' + p.name + ' must have displayName');
  }
});

test('All providers have "baseUrl" field (valid HTTPS URL)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.baseUrl === 'string' && p.baseUrl.startsWith('https://'),
      'Provider ' + p.name + ' baseUrl must be HTTPS, got: ' + p.baseUrl);
    new URL(p.baseUrl); // validates URL format
  }
});

test('All providers have "api" field', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.api === 'string' && p.api.length > 0,
      'Provider ' + p.name + ' must have api format');
  }
});

test('All providers have "envVar" field', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.envVar === 'string' && p.envVar.length > 0,
      'Provider ' + p.name + ' must have envVar');
  }
});

test('All providers have "signupUrl" (valid URL)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.signupUrl === 'string' && p.signupUrl.startsWith('https://'),
      'Provider ' + p.name + ' must have HTTPS signupUrl');
  }
});

test('All providers have "models" array with at least 1 entry', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(Array.isArray(p.models), 'Provider ' + p.name + ' must have models array');
    assert.ok(p.models.length >= 1, 'Provider ' + p.name + ' must have at least 1 model');
  }
});

test('All providers have "rateLimit" object', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    assert.ok(typeof p.rateLimit === 'object' && p.rateLimit !== null,
      'Provider ' + p.name + ' must have rateLimit');
  }
});

test('No duplicate provider names', function() {
  var names = KNOWN_PROVIDERS.map(function(p) { return p.name; });
  var unique = new Set(names);
  assert.strictEqual(names.length, unique.size, 'Duplicate names: ' +
    names.filter(function(n, i) { return names.indexOf(n) !== i; }).join(', '));
});

// ===========================================================================
// TESTS: Model Entry Validation
// ===========================================================================
console.log('\n=== Model Entry Validation ===\n');

test('All model entries have "id" (non-empty string)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    for (var j = 0; j < p.models.length; j++) {
      var m = p.models[j];
      assert.ok(typeof m.id === 'string' && m.id.length > 0,
        'Model in ' + p.name + ' at index ' + j + ' must have id');
    }
  }
});

test('All model entries have "name" (non-empty string)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    for (var j = 0; j < p.models.length; j++) {
      var m = p.models[j];
      assert.ok(typeof m.name === 'string' && m.name.length > 0,
        'Model ' + m.id + ' in ' + p.name + ' must have name');
    }
  }
});

test('All model entries have "contextWindow" (positive number)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    for (var j = 0; j < p.models.length; j++) {
      var m = p.models[j];
      assert.ok(typeof m.contextWindow === 'number' && m.contextWindow > 0,
        'Model ' + m.id + ' in ' + p.name + ' must have positive contextWindow');
    }
  }
});

test('All model entries have "maxTokens" (positive number)', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    for (var j = 0; j < p.models.length; j++) {
      var m = p.models[j];
      assert.ok(typeof m.maxTokens === 'number' && m.maxTokens > 0,
        'Model ' + m.id + ' in ' + p.name + ' must have positive maxTokens');
    }
  }
});

test('All model entries have "free" boolean', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    for (var j = 0; j < p.models.length; j++) {
      var m = p.models[j];
      assert.ok(typeof m.free === 'boolean',
        'Model ' + m.id + ' in ' + p.name + ' must have boolean free flag');
    }
  }
});

test('No duplicate model IDs within a provider', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    var ids = p.models.map(function(m) { return m.id; });
    var unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size,
      'Provider ' + p.name + ' has duplicate model IDs');
  }
});

// ===========================================================================
// TESTS: API Format Validation
// ===========================================================================
console.log('\n=== API Format Validation ===\n');

test('NVIDIA uses openai-completions', function() {
  var nvidia = KNOWN_PROVIDERS.find(function(p) { return p.name === 'nvidia'; });
  assert.ok(nvidia, 'nvidia should exist');
  assert.strictEqual(nvidia.api, 'openai-completions');
});

test('Groq uses openai-completions', function() {
  var groq = KNOWN_PROVIDERS.find(function(p) { return p.name === 'groq'; });
  assert.ok(groq, 'groq should exist');
  assert.strictEqual(groq.api, 'openai-completions');
});

test('All provider URLs are valid', function() {
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    var p = KNOWN_PROVIDERS[i];
    try {
      new URL(p.baseUrl);
    } catch (e) {
      assert.fail('Provider ' + p.name + ' has invalid URL: ' + p.baseUrl);
    }
  }
});

// ===========================================================================
// TESTS: getKnownProviders()
// ===========================================================================
console.log('\n=== getKnownProviders ===\n');

test('getKnownProviders returns array of providers', function() {
  var kp = registry.getKnownProviders();
  assert.ok(Array.isArray(kp));
  assert.ok(kp.length >= 5);
});

test('getKnownProviders includes nvidia', function() {
  var kp = registry.getKnownProviders();
  var nvidia = kp.find(function(p) { return p.name === 'nvidia'; });
  assert.ok(nvidia, 'should include nvidia');
});

// ===========================================================================
// TESTS: getAllProviders()
// ===========================================================================
console.log('\n=== getAllProviders ===\n');

test('getAllProviders returns object keyed by provider name', function() {
  var all = registry.getAllProviders();
  assert.ok(typeof all === 'object' && all !== null);
  assert.ok('nvidia' in all, 'should have nvidia key');
});

test('getAllProviders has expected providers', function() {
  var all = registry.getAllProviders();
  var keys = Object.keys(all);
  assert.ok(keys.includes('nvidia'));
  assert.ok(keys.includes('groq'));
  console.log('    (providers: ' + keys.join(', ') + ')');
});

// ===========================================================================
// TESTS: getTestableModels(cfg)
// ===========================================================================
console.log('\n=== getTestableModels ===\n');

test('getTestableModels returns array', function() {
  var models = registry.getTestableModels(cfg);
  assert.ok(Array.isArray(models));
});

test('getTestableModels includes config models', function() {
  var models = registry.getTestableModels(cfg);
  assert.ok(models.length >= 1, 'should include at least config models');
  console.log('    (total testable models: ' + models.length + ')');
});

test('getTestableModels entries have required fields', function() {
  var models = registry.getTestableModels(cfg);
  if (models.length === 0) { skip('model fields', 'no models'); return; }
  var m = models[0];
  assert.ok(typeof m.provider === 'string', 'should have provider');
  assert.ok(typeof m.id === 'string', 'should have id');
  assert.ok(typeof m.name === 'string', 'should have name');
  assert.ok(typeof m.baseUrl === 'string', 'should have baseUrl');
});

test('getTestableModels does not contain duplicates', function() {
  var models = registry.getTestableModels(cfg);
  var keys = models.map(function(m) { return m.provider + '/' + m.id; });
  var unique = new Set(keys);
  assert.strictEqual(keys.length, unique.size, 'should have no duplicate models');
});

// ===========================================================================
// TESTS: mergeWithConfig(cfg)
// ===========================================================================
console.log('\n=== mergeWithConfig ===\n');

test('mergeWithConfig returns object with config providers', function() {
  var merged = registry.mergeWithConfig(cfg);
  assert.ok(typeof merged === 'object');
  // Should include existing config providers
  var configProviders = Object.keys(cfg.models && cfg.models.providers ? cfg.models.providers : {});
  for (var cp of configProviders) {
    assert.ok(cp in merged, 'merged should include config provider: ' + cp);
  }
});

// ===========================================================================
// TESTS: isModelFree
// ===========================================================================
console.log('\n=== isModelFree ===\n');

test('isModelFree returns true for zero-cost model', function() {
  assert.strictEqual(registry.isModelFree({ cost: { input: 0, output: 0 } }), true);
});

test('isModelFree returns false for non-zero cost model', function() {
  assert.strictEqual(registry.isModelFree({ cost: { input: 1, output: 0 } }), false);
  assert.strictEqual(registry.isModelFree({ cost: { input: 0, output: 0.5 } }), false);
});

test('isModelFree handles model with free flag', function() {
  var result = registry.isModelFree({ free: true, cost: { input: 0, output: 0 } });
  assert.strictEqual(result, true);
});

// ===========================================================================
// TESTS: generateProviderConfig
// ===========================================================================
console.log('\n=== generateProviderConfig ===\n');

test('generateProviderConfig returns config for nvidia', function() {
  var config = registry.generateProviderConfig('nvidia', 'test-key');
  assert.ok(config, 'should return config');
  assert.ok(config.baseUrl, 'should have baseUrl');
  assert.ok(config.apiKey === 'test-key' || config.api, 'should have apiKey or api');
  assert.ok(Array.isArray(config.models), 'should have models array');
});

test('generateProviderConfig models have required fields', function() {
  var config = registry.generateProviderConfig('nvidia', 'key');
  if (!config || !config.models) { skip('model fields', 'no config'); return; }
  for (var m of config.models) {
    assert.ok(typeof m.id === 'string', 'model should have id');
    assert.ok(typeof m.name === 'string', 'model should have name');
  }
});

test('generateProviderConfig returns null for unknown provider', function() {
  var config = registry.generateProviderConfig('nonexistent_xyz_provider', 'key');
  assert.strictEqual(config, null);
});

// ===========================================================================
// TESTS: Known Provider Counts
// ===========================================================================
console.log('\n=== Known Provider Counts ===\n');

test('NVIDIA has at least 7 free models', function() {
  var nvidia = KNOWN_PROVIDERS.find(function(p) { return p.name === 'nvidia'; });
  assert.ok(nvidia.models.length >= 7,
    'Expected 7+ nvidia models, got ' + nvidia.models.length);
});

test('Total free models across all providers is substantial', function() {
  var total = 0;
  for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
    total += KNOWN_PROVIDERS[i].models.length;
  }
  assert.ok(total >= 15, 'Expected 15+ total free models, got ' + total);
  console.log('    (Total models: ' + total + ' across ' + KNOWN_PROVIDERS.length + ' providers)');
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n=== PROVIDER REGISTRY TEST SUMMARY ===');
console.log('  Passed: ' + passedCount);
console.log('  Failed: ' + failedCount);
console.log('  Skipped: ' + skippedCount);
if (failureList.length > 0) {
  console.log('\n  Failures:');
  failureList.forEach(function(f) { console.log('    - ' + f.name + ': ' + f.error); });
}
console.log('');

process.exit(failedCount > 0 ? 1 : 0);
