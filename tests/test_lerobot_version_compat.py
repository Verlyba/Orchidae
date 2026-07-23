"""
Tests for LeRobot version compatibility in the inference daemon.

LeRobot has moved `hw_to_dataset_features`/`build_dataset_frame` between
modules twice (lerobot.datasets.utils -> lerobot.datasets.feature_utils in
the 0.4.x/0.5.x line -> lerobot.utils.feature_utils in 0.6.0), and 0.6.0
removed `lerobot.utils.control_utils.predict_action` entirely (inference
moved to a separate `lerobot-rollout` command). These tests cover the
version-adaptive import resolution and the locally-reimplemented
predict_action(), independent of whether LeRobot/torch are installed.
"""

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.ai import orchiday_inference as oi


# ── Module imports cleanly regardless of LeRobot/torch availability ─────────

def test_module_imports_without_lerobot_or_torch():
    # This test running at all proves the module-level try/except blocks
    # degrade gracefully rather than raising ImportError at import time.
    assert hasattr(oi, "LEROBOT_OK")
    assert hasattr(oi, "TORCH_OK")
    assert callable(oi.predict_action)
    assert callable(oi._import_first)


# ── _import_first: version-adaptive symbol resolution ───────────────────────

def _install_fake_module(monkeypatch, name: str, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    monkeypatch.setitem(sys.modules, name, mod)
    return mod


def test_import_first_picks_newest_module_when_present(monkeypatch):
    _install_fake_module(monkeypatch, "fake_lerobot_new", build_dataset_frame=lambda: "new")
    result = oi._import_first(
        ("fake_lerobot_new", "build_dataset_frame"),
        ("fake_lerobot_old", "build_dataset_frame"),
    )
    assert result() == "new"


def test_import_first_falls_back_when_newest_module_missing(monkeypatch):
    monkeypatch.delitem(sys.modules, "fake_lerobot_missing", raising=False)
    _install_fake_module(monkeypatch, "fake_lerobot_old", build_dataset_frame=lambda: "old")
    result = oi._import_first(
        ("fake_lerobot_missing", "build_dataset_frame"),
        ("fake_lerobot_old", "build_dataset_frame"),
    )
    assert result() == "old"


def test_import_first_falls_back_when_attribute_missing_in_newest(monkeypatch):
    # Module exists (newest layout) but doesn't have this particular symbol yet
    _install_fake_module(monkeypatch, "fake_lerobot_partial")
    _install_fake_module(monkeypatch, "fake_lerobot_old2", build_dataset_frame=lambda: "old2")
    result = oi._import_first(
        ("fake_lerobot_partial", "build_dataset_frame"),
        ("fake_lerobot_old2", "build_dataset_frame"),
    )
    assert result() == "old2"


def test_import_first_raises_when_nothing_resolves():
    with pytest.raises((ImportError, AttributeError)):
        oi._import_first(
            ("definitely_not_a_real_module_xyz", "foo"),
            ("also_not_real_xyz", "bar"),
        )


# ── predict_action(): local reimplementation of the removed 0.5.x helper ────

class _FakeTensor:
    def item(self):
        return 1.0


class _FakePolicy:
    def __init__(self):
        self.calls = []

    def select_action(self, observation):
        self.calls.append(observation)
        return {"action": _FakeTensor()}


class _FakeDevice:
    type = "cpu"


def test_predict_action_calls_prepare_preprocess_select_postprocess(monkeypatch):
    calls = []

    def fake_prepare(observation, device, task, robot_type):
        calls.append(("prepare", observation, task, robot_type))
        return {"prepared": True}

    def fake_preprocessor(observation):
        calls.append(("preprocess", observation))
        return {"preprocessed": True}

    def fake_postprocessor(action):
        calls.append(("postprocess", action))
        return "final_action"

    class _FakeTorch:
        class inference_mode:
            def __enter__(self): return self
            def __exit__(self, *a): return False

    monkeypatch.setattr(oi, "prepare_observation_for_inference", fake_prepare, raising=False)
    monkeypatch.setattr(oi, "torch", _FakeTorch(), raising=False)

    policy = _FakePolicy()
    result = oi.predict_action(
        {"raw": "obs"}, policy, _FakeDevice(),
        fake_preprocessor, fake_postprocessor,
        use_amp=False, task="pick_cube", robot_type="so101_follower",
    )

    assert result == "final_action"
    steps = [c[0] for c in calls]
    assert steps == ["prepare", "preprocess", "postprocess"]
    assert calls[0][2] == "pick_cube"
    assert calls[0][3] == "so101_follower"
    assert policy.calls == [{"preprocessed": True}]
