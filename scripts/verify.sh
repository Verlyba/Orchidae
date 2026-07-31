#!/usr/bin/env bash
# Orchiday — full verification gate.
#
# Everything here is runnable WITHOUT robot hardware, so it is the complete
# check an automated (cloud) session can rely on. Hardware behaviour
# (calibration, teleop, recording against a real arm) cannot be verified here
# and must never be claimed as verified by a session that only ran this.
set -uo pipefail

cd "$(dirname "$0")/.."
FAIL=0
step() { printf '\n==> %s\n' "$1"; }
fail() { echo "FAIL: $1"; FAIL=1; }

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

# The tests construct a QCoreApplication. On a headless container Qt must be
# told there is no display, otherwise it aborts trying to reach one.
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"

# ── 1. TypeScript compiles (web/app.ts -> web/app.js) ─────────────────────
step "TypeScript build"
if command -v npm >/dev/null 2>&1; then
  ( cd web && npx -y -p typescript tsc ) || fail "tsc reported errors"
else
  echo "skipped (npm unavailable)"
fi

# ── 2. Compiled JS is in sync with the source ─────────────────────────────
# app.js is committed, so a forgotten rebuild ships stale behaviour to users.
step "app.js up to date with app.ts"
if [ web/app.ts -nt web/app.js ]; then
  fail "web/app.js is older than web/app.ts — run tsc and commit the result"
fi

# ── 3. Python test suite ──────────────────────────────────────────────────
step "pytest"
PYTHONPATH=src "$PY" -m pytest tests/ -q || fail "pytest failures"

# ── 4. Python syntax of the whole package ─────────────────────────────────
step "python compileall"
"$PY" -m compileall -q src/orchiday >/dev/null || fail "python syntax errors"

# ── 5. i18n: cs/en key parity + no key used in HTML but missing ───────────
step "i18n parity and coverage"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    global.window = {};
    eval(fs.readFileSync("web/i18n.js", "utf8"));
    const cs = new Set(Object.keys(window.I18N.cs));
    const en = new Set(Object.keys(window.I18N.en));
    const onlyCs = [...cs].filter(k => !en.has(k));
    const onlyEn = [...en].filter(k => !cs.has(k));
    const html = fs.readFileSync("web/index.html", "utf8");
    const used = new Set(
      [...html.matchAll(/data-i18n(?:-ph|-title|-tooltip|-html)?="([^"]+)"/g)].map(m => m[1])
    );
    const missing = [...used].filter(k => !cs.has(k));
    let bad = false;
    if (onlyCs.length) { console.log("cs-only keys:", onlyCs); bad = true; }
    if (onlyEn.length) { console.log("en-only keys:", onlyEn); bad = true; }
    if (missing.length) { console.log("used in HTML but undefined:", missing); bad = true; }
    console.log(`cs=${cs.size} en=${en.size} usedInHtml=${used.size}`);
    process.exit(bad ? 1 : 0);
  ' || fail "i18n problems"
else
  echo "skipped (node unavailable)"
fi

# ── 6. No duplicate element ids in index.html ─────────────────────────────
# getElementById silently returns the first match, so a duplicate id makes
# half the UI wire itself to the wrong element (this has bitten us before).
step "duplicate element ids"
DUPES=$(grep -oE 'id="[a-zA-Z0-9_-]+"' web/index.html | sort | uniq -d || true)
if [ -n "$DUPES" ]; then
  echo "$DUPES"
  fail "duplicate ids in web/index.html"
fi

# ── 7. Every App.<fn>() referenced from HTML actually exists ──────────────
# An onclick pointing at a missing method fails silently at runtime.
step "HTML -> App method references"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const html = fs.readFileSync("web/index.html", "utf8");
    const ts = fs.readFileSync("web/app.ts", "utf8");
    const called = new Set(
      [...html.matchAll(/App\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1])
    );
    const defined = new Set(
      [...ts.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)].map(m => m[1])
    );
    const missing = [...called].filter(fn => !defined.has(fn));
    if (missing.length) { console.log("referenced in HTML, not defined in app.ts:", missing); process.exit(1); }
    console.log(`checked ${called.size} App.* references`);
  ' || fail "HTML references a missing App method"
else
  echo "skipped (node unavailable)"
fi

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "VERIFICATION FAILED"
fi
exit "$FAIL"
