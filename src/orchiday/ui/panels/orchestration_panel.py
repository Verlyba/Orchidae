from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QHBoxLayout, QLabel, QLineEdit, QPushButton,
    QScrollArea, QVBoxLayout, QWidget, QFormLayout, QPlainTextEdit, QMessageBox,
)

from orchiday.core.events import event_bus
from orchiday.ui import (
    BG_MEDIUM, BG_LIGHT, BG_DARKEST, BORDER,
    ACCENT_PRIMARY, ACCENT_GRADIENT_START, ACCENT_GRADIENT_END,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
    FONT_SIZE_LG, SUCCESS, ERROR, WARNING,
)


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
        layout.setContentsMargins(12, 8, 12, 8)

        self._icon = QLabel("--")
        self._icon.setFixedWidth(28)
        self._icon.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 14px; background: transparent;")
        layout.addWidget(self._icon)

        self._label = QLabel(f"Step {self._index + 1}: {self._task_name}")
        self._label.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: 14px; background: transparent;")
        layout.addWidget(self._label)
        layout.addStretch()

        self._status = QLabel("Pending")
        self._status.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px; background: transparent;")
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
        self._icon.setStyleSheet(f"color: {color}; font-size: 14px; font-weight: bold; background: transparent;")
        self._label.setStyleSheet(f"color: {TEXT_PRIMARY if state in ('active', 'success') else TEXT_SECONDARY}; font-size: 14px; background: transparent;")
        self._status.setText(status)
        self._status.setStyleSheet(f"color: {color}; font-size: 12px; background: transparent;")


