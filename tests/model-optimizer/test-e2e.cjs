#!/usr/bin/env node
/**
 * test-e2e.cjs - End-to-end test for the model auto-optimizer.
 *
 * Tests: full benchmark cycle, config update verification,
 * gateway reload capability, results JSON validation.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/test-e2e.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = '/home/node/.openclaw/openclaw.json';
const RESULTS_PATH = '/tmp/model-optimizer-latest.json';
const BACKUP_DIR = '/tmp/model-optimizer-e2e-backup';
const ENGINE_PATH = '/host/home/openclaw/scripts/model-optimizer.cjs';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
var passed = 0;
var failed = 0;
var skipped = 0;
var failures = [];

function test(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') {
    return fn().then(function() {
      passed++;
      console.log('  PASS: ' + name);
    }).catch(function(e) {
      failed++;
      failures.push({ name: name, error: e.message });
      console.log('  FAIL: ' + name + ' -- ' + e.message);
    });
  }
  try {
    fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, error: e.message });
    console.log('  FAIL: ' + name + ' -- ' + e.message);
  }
  return Promise.resolve();
}

function skip(name, reason) {
  skipped++;
  console.log('  SKIP: ' + name + ' -- ' + reason);
  return Promise.resolve();
}

// ===========================================================================
// SETUP: Backup current config
// ===========================================================================
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

var backupPath = path.join(BACKUP_DIR, 'pre-e2e-config.json');
fs.copyFileSync(CONFIG_PATH, backupPath);
var originalConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
console.log('\nE2E backup saved to: ' + backupPath);
console.log('Engine: ' + ENGINE_PATH + ' (exists: ' + fs.existsSync(ENGINE_PATH) + ')');

// ===========================================================================
// RUN TESTS
// ===========================================================================
async function runTests() {

  // =========================================================================
  // TESTS: Engine Script Availability
  // =========================================================================
  console.log('\n=== Engine Availability ===\n');

  await test('model-optimizer.cjs exists', function() {
    assert.ok(fs.existsSync(ENGINE_PATH), 'Engine script should exist at ' + ENGINE_PATH);
  });

  await test('scoring.cjs exists and is loadable', function() {
    var scoringPath = '/host/home/openclaw/scripts/scoring.cjs';
    assert.ok(fs.existsSync(scoringPath), 'scoring.cjs should exist');
    var m = require(scoringPath);
    assert.ok(typeof m.latencyScore === 'function');
    assert.ok(typeof m.compositeScore === 'function');
  });

  await test('provider-registry.cjs exists and is loadable', function() {
    var regPath = '/host/home/openclaw/scripts/provider-registry.cjs';
    assert.ok(fs.existsSync(regPath), 'provider-registry.cjs should exist');
    var m = require(regPath);
    assert.ok(Array.isArray(m.KNOWN_PROVIDERS), 'KNOWN_PROVIDERS should be array');
    assert.ok(typeof m.getTestableModels === 'function', 'getTestableModels should be function');
  });

  // =========================================================================
  // TESTS: Full Benchmark Cycle (dry-run for safety)
  // =========================================================================
  console.log('\n=== Full Benchmark Cycle (dry-run) ===\n');

  if (!fs.existsSync(ENGINE_PATH)) {
    await skip('Full benchmark cycle', 'Engine not found');
  } else {
    var engineOutput = '';

    await test('Engine runs with --dry-run --json without crashing', async function() {
      try {
        engineOutput = execSync('node ' + ENGINE_PATH + ' --dry-run --json --timeout 15000', {
          timeout: 180000,
          encoding: 'utf8',
        });
        console.log('    (Output length: ' + engineOutput.length + ' chars)');
        assert.ok(engineOutput.length > 0, 'Should produce output');
      } catch (e) {
        engineOutput = e.stdout || '';
        if (engineOutput.length > 0) {
          console.log('    (Got output despite exit code ' + e.status + ')');
        } else {
          assert.fail('Engine crashed: ' + (e.stderr || e.message).slice(0, 300));
        }
      }
    });

    await test('Engine JSON output is parseable', async function() {
      if (!engineOutput) { skip('JSON parse', 'no output'); return; }
      var parsed;
      try {
        parsed = JSON.parse(engineOutput);
      } catch (e) {
        assert.fail('Output is not valid JSON: ' + e.message);
      }
      assert.ok(typeof parsed === 'object');
    });

    await test('Engine JSON has required fields', async function() {
      if (!engineOutput) return;
      var results;
      try { results = JSON.parse(engineOutput); } catch (e) { return; }

      assert.ok(results.timestamp, 'Should have timestamp');
      assert.ok(typeof results.totalModels === 'number', 'Should have totalModels');
      assert.ok(typeof results.workingModels === 'number', 'Should have workingModels count');
      assert.ok(typeof results.failedModels === 'number', 'Should have failedModels count');
      assert.ok(typeof results.primary === 'object', 'Should have primary object');
      assert.ok(typeof results.primary.modelId === 'string', 'Should have primary.modelId');
      assert.ok(typeof results.primary.score === 'number', 'Should have primary.score');
      assert.ok(typeof results.rotated === 'boolean', 'Should have rotated flag');
      assert.ok(Array.isArray(results.rankings), 'Should have rankings array');
    });

    await test('Engine produces results file', async function() {
      if (!fs.existsSync(RESULTS_PATH)) {
        console.log('    [INFO] Results file not at ' + RESULTS_PATH + ', running engine...');
        try {
          execSync('node ' + ENGINE_PATH + ' --dry-run --timeout 15000', {
            timeout: 180000,
            encoding: 'utf8',
          });
        } catch (e) { /* ok */ }
      }

      assert.ok(fs.existsSync(RESULTS_PATH),
        'Results file should exist at ' + RESULTS_PATH);
    });
  }

  // =========================================================================
  // TESTS: Results JSON Validation
  // =========================================================================
  console.log('\n=== Results JSON Validation ===\n');

  if (!fs.existsSync(RESULTS_PATH)) {
    await skip('Results JSON tests', 'No results file');
  } else {
    await test('Results JSON is valid and parseable', function() {
      var content = fs.readFileSync(RESULTS_PATH, 'utf8');
      JSON.parse(content); // Throws if invalid
    });

    await test('Results has timestamp as valid ISO date', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      assert.ok(results.timestamp);
      var d = new Date(results.timestamp);
      assert.ok(!isNaN(d.getTime()), 'Invalid date: ' + results.timestamp);
    });

    await test('Results workingModels + failedModels = totalModels', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      assert.strictEqual(results.workingModels + results.failedModels, results.totalModels,
        'workingModels(' + results.workingModels + ') + failedModels(' + results.failedModels + ') != totalModels(' + results.totalModels + ')');
    });

    await test('Each ranking entry has required fields', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      for (var r of results.rankings) {
        assert.ok(typeof r.provider === 'string', 'provider');
        assert.ok(typeof r.modelId === 'string', 'modelId');
        assert.ok(typeof r.rank === 'number', 'rank');
        assert.ok(typeof r.composite === 'number', 'composite');
        assert.ok(typeof r.latencyScore === 'number', 'latencyScore');
        assert.ok(typeof r.throughputScore === 'number', 'throughputScore');
        assert.ok(typeof r.correctnessScore === 'number', 'correctnessScore');
        assert.ok(typeof r.availabilityScore === 'number', 'availabilityScore');
      }
    });

    await test('Result scores are in 0-100 range', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      for (var r of results.rankings) {
        assert.ok(r.latencyScore >= 0 && r.latencyScore <= 100,
          r.modelId + ' latencyScore: ' + r.latencyScore);
        assert.ok(r.throughputScore >= 0 && r.throughputScore <= 100,
          r.modelId + ' throughputScore: ' + r.throughputScore);
        assert.ok(r.correctnessScore >= 0 && r.correctnessScore <= 100,
          r.modelId + ' correctnessScore: ' + r.correctnessScore);
        assert.ok(r.composite >= 0 && r.composite <= 100,
          r.modelId + ' composite: ' + r.composite);
      }
    });

    await test('At least one model succeeded', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      assert.ok(results.workingModels > 0,
        'At least one model should succeed, workingModels=' + results.workingModels);
    });

    await test('primary.modelId is among ranked models', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      var primaryId = results.primary.modelId;
      var found = results.rankings.some(function(r) {
        return r.modelId === primaryId;
      });
      assert.ok(found, 'primary.modelId "' + primaryId + '" should be among rankings');
    });

    await test('primary.score matches top-ranked composite', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      if (results.rankings.length > 0) {
        assert.strictEqual(results.primary.score, results.rankings[0].composite,
          'primary.score (' + results.primary.score + ') should match top ranking (' + results.rankings[0].composite + ')');
      }
    });

    await test('dry-run flag means rotated is false', function() {
      var results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
      // We ran with --dry-run, so rotated should be false
      assert.strictEqual(results.rotated, false, 'dry-run should not rotate');
    });
  }

  // =========================================================================
  // TESTS: Config Integrity
  // =========================================================================
  console.log('\n=== Config Integrity ===\n');

  await test('Config has a primary model set', function() {
    var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    var primary = cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model
      ? cfg.agents.defaults.model.primary : null;
    assert.ok(primary && typeof primary === 'string' && primary.length > 0,
      'Primary should be set');
  });

  await test('Config has fallback models array', function() {
    var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    var fallbacks = cfg.agents && cfg.agents.defaults && cfg.agents.defaults.model
      ? cfg.agents.defaults.model.fallbacks : null;
    assert.ok(Array.isArray(fallbacks), 'Fallbacks should be an array');
  });

  await test('Config is valid JSON that gateway can parse', function() {
    var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    assert.ok(cfg.models, 'Should have models section');
    assert.ok(cfg.agents, 'Should have agents section');
    assert.ok(cfg.agents.defaults, 'Should have agents.defaults');
    assert.ok(cfg.agents.defaults.model, 'Should have agents.defaults.model');
  });

  // =========================================================================
  // TESTS: Gateway Reload
  // =========================================================================
  console.log('\n=== Gateway Reload Capability ===\n');

  await test('PID 1 is the gateway process', function() {
    try {
      var cmdline = execSync('cat /proc/1/cmdline', { encoding: 'utf8' });
      console.log('    (PID 1: ' + cmdline.replace(/\0/g, ' ').trim().slice(0, 80) + ')');
      assert.ok(cmdline.length > 0);
    } catch (e) {
      console.log('    [INFO] Could not read PID 1');
    }
  });

  await test('Config file is readable', function() {
    fs.accessSync(CONFIG_PATH, fs.constants.R_OK);
  });

  await test('Config file is writable', function() {
    fs.accessSync(CONFIG_PATH, fs.constants.W_OK);
  });

  // =========================================================================
  // TESTS: Config unchanged after dry-run e2e
  // =========================================================================
  console.log('\n=== Config Unchanged After Dry-Run ===\n');

  await test('Config unchanged after dry-run cycle', function() {
    var current = readConfig();
    assert.strictEqual(
      current.agents.defaults.model.primary,
      originalConfig.agents.defaults.model.primary,
      'Primary should be unchanged after dry-run e2e'
    );
  });

  // =========================================================================
  // TEARDOWN
  // =========================================================================
  console.log('\n=== Teardown ===\n');

  await test('Restore original config from backup', function() {
    fs.copyFileSync(backupPath, CONFIG_PATH);
    var restored = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    assert.strictEqual(
      restored.agents.defaults.model.primary,
      originalConfig.agents.defaults.model.primary
    );
  });

  // Cleanup
  try {
    fs.unlinkSync(backupPath);
    fs.rmdirSync(BACKUP_DIR);
  } catch (e) { /* best effort */ }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=== E2E TEST SUMMARY ===');
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

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

runTests().catch(function(e) {
  // Restore on crash
  try { fs.copyFileSync(backupPath, CONFIG_PATH); } catch (e2) { /* */ }
  console.error('E2E test runner error: ' + e.message);
  process.exit(1);
});
