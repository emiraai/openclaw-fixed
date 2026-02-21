#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL="${OPENCLAW_INSTALL_URL:-https://openclaw.bot/install.sh}"
SMOKE_PREVIOUS_VERSION="${OPENCLAW_INSTALL_SMOKE_PREVIOUS:-}"
SKIP_PREVIOUS="${OPENCLAW_INSTALL_SMOKE_SKIP_PREVIOUS:-0}"
DEFAULT_PACKAGE="openclaw"
PACKAGE_NAME="${OPENCLAW_INSTALL_PACKAGE:-$DEFAULT_PACKAGE}"

echo "==> Resolve npm versions"
LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"
if [[ -n "$SMOKE_PREVIOUS_VERSION" ]]; then
  PREVIOUS_VERSION="$SMOKE_PREVIOUS_VERSION"
else
  VERSIONS_JSON="$(npm view "$PACKAGE_NAME" versions --json)"
  PREVIOUS_VERSION="$(VERSIONS_JSON="$VERSIONS_JSON" LATEST_VERSION="$LATEST_VERSION" node - <<'NODE'
const raw = process.env.VERSIONS_JSON || "[]";
const latest = process.env.LATEST_VERSION || "";
let versions;
try {
  versions = JSON.parse(raw);
} catch {
  versions = raw ? [raw] : [];
}
if (!Array.isArray(versions)) {
  versions = [versions];
}
if (versions.length === 0) {
  process.exit(1);
}
const latestIndex = latest ? versions.lastIndexOf(latest) : -1;
if (latestIndex > 0) {
  process.stdout.write(String(versions[latestIndex - 1]));
  process.exit(0);
}
process.stdout.write(String(latest || versions[versions.length - 1]));
NODE
)"
fi

echo "package=$PACKAGE_NAME latest=$LATEST_VERSION previous=$PREVIOUS_VERSION"

if [[ "$SKIP_PREVIOUS" == "1" ]]; then
  echo "==> Skip preinstall previous (OPENCLAW_INSTALL_SMOKE_SKIP_PREVIOUS=1)"
else
  echo "==> Preinstall previous (forces installer upgrade path)"
  npm install -g "${PACKAGE_NAME}@${PREVIOUS_VERSION}"
fi

echo "==> Run official installer one-liner"
curl -fsSL "$INSTALL_URL" | bash

echo "==> Verify installed version"
CLI_NAME="$PACKAGE_NAME"
CLI_CMD=("$CLI_NAME")
RESOLVED_CLI=""
if ! command -v "$CLI_NAME" >/dev/null 2>&1; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  NPM_PREFIX="${NPM_PREFIX//$'\r'/}"
  NPM_GLOBAL_BIN=""
  if [[ -n "$NPM_PREFIX" && "$NPM_PREFIX" != "undefined" ]]; then
    NPM_GLOBAL_BIN="${NPM_PREFIX%/}/bin"
  fi

  if [[ -n "$NPM_GLOBAL_BIN" && -x "$NPM_GLOBAL_BIN/$CLI_NAME" ]]; then
    export PATH="$NPM_GLOBAL_BIN:$PATH"
    RESOLVED_CLI="$NPM_GLOBAL_BIN/$CLI_NAME"
  fi
fi
if [[ -z "$RESOLVED_CLI" ]] && command -v "$CLI_NAME" >/dev/null 2>&1; then
  RESOLVED_CLI="$(command -v "$CLI_NAME")"
fi
if [[ -z "$RESOLVED_CLI" ]]; then
  NPM_ROOT="$(npm root -g 2>/dev/null || true)"
  NPM_ROOT="${NPM_ROOT//$'\r'/}"
  if [[ -n "$NPM_ROOT" && -f "$NPM_ROOT/$CLI_NAME/dist/entry.js" ]]; then
    RESOLVED_CLI="$NPM_ROOT/$CLI_NAME/dist/entry.js"
    CLI_CMD=(node "$RESOLVED_CLI")
  fi
fi
if [[ -z "$RESOLVED_CLI" ]]; then
  echo "ERROR: $PACKAGE_NAME is not on PATH" >&2
  exit 1
fi
if [[ -n "${OPENCLAW_INSTALL_LATEST_OUT:-}" ]]; then
  printf "%s" "$LATEST_VERSION" > "${OPENCLAW_INSTALL_LATEST_OUT:-}"
fi
INSTALLED_VERSION="$("${CLI_CMD[@]}" --version 2>/dev/null | head -n 1 | tr -d '\r')"
echo "cli=$CLI_NAME installed=$INSTALLED_VERSION expected=$LATEST_VERSION"

if [[ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]]; then
  echo "ERROR: expected ${CLI_NAME}@${LATEST_VERSION}, got ${CLI_NAME}@${INSTALLED_VERSION}" >&2
  exit 1
fi

echo "==> Sanity: CLI runs"
"${CLI_CMD[@]}" --help >/dev/null

echo "OK"
