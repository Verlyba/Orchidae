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
import threading

import cv2

log = logging.getLogger(__name__)

# OpenCV's Windows backends (DSHOW/MSMF) are NOT thread-safe during device
# enumeration/open — two threads opening captures concurrently can crash the
# whole process with a native access violation. Serialize every open.
_open_lock = threading.Lock()

# Sources currently streamed by a CameraWorker. Probing (open/read/release) a
# device that another handle is actively streaming triggers the same native
# crash — hardware scans must skip these entirely.
_active_sources: set[str] = set()
_sources_lock = threading.Lock()


def register_source(source: int | str) -> None:
    """Mark a camera source as actively streamed (exclusive ownership)."""
    with _sources_lock:
        _active_sources.add(str(source))


def unregister_source(source: int | str) -> None:
    """Release a camera source after its stream stopped."""
    with _sources_lock:
        _active_sources.discard(str(source))


def is_source_active(source: int | str) -> bool:
    """True when a CameraWorker currently owns this source."""
    with _sources_lock:
        return str(source) in _active_sources


def preferred_backend() -> int | None:
    """Return the preferred cv2 capture backend constant for this OS."""
    if sys.platform == "win32":
        return cv2.CAP_DSHOW
    if sys.platform == "darwin":
        return getattr(cv2, "CAP_AVFOUNDATION", None)
    if sys.platform.startswith("linux"):
        return cv2.CAP_V4L2
    return None


def open_capture_configured(source: int | str, width: int, height: int,
                            fps: int) -> cv2.VideoCapture:
    """Open a camera AND apply resolution/FPS while holding the open lock —
    property negotiation on a freshly opened Windows device is part of the
    non-thread-safe window."""
    cap = open_capture(source)
    if cap.isOpened():
        with _open_lock:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            cap.set(cv2.CAP_PROP_FPS, fps)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def open_capture(source: int | str) -> cv2.VideoCapture:
    """
    Open a camera with the platform's native backend, falling back to
    OpenCV's auto-detection. Always returns a VideoCapture (check isOpened()).
    """
    with _open_lock:
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
