"""
Orchiday Controller — the central controller connecting Project, Cameras, LeRobot, and AI.

Manages coordination between Qt event loop and the background asyncio orchestration.
"""

import threading
import logging
import asyncio
from pathlib import Path
from PySide6.QtCore import QObject, Slot

from orchiday.core.events import event_bus
from orchiday.core.project_manager import ProjectManager
from orchiday.hardware.camera_worker import CameraManager
from orchiday.ai.lm_studio_client import LMStudioClient
from orchiday.ai.llm_planner import LLMPlanner
from orchiday.ai.vlm_inspector import VLMInspector
from orchiday.ai.lerobot_bridge import LeRobotBridge
from orchiday.orchestration.orchestrator import Orchestrator, OrchestratorState

log = logging.getLogger(__name__)


class OrchestrationThread(threading.Thread):
    """Thread for running the async orchestrator loop without freezing Qt UI."""

    def __init__(self, orchestrator: Orchestrator, user_instruction: str):
        super().__init__()
        self._orchestrator = orchestrator
        self._user_instruction = user_instruction
        self.daemon = True

    def run(self):
        log.info("Starting orchestration thread for instruction: '%s'", self._user_instruction)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Register the running loop to the orchestrator and its TaskLatch
        self._orchestrator.latch._loop = loop

        try:
            loop.run_until_complete(self._orchestrator.run(self._user_instruction))
        except Exception as e:
            log.exception("Orchestration loop error: %s", e)
        finally:
            loop.close()
            log.info("Orchestration thread completed")


