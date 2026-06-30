"""
Main window — sidebar navigation + stacked panels + console + settings.
"""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QMainWindow, QPushButton,
    QSplitter, QStackedWidget, QStatusBar, QVBoxLayout, QWidget,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.controller import OrchidayController
from orchiday.core.events import event_bus
from orchiday.core.constants import APP_DISPLAY_NAME, WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT, SIDEBAR_WIDTH
from orchiday.ui import (
    BG_DARKEST, ACCENT_PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
)
from orchiday.ui.panels.project_panel import ProjectPanel
from orchiday.ui.panels.dashboard_panel import DashboardPanel
from orchiday.ui.panels.calibration_panel import CalibrationPanel
from orchiday.ui.panels.console_panel import ConsolePanel
from orchiday.ui.dialogs.settings_dialog import SettingsDialog
from orchiday.ui.widgets import StatusIndicator


class MainWindow(QMainWindow):
    """Main application window with sidebar navigation."""

    NAV_ITEMS = [
        ("Home", 0),
        ("Robot Dashboard", 1),
        ("Calibration & Config", 2),
    ]

    def __init__(self):
        super().__init__()
        self._pm = ProjectManager()
        self._controller = OrchidayController(self._pm, self)
        self._nav_buttons: list[QPushButton] = []
        self._project_loaded = False

        self._setup_window()
        self._setup_ui()
        self._connect_events()
        self._switch_panel(0)
        self._update_nav_state()

    def _setup_window(self) -> None:
        self.setWindowTitle(APP_DISPLAY_NAME)
        self.setMinimumSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)
        self.resize(1440, 900)

    def _setup_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)

        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Sidebar
        sidebar = QWidget()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(SIDEBAR_WIDTH)

        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(12, 12, 12, 12)
        sidebar_layout.setSpacing(4)

        logo = QLabel("Orchiday")
        logo.setObjectName("sidebar_logo")
        sidebar_layout.addWidget(logo)

        # Active project display in sidebar
        self._active_project_label = QLabel("No project loaded")
        self._active_project_label.setStyleSheet("color: #888; font-size: 11px; padding: 0 16px 12px 16px; font-weight: 500; background: transparent; border: none;")
        self._active_project_label.setWordWrap(True)
        sidebar_layout.addWidget(self._active_project_label)

        for text, idx in self.NAV_ITEMS:
            btn = QPushButton(f"  {text}")
            btn.setCheckable(True)
            btn.setAutoExclusive(True)
            btn.setFixedHeight(44)
            btn.clicked.connect(lambda checked, i=idx: self._switch_panel(i))
            sidebar_layout.addWidget(btn)
            self._nav_buttons.append(btn)

        sidebar_layout.addStretch()

        # Status indicators
        status_section = QVBoxLayout()
        status_section.setSpacing(6)

        robot_row = QHBoxLayout()
        self._robot_status = StatusIndicator(state="idle", size=8)
        robot_row.addWidget(self._robot_status)
        rl = QLabel("Robot")
        rl.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px;")
        robot_row.addWidget(rl)
        robot_row.addStretch()
        status_section.addLayout(robot_row)

        lm_row = QHBoxLayout()
        self._lm_status = StatusIndicator(state="idle", size=8)
        lm_row.addWidget(self._lm_status)
        ll = QLabel("LM Studio")
        ll.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px;")
        lm_row.addWidget(ll)
        lm_row.addStretch()
        status_section.addLayout(lm_row)

        sidebar_layout.addLayout(status_section)

        # Settings button
        settings_btn = QPushButton("  Settings")
        settings_btn.setFixedHeight(36)
        settings_btn.clicked.connect(self._open_settings)
        sidebar_layout.addWidget(settings_btn)

        version = QLabel("v0.1.0")
        version.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 10px; padding: 8px 0;")
        sidebar_layout.addWidget(version)

        main_layout.addWidget(sidebar)

        # Content area
        content_area = QWidget()
        content_area.setObjectName("content_area")
        content_layout = QVBoxLayout(content_area)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        splitter = QSplitter(Qt.Orientation.Vertical)

        self._stack = QStackedWidget()

        # Panel 0: Home / Projects
        self._project_panel = ProjectPanel(self._pm)
        self._project_panel.project_selected.connect(self._on_project_opened)
        self._stack.addWidget(self._project_panel)

        # Panel 1: Unified Robot Dashboard
        self._dashboard_panel = DashboardPanel(self._pm)
        self._stack.addWidget(self._dashboard_panel)

        # Panel 2: Calibration & Config Panel
        self._calibration_panel = CalibrationPanel(self._pm)
        self._stack.addWidget(self._calibration_panel)

        splitter.addWidget(self._stack)

        # Console
        self._console = ConsolePanel()
        splitter.addWidget(self._console)
        splitter.setStretchFactor(0, 5)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([700, 200])

        content_layout.addWidget(splitter)
        main_layout.addWidget(content_area)

        # Status bar
        status_bar = QStatusBar()
        self.setStatusBar(status_bar)
        self._status_label = QLabel("Welcome to Orchiday")
        status_bar.addPermanentWidget(self._status_label)

    def _connect_events(self) -> None:
        event_bus.project_opened.connect(self._on_project_opened)
        event_bus.project_closed.connect(self._on_project_closed)
        event_bus.robot_connected.connect(lambda _: self._robot_status.set_state("connected"))
        event_bus.robot_disconnected.connect(lambda _: self._robot_status.set_state("disconnected"))
        event_bus.model_connection_ok.connect(lambda _: self._lm_status.set_state("connected"))
        event_bus.log_message.connect(self._on_log)

    def _switch_panel(self, index: int) -> None:
        if index > 0 and not self._project_loaded:
            event_bus.log_message.emit("WARN", "Open or create a project first.")
            return
        self._stack.setCurrentIndex(index)
        self._update_nav_buttons(index)

    def _update_nav_buttons(self, active: int) -> None:
        for i, btn in enumerate(self._nav_buttons):
            btn.setChecked(i == active)

    def _update_nav_state(self) -> None:
        for i, btn in enumerate(self._nav_buttons):
            btn.setEnabled(i == 0 or self._project_loaded)

    def _on_project_opened(self, data: dict) -> None:
        self._project_loaded = True
        self._update_nav_state()
        name = data.get("name", "Project")
        self.setWindowTitle(f"{APP_DISPLAY_NAME} — {name}")
        self._status_label.setText(f"Project: {name}")
        self._active_project_label.setText(f"Active: {name}")
        self._active_project_label.setStyleSheet(f"color: {ACCENT_PRIMARY}; font-size: 11px; padding: 0 16px 12px 16px; font-weight: bold; background: transparent; border: none;")
        event_bus.log_message.emit("SUCCESS", f"Project '{name}' opened")
        self._switch_panel(1)

    def _on_project_closed(self) -> None:
        self._project_loaded = False
        self._update_nav_state()
        self.setWindowTitle(APP_DISPLAY_NAME)
        self.setStatusBar(QStatusBar()) # Clean status bar
        self._status_label = QLabel("No project open")
        self.statusBar().addPermanentWidget(self._status_label)
        self._active_project_label.setText("No project loaded")
        self._active_project_label.setStyleSheet("color: #888; font-size: 11px; padding: 0 16px 12px 16px; font-weight: 500; background: transparent; border: none;")
        self._switch_panel(0)

    def _on_log(self, level: str, message: str) -> None:
        self._status_label.setText(message)

    def _open_settings(self) -> None:
        dialog = SettingsDialog(self)
        dialog.exec()

    def closeEvent(self, event) -> None:
        if self._pm.current_project:
            self._pm.close_project()
        super().closeEvent(event)
