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

    def fake_preflight(port, robot_type, on_success_callback, *args, **kwargs):
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
    # Recording runs through Orchiday's wrapper rather than `-m
    # lerobot.scripts.lerobot_record`: the wrapper swaps in a file-driven
    # replacement for init_keyboard_listener, without which the episode
    # controls (next / re-record / stop) can never fire in a subprocess.
    assert cmd[1].endswith("orchiday_record_wrapper.py")
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

def test_teleop_command(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_has_rerun_sdk", lambda: True)
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


# ── Resource arbiter: exclusive serial ports & cameras ───────────────────────

def test_port_guard_blocks_conflicting_start(bridge, monkeypatch):
    # Simulate a running teleop that owns COM3
    bridge._process_ports["teleop"] = {"COM3"}
    bridge._process_kinds["teleop"] = "teleop"
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)

    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="COM4",
    )
    assert "cmd" not in bridge._captured


def test_port_guard_allows_free_ports(bridge):
    bridge._process_ports["teleop"] = {"COM7"}
    bridge._process_kinds["teleop"] = "teleop"
    bridge.start_recording(
        robot_type="so100_follower",
        dataset_name="local/pick_cube",
        skill_slug="pick_cube",
        port="COM3",
        teleop_port="COM4",
    )
    assert "cmd" in bridge._captured


def test_extract_ports_from_command():
    cmd = ["python", "-m", "x", "--robot.port=COM3", "--teleop.port=COM4", "--fps=30"]
    assert LeRobotBridge._extract_ports(cmd) == {"COM3", "COM4"}


def test_dataset_dir_does_not_duplicate_local_namespace(bridge):
    d = bridge._get_dataset_dir("local/parent/pick_cube")
    parts = [p for p in d.parts if p == "local"]
    assert len(parts) == 1
    assert str(d).replace("\\", "/").endswith("lerobot/local/parent/pick_cube")


# ── Step marks (sub-task flags during recording) ─────────────────────────────

def test_mark_step_requires_active_recording(bridge):
    result = bridge.mark_step("pick_cube", label="lift")
    assert result["ok"] is False


def test_mark_step_queues_a_sentinel_for_the_recorder(bridge, tmp_path, monkeypatch):
    """The bridge only queues the request.

    A mark has to be timestamped from the frames already written to the episode
    (LeRobot stores frame timestamps as frame_index / fps), which only the
    recording process can do — see tests/test_record_marks.py for the timing
    itself and for how the resulting mark comes back.
    """
    from PySide6.QtCore import QProcess

    class _FakeProc:
        def state(self):
            return QProcess.ProcessState.Running

    key = "record_pick_cube"
    bridge._active_processes[key] = _FakeProc()
    monkeypatch.setattr(bridge, "_record_control_dir", lambda k: tmp_path / k)
    bridge._record_marks["pick_cube"] = {
        "dataset": "local/pick_cube",
        "marks_path": str(tmp_path / "pick_cube.step_marks.json"),
        "fps": 30, "episodes": {}, "current_episode": 2,
        "phase": "record", "wrapper": True,
    }

    assert bridge.mark_step("pick_cube", label="lift") == {"ok": True, "queued": True}
    assert bridge.undo_step_mark("pick_cube") == {"ok": True, "queued": True}

    # Numbered files, so two marks in the same poll interval both survive
    files = sorted(p.name for p in (tmp_path / key).iterdir())
    assert [f.split("#")[0] for f in files] == ["mark", "unmark"]
    assert (tmp_path / key / files[0]).read_text(encoding="utf-8") == "lift"


def test_mark_step_without_recording_state_is_rejected(bridge):
    assert bridge.mark_step("never_recorded")["ok"] is False
    assert bridge.undo_step_mark("never_recorded")["ok"] is False


# ── Dataset splitting (per-step orchestration datasets) ──────────────────────

def test_split_requires_marks_file(bridge, tmp_path, monkeypatch):
    ds_dir = tmp_path / "lerobot" / "local" / "pick_cube"
    ds_dir.mkdir(parents=True)
    monkeypatch.setattr(bridge, "_get_dataset_dir", lambda name: ds_dir)
    ok = bridge.start_dataset_split(
        "local/pick_cube", "pick_cube",
        steps=[{"slug": "a", "repo_id": "local/pick_cube/a", "task": "a"},
               {"slug": "b", "repo_id": "local/pick_cube/b", "task": "b"}],
    )
    assert ok is False  # no marks sidecar file


