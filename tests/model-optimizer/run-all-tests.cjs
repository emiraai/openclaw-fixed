#!/usr/bin/env node
/**
 * run-all-tests.cjs - Runs all model-optimizer test suites in order.
 *
 * Run inside Docker:
 *   MSYS_NO_PATHCONV=1 docker exec openclaw-openclaw-gateway-1 \
 *     node /host/home/openclaw/tests/model-optimizer/run-all-tests.cjs
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_DIR = '/host/home/openclaw/tests/model-optimizer';
const REPORT_PATH = '/host/home/openclaw/.workshop/test-results.md';

const TESTS = [
  { file: 'test-scoring.cjs',           name: 'Scoring (Unit)',             type: 'unit' },
  { file: 'test-provider-registry.cjs', name: 'Provider Registry (Unit)',   type: 'unit' },
  { file: 'test-live-benchmark.cjs',    name: 'Live Benchmark (Integration)', type: 'integration' },
  { file: 'test-config-update.cjs',     name: 'Config Update (Integration)',  type: 'integration' },
  { file: 'test-e2e.cjs',              name: 'End-to-End',                 type: 'e2e' },
];

const results = [];
let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

console.log('=================================================');
console.log('  Model Optimizer Test Suite');
console.log('  ' + new Date().toISOString());
console.log('=================================================\n');

for (const t of TESTS) {
  const filePath = path.join(TEST_DIR, t.file);
  console.log('--- Running: ' + t.name + ' (' + t.file + ') ---\n');

  if (!fs.existsSync(filePath)) {
    console.log('  [ERROR] File not found: ' + filePath);
    results.push({ name: t.name, file: t.file, type: t.type, status: 'MISSING', output: '', exitCode: -1 });
    continue;
  }

  let output = '';
  let exitCode = 0;
  const start = performance.now();

  try {
    output = execSync('node ' + filePath, {
      timeout: 180000, // 3 min per suite
      encoding: 'utf8',
      env: process.env,
    });
    console.log(output);
  } catch (e) {
    exitCode = e.status || 1;
    output = (e.stdout || '') + (e.stderr || '');
    console.log(output);
  }

  const elapsed = Math.round(performance.now() - start);

  // Parse summary from output
  const passMatch = output.match(/Passed:\s*(\d+)/);
  const failMatch = output.match(/Failed:\s*(\d+)/);
  const skipMatch = output.match(/Skipped:\s*(\d+)/);

  const p = passMatch ? parseInt(passMatch[1], 10) : 0;
  const f = failMatch ? parseInt(failMatch[1], 10) : 0;
  const s = skipMatch ? parseInt(skipMatch[1], 10) : 0;

  totalPassed += p;
  totalFailed += f;
  totalSkipped += s;

  results.push({
    name: t.name,
    file: t.file,
    type: t.type,
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    passed: p,
    failed: f,
    skipped: s,
    elapsed: elapsed,
    output: output,
    exitCode: exitCode,
  });

  console.log('');
}

// ===========================================================================
// GRAND SUMMARY
// ===========================================================================
console.log('=================================================');
console.log('  GRAND SUMMARY');
console.log('=================================================\n');

for (const r of results) {
  const icon = r.status === 'PASS' ? 'OK' : r.status === 'MISSING' ? '??' : 'XX';
  console.log('  [' + icon + '] ' + r.name.padEnd(35) + ' P:' + (r.passed || 0) + ' F:' + (r.failed || 0) + ' S:' + (r.skipped || 0) + ' (' + (r.elapsed || 0) + 'ms)');
}

console.log('\n  Total: ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalSkipped + ' skipped');
console.log('  Overall: ' + (totalFailed === 0 ? 'ALL PASS' : 'FAILURES DETECTED'));
console.log('');

// ===========================================================================
// WRITE REPORT
// ===========================================================================
const reportDir = path.dirname(REPORT_PATH);
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

let report = '# Model Optimizer Test Results\n\n';
report += '**Date**: ' + new Date().toISOString() + '\n';
report += '**Overall**: ' + (totalFailed === 0 ? 'ALL PASS' : 'FAILURES DETECTED') + '\n';
report += '**Totals**: ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalSkipped + ' skipped\n\n';
report += '## Suite Results\n\n';
report += '| Suite | Type | Status | Pass | Fail | Skip | Time |\n';
report += '|-------|------|--------|------|------|------|------|\n';

for (const r of results) {
  report += '| ' + r.name + ' | ' + r.type + ' | ' + r.status + ' | ' + (r.passed || 0) + ' | ' + (r.failed || 0) + ' | ' + (r.skipped || 0) + ' | ' + (r.elapsed || 0) + 'ms |\n';
}

if (totalFailed > 0) {
  report += '\n## Failures\n\n';
  for (const r of results) {
    if (r.status === 'FAIL') {
      report += '### ' + r.name + '\n\n';
      // Extract failure lines
      const failLines = r.output.split('\n').filter(l => l.includes('FAIL:'));
      for (const l of failLines) {
        report += '- ' + l.trim() + '\n';
      }
      report += '\n';
    }
  }
}

report += '\n## Full Output\n\n';
for (const r of results) {
  report += '### ' + r.name + '\n\n```\n' + (r.output || '(no output)').slice(0, 3000) + '\n```\n\n';
}

fs.writeFileSync(REPORT_PATH, report);
console.log('Report saved to: ' + REPORT_PATH);

process.exit(totalFailed > 0 ? 1 : 0);
