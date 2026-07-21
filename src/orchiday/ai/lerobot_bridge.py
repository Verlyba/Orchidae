"""
LeRobot bridge — QProcess subprocess wrapper for running LeRobot CLI commands.

Handles:
- Robot connection and calibration
- Data collection (recording episodes)
- Policy training
- Policy inference
- Custom terminal command execution

All LeRobot operations run as background QProcesses integrated into the Qt event loop,
ensuring high responsiveness, thread-safety, and robust emergency stop capability.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, Signal, Slot

from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class LeRobotBridge(QObject):
    """
    Manages LeRobot CLI subprocesses using PySide6's QProcess.

    All commands are spawned asynchronously on the Qt event loop,
    ensuring thread-safety, real-time output parsing, and reliable emergency stopping.
    """

    # Marshals subprocess spawning onto the bridge's owning (main) thread —
    # QProcess must be created and driven from the thread whose event loop
    # services it (the orchestration worker thread calls into the bridge).
    _spawn_requested = Signal(str, list, str, str)
    # Marshals stdin writes onto the owning thread (QProcess is not thread-safe;
    # the orchestration worker thread sends SET_TASK/SET_POLICY/SNAP commands).
    _write_requested = Signal(str, str)

    def __init__(self, python_executable: str | None = None, project_manager=None, parent=None):
        super().__init__(parent)
        self._spawn_requested.connect(self._spawn_process_impl)
        self._write_requested.connect(self._write_process_impl)
        self._default_python = python_executable or self._autodetect_python() or sys.executable
        log.info("LeRobotBridge: default Python interpreter: %s", self._default_python)
        # Injected ProjectManager — avoids importing orchiday.server (which would
        # create a SECOND module instance when the server runs as `python -m`).
        self._pm = project_manager
        self._active_processes: dict[str, QProcess] = {}
        self._teleop_state: dict[str, float] = {}
        # Counts consecutive bus packet-drop warnings per process so we can
        # escalate to an actionable suggestion instead of repeating forever.
        self._packet_drop_counts: dict[str, int] = {}
        self._record_totals: dict[str, int] = {}
        self._pending_infer_tasks: dict[str, str] = {}
        self._process_kinds: dict[str, str] = {}
        self._shell_process: QProcess | None = None
        # ── Resource arbiter state (exclusive hardware access) ────────────
        # Serial ports owned by running processes: key -> {port, ...}
        self._process_ports: dict[str, set[str]] = {}
        # Preview cameras suspended for a process, restored on its exit
        self._suspended_cameras: dict[str, list[str]] = {}
        # Injected CameraManager (set by the controller)
        self._camera_manager = None
        # ── Per-step orchestration state ───────────────────────────────────
        # Policy currently loaded inside a running inference daemon: key -> path
        self._infer_policy_paths: dict[str, str] = {}
        # Waiters for [SNAPSHOT]/[STATUS] POLICY_* daemon replies: key -> (Event, [payload])
        self._daemon_waiters: dict[str, tuple] = {}
        # ── Step-mark state (sub-task flags clicked during recording) ─────
        # skill_slug -> {dataset, marks_path, fps, episodes, current_episode, episode_started}
        self._record_marks: dict[str, dict] = {}

    @staticmethod
    def _autodetect_python() -> str | None:
        """Best-effort cross-platform search for a Python with LeRobot installed."""
        home = Path.home()
        is_win = sys.platform == "win32"
        candidates: list[Path] = []
        # LeRobot repo virtualenvs in common checkout locations
        for repo in (home / "robotics" / "lerobot", home / "lerobot", home / "projects" / "lerobot"):
            if is_win:
                candidates.append(repo / ".venv" / "Scripts" / "python.exe")
            else:
                candidates.append(repo / ".venv" / "bin" / "python")
        # Conda env named "lerobot"
        for conda_root in (home / "miniconda3", home / "anaconda3", Path("/opt/miniconda3")):
            if is_win:
                candidates.append(conda_root / "envs" / "lerobot" / "python.exe")
            else:
                candidates.append(conda_root / "envs" / "lerobot" / "bin" / "python")
        for c in candidates:
            if c.exists():
                return str(c)
        return None

    @property
    def _python(self) -> str:
        """Dynamically return the python executable path from global config."""
        try:
            from orchiday.core.config import AppConfig
            cfg = AppConfig()
            python_path = cfg.get("python_path")
            if python_path and Path(python_path).exists():
                return python_path

            # Fallback to checking lerobot_dir
            p_dir = cfg.get("lerobot_dir")
            if p_dir:
                for rel in ((".venv", "bin", "python"), (".venv", "Scripts", "python.exe"),
                            ("bin", "python"), ("Scripts", "python.exe")):
                    venv_python = Path(p_dir).joinpath(*rel)
                    if venv_python.exists():
                        return str(venv_python)
        except Exception:
            pass
        return self._default_python

    # ── Resource arbiter: exclusive camera + serial-port access ───────────

    def set_camera_manager(self, camera_manager) -> None:
        """Inject the CameraManager so preview workers can be suspended while
        a LeRobot subprocess needs exclusive access to the same devices."""
        self._camera_manager = camera_manager

    def _port_conflict(self, *ports: str) -> str | None:
        """Return a human-readable owner description if any port is already
        owned by a running process, else None."""
        wanted = {p.strip() for p in ports if p and p.strip()}
        for key, owned in self._process_ports.items():
            hit = wanted & owned
            if hit:
                kind = self._process_kinds.get(key, "process")
                return f"port '{next(iter(hit))}' is in use by running {kind} ({key})"
        return None

    def _guard_ports(self, *ports: str) -> bool:
        """Emit an error and return False when a requested serial port is busy."""
        conflict = self._port_conflict(*ports)
        if conflict:
            msg = f"[RESOURCE CONFLICT] Cannot start: {conflict}. Stop it first."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return False
        return True

    @staticmethod
    def _extract_ports(cmd: list[str]) -> set[str]:
        """Collect serial ports referenced by a command line."""
        ports: set[str] = set()
        for a in cmd:
            for prefix in ("--robot.port=", "--teleop.port="):
                if a.startswith(prefix):
                    val = a[len(prefix):].strip()
                    if val:
                        ports.add(val)
        return ports

    def _suspend_preview_cameras(self, key: str, cmd: list[str]) -> None:
        """Stop preview CameraWorkers before a subprocess opens the same devices.

        Only one process may own a camera at a time; LeRobot subprocesses that
        receive a cameras argument get exclusive access, previews are restored
        automatically when the process exits.
        """
        if self._camera_manager is None:
            return
        if not any(".cameras=" in a for a in cmd):
            return
        active = list(self._camera_manager.active_cameras)
        if not active:
            return
        for cam_id in active:
            try:
                self._camera_manager.stop_camera(cam_id)
                event_bus.camera_suspended.emit(cam_id)
            except Exception as e:
                log.warning("Failed to suspend camera '%s': %s", cam_id, e)
        self._suspended_cameras[key] = active
        event_bus.log_message.emit(
            "INFO", f"Camera preview suspended ({', '.join(active)}) — exclusive access handed to {key}")

    def _resume_preview_cameras(self, key: str) -> None:
        """Restart preview workers that were suspended for a finished process."""
        suspended = self._suspended_cameras.pop(key, None)
        if not suspended:
            return
        for cam_id in suspended:
            # camera_started is a REQUEST signal — the controller slot restarts
            # the worker using the project camera configuration.
            event_bus.camera_started.emit(cam_id)
        event_bus.log_message.emit(
            "INFO", f"Camera preview resumed ({', '.join(suspended)}) after {key} finished")

    # ── Project config helpers ───────────────────────────────────────────

    def _current_project(self) -> dict | None:
        """Return the active project dict from the injected ProjectManager."""
        try:
            if self._pm is not None and self._pm.current_project:
                return self._pm.current_project
        except Exception:
            pass
        return None

    def _build_cameras_arg(self, camera_ids: list[str] | None) -> str:
        """
        Build the draccus camera dict for --robot.cameras from project camera configs.

        LeRobot >= 0.4 expects:
        { name: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}
        """
        project = self._current_project()
        configured = (project or {}).get("cameras", [])
        by_id = {c.get("id"): c for c in configured}

        entries = []
        for cam_id in camera_ids or []:
            cfg = by_id.get(cam_id)
            if not cfg:
                continue
            source = cfg.get("source", 0)
            try:
                source = int(source)
            except (TypeError, ValueError):
                pass  # keep string path (e.g. /dev/video0)
            res = cfg.get("resolution", [640, 480]) or [640, 480]
            fps = cfg.get("fps", 30)
            name = re.sub(r"[^a-zA-Z0-9_]", "_", cam_id)
            src_repr = source if isinstance(source, int) else f"'{source}'"
            entries.append(
                f"{name}: {{type: opencv, index_or_path: {src_repr}, "
                f"width: {res[0]}, height: {res[1]}, fps: {fps}}}"
            )
        if not entries:
            return ""
        return "{ " + ", ".join(entries) + "}"

    def _build_cameras_json(self, camera_ids: list[str] | None) -> str:
        """JSON camera map for the Orchiday inference daemon (not draccus syntax)."""
        project = self._current_project()
        configured = (project or {}).get("cameras", [])
        by_id = {c.get("id"): c for c in configured}

        cams: dict[str, dict] = {}
        for cam_id in camera_ids or []:
            cfg = by_id.get(cam_id)
            if not cfg:
                continue
            source = cfg.get("source", 0)
            try:
                source = int(source)
            except (TypeError, ValueError):
                pass
            res = cfg.get("resolution", [640, 480]) or [640, 480]
            name = re.sub(r"[^a-zA-Z0-9_]", "_", cam_id)
            cams[name] = {
                "index_or_path": source,
                "width": res[0],
                "height": res[1],
                "fps": cfg.get("fps", 30),
            }
        return json.dumps(cams) if cams else ""

    @property
    def active_processes(self) -> dict[str, QProcess]:
        return dict(self._active_processes)

    @property
    def active_process_kinds(self) -> dict[str, str]:
        """Map of running process key -> kind, for UI state synchronisation."""
        return {k: self._process_kinds.get(k, "") for k in self._active_processes}

    # ── Detect available robot types from LeRobot ────────────────────────

    def detect_available_robots(self) -> list[str]:
        """
        Query LeRobot to find which robot types are available.

        Returns list of robot type strings the installed LeRobot supports.
        """
        import subprocess
        try:
            result = subprocess.run(
                [self._python, "-c",
                 "from lerobot.robots.utils import make_robot_from_config; "
                 "print('lerobot_available')"],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0:
                log.info("LeRobot is available")
                return ["lerobot_available"]
        except (subprocess.TimeoutExpired, FileNotFoundError):
            log.warning("LeRobot not found or timed out")
        return []

    def check_lerobot_installed(self) -> bool:
        """Check if LeRobot is importable."""
        import subprocess
        try:
            result = subprocess.run(
                [self._python, "-c", "import lerobot; print(lerobot.__version__)"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                log.info("LeRobot version: %s", version)
                event_bus.log_message.emit("INFO", f"LeRobot {version} detected")
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        event_bus.log_message.emit("WARN", "LeRobot not found — install it first")
        return False

    def _run_preflight_check(self, port: str, robot_type: str, on_success_callback: Callable[[], None]) -> None:
        """Run pre-flight check asynchronously via QProcess. If success, execute callback."""
        if not port:
            on_success_callback()
            return

        is_feetech = any(f in robot_type.lower() for f in ("so100", "so101", "bi_so", "lekiwi"))
        if is_feetech:
            # STS3215 Feetech check
            py_code = f"""
