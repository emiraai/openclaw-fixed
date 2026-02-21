#!/usr/bin/env node
/**
 * run.cjs - Skill runner for model-optimizer.
 * Thin wrapper that invokes the core engine from the skill context.
 * Called by OpenClaw when the skill triggers.
 *
 * The core engine lives at /host/home/openclaw/scripts/model-optimizer.cjs
 * (or relative to this file at ../../../scripts/model-optimizer.cjs).
 *
 * If no flags are passed, defaults to --auto (benchmark + rotate).
 */
"use strict";

var childProcess = require("child_process");
var path = require("path");

// Resolve engine path (works both in container and locally)
var enginePath = path.resolve(__dirname, "..", "..", "..", "scripts", "model-optimizer.cjs");

// Forward all CLI args; default to --auto if no args given
var args = process.argv.slice(2);
if (args.length === 0) {
  args.push("--auto");
}

var cmd = "node";
var cmdArgs = [enginePath].concat(args);

try {
  var result = childProcess.spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    timeout: 300000, // 5 minute max
    env: process.env,
  });

  if (result.error) {
    console.error("Skill runner error: " + result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
} catch (e) {
  console.error("Skill runner error: " + (e.message || e));
  process.exit(1);
}
