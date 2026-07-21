"""
Portability — export/import self-contained Orchiday bundles.

A bundle (``.orchiday`` = a ZIP) makes a project fully transferable between
machines: it carries the project definition (skills + their descriptions,
robots, cameras, orchestration config), optionally the recorded LeRobot
datasets, and optionally the trained policy checkpoints.

Layout inside the archive::

    manifest.json                       bundle metadata (versions, contents)
    project/                            the project directory tree (project.json, skills/…)
    datasets/lerobot/local/<p>/<slug>/  LeRobotDataset dirs (meta, data, videos)
    models/outputs/training/<name>/     trained checkpoints (pretrained_model, …)

Absolute paths from the source machine are never trusted on import; the
importer recomputes every location from the target machine's config, so a
bundle collected on a laptop trains and runs unchanged on a workstation.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchiday.core.constants import APP_DATA_DIR, PROJECT_FILE, SKILLS_DIR

log = logging.getLogger(__name__)

BUNDLE_FORMAT = "orchiday-bundle/1"


# ── Path resolution (mirrors controller/bridge conventions) ───────────────

def hf_home_for(project: dict | None) -> Path:
    """Root under which LeRobot datasets live for a given project."""
    if project and project.get("dataset_storage_dir"):
        return Path(project["dataset_storage_dir"])
    return APP_DATA_DIR / "data" / "huggingface"


def output_base_for(project: dict | None) -> Path:
    """Root under which training outputs (checkpoints) live for a project."""
    if project and project.get("dataset_storage_dir"):
        return Path(project["dataset_storage_dir"])
    return APP_DATA_DIR / "data"


def dataset_dir(project: dict | None, parent_slug: str, slug: str) -> Path:
    rel = Path(parent_slug, slug) if parent_slug else Path(slug)
    return hf_home_for(project) / "lerobot" / "local" / rel


def policy_slug_for(parent_slug: str, slug: str) -> str:
    return f"{parent_slug}_{slug}" if parent_slug else slug


def lerobot_version(python_exe: str | None) -> str:
    """Best-effort LeRobot version string (for manifest / mismatch warnings)."""
    import subprocess
    if not python_exe:
        return "unknown"
    try:
        r = subprocess.run(
            [python_exe, "-c", "import lerobot; print(lerobot.__version__)"],
            capture_output=True, text=True, timeout=8,
        )
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return "unknown"


# ── Skill / dataset / model enumeration ───────────────────────────────────

def _iter_skill_targets(project: dict) -> list[dict[str, Any]]:
    """Return per-skill dataset + model on-disk locations for the project."""
    skills = project.get("skills", [])
    details = project.get("skills_details", {})
    policy_type = project.get("policy_architecture", "diffusion")
    out_base = output_base_for(project)
    out = []
    for slug in skills:
        parent = (details.get(slug, {}) or {}).get("parent_slug") or ""
        ds = dataset_dir(project, parent, slug)
        pslug = policy_slug_for(parent, slug)
        # model dir may carry a _vN suffix from resume-safe naming
        model_matches = sorted(
            (out_base / "outputs" / "training").glob(f"{pslug}_{policy_type}*")
        ) if (out_base / "outputs" / "training").exists() else []
        out.append({
            "slug": slug,
            "parent": parent,
            "dataset_dir": ds,
            "dataset_rel": (Path(parent, slug) if parent else Path(slug)),
            "models": [m for m in model_matches if m.is_dir()],
        })
    return out


# ── Export ─────────────────────────────────────────────────────────────────

def build_project_bundle(
    project: dict,
    project_path: Path,
    dest_zip: Path,
    include_datasets: bool = True,
    include_models: bool = False,
    python_exe: str | None = None,
) -> dict[str, Any]:
    """Write a full ``.orchiday`` bundle. Returns the manifest dict."""
    targets = _iter_skill_targets(project)
    included_datasets, included_models = [], []

    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Project tree (definitions, skill descriptions, calibration, …)
        for root, _dirs, files in os.walk(project_path):
            for f in files:
                fp = Path(root) / f
                arc = Path("project") / fp.relative_to(project_path)
                zf.write(fp, arc.as_posix())

        # 2. Datasets
        if include_datasets:
            for t in targets:
                ds: Path = t["dataset_dir"]
                if ds.exists() and ds.is_dir():
                    for root, _d, files in os.walk(ds):
                        for f in files:
                            fp = Path(root) / f
                            arc = Path("datasets/lerobot/local") / t["dataset_rel"] / fp.relative_to(ds)
                            zf.write(fp, arc.as_posix())
                    included_datasets.append(str(t["dataset_rel"].as_posix()))

        # 3. Models (trained checkpoints)
        if include_models:
            for t in targets:
                for m in t["models"]:
                    for root, _d, files in os.walk(m):
                        for f in files:
                            fp = Path(root) / f
                            arc = Path("models/outputs/training") / m.name / fp.relative_to(m)
                            zf.write(fp, arc.as_posix())
                    included_models.append(m.name)

        # 4. Manifest
        manifest = {
            "format": BUNDLE_FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "app_version": "0.1.0",
            "lerobot_version": lerobot_version(python_exe),
            "project_slug": project.get("slug", "project"),
            "project_name": project.get("name", project.get("slug", "project")),
            "policy_architecture": project.get("policy_architecture", "diffusion"),
            "skills": project.get("skills", []),
            "contents": {
                "project": True,
                "datasets": included_datasets,
                "models": included_models,
            },
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

    return manifest


def build_model_bundle(project: dict, skill_slug: str, dest_zip: Path) -> dict[str, Any]:
    """Zip just the trained checkpoint(s) for one skill (send a model back)."""
    targets = {t["slug"]: t for t in _iter_skill_targets(project)}
    t = targets.get(skill_slug)
    if not t or not t["models"]:
        raise FileNotFoundError(f"No trained model found on disk for skill '{skill_slug}'.")

    names = []
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for m in t["models"]:
            for root, _d, files in os.walk(m):
                for f in files:
                    fp = Path(root) / f
                    arc = Path("models/outputs/training") / m.name / fp.relative_to(m)
                    zf.write(fp, arc.as_posix())
            names.append(m.name)
        manifest = {
            "format": BUNDLE_FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "kind": "model",
            "project_slug": project.get("slug", ""),
            "skill": skill_slug,
            "models": names,
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
    return manifest


# ── Import ───────────────────────────────────────────────────────────────

def _safe_members(zf: zipfile.ZipFile, base: Path) -> list[str]:
    """Zip-slip guard: reject any entry that escapes the extraction root."""
    safe = []
    base_res = base.resolve()
    for name in zf.namelist():
        target = (base / name).resolve()
        if base_res == target or base_res in target.parents:
            safe.append(name)
        else:
            log.warning("Skipping unsafe archive entry: %s", name)
    return safe


def import_project_bundle(zip_path: Path, projects_dir: Path) -> dict[str, Any]:
    """
    Extract a bundle onto this machine. The project is placed under
    ``projects_dir`` (slug collisions get a numeric suffix); datasets and
    models are restored into this machine's default local cache. Returns
    {slug, path, manifest} — the caller opens the project afterwards.
    """
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp, members=_safe_members(zf, tmp))

        manifest = {}
        mf = tmp / "manifest.json"
        if mf.exists():
            manifest = json.loads(mf.read_text(encoding="utf-8"))

        src_project = tmp / "project"
        if not (src_project / PROJECT_FILE).exists():
            raise ValueError("Bundle does not contain a valid project (missing project.json).")

        # Resolve a non-colliding destination slug
        slug = manifest.get("project_slug") or "imported_project"
        dest = projects_dir / slug
        base_slug, n = slug, 1
        while dest.exists():
            slug = f"{base_slug}_{n}"
            dest = projects_dir / slug
            n += 1

        shutil.copytree(src_project, dest)

        # Rewrite project.json so paths belong to THIS machine, not the source.
        proj_file = dest / PROJECT_FILE
        try:
            data = json.loads(proj_file.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        data["slug"] = slug
        data.pop("path", None)
        data.pop("_path", None)
        # Use the default local cache on this machine (portable, always exists)
        data["dataset_storage_dir"] = ""
        data.pop("lerobot_dir", None)
        proj_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        # Restore datasets into the default local cache
        src_ds = tmp / "datasets" / "lerobot" / "local"
        if src_ds.exists():
            target_ds = APP_DATA_DIR / "data" / "huggingface" / "lerobot" / "local"
            target_ds.mkdir(parents=True, exist_ok=True)
            for child in src_ds.iterdir():
                _merge_tree(child, target_ds / child.name)

        # Restore trained checkpoints
        src_models = tmp / "models" / "outputs" / "training"
        if src_models.exists():
            target_models = APP_DATA_DIR / "data" / "outputs" / "training"
            target_models.mkdir(parents=True, exist_ok=True)
            for child in src_models.iterdir():
                _merge_tree(child, target_models / child.name)

        return {"slug": slug, "path": str(dest), "manifest": manifest}


def import_model_bundle(zip_path: Path, project: dict | None) -> list[str]:
    """Restore trained checkpoint(s) from a model bundle into this machine."""
    import tempfile
    restored = []
    target_models = output_base_for(project) / "outputs" / "training"
    target_models.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp, members=_safe_members(zf, tmp))
        src_models = tmp / "models" / "outputs" / "training"
        if not src_models.exists():
            raise ValueError("Bundle does not contain any models.")
        for child in src_models.iterdir():
            _merge_tree(child, target_models / child.name)
            restored.append(child.name)
    return restored


def _merge_tree(src: Path, dest: Path) -> None:
    """Copy `src` dir onto `dest`, overwriting files but keeping siblings."""
    if src.is_dir():
        dest.mkdir(parents=True, exist_ok=True)
        for child in src.iterdir():
            _merge_tree(child, dest / child.name)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
