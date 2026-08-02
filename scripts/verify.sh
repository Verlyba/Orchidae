#!/usr/bin/env bash
# Orchiday — full verification gate.
#
# Everything here is runnable WITHOUT robot hardware, so it is the complete
# check an automated (cloud) session can rely on. Hardware behaviour
# (calibration, teleop, recording against a real arm) cannot be verified here
# and must never be claimed as verified by a session that only ran this.
#
# The frontend is a Vite + React + Tailwind project in frontend/, built into
# web/ (which the FastAPI backend serves and which is COMMITTED so a clone
# without Node still runs). Checks that used to read web/index.html therefore
# read frontend/src/**/*.tsx now — same guarantees, new location.
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

HAVE_NODE=0
command -v node >/dev/null 2>&1 && HAVE_NODE=1
HAVE_FRONTEND_DEPS=0
[ -d frontend/node_modules ] && HAVE_FRONTEND_DEPS=1

# ── 1. The frontend typechecks ────────────────────────────────────────────
step "frontend typecheck (tsc --noEmit)"
if [ "$HAVE_FRONTEND_DEPS" -eq 1 ] && command -v npm >/dev/null 2>&1; then
  ( cd frontend && npm run --silent typecheck ) || fail "tsc reported errors"
else
  echo "skipped (run scripts/setup-dev.sh to install frontend/node_modules)"
fi

# ── 2. The committed bundle matches the sources it was built from ─────────
# web/ is a build artifact that is committed on purpose, so someone with
# Python but no Node can run the app straight after cloning. That only holds
# if it is actually rebuilt when frontend/src changes. Timestamps cannot tell
# us: git does not restore mtimes, so on a fresh clone every file is the same
# age. The build writes a content hash of its inputs; this recomputes it.
step "web/ bundle is up to date with frontend/src"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    import fs from "node:fs";
    import path from "node:path";
    const manifestPath = "web/build-manifest.json";
    if (!fs.existsSync(manifestPath)) {
      console.log("web/build-manifest.json is missing — run: cd frontend && npm run build");
      process.exit(1);
    }
    const { hashSources } = await import("./frontend/scripts/write-build-manifest.mjs");
    const { hash, count } = hashSources("frontend");
    const stored = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (stored.sourceHash !== hash) {
      console.log("frontend sources changed since the last build");
      console.log(`  committed: ${stored.sourceHash.slice(0, 16)}… (${stored.sourceFiles} files)`);
      console.log(`  current:   ${hash.slice(0, 16)}… (${count} files)`);
      console.log("  fix: cd frontend && npm run build   (and commit web/)");
      process.exit(1);
    }
    // The bundle the built index.html points at has to actually be there.
    const html = fs.readFileSync("web/index.html", "utf8");
    const refs = [...html.matchAll(/(?:src|href)="\/static\/([^"]+)"/g)].map(m => m[1]);
    const missing = refs.filter(r => !fs.existsSync(path.join("web", r)));
    if (missing.length) {
      console.log("web/index.html references files that are not in web/:", missing);
      process.exit(1);
    }
    console.log(`bundle matches ${count} source files; ${refs.length} asset references resolve`);
  ' --input-type=module || fail "web/ is stale or incomplete"
else
  echo "skipped (node unavailable)"
fi

# ── 3. Python test suite ──────────────────────────────────────────────────
step "pytest"
PYTHONPATH=src "$PY" -m pytest tests/ -q || fail "pytest failures"

# ── 4. Python syntax of the whole package ─────────────────────────────────
step "python compileall"
"$PY" -m compileall -q src/orchiday >/dev/null || fail "python syntax errors"

