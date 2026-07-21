"""
Orchiday Web Server — FastAPI + WebSocket backend for the web UI.

Replaces Qt event loop with an async web server that serves:
- REST API for project/robot/skill CRUD
- WebSocket for real-time events (console, training, orchestration)
- Static files for the web frontend

Usage:
    python -m orchiday.server
"""

from __future__ import annotations

import os
os.environ["OPENCV_LOG_LEVEL"] = "OFF"

import asyncio
import json
import logging
import sys
import threading
from pathlib import Path
from typing import Any

# Ensure the src directory is on the path
_src_dir = Path(__file__).resolve().parent.parent
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Bootstrap Qt (headless) for event_bus compatibility ──────────────────
# We need a QCoreApplication for Qt signals to work, even without a GUI.
from PySide6.QtCore import QCoreApplication, QTimer

_qt_app = QCoreApplication.instance()
if _qt_app is None:
    _qt_app = QCoreApplication(sys.argv)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus
from orchiday.core.constants import (
    LEROBOT_SUPPORTED_ROBOTS,
    LEROBOT_TELEOP_TYPES,
    SUPPORTED_ARCHITECTURES,
    LATCH_STRATEGIES,
    APP_DISPLAY_NAME,
)
from orchiday.web_events import web_bridge

# ── Logging ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Data directory (cross-platform) ─────────────────────────────────────
def _get_data_dir() -> Path:
    """Return a cross-platform data directory for Orchiday."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "Orchiday" / "data"


DATA_DIR = _get_data_dir()


def _default_lerobot_dir() -> Path:
    """Resolve the LeRobot checkout directory (env var > global config > common paths)."""
    env_dir = os.environ.get("LEROBOT_DIR", "")
    if env_dir:
        return Path(env_dir)
    try:
        from orchiday.core.config import AppConfig
        cfg_dir = AppConfig().get("lerobot_dir", "")
        if cfg_dir:
            return Path(cfg_dir)
    except Exception:
        pass
    for d in (Path.home() / "robotics" / "lerobot", Path.home() / "lerobot"):
        if d.exists():
            return d
    return Path.home() / "lerobot"


LEROBOT_DIR = _default_lerobot_dir()

# ── Qt event pump ────────────────────────────────────────────────────────
# QProcess/QObject events MUST be processed on the thread that owns them —
# the main thread, which uvicorn's asyncio loop occupies. Pumping Qt events
# from inside that very loop is the only way subprocess output streaming,
# finished-handlers and cross-thread signal delivery actually work.

async def _qt_event_pump():
    while True:
        try:
            _qt_app.processEvents()
        except Exception:
            pass
        await asyncio.sleep(0.03)


from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    loop = asyncio.get_running_loop()
    # Give the WebSocket bridge the REAL running loop so broadcasts emitted
    # from Qt callbacks and background threads are marshalled correctly.
    web_bridge.set_loop(loop)
    pump_task = asyncio.create_task(_qt_event_pump())
    log.info("Qt event pump attached to the uvicorn asyncio loop.")
    yield
    pump_task.cancel()


# ── FastAPI App ──────────────────────────────────────────────────────────
app = FastAPI(title="Orchiday API", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend files
_web_dir = Path(__file__).resolve().parent.parent.parent / "web"
if _web_dir.exists():
    app.mount("/static", StaticFiles(directory=str(_web_dir)), name="static")

# ── Shared state ─────────────────────────────────────────────────────────
pm = ProjectManager()

# Lazy controller (initialized after Qt thread starts)
_controller = None


def _get_controller():
    global _controller
    if _controller is None:
        from orchiday.core.controller import OrchidayController
        _controller = OrchidayController(pm)
    return _controller


# ── Pydantic models ──────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    slug: str
    parent_dir: str = ""
    scene_description: str = ""


class RobotCreate(BaseModel):
    id: str
    type: str
    port: str = ""
    device_id: str = ""
    label: str = ""
    cameras: list[str] = []


class CameraCreate(BaseModel):
    id: str
    source: int | str = 0
    device_id: str = ""
    role: str = "overhead"
    resolution: list[int] = [640, 480]
    fps: int = 30


class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str = ""
    parent_slug: str | None = None


class SkillUpdate(BaseModel):
    name: str
    description: str = ""
    parent_slug: str | None = None


class ModelConfig(BaseModel):
    endpoint: str = "http://localhost:1234/v1"
    model_name: str = ""
    system_prompt: str | None = None


class TrainingConfig(BaseModel):
    skill_slug: str | None = None
    skills: list[str] | None = None
    policy_type: str = "diffusion"
    # Number of optimizer steps for lerobot-train (--steps). "epochs" kept as a
    # backward-compatible alias from older frontends (multiplied by 100).
    steps: int | None = None
    epochs: int = 100
    batch_size: int = 8
    device: str = "cuda"
    use_wandb: bool = False
    extra_args_str: str = ""



class TeleopConfig(BaseModel):
    robot_type: str
    robot_port: str
    robot_id: str
    teleop_type: str
    teleop_port: str
    teleop_id: str
    cameras: str = ""
    display_data: bool = True
    fps: int | None = None
    teleop_time_s: float | None = None


class ArmCalibrateConfig(BaseModel):
    robot_type: str = ""
    robot_id: str
    port: str = ""              # follower/robot port
    teleop_type: str = ""       # leader/teleop type (e.g. so100_leader)
    teleop_port: str = ""       # leader/teleop port


class ReplayConfig(BaseModel):
    robot_type: str
    dataset_name: str
    episode_index: int
    port: str = ""


class DirectInferConfig(BaseModel):
    robot_type: str
    policy_path: str
    skill_slug: str
    port: str = ""
    fps: int = 30


class SettingsConfig(BaseModel):
    dataset_storage_dir: str = ""
    lerobot_dir: str = ""
    python_path: str = ""
    robot_type: str = ""
    follower_port: str = ""
    leader_port: str = ""
    sequential_loop_interval: float | None = None
    language: str | None = None
    scene_description: str | None = None



# ── REST Endpoints ───────────────────────────────────────────────────────

@app.get("/")
async def serve_index():
    index_path = _web_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return JSONResponse({"error": "Frontend not found"}, status_code=404)


@app.get("/api/info")
async def get_info():
    return {
        "app": APP_DISPLAY_NAME,
        "version": "0.1.0",
        "data_dir": str(DATA_DIR),
        "lerobot_dir": str(LEROBOT_DIR),
        "supported_robots": LEROBOT_SUPPORTED_ROBOTS,
        "supported_teleop_types": LEROBOT_TELEOP_TYPES,
        "supported_architectures": SUPPORTED_ARCHITECTURES,
        "latch_strategies": LATCH_STRATEGIES,
    }


# ── Projects ─────────────────────────────────────────────────────────────

@app.get("/api/projects")
async def list_projects():
    return {"projects": pm.list_projects(), "recent": pm.recent_projects}


@app.post("/api/projects")
async def create_project(body: ProjectCreate):
    if not body.scene_description.strip():
        return JSONResponse(
            {"ok": False, "error": "scene_description is required — describe the physical workspace."},
            status_code=422)
    try:
        p_dir = Path(body.parent_dir) if body.parent_dir else None
        data = pm.create_project(body.name, body.slug, p_dir, scene_description=body.scene_description)
        return {"ok": True, "project": data}
    except FileExistsError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=409)


@app.post("/api/projects/open")
async def open_project(body: dict):
    path = body.get("path", "")
    try:
        data = pm.open_project(Path(path))
        _get_controller()  # Initialize controller on project open
        return {"ok": True, "project": data}
    except FileNotFoundError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=404)


@app.post("/api/projects/close")
async def close_project():
    pm.close_project()
    return {"ok": True}


@app.post("/api/projects/delete")
async def delete_project(body: dict):
    path_str = body.get("path", "")
    if not path_str:
        return JSONResponse({"ok": False, "error": "Path is required"}, status_code=400)
    try:
        from pathlib import Path
        pm.delete_project(Path(path_str))
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/project")
async def get_current_project():
    if pm.current_project:
        ctrl = _get_controller()
        active_cams = ctrl.camera_manager.active_cameras if ctrl else []
        return {
            "project": pm.current_project,
            "path": str(pm.current_path),
            "active_cameras": active_cams
        }
    return JSONResponse({"error": "No project open"}, status_code=404)


# ── Robots ───────────────────────────────────────────────────────────────

@app.post("/api/robots")
async def add_robot(body: RobotCreate):
    try:
        config = body.model_dump()
        pm.add_robot(config)
        return {"ok": True, "robot": config}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.delete("/api/robots/{robot_id}")
async def remove_robot(robot_id: str):
    try:
        pm.remove_robot(robot_id)
        return {"ok": True}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/robots/{robot_id}/calibrate")
async def calibrate_robot(robot_id: str):
    ctrl = _get_controller()
    robot = pm.get_robot(robot_id)
    if not robot:
        return JSONResponse({"error": "Robot not found"}, status_code=404)
    ctrl.lerobot_bridge.calibrate_robot(
        robot_type=robot.get("type", "so100"),
        robot_id=robot_id,
        port=robot.get("port", ""),
    )
    return {"ok": True}


@app.post("/api/hardware/calibrate")
async def calibrate_hardware(body: ArmCalibrateConfig):
    ctrl = _get_controller()
    ctrl.lerobot_bridge.calibrate_robot(
        robot_type=body.robot_type,
        robot_id=body.robot_id,
        port=body.port,
        teleop_type=body.teleop_type,
        teleop_port=body.teleop_port,
    )
    return {"ok": True}


# ── Cameras ──────────────────────────────────────────────────────────────

@app.post("/api/cameras")
async def add_camera(body: CameraCreate):
    try:
        config = body.model_dump()
        pm.add_camera(config)
        return {"ok": True, "camera": config}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.delete("/api/cameras/{camera_id}")
async def remove_camera(camera_id: str):
    try:
        pm.remove_camera(camera_id)
        return {"ok": True}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/cameras/{camera_id}/start")
async def start_camera(camera_id: str):
    event_bus.camera_started.emit(camera_id)
    return {"ok": True}


@app.post("/api/cameras/{camera_id}/stop")
async def stop_camera(camera_id: str):
    event_bus.camera_stopped.emit(camera_id)
    return {"ok": True}


@app.get("/api/cameras/{camera_id}/feed")
async def get_camera_feed(camera_id: str):
    import cv2
    ctrl = _get_controller()
    worker = ctrl.camera_manager.get_worker(camera_id) if ctrl else None
    if not worker:
        return JSONResponse({"error": f"Camera '{camera_id}' is not active or running"}, status_code=404)

    async def frame_generator():
        while True:
            worker._mutex.lock()
            frame = worker._last_frame.copy() if worker._last_frame is not None else None
            worker._mutex.unlock()

            if frame is not None:
                ret, jpeg = cv2.imencode(".jpg", frame)
                if ret:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
            await asyncio.sleep(0.04)  # ~25 FPS to conserve CPU

    from fastapi.responses import StreamingResponse
    return StreamingResponse(frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")


# ── Hardware Detection & Pairing ─────────────────────────────────────────

@app.get("/api/hardware/scan")
def scan_hardware():
    from orchiday.hardware.detection import detect_serial_ports, detect_cameras
    return {
        "ports": detect_serial_ports(),
        "cameras": detect_cameras()
    }


@app.get("/api/calibration/arm_visual_config")
def get_arm_visual_config(robot_id: str | None = None):
    """Joint calibration (motor id, range_min/max, homing_offset) for the
    leader + follower of a robot setup — drives the live arm visualization."""
    ctrl = _get_controller()
    return ctrl.calibration_manager.get_arm_visual_config(robot_id)


@app.post("/api/hardware/pair")
def pair_hardware():
    if not pm.current_project:
        return JSONResponse({"error": "No project open"}, status_code=404)

    from orchiday.hardware.detection import detect_serial_ports, detect_cameras
    scanned_ports = detect_serial_ports()
    scanned_cameras = detect_cameras()

    changed = False

    # Pair robots
    robots = pm.current_project.setdefault("robots", [])
    for robot in robots:
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
            else:
                event_bus.log_message.emit("WARN", f"Configured leader arm '{robot['id']}' device '{leader_dev_id}' not connected.")

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
            else:
                event_bus.log_message.emit("WARN", f"Configured follower arm '{robot['id']}' device '{follower_dev_id}' not connected.")

    # Pair cameras
    cameras = pm.current_project.setdefault("cameras", [])
    for camera in cameras:
        dev_id = camera.get("device_id")
        if dev_id:
            matching = [c for c in scanned_cameras if c["persistent_id"] == dev_id]
            if matching:
                matched_source = matching[0]["index"]
                if camera.get("source") != matched_source and str(camera.get("source")) != str(matched_source):
                    camera["source"] = matched_source
                    changed = True
                    event_bus.log_message.emit("SUCCESS", f"Auto-detected camera '{camera['id']}' at index {matched_source}")
            else:
                event_bus.log_message.emit("WARN", f"Configured camera '{camera['id']}' device '{dev_id}' not connected.")

    if changed:
        pm.save_project()
        # Broadcast updated project configuration
        event_bus.project_opened.emit(pm.current_project)

    return {"ok": True, "project": pm.current_project}


# ── Skills ───────────────────────────────────────────────────────────────

@app.post("/api/skills")
async def create_skill(body: SkillCreate):
    try:
        skill_data = body.model_dump()
        pm.add_skill(body.slug, skill_data)
        return {"ok": True, "skill": skill_data}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.put("/api/skills/{skill_slug}")
async def update_skill_endpoint(skill_slug: str, body: SkillUpdate):
    try:
        pm.update_skill(skill_slug, body.name, body.description, body.parent_slug)
        project = pm.current_project
        if project is None:
            return JSONResponse({"ok": False, "error": "No project open"}, status_code=400)
        skills_details = project.get("skills_details", {})
        return {"ok": True, "skill": skills_details.get(skill_slug)}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.delete("/api/skills/{skill_slug}")
async def delete_skill(skill_slug: str):
    try:
        pm.remove_skill(skill_slug)
        return {"ok": True}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


def _get_skill_slug_from_dataset(dataset_name: str) -> str:
    """Helper to extract skill_slug from dataset name, e.g. local/parent/step -> step."""
    parts = dataset_name.split("/")
    last_part = parts[-1]
    
    if pm.current_project and "skills" in pm.current_project:
        # Try exact match first
        if last_part in pm.current_project["skills"]:
            return last_part
        
        # Try stripping robot type prefixes (e.g. so100_, koch_, viperx_, soarm101_, etc.)
        for robot in pm.current_project.get("robots", []):
            r_type = robot.get("type", "")
            if r_type and last_part.startswith(f"{r_type}_"):
                candidate = last_part[len(r_type) + 1:]
                if candidate in pm.current_project["skills"]:
                    return candidate
                    
        # Check if any skill slug is a substring
        for skill in pm.current_project["skills"]:
            if last_part.endswith(skill):
                return skill
                
    return last_part


@app.get("/api/skills/{skill_slug:path}/dataset_info")
def get_skill_dataset_info(skill_slug: str):
    from pathlib import Path
    import json
    
    # Check if there is a parent skill
    parent_slug = None
    if pm.current_project and "skills_details" in pm.current_project:
        detail = pm.current_project["skills_details"].get(skill_slug, {})
        if not detail:
            # Maybe the slug has parent inside it, e.g. "parent/step"
            if "/" in skill_slug:
                parts = skill_slug.split("/")
                detail = pm.current_project["skills_details"].get(parts[-1], {})
        parent_slug = detail.get("parent_slug")

    # Build potential paths
    paths = []
    
    # 1. Custom directory if defined
    custom_dir = None
    if pm.current_project:
        custom_dir = pm.current_project.get("dataset_storage_dir")
        if custom_dir:
            custom_path = Path(custom_dir)
            if parent_slug:
                paths.append(custom_path / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1])
                paths.append(custom_path / "lerobot" / parent_slug / skill_slug.split("/")[-1])
                paths.append(custom_path / parent_slug / skill_slug.split("/")[-1])
            paths.append(custom_path / "lerobot" / "local" / skill_slug)
            paths.append(custom_path / "lerobot" / skill_slug)
            paths.append(custom_path / skill_slug)
            
            # Old name compatibility fallbacks in custom dir
            for robot in pm.current_project.get("robots", []):
                r_type = robot.get("type", "")
                if r_type:
                    paths.append(custom_path / "lerobot" / "local" / f"{r_type}_{skill_slug.split('/')[-1]}")
                    paths.append(custom_path / f"{r_type}_{skill_slug.split('/')[-1]}")

    # 2. Standard HuggingFace Cache fallback paths
    default_hf = Path.home() / ".cache" / "huggingface"
    if parent_slug:
        paths.append(default_hf / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1])
        paths.append(default_hf / "lerobot" / parent_slug / skill_slug.split("/")[-1])
    paths.append(default_hf / "lerobot" / "local" / skill_slug)
    paths.append(default_hf / "lerobot" / skill_slug)
    
    # Dynamic APP_DATA_DIR fallback
    from orchiday.core.constants import APP_DATA_DIR
    paths.append(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / skill_slug)
    if parent_slug:
        paths.append(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1])

    dataset_exists = False
    num_episodes = 0
    fps = 30
    size_bytes = 0
    
    for p in paths:
        if p.exists():
            dataset_exists = True
            for f in p.glob("**/*"):
                if f.is_file():
                    size_bytes += f.stat().st_size
                    
            info_json = p / "meta" / "info.json"
            if not info_json.exists():
                info_json = p / "info.json"
                
            if info_json.exists():
                try:
                    with open(info_json, "r", encoding="utf-8") as f_in:
                        meta = json.load(f_in)
                        num_episodes = meta.get("total_episodes", meta.get("num_episodes", 0))
                        fps = meta.get("fps", 30)
                except Exception:
                    pass
            break
            
    return {
        "exists": dataset_exists,
        "num_episodes": num_episodes,
        "fps": fps,
        "size_mb": round(size_bytes / (1024 * 1024), 2)
    }


# ── Portable bundles (project / datasets / models between machines) ──────

@app.get("/api/project/export")
def export_project_bundle(background_tasks: BackgroundTasks, datasets: int = 1, models: int = 0):
    """Export the current project as a portable .orchiday bundle."""
    import tempfile
    from orchiday.core import portability

    if not pm.current_project or not pm.current_path:
        return JSONResponse({"ok": False, "error": "No project open"}, status_code=400)

    ctrl = _get_controller()
    python_exe = ctrl.lerobot_bridge._python if ctrl else None
    slug = pm.current_project.get("slug", "project")
    zip_path = Path(tempfile.gettempdir()) / f"{slug}.orchiday"

    try:
        portability.build_project_bundle(
            project=pm.current_project,
            project_path=pm.current_path,
            dest_zip=zip_path,
            include_datasets=bool(datasets),
            include_models=bool(models),
            python_exe=python_exe,
        )
    except Exception as e:
        log.exception("Bundle export failed: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

    background_tasks.add_task(lambda p=str(zip_path): os.remove(p) if os.path.exists(p) else None)
    return FileResponse(path=str(zip_path), filename=f"{slug}.orchiday", media_type="application/zip")


@app.post("/api/project/import")
async def import_project_bundle_ep(request: Request):
    """Import a .orchiday bundle: places the project, restores datasets & models."""
    import tempfile
    from orchiday.core import portability

    body = await request.body()
    if not body:
        return JSONResponse({"ok": False, "error": "Empty upload"}, status_code=400)

    tmp_zip = Path(tempfile.gettempdir()) / "orchiday_import.orchiday"
    tmp_zip.write_bytes(body)
    try:
        result = portability.import_project_bundle(tmp_zip, pm._config.projects_dir)
        data = pm.open_project(Path(result["path"]))
        _get_controller()
        event_bus.project_opened.emit(pm.current_project)
        event_bus.log_message.emit("SUCCESS", f"Imported project '{result['slug']}' from bundle.")
        return {"ok": True, "project": data, "manifest": result.get("manifest", {})}
    except Exception as e:
        log.exception("Bundle import failed: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    finally:
        try:
            tmp_zip.unlink()
        except Exception:
            pass


@app.get("/api/skills/{skill_slug:path}/export_model")
def export_skill_model(skill_slug: str, background_tasks: BackgroundTasks):
    """Export just the trained checkpoint of one skill (for sending a model back)."""
    import tempfile
    from orchiday.core import portability

    if not pm.current_project:
        return JSONResponse({"ok": False, "error": "No project open"}, status_code=400)

    slug_leaf = skill_slug.split("/")[-1]
    zip_path = Path(tempfile.gettempdir()) / f"{slug_leaf}_model.orchiday"
    try:
        portability.build_model_bundle(pm.current_project, slug_leaf, zip_path)
    except FileNotFoundError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=404)
    except Exception as e:
        log.exception("Model export failed: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

    background_tasks.add_task(lambda p=str(zip_path): os.remove(p) if os.path.exists(p) else None)
    return FileResponse(path=str(zip_path), filename=f"{slug_leaf}_model.orchiday", media_type="application/zip")


@app.post("/api/models/import")
async def import_model_bundle_ep(request: Request):
    """Import a trained checkpoint bundle back onto this machine."""
    import tempfile
    from orchiday.core import portability

    body = await request.body()
    if not body:
        return JSONResponse({"ok": False, "error": "Empty upload"}, status_code=400)
    tmp_zip = Path(tempfile.gettempdir()) / "orchiday_model_import.orchiday"
    tmp_zip.write_bytes(body)
    try:
        restored = portability.import_model_bundle(tmp_zip, pm.current_project)
        event_bus.log_message.emit("SUCCESS", f"Imported model(s): {', '.join(restored)}")
        return {"ok": True, "restored": restored}
    except Exception as e:
        log.exception("Model import failed: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    finally:
        try:
            tmp_zip.unlink()
        except Exception:
            pass


@app.get("/api/project/export_datasets")
def export_project_datasets(background_tasks: BackgroundTasks):
    from pathlib import Path
    import os
    import zipfile
    import tempfile

    if not pm.current_project:
        return JSONResponse({"ok": False, "error": "No project open"}, status_code=400)
    
    skills = pm.current_project.get("skills", [])
    details = pm.current_project.get("skills_details", {})
    
    to_zip = []
    
    for skill_slug in skills:
        detail = details.get(skill_slug, {})
        parent_slug = detail.get("parent_slug")
        
        paths_to_check = []
        custom_dir = pm.current_project.get("dataset_storage_dir")
        if custom_dir:
            custom_path = Path(custom_dir)
            if parent_slug:
                paths_to_check.append((custom_path / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1], f"lerobot/local/{parent_slug}/{skill_slug.split('/')[-1]}"))
                paths_to_check.append((custom_path / "lerobot" / parent_slug / skill_slug.split("/")[-1], f"lerobot/{parent_slug}/{skill_slug.split('/')[-1]}"))
                paths_to_check.append((custom_path / parent_slug / skill_slug.split("/")[-1], f"{parent_slug}/{skill_slug.split('/')[-1]}"))
            paths_to_check.append((custom_path / "lerobot" / "local" / skill_slug, f"lerobot/local/{skill_slug}"))
            paths_to_check.append((custom_path / "lerobot" / skill_slug, f"lerobot/{skill_slug}"))
            paths_to_check.append((custom_path / skill_slug, f"{skill_slug}"))
            
            for robot in pm.current_project.get("robots", []):
                r_type = robot.get("type", "")
                if r_type:
                    paths_to_check.append((custom_path / "lerobot" / "local" / f"{r_type}_{skill_slug.split('/')[-1]}", f"lerobot/local/{r_type}_{skill_slug.split('/')[-1]}"))
                    paths_to_check.append((custom_path / f"{r_type}_{skill_slug.split('/')[-1]}", f"{r_type}_{skill_slug.split('/')[-1]}"))

        default_hf = Path.home() / ".cache" / "huggingface"
        if parent_slug:
            paths_to_check.append((default_hf / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1], f"lerobot/local/{parent_slug}/{skill_slug.split('/')[-1]}"))
            paths_to_check.append((default_hf / "lerobot" / parent_slug / skill_slug.split("/")[-1], f"lerobot/{parent_slug}/{skill_slug.split('/')[-1]}"))
        paths_to_check.append((default_hf / "lerobot" / "local" / skill_slug, f"lerobot/local/{skill_slug}"))
        paths_to_check.append((default_hf / "lerobot" / skill_slug, f"lerobot/{skill_slug}"))

        from orchiday.core.constants import APP_DATA_DIR
        paths_to_check.append((APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / skill_slug, f"lerobot/local/{skill_slug}"))
        if parent_slug:
            paths_to_check.append((APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / parent_slug / skill_slug.split("/")[-1], f"lerobot/local/{parent_slug}/{skill_slug.split('/')[-1]}"))

        for p, arcname in paths_to_check:
            if p.exists() and p.is_dir():
                to_zip.append((p, arcname))
                break
                
    if not to_zip:
        return JSONResponse({"ok": False, "error": "No dataset directories found on disk to export"}, status_code=404)
        
    temp_dir = tempfile.gettempdir()
    zip_filename = f"orchiday_datasets_{pm.current_project['slug']}.zip"
    zip_path = os.path.join(temp_dir, zip_filename)
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for disk_path, arc_dir in to_zip:
                for root, dirs, files in os.walk(disk_path):
                    for file in files:
                        file_path = os.path.join(root, file)
                        rel_path = os.path.relpath(file_path, disk_path)
                        zip_file.write(file_path, os.path.join(arc_dir, rel_path))
                        
        def remove_file(path: str):
            try:
                os.remove(path)
            except Exception:
                pass
                
        background_tasks.add_task(remove_file, zip_path)
        
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip"
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"Failed to create ZIP: {str(e)}"}, status_code=500)


@app.get("/api/skills/{skill_slug:path}/policy_status")
async def get_skill_policy_status(skill_slug: str):
    from pathlib import Path
    robots = pm.current_project.get("robots", []) if pm.current_project else []
    r_type = robots[0].get("type", "so100") if robots else "so100"
    dataset_slug = f"{r_type}_{skill_slug.split('/')[-1]}"
    policy_type = pm.current_project.get("policy_architecture", "diffusion") if pm.current_project else "diffusion"
    
    custom_dir = pm.current_project.get("dataset_storage_dir") if pm.current_project else None
    
    paths = []
    if custom_dir:
        paths.append(Path(custom_dir) / "outputs" / "training" / f"{dataset_slug}_{policy_type}")
        paths.append(Path(custom_dir) / f"{dataset_slug}_{policy_type}")
    
    from orchiday.core.constants import APP_DATA_DIR
    paths.append(APP_DATA_DIR / "data" / "outputs" / "training" / f"{dataset_slug}_{policy_type}")
    paths.append(Path.home() / "OrchidayProjects" / pm.current_project.get("slug", "") / "models" / "policies" / f"{dataset_slug}_{policy_type}" if pm.current_project else None)
    paths.append(Path.home() / ".cache" / "huggingface" / "lerobot" / "outputs" / "training" / f"{dataset_slug}_{policy_type}")
    paths.append(Path.home() / "lerobot" / "outputs" / "training" / f"{dataset_slug}_{policy_type}")
    
    exists = False
    for p in paths:
        if p and p.exists():
            exists = True
            break
            
    return {"exists": exists}


@app.post("/api/skills/{skill_slug:path}/delete_episode")
def delete_skill_episode(skill_slug: str, body: dict):
    episode_idx = body.get("episode_index", -1)
    if episode_idx < 0:
        return JSONResponse({"ok": False, "error": "Invalid episode index"}, status_code=400)
    
    import subprocess

    dataset_id = f"local/{skill_slug}"
    ctrl = _get_controller()
    lerobot_python = ctrl.lerobot_bridge._python

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    if pm.current_project:
        custom_dir = pm.current_project.get("dataset_storage_dir")
        if custom_dir:
            env["HF_HOME"] = str(custom_dir)

    # LeRobot >= 0.5 ships `lerobot-edit-dataset` for in-place episode deletion
    cmd = [
        lerobot_python, "-m", "lerobot.scripts.lerobot_edit_dataset",
        f"--repo_id={dataset_id}",
        "--operation.type=delete_episodes",
        f"--operation.episode_indices=[{episode_idx}]",
        "--push_to_hub=false",
    ]

    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=120
        )
        if res.returncode == 0:
            event_bus.log_message.emit("SUCCESS", f"Episode {episode_idx} deleted from {dataset_id}")
            return {"ok": True}
        err = (res.stdout or "") + "\n" + (res.stderr or "")
        return JSONResponse({"ok": False, "error": f"Failed to delete: {err.strip()[-800:]}"}, status_code=400)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Teleoperation ────────────────────────────────────────────────────────

@app.post("/api/teleop/start")
async def start_teleop(body: TeleopConfig):
    ctrl = _get_controller()
    extra_args = {}
    if body.fps is not None:
        extra_args["fps"] = body.fps
    if body.teleop_time_s is not None:
        extra_args["teleop_time_s"] = body.teleop_time_s
    ctrl.start_teleop_workflow(
        robot_type=body.robot_type,
        robot_port=body.robot_port,
        robot_id=body.robot_id,
        teleop_type=body.teleop_type,
        teleop_port=body.teleop_port,
        teleop_id=body.teleop_id,
        cameras=body.cameras,
        display_data=body.display_data,
        extra_args=extra_args,
    )
    return {"ok": True}


@app.post("/api/teleop/stop")
async def stop_teleop():
    ctrl = _get_controller()
    ctrl.stop_teleop_workflow()
    return {"ok": True}


# ── Replay ───────────────────────────────────────────────────────────────

@app.post("/api/replay/start")
async def start_replay(body: ReplayConfig):
    ctrl = _get_controller()
    
    # Increment execution count
    skill_slug = _get_skill_slug_from_dataset(body.dataset_name)
    pm.increment_skill_execution_count(skill_slug)
    
    robots = pm.current_project.get("robots", []) if pm.current_project else []
    robot = robots[0] if robots else {}
    ctrl.lerobot_bridge.start_replay(
        robot_type=body.robot_type,
        dataset_name=body.dataset_name,
        episode_index=body.episode_index,
        port=body.port or robot.get("follower_port") or robot.get("port", ""),
        robot_id=robot.get("follower_id") or robot.get("id") or "my_follower_arm",
    )
    return {"ok": True}


# ── Direct Inference / Evaluation ────────────────────────────────────────

@app.post("/api/inference/start")
async def start_direct_inference(body: DirectInferConfig):
    ctrl = _get_controller()
    
    # Increment execution count
    pm.increment_skill_execution_count(body.skill_slug)
    
    ctrl.start_direct_inference(
        robot_type=body.robot_type,
        policy_path=body.policy_path,
        skill_slug=body.skill_slug,
        port=body.port,
        fps=body.fps,
    )
    return {"ok": True}


@app.post("/api/inference/stop")
async def stop_direct_inference(body: dict):
    skill = body.get("skill_slug", "")
    ctrl = _get_controller()
    ctrl.stop_direct_inference(skill)
    return {"ok": True}


class InferenceCommandConfig(BaseModel):
    skill_slug: str
    command: str

@app.post("/api/inference/command")
async def send_inference_command(body: InferenceCommandConfig):
    ctrl = _get_controller()
    ok = ctrl.send_inference_command(body.skill_slug, body.command)
    return {"ok": ok}


# ── Recording ────────────────────────────────────────────────────────────

class RecordingConfig(BaseModel):
    robot_type: str
    dataset_name: str
    skill_slug: str
    num_episodes: int = 50
    fps: int = 30
    port: str = ""
    single_task: str = ""
    episode_time_s: float = 60
    reset_time_s: float = 10
    push_to_hub: bool = False
    display_data: bool = False
    resume: bool = False
    extra_args_str: str = ""

@app.post("/api/recording/start")
async def start_recording(body: RecordingConfig):
    ctrl = _get_controller()

    # ── Strict HW Validations ──
    project = pm.current_project
    if not project:
        return {"ok": False, "error": "No active project"}

    robots = project.get("robots", [])
    if not robots:
        return {"ok": False, "error": "No robots configured"}

    robot = robots[0]
    follower_port = body.port or robot.get("follower_port") or robot.get("port", "")
    if not follower_port:
        return {"ok": False, "error": "Follower robot port is missing"}

    leader_port = robot.get("leader_port") or project.get("leader_port", "")
    if not leader_port:
        return {"ok": False, "error": "Leader (teleop) port is missing — recording needs a teleoperator arm."}

    cameras = robot.get("cameras", [])
    if not cameras:
        return {"ok": False, "error": "No cameras assigned. You must assign at least one camera."}

    robot_type = body.robot_type or robot.get("follower_type") or robot.get("type", "so100_follower")
    leader_type = robot.get("leader_type") or robot_type.replace("_follower", "_leader")

    # Enforce strict dataset path naming based on parent skill slug
    parent_slug = ""
    skills_details = project.get("skills_details", {})
    if body.skill_slug in skills_details:
        parent_slug = skills_details[body.skill_slug].get("parent_slug", "")

    if parent_slug:
        enforced_dataset_name = f"local/{parent_slug}/{body.skill_slug}"
    else:
        enforced_dataset_name = f"local/{body.skill_slug}"

    # Default the mandatory task annotation to the skill description/name
    single_task = body.single_task
    if not single_task:
        detail = skills_details.get(body.skill_slug, {})
        single_task = detail.get("description") or detail.get("name") or body.skill_slug.replace("_", " ")

    # Increment execution count
    pm.increment_skill_execution_count(body.skill_slug)

    ctrl.lerobot_bridge.start_recording(
        robot_type=robot_type,
        dataset_name=enforced_dataset_name,
        skill_slug=body.skill_slug,
        num_episodes=body.num_episodes,
        fps=body.fps,
        port=follower_port,
        robot_id=robot.get("follower_id") or robot.get("id") or "my_follower_arm",
        teleop_type=leader_type,
        teleop_port=leader_port,
        teleop_id=robot.get("leader_id") or "my_leader_arm",
        single_task=single_task,
        episode_time_s=body.episode_time_s,
        reset_time_s=body.reset_time_s,
        push_to_hub=body.push_to_hub,
        display_data=body.display_data,
        camera_ids=cameras,
        resume=body.resume,
        extra_args_str=body.extra_args_str
    )
    return {"ok": True}


@app.post("/api/recording/stop")
async def stop_recording(body: dict):
    skill = body.get("skill_slug", "")
    ctrl = _get_controller()
    ctrl.lerobot_bridge._kill_process(f"record_{skill}")
    return {"ok": True}


@app.post("/api/recording/action")
async def recording_action(body: dict):
    action = body.get("action", "")
    try:
        import keyboard  # type: ignore
        if action == "next":
            keyboard.send("right")
        elif action == "reset":
            keyboard.send("left")
        elif action == "stop":
            keyboard.send("esc")
        return {"ok": True}
    except Exception as e:
        log.warning("Failed to simulate global keyboard press: %s", e)
        event_bus.log_message.emit("WARN", f"Global keypress simulation failed: {e}")
        return {"ok": False, "error": str(e)}


# ── Step marks: sub-task boundary flags during recording ────────────────────

def _dataset_name_for_skill(skill_slug: str) -> str:
    """Enforced local dataset repo_id for a skill (parent-aware)."""
    parent_slug = ""
    if pm.current_project:
        details = pm.current_project.get("skills_details", {})
        parent_slug = details.get(skill_slug, {}).get("parent_slug", "") or ""
    return f"local/{parent_slug}/{skill_slug}" if parent_slug else f"local/{skill_slug}"


def _ordered_sub_steps(skill_slug: str) -> list[dict]:
    """Ordered child steps of a parent skill as splitter step descriptors."""
    project = pm.current_project or {}
    details = project.get("skills_details", {})
    steps = []
    for s in project.get("skills", []):  # project skill order defines step order
        d = details.get(s, {})
        if d.get("parent_slug") == skill_slug:
            steps.append({
                "slug": s,
                "repo_id": f"local/{skill_slug}/{s}",
                "task": d.get("description") or d.get("name") or s.replace("_", " "),
            })
    return steps


@app.post("/api/recording/mark_step")
async def mark_recording_step(body: dict):
    """Flag a sub-task boundary at the current moment of an active recording."""
    ctrl = _get_controller()
    skill = body.get("skill_slug", "")
    if not skill:
        return {"ok": False, "error": "skill_slug is required"}
    return ctrl.lerobot_bridge.mark_step(
        skill, int(body.get("step", 0)), str(body.get("label", "")))


@app.post("/api/recording/undo_mark")
async def undo_recording_mark(body: dict):
    """Remove the last step mark of the current episode (misclick recovery)."""
    ctrl = _get_controller()
    skill = body.get("skill_slug", "")
    if not skill:
        return {"ok": False, "error": "skill_slug is required"}
    return ctrl.lerobot_bridge.undo_step_mark(skill)


@app.get("/api/skills/{skill_slug:path}/step_marks")
async def get_step_marks(skill_slug: str):
    """Step marks for a skill — live during recording, else the persisted file."""
    ctrl = _get_controller()
    marks = ctrl.lerobot_bridge.get_step_marks(skill_slug, _dataset_name_for_skill(skill_slug))
    marks["steps"] = _ordered_sub_steps(skill_slug)
    return {"ok": True, **marks}


@app.post("/api/datasets/split_steps")
async def split_dataset_steps(body: dict):
    """Split a parent skill's recorded dataset into per-step sub-datasets.

    The full dataset stays untouched (baseline policy training); each ordered
    sub-skill receives its own derived dataset for per-step model training.
    """
    ctrl = _get_controller()
    skill = body.get("skill_slug", "")
    if not skill:
        return {"ok": False, "error": "skill_slug is required"}
    steps = _ordered_sub_steps(skill)
    if len(steps) < 2:
        return {"ok": False, "error": "Skill needs at least 2 ordered sub-steps to split by marks."}
    ok = ctrl.lerobot_bridge.start_dataset_split(
        source_repo_id=_dataset_name_for_skill(skill),
        skill_slug=skill,
        steps=steps,
        require_complete=bool(body.get("require_complete", True)),
    )
    return {"ok": ok}


@app.get("/api/orchestration/runs")
async def get_orchestration_runs(limit: int = 50):
    """List persisted orchestration run logs of the open project."""
    if not pm.current_project or not pm.current_path:
        return {"ok": False, "error": "No active project", "runs": []}
    from orchiday.orchestration.run_logger import list_runs
    return {"ok": True, "runs": list_runs(pm.current_path, limit=limit)}


# NOTE: The legacy /api/recording/tag_episode endpoint (direct parquet
# rewriting) was replaced by the step-mark + dataset-splitter pipeline:
# POST /api/recording/mark_step  +  POST /api/datasets/split_steps.


# ── Training ─────────────────────────────────────────────────────────────

@app.post("/api/training/start")
async def start_training(body: TrainingConfig):
    # Resolve optimizer steps: prefer explicit steps, fall back to legacy epochs*100
    steps = body.steps if body.steps and body.steps > 0 else body.epochs * 100
    if pm.current_project:
        pm.current_project["policy_architecture"] = body.policy_type
        pm.current_project["active_training_config"] = {
            "steps": steps,
            "epochs": body.epochs,
            "batch_size": body.batch_size,
            "device": body.device,
            "use_wandb": body.use_wandb,
            "extra_args_str": body.extra_args_str
        }
        pm.save_project()
    
    ctrl = _get_controller()
    if ctrl:
        slugs = []
        if body.skills:
            slugs = body.skills
        elif body.skill_slug:
            slugs = [body.skill_slug]
        
        if slugs:
            ctrl.start_training_queue(slugs)
            return {"ok": True}
        else:
            return JSONResponse({"ok": False, "error": "No skills specified for training"}, status_code=400)
    return JSONResponse({"ok": False, "error": "Controller not initialized"}, status_code=500)


@app.post("/api/training/stop")
async def stop_training(body: dict):
    skill = body.get("skill_slug", "")
    event_bus.training_stopped.emit(skill)
    return {"ok": True}


@app.get("/api/training/status")
async def get_training_status():
    ctrl = _get_controller()
    if ctrl:
        return {
            "active_skill": ctrl._current_training_skill,
            "queue": ctrl._training_queue
        }
    return {"active_skill": None, "queue": []}


# ── Settings ─────────────────────────────────────────────────────────────

@app.post("/api/settings")
async def save_settings(body: SettingsConfig):
    from orchiday.core.config import AppConfig
    cfg = AppConfig()
    if body.lerobot_dir:
        cfg.set("lerobot_dir", body.lerobot_dir.strip())
    if body.python_path:
        cfg.set("python_path", body.python_path.strip())
    # UI language is a global preference (applies regardless of open project)
    if body.language in ("cs", "en"):
        cfg.set("language", body.language)

    if not pm.current_project:
        return {"ok": True}

    if body.dataset_storage_dir is not None:
        pm.current_project["dataset_storage_dir"] = body.dataset_storage_dir.strip()
    if body.scene_description is not None:
        pm.current_project["scene_description"] = body.scene_description.strip()
    if body.robot_type is not None:
        pm.current_project["robot_type"] = body.robot_type.strip()
    if body.follower_port is not None:
        pm.current_project["follower_port"] = body.follower_port.strip()
    if body.leader_port is not None:
        pm.current_project["leader_port"] = body.leader_port.strip()
    if body.sequential_loop_interval is not None:
        if "orchestration" not in pm.current_project:
            pm.current_project["orchestration"] = {}
        pm.current_project["orchestration"]["sequential_loop_interval"] = body.sequential_loop_interval
    pm.save_project()
    # Broadcast project opened to sync state with frontend
    event_bus.project_opened.emit(pm.current_project)
    return {"ok": True}


@app.get("/api/settings/sysinfo")
def get_sysinfo():
    import subprocess
    from orchiday.core.config import AppConfig
    cfg = AppConfig()
    ctrl = _get_controller()
    python_path = cfg.get("python_path") or ctrl.lerobot_bridge._python
    lerobot_dir = cfg.get("lerobot_dir") or str(LEROBOT_DIR)

    # 1. Python version
    py_version = "Neznámá"
    try:
        res = subprocess.run([python_path, "--version"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            py_version = res.stdout.strip().replace("Python ", "")
    except Exception:
        pass

    # 2. LeRobot version
    lerobot_version = "Nenalezeno"
    try:
        res = subprocess.run([python_path, "-c", "import lerobot; print(lerobot.__version__)"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            lerobot_version = res.stdout.strip()
    except Exception:
        pass

    # 3. Conda env info
    conda_env = "Neznámé"
    try:
        res = subprocess.run([python_path, "-c", "import os; print(os.environ.get('CONDA_DEFAULT_ENV', ''))"], capture_output=True, text=True, timeout=5)
        val = res.stdout.strip()
        if val:
            conda_env = val
        else:
            if "envs/" in python_path:
                parts = python_path.split("envs/")
                conda_env = parts[1].split("/")[0]
    except Exception:
        pass

    # 4. Miniconda / Anaconda path check
    miniconda_path = "Nenalezeno"
    possible_paths = [
        Path.home() / "miniconda3",
        Path.home() / "anaconda3",
        Path("/opt/miniconda3"),
    ]
    for p in possible_paths:
        if p.exists():
            miniconda_path = str(p)
            break

    return {
        "python_path": python_path,
        "lerobot_dir": lerobot_dir,
        "python_version": py_version,
        "lerobot_version": lerobot_version,
        "conda_env": conda_env,
        "miniconda_path": miniconda_path,
    }


# ── Models (AI config) ──────────────────────────────────────────────────

@app.post("/api/models/{role}")
async def configure_model(role: str, body: ModelConfig):
    try:
        config = body.model_dump(exclude_none=True)
        pm.update_model_config(role, config)
        return {"ok": True}
    except RuntimeError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/utils/browse_directory")
def browse_directory():
    import platform
    import subprocess
    import sys
    import os

    system = platform.system().lower()
    directory = None

    # Try native OS dialogs first for modern look on all OS
    try:
        if "darwin" in system:
            script = 'POSIX path of (choose folder with prompt "Vyberte adresář LeRobot")'
            proc = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=60
            )
            if proc.returncode == 0:
                directory = proc.stdout.strip()
        elif "linux" in system:
            # Try Zenity
            proc = subprocess.run(
                ["zenity", "--file-selection", "--directory", "--title=Vyberte adresář LeRobot"],
                capture_output=True,
                text=True,
                timeout=60
            )
            if proc.returncode == 0:
                directory = proc.stdout.strip()
            else:
                # Try Kdialog
                proc = subprocess.run(
                    ["kdialog", "--getexistingdirectory"],
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                if proc.returncode == 0:
                    directory = proc.stdout.strip()
        elif "windows" in system or "nt" in system:
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                directory = filedialog.askdirectory(title="Vyberte adresář LeRobot")
                root.destroy()
            except Exception as tk_err:
                log.warning("Tkinter folder dialog failed, trying powershell fallback: %s", tk_err)
                ps_cmd = (
                    "Add-Type -AssemblyName System.Windows.Forms; "
                    "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                    "$f.Description = 'Vyberte adresář LeRobot'; "
                    "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"
                )
                proc = subprocess.run(
                    ["powershell", "-Command", ps_cmd],
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                if proc.returncode == 0:
                    directory = proc.stdout.strip()
    except Exception as e:
        log.warning("Nativní dialog pro výběr složky selhal: %s", e)

    # Fallback to Tkinter (for other platform options if native OS dialog failed)
    if not directory:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            directory = filedialog.askdirectory(title="Vyberte adresář LeRobot")
            root.destroy()
        except Exception as e:
            log.debug("General Tkinter fallback skipped or failed: %s", e)

    if not directory:
        return {"ok": True, "path": ""}
        
    return {"ok": True, "path": directory}


# ── Orchestration ────────────────────────────────────────────────────────

@app.post("/api/orchestrate")
async def orchestrate(body: dict):
    instruction = body.get("instruction", "")
    if not instruction:
        return JSONResponse({"error": "No instruction"}, status_code=400)
    event_bus.orchestration_requested.emit(instruction)
    return {"ok": True}


# ── Terminal ─────────────────────────────────────────────────────────────

@app.post("/api/terminal")
async def terminal_command(body: dict):
    cmd = body.get("command", "")
    event_bus.terminal_command_requested.emit(cmd)
    return {"ok": True}


# ── LeRobot CLI tools, dataset editing & simulation evaluation ──────────

class ToolRunConfig(BaseModel):
    tool: str
    args: list[str] = []


@app.post("/api/tools/run")
async def run_lerobot_tool(body: ToolRunConfig):
    """Run a whitelisted LeRobot CLI utility in the persistent terminal."""
    ctrl = _get_controller()
    ok = ctrl.lerobot_bridge.run_tool(body.tool, body.args)
    if not ok:
        return JSONResponse({"ok": False, "error": f"Unknown or failed tool: {body.tool}"}, status_code=400)
    return {"ok": True}


class HFLoginConfig(BaseModel):
    token: str


@app.post("/api/tools/hf-login")
async def hf_login(body: HFLoginConfig):
    """Log in to the Hugging Face Hub without echoing the token to the console."""
    import subprocess
    ctrl = _get_controller()
    token = body.token.strip()
    if not token:
        return JSONResponse({"ok": False, "error": "Token nesmí být prázdný."}, status_code=400)
    try:
        res = subprocess.run(
            [ctrl.lerobot_bridge._python, "-c",
             "import sys; from huggingface_hub import login; login(token=sys.stdin.read().strip(), add_to_git_credential=False); print('LOGIN_OK')"],
            input=token, capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0 and "LOGIN_OK" in res.stdout:
            event_bus.log_message.emit("SUCCESS", "Přihlášení k Hugging Face Hub proběhlo úspěšně.")
            return {"ok": True}
        err = (res.stderr or res.stdout).strip()[-500:]
        return JSONResponse({"ok": False, "error": err or "Login failed"}, status_code=400)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


class DatasetEditRequest(BaseModel):
    operation: str
    repo_id: str = ""
    new_repo_id: str = ""
    params: dict = {}


@app.post("/api/datasets/edit")
async def dataset_edit(body: DatasetEditRequest):
    """Run a lerobot-edit-dataset operation (delete episodes, split, merge, ...)."""
    ctrl = _get_controller()
    ok = ctrl.lerobot_bridge.run_dataset_edit(
        operation=body.operation,
        repo_id=body.repo_id,
        new_repo_id=body.new_repo_id,
        params=body.params,
    )
    if not ok:
        return JSONResponse({"ok": False, "error": "Operation rejected — check the console log."}, status_code=400)
    return {"ok": True}


class DatasetPushRequest(BaseModel):
    repo_id: str       # local dataset id, e.g. local/pick_cube
    hub_id: str        # target hub id, e.g. username/pick_cube
    private: bool = True


@app.post("/api/datasets/push")
async def dataset_push(body: DatasetPushRequest):
    """Push a local dataset to the Hugging Face Hub (runs in the terminal console)."""
    ctrl = _get_controller()
    if "/" not in body.hub_id:
        return JSONResponse({"ok": False, "error": "Hub ID musí mít tvar 'uzivatel/nazev'."}, status_code=400)
    py = (
        "from lerobot.datasets.lerobot_dataset import LeRobotDataset; "
        f"ds = LeRobotDataset('{body.repo_id}'); "
        f"ds.push_to_hub(repo_id='{body.hub_id}', private={body.private}); "
        "print('PUSH_DONE')"
    )
    cmd = f'"{ctrl.lerobot_bridge._python}" -c "{py}"'
    ctrl.lerobot_bridge.run_custom_command(cmd)
    return {"ok": True}


class SimEvalRequest(BaseModel):
    policy_path: str
    env_type: str = "pusht"
    n_episodes: int = 10
    batch_size: int = 10
    device: str = "cuda"


@app.post("/api/eval/start")
async def start_sim_eval(body: SimEvalRequest):
    """Evaluate a trained policy in a simulated environment via lerobot-eval."""
    ctrl = _get_controller()
    ok = ctrl.lerobot_bridge.start_eval(
        policy_path=body.policy_path,
        env_type=body.env_type,
        n_episodes=body.n_episodes,
        batch_size=body.batch_size,
        device=body.device,
    )
    if not ok:
        return JSONResponse({"ok": False, "error": "Evaluation rejected — check the console log."}, status_code=400)
    return {"ok": True}


@app.get("/api/datasets/list")
async def list_datasets():
    """List local datasets derived from the project's skill tree, with on-disk status."""
    if not pm.current_project:
        return {"datasets": []}
    skills = pm.current_project.get("skills", [])
    details = pm.current_project.get("skills_details", {})
    ctrl = _get_controller()
    out = []
    for slug in skills:
        detail = details.get(slug, {})
        parent = detail.get("parent_slug") or ""
        repo_id = f"local/{parent}/{slug}" if parent else f"local/{slug}"
        out.append({
            "skill": slug,
            "name": detail.get("name", slug),
            "parent": parent,
            "repo_id": repo_id,
            "exists": ctrl.lerobot_bridge._verify_dataset_exists(repo_id),
        })
    return {"datasets": out}


