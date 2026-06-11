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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
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
LEROBOT_DIR = Path(os.environ.get("LEROBOT_DIR", "/home/verlyba/robotics/lerobot"))

# ── FastAPI App ──────────────────────────────────────────────────────────
app = FastAPI(title="Orchiday API", version="0.1.0")

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
    epochs: int = 100
    batch_size: int = 32
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
    try:
        p_dir = Path(body.parent_dir) if body.parent_dir else None
        data = pm.create_project(body.name, body.slug, p_dir)
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
async def scan_hardware():
    from orchiday.hardware.detection import detect_serial_ports, detect_cameras
    return {
        "ports": detect_serial_ports(),
        "cameras": detect_cameras()
    }


@app.post("/api/hardware/pair")
async def pair_hardware():
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
        skills_details = pm.current_project.get("skills_details", {})
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
async def get_skill_dataset_info(skill_slug: str):
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


@app.get("/api/project/export_datasets")
async def export_project_datasets(background_tasks: BackgroundTasks):
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
async def delete_skill_episode(skill_slug: str, body: dict):
    episode_idx = body.get("episode_index", -1)
    if episode_idx < 0:
        return JSONResponse({"ok": False, "error": "Invalid episode index"}, status_code=400)
    
    import subprocess
    import sys
    
    dataset_id = f"local/{skill_slug}"
    py_code = (
        "try:\n"
        "    from lerobot.common.datasets.lerobot_dataset import LeRobotDataset\n"
        f"    ds = LeRobotDataset('{dataset_id}')\n"
        f"    ds.delete_episode({episode_idx})\n"
        "    print('SUCCESS')\n"
        "except Exception as e:\n"
        "    print('ERROR:', e)\n"
    )
    
    env = os.environ.copy()
    if pm.current_project:
        custom_dir = pm.current_project.get("dataset_storage_dir")
        if custom_dir:
            env["HF_HOME"] = str(custom_dir)

    try:
        res = subprocess.run(
            [sys.executable, "-c", py_code],
            capture_output=True,
            text=True,
            env=env,
            timeout=15
        )
        if "SUCCESS" in res.stdout:
            return {"ok": True}
        else:
            err = res.stdout + "\n" + res.stderr
            return JSONResponse({"ok": False, "error": f"Failed to delete: {err}"}, status_code=400)
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
    
    ctrl.lerobot_bridge.start_replay(
        robot_type=body.robot_type,
        dataset_name=body.dataset_name,
        episode_index=body.episode_index,
        port=body.port,
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
    port = robot.get("port", "")
    if not port:
        return {"ok": False, "error": "Follower robot port is missing"}
        
    cameras = robot.get("cameras", [])
    if not cameras:
        return {"ok": False, "error": "No cameras assigned. You must assign at least one camera."}
        
    extra_args = {"cameras": ",".join(cameras)}
    
    # Enforce strict dataset path naming based on parent skill slug
    parent_slug = ""
    skills_details = project.get("skills_details", {})
    if body.skill_slug in skills_details:
        parent_slug = skills_details[body.skill_slug].get("parent_slug", "")
        
    if parent_slug:
        enforced_dataset_name = f"local/{parent_slug}/{body.skill_slug}"
    else:
        enforced_dataset_name = f"local/{body.skill_slug}"
    
    # Increment execution count
    pm.increment_skill_execution_count(body.skill_slug)
    
    ctrl.lerobot_bridge.start_recording(
        robot_type=body.robot_type,
        dataset_name=enforced_dataset_name,
        skill_slug=body.skill_slug,
        num_episodes=body.num_episodes,
        fps=body.fps,
        port=body.port,
        resume=body.resume,
        extra_args=extra_args,
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


class RecordingTagConfig(BaseModel):
    dataset_name: str
    macro_task: str
    sub_skills: list[str]
    transition_points: list[int]
    episode_index: int | None = None


@app.post("/api/recording/tag_episode")
async def tag_episode(body: RecordingTagConfig):
    import re
    from pathlib import Path
    import pandas as pd

    # Locate dataset path
    custom_dir = None
    if pm.current_project:
        custom_dir = pm.current_project.get("dataset_storage_dir")

    parent_slug = None
    skill_slug = body.dataset_name.split("/")[-1]
    if pm.current_project and "skills_details" in pm.current_project:
        detail = pm.current_project["skills_details"].get(skill_slug, {})
        if not detail and "/" in body.dataset_name:
            parts = body.dataset_name.split("/")
            detail = pm.current_project["skills_details"].get(parts[-1], {})
        parent_slug = detail.get("parent_slug")

    paths = []
    if custom_dir:
        custom_path = Path(custom_dir)
        if parent_slug:
            paths.append(custom_path / "lerobot" / "local" / parent_slug / skill_slug)
            paths.append(custom_path / "lerobot" / parent_slug / skill_slug)
            paths.append(custom_path / parent_slug / skill_slug)
        paths.append(custom_path / "lerobot" / "local" / body.dataset_name)
        paths.append(custom_path / "lerobot" / body.dataset_name)
        paths.append(custom_path / body.dataset_name)

    default_hf = Path.home() / ".cache" / "huggingface"
    if parent_slug:
        paths.append(default_hf / "lerobot" / "local" / parent_slug / skill_slug)
        paths.append(default_hf / "lerobot" / parent_slug / skill_slug)
    paths.append(default_hf / "lerobot" / "local" / body.dataset_name)
    paths.append(default_hf / "lerobot" / body.dataset_name)

    from orchiday.core.constants import APP_DATA_DIR
    paths.append(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / body.dataset_name)
    if parent_slug:
        paths.append(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local" / parent_slug / skill_slug)

    target_dir = None
    for p in paths:
        if p.exists() and (p / "data").exists():
            target_dir = p
            break
        elif p.exists():
            target_dir = p
            break

    if not target_dir:
        target_dir = paths[0]  # Fallback to the first path

    log.info("Recording tag: dataset located at %s", target_dir)

    data_dir = target_dir / "data"
    if not data_dir.exists():
        data_dir = target_dir

    parquet_files = list(data_dir.glob("episode_*.parquet"))
    if not parquet_files:
        parquet_files = list(target_dir.glob("*.parquet"))

    if not parquet_files:
        return JSONResponse({"ok": False, "error": f"No Parquet files found in dataset path: {target_dir}"}, status_code=404)

    def get_episode_num(f: Path) -> int:
        match = re.search(r"episode_(\d+)\.parquet", f.name)
        if match:
            return int(match.group(1))
        return -1

    parquet_files.sort(key=get_episode_num)

    target_file = None
    if body.episode_index is not None:
        expected_name = f"episode_{body.episode_index:06d}.parquet"
        for pf in parquet_files:
            if pf.name == expected_name:
                target_file = pf
                break
        if not target_file:
            return JSONResponse({"ok": False, "error": f"Requested episode {body.episode_index} Parquet file not found."}, status_code=404)
    else:
        target_file = parquet_files[-1]  # Latest episode

    log.info("Tagging episode file: %s", target_file)
    event_bus.log_message.emit("INFO", f"Tagging dataset file: {target_file.name}")

    try:
        df = pd.read_parquet(target_file)
        num_rows = len(df)

        lang_instructions = []
        pts = body.transition_points
        skills = body.sub_skills
        macro = body.macro_task

        if not skills:
            return JSONResponse({"ok": False, "error": "No sub-skills provided for tagging."}, status_code=400)

        for row_idx in range(num_rows):
            phase_idx = 0
            for i, pt in enumerate(pts):
                if row_idx >= pt:
                    phase_idx = i + 1
                else:
                    break

            if phase_idx >= len(skills):
                phase_idx = len(skills) - 1

            active_skill = skills[phase_idx]
            lang_instructions.append(f"{macro}__{active_skill}")

        df['language_instruction'] = lang_instructions
        df.to_parquet(target_file, index=False)

        msg = f"Successfully injected active tags into episode Parquet file ({num_rows} frames)"
        log.info(msg)
        event_bus.log_message.emit("SUCCESS", msg)
        return {"ok": True, "file": target_file.name, "frames": num_rows}
    except Exception as e:
        err_msg = f"Failed to tag Parquet file: {e}"
        log.exception(err_msg)
        event_bus.log_message.emit("ERROR", err_msg)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)



# ── Training ─────────────────────────────────────────────────────────────

@app.post("/api/training/start")
async def start_training(body: TrainingConfig):
    if pm.current_project:
        pm.current_project["policy_architecture"] = body.policy_type
        pm.current_project["active_training_config"] = {
            "epochs": body.epochs,
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

    if not pm.current_project:
        return {"ok": True}

    if body.dataset_storage_dir is not None:
        pm.current_project["dataset_storage_dir"] = body.dataset_storage_dir.strip()
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
async def get_sysinfo():
    import subprocess
    from orchiday.core.config import AppConfig
    cfg = AppConfig()
    python_path = cfg.get("python_path") or "/home/verlyba/miniconda3/envs/lerobot/bin/python"
    lerobot_dir = cfg.get("lerobot_dir") or "/home/verlyba/robotics/lerobot"

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
async def browse_directory():
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
        log.warning("Nativní dialog pro výběr složky selhal, zkouším tkinter fallback: %s", e)

    # Fallback to Tkinter
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
            log.error("Chyba při otevírání tkinter dialogu: %s", e)
            return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

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

@app.post("/api/setup/finish")
async def setup_finish(body: SetupFinishConfig):
    import re
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
        project_data = pm.create_project(body.project_name, slug)
        
        # Open it so it is the active one
        pm.open_project(pm._config.projects_dir / slug)
        
        # Configure LeRobot dir if provided
        lerobot_dir = body.lerobot_path.strip() if body.lerobot_path else "/home/verlyba/robotics/lerobot"
        if lerobot_dir and pm.current_project is not None:
            pm.current_project["lerobot_dir"] = lerobot_dir
            # also save in settings
            pm.current_project["dataset_storage_dir"] = str(Path(lerobot_dir).parent / "data")
        
        # Add robot config
        r_type = "so100"
        if "so-arm" in body.robot_type.lower() or "soarm" in body.robot_type.lower():
            r_type = "soarm101"
        elif "koch" in body.robot_type.lower():
            r_type = "koch"
        elif "aloha" in body.robot_type.lower():
            r_type = "aloha"
        elif "moss" in body.robot_type.lower():
            r_type = "moss"
        elif "stretch" in body.robot_type.lower():
            r_type = "stretch"
        elif "lekiwi" in body.robot_type.lower():
            r_type = "lekiwi"
        
        robot_cfg = {
            "id": "my_robot",
            "type": r_type,
            "port": body.follower_port or "",
            "device_id": body.follower_device_id or "",
            "label": f"LeRobot Setup: F1/L1",
            "follower_type": r_type,
            "follower_port": body.follower_port or "",
            "follower_id": "F1",
            "follower_device_id": body.follower_device_id or "",
            "leader_type": f"{r_type}_leader" if r_type in ["so100", "soarm101", "koch"] else "so100_leader",
            "leader_port": body.leader_port or "",
            "leader_id": "L1",
            "leader_device_id": body.leader_device_id or "",
            "fps": 30,
            "baudrate": 1000000,
            "cameras": [],
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
async def get_system_status():
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
async def check_lerobot():
    status = await get_system_status()
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

        # If not active, open it
        log.info("Setup preview: opening camera %s for live feed", src)
        is_linux = platform.system().lower() == "linux"
        cap = None
        if is_linux and isinstance(src, int):
            # Try V4L2 backend on Linux first as it is much more robust
            cap = cv2.VideoCapture(src + cv2.CAP_V4L2)
            if not cap.isOpened():
                cap.release()
                cap = None
        if cap is None:
            cap = cv2.VideoCapture(src)
            
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
async def setup_install_lerobot(body: InstallConfig):
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
        log_lines.append("Conda environment 'lerobot' does not exist. Creating it (Python 3.10)...")
        try:
            res = subprocess.run(
                [conda_path, "create", "-n", "lerobot", "python=3.10", "-y"],
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


# ── Qt Event Loop Integration ───────────────────────────────────────────

def _run_qt_events():
    """Process pending Qt events periodically from the async event loop."""
    if _qt_app:
        _qt_app.processEvents()


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    import uvicorn

    # Ensure data directories exist
    (DATA_DIR / "datasets" / "local").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "outputs" / "training").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "huggingface").mkdir(parents=True, exist_ok=True)

    # Connect event bridge
    web_bridge.connect_event_bus()

    log.info("Starting %s Web Server...", APP_DISPLAY_NAME)
    log.info("Data directory: %s", DATA_DIR)
    log.info("Frontend: %s", _web_dir)
    log.info("Open http://localhost:8000 in your browser")

    # Run Qt event processing in a background thread
    def qt_thread():
        import time
        while True:
            _run_qt_events()
            time.sleep(0.05)

    t = threading.Thread(target=qt_thread, daemon=True)
    t.start()

    # Set the event loop for the bridge
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    web_bridge.set_loop(loop)

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info", loop="asyncio")


if __name__ == "__main__":
    main()
