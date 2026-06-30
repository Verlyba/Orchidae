"""
Calibration panel — manage, bind, backup, and import calibration files.
"""

from __future__ import annotations

import logging
from pathlib import Path
from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QWidget, QDialog, QVBoxLayout, QHBoxLayout, QLabel, QComboBox,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView,
    QSplitter, QMessageBox, QFrame, QFormLayout, QGroupBox
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.calibration_manager import CalibrationManager
from orchiday.core.events import event_bus
from orchiday.ui import (
    BG_MEDIUM, BG_LIGHT, BG_DARKEST, BORDER,
    ACCENT_PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
    FONT_SIZE_XL, SUCCESS, ERROR, WARNING
)
from orchiday.ui.dialogs.calibration_import_dialog import CalibrationImportDialog

log = logging.getLogger(__name__)


class CalibrationPanel(QWidget):
    """
    Dedicated Calibration & Config Panel.
    Allows managing LeRobot calibration files and bindings on a per-project basis.
    """

    def __init__(self, project_manager: ProjectManager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._cm = CalibrationManager(self._pm)
        
        self._setup_ui()
        self._refresh()

        # Connect event listeners
        event_bus.project_opened.connect(lambda _: self._refresh())
        event_bus.calibration_list_changed.connect(self._refresh)
        event_bus.robot_calibrated.connect(lambda _: self._refresh())

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"background-color: {BG_DARKEST};")
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(16)

        # Header Section
        header = QHBoxLayout()
        title = QLabel("Calibration & Configuration")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 800; color: {TEXT_PRIMARY};")
        header.addWidget(title)
        header.addStretch()
        layout.addLayout(header)

        subtitle = QLabel("Manage joint calibration files, switch active profiles, and import parameters from other projects.")
        subtitle.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 13px;")
        layout.addWidget(subtitle)

        # Separator line
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setFixedHeight(1)
        sep.setStyleSheet(f"background-color: {BORDER}; border: none;")
        layout.addWidget(sep)

        # Main splitter (Left: Setup Bindings, Right: Database Table)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setStyleSheet(f"QSplitter::handle {{ background-color: {BORDER}; width: 1px; }}")

        # 1. Left Section: Bindings
        self._left_widget = QWidget()
        self._left_layout = QVBoxLayout(self._left_widget)
        self._left_layout.setContentsMargins(0, 0, 16, 0)
        self._left_layout.setSpacing(16)
        
        left_title = QLabel("Active Project Bindings")
        left_title.setStyleSheet(f"font-weight: 700; font-size: 14px; color: {ACCENT_PRIMARY};")
        self._left_layout.addWidget(left_title)

        self._bindings_container = QWidget()
        self._bindings_layout = QVBoxLayout(self._bindings_container)
        self._bindings_layout.setContentsMargins(0, 0, 0, 0)
        self._bindings_layout.setSpacing(12)
        self._bindings_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        
        self._left_layout.addWidget(self._bindings_container, stretch=1)
        splitter.addWidget(self._left_widget)

        # 2. Right Section: Database Table
        self._right_widget = QWidget()
        self._right_layout = QVBoxLayout(self._right_widget)
        self._right_layout.setContentsMargins(16, 0, 0, 0)
        self._right_layout.setSpacing(12)

        right_title = QLabel("Calibration File Repository")
        right_title.setStyleSheet(f"font-weight: 700; font-size: 14px; color: {ACCENT_PRIMARY};")
        self._right_layout.addWidget(right_title)

        self._table = QTableWidget()
        self._table.setColumnCount(4)
        self._table.setHorizontalHeaderLabels(["Filename", "Role", "Device Type", "Last Modified"])
        self._table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self._table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self._table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        self._table.setStyleSheet(f"""
            QTableWidget {{
                background-color: {BG_MEDIUM};
                border: 1px solid {BORDER};
                gridline-color: {BORDER};
                color: {TEXT_PRIMARY};
                border-radius: 8px;
            }}
            QHeaderView::section {{
                background-color: {BG_LIGHT};
                color: {TEXT_SECONDARY};
                padding: 6px;
                border: 1px solid {BORDER};
                font-weight: bold;
            }}
        """)
        self._right_layout.addWidget(self._table, stretch=1)

        # Action bar under table
        actions_lay = QHBoxLayout()
        actions_lay.setSpacing(8)

        self._import_btn = QPushButton("Import Calibration...")
        self._import_btn.setObjectName("primary_button")
        self._import_btn.clicked.connect(self._on_import)
        actions_lay.addWidget(self._import_btn)

        self._delete_btn = QPushButton("Delete Selected")
        self._delete_btn.setStyleSheet(f"""
            QPushButton {{
                background: {BG_LIGHT}; color: {ERROR}; border: 1px solid {BORDER};
                border-radius: 6px; padding: 6px 12px; font-weight: bold;
            }}
            QPushButton:hover {{ background: #2f2f3a; }}
        """)
        self._delete_btn.clicked.connect(self._on_delete)
        actions_lay.addWidget(self._delete_btn)

        self._folder_btn = QPushButton("Open Folder")
        self._folder_btn.setStyleSheet(f"""
            QPushButton {{
                background: {BG_LIGHT}; color: {TEXT_PRIMARY}; border: 1px solid {BORDER};
                border-radius: 6px; padding: 6px 12px; font-weight: bold;
            }}
            QPushButton:hover {{ background: #2f2f3a; }}
        """)
        self._folder_btn.clicked.connect(self._on_open_folder)
        actions_lay.addWidget(self._folder_btn)

        self._right_layout.addLayout(actions_lay)
        splitter.addWidget(self._right_widget)

        # Adjust initial splitter sizes
        splitter.setSizes([380, 580])
        layout.addWidget(splitter, stretch=1)

    def _refresh(self) -> None:
        """Refresh active setup bindings and database table contents."""
        self._refresh_bindings()
        self._refresh_table()

    def _refresh_bindings(self) -> None:
        """Re-populate project robot setup bindings list."""
        # Clear existing bindings layout
        while self._bindings_layout.count():
            item = self._bindings_layout.takeAt(0)
            if item is not None:
                widget = item.widget()
                if widget is not None:
                    widget.deleteLater()

        if not self._pm.current_project:
            empty = QLabel("Open a project to configure calibration bindings.")
            empty.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 13px; font-style: italic;")
            self._bindings_layout.addWidget(empty)
            return

        robots = self._pm.current_project.get("robots", [])
        if not robots:
            empty = QLabel("No robot hardware setups added to this project yet.")
            empty.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 13px; font-style: italic;")
            self._bindings_layout.addWidget(empty)
            return

        # Fetch all files currently inside project calibrations
        calibrations = self._cm.scan_project_calibrations()

        for robot in robots:
            setup_id = robot["id"]
            
            box = QGroupBox(f"Hardware Setup: {setup_id}")
            box.setStyleSheet(f"""
                QGroupBox {{
                    background-color: {BG_MEDIUM};
                    border: 1px solid {BORDER};
                    border-radius: 8px;
                    margin-top: 12px;
                    padding-top: 8px;
                    font-weight: bold;
                    color: {TEXT_PRIMARY};
                }}
                QGroupBox::title {{
                    subcontrol-origin: margin;
                    subcontrol-position: top left;
                    padding: 0 8px;
                }}
            """)
            
            form = QFormLayout(box)
            form.setSpacing(10)
            form.setContentsMargins(12, 12, 12, 12)

            # ── Follower (robots) Binding ──
            f_type = robot.get("follower_type", "so100_follower")
            f_id = robot.get("follower_id", "F1")
            
            f_row = QHBoxLayout()
            f_combo = QComboBox()
            f_combo.setMinimumWidth(160)
            
            # Find matching calibration files in project
            f_files = [c["name"] for c in calibrations if c["category"] == "robots" and c["device_type"] == f_type]
            
            f_combo.blockSignals(True)
            f_combo.addItem("Not Bound (Auto)", "")
            for f in sorted(f_files):
                f_combo.addItem(f, f)
            
            # Set active binding
            active_f_cal = robot.get("follower_calibration", "")
            idx = f_combo.findData(active_f_cal)
            if idx >= 0:
                f_combo.setCurrentIndex(idx)
            f_combo.blockSignals(False)
            
            # Connect change event
            f_combo.currentIndexChanged.connect(
                lambda idx, sid=setup_id, combo=f_combo: self._on_binding_changed(sid, "robots", combo.currentData())
            )
            f_row.addWidget(f_combo)

            f_backup_btn = QPushButton("Backup Active")
            f_backup_btn.setStyleSheet(f"font-size: 10px; padding: 2px 6px; background-color: {BG_LIGHT}; border: 1px solid {BORDER}; border-radius: 4px; color: {TEXT_PRIMARY};")
            f_backup_btn.clicked.connect(
                lambda _, sid=setup_id: self._on_backup_active(sid, "robots")
            )
            f_row.addWidget(f_backup_btn)
            
            form.addRow(f"Follower ({f_id} / {f_type}):", f_row)

            # ── Leader (teleoperators) Binding ──
            l_type = robot.get("leader_type", "so100_leader")
            l_id = robot.get("leader_id", "L1")

            l_row = QHBoxLayout()
            l_combo = QComboBox()
            l_combo.setMinimumWidth(160)

            l_files = [c["name"] for c in calibrations if c["category"] == "teleoperators" and c["device_type"] == l_type]

            l_combo.blockSignals(True)
            l_combo.addItem("Not Bound (Auto)", "")
            for l in sorted(l_files):
                l_combo.addItem(l, l)

            active_l_cal = robot.get("leader_calibration", "")
            idx = l_combo.findData(active_l_cal)
            if idx >= 0:
                l_combo.setCurrentIndex(idx)
            l_combo.blockSignals(False)

            # Connect change event
            l_combo.currentIndexChanged.connect(
                lambda idx, sid=setup_id, combo=l_combo: self._on_binding_changed(sid, "teleoperators", combo.currentData())
            )
            l_row.addWidget(l_combo)

            l_backup_btn = QPushButton("Backup Active")
            l_backup_btn.setStyleSheet(f"font-size: 10px; padding: 2px 6px; background-color: {BG_LIGHT}; border: 1px solid {BORDER}; border-radius: 4px; color: {TEXT_PRIMARY};")
            l_backup_btn.clicked.connect(
                lambda _, sid=setup_id: self._on_backup_active(sid, "teleoperators")
            )
            l_row.addWidget(l_backup_btn)

            form.addRow(f"Leader ({l_id} / {l_type}):", l_row)

            self._bindings_layout.addWidget(box)

    def _refresh_table(self) -> None:
        """Re-scan and display project calibrations in table."""
        self._table.setRowCount(0)
        self._table_data = []

        if not self._pm.current_project:
            return

        calibrations = self._cm.scan_project_calibrations()
        self._table_data = calibrations
        self._table.setRowCount(len(calibrations))

        for row, cal in enumerate(calibrations):
            self._table.setItem(row, 0, QTableWidgetItem(cal["name"]))
            self._table.setItem(row, 1, QTableWidgetItem("Follower (robots)" if cal["category"] == "robots" else "Leader (teleop)"))
            self._table.setItem(row, 2, QTableWidgetItem(cal["device_type"]))
            
            # Format datetime
            dt_str = cal["last_modified"]
            try:
                dt_str = dt_str.replace("T", " ")[:19]
            except Exception:
                pass
            self._table.setItem(row, 3, QTableWidgetItem(dt_str))

    def _on_binding_changed(self, setup_id: str, category: str, filename: str) -> None:
        """Triggered when user selects a calibration file in the dropdown."""
        if not self._pm.current_project:
            return
        if not filename:
            # Unbind
            for r in self._pm.current_project.get("robots", []):
                if r.get("id") == setup_id:
                    if category == "robots":
                        r.pop("follower_calibration", None)
                    else:
                        r.pop("leader_calibration", None)
                    break
            self._pm.save_project()
            event_bus.log_message.emit("INFO", f"Cleared calibration binding for '{setup_id}' ({category}).")
            event_bus.project_opened.emit(self._pm.current_project)
            return

        # Apply
        success = self._cm.apply_calibration(setup_id, category, filename)
        if success:
            event_bus.log_message.emit("SUCCESS", f"Activated calibration profile: {filename}")
        else:
            QMessageBox.critical(self, "Error", f"Failed to apply calibration profile '{filename}'")

    def _on_backup_active(self, setup_id: str, category: str) -> None:
        """Backup the current global cache calibration for a setup and reload UI."""
        if not self._pm.current_project:
            return
        filename = self._cm.backup_active_calibration(setup_id, category)
        if filename:
            QMessageBox.information(
                self, "Backup Successful",
                f"Successfully backed up active calibration to project folder as:\n\n{filename}"
            )
        else:
            # Get expected device details to report
            expected_id = ""
            for r in self._pm.current_project.get("robots", []):
                if r.get("id") == setup_id:
                    expected_id = r.get("follower_id") if category == "robots" else r.get("leader_id")
                    break
            QMessageBox.warning(
                self, "No Calibration Found",
                f"No calibration file for '{expected_id}' was found in LeRobot cache.\n"
                "Please run calibration for this arm first!"
            )

    def _on_import(self) -> None:
        """Open the import dialog."""
        dialog = CalibrationImportDialog(self._pm, self._cm, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self._refresh()

    def _on_delete(self) -> None:
        """Delete selected calibration file."""
        selected_ranges = self._table.selectedRanges()
        if not selected_ranges:
            QMessageBox.warning(self, "No Selection", "Please select a calibration file to delete.")
            return

        row = selected_ranges[0].topRow()
        cal = self._table_data[row]
        
        reply = QMessageBox.question(
            self, "Delete Calibration",
            f"Are you sure you want to delete calibration profile '{cal['name']}' from the project?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            self._cm.delete_calibration_file(cal["category"], cal["device_type"], cal["name"])

    def _on_open_folder(self) -> None:
        """Open project calibration directory in system file explorer."""
        project_cal_dir = self._cm.get_project_calibration_dir()
        if project_cal_dir and project_cal_dir.exists():
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(project_cal_dir)))
        else:
            QMessageBox.warning(self, "Folder Not Found", "No calibration directory exists for this project yet.")
