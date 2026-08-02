#!/usr/bin/env bash
# Orchiday — development environment bootstrap.
#
# Prepares everything needed to BUILD and VERIFY the app (frontend toolchain,
# pytest, i18n and component checks). It deliberately does NOT install LeRobot, torch or
# robot drivers: those live in a separate Python environment that the app points
# at through its `python_path` setting, and they are only reachable on a machine
# with the actual hardware attached.
#
# Deliberately NOT `set -e`. In a container a single optional step (system Qt
# libs, npm) failing must not abort the whole session before the agent starts —
# it is far more useful to continue and report precisely what is missing.
set -uo pipefail

cd "$(dirname "$0")/.."
echo "==> Orchiday dev setup in $(pwd)"

WARN=0
warn() { echo "!! $1"; WARN=1; }

# ── Python interpreter ────────────────────────────────────────────────────
# Pick one that actually runs: on Windows `python3` is often a Microsoft Store
# stub that exists on PATH but exits without doing anything.
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for cand in python3 python py; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "" >/dev/null 2>&1; then
      PY="$cand"; break
    fi
  done
fi
if [ -z "$PY" ]; then
  echo "FATAL: no working Python interpreter found"; exit 1
fi
echo "==> Python: $("$PY" --version 2>&1)"

# ── System libraries for PySide6 ──────────────────────────────────────────
# The PySide6 wheel bundles Qt but still dynamically links against a handful of
# system libs. A slim container image usually lacks them, and the failure only
# surfaces later as an ImportError inside pytest. Best-effort, never fatal.
if command -v apt-get >/dev/null 2>&1; then
  SUDO=""
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
  echo "==> Ensuring Qt runtime libraries (best effort)"
  $SUDO apt-get update -qq >/dev/null 2>&1
  $SUDO apt-get install -y -qq --no-install-recommends \
    libgl1 libegl1 libxkbcommon0 libdbus-1-3 libglib2.0-0 >/dev/null 2>&1 \
    || warn "could not install Qt system libs (continuing; PySide6 import may fail)"
fi

# ── Python packages ───────────────────────────────────────────────────────
# Debian/Ubuntu images since PEP 668 mark the system interpreter "externally
# managed" and refuse a plain `pip install`. A container has no other consumer
# of that interpreter to protect, so retry with --break-system-packages.
pip_install() {
  "$PY" -m pip install "$@" && return 0
  echo "==> pip refused (PEP 668 externally-managed env); retrying with --break-system-packages"
  "$PY" -m pip install --break-system-packages "$@"
}

echo "==> Upgrading pip / setuptools / wheel"
pip_install --quiet --upgrade pip setuptools wheel >/dev/null 2>&1 \
  || warn "could not upgrade pip/setuptools/wheel"

echo "==> Installing Orchiday + dev dependencies (editable)"
if ! pip_install -e ".[dev]"; then
  warn "editable install failed — retrying without the editable flag"
  pip_install ".[dev]" || warn "dependency install failed"
fi

# ── Node / frontend (Vite + React + Tailwind) ─────────────────────────────
# Only needed to CHANGE the frontend. The built bundle in web/ is committed,
# so running Orchiday itself never requires Node.
if command -v npm >/dev/null 2>&1; then
  echo "==> Node: $(node --version 2>&1)"
  echo "==> Installing frontend dependencies (frontend/)"
  if [ -f frontend/package-lock.json ]; then
    ( cd frontend && npm ci ) >/dev/null 2>&1 || ( cd frontend && npm install ) >/dev/null 2>&1 \
      || warn "npm install failed in frontend/ (frontend cannot be rebuilt here)"
  else
    ( cd frontend && npm install ) >/dev/null 2>&1 \
      || warn "npm install failed in frontend/ (frontend cannot be rebuilt here)"
  fi
else
  warn "npm not found — the frontend cannot be rebuilt in this environment"
fi

# ── Report what actually works ────────────────────────────────────────────
echo ""
echo "==> Capability check"
# Qt must be usable headless; QCoreApplication needs no display but the import
# chain still needs the libs installed above.
QT_QPA_PLATFORM=offscreen "$PY" -c "from PySide6.QtCore import QCoreApplication" >/dev/null 2>&1 \
  && echo "    PySide6      OK" || { echo "    PySide6      MISSING (pytest will fail)"; WARN=1; }
"$PY" -c "import pytest" >/dev/null 2>&1 \
  && echo "    pytest       OK" || { echo "    pytest       MISSING"; WARN=1; }
"$PY" -c "import fastapi, uvicorn, pydantic, httpx" >/dev/null 2>&1 \
  && echo "    web stack    OK" || echo "    web stack    MISSING"
# Uvicorn has no built-in WebSocket implementation. Without one the /ws route
# answers 404 and the whole live event stream (console output, process state,
# recording and calibration events) silently never arrives.
if "$PY" -c "import websockets" >/dev/null 2>&1 || "$PY" -c "import wsproto" >/dev/null 2>&1; then
  echo "    websockets   OK"
else
  echo "    websockets   MISSING (live events would not work)"; WARN=1
fi
"$PY" -c "import cv2" >/dev/null 2>&1 \
  && echo "    opencv       OK" || echo "    opencv       MISSING (camera code paths only)"
command -v npm >/dev/null 2>&1 \
  && echo "    npm          OK" || echo "    npm          MISSING (frontend cannot be rebuilt)"
if [ -d frontend/node_modules ]; then
  echo "    frontend     OK (cd frontend && npm run build)"
else
  echo "    frontend     NOT INSTALLED (web/ bundle still works; rebuilds are not possible)"
fi

echo ""
if [ "$WARN" -eq 0 ]; then
  echo "==> Setup complete. Verify with: bash scripts/verify.sh"
else
  echo "==> Setup finished WITH WARNINGS (see above). Continuing anyway."
fi
# Always succeed: a partially-provisioned container is still far more useful
# than a session that never starts.
exit 0
