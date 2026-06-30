"""
Skill panel — create skills, record episodes, train policy models.
"""

import json
import re
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout,
    QLabel, QLineEdit, QMessageBox, QProgressBar, QPushButton,
    QScrollArea, QSpinBox, QVBoxLayout, QWidget, QSplitter,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus
from orchiday.core.constants import SUPPORTED_ARCHITECTURES, DEFAULT_EPOCHS, DEFAULT_BATCH_SIZE
from orchiday.ui import (
    BG_MEDIUM, BG_LIGHT, BG_DARKEST, BORDER,
    ACCENT_PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
    FONT_SIZE_XL, FONT_SIZE_LG, SUCCESS, ERROR, WARNING,
)


class NewSkillDialog(QDialog):
    """Dialog for creating a new skill."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("New Skill")
        self.setMinimumWidth(420)
        self.setModal(True)
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(20)
        layout.setContentsMargins(32, 32, 32, 32)

        title = QLabel("Create New Skill")
        title.setStyleSheet(f"font-size: {FONT_SIZE_XL}; font-weight: 700;")
        layout.addWidget(title)

        form = QFormLayout()
        form.setSpacing(12)

        self._name_input = QLineEdit()
        self._name_input.setPlaceholderText("e.g. Pick Up Cube")
        self._name_input.textChanged.connect(self._on_name_changed)
        form.addRow("Name:", self._name_input)

        self._slug_input = QLineEdit()
        self._slug_input.setPlaceholderText("pick_up_cube (auto)")
        form.addRow("Identifier:", self._slug_input)

        self._task_desc = QLineEdit()
        self._task_desc.setPlaceholderText("e.g. Pick up the red cube and place it in the bowl")
        form.addRow("Task Description:", self._task_desc)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Create Skill")
        buttons.button(QDialogButtonBox.StandardButton.Ok).setObjectName("primary_button")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_name_changed(self, text: str) -> None:
        slug = re.sub(r"[^a-z0-9]+", "_", text.lower().strip()).strip("_")
        self._slug_input.setText(slug)

    @property
    def skill_name(self) -> str:
        return self._name_input.text().strip()

    @property
    def skill_slug(self) -> str:
        return self._slug_input.text().strip()

    @property
    def skill_architecture(self) -> str:
        return "diffusion"

    @property
    def task_description(self) -> str:
        return self._task_desc.text().strip()


class SkillCard(QWidget):
    """Card for a single skill with record and train actions."""

    remove_requested = Signal(str)

    def __init__(self, skill_slug: str, skill_data: dict, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._slug = skill_slug
        self._data = skill_data
        self._pm = project_manager
        self._compact = compact
        self._is_recording = False
        self._is_training = False
        self._setup_ui()

        # Listen for training progress
        event_bus.training_progress.connect(self._on_training_progress)
        event_bus.training_finished.connect(self._on_training_finished)
        event_bus.recording_progress.connect(self._on_recording_progress)
        event_bus.recording_stopped.connect(self._on_recording_stopped)

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"""
            SkillCard {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 8px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setSpacing(6 if self._compact else 12)
        layout.setContentsMargins(12, 10, 12, 10) if self._compact else layout.setContentsMargins(20, 16, 20, 16)

        # Header
        header = QHBoxLayout()
        title = QLabel(self._data.get("name", self._slug))
        fs_title = 12 if self._compact else 16
        title.setStyleSheet(f"font-weight: 700; font-size: {fs_title}px; color: {TEXT_PRIMARY}; background: transparent;")
        header.addWidget(title)

        slug_label = QLabel(f"({self._slug})")
        slug_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px; background: transparent;")
        header.addWidget(slug_label)
        header.addStretch()

        remove_btn = QPushButton("X")
        remove_btn.setObjectName("danger_button")
        remove_btn.setFixedSize(20, 20) if self._compact else remove_btn.setFixedSize(28, 28)
        remove_btn.setStyleSheet("font-size: 8px; padding: 0;") if self._compact else None
        remove_btn.clicked.connect(lambda: self.remove_requested.emit(self._slug))
        header.addWidget(remove_btn)
        layout.addLayout(header)

        # Info
        info = QHBoxLayout()
        arch = self._pm.current_project.get("policy_architecture", "diffusion") if self._pm and self._pm.current_project else "diffusion"
        arch_label = QLabel(f"Policy: {arch.upper()}")
        arch_label.setStyleSheet("color: #00e5ff; font-size: 11px; background: transparent; font-weight: bold;") if self._compact else arch_label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent; font-weight: bold;")
        info.addWidget(arch_label)

        ep_count = self._data.get("episodes", 0)
        ep_label = QLabel(f"Episodes: {ep_count}")
        ep_label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;")
        info.addWidget(ep_label)

        if not self._compact:
            desc = self._data.get("task_description", "")
            if desc:
                desc_label = QLabel(f"Task: {desc}")
                desc_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px; background: transparent;")
                info.addWidget(desc_label)

        info.addStretch()
        layout.addLayout(info)

        # Actions
        actions = QHBoxLayout()
        actions.setSpacing(6 if self._compact else 8)

        self._record_btn = QPushButton("Record")
        if self._compact:
            self._record_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {ERROR}; color: white; border: none;
                    border-radius: 6px; padding: 4px 10px; font-weight: bold; font-size: 11px;
                }}
                QPushButton:hover {{ background: #ef4444; }}
            """)
        else:
            self._record_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {ERROR}; color: white; border: none;
                    border-radius: 8px; padding: 10px 24px; font-weight: 600;
                }}
                QPushButton:hover {{ background: #ef4444; }}
            """)
        self._record_btn.clicked.connect(self._toggle_recording)
        actions.addWidget(self._record_btn)

        self._train_btn = QPushButton("Train")
        self._train_btn.setObjectName("primary_button")
        if self._compact:
            self._train_btn.setFixedHeight(24)
            self._train_btn.setStyleSheet("font-size: 11px; padding: 4px 10px;")
        self._train_btn.clicked.connect(self._start_training)
        actions.addWidget(self._train_btn)

        self._validate_btn = QPushButton("Validate")
        if self._compact:
            self._validate_btn.setStyleSheet("""
                QPushButton {
                    background: #111; color: #ccc; border: 1px solid #333;
                    border-radius: 6px; padding: 4px 10px; font-weight: bold; font-size: 11px;
                }
                QPushButton:hover { background: #222; }
            """)
        else:
            self._validate_btn.setStyleSheet(f"""
                QPushButton {{
                    background: #111; color: #ccc; border: 1px solid #333;
                    border-radius: 8px; padding: 10px 24px; font-weight: 600;
                }}
                QPushButton:hover {{ background: #222; }}
            """)
        self._validate_btn.clicked.connect(self._open_validator)
        actions.addWidget(self._validate_btn)

        actions.addStretch()
        layout.addLayout(actions)

        # Progress bar (hidden/unused in compact layout layout)
        self._progress = QProgressBar()
        self._progress.setVisible(False)
        self._progress.setTextVisible(False)
        self._progress.setFixedHeight(6)
        if not self._compact:
            layout.addWidget(self._progress)

        # Status label (hidden/unused in compact layout layout)
        self._status_label = QLabel("")
        self._status_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px; background: transparent;")
        if not self._compact:
            layout.addWidget(self._status_label)

        # Loss Chart (hidden/unused in compact layout layout)
        from orchiday.ui.widgets.loss_chart import LossChart
        self._loss_chart = LossChart(self)
        self._loss_chart.setVisible(False)
        if not self._compact:
            layout.addWidget(self._loss_chart)

    def _open_validator(self) -> None:
        if not self._pm or not self._pm.current_project:
            return
            
        robots = self._pm.current_project.get("robots", [])
        robot_type = robots[0].get("type", "so100") if robots else "so100"
        dataset_name = f"{robot_type}_{self._slug}"
        
        from orchiday.ui.dialogs.dataset_validator_dialog import DatasetValidatorDialog
        dialog = DatasetValidatorDialog(robot_type, dataset_name, self)
        dialog.exec()

    def _toggle_recording(self) -> None:
        if not self._is_recording:
            # Check if dataset already exists and has files
            robots = self._pm.current_project.get("robots", []) if self._pm.current_project else []
            robot_type = robots[0].get("type", "so100") if robots else "so100"
            dataset_path = Path("d:/Orchiday/data/huggingface/lerobot") / f"{robot_type}_{self._slug}"
            
            resume = False
            if dataset_path.exists() and any(dataset_path.iterdir()):
                box = QMessageBox(self)
                box.setWindowTitle("Resume Recording?")
                box.setText(f"A dataset for '{self._slug}' already exists.\n\n"
                            "Do you want to append new episodes to the existing data (Resume), "
                            "or overwrite the entire dataset?")
                resume_btn = box.addButton("Resume (Add Data)", QMessageBox.ButtonRole.YesRole)
                overwrite_btn = box.addButton("Overwrite", QMessageBox.ButtonRole.NoRole)
                box.addButton("Cancel", QMessageBox.ButtonRole.RejectRole)
                
                box.exec()
                if box.clickedButton() == resume_btn:
                    resume = True
                elif box.clickedButton() == overwrite_btn:
                    resume = False
                else:
                    return  # Cancelled

            self._is_recording = True
            self._record_btn.setText("Stop Recording")
            self._record_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {WARNING}; color: {BG_DARKEST}; border: none;
                    border-radius: 8px; padding: 10px 24px; font-weight: 600;
                }}
            """)
            self._progress.setVisible(True)
            self._progress.setRange(0, 0)  # indeterminate
            self._status_label.setText("Recording... follow the teleoperation instructions")
            event_bus.recording_requested.emit(self._slug, resume)
        else:
            event_bus.recording_stop_requested.emit(self._slug)

    def _start_training(self) -> None:
        if self._is_training:
            return
        self._is_training = True
        self._train_btn.setEnabled(False)
        self._train_btn.setText("Training...")
        self._progress.setVisible(True)
        self._progress.setRange(0, 100)
        self._progress.setValue(0)
        self._status_label.setText("Training started — monitoring loss...")
        
        self._loss_chart.clear()
        self._loss_chart.setVisible(True)
        
        event_bus.training_started.emit(self._slug)

    def _on_training_progress(self, slug: str, epoch: int, loss: float) -> None:
        if slug != self._slug:
            return
        self._progress.setValue(min(epoch, 100))
        self._status_label.setText(f"Epoch {epoch} — Loss: {loss:.4f}")
        self._loss_chart.add_loss_point(epoch, loss)

    def _on_training_finished(self, slug: str, checkpoint: str) -> None:
        if slug != self._slug:
            return
        self._is_training = False
        self._train_btn.setEnabled(True)
        self._train_btn.setText("Train")
        self._progress.setVisible(False)
        self._status_label.setText(f"Training complete! Checkpoint saved.")
        self._status_label.setStyleSheet(f"color: {SUCCESS}; font-size: 11px; background: transparent;")

    def _on_recording_progress(self, slug: str, progress: float) -> None:
        if slug != self._slug:
            return
        self._progress.setRange(0, 100)
        self._progress.setValue(int(progress * 100))
        self._status_label.setText(f"Recording... {int(progress * 100)}%")

    def _on_recording_stopped(self, slug: str, episode_count: int) -> None:
        if slug != self._slug:
            return
        self._is_recording = False
        self._record_btn.setText("Record")
        if self._compact:
            self._record_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {ERROR}; color: white; border: none;
                    border-radius: 6px; padding: 4px 10px; font-weight: bold; font-size: 11px;
                }}
                QPushButton:hover {{ background: #ef4444; }}
            """)
        else:
            self._record_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {ERROR}; color: white; border: none;
                    border-radius: 8px; padding: 10px 24px; font-weight: 600;
                }}
                QPushButton:hover {{ background: #ef4444; }}
            """)
        self._progress.setVisible(False)
        self._status_label.setText(f"Recording stopped ({episode_count} episodes)")


class SkillPanel(QWidget):
    """Panel for managing skills in the project."""

    def __init__(self, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._compact = compact
        self._setup_ui()

        event_bus.skill_created.connect(lambda _: self._refresh())
        event_bus.skill_deleted.connect(lambda _: self._refresh())
        event_bus.project_opened.connect(lambda _: self._refresh())

        if self._compact:
            event_bus.training_started.connect(self._on_shared_training_started)
            event_bus.training_progress.connect(self._on_shared_training_progress)
            event_bus.training_finished.connect(self._on_shared_training_finished)
            event_bus.training_error.connect(self._on_shared_training_error)

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(10 if self._compact else 16)
        if self._compact:
            layout.setContentsMargins(8, 8, 8, 8)
        else:
            layout.setContentsMargins(32, 32, 32, 32)

        header = QHBoxLayout()
        if self._compact:
            title = QLabel("Motor Skills & Training")
            title.setStyleSheet("font-weight: 700; font-size: 14px; color: #fff;")
            header.addWidget(title)
        else:
            title = QLabel("Skills")
            title.setObjectName("section_title")
            header.addWidget(title)
        header.addStretch()
        add_btn = QPushButton("+ New Skill")
        add_btn.setObjectName("primary_button")
        if self._compact:
            add_btn.setFixedHeight(28)
            add_btn.setStyleSheet("font-size: 11px; padding: 4px 10px;")
        add_btn.clicked.connect(self._on_add_skill)
        header.addWidget(add_btn)
        layout.addLayout(header)

        if not self._compact:
            subtitle = QLabel("Create skills, record demonstration episodes, and train policy models. Each skill maps to one robot action.")
            subtitle.setObjectName("section_subtitle")
            subtitle.setWordWrap(True)
            layout.addWidget(subtitle)

        # Layout for compact mode: Top is skills list, Bottom is training details
        if self._compact:
            self._panel_layout = QVBoxLayout()
            self._panel_layout.setSpacing(12)

            # Top side (list of skills)
            self._skills_list_widget = QWidget()
            skills_list_layout = QVBoxLayout(self._skills_list_widget)
            skills_list_layout.setContentsMargins(0, 0, 0, 0)
            skills_list_layout.setSpacing(6)

            self._cards_container = QWidget()
            self._cards_layout = QVBoxLayout(self._cards_container)
            self._cards_layout.setSpacing(6)
            self._cards_layout.setContentsMargins(0, 0, 0, 0)
            self._cards_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
            skills_list_layout.addWidget(self._cards_container, stretch=1)

            self._panel_layout.addWidget(self._skills_list_widget, stretch=1)

            # Bottom side (Training center - shared Loss Chart and progress bar)
            self._training_widget = QWidget()
            self._training_widget.setStyleSheet(f"background-color: {BG_DARKEST}; border: 1px solid {BORDER}; border-radius: 8px;")
            training_layout = QVBoxLayout(self._training_widget)
            training_layout.setContentsMargins(10, 10, 10, 10)
            training_layout.setSpacing(8)

            t_header = QLabel("Training Live Telemetry")
            t_header.setStyleSheet("font-weight: bold; font-size: 12px; color: #00e5ff;")
            training_layout.addWidget(t_header)

            from orchiday.ui.widgets.loss_chart import LossChart
            self._shared_loss_chart = LossChart(self)
            self._shared_loss_chart.setMinimumHeight(120)
            training_layout.addWidget(self._shared_loss_chart, stretch=1)

            self._shared_progress = QProgressBar()
            self._shared_progress.setFixedHeight(6)
            self._shared_progress.setTextVisible(False)
            self._shared_progress.setValue(0)
            training_layout.addWidget(self._shared_progress)

            self._shared_status = QLabel("Ready to train. Choose a skill and click 'Train'.")
            self._shared_status.setStyleSheet("font-size: 11px; color: #888;")
            self._shared_status.setWordWrap(True)
            training_layout.addWidget(self._shared_status)

            self._panel_layout.addWidget(self._training_widget, stretch=0)
            layout.addLayout(self._panel_layout, stretch=1)
        else:
            self._cards_container = QWidget()
            self._cards_layout = QVBoxLayout(self._cards_container)
            self._cards_layout.setSpacing(12)
            self._cards_layout.setContentsMargins(0, 0, 0, 0)
            self._cards_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
            layout.addWidget(self._cards_container, stretch=1)

        self._refresh()

    def _on_shared_training_started(self, slug: str) -> None:
        self._shared_status.setText(f"Training started: {slug}")
        self._shared_status.setStyleSheet(f"color: {WARNING}; font-size: 11px;")
        self._shared_progress.setValue(0)
        self._shared_loss_chart.clear()

    def _on_shared_training_progress(self, slug: str, epoch: int, loss: float) -> None:
        self._shared_status.setText(f"Training '{slug}': Epoch {epoch} — Loss: {loss:.4f}")
        self._shared_progress.setValue(min(epoch, 100))
        self._shared_loss_chart.add_loss_point(epoch, loss)

    def _on_shared_training_finished(self, slug: str, checkpoint: str) -> None:
        self._shared_status.setText(f"Training complete! Checkpoint saved.")
        self._shared_status.setStyleSheet(f"color: {SUCCESS}; font-size: 11px;")
        self._shared_progress.setValue(100)

    def _on_shared_training_error(self, slug: str, error_msg: str) -> None:
        self._shared_status.setText(f"Error '{slug}': {error_msg}")
        self._shared_status.setStyleSheet(f"color: {ERROR}; font-size: 11px;")

    def _refresh(self) -> None:
        while self._cards_layout.count():
            child = self._cards_layout.takeAt(0)
            if child is not None:
                w = child.widget()
                if w is not None:
                    w.deleteLater()

        if self._pm.current_project is None:
            return

        skills = self._pm.current_project.get("skills", [])
        if not skills:
            empty = QLabel("No skills yet. Click '+ New Skill' to create one.")
            empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty.setStyleSheet(f"color: {TEXT_MUTED}; padding: 40px; font-size: 13px;")
            self._cards_layout.addWidget(empty)
            return

        for slug in skills:
            skill_data = {"name": slug, "architecture": "diffusion", "episodes": 0}
            if self._pm.current_path:
                skill_json = self._pm.current_path / "skills" / slug / "skill.json"
                if skill_json.exists():
                    try:
                        with open(skill_json, "r", encoding="utf-8") as f:
                            skill_data.update(json.load(f))
                    except Exception:
                        pass
            card = SkillCard(slug, skill_data, self._pm, compact=self._compact)
            card.remove_requested.connect(self._on_remove_skill)
            self._cards_layout.addWidget(card)

    def _on_add_skill(self) -> None:
        dialog = NewSkillDialog(self)
        if dialog.exec() == NewSkillDialog.DialogCode.Accepted:
            name = dialog.skill_name
            slug = dialog.skill_slug
            if not name or not slug:
                QMessageBox.warning(self, "Error", "Name and identifier are required.")
                return
            try:
                self._pm.add_skill(slug, {
                    "name": name,
                    "slug": slug,
                    "architecture": dialog.skill_architecture,
                    "task_description": dialog.task_description,
                    "episodes": 0,
                })
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _on_remove_skill(self, skill_slug: str) -> None:
        reply = QMessageBox.question(
            self, "Delete Skill",
            f"Delete skill '{skill_slug}'?\nAll recorded data will be lost!",
        )
        if reply == QMessageBox.StandardButton.Yes:
            self._pm.remove_skill(skill_slug)
