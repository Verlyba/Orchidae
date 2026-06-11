"""
Global application configuration for Orchiday.

Manages settings that persist across restarts (recent projects,
UI preferences, default paths).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from orchiday.core.constants import (
    APP_DATA_DIR,
    DEFAULT_PROJECTS_DIR,
    GLOBAL_CONFIG_FILE,
    RECENT_PROJECTS_FILE,
)

log = logging.getLogger(__name__)


_DEFAULT_CONFIG: dict[str, Any] = {
    "projects_dir": str(DEFAULT_PROJECTS_DIR),
    "theme": "dark",
    "language": "en",
    "lm_studio_url": "http://localhost:1234/v1",
    "auto_connect_robot": False,
    "auto_start_cameras": True,
    "window_state": {},
    "lerobot_dir": "/home/verlyba/robotics/lerobot",
    "python_path": "/home/verlyba/miniconda3/envs/lerobot/bin/python",
}


class AppConfig:
    """
    Singleton for global application configuration.

    Loaded from disk on first access, saved on every mutation.
    """

    _instance: AppConfig | None = None
    _data: dict[str, Any]

    def __new__(cls) -> AppConfig:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._data = dict(_DEFAULT_CONFIG)
            cls._instance._load()
        return cls._instance

    def _load(self) -> None:
        if GLOBAL_CONFIG_FILE.exists():
            try:
                with open(GLOBAL_CONFIG_FILE, "r", encoding="utf-8") as f:
                    stored = json.load(f)
                self._data.update(stored)
                log.info("Config loaded from %s", GLOBAL_CONFIG_FILE)
            except (json.JSONDecodeError, OSError) as e:
                log.warning("Cannot load config: %s — using defaults", e)

    def save(self) -> None:
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(GLOBAL_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any, *, auto_save: bool = True) -> None:
        self._data[key] = value
        if auto_save:
            self.save()

    @property
    def projects_dir(self) -> Path:
        return Path(self._data["projects_dir"])

    @projects_dir.setter
    def projects_dir(self, path: Path) -> None:
        self._data["projects_dir"] = str(path)
        self.save()

    @property
    def theme(self) -> str:
        return self._data["theme"]

    @property
    def lm_studio_url(self) -> str:
        return self._data["lm_studio_url"]

    @lm_studio_url.setter
    def lm_studio_url(self, value: str) -> None:
        self._data["lm_studio_url"] = value
        self.save()


class RecentProjects:
    """Maintains a list of recently opened projects (max 10)."""

    MAX_RECENT = 10

    def __init__(self) -> None:
        self._items: list[dict[str, str]] = []
        self._load()

    def _load(self) -> None:
        if RECENT_PROJECTS_FILE.exists():
            try:
                with open(RECENT_PROJECTS_FILE, "r", encoding="utf-8") as f:
                    self._items = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._items = []

    def _save(self) -> None:
        APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(RECENT_PROJECTS_FILE, "w", encoding="utf-8") as f:
            json.dump(self._items, f, indent=2, ensure_ascii=False)

    def add(self, name: str, path: str) -> None:
        self._items = [p for p in self._items if p.get("path") != path]
        self._items.insert(0, {"name": name, "path": path})
        self._items = self._items[: self.MAX_RECENT]
        self._save()

    def remove(self, path: str) -> None:
        self._items = [p for p in self._items if p.get("path") != path]
        self._save()

    @property
    def items(self) -> list[dict[str, str]]:
        return list(self._items)
