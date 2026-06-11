"""
Settings dialog — global app preferences and LM Studio configuration.
"""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout,
    QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget,
)

from orchiday.core.config import AppConfig
from orchiday.ui import TEXT_SECONDARY, FONT_SIZE_XL


class SettingsDialog(QDialog):
    """Global application settings."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._config = AppConfig()
        self.setWindowTitle("Settings")
        self.setMinimumWidth(480)
        self.setModal(True)
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(20)
        layout.setContentsMargins(32, 32, 32, 32)

        title = QLabel("Settings")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        form = QFormLayout()
        form.setSpacing(12)

        # Projects directory
        path_row = QWidget()
        path_layout = QHBoxLayout(path_row)
        path_layout.setContentsMargins(0, 0, 0, 0)
        self._projects_dir = QLineEdit(str(self._config.projects_dir))
        path_layout.addWidget(self._projects_dir)
        browse_btn = QPushButton("...")
        browse_btn.setFixedWidth(40)
        browse_btn.clicked.connect(self._browse)
        path_layout.addWidget(browse_btn)
        form.addRow("Projects Directory:", path_row)

        # LM Studio URL
        self._lm_url = QLineEdit(self._config.lm_studio_url)
        form.addRow("LM Studio URL:", self._lm_url)

        # Theme
        self._theme_combo = QComboBox()
        self._theme_combo.addItems(["dark", "light"])
        self._theme_combo.setCurrentText(self._config.theme)
        form.addRow("Theme:", self._theme_combo)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Save")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self._save_and_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _browse(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select Directory", self._projects_dir.text())
        if path:
            self._projects_dir.setText(path)

    def _save_and_accept(self) -> None:
        from pathlib import Path
        self._config.projects_dir = Path(self._projects_dir.text())
        self._config.lm_studio_url = self._lm_url.text().strip()
        self._config.set("theme", self._theme_combo.currentText())
        self.accept()
