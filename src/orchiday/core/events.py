"""
Event bus for inter-module communication in Orchiday.

Uses Qt signals so the UI layer can react to events from core/hardware/AI
without direct imports. All modules emit and listen via the singleton `event_bus`.
"""

from PySide6.QtCore import QObject, Signal


class EventBus(QObject):
    """
    Central event bus.

    All signals are defined here to prevent circular dependencies.
    Modules emit and listen through the single `event_bus` instance.
    """

    # ── Project ──────────────────────────────────────────────────────────
    project_created = Signal(dict)       # {name, slug, path}
    project_opened = Signal(dict)        # Full project.json as dict
    project_closed = Signal()
    project_saved = Signal()

    # ── Robots ───────────────────────────────────────────────────────────
    robot_added = Signal(dict)           # {id, type, port, ...}
    robot_removed = Signal(str)          # robot_id
    robot_connected = Signal(str)        # robot_id
    robot_disconnected = Signal(str)     # robot_id
    robot_error = Signal(str, str)       # robot_id, error_message
    robot_calibrating = Signal(str)      # robot_id
    robot_calibrated = Signal(str)       # robot_id
    calibration_list_changed = Signal()  # Emitted when project calibration list changes

    # ── Cameras ──────────────────────────────────────────────────────────
    camera_added = Signal(dict)          # {id, source, role, ...}
    camera_removed = Signal(str)         # camera_id
    camera_started = Signal(str)         # camera_id
    camera_stopped = Signal(str)         # camera_id
    camera_error = Signal(str, str)      # camera_id, error_message
    camera_frame_ready = Signal(str, object)  # camera_id, QImage (use object for typing)

    # ── AI Models ────────────────────────────────────────────────────────
    model_configured = Signal(str, dict)      # model_role, config
    model_connection_ok = Signal(str)         # model_role
    model_connection_fail = Signal(str, str)  # model_role, error

    # ── Skills ───────────────────────────────────────────────────────────
    skill_created = Signal(dict)              # {name, slug, ...}
    skill_deleted = Signal(str)               # skill_slug
    recording_started = Signal(str)           # skill_slug
    recording_stopped = Signal(str, int)      # skill_slug, episode_count
    recording_progress = Signal(str, float)   # skill_slug, progress 0..1
    replay_requested = Signal(str, str, int, str)  # robot_type, dataset_name, episode_index, port
    recording_requested = Signal(str, bool)   # skill_slug, resume
    recording_stop_requested = Signal(str)    # skill_slug

    # ── Training ─────────────────────────────────────────────────────────
    training_started = Signal(str)            # skill_slug
    training_stopped = Signal(str)            # skill_slug
    training_progress = Signal(str, int, float)  # skill_slug, epoch, loss
    training_finished = Signal(str, str)      # skill_slug, checkpoint_path
    training_error = Signal(str, str)         # skill_slug, error_message
    inference_finished = Signal(str)          # skill_slug

    # ── Orchestration ────────────────────────────────────────────────────
    orchestration_requested = Signal(str)          # user_instruction
    orchestration_plan_ready = Signal(list)        # ["pick_cube", "move_to_bowl"]
    orchestration_task_started = Signal(str)       # active_task name
    orchestration_task_completed = Signal(str, bool)  # task_name, success
    orchestration_locked = Signal()
    orchestration_unlocked = Signal()
    orchestration_finished = Signal(bool)          # overall_success
    orchestration_error = Signal(str)              # error_message
    orchestration_vlm_snap = Signal(str)           # base64 verification snapshot

    # ── Safety ───────────────────────────────────────────────────────────
    safety_warning = Signal(str, str)    # robot_id, warning message
    emergency_stop = Signal(str)         # robot_id
    watchdog_timeout = Signal(str)       # robot_id
    safety_telemetry = Signal(list, list)  # raw_angles, safe_angles

    # ── Subprocess lifecycle (drives UI button states) ───────────────────
    process_started = Signal(str, str)   # process_key, kind (teleop/record/train/infer/...)
    process_finished = Signal(str, str)  # process_key, kind

    # ── Console / Logs ───────────────────────────────────────────────────
    log_message = Signal(str, str)       # level ("INFO"/"WARN"/"ERROR"), message
    console_output = Signal(str)         # Raw stdout/stderr from subprocess
    terminal_command_requested = Signal(str)  # command_string


# Singleton instance
event_bus = EventBus()
