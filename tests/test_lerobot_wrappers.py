"""
Tests for the two wrapper scripts Orchiday injects into the user's LeRobot
environment (LeRobotBridge._CALIBRATION_WRAPPER_SRC / _RECORD_WRAPPER_SRC).

Both work by monkeypatching LeRobot symbols. A plain attribute assignment on a
module that does not have the symbol silently CREATES it, so a renamed or
relocated LeRobot function turns the wrapper into a no-op that fails invisibly:
calibration whose Confirm button does nothing, or a recording whose episode
controls and sub-task marks never fire. These tests pin the two properties that
prevent that:

  * the patch reaches every module that can call the original — verified against
    the real LeRobot layout, where enter_pressed is defined once in
    lerobot/utils/utils.py but copied by `from ... import` into each motor bus,
    and each motor family (motors_bus / damiao / robstride) has its OWN
    record_ranges_of_motion() calling its own copy;
  * when there is nothing to patch, the wrapper aborts loudly.
"""

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.ai.lerobot_bridge import LeRobotBridge


# ── Fake LeRobot installation ────────────────────────────────────────────────

def _real_enter_pressed() -> bool:
    """Stand-in for lerobot.utils.utils.enter_pressed (console/TTY based)."""
    return False


def _install_fake_lerobot(monkeypatch, *, with_enter_pressed: bool = True,
                          holders: tuple[str, ...] = ("lerobot.motors.motors_bus",)):
    """Register a minimal `lerobot` package mirroring the real module layout.

    `holders` are modules that took their own copy of enter_pressed at import
    time, exactly as the motor buses do.
    """
    modules: dict[str, types.ModuleType] = {}

    def add(name: str) -> types.ModuleType:
        mod = types.ModuleType(name)
        modules[name] = mod
        monkeypatch.setitem(sys.modules, name, mod)
        return mod

    for name in ("lerobot", "lerobot.utils", "lerobot.scripts",
                 "lerobot.motors", "lerobot.motors.damiao",
                 "lerobot.motors.robstride"):
        add(name)

    utils = add("lerobot.utils.utils")
    if with_enter_pressed:
        utils.enter_pressed = _real_enter_pressed

    for name in holders:
        parent = name.rsplit(".", 1)[0]
        if parent not in modules:
            add(parent)
        holder = add(name)
        if with_enter_pressed:
            # `from lerobot.utils.utils import enter_pressed`
            holder.enter_pressed = _real_enter_pressed

    calibrate = add("lerobot.scripts.lerobot_calibrate")
    calibrate.main = lambda: None
    return modules


def _run_calibration_wrapper() -> dict:
    ns: dict = {"__name__": "orchiday_calibrate_wrapper"}
    exec(compile(LeRobotBridge._CALIBRATION_WRAPPER_SRC, "cal_wrapper", "exec"), ns)
    return ns


# ── Calibration wrapper: patch coverage ──────────────────────────────────────

def test_patches_the_defining_module_so_later_imports_get_it(monkeypatch):
    """lerobot.utils.utils is where enter_pressed lives.

    Patching it is what makes the motor bus chosen at connect time — imported
    only once the robot is instantiated, i.e. after the wrapper ran — bind the
    replacement through its own `from ... import enter_pressed`.
    """
    modules = _install_fake_lerobot(monkeypatch)
    _run_calibration_wrapper()

    assert modules["lerobot.utils.utils"].enter_pressed is not _real_enter_pressed
    # A module importing the name now picks up the replacement.
    from lerobot.utils.utils import enter_pressed as late_bound
    assert late_bound is modules["lerobot.utils.utils"].enter_pressed


