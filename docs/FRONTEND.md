# Orchiday frontend — React + Vite + Tailwind

## Where things are

```
frontend/                     source — everything you edit
  index.html                  Vite entry (just a <div id="root">)
  vite.config.ts              build config; writes into ../web
  src/
    main.tsx                  mounts the shell, then calls App.init()
    App.tsx                   the shell: title bar, sidebar, pages, overlays
    shell/                    TitleBar, Sidebar, BottomDock, HiddenFileInputs
    pages/                    one component per #page-… pane (8)
    modals/                   one component per modal overlay (12)
    wizard/                   first-run / quick-setup wizard
    util/importantStyle.ts    applies inline `!important` (React cannot)
    legacy/app.ts             the application logic (App object)
    legacy/i18n.ts            cs/en dictionary
    styles/tailwind.css       Tailwind layer, wired to the design tokens
    styles/app.css            the design system itself (7 000 lines)

web/                          BUILD OUTPUT — generated, committed, served
  index.html                  written by Vite; do not hand-edit
  assets/index-<hash>.{js,css}
  build-manifest.json         hash of the sources this bundle came from
  favicon.svg
```

## Why the build output is committed

The backend serves `web/` (`src/orchiday/server.py`: `/` → `web/index.html`,
`/static` → `web/`). Orchiday has to run for someone who cloned the repo and
has Python but no Node, so the bundle ships with the repo — the same reason
the compiled `web/app.js` was committed before the React port.

`scripts/verify.sh` checks the bundle is not stale by recomputing a content
hash of `frontend/src`, `frontend/public`, `index.html`, `vite.config.ts`,
`tsconfig.json` and `package.json` and comparing it with
`web/build-manifest.json`. It deliberately does not use timestamps: git does
not restore mtimes, so on a fresh clone every file is exactly as old as every
other one.

Asset filenames carry a content hash, so a stale cached bundle is impossible.
That replaces the old `?v=X.Y.Z` query strings that had to be bumped by hand
in `index.html` on every change.

## Working on it

```bash
bash scripts/setup-dev.sh        # installs frontend/node_modules too

cd frontend
npm run dev                      # http://localhost:5173, hot reload
                                 # (needs a backend on :8000 — run `orchiday`;
                                 #  /api and /ws are proxied to it)
npm run typecheck                # tsc --noEmit
npm run build                    # rebuilds ../web  <- REQUIRED before commit
```

If you change anything under `frontend/`, run `npm run build` and commit the
resulting `web/` alongside your source change. `scripts/verify.sh` fails
otherwise.

## Two rules the design depends on

**1. Tailwind runs without preflight.** `styles/tailwind.css` imports
`tailwindcss/theme.css` and `tailwindcss/utilities.css` individually and
leaves `preflight.css` out. Tailwind's reset would rewrite the baseline
`app.css` was authored against and every page would shift.

**2. The Tailwind theme is Orchiday's, not Tailwind's.** Every namespace is
cleared with `initial` and repopulated from the app's own variables. There is
no `rounded-xl`, no `shadow-md`, no `blur-sm` — those namespaces are deleted,
so the utilities do not exist. Corners come from `--radius-sm|md|lg` and
nothing else; `rounded-md` in a className and `var(--radius-md)` in CSS are
the same three-step scale. `scripts/verify.sh` enforces this on both sides.

## The trap: React decides clicks from props, not from the DOM

React does not ask the DOM whether a control is disabled. Before it dispatches
a click it looks at the element's **props** (`shouldPreventMouseEvent`). So a
button written as

```tsx
<button id="btn-x" disabled={true} onClick={() => App.x()}>…</button>
```

that `app.ts` later enables the only way it knows how —

```ts
(document.getElementById('btn-x') as HTMLButtonElement).disabled = false;
```

looks enabled, *is* enabled as far as the browser is concerned, and still
swallows every click. Silently: no error, no warning, nothing in the console.
That is how the React port left 18 buttons dead on arrival — the Projects
page's Open / Export / Delete, all of Datasety's dataset actions, both teleop
buttons, stop-training and stop-inference.

There are exactly two allowed ways to write it, and `scripts/verify.sh`
rejects the constant:

```tsx
disabled={!selected}              // derived from React state — preferred
ref={initiallyDisabled}           // app.ts owns the property (util/initiallyDisabled.ts)
```

The second loses nothing: the browser does not fire click events on a disabled
control either, so `el.disabled = true` still blocks the button on its own.

The general shape of the trap is worth remembering when converting the
remaining pages: **anything React holds in props and app.ts mutates in the DOM
is a place the two can silently disagree.** `disabled` is the one that eats
events; `value`, `checked` and `selected` are the others.

## State of the migration

The components are a faithful port of the hand-written `index.html`: same
elements, ids, classes, attributes and order. That was verified against the
pre-migration build by comparing the live DOM of every page and overlay
(2 400+ nodes, identical) and by byte-comparing screenshots of all eight pages
(identical).

**Projects is the first page off imperative rendering.** `state/projects.ts`
holds a snapshot (listing, selected path, open path, path being opened) that
`legacy/app.ts` publishes through `App.publishProjects()`; `ProjectsPage.tsx`
subscribes with `useSyncExternalStore` and is the only thing that paints it.
`renderProjectDetail()`, `_detailRow()` and the innerHTML halves of
`renderProjectList()` / `updateProjectCardsActiveState()` are gone. A store
rather than context because the publisher is not a component and cannot call
hooks.

Everywhere else **the logic layer is still imperative**. `legacy/app.ts`
drives the UI by `getElementById` and `innerHTML`, exactly as before, and
those parts of the React tree are rendered once and never re-rendered — which
is why it is safe for app.ts to mutate them. Concretely:

- every page is mounted at once and hidden with `.editor-area` /
  `.active-page`; `App.changeTab()` switches them,
- `App.init()` runs from a `useEffect` in `main.tsx`, because React 19 commits
  the tree asynchronously and anything earlier (including
  `requestAnimationFrame`) can run before the DOM exists,
- `<React.StrictMode>` is off: it would mount twice and run `init()` twice,
  opening two WebSockets.

Datasets is the next page worth converting — it holds the largest amount of
dynamic `innerHTML` left.
