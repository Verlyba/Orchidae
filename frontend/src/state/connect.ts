/**
 * The device-type list on Setup → Connect — one row per robot LeRobot
 * registers, plus which one the project currently has selected.
 *
 * Loaded once from `GET /api/hardware/device_types` (`legacy/app.ts`'s
 * `loadDeviceTypes()`); nothing in the browser derives `--robot.type` /
 * `--teleop.type` on its own, so this snapshot carries exactly what LeRobot's
 * own registry said, unmodified.
 *
 * It used to be an `innerHTML` string rebuilt by `App.renderRobotTypeList()`
 * on every change (device-type load, robot selection, port edits — anything
 * that could shift which row is "active"). Same store-not-context shape as
 * `state/skills`, `state/collect`, `state/datasets`, `state/trainTargets`, and
 * for the same reason: the publisher is `legacy/app.ts`, not a component, so
 * it cannot call hooks.
 *
 * The hidden `#robot-type-select` element is still the source of truth the
 * rest of the app reads the resolved robot type from (`onRobotTypeChange()`,
 * `saveSettingsState()`, `updateConnectCmdPreview()`) — this store only
 * mirrors it for the list to render from, it does not replace it.
 */

import { useSyncExternalStore } from 'react';

/** One device LeRobot registers, exactly as `DeviceType.to_dict()` sends it. */
export type DeviceType = {
  robot_type: string;
  leader_type: string | null;
  label: string;
  connection: string;
  port_flag: string;
  supported: boolean;
  has_leader: boolean;
};

export type ConnectSnapshot = {
  /** The catalogue as LeRobot's registry has it. Empty = not loaded yet. */
  deviceTypes: DeviceType[];
  /** `robot_type` of the row the hidden `<select>` currently holds. */
  activeRobotType: string;
};

const EMPTY: ConnectSnapshot = {
  deviceTypes: [],
  activeRobotType: '',
};

let snapshot: ConnectSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getConnectSnapshot(): ConnectSnapshot {
  return snapshot;
}

/** Fresh object every time on purpose — a language toggle republishes an
 * unchanged catalogue to force a repaint in the new language, and
 * `useSyncExternalStore` bails out on identity. */
export function publishConnect(next: Partial<ConnectSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) {
    try { l(); } catch (_) { /* one bad subscriber must not stop the rest */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useConnect(): ConnectSnapshot {
  return useSyncExternalStore(subscribe, getConnectSnapshot, getConnectSnapshot);
}

/** How many rows this single serial port setup can actually drive. */
export function usableCount(s: ConnectSnapshot): number {
  return s.deviceTypes.filter(d => d.supported).length;
}
