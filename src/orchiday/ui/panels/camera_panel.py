"""
Camera panel — multi-stream management, toggle on/off, detachable floating windows.
"""

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout,
    QLabel, QLineEdit, QMessageBox, QPushButton, QScrollArea,
    QSpinBox, QVBoxLayout, QWidget,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus
from orchiday.core.constants import DEFAULT_CAMERA_WIDTH, DEFAULT_CAMERA_HEIGHT, DEFAULT_CAMERA_FPS
from orchiday.ui import (
    BG_MEDIUM, BG_DARKEST, BORDER, ACCENT_PRIMARY,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, FONT_SIZE_XL,
)
from orchiday.ui.widgets import ToggleSwitch, StatusIndicator


class NewCameraDialog(QDialog):
    """Dialog for adding a new camera."""

    ROLES = ["hand_camera", "overhead", "side", "wrist", "custom"]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Add Camera")
        self.setMinimumWidth(420)
        self.setModal(True)
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(20)
        layout.setContentsMargins(32, 32, 32, 32)

        title = QLabel("Add Camera")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        form = QFormLayout()
        form.setSpacing(12)

        self._id_input = QLineEdit()
        self._id_input.setPlaceholderText("e.g. cam_hand")
        form.addRow("Camera ID:", self._id_input)

        # Dropdown with auto-detected OpenCV camera devices
        self._source_combo = QComboBox()
        from orchiday.hardware.detection import detect_cameras
        detected = detect_cameras()
        for idx in detected:
            self._source_combo.addItem(f"Detected Camera {idx}", idx)
        self._source_combo.addItem("Custom Device/RTSP...", "custom")
        self._source_combo.currentIndexChanged.connect(self._on_source_changed)
        form.addRow("Source:", self._source_combo)

        # Custom source string text input (hidden by default unless "custom" is selected)
        self._custom_source_input = QLineEdit()
        self._custom_source_input.setPlaceholderText("rtsp://... or custom index")
        self._custom_source_input.setVisible(len(detected) == 0)
        if len(detected) == 0:
            # Set combo to custom if nothing detected
            self._source_combo.setCurrentIndex(self._source_combo.count() - 1)
        form.addRow("Custom Source:", self._custom_source_input)

        self._role_combo = QComboBox()
        self._role_combo.addItems(self.ROLES)
        form.addRow("Role:", self._role_combo)

        self._width_spin = QSpinBox()
        self._width_spin.setRange(160, 3840)
        self._width_spin.setValue(DEFAULT_CAMERA_WIDTH)
        form.addRow("Width:", self._width_spin)

        self._height_spin = QSpinBox()
        self._height_spin.setRange(120, 2160)
        self._height_spin.setValue(DEFAULT_CAMERA_HEIGHT)
        form.addRow("Height:", self._height_spin)

        self._fps_spin = QSpinBox()
        self._fps_spin.setRange(1, 120)
        self._fps_spin.setValue(DEFAULT_CAMERA_FPS)
        form.addRow("FPS:", self._fps_spin)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Add Camera")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_source_changed(self, index: int) -> None:
        data = self._source_combo.currentData()
        self._custom_source_input.setVisible(data == "custom")

    @property
    def camera_config(self) -> dict:
        data = self._source_combo.currentData()
        if data == "custom":
            source_text = self._custom_source_input.text().strip()
            try:
                source = int(source_text)
            except ValueError:
                source = source_text
        else:
            source = data

        return {
            "id": self._id_input.text().strip() or "cam_1",
            "source": source,
            "role": self._role_combo.currentText(),
            "resolution": [self._width_spin.value(), self._height_spin.value()],
            "fps": self._fps_spin.value(),
            "enabled": True,
        }