class SetupCameraConfig(BaseModel):
    id: str
    source: int | str
    device_id: str
    role: str

class SetupFinishConfig(BaseModel):
    project_name: str
    robot_type: str
    lerobot_option: str  # "connect" or "install"
    lerobot_path: str = ""
    leader_port: str = ""
    leader_device_id: str = ""
    follower_port: str = ""
    follower_device_id: str = ""
    cameras: list[SetupCameraConfig] = []
    scene_description: str = ""

@app.post("/api/setup/finish")
async def setup_finish(body: SetupFinishConfig):
    import re
    if not body.scene_description.strip():
        return JSONResponse(
            {"ok": False, "error": "scene_description is required — describe the physical workspace."},
            status_code=422)
    # 1. Generate slug from project name
    slug = re.sub(r'[^a-z0-9_]', '', body.project_name.lower().replace(" ", "_").replace("-", "_"))
    if not slug:
        slug = "project"
    
    # Check if project directory already exists, if so, append suffix
    original_slug = slug
    counter = 1
    while (pm._config.projects_dir / slug).exists():
        slug = f"{original_slug}_{counter}"
        counter += 1

    try:
        # Create project
        project_data = pm.create_project(body.project_name, slug, scene_description=body.scene_description)
        
        # Open it so it is the active one
        pm.open_project(pm._config.projects_dir / slug)
        
        # Configure LeRobot dir if provided
        lerobot_dir = body.lerobot_path.strip() if body.lerobot_path else str(LEROBOT_DIR)
        if lerobot_dir and pm.current_project is not None:
            pm.current_project["lerobot_dir"] = lerobot_dir
            # also save in settings
            pm.current_project["dataset_storage_dir"] = str(Path(lerobot_dir).parent / "data")
        
        # Add robot config — map free-form wizard labels to valid LeRobot >= 0.4 types
        raw = body.robot_type.lower()
        if raw in {r["type"] for r in LEROBOT_SUPPORTED_ROBOTS}:
            r_type = raw
        elif "101" in raw:
            r_type = "so101_follower"
        elif "koch" in raw:
            r_type = "koch_follower"
        elif "openarm" in raw:
            r_type = "openarm_follower"
        elif "lekiwi" in raw:
            r_type = "lekiwi"
        elif "reachy" in raw:
            r_type = "reachy2"
        else:
            r_type = "so100_follower"

        base_family = r_type.replace("_follower", "")
        leader_type = f"{base_family}_leader" if r_type.endswith("_follower") else "so100_leader"

        robot_cfg = {
            "id": "my_robot",
            "type": r_type,
            "port": body.follower_port or "",
            "device_id": body.follower_device_id or "",
            "label": f"LeRobot Setup: F1/L1",
            "follower_type": r_type,
            "follower_port": body.follower_port or "",
            "follower_id": "my_follower_arm",
            "follower_device_id": body.follower_device_id or "",
            "leader_type": leader_type,
            "leader_port": body.leader_port or "",
            "leader_id": "my_leader_arm",
            "leader_device_id": body.leader_device_id or "",
            "fps": 30,
            "baudrate": 1000000,
            # Assign all wizard-configured cameras to this robot so recording works out of the box
            "cameras": [cam.id for cam in body.cameras],
            "safety": {
                "slew_rate_limit": 0.05,
                "lowpass_alpha": 0.25,
                "watchdog_timeout_s": 5.0,
            }
        }
        pm.add_robot(robot_cfg)

        # Add cameras to project
        if body.cameras:
            for cam in body.cameras:
                camera_cfg = {
                    "id": cam.id,
                    "source": cam.source,
                    "device_id": cam.device_id,
                    "role": cam.role,
                    "resolution": [640, 480],
                    "fps": 30
                }
                pm.add_camera(camera_cfg)

        pm.save_project()
        
        # Initialize controller with project
        _get_controller()
        
        # Broadcast project opened
        event_bus.project_opened.emit(pm.current_project)
        
        return {"ok": True, "project": pm.current_project}
    except Exception as e:
        log.exception("Setup finish error: %s", e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# Temporary in-memory storage for detection snapshots
detection_snapshots = {}

@app.post("/api/setup/detect-arms/start")
async def detect_arms_start():
    from orchiday.hardware.detection import detect_serial_ports
    ports = detect_serial_ports()
    detection_snapshots["ports_before"] = {p["device"]: p for p in ports}
    log.info("Started arm detection. Saved snapshot with %d ports.", len(ports))
    return {"ok": True, "ports_count": len(ports)}

@app.post("/api/setup/detect-arms/unplugged")
async def detect_arms_unplugged():
    from orchiday.hardware.detection import detect_serial_ports
    ports_before = detection_snapshots.get("ports_before", {})
    if not ports_before:
        return JSONResponse({"ok": False, "error": "No detection snapshot found. Start search first."}, status_code=400)
    
    ports_after = {p["device"]: p for p in detect_serial_ports()}
    diff_devices = set(ports_before.keys()) - set(ports_after.keys())
    
    if len(diff_devices) == 1:
        unplugged_device = list(diff_devices)[0]
        port_info = ports_before[unplugged_device]
        log.info("Detected unplugged device: %s (%s)", unplugged_device, port_info["persistent_id"])
        return {
            "ok": True,
            "device": unplugged_device,
            "persistent_id": port_info["persistent_id"],
            "friendly_name": port_info["friendly_name"]
        }
    elif len(diff_devices) == 0:
        return JSONResponse({
            "ok": False,
            "error": "Could not detect the port. No difference was found. Make sure to unplug the USB cable."
        }, status_code=400)
    else:
        return JSONResponse({
            "ok": False,
            "error": f"Could not detect the port. More than one port was disconnected: {list(diff_devices)}."
        }, status_code=400)


def find_conda_executable() -> str | None:
    import shutil
    import os
    import platform
    # 1. Check PATH
    conda_in_path = shutil.which("conda")
    if conda_in_path:
        return conda_in_path
    
    # 2. Check common directories
    home = os.path.expanduser("~")
    is_win = platform.system().lower() == "windows"
    
    if is_win:
        common_paths = [
            os.path.join(home, "miniconda3", "Scripts", "conda.exe"),
            os.path.join(home, "anaconda3", "Scripts", "conda.exe"),
            os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "miniconda3", "Scripts", "conda.exe"),
            os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"), "anaconda3", "Scripts", "conda.exe"),
        ]
    else:
        common_paths = [
            os.path.join(home, "miniconda3", "bin", "conda"),
            os.path.join(home, "anaconda3", "bin", "conda"),
            "/opt/miniconda3/bin/conda",
            "/opt/anaconda3/bin/conda",
            os.path.join(home, "opt", "miniconda3", "bin", "conda"),
        ]
        
    for path in common_paths:
        if os.path.exists(path):
            return path
            
    return None


