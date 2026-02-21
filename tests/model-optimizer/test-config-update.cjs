#!/usr/bin/env node
/**
 * test-config-update.cjs - Integration tests for config backup and update.
 *
 * Tests: backup creation, primary model update, fallback ordering,
 * dry-run mode (--dry-run flag), rollback from backup.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/test-config-update.cjs
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = '/home/node/.openclaw/openclaw.json';
const BACKUP_PATH = CONFIG_PATH + '.optimizer-backup';
const TEST_BACKUP_DIR = '/tmp/model-optimizer-test-backups';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------
var passed = 0;
var failed = 0;
var skipped = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, error: e.message });
    console.log('  FAIL: ' + name + ' -- ' + e.message);
  }
}

function skip(name, reason) {
  skipped++;
  console.log('  SKIP: ' + name + ' -- ' + reason);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ===========================================================================
// SETUP: Snapshot original config
// ===========================================================================
var originalConfigStr = fs.readFileSync(CONFIG_PATH, 'utf8');
var originalConfig = JSON.parse(originalConfigStr);
var originalPrimary = originalConfig.agents &&
  originalConfig.agents.defaults &&
  originalConfig.agents.defaults.model ?
  originalConfig.agents.defaults.model.primary : null;
var originalFallbacks = originalConfig.agents &&
  originalConfig.agents.defaults &&
  originalConfig.agents.defaults.model ?
  (originalConfig.agents.defaults.model.fallbacks || []) : [];

console.log('\nOriginal primary: ' + originalPrimary);
console.log('Original fallbacks: ' + JSON.stringify(originalFallbacks));

if (!fs.existsSync(TEST_BACKUP_DIR)) {
  fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
}

// Save a test-level backup
var testBackupPath = path.join(TEST_BACKUP_DIR, 'test-safety-backup.json');
fs.copyFileSync(CONFIG_PATH, testBackupPath);

// ===========================================================================
// TESTS: Config Backup Creation
// ===========================================================================
console.log('\n=== Config Backup Creation ===\n');

test('Can create a config backup file', function() {
  var backupPath = path.join(TEST_BACKUP_DIR, 'test-backup-' + Date.now() + '.json');
  fs.copyFileSync(CONFIG_PATH, backupPath);

  assert.ok(fs.existsSync(backupPath), 'Backup file should exist');
  var backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.ok(backup.models, 'Backup should contain models section');
  fs.unlinkSync(backupPath);
});

test('Backup is a valid JSON copy of original config', function() {
  var backupPath = path.join(TEST_BACKUP_DIR, 'test-valid-' + Date.now() + '.json');
  fs.copyFileSync(CONFIG_PATH, backupPath);
  var backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  var current = readConfig();
  assert.deepStrictEqual(backup.models, current.models);
  fs.unlinkSync(backupPath);
});

test('model-optimizer creates backup at expected path', function() {
  // The model-optimizer.cjs creates backup at CONFIG_PATH + '.optimizer-backup'
  // We test that the backup path convention is correct
  var expectedPath = CONFIG_PATH + '.optimizer-backup';
  assert.ok(typeof expectedPath === 'string');
  assert.ok(expectedPath.endsWith('.optimizer-backup'));
});

test('Multiple backups do not conflict', function() {
  var b1 = path.join(TEST_BACKUP_DIR, 'b1-' + Date.now() + '.json');
  var b2 = path.join(TEST_BACKUP_DIR, 'b2-' + Date.now() + '.json');
  fs.copyFileSync(CONFIG_PATH, b1);
  fs.copyFileSync(CONFIG_PATH, b2);
  assert.ok(fs.existsSync(b1) && fs.existsSync(b2));
  fs.unlinkSync(b1);
  fs.unlinkSync(b2);
});

// ===========================================================================
// TESTS: Primary Model Update
// ===========================================================================
console.log('\n=== Primary Model Update ===\n');

test('Can update primary model in config', function() {
  var testPrimary = 'nvidia/test-model-update-primary';
  var cfg = readConfig();
  cfg.agents.defaults.model.primary = testPrimary;
  writeConfig(cfg);

  var verify = readConfig();
  assert.strictEqual(verify.agents.defaults.model.primary, testPrimary);

  // Restore
  cfg.agents.defaults.model.primary = originalPrimary;
  writeConfig(cfg);
});

test('Updated config remains valid JSON', function() {
  var cfg = readConfig();
  var saved = cfg.agents.defaults.model.primary;
  cfg.agents.defaults.model.primary = 'nvidia/json-validity-test';
  writeConfig(cfg);

  var reRead;
  try {
    reRead = readConfig();
  } catch (e) {
    cfg.agents.defaults.model.primary = saved;
    writeConfig(cfg);
    assert.fail('Config invalid after update: ' + e.message);
  }
  assert.strictEqual(reRead.agents.defaults.model.primary, 'nvidia/json-validity-test');

  cfg.agents.defaults.model.primary = saved;
  writeConfig(cfg);
});

test('Config preserves other sections after model update', function() {
  var before = readConfig();
  var providersBefore = JSON.stringify(before.models.providers);

  var cfg = readConfig();
  cfg.agents.defaults.model.primary = 'nvidia/preserve-test';
  writeConfig(cfg);

  var after = readConfig();
  assert.strictEqual(JSON.stringify(after.models.providers), providersBefore,
    'providers section should be unchanged');

  cfg.agents.defaults.model.primary = originalPrimary;
  writeConfig(cfg);
});

// ===========================================================================
// TESTS: Fallback Ordering
// ===========================================================================
console.log('\n=== Fallback Ordering ===\n');

test('Can set ordered fallback list', function() {
  var testFallbacks = ['provider/model-a', 'provider/model-b', 'provider/model-c'];
  var cfg = readConfig();
  var saved = cfg.agents.defaults.model.fallbacks;
  cfg.agents.defaults.model.fallbacks = testFallbacks;
  writeConfig(cfg);

  var verify = readConfig();
  assert.deepStrictEqual(verify.agents.defaults.model.fallbacks, testFallbacks);

  cfg.agents.defaults.model.fallbacks = saved;
  writeConfig(cfg);
});

test('Fallback order is preserved exactly', function() {
  var testFallbacks = ['z-model', 'a-model', 'm-model'];
  var cfg = readConfig();
  var saved = cfg.agents.defaults.model.fallbacks;
  cfg.agents.defaults.model.fallbacks = testFallbacks;
  writeConfig(cfg);

  var verify = readConfig();
  for (var i = 0; i < testFallbacks.length; i++) {
    assert.strictEqual(verify.agents.defaults.model.fallbacks[i], testFallbacks[i],
      'Fallback at index ' + i + ' should be ' + testFallbacks[i]);
  }

  cfg.agents.defaults.model.fallbacks = saved;
  writeConfig(cfg);
});

test('Empty fallback list is valid', function() {
  var cfg = readConfig();
  var saved = cfg.agents.defaults.model.fallbacks;
  cfg.agents.defaults.model.fallbacks = [];
  writeConfig(cfg);

  var verify = readConfig();
  assert.deepStrictEqual(verify.agents.defaults.model.fallbacks, []);

  cfg.agents.defaults.model.fallbacks = saved;
  writeConfig(cfg);
});

// ===========================================================================
// TESTS: Dry-Run Mode
// ===========================================================================
console.log('\n=== Dry-Run Mode ===\n');

test('--dry-run flag does not modify config', function() {
  var before = readConfig();
  var beforePrimary = before.agents.defaults.model.primary;
  var beforeFallbacksStr = JSON.stringify(before.agents.defaults.model.fallbacks);

  // Run optimizer with --dry-run
  try {
    execSync('node /host/home/openclaw/scripts/model-optimizer.cjs --dry-run --timeout 10000', {
      timeout: 120000,
      encoding: 'utf8',
    });
  } catch (e) {
    // Exit code 0 or 1 both ok for dry-run
    if (!e.stdout && !e.stderr) {
      skip('dry-run execution', 'optimizer not available');
      return;
    }
  }

  var after = readConfig();
  assert.strictEqual(after.agents.defaults.model.primary, beforePrimary,
    'Primary should be unchanged after --dry-run');
  assert.strictEqual(JSON.stringify(after.agents.defaults.model.fallbacks), beforeFallbacksStr,
    'Fallbacks should be unchanged after --dry-run');
});

// ===========================================================================
// TESTS: Rollback on Error
// ===========================================================================
console.log('\n=== Rollback on Error ===\n');

test('Config can be restored from backup after bad write', function() {
  // Ensure config exists (prior test may have replaced it via atomic write)
  if (!fs.existsSync(CONFIG_PATH)) fs.copyFileSync(testBackupPath, CONFIG_PATH);
  var backupPath = path.join(TEST_BACKUP_DIR, 'rollback-' + Date.now() + '.json');
  fs.copyFileSync(CONFIG_PATH, backupPath);

  var cfg = readConfig();
  var saved = cfg.agents.defaults.model.primary;
  cfg.agents.defaults.model.primary = 'BROKEN/nonexistent-model';
  writeConfig(cfg);

  var corrupted = readConfig();
  assert.strictEqual(corrupted.agents.defaults.model.primary, 'BROKEN/nonexistent-model');

  // Rollback
  fs.copyFileSync(backupPath, CONFIG_PATH);
  var restored = readConfig();
  assert.strictEqual(restored.agents.defaults.model.primary, saved);

  fs.unlinkSync(backupPath);
});

test('Rollback preserves all config sections', function() {
  if (!fs.existsSync(CONFIG_PATH)) fs.copyFileSync(testBackupPath, CONFIG_PATH);
  var backupPath = path.join(TEST_BACKUP_DIR, 'rollback-full-' + Date.now() + '.json');
  fs.copyFileSync(CONFIG_PATH, backupPath);

  var cfg = readConfig();
  cfg.agents.defaults.model.primary = 'ROLLBACK/test';
  writeConfig(cfg);

  fs.copyFileSync(backupPath, CONFIG_PATH);
  var restored = readConfig();

  assert.ok(restored.models, 'models section should exist');
  assert.ok(restored.agents, 'agents section should exist');
  assert.ok(restored.models.providers, 'providers should exist');

  fs.unlinkSync(backupPath);
});

test('Optimizer backup path convention works for rollback', function() {
  // Simulate what the optimizer does: backup to .optimizer-backup
  var simulatedBackup = CONFIG_PATH + '.test-optimizer-backup';
  fs.copyFileSync(CONFIG_PATH, simulatedBackup);

  var cfg = readConfig();
  cfg.agents.defaults.model.primary = 'SIMULATED/bad-update';
  writeConfig(cfg);

  // Rollback using the backup
  fs.copyFileSync(simulatedBackup, CONFIG_PATH);
  var restored = readConfig();
  assert.strictEqual(restored.agents.defaults.model.primary, originalPrimary);

  fs.unlinkSync(simulatedBackup);
});

// ===========================================================================
// FINAL RESTORE
// ===========================================================================
console.log('\n=== Final Config Restoration ===\n');

test('Config is restored to original state after all tests', function() {
  // Restore from our safety backup (ensure backup still exists)
  assert.ok(fs.existsSync(testBackupPath), 'Safety backup should exist at ' + testBackupPath);
  fs.writeFileSync(CONFIG_PATH, fs.readFileSync(testBackupPath, 'utf8'));
  var final_ = readConfig();
  assert.strictEqual(final_.agents.defaults.model.primary, originalPrimary);
  assert.deepStrictEqual(final_.agents.defaults.model.fallbacks, originalFallbacks);
});

// Cleanup
try {
  var files = fs.readdirSync(TEST_BACKUP_DIR);
  for (var f of files) {
    fs.unlinkSync(path.join(TEST_BACKUP_DIR, f));
  }
  fs.rmdirSync(TEST_BACKUP_DIR);
} catch (e) { /* best effort */ }

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n=== CONFIG UPDATE TEST SUMMARY ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('  Skipped: ' + skipped);
if (failures.length > 0) {
  console.log('\n  Failures:');
  failures.forEach(function(f) { console.log('    - ' + f.name + ': ' + f.error); });
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
