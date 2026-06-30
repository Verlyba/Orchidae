"""
Cross-platform OpenCV capture helpers.

Picks the fastest native capture backend per OS instead of letting OpenCV
probe them all (which is very slow on Windows/MSMF):

- Windows: DirectShow (CAP_DSHOW) — opens in ~100 ms vs seconds with MSMF.
- Linux:   Video4Linux2 (CAP_V4L2) — robust with USB UVC cameras.
- macOS:   AVFoundation (CAP_AVFOUNDATION).

Falls back to OpenCV's default backend when the preferred one fails.
"""

from __future__ import annotations

import logging
import sys

import cv2

log = logging.getLogger(__name__)


def preferred_backend() -> int | None:
    """Return the preferred cv2 capture backend constant for this OS."""
    if sys.platform == "win32":
        return cv2.CAP_DSHOW
    if sys.platform == "darwin":
        return getattr(cv2, "CAP_AVFOUNDATION", None)
    if sys.platform.startswith("linux"):
        return cv2.CAP_V4L2
    return None


def open_capture(source: int | str) -> cv2.VideoCapture:
    """
    Open a camera with the platform's native backend, falling back to
    OpenCV's auto-detection. Always returns a VideoCapture (check isOpened()).
    """
    backend = preferred_backend()
    if isinstance(source, int) and backend is not None:
        cap = cv2.VideoCapture(source, backend)
        if cap.isOpened():
            return cap
        cap.release()
        log.debug("Preferred capture backend failed for source %s — using default.", source)
    return cv2.VideoCapture(source)


def camera_device_label(index: int) -> str:
    """Human-readable device path/name for a camera index, per platform."""
    if sys.platform.startswith("linux"):
        return f"/dev/video{index}"
    return f"Camera {index}"
