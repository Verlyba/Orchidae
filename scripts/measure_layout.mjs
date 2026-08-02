/**
 * Orchiday — layout measurement harness.
 *
 * Answers the questions the brief keeps asking about the frontend, with
 * numbers instead of opinions:
 *
 *   - how much of a page's area is actually *drawn on* (dead space),
 *   - does anything overflow horizontally,
 *   - is anything clipped (overflow:hidden with content taller than the box),
 *   - is any control stretched to a nonsensical width,
 *   - did the browser console report an error.
 *
 * It drives a REAL backend, not a static file server: against `web/` alone
 * most pages render empty and every measurement lies. Start the server with
 * `scripts/measure-layout.sh`, which wires this up end to end.
 *
 * Usage:  node scripts/measure_layout.mjs [--base URL] [--pages a,b] [--json]
 *
 * ── Traps this script already handles (learned the hard way, see
 *    docs/PROGRESS.md runs 4-7) ────────────────────────────────────────────
 *  1. Playwright's downloaded build does not match the preinstalled browser
 *     in the cloud image -> launch with an explicit executablePath.
 *  2. Headless Chromium injects `--hide-scrollbars`, so scrollbars take no
 *     layout space and scroll affordance cannot be measured -> disabled.
 *  3. `changeTab()` alert()s and bounces back to Projects unless a project is
 *     open -> the harness creates and opens one.
 *  4. The first-run wizard overlay covers the whole workspace -> dismissed.
 *  5. Counting containers as "drawn on" reports an empty panel at 82 % -> only
 *     leaf elements that actually paint (text, inputs, svg) are counted.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BASE = argVal('--base', process.env.ORCHIDAY_BASE || 'http://127.0.0.1:8100');
const AS_JSON = args.includes('--json');

const ALL_PAGES = [
  'projects', 'setup', 'teleoperation', 'datasety',
  'uceni', 'modelrun', 'settings', 'help',
];
const PAGES = argVal('--pages', '').trim()
  ? argVal('--pages', '').split(',').map(s => s.trim()).filter(Boolean)
  : ALL_PAGES;

const VIEWPORTS = [
  { w: 1600, h: 900 },
  { w: 1280, h: 800 },
  { w: 1024, h: 760 },
];

// Chromium ships under a versioned directory in the cloud image; take
// whichever one is there rather than pinning a version that will rot.
function findChromium() {
  if (process.env.ORCHIDAY_CHROMIUM) return process.env.ORCHIDAY_CHROMIUM;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;   // let Playwright resolve it
  for (const dir of fs.readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const p = `${root}/${dir}/chrome-linux/chrome`;
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}/api${path}`, opts);
  return r.json().catch(() => ({}));
}

/** Make sure some project is open, otherwise every page but Projects is blank. */
async function ensureProject() {
  const cur = await api('/project');
  if (cur.project) return cur.project.name;

  const list = await api('/projects');
  const existing = (list.projects || [])[0];
  if (existing) {
    await api('/projects/open', 'POST', { path: existing._path });
    return existing.name;
  }
  const made = await api('/projects', 'POST', {
    name: 'Layout Probe', slug: 'layout-probe',
    scene_description: 'Measurement fixture: bench with one camera above it.',
  });
  if (!made.ok) throw new Error(`could not create fixture project: ${JSON.stringify(made)}`);
  await api('/projects/open', 'POST', { path: made.project._path });
  return made.project.name;
}

/**
 * A project with no skills makes several pages measure their empty state, which
 * is not what the app looks like in use. One task with two ordered sub-steps is
 * the smallest fixture that is also SPLITTABLE — that is the case the data
 * collection and dataset pages are built around, so it must be the one measured.
 */
async function ensureSkills() {
  const cur = await api('/project');
  const have = new Set(cur.project?.skills || []);
  const wanted = [
    { name: 'Uklidit kostku', slug: 'probe_task', parent_slug: null },
    { name: 'Najet ke kostce', slug: 'probe_step_approach', parent_slug: 'probe_task' },
    { name: 'Uchopit kostku', slug: 'probe_step_grasp', parent_slug: 'probe_task' },
  ];
  for (const s of wanted) {
    if (have.has(s.slug)) continue;
    await api('/skills', 'POST', { description: 'Layout measurement fixture.', ...s });
  }
}

/**
 * Runs inside the page. Everything here must be self-contained — it is
 * serialised to the browser, so it cannot close over anything above.
 */
