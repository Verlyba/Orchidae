"""
Dataset Validator Dialog — visual episode validator and selector.

Allows replaying recorded camera video frame-by-frame via OpenCV (codec-independent)
and cleanly deleting corrupt or failed episodes using the LeRobot API.
"""

import logging
import os
import re
import sys
from pathlib import Path
import cv2
from PySide6.QtCore import Qt, QTimer, Slot, QProcess, QProcessEnvironment
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QVBoxLayout, QListWidget, QListWidgetItem,
    QLabel, QPushButton, QMessageBox, QWidget, QSplitter
)

from orchiday.core.events import event_bus
from orchiday.ui import BG_MEDIUM, BG_DARKEST, BORDER, ACCENT_PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED

log = logging.getLogger(__name__)


class DatasetValidatorDialog(QDialog):
    """
    Visual episode validator dialog.

    Allows browsing recorded demonstration episodes, playing the camera videos
    frame-by-frame via OpenCV (no external codec dependencies), and deleting
    bad episodes natively using the LeRobot API.
    """

    def __init__(self, robot_type: str, dataset_name: str, parent=None):
        super().__init__(parent)
        self._robot_type = robot_type
        self._dataset_name = dataset_name
        self._video_path = Path("d:/Orchiday/data/huggingface/lerobot") / dataset_name / "videos"
        self._active_cap = None
        self._active_timer = QTimer(self)
        self._active_timer.timeout.connect(self._next_frame)

        self.setWindowTitle(f"Dataset Validator: {dataset_name}")
        self.setMinimumSize(900, 560)
        self.resize(1000, 600)

        self._setup_ui()
        self._scan_episodes()

    def _setup_ui(self) -> None:
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)

        splitter = QSplitter(Qt.Orientation.Horizontal, self)

        # Left Panel: List of episodes
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.setContentsMargins(0, 0, 0, 0)

        title_list = QLabel("Recorded Episodes")
        title_list.setStyleSheet(f"font-weight: 700; color: {TEXT_PRIMARY}; font-size: 14px;")
        left_layout.addWidget(title_list)

        self._episodes_list = QListWidget()
        self._episodes_list.setStyleSheet(f"""
            QListWidget {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER};
                border-radius: 6px; color: {TEXT_PRIMARY}; padding: 4px;
            }}
            QListWidget::item {{
                padding: 10px; border-bottom: 1px solid {BORDER};
            }}
            QListWidget::item:selected {{
                background-color: {ACCENT_PRIMARY}; color: white; border-radius: 4px;
            }}
        """)
        self._episodes_list.itemSelectionChanged.connect(self._on_episode_selected)
        left_layout.addWidget(self._episodes_list)

        self._delete_btn = QPushButton("Delete Selected Episode")
        self._delete_btn.setObjectName("danger_button")
        self._delete_btn.setFixedHeight(36)
        self._delete_btn.clicked.connect(self._on_delete_episode)
        left_layout.addWidget(self._delete_btn)

        splitter.addWidget(left_widget)

        # Right Panel: Video player
        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        right_layout.setContentsMargins(0, 0, 0, 0)

        title_player = QLabel("Video Replay (OpenCV Frame-by-Frame)")
        title_player.setStyleSheet(f"font-weight: 700; color: {TEXT_PRIMARY}; font-size: 14px;")
        right_layout.addWidget(title_player)

        self._video_label = QLabel("Select an episode to replay video...")
        self._video_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._video_label.setStyleSheet(f"background-color: {BG_DARKEST}; border: 1px solid {BORDER}; border-radius: 8px; color: {TEXT_MUTED}; font-size: 13px;")
        self._video_label.setMinimumSize(480, 360)
        right_layout.addWidget(self._video_label)

        # Playback Controls
        ctrl_layout = QHBoxLayout()
        self._play_btn = QPushButton("Play")
        self._play_btn.clicked.connect(self._toggle_playback)
        ctrl_layout.addWidget(self._play_btn)

        self._replay_robot_btn = QPushButton("Replay on Robot")
        self._replay_robot_btn.setObjectName("primary_button")
        self._replay_robot_btn.clicked.connect(self._on_replay_on_robot)
        self._replay_robot_btn.setEnabled(False)
        ctrl_layout.addWidget(self._replay_robot_btn)

        self._status_label = QLabel("Stopped")
        self._status_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px; padding-left: 10px;")
        ctrl_layout.addWidget(self._status_label)
        ctrl_layout.addStretch()
        right_layout.addLayout(ctrl_layout)

        splitter.addWidget(right_widget)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 2)

        layout.addWidget(splitter)

    def _scan_episodes(self) -> None:
        """Scan videos folder and populate the list widget."""
        self._episodes_list.clear()
        self._stop_playback()

        if not self._video_path.exists():
            log.warning("Videos directory does not exist: %s", self._video_path)
            return

        mp4_files = sorted(self._video_path.glob("*.mp4"))
        if not mp4_files:
            item = QListWidgetItem("No recorded episodes found")
            item.setFlags(Qt.ItemFlag.NoItemFlags)
            self._episodes_list.addItem(item)
            return

        for filepath in mp4_files:
            filename = filepath.name
            match = re.search(r"episode_(\d+)", filename)
            idx_str = match.group(1) if match else filename
            idx = int(idx_str) if idx_str.isdigit() else idx_str

            item = QListWidgetItem(f"Episode {idx}")
            item.setData(Qt.ItemDataRole.UserRole, str(filepath))
            item.setData(Qt.ItemDataRole.UserRole + 1, idx)
            self._episodes_list.addItem(item)

    def _on_episode_selected(self) -> None:
        items = self._episodes_list.selectedItems()
        if not items:
            return
        item = items[0]
        filepath = item.data(Qt.ItemDataRole.UserRole)
        if not filepath:
            return

        self._stop_playback()

        # Load video via OpenCV
        self._active_cap = cv2.VideoCapture(filepath)
        if not self._active_cap.isOpened():
            self._video_label.setText("Error: Cannot open video file.")
            self._active_cap = None
            return

        # Read first frame and display it
        ret, frame = self._active_cap.read()
        if ret:
            self._display_frame(frame)
            self._status_label.setText("Loaded")
            self._replay_robot_btn.setEnabled(True)
        else:
            self._video_label.setText("Error: Empty video file.")
            self._active_cap.release()
            self._active_cap = None

    def _display_frame(self, frame) -> None:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        qt_img = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888)
        pixmap = QPixmap.fromImage(qt_img).scaled(
            self._video_label.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self._video_label.setPixmap(pixmap)

    def _next_frame(self) -> None:
        if not self._active_cap:
            self._stop_playback()
            return

        ret, frame = self._active_cap.read()
        if ret:
            self._display_frame(frame)
        else:
            # Rewind to start for loop playback
            self._active_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    def _toggle_playback(self) -> None:
        if not self._active_cap:
            return

        if self._active_timer.isActive():
            self._active_timer.stop()
            self._play_btn.setText("Play")
            self._status_label.setText("Paused")
        else:
            self._active_timer.start(33)  # ~30 FPS
            self._play_btn.setText("Pause")
            self._status_label.setText("Playing")

    def _stop_playback(self) -> None:
        self._active_timer.stop()
        self._play_btn.setText("Play")
        self._status_label.setText("Stopped")
        if self._active_cap:
            self._active_cap.release()
            self._active_cap = None
        self._video_label.setPixmap(QPixmap())
        self._video_label.setText("Select an episode to replay video...")
        self._replay_robot_btn.setEnabled(False)

    def _on_replay_on_robot(self) -> None:
        items = self._episodes_list.selectedItems()
        if not items:
            return
        item = items[0]
        idx = item.data(Qt.ItemDataRole.UserRole + 1)
        if idx is None:
            return

        reply = QMessageBox.question(
            self, "Replay on Robot",
            f"Do you want to play Episode {idx} physically on the robot?\nMake sure the hardware area is clear!",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        # Emit the replay requested signal
        event_bus.log_message.emit("INFO", f"Requesting physical hardware replay for episode {idx}...")
        event_bus.replay_requested.emit(self._robot_type, f"local/{self._dataset_name}", idx, "")

    def _on_delete_episode(self) -> None:
        items = self._episodes_list.selectedItems()
        if not items:
            return
        item = items[0]
        idx = item.data(Qt.ItemDataRole.UserRole + 1)
        if idx is None:
            return

        reply = QMessageBox.question(
            self, "Delete Episode",
            f"Are you sure you want to delete Episode {idx}?\nThis will modify the Parquet dataset and cannot be undone!",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        self._stop_playback()
        self._delete_btn.setEnabled(False)
        self._delete_btn.setText("Deleting via LeRobot API...")

        # Spawn a QProcess to run the native LeRobot delete command
        # This keeps the UI responsive during the dataset modification!
        process = QProcess(self)

        cmd = [
            sys.executable, "-c",
            f"from lerobot.common.datasets.lerobot_dataset import LeRobotDataset; "
            f"ds = LeRobotDataset('local/{self._dataset_name}'); "
            f"ds.delete_episode({idx})"
        ]

        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HF_HOME", "d:/Orchiday/data/huggingface")
        process.setProcessEnvironment(env)

        process.finished.connect(lambda exit_code: self._on_delete_completed(exit_code))

        event_bus.log_message.emit("INFO", f"Dataset: Deleting episode {idx} via LeRobot Dataset API...")
        process.start(cmd[0], cmd[1:])

    def _on_delete_completed(self, exit_code: int) -> None:
        self._delete_btn.setEnabled(True)
        self._delete_btn.setText("Delete Selected Episode")

        if exit_code == 0:
            event_bus.log_message.emit("SUCCESS", f"Episode deleted successfully from local/{self._dataset_name}")
            QMessageBox.information(self, "Success", "Episode deleted successfully.")
            self._scan_episodes()
        else:
            event_bus.log_message.emit("ERROR", f"Failed to delete episode from local/{self._dataset_name}")
            QMessageBox.critical(self, "Error", f"Failed to delete episode. Exit code: {exit_code}")

    def closeEvent(self, event) -> None:
        self._stop_playback()
        super().closeEvent(event)
