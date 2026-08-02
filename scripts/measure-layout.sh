#!/usr/bin/env bash
# Orchiday — start a real backend, measure every page's layout, shut down.
#
# The measurement itself lives in scripts/measure_layout.mjs; this wrapper only
# owns the server lifecycle, because measuring against a static file server
# over web/ gives numbers that are simply wrong (most pages render empty).
#
# Usage:  bash scripts/measure-layout.sh [--pages projects,setup] [--json]
#
# Requires `playwright` (npm i playwright) and a Chromium build. Both are
# optional dev-only tooling — nothing in the app depends on them, and
# scripts/verify.sh does not call this.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${ORCHIDAY_PORT:-8100}"
BASE="http://127.0.0.1:${PORT}"

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for cand in python3 python py; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "" >/dev/null 2>&1; then
      PY="$cand"; break
    fi
  done
fi
[ -n "$PY" ] || { echo "no working Python interpreter found"; exit 1; }

if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  echo "playwright is not installed — run: npm i playwright"
  exit 1
fi

# Qt would try to reach a display and abort on a headless machine.
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
export PYTHONPATH="src:${PYTHONPATH:-}"

LOG="$(mktemp)"
"$PY" -m uvicorn orchiday.server:app --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
# Kill by PID, never by pattern: `pkill -f "uvicorn orchiday.server"` also
# matches this script's own command line and takes down the shell running it.
cleanup() { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS "${BASE}/api/info" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server died on startup:"; cat "$LOG"; exit 1
  fi
  sleep 0.5
done
curl -fsS "${BASE}/api/info" >/dev/null 2>&1 || { echo "server never came up:"; cat "$LOG"; exit 1; }

ORCHIDAY_BASE="$BASE" node scripts/measure_layout.mjs --base "$BASE" "$@"
RC=$?

# Server-side errors during the run are worth seeing even when the page
# measured clean — a 500 behind a fetch() shows up as an empty panel.
if grep -qE "Traceback|ERROR" "$LOG"; then
  echo; echo "server log had errors:"; grep -E "Traceback|ERROR" -A 4 "$LOG" | head -40
fi
exit $RC
