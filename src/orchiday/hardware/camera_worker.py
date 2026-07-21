"""
Camera worker — runs in its own QThread, captures frames via OpenCV.

Each camera gets its own thread to avoid blocking the main UI.
"""

import logging

import cv2
from PySide6.QtCore import QThread, Signal, Slot, QMutex
from PySide6.QtGui import QImage

from orchiday.core.events import event_bus
from orchiday.hardware.camera_utils import (
    open_capture_configured, register_source, unregister_source)

log = logging.getLogger(__name__)


class CameraWorker(QThread):
    """
    Thread for capturing frames from a camera via OpenCV.

    Signals:
        frame_ready(QImage): A new frame is ready for display.
        error(str): An error occurred.
        started_ok(str): Camera successfully started (camera_id).
        stopped_ok(str): Camera stopped (camera_id).
    """

    frame_ready = Signal(QImage)
    error = Signal(str)
    started_ok = Signal(str)
    stopped_ok = Signal(str)

    def __init__(self, camera_id: str, source: int | str = 0,
                 width: int = 640, height: int = 480, fps: int = 30, parent=None):
        super().__init__(parent)
        self._camera_id = camera_id
        self._source = source
        self._width = width
        self._height = height
        self._fps = fps
        self._running = False
        self._mutex = QMutex()
        self._last_frame = None

    @property
    def camera_id(self) -> str:
        return self._camera_id

    def run(self) -> None:
        """Main capture loop."""
        self._running = True

        # Claim the device BEFORE opening so hardware scans skip it (probing a
        # device that is being streamed crashes Windows capture backends).
        register_source(self._source)
        try:
            cap = open_capture_configured(self._source, self._width, self._height, self._fps)
            if not cap.isOpened():
                msg = f"Cannot open camera: {self._source}"
                log.error(msg)
                self.error.emit(msg)
                return

            log.info("Camera %s started (source=%s, %dx%d, %d FPS)",
                     self._camera_id, self._source, self._width, self._height, self._fps)
            self.started_ok.emit(self._camera_id)

            frame_delay = max(1, int(1000 / self._fps))

            while self._running:
                ret, frame = cap.read()
                if ret:
                    self._mutex.lock()
                    self._last_frame = frame.copy()
                    self._mutex.unlock()

                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    h, w, ch = rgb.shape
                    qt_image = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888).copy()
                    self.frame_ready.emit(qt_image)
                    event_bus.camera_frame_ready.emit(self._camera_id, qt_image)
                else:
                    self.msleep(100)
                    continue
                self.msleep(frame_delay)

            cap.release()
            log.info("Camera %s stopped", self._camera_id)
            self.stopped_ok.emit(self._camera_id)
        finally:
            unregister_source(self._source)

    @Slot()
    def stop(self) -> None:
        """Safely stop the capture thread."""
        self._mutex.lock()
        self._running = False
        self._mutex.unlock()
        self.wait(5000)

    def get_last_frame_b64(self) -> str | None:
        """Get the last captured frame as a base64 encoded JPEG string."""
        self._mutex.lock()
        frame = self._last_frame.copy() if self._last_frame is not None else None
        self._mutex.unlock()

        if frame is None:
            return None
        try:
            import base64
            ret, buffer = cv2.imencode(".jpg", frame)
            if ret:
                return base64.b64encode(buffer).decode("utf-8")
        except Exception as e:
            log.error("Failed to encode frame to base64: %s", e)
        return None


class CameraManager:
    """
    Manages multiple CameraWorker instances.

    Usage:
        manager = CameraManager()
        worker = manager.start_camera("cam1", source=0)
        manager.stop_camera("cam1")
    """

    def __init__(self):
        self._workers: dict[str, CameraWorker] = {}

    def start_camera(self, camera_id: str, source: int | str = 0,
                     width: int = 640, height: int = 480, fps: int = 30) -> CameraWorker | None:
        if camera_id in self._workers:
            log.warning("Camera %s is already running", camera_id)
            return self._workers[camera_id]
        # One physical device = one owner. A second worker on the same source
        # would fail to open at best and crash the OS backend at worst.
        for other in self._workers.values():
            if str(other._source) == str(source):
                msg = (f"Camera source '{source}' is already used by '{other.camera_id}' — "
                       f"'{camera_id}' not started. Assign a different device index.")
                log.warning(msg)
                event_bus.camera_error.emit(camera_id, msg)
                event_bus.log_message.emit("WARN", msg)
                return None
        worker = CameraWorker(camera_id, source, width, height, fps)
        self._workers[camera_id] = worker
        worker.start()
        return worker

    def stop_camera(self, camera_id: str) -> None:
        if camera_id in self._workers:
            self._workers.pop(camera_id).stop()

    def stop_all(self) -> None:
        for cam_id in list(self._workers.keys()):
            self.stop_camera(cam_id)

    def get_worker(self, camera_id: str) -> CameraWorker | None:
        return self._workers.get(camera_id)

    @property
    def active_cameras(self) -> list[str]:
        return list(self._workers.keys())

    def get_camera_frame_b64(self, camera_id: str) -> str | None:
        """Get the last frame from a camera as a base64 encoded JPEG string."""
        worker = self.get_worker(camera_id)
        if worker:
            return worker.get_last_frame_b64()
        return None