def check_conda_env_exists(conda_path: str, env_name: str = "lerobot") -> bool:
    import subprocess
    import os
    if not conda_path:
        return False
    try:
        conda_dir = None
        if conda_path.endswith("conda") or conda_path.endswith("conda.exe"):
            parent1 = os.path.dirname(conda_path)
            parent2 = os.path.dirname(parent1)
            if os.path.basename(parent1).lower() in ["bin", "scripts"]:
                conda_dir = parent2
            else:
                conda_dir = parent1
                
        if conda_dir:
            env_path = os.path.join(conda_dir, "envs", env_name)
            if os.path.exists(env_path):
                return True
                
        # Fallback: query list
        res = subprocess.run([conda_path, "env", "list"], capture_output=True, text=True, timeout=10)
        if env_name in res.stdout:
            return True
    except Exception:
        pass
    return False


def get_env_executables(conda_path: str, env_name: str = "lerobot") -> tuple[str | None, str | None]:
    import os
    import platform
    if not conda_path:
        return None, None
    
    conda_dir = None
    if conda_path.endswith("conda") or conda_path.endswith("conda.exe"):
        parent1 = os.path.dirname(conda_path)
        parent2 = os.path.dirname(parent1)
        if os.path.basename(parent1).lower() in ["bin", "scripts"]:
            conda_dir = parent2
        else:
            conda_dir = parent1
            
    if not conda_dir:
        return None, None
        
    is_win = platform.system().lower() == "windows"
    if is_win:
        python_path = os.path.join(conda_dir, "envs", env_name, "python.exe")
        pip_path = os.path.join(conda_dir, "envs", env_name, "Scripts", "pip.exe")
    else:
        python_path = os.path.join(conda_dir, "envs", env_name, "bin", "python")
        pip_path = os.path.join(conda_dir, "envs", env_name, "bin", "pip")
        
    return (
        python_path if os.path.exists(python_path) else None,
        pip_path if os.path.exists(pip_path) else None
    )


