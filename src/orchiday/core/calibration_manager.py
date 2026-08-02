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

    # Where LeRobot looks for a calibration file, straight from its own source:
    #   Robot.__init__:  HF_LEROBOT_CALIBRATION / {robots|teleoperators} / self.name / f"{self.id}.json"
    # `self.name` is the DEVICE CLASS name, which is not always the value passed
    # to --robot.type: SO-100 and SO-101 are both served by SOFollower/SOLeader,
    # whose name is "so_follower"/"so_leader". Every other supported arm's class
    # name equals its CLI type, hence the identity fallback.
    #
    # Getting this wrong is silent: LeRobot simply reports "no calibration file
    # found" and re-prompts, which is what filled the cache with duplicates.
    _LEROBOT_DIRNAME_OVERRIDES = {
        "so100_follower": "so_follower",
        "so101_follower": "so_follower",
        "so100_leader": "so_leader",
        "so101_leader": "so_leader",
    }

    @classmethod
    def lerobot_device_dirname(cls, device_type: str) -> str:
        """Directory LeRobot reads a device's calibration from."""
        return cls._LEROBOT_DIRNAME_OVERRIDES.get(device_type, device_type)

    def get_lerobot_calibration_dir(self) -> Path:
        """Get the LeRobot cache calibration directory used by subprocesses."""
        from orchiday.core.constants import APP_DATA_DIR
        cal_dir = APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "calibration"
        cal_dir.mkdir(parents=True, exist_ok=True)
        return cal_dir

    def get_project_calibration_dir(self) -> Path | None:
        """Get the calibration directory of the currently open project."""
        if self._pm.current_path is None:
            return None
        p_dir = self._pm.current_path / "calibration"
        p_dir.mkdir(exist_ok=True)
        (p_dir / "robots").mkdir(exist_ok=True)
        (p_dir / "teleoperators").mkdir(exist_ok=True)
        return p_dir

    # ── User-facing metadata (display name, favorite) ──────────────────────
    # LeRobot's own calibration JSON is a flat {motor: {id, homing_offset,
    # range_min, range_max, drive_mode}} map with no room for extra keys
    # (it's parsed straight into MotorCalibration objects) — a stray key
    # would either be silently dropped or crash that parse. Naming/favorite
    # state is kept in a small sidecar file next to the calibration files
    # instead, keyed by filename.

    def _meta_path(self) -> Path | None:
        cal_dir = self.get_project_calibration_dir()
        return cal_dir / "meta.json" if cal_dir else None

    def _load_meta(self) -> dict[str, dict[str, Any]]:
        path = self._meta_path()
        if not path or not path.exists():
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            log.warning("Failed to read calibration meta.json: %s", e)
            return {}

    def _save_meta(self, meta: dict[str, dict[str, Any]]) -> None:
        path = self._meta_path()
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
        except Exception as e:
            log.error("Failed to write calibration meta.json: %s", e)

    def set_calibration_meta(
        self, filename: str, display_name: str | None = None, favorite: bool | None = None
    ) -> bool:
        """Set the user-facing display name and/or favorite flag for a
        project calibration file, keyed by filename (unique within a
        project's calibration folder — timestamped on creation)."""
        meta = self._load_meta()
        entry = meta.setdefault(filename, {})
        if display_name is not None:
            entry["display_name"] = display_name.strip()
        if favorite is not None:
            entry["favorite"] = favorite
        self._save_meta(meta)
        event_bus.calibration_list_changed.emit()
        return True

    def list_calibrations(self) -> dict[str, Any]:
        """Project and global LeRobot cache calibration files enriched with display name,
        favorite flag, source, and whether each is the currently ACTIVE (bound) calibration
        for its robot setup — everything the file-manager UI needs in one call."""
        meta = self._load_meta()
        active_by_key: set[tuple[str, str, str]] = set()
        if self._pm.current_project:
            for r in self._pm.current_project.get("robots", []):
                setup_id = r.get("id", "")
                if r.get("follower_calibration"):
                    active_by_key.add((setup_id, "robots", r["follower_calibration"]))
                if r.get("leader_calibration"):
                    active_by_key.add((setup_id, "teleoperators", r["leader_calibration"]))

        files = self.scan_project_calibrations()
        seen_names = {f["name"] for f in files}

        # Merge global LeRobot cache files
        cache_files = self.scan_lerobot_calibrations()
        for cf in cache_files:
            if cf["name"] not in seen_names:
                cf["source"] = "cache"
                files.append(cf)
                seen_names.add(cf["name"])

        for f in files:
            entry = meta.get(f["name"], {})
            f["display_name"] = entry.get("display_name") or f["name"]
            f["favorite"] = bool(entry.get("favorite", False))
            f["active_for"] = [
                setup_id for (setup_id, cat, name) in active_by_key
                if cat == f["category"] and name == f["name"]
            ]
        return {"files": files}

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
        Scan the global LeRobot cache calibration directories.
        Returns a list of dicts with file metadata.
        """
        from orchiday.core.constants import APP_DATA_DIR
        candidate_dirs = [
            self.get_lerobot_calibration_dir(),
            APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "calibration",
            Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration",
        ]

        results = []
        seen_paths = set()

        for lerobot_dir in candidate_dirs:
            if not lerobot_dir.exists():
                continue
            for category in ["robots", "teleoperators"]:
                cat_dir = lerobot_dir / category
                if not cat_dir.exists():
                    continue
                for dev_dir in cat_dir.iterdir():
                    if not dev_dir.is_dir():
                        continue
                    for json_file in dev_dir.glob("*.json"):
                        if not json_file.is_file() or str(json_file) in seen_paths:
                            continue
                        seen_paths.add(str(json_file))
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
            if r.get("id") == robot_setup_id or robot_setup_id in (r.get("leader_id"), r.get("follower_id")):
                robot_setup = r
                break

        if not robot_setup:
            robots = self._pm.current_project.get("robots", [])
            if robots:
                robot_setup = robots[0]

        if not robot_setup:
            log.error("Robot setup '%s' not found in project", robot_setup_id)
            return None

        actual_setup_id = robot_setup.get("id", robot_setup_id)

        if arm_category == "robots":
            device_type = robot_setup.get("follower_type", "so100_follower")
            candidate_ids = [
                robot_setup.get("follower_id"),
                f"{actual_setup_id}_follower" if not actual_setup_id.endswith("_follower") else actual_setup_id,
                "my_robot_follower",
                "my_follower_arm",
                "F1",
            ]
        elif arm_category == "teleoperators":
            device_type = robot_setup.get("leader_type", "so100_leader")
            candidate_ids = [
                robot_setup.get("leader_id"),
                f"{actual_setup_id}_leader" if not actual_setup_id.endswith("_leader") else actual_setup_id,
                "my_robot_leader",
                "my_leader_arm",
                "L1",
            ]
        else:
            log.error("Invalid arm category: %s", arm_category)
            return None

        candidate_ids = [cid for cid in candidate_ids if cid]

        from orchiday.core.constants import APP_DATA_DIR
        base_cache_dirs = [
            self.get_lerobot_calibration_dir(),
            APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "calibration",
            Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration",
        ]

        # The canonical directory comes first; the raw CLI type is kept only as
        # a fallback so calibrations written by older builds are still found and
        # can be migrated into the correct place.
        cand_types = [self.lerobot_device_dirname(device_type)]
        if device_type not in cand_types:
            cand_types.append(device_type)

        source_file: Path | None = None
        for b_dir in base_cache_dirs:
            if not b_dir.exists():
                continue
            cat_dir = b_dir / arm_category
            if not cat_dir.exists():
                continue

            for dt in cand_types:
                dev_dir = cat_dir / dt
                if not dev_dir.exists():
                    continue
                for cid in candidate_ids:
                    f = dev_dir / f"{cid}.json"
                    if f.exists():
                        source_file = f
                        break
                if source_file:
                    break
            if source_file:
                break

        # Fallback: search for any .json file matching candidate_ids strictly inside cat_dir
        if not source_file:
            for b_dir in base_cache_dirs:
                cat_dir = b_dir / arm_category
                if not cat_dir.exists():
                    continue
                # Require an EXACT id match. A substring match ("my_robot" also
                # matching "my_robot_follower.json") could hand back the wrong
                # arm's calibration, which is worse than reporting none.
                for json_file in cat_dir.rglob("*.json"):
                    if json_file.stem in candidate_ids:
                        source_file = json_file
                        log.info("Found active calibration file by fallback scan: %s", source_file)
                        break
                if source_file:
                    break

        if not source_file or not source_file.exists():
            log.warning("No active calibration found in LeRobot cache at %s / %s", arm_category, device_type)
            return None

        # Destination in project folder
        project_cal_dir = self.get_project_calibration_dir()
        if not project_cal_dir:
            return None

        target_dir = project_cal_dir / arm_category / device_type
        target_dir.mkdir(parents=True, exist_ok=True)

        device_prefix = candidate_ids[0] if candidate_ids else "calib"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target_filename = f"{device_prefix}_backup_{timestamp}.json"
        target_file = target_dir / target_filename

        try:
            shutil.copy2(source_file, target_file)
            log.info("Backed up active calibration %s to %s", source_file, target_file)
            
            # Automatically bind this new backup to the project config
            self._update_setup_binding(actual_setup_id, arm_category, target_filename)
            
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

        # Source in project or LeRobot cache
        project_cal_dir = self.get_project_calibration_dir()
        source_file = (project_cal_dir / arm_category / device_type / filename) if project_cal_dir else Path(filename)
        if not source_file.exists():
            # Check global LeRobot cache directory as fallback
            source_file = (self.get_lerobot_calibration_dir() / arm_category
                           / self.lerobot_device_dirname(device_type) / filename)

        if not source_file.exists():
            log.error("Source calibration file '%s' not found in project or LeRobot cache", filename)
            return False

        # Ensure copied into project directory if not already there
        if project_cal_dir:
            proj_target = project_cal_dir / arm_category / device_type / filename
            if not proj_target.exists() and source_file != proj_target:
                proj_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, proj_target)

        # Exactly ONE destination — the path LeRobot actually reads. Writing the
        # same file under every plausible directory/id combination (which this
        # used to do) produced 9 copies per arm, none of them authoritative, and
        # left stale ones behind to be "restored" later.
        dest_dir = self.get_lerobot_calibration_dir() / arm_category / self.lerobot_device_dirname(device_type)
        dest_file = dest_dir / f"{device_id}.json"

        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, dest_file)
            log.info("Applied calibration %s -> %s", source_file, dest_file)

            self._prune_stale_cache_copies(arm_category, device_type, device_id)

            # Save binding
            self._update_setup_binding(robot_setup_id, arm_category, filename)

            return True
        except Exception as e:
            log.error("Failed to apply calibration: %s", e)
            return False

    def _prune_stale_cache_copies(self, arm_category: str, device_type: str, device_id: str) -> None:
        """Remove copies of this device's calibration outside the canonical path.

        Earlier versions fanned each calibration out across several directory
        and filename variants. Those leftovers are indistinguishable from a real
        calibration to the user and can be picked up by the mtime fallback in
        backup_active_calibration, so a stale one silently becomes "active".
        """
        cal_root = self.get_lerobot_calibration_dir() / arm_category
        if not cal_root.exists():
            return
        keep = (cal_root / self.lerobot_device_dirname(device_type) / f"{device_id}.json").resolve()
        for stale in cal_root.glob("*/*.json"):
            try:
                if stale.resolve() == keep:
                    continue
            except OSError:
                continue
            try:
                stale.unlink()
                log.info("Pruned stale calibration copy %s", stale)
            except OSError as e:
                log.warning("Could not prune stale calibration %s: %s", stale, e)
        # Drop directories left empty by the pruning above.
        for d in cal_root.iterdir():
            if d.is_dir() and not any(d.iterdir()):
                try:
                    d.rmdir()
                except OSError:
                    pass

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
        """Delete a calibration file from the project's local folder and/or LeRobot global cache."""
        project_cal_dir = self.get_project_calibration_dir()
        target_file = (project_cal_dir / arm_category / device_type / filename) if project_cal_dir else None
        
        cache_cal_dir = self.get_lerobot_calibration_dir()
        cache_file = cache_cal_dir / arm_category / self.lerobot_device_dirname(device_type) / filename

        deleted = False
        if target_file and target_file.exists():
            try:
                target_file.unlink()
                deleted = True
                log.info("Deleted project calibration file %s", target_file)
            except Exception as e:
                log.error("Failed to delete project calibration file: %s", e)

        if cache_file and cache_file.exists():
            try:
                cache_file.unlink()
                deleted = True
                log.info("Deleted cache calibration file %s", cache_file)
            except Exception as e:
                log.error("Failed to delete cache calibration file: %s", e)

        # Previously this swept a hardcoded list of "likely" ids, which could
        # delete a different arm's calibration. Only the deployed copy of THIS
        # file is removed now.
        for default_name in (filename,):
            c_f = cache_cal_dir / arm_category / self.lerobot_device_dirname(device_type) / default_name
            if c_f.exists():
                try:
                    c_f.unlink()
                    deleted = True
                    log.info("Deleted active device calibration cache %s", c_f)
                except Exception:
                    pass

        if deleted:
            meta = self._load_meta()
            if meta.pop(filename, None) is not None:
                self._save_meta(meta)

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

            event_bus.calibration_list_changed.emit()
            return True
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
        """Helper to save the calibration binding in the project config.

        Deliberately emits calibration_list_changed, NOT project_opened:
        apply_calibration() is itself called from deploy_active_bindings(),
        which runs INSIDE the project_opened handler (Controller.
        _on_project_opened) on every project open. Re-emitting project_opened
        from here would re-enter that handler, which re-deploys bindings,
        which calls apply_calibration() again — infinite recursion the
        instant any calibration is bound (verified: crashes the process).
        """
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
        event_bus.calibration_list_changed.emit()

    def purge_all_calibrations(self) -> dict[str, Any]:
        """
        Purge all calibration files in current project, all projects in projects_dir,
        and LeRobot global caches, reset active calibration bindings, and return summary.
        """
        from orchiday.core.constants import APP_DATA_DIR
        from orchiday.core.config import AppConfig
        purged_count = 0
        dirs_to_clean: set[Path] = set()

        # Project calibration dir
        proj_cal_dir = self.get_project_calibration_dir()
        if proj_cal_dir and proj_cal_dir.exists():
            dirs_to_clean.add(proj_cal_dir)

        # All projects in projects_dir
        try:
            cfg = AppConfig()
            p_root = cfg.get("projects_dir")
            if p_root:
                p_path = Path(p_root)
                if p_path.exists():
                    for proj_folder in p_path.iterdir():
                        if proj_folder.is_dir() and (proj_folder / "calibration").exists():
                            dirs_to_clean.add(proj_folder / "calibration")
        except Exception as e:
            log.warning("Failed scanning projects_dir for calibration purge: %s", e)

        # Global/Local LeRobot cache dirs
        dirs_to_clean.add(self.get_lerobot_calibration_dir())
        dirs_to_clean.add(APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "calibration")

        for c_dir in dirs_to_clean:
            if not c_dir.exists():
                continue
            for json_file in list(c_dir.rglob("*.json")):
                try:
                    json_file.unlink()
                    purged_count += 1
                    log.info("Purged calibration file: %s", json_file)
                except Exception as e:
                    log.warning("Failed to delete %s: %s", json_file, e)

        # Clear bindings in active project
        if self._pm.current_project:
            for r in self._pm.current_project.get("robots", []):
                r.pop("follower_calibration", None)
                r.pop("leader_calibration", None)
            self._pm.save_project()

        # Clear bindings in all project.json files across projects_dir
        try:
            p_root = AppConfig().get("projects_dir")
            if p_root:
                p_path = Path(p_root)
                if p_path.exists():
                    for proj_folder in p_path.iterdir():
                        p_file = proj_folder / "project.json"
                        if p_file.exists():
                            try:
                                with open(p_file, "r", encoding="utf-8") as f:
                                    p_data = json.load(f)
                                if isinstance(p_data, dict) and "robots" in p_data:
                                    mod = False
                                    for r in p_data.get("robots", []):
                                        if "follower_calibration" in r or "leader_calibration" in r:
                                            r.pop("follower_calibration", None)
                                            r.pop("leader_calibration", None)
                                            mod = True
                                    if mod:
                                        with open(p_file, "w", encoding="utf-8") as f:
                                            json.dump(p_data, f, indent=2)
                            except Exception:
                                pass
        except Exception:
            pass

        # Clear meta.json
        meta_p = self._meta_path()
        if meta_p and meta_p.exists():
            try:
                meta_p.unlink()
            except Exception:
                pass

        event_bus.calibration_list_changed.emit()
        log.info("Purged %d calibration files across all projects and LeRobot cache", purged_count)
        return {"ok": True, "purged_count": purged_count}

