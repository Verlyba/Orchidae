"""
Unit tests for CalibrationManager.
"""

from __future__ import annotations

import json
from pathlib import Path
import pytest

from typing import Any

from orchiday.core.project_manager import ProjectManager
from orchiday.core.calibration_manager import CalibrationManager


@pytest.fixture
def temp_project_dir(tmp_path) -> Path:
    proj_dir = tmp_path / "test_project"
    proj_dir.mkdir()
    # Create subdirs
    (proj_dir / "calibration" / "robots").mkdir(parents=True)
    (proj_dir / "calibration" / "teleoperators").mkdir(parents=True)
    return proj_dir


@pytest.fixture
def mock_project_manager(temp_project_dir) -> Any:
    class MockProjectManager:
        def __init__(self):
            self.current_path = temp_project_dir
            self.current_project = {
                "name": "Test Project",
                "slug": "test_project",
                "robots": [
                    {
                        "id": "setup_1",
                        "follower_type": "so100_follower",
                        "follower_id": "F1",
                        "leader_type": "so100_leader",
                        "leader_id": "L1"
                    }
                ]
            }

        def save_project(self):
            # Save mock project config
            with open(self.current_path / "project.json", "w", encoding="utf-8") as f:
                json.dump(self.current_project, f, indent=2)

    return MockProjectManager()


def test_scan_project_calibrations(temp_project_dir, mock_project_manager):
    cm = CalibrationManager(mock_project_manager)
    
    # Pre-check empty
    assert len(cm.scan_project_calibrations()) == 0

    # Write a test calibration file
    dev_dir = temp_project_dir / "calibration" / "robots" / "so100_follower"
    dev_dir.mkdir(parents=True, exist_ok=True)
    cal_file = dev_dir / "F1_calib.json"
    cal_file.write_text('{"joint_offsets": [0,0,0]}')

    # Scan
    results = cm.scan_project_calibrations()
    assert len(results) == 1
    assert results[0]["name"] == "F1_calib.json"
    assert results[0]["category"] == "robots"
    assert results[0]["device_type"] == "so100_follower"


def test_backup_and_apply_calibration(tmp_path, temp_project_dir, mock_project_manager, monkeypatch):
    cm = CalibrationManager(mock_project_manager)

    # Mock global LeRobot cache directory
    mock_global_dir = tmp_path / "global_lerobot_cache"
    monkeypatch.setattr(cm, "get_lerobot_calibration_dir", lambda: mock_global_dir)

    # 1. Create a dummy calibration in mock global cache
    global_cal_file = mock_global_dir / "robots" / "so100_follower" / "F1.json"
    global_cal_file.parent.mkdir(parents=True, exist_ok=True)
    global_cal_file.write_text('{"data": "original_calibration"}')

    # 2. Backup to project
    backed_up_name = cm.backup_active_calibration("setup_1", "robots")
    assert backed_up_name is not None
    assert "F1_backup_" in backed_up_name
    
    # Check project directory has it
    project_backup_file = temp_project_dir / "calibration" / "robots" / "so100_follower" / backed_up_name
    assert project_backup_file.exists()
    assert json.loads(project_backup_file.read_text())["data"] == "original_calibration"

    # Check project config has active binding updated
    assert mock_project_manager.current_project["robots"][0]["follower_calibration"] == backed_up_name

    # 3. Apply calibration (deploy from project to global cache)
    # Modify the backup file contents to simulate a change
    project_backup_file.write_text('{"data": "updated_calibration"}')

    # Run apply
    success = cm.apply_calibration("setup_1", "robots", backed_up_name)
    assert success is True

    # Check that global cache has been overwritten with updated_calibration
    assert json.loads(global_cal_file.read_text())["data"] == "updated_calibration"


