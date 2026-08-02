/**
 * Projects page state.
 *
 * The Projects page used to be painted by `App.renderProjectList()` and
 * `App.renderProjectDetail()` building innerHTML strings and poking element
 * ids. This is the same data, published once by the controller and rendered
 * by React — the first page moved off imperative DOM writes.
 *
 * Why a hand-written store instead of a context: the publisher is
 * `legacy/app.ts`, which is not a component and cannot call hooks. A store
 * with `useSyncExternalStore` is the supported way to bridge exactly that —
 * non-React code owns the data, React subscribes to it.
 */

import { useSyncExternalStore } from 'react';

export type ProjectsSnapshot = {
  /** Listing entries as the server returned them (`_path`, `name`, `slug`, …). */
  projects: any[];
  /** Row the user picked in the list; drives the detail panel. */
  selectedPath: string;
  /** Project that is actually open server-side (`App.project.path`). */
  openPath: string;
  /** Project currently being opened — a round trip that is not instant. */
  openingPath: string;
  /** False until the first listing arrives, so "loading" ≠ "no projects". */
  loaded: boolean;
};

const EMPTY: ProjectsSnapshot = {
  projects: [],
  selectedPath: '',
  openPath: '',
  openingPath: '',
  loaded: false,
};

let snapshot: ProjectsSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getProjectsSnapshot(): ProjectsSnapshot {
  return snapshot;
}

/**
 * Publish new state. A fresh object every time on purpose: the language
 * toggle re-publishes an unchanged listing precisely to force a repaint in
 * the new language, and `useSyncExternalStore` bails out on identity.
 */
export function publishProjects(next: Partial<ProjectsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useProjects(): ProjectsSnapshot {
  return useSyncExternalStore(subscribe, getProjectsSnapshot, getProjectsSnapshot);
}
