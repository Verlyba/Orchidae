/**
 * The project's skill tree — the left column of "Sběr dat & Dovednosti".
 *
 * This tree is the project's structure made visible: a top-level task (the
 * whole take) with its ordered sub-steps underneath (what the boundary marks
 * separate). Picking a row here is what every other panel on the tab reads
 * from, so the tree is where "which skill are we talking about" is decided.
 *
 * It used to be one `innerHTML` string built in `App.renderSkillsFull()`, and
 * that carried three problems this module exists to remove:
 *
 *  1. **Skill names were interpolated raw.** `<span>${details[m]?.name}</span>`
 *     with no `esc()` — and a skill name is free text the user types into the
 *     "new skill" modal. A name containing `<` did not display, it *parsed*.
 *     React escapes text nodes, so the whole class of problem is gone.
 *  2. **Every repaint refetched every badge.** The episode count next to each
 *     sub-step was fetched inside the render loop (one GET per sub-step) and
 *     written back by element id. Switching the UI language calls the render
 *     path, so changing the language walked the dataset directory once per
 *     sub-step. Counts live in this snapshot now; a repaint is a repaint.
 *  3. **Answers landed by element id.** Two overlapping renders wrote into
 *     `#ep-badge-<slug>` with no way to tell whose answer arrived. Counts are
 *     keyed by slug in state and stamped with a token, so an answer for a
 *     project that is no longer open cannot paint anything.
 *
 * Same store-not-context shape as `state/projects`, `state/datasets` and
 * `state/collect`, and for the same reason: the publisher is `legacy/app.ts`,
 * which is not a component and cannot call hooks.
 *
 * Nothing here is pre-translated — the snapshot carries slugs and names, and
 * the component resolves i18n keys at render time.
 */

import { useSyncExternalStore } from 'react';

/** Episode count for one sub-step's dataset. */
export type BadgeState =
  /** The GET is in flight (or has not been asked yet) — show a placeholder. */
  | { status: 'loading' }
  /** Answered: how many episodes are on disk (0 = dataset not recorded yet). */
  | { status: 'ready'; episodes: number }
  /** The GET failed — say so rather than showing a count that isn't one. */
  | { status: 'error' };

/** One sub-step row: a phase of the take, with its own dataset. */
export type SkillStep = {
  slug: string;
  name: string;
};

/** One top-level task and the sub-steps beneath it. */
export type SkillGroup = {
  slug: string;
  name: string;
  collapsed: boolean;
  steps: SkillStep[];
};

export type SkillsSnapshot = {
  /** Top-level tasks, in project order. Empty = the tree's empty state. */
  groups: SkillGroup[];
  /** Slug of the selected row; '' when nothing is selected. */
  activeSkill: string;
  /**
   * Episode counts keyed by sub-step slug. A slug missing from the map has
   * never been asked about — the row renders as loading, same as an in-flight
   * request, because from the user's side those are the same state.
   */
  badges: Record<string, BadgeState>;
};

const EMPTY: SkillsSnapshot = {
  groups: [],
  activeSkill: '',
  badges: {},
};

let snapshot: SkillsSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getSkillsSnapshot(): SkillsSnapshot {
  return snapshot;
}

/**
 * Publish new state. A fresh object every time on purpose: the language
 * toggle republishes an unchanged tree precisely to force a repaint in the
 * new language, and `useSyncExternalStore` bails out on identity.
 */
export function publishSkills(next: Partial<SkillsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

/**
 * Record one sub-step's episode count without disturbing the others.
 *
 * Separate from `publishSkills` because badge answers arrive one at a time,
 * out of order, and each must merge into the map rather than replace it.
 */
export function publishBadge(slug: string, state: BadgeState): void {
  publishSkills({ badges: { ...snapshot.badges, [slug]: state } });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSkills(): SkillsSnapshot {
  return useSyncExternalStore(subscribe, getSkillsSnapshot, getSkillsSnapshot);
}

// ── Derived answers, kept here so the tree and app.ts cannot disagree ──

/** Every sub-step slug in the tree, in display order — what needs a badge. */
export function allStepSlugs(s: SkillsSnapshot): string[] {
  return s.groups.flatMap(g => g.steps.map(st => st.slug));
}

/** Look a badge up; a slug nobody has asked about counts as still loading. */
export function badgeOf(s: SkillsSnapshot, slug: string): BadgeState {
  return s.badges[slug] || { status: 'loading' };
}
