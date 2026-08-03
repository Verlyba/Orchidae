/**
 * "Sběr dat & Dovednosti" (Datasety → collect tab) state — the recording panel
 * and the sub-task marking column.
 *
 * This is the tab the whole project exists for: one take is recorded once, its
 * sub-task boundaries are marked while it runs, and the resulting dataset then
 * feeds BOTH branches of the comparison (whole = ACT baseline, cut on the marks
 * = orchestration). Everything the tab shows about the selected skill used to be
 * painted by `App.selectSkill()`, `App.renderStepPlan()` and
 * `App.renderTaggingSteps()` writing innerHTML strings and poking a dozen
 * element ids; this is the same data, published once and rendered by React.
 *
 * Same shape as `state/projects` and `state/datasets`, and for the same reason:
 * the publisher is `legacy/app.ts`, which is not a component and cannot call
 * hooks, so the bridge is a store read through `useSyncExternalStore`.
 *
 * Nothing here is pre-translated. Reasons and states are carried as i18n KEYS
 * and resolved at render time — a snapshot holding finished Czech prose would
 * survive the language toggle and show the wrong language until the next
 * refetch (and the refetch is over the network, for a language switch).
 */

import { useSyncExternalStore } from 'react';

/** One ordered sub-step of the selected skill: what a boundary mark separates. */
export type SubStep = {
  slug: string;
  name: string;
};

/** Phase of lerobot_record's loop. Marks only mean something during `record`. */
export type RecordPhase = 'idle' | 'record' | 'reset';

/** Whether a policy was trained for the selected skill; '' until answered. */
export type PolicyState = '' | 'trained' | 'untrained' | 'unknown';

export type CollectSnapshot = {
  // ── The selected skill, straight from the project tree ──────────────
  /** Slug of the selected skill; '' when nothing is selected yet. */
  skill: string;
  /** Display name of the selected skill (falls back to the slug). */
  skillName: string;
  /** True when the selection is itself a sub-step of something else. */
  isStep: boolean;
  /** Ordered sub-steps of the selection — the phases that get marked. */
  subSteps: SubStep[];
  /**
   * Whether lerobot-record can be pointed at this selection at all. A
   * top-level task with no sub-steps has no dataset of its own, so the panel
   * shows its empty state instead of a configuration nobody can run.
   */
  recordable: boolean;
  /** `local/<parent>/<slug>` — the dataset the take is written into. */
  repoId: string;

  // ── Facts read from disk (two round trips, not instant) ─────────────
  /** dataset_info / policy_status in flight — the readouts say so. */
  detailLoading: boolean;
  /** Episodes already on disk; -1 while unknown. */
  episodes: number;
  /** Dataset size as the backend formatted it; '' while unknown. */
  sizeMb: string;
  policy: PolicyState;

  // ── Whether a take can be started at all ────────────────────────────
  /**
   * i18n key of the hardware problem that blocks recording ('' = ready).
   * Derived from the project's own robot entry — no port or no camera means
   * lerobot-record would refuse, so the button says so before the click.
   */
  hwErrorKey: string;
  /** Another LeRobot process holds the serial bus (teleop, calibration, …). */
  busBusy: boolean;
  /** The process registry reports a running `record` process. */
  recordRunning: boolean;
  /** POST /recording/start is in flight — spawning also opens the serial port. */
  starting: boolean;
  /**
   * The app's own "a take is running" switch, set around /recording/start and
   * /recording/stop. Kept next to `recordRunning` rather than merged into it:
   * this one flips immediately, the registry one only once the process reports.
   */
  recordingActive: boolean;

  // ── The take in progress ────────────────────────────────────────────
  phase: RecordPhase;
  /** Index of the sub-step currently being performed. */
  activeIndex: number;
  /** Boundary timestamps confirmed by the recording process, in seconds. */
  marks: number[];
  /** Episode index reported by the recording process; -1 = none yet. */
  episode: number;
  /**
   * `Date.now()` when the current take's timer started; 0 = not running.
   * The elapsed seconds are counted by the component that displays them, so a
   * 10 Hz timer repaints one `<strong>` instead of the whole column. The value
   * is display-only either way — marks are timestamped inside the recording
   * process, against the frames already written to the episode.
   */
  startedAt: number;
};

const EMPTY: CollectSnapshot = {
  skill: '',
  skillName: '',
  isStep: false,
  subSteps: [],
  recordable: false,
  repoId: '',
  detailLoading: false,
  episodes: -1,
  sizeMb: '',
  policy: '',
  hwErrorKey: '',
  busBusy: false,
  recordRunning: false,
  starting: false,
  recordingActive: false,
  phase: 'idle',
  activeIndex: 0,
  marks: [],
  episode: -1,
  startedAt: 0,
};

let snapshot: CollectSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getCollectSnapshot(): CollectSnapshot {
  return snapshot;
}

/**
 * Publish new state. A fresh object every time on purpose: the language
 * toggle re-publishes an unchanged selection precisely to force a repaint in
 * the new language, and `useSyncExternalStore` bails out on identity.
 */
export function publishCollect(next: Partial<CollectSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCollect(): CollectSnapshot {
  return useSyncExternalStore(subscribe, getCollectSnapshot, getCollectSnapshot);
}

// ── Derived answers, kept here so the panel and app.ts cannot disagree ──

/**
 * Two or more ordered sub-steps means at least one boundary, so the recording
 * can be cut into sub-datasets — the same rule the dataset splitter uses.
 */
export function isSplittable(s: CollectSnapshot): boolean {
  return s.subSteps.length >= 2;
}

/** Whether a boundary mark can be stored right now, and if not, why not. */
export function markState(s: CollectSnapshot): { enabled: boolean; labelKey: string } {
  const n = s.subSteps.length;
  // The last sub-step has no boundary after it — marking ends one step early.
  const allMarked = n >= 2 && s.activeIndex >= n - 1;
  if (n < 2) return { enabled: false, labelKey: 'rec.markNoBoundary' };
  if (s.phase !== 'record') return { enabled: false, labelKey: 'rec.markUnavailable' };
  if (allMarked) return { enabled: false, labelKey: 'rec.allPhasesMarked' };
  return { enabled: true, labelKey: 'rec.markPhaseEnd' };
}

/**
 * Whether "Spustit nahrávání" can run, and the i18n key explaining the answer.
 *
 * Both reasons live here on purpose. They used to be written by two different
 * functions onto the same button — `updateRecordingHardwareChecks()` for the
 * missing port/camera and `updateActionButtonStates()` for the busy serial bus
 * — and the second one re-enabled the button unconditionally whenever the bus
 * freed up, wiping out the first one's verdict. The button then offered to
 * start a recording the app itself knew had no port to record from.
 */
export function startState(s: CollectSnapshot): { enabled: boolean; titleKey: string } {
  if (s.starting) return { enabled: false, titleKey: 'btn.startingRecording' };
  if (s.recordRunning) return { enabled: false, titleKey: 'tip.recordAlready' };
  if (s.busBusy) return { enabled: false, titleKey: 'tip.busBusy' };
  if (!s.recordable) return { enabled: false, titleKey: 'tip.recordNeedsSkill' };
  if (s.hwErrorKey) return { enabled: false, titleKey: s.hwErrorKey };
  return { enabled: true, titleKey: 'tip.startsRecord' };
}
