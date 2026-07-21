"""
Tests for scene-description prompt grounding: the physical workspace
description entered at project creation must reach both the CEO planner's
and the VLM inspector's prompts, and project creation must persist it.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.ai.llm_planner import LLMPlanner
from orchiday.ai.vlm_inspector import VLMInspector


# ── LLMPlanner (CEO) ──────────────────────────────────────────────────────

def test_system_prompt_includes_scene_description():
    planner = LLMPlanner(client=None, scene_description="Cameras: overhead + wrist. White bowl on the left.")
    prompt = planner._build_system_prompt()
    assert "Cameras: overhead + wrist. White bowl on the left." in prompt
    assert "Scene description" in prompt


def test_system_prompt_omits_scene_block_when_empty():
    planner = LLMPlanner(client=None, scene_description="")
    prompt = planner._build_system_prompt()
    assert "Scene description" not in prompt


def test_set_scene_description_updates_prompt():
    planner = LLMPlanner(client=None, scene_description="")
    planner.set_scene_description("Updated scene: red box center.")
    prompt = planner._build_system_prompt()
    assert "Updated scene: red box center." in prompt


def test_scene_description_precedes_skills_list():
    planner = LLMPlanner(client=None, scene_description="Scene A",
                         available_skills=["grab_cube"],
                         skills_details={"grab_cube": {"name": "Grab", "description": "Grabs it"}})
    prompt = planner._build_system_prompt()
    assert prompt.index("Scene A") < prompt.index("Available robot skills")


# ── VLMInspector ──────────────────────────────────────────────────────────

def test_verification_prompt_includes_scene_context():
    inspector = VLMInspector(client=None, scene_description="Overhead camera, wooden table.")
    prompt = inspector._build_verification_prompt("grab_cube", None)
    assert prompt.startswith("Scene context: Overhead camera, wooden table.")


def test_verification_prompt_omits_scene_block_when_empty():
    inspector = VLMInspector(client=None, scene_description="")
    prompt = inspector._build_verification_prompt("grab_cube", None)
    assert "Scene context:" not in prompt
    assert prompt.startswith("The robotic task")


def test_set_scene_description_updates_verification_prompt():
    inspector = VLMInspector(client=None, scene_description="")
    inspector.set_scene_description("New scene context.")
    prompt = inspector._build_verification_prompt("grab_cube", None)
    assert "New scene context." in prompt


# ── ProjectManager.create_project persists scene_description ────────────────

def test_create_project_persists_scene_description(tmp_path, monkeypatch):
    from orchiday.core.project_manager import ProjectManager

    pm = ProjectManager()
    monkeypatch.setattr(pm._recent, "add", lambda *a, **kw: None)

    data = pm.create_project("Test Project", "test_scene_proj", tmp_path,
                             scene_description="  Overhead camera above a wooden table.  ")

    assert data["scene_description"] == "Overhead camera above a wooden table."

    import json
    saved = json.loads((tmp_path / "test_scene_proj" / "project.json").read_text(encoding="utf-8"))
    assert saved["scene_description"] == "Overhead camera above a wooden table."


def test_create_project_defaults_scene_description_to_empty(tmp_path, monkeypatch):
    from orchiday.core.project_manager import ProjectManager

    pm = ProjectManager()
    monkeypatch.setattr(pm._recent, "add", lambda *a, **kw: None)

    data = pm.create_project("No Scene", "test_no_scene_proj", tmp_path)
    assert data["scene_description"] == ""
