"""
Tests for LeRobotBridge CLI command generation.

Validates that generated commands match the LeRobot >= 0.5 CLI contract:
- lerobot-record requires --dataset.single_task and a teleop (or policy)
- lerobot-train must disable --policy.push_to_hub unless a repo_id is given
- lerobot-calibrate accepts exactly one device per invocation
- lerobot-replay uses --dataset.episode
"""

import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.ai.lerobot_bridge import LeRobotBridge


@pytest.fixture()
def bridge(monkeypatch) -> Any:
    b: Any = LeRobotBridge(python_executable="python")
    captured: dict = {}

    def fake_spawn(key, cmd, kind="", skill_slug=""):
        captured["key"] = key
        captured["cmd"] = cmd
        captured["kind"] = kind

    def fake_preflight(port, robot_type, on_success_callback):
        on_success_callback()

    monkeypatch.setattr(b, "_spawn_process", fake_spawn)
    monkeypatch.setattr(b, "_run_preflight_check", fake_preflight)
    b._captured = captured
    return b


def _arg(cmd: list[str], prefix: str) -> str | None:
    for a in cmd:
        if a.startswith(prefix):
            return a.split("=", 1)[1] if "=" in a else a
    return None


# ── Recording ────────────────────────────────────────────────────────────────

def test_record_command_has_required_modern_args(bridge):
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        num_episodes=10,
        fps=30,
        port="COM3",
        robot_id="my_follower_arm",
        teleop_type="so100_leader",
        teleop_port="COM4",
        teleop_id="my_leader_arm",
        single_task="Pick up the red cube",
        episode_time_s=15,
        reset_time_s=5,
    )
    cmd = bridge._captured["cmd"]
    assert "-m" in cmd and "lerobot.scripts.lerobot_record" in cmd
    assert _arg(cmd, "--robot.type=") == "so100_follower"
    assert _arg(cmd, "--robot.port=") == "COM3"
    assert _arg(cmd, "--robot.id=") == "my_follower_arm"
    assert _arg(cmd, "--teleop.type=") == "so100_leader"
    assert _arg(cmd, "--teleop.port=") == "COM4"
    assert _arg(cmd, "--teleop.id=") == "my_leader_arm"
    assert _arg(cmd, "--dataset.repo_id=") == "local/pick_cube"
    assert _arg(cmd, "--dataset.single_task=") == "Pick up the red cube"
    assert _arg(cmd, "--dataset.num_episodes=") == "10"
    assert _arg(cmd, "--dataset.episode_time_s=") == "15"
    assert _arg(cmd, "--dataset.push_to_hub=") == "false"
    assert _arg(cmd, "--dataset.streaming_encoding=") == "true"


def test_record_requires_teleop_port(bridge):
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="",  # missing leader
    )
    assert "cmd" not in bridge._captured


def test_record_rejects_port_conflict(bridge):
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="COM3",
    )
    assert "cmd" not in bridge._captured


def test_record_defaults_single_task_to_skill(bridge):
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="COM4",
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--dataset.single_task=") == "pick cube"


def test_record_resume_flag(bridge):
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="COM4",
        resume=True,
    )
    assert "--resume=true" in bridge._captured["cmd"]


# ── Training ────────────────────────────────────────────────────────────────