def test_patches_every_motor_family_that_already_holds_a_copy(monkeypatch):
    """OpenArm (Damiao CAN) and RobStride have their own record_ranges_of_motion.

    Before this, only motors_bus was patched, so those arms showed a Confirm
    step button that could never advance the calibration.
    """
    holders = ("lerobot.motors.motors_bus",
               "lerobot.motors.damiao.damiao",
               "lerobot.motors.robstride.robstride")
    modules = _install_fake_lerobot(monkeypatch, holders=holders)
    _run_calibration_wrapper()

    for name in holders:
        assert modules[name].enter_pressed is not _real_enter_pressed, name


def test_patch_reaches_modules_imported_by_lerobot_calibrate(monkeypatch):
    """A holder pulled in by `from lerobot.scripts.lerobot_calibrate import main`.

    Such a module captures the ORIGINAL after the wrapper's first sweep has
    already run, which is why the wrapper sweeps a second time once
    lerobot_calibrate is imported.
    """
    modules = _install_fake_lerobot(monkeypatch)
    calibrate = modules["lerobot.scripts.lerobot_calibrate"]
    del calibrate.main

    late = types.ModuleType("lerobot.robots.openarm")
    late.enter_pressed = _real_enter_pressed

    def _module_getattr(name):
        # PEP 562: resolving `main` is what runs the rest of lerobot's import
        # chain, and that is when this holder appears in sys.modules.
        if name != "main":
            raise AttributeError(name)
        sys.modules["lerobot.robots.openarm"] = late
        return lambda: None

    calibrate.__getattr__ = _module_getattr
    # Claim the key so monkeypatch removes it again at teardown, whatever the
    # wrapper leaves behind in sys.modules.
    monkeypatch.setitem(sys.modules, "lerobot.robots.openarm", None)

    _run_calibration_wrapper()
    assert late.enter_pressed is not _real_enter_pressed


def test_patched_enter_pressed_consumes_the_confirm_sentinel(monkeypatch, tmp_path):
    """One click == exactly one True, and the sentinel is consumed."""
    confirm = tmp_path / "confirm.flag"
    monkeypatch.setenv("ORCHIDAY_CALIBRATION_CONFIRM_FILE", str(confirm))
    modules = _install_fake_lerobot(monkeypatch)
    _run_calibration_wrapper()

    patched = modules["lerobot.motors.motors_bus"].enter_pressed
    assert patched() is False

    confirm.write_text("1", encoding="utf-8")
    assert patched() is True
    assert not confirm.exists()
    assert patched() is False


def test_calibration_wrapper_aborts_when_nothing_to_patch(monkeypatch, capsys):
    """An unknown LeRobot layout must fail loudly, not start a dead calibration."""
    _install_fake_lerobot(monkeypatch, with_enter_pressed=False)

    with pytest.raises(SystemExit) as exc:
        _run_calibration_wrapper()

    assert exc.value.code == 3
    assert "FATAL" in capsys.readouterr().out


def test_calibration_wrapper_reports_what_it_patched(monkeypatch, capsys):
    """The console line is how a user can tell the hook is actually installed."""
    _install_fake_lerobot(monkeypatch)
    _run_calibration_wrapper()

    out = capsys.readouterr().out
    assert "[ORCHIDAY_CAL] enter_pressed patched in:" in out
    assert "lerobot.utils.utils" in out


# ── Record wrapper: patch targets must exist ─────────────────────────────────

