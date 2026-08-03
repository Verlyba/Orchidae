"""
Tests for `OrchidayController.training_targets()` — the read-only answer the
Learning page renders before anything is trained.

The point of these tests is the project's central claim: **both branches of the
comparison come out of one recording**. The whole dataset trains the plain ACT
baseline, the sub-datasets cut from it train the orchestration policies. So the
page has to offer both as training targets, and the values it shows must not be
able to drift away from what the trainer really does — the repo_id has to be the
one `start_training()` is handed, the readiness flags have to come from the very
checks that refuse to start.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.core.controller import OrchidayController


def _ckpt(posix_path: str) -> str:
    """The same path as the controller renders it on this platform.

    `_policy_path_for()` builds the directory with pathlib and returns native
    separators, so spelling the expected value with "/" only passes on POSIX.
    """
    return str(Path(posix_path))


class _FakePM:
    def __init__(self, project):
        self.current_project = project
        self.current_path = None


class _FakeBridge:
    """Stands in for LeRobotBridge; records what it was asked about."""

    def __init__(self, datasets: set[str] | None = None, policies: set[str] | None = None):
        self.datasets = datasets or set()
        self.policies = policies or set()
        self.asked_datasets: list[str] = []
        self.asked_policies: list[str] = []
        self.python_executable = "python"

    def dataset_exists(self, repo_id: str) -> bool:
        self.asked_datasets.append(repo_id)
        return repo_id in self.datasets

    def policy_exists(self, policy_path: str) -> bool:
        self.asked_policies.append(policy_path)
        return policy_path in self.policies

    def resolve_training_output(self, output_dir: str) -> dict[str, str]:
        """Same rule the real bridge uses, kept independent on purpose: this
        fake exists to check the controller calls it with the right path, not
        to share its implementation."""
        if not output_dir:
            return {"output_dir": "", "resume_config": ""}
        out_path = Path(output_dir)
        if not out_path.exists():
            return {"output_dir": output_dir, "resume_config": ""}
        candidate = out_path / "checkpoints" / "last" / "pretrained_model" / "train_config.json"
        if candidate.exists():
            return {"output_dir": output_dir, "resume_config": str(candidate)}
        return {"output_dir": f"{output_dir}_v2", "resume_config": ""}


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


def _task(result, slug):
    return next(t for t in result["tasks"] if t["slug"] == slug)


# ── The two branches ────────────────────────────────────────────────────────

def test_every_task_offers_the_act_baseline_as_its_own_target():
    """The control arm of the whole project: one policy on the whole dataset.

    This is the regression this module exists for — the page used to render
    checkboxes for sub-steps only, so the baseline could not be started at all.
    """
    result = _make_controller(PROJECT).training_targets()

    baseline = _task(result, "tidy_table")["baseline"]
    assert baseline["slug"] == "tidy_table"
    assert baseline["repo_id"] == "local/tidy_table"


def test_sub_steps_are_listed_under_their_parent_not_as_tasks():
    result = _make_controller(PROJECT).training_targets()

    assert [t["slug"] for t in result["tasks"]] == ["tidy_table", "solo_wave"]
    assert [s["slug"] for s in _task(result, "tidy_table")["steps"]] == ["grab_cube", "move_to_box"]


def test_step_repo_ids_are_namespaced_under_the_parent():
    """Sub-datasets are what the splitter writes, so they live under the parent."""
    result = _make_controller(PROJECT).training_targets()

    assert [s["repo_id"] for s in _task(result, "tidy_table")["steps"]] == [
        "local/tidy_table/grab_cube",
        "local/tidy_table/move_to_box",
    ]


def test_step_order_follows_project_json_not_the_alphabet():
    """The splitter cuts in the order the skills list gives, so the rows must
    line up with the sub-datasets that appear on disk."""
    project = dict(PROJECT, skills=["tidy_table", "move_to_box", "grab_cube"])
    result = _make_controller(project).training_targets()

    assert [s["slug"] for s in _task(result, "tidy_table")["steps"]] == ["move_to_box", "grab_cube"]


def test_orchestrated_needs_two_or_more_steps():
    """One step is not an orchestration — the daemon would never swap a model.
    Same rule the splitter and the run preview use."""
    result = _make_controller(PROJECT).training_targets()

    assert _task(result, "tidy_table")["orchestrated"] is True
    assert _task(result, "solo_wave")["orchestrated"] is False
    assert _task(result, "solo_wave")["steps"] == []


def test_a_task_without_steps_is_still_trainable_as_a_baseline():
    """A plain task has nothing to orchestrate but is a perfectly good ACT run,
    so it must not come back as an untrainable row."""
    result = _make_controller(PROJECT).training_targets()

    assert _task(result, "solo_wave")["baseline"]["repo_id"] == "local/solo_wave"


# ── Values must match what the executor would use ───────────────────────────

def test_repo_id_matches_what_the_trainer_would_be_handed():
    """Binds the preview to the executor: if the derivation ever changes, this
    fails rather than the page quietly describing a different dataset."""
    ctrl = _make_controller(PROJECT)
    result = ctrl.training_targets()

    for task in result["tasks"]:
        for target in [task["baseline"], *task["steps"]]:
            assert target["repo_id"] == ctrl._dataset_repo_id_for(target["slug"])


def test_checkpoint_path_matches_what_the_trainer_would_write():
    ctrl = _make_controller(PROJECT)
    result = ctrl.training_targets()

    for task in result["tasks"]:
        for target in [task["baseline"], *task["steps"]]:
            assert target["policy_path"] == ctrl._policy_path_for(target["slug"])


def test_readiness_comes_from_the_bridge_checks_that_gate_the_run():
    """`dataset_ready` is the check that REFUSES to start training, and
    `policy_ready` the one inference gates on — not a guess made here."""
    bridge = _FakeBridge(
        datasets={"local/tidy_table", "local/tidy_table/grab_cube"},
        policies={_ckpt("/data/outputs/training/tidy_table_grab_cube_act")},
    )
    ctrl = _make_controller(PROJECT, bridge)
    result = ctrl.training_targets()
    task = _task(result, "tidy_table")

    assert task["baseline"]["dataset_ready"] is True
    assert task["baseline"]["policy_ready"] is False
    steps = {s["slug"]: s for s in task["steps"]}
    assert steps["grab_cube"]["dataset_ready"] is True
    assert steps["grab_cube"]["policy_ready"] is True
    assert steps["move_to_box"]["dataset_ready"] is False

    # It really asked the bridge about the repo_ids and paths it reported.
    assert "local/tidy_table/move_to_box" in bridge.asked_datasets
    assert _ckpt("/data/outputs/training/tidy_table_move_to_box_act") in bridge.asked_policies


def test_will_resume_reflects_the_exact_directory_start_training_would_write_to(tmp_path):
    """`policy_ready` also matches a checkpoint pulled from the HF hub cache or
    a custom storage dir — those are not what `will_resume` answers. It has to
    agree with `resolve_training_output()`, the same call `start_training()`
    makes, for the literal `policy_path` directory."""
    ctrl = _make_controller(PROJECT, data_dir=str(tmp_path))
    ckpt_dir = Path(ctrl._policy_path_for("tidy_table")) / "checkpoints" / "last" / "pretrained_model"
    ckpt_dir.mkdir(parents=True)
    (ckpt_dir / "train_config.json").write_text("{}")

    task = _task(ctrl.training_targets(), "tidy_table")
    assert task["baseline"]["will_resume"] is True
    assert task["baseline"]["training_output_dir"] == ctrl._policy_path_for("tidy_table")
    assert task["baseline"]["resume_config_path"] == str(ckpt_dir / "train_config.json")
    assert task["steps"][0]["will_resume"] is False
    assert task["steps"][0]["resume_config_path"] == ""


def test_training_output_dir_diverges_when_the_directory_exists_without_a_checkpoint(tmp_path):
    """The directory is already occupied by something that is not a resumable
    checkpoint — `start_training()` trains into a `_v2` sibling instead, and
    the preview must say THAT path, not the one inference will later read."""
    ctrl = _make_controller(PROJECT, data_dir=str(tmp_path))
    Path(ctrl._policy_path_for("tidy_table")).mkdir(parents=True)

    task = _task(ctrl.training_targets(), "tidy_table")
    assert task["baseline"]["will_resume"] is False
    assert task["baseline"]["training_output_dir"] == ctrl._policy_path_for("tidy_table") + "_v2"


def test_response_carries_the_interpreter_and_save_freq_the_run_would_really_use():
    """The command preview must not hard-code `python` or a save_freq nobody
    configured — both come from the same values `_on_training_started()` hands
    the bridge."""
    from orchiday.ai.lerobot_bridge import DEFAULT_TRAIN_SAVE_FREQ

    bridge = _FakeBridge()
    bridge.python_executable = "/opt/lerobot/bin/python"
    result = _make_controller(PROJECT, bridge).training_targets()

    assert result["python_executable"] == "/opt/lerobot/bin/python"
    assert result["save_freq"] == DEFAULT_TRAIN_SAVE_FREQ


def test_checkpoint_dir_is_named_parent_step_arch():
    """The daemon reads exactly this directory, so the name is load-bearing."""
    ctrl = _make_controller(PROJECT)
    task = _task(ctrl.training_targets(), "tidy_table")

    assert task["baseline"]["policy_path"] == _ckpt("/data/outputs/training/tidy_table_act")
    assert task["steps"][0]["policy_path"] == _ckpt("/data/outputs/training/tidy_table_grab_cube_act")


def test_custom_dataset_storage_dir_moves_the_checkpoints():
    project = dict(PROJECT, dataset_storage_dir="/mnt/big")
    ctrl = _make_controller(project)

    assert _task(ctrl.training_targets(), "solo_wave")["baseline"]["policy_path"] \
        == _ckpt("/mnt/big/outputs/training/solo_wave_act")


# ── Degenerate inputs ───────────────────────────────────────────────────────

def test_architecture_falls_back_when_the_project_does_not_set_one():
    project = {k: v for k, v in PROJECT.items() if k != "policy_architecture"}
    assert _make_controller(project).training_targets()["policy_architecture"] == "diffusion"


def test_no_project_open_yields_an_empty_task_list():
    result = _make_controller(None).training_targets()

    assert result["tasks"] == []


def test_empty_project_yields_an_empty_task_list():
    result = _make_controller({"skills": [], "skills_details": {}}).training_targets()

    assert result["tasks"] == []


def test_a_skill_without_a_name_falls_back_to_its_slug():
    project = {
        "skills": ["nameless"],
        "skills_details": {"nameless": {}},
    }
    task = _task(_make_controller(project).training_targets(), "nameless")

    assert task["name"] == "nameless"
    assert task["baseline"]["name"] == "nameless"


def test_blank_parent_slug_is_treated_as_top_level():
    """`parent_slug: ""` means "no parent" — it must not produce `local//slug`."""
    project = {
        "skills": ["loose"],
        "skills_details": {"loose": {"parent_slug": ""}},
    }
    ctrl = _make_controller(project)

    assert ctrl._dataset_repo_id_for("loose") == "local/loose"
    assert _task(ctrl.training_targets(), "loose")["baseline"]["repo_id"] == "local/loose"


def test_a_skill_missing_from_skills_details_is_still_a_target():
    """Its directory exists on disk with recorded episodes; dropping it would
    hide a dataset the user actually has."""
    project = {"skills": ["orphan"], "skills_details": {}}
    task = _task(_make_controller(project).training_targets(), "orphan")

    assert task["baseline"]["repo_id"] == "local/orphan"


# ── The executor must use the same derivation, not a second copy ────────────

class _RecordingBridge(_FakeBridge):
    def __init__(self):
        super().__init__()
        self.train_call: dict = {}

    def start_training(self, **kwargs):
        self.train_call = kwargs


def test_the_trainer_is_handed_exactly_what_the_preview_advertised():
    """The whole point of the preview: what the page promises for a row is what
    `_on_training_started()` actually spawns. Two hand-written copies of this
    derivation is how the page starts describing a different run than it makes.
    """
    bridge = _RecordingBridge()
    ctrl = _make_controller(PROJECT, bridge)
    task = _task(ctrl.training_targets(), "tidy_table")

    for advertised in [task["baseline"], *task["steps"]]:
        ctrl._on_training_started(advertised["slug"])
        assert bridge.train_call["dataset_repo_id"] == advertised["repo_id"]
        assert bridge.train_call["output_dir"] == advertised["policy_path"]
        assert bridge.train_call["skill_slug"] == advertised["slug"]


def test_training_a_baseline_reads_the_whole_dataset_not_a_sub_dataset():
    """Guards the comparison itself: the baseline run must not be pointed at a
    sub-step's slice, or the two branches would train on different data."""
    bridge = _RecordingBridge()
    ctrl = _make_controller(PROJECT, bridge)

    ctrl._on_training_started("tidy_table")

    assert bridge.train_call["dataset_repo_id"] == "local/tidy_table"
    assert bridge.train_call["policy_type"] == "act"
