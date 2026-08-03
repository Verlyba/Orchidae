/**
 * Configured-camera list on Setup → Connect (`#hw-camera-list` /
 * `#hw-camera-count`) — the cameras the project has actually added, not the
 * raw port scan (`hw-camera-port-select`, still imperative in `legacy/app.ts`
 * — picking a port only feeds the live-preview box, it doesn't add a camera).
 *
 * Used to be an `innerHTML` string rebuilt by `App.renderCameras()` on every
 * change (project load, camera add/remove, `camera_started`/`camera_stopped`/
 * `camera_error`/`camera_suspended` over the websocket). Same store-not-context
 * shape as `state/connect`, for the same reason: the publisher is
 * `legacy/app.ts`, not a component, so it cannot call hooks.
 *
 * `renderCameras()` still owns the *docked* live-camera grid
 * (`.cameras-dock-body`, `#tele-cam-feed-placeholder-N`) directly — that one
 * stays `innerHTML` for now, it's a stateful MJPEG `<img>` stream rather than
 * static markup and hasn't been migrated yet.
 */

import { useSyncExternalStore } from 'react';

/** One camera the project has configured, exactly as the backend sends it
 * (`Camera.to_dict()` — see `CameraCreate` in `src/orchiday/server.py`). */
export type Camera = {
  id: string;
  source: number | string;
  role: string;
};

export type CamerasSnapshot = {
  cameras: Camera[];
  /** ids currently streaming (`App.activeCameras`) — drives the "ACTIVE" badge. */
  activeCameraIds: string[];
  /** False until the first project load publishes a real snapshot, so the
   * list can tell "no project open yet" apart from "project has 0 cameras". */
  loaded: boolean;
};

const EMPTY: CamerasSnapshot = {
  cameras: [],
  activeCameraIds: [],
  loaded: false,
};

let snapshot: CamerasSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getCamerasSnapshot(): CamerasSnapshot {
  return snapshot;
}

/** Fresh object every time on purpose — a language toggle republishes an
 * unchanged list to force a repaint in the new language, and
 * `useSyncExternalStore` bails out on identity. */
export function publishCameras(next: Partial<CamerasSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useCameras(): CamerasSnapshot {
  return useSyncExternalStore(subscribe, getCamerasSnapshot, getCamerasSnapshot);
}
