"""
Project panel — welcome screen, recent projects, create / open.
"""

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFileDialog, QHBoxLayout, QLabel, QMessageBox,
    QPushButton, QScrollArea, QVBoxLayout, QWidget,
)

from orchiday.core.config import RecentProjects
from orchiday.core.project_manager import ProjectManager
from orchiday.ui import (
    BG_MEDIUM, BG_LIGHT, BORDER, ACCENT_PRIMARY,
    ACCENT_GRADIENT_START, ACCENT_GRADIENT_END,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
    FONT_SIZE_LG, FONT_SIZE_SM, SUCCESS, ERROR,
)
from orchiday.ui.dialogs.new_project_dialog import NewProjectDialog


class ProjectPanel(QWidget):
    """Welcome screen with project list and create/open actions."""

    project_selected = Signal(dict)

    def __init__(self, project_manager: ProjectManager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(32)
        layout.setContentsMargins(80, 60, 80, 60)

        # Header
        header = QVBoxLayout()
        header.setAlignment(Qt.AlignmentFlag.AlignCenter)
        header.setSpacing(8)

        logo = QLabel("Orchiday")
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo.setStyleSheet(f"""
            font-size: 42px; font-weight: 800; color: {ACCENT_PRIMARY}; padding-bottom: 4px;
        """)
        header.addWidget(logo)

        tagline = QLabel("Intelligent Robot Control Platform")
        tagline.setAlignment(Qt.AlignmentFlag.AlignCenter)
        tagline.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: {FONT_SIZE_LG};")
        header.addWidget(tagline)
        layout.addLayout(header)

        # Action buttons
        actions = QHBoxLayout()
        actions.setAlignment(Qt.AlignmentFlag.AlignCenter)
        actions.setSpacing(16)

        new_btn = QPushButton("  New Project")
        new_btn.setObjectName("primary_button")
        new_btn.setFixedSize(200, 48)
        new_btn.setStyleSheet(f"""
            QPushButton {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 {ACCENT_GRADIENT_START}, stop:1 {ACCENT_GRADIENT_END});
                border: none; border-radius: 10px; font-size: 15px;
                font-weight: 600; color: white;
            }}
            QPushButton:hover {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 {ACCENT_GRADIENT_END}, stop:1 {ACCENT_GRADIENT_START});
            }}
        """)
        new_btn.clicked.connect(self._on_new_project)
        actions.addWidget(new_btn)

        open_btn = QPushButton("  Open Project")
        open_btn.setFixedSize(200, 48)
        open_btn.clicked.connect(self._on_open_project)
        actions.addWidget(open_btn)
        layout.addLayout(actions)

        # Recent projects
        recent_header = QLabel("Recent Projects")
        recent_header.setStyleSheet(f"font-size: {FONT_SIZE_LG}; font-weight: 600; color: {TEXT_SECONDARY}; padding-top: 16px;")
        layout.addWidget(recent_header)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setMaximumHeight(400)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        self._projects_container = QWidget()
        self._projects_layout = QVBoxLayout(self._projects_container)
        self._projects_layout.setSpacing(8)
        self._projects_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        scroll.setWidget(self._projects_container)
        layout.addWidget(scroll)
        layout.addStretch()
        self._refresh_recent()

    def _refresh_recent(self) -> None:
        while self._projects_layout.count():
            child = self._projects_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        recent = self._pm.recent_projects
        if not recent:
            empty = QLabel("No projects yet. Create your first one!")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setStyleSheet(f"color: {TEXT_MUTED}; padding: 40px; font-size: {FONT_SIZE_LG};")
            self._projects_layout.addWidget(empty)
            return

        for proj in recent:
            card = self._make_project_card(proj["name"], proj["path"])
            self._projects_layout.addWidget(card)

    def _make_project_card(self, name: str, path: str) -> QWidget:
        card = QWidget()
        card.setCursor(Qt.CursorShape.PointingHandCursor)
        card.setStyleSheet(f"""
            QWidget {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER};
                border-radius: 10px; padding: 16px 20px;
            }}
            QWidget:hover {{ border-color: {ACCENT_PRIMARY}; background-color: {BG_LIGHT}; }}
        """)
        h = QHBoxLayout(card)
        h.setContentsMargins(0, 0, 0, 0)

        info = QVBoxLayout()
        info.setSpacing(2)
        name_label = QLabel(name)
        name_label.setStyleSheet(f"font-weight: 600; font-size: 15px; background: transparent; color: {TEXT_PRIMARY};")
        info.addWidget(name_label)
        path_label = QLabel(path)
        path_label.setStyleSheet(f"font-size: {FONT_SIZE_SM}; color: {TEXT_MUTED}; background: transparent;")
        info.addWidget(path_label)
        h.addLayout(info)
        h.addStretch()

        exists = Path(path).exists()
        status = QLabel("Available" if exists else "Missing")
        status.setStyleSheet(f"color: {SUCCESS if exists else ERROR}; font-size: 11px; background: transparent;")
        h.addWidget(status)
        card.mousePressEvent = lambda _e, p=path: self._open_path(p)
        return card

    def _on_new_project(self) -> None:
        dialog = NewProjectDialog(self)
        if dialog.exec() == NewProjectDialog.DialogCode.Accepted:
            name, slug, parent = dialog.project_name, dialog.project_slug, dialog.project_parent_dir
            if not name or not slug:
                QMessageBox.warning(self, "Error", "Name and identifier are required.")
                return
            try:
                self._pm.create_project(name, slug, parent)
                data = self._pm.open_project(parent / slug)
                self.project_selected.emit(data)
            except FileExistsError as e:
                QMessageBox.warning(self, "Project Exists", str(e))
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _on_open_project(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select Project Directory", str(self._pm._config.projects_dir))
        if path:
            self._open_path(path)

    def _open_path(self, path: str) -> None:
        try:
            data = self._pm.open_project(Path(path))
            self.project_selected.emit(data)
        except FileNotFoundError:
            QMessageBox.warning(self, "Not Found", f"project.json not found in:\n{path}")
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    def showEvent(self, event) -> None:
        super().showEvent(event)
        self._refresh_recent()
