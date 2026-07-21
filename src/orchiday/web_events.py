"""
WebSocket event bridge for Orchiday.

Connects Qt-based event_bus signals to a WebSocket broadcast system,
allowing the web frontend to receive real-time updates from all backend modules.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


class WebEventBridge:
    """
    Bridges the Qt event_bus signals to WebSocket JSON messages.

    Each signal is mapped to a named event type and broadcast
    to all connected WebSocket clients.
    """

    def __init__(self):
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def register_client(self, ws) -> None:
        self._clients.add(ws)
        log.info("WebSocket client connected (total: %d)", len(self._clients))

    def unregister_client(self, ws) -> None:
        self._clients.discard(ws)
        log.info("WebSocket client disconnected (total: %d)", len(self._clients))

    def broadcast(self, event_type: str, data: Any = None) -> None:
        """Broadcast an event to all connected WebSocket clients."""
        message = json.dumps({"event": event_type, "data": data}, default=str)
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future,
                self._async_broadcast(message),
            )
        else:
            # Fallback: try to create a task directly
            try:
                asyncio.ensure_future(self._async_broadcast(message))
            except RuntimeError:
                pass

    async def _async_broadcast(self, message: str) -> None:
        """Send a message to all connected clients."""
        disconnected = set()
        for ws in self._clients:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.add(ws)
        for ws in disconnected:
            self._clients.discard(ws)

    def connect_event_bus(self) -> None:
        """Wire all event_bus Qt signals to WebSocket broadcasts."""
        from orchiday.core.events import event_bus

        # ── Project events ───────────────────────────────────────────
        event_bus.project_created.connect(
            lambda d: self.broadcast("project_created", d))
        event_bus.project_opened.connect(
            lambda d: self.broadcast("project_opened", d))
        event_bus.project_closed.connect(
            lambda: self.broadcast("project_closed"))
        event_bus.project_saved.connect(
            lambda: self.broadcast("project_saved"))

        # ── Robot events ─────────────────────────────────────────────
        event_bus.robot_added.connect(
            lambda d: self.broadcast("robot_added", d))
        event_bus.robot_removed.connect(
            lambda rid: self.broadcast("robot_removed", rid))
        event_bus.robot_connected.connect(
            lambda rid: self.broadcast("robot_connected", rid))
        event_bus.robot_disconnected.connect(
            lambda rid: self.broadcast("robot_disconnected", rid))
        event_bus.robot_error.connect(
            lambda rid, msg: self.broadcast("robot_error", {"id": rid, "error": msg}))
        event_bus.robot_calibrating.connect(
            lambda rid: self.broadcast("robot_calibrating", rid))
        event_bus.robot_calibrated.connect(
            lambda rid: self.broadcast("robot_calibrated", rid))

        # ── Camera events ────────────────────────────────────────────
        event_bus.camera_added.connect(
            lambda d: self.broadcast("camera_added", d))
        event_bus.camera_removed.connect(
            lambda cid: self.broadcast("camera_removed", cid))
        event_bus.camera_started.connect(
            lambda cid: self.broadcast("camera_started", cid))
        event_bus.camera_stopped.connect(
            lambda cid: self.broadcast("camera_stopped", cid))
        event_bus.camera_error.connect(
            lambda cid, msg: self.broadcast("camera_error", {"id": cid, "error": msg}))
        event_bus.camera_suspended.connect(
            lambda cid: self.broadcast("camera_suspended", cid))

        # ── AI model events ──────────────────────────────────────────
        event_bus.model_configured.connect(
            lambda role, cfg: self.broadcast("model_configured", {"role": role, "config": cfg}))
        event_bus.model_connection_ok.connect(
            lambda role: self.broadcast("model_connection_ok", role))
        event_bus.model_connection_fail.connect(
            lambda role, msg: self.broadcast("model_connection_fail", {"role": role, "error": msg}))

        # ── Skill events ─────────────────────────────────────────────
        event_bus.skill_created.connect(
            lambda d: self.broadcast("skill_created", d))
        event_bus.skill_deleted.connect(
            lambda s: self.broadcast("skill_deleted", s))
        event_bus.recording_started.connect(
            lambda s: self.broadcast("recording_started", s))
        event_bus.recording_stopped.connect(
            lambda s, n: self.broadcast("recording_stopped", {"skill": s, "episodes": n}))
        event_bus.recording_progress.connect(
            lambda s, p: self.broadcast("recording_progress", {"skill": s, "progress": p}))
        event_bus.recording_episode.connect(
            lambda s, ep: self.broadcast("recording_episode", {"skill": s, "episode": ep}))
        event_bus.step_marked.connect(
            lambda s, mark: self.broadcast("step_marked", {"skill": s, **(mark or {})}))

        # ── Training events ──────────────────────────────────────────
        event_bus.training_started.connect(
            lambda s: self.broadcast("training_started", s))
        event_bus.training_stopped.connect(
            lambda s: self.broadcast("training_stopped", s))
        event_bus.training_progress.connect(
            lambda s, ep, loss: self.broadcast("training_progress", {"skill": s, "epoch": ep, "loss": loss}))
        event_bus.training_finished.connect(
            lambda s, p: self.broadcast("training_finished", {"skill": s, "checkpoint": p}))
        event_bus.training_error.connect(
            lambda s, msg: self.broadcast("training_error", {"skill": s, "error": msg}))
        event_bus.inference_finished.connect(
            lambda s: self.broadcast("inference_finished", s))

        # ── Orchestration events ─────────────────────────────────────
        event_bus.orchestration_plan_ready.connect(
            lambda plan: self.broadcast("orchestration_plan_ready", plan))
        event_bus.orchestration_task_started.connect(
            lambda t: self.broadcast("orchestration_task_started", t))
        event_bus.orchestration_task_completed.connect(
            lambda t, ok: self.broadcast("orchestration_task_completed", {"task": t, "success": ok}))
        event_bus.orchestration_locked.connect(
            lambda: self.broadcast("orchestration_locked"))
        event_bus.orchestration_unlocked.connect(
            lambda: self.broadcast("orchestration_unlocked"))
        event_bus.orchestration_finished.connect(
            lambda ok: self.broadcast("orchestration_finished", ok))
        event_bus.orchestration_error.connect(
            lambda msg: self.broadcast("orchestration_error", msg))
        event_bus.orchestration_vlm_snap.connect(
            lambda b64: self.broadcast("orchestration_vlm_snap", b64))

        # ── Safety events ────────────────────────────────────────────
        event_bus.safety_warning.connect(
            lambda rid, msg: self.broadcast("safety_warning", {"robot": rid, "message": msg}))
        event_bus.emergency_stop.connect(
            lambda rid: self.broadcast("emergency_stop", rid))
        event_bus.watchdog_timeout.connect(
            lambda rid: self.broadcast("watchdog_timeout", rid))

        # ── Subprocess lifecycle (drives UI button states) ───────────
        event_bus.process_started.connect(
            lambda key, kind: self.broadcast("process_started", {"key": key, "kind": kind}))
        event_bus.process_finished.connect(
            lambda key, kind: self.broadcast("process_finished", {"key": key, "kind": kind}))

        # ── Console / Log events ─────────────────────────────────────
        event_bus.log_message.connect(
            lambda level, msg: self.broadcast("log_message", {"level": level, "message": msg}))
        event_bus.console_output.connect(
            lambda text: self.broadcast("console_output", text))

        log.info("WebEventBridge: all event_bus signals connected")


# Singleton instance
web_bridge = WebEventBridge()
