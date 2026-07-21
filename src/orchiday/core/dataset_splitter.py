#!/usr/bin/env python3
"""
Orchiday dataset splitter — cuts one recorded LeRobot dataset into per-step
sub-datasets using step-mark flags clicked in the UI during recording.

Methodology (thesis comparability):
    The FULL source dataset trains the monolithic baseline policy (e.g. ACT).
    The per-step datasets produced here train the orchestration's small
    per-step models. Both come from the SAME demonstrations, so the two
    approaches are directly comparable — no extra data is collected for
    either side.

Input:
    --repo-id      source dataset, e.g. "local/pick_and_place"
    --marks        path to the step-marks sidecar JSON written by the app:
                   {"episodes": {"0": [{"t": 3.42, "step": 1, "label": "lift"}]}}
                   Mark times are seconds from the episode start and align with
                   the dataset's per-frame `timestamp` column.
    --steps-json   ordered JSON list [{"slug", "repo_id", "task"}, ...] —
                   segment k of every episode is appended to steps[k].
    --require-complete
                   "true" (default): skip episodes whose mark count is not
                   exactly len(steps) - 1; "false": clamp extra segments into
                   the last step and pad missing boundaries at episode end.

Output:
    One LeRobotDataset per step (existing target dirs are replaced) plus a
    split manifest JSON next to the marks file.

This script is intentionally self-contained (no orchiday imports) — it runs
inside the LeRobot Python environment, which does not have Orchiday installed.
"""

from __future__ import annotations

import argparse
import bisect
import json
import logging
import shutil
import sys
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("dataset_splitter")

# Per-frame columns managed automatically by LeRobotDataset — never copied
AUTO_FEATURES = {"timestamp", "frame_index", "episode_index", "index", "task_index"}


def _lerobot_home() -> Path:
    """Resolve HF_LEROBOT_HOME the same way LeRobot does."""
    try:
        from lerobot.utils.constants import HF_LEROBOT_HOME  # >= 0.5
        return Path(HF_LEROBOT_HOME)
    except ImportError:
        pass
    try:
        from lerobot.constants import HF_LEROBOT_HOME  # older layouts
        return Path(HF_LEROBOT_HOME)
    except ImportError:
        pass
    import os
    hf_home = Path(os.getenv("HF_HOME", Path.home() / ".cache" / "huggingface"))
    return Path(os.getenv("HF_LEROBOT_HOME", hf_home / "lerobot"))


def _to_image(value) -> np.ndarray:
    """Convert a decoded video frame (torch CHW float [0,1]) to HWC uint8."""
    arr = value.numpy() if hasattr(value, "numpy") else np.asarray(value)
    if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[0] < arr.shape[-1]:
        arr = np.transpose(arr, (1, 2, 0))
    if arr.dtype != np.uint8:
        arr = (np.clip(arr, 0.0, 1.0) * 255.0).round().astype(np.uint8)
    return np.ascontiguousarray(arr)


def _to_value(value) -> np.ndarray:
    arr = value.numpy() if hasattr(value, "numpy") else np.asarray(value)
    return arr


