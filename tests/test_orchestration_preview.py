"""
Tests for `OrchidayController.orchestration_plan_preview()` — the read-only
answer the Orchestration page renders before a run.

The point of these tests is that the preview must not be able to drift away
from what a real run does: the step list has to come from the orchestrator's
own plan resolver, the checkpoint from the same `_policy_path_for()` the
executor hands to the daemon, and the readiness flag from the same bridge
check that refuses to spawn it.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.core.controller import OrchidayController


class _FakePM:
    def __init__(self, project):
        self.current_project = project
        self.current_path = None


class _FakeBridge:
    """Stands in for LeRobotBridge; records what it was asked about."""

    def __init__(self, existing: set[str] | None = None):
        self.existing = existing or set()
        self.asked: list[str] = []

    def policy_exists(self, policy_path: str) -> bool:
        self.asked.append(policy_path)
        return policy_path in self.existing


def _make_controller(project, bridge=None, data_dir="/data") -> OrchidayController:
    ctrl = OrchidayController.__new__(OrchidayController)  # skip heavy __init__
    ctrl.pm = _FakePM(project)
    ctrl.lerobot_bridge = bridge or _FakeBridge()
    ctrl._data_dir = Path(data_dir)
    return ctrl


PROJECT = {
    "policy_architecture": "act",
    "skills": ["tidy_table", "grab_cube", "move_to_box", "solo_wave"],
    "skills_details": {
        "tidy_table": {"name": "Ukliď stůl"},
        "grab_cube": {"name": "Uchop kostku", "parent_slug": "tidy_table"},
        "move_to_box": {"name": "Přesuň do krabice", "parent_slug": "tidy_table"},
        "solo_wave": {"name": "Zamávej"},
    },
}


def test_sub_steps_are_not_listed_as_tasks_of_their_own():
    preview = _make_controller(PROJECT).orchestration_plan_preview()
    assert [t["slug"] for t in preview["tasks"]] == ["tidy_table", "solo_wave"]


def test_parent_task_expands_into_its_ordered_steps():
    preview = _make_controller(PROJECT).orchestration_plan_preview()
    tidy = preview["tasks"][0]
    assert [s["slug"] for s in tidy["steps"]] == ["grab_cube", "move_to_box"]
    assert [s["name"] for s in tidy["steps"]] == ["Uchop kostku", "Přesuň do krabice"]


def test_two_or_more_steps_is_the_orchestrated_verdict():
    preview = _make_controller(PROJECT).orchestration_plan_preview()
    by_slug = {t["slug"]: t for t in preview["tasks"]}
    assert by_slug["tidy_table"]["orchestrated"] is True
    # A task with no sub-steps runs as a single policy — the ACT baseline.
    assert by_slug["solo_wave"]["orchestrated"] is False
    assert [s["slug"] for s in by_slug["solo_wave"]["steps"]] == ["solo_wave"]


def test_step_order_follows_project_json_not_alphabet():
    project = {
        **PROJECT,
        "skills": ["tidy_table", "move_to_box", "grab_cube", "solo_wave"],
    }
    preview = _make_controller(project).orchestration_plan_preview()
    assert [s["slug"] for s in preview["tasks"][0]["steps"]] == ["move_to_box", "grab_cube"]


def test_checkpoint_path_matches_what_the_executor_would_use():
    ctrl = _make_controller(PROJECT)
    preview = ctrl.orchestration_plan_preview()
    for step in preview["tasks"][0]["steps"]:
        assert step["policy_path"] == ctrl._policy_path_for(step["slug"])
    # ... and that path is the parent-prefixed slug plus the architecture.
    assert preview["tasks"][0]["steps"][0]["policy_path"].endswith(
        str(Path("outputs") / "training" / "tidy_table_grab_cube_act"))


def test_readiness_comes_from_the_bridge_check():
    ctrl = _make_controller(PROJECT)
    ready_path = ctrl._policy_path_for("grab_cube")
    bridge = _FakeBridge(existing={ready_path})
    ctrl.lerobot_bridge = bridge

    steps = ctrl.orchestration_plan_preview()["tasks"][0]["steps"]
    assert [s["policy_ready"] for s in steps] == [True, False]
    assert bridge.asked[0] == ready_path


def test_policy_architecture_is_reported():
    assert _make_controller(PROJECT).orchestration_plan_preview()["policy_architecture"] == "act"
    # Missing key falls back to the same default the executor uses.
    assert _make_controller(
        {"skills": [], "skills_details": {}}
    ).orchestration_plan_preview()["policy_architecture"] == "diffusion"


def test_empty_project_yields_no_tasks():
    preview = _make_controller({}).orchestration_plan_preview()
    assert preview["tasks"] == []


def test_no_project_open_does_not_raise():
    preview = _make_controller(None).orchestration_plan_preview()
    assert preview == {"policy_architecture": "diffusion", "tasks": []}


def test_task_without_a_display_name_falls_back_to_its_slug():
    project = {"skills": ["nameless"], "skills_details": {"nameless": {}}}
    task = _make_controller(project).orchestration_plan_preview()["tasks"][0]
    assert task["name"] == "nameless"
    assert task["steps"][0]["name"] == "nameless"
