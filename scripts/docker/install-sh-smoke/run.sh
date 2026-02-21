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

resolve_cli_path() {
  local cli_name="$1"
  local candidate=""

  candidate="$(command -v "$cli_name" || true)"
  if [[ -n "$candidate" ]]; then
    printf "%s" "$candidate"
    return 0
  fi

  local npm_prefix=""
  npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "$npm_prefix" && "$npm_prefix" != "undefined" && -x "$npm_prefix/bin/$cli_name" ]]; then
    printf "%s" "$npm_prefix/bin/$cli_name"
    return 0
  fi

  local fallback_bin=""
  for fallback_bin in /usr/local/bin /usr/bin "$HOME/.npm-global/bin" "$HOME/.local/bin"; do
    if [[ -x "$fallback_bin/$cli_name" ]]; then
      printf "%s" "$fallback_bin/$cli_name"
      return 0
    fi
  done

  return 1
}

resolve_cli_entrypoint_from_package() {
  local pkg_name="$1"
  local npm_root=""
  npm_root="$(npm root -g 2>/dev/null || true)"
  if [[ -z "$npm_root" || "$npm_root" == "undefined" ]]; then
    return 1
  fi

  local pkg_dir="$npm_root/$pkg_name"
  local pkg_json="$pkg_dir/package.json"
  if [[ ! -f "$pkg_json" ]]; then
    return 1
  fi

  local bin_rel=""
  bin_rel="$(node -e '
const fs = require("fs");
const pkgPath = process.argv[1];
const pkgName = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const bin = pkg?.bin;
let rel = "";
if (typeof bin === "string") {
  rel = bin;
} else if (bin && typeof bin === "object") {
  rel = bin[pkgName] || Object.values(bin).find((value) => typeof value === "string") || "";
}
if (typeof rel === "string" && rel.length > 0) {
  process.stdout.write(rel);
}
' "$pkg_json" "$pkg_name" 2>/dev/null || true)"
  if [[ -z "$bin_rel" ]]; then
    return 1
  fi

  if [[ -f "$pkg_dir/$bin_rel" ]]; then
    printf "%s" "$pkg_dir/$bin_rel"
    return 0
  fi

  return 1
}

echo "==> Verify installed version"
CLI_NAME="$PACKAGE_NAME"
CMD_PATH="$(resolve_cli_path "$CLI_NAME" || true)"
CMD_ENTRYPOINT=""
if [[ -z "$CMD_PATH" ]]; then
  CMD_ENTRYPOINT="$(resolve_cli_entrypoint_from_package "$CLI_NAME" || true)"
fi
if [[ -z "$CMD_PATH" && -z "$CMD_ENTRYPOINT" ]]; then
  echo "ERROR: $PACKAGE_NAME is not on PATH" >&2
  echo "PATH=$PATH" >&2
  echo "npm-prefix=$(npm config get prefix 2>/dev/null || true)" >&2
  echo "npm-root=$(npm root -g 2>/dev/null || true)" >&2
  exit 1
fi
if [[ -n "${OPENCLAW_INSTALL_LATEST_OUT:-}" ]]; then
  printf "%s" "$LATEST_VERSION" > "${OPENCLAW_INSTALL_LATEST_OUT:-}"
fi
INSTALLED_VERSION=""
if [[ -n "$CMD_PATH" ]]; then
  INSTALLED_VERSION="$("$CMD_PATH" --version 2>/dev/null | head -n 1 | tr -d '\r')"
  echo "cli=$CLI_NAME cmd=$CMD_PATH installed=$INSTALLED_VERSION expected=$LATEST_VERSION"
else
  INSTALLED_VERSION="$(node "$CMD_ENTRYPOINT" --version 2>/dev/null | head -n 1 | tr -d '\r')"
  echo "cli=$CLI_NAME entrypoint=$CMD_ENTRYPOINT installed=$INSTALLED_VERSION expected=$LATEST_VERSION"
fi

if [[ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]]; then
  echo "ERROR: expected ${CLI_NAME}@${LATEST_VERSION}, got ${CLI_NAME}@${INSTALLED_VERSION}" >&2
  exit 1
fi

echo "==> Sanity: CLI runs"
if [[ -n "$CMD_PATH" ]]; then
  "$CMD_PATH" --help >/dev/null
else
  node "$CMD_ENTRYPOINT" --help >/dev/null
fi

echo "OK"