# ── 5. i18n: cs/en key parity + no key used in the UI but missing ─────────
step "i18n parity and coverage"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync("frontend/src/legacy/i18n.ts", "utf8");
    // The dictionary is a plain object literal with a TS annotation bolted on
    // the front; strip the annotation and it is evaluable as-is.
    global.window = {};
    eval(src.replace(/export const I18N[^=]*=/, "window.I18N =")
            .replace(/\(window as any\)\.I18N = I18N;/, ""));
    const cs = new Set(Object.keys(window.I18N.cs));
    const en = new Set(Object.keys(window.I18N.en));
    const onlyCs = [...cs].filter(k => !en.has(k));
    const onlyEn = [...en].filter(k => !cs.has(k));

    const tsx = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx")) tsx.push(p);
    } };
    walk("frontend/src");
    const markup = tsx.map(f => fs.readFileSync(f, "utf8")).join("\n");
    const used = new Set(
      [...markup.matchAll(/data-i18n(?:-ph|-title|-tooltip|-html)?="([^"]+)"/g)].map(m => m[1])
    );
    const missing = [...used].filter(k => !cs.has(k));

    // A repeated key inside one object literal is NOT an error in JS — the
    // last definition silently wins. So Object.keys() can never reveal it,
    // and a key added in one place quietly changes a label somewhere else
    // on the other side of the file. Scan the source text instead.
    const csAt = src.indexOf("cs: {"), enAt = src.indexOf("en: {");
    const dupes = [];
    for (const [lang, bodyText] of [["cs", src.slice(csAt, enAt)], ["en", src.slice(enAt)]]) {
      const seen = new Set();
      for (const m of bodyText.matchAll(/^\s*"([^"]+)":/gm)) {
        if (seen.has(m[1])) dupes.push(`${lang}:${m[1]}`);
        seen.add(m[1]);
      }
    }

    let bad = false;
    if (onlyCs.length) { console.log("cs-only keys:", onlyCs); bad = true; }
    if (onlyEn.length) { console.log("en-only keys:", onlyEn); bad = true; }
    if (missing.length) { console.log("used in markup but undefined:", missing); bad = true; }
    if (dupes.length) { console.log("duplicate keys (later one silently wins):", dupes); bad = true; }
    console.log(`cs=${cs.size} en=${en.size} usedInMarkup=${used.size} across ${tsx.length} components`);
    process.exit(bad ? 1 : 0);
  ' || fail "i18n problems"
else
  echo "skipped (node unavailable)"
fi

# ── 6. No duplicate element ids across the whole component tree ───────────
# getElementById silently returns the first match, so a duplicate id makes
# half the UI wire itself to the wrong element (this has bitten us before).
# Splitting one index.html into 25 components makes this MORE likely, not
# less: nothing stops two files from claiming the same id.
step "duplicate element ids"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const files = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p);
    } };
    walk("frontend/src");
    const seen = new Map();
    const dupes = [];
    for (const f of files) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) {
        if (seen.has(m[1])) dupes.push(`${m[1]}  (${seen.get(m[1])} and ${f})`);
        else seen.set(m[1], f);
      }
    }
    if (dupes.length) { console.log(dupes.join("\n")); process.exit(1); }
    console.log(`${seen.size} unique element ids across ${files.length} components`);
  ' || fail "duplicate ids in the component tree"
else
  echo "skipped (node unavailable)"
fi

