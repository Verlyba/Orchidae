"""
Tests for identifier (slug) validation.

The defect these pin down: nothing checked what a skill or project was called.
The wizard lower-cased the typed name, stripped diacritics and handed the
result straight to `mkdir` and to LeRobot — so an ordinary task name could
produce an identifier that fails somewhere the user cannot connect to what they
typed:

* "Eval test"  -> `eval_test`, which LeRobot 0.6.1 refuses to record into
  (`src/lerobot/scripts/lerobot_record.py:433` — reserved for lerobot-rollout),
* "Con"        -> `con`, a directory Windows cannot create,
* the same name twice -> the same slug, and `add_skill()` silently overwrote
  the first skill's `skill.json` and `skills_details` entry.

The `eval_` line was read off LeRobot 0.6.1; LeRobot 0.4.4 has no such check,
which is exactly why it belongs here — a project must not work on one LeRobot
version and die on the next.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.core import slugs
from orchiday.core.slugs import (
    KIND_PROJECT,
    KIND_SKILL,
    InvalidSlug,
    suggest_slug,
    validate_slug,
)


# ── The rules, one test per reason ───────────────────────────────────────────

def test_an_ordinary_identifier_is_accepted():
    assert validate_slug("uklidit_stul") is None
    assert validate_slug("grasp-1") is None
    assert validate_slug("step2") is None


def test_empty_is_rejected():
    problem = validate_slug("")
    assert problem is not None and problem.code == slugs.EMPTY
    assert validate_slug("   ").code == slugs.EMPTY


def test_lerobot_reserves_the_eval_prefix_for_rollout():
    # lerobot_record.py:433 raises ValueError on repo names starting with eval_.
    problem = validate_slug("eval_grasp", kind=KIND_SKILL)
    assert problem is not None and problem.code == slugs.EVAL_PREFIX
    # It is a prefix check, not a substring one.
    assert validate_slug("my_eval_grasp") is None
    assert validate_slug("evaluation") is None


def test_the_eval_prefix_is_a_repo_id_rule_so_it_does_not_apply_to_projects():
    # A project slug is a directory name; it never becomes a LeRobot repo_id.
    assert validate_slug("eval_bench", kind=KIND_PROJECT) is None


def test_windows_device_names_are_rejected_on_every_platform():
    # `mkdir con` fails on Windows and nowhere else — catching it only there
    # would mean a project built on Linux cannot be opened on Windows.
    for name in ("con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9"):
        problem = validate_slug(name)
        assert problem is not None and problem.code == slugs.WINDOWS_RESERVED, name
    # Not reserved: the name only matters on its own, not as a prefix.
    assert validate_slug("console") is None
    assert validate_slug("com10") is None


@pytest.mark.parametrize("bad", ["a/b", "a\\b", "..", "a.b", "a b", "a:b", "a*b", "a?b", "a|b"])
def test_path_and_shell_hostile_characters_are_rejected(bad):
    # "/" would silently change the depth of the repo_id, ".." would write
    # outside $HF_LEROBOT_HOME, and <>:"|?* cannot appear in a Windows path.
    problem = validate_slug(bad)
    assert problem is not None and problem.code == slugs.CHARSET, bad


def test_uppercase_is_rejected_because_two_filesystems_are_case_insensitive():
    # "Grasp" and "grasp" would be two entries in project.json sharing one
    # directory on macOS and Windows.
    problem = validate_slug("Grasp")
    assert problem is not None and problem.code == slugs.CHARSET


def test_a_leading_underscore_or_dash_is_rejected():
    assert validate_slug("_grasp").code == slugs.START_CHAR
    # A leading dash also reads as a flag on the command line.
    assert validate_slug("-grasp").code == slugs.START_CHAR


def test_control_characters_are_named_not_shown_raw():
    problem = validate_slug("a\x01b")
    assert problem is not None and problem.code == slugs.CHARSET
    assert problem.params["chars"] == "\\x01"


def test_length_is_capped_because_the_slug_ends_up_in_a_path():
    assert validate_slug("a" * slugs.MAX_LEN) is None
    problem = validate_slug("a" * (slugs.MAX_LEN + 1))
    assert problem is not None and problem.code == slugs.TOO_LONG
    assert problem.params["max"] == str(slugs.MAX_LEN)


def test_a_taken_identifier_is_rejected_case_insensitively():
    problem = validate_slug("grasp", taken=["approach", "GRASP"])
    assert problem is not None and problem.code == slugs.DUPLICATE
    assert validate_slug("grasp", taken=["approach"]) is None


# ── The generator must only ever produce something the validator accepts ─────

@pytest.mark.parametrize("name", [
    "Uklidit stůl", "Eval test", "Con", "  spaced  out  ", "Přesun-Kostky!",
    "ŽLUŤOUČKÝ kůň", "123 start", "A" * 200, "com1", "eval_", "--dashes--",
])
def test_suggest_slug_output_always_validates(name):
    suggestion = suggest_slug(name)
    if suggestion:
        assert validate_slug(suggestion) is None, f"{name!r} -> {suggestion!r}"


def test_suggest_slug_keeps_the_ascii_letter_under_a_diacritic():
    # The project modal used to skip NFD normalisation, so "Úklid stolu" became
    # "_klid_stolu" there and "uklid_stolu" in the skill wizard.
    assert suggest_slug("Úklid stolu") == "uklid_stolu"
    assert suggest_slug("Žluťoučký kůň") == "zlutoucky_kun"


def test_suggest_slug_repairs_the_two_reserved_shapes():
    assert not suggest_slug("Eval test").startswith("eval_")
    assert suggest_slug("Con") != "con"


def test_suggest_slug_gives_up_visibly_when_there_is_nothing_to_derive():
    # Better an empty suggestion (which validate_slug reports as `empty`) than
    # an invented name the user did not ask for.
    assert suggest_slug("!!!") == ""
    assert suggest_slug("") == ""


# ── ProjectManager enforces it — the API is not the only caller ──────────────

@pytest.fixture
def project(tmp_path, monkeypatch):
    from orchiday.core.project_manager import ProjectManager

    pm = ProjectManager()
    monkeypatch.setattr(type(pm._config), "projects_dir",
                        property(lambda self: tmp_path), raising=False)
    pm.create_project("Probe", "probe", tmp_path, scene_description="a table")
    pm.open_project(tmp_path / "probe")
    return pm


def test_add_skill_refuses_an_identifier_lerobot_would_reject(project):
    with pytest.raises(InvalidSlug) as exc:
        project.add_skill("eval_grasp", {"name": "Eval grasp", "slug": "eval_grasp"})
    assert exc.value.problem.code == slugs.EVAL_PREFIX
    assert "eval_grasp" not in project.current_project.get("skills", [])
    assert not (project.current_path / "skills" / "eval_grasp").exists()


def test_add_skill_refuses_a_path_that_escapes_the_project(project):
    with pytest.raises(InvalidSlug):
        project.add_skill("../escaped", {"name": "x", "slug": "../escaped"})
    assert not (project.current_path.parent / "escaped").exists()


def test_add_skill_no_longer_overwrites_an_existing_skill(project):
    project.add_skill("grasp", {"name": "Grasp", "slug": "grasp", "description": "first"})
    with pytest.raises(InvalidSlug) as exc:
        project.add_skill("grasp", {"name": "Grasp again", "slug": "grasp", "description": "second"})
    assert exc.value.problem.code == slugs.DUPLICATE
    # The original survives, description and all.
    detail = project.current_project["skills_details"]["grasp"]
    assert detail["description"] == "first"
    on_disk = json.loads((project.current_path / "skills" / "grasp" / "skill.json").read_text("utf-8"))
    assert on_disk["description"] == "first"
    assert project.current_project["skills"].count("grasp") == 1


def test_add_skill_still_accepts_a_normal_identifier(project):
    project.add_skill("approach", {"name": "Approach", "slug": "approach"})
    assert "approach" in project.current_project["skills"]
    assert (project.current_path / "skills" / "approach" / "dataset").is_dir()


def test_create_project_refuses_a_bad_directory_name_before_writing_anything(tmp_path):
    from orchiday.core.project_manager import ProjectManager

    pm = ProjectManager()
    with pytest.raises(InvalidSlug):
        pm.create_project("Con", "con", tmp_path, scene_description="a table")
    assert not (tmp_path / "con").exists()
    assert list(tmp_path.iterdir()) == []


def test_projects_already_on_disk_are_never_re_validated(project):
    # An identifier written by an older version keeps working: validation only
    # runs on creation, so opening and reading a project is untouched.
    legacy = project.current_path / "skills" / "Eval_Legacy"
    legacy.mkdir(parents=True)
    (legacy / "skill.json").write_text(json.dumps({"name": "legacy", "slug": "Eval_Legacy"}), "utf-8")
    project.current_project.setdefault("skills", []).append("Eval_Legacy")
    project.save_project()
    reopened = project.open_project(project.current_path)
    assert "Eval_Legacy" in reopened["skills"]


# ── The wizard's preview must be the identity the runner uses ────────────────

def test_repo_id_preview_comes_from_the_same_derivation_the_recorder_uses():
    from orchiday.core.slugs import dataset_repo_id

    assert dataset_repo_id("", "pick_place") == "local/pick_place"
    assert dataset_repo_id("pick_place", "approach") == "local/pick_place/approach"
    # An empty parent must not produce "local//approach".
    assert dataset_repo_id("   ", "approach") == "local/approach"


def test_controller_repo_id_resolution_delegates_to_the_module_function(monkeypatch):
    """`_dataset_repo_id_for()` must not grow a second copy of the rule.

    The Learning page, the recorder and now the new-skill wizard all have to
    name the same dataset; `tests/test_training_targets.py` pins the first two
    to `_dataset_repo_id_for()`, and this pins that to the shared function.
    """
    import orchiday.core.controller as controller_mod
    from orchiday.core.controller import OrchidayController

    seen: list[tuple[str, str]] = []
    real = controller_mod.dataset_repo_id

    def spy(parent, slug):
        seen.append((parent, slug))
        return real(parent, slug)

    monkeypatch.setattr(controller_mod, "dataset_repo_id", spy)

    ctrl = OrchidayController.__new__(OrchidayController)

    class _PM:
        current_project = {"skills_details": {"approach": {"parent_slug": "pick_place"}}}

    ctrl.pm = _PM()
    assert ctrl._dataset_repo_id_for("approach") == "local/pick_place/approach"
    assert seen == [("pick_place", "approach")]
