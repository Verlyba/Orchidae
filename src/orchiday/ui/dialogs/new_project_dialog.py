"""
New project dialog — name, slug, directory picker.
"""

import re
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QDialogButtonBox, QFileDialog, QFormLayout,
    QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget,
)

from orchiday.core.config import AppConfig
from orchiday.ui import TEXT_SECONDARY, FONT_SIZE_XL


class NewProjectDialog(QDialog):
    """Dialog for creating a new project."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = AppConfig()
        self.setWindowTitle("New Project")
        self.setMinimumWidth(500)
        self.setModal(True)
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(20)
        layout.setContentsMargins(32, 32, 32, 32)

        title = QLabel("Create New Project")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        subtitle = QLabel("A project is a workspace for your robots, cameras, skills, and models.")
        subtitle.setStyleSheet(f"color: {TEXT_SECONDARY};")
        layout.addWidget(subtitle)

        form = QFormLayout()
        form.setSpacing(12)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self._name_input = QLineEdit()
        self._name_input.setPlaceholderText("e.g. My Robot Workspace")
        self._name_input.textChanged.connect(self._on_name_changed)
        form.addRow("Name:", self._name_input)

        self._slug_input = QLineEdit()
        self._slug_input.setPlaceholderText("my_robot_workspace (auto)")
        form.addRow("Identifier:", self._slug_input)

        path_row = QWidget()
        path_layout = QHBoxLayout(path_row)
        path_layout.setContentsMargins(0, 0, 0, 0)
        self._path_input = QLineEdit(str(self._config.projects_dir))
        path_layout.addWidget(self._path_input)
        browse_btn = QPushButton("...")
        browse_btn.setFixedWidth(40)
        browse_btn.clicked.connect(self._browse_path)
        path_layout.addWidget(browse_btn)
        form.addRow("Location:", path_row)

        layout.addLayout(form)

        self._preview_label = QLabel()
        self._preview_label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 12px;")
        layout.addWidget(self._preview_label)
        self._update_preview()

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Create")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_name_changed(self, text: str) -> None:
        slug = re.sub(r"[^a-z0-9]+", "_", text.lower().strip()).strip("_")
        self._slug_input.setText(slug)
        self._update_preview()

    def _update_preview(self) -> None:
        slug = self._slug_input.text() or "..."
        self._preview_label.setText(f"Path: {self._path_input.text()}/{slug}/")

    def _browse_path(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select Directory", self._path_input.text())
        if path:
            self._path_input.setText(path)
            self._update_preview()

    @property
    def project_name(self) -> str:
        return self._name_input.text().strip()

    @property
    def project_slug(self) -> str:
        return self._slug_input.text().strip()

    @property
    def project_parent_dir(self) -> Path:
        return Path(self._path_input.text())