class OrchidayController(QObject):
    """
    Central logic controller for Orchiday.

    Wires up the hardware, camera, LeRobot subprocess, and AI orchestration.
    """

    def __init__(self, project_manager: ProjectManager, parent=None):
        super().__init__(parent)
        self.pm = project_manager

        # Initialize localized HF and LeRobot data directories
        from orchiday.core.constants import APP_DATA_DIR
        data_dir = APP_DATA_DIR / "data"
        (data_dir / "datasets" / "local").mkdir(parents=True, exist_ok=True)
        (data_dir / "outputs" / "training").mkdir(parents=True, exist_ok=True)
        (data_dir / "huggingface").mkdir(parents=True, exist_ok=True)
        self._data_dir = data_dir
        log.info("Localized data directories successfully initialized at %s", data_dir)

        # Managers & Bridges
        self.camera_manager = CameraManager()
        self.lerobot_bridge = LeRobotBridge(project_manager=project_manager)
        from orchiday.core.calibration_manager import CalibrationManager
        self.calibration_manager = CalibrationManager(self.pm)

        # AI clients & models (lazy-initialized when project opens)
        self.lm_client = None
        self.llm_client: LMStudioClient | None = None
        self.vlm_client: LMStudioClient | None = None
        self.planner: LLMPlanner | None = None
        self.inspector: VLMInspector | None = None
        self.orchestrator: Orchestrator | None = None

        # Training queues
        self._training_queue = []
        self._current_training_skill = None

        self._connect_events()

    def _connect_events(self) -> None:
        event_bus.project_opened.connect(self._on_project_opened)
        event_bus.project_closed.connect(self._on_project_closed)
        event_bus.camera_started.connect(self._on_camera_started)
        event_bus.camera_stopped.connect(self._on_camera_stopped)
        event_bus.inference_finished.connect(self._on_inference_finished)
        event_bus.orchestration_requested.connect(self.execute_command)
        
        # Connect terminal and training/recording pipeline events
        event_bus.terminal_command_requested.connect(self._on_terminal_command_requested)
        event_bus.recording_requested.connect(self._on_recording_requested)
        event_bus.recording_stop_requested.connect(self._on_recording_stop_requested)
        event_bus.training_started.connect(self._on_training_started)
        event_bus.training_stopped.connect(self._on_training_stopped)
        event_bus.training_finished.connect(self._on_training_finished)
        event_bus.training_error.connect(self._on_training_error)
        event_bus.replay_requested.connect(self._on_replay_requested)
        event_bus.model_configured.connect(self._on_model_configured)
        event_bus.robot_calibrated.connect(self._on_robot_calibrated)

    @Slot(dict)
    def _on_project_opened(self, project_data: dict) -> None:
        log.info("Controller: configuring AI models for project '%s'", project_data.get("name"))

        # Deploy project calibration files to LeRobot cache
        try:
            self.calibration_manager.deploy_active_bindings()
        except Exception as e:
            log.warning("Failed to deploy project calibration bindings: %s", e)

        # Auto-detect and pair hardware devices on project load
        try:
            from orchiday.hardware.detection import detect_serial_ports, detect_cameras
            scanned_ports = detect_serial_ports()
            scanned_cameras = detect_cameras()
            changed = False

            # Pair robots
            for robot in project_data.get("robots", []):
                # 1. Pair leader if leader_device_id exists
                leader_dev_id = robot.get("leader_device_id")
                if leader_dev_id:
                    matching = [p for p in scanned_ports if p["persistent_id"] == leader_dev_id]
                    if matching:
                        matched_port = matching[0]["device"]
                        if robot.get("leader_port") != matched_port:
                            robot["leader_port"] = matched_port
                            changed = True
                            event_bus.log_message.emit("SUCCESS", f"Auto-detected leader arm '{robot['id']}' at port {matched_port}")

                # 2. Pair follower if follower_device_id exists (or device_id for backward compatibility)
                follower_dev_id = robot.get("follower_device_id") or robot.get("device_id")
                if follower_dev_id:
                    matching = [p for p in scanned_ports if p["persistent_id"] == follower_dev_id]
                    if matching:
                        matched_port = matching[0]["device"]
                        if robot.get("follower_port") != matched_port:
                            robot["follower_port"] = matched_port
                            robot["port"] = matched_port  # Keep port in sync for backward compatibility
                            changed = True
                            event_bus.log_message.emit("SUCCESS", f"Auto-detected follower arm '{robot['id']}' at port {matched_port}")

            # Pair cameras
            for camera in project_data.get("cameras", []):
                dev_id = camera.get("device_id")
                if dev_id:
                    matching = [c for c in scanned_cameras if c["persistent_id"] == dev_id]
                    if matching:
                        matched_source = matching[0]["index"]
                        if camera.get("source") != matched_source and str(camera.get("source")) != str(matched_source):
                            camera["source"] = matched_source
                            changed = True
                            event_bus.log_message.emit("SUCCESS", f"Auto-detected camera '{camera['id']}' at index {matched_source}")

            if changed:
                self.pm.save_project()
        except Exception as e:
            log.warning("Auto-pairing failed on project load: %s", e)

        # 1. Setup Decoupled LM Studio Clients
        models_cfg = project_data.get("models", {})
        llm_cfg = models_cfg.get("llm_ceo", {})
        vlm_cfg = models_cfg.get("vlm_inspector", {})

        llm_endpoint = llm_cfg.get("endpoint") or "http://localhost:1234/v1"
        vlm_endpoint = vlm_cfg.get("endpoint") or "http://localhost:1234/v1"

        self.llm_client = LMStudioClient(base_url=llm_endpoint)
        self.vlm_client = LMStudioClient(base_url=vlm_endpoint)

        # 2. Setup LLM Planner
        llm_model = llm_cfg.get("model_name") or "local-llm"
        system_prompt = llm_cfg.get("system_prompt")
        skills = project_data.get("skills", [])
        skills_details = project_data.get("skills_details", {})

        if system_prompt:
            self.planner = LLMPlanner(
                self.llm_client,
                model_name=llm_model,
                system_prompt=system_prompt,
                available_skills=skills,
                skills_details=skills_details,
            )
        else:
            self.planner = LLMPlanner(
                self.llm_client,
                model_name=llm_model,
                available_skills=skills,
                skills_details=skills_details,
            )

        # 3. Setup VLM Inspector
        vlm_model = vlm_cfg.get("model_name") or "local-vlm"
        self.inspector = VLMInspector(self.vlm_client, model_name=vlm_model, skills_details=skills_details)

        # 4. Setup Orchestrator
        orch_cfg = project_data.get("orchestration", {})
        strategy = orch_cfg.get("latch_strategy") or "action_chunk"
        timeout_s = orch_cfg.get("default_timeout_s") or 10.0

        self.orchestrator = Orchestrator(
            self.planner,
            self.inspector,
            latch_strategy=strategy,
            timeout_s=timeout_s,
        )

        # Connect callbacks
        self.orchestrator.set_execute_callback(self._execute_motor_task)
        self.orchestrator.set_capture_callback(self._capture_scene_snapshot)

        # Test connection in background thread
        threading.Thread(target=self._test_lm_connection, daemon=True).start()

        # Auto-detect existing trained models metadata on load
        try:
            skills = project_data.get("skills", [])
            for skill_slug in skills:
                parent_slug = ""
                skills_details = project_data.get("skills_details", {})
                if skill_slug in skills_details:
                    parent_slug = skills_details[skill_slug].get("parent_slug", "")
                
                policy_type = project_data.get("policy_architecture", "diffusion")
                policy_slug = f"{parent_slug}_{skill_slug}" if parent_slug else skill_slug
                
                custom_dir = project_data.get("dataset_storage_dir")
                base_output = Path(custom_dir) if custom_dir else self._data_dir
                output_dir = base_output / "outputs" / "training" / f"{policy_slug}_{policy_type}"
                
                if output_dir.exists() and "model_metadata" not in skills_details.get(skill_slug, {}):
                    self._save_model_metadata(skill_slug, save_project=False)
            self.pm.save_project()
        except Exception as e:
            log.warning("Failed to auto-detect trained models metadata: %s", e)

    def _test_lm_connection(self) -> None:
        """Asynchronously test connection to both LLM and VLM endpoints and report to UI."""
        loop = asyncio.new_event_loop()
        try:
            # ── Test LLM connection ──────────────────────────────────────────
            if self.llm_client:
                ok_llm, msg_llm = loop.run_until_complete(self.llm_client.test_connection())
                if ok_llm:
                    event_bus.model_connection_ok.emit("llm_ceo")
                    event_bus.log_message.emit("SUCCESS", f"Connected LLM CEO to server at {self.llm_client.base_url}")
                else:
                    event_bus.model_connection_fail.emit("llm_ceo", msg_llm)
                    event_bus.log_message.emit("ERROR", f"LLM CEO server connection failed ({self.llm_client.base_url}): {msg_llm}")
            
            # ── Test VLM connection ──────────────────────────────────────────
            if self.vlm_client:
                ok_vlm, msg_vlm = loop.run_until_complete(self.vlm_client.test_connection())
                if ok_vlm:
                    event_bus.model_connection_ok.emit("vlm_inspector")
                    event_bus.log_message.emit("SUCCESS", f"Connected VLM Inspector to server at {self.vlm_client.base_url}")
                else:
                    event_bus.model_connection_fail.emit("vlm_inspector", msg_vlm)
                    event_bus.log_message.emit("ERROR", f"VLM Inspector server connection failed ({self.vlm_client.base_url}): {msg_vlm}")
        except Exception as e:
            event_bus.model_connection_fail.emit("llm_ceo", str(e))
            event_bus.model_connection_fail.emit("vlm_inspector", str(e))
            event_bus.log_message.emit("ERROR", f"Model server connection test encountered error: {e}")
        finally:
            loop.close()

    @Slot()
    def _on_project_closed(self) -> None:
        log.info("Controller: closing cameras and stopping LeRobot processes...")
        self.camera_manager.stop_all()
        self.lerobot_bridge.kill_all()
        self.llm_client = None
        self.vlm_client = None
        self.planner = None
        self.inspector = None
        self.orchestrator = None

    @Slot(str, dict)
    def _on_model_configured(self, model_role: str, config: dict) -> None:
        """Dynamically update model configurations in running planners and inspectors."""
        log.info("Controller: model configuration updated for %s", model_role)
        if not self.pm.current_project:
            return

        import threading

        if model_role == "llm_ceo":
            endpoint = config.get("endpoint") or "http://localhost:1234/v1"
            llm_model = config.get("model_name") or "local-llm"
            system_prompt = config.get("system_prompt")

            # Re-create client if endpoint changed
            if not getattr(self, "llm_client", None) or self.llm_client.base_url != endpoint:
                self.llm_client = LMStudioClient(base_url=endpoint)

            if getattr(self, "planner", None):
                self.planner._client = self.llm_client
                self.planner.model_name = llm_model
                if system_prompt:
                    self.planner._system_prompt = system_prompt
            else:
                skills = self.pm.current_project.get("skills", []) if self.pm.current_project else []
                if system_prompt:
                    self.planner = LLMPlanner(
                        self.llm_client,
                        model_name=llm_model,
                        system_prompt=system_prompt,
                        available_skills=skills,
                    )
                else:
                    self.planner = LLMPlanner(
                        self.llm_client,
                        model_name=llm_model,
                        available_skills=skills,
                    )
            if getattr(self, "orchestrator", None):
                self.orchestrator._planner = self.planner

        elif model_role == "vlm_inspector":
            endpoint = config.get("endpoint") or "http://localhost:1234/v1"
            vlm_model = config.get("model_name") or "local-vlm"

            if not getattr(self, "vlm_client", None) or self.vlm_client.base_url != endpoint:
                self.vlm_client = LMStudioClient(base_url=endpoint)

            if getattr(self, "inspector", None):
                self.inspector._client = self.vlm_client
                self.inspector._model = vlm_model
            else:
                self.inspector = VLMInspector(self.vlm_client, model_name=vlm_model)

            if getattr(self, "orchestrator", None):
                self.orchestrator._inspector = self.inspector

        # Re-test connection in background
        threading.Thread(target=self._test_lm_connection, daemon=True).start()

    @Slot(str)
    def _on_camera_started(self, camera_id: str) -> None:
        """Start OpenCV camera worker using the configuration from the project."""
        if not self.pm.current_project:
            return

        cameras = self.pm.current_project.get("cameras", [])
        cam_cfg = None
        for cam in cameras:
            if cam.get("id") == camera_id:
                cam_cfg = cam
                break

        if not cam_cfg:
            msg = f"Camera config not found for '{camera_id}'"
            log.warning(msg)
            event_bus.log_message.emit("WARN", msg)
            return

        source = cam_cfg.get("source", 0)
        res = cam_cfg.get("resolution", [640, 480])
        fps = cam_cfg.get("fps", 30)

        log.info("Starting camera worker: %s (source=%s)", camera_id, source)
        try:
            self.camera_manager.start_camera(
                camera_id=camera_id,
                source=source,
                width=res[0],
                height=res[1],
                fps=fps,
            )
            event_bus.log_message.emit("SUCCESS", f"Camera '{camera_id}' started")
        except Exception as e:
            log.error("Failed to start camera: %s", e)
            event_bus.log_message.emit("ERROR", f"Failed to start camera '{camera_id}': {e}")

    @Slot(str)
    def _on_camera_stopped(self, camera_id: str) -> None:
        log.info("Stopping camera worker: %s", camera_id)
        self.camera_manager.stop_camera(camera_id)
        event_bus.log_message.emit("INFO", f"Camera '{camera_id}' stopped")

    @Slot(str)
    def _on_inference_finished(self, skill_slug: str) -> None:
        """Triggered when LeRobot inference subprocess completes."""
        log.info("Inference completed for skill '%s'", skill_slug)
        if self.orchestrator and self.orchestrator.latch.is_locked:
            log.info("Unlocking task latch")
            self.orchestrator.latch.unlock()

    # ── Terminal Command Slot ────────────────────────────────────────────────

    @Slot(str)
    def _on_terminal_command_requested(self, cmd_string: str) -> None:
        """Triggered when the user runs a custom command in the terminal line. Handles macros/aliases."""
        cmd_string = cmd_string.strip()
        if not cmd_string:
            return

        if cmd_string.startswith("/"):
            self._handle_terminal_alias(cmd_string)
        else:
            self.lerobot_bridge.run_custom_command(cmd_string)

    def _handle_terminal_alias(self, alias_cmd: str) -> None:
        """Parse and execute built-in micro macros and aliases starting with /"""
        parts = alias_cmd.split()
        cmd = parts[0].lower()

        if cmd == "/help":
            help_text = (
                "<br/>"
                "<span style='color:#39ff14;font-weight:bold;font-family:monospace;'>Available Macro Commands (Aliases):</span><br/>"
                "<span style='color:#ACCENT_PRIMARY;font-family:monospace;'>  /vis</span> — Visualize dataset of the active robot and skill<br/>"
                "<span style='color:#ACCENT_PRIMARY;font-family:monospace;'>  /record</span> — Start demonstration recording for active robot and skill<br/>"
                "<span style='color:#ACCENT_PRIMARY;font-family:monospace;'>  /train</span> — Start policy training for active skill<br/>"
                "<span style='color:#ACCENT_PRIMARY;font-family:monospace;'>  /stop</span> — Okamžitě ukončí všechny běžící procesy (Emergency STOP)<br/>"
                "<span style='color:#ACCENT_PRIMARY;font-family:monospace;'>  /help</span> — Show this help message<br/>"
            )
            event_bus.console_output.emit(help_text)
            return

        if not self.pm.current_project:
            event_bus.log_message.emit("ERROR", "No project open. Cannot run macro.")
            return

        robots = self.pm.current_project.get("robots", [])
        active_robot = robots[0] if robots else None
        active_robot_type = active_robot.get("type", "so100_follower") if active_robot else "so100_follower"

        skills = self.pm.current_project.get("skills", [])
        active_skill = skills[0] if skills else "pick_cube"

        if cmd == "/stop":
            event_bus.log_message.emit("WARN", "Macro: Triggering Emergency STOP...")
            self.lerobot_bridge.kill_all()

        elif cmd == "/vis":
            dataset_repo_id = f"local/{active_skill}"
            python = self.lerobot_bridge._python
            cli_cmd = f'"{python}" -m lerobot.scripts.lerobot_dataset_viz --repo-id {dataset_repo_id} --episode-index 0'
            event_bus.log_message.emit("INFO", f"Macro: Launching Rerun visualization for {dataset_repo_id}...")
            self.lerobot_bridge.run_custom_command(cli_cmd)
            
        elif cmd == "/record":
            event_bus.log_message.emit("INFO", "Macro: Triggering teleoperation recording...")
            event_bus.recording_requested.emit(active_skill, False)
            
        elif cmd == "/train":
            event_bus.log_message.emit("INFO", "Macro: Triggering policy training...")
            self._on_training_started(active_skill)
            
        else:
            event_bus.log_message.emit("ERROR", f"Unknown macro command: {cmd}. Type /help for assistance.")

    # ── Recording and Training Pipeline Slots ────────────────────────────────

    @Slot(str, bool)
    def _on_recording_requested(self, skill_slug: str, resume: bool = False) -> None:
        """Start teleoperation recording using robot configuration and its associated cameras."""
        if not self.pm.current_project:
            return

        robots = self.pm.current_project.get("robots", [])
        if not robots:
            event_bus.log_message.emit("ERROR", "No robot configured in project! Please add a robot first.")
            event_bus.recording_stopped.emit(skill_slug, 0)
            return

        robot = robots[0]  # Use the active/first robot
        robot_type = robot.get("follower_type") or robot.get("type", "so100_follower")
        port = robot.get("follower_port") or robot.get("port", "")
        leader_port = robot.get("leader_port") or self.pm.current_project.get("leader_port", "")
        leader_type = robot.get("leader_type") or robot_type.replace("_follower", "_leader")
        associated_cams = robot.get("cameras", [])

        # Vynucení lokálního názvu datasetu s ohledem na hierarchii dovedností
        parent_slug = ""
        skills_details = self.pm.current_project.get("skills_details", {})
        detail = skills_details.get(skill_slug, {})
        parent_slug = detail.get("parent_slug", "") or ""

        if parent_slug:
            dataset_name = f"local/{parent_slug}/{skill_slug}"
        else:
            dataset_name = f"local/{skill_slug}"

        cams_str = ", ".join(associated_cams) if associated_cams else "default"
        event_bus.log_message.emit("INFO", f"Recording dataset using cameras: {cams_str}")

        single_task = detail.get("description") or detail.get("name") or skill_slug.replace("_", " ")

        self.lerobot_bridge.start_recording(
            robot_type=robot_type,
            dataset_name=dataset_name,
            skill_slug=skill_slug,
            port=port,
            robot_id=robot.get("follower_id") or robot.get("id") or "my_follower_arm",
            teleop_type=leader_type,
            teleop_port=leader_port,
            teleop_id=robot.get("leader_id") or "my_leader_arm",
            single_task=single_task,
            camera_ids=associated_cams,
            resume=resume,
        )

    @Slot(str)
    def _on_recording_stop_requested(self, skill_slug: str) -> None:
        log.info("Stopping recording process for skill '%s'", skill_slug)
        self.lerobot_bridge.stop_recording(skill_slug)

    @Slot(str, str, int, str)
    def _on_replay_requested(self, robot_type: str, dataset_name: str, episode_index: int, port: str = "") -> None:
        """Start hardware replay of an episode."""
        self.lerobot_bridge.start_replay(
            robot_type=robot_type,
            dataset_name=dataset_name,
            episode_index=episode_index,
            port=port,
        )

    @Slot(str)
    def _on_training_started(self, skill_slug: str) -> None:
        """Start LeRobot policy training for a skill using localized folder structures."""
        if not self.pm.current_project:
            return

        # Retrieve selected policy architecture globally from project settings
        policy_type = self.pm.current_project.get("policy_architecture", "diffusion")

        # Read active training configuration
        train_cfg = self.pm.current_project.get("active_training_config", {})
        steps = train_cfg.get("steps") or train_cfg.get("epochs", 100) * 100
        batch_size = train_cfg.get("batch_size", 8)
        device = train_cfg.get("device", "cuda")
        use_wandb = train_cfg.get("use_wandb", False)
        extra_args_str = train_cfg.get("extra_args_str", "")

        # Repo ID maps to local/{parent_slug}/{skill_slug} if parent_slug exists, else local/{skill_slug}
        parent_slug = ""
        skills_details = self.pm.current_project.get("skills_details", {})
        if skill_slug in skills_details:
            parent_slug = skills_details[skill_slug].get("parent_slug", "")

        if parent_slug:
            dataset_repo_id = f"local/{parent_slug}/{skill_slug}"
            policy_slug = f"{parent_slug}_{skill_slug}"
        else:
            dataset_repo_id = f"local/{skill_slug}"
            policy_slug = skill_slug

        # Training outputs stored in active project's dataset storage dir if set, else in cross-platform data directory
        custom_dir = self.pm.current_project.get("dataset_storage_dir")
        base_output = Path(custom_dir) if custom_dir else self._data_dir
        output_dir = str(base_output / "outputs" / "training" / f"{policy_slug}_{policy_type}")

        self.lerobot_bridge.start_training(
            policy_type=policy_type,
            dataset_repo_id=dataset_repo_id,
            skill_slug=skill_slug,
            output_dir=output_dir,
            training_steps=steps,
            batch_size=batch_size,
            device=device,
            use_wandb=use_wandb,
            extra_args_str=extra_args_str,
        )

    @Slot(str)
    def _on_training_stopped(self, skill_slug: str) -> None:
        log.info("Stopping training process for skill '%s'", skill_slug)
        self.lerobot_bridge.stop_training(skill_slug)
        # Clear the queue on training stop
        self._training_queue = []
        self._current_training_skill = None

    def start_training_queue(self, skill_slugs: list[str]) -> None:
        """Start a queue of skill training sessions, running one after another."""
        self._training_queue = list(skill_slugs)
        self._current_training_skill = None
        log.info("Controller: starting training queue: %s", self._training_queue)
        self._process_next_in_training_queue()

    def _process_next_in_training_queue(self) -> None:
        if not self._training_queue:
            self._current_training_skill = None
            log.info("Controller: training queue completed.")
            event_bus.log_message.emit("SUCCESS", "Fronta trénování byla úspěšně dokončena.")
            return

        next_skill = self._training_queue.pop(0)
        self._current_training_skill = next_skill
        log.info("Controller: spawning next training task in queue: %s", next_skill)
        self._on_training_started(next_skill)

    @Slot(str, str)
    def _on_training_finished(self, skill_slug: str, checkpoint_path: str) -> None:
        log.info("Controller: training finished for %s", skill_slug)
        self._save_model_metadata(skill_slug)
        if skill_slug == self._current_training_skill:
            self._process_next_in_training_queue()

    @Slot(str, str)
    def _on_training_error(self, skill_slug: str, error_msg: str) -> None:
        log.warning("Controller: training error for %s: %s", skill_slug, error_msg)
        if skill_slug == self._current_training_skill:
            self._process_next_in_training_queue()

    @Slot(str)
    def _on_robot_calibrated(self, arm_id: str) -> None:
        """
        Triggered when a leader or follower calibration finishes.
        We scan the project's configured robots to find who matches this arm_id,
        and automatically back up their newly written calibration to the project's local folder.
        """
        log.info("Controller: robot/teleop arm '%s' calibrated", arm_id)
        if not self.pm.current_project:
            return

        for r in self.pm.current_project.get("robots", []):
            setup_id = r.get("id")
            if r.get("leader_id") == arm_id:
                # This was a leader calibration
                log.info("Auto-saving leader calibration for setup %s", setup_id)
                new_file = self.calibration_manager.backup_active_calibration(setup_id, "teleoperators")
                if new_file:
                    event_bus.log_message.emit("SUCCESS", f"Auto-backed up leader calibration: {new_file}")
                return
            elif r.get("follower_id") == arm_id:
                # This was a follower calibration
                log.info("Auto-saving follower calibration for setup %s", setup_id)
                new_file = self.calibration_manager.backup_active_calibration(setup_id, "robots")
                if new_file:
                    event_bus.log_message.emit("SUCCESS", f"Auto-backed up follower calibration: {new_file}")
                return

    def _save_model_metadata(self, skill_slug: str, save_project: bool = True) -> None:
        if not self.pm.current_project:
            return

        import json

        parent_slug = ""
        skills_details = self.pm.current_project.get("skills_details", {})
        if skill_slug in skills_details:
            parent_slug = skills_details[skill_slug].get("parent_slug", "")

        policy_type = self.pm.current_project.get("policy_architecture", "diffusion")
        policy_slug = f"{parent_slug}_{skill_slug}" if parent_slug else skill_slug

        custom_dir = self.pm.current_project.get("dataset_storage_dir")
        base_output = Path(custom_dir) if custom_dir else self._data_dir
        output_dir = base_output / "outputs" / "training" / f"{policy_slug}_{policy_type}"

        param_count = None
        try:
            safetensors_files = list(output_dir.glob("**/model.safetensors"))
            if safetensors_files:
                pretrained_path = output_dir / "checkpoints" / "pretrained_model" / "model.safetensors"
                if not pretrained_path.exists():
                    pretrained_path = output_dir / "pretrained_model" / "model.safetensors"
                
                target_file = None
                if pretrained_path.exists():
                    target_file = pretrained_path
                else:
                    safetensors_files.sort(key=lambda x: x.stat().st_mtime)
                    target_file = safetensors_files[-1]
                
                param_count = self._get_safetensors_param_count(target_file)
        except Exception as e:
            log.warning("Could not read safetensors file in %s: %s", output_dir, e)

        train_cfg = self.pm.current_project.get("active_training_config", {})
        epochs = train_cfg.get("epochs", 100)

        if skill_slug in skills_details:
            skills_details[skill_slug]["model_metadata"] = {
                "policy_type": policy_type,
                "epochs": epochs,
                "param_count": param_count
            }
            try:
                assert self.pm.current_path is not None
                skill_dir = self.pm.current_path / "skills" / skill_slug
                skill_file = skill_dir / "skill.json"
                if skill_file.exists():
                    with open(skill_file, "r", encoding="utf-8") as f:
                        skill_data = json.load(f)
                    skill_data["model_metadata"] = skills_details[skill_slug]["model_metadata"]
                    with open(skill_file, "w", encoding="utf-8") as f:
                        json.dump(skill_data, f, indent=2, ensure_ascii=False)
            except Exception as e:
                log.warning("Failed to save local skill.json metadata: %s", e)

            if save_project:
                self.pm.save_project()
                event_bus.project_opened.emit(self.pm.current_project)

    def _get_safetensors_param_count(self, path: Path) -> int | None:
        import struct
        import json
        try:
            with open(path, "rb") as f:
                header_size_bytes = f.read(8)
                if len(header_size_bytes) != 8:
                    return None
                header_size = struct.unpack("<Q", header_size_bytes)[0]
                header_bytes = f.read(header_size)
                header = json.loads(header_bytes.decode("utf-8"))
                total_params = 0
                for k, v in header.items():
                    if k == "__metadata__":
                        continue
                    shape = v.get("shape")
                    if shape:
                        prod = 1
                        for dim in shape:
                            prod *= dim
                        total_params += prod
                return total_params
        except Exception as e:
            log.warning("Safetensors param count parse failed for %s: %s", path, e)
            return None

    # ── Orchestration Callbacks (called by Orchestrator Thread) ──────────────

    def _execute_motor_task(self, task_name: str) -> None:
        """
        Callback called by the Orchestrator to execute a sub-task.
        Starts the LeRobot inference process in non-blocking mode.
        """
        if not self.pm.current_project:
            raise RuntimeError("No project open")

        robots = self.pm.current_project.get("robots", [])
        if not robots:
            raise RuntimeError("No robot configured in project. Please add a robot first.")

        robot = robots[0]  # Use the first configured robot in v1
        robot_type = robot.get("follower_type") or robot.get("type", "so100_follower")
        port = robot.get("follower_port") or robot.get("port", "")

        parent_slug = ""
        skills_details = self.pm.current_project.get("skills_details", {})
        if task_name in skills_details:
            parent_slug = skills_details[task_name].get("parent_slug", "")

        policy_type = self.pm.current_project.get("policy_architecture", "diffusion")
        policy_slug = f"{parent_slug}_{task_name}" if parent_slug else task_name

        custom_dir = self.pm.current_project.get("dataset_storage_dir")
        base_output = Path(custom_dir) if custom_dir else self._data_dir
        policy_path = str(base_output / "outputs" / "training" / f"{policy_slug}_{policy_type}")

        # 1. Goal-conditioned mode: if a persistent daemon is already running,
        #    just switch its active task over stdin instead of spawning a new process.
        for key in self.lerobot_bridge.active_processes:
            if key.startswith("infer_"):
                running_slug = key[len("infer_"):]
                if self.lerobot_bridge.send_inference_command(running_slug, f"SET_TASK:{task_name}"):
                    event_bus.log_message.emit("INFO", f"Re-using running inference daemon — task switched to '{task_name}'.")
                    return
                # Stale daemon for another skill: stop it to free the serial port
                self.lerobot_bridge.stop_inference(running_slug)

        log.info(
            "Controller: starting LeRobot inference for skill '%s' using %s robot",
            task_name,
            robot_type,
        )
        event_bus.log_message.emit("INFO", f"Starting robot inference: {task_name}...")

        # 2. Cold start: spawn the daemon and auto-dispatch the task once it is ready
        self.lerobot_bridge.start_inference(
            robot_type=robot_type,
            policy_path=policy_path,
            skill_slug=task_name,
            port=port,
            auto_task=task_name,
        )

    def _capture_scene_snapshot(self) -> str:
        """
        Callback called by the Orchestrator to get a scene image.
        Returns base64 encoded JPEG string.
        """
        active = self.camera_manager.active_cameras
        if not active:
            log.warning("No active cameras to capture scene snapshot")
            return ""

        # Prioritize 'overhead' or 'hand_camera' if they exist, otherwise take the first
        cam_id = active[0]
        for cid in active:
            if "overhead" in cid.lower() or "hand" in cid.lower():
                cam_id = cid
                break

        b64 = self.camera_manager.get_camera_frame_b64(cam_id)
        if not b64:
            log.warning("Captured empty frame for camera '%s'", cam_id)
        return b64 or ""

    # ── Public API for UI ───────────────────────────────────────────────────

    def execute_command(self, user_instruction: str) -> None:
        """Start high-level orchestration for a user instruction."""
        if not self.orchestrator:
            event_bus.log_message.emit("ERROR", "No project open. Cannot run orchestration.")
            return

        if self.orchestrator.state in (
            OrchestratorState.PLANNING,
            OrchestratorState.EXECUTING,
            OrchestratorState.VERIFYING,
        ):
            event_bus.log_message.emit("WARN", "Orchestration already in progress.")
            return

        # Update available skills from project manager
        if not self.pm.current_project or not self.planner:
            event_bus.log_message.emit("ERROR", "No project open. Cannot run orchestration.")
            return
        skills = self.pm.current_project.get("skills", [])
        skills_details = self.pm.current_project.get("skills_details", {})
        self.planner.set_available_skills(skills)
        self.planner.set_skills_details(skills_details)
        if self.inspector:
            self.inspector.set_skills_details(skills_details)

        # Start the background execution thread
        thread = OrchestrationThread(self.orchestrator, user_instruction)
        thread.start()

    def start_teleop_workflow(
        self,
        robot_type: str,
        robot_port: str,
        robot_id: str,
        teleop_type: str,
        teleop_port: str,
        teleop_id: str,
        cameras: str = "",
        display_data: bool = True,
        extra_args: dict | None = None,
    ) -> None:
        """Launch the teleoperation procedure via LeRobotBridge."""
        self.lerobot_bridge.start_teleop(
            robot_type=robot_type,
            robot_port=robot_port,
            robot_id=robot_id,
            teleop_type=teleop_type,
            teleop_port=teleop_port,
            teleop_id=teleop_id,
            cameras=cameras,
            display_data=display_data,
            extra_args=extra_args,
        )

    def stop_teleop_workflow(self) -> None:
        """Stop running teleoperation process."""
        self.lerobot_bridge.stop_teleop()

    def start_direct_inference(
        self,
        robot_type: str,
        policy_path: str,
        skill_slug: str,
        port: str = "",
        fps: int = 30,
        extra_args: dict | None = None,
    ) -> None:
        """Run policy evaluation autonomously on the robot hardware."""
        self.lerobot_bridge.start_inference(
            robot_type=robot_type,
            policy_path=policy_path,
            skill_slug=skill_slug,
            port=port,
            fps=fps,
            extra_args=extra_args,
        )

    def stop_direct_inference(self, skill_slug: str) -> None:
        """Stop running policy evaluation."""
        self.lerobot_bridge.stop_inference(skill_slug)

    def send_inference_command(self, skill_slug: str, command: str) -> bool:
        """Send a string command to the running persistent inference stdin pipe."""
        return self.lerobot_bridge.send_inference_command(skill_slug, command)
