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
from typing import Any

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, Slot

from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class LeRobotBridge(QObject):
    """
    Manages LeRobot CLI subprocesses using PySide6's QProcess.

    All commands are spawned asynchronously on the Qt event loop,
    ensuring thread-safety, real-time output parsing, and reliable emergency stopping.
    """

    def __init__(self, python_executable: str | None = None, parent=None):
        super().__init__(parent)
        # Auto-detect LeRobot venv python if not explicitly provided
        venv_python = Path("/home/verlyba/robotics/lerobot/.venv/bin/python")
        if not python_executable and venv_python.exists():
            self._default_python = str(venv_python)
            log.info("LeRobotBridge: Auto-detected LeRobot virtualenv Python at %s", self._default_python)
        else:
            self._default_python = python_executable or sys.executable
        self._active_processes: dict[str, QProcess] = {}
        self._teleop_state: dict[str, float] = {}
        self._shell_process: QProcess | None = None

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
                venv_python = Path(p_dir) / ".venv" / "bin" / "python"
                if venv_python.exists():
                    return str(venv_python)
                if (Path(p_dir) / "bin" / "python").exists():
                    return str(Path(p_dir) / "bin" / "python")
        except Exception:
            pass
        return self._default_python

    @property
    def active_processes(self) -> dict[str, QProcess]:
        return dict(self._active_processes)

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
                 "from lerobot.common.robots.utils import make_robot_from_config; "
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

    def _verify_dataset_exists(self, dataset_name: str) -> bool:
        """Check if dataset exists locally in local caches or is absolute."""
        if not dataset_name:
            return False
        if Path(dataset_name).exists():
            return True

        custom_dir = None
        parent_slug = ""
        try:
            from orchiday.server import pm
            if pm and pm.current_project:
                custom_dir = pm.current_project.get("dataset_storage_dir")
                skills_details = pm.current_project.get("skills_details", {})
                parts = dataset_name.split("/")
                last_part = parts[-1]
                if last_part in skills_details:
                    parent_slug = skills_details[last_part].get("parent_slug", "")
                else:
                    for robot in pm.current_project.get("robots", []):
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
        try:
            from orchiday.server import pm
            if pm and pm.current_project:
                custom_dir = pm.current_project.get("dataset_storage_dir")
        except Exception:
            pass

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

        event_bus.log_message.emit("INFO", f"Starting teleoperation: {robot_type} <-> {teleop_type}")
        self._spawn_process(key, cmd, kind="teleop", skill_slug="teleop")

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

        LeRobot calibrate operates on the teleoperator (leader) device.
        Provide teleop_type/teleop_port for leader calibration,
        and robot_type/port for follower calibration.
        At least one (teleop or robot) port must be specified.
        """
        key = f"calibrate_{robot_id}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Calibration already running for {robot_id}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not teleop_port and not port:
            msg = f"[VALIDATION ERROR] Calibration requires at least one port (teleop leader or robot follower)! Configure one for '{robot_id}'."
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_calibrate",
        ]

        # Teleop (leader/teacher) args — primary calibration target
        if teleop_type:
            cmd.append(f"--teleop.type={teleop_type}")
        if teleop_port:
            cmd.append(f"--teleop.port={teleop_port}")

        # Robot (follower) args — optional second calibration target
        if robot_type:
            cmd.append(f"--robot.type={robot_type}")
        if port:
            cmd.append(f"--robot.port={port}")

        if extra_args:
            for k, v in extra_args.items():
                cmd.append(f"--{k}={v}")

        event_bus.robot_calibrating.emit(robot_id)
        event_bus.log_message.emit("INFO", f"Starting calibration: teleop={teleop_type or 'n/a'} robot={robot_type or 'n/a'} ({robot_id})")

        self._spawn_process(key, cmd, kind="calibrate", skill_slug=robot_id)

    # ── Data recording ───────────────────────────────────────────────────

    def start_recording(
        self,
        robot_type: str,
        dataset_name: str,
        skill_slug: str,
        num_episodes: int = 50,
        fps: int = 30,
        port: str = "",
        resume: bool = False,
        extra_args: dict[str, Any] | None = None,
        extra_args_str: str = "",
    ) -> None:
        """Start recording episodes using LeRobot's teleoperation with validation."""
        key = f"record_{skill_slug}"
        if key in self._active_processes:
            event_bus.log_message.emit("WARN", f"Recording already active for {skill_slug}")
            return

        # ── Precondition Validations ─────────────────────────────────────────
        if not port:
            msg = "[VALIDATION ERROR] Follower serial port must be specified to start recording demonstrations!"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        if not dataset_name:
            msg = "[VALIDATION ERROR] Dataset repository name cannot be empty!"
            log.error(msg)
            event_bus.log_message.emit("ERROR", msg)
            event_bus.console_output.emit(f"<span style='color:var(--error); font-weight:bold;'>{msg}</span>")
            return

        # Enforce local repository name and no HF hub pushing
        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_record",
            f"--robot.type={robot_type}",
            f"--dataset.fps={fps}",
            f"--dataset.num_episodes={num_episodes}",
            f"--dataset.repo_id={dataset_name}",
            "--dataset.push_to_hub=false",
        ]
        if port:
            cmd.append(f"--robot.port={port}")

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

        event_bus.recording_started.emit(skill_slug)
        event_bus.log_message.emit("INFO", f"Recording started: {skill_slug} ({num_episodes} episodes, resume={resume})")

        self._spawn_process(key, cmd, kind="record", skill_slug=skill_slug)

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

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_replay",
            f"--robot.type={robot_type}",
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

    # ── Training ─────────────────────────────────────────────────────────

    def start_training(
        self,
        policy_type: str,
        dataset_repo_id: str,
        skill_slug: str,
        output_dir: str = "",
        num_epochs: int = 100,
        batch_size: int = 32,
        device: str = "cuda",
        use_wandb: bool = False,
        extra_args: dict[str, Any] | None = None,
        extra_args_str: str = "",
    ) -> None:
        """Start training a LeRobot policy with validation of dataset presence."""
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

        cmd = [
            self._python, "-m", "lerobot.scripts.lerobot_train",
            f"--policy.type={policy_type}",
            f"--dataset.repo_id={dataset_repo_id}",
            f"--steps={num_epochs * 100}",
            f"--batch_size={batch_size}",
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

        event_bus.training_started.emit(skill_slug)
        event_bus.log_message.emit("INFO", f"Training started: {skill_slug} (policy={policy_type})")

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

        from pathlib import Path
        script_path = Path(__file__).parent / "orchiday_inference.py"

        cmd = [
            self._python, str(script_path),
            f"--robot.type={robot_type}",
            f"--policy.path={policy_path}",
            f"--fps={fps}",
        ]
        if port:
            cmd.append(f"--robot.port={port}")

        event_bus.log_message.emit("INFO", f"Inference started: {skill_slug}")
        self._spawn_process(key, cmd, kind="infer", skill_slug=skill_slug)

    def stop_inference(self, skill_slug: str) -> None:
        """Stop inference."""
        key = f"infer_{skill_slug}"
        self._kill_process(key)

    def send_inference_command(self, skill_slug: str, command: str) -> bool:
        """Send a string command to the running persistent inference stdin pipe."""
        key = f"infer_{skill_slug}"
        process = self._active_processes.get(key)
        if process and process.state() == QProcess.ProcessState.Running:
            log.info("Sending inference command to %s: %s", key, command.strip())
            process.write(f"{command.strip()}\n".encode("utf-8"))
            return True
        return False

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
        try:
            from orchiday.server import pm
            if pm and pm.current_project:
                custom_dir = pm.current_project.get("dataset_storage_dir")
                if custom_dir:
                    hf_home = str(custom_dir)
        except Exception:
            pass

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
        try:
            from orchiday.server import pm
            if pm and pm.current_project and pm.current_project.get("path"):
                working_dir = pm.current_project["path"]
            else:
                working_dir = os.getcwd()
        except Exception:
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
        """Spawn a subprocess via PySide6 QProcess on the event loop."""
        if key in self._active_processes:
            return

        process = QProcess(self)
        process.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)

        # Enforce HF_HOME to lock Hugging Face datasets/policies locally
        from orchiday.core.constants import APP_DATA_DIR
        hf_home = str(APP_DATA_DIR / "data" / "huggingface")
        
        try:
            from orchiday.server import pm
            if pm and pm.current_project:
                custom_dir = pm.current_project.get("dataset_storage_dir")
                if custom_dir:
                    hf_home = str(custom_dir)
        except Exception:
            pass

        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HF_HOME", hf_home)
        process.setProcessEnvironment(env)

        # Wire up slot callbacks
        process.readyReadStandardOutput.connect(lambda: self._handle_ready_read(key, process, kind, skill_slug))
        process.finished.connect(lambda exit_code, exit_status: self._handle_finished(key, exit_code, kind, skill_slug))

        log.debug("Spawning QProcess: %s", " ".join(cmd))
        event_bus.console_output.emit(f"$ {' '.join(cmd)}")

        process.start(cmd[0], cmd[1:])
        self._active_processes[key] = process

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
            event_bus.console_output.emit(line)

            # Parse training progress
            if kind == "train":
                self._parse_training_line(line, skill_slug)

            # Parse recording progress
            elif kind == "record":
                self._parse_recording_line(line, skill_slug)

            # Parse teleoperation progress/telemetry
            elif kind == "teleop":
                self._parse_teleop_line(line)

    def _handle_finished(self, key: str, exit_code: int, kind: str, skill_slug: str) -> None:
        """Triggered asynchronously when a QProcess exits."""
        self._active_processes.pop(key, None)
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
            event_bus.recording_stopped.emit(skill_slug, 0)
            if exit_code == 0:
                event_bus.log_message.emit("SUCCESS", f"Recording completed: {skill_slug}")
            else:
                event_bus.log_message.emit("WARN", f"Recording process exited with code {exit_code}")

    def _parse_training_line(self, line: str, skill_slug: str) -> None:
        """Extract epoch and loss from training output."""
        loss_match = re.search(r"loss[:\s]+([0-9]+\.?[0-9]*)", line, re.IGNORECASE)
        epoch_match = re.search(r"epoch[:\s]+(\d+)", line, re.IGNORECASE)
        if loss_match:
            loss = float(loss_match.group(1))
            epoch = int(epoch_match.group(1)) if epoch_match else 0
            event_bus.training_progress.emit(skill_slug, epoch, loss)

    def _parse_recording_line(self, line: str, skill_slug: str) -> None:
        """Extract recording progress from output."""
        ep_match = re.search(r"[Ee]pisode[:\s_]+(\d+)\s*/\s*(\d+)", line)
        if ep_match:
            current = int(ep_match.group(1))
            total = int(ep_match.group(2))
            progress = current / total if total > 0 else 0
            event_bus.recording_progress.emit(skill_slug, progress)

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
                # Sort keys alphabetically to keep mapping consistent
                sorted_keys = sorted(self._teleop_state.keys())
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

    def _kill_process(self, key: str) -> None:
        """Forcibly terminate a running subprocess (Emergency Stop)."""
        if key not in self._active_processes:
            return
        process = self._active_processes[key]
        log.warning("Emergency Stop: Terminating LeRobot process: %s", key)
        process.kill()
        process.waitForFinished(3000)
        self._active_processes.pop(key, None)
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