def download_miniconda(target_file: str) -> str:
    import urllib.request
    import platform
    
    system = platform.system().lower()
    machine = platform.machine().lower()
    
    if system == "linux":
        if "arm" in machine or "aarch64" in machine:
            url = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh"
        else:
            url = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
    elif system == "darwin":
        if "arm" in machine or "aarch64" in machine:
            url = "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh"
        else:
            url = "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh"
    elif system == "windows":
        url = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"
    else:
        raise Exception(f"Unsupported operating system: {system}")
        
    urllib.request.urlretrieve(url, target_file)
    return url


class VerifyPathConfig(BaseModel):
    path: str

class InstallConfig(BaseModel):
    parent_dir: str

@app.get("/api/setup/system-status")
def get_system_status():
    import os
    import shutil
    import platform
    
    git_installed = shutil.which("git") is not None
    conda_path = find_conda_executable()
    conda_installed = conda_path is not None
    env_exists = check_conda_env_exists(conda_path, "lerobot") if conda_installed else False
    
    home = os.path.expanduser("~")
    search_dirs = [
        os.path.join(home, "robotics", "lerobot"),
        os.path.join(home, "lerobot"),
        os.path.join(home, "projects", "lerobot"),
        os.path.join(home, "PycharmProjects", "lerobot"),
        os.path.join(home, "Desktop", "lerobot"),
    ]
    
    found_lerobot_path = None
    for d in search_dirs:
        if os.path.isdir(d):
            if (os.path.exists(os.path.join(d, "setup.py")) or 
                os.path.exists(os.path.join(d, "pyproject.toml")) or 
                os.path.isdir(os.path.join(d, "lerobot")) or 
                os.path.isdir(os.path.join(d, "src/lerobot"))):
                found_lerobot_path = d
                break
                
    return {
        "ok": True,
        "git_installed": git_installed,
        "conda_installed": conda_installed,
        "conda_path": conda_path,
        "env_exists": env_exists,
        "lerobot_found": found_lerobot_path is not None,
        "lerobot_path": found_lerobot_path,
        "os": platform.system().lower(),
        "home": home
    }

