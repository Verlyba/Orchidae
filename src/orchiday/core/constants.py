"""
Global constants and default paths for the Orchiday application.
"""

import os
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Application paths
# ---------------------------------------------------------------------------

def _get_app_data_dir() -> Path:
    """Return platform-specific application data directory."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "Orchiday"


APP_DATA_DIR = _get_app_data_dir()
DEFAULT_PROJECTS_DIR = Path.home() / "OrchidayProjects"
GLOBAL_CONFIG_FILE = APP_DATA_DIR / "config.json"
RECENT_PROJECTS_FILE = APP_DATA_DIR / "recent_projects.json"


# ---------------------------------------------------------------------------
# Project file structure
# ---------------------------------------------------------------------------

PROJECT_FILE = "project.json"
ROBOTS_DIR = "robots"
CAMERAS_FILE = "cameras/cameras.json"
MODELS_DIR = "models"
SKILLS_DIR = "skills"
POLICIES_DIR = "models/policies"
ORCHESTRATION_DIR = "orchestration"
LOGS_DIR = "logs/sessions"


# ---------------------------------------------------------------------------
# Hardware defaults
# ---------------------------------------------------------------------------

DEFAULT_BAUDRATE = 1_000_000
DEFAULT_SLEW_RATE_LIMIT = 0.05       # rad / frame (~33 ms)
DEFAULT_LOWPASS_ALPHA = 0.25
DEFAULT_WATCHDOG_TIMEOUT_S = 5.0
DEFAULT_CAMERA_WIDTH = 640
DEFAULT_CAMERA_HEIGHT = 480
DEFAULT_CAMERA_FPS = 30


# ---------------------------------------------------------------------------
# LeRobot supported robots
# All robot types that LeRobot currently supports.
# Users pick from this list (or enter custom) when adding a robot.
# ---------------------------------------------------------------------------

LEROBOT_SUPPORTED_ROBOTS = [
    # ── SO-100 / SO-101 family (Feetech STS3215) ─────────────────────────
    {"type": "so100_follower", "label": "SO-100 Follower", "bus": "serial",
     "description": "SO-100 follower arm (6-DOF, Feetech STS3215 servos)"},
    {"type": "so101_follower", "label": "SO-101 Follower", "bus": "serial",
     "description": "SO-101 follower arm (improved SO-100)"},
    {"type": "bi_so_follower", "label": "Bimanual SO Follower", "bus": "serial",
     "description": "Dual SO-100/101 follower arms for bimanual tasks"},

    # ── Koch family (Dynamixel XL330) ────────────────────────────────────
    {"type": "koch_follower", "label": "Koch Follower", "bus": "serial",
     "description": "Koch v1.1 follower arm (6-DOF, Dynamixel XL330 servos)"},
    {"type": "omx_follower", "label": "OMX Follower", "bus": "serial",
     "description": "OMX follower arm"},

    # ── OpenArm family (Damiao CAN motors) ───────────────────────────────
    {"type": "openarm_follower", "label": "OpenArm Follower", "bus": "can",
     "description": "OpenArm 7-DOF follower (CAN bus, Damiao motors)"},
    {"type": "bi_openarm_follower", "label": "Bimanual OpenArm Follower", "bus": "can",
     "description": "Dual OpenArm followers for bimanual tasks"},

    # ── Hope Jr family ────────────────────────────────────────────────────
    {"type": "hope_jr_arm", "label": "Hope Jr Arm", "bus": "serial",
     "description": "Hope Jr robot arm"},
    {"type": "hope_jr_hand", "label": "Hope Jr Hand", "bus": "serial",
     "description": "Hope Jr robotic hand"},

    # ── Reachy 2 ─────────────────────────────────────────────────────────
    {"type": "reachy2", "label": "Reachy 2", "bus": "network",
     "description": "Pollen Robotics Reachy 2 (TCP/IP connection)"},

    # ── Unitree G1 ────────────────────────────────────────────────────────
    {"type": "unitree_g1", "label": "Unitree G1", "bus": "network",
     "description": "Unitree G1 humanoid robot"},

    # ── EarthRover ────────────────────────────────────────────────────────
    {"type": "earthrover_mini_plus", "label": "EarthRover Mini+", "bus": "network",
     "description": "EarthRover Mini Plus (Frodobots SDK)"},

    # ── LeKiwi ────────────────────────────────────────────────────────────
    {"type": "lekiwi", "label": "LeKiwi Mobile", "bus": "serial",
     "description": "Mobile robot with SO-100 arm on wheeled base"},
]

# Teleoperator (leader) device types — used for calibration/teleoperation
LEROBOT_TELEOP_TYPES = [
    {"type": "so100_leader", "label": "SO-100 Leader", "bus": "serial",
     "description": "SO-100 leader arm (for teleoperation/calibration)"},
    {"type": "so101_leader", "label": "SO-101 Leader", "bus": "serial",
     "description": "SO-101 leader arm"},
    {"type": "bi_so_leader", "label": "Bimanual SO Leader", "bus": "serial",
     "description": "Dual SO-100/101 leader arms"},
    {"type": "koch_leader", "label": "Koch Leader", "bus": "serial",
     "description": "Koch v1.1 leader arm"},
    {"type": "omx_leader", "label": "OMX Leader", "bus": "serial",
     "description": "OMX leader arm"},
    {"type": "openarm_leader", "label": "OpenArm Leader", "bus": "can",
     "description": "OpenArm leader arm (CAN bus)"},
    {"type": "bi_openarm_leader", "label": "Bimanual OpenArm Leader", "bus": "can",
     "description": "Dual OpenArm leaders"},
    {"type": "keyboard", "label": "Keyboard", "bus": "none",
     "description": "Keyboard-based teleoperation"},
    {"type": "gamepad", "label": "Gamepad", "bus": "none",
     "description": "Gamepad/joystick teleoperation"},
]

# Quick lookup: type -> full info
ROBOT_TYPE_MAP = {r["type"]: r for r in LEROBOT_SUPPORTED_ROBOTS}
TELEOP_TYPE_MAP = {r["type"]: r for r in LEROBOT_TELEOP_TYPES}


# ---------------------------------------------------------------------------
# AI defaults
# ---------------------------------------------------------------------------

DEFAULT_LM_STUDIO_URL = "http://localhost:1234/v1"
DEFAULT_LLM_SYSTEM_PROMPT = (
    "You are a robotic arm task planner. "
    "Decompose the user's instruction into an ordered array of sub-tasks. "
    "Respond with a pure JSON array of strings, no extra commentary."
)
DEFAULT_VLM_TIMEOUT_S = 30.0
DEFAULT_LLM_TIMEOUT_S = 30.0


# ---------------------------------------------------------------------------
# Training defaults
# ---------------------------------------------------------------------------

# Policy types from lerobot_train --policy.type help
# {act,diffusion,groot,pi0,pi0_fast,pi05,smolvla,tdmpc,vqbet,wall_x,xvla,sac,reward_classifier,sarm}
SUPPORTED_ARCHITECTURES = [
    "act",           # Action Chunking with Transformers (most common for SO-100/Koch)
    "diffusion",     # Diffusion Policy
    "pi0",           # π0 (PhysicalIntelligence)
    "pi0_fast",      # π0 FAST (faster π0 variant)
    "smolvla",       # SmolVLA (small VLA model)
    "tdmpc",         # TD-MPC (temporal difference MPC)
    "vqbet",         # VQ-BeT
    "groot",         # GR00T
]
DEFAULT_EPOCHS = 100
DEFAULT_BATCH_SIZE = 32


# ---------------------------------------------------------------------------
# Orchestration defaults
# ---------------------------------------------------------------------------

LATCH_STRATEGIES = ["timeout", "action_chunk", "hybrid"]
DEFAULT_LATCH_STRATEGY = "action_chunk"
DEFAULT_TASK_TIMEOUT_S = 10.0


# ---------------------------------------------------------------------------
# UI constants
# ---------------------------------------------------------------------------

APP_DISPLAY_NAME = "Orchiday"
WINDOW_MIN_WIDTH = 1280
WINDOW_MIN_HEIGHT = 800
SIDEBAR_WIDTH = 240
