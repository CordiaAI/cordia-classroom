#!/usr/bin/env bash
# Redesign gate: runs the same steps as the "verify" job in .github/workflows/release-checks.yml,
# in the same order and from the same folders, so nothing merges that CI would reject.
# Local differences from CI: python3 instead of python (this Mac has no "python"), a private
# virtualenv (.gate-venv) instead of a fresh runner, and installs skipped when the lockfiles
# haven't changed since the last run. The "oauth-lockdown" job needs Docker and a local
# Supabase stack, so it runs only with RUN_OAUTH_PROBE=1; otherwise it runs in CI on the PR.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

step() { printf '\n== %s\n' "$1"; }
hash_of() { shasum "$@" 2>/dev/null | shasum | cut -d' ' -f1; }

# Keep the gate's own files out of git without touching .gitignore.
grep -qxF '.gate-venv/' .git/info/exclude 2>/dev/null || echo '.gate-venv/' >> .git/info/exclude

step "Node version (CI uses 22)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
echo "node $(node --version)"
[ "$NODE_MAJOR" = "22" ] || echo "Note: CI uses Node 22; results can differ on Node $NODE_MAJOR."

step "Raw colour values outside tokens.css in files this branch changed"
BASE="$(git merge-base HEAD origin/main)"
CHANGED="$(git diff --name-only --diff-filter=AM "$BASE" -- web | grep -E '\.(js|jsx|ts|tsx|css)$' | grep -v 'tokens\.css$' || true)"
# One exception: the browser's <meta name="theme-color"> cannot read a CSS variable, and its value
# is the same on main. Every other raw colour in a changed file fails.
if [ -n "$CHANGED" ] && echo "$CHANGED" | xargs grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' | grep -v '<meta name="theme-color"' ; then
  echo "FAIL: colour values found outside tokens.css. Move them into tokens.css as tokens."
  exit 1
fi
echo "none"

step "pip install -r backend/requirements.txt pyflakes"
[ -x .gate-venv/bin/python ] || python3 -m venv .gate-venv
PY="$ROOT/.gate-venv/bin/python"
REQ_HASH="$(hash_of backend/requirements.txt)"
if [ "$(cat .gate-venv/.req-hash 2>/dev/null)" != "$REQ_HASH" ]; then
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r backend/requirements.txt pyflakes
  echo "$REQ_HASH" > .gate-venv/.req-hash
else
  echo "unchanged since last run"
fi

step "python -m pyflakes backend"
"$PY" -m pyflakes backend

step "npm ci"
ROOT_LOCK="$(hash_of package-lock.json)"
if [ ! -d node_modules ] || [ "$(cat node_modules/.gate-lock-hash 2>/dev/null)" != "$ROOT_LOCK" ]; then
  npm ci
  echo "$ROOT_LOCK" > node_modules/.gate-lock-hash
else
  echo "unchanged since last run"
fi

step "npx playwright install chromium"
npx playwright install chromium

step "npm ci --prefix web"
WEB_LOCK="$(hash_of web/package-lock.json)"
if [ ! -d web/node_modules ] || [ "$(cat web/node_modules/.gate-lock-hash 2>/dev/null)" != "$WEB_LOCK" ]; then
  npm ci --prefix web
  echo "$WEB_LOCK" > web/node_modules/.gate-lock-hash
else
  echo "unchanged since last run"
fi

step "python -m unittest discover -s tests -v"
"$PY" scripts/redesign-unittest.py

step "npm test (same files as the npm test script, minus Mac-only failures; CI runs them all)"
# tests/extension-load.test.cjs expects "Ctrl+Shift+Y"; Chrome on a Mac shows "⇧⌘Y". Passes in CI on Linux.
NODE_TEST_FILES="$(ls tests/*.js tests/*.cjs web/tests/*.mjs | grep -v '^tests/extension-load.test.cjs$')"
echo "skipped locally (CI still runs it): tests/extension-load.test.cjs"
node --test $NODE_TEST_FILES

step "npm run build --prefix web"
npm run build --prefix web

step "node web/scripts/seoCheck.mjs --skip-build"
node web/scripts/seoCheck.mjs --skip-build

if [ "${RUN_OAUTH_PROBE:-0}" = "1" ]; then
  step "bash tests/oauth/run_local_probe.sh (oauth-lockdown job)"
  bash tests/oauth/run_local_probe.sh
else
  step "oauth-lockdown job"
  echo "skipped locally (needs Docker); it runs in CI on the pull request. Set RUN_OAUTH_PROBE=1 to run it here."
fi

printf '\nGATE PASSED\n'