def test_import_calibration_from_project(tmp_path, temp_project_dir, mock_project_manager, monkeypatch):
    cm = CalibrationManager(mock_project_manager)

    # Mock global LeRobot cache directory
    mock_global_dir = tmp_path / "global_lerobot_cache"
    monkeypatch.setattr(cm, "get_lerobot_calibration_dir", lambda: mock_global_dir)

    # Create source project directory
    src_proj_dir = tmp_path / "source_project"
    src_cal_dir = src_proj_dir / "calibration" / "robots" / "so100_follower"
    src_cal_dir.mkdir(parents=True, exist_ok=True)
    src_file = src_cal_dir / "F1_calib.json"
    src_file.write_text('{"data": "imported_calibration_data"}')

    # Import to setup_1's follower
    imported_name = cm.import_calibration_from_project(
        source_project_path=src_proj_dir,
        source_category="robots",
        source_device_type="so100_follower",
        source_filename="F1_calib.json",
        target_setup_id="setup_1",
        target_category="robots",
    )

    assert imported_name is not None
    assert "F1_from_source_project_" in imported_name

    # Check that it exists in the current project
    dest_file = temp_project_dir / "calibration" / "robots" / "so100_follower" / imported_name
    assert dest_file.exists()
    assert json.loads(dest_file.read_text())["data"] == "imported_calibration_data"

    # Check that it was applied automatically to the global cache
    global_file = mock_global_dir / "robots" / "so100_follower" / "F1.json"
    assert global_file.exists()
    assert json.loads(global_file.read_text())["data"] == "imported_calibration_data"


def test_delete_calibration_file(temp_project_dir, mock_project_manager):
    cm = CalibrationManager(mock_project_manager)

    # Write a test calibration file and set it bound
    dev_dir = temp_project_dir / "calibration" / "robots" / "so100_follower"
    dev_dir.mkdir(parents=True, exist_ok=True)
    cal_file = dev_dir / "F1_to_delete.json"
    cal_file.write_text('{"joint_offsets": [0,0,0]}')

    mock_project_manager.current_project["robots"][0]["follower_calibration"] = "F1_to_delete.json"

    # Delete
    success = cm.delete_calibration_file("robots", "so100_follower", "F1_to_delete.json")
    assert success is True
    assert not cal_file.exists()

    # Binding must be cleared
    assert "follower_calibration" not in mock_project_manager.current_project["robots"][0]


# ── Arm visual config (calibration-driven animation) ─────────────────────────

def test_arm_visual_config_uses_bound_calibration(temp_project_dir, mock_project_manager):
    cm = CalibrationManager(mock_project_manager)

    follower_joints = {
        "shoulder_pan": {"id": 1, "drive_mode": 0, "homing_offset": -46, "range_min": 815, "range_max": 3283},
        "shoulder_lift": {"id": 2, "drive_mode": 0, "homing_offset": 12, "range_min": 900, "range_max": 3200},
    }
    dev_dir = temp_project_dir / "calibration" / "robots" / "so100_follower"
    dev_dir.mkdir(parents=True, exist_ok=True)
    (dev_dir / "F1.json").write_text(json.dumps(follower_joints))
    mock_project_manager.current_project["robots"][0]["follower_calibration"] = "F1.json"

    config = cm.get_arm_visual_config()
    assert config["ok"] is True
    assert config["robot_id"] == "setup_1"
    assert config["follower"]["source"] == "calibration"
    assert config["follower"]["joints"]["shoulder_pan"]["id"] == 1
    assert config["follower"]["joints"]["shoulder_pan"]["range_max"] == 3283
    # No leader calibration bound -> falls back to generic defaults
    assert config["leader"]["source"] == "default"
    assert config["leader"]["joints"]["gripper"]["id"] == 6


def test_arm_visual_config_no_project():
    from orchiday.core.calibration_manager import CalibrationManager

    class EmptyPM:
        current_project = None
        current_path = None

    cm = CalibrationManager(EmptyPM())
    result = cm.get_arm_visual_config()
    assert result["ok"] is False


def test_arm_visual_config_no_robots(mock_project_manager):
    cm = CalibrationManager(mock_project_manager)
    mock_project_manager.current_project["robots"] = []
    result = cm.get_arm_visual_config()
    assert result["ok"] is False


def test_read_calibration_content_missing_file(temp_project_dir, mock_project_manager):
    cm = CalibrationManager(mock_project_manager)
    assert cm.read_calibration_content(temp_project_dir / "nope.json") is None


def test_read_calibration_content_malformed(tmp_path, mock_project_manager):
    cm = CalibrationManager(mock_project_manager)
    bad = tmp_path / "bad.json"
    bad.write_text("not json{{{")
    assert cm.read_calibration_content(bad) is None
