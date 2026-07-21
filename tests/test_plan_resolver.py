"""
Tests for the orchestration plan resolver — validation of LLM plans and
expansion of parent skills into ordered per-step models.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.core.controller import OrchidayController


class _FakePM:
    """Minimal ProjectManager stand-in for resolver tests."""

    def __init__(self, project):
        self.current_project = project
        self.current_path = None


def _make_controller(project) -> OrchidayController:
    ctrl = OrchidayController.__new__(OrchidayController)  # skip heavy __init__
    ctrl.pm = _FakePM(project)
    return ctrl


PROJECT = {
    "skills": ["tidy_table", "grab_cube", "move_to_box", "release"],
    "skills_details": {
        "tidy_table": {"name": "Ukliď stůl"},
        "grab_cube": {"name": "Uchop kostku", "parent_slug": "tidy_table"},
        "move_to_box": {"name": "Přesuň do krabice", "parent_slug": "tidy_table"},
        "release": {"name": "Pusť", "parent_slug": "tidy_table"},
    },
}


def test_parent_goal_expands_to_ordered_steps():
    ctrl = _make_controller(PROJECT)
    plan = ctrl._resolve_orchestration_plan(["tidy_table"])
    assert plan == ["grab_cube", "move_to_box", "release"]


def test_unknown_skills_are_dropped():
    ctrl = _make_controller(PROJECT)
    plan = ctrl._resolve_orchestration_plan(["fly_to_moon", "grab_cube"])
    assert plan == ["grab_cube"]


def test_display_names_map_back_to_slugs():
    ctrl = _make_controller(PROJECT)
    plan = ctrl._resolve_orchestration_plan(["Uchop kostku", "Pusť"])
    assert plan == ["grab_cube", "release"]


def test_consecutive_duplicates_collapse():
    ctrl = _make_controller(PROJECT)
    plan = ctrl._resolve_orchestration_plan(["grab_cube", "grab_cube", "release"])
    assert plan == ["grab_cube", "release"]


def test_mixed_goal_and_step_plan():
    ctrl = _make_controller(PROJECT)
    plan = ctrl._resolve_orchestration_plan(["grab_cube", "tidy_table"])
    # The goal expansion starts with grab_cube again - consecutive dup collapses
    assert plan == ["grab_cube", "move_to_box", "release"]
