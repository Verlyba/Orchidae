#!/usr/bin/env bash
# Orchiday — development environment bootstrap.
#
# Sets up everything needed to BUILD and VERIFY the app (TypeScript compile,
# pytest, i18n/HTML checks). It deliberately does NOT install LeRobot, torch
# or any robot drivers: those live in a separate Python environment that the
# app points at through its `python_path` setting, and they are only reachable
# on a machine with the actual hardware attached.
#
# Usage:  bash scripts/setup-dev.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Orchiday dev setup in $(pwd)"

# ── Python ────────────────────────────────────────────────────────────────
# Pick an interpreter that actually runs: on Windows `python3` is often a
# Microsoft Store stub that exists on PATH but exits without doing anything.
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for cand in python3 python py; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "" >/dev/null 2>&1; then
      PY="$cand"; break
    fi
  done
fi
[ -n "$PY" ] || { echo "FAIL: no working Python interpreter found"; exit 1; }
echo "==> Python: $("$PY" --version)"

"$PY" -m pip install --upgrade pip >/dev/null
echo "==> Installing Orchiday + dev dependencies (editable)"
"$PY" -m pip install -e ".[dev]"

# ── Node (TypeScript build) ───────────────────────────────────────────────
if command -v npm >/dev/null 2>&1; then
  echo "==> Node: $(node --version)"
  # tsc is invoked via npx in the verify step; warm the cache so the first
  # compile in a fresh container is not a silent multi-second stall.
  npx -y -p typescript tsc --version >/dev/null
else
  echo "!! npm not found — the TypeScript build (web/app.ts -> web/app.js) will not work."
fi

echo "==> Setup complete. Verify with: bash scripts/verify.sh"
