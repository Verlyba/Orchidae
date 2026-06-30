#!/usr/bin/env python3
"""
Orchiday Persistent Inference Daemon — Model 3 (Svaly).

Loads a trained imitation learning policy (ACT / Diffusion / ...) once into memory
and manages a persistent evaluation loop over standard I/O (stdin/stdout).

Designed for LeRobot >= 0.5 (lerobot.robots / lerobot.policies API).
If LeRobot or the hardware is unavailable, the daemon degrades to a
simulated mock mode so the UI pipeline stays testable.

Stdin protocol:
    SET_TASK:<task_name>   -> switch to RUNNING and condition the policy on the task
    STOP                   -> freeze motors, go back to WAITING
    QUIT                   -> exit the daemon

Dynamic termination triggers:
- Protocol A (Velocity Delta): |target - current| < 0.005 for 5 consecutive frames.
- Protocol B (Torque Spike): gripper servo load exceeds 250 mA on contact.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
import time

import numpy as np

# Set OpenCV logging level to OFF to avoid console clutter
os.environ["OPENCV_LOG_LEVEL"] = "OFF"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("orchiday_inference")

try:
    import torch
    TORCH_OK = True
except ImportError:
    torch = None  # type: ignore
    TORCH_OK = False
    log.warning("PyTorch not importable — running in pure mock mode.")

# ── LeRobot imports (modern >= 0.5 layout) ───────────────────────────────────
LEROBOT_OK = False
try:
    from lerobot.configs.policies import PreTrainedConfig
    from lerobot.policies.factory import get_policy_class, make_pre_post_processors
    from lerobot.robots import RobotConfig  # noqa: F401 — triggers subclass registration
    from lerobot.robots.utils import make_robot_from_config
    from lerobot.datasets.utils import hw_to_dataset_features, build_dataset_frame
    from lerobot.utils.control_utils import predict_action
    LEROBOT_OK = True
    log.info("Successfully imported LeRobot >= 0.5 components.")
except ImportError as e:
    log.warning("Could not import LeRobot (%s). Falling back to VIRTUAL MOCK mode.", e)

# ── Global State ─────────────────────────────────────────────────────────────
state = "WAITING"  # WAITING or RUNNING
active_task = ""
last_joints = np.zeros(6, dtype=np.float32)
predicted_action = np.zeros(6, dtype=np.float32)
simulated_mode = True
robot = None
policy = None
preprocessor = None
postprocessor = None
obs_features = None
action_keys: list[str] = []
device = "cpu"

# Protocol constants
PROTOCOL_A_THRESHOLD = 0.005  # Radians
PROTOCOL_A_PATIENCE = 5       # Frames
PROTOCOL_B_LOAD_LIMIT = 250   # mA

# ── Console/Pipe Input Reader Thread ──────────────────────────────────────────

def stdin_reader():
    global state, active_task
    log.info("Stdin reader thread started. Waiting for 'SET_TASK:<task_name>'...")

    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        log.info("Command received: '%s'", line)
        if line.startswith("SET_TASK:"):
            task = line[len("SET_TASK:"):].strip()
            if task:
                active_task = task
                if policy is not None and hasattr(policy, "reset"):
                    try:
                        policy.reset()
                    except Exception:
                        pass
                state = "RUNNING"
                log.info("Transitioned to RUNNING. Active Task: %s", active_task)
                print(f"[STATUS] TASK_STARTED: {active_task}", flush=True)
        elif line == "STOP":
            state = "WAITING"
            active_task = ""
            log.info("Transitioned to WAITING. Stated STOP.")
            print("[STATUS] TASK_STOPPED", flush=True)
        elif line == "QUIT":
            log.info("Quit command received. Exiting.")
            os._exit(0)


# ── Hardware / Policy bootstrap ───────────────────────────────────────────────

def load_policy(policy_path: str, dev: str):
    """Load a pretrained LeRobot policy + its processor pipelines."""
    global policy, preprocessor, postprocessor
    cfg = PreTrainedConfig.from_pretrained(policy_path)
    cfg.pretrained_path = policy_path
    policy_cls = get_policy_class(cfg.type)
    policy = policy_cls.from_pretrained(policy_path)
    policy.to(dev)
    policy.eval()
    try:
        preprocessor, postprocessor = make_pre_post_processors(
            policy_cfg=cfg, pretrained_path=policy_path
        )
    except Exception as e:
        log.warning("Processor pipelines unavailable (%s) — raw select_action will be used.", e)
        preprocessor, postprocessor = None, None
    log.info("Policy '%s' loaded from %s onto %s.", cfg.type, policy_path, dev)


def connect_robot(robot_type: str, port: str, robot_id: str, cameras_json: str):
    """Instantiate and connect a LeRobot robot from its registered config class."""
    global robot, obs_features, action_keys
    cfg_cls = RobotConfig.get_choice_class(robot_type)
    kwargs: dict = {"port": port, "id": robot_id}

    if cameras_json:
        try:
            from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig
            cams = {}
            for name, c in json.loads(cameras_json).items():
                cams[name] = OpenCVCameraConfig(
                    index_or_path=c.get("index_or_path", 0),
                    width=c.get("width", 640),
                    height=c.get("height", 480),
                    fps=c.get("fps", 30),
                )
            kwargs["cameras"] = cams
        except Exception as e:
            log.warning("Camera config parse failed (%s) — connecting without cameras.", e)

    try:
        robot_cfg = cfg_cls(**kwargs)
    except TypeError:
        # Network robots (reachy2, unitree_g1, ...) take no serial port
        kwargs.pop("port", None)
        robot_cfg = cfg_cls(**kwargs)

    robot = make_robot_from_config(robot_cfg)
    robot.connect()
    obs_features = hw_to_dataset_features(robot.observation_features, "observation")
    action_keys = list(robot.action_features)
    log.info("Robot '%s' connected on %s (%d action dims).", robot_type, port, len(action_keys))


def predict_real_action(task: str, dev: str) -> tuple[np.ndarray, np.ndarray, float]:
    """One inference step on real hardware. Returns (current_joints, target_action, gripper_load)."""
    obs = robot.get_observation()

    # Current joint positions (any *.pos keys)
    joints = np.array(
        [float(v) for k, v in obs.items() if isinstance(v, (int, float)) and k.endswith(".pos")],
        dtype=np.float32,
    )
    gripper_load = float(obs.get("gripper.current", obs.get("observation.gripper_current", 0.0)) or 0.0)

    frame = build_dataset_frame(obs_features, obs, prefix="observation")
    action_values = predict_action(
        frame, policy, torch.device(dev),
        preprocessor, postprocessor,
        use_amp=getattr(policy.config, "use_amp", False),
        task=task,
        robot_type=robot.name,
    )
    action = {key: action_values[i].item() for i, key in enumerate(action_keys)}
    robot.send_action(action)

    target = np.array([action[k] for k in action_keys], dtype=np.float32)
    return joints, target, gripper_load


# ── Main Persistent Loop ──────────────────────────────────────────────────────

def main():
    global state, active_task, last_joints, predicted_action, simulated_mode, device

    parser = argparse.ArgumentParser(description="Orchiday Persistent Inference Daemon")
    parser.add_argument("--robot.type", dest="robot_type", default="so100_follower", help="Follower robot type")
    parser.add_argument("--robot.id", dest="robot_id", default="my_follower_arm", help="Robot ID (calibration key)")
    parser.add_argument("--robot.port", dest="robot_port", default="", help="Robot serial port")
    parser.add_argument("--robot.cameras", dest="robot_cameras", default="", help="JSON camera map {name: {index_or_path, width, height, fps}}")
    parser.add_argument("--policy.path", dest="policy_path", required=True, help="Trained model policy directory")
    parser.add_argument("--device", dest="device", default="", help="cuda | mps | cpu (auto when empty)")
    parser.add_argument("--fps", dest="fps", type=int, default=30, help="Inference frequency")
    args = parser.parse_args()

    # 1. Resolve compute device
    if args.device:
        device = args.device
    elif TORCH_OK and torch.cuda.is_available():
        device = "cuda"
    elif TORCH_OK and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    if device == "cuda" and (not TORCH_OK or not torch.cuda.is_available()):
        device = "cpu"
        log.warning("CUDA not available. Falling back to CPU.")

    # 2. Load Trained Policy
    log.info("Loading policy model from %s onto %s...", args.policy_path, device)
    if LEROBOT_OK and TORCH_OK:
        try:
            load_policy(args.policy_path, device)
        except Exception as e:
            log.exception("Failed to load policy — emulating policy inference. Error: %s", e)
    else:
        log.warning("LeRobot/torch unavailable — policy emulation active.")

    # 3. Connect to follower hardware
    simulated_mode = True
    if LEROBOT_OK and args.robot_port:
        try:
            connect_robot(args.robot_type, args.robot_port, args.robot_id, args.robot_cameras)
            simulated_mode = False
        except Exception as e:
            log.warning("[SYSTEM] Follower hardware offline or busy (%s). Booting in VIRTUAL MOCK mode.", e)
    elif not args.robot_port:
        log.warning("[SYSTEM] No serial port specified. Booting in VIRTUAL MOCK mode.")

    # Initialize joint states (SO-100: Base, Shoulder, Elbow, Wrist Pitch, Wrist Roll, Gripper)
    n_joints = len(action_keys) if action_keys else 6
    last_joints = np.zeros(n_joints, dtype=np.float32)
    predicted_action = np.zeros(n_joints, dtype=np.float32)

    # Start stdin listener thread
    t = threading.Thread(target=stdin_reader, daemon=True)
    t.start()

    # FPS control
    sleep_time = 1.0 / args.fps
    consecutive_settled_frames = 0
    simulated_load = 0.0

    mode = "SIMULATED" if simulated_mode else "HARDWARE"
    log.info("Persistent inference loop online in %s mode and WAITING.", mode)
    print(f"[STATUS] DAEMON_READY: mode={mode}", flush=True)

    while True:
        start_tick = time.time()
        gripper_current = 0.0

        if state == "WAITING":
            # Hold position: keep reading observations so the arm doesn't drift unnoticed
            if not simulated_mode and robot is not None:
                try:
                    obs = robot.get_observation()
                    joints = np.array(
                        [float(v) for k, v in obs.items() if isinstance(v, (int, float)) and k.endswith(".pos")],
                        dtype=np.float32,
                    )
                    if joints.size:
                        last_joints = joints
                except Exception:
                    pass
            consecutive_settled_frames = 0

        elif state == "RUNNING":
            # ── 1+2+3. Observe -> Predict -> Act ──
            if not simulated_mode and robot is not None and policy is not None:
                try:
                    joints, target, gripper_current = predict_real_action(active_task, device)
                    if joints.size:
                        last_joints = joints
                    predicted_action = target
                except Exception as e:
                    log.warning("Inference step failed: %s", e)
            else:
                # Simulated arm: joints slide toward the predicted targets
                if "uchop" in active_task or "grasp" in active_task or "pick" in active_task:
                    predicted_action = np.resize(
                        np.array([0.1, -0.2, 0.4, 0.1, 0.0, 1.2], dtype=np.float32), last_joints.shape)
                elif any(w in active_task for w in ("prenes", "najed", "move", "place")):
                    predicted_action = np.resize(
                        np.array([0.8, 0.3, -0.2, 0.5, 0.0, 0.0], dtype=np.float32), last_joints.shape)
                else:
                    predicted_action = np.zeros_like(last_joints)
                last_joints = last_joints + (predicted_action - last_joints) * 0.15

                # Simulated gripper load: squeezing raises the load past the trigger limit
                if ("uchop" in active_task or "grasp" in active_task or "pick" in active_task) \
                        and last_joints.size >= 6 and last_joints[5] > 0.8:
                    simulated_load = 280.0
                else:
                    simulated_load = 40.0 if active_task else 15.0
                gripper_current = simulated_load

            # ── 4. Termination triggers ──
            is_gripper_contact = gripper_current > PROTOCOL_B_LOAD_LIMIT

            n_pos = max(last_joints.size - 1, 1)  # exclude gripper from settle check
            positioning_deltas = np.abs(predicted_action[:n_pos] - last_joints[:n_pos])
            is_joints_settled = bool(np.all(positioning_deltas < PROTOCOL_A_THRESHOLD))

            if is_joints_settled:
                consecutive_settled_frames += 1
            else:
                consecutive_settled_frames = 0

            if int(start_tick * 10) % 15 == 0:
                log.info(
                    "Task: %s | Settled Frames: %d/5 | Gripper Load: %.1f mA | Max Delta: %.4f",
                    active_task, consecutive_settled_frames, gripper_current,
                    float(np.max(positioning_deltas)) if positioning_deltas.size else 0.0,
                )

            triggered = False
            trigger_reason = ""

            grasp_task = any(w in active_task for w in ("uchop", "grasp", "pick", "close"))
            if grasp_task and is_gripper_contact:
                triggered = True
                trigger_reason = f"Protocol B (Gripper Load Spike: {gripper_current:.1f} mA > {PROTOCOL_B_LOAD_LIMIT} mA)"
            elif consecutive_settled_frames >= PROTOCOL_A_PATIENCE:
                triggered = True
                max_d = float(np.max(positioning_deltas)) if positioning_deltas.size else 0.0
                trigger_reason = f"Protocol A (Arm Settled: max delta {max_d:.5f} < {PROTOCOL_A_THRESHOLD} rad)"

            if triggered:
                log.info("[TRIGGER] %s met! Freezing motors.", trigger_reason)
                print(f"[STATUS] TASK_DONE: {active_task} | {trigger_reason}", flush=True)
                state = "WAITING"
                active_task = ""

        # Print telemetry log (parsed by the frontend) ~ every other tick
        if int(time.time() * 10) % 2 == 0:
            n_pos = max(last_joints.size - 1, 1)
            positioning_deltas = np.abs(predicted_action[:n_pos] - last_joints[:n_pos])
            max_delta = float(np.max(positioning_deltas)) if positioning_deltas.size else 0.0
            print(
                f"[TELEMETRY] joints:{','.join(f'{x:.4f}' for x in last_joints)} | "
                f"target:{','.join(f'{x:.4f}' for x in predicted_action)} | "
                f"load:{gripper_current:.1f} | "
                f"settle:{consecutive_settled_frames}/5 | "
                f"max_delta:{max_delta:.5f}",
                flush=True
            )

        # Maintain frequency
        elapsed = time.time() - start_tick
        if elapsed < sleep_time:
            time.sleep(sleep_time - elapsed)


if __name__ == "__main__":
    try:
        main()
    finally:
        if robot is not None:
            try:
                robot.disconnect()
            except Exception:
                pass