def test_split_command_contains_steps_json(bridge, tmp_path, monkeypatch):
    ds_dir = tmp_path / "lerobot" / "local" / "pick_cube"
    ds_dir.mkdir(parents=True)
    (ds_dir.parent / "pick_cube.step_marks.json").write_text(
        '{"episodes": {"0": [{"t": 2.0, "step": 1, "label": "b"}]}}', encoding="utf-8")
    monkeypatch.setattr(bridge, "_get_dataset_dir", lambda name: ds_dir)
    ok = bridge.start_dataset_split(
        "local/pick_cube", "pick_cube",
        steps=[{"slug": "a", "repo_id": "local/pick_cube/a", "task": "grab it"},
               {"slug": "b", "repo_id": "local/pick_cube/b", "task": "place it"}],
    )
    assert ok is True
    cmd = bridge._captured["cmd"]
    assert any("dataset_splitter.py" in a for a in cmd)
    assert _arg(cmd, "--repo-id=") == "local/pick_cube"
    steps_json = _arg(cmd, "--steps-json=")
    assert steps_json is not None
    import json as _json  # local import to avoid top-level collision
    steps = _json.loads(steps_json)
    assert [s["slug"] for s in steps] == ["a", "b"]


def test_split_requires_two_steps(bridge, tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, "_get_dataset_dir", lambda name: tmp_path)
    ok = bridge.start_dataset_split(
        "local/pick_cube", "pick_cube",
        steps=[{"slug": "a", "repo_id": "local/pick_cube/a", "task": "a"}],
    )
    assert ok is False


# ── Daemon request/reply protocol (SNAP / SET_POLICY) ────────────────────────

def test_snapshot_line_resolves_waiter(bridge):
    import threading
    event = threading.Event()
    payload: list = []
    bridge._daemon_waiters["infer_pick"] = (event, payload)
    bridge._parse_inference_line("[SNAPSHOT] QUJD", "infer_pick", "pick")
    assert event.is_set()
    assert payload == ["SNAPSHOT:QUJD"]


def test_policy_loaded_line_resolves_waiter(bridge):
    import threading
    event = threading.Event()
    payload: list = []
    bridge._daemon_waiters["infer_pick"] = (event, payload)
    bridge._parse_inference_line("[STATUS] POLICY_LOADED: /models/step2", "infer_pick", "pick")
    assert event.is_set()
    assert payload == ["POLICY_LOADED"]


def test_release_resources_unblocks_waiter(bridge):
    import threading
    event = threading.Event()
    payload: list = []
    bridge._daemon_waiters["infer_pick"] = (event, payload)
    bridge._release_process_resources("infer_pick")
    assert event.is_set()
    assert payload == [None]


# ── Field-report robustness fixes ────────────────────────────────────────────
# (serial-number port ID, camera arg format, repo_id/single_task, resume/
#  FileExistsError were already covered above; these cover the newly-fixed
#  gaps: canonical joint ordering, packet-drop escalation, calibration errors)

def test_joint_sort_key_matches_kinematic_chain(bridge):
    names = ["wrist_roll.pos", "gripper.pos", "shoulder_pan.pos",
             "elbow_flex.pos", "wrist_flex.pos", "shoulder_lift.pos"]
    ordered = sorted(names, key=bridge._joint_sort_key)
    assert ordered == ["shoulder_pan.pos", "shoulder_lift.pos", "elbow_flex.pos",
                        "wrist_flex.pos", "wrist_roll.pos", "gripper.pos"]


def test_joint_sort_key_falls_back_alphabetically_for_unknown_names(bridge):
    names = ["zeta", "alpha", "beta"]
    ordered = sorted(names, key=bridge._joint_sort_key)
    assert ordered == ["alpha", "beta", "zeta"]


def test_teleop_telemetry_emits_in_kinematic_order(bridge):
    from orchiday.core.events import event_bus
    emitted = []
    slot = lambda s: emitted.append(s)
    event_bus.console_output.connect(slot)
    try:
        for name, val in [("gripper.pos", 6.0), ("shoulder_pan.pos", 1.0),
                           ("elbow_flex.pos", 3.0), ("shoulder_lift.pos", 2.0),
                           ("wrist_flex.pos", 4.0), ("wrist_roll.pos", 5.0)]:
            bridge._parse_teleop_line(f"{name} | {val}")
        bridge._parse_teleop_line("Teleop loop time: 10ms")

        assert len(emitted) == 1
        assert "joints:1.0000,2.0000,3.0000,4.0000,5.0000,6.0000" in emitted[0]
    finally:
        event_bus.console_output.disconnect(slot)


def test_packet_drop_escalates_after_threshold(bridge):
    from orchiday.core.events import event_bus
    messages = []
    slot = lambda level, msg: messages.append(msg)
    event_bus.log_message.connect(slot)
    try:
        for _ in range(bridge._PACKET_DROP_ESCALATE_AT):
            bridge._monitor_hardware_errors("Incorrect status packet!", "record_pick")
        assert any("DOPORUČENÍ" in m for m in messages)
    finally:
        event_bus.log_message.disconnect(slot)