def main() -> int:
    parser = argparse.ArgumentParser(description="Split a LeRobot dataset at step marks")
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--marks", required=True)
    parser.add_argument("--steps-json", required=True)
    parser.add_argument("--require-complete", default="true")
    args = parser.parse_args()

    require_complete = args.require_complete.strip().lower() != "false"
    steps: list[dict] = json.loads(args.steps_json)
    if len(steps) < 2:
        log.error("At least 2 steps are required, got %d", len(steps))
        return 2

    with open(args.marks, "r", encoding="utf-8") as f:
        marks_by_episode: dict[str, list[dict]] = json.load(f).get("episodes", {})
    if not marks_by_episode:
        log.error("Marks file contains no episodes: %s", args.marks)
        return 2

    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    log.info("Loading source dataset '%s'...", args.repo_id)
    src = LeRobotDataset(args.repo_id)
    fps = int(src.fps)
    features = {k: v for k, v in src.meta.features.items() if k not in AUTO_FEATURES}
    image_keys = {k for k, v in features.items() if v.get("dtype") in ("video", "image")}
    robot_type = getattr(src.meta, "robot_type", None)
    log.info("Source: %d frames, %d episodes, fps=%d, features=%s",
             len(src), src.meta.total_episodes, fps, sorted(features))

    # ── Create one clean destination dataset per step ─────────────────────
    home = _lerobot_home()
    targets: list = []
    for step in steps:
        target_dir = home / step["repo_id"]
        if target_dir.exists():
            log.info("Replacing existing step dataset at %s", target_dir)
            shutil.rmtree(target_dir)
        dst = LeRobotDataset.create(
            repo_id=step["repo_id"],
            fps=fps,
            features=features,
            robot_type=robot_type,
            use_videos=bool(image_keys),
        )
        targets.append(dst)

    n_boundaries = len(steps) - 1
    stats = {s["repo_id"]: {"episodes": 0, "frames": 0} for s in steps}
    skipped: list[int] = []

    # ── Walk the source frame-by-frame, cutting at mark timestamps ───────
    episodes: dict[int, list[float]] = {}
    for ep_str, marks in marks_by_episode.items():
        times = sorted(float(m["t"]) for m in marks)
        episodes[int(ep_str)] = times

    current_ep = -1
    current_seg = -1
    seg_frames = 0

    def close_segment() -> None:
        """Save the currently buffered segment as one episode of its step dataset."""
        nonlocal seg_frames
        if current_seg >= 0 and seg_frames > 0:
            targets[current_seg].save_episode()
            stats[steps[current_seg]["repo_id"]]["episodes"] += 1
            stats[steps[current_seg]["repo_id"]]["frames"] += seg_frames
        seg_frames = 0

    total = len(src)
    for idx in range(total):
        item = src[idx]
        ep = int(item["episode_index"])
        ts = float(item["timestamp"])

        if ep != current_ep:
            close_segment()
            current_ep = ep
            current_seg = -1

        boundaries = episodes.get(ep)
        if boundaries is None or (require_complete and len(boundaries) != n_boundaries):
            if ep not in skipped:
                skipped.append(ep)
                log.warning("Skipping episode %d: %s marks (expected %d)",
                            ep, "no" if boundaries is None else len(boundaries), n_boundaries)
            continue

        seg = min(bisect.bisect_right(boundaries, ts), len(steps) - 1)
        if seg != current_seg:
            close_segment()
            current_seg = seg

        frame = {}
        for key in features:
            frame[key] = _to_image(item[key]) if key in image_keys else _to_value(item[key])
        frame["task"] = steps[seg]["task"]
        targets[seg].add_frame(frame)
        seg_frames += 1

        if idx % 500 == 0:
            log.info("Progress: frame %d/%d (episode %d, segment %d)", idx, total, ep, seg)

    close_segment()

    # ── Finalize ──────────────────────────────────────────────────────────
    for dst in targets:
        try:
            # Flush pending async video encoding / metadata where supported
            if hasattr(dst, "finalize"):
                dst.finalize()
        except Exception as e:
            log.warning("Finalize failed for %s: %s", dst.repo_id, e)

    manifest = {
        "source": args.repo_id,
        "steps": [s["repo_id"] for s in steps],
        "stats": stats,
        "skipped_episodes": skipped,
    }
    manifest_path = Path(args.marks).with_name(Path(args.marks).name.replace(
        ".step_marks.json", ".split_manifest.json"))
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    log.info("Split complete: %s", json.dumps(stats))
    if skipped:
        log.warning("Skipped %d episode(s) without complete marks: %s", len(skipped), skipped)
    print(f"[SPLIT_DONE] {json.dumps(manifest)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
