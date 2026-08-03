/**
 * The training target checklist — left column of "Učení / Imitační učení".
 *
 * Both branches of the project's comparison are trainable from here, because
 * both come out of the SAME recording: the whole dataset (`baseline`, the ACT
 * control arm) and the sub-datasets the splitter cuts from it (`steps`, one
 * per orchestration step). Ticking rows here is what `startWorkflowTraining()`
 * reads to decide which `lerobot-train` runs to queue.
 *
 * It used to be one `innerHTML` string built in `App.renderTrainingSkillsTree()`
 * — a second tree built the same way as the pre-migration skills tree in
 * `state/skills.ts`, so it carried the same class of trap that tree's own
 * migration found and fixed there:
 *
 *  1. **Task/skill names were interpolated raw** (`${this.esc(target.name)}`
 *     protected the text, but the checkbox's own `checked`/`disabled` never
 *     went through React — see next point).
 *  2. **Checkbox state was uncontrolled DOM, not read back.** A row's
 *     `checked` attribute was only ever written once, at render time; ticking
 *     it relied on the browser's own checkbox toggling itself, and the "select
 *     all" parent checkbox never reflected whether its children were already
 *     all ticked — checking every row by hand left the parent box looking
 *     unticked. Controlled checkboxes here fix that: the parent's own checked
 *     state is derived from its children, same as every other control in this
 *     app that learned the hard way what happens when React's props and a
 *     manual DOM write disagree (`disabled` in run 20; see
 *     `util/initiallyDisabled.ts`).
 *
 * Nothing here is pre-translated — the snapshot carries slugs, names and
 * plain numbers, and the component resolves i18n keys at render time, so a
 * language switch is a republish, not a refetch (this tree already had that
 * property; it stays true here).
 */

import { useSyncExternalStore } from 'react';

/** What a row's progress row shows, if anything. */
export type TrainRowProgress =
  /** This is the one target currently being trained. `step` is null until the
   * first `training_progress` message arrives — until then the row says
   * "training…", not "step 0". */
  | { kind: 'active'; step: number | null; totalSteps: number; lossText: string }
  /** Queued behind the active target, not started yet. */
  | { kind: 'queued' }
  /** One-shot flash right after `training_finished` — cleared by the next
   * full republish (the readiness refresh that follows replaces it with the
   * real "checkpoint ready" flag). */
  | { kind: 'done' }
  /** Same one-shot idea, for `training_error`. */
  | { kind: 'error' };

export type TrainRowSnapshot = {
  slug: string;
  name: string;
  repoId: string;
  policyPath: string;
  datasetReady: boolean;
  policyReady: boolean;
  willResume: boolean;
  trainingOutputDir: string;
  checked: boolean;
  progress: TrainRowProgress | null;
};

export type TrainTaskSnapshot = {
  slug: string;
  name: string;
  orchestrated: boolean;
  baseline: TrainRowSnapshot;
  steps: TrainRowSnapshot[];
};

export type TrainStats = {
  taskCount: number;
  datasetsReady: number;
  datasetsTotal: number;
  datasetsWarn: boolean;
  ckptsReady: number;
  ckptsTotal: number;
  ckptsWarn: boolean;
  archLabel: string;
};

export type TrainTargetsSnapshot = {
  hasProject: boolean;
  tasks: TrainTaskSnapshot[];
  stats: TrainStats;
};

const EMPTY_STATS: TrainStats = {
  taskCount: 0,
  datasetsReady: 0,
  datasetsTotal: 0,
  datasetsWarn: false,
  ckptsReady: 0,
  ckptsTotal: 0,
  ckptsWarn: false,
  archLabel: '–',
};

const EMPTY: TrainTargetsSnapshot = { hasProject: false, tasks: [], stats: EMPTY_STATS };

let snapshot: TrainTargetsSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getTrainTargetsSnapshot(): TrainTargetsSnapshot {
  return snapshot;
}

/** Publish a full snapshot — always a fresh object, so a same-data republish
 * (a language switch) still forces `useSyncExternalStore` to repaint. */
export function publishTrainTargets(next: TrainTargetsSnapshot): void {
  snapshot = next;
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTrainTargets(): TrainTargetsSnapshot {
  return useSyncExternalStore(subscribe, getTrainTargetsSnapshot, getTrainTargetsSnapshot);
}