def test_packet_drop_count_resets_on_process_release(bridge):
    bridge._monitor_hardware_errors("Incorrect status packet!", "record_pick")
    assert bridge._packet_drop_counts.get("record_pick") == 1
    bridge._release_process_resources("record_pick")
    assert "record_pick" not in bridge._packet_drop_counts


def test_calibration_homing_offset_error_detected(bridge):
    from orchiday.core.events import event_bus
    messages = []
    slot = lambda level, msg: messages.append(msg)
    event_bus.log_message.connect(slot)
    try:
        bridge._monitor_hardware_errors(
            "ValueError: Homing_Offset Magnitude 3147 exceeds 2047", "calibrate_arm")
        assert any("KALIBRACE SELHALA" in m for m in messages)
    finally:
        event_bus.log_message.disconnect(slot)


# ── Recording episode controls (next / re-record / stop) ──────────────────
# lerobot_record only installs a keyboard listener when pynput is importable
# or stdin is a TTY. Under a QProcess neither holds, so the controls are
# routed through sentinel files that Orchiday's record wrapper watches.

def test_record_wrapper_patches_keyboard_listener():
    from orchiday.ai.lerobot_bridge import LeRobotBridge
    src = LeRobotBridge._RECORD_WRAPPER_SRC
    assert "init_keyboard_listener" in src
    # Must set exactly the three flags lerobot's record_loop polls.
    for flag in ("exit_early", "rerecord_episode", "stop_recording"):
        assert flag in src


def test_send_record_control_writes_sentinel(bridge, tmp_path, monkeypatch):
    from PySide6.QtCore import QProcess

    class _FakeProc:
        def state(self):
            return QProcess.ProcessState.Running

    key = "record_pick_cube"
    bridge._active_processes[key] = _FakeProc()
    monkeypatch.setattr(bridge, "_record_control_dir", lambda k: tmp_path / k)

    assert bridge.send_record_control("pick_cube", "next") is True
    assert (tmp_path / key / "next").exists()

    assert bridge.send_record_control("pick_cube", "reset") is True
    assert (tmp_path / key / "rerecord").exists()

    assert bridge.send_record_control("pick_cube", "stop") is True
    assert (tmp_path / key / "stop").exists()

    # Unknown action is rejected rather than silently writing a stray file.
    assert bridge.send_record_control("pick_cube", "bogus") is False


def test_send_record_control_requires_running_process(bridge):
    assert bridge.send_record_control("not_running", "next") is False


# ── Flag merging and the rerun guard ─────────────────────────────────────────

def test_extra_args_override_base_flags_in_place(bridge, monkeypatch):
    """A repeated option must appear once, carrying the user's value.

    LeRobot's parser takes the last occurrence, so a duplicated flag already
    ran the user's value — but the echoed command read `--steps=1000 ...
    --steps=50000`, where the value that takes effect is not the one the eye
    lands on first.
    """
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    bridge.start_training(
        skill_slug="pick_cube",
        dataset_repo_id="local/pick_cube",
        policy_type="act",
        training_steps=1000,
        batch_size=8,
        extra_args={"steps": 50000, "policy.device": "cpu"},
    )
    cmd = bridge._captured["cmd"]
    assert cmd.count("--steps=50000") == 1
    assert "--steps=1000" not in cmd
    assert [a for a in cmd if a.startswith("--policy.device=")] == ["--policy.device=cpu"]


