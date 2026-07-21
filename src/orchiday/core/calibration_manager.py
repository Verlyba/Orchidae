"""
Calibration manager — Handles scanning, backup, apply, delete, and cross-project
import of LeRobot joint calibration files.
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus

log = logging.getLogger(__name__)

# Base->gripper kinematic chain order for SO-100/SO-101/Koch 6-DOF arms —
# used as the rendering order when a calibration file is missing so the
# visualization still shows something reasonable (generic mid-range values,
# ids 1-6 following the physical bus wiring convention).
DEFAULT_SO100_CALIBRATION: dict[str, dict[str, Any]] = {
    "shoulder_pan": {"id": 1, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
    "shoulder_lift": {"id": 2, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
    "elbow_flex": {"id": 3, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
    "wrist_flex": {"id": 4, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
    "wrist_roll": {"id": 5, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
    "gripper": {"id": 6, "drive_mode": 0, "homing_offset": 0, "range_min": 0, "range_max": 4095},
}


class CalibrationManager:
    """
    Manages robot calibration files, syncing them between the global LeRobot cache
    and local project-specific directories.
    """

    def __init__(self, project_manager: ProjectManager) -> None:
        self._pm = project_manager

    def get_lerobot_calibration_dir(self) -> Path:
        """Get the global LeRobot cache calibration directory."""
        return Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"

    def get_project_calibration_dir(self) -> Path | None:
        """Get the calibration directory of the currently open project."""
        if self._pm.current_path is None:
            return None
        p_dir = self._pm.current_path / "calibration"
        p_dir.mkdir(exist_ok=True)
        (p_dir / "robots").mkdir(exist_ok=True)
        (p_dir / "teleoperators").mkdir(exist_ok=True)
        return p_dir

    def scan_project_calibrations(self) -> list[dict[str, Any]]:
        """
        Scan all calibration files in the active project directory.
        Returns a list of dicts with file metadata.
        """
        cal_dir = self.get_project_calibration_dir()
        if not cal_dir or not cal_dir.exists():
            return []

        results = []
        # Categories: robots, teleoperators
        for category in ["robots", "teleoperators"]:
            cat_dir = cal_dir / category
            if not cat_dir.exists():
                continue
            # Device types (e.g., so100_follower, so100_leader)
            for dev_dir in cat_dir.iterdir():
                if not dev_dir.is_dir():
                    continue
                # JSON files
                for json_file in dev_dir.glob("*.json"):
                    if not json_file.is_file():
                        continue
                    try:
                        stat = json_file.stat()
                        results.append({
                            "name": json_file.name,
                            "path": str(json_file),
                            "category": category,
                            "device_type": dev_dir.name,
                            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "size": stat.st_size,
                        })
                    except Exception as e:
                        log.warning("Failed to parse stat for %s: %s", json_file, e)
        return results

    def scan_lerobot_calibrations(self) -> list[dict[str, Any]]:
        """
        Scan the global LeRobot cache calibration directory.
        Returns a list of dicts with file metadata.
        """
        lerobot_dir = self.get_lerobot_calibration_dir()
        if not lerobot_dir.exists():
            return []

        results = []
        for category in ["robots", "teleoperators"]:
            cat_dir = lerobot_dir / category
            if not cat_dir.exists():
                continue
            for dev_dir in cat_dir.iterdir():
                if not dev_dir.is_dir():
                    continue
                for json_file in dev_dir.glob("*.json"):
                    if not json_file.is_file():
                        continue
                    try:
                        stat = json_file.stat()
                        results.append({
                            "name": json_file.name,
                            "path": str(json_file),
                            "category": category,
                            "device_type": dev_dir.name,
                            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            "size": stat.st_size,
                        })
                    except Exception as e:
                        log.warning("Failed to parse stat for %s: %s", json_file, e)
        return results

    def backup_active_calibration(self, robot_setup_id: str, arm_category: str) -> str | None:
        """
        Backup the currently active calibration in LeRobot global cache for a setup's leader/follower
        to the project's local calibration folder.
        """
        if not self._pm.current_project:
            return None

        # Find the robot setup
        robot_setup = None
        for r in self._pm.current_project.get("robots", []):
            if r.get("id") == robot_setup_id:
                robot_setup = r
                break

        if not robot_setup:
            log.error("Robot setup '%s' not found in project", robot_setup_id)
            return None

        if arm_category == "robots":
            device_type = robot_setup.get("follower_type", "so100_follower")
            device_id = robot_setup.get("follower_id", "F1")
        elif arm_category == "teleoperators":
            device_type = robot_setup.get("leader_type", "so100_leader")
            device_id = robot_setup.get("leader_id", "L1")
        else:
            log.error("Invalid arm category: %s", arm_category)
            return None

        # Source in LeRobot cache
        source_file = self.get_lerobot_calibration_dir() / arm_category / device_type / f"{device_id}.json"
        if not source_file.exists():
            log.warning("No active calibration found in LeRobot cache at %s", source_file)
            return None

        # Destination in project folder
        project_cal_dir = self.get_project_calibration_dir()
        if not project_cal_dir:
            return None

        target_dir = project_cal_dir / arm_category / device_type
        target_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_filename = f"{device_id}_backup_{timestamp}.json"
        target_file = target_dir / target_filename

        try:
            shutil.copy2(source_file, target_file)
            log.info("Backed up active calibration %s to %s", source_file, target_file)
            
            # Automatically bind this new backup to the project config
            self._update_setup_binding(robot_setup_id, arm_category, target_filename)
            
            event_bus.calibration_list_changed.emit()
            return target_filename
        except Exception as e:
            log.error("Failed to backup calibration: %s", e)
            return None

    def apply_calibration(self, robot_setup_id: str, arm_category: str, filename: str) -> bool:
        """
        Deploy a calibration file from the project's local folder to LeRobot's global cache,
        and save this binding in the project config.
        """
        if not self._pm.current_project:
            return False

        # Find the robot setup
        robot_setup = None
        for r in self._pm.current_project.get("robots", []):
            if r.get("id") == robot_setup_id:
                robot_setup = r
                break

        if not robot_setup:
            log.error("Robot setup '%s' not found", robot_setup_id)
            return False

        if arm_category == "robots":
            device_type = robot_setup.get("follower_type", "so100_follower")
            device_id = robot_setup.get("follower_id", "F1")
        elif arm_category == "teleoperators":
            device_type = robot_setup.get("leader_type", "so100_leader")
            device_id = robot_setup.get("leader_id", "L1")
        else:
            log.error("Invalid arm category: %s", arm_category)
            return False

        # Source in project
        project_cal_dir = self.get_project_calibration_dir()
        if not project_cal_dir:
            return False

        source_file = project_cal_dir / arm_category / device_type / filename
        if not source_file.exists():
            log.error("Source calibration file '%s' not found in project", source_file)
            return False

        # Destination in LeRobot cache
        dest_dir = self.get_lerobot_calibration_dir() / arm_category / device_type
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / f"{device_id}.json"

        try:
            shutil.copy2(source_file, dest_file)
            log.info("Applied calibration %s to LeRobot cache at %s", source_file, dest_file)
            
            # Save binding
            self._update_setup_binding(robot_setup_id, arm_category, filename)
            
            return True
        except Exception as e:
            log.error("Failed to apply calibration: %s", e)
            return False

    def deploy_active_bindings(self) -> None:
        """
        Deploy all bound calibration files for the current project into the LeRobot global cache.
        Usually called when opening a project to restore active calibrations.
        """
        if not self._pm.current_project:
            return

        log.info("Deploying active project calibration bindings to LeRobot cache...")
        for r in self._pm.current_project.get("robots", []):
            setup_id = r.get("id")
            
            # Follower calibration
            follower_cal = r.get("follower_calibration")
            if follower_cal:
                self.apply_calibration(setup_id, "robots", follower_cal)

            # Leader calibration
            leader_cal = r.get("leader_calibration")
            if leader_cal:
                self.apply_calibration(setup_id, "teleoperators", leader_cal)

    def import_calibration_from_project(
        self,
        source_project_path: Path,
        source_category: str,
        source_device_type: str,
        source_filename: str,
        target_setup_id: str,
        target_category: str,  # usually same as source_category
    ) -> str | None:
        """
        Import a calibration file from another project, renaming it to fit the target setup.
        Returns the new filename in the target project.
        """
        if not self._pm.current_project:
            return None

        # Find target setup
        target_setup = None
        for r in self._pm.current_project.get("robots", []):
            if r.get("id") == target_setup_id:
                target_setup = r
                break

        if not target_setup:
            log.error("Target robot setup '%s' not found", target_setup_id)
            return None

        # Determine target device type and target id
        if target_category == "robots":
            target_device_type = target_setup.get("follower_type", "so100_follower")
            target_device_id = target_setup.get("follower_id", "F1")
        else:
            target_device_type = target_setup.get("leader_type", "so100_leader")
            target_device_id = target_setup.get("leader_id", "L1")

        # Source path
        source_file = source_project_path / "calibration" / source_category / source_device_type / source_filename
        if not source_file.exists():
            log.error("Source file '%s' does not exist", source_file)
            return None

        # Target directory in current project
        project_cal_dir = self.get_project_calibration_dir()
        if not project_cal_dir:
            return None

        dest_dir = project_cal_dir / target_category / target_device_type
        dest_dir.mkdir(parents=True, exist_ok=True)

        # Generate destination filename keeping original provenance (slug of project)
        source_project_slug = source_project_path.name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest_filename = f"{target_device_id}_from_{source_project_slug}_{timestamp}.json"
        dest_file = dest_dir / dest_filename

        try:
            # Copy file
            shutil.copy2(source_file, dest_file)
            log.info("Imported calibration from %s to %s", source_file, dest_file)
            
            # Optional: Add/Modify metadata inside the file to trace original ID/device_type if needed.
            # (LeRobot calibration is a flat STS/Dynamixel mapping so it doesn't break if we just copy it).
            
            # Auto-apply the imported calibration to make it active
            self.apply_calibration(target_setup_id, target_category, dest_filename)
            
            event_bus.calibration_list_changed.emit()
            return dest_filename
        except Exception as e:
            log.error("Failed to import calibration: %s", e)
            return None

    def delete_calibration_file(self, arm_category: str, device_type: str, filename: str) -> bool:
        """Delete a calibration file from the project's local folder."""
        project_cal_dir = self.get_project_calibration_dir()
        if not project_cal_dir:
            return False

        target_file = project_cal_dir / arm_category / device_type / filename
        if not target_file.exists():
            return False

        try:
            target_file.unlink()
            log.info("Deleted calibration file %s", target_file)

            # Clean bindings in project config
            if self._pm.current_project:
                changed = False
                for r in self._pm.current_project.get("robots", []):
                    if arm_category == "robots" and r.get("follower_calibration") == filename:
                        r.pop("follower_calibration", None)
                        changed = True
                    elif arm_category == "teleoperators" and r.get("leader_calibration") == filename:
                        r.pop("leader_calibration", None)
                        changed = True
                if changed:
                    self._pm.save_project()
                    event_bus.project_opened.emit(self._pm.current_project)

            event_bus.calibration_list_changed.emit()
            return True
        except Exception as e:
            log.error("Failed to delete calibration: %s", e)
            return False

    def read_calibration_content(self, path: Path) -> dict[str, Any] | None:
        """Parse a calibration JSON file's per-joint data (id, homing_offset,
        range_min/range_max, drive_mode). Returns None if missing/unreadable."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data:
                return data
        except Exception as e:
            log.warning("Failed to read calibration file %s: %s", path, e)
        return None

    def get_arm_visual_config(self, robot_setup_id: str | None = None) -> dict[str, Any]:
        """
        Resolve joint calibration data (motor id, range_min/max, homing_offset)
        for both the leader and follower of a robot setup, to drive a visual
        arm animation. Falls back to DEFAULT_SO100_CALIBRATION for whichever
        side has no calibration file bound yet, so the visualization always has
        something reasonable to render (e.g. before the user ever calibrates).
        """
        if not self._pm.current_project:
            return {"ok": False, "error": "No project open"}

        robots = self._pm.current_project.get("robots", [])
        setup = None
        if robot_setup_id:
            setup = next((r for r in robots if r.get("id") == robot_setup_id), None)
        elif robots:
            setup = robots[0]
        if not setup:
            return {"ok": False, "error": "No robot configured in this project"}

        cal_dir = self.get_project_calibration_dir()

        def _resolve(category: str, device_type: str, filename: str | None) -> dict[str, Any]:
            if filename and cal_dir:
                content = self.read_calibration_content(cal_dir / category / device_type / filename)
                if content:
                    return {"source": "calibration", "filename": filename, "joints": content}
            return {"source": "default", "filename": None, "joints": DEFAULT_SO100_CALIBRATION}

        follower_type = setup.get("follower_type", "so100_follower")
        leader_type = setup.get("leader_type", "so100_leader")

        return {
            "ok": True,
            "robot_id": setup.get("id"),
            "follower": {"device_type": follower_type,
                        **_resolve("robots", follower_type, setup.get("follower_calibration"))},
            "leader": {"device_type": leader_type,
                      **_resolve("teleoperators", leader_type, setup.get("leader_calibration"))},
        }

    def _update_setup_binding(self, robot_setup_id: str, arm_category: str, filename: str) -> None:
        """Helper to save the calibration binding in the project config."""
        if not self._pm.current_project:
            return

        for r in self._pm.current_project.get("robots", []):
            if r.get("id") == robot_setup_id:
                if arm_category == "robots":
                    r["follower_calibration"] = filename
                else:
                    r["leader_calibration"] = filename
                break

        self._pm.save_project()
        event_bus.project_opened.emit(self._pm.current_project)