import sys
try:
    from lerobot.motors.feetech import FeetechMotorsBus
    from lerobot.motors.motors_bus import Motor, MotorNormMode
    norm = list(MotorNormMode)[0]
    motors = {{f"m{{i}}": Motor(i, "sts3215", norm) for i in [1, 2, 3, 4, 5, 6]}}
    bus = FeetechMotorsBus(port=r'{port}', motors=motors)
    bus.connect()
    bus.disconnect()
    print("SUCCESS")
except Exception as e:
    print("ERROR:", str(e))
"""
        else:
            # Generic serial check
            py_code = f"""
import sys
try:
    import serial
    s = serial.Serial(r'{port}', baudrate=1000000, timeout=1)
    s.close()
    print("SUCCESS")
except Exception as e:
    print("ERROR:", str(e))
"""

        # Using a QProcess for non-blocking asynchronous execution
        check_process = QProcess(self)
        check_process.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        
        project = self._current_project()
        from orchiday.core.constants import APP_DATA_DIR
        hf_home = str(APP_DATA_DIR / "data" / "huggingface")
        if project and project.get("dataset_storage_dir"):
            hf_home = str(project["dataset_storage_dir"])
            
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HF_HOME", hf_home)
        check_process.setProcessEnvironment(env)

        temp_key = f"preflight_{port}"
        self._active_processes[temp_key] = check_process

        def on_finished(exit_code: int):
            self._active_processes.pop(temp_key, None)
            output = bytes(check_process.readAllStandardOutput().data()).decode("utf-8", errors="replace").strip()
            if exit_code == 0 and "SUCCESS" in output:
                log.info("Pre-flight hardware check passed for port %s.", port)
                on_success_callback()
            else:
                err = output.replace("ERROR:", "").strip() or "Connection timeout or device not found."
                msg = f"[HARDWARE CHECK FAILED] Port {port}: {err}"
                log.error(msg)
                event_bus.log_message.emit("ERROR", msg)
                event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")

        check_process.finished.connect(on_finished)
        log.info("Spawning asynchronous pre-flight hardware check on port %s...", port)
        check_process.start(self._python, ["-c", py_code])

    def _get_dataset_dir(self, dataset_name: str) -> Path:
        """Resolve the local dataset directory on disk using the HF_HOME setting."""
        project = self._current_project()
        hf_home = Path.home() / ".cache" / "huggingface"
        if project and project.get("dataset_storage_dir"):
            hf_home = Path(project["dataset_storage_dir"])
        else:
            from orchiday.core.constants import APP_DATA_DIR
            hf_home = APP_DATA_DIR / "data" / "huggingface"

        # LeRobot resolves local datasets to HF_LEROBOT_HOME/<repo_id>, where
        # HF_LEROBOT_HOME defaults to HF_HOME/lerobot — repo_id already contains
        # the "local/" namespace, so it must NOT be prefixed again.
        parts = dataset_name.split("/")
        return hf_home / "lerobot" / Path(*parts)

    def _verify_dataset_exists(self, dataset_name: str) -> bool:
        """Check if dataset exists locally in local caches or is absolute."""
        if not dataset_name:
            return False
        if Path(dataset_name).exists():
            return True

        custom_dir = None
        parent_slug = ""
        try:
            project = self._current_project()
            if project:
                custom_dir = project.get("dataset_storage_dir")
                skills_details = project.get("skills_details", {})
                parts = dataset_name.split("/")
                last_part = parts[-1]
                if last_part in skills_details:
                    parent_slug = skills_details[last_part].get("parent_slug", "")
                else:
                    for robot in project.get("robots", []):
                        r_type = robot.get("type", "")
                        if r_type and last_part.startswith(f"{r_type}_"):
                            candidate = last_part[len(r_type) + 1:]
                            if candidate in skills_details:
                                parent_slug = skills_details[candidate].get("parent_slug", "")
                                break
        except Exception:
            pass

        paths = []
        if custom_dir:
            custom_path = Path(custom_dir)
            if parent_slug:
                paths.append(custom_path / "lerobot" / "local" / parent_slug / dataset_name.split("/")[-1])
                paths.append(custom_path / "lerobot" / parent_slug / dataset_name.split("/")[-1])
                paths.append(custom_path / parent_slug / dataset_name.split("/")[-1])
            paths.append(custom_path / "lerobot" / dataset_name)
            paths.append(custom_path / dataset_name)

        from orchiday.core.constants import APP_DATA_DIR
        
        if parent_slug:
            paths.append(Path.home() / ".cache" / "huggingface" / "lerobot" / "local" / parent_slug / dataset_name.split("/")[-1])
            paths.append(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / parent_slug / dataset_name.split("/")[-1])

        paths.extend([
            Path.home() / ".cache" / "huggingface" / "lerobot" / dataset_name,
            APP_DATA_DIR / "data" / "huggingface" / "lerobot" / dataset_name,
            APP_DATA_DIR / "data" / "huggingface" / "hub" / f"datasets--{dataset_name.replace('/', '--')}",
            Path.home() / ".cache" / "huggingface" / "hub" / f"datasets--{dataset_name.replace('/', '--')}"
        ])

        for p in paths:
            if p.exists():
                log.info("Found dataset at: %s", p)
                return True
        return False

    def _verify_policy_exists(self, policy_path: str) -> bool:
        """Check if policy checkpoint exists locally or in app outputs."""
        if not policy_path:
            return False
        path_obj = Path(policy_path)
        if path_obj.exists():
            return True

        custom_dir = None
        project = self._current_project()
        if project:
            custom_dir = project.get("dataset_storage_dir")

        paths = []
        if custom_dir:
            custom_path = Path(custom_dir)
            paths.append(custom_path / "outputs" / "training" / policy_path)
            paths.append(custom_path / policy_path)

        from orchiday.core.constants import APP_DATA_DIR
        paths.extend([
            APP_DATA_DIR / "data" / "outputs" / "training" / policy_path,
            APP_DATA_DIR / "data" / "huggingface" / "hub" / f"models--{policy_path.replace('/', '--')}",
            Path.home() / ".cache" / "huggingface" / "hub" / f"models--{policy_path.replace('/', '--')}"
        ])

        for p in paths:
            if p.exists():
                log.info("Found policy at: %s", p)
                return True
        return False

    # ── Robot teleoperation ──────────────────────────────────────────────

    def start_teleop(
        self,
        robot_type: str,
        robot_port: str,
        robot_id: str,
        teleop_type: str,
        teleop_port: str,
        teleop_id: str,
        cameras: str = "",
        display_data: bool = True,
        extra_args: dict[str, Any] | None = None,
    ) -> None:
        """Run LeRobot teleoperation between leader and follower with validations."""
        key = "teleop"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", "Teleoperation already running")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not robot_port or not teleop_port:
            msg = "[VALIDATION ERROR] Leader and Follower serial ports must be specified!"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if robot_port.strip() == teleop_port.strip():
            msg = f"[VALIDATION ERROR] Serial Port Conflict! Leader and Follower cannot share the same port: '{robot_port}'"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not self._guard_ports(robot_port, teleop_port):
            return

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_teleoperate",
            f"--robot.type={robot_type}",
            f"--robot.port={robot_port}",
            f"--robot.id={robot_id}",
            f"--teleop.type={teleop_type}",
            f"--teleop.port={teleop_port}",
            f"--teleop.id={teleop_id}",
        ]
        if cameras:
            cmd.append(f"--robot.cameras={cameras}")
        if display_data:
            cmd.append("--display_data=true")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        def launch():
            event_bus.log_message.emit("INFO", f"Starting teleoperation: {robot_type} <-> {teleop_type}")
            self._spawn_process(key, cmd, kind="teleop", skill_slug="teleop")

        self._run_preflight_check(robot_port, robot_type,
            lambda: self._run_preflight_check(teleop_port, teleop_type, launch))

    def stop_teleop(self) -> None:
        """Stop running teleoperation."""
        self._kill_process("teleop")

    # ── Robot calibration ────────────────────────────────────────────────

    def calibrate_robot(
        self,
        robot_type: str,
        robot_id: str,
        port: str = "",
        teleop_type: str = "",
        teleop_port: str = "",
        extra_args: dict[str, Any] | None = None,
    ) -> None:
        """
        Run LeRobot calibration with validation.

        LeRobot >= 0.4 requires EXACTLY ONE device per invocation:
        either --teleop.* (leader arm) or --robot.* (follower arm).
        Pass teleop_type+teleop_port to calibrate a leader,
        or robot_type+port to calibrate a follower.
        """
        key = f"calibrate_{robot_id}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Calibration already running for {robot_id}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        use_teleop = bool(teleop_port.strip()) if teleop_port else False
        use_robot = bool(port.strip()) if port else False

        if not use_teleop and not use_robot:
            msg = f"[VALIDATION ERROR] Calibration requires a port (teleop leader or robot follower)! Configure one for '{robot_id}'."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if use_teleop and use_robot:
            # lerobot-calibrate accepts only one device — prefer the teleop (leader),
            # the caller should invoke a second calibration for the follower.
            msg = ("[VALIDATION] lerobot-calibrate accepts exactly one device per run — "
                   "calibrating the LEADER now. Run follower calibration separately.")
            log.warning(msg)
            event_bus.log_message.emit("WARN", msg)
            use_robot = False

        if not self._guard_ports(teleop_port if use_teleop else port):
            return

        cmd = [self._python, "-m", "lerobot.scripts.lerobot_calibrate"]

        if use_teleop:
            cmd.append(f"--teleop.type={teleop_type or 'so100_leader'}")
            cmd.append(f"--teleop.port={teleop_port}")
            cmd.append(f"--teleop.id={robot_id}")
        else:
            cmd.append(f"--robot.type={robot_type or 'so100_follower'}")
            cmd.append(f"--robot.port={port}")
            cmd.append(f"--robot.id={robot_id}")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        def launch():
            event_bus.robot_calibrating.emit(robot_id)
            target = "leader/teleop" if use_teleop else "follower/robot"
            event_bus.log_message.emit("INFO", f"Starting calibration of {target} arm '{robot_id}'")
            self._spawn_process(key, cmd, kind="calibrate", skill_slug=robot_id)

        if use_teleop:
            self._run_preflight_check(teleop_port, teleop_type or "so100_leader", launch)
        else:
            self._run_preflight_check(port, robot_type or "so100_follower", launch)

    # ── Data recording ───────────────────────────────────────────────────

    def start_recording(
        self,
        robot_type: str,
        dataset_name: str,
        skill_slug: str,
        num_episodes: int = 50,
        fps: int = 30,
        port: str = "",
        robot_id: str = "",
        teleop_type: str = "",
        teleop_port: str = "",
        teleop_id: str = "",
        single_task: str = "",
        episode_time_s: float = 60,
        reset_time_s: float = 10,
        push_to_hub: bool = False,
        display_data: bool = False,
        camera_ids: list[str] | None = None,
        resume: bool = False,
        extra_args: dict[str, Any] | None = None,
        extra_args_str: str = "",
    ) -> None:
        """
        Start recording episodes via `lerobot-record` (LeRobot >= 0.4 CLI).

        The record script requires a teleoperator (leader arm) OR a policy,
        plus a mandatory --dataset.single_task annotation.
        """
        key = f"record_{skill_slug}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Recording already active for {skill_slug}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        def _fail(msg: str) -> None:
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")

        if not port:
            _fail("[VALIDATION ERROR] Follower serial port must be specified to start recording demonstrations!")
            return
        if not teleop_port:
            _fail("[VALIDATION ERROR] Leader (teleop) serial port must be specified — lerobot-record needs a teleoperator to control the robot!")
            return
        if port.strip() == teleop_port.strip():
            _fail(f"[VALIDATION ERROR] Serial Port Conflict! Leader and Follower cannot share the same port: '{port}'")
            return
        if not dataset_name:
            _fail("[VALIDATION ERROR] Dataset repository name cannot be empty!")
            return
        if not self._guard_ports(port, teleop_port):
            return

        if not single_task:
            # --dataset.single_task is mandatory in LeRobot >= 0.4
            single_task = skill_slug.replace("_", " ")
            event_bus.log_message.emit("WARN", f"No task description provided — using '{single_task}' as the dataset task annotation.")

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_record",
            f"--robot.type={robot_type}",
            f"--robot.port={port}",
            f"--robot.id={robot_id or 'my_follower_arm'}",
            f"--teleop.type={teleop_type or 'so100_leader'}",
            f"--teleop.port={teleop_port}",
            f"--teleop.id={teleop_id or 'my_leader_arm'}",
            f"--dataset.repo_id={dataset_name}",
            f"--dataset.single_task={single_task}",
            f"--dataset.fps={fps}",
            f"--dataset.num_episodes={num_episodes}",
            f"--dataset.episode_time_s={episode_time_s}",
            f"--dataset.reset_time_s={reset_time_s}",
            f"--dataset.push_to_hub={'true' if push_to_hub else 'false'}",
            # Streaming video encoding keeps the 30 Hz control loop stable (anti-lag)
            "--dataset.streaming_encoding=true",
            "--dataset.encoder_threads=2",
        ]

        cameras_arg = self._build_cameras_arg(camera_ids)
        if cameras_arg:
            cmd.append(f"--robot.cameras={cameras_arg}")

        if display_data:
            cmd.append("--display_data=true")

        if resume:
            cmd.append("--resume=true")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        if extra_args_str:
            try:
                parsed_args = shlex.split(extra_args_str)
                cmd.extend(parsed_args)
            except Exception as e:
                log.error("Failed to parse extra record arguments: %s", e)

        def launch():
            dataset_dir = self._get_dataset_dir(dataset_name)
            marks_path = dataset_dir.parent / f"{dataset_dir.name}.step_marks.json"
            if not resume:
                if dataset_dir.exists():
                    log.info("FS Validation: Deleting existing dataset at %s to prevent LeRobot FileExistsError", dataset_dir)
                    try:
                        import shutil
                        shutil.rmtree(dataset_dir)
                    except Exception as e:
                        log.error("Failed to delete existing dataset directory: %s", e)
                if marks_path.exists():
                    try:
                        marks_path.unlink()
                    except Exception as e:
                        log.warning("Failed to reset step marks file: %s", e)

            # Step-mark tracking: sub-task boundary flags clicked in the UI while
            # recording; stored NEXT TO the dataset (sibling file) so lerobot-record
            # never sees an unexpected pre-existing dataset directory.
            marks_state = {
                "dataset": dataset_name,
                "marks_path": str(marks_path),
                "fps": fps,
                "episodes": {},
                "current_episode": -1,
                "episode_started": 0.0,
            }
            if resume and marks_path.exists():
                try:
                    with open(marks_path, "r", encoding="utf-8") as f:
                        marks_state["episodes"] = json.load(f).get("episodes", {})
                except Exception as e:
                    log.warning("Failed to load existing step marks: %s", e)
            self._record_marks[skill_slug] = marks_state

            self._record_totals[skill_slug] = num_episodes
            event_bus.recording_started.emit(skill_slug)
            event_bus.log_message.emit("INFO", f"Recording started: {skill_slug} ({num_episodes} episodes, task='{single_task}', resume={resume})")
            self._spawn_process(key, cmd, kind="record", skill_slug=skill_slug)

        self._run_preflight_check(port, robot_type,
            lambda: self._run_preflight_check(teleop_port, teleop_type or "so100_leader", launch))

    def stop_recording(self, skill_slug: str) -> None:
        """Stop an active recording session (Emergency Stop)."""
        key = f"record_{skill_slug}"
        self._kill_process(key)
        event_bus.recording_stopped.emit(skill_slug, 0)

    def start_replay(
        self,
        robot_type: str,
        dataset_name: str,
        episode_index: int,
        port: str = "",
        robot_id: str = "",
        extra_args: dict[str, Any] | None = None,
    ) -> None:
        """Start hardware replay of a recorded episode on the robot with validations."""
        key = f"replay_{dataset_name}_{episode_index}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Replay already active for episode {episode_index}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not port:
            msg = "[VALIDATION ERROR] Follower serial port must be specified to replay an episode on the hardware!"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not self._verify_dataset_exists(dataset_name):
            msg = f"[VALIDATION ERROR] Dataset '{dataset_name}' not found locally or in Hugging Face cache! Did you record demonstrations first (Step 2)?"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not self._guard_ports(port):
            return

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_replay",
            f"--robot.type={robot_type}",
            f"--robot.id={robot_id or 'my_follower_arm'}",
            f"--dataset.repo_id={dataset_name}",
            f"--dataset.episode={episode_index}",
        ]
        if port:
            cmd.append(f"--robot.port={port}")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        event_bus.log_message.emit("INFO", f"Replay started: episode {episode_index} of {dataset_name} on {robot_type}")
        self._spawn_process(key, cmd, kind="replay", skill_slug=dataset_name)

    # ── Dataset editing (lerobot-edit-dataset) ───────────────────────────

    # Whitelisted operations of lerobot-edit-dataset (LeRobot >= 0.5)
    DATASET_EDIT_OPERATIONS = {
        "delete_episodes", "split", "merge", "remove_feature",
        "modify_tasks", "convert_image_to_video", "recompute_stats", "info",
    }

    def run_dataset_edit(
        self,
        operation: str,
        repo_id: str = "",
        new_repo_id: str = "",
        params: dict[str, Any] | None = None,
    ) -> bool:
        """
        Run one `lerobot-edit-dataset` operation as a tracked subprocess.

        Operation params are passed as --operation.<key>=<value>; lists/dicts
        are serialized the way draccus expects (Python-literal style strings).
        """
        if operation not in self.DATASET_EDIT_OPERATIONS:
            event_bus.log_message.emit("ERROR", f"Unknown dataset operation: {operation}")
            return False
        if operation != "merge" and not repo_id:
            event_bus.log_message.emit("ERROR", "Dataset repo_id is required for this operation.")
            return False

        key = f"dataset_edit_{operation}_{repo_id or new_repo_id}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", "A dataset edit operation is already running for this dataset.")
            return False

        cmd = [self._python, "-m", "lerobot.scripts.lerobot_edit_dataset",
               f"--operation.type={operation}"]
        if repo_id:
            cmd.append(f"--repo_id={repo_id}")
        if new_repo_id:
            cmd.append(f"--new_repo_id={new_repo_id}")
        cmd.append("--push_to_hub=false")

        for k, v in (params or {}).items():
            if isinstance(v, (list, dict)):
                cmd.append(f"--operation.{k}={json.dumps(v)}")
            elif isinstance(v, bool):
                cmd.append(f"--operation.{k}={'true' if v else 'false'}")
            else:
                cmd.append(f"--operation.{k}={v}")

        event_bus.log_message.emit("INFO", f"Dataset operation '{operation}' started on '{repo_id or new_repo_id}'")
        self._spawn_process(key, cmd, kind="dataset_edit", skill_slug=repo_id)
        return True

    # ── Step-dataset splitting (orchestration training data) ─────────────

    def start_dataset_split(
        self,
        source_repo_id: str,
        skill_slug: str,
        steps: list[dict],
        require_complete: bool = True,
    ) -> bool:
        """
        Split a recorded dataset into per-step sub-datasets using the step marks
        sidecar file. Runs core/dataset_splitter.py as a standalone script inside
        the LeRobot Python environment (the script has no orchiday imports).

        Args:
            source_repo_id: e.g. "local/pick_and_place" (the full baseline dataset).
            skill_slug: parent skill slug (used for progress reporting).
            steps: ordered list of {"slug", "repo_id", "task"} — one per sub-skill.
                   Segment k of every episode is appended to steps[k]'s dataset.
            require_complete: skip episodes whose mark count != len(steps) - 1.
        """
        key = f"dataset_split_{skill_slug}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", "Dataset splitting already running for this skill.")
            return False
        if len(steps) < 2:
            event_bus.log_message.emit("ERROR", "Dataset splitting requires at least 2 ordered sub-steps.")
            return False

        dataset_dir = self._get_dataset_dir(source_repo_id)
        if not dataset_dir.exists():
            event_bus.log_message.emit("ERROR", f"Source dataset '{source_repo_id}' not found on disk.")
            return False
        marks_path = dataset_dir.parent / f"{dataset_dir.name}.step_marks.json"
        if not marks_path.exists():
            event_bus.log_message.emit("ERROR", "No step marks found — record with step flags first.")
            return False

        script_path = Path(__file__).parent.parent / "core" / "dataset_splitter.py"
        cmd = [
            self._python, str(script_path),
            f"--repo-id={source_repo_id}",
            f"--marks={marks_path}",
            f"--steps-json={json.dumps(steps, ensure_ascii=False)}",
            f"--require-complete={'true' if require_complete else 'false'}",
        ]
        event_bus.log_message.emit(
            "INFO", f"Splitting dataset '{source_repo_id}' into {len(steps)} step datasets...")
        self._spawn_process(key, cmd, kind="dataset_split", skill_slug=skill_slug)
        return True

    # ── Simulation evaluation (lerobot-eval) ─────────────────────────────

    def start_eval(
        self,
        policy_path: str,
        env_type: str,
        n_episodes: int = 10,
        batch_size: int = 10,
        device: str = "cuda",
    ) -> bool:
        """Evaluate a trained policy in a simulated gym environment (pusht/aloha/xarm)."""
        key = f"eval_{env_type}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Evaluation already running in env '{env_type}'")
            return False

        if not policy_path:
            event_bus.log_message.emit("ERROR", "Policy path is required for evaluation.")
            return False

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_eval",
            f"--policy.path={policy_path}",
            f"--env.type={env_type}",
            f"--eval.n_episodes={n_episodes}",
            f"--eval.batch_size={batch_size}",
            f"--policy.device={device}",
            "--policy.use_amp=false",
        ]
        event_bus.log_message.emit("INFO", f"Simulation evaluation started: {policy_path} in '{env_type}' ({n_episodes} episodes)")
        self._spawn_process(key, cmd, kind="eval", skill_slug=env_type)
        return True

    # ── Hardware / diagnostic CLI utilities ──────────────────────────────

    # tool name -> (module, supports draccus robot/teleop args)
    LEROBOT_TOOLS = {
        "find_cameras": "lerobot.scripts.lerobot_find_cameras",
        "find_port": "lerobot.scripts.lerobot_find_port",
        "setup_motors": "lerobot.scripts.lerobot_setup_motors",
        "find_joint_limits": "lerobot.scripts.lerobot_find_joint_limits",
        "info": "lerobot.scripts.lerobot_info",
        "dataset_viz": "lerobot.scripts.lerobot_dataset_viz",
    }

    def run_tool(self, tool: str, cli_args: list[str] | None = None) -> bool:
        """
        Run a whitelisted LeRobot CLI utility inside the persistent terminal
        shell so interactive prompts (setup-motors, find-port) keep working.
        """
        module = self.LEROBOT_TOOLS.get(tool)
        if not module:
            event_bus.log_message.emit("ERROR", f"Unknown LeRobot tool: {tool}")
            return False

        parts = [f'"{self._python}"', "-m", module]
        for a in cli_args or []:
            # Basic shell-safety: quote args containing spaces
            parts.append(f'"{a}"' if " " in a and not a.startswith('"') else a)

        event_bus.log_message.emit("INFO", f"Spouštím LeRobot nástroj: {tool}")
        self.run_custom_command(" ".join(parts))
        return True

    # ── Training ─────────────────────────────────────────────────────────

    def start_training(
        self,
        policy_type: str,
        dataset_repo_id: str,
        skill_slug: str,
        output_dir: str = "",
        training_steps: int = 10_000,
        batch_size: int = 8,
        device: str = "cuda",
        use_wandb: bool = False,
        save_freq: int = 2_000,
        extra_args: dict[str, Any] | None = None,
        extra_args_str: str = "",
    ) -> None:
        """
        Start training a LeRobot policy via `lerobot-train`.

        Notes for LeRobot >= 0.4:
        - --policy.push_to_hub defaults to TRUE and then requires --policy.repo_id;
          we force it to false unless the user overrides it in extra args.
        - --output_dir must not already exist; if it does and contains a resumable
          checkpoint we resume from it, otherwise we pick a unique directory.
        """
        key = f"train_{skill_slug}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Training already active for {skill_slug}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not self._verify_dataset_exists(dataset_repo_id):
            msg = f"[VALIDATION ERROR] Cannot start training! Dataset '{dataset_repo_id}' was not found locally in cache. Record demonstrations first."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            event_bus.training_error.emit(skill_slug, msg)
            return

        # ── Resume / output-dir collision handling ──────────────────────────
        resume_config: Path | None = None
        if output_dir:
            out_path = Path(output_dir)
            if out_path.exists():
                candidate = out_path / "checkpoints" / "last" / "pretrained_model" / "train_config.json"
                if candidate.exists():
                    resume_config = candidate
                    event_bus.log_message.emit("INFO", f"Existing checkpoint found — resuming training from {candidate}")
                else:
                    base = output_dir
                    suffix = 2
                    while Path(f"{base}_v{suffix}").exists():
                        suffix += 1
                    output_dir = f"{base}_v{suffix}"
                    event_bus.log_message.emit("WARN", f"Output dir already exists — training into '{output_dir}' instead.")

        if resume_config is not None:
            cmd = [
                self._python, "-m", "lerobot.scripts.lerobot_train",
                f"--config_path={resume_config}",
                "--resume=true",
            ]
        else:
            cmd = [
                self._python, "-m", "lerobot.scripts.lerobot_train",
                f"--policy.type={policy_type}",
                f"--dataset.repo_id={dataset_repo_id}",
                f"--steps={training_steps}",
                f"--batch_size={batch_size}",
                f"--save_freq={save_freq}",
                f"--job_name={skill_slug}",
                f"--policy.device={device}",
                f"--wandb.enable={'true' if use_wandb else 'false'}",
            ]
            if output_dir:
                cmd.append(f"--output_dir={output_dir}")

            if extra_args:
                for k, v in extra_args.items():
                    cmd.append(f"--{k}={v}")

            if extra_args_str:
                try:
                    parsed_args = shlex.split(extra_args_str)
                    cmd.extend(parsed_args)
                except Exception as e:
                    log.error("Failed to parse extra train arguments: %s", e)

            # Mandatory unless the user pushes to hub themselves (then repo_id is required too)
            if not any(a.startswith("--policy.push_to_hub") for a in cmd):
                cmd.append("--policy.push_to_hub=false")

        event_bus.training_started.emit(skill_slug)
        event_bus.log_message.emit("INFO", f"Training started: {skill_slug} (policy={policy_type}, steps={training_steps})")

        self._spawn_process(key, cmd, kind="train", skill_slug=skill_slug)

    def stop_training(self, skill_slug: str) -> None:
        """Stop an active training session."""
        key = f"train_{skill_slug}"
        self._kill_process(key)

    # ── Inference ────────────────────────────────────────────────────────

    def start_inference(
        self,
        robot_type: str,
        policy_path: str,
        skill_slug: str,
        port: str = "",
        fps: int = 30,
        auto_task: str = "",
        extra_args: dict[str, Any] | None = None,
    ) -> None:
        """Start running a trained policy on the robot with checkpoint validations."""
        key = f"infer_{skill_slug}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Inference already active for {skill_slug}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not port:
            msg = "[VALIDATION ERROR] Follower serial port must be specified to run autonomous inference!"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not self._verify_policy_exists(policy_path):
            msg = f"[VALIDATION ERROR] Policy checkpoint not found at '{policy_path}'! Please train the policy first (Step 4)."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not self._guard_ports(port):
            return

        script_path = Path(__file__).parent / "orchiday_inference.py"

        project = self._current_project() or {}
        robots = project.get("robots", [])
        robot_cfg = robots[0] if robots else {}
        robot_id = robot_cfg.get("follower_id") or robot_cfg.get("id") or "my_follower_arm"

        cmd = [
            self._python, str(script_path),
            f"--robot.type={robot_type}",
            f"--robot.id={robot_id}",
            f"--policy.path={policy_path}",
            f"--fps={fps}",
        ]
        if port:
            cmd.append(f"--robot.port={port}")

        cameras_json = self._build_cameras_json(robot_cfg.get("cameras"))
        if cameras_json:
            cmd.append(f"--robot.cameras={cameras_json}")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        if auto_task:
            # The daemon boots in WAITING — queue the task to dispatch on DAEMON_READY
            self._pending_infer_tasks[key] = auto_task

        def launch():
            event_bus.log_message.emit("INFO", f"Inference started: {skill_slug}")
            self._infer_policy_paths[key] = policy_path
            self._spawn_process(key, cmd, kind="infer", skill_slug=skill_slug)

        self._run_preflight_check(port, robot_type, launch)

    def stop_inference(self, skill_slug: str) -> None:
        """Stop inference."""
        key = f"infer_{skill_slug}"
        self._kill_process(key)

    def send_inference_command(self, skill_slug: str, command: str) -> bool:
        """Send a string command to the running persistent inference stdin pipe.

        Safe to call from any thread — the actual write is marshalled onto the
        bridge's owning thread via a queued signal (QProcess is not thread-safe).
        """
        key = f"infer_{skill_slug}"
        process = self._active_processes.get(key)
        if process and process.state() == QProcess.ProcessState.Running:
            log.info("Sending inference command to %s: %s", key, command.strip())
            self._write_requested.emit(key, f"{command.strip()}\n")
            return True
        return False

    @Slot(str, str)
    def _write_process_impl(self, key: str, payload: str) -> None:
        """Perform the QProcess stdin write on the owning thread."""
        process = self._active_processes.get(key)
        if process and process.state() == QProcess.ProcessState.Running:
            process.write(payload.encode("utf-8"))

    # ── Daemon request/reply helpers (orchestration thread → daemon) ──────

    def _wait_daemon_reply(self, key: str, command: str, timeout_s: float):
        """Send a stdin command to a daemon and block until its tagged reply
        arrives (parsed in _parse_inference_line) or the timeout expires.

        Called from the orchestration worker thread — NEVER from the Qt thread,
        blocking there would deadlock the reply parsing.
        """
        import threading as _threading
        if key not in self._active_processes:
            return None
        event = _threading.Event()
        payload: list = []
        self._daemon_waiters[key] = (event, payload)
        skill_slug = key[len("infer_"):]
        if not self.send_inference_command(skill_slug, command):
            self._daemon_waiters.pop(key, None)
            return None
        if not event.wait(timeout_s):
            self._daemon_waiters.pop(key, None)
            log.warning("Daemon reply timeout for '%s' on %s", command, key)
            return None
        return payload[0] if payload else None

    def running_inference_key(self) -> str | None:
        """Return the key of the first running persistent inference daemon."""
        for key in self._active_processes:
            if key.startswith("infer_"):
                return key
        return None

    def daemon_policy_path(self, key: str) -> str:
        """Policy path currently loaded in the given daemon ('' if unknown)."""
        return self._infer_policy_paths.get(key, "")

    def swap_policy(self, key: str, policy_path: str, timeout_s: float = 180.0) -> bool:
        """Hot-swap the policy inside a running daemon (blocks until loaded)."""
        reply = self._wait_daemon_reply(key, f"SET_POLICY:{policy_path}", timeout_s)
        if isinstance(reply, str) and reply.startswith("POLICY_LOADED"):
            self._infer_policy_paths[key] = policy_path
            return True
        return False

    def request_snapshot(self, key: str, timeout_s: float = 5.0) -> str:
        """Ask a running daemon for a camera snapshot (base64 JPEG, '' on failure).

        During orchestration the daemon owns the cameras exclusively, so the
        VLM inspector must obtain scene images through this channel."""
        reply = self._wait_daemon_reply(key, "SNAP", timeout_s)
        if isinstance(reply, str) and reply.startswith("SNAPSHOT:"):
            return reply[len("SNAPSHOT:"):]
        return ""

    def _ensure_shell_active(self) -> None:
        """Ensure the persistent shell process is running."""
        if hasattr(self, "_shell_process") and self._shell_process is not None:
            if self._shell_process.state() == QProcess.ProcessState.Running:
                return

        log.info("Starting persistent terminal shell process...")
        self._shell_process = QProcess(self)
        self._shell_process.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)

        # Enforce HF_HOME to lock Hugging Face datasets/policies locally
        from orchiday.core.constants import APP_DATA_DIR
        hf_home = str(APP_DATA_DIR / "data" / "huggingface")
        project = self._current_project()
        if project and project.get("dataset_storage_dir"):
            hf_home = str(project["dataset_storage_dir"])

        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HF_HOME", hf_home)
        self._shell_process.setProcessEnvironment(env)

        # Wire up slots
        self._shell_process.readyReadStandardOutput.connect(self._handle_shell_ready_read)
        self._shell_process.finished.connect(self._handle_shell_finished)

        # Identify shell command based on platform
        import platform
        import os
        if platform.system() == "Windows":
            shell_cmd = "cmd.exe"
            shell_args = []
        else:
            shell_cmd = os.environ.get("SHELL", "/bin/bash")
            shell_args = ["-i"]  # Run interactive to load env profiles

        # Set working directory to project path or current working directory
        project = self._current_project()
        if project and project.get("path"):
            working_dir = project["path"]
        else:
            working_dir = os.getcwd()

        self._shell_process.setWorkingDirectory(working_dir)

        log.info("Spawning persistent shell: %s in directory %s", shell_cmd, working_dir)
        self._shell_process.start(shell_cmd, shell_args)

    def _handle_shell_ready_read(self) -> None:
        """Read stdout/stderr from the persistent shell and emit to console."""
        if not self._shell_process:
            return
        data = bytes(self._shell_process.readAllStandardOutput().data()).decode("utf-8", errors="replace")
        for line in data.splitlines():
            line = line.rstrip()
            if line:
                event_bus.console_output.emit(line)

    def _handle_shell_finished(self, exit_code: int, exit_status: QProcess.ExitStatus) -> None:
        """Handle shell process termination."""
        log.info("Persistent shell process exited with code %d", exit_code)
        self._shell_process = None

    def run_custom_command(self, cmd_string: str) -> None:
        """
        Execute any custom terminal command (e.g. replay, visualize_dataset) in the persistent shell.

        Args:
            cmd_string: Raw command string entered by the user.
        """
        cmd_string = cmd_string.strip()
        if not cmd_string:
            return

        self._ensure_shell_active()
        assert self._shell_process is not None

        # Echo prompt and command in UI console log
        event_bus.console_output.emit(f"$ {cmd_string}")

        # Send command to shell stdin
        import platform
        newline = "\r\n" if platform.system() == "Windows" else "\n"
        self._shell_process.write(f"{cmd_string}{newline}".encode("utf-8"))

    # ── QProcess Internal Management ─────────────────────────────────────

    def _spawn_process(
        self,
        key: str,
        cmd: list[str],
        kind: str = "",
        skill_slug: str = "",
    ) -> None:
        """Spawn a subprocess. Safe to call from any thread (queued to owner)."""
        self._spawn_requested.emit(key, cmd, kind, skill_slug)

    @Slot(str, list, str, str)
    def _spawn_process_impl(
        self,
        key: str,
        cmd: list[str],
        kind: str = "",
        skill_slug: str = "",
    ) -> None:
        """Spawn a subprocess via PySide6 QProcess on the event loop."""
        if key in self._active_processes:
            return

        process = QProcess(self)
        process.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)

        # Enforce HF_HOME to lock Hugging Face datasets/policies locally
        from orchiday.core.constants import APP_DATA_DIR
        hf_home = str(APP_DATA_DIR / "data" / "huggingface")

        project = self._current_project()
        if project and project.get("dataset_storage_dir"):
            hf_home = str(project["dataset_storage_dir"])

        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HF_HOME", hf_home)
        process.setProcessEnvironment(env)

        # Wire up slot callbacks
        process.readyReadStandardOutput.connect(lambda: self._handle_ready_read(key, process, kind, skill_slug))
        process.finished.connect(lambda exit_code, exit_status: self._handle_finished(key, exit_code, kind, skill_slug))

        log.debug("Spawning QProcess: %s", " ".join(cmd))
        event_bus.console_output.emit(f"$ {' '.join(cmd)}")

        # ── Resource arbiter: register serial ports + take exclusive cameras ──
        ports = self._extract_ports(cmd)
        if ports:
            self._process_ports[key] = ports
        if kind in ("record", "teleop", "infer"):
            self._suspend_preview_cameras(key, cmd)

        process.start(cmd[0], cmd[1:])
        self._active_processes[key] = process
        self._process_kinds[key] = kind
        event_bus.process_started.emit(key, kind)

        # Auto-confirm calibration/interactive dialogs on startup by seeding stdin with newline
        if kind in ("teleop", "calibrate", "record", "replay", "infer"):
            log.info("Sending auto-confirm newline to bypass interactive setup prompts for: %s", key)
            process.write(b"\n")

    def _handle_ready_read(self, key: str, process: QProcess, kind: str, skill_slug: str) -> None:
        """Read newly buffered stdout/stderr lines in real time and forward to event bus."""
        data = bytes(process.readAllStandardOutput().data()).decode("utf-8", errors="replace")
        for line in data.splitlines():
            line = line.rstrip()
            if not line:
                continue
            # Snapshot payloads are huge base64 blobs — keep them out of the console
            if not line.startswith("[SNAPSHOT]"):
                event_bus.console_output.emit(line)

            # Monitor hardware errors and warnings in real time
            self._monitor_hardware_errors(line, key)

            # Parse training progress
            if kind == "train":
                self._parse_training_line(line, skill_slug)

            # Parse recording progress
            elif kind == "record":
                self._parse_recording_line(line, skill_slug)

            # Parse teleoperation progress/telemetry
            elif kind == "teleop":
                self._parse_teleop_line(line)

            # Parse persistent inference daemon status
            elif kind == "infer":
                self._parse_inference_line(line, key, skill_slug)

    def _handle_finished(self, key: str, exit_code: int, kind: str, skill_slug: str) -> None:
        """Triggered asynchronously when a QProcess exits."""
        self._active_processes.pop(key, None)
        self._process_kinds.pop(key, None)
        self._release_process_resources(key)
        event_bus.process_finished.emit(key, kind)
        log.info("Process %s exited with code %d", key, exit_code)

        if kind == "train":
            if exit_code == 0:
                event_bus.training_finished.emit(skill_slug, "")
                event_bus.log_message.emit("SUCCESS", f"Training completed: {skill_slug}")
            else:
                event_bus.training_error.emit(skill_slug, f"Exit code {exit_code}")
                event_bus.log_message.emit("ERROR", f"Training failed: {skill_slug}")

        elif kind == "calibrate":
            if exit_code == 0:
                event_bus.robot_calibrated.emit(skill_slug)
                event_bus.log_message.emit("SUCCESS", f"Calibration completed: {skill_slug}")
            else:
                event_bus.log_message.emit("ERROR", f"Calibration failed for {skill_slug}")

        elif kind == "infer":
            event_bus.inference_finished.emit(skill_slug)
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Inference completed: {skill_slug}")
            else:
                event_bus.log_message.emit("WARN", f"Inference exited with code {exit_code}")

        elif kind == "replay":
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Replay completed successfully: {skill_slug}")
            else:
                event_bus.log_message.emit("ERROR", f"Replay failed or aborted with exit code {exit_code}")

        elif kind == "record":
            self._record_marks.pop(skill_slug, None)  # persisted sidecar remains on disk
            event_bus.recording_stopped.emit(skill_slug, 0)
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Recording completed: {skill_slug}")
            else:
                event_bus.log_message.emit("WARN", f"Recording process exited with code {exit_code}")

        elif kind == "dataset_edit":
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Dataset operation completed: {skill_slug}")
            else:
                event_bus.log_message.emit("ERROR", f"Dataset operation failed (exit {exit_code}): {skill_slug}")

        elif kind == "dataset_split":
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Step datasets created for '{skill_slug}' — sub-skills are ready for training.")
            else:
                event_bus.log_message.emit("ERROR", f"Dataset splitting failed (exit {exit_code}): {skill_slug}")

        elif kind == "eval":
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Simulation evaluation completed ({skill_slug}) — see console for metrics.")
            else:
                event_bus.log_message.emit("ERROR", f"Simulation evaluation failed (exit {exit_code})")

    def _parse_training_line(self, line: str, skill_slug: str) -> None:
        """
        Extract progress from `lerobot-train` output.

        LeRobot >= 0.4 logs lines like:
        "step:200 smpl:2K ep:8 epch:0.31 loss:2.674 grdn:18.114 lr:1.0e-05 ..."
        """
        loss_match = re.search(r"loss[:\s]+([0-9]+\.?[0-9]*(?:[eE][-+]?\d+)?)", line, re.IGNORECASE)
        if not loss_match:
            return
        step_match = re.search(r"\bstep[:\s]+([0-9][0-9_]*)(K?)", line, re.IGNORECASE)
        epoch_match = re.search(r"\bepoch[:\s]+(\d+)", line, re.IGNORECASE)

        loss = float(loss_match.group(1))
        if step_match:
            step = int(step_match.group(1).replace("_", ""))
            if step_match.group(2):  # "2K" style suffix
                step *= 1000
        elif epoch_match:
            step = int(epoch_match.group(1))
        else:
            step = 0
        event_bus.training_progress.emit(skill_slug, step, loss)

    def _parse_recording_line(self, line: str, skill_slug: str) -> None:
        """
        Extract recording progress from `lerobot-record` output.

        Matches both "Episode 3/50" style and LeRobot's
        "Recording episode 3" voice-log style.
        """
        ep_match = re.search(r"[Ee]pisode[:\s_]+(\d+)\s*/\s*(\d+)", line)
        if ep_match:
            current = int(ep_match.group(1))
            total = int(ep_match.group(2))
            progress = current / total if total > 0 else 0
            event_bus.recording_progress.emit(skill_slug, progress)
            self._track_episode_start(skill_slug, current)
            return

        rec_match = re.search(r"Recording episode\s+(\d+)", line)
        if rec_match:
            current = int(rec_match.group(1))
            total = self._record_totals.get(skill_slug, 0)
            progress = min(current / total, 1.0) if total > 0 else 0.0
            event_bus.recording_progress.emit(skill_slug, progress)
            self._track_episode_start(skill_slug, current)

    def _track_episode_start(self, skill_slug: str, episode_index: int) -> None:
        """Anchor the wall-clock start of an episode so step marks clicked in the
        UI can be converted to in-episode timestamps (matching the dataset's
        per-frame `timestamp` column, which starts at 0 each episode)."""
        import time
        state = self._record_marks.get(skill_slug)
        if state is None or state.get("current_episode") == episode_index:
            return
        state["current_episode"] = episode_index
        state["episode_started"] = time.monotonic()
        event_bus.recording_episode.emit(skill_slug, episode_index)

    def mark_step(self, skill_slug: str, step: int, label: str = "") -> dict:
        """Record a sub-task boundary flag during an active recording.

        The mark stores the elapsed time within the current episode; the dataset
        splitter later cuts the episode into per-step segments at these times.
        Returns a result dict {ok, episode, t, step, label} or {ok: False, error}.
        """
        import time
        key = f"record_{skill_slug}"
        state = self._record_marks.get(skill_slug)
        if key not in self._active_processes or state is None:
            return {"ok": False, "error": "no active recording for this skill"}
        episode = state.get("current_episode", -1)
        if episode < 0:
            return {"ok": False, "error": "no episode started yet"}

        t = round(time.monotonic() - state["episode_started"], 3)
        mark = {"t": t, "step": step, "label": label}
        state["episodes"].setdefault(str(episode), []).append(mark)
        self._persist_step_marks(skill_slug)

        payload = {"episode": episode, **mark}
        event_bus.step_marked.emit(skill_slug, payload)
        event_bus.log_message.emit("INFO", f"Step mark: '{label or step}' at {t:.2f}s of episode {episode} ({skill_slug})")
        return {"ok": True, **payload}

    def undo_step_mark(self, skill_slug: str) -> dict:
        """Remove the last step mark of the current episode (misclick recovery)."""
        state = self._record_marks.get(skill_slug)
        if state is None:
            return {"ok": False, "error": "no active recording for this skill"}
        episode = str(state.get("current_episode", -1))
        marks = state["episodes"].get(episode) or []
        if not marks:
            return {"ok": False, "error": "no marks in current episode"}
        removed = marks.pop()
        self._persist_step_marks(skill_slug)
        event_bus.step_marked.emit(skill_slug, {"episode": int(episode), "undone": True, **removed})
        return {"ok": True, "removed": removed}

    def _persist_step_marks(self, skill_slug: str) -> None:
        """Write the marks sidecar JSON next to the dataset directory."""
        state = self._record_marks.get(skill_slug)
        if state is None:
            return
        try:
            marks_path = Path(state["marks_path"])
            marks_path.parent.mkdir(parents=True, exist_ok=True)
            with open(marks_path, "w", encoding="utf-8") as f:
                json.dump({
                    "version": 1,
                    "dataset": state["dataset"],
                    "fps": state["fps"],
                    "episodes": state["episodes"],
                }, f, indent=2, ensure_ascii=False)
        except Exception as e:
            log.error("Failed to persist step marks: %s", e)

    def get_step_marks(self, skill_slug: str, dataset_name: str = "") -> dict:
        """Return step marks for a skill — live state when recording, otherwise
        the persisted sidecar file of the given/derived dataset."""
        state = self._record_marks.get(skill_slug)
        if state is not None:
            return {"dataset": state["dataset"], "episodes": state["episodes"], "live": True}
        if dataset_name:
            marks_path_dir = self._get_dataset_dir(dataset_name)
            marks_path = marks_path_dir.parent / f"{marks_path_dir.name}.step_marks.json"
            if marks_path.exists():
                try:
                    with open(marks_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    return {"dataset": dataset_name, "episodes": data.get("episodes", {}), "live": False}
                except Exception as e:
                    log.warning("Failed to read step marks file: %s", e)
        return {"dataset": dataset_name, "episodes": {}, "live": False}

    def _parse_inference_line(self, line: str, key: str, skill_slug: str) -> None:
        """
        React to the persistent inference daemon's [STATUS] protocol.

        - DAEMON_READY: dispatch a queued SET_TASK (orchestration auto-start).
        - TASK_DONE: the motor finished one skill — signal completion so the
          orchestrator's task latch unlocks WITHOUT killing the daemon.
        """
        if "[STATUS] DAEMON_READY" in line or "DEEMON_READY" in line:
            pending = self._pending_infer_tasks.pop(key, None)
            if pending:
                log.info("Daemon ready — dispatching queued task '%s'", pending)
                self.send_inference_command(skill_slug, f"SET_TASK:{pending}")
        elif "[STATUS] TASK_DONE" in line:
            event_bus.inference_finished.emit(skill_slug)
        elif line.startswith("[SNAPSHOT]"):
            self._resolve_daemon_waiter(key, "SNAPSHOT:" + line[len("[SNAPSHOT]"):].strip())
        elif "[STATUS] POLICY_LOADED" in line:
            self._resolve_daemon_waiter(key, "POLICY_LOADED")
        elif "[STATUS] POLICY_ERROR" in line:
            event_bus.log_message.emit("ERROR", f"Policy hot-swap failed in daemon: {line}")
            self._resolve_daemon_waiter(key, "POLICY_ERROR")

    def _resolve_daemon_waiter(self, key: str, payload: str) -> None:
        """Deliver a daemon reply to the thread blocked in _wait_daemon_reply."""
        waiter = self._daemon_waiters.pop(key, None)
        if waiter is not None:
            waiter[1].append(payload)
            waiter[0].set()

    # Threshold at which repeated bus packet-drop warnings escalate to an
    # actionable one-time suggestion (lower FPS / check power) instead of
    # repeating the same generic line for every dropped frame.
    _PACKET_DROP_ESCALATE_AT = 5

    def _monitor_hardware_errors(self, line: str, key: str) -> None:
        """Scan subprocess output for critical hardware errors or performance alerts."""
        if "Overload error!" in line:
            msg = "[KRITICKÉ PŘETÍŽENÍ SERVA] Vypni na 2 minuty napájení robota, aby serva vychladla."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            self.kill_all()
        elif "Incorrect status packet!" in line:
            msg = "[VAROVÁNÍ] Sběrnice ztrácí packety (přerušený drát/rušení)."
            log.warning(msg)
            event_bus.log_message.emit("WARN", msg)
            event_bus.console_output.emit(f"<span style='color:var(--warning); font-weight:bold;'>{msg}</span>")

            count = self._packet_drop_counts.get(key, 0) + 1
            self._packet_drop_counts[key] = count
            if count == self._PACKET_DROP_ESCALATE_AT:
                tip = ("[DOPORUČENÍ] Opakované ztráty packetů obvykle znamenají nedostatečné napájení "
                       "nebo příliš vysoké FPS. Zkuste: 1) snížit FPS na 30 (Teleoperace/Sběr dat), "
                       "2) použít silnější napájecí zdroj pro serva, 3) zkrátit/zkontrolovat kabeláž sběrnice.")
                log.warning(tip)
                event_bus.log_message.emit("WARN", tip)
                event_bus.console_output.emit(f"<span style='color:var(--warning); font-weight:bold;'>{tip}</span>")
        elif "running slower" in line:
            msg = "[VAROVÁNÍ] Počítač nestíhá (přetížené GPU/CPU)."
            log.warning(msg)
            event_bus.log_message.emit("WARN", msg)
            event_bus.console_output.emit(f"<span style='color:var(--warning);'>{msg}</span>")
        elif ("Homing_Offset" in line and ("exceeds" in line or "Magnitude" in line)) or \
                ("Magnitude" in line and "exceeds" in line):
            msg = ("[KALIBRACE SELHALA] Kloub je mechanicky přetočený mimo referenční bod 0/4095 "
                   "(homing offset mimo rozsah ±2047). Postup: 1) ručně srovnejte postižený kloub "
                   "(často wrist_roll) do neutrální polohy, 2) v Hardware → Kalibrace smažte starý "
                   "kalibrační soubor tohoto ramene, 3) spusťte kalibraci znovu.")
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")

    # Canonical base->gripper kinematic chain order for SO-100/SO-101/Koch arms —
    # matches LeRobot's own robot.get_observation() ordering and the joint keys
    # used in calibration JSON files.
    CANONICAL_JOINT_ORDER = (
        "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper",
    )

    def _joint_sort_key(self, name: str) -> tuple:
        """Rank a joint/motor name by its position in CANONICAL_JOINT_ORDER;
        unrecognized names (other robot types) fall back to alphabetical,
        matching the previous behavior exactly."""
        lname = name.lower()
        for idx, canon in enumerate(self.CANONICAL_JOINT_ORDER):
            if canon in lname:
                return (0, idx, lname)
        return (1, 0, lname)

    def _parse_teleop_line(self, line: str) -> None:
        """Extract joints state from teleop output name | value and format as [TELEMETRY] log."""
        # Clean any terminal escape characters/ANSI sequences if present
        clean_line = re.sub(r'\x1B[@-_][0-?]*[ -/]*[@-~]', '', line).strip()
        
        # Match a joint line like "joint_1 |  0.05" or "main_joint_1_shoulder_pan |  0.05"
        match = re.match(r"^([a-zA-Z0-9_\-\.]+)\s*\|\s*([\d\.\-\+eE]+)$", clean_line)
        if match:
            name, val_str = match.groups()
            name = name.strip()
            if name != "NAME":
                try:
                    self._teleop_state[name] = float(val_str)
                except ValueError:
                    pass
        elif "Teleop loop time:" in clean_line:
            if self._teleop_state:
                # Sort by the arm's physical kinematic chain (base -> gripper) so
                # the J1..J6 slots line up with shoulder_pan..gripper the same way
                # the inference daemon's robot.get_observation() already orders
                # them — a plain alphabetical sort would scramble that order
                # (e.g. "elbow_flex" < "gripper" < "shoulder_lift" alphabetically).
                sorted_keys = sorted(self._teleop_state.keys(), key=self._joint_sort_key)
                joint_vals = [self._teleop_state[k] for k in sorted_keys]
                
                # Format to match what the frontend parses:
                # [TELEMETRY] joints:val,val,... | target:val,val,... | load:0.0 | settle:0/5 | max_delta:0.0
                tele_str = (
                    f"[TELEMETRY] joints:{','.join(f'{x:.4f}' for x in joint_vals)} | "
                    f"target:{','.join(f'{x:.4f}' for x in joint_vals)} | "
                    f"load:0.0 | "
                    f"settle:0/5 | "
                    f"max_delta:0.0"
                )
                event_bus.console_output.emit(tele_str)

    def _release_process_resources(self, key: str) -> None:
        """Release serial ports, restore preview cameras, and drop daemon state
        associated with a finished/killed process."""
        self._process_ports.pop(key, None)
        self._infer_policy_paths.pop(key, None)
        self._packet_drop_counts.pop(key, None)
        waiter = self._daemon_waiters.pop(key, None)
        if waiter is not None:
            # Unblock anyone waiting for a daemon reply that will never come
            waiter[1].append(None)
            waiter[0].set()
        self._resume_preview_cameras(key)

    def _kill_process(self, key: str) -> None:
        """Forcibly terminate a running subprocess (Emergency Stop)."""
        if key not in self._active_processes:
            return
        process = self._active_processes[key]
        log.warning("Emergency Stop: Terminating LeRobot process: %s", key)
        process.kill()
        process.waitForFinished(3000)
        self._active_processes.pop(key, None)
        self._release_process_resources(key)
        # _handle_finished normally emits process_finished; cover the timeout path too
        if key in self._process_kinds:
            event_bus.process_finished.emit(key, self._process_kinds.pop(key))
        event_bus.log_message.emit("WARN", f"Process {key} terminated by Emergency Stop!")

    def kill_all(self) -> None:
        """Kill all active processes and the persistent shell."""
        for key in list(self._active_processes.keys()):
            self._kill_process(key)
        if hasattr(self, "_shell_process") and self._shell_process is not None:
            log.warning("Emergency Stop: Terminating persistent shell process.")
            self._shell_process.kill()
            self._shell_process.waitForFinished(1000)
            self._shell_process = None