@app.get("/api/setup/check-lerobot")
def check_lerobot():
    status = get_system_status()
    if status["lerobot_found"]:
        return {"ok": True, "found": True, "path": status["lerobot_path"]}
    return {"ok": True, "found": False}

@app.post("/api/setup/verify-lerobot-path")
async def verify_lerobot_path(body: VerifyPathConfig):
    import os
    p = body.path.strip()
    if not p:
        return JSONResponse({"ok": False, "error": "Cesta nesmí být prázdná."}, status_code=400)
    if not os.path.isdir(p):
        return JSONResponse({"ok": False, "error": "Zadaná cesta neexistuje nebo není složkou."}, status_code=400)
    if not (os.path.exists(os.path.join(p, "setup.py")) or 
            os.path.exists(os.path.join(p, "pyproject.toml")) or 
            os.path.isdir(os.path.join(p, "lerobot")) or 
            os.path.isdir(os.path.join(p, "src/lerobot"))):
        return JSONResponse({"ok": False, "error": "Složka neobsahuje platnou instalaci LeRobot (chybí setup.py, pyproject.toml nebo lerobot složka)."}, status_code=400)
    return {"ok": True}

@app.get("/api/setup/camera-preview/feed")
async def setup_camera_preview_feed(source: str):
    import cv2
    import asyncio
    import platform
    try:
        src = int(source)
    except ValueError:
        src = source # custom path
        
    async def frame_generator():
        # Check if the camera is already active in the application's camera manager
        ctrl = _get_controller()
        active_worker = None
        if ctrl and ctrl.camera_manager:
            for w in ctrl.camera_manager._workers.values():
                if str(w._source) == str(src):
                    active_worker = w
                    break
        
        if active_worker:
            log.info("Setup preview: sharing frame stream from active camera worker.")
            while True:
                active_worker._mutex.lock()
                frame = active_worker._last_frame.copy() if active_worker._last_frame is not None else None
                active_worker._mutex.unlock()
                
                if frame is not None:
                    ret, jpeg = cv2.imencode(".jpg", frame)
                    if ret:
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
                await asyncio.sleep(0.04)
            return

        # If not active, open it with the platform's native backend
        log.info("Setup preview: opening camera %s for live feed", src)
        from orchiday.hardware.camera_utils import open_capture
        cap = open_capture(src)

        if not cap.isOpened():
            log.warning("Setup preview: failed to open camera %s", src)
            yield b""
            return
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    await asyncio.sleep(0.04)
                    continue
                ret, jpeg = cv2.imencode(".jpg", frame)
                if ret:
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
                await asyncio.sleep(0.04)
        finally:
            cap.release()

    from fastapi.responses import StreamingResponse
    return StreamingResponse(frame_generator(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.post("/api/setup/install-lerobot")
def setup_install_lerobot(body: InstallConfig):
    import os
    import subprocess
    import shutil
    import platform
    import tempfile
    from pathlib import Path
    
    parent = body.parent_dir.strip() if body.parent_dir else os.path.expanduser("~/robotics")
    os.makedirs(parent, exist_ok=True)
    
    path = str(Path(parent) / "lerobot")
    exists = os.path.exists(path)
    
    log_lines = [
        "Initializing complete installation setup...",
        f"Target LeRobot parent folder: {parent}",
        f"Checking LeRobot path: {path}"
    ]
    
    # 1. Check Conda
    conda_path = find_conda_executable()
    if not conda_path:
        log_lines.append("Conda not found. Downloading Miniconda...")
        try:
            installer_name = "miniconda_installer.exe" if platform.system().lower() == "windows" else "miniconda_installer.sh"
            installer_path = os.path.join(tempfile.gettempdir(), installer_name)
            
            # Download
            log_lines.append("Downloading Miniconda installer from repo.anaconda.com...")
            url = download_miniconda(installer_path)
            log_lines.append(f"Miniconda installer downloaded successfully from: {url}")
            log_lines.append("Installing Miniconda silently...")
            
            install_dir = os.path.expanduser("~/miniconda3")
            if platform.system().lower() == "windows":
                subprocess.run(
                    [installer_path, "/S", "/RegisterPython=0", f"/D={install_dir}"],
                    check=True,
                    timeout=300
                )
            else:
                subprocess.run(
                    ["bash", installer_path, "-b", "-u", "-p", install_dir],
                    check=True,
                    timeout=300
                )
                
            log_lines.append(f"Miniconda installed successfully to {install_dir}!")
            
            if platform.system().lower() == "windows":
                conda_path = os.path.join(install_dir, "Scripts", "conda.exe")
            else:
                conda_path = os.path.join(install_dir, "bin", "conda")
                
        except Exception as e:
            log_lines.append(f"Miniconda installation failed: {str(e)}")
            return {"ok": False, "logs": log_lines, "error": str(e)}
    else:
        log_lines.append(f"Conda already installed: {conda_path}")
        
    # 2. Check Git
    git_installed = shutil.which("git") is not None
    if not git_installed:
        log_lines.append("WARNING: Git is missing. Cloning might fail. Trying to proceed anyway...")
        
    # 3. Clone LeRobot
    if exists:
        log_lines.append("Found existing LeRobot repository at target path.")
    else:
        log_lines.append("Repository not found. Cloning LeRobot from Github...")
        try:
            result = subprocess.run(
                ["git", "clone", "--depth", "1", "https://github.com/huggingface/lerobot.git", "lerobot"],
                cwd=parent,
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode == 0:
                log_lines.append("Cloning completed successfully.")
            else:
                log_lines.append(f"Git clone failed: {result.stderr}")
                log_lines.append("Creating fallback LeRobot folder structure...")
                os.makedirs(os.path.join(path, "src", "lerobot"), exist_ok=True)
                with open(os.path.join(path, "setup.py"), "w") as f:
                    f.write("# Fallback setup.py\n")
        except Exception as e:
            log_lines.append(f"Error cloning repository: {str(e)}")
            log_lines.append("Creating fallback LeRobot folder structure...")
            os.makedirs(os.path.join(path, "src", "lerobot"), exist_ok=True)
            with open(os.path.join(path, "setup.py"), "w") as f:
                f.write("# Fallback setup.py\n")
                
    # 4. Check if lerobot conda env exists
    env_exists = check_conda_env_exists(conda_path, "lerobot")
    if not env_exists:
        # LeRobot >= 0.5 requires Python 3.12+
        log_lines.append("Conda environment 'lerobot' does not exist. Creating it (Python 3.12)...")
        try:
            res = subprocess.run(
                [conda_path, "create", "-n", "lerobot", "python=3.12", "-y"],
                capture_output=True,
                text=True,
                timeout=600
            )
            if res.returncode == 0:
                log_lines.append("Conda environment 'lerobot' created successfully.")
            else:
                log_lines.append(f"Conda env creation failed: {res.stderr}")
                return {"ok": False, "logs": log_lines, "error": res.stderr}
        except Exception as e:
            log_lines.append(f"Failed to create conda environment: {str(e)}")
            return {"ok": False, "logs": log_lines, "error": str(e)}
    else:
        log_lines.append("Conda environment 'lerobot' already exists.")
        
    # 5. Locate pip in environment
    python_path, pip_path = get_env_executables(conda_path, "lerobot")
    if not pip_path:
        log_lines.append("Could not locate pip executable inside 'lerobot' env. Setup failed.")
        return {"ok": False, "logs": log_lines, "error": "Pip not found in env"}
        
    log_lines.append(f"Found env pip executable: {pip_path}")
    
    # 6. Pip install
    log_lines.append("Installing LeRobot python package dependencies (pip install -e .)...")
    try:
        pip_res = subprocess.run(
            [pip_path, "install", "-e", "."],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=300
        )
        if pip_res.returncode == 0:
            log_lines.append("LeRobot base package installed successfully.")
        else:
            log_lines.append(f"Pip install base package warning: {pip_res.stderr}")
    except Exception as e:
        log_lines.append(f"Failed to install base package: {str(e)}")

    log_lines.append("Installing LeRobot hardware extra dependencies (pip install -e '.[feetech]')...")
    try:
        feetech_res = subprocess.run(
            [pip_path, "install", "-e", ".[feetech]"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=300
        )
        if feetech_res.returncode == 0:
            log_lines.append("LeRobot Feetech extra packages installed successfully.")
        else:
            log_lines.append(f"Pip install Feetech extras warning: {feetech_res.stderr}")
    except Exception as e:
        log_lines.append(f"Failed to install Feetech extras: {str(e)}")
        
    log_lines.append("Installation completed successfully!")
    return {"ok": True, "logs": log_lines, "path": path}


# ── Process state (UI button gating) ────────────────────────────────────

@app.get("/api/processes")
async def list_processes():
    """Return currently running LeRobot subprocesses: {key: kind}."""
    ctrl = _get_controller()
    return {"processes": ctrl.lerobot_bridge.active_process_kinds}


# ── Emergency Stop ───────────────────────────────────────────────────────

@app.post("/api/emergency-stop")
async def emergency_stop():
    ctrl = _get_controller()
    ctrl.lerobot_bridge.kill_all()
    event_bus.log_message.emit("WARN", "EMERGENCY STOP — All processes killed")
    return {"ok": True}


# ── WebSocket ────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    web_bridge.register_client(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                action = msg.get("action", "")
                payload = msg.get("data", {})

                if action == "terminal":
                    event_bus.terminal_command_requested.emit(payload.get("command", ""))
                elif action == "orchestrate":
                    event_bus.orchestration_requested.emit(payload.get("instruction", ""))
                elif action == "emergency_stop":
                    ctrl = _get_controller()
                    ctrl.lerobot_bridge.kill_all()
                elif action == "ping":
                    await ws.send_text(json.dumps({"event": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        web_bridge.unregister_client(ws)
    except Exception as e:
        log.error("WebSocket error: %s", e)
        web_bridge.unregister_client(ws)


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    import uvicorn

    # Ensure data directories exist
    (DATA_DIR / "datasets" / "local").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "outputs" / "training").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "huggingface").mkdir(parents=True, exist_ok=True)

    # Connect event bridge (the asyncio loop is attached in the lifespan hook)
    web_bridge.connect_event_bus()

    log.info("Starting %s Web Server...", APP_DISPLAY_NAME)
    log.info("Data directory: %s", DATA_DIR)
    log.info("Frontend: %s", _web_dir)
    log.info("Open http://localhost:8000 in your browser")

    # Host/port configurable for packaging & multi-instance dev (defaults unchanged)
    host = os.environ.get("ORCHIDAY_HOST", "0.0.0.0")
    port = int(os.environ.get("ORCHIDAY_PORT", "8000"))

    import webbrowser
    def open_browser():
        import time
        time.sleep(1.0)
        webbrowser.open(f"http://localhost:{port}")
    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(app, host=host, port=port, log_level="info", loop="asyncio")



if __name__ == "__main__":
    main()
