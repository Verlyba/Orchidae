"""
Orchestration run logger — persistent episode log of every orchestration run.

Each run is stored inside the project directory:

    orchestration_runs/
        run_20260715_153000/
            run.json            # instruction, plan, per-step results, timings
            step_00_pick.jpg    # VLM verification snapshot of step 0
            step_01_place.jpg

This is the "special dataset structure" of the orchestration layer: every step
maps to a small per-step model, and the log captures which model ran, how long
it took, what the VLM saw, and whether the step succeeded. The logs are the raw
material for evaluating the multi-model schema against a monolithic baseline.

The logger is fully decoupled — it only listens to event_bus signals, so it can
never break the orchestration flow itself.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from PySide6.QtCore import QObject, Slot

from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class OrchestrationRunLogger(QObject):
    """Writes orchestration_runs/{run_id}/run.json incrementally during a run."""

    def __init__(self, project_manager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._run_dir: Path | None = None
        self._run: dict[str, Any] = {}
        self._current_step: dict[str, Any] | None = None
        self._pending_snapshot: str = ""

        event_bus.orchestration_requested.connect(self._on_run_requested)
        event_bus.orchestration_plan_ready.connect(self._on_plan_ready)
        event_bus.orchestration_task_started.connect(self._on_task_started)
        event_bus.orchestration_vlm_snap.connect(self._on_vlm_snap)
        event_bus.orchestration_task_completed.connect(self._on_task_completed)
        event_bus.orchestration_finished.connect(self._on_finished)
        event_bus.orchestration_error.connect(self._on_error)

    # ── Helpers ──────────────────────────────────────────────────────────

    def _project_path(self) -> Path | None:
        try:
            if self._pm is not None and self._pm.current_path:
                return Path(self._pm.current_path)
        except Exception:
            pass
        return None

    def _flush(self) -> None:
        """Write run.json to disk (incremental, crash-safe)."""
        if not self._run_dir or not self._run:
            return
        try:
            self._run_dir.mkdir(parents=True, exist_ok=True)
            with open(self._run_dir / "run.json", "w", encoding="utf-8") as f:
                json.dump(self._run, f, indent=2, ensure_ascii=False)
        except Exception as e:
            log.warning("Failed to write orchestration run log: %s", e)

    @staticmethod
    def _now() -> str:
        return datetime.now().isoformat(timespec="seconds")

    # ── Event slots ──────────────────────────────────────────────────────

    @Slot(str)
    def _on_run_requested(self, instruction: str) -> None:
        project_path = self._project_path()
        if project_path is None:
            self._run_dir = None
            self._run = {}
            return
        run_id = "run_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        self._run_dir = project_path / "orchestration_runs" / run_id
        self._run = {
            "run_id": run_id,
            "instruction": instruction,
            "started_at": self._now(),
            "plan": [],
            "replans": 0,
            "steps": [],
            "finished_at": None,
            "success": None,
            "error": None,
        }
        self._current_step = None
        self._pending_snapshot = ""
        self._flush()

    @Slot(list)
    def _on_plan_ready(self, plan: list) -> None:
        if not self._run:
            return
        if self._run["plan"]:
            # A subsequent plan means either the resolved (expanded) plan
            # or a re-plan after a failed step
            if self._run["steps"]:
                self._run["replans"] += 1
        self._run["plan"] = list(plan)
        self._flush()

    @Slot(str)
    def _on_task_started(self, task_name: str) -> None:
        if not self._run:
            return
        self._current_step = {
            "index": len(self._run["steps"]),
            "task": task_name,
            "started_at": self._now(),
            "finished_at": None,
            "success": None,
            "snapshot": None,
        }
        self._pending_snapshot = ""

    @Slot(str)
    def _on_vlm_snap(self, image_b64: str) -> None:
        # Snapshot arrives during VERIFYING, before task_completed
        self._pending_snapshot = image_b64 or ""

    @Slot(str, bool)
    def _on_task_completed(self, task_name: str, success: bool) -> None:
        if not self._run:
            return
        step = self._current_step or {
            "index": len(self._run["steps"]),
            "task": task_name,
            "started_at": None,
            "finished_at": None,
            "success": None,
            "snapshot": None,
        }
        step["finished_at"] = self._now()
        step["success"] = bool(success)

        if self._pending_snapshot and self._run_dir:
            fname = f"step_{step['index']:02d}_{task_name}.jpg"
            try:
                self._run_dir.mkdir(parents=True, exist_ok=True)
                with open(self._run_dir / fname, "wb") as f:
                    f.write(base64.b64decode(self._pending_snapshot))
                step["snapshot"] = fname
            except Exception as e:
                log.warning("Failed to save VLM snapshot: %s", e)
            self._pending_snapshot = ""

        self._run["steps"].append(step)
        self._current_step = None
        self._flush()

    @Slot(bool)
    def _on_finished(self, success: bool) -> None:
        if not self._run:
            return
        self._run["finished_at"] = self._now()
        self._run["success"] = bool(success)
        self._flush()
        self._run = {}
        self._run_dir = None

    @Slot(str)
    def _on_error(self, message: str) -> None:
        if not self._run:
            return
        self._run["finished_at"] = self._now()
        self._run["success"] = False
        self._run["error"] = message
        self._flush()
        self._run = {}
        self._run_dir = None


def list_runs(project_path: Path, limit: int = 50) -> list[dict[str, Any]]:
    """Return run.json summaries of the most recent orchestration runs."""
    runs_dir = Path(project_path) / "orchestration_runs"
    if not runs_dir.exists():
        return []
    results: list[dict[str, Any]] = []
    for run_dir in sorted(runs_dir.iterdir(), reverse=True)[:limit]:
        run_file = run_dir / "run.json"
        if not run_file.exists():
            continue
        try:
            with open(run_file, "r", encoding="utf-8") as f:
                results.append(json.load(f))
        except Exception:
            continue
    return results
