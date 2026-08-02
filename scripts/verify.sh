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

    // A repeated key inside one object literal is NOT an error in JS — the
    // last definition silently wins. So Object.keys() can never reveal it,
    // and a key added in one place quietly changes a label somewhere else
    // on the other side of the file. Scan the source text instead.
    const src = fs.readFileSync("web/i18n.js", "utf8");
    const csAt = src.indexOf("cs: {"), enAt = src.indexOf("en: {");
    const dupes = [];
    for (const [lang, body] of [["cs", src.slice(csAt, enAt)], ["en", src.slice(enAt)]]) {
      const seen = new Set();
      for (const m of body.matchAll(/^\s*"([^"]+)":/gm)) {
        if (seen.has(m[1])) dupes.push(`${lang}:${m[1]}`);
        seen.add(m[1]);
      }
    }

    let bad = false;
    if (onlyCs.length) { console.log("cs-only keys:", onlyCs); bad = true; }
    if (onlyEn.length) { console.log("en-only keys:", onlyEn); bad = true; }
    if (missing.length) { console.log("used in HTML but undefined:", missing); bad = true; }
    if (dupes.length) { console.log("duplicate keys (later one silently wins):", dupes); bad = true; }
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

# ── 7. index.html tag balance + top-level page structure ──────────────────
# A single missing </div> does not break the HTML parser — it silently nests
# everything that follows *inside* the previous element. That has now landed
# twice: once the "manage" dataset panel ended up inside "collect", and once
# #page-settings swallowed both #page-help and #bottom-dock-container, which
# made the Help page unreachable and hid the console dock on every other page.
# Neither showed up in any other check here.
step "index.html structure"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    // Comments are stripped first: they legitimately contain "</div>" when
    // they annotate which element a closing tag belongs to.
    const html = fs.readFileSync("web/index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const VOID = new Set(["area","base","br","col","embed","hr","img","input","link",
      "meta","param","source","track","wbr","path","circle","rect","line","polyline",
      "polygon","ellipse","use","stop"]);
    const lineOf = i => html.slice(0, i).split("\n").length;
    const stack = [];
    let bad = false;
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
      const [, close, rawTag, attrs] = m;
      const tag = rawTag.toLowerCase();
      if (VOID.has(tag) || attrs.trimEnd().endsWith("/")) continue;
      const line = lineOf(m.index);
      if (!close) {
        const id = (attrs.match(/id="([^"]+)"/) || [])[1] || null;
        stack.push({ tag, id, line });
      } else {
        const top = stack[stack.length - 1];
        if (!top) { console.log(`line ${line}: stray </${tag}>`); bad = true; break; }
        if (top.tag !== tag) {
          console.log(`line ${line}: </${tag}> closes <${top.tag}${top.id ? "#" + top.id : ""}> opened on line ${top.line}`);
          console.log("  -> a closing tag is missing above this point");
          bad = true; break;
        }
        stack.pop();
      }
    }
    if (!bad && stack.length) {
      console.log("never closed:", stack.map(e => `<${e.tag}${e.id ? "#" + e.id : ""}> line ${e.line}`).join(", "));
      bad = true;
    }
    process.exit(bad ? 1 : 0);
  ' || fail "web/index.html has unbalanced tags"

  # Every page and the console dock must be a DIRECT child of #workspace-main.
  # If one nests inside another, the inner one inherits `display: none` from
  # .editor-area and can never be shown, whatever the nav does.
  node -e '
    const fs = require("fs");
    const html = fs.readFileSync("web/index.html", "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const VOID = new Set(["area","base","br","col","embed","hr","img","input","link",
      "meta","param","source","track","wbr","path","circle","rect","line","polyline",
      "polygon","ellipse","use","stop"]);
    const WANT = /^(page-[a-z]+|bottom-dock-container)$/;
    const stack = [];
    const found = [];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
      const [, close, rawTag, attrs] = m;
      const tag = rawTag.toLowerCase();
      if (VOID.has(tag) || attrs.trimEnd().endsWith("/")) continue;
      if (!close) {
        const id = (attrs.match(/id="([^"]+)"/) || [])[1] || null;
        if (id && WANT.test(id)) {
          const parent = stack[stack.length - 1];
          found.push({ id, parent: parent ? (parent.id || parent.tag) : "(root)" });
        }
        stack.push({ tag, id });
      } else if (stack.length && stack[stack.length - 1].tag === tag) {
        stack.pop();
      } else break; // unbalanced — the check above already reported it
    }
    const stray = found.filter(f => f.parent !== "workspace-main");
    if (stray.length) {
      stray.forEach(f => console.log(`#${f.id} is nested inside #${f.parent}, not #workspace-main`));
      process.exit(1);
    }
    console.log(`checked ${found.length} top-level panes under #workspace-main`);
  ' || fail "a page or the console dock is nested in the wrong parent"
else
  echo "skipped (node unavailable)"
fi

# ── 8. Flat technical look: no rounded corners, blur, shadows or glow ─────
# The design language is a deliberate constraint, not a taste: sharp corners,
# visible borders, muted fills. Decoration crept back in every time a new panel
# was hand-styled (98 border-radius declarations, a blurred overlay backdrop and
# several glows had accumulated), so it is checked instead of remembered.
# Inline style="" attributes count too — that is where most of it came from.
step "flat design tokens"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const FILES = ["web/styles.css", "web/index.html", "web/app.ts"];
    // Property name -> what is allowed. Anything else is a finding.
    const RULES = [
      [/border-radius\s*:\s*([^;"\x27}`\n]+)/gi, v => /^0(?:px|%)?$/.test(v.trim()),
       "rounded corner (sharp corners only)"],
      [/(?:^|[^-\w])(?:-webkit-)?backdrop-filter\s*:\s*([^;"\x27}`\n]+)/gi, v => /^none$/i.test(v.trim()),
       "backdrop-filter (no blur)"],
      [/(?:box|text)-shadow\s*:\s*([^;"\x27}`\n]+)/gi, v => /^none$/i.test(v.trim()),
       "shadow / glow"],
      // The leading guard keeps this from re-reporting `backdrop-filter`.
      [/(?:^|[^-\w])filter\s*:\s*([^;"\x27}`\n]*blur\([^)]*\))/gi, () => false, "blur() filter"],
    ];
    let bad = false;
    for (const file of FILES) {
      const text = fs.readFileSync(file, "utf8");
      for (const [re, ok, what] of RULES) {
        for (const m of text.matchAll(re)) {
          if (ok(m[1])) continue;
          const line = text.slice(0, m.index).split("\n").length;
          console.log(`${file}:${line}: ${what} -> ${m[0].trim()}`);
          bad = true;
        }
      }
    }
    if (bad) process.exit(1);
    console.log("no rounded corners, blur, shadows or glow in web/");
  ' || fail "decorative styling found (see above) — the UI is deliberately flat"
else
  echo "skipped (node unavailable)"
fi

# ── 9. Every App.<fn>() referenced from HTML actually exists ──────────────
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
