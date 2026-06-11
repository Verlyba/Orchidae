"""
AI Model panel — configure LLM (CEO), VLM (Inspector), manage LeRobot policies, and interact with the CEO Planner.
"""

from PySide6.QtCore import Qt, Slot
from PySide6.QtWidgets import (
    QFormLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
    QPlainTextEdit, QPushButton, QScrollArea, QVBoxLayout, QWidget,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.core.events import event_bus
from orchiday.core.constants import DEFAULT_LM_STUDIO_URL
from orchiday.ui import (
    BG_MEDIUM, BG_LIGHT, BORDER, ACCENT_PRIMARY,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
    FONT_SIZE_LG, FONT_SIZE_XL, WARNING, SUCCESS, ERROR,
)
from orchiday.ui.widgets import StatusIndicator


class ModelConfigCard(QWidget):
    """Configuration card for a single AI model (LLM or VLM)."""

    def __init__(self, model_role: str, title: str, icon: str, description: str,
                 config: dict, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._role = model_role
        self._config = dict(config)
        self._pm = project_manager
        self._compact = compact
        self._setup_ui(title, icon, description)
        
        # Connect status events
        event_bus.model_connection_ok.connect(self._on_connection_ok)
        event_bus.model_connection_fail.connect(self._on_connection_fail)

    def _setup_ui(self, title: str, icon: str, description: str) -> None:
        self.setStyleSheet(f"""
            ModelConfigCard {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 12px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setSpacing(4 if self._compact else 12)
        if self._compact:
            layout.setContentsMargins(10, 8, 10, 8)
        else:
            layout.setContentsMargins(20, 20, 20, 20)

        header = QHBoxLayout()
        header.setSpacing(6)
        
        icon_label = QLabel(icon)
        icon_label.setStyleSheet("font-size: 14px; background: transparent; font-weight: bold; color: #a78bfa;" if self._compact else "font-size: 28px; background: transparent;")
        header.addWidget(icon_label)

        title_layout = QVBoxLayout()
        title_layout.setSpacing(0)
        title_label = QLabel(title)
        title_label.setStyleSheet(f"font-weight: 700; font-size: 11px; color: {TEXT_PRIMARY}; background: transparent;" if self._compact else f"font-weight: 700; font-size: {FONT_SIZE_LG}; color: {TEXT_PRIMARY}; background: transparent;")
        title_layout.addWidget(title_label)
        
        if not self._compact:
            desc_label = QLabel(description)
            desc_label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;")
            title_layout.addWidget(desc_label)
            
        header.addLayout(title_layout)
        header.addStretch()

        self._status = StatusIndicator(state="idle", size=5 if self._compact else 10)
        header.addWidget(self._status)
        layout.addLayout(header)

        form = QFormLayout()
        form.setSpacing(3 if self._compact else 8)
        form.setContentsMargins(0, 0, 0, 0)
        
        self._endpoint_input = QLineEdit(self._config.get("endpoint", DEFAULT_LM_STUDIO_URL))
        if self._compact:
            self._endpoint_input.setStyleSheet("font-size: 9px; padding: 3px; height: 16px;")
        form.addRow("Endpoint:", self._endpoint_input)

        self._model_input = QLineEdit(self._config.get("model_name", ""))
        self._model_input.setPlaceholderText("Model name in LM Studio")
        if self._compact:
            self._model_input.setStyleSheet("font-size: 9px; padding: 3px; height: 16px;")
        form.addRow("Model:", self._model_input)

        if "system_prompt" in self._config:
            self._prompt_input = QPlainTextEdit(self._config.get("system_prompt", ""))
            self._prompt_input.setMaximumHeight(30 if self._compact else 80)
            if self._compact:
                self._prompt_input.setStyleSheet("font-size: 9px; padding: 3px;")
            form.addRow("Prompt:" if self._compact else "System Prompt:", self._prompt_input)
        else:
            self._prompt_input = None

        layout.addLayout(form)

        actions = QHBoxLayout()
        actions.setSpacing(4)
        actions.addStretch()
        
        test_btn = QPushButton("Test") if self._compact else QPushButton("Test Connection")
        if self._compact:
            test_btn.setFixedHeight(20)
            test_btn.setStyleSheet("font-size: 9px; padding: 1px 6px;")
        test_btn.clicked.connect(self._test_connection)
        actions.addWidget(test_btn)
        
        save_btn = QPushButton("Save")
        save_btn.setObjectName("primary_button")
        if self._compact:
            save_btn.setFixedHeight(20)
            save_btn.setStyleSheet("font-size: 9px; padding: 1px 6px;")
        save_btn.clicked.connect(self._save_config)
        actions.addWidget(save_btn)
        
        layout.addLayout(actions)

    def _test_connection(self) -> None:
        self._status.set_state("warning")
        event_bus.log_message.emit("INFO", f"Testing connection for {self._role}...")
        
        # Save temp config and trigger a reload/test in Controller
        config = {
            "endpoint": self._endpoint_input.text().strip(),
            "model_name": self._model_input.text().strip(),
        }
        if self._prompt_input is not None:
            config["system_prompt"] = self._prompt_input.toPlainText()
        
        event_bus.model_configured.emit(self._role, config)

    def _save_config(self) -> None:
        config = {
            "endpoint": self._endpoint_input.text().strip(),
            "model_name": self._model_input.text().strip(),
        }
        if self._prompt_input is not None:
            config["system_prompt"] = self._prompt_input.toPlainText()
        try:
            self._pm.update_model_config(self._role, config)
            event_bus.log_message.emit("SUCCESS", f"Model {self._role} configuration saved.")
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    @Slot(str)
    def _on_connection_ok(self, role: str) -> None:
        if role == self._role:
            self._status.set_state("connected")

    @Slot(str, str)
    def _on_connection_fail(self, role: str, msg: str) -> None:
        if role == self._role:
            self._status.set_state("disconnected")


class TaskStepWidget(QWidget):
    """Visual step in the orchestration pipeline."""

    def __init__(self, index: int, task_name: str, parent=None):
        super().__init__(parent)
        self._index = index
        self._task_name = task_name
        self._state = "pending"  # pending, active, success, failed
        self._setup_ui()

    def _setup_ui(self) -> None:
        layout = QHBoxLayout(self)
        layout.setContentsMargins(6, 4, 6, 4)

        self._icon = QLabel("--")
        self._icon.setFixedWidth(20)
        self._icon.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 11px; background: transparent;")
        layout.addWidget(self._icon)

        self._label = QLabel(f"Step {self._index + 1}: {self._task_name}")
        self._label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;")
        layout.addWidget(self._label)
        layout.addStretch()

        self._status = QLabel("Pending")
        self._status.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 9px; background: transparent;")
        layout.addWidget(self._status)

    def set_state(self, state: str) -> None:
        self._state = state
        style_map = {
            "pending": (TEXT_MUTED, "--", "Pending"),
            "active":  (WARNING, ">>", "Running..."),
            "success": (SUCCESS, "OK", "Done"),
            "failed":  (ERROR, "!!", "Failed"),
        }
        color, icon, status = style_map.get(state, style_map["pending"])
        self._icon.setText(icon)
        self._icon.setStyleSheet(f"color: {color}; font-size: 11px; font-weight: bold; background: transparent;")
        self._label.setStyleSheet(f"color: {TEXT_PRIMARY if state in ('active', 'success') else TEXT_SECONDARY}; font-size: 11px; background: transparent;")
        self._status.setText(status)
        self._status.setStyleSheet(f"color: {color}; font-size: 9px; background: transparent;")


class ModelChatCard(QWidget):
    """Chat input and live execution pipeline steps for communicating tasks to the CEO planner."""

    def __init__(self, project_manager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._step_widgets: list[TaskStepWidget] = []
        self._setup_ui()
        self._connect_events()

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"""
            ModelChatCard {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 12px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setSpacing(6)
        layout.setContentsMargins(12, 12, 12, 12)

        header = QHBoxLayout()
        title = QLabel("💬 CEO COMMUNICATOR")
        title.setStyleSheet(f"font-weight: 700; font-size: 12px; color: {ACCENT_PRIMARY}; background: transparent; letter-spacing: 0.5px;")
        header.addWidget(title)
        header.addStretch()
        layout.addLayout(header)

        # Instruction input row
        input_row = QHBoxLayout()
        input_row.setSpacing(6)
        
        self._chat_input = QLineEdit()
        self._chat_input.setPlaceholderText("Task for CEO (e.g. Pick up red cube)")
        self._chat_input.setStyleSheet("font-size: 11px; padding: 6px; height: 18px; border-radius: 6px;")
        self._chat_input.returnPressed.connect(self._on_send)
        input_row.addWidget(self._chat_input)

        self._send_btn = QPushButton("Execute")
        self._send_btn.setObjectName("primary_button")
        self._send_btn.setFixedHeight(30)
        self._send_btn.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #a78bfa, stop:1 #06b6d4);
                border: none; border-radius: 6px; font-size: 11px;
                font-weight: 600; color: white; padding: 2px 12px;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #06b6d4, stop:1 #a78bfa);
            }
        """)
        self._send_btn.clicked.connect(self._on_send)
        input_row.addWidget(self._send_btn)
        layout.addLayout(input_row)

        # Pipeline view
        self._pipeline_container = QWidget()
        self._pipeline_layout = QVBoxLayout(self._pipeline_container)
        self._pipeline_layout.setSpacing(3)
        self._pipeline_layout.setContentsMargins(0, 0, 0, 0)
        self._pipeline_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        scroll.setWidget(self._pipeline_container)
        layout.addWidget(scroll, stretch=1)

        # Bottom overall status
        self._overall_status = QLabel("Ready for CEO task...")
        self._overall_status.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 10px; font-weight: bold; background: transparent;")
        layout.addWidget(self._overall_status)

    def _connect_events(self) -> None:
        event_bus.orchestration_plan_ready.connect(self._on_plan_ready)
        event_bus.orchestration_task_started.connect(self._on_task_started)
        event_bus.orchestration_task_completed.connect(self._on_task_completed)
        event_bus.orchestration_finished.connect(self._on_finished)
        event_bus.orchestration_error.connect(self._on_error)

    def _on_send(self) -> None:
        text = self._chat_input.text().strip()
        if not text:
            return

        self._clear_pipeline()
        self._overall_status.setText("Planning...")
        self._overall_status.setStyleSheet(f"color: {WARNING}; font-size: 10px; font-weight: bold; background: transparent;")
        event_bus.log_message.emit("INFO", f"User task: {text}")
        event_bus.orchestration_requested.emit(text)
        self._chat_input.clear()

    def _on_plan_ready(self, plan: list) -> None:
        self._clear_pipeline()
        for i, task in enumerate(plan):
            step = TaskStepWidget(i, task)
            self._step_widgets.append(step)
            self._pipeline_layout.addWidget(step)
        self._overall_status.setText(f"Plan parsed: {len(plan)} steps")
        self._overall_status.setStyleSheet(f"color: {TEXT_PRIMARY}; font-size: 10px; font-weight: bold; background: transparent;")

    def _on_task_started(self, task_name: str) -> None:
        for sw in self._step_widgets:
            if sw._task_name == task_name and sw._state == "pending":
                sw.set_state("active")
                break
        self._overall_status.setText(f"Active: {task_name}")

    def _on_task_completed(self, task_name: str, success: bool) -> None:
        for sw in self._step_widgets:
            if sw._task_name == task_name and sw._state == "active":
                sw.set_state("success" if success else "failed")
                break

    def _on_finished(self, success: bool) -> None:
        if success:
            self._overall_status.setText("CEO task completed successfully!")
            self._overall_status.setStyleSheet(f"color: {SUCCESS}; font-size: 10px; font-weight: bold; background: transparent;")
        else:
            self._overall_status.setText("CEO task failed.")
            self._overall_status.setStyleSheet(f"color: {WARNING}; font-size: 10px; font-weight: bold; background: transparent;")

    def _on_error(self, error: str) -> None:
        self._overall_status.setText(f"Error: {error}")
        self._overall_status.setStyleSheet(f"color: {ERROR}; font-size: 10px; font-weight: bold; background: transparent;")

    def _clear_pipeline(self) -> None:
        self._step_widgets.clear()
        while self._pipeline_layout.count():
            child = self._pipeline_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()


class PolicyCard(QWidget):
    """Card for a trained LeRobot policy."""

    def __init__(self, skill_slug: str, policy_data: dict, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"background-color: {BG_LIGHT}; border: 1px solid {BORDER}; border-radius: 8px;")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)

        info = QVBoxLayout()
        name = QLabel(skill_slug)
        name.setStyleSheet(f"font-weight: 600; color: {TEXT_PRIMARY}; background: transparent;")
        info.addWidget(name)
        arch = policy_data.get("architecture", "?")
        detail = QLabel(f"Architecture: {arch}")
        detail.setStyleSheet(f"font-size: 12px; color: {TEXT_SECONDARY}; background: transparent;")
        info.addWidget(detail)
        layout.addLayout(info)
        layout.addStretch()

        trained = policy_data.get("checkpoint")
        status = QLabel("Trained" if trained else "Pending")
        status.setStyleSheet(f"color: {'#34d399' if trained else '#fbbf24'}; font-size: 12px; background: transparent;")
        layout.addWidget(status)


class ModelPanel(QWidget):
    """Panel for managing all AI models and interacting with the CEO Planner."""

    def __init__(self, project_manager: ProjectManager, compact: bool = False, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._compact = compact
        self._setup_ui()
        
        event_bus.project_opened.connect(lambda _: self._refresh())
        event_bus.model_configured.connect(lambda *_: self._refresh())

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(8 if self._compact else 16)
        if self._compact:
            layout.setContentsMargins(4, 4, 4, 4)
        else:
            layout.setContentsMargins(32, 32, 32, 32)

        if not self._compact:
            title = QLabel("AI Models")
            title.setObjectName("section_title")
            layout.addWidget(title)

            subtitle = QLabel("Configure LLM (CEO planner), VLM (Scene inspector), and manage trained policy models.")
            subtitle.setObjectName("section_subtitle")
            subtitle.setWordWrap(True)
            layout.addWidget(subtitle)

        # Compact layout is a 2-column split: Left lists CEO/Manager vertically, Right embeds CEO Communicator.
        if self._compact:
            self._content = QWidget()
            main_h = QHBoxLayout(self._content)
            main_h.setSpacing(12)
            main_h.setContentsMargins(0, 0, 0, 0)
            
            # Left Column (vertical models stack)
            left_col = QWidget()
            self._left_layout = QVBoxLayout(left_col)
            self._left_layout.setSpacing(8)
            self._left_layout.setContentsMargins(0, 0, 0, 0)
            main_h.addWidget(left_col, stretch=1)
            
            # Right Column (CEO Communicator chat & pipeline)
            self._chat_card = ModelChatCard(self._pm, parent=self)
            main_h.addWidget(self._chat_card, stretch=1)
            
            layout.addWidget(self._content, stretch=1)
        else:
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")
            self._content = QWidget()
            self._content_layout = QVBoxLayout(self._content)
            self._content_layout.setSpacing(16)
            self._content_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
            scroll.setWidget(self._content)
            layout.addWidget(scroll)
            
        self._refresh()

    def _refresh(self) -> None:
        # Determine active target container
        target_layout = self._left_layout if self._compact else self._content_layout

        while target_layout.count():
            child = target_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        if self._pm.current_project is None:
            return

        models = self._pm.current_project.get("models", {})

        llm_card = ModelConfigCard(
            "llm_ceo", "CEO (LLM Planner)", "🧠 CEO",
            "High level — decomposes tasks into sub-task sequences",
            models.get("llm_ceo", {}), self._pm,
            compact=self._compact,
        )
        target_layout.addWidget(llm_card)

        vlm_card = ModelConfigCard(
            "vlm_inspector", "Manager (VLM Inspector)", "👁️ MANAGER",
            "Mid level — visual verification of scene state",
            models.get("vlm_inspector", {}), self._pm,
            compact=self._compact,
        )
        target_layout.addWidget(vlm_card)

        if not self._compact:
            policies_header = QLabel("Model 3: Motor Policies (LeRobot)")
            policies_header.setStyleSheet(f"font-size: {FONT_SIZE_LG}; font-weight: 600; color: {TEXT_SECONDARY}; padding-top: 8px;")
            self._content_layout.addWidget(policies_header)

            skills = self._pm.current_project.get("skills", [])
            if not skills:
                empty = QLabel("No policy models yet. Create skills and train them first.")
                empty.setStyleSheet(f"color: {TEXT_MUTED}; padding: 16px;")
                self._content_layout.addWidget(empty)
            else:
                for slug in skills:
                    card = PolicyCard(slug, {"architecture": "diffusion"})
                    self._content_layout.addWidget(card)