# ── 7. Top-level page structure ───────────────────────────────────────────
# Every page and the console dock must be rendered as a DIRECT child of
# #workspace-main. If one nests inside another, the inner one inherits
# `display: none` from .editor-area and can never be shown, whatever the nav
# does — that has landed twice before. Unbalanced markup no longer needs its
# own check: JSX that does not nest correctly fails the build outright.
step "page structure"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const app = fs.readFileSync("frontend/src/App.tsx", "utf8");
    const open = app.indexOf("id=\"workspace-main\"");
    const close = app.indexOf("</main>", open);
    if (open < 0 || close < 0) { console.log("#workspace-main not found in App.tsx"); process.exit(1); }
    const inside = app.slice(open, close);

    const pages = fs.readdirSync("frontend/src/pages").filter(f => f.endsWith(".tsx"))
      .map(f => f.replace(/\.tsx$/, ""));
    const wanted = [...pages, "BottomDock"];
    let bad = false;
    for (const c of wanted) {
      const all = [...app.matchAll(new RegExp(`<${c}\\s*/>`, "g"))];
      if (all.length !== 1) { console.log(`<${c} /> is rendered ${all.length} times, expected 1`); bad = true; continue; }
      if (!new RegExp(`<${c}\\s*/>`).test(inside)) {
        console.log(`<${c} /> is not inside #workspace-main`); bad = true;
      }
    }
    // Each page component must still BE a .editor-area pane at its root.
    // Anchor on the EXPORTED component, not on the first `return (` in the
    // file: a page is free to define local sub-components above itself, and
    // those return markup too.
    for (const p of pages) {
      const body = fs.readFileSync(`frontend/src/pages/${p}.tsx`, "utf8");
      const at = body.search(new RegExp(`^export function ${p}\\s*\\(`, "m"));
      if (at < 0) { console.log(`${p}.tsx does not export a function named ${p}`); bad = true; continue; }
      const root = body.slice(body.indexOf("return (", at));
      if (!/^\s*return \(\s*\n\s*<div id="page-[a-z]+" className="editor-area/.test(root)) {
        console.log(`${p}.tsx does not start with a <div id="page-…" className="editor-area…"> root`);
        bad = true;
      }
    }
    if (bad) process.exit(1);
    console.log(`checked ${wanted.length} top-level panes under #workspace-main`);
  ' || fail "a page or the console dock is rendered in the wrong place"
else
  echo "skipped (node unavailable)"
fi

# ── 8. Flat technical look: one radius scale, no blur, shadows or glow ────
# The design language is a deliberate constraint, not a taste: muted fills,
# visible borders, and corners that come from ONE scale instead of whatever
# each panel's author happened to type. Decoration crept back in every time a
# new panel was hand-styled (98 border-radius declarations, a blurred overlay
# backdrop and several glows had accumulated), so it is checked instead of
# remembered. Inline style={{}} objects count too — that is where most of it
# came from, and an inline radius also silently outranks the stylesheet.
#
# Radius used to be banned outright. It no longer is: the design carries a
# three-step scale (--radius-sm/md/lg in :root). What is banned is a radius
# written as a literal length, because that is a fourth step nobody decided on
# — exactly how 4/6/8/10px ended up mixed across pages. Blur, shadow and glow
# stay banned; the buttons say so themselves with `filter: none !important`.
#
# Tailwind is a second way in, so it is checked too. The theme in
# styles/tailwind.css already deletes the shadow/blur namespaces and pins the
# radius scale, which means `shadow-lg` or `rounded-[7px]` generate nothing at
# all — a class that silently does nothing is worth catching in review.
step "flat design tokens"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const RADIUS_TOKENS = ["--radius-sm", "--radius-md", "--radius-lg"];

    const files = ["frontend/src/styles/app.css", "frontend/src/styles/tailwind.css"];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx") || p.endsWith(".ts")) files.push(p);
    } };
    walk("frontend/src");

    // The scale has to exist, or every var(--radius-*) below resolves to
    // nothing and the check passes while the corners quietly go square.
    const css = fs.readFileSync("frontend/src/styles/app.css", "utf8");
    const undefined_ = RADIUS_TOKENS.filter(t => !new RegExp(`^\\s*${t}\\s*:`, "m").test(css));
    if (undefined_.length) {
      console.log("radius tokens used but not defined in :root:", undefined_.join(", "));
      process.exit(1);
    }
    const allowedRadius = new RegExp(
      `^(?:0(?:px|%)?|var\\(\\s*(?:${RADIUS_TOKENS.join("|")})\\s*\\))$`);

    // Property name -> what is allowed. Anything else is a finding.
    // `!important` is stripped before the value is judged: `none !important`
    // is still none, and rejecting it made the gate fail on a rule whose whole
    // job was to force the effect off.
    const strip = v => v.trim().replace(/\s*!important$/i, "").trim().replace(/^["\x27]|["\x27]$/g, "");
    const RULES = [
      // Matches border-radius and the per-corner longhands, prefixed or not,
      // in CSS (`border-radius: 4px`) and in JSX style objects (`borderRadius: "4px"`).
      [/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;"\x27}`\n]+)/gi,
       v => allowedRadius.test(strip(v)),
       "radius outside the scale (use 0 or var(--radius-sm|md|lg))"],
      [/border(?:Top|Bottom)(?:Left|Right)?Radius\s*:\s*("[^"]*"|\x27[^\x27]*\x27)/g,
       v => allowedRadius.test(strip(v)),
       "radius outside the scale (use 0 or var(--radius-sm|md|lg))"],
      [/(?:^|[^-\w])(?:-webkit-)?backdrop-filter\s*:\s*([^;"\x27}`\n]+)/gi,
       v => /^none$/i.test(strip(v)), "backdrop-filter (no blur)"],
      [/(?:box|text)-shadow\s*:\s*([^;"\x27}`\n]+)/gi,
       v => /^none$/i.test(strip(v)), "shadow / glow"],
      [/(?:boxShadow|textShadow)\s*:\s*("[^"]*"|\x27[^\x27]*\x27)/g,
       v => /^none$/i.test(strip(v)), "shadow / glow"],
      // The leading guard keeps this from re-reporting `backdrop-filter`.
      [/(?:^|[^-\w])filter\s*:\s*([^;"\x27}`\n]*blur\([^)]*\))/gi, () => false, "blur() filter"],
      // Tailwind utilities that the theme deletes: writing one is a no-op.
      [/className="([^"]*)"/g,
       v => !/(?:^|\s)(?:shadow|drop-shadow|blur|backdrop-blur)(?:-[\w[\]./-]+)?(?=\s|$)/.test(v)
         && !/(?:^|\s)rounded(?:-[a-z]+)?-\[/.test(v),
       "Tailwind class for an effect the theme removed (shadow/blur) or an off-scale radius"],
    ];
    let bad = false;
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [re, ok, what] of RULES) {
        for (const m of text.matchAll(re)) {
          if (ok(m[1])) continue;
          const line = text.slice(0, m.index).split("\n").length;
          console.log(`${file}:${line}: ${what} -> ${m[0].trim().slice(0, 120)}`);
          bad = true;
        }
      }
    }
    if (bad) process.exit(1);
    console.log(`radii come from ${RADIUS_TOKENS.join(" / ")}; no blur, shadow or glow in ${files.length} files`);
  ' || fail "styling outside the design tokens (see above) — one radius scale, no blur/shadow/glow"
else
  echo "skipped (node unavailable)"
fi

# ── 9. Every App.<fn>() called from a component actually exists ───────────
# The inline onclick="App.foo()" handlers became onClick={() => App.foo()}.
# TypeScript would catch a typo, but only when the frontend deps are
# installed — this check works from a bare clone too.
step "component -> App method references"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const files = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p);
    } };
    walk("frontend/src");
    const markup = files.map(f => fs.readFileSync(f, "utf8")).join("\n");
    const ts = fs.readFileSync("frontend/src/legacy/app.ts", "utf8");
    const called = new Set(
      [...markup.matchAll(/\bApp\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map(m => m[1])
    );
    const defined = new Set(
      [...ts.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)].map(m => m[1])
    );
    const missing = [...called].filter(fn => !defined.has(fn));
    if (missing.length) { console.log("called from a component, not defined in app.ts:", missing); process.exit(1); }
    console.log(`checked ${called.size} App.* references`);
  ' || fail "a component calls a missing App method"
else
  echo "skipped (node unavailable)"
fi

# ── 10. No control is rendered with a hardcoded `disabled` ────────────────
# React decides whether to dispatch a click from the element's PROPS, not from
# the DOM. A button rendered `disabled={true}` and later enabled the way every
# page still does it — `el.disabled = false` from app.ts — therefore looks
# enabled, is enabled as far as the browser is concerned, and still swallows
# every click. Silently: no error, no warning. That killed 18 buttons at once
# after the React port (Projects Open/Export/Delete, all of Datasety's dataset
# actions, both teleop buttons, stop-training, stop-inference).
#
# Two ways out, both allowed: derive it from state (`disabled={!selected}` —
# see ProjectsPage) or hand the DOM property back to app.ts with
# `ref={initiallyDisabled}`. What is banned is the constant.
step "no hardcoded disabled= on a control"
if [ "$HAVE_NODE" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const files = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p);
    } };
    walk("frontend/src");
    const bad = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      // `disabled={true}` and a bare `disabled` attribute both put a literal
      // in props. `disabled={expr}` is state-driven and fine. Attributes are
      // written one per line here, which is what keeps the prose in comments
      // ("letting a disabled button look broken") out of the match.
      text.split("\n").forEach((line, i) => {
        if (/disabled=\{true\}/.test(line) || /^\s*disabled\s*\/?>?\s*$/.test(line)) {
          bad.push(`${f}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    if (bad.length) {
      console.log(bad.join("\n"));
      console.log("fix: derive it from state, or use ref={initiallyDisabled} so app.ts owns the property");
      process.exit(1);
    }
    console.log(`no constant disabled props in ${files.length} components`);
  ' || fail "a control is rendered with a hardcoded disabled prop (React will swallow its clicks)"
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