class OrchestrationPanel(QWidget):
    """
    Panel with chat input for user commands and visual pipeline display.

    The user types a natural language command, the CEO model decomposes it,
    and the pipeline steps are displayed with live status updates.
    """

    def __init__(self, project_manager=None, compact: bool = False, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._compact = compact
        self._step_widgets: list[TaskStepWidget] = []
        self._setup_ui()
        self._connect_events()

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(10 if self._compact else 16)
        if self._compact:
            layout.setContentsMargins(8, 8, 8, 8)
        else:
            layout.setContentsMargins(32, 32, 32, 32)

        header = QHBoxLayout()
        if self._compact:
            title = QLabel("AI Orchestrator")
            title.setStyleSheet("font-weight: 700; font-size: 14px; color: #fff;")
            header.addWidget(title)
        else:
            title = QLabel("Orchestration")
            title.setObjectName("section_title")
            header.addWidget(title)
        header.addStretch()
        layout.addLayout(header)

        if not self._compact:
            subtitle = QLabel(
                "Enter a natural language command. The CEO model will plan the steps, "
                "and the robot will execute them sequentially with visual verification."
            )
            subtitle.setObjectName("section_subtitle")
            subtitle.setWordWrap(True)
            layout.addWidget(subtitle)

        # AI Config Header (Collapsible Settings)
        self._settings_visible = False
        self._toggle_settings_btn = QPushButton("⚙️ Configure AI Models")
        self._toggle_settings_btn.setStyleSheet("""
            QPushButton {
                background: #1e1e1e; border: 1px solid #333; border-radius: 6px;
                color: #aaa; font-size: 11px; padding: 4px 10px; font-weight: bold;
            }
            QPushButton:hover { background: #2a2a2a; color: #fff; }
        """)
        self._toggle_settings_btn.clicked.connect(self._toggle_settings)
        layout.addWidget(self._toggle_settings_btn, 0, Qt.AlignmentFlag.AlignLeft)

        # Settings content widget
        self._settings_widget = QWidget()
        self._settings_widget.setVisible(False)
        self._settings_widget.setStyleSheet(f"""
            QWidget {{
                background-color: {BG_MEDIUM}; border: 1px solid {BORDER}; border-radius: 8px;
            }}
            QLabel {{ font-size: 11px; color: {TEXT_SECONDARY}; }}
            QLineEdit, QPlainTextEdit {{ font-size: 11px; }}
        """)
        settings_layout = QVBoxLayout(self._settings_widget)
        settings_layout.setContentsMargins(12, 12, 12, 12)
        settings_layout.setSpacing(6)

        # Form layout for configs
        form = QFormLayout()
        form.setSpacing(6)

        self._llm_endpoint = QLineEdit()
        self._llm_endpoint.setPlaceholderText("LLM (CEO) Endpoint, e.g. http://localhost:1234/v1")
        form.addRow("LLM Endpoint:", self._llm_endpoint)

        self._llm_model = QLineEdit()
        self._llm_model.setPlaceholderText("LLM Model Name")
        form.addRow("LLM Model:", self._llm_model)

        self._llm_prompt = QPlainTextEdit()
        self._llm_prompt.setPlaceholderText("LLM System Prompt...")
        self._llm_prompt.setMaximumHeight(50)
        form.addRow("System Prompt:", self._llm_prompt)

        self._vlm_endpoint = QLineEdit()
        self._vlm_endpoint.setPlaceholderText("VLM Endpoint, e.g. http://localhost:1234/v1")
        form.addRow("VLM Endpoint:", self._vlm_endpoint)

        self._vlm_model = QLineEdit()
        self._vlm_model.setPlaceholderText("VLM Model Name")
        form.addRow("VLM Model:", self._vlm_model)

        settings_layout.addLayout(form)

        # Save/Test row
        btn_row = QHBoxLayout()
        btn_row.addStretch()

        self._save_settings_btn = QPushButton("Save AI Config")
        self._save_settings_btn.setObjectName("primary_button")
        self._save_settings_btn.setFixedHeight(24)
        self._save_settings_btn.setStyleSheet("font-size: 11px; padding: 2px 8px;")
        self._save_settings_btn.clicked.connect(self._save_ai_settings)
        btn_row.addWidget(self._save_settings_btn)

        settings_layout.addLayout(btn_row)
        layout.addWidget(self._settings_widget)

        # Chat input
        input_row = QHBoxLayout()
        self._chat_input = QLineEdit()
        self._chat_input.setPlaceholderText("e.g. Pick up the red cube and place it in the bowl")
        _pad = "8px 10px" if self._compact else "14px 16px"
        _fs = "13px" if self._compact else "15px"
        _br = "8px" if self._compact else "10px"
        self._chat_input.setStyleSheet(f"""
            QLineEdit {{ padding: {_pad}; font-size: {_fs}; border-radius: {_br}; }}
        """)
        self._chat_input.returnPressed.connect(self._on_send)
        input_row.addWidget(self._chat_input)

        send_btn = QPushButton("Execute")
        send_btn.setFixedSize(80 if self._compact else 100, 32 if self._compact else 48)
        send_btn.setStyleSheet(f"""
            QPushButton {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 {ACCENT_GRADIENT_START}, stop:1 {ACCENT_GRADIENT_END});
                border: none; border-radius: {_br}; font-size: 13px;
                font-weight: 600; color: white;
            }}
            QPushButton:hover {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 {ACCENT_GRADIENT_END}, stop:1 {ACCENT_GRADIENT_START});
            }}
        """)
        send_btn.clicked.connect(self._on_send)
        input_row.addWidget(send_btn)
        layout.addLayout(input_row)

        # Pipeline display
        _pip_fs = "12px" if self._compact else FONT_SIZE_LG
        self._pipeline_label = QLabel("Pipeline")
        self._pipeline_label.setStyleSheet(f"font-size: {_pip_fs}; font-weight: 600; color: {TEXT_SECONDARY}; padding-top: 4px;")
        layout.addWidget(self._pipeline_label)

        self._pipeline_container = QWidget()
        self._pipeline_layout = QVBoxLayout(self._pipeline_container)
        self._pipeline_layout.setSpacing(4)
        self._pipeline_layout.setContentsMargins(0, 0, 0, 0)
        self._pipeline_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        layout.addWidget(self._pipeline_container, stretch=1)

        # Status
        _st_fs = "11px" if self._compact else "13px"
        self._overall_status = QLabel("Waiting for command...")
        self._overall_status.setStyleSheet(f"color: {TEXT_MUTED}; font-size: {_st_fs}; padding-top: 4px;")
        layout.addWidget(self._overall_status)

        # Load values initially
        self._load_settings()

    def _toggle_settings(self) -> None:
        self._settings_visible = not self._settings_visible
        self._settings_widget.setVisible(self._settings_visible)
        self._toggle_settings_btn.setText("⚙️ Hide AI Config" if self._settings_visible else "⚙️ Configure AI Models")

    def _load_settings(self) -> None:
        if not self._pm or not self._pm.current_project:
            return
        models = self._pm.current_project.get("models", {})
        llm = models.get("llm_ceo", {})
        vlm = models.get("vlm_inspector", {})

        self._llm_endpoint.setText(llm.get("endpoint", ""))
        self._llm_model.setText(llm.get("model_name", ""))
        self._llm_prompt.setPlainText(llm.get("system_prompt", ""))

        self._vlm_endpoint.setText(vlm.get("endpoint", ""))
        self._vlm_model.setText(vlm.get("model_name", ""))

    def _save_ai_settings(self) -> None:
        if not self._pm or not self._pm.current_project:
            return
        
        llm_config = {
            "endpoint": self._llm_endpoint.text().strip(),
            "model_name": self._llm_model.text().strip(),
            "system_prompt": self._llm_prompt.toPlainText().strip()
        }
        vlm_config = {
            "endpoint": self._vlm_endpoint.text().strip(),
            "model_name": self._vlm_model.text().strip()
        }

        try:
            self._pm.update_model_config("llm_ceo", llm_config)
            self._pm.update_model_config("vlm_inspector", vlm_config)
            event_bus.log_message.emit("SUCCESS", "AI Model Configs updated dynamically!")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save configs: {e}")

    def _connect_events(self) -> None:
        event_bus.orchestration_plan_ready.connect(self._on_plan_ready)
        event_bus.orchestration_task_started.connect(self._on_task_started)
        event_bus.orchestration_task_completed.connect(self._on_task_completed)
        event_bus.orchestration_finished.connect(self._on_finished)
        event_bus.orchestration_error.connect(self._on_error)
        event_bus.project_opened.connect(lambda _: self._load_settings())

    def _on_send(self) -> None:
        text = self._chat_input.text().strip()
        if not text:
            return

        self._clear_pipeline()
        self._overall_status.setText("Planning...")
        self._overall_status.setStyleSheet(f"color: {WARNING}; font-size: 13px; padding-top: 8px;")
        event_bus.log_message.emit("INFO", f"User command: {text}")
        event_bus.orchestration_requested.emit(text)
        self._chat_input.clear()

    def _on_plan_ready(self, plan: list) -> None:
        self._clear_pipeline()
        for i, task in enumerate(plan):
            step = TaskStepWidget(i, task)
            self._step_widgets.append(step)
            self._pipeline_layout.addWidget(step)
        self._overall_status.setText(f"Plan ready: {len(plan)} steps")
        self._overall_status.setStyleSheet(f"color: {TEXT_PRIMARY}; font-size: 13px; padding-top: 8px;")

    def _on_task_started(self, task_name: str) -> None:
        for sw in self._step_widgets:
            if sw._task_name == task_name and sw._state == "pending":
                sw.set_state("active")
                break
        self._overall_status.setText(f"Executing: {task_name}")

    def _on_task_completed(self, task_name: str, success: bool) -> None:
        for sw in self._step_widgets:
            if sw._task_name == task_name and sw._state == "active":
                sw.set_state("success" if success else "failed")
                break

    def _on_finished(self, success: bool) -> None:
        if success:
            self._overall_status.setText("All steps completed successfully!")
            self._overall_status.setStyleSheet(f"color: {SUCCESS}; font-size: 13px; font-weight: 600; padding-top: 8px;")
        else:
            self._overall_status.setText("Completed with errors.")
            self._overall_status.setStyleSheet(f"color: {WARNING}; font-size: 13px; padding-top: 8px;")

    def _on_error(self, error: str) -> None:
        self._overall_status.setText(f"Error: {error}")
        self._overall_status.setStyleSheet(f"color: {ERROR}; font-size: 13px; padding-top: 8px;")

    def _clear_pipeline(self) -> None:
        self._step_widgets.clear()
        while self._pipeline_layout.count():
            child = self._pipeline_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
