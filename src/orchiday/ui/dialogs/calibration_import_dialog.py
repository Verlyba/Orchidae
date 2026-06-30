"""
Calibration import dialog — select project and calibration file to import.
"""

from __future__ import annotations

from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout,
    QLabel, QComboBox, QTableWidget, QTableWidgetItem,
    QHeaderView, QVBoxLayout, QMessageBox, QWidget
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.calibration_manager import CalibrationManager
from orchiday.ui import TEXT_SECONDARY, FONT_SIZE_XL, BG_DARKEST, BORDER, TEXT_PRIMARY


class CalibrationImportDialog(QDialog):
    """
    Dialog allowing the user to select another project, browse its calibration files,
    and import a selected file for the current project's leader/follower.
    """

    def __init__(self, project_manager: ProjectManager, calibration_manager: CalibrationManager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._cm = calibration_manager
        self.setWindowTitle("Import Calibration")
        self.setMinimumSize(640, 480)
        self.setModal(True)
        
        self._projects = []
        self._calibrations = []
        
        self._setup_ui()
        self._load_projects()
        self._load_targets()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(24, 24, 24, 24)

        title = QLabel("Import Calibration from Another Project")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        subtitle = QLabel("Select a source project, browse its calibration database, and choose a target setup in this project.")
        subtitle.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 12px;")
        layout.addWidget(subtitle)

        # Form for Project Selection & Target Binding
        form = QFormLayout()
        form.setSpacing(10)

        self._project_combo = QComboBox()
        self._project_combo.currentIndexChanged.connect(self._on_project_changed)
        form.addRow("Source Project:", self._project_combo)

        self._target_combo = QComboBox()
        form.addRow("Target Setup & Arm:", self._target_combo)

        layout.addLayout(form)

        # Calibration files table
        layout.addWidget(QLabel("Available Calibrations in Selected Project:"))
        
        self._table = QTableWidget()
        self._table.setColumnCount(3)
        self._table.setHorizontalHeaderLabels(["Filename", "Category", "Device Type"])
        self._table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self._table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self._table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        self._table.setStyleSheet(f"""
            QTableWidget {{
                background-color: {BG_DARKEST};
                border: 1px solid {BORDER};
                gridline-color: {BORDER};
                color: {TEXT_PRIMARY};
            }}
            QHeaderView::section {{
                background-color: #161b22;
                color: {TEXT_SECONDARY};
                padding: 4px;
                border: 1px solid {BORDER};
            }}
        """)
        layout.addWidget(self._table, stretch=1)

        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Import & Apply")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _load_projects(self) -> None:
        """Load all projects except the current one."""
        all_projects = self._pm.list_projects()
        current_slug = self._pm.current_project.get("slug") if self._pm.current_project else None

        self._project_combo.clear()
        self._projects = []

        for p in all_projects:
            if p.get("slug") == current_slug:
                continue
            self._project_combo.addItem(p.get("name", "Unnamed Project"), p.get("_path"))
            self._projects.append(p)

        if not self._projects:
            self._project_combo.addItem("No other projects found", "")
            self._project_combo.setEnabled(False)

    def _load_targets(self) -> None:
        """Load configured leader/follower targets in the current project."""
        self._target_combo.clear()
        if not self._pm.current_project:
            return

        for r in self._pm.current_project.get("robots", []):
            setup_id = r.get("id", "setup")
            
            # Follower target
            follower_type = r.get("follower_type", "so100_follower")
            follower_id = r.get("follower_id", "F1")
            self._target_combo.addItem(
                f"{setup_id} — Follower ({follower_type} / {follower_id})",
                {"setup_id": setup_id, "category": "robots"}
            )

            # Leader target
            leader_type = r.get("leader_type", "so100_leader")
            leader_id = r.get("leader_id", "L1")
            self._target_combo.addItem(
                f"{setup_id} — Leader ({leader_type} / {leader_id})",
                {"setup_id": setup_id, "category": "teleoperators"}
            )

    def _on_project_changed(self, index: int) -> None:
        """Browse calibrations when the selected project changes."""
        self._table.setRowCount(0)
        self._calibrations = []

        if index < 0 or not self._projects:
            return

        proj_path_str = self._project_combo.currentData()
        if not proj_path_str:
            return

        proj_path = Path(proj_path_str)
        
        # We temporarily scan calibrations of the source project by checking its subfolders
        cal_dir = proj_path / "calibration"
        if not cal_dir.exists():
            return

        # Scan
        results = []
        for category in ["robots", "teleoperators"]:
            cat_dir = cal_dir / category
            if not cat_dir.exists():
                continue
            for dev_dir in cat_dir.iterdir():
                if not dev_dir.is_dir():
                    continue
                for json_file in dev_dir.glob("*.json"):
                    if json_file.is_file():
                        results.append({
                            "name": json_file.name,
                            "category": category,
                            "device_type": dev_dir.name,
                        })

        self._calibrations = results
        self._table.setRowCount(len(results))
        for row, cal in enumerate(results):
            self._table.setItem(row, 0, QTableWidgetItem(cal["name"]))
            self._table.setItem(row, 1, QTableWidgetItem(cal["category"]))
            self._table.setItem(row, 2, QTableWidgetItem(cal["device_type"]))

    def _on_accept(self) -> None:
        """Validate selection and invoke import."""
        selected_rows = self._table.selectedItems()
        if not selected_rows:
            QMessageBox.warning(self, "No Selection", "Please select a calibration file to import.")
            return

        row = selected_rows[0].row()
        selected_cal = self._calibrations[row]

        target_data = self._target_combo.currentData()
        if not target_data:
            QMessageBox.warning(self, "No Target", "Please select a target setup.")
            return

        proj_path_str = self._project_combo.currentData()
        if not proj_path_str:
            return

        # Perform the import
        new_filename = self._cm.import_calibration_from_project(
            source_project_path=Path(proj_path_str),
            source_category=selected_cal["category"],
            source_device_type=selected_cal["device_type"],
            source_filename=selected_cal["name"],
            target_setup_id=target_data["setup_id"],
            target_category=target_data["category"],
        )

        if new_filename:
            QMessageBox.information(
                self, "Import Successful",
                f"Successfully imported calibration as '{new_filename}' and set it as active!"
            )
            self.accept()
        else:
            QMessageBox.critical(
                self, "Import Failed",
                "Failed to import the calibration file. See logs for details."
            )