def test_extra_args_string_also_overrides(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_verify_dataset_exists", lambda name: True)
    bridge.start_training(
        skill_slug="pick_cube",
        dataset_repo_id="local/pick_cube",
        policy_type="act",
        training_steps=1000,
        batch_size=8,
        extra_args_str="--batch_size=64 --num_workers=4",
    )
    cmd = bridge._captured["cmd"]
    assert [a for a in cmd if a.startswith("--batch_size=")] == ["--batch_size=64"]
    assert "--num_workers=4" in cmd


def test_record_omits_display_data_without_rerun(bridge, monkeypatch):
    """Without rerun-sdk, LeRobot's init_rerun() raises before episode one.

    Passing the flag anyway kills the recording session at startup, so it is
    dropped the same way teleoperation already drops it.
    """
    monkeypatch.setattr(bridge, "_has_rerun_sdk", lambda: False)
    bridge.start_recording(
        robot_type="so100_follower", dataset_name="local/pick_cube",
        skill_slug="pick_cube", num_episodes=1, fps=30, port="COM3",
        robot_id="f", teleop_type="so100_leader", teleop_port="COM4",
        teleop_id="l", single_task="pick", display_data=True,
    )
    assert not [a for a in bridge._captured["cmd"] if a.startswith("--display_data")]


def test_record_keeps_display_data_with_rerun(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "_has_rerun_sdk", lambda: True)
    bridge.start_recording(
        robot_type="so100_follower", dataset_name="local/pick_cube2",
        skill_slug="pick_cube2", num_episodes=1, fps=30, port="COM3",
        robot_id="f", teleop_type="so100_leader", teleop_port="COM4",
        teleop_id="l", single_task="pick", display_data=True,
    )
    assert "--display_data=true" in bridge._captured["cmd"]


def test_rerun_probe_is_cached_per_interpreter(bridge, monkeypatch):
    calls = []

    class _Res:
        returncode = 0

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _Res()

    monkeypatch.setattr("orchiday.ai.lerobot_bridge.subprocess.run", fake_run)
    assert bridge._has_rerun_sdk() is True
    assert bridge._has_rerun_sdk() is True
    assert len(calls) == 1
    # The probe locates the module spec instead of importing rerun, which pulls
    # in the native SDK and used to lose races with the subprocess timeout.
    assert "find_spec" in calls[0][-1]
    assert "import rerun" not in calls[0][-1]


# ── Device types on the command line ─────────────────────────────────────────
# Orchiday used to build `--robot.type` / `--teleop.type` by appending
# `_follower` / `_leader` to the family name. draccus resolves those flags
# against registered subclasses, so for every robot whose leader is not named
# after it the process died during argument parsing. These bind the spawned
# command to the catalogue read off LeRobot's own `register_subclass` calls.

from orchiday.core import device_types as dt


@pytest.mark.parametrize("robot_type,expected_robot,expected_teleop", [
    ("lekiwi", "lekiwi", "so100_leader"),
    ("unitree_g1", "unitree_g1", "unitree_g1"),
    ("reachy2", "reachy2", "reachy2_teleoperator"),
    ("hope_jr_arm", "hope_jr_arm", "homunculus_arm"),
    ("so101_follower", "so101_follower", "so101_leader"),
])
def test_teleop_command_carries_registered_device_types(
        bridge, robot_type, expected_robot, expected_teleop):
    bridge.start_teleop(
        robot_type=robot_type, robot_port="COM3", robot_id="my_follower_arm",
        teleop_type="", teleop_port="COM4", teleop_id="my_leader_arm",
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--robot.type=") == expected_robot
    assert _arg(cmd, "--teleop.type=") == expected_teleop


@pytest.mark.parametrize("robot_type,expected", [
    ("lekiwi", "lekiwi"),                    # was `lekiwi_follower`
    ("unitree_g1", "unitree_g1"),            # was `unitree_g1_follower`
    ("reachy2", "reachy2"),                  # was `reachy2_follower`
    ("hope_jr_arm", "hope_jr_arm"),          # was `hope_jr_arm_follower`
    ("so100", "so100_follower"),             # bare family from an old project
])
def test_follower_calibration_carries_a_registered_robot_type(bridge, robot_type, expected):
    bridge.calibrate_robot(robot_type=robot_type, port="COM3", robot_id="my_follower_arm")
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--robot.type=") == expected
    assert "--teleop.type=" not in " ".join(cmd)


@pytest.mark.parametrize("robot_type,expected", [
    ("lekiwi", "so100_leader"),              # was `lekiwi_leader`
    ("reachy2", "reachy2_teleoperator"),     # was `reachy2_leader`
    ("hope_jr_hand", "homunculus_glove"),    # was `hope_jr_hand_leader`
    ("koch_follower", "koch_leader"),
])
def test_leader_calibration_carries_a_registered_teleop_type(bridge, robot_type, expected):
    bridge.calibrate_robot(
        robot_type="", teleop_type=robot_type,
        teleop_port="COM4", robot_id="my_leader_arm",
    )
    cmd = bridge._captured["cmd"]
    assert _arg(cmd, "--teleop.type=") == expected
    assert "--robot.type=" not in " ".join(cmd)


def test_no_catalogue_device_can_produce_an_unregistered_flag(bridge):
    """
    Sweeps the whole catalogue through the command builder — the guarantee is
    that nothing Orchiday can be configured with reaches LeRobot as a name it
    does not register.
    """
    from tests.test_device_types import LEROBOT_ROBOT_TYPES, LEROBOT_TELEOP_TYPES

    for entry in dt.CATALOGUE:
        bridge.start_teleop(
            robot_type=entry.robot_type, robot_port="COM3", robot_id="follower",
            teleop_type="", teleop_port="COM4", teleop_id="leader",
        )
        cmd = bridge._captured["cmd"]
        assert _arg(cmd, "--robot.type=") in LEROBOT_ROBOT_TYPES, entry.robot_type
        assert _arg(cmd, "--teleop.type=") in LEROBOT_TELEOP_TYPES, entry.robot_type
        bridge._active_processes.clear()