def _install_fake_record_module(monkeypatch, **attrs) -> types.ModuleType:
    for name in ("lerobot", "lerobot.scripts"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    record_mod = types.ModuleType("lerobot.scripts.lerobot_record")
    for key, value in attrs.items():
        setattr(record_mod, key, value)
    monkeypatch.setitem(sys.modules, "lerobot.scripts.lerobot_record", record_mod)
    return record_mod


def _run_record_wrapper() -> dict:
    ns: dict = {"__name__": "orchiday_record_wrapper"}
    exec(compile(LeRobotBridge._RECORD_WRAPPER_SRC, "rec_wrapper", "exec"), ns)
    return ns


def test_record_wrapper_installs_both_hooks(monkeypatch):
    original_loop = lambda **kwargs: None
    record_mod = _install_fake_record_module(
        monkeypatch,
        record_loop=original_loop,
        init_keyboard_listener=lambda: (None, {}),
        main=lambda: None,
    )
    ns = _run_record_wrapper()

    assert record_mod.init_keyboard_listener is ns["_orchiday_init_keyboard_listener"]
    assert record_mod.record_loop is ns["_orchiday_record_loop"]
    assert ns["_ORIGINAL_RECORD_LOOP"] is original_loop


@pytest.mark.parametrize("present", [
    {"record_loop": lambda **k: None},                    # listener hook missing
    {"init_keyboard_listener": lambda: (None, {})},       # record_loop missing
    {},                                                   # neither
])
def test_record_wrapper_refuses_an_unsupported_lerobot(monkeypatch, capsys, present):
    """Without both hooks the recording would produce unusable data silently."""
    _install_fake_record_module(monkeypatch, main=lambda: None, **present)

    with pytest.raises(SystemExit) as exc:
        _run_record_wrapper()

    assert exc.value.code == 3
    out = capsys.readouterr().out
    assert '"ev": "fatal"' in out


# ── Record wrapper: keeping the dataset name Orchiday chose ──────────────────
#
# LeRobot >= 0.6 appends a "_YYYYmmdd_HHMMSS" tag to repo_id in
# DatasetRecordConfig.stamp_repo_id(), called from record() right before
# LeRobotDataset.create(). Orchiday derives the marks sidecar, the split
# sub-datasets and the training target from the repo_id it passed, so a
# silently renamed dataset orphans all three.

class _StampingConfig:
    """Stand-in for LeRobot >= 0.6's DatasetRecordConfig."""

    def __init__(self, repo_id="local/pick_place"):
        self.repo_id = repo_id

    def stamp_repo_id(self):
        self.repo_id = f"{self.repo_id}_20260802_120000"


def _base_record_attrs(**extra):
    return dict(record_loop=lambda **k: None,
                init_keyboard_listener=lambda: (None, {}),
                main=lambda: None, **extra)


def test_record_wrapper_disables_repo_id_stamping(monkeypatch, capsys):
    """The dataset must keep the name passed on the command line."""
    _install_fake_record_module(
        monkeypatch, **_base_record_attrs(DatasetRecordConfig=_StampingConfig))
    _run_record_wrapper()

    cfg = _StampingConfig("local/pick_place")
    cfg.stamp_repo_id()
    assert cfg.repo_id == "local/pick_place"
    assert '"ev": "no_stamp"' in capsys.readouterr().out


def test_record_wrapper_finds_the_config_in_its_own_module(monkeypatch):
    """0.6.x re-exports DatasetRecordConfig from lerobot.configs.dataset, but
    older layouts define it in lerobot_record itself — both must be patched."""
    _install_fake_record_module(
        monkeypatch, **_base_record_attrs(DatasetRecordConfig=_StampingConfig))
    ns = _run_record_wrapper()

    assert ns["_find_dataset_record_config"]() is _StampingConfig


def test_record_wrapper_accepts_a_lerobot_that_never_stamps(monkeypatch, capsys):
    """LeRobot 0.4.x has no stamp_repo_id() — there is nothing to neutralize
    and the wrapper must still start."""
    _install_fake_record_module(monkeypatch, **_base_record_attrs())
    _run_record_wrapper()

    assert '"ev": "no_stamp"' not in capsys.readouterr().out


def test_record_wrapper_ignores_a_config_without_stamping(monkeypatch, capsys):
    """A DatasetRecordConfig that simply lacks the method is not an error."""
    class _PlainConfig:
        repo_id = "local/pick_place"

    _install_fake_record_module(
        monkeypatch, **_base_record_attrs(DatasetRecordConfig=_PlainConfig))
    _run_record_wrapper()

    assert '"ev": "no_stamp"' not in capsys.readouterr().out
