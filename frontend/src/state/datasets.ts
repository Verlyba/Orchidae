/**
 * "Správa datasetů" (Datasety → manage tab) state.
 *
 * The panel used to be painted by `App.dsRefreshList()` writing `<option>`
 * strings into two `<select>`s and `App.dsOnSelect()` poking a dozen element
 * ids (`ds-info-*` text, `ds-btn-*` `.disabled` and `.title`). This is the
 * same data, published once by the controller and rendered by React.
 *
 * Same shape as `state/projects`, and for the same reason: the publisher is
 * `legacy/app.ts`, which is not a component and cannot call hooks, so the
 * bridge is a store read through `useSyncExternalStore`.
 *
 * Nothing here is pre-translated. Tips are carried as i18n KEYS and resolved
 * at render time — a snapshot holding finished Czech prose would survive the
 * language toggle and show the wrong language until the next refetch.
 */

import { useSyncExternalStore } from 'react';

/** One row of `GET /api/datasets/list` — a skill and its derived dataset. */
export type DatasetEntry = {
  skill: string;
  name: string;
  parent: string;
  repo_id: string;
  /** Whether LeRobot can already find the dataset on disk. */
  exists: boolean;
};

/** `GET /api/skills/<slug>/dataset_info`, normalized. */
export type DatasetInfo = {
  exists: boolean;
  episodes: number;
  fps: number;
  sizeMb: number;
};

export type DatasetsSnapshot = {
  datasets: DatasetEntry[];
  /** False until the first listing arrives, so "loading" ≠ "no datasets". */
  loaded: boolean;
  /** `GET /datasets/list` in flight — the list can take a moment on a NAS. */
  refreshing: boolean;
  /** repo_id of the dataset the operations apply to. */
  selectedRepo: string;
  /** repo_id of the second dataset for the merge operation. */
  mergeRepo: string;
  /** Detail round trips (dataset_info + policy_status + step_marks) in flight. */
  detailLoading: boolean;
  /** Null while unknown (nothing selected, or still loading). */
  info: DatasetInfo | null;
  /** A trained policy exists for the selected skill → export is meaningful. */
  modelExists: boolean;
  /** Dataset on disk + ≥2 ordered sub-steps + at least one marked episode. */
  splitStepsEnabled: boolean;
  /** i18n key explaining the split button's current state. */
  splitStepsTipKey: string;
  /**
   * Operation whose POST is in flight ('push', 'split_steps', 'info', …).
   * Only one at a time: they all target the selected dataset and each one
   * ends up in the same console dock.
   */
  busyOp: string;
};

const EMPTY: DatasetsSnapshot = {
  datasets: [],
  loaded: false,
  refreshing: false,
  selectedRepo: '',
  mergeRepo: '',
  detailLoading: false,
  info: null,
  modelExists: false,
  splitStepsEnabled: false,
  splitStepsTipKey: 'tip.splitNeedsDataset',
  busyOp: '',
};

let snapshot: DatasetsSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getDatasetsSnapshot(): DatasetsSnapshot {
  return snapshot;
}

/**
 * Publish new state. A fresh object every time on purpose: the language
 * toggle re-publishes an unchanged listing precisely to force a repaint in
 * the new language, and `useSyncExternalStore` bails out on identity.
 */
export function publishDatasets(next: Partial<DatasetsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDatasets(): DatasetsSnapshot {
  return useSyncExternalStore(subscribe, getDatasetsSnapshot, getDatasetsSnapshot);
}