function measurePage(pageId) {
  const root = document.getElementById(`page-${pageId}`);
  if (!root) return { error: `#page-${pageId} not found` };
  const box = root.getBoundingClientRect();
  const pageArea = box.width * box.height;
  if (pageArea <= 0) return { error: `#page-${pageId} is ${box.width}x${box.height}` };

  const PAINTS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SVG', 'IMG', 'CANVAS']);
  let drawn = 0, overflowX = 0;
  const clipped = [], wide = [];

  const walk = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                    r.width > 0 && r.height > 0;
    if (!visible) return;

    // Horizontal overflow: content sticking out past the page's right edge.
    if (r.right > box.right + 1) overflowX = Math.max(overflowX, r.right - box.right);

    // Clipped: the box hides content it is too small to show.
    const hidesY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
    if (hidesY && el.scrollHeight - el.clientHeight > 2 && el.clientHeight > 0) {
      clipped.push(`${el.tagName}${el.id ? '#' + el.id : ''}` +
                   `.${(el.className || '').toString().split(' ')[0]} ` +
                   `${el.scrollHeight}>${el.clientHeight}`);
    }

    // A control stretched across the whole window is the thing the brief
    // explicitly forbids. Only leaf controls count — panels may be wide.
    if ((el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
         el.tagName === 'BUTTON' || el.tagName === 'TEXTAREA') && r.width > 620) {
      wide.push(`${el.tagName}${el.id ? '#' + el.id : ''}:${Math.round(r.width)}px`);
    }

    // Only leaves that paint count towards occupancy: counting containers
    // reports an empty panel as nearly full.
    const kids = Array.from(el.children);
    const hasOwnText = Array.from(el.childNodes).some(
      n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (kids.length === 0 || hasOwnText || PAINTS.has(el.tagName)) {
      drawn += Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) *
               Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
    }
    if (!PAINTS.has(el.tagName)) kids.forEach(walk);
  };
  Array.from(root.children).forEach(walk);

  return {
    w: Math.round(box.width), h: Math.round(box.height),
    occupancy: Math.round((drawn / pageArea) * 100),
    overflowX: Math.round(overflowX),
    clipped, wide,
  };
}

const project = await ensureProject();
await ensureSkills();

const browser = await chromium.launch({
  executablePath: findChromium(),
  // Without this the scrollbar is not in the layout and scroll affordance
  // cannot be measured at all.
  ignoreDefaultArgs: ['--hide-scrollbars'],
});

const results = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.addInitScript(() => {
    try { localStorage.setItem('orchiday_setup_completed', '1'); } catch (_) {}
  });
  // Not `networkidle`: the app holds a live WebSocket to /ws and retries the
  // Google Fonts import, so the network never goes idle and the wait expires.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.App, null, { timeout: 20000 });
  await page.evaluate(() => {
    const ov = document.getElementById('setup-wizard-overlay');
    if (ov) ov.style.display = 'none';
  });
  await page.waitForTimeout(500);

  for (const id of PAGES) {
    await page.evaluate((p) => window.App && window.App.changeTab(p), id);
    await page.waitForTimeout(400);
    const m = await page.evaluate(measurePage, id);
    results.push({ page: id, vp: `${vp.w}x${vp.h}`, ...m,
                   errors: errors.splice(0).filter(e => !/fonts\.googleapis/.test(e)) });
  }
  await ctx.close();
}
await browser.close();

if (AS_JSON) {
  console.log(JSON.stringify({ project, results }, null, 2));
} else {
  console.log(`project: ${project}    base: ${BASE}\n`);
  console.log('page            viewport    area%  ovfX  clipped  wide  errs');
  console.log('─'.repeat(68));
  for (const r of results) {
    if (r.error) { console.log(`${r.page.padEnd(15)} ${r.vp.padEnd(11)} ${r.error}`); continue; }
    console.log(
      `${r.page.padEnd(15)} ${r.vp.padEnd(11)} ${String(r.occupancy).padStart(4)}%` +
      ` ${String(r.overflowX).padStart(5)} ${String(r.clipped.length).padStart(8)}` +
      ` ${String(r.wide.length).padStart(5)} ${String(r.errors.length).padStart(5)}`);
  }
  const detail = results.filter(r => r.clipped?.length || r.wide?.length || r.errors?.length);
  if (detail.length) {
    console.log('\ndetail');
    console.log('─'.repeat(68));
    for (const r of detail) {
      console.log(`${r.page} @ ${r.vp}`);
      r.clipped.forEach(c => console.log(`   clipped: ${c}`));
      r.wide.forEach(w => console.log(`   wide:    ${w}`));
      r.errors.forEach(e => console.log(`   error:   ${e.slice(0, 140)}`));
    }
  }
}
