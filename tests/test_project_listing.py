"""
Tests for the project listing that feeds the Projects page.

The Projects page is a master/detail view: the list only selects, and the
detail panel has to say everything knowable about a project *without opening
it*. That makes ``ProjectManager.list_projects()`` the single source of the
task/sub-step structure shown there, so these tests pin the invariants the
page depends on:

  - step order comes from ``project.json``'s ``skills`` list (the order the
    dataset splitter uses), not from the alphabetical directory order,
  - a skill directory missing from ``project.json`` is still reported, because
    it holds recordings the user made,
  - ``parent_slug`` is normalised so the page can tell a top-level task from
    a sub-step, and a task with >= 2 sub-steps from one that can only ever
    train an ACT baseline,
  - a corrupt ``skill.json`` degrades to the slug instead of losing the whole
    project from the listing.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.core.project_manager import ProjectManager


def _write_project(root: Path, slug: str, *, skills: list[str] | None = None,
                   extra: dict | None = None) -> Path:
    p = root / slug
    (p / "skills").mkdir(parents=True, exist_ok=True)
    data = {"name": slug.replace("-", " ").title(), "slug": slug,
            "skills": skills or []}
    data.update(extra or {})
    (p / "project.json").write_text(json.dumps(data), encoding="utf-8")
    return p


def _write_skill(project_dir: Path, slug: str, name: str,
                 parent: str | None = None, raw: str | None = None) -> None:
    d = project_dir / "skills" / slug
    d.mkdir(parents=True, exist_ok=True)
    if raw is not None:
        (d / "skill.json").write_text(raw, encoding="utf-8")
        return
    (d / "skill.json").write_text(
        json.dumps({"name": name, "slug": slug, "parent_slug": parent}),
        encoding="utf-8")


@pytest.fixture()
def pm(tmp_path, monkeypatch):
    """A ProjectManager whose projects_dir is an empty temp directory."""
    manager = ProjectManager()
    projects_dir = tmp_path / "projects"
    projects_dir.mkdir()
    monkeypatch.setattr(type(manager._config), "projects_dir",
                        property(lambda _self: projects_dir))
    manager.projects_root = projects_dir  # convenience for the tests
    return manager


def test_missing_projects_dir_returns_empty(tmp_path, monkeypatch):
    manager = ProjectManager()
    monkeypatch.setattr(type(manager._config), "projects_dir",
                        property(lambda _self: tmp_path / "nope"))
    assert manager.list_projects() == []


def test_summary_follows_project_json_skill_order(pm):
    """Directory order is alphabetical; step order must come from project.json."""
    proj = _write_project(pm.projects_root, "bench",
                          skills=["pick", "z_place", "a_release"])
    _write_skill(proj, "pick", "Pick")
    _write_skill(proj, "z_place", "Place")
    _write_skill(proj, "a_release", "Release")

    summary = pm.list_projects()[0]["skills_summary"]
    assert [s["slug"] for s in summary] == ["pick", "z_place", "a_release"]


def test_skill_dir_absent_from_project_json_is_still_listed(pm):
    proj = _write_project(pm.projects_root, "bench", skills=["pick"])
    _write_skill(proj, "pick", "Pick")
    _write_skill(proj, "orphan", "Orphan")

    slugs = [s["slug"] for s in pm.list_projects()[0]["skills_summary"]]
    assert slugs == ["pick", "orphan"], "declared skills first, then extras on disk"


def test_parent_slug_identifies_tasks_and_sub_steps(pm):
    proj = _write_project(pm.projects_root, "bench",
                          skills=["stack", "grab", "lift", "drop", "wave"])
    _write_skill(proj, "stack", "Stack cubes")
    _write_skill(proj, "grab", "Grab", parent="stack")
    _write_skill(proj, "lift", "Lift", parent="stack")
    _write_skill(proj, "drop", "Drop", parent="stack")
    _write_skill(proj, "wave", "Wave")  # a task with no sub-steps

    summary = pm.list_projects()[0]["skills_summary"]
    roots = [s for s in summary if s["parent_slug"] is None]
    assert [s["slug"] for s in roots] == ["stack", "wave"]

    stack_steps = [s["slug"] for s in summary if s["parent_slug"] == "stack"]
    assert stack_steps == ["grab", "lift", "drop"], "sub-step order is preserved"

    # >= 2 ordered sub-steps is exactly the splittable condition the page shows.
    assert len(stack_steps) >= 2
    assert [s for s in summary if s["parent_slug"] == "wave"] == []


def test_empty_parent_slug_normalises_to_none(pm):
    """An empty string must not read as "child of a task named ''"."""
    proj = _write_project(pm.projects_root, "bench", skills=["solo"])
    (proj / "skills" / "solo").mkdir(parents=True, exist_ok=True)
    (proj / "skills" / "solo" / "skill.json").write_text(
        json.dumps({"name": "Solo", "parent_slug": ""}), encoding="utf-8")

    assert pm.list_projects()[0]["skills_summary"][0]["parent_slug"] is None


def test_corrupt_skill_json_falls_back_to_slug(pm):
    proj = _write_project(pm.projects_root, "bench", skills=["good", "bad"])
    _write_skill(proj, "good", "Good")
    _write_skill(proj, "bad", "", raw="{ this is not json")

    summary = pm.list_projects()[0]["skills_summary"]
    assert {s["slug"]: s["name"] for s in summary} == {"good": "Good", "bad": "bad"}


def test_corrupt_project_json_drops_only_that_project(pm):
    _write_project(pm.projects_root, "ok", skills=[])
    broken = pm.projects_root / "broken"
    broken.mkdir()
    (broken / "project.json").write_text("{ nope", encoding="utf-8")

    assert [p["slug"] for p in pm.list_projects()] == ["ok"]


def test_skills_names_still_provided_for_existing_callers(pm):
    proj = _write_project(pm.projects_root, "bench", skills=["pick"])
    _write_skill(proj, "pick", "Pick the cube")

    listing = pm.list_projects()[0]
    assert listing["skills_names"] == ["Pick the cube"]
    assert listing["_path"] == str(proj)


def test_project_without_skills_dir_lists_with_empty_summary(pm):
    p = pm.projects_root / "bare"
    p.mkdir()
    (p / "project.json").write_text(json.dumps({"name": "Bare", "slug": "bare"}),
                                    encoding="utf-8")

    listing = pm.list_projects()[0]
    assert listing["skills_summary"] == []
    assert listing["skills_names"] == []