class CameraFloatWindow(QWidget):
    """Detachable floating window for a camera stream."""

    closed = Signal(str)

    def __init__(self, camera_id: str, parent=None):
        super().__init__(parent, Qt.WindowType.Window)
        self._camera_id = camera_id
        self.setWindowTitle(f"Camera: {camera_id}")
        self.setMinimumSize(320, 240)
        self.resize(640, 480)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self._video_label = QLabel("Waiting for stream...")
        self._video_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._video_label.setStyleSheet(f"background: {BG_DARKEST}; color: {TEXT_MUTED};")
        layout.addWidget(self._video_label)

        event_bus.camera_frame_ready.connect(self._on_frame_ready)

    def _on_frame_ready(self, camera_id: str, image) -> None:
        if camera_id == self._camera_id:
            self.update_frame(image)

    def update_frame(self, image: QImage) -> None:
        pixmap = QPixmap.fromImage(image).scaled(
            self._video_label.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self._video_label.setPixmap(pixmap)

    def closeEvent(self, event) -> None:
        self.closed.emit(self._camera_id)
        super().closeEvent(event)


class CameraCard(QWidget):
    """Card for a single camera with stream preview and controls."""

    remove_requested = Signal(str)
    detach_requested = Signal(str)

    def __init__(self, camera_data: dict, compact: bool = False, parent=None):
        super().__init__(parent)
        self._data = camera_data
        self._compact = compact
        self._cam_id = camera_data.get("id", "cam")
        self._setup_ui()
        event_bus.camera_frame_ready.connect(self._on_frame_ready)

    def _on_frame_ready(self, camera_id: str, image) -> None:
        if camera_id == self._cam_id and self._toggle.isChecked():
            self.update_frame(image)

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"""
            CameraCard {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 8px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setSpacing(6 if self._compact else 8)
        if self._compact:
            layout.setContentsMargins(6, 6, 6, 6)
        else:
            layout.setContentsMargins(10, 10, 10, 10)

        self._video_label = QLabel("Stream off")
        self._video_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._video_label.setFixedHeight(110 if self._compact else 180)
        self._video_label.setStyleSheet(f"background: {BG_DARKEST}; border-radius: 6px; color: {TEXT_MUTED}; font-size: 11px;")
        layout.addWidget(self._video_label)

        controls = QHBoxLayout()
        controls.setSpacing(4 if self._compact else 8)
        info_label = QLabel(self._cam_id)
        fs = 11 if self._compact else 12
        info_label.setStyleSheet(f"font-weight: 600; color: {TEXT_PRIMARY}; font-size: {fs}px;")
        controls.addWidget(info_label)

        if not self._compact:
            role_label = QLabel(self._data.get("role", ""))
            role_label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 11px;")
            controls.addWidget(role_label)
        controls.addStretch()

        self._toggle = ToggleSwitch()
        self._toggle.setChecked(self._data.get("enabled", False))
        self._toggle.toggled_value.connect(self._on_toggle)
        controls.addWidget(self._toggle)

        detach_btn = QPushButton("Detach")
        detach_btn.setFixedHeight(22 if self._compact else 28)
        if self._compact:
            detach_btn.setStyleSheet("font-size: 10px; padding: 2px 6px;")
        detach_btn.setToolTip("Open in floating window")
        detach_btn.clicked.connect(lambda: self.detach_requested.emit(self._cam_id))
        controls.addWidget(detach_btn)

        remove_btn = QPushButton("X")
        remove_btn.setObjectName("danger_button")
        if self._compact:
            remove_btn.setFixedSize(22, 22)
            remove_btn.setStyleSheet("font-size: 9px; padding: 0;")
        else:
            remove_btn.setFixedSize(28, 28)
        remove_btn.clicked.connect(lambda: self.remove_requested.emit(self._cam_id))
        controls.addWidget(remove_btn)

        layout.addLayout(controls)

    def _on_toggle(self, checked: bool) -> None:
        if checked:
            self._video_label.setText("Connecting...")
            event_bus.camera_started.emit(self._cam_id)
        else:
            self._video_label.setText("Stream off")
            self._video_label.setPixmap(QPixmap())
            event_bus.camera_stopped.emit(self._cam_id)

    def update_frame(self, image: QImage) -> None:
        pixmap = QPixmap.fromImage(image).scaled(
            self._video_label.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self._video_label.setPixmap(pixmap)


class CameraPanel(QWidget):
    """Panel for managing cameras in the project."""

    def __init__(self, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._compact = compact
        self._float_windows: dict[str, CameraFloatWindow] = {}
        self._camera_cards: dict[str, CameraCard] = {}
        self._setup_ui()
        self._refresh()

        event_bus.camera_added.connect(lambda _: self._refresh())
        event_bus.camera_removed.connect(lambda _: self._refresh())
        event_bus.project_opened.connect(lambda _: self._refresh())

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(8 if self._compact else 16)
        if self._compact:
            layout.setContentsMargins(8, 8, 8, 8)
        else:
            layout.setContentsMargins(32, 32, 32, 32)

        header = QHBoxLayout()
        if self._compact:
            title = QLabel("Cameras")
            title.setStyleSheet("font-weight: 700; font-size: 14px; color: #fff;")
            header.addWidget(title)
        else:
            title = QLabel("Cameras")
            title.setObjectName("section_title")
            header.addWidget(title)
        header.addStretch()
        add_btn = QPushButton("+ Add Camera")
        add_btn.setObjectName("primary_button")
        if self._compact:
            add_btn.setFixedHeight(28)
            add_btn.setStyleSheet("font-size: 11px; padding: 4px 10px;")
        add_btn.clicked.connect(self._on_add_camera)
        header.addWidget(add_btn)
        layout.addLayout(header)

        if not self._compact:
            subtitle = QLabel("Manage video streams. Toggle cameras on/off and detach into floating windows.")
            subtitle.setObjectName("section_subtitle")
            subtitle.setWordWrap(True)
            layout.addWidget(subtitle)

        self._cards_container = QWidget()
        if self._compact:
            self._cards_layout = QHBoxLayout(self._cards_container)
            self._cards_layout.setSpacing(8)
            self._cards_layout.setContentsMargins(0, 0, 0, 0)
        else:
            self._cards_layout = QVBoxLayout(self._cards_container)
            self._cards_layout.setSpacing(12)
            self._cards_layout.setContentsMargins(0, 0, 0, 0)
            self._cards_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        layout.addWidget(self._cards_container, stretch=1)

    def _refresh(self) -> None:
        while self._cards_layout.count():
            child = self._cards_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        self._camera_cards.clear()

        if self._pm.current_project is None:
            return

        cameras = self._pm.current_project.get("cameras", [])
        if not cameras:
            empty = QLabel("No cameras added yet. Click '+ Add Camera' to get started.")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setStyleSheet(f"color: {TEXT_MUTED}; padding: 40px; font-size: 15px;")
            self._cards_layout.addWidget(empty)
            return

        for cam in cameras:
            card = CameraCard(cam, compact=self._compact)
            card.remove_requested.connect(self._on_remove_camera)
            card.detach_requested.connect(self._on_detach_camera)
            self._camera_cards[cam["id"]] = card
            self._cards_layout.addWidget(card)

    def _on_add_camera(self) -> None:
        dialog = NewCameraDialog(self)
        if dialog.exec() == NewCameraDialog.DialogCode.Accepted:
            try:
                self._pm.add_camera(dialog.camera_config)
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _on_remove_camera(self, camera_id: str) -> None:
        reply = QMessageBox.question(self, "Remove Camera", f"Remove camera '{camera_id}'?")
        if reply == QMessageBox.StandardButton.Yes:
            if camera_id in self._float_windows:
                self._float_windows[camera_id].close()
                del self._float_windows[camera_id]
            self._pm.remove_camera(camera_id)

    def _on_detach_camera(self, camera_id: str) -> None:
        if camera_id in self._float_windows:
            self._float_windows[camera_id].raise_()
            return
        win = CameraFloatWindow(camera_id)
        win.closed.connect(self._on_float_closed)
        win.show()
        self._float_windows[camera_id] = win

    def _on_float_closed(self, camera_id: str) -> None:
        self._float_windows.pop(camera_id, None)