def test_train_disables_hub_push_and_uses_steps(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    bridge.start_training(
        policy_type="act",
        dataset_repo_id="local/pick_cube",
        skill_slug="pick_cube",
        output_dir=str(tmp_path / "out"),
        training_steps=5000,
        batch_size=8,
        device="cuda",
    )
    cmd = bridge._captured["cmd"]
    assert "lerobot.scripts.lerobot_train" in cmd
    assert _arg(cmd, "--policy.type=") == "act"
    assert _arg(cmd, "--steps=") == "5000"
    assert _arg(cmd, "--batch_size=") == "8"
    assert _arg(cmd, "--policy.device=") == "cuda"
    assert _arg(cmd, "--policy.push_to_hub=") == "false"
    assert _arg(cmd, "--job_name=") == "pick_cube"
    # No legacy/global device flag
    assert _arg(cmd, "--device=") is None


def test_train_resumes_from_existing_checkpoint(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    out = tmp_path / "out"
    ckpt = out / "checkpoints" / "last" / "pretrained_model"
    ckpt.mkdir(parents=True)
    (ckpt / "train_config.json").write_text("{}")

    bridge.start_training(
        policy_type="act",
        dataset_repo_id="local/pick_cube",
        skill_slug="pick_cube",
        output_dir=str(out),
    )
    cmd = bridge._captured["cmd"]
    assert "--resume=true" in cmd
    assert any(a.startswith("--config_path=") for a in cmd)


def test_train_picks_unique_dir_when_existing_without_checkpoint(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    out = tmp_path / "out"
    out.mkdir()

    bridge.start_training(
        policy_type="act",
        dataset_repo_id="local/pick_cube",
        skill_slug="pick_cube",
        output_dir=str(out),
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--output_dir=") == str(out) + "_v2"


def test_train_blocked_when_dataset_missing(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: False)
    bridge.start_training(
        policy_type="act",
        dataset_repo_id="local/missing",
        skill_slug="missing",
    )
    assert "cmd" not in bridge._captured


# ── Calibration ─────────────────────────────────────────────────────────────

def test_calibrate_leader_only(bridge):
    bridge.calibrate_robot(
        robot_type="", robot_id="my_leader_arm",
        teleop_type="so100_leader", teleop_port="COM4",
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--teleop.type=") == "so100_leader"
    assert _arg(cmd, "--teleop.port=") == "COM4"
    assert _arg(cmd, "--teleop.id=") == "my_leader_arm"
    assert not any(a.startswith("--robot.") for a in cmd)


def test_calibrate_follower_only(bridge):
    bridge.calibrate_robot(
        robot_type="so100_follower", robot_id="my_follower_arm", port="COM3",
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--robot.type=") == "so100_follower"
    assert _arg(cmd, "--robot.id=") == "my_follower_arm"
    assert not any(a.startswith("--teleop.") for a in cmd)


def test_calibrate_both_prefers_leader(bridge):
    bridge.calibrate_robot(
        robot_type="so100_follower", robot_id="arm", port="COM3",
        teleop_type="so100_leader", teleop_port="COM4",
    )
    cmd = bridge._captured["cmd"]
    assert any(a.startswith("--teleop.") for a in cmd)
    assert not any(a.startswith("--robot.") for a in cmd)


def test_calibrate_requires_some_port(bridge):
    bridge.calibrate_robot(robot_type="so100_follower", robot_id="arm")
    assert "cmd" not in bridge._captured


# ── Replay ──────────────────────────────────────────────────────────────────

def test_replay_uses_dataset_episode(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    bridge.start_replay(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        episode_index=3,
        port="COM3",
        robot_id="my_follower_arm",
    )
    cmd = bridge._captured["cmd"]
    assert "lerobot.scripts.lerobot_replay" in cmd
    assert _arg(cmd, "--dataset.episode=") == "3"
    assert _arg(cmd, "--robot.id=") == "my_follower_arm"


# ── Teleoperation ───────────────────────────────────────────────────────────

def test_teleop_command(bridge):
    bridge.start_teleop(
        robot_type="so101_follower", robot_port="COM3", robot_id="f1",
        teleop_type="so101_leader", teleop_port="COM4", teleop_id="l1",
        extra_args={"fps": 60},
    )
    cmd = bridge._captured["cmd"]
    assert "lerobot.scripts.lerobot_teleoperate" in cmd
    assert _arg(cmd, "--robot.type=") == "so101_follower"
    assert _arg(cmd, "--teleop.type=") == "so101_leader"
    assert _arg(cmd, "--fps=") == "60"
    assert "--display_data=true" in cmd


# ── Inference & Hardware Monitoring ──────────────────────────────────────────

def test_inference_command_uses_preflight(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_verify_policy_exists", lambda name: True)
    bridge.start_inference(
        robot_type="so100_follower",
        policy_path="my_model",
        skill_slug="pick_cube",
        port="COM3",
        fps=30,
    )
    cmd = bridge._captured["cmd"]
    assert "orchiday_inference.py" in cmd[1]
    assert _arg(cmd, "--robot.type=") == "so100_follower"
    assert _arg(cmd, "--robot.port=") == "COM3"


def test_monitor_hardware_errors_overload(bridge, monkeypatch):
    from orchiday.core.events import event_bus
    log_messages = []
    console_outputs = []
    
    log_slot = lambda level, msg: log_messages.append((level, msg))
    console_slot = lambda msg: console_outputs.append(msg)
    
    event_bus.log_message.connect(log_slot)
    event_bus.console_output.connect(console_slot)
    
    # Mock kill_all
    killed = False
    def fake_kill():
        nonlocal killed
        killed = True
    monkeypatch.setattr(bridge, "kill_all", fake_kill)
    
    try:
        bridge._monitor_hardware_errors("Overload error!", "infer_key")
        
        assert killed
        assert any("KRITICKÉ PŘETÍŽENÍ SERVA" in msg for lvl, msg in log_messages)
        assert any("color:var(--error)" in msg for msg in console_outputs)
    finally:
        event_bus.log_message.disconnect(log_slot)
        event_bus.console_output.disconnect(console_slot)


def test_monitor_hardware_errors_status_packet(bridge):
    from orchiday.core.events import event_bus
    log_messages = []
    console_outputs = []
    
    log_slot = lambda level, msg: log_messages.append((level, msg))
    console_slot = lambda msg: console_outputs.append(msg)
    
    event_bus.log_message.connect(log_slot)
    event_bus.console_output.connect(console_slot)
    
    try:
        bridge._monitor_hardware_errors("Incorrect status packet!", "infer_key")
        
        assert any("Sběrnice ztrácí packety" in msg for lvl, msg in log_messages)
        assert any("color:var(--warning)" in msg for msg in console_outputs)
    finally:
        event_bus.log_message.disconnect(log_slot)
        event_bus.console_output.disconnect(console_slot)


def test_monitor_hardware_errors_running_slower(bridge):
    from orchiday.core.events import event_bus
    log_messages = []
    console_outputs = []
    
    log_slot = lambda level, msg: log_messages.append((level, msg))
    console_slot = lambda msg: console_outputs.append(msg)
    
    event_bus.log_message.connect(log_slot)
    event_bus.console_output.connect(console_slot)
    
    try:
        bridge._monitor_hardware_errors("running slower (10.5 Hz) than the target FPS", "infer_key")
        
        assert any("Počítač nestíhá" in msg for lvl, msg in log_messages)
        assert any("color:var(--warning)" in msg for msg in console_outputs)
    finally:
        event_bus.log_message.disconnect(log_slot)
        event_bus.console_output.disconnect(console_slot)
