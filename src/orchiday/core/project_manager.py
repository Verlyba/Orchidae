"""
Project manager — CRUD operations on Orchiday user projects.

Each project is a directory with a ``project.json`` config and sub-directories
for robots, cameras, models, skills, and logs.
"""

from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchiday.core.constants import (
    CAMERAS_FILE,
    LOGS_DIR,
    MODELS_DIR,
    ORCHESTRATION_DIR,
    POLICIES_DIR,
    PROJECT_FILE,
    ROBOTS_DIR,
    SKILLS_DIR,
    DEFAULT_LM_STUDIO_URL,
    DEFAULT_LLM_SYSTEM_PROMPT,
    DEFAULT_LATCH_STRATEGY,
    DEFAULT_TASK_TIMEOUT_S,
)
from orchiday.core.config import AppConfig, RecentProjects
from orchiday.core.events import event_bus

log = logging.getLogger(__name__)


class ProjectManager:
    """
    Manages the full lifecycle of user projects.

    Attributes:
        current_project: Currently opened project dict or None.
        current_path: Path to the current project directory.
    """

    def __init__(self) -> None:
        self._config = AppConfig()
        self._recent = RecentProjects()
        self.current_project: dict[str, Any] | None = None
        self.current_path: Path | None = None

    # ── Create ───────────────────────────────────────────────────────────

    def create_project(
        self, name: str, slug: str, parent_dir: Path | None = None
    ) -> dict[str, Any]:
        """
        Create a new project with full directory structure.

        Raises:
            FileExistsError: If a project with the same slug already exists.
        """
        base = parent_dir or self._config.projects_dir
        project_dir = base / slug

        if project_dir.exists():
            raise FileExistsError(f"Project '{slug}' already exists in {base}")

        subdirs = [
            ROBOTS_DIR, "cameras", MODELS_DIR, POLICIES_DIR,
            SKILLS_DIR, ORCHESTRATION_DIR, LOGS_DIR,
        ]
        for subdir in subdirs:
            (project_dir / subdir).mkdir(parents=True, exist_ok=True)

        project_data: dict[str, Any] = {
            "name": name,
            "slug": slug,
            "version": "1.0",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "robots": [],
            "cameras": [],
            "policy_architecture": "diffusion",
            "models": {
                "llm_ceo": {
                    "endpoint": DEFAULT_LM_STUDIO_URL,
                    "model_name": "",
                    "system_prompt": DEFAULT_LLM_SYSTEM_PROMPT,
                },
                "vlm_inspector": {
                    "endpoint": DEFAULT_LM_STUDIO_URL,
                    "model_name": "",
                },
            },
            "skills": [],
            "orchestration": {
                "latch_strategy": DEFAULT_LATCH_STRATEGY,
                "default_timeout_s": DEFAULT_TASK_TIMEOUT_S,
            },
        }

        with open(project_dir / PROJECT_FILE, "w", encoding="utf-8") as f:
            json.dump(project_data, f, indent=2, ensure_ascii=False)

        with open(project_dir / CAMERAS_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2)

        with open(project_dir / ORCHESTRATION_DIR / "pipeline.json", "w", encoding="utf-8") as f:
            json.dump({
                "latch_strategy": DEFAULT_LATCH_STRATEGY,
                "default_timeout_s": DEFAULT_TASK_TIMEOUT_S,
            }, f, indent=2)

        log.info("Project '%s' created at %s", name, project_dir)
        project_data["path"] = str(project_dir)
        project_data["_path"] = str(project_dir)
        self._recent.add(name, str(project_dir))
        event_bus.project_created.emit(project_data)
        return project_data

    # ── Open / Save / Close ──────────────────────────────────────────────

    def open_project(self, project_dir: Path) -> dict[str, Any]:
        project_file = project_dir / PROJECT_FILE
        if not project_file.exists():
            raise FileNotFoundError(f"{project_file} not found")

        with open(project_file, "r", encoding="utf-8") as f:
            project_data = json.load(f)

        # Load skill details dynamically!
        skills_details = {}
        skills_dir = project_dir / SKILLS_DIR
        if skills_dir.exists():
            for p in skills_dir.iterdir():
                if p.is_dir() and (p / "skill.json").exists():
                    try:
                        with open(p / "skill.json", "r", encoding="utf-8") as sf:
                            skills_details[p.name] = json.load(sf)
                    except Exception:
                        pass
        project_data["skills_details"] = skills_details
        project_data["path"] = str(project_dir)
        project_data["_path"] = str(project_dir)

        self.current_project = project_data
        self.current_path = project_dir
        self._recent.add(project_data.get("name", "Unnamed"), str(project_dir))
        event_bus.project_opened.emit(project_data)
        log.info("Project '%s' opened", project_data.get("name"))
        return project_data

    def save_project(self) -> None:
        if self.current_project is None or self.current_path is None:
            return
        # Pop skills_details before saving project.json so we keep it clean!
        project_data = self.current_project.copy()
        project_data.pop("skills_details", None)
        with open(self.current_path / PROJECT_FILE, "w", encoding="utf-8") as f:
            json.dump(project_data, f, indent=2, ensure_ascii=False)
        event_bus.project_saved.emit()

    def close_project(self) -> None:
        if self.current_project:
            self.save_project()
            self.current_project = None
            self.current_path = None
            event_bus.project_closed.emit()

    def delete_project(self, project_dir: Path) -> None:
        if self.current_path == project_dir:
            self.close_project()
        if project_dir.exists():
            shutil.rmtree(project_dir)
            self._recent.remove(str(project_dir))

    # ── List ─────────────────────────────────────────────────────────────

    def list_projects(self) -> list[dict[str, Any]]:
        projects_dir = self._config.projects_dir
        if not projects_dir.exists():
            return []
        projects = []
        for child in sorted(projects_dir.iterdir()):
            pf = child / PROJECT_FILE
            if child.is_dir() and pf.exists():
                try:
                    with open(pf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    data["_path"] = str(child)
                    
                    # Parse actual readable skill names from skill.json files inside skills/ subdirs
                    skills_names = []
                    skills_dir = child / SKILLS_DIR
                    if skills_dir.exists():
                        for p in sorted(skills_dir.iterdir()):
                            if p.is_dir() and (p / "skill.json").exists():
                                try:
                                    with open(p / "skill.json", "r", encoding="utf-8") as sf:
                                        s_data = json.load(sf)
                                        skills_names.append(s_data.get("name", p.name))
                                except Exception:
                                    pass
                    if not skills_names and data.get("skills"):
                        skills_names = data["skills"]
                    data["skills_names"] = skills_names
                    
                    projects.append(data)
                except (json.JSONDecodeError, OSError):
                    pass
        return projects

    @property
    def recent_projects(self) -> list[dict[str, str]]:
        return self._recent.items

    # ── Robot CRUD ───────────────────────────────────────────────────────

    def add_robot(self, robot_config: dict[str, Any]) -> None:
        """Add a robot to the current project. Works with ANY LeRobot robot type."""
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project.setdefault("robots", []).append(robot_config)
        robot_dir = self.current_path / ROBOTS_DIR / robot_config["id"]
        robot_dir.mkdir(parents=True, exist_ok=True)
        with open(robot_dir / "config.json", "w", encoding="utf-8") as f:
            json.dump(robot_config, f, indent=2, ensure_ascii=False)
        self.save_project()
        event_bus.robot_added.emit(robot_config)

    def remove_robot(self, robot_id: str) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project["robots"] = [
            r for r in self.current_project.get("robots", []) if r.get("id") != robot_id
        ]
        robot_dir = self.current_path / ROBOTS_DIR / robot_id
        if robot_dir.exists():
            shutil.rmtree(robot_dir)
        self.save_project()
        event_bus.robot_removed.emit(robot_id)

    def get_robot(self, robot_id: str) -> dict[str, Any] | None:
        if self.current_project is None:
            return None
        for r in self.current_project.get("robots", []):
            if r.get("id") == robot_id:
                return r
        return None

    # ── Camera CRUD ──────────────────────────────────────────────────────

    def add_camera(self, camera_config: dict[str, Any]) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project.setdefault("cameras", []).append(camera_config)
        self.save_project()
        event_bus.camera_added.emit(camera_config)

    def remove_camera(self, camera_id: str) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project["cameras"] = [
            c for c in self.current_project.get("cameras", []) if c.get("id") != camera_id
        ]
        self.save_project()
        event_bus.camera_removed.emit(camera_id)

    # ── Skill CRUD ───────────────────────────────────────────────────────

    def add_skill(self, skill_slug: str, skill_data: dict[str, Any]) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        skill_dir = self.current_path / SKILLS_DIR / skill_slug
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "dataset").mkdir(exist_ok=True)
        with open(skill_dir / "skill.json", "w", encoding="utf-8") as f:
            json.dump(skill_data, f, indent=2, ensure_ascii=False)
        if skill_slug not in self.current_project.get("skills", []):
            self.current_project.setdefault("skills", []).append(skill_slug)
        self.current_project.setdefault("skills_details", {})[skill_slug] = skill_data
        self.save_project()
        event_bus.skill_created.emit(skill_data)

    def update_skill(self, skill_slug: str, name: str, description: str, parent_slug: str | None) -> None:
        if self.current_project is None or self.current_path is None:
            raise RuntimeError("No project open")
        
        skill_dir = self.current_path / SKILLS_DIR / skill_slug
        if not skill_dir.exists():
            raise RuntimeError(f"Skill {skill_slug} does not exist")
            
        skill_file = skill_dir / "skill.json"
        skill_data = {}
        if skill_file.exists():
            try:
                with open(skill_file, "r", encoding="utf-8") as f:
                    skill_data = json.load(f)
            except Exception:
                pass
                
        skill_data["name"] = name
        skill_data["description"] = description
        skill_data["parent_slug"] = parent_slug
        
        with open(skill_file, "w", encoding="utf-8") as f:
            json.dump(skill_data, f, indent=2, ensure_ascii=False)
            
        self.current_project.setdefault("skills_details", {})[skill_slug] = skill_data
        self.save_project()
        event_bus.skill_created.emit(skill_data) # reuse skill_created event to notify changes

    def remove_skill(self, skill_slug: str) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project["skills"] = [
            s for s in self.current_project.get("skills", []) if s != skill_slug
        ]
        if "skills_details" in self.current_project:
            self.current_project["skills_details"].pop(skill_slug, None)
        skill_dir = self.current_path / SKILLS_DIR / skill_slug
        if skill_dir.exists():
            shutil.rmtree(skill_dir)
        self.save_project()
        event_bus.skill_deleted.emit(skill_slug)

    def increment_skill_execution_count(self, skill_slug: str) -> int:
        """Increment the execution (iteration) count of a given step/skill."""
        if self.current_project is None or self.current_path is None:
            return 0
        skill_dir = self.current_path / SKILLS_DIR / skill_slug
        if not skill_dir.exists():
            return 0
        
        skill_file = skill_dir / "skill.json"
        skill_data = {}
        if skill_file.exists():
            try:
                with open(skill_file, "r", encoding="utf-8") as f:
                    skill_data = json.load(f)
            except Exception:
                pass

        count = skill_data.get("execution_count", 0) + 1
        skill_data["execution_count"] = count

        with open(skill_file, "w", encoding="utf-8") as f:
            json.dump(skill_data, f, indent=2, ensure_ascii=False)

        # Update in-memory cache
        self.current_project.setdefault("skills_details", {})[skill_slug] = skill_data
        
        # Broadcast project opened to sync state with frontend
        event_bus.project_opened.emit(self.current_project)
        return count

    # ── Model config ─────────────────────────────────────────────────────

    def update_model_config(self, model_role: str, config: dict[str, Any]) -> None:
        if self.current_project is None:
            raise RuntimeError("No project open")
        self.current_project.setdefault("models", {})[model_role] = config
        self.save_project()
        event_bus.model_configured.emit(model_role, config)
