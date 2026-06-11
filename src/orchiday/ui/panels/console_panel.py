"""
Console panel — colored log output, subprocess stdout/stderr.
"""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPlainTextEdit, QPushButton, QVBoxLayout, QWidget, QLineEdit

from orchiday.core.events import event_bus
from orchiday.ui import SUCCESS, WARNING, ERROR, INFO, TEXT_SECONDARY


class TerminalInput(QLineEdit):
    """Custom QLineEdit that captures Up/Down arrows to navigate command history."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._history: list[str] = []
        self._history_index = -1
        self._temp_input = ""

    def keyPressEvent(self, event) -> None:
        key = event.key()
        if key == Qt.Key.Key_Up:
            if not self._history:
                return
            if self._history_index == -1:
                # Save current typed text before moving up
                self._temp_input = self.text()

            if self._history_index < len(self._history) - 1:
                self._history_index += 1
                self.setText(self._history[self._history_index])
            return

        elif key == Qt.Key.Key_Down:
            if self._history_index > -1:
                self._history_index -= 1
                if self._history_index == -1:
                    self.setText(self._temp_input)
                else:
                    self.setText(self._history[self._history_index])
            return

        elif key in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            cmd = self.text().strip()
            if cmd:
                # Add to history if not a duplicate of the last command
                if not self._history or self._history[0] != cmd:
                    self._history.insert(0, cmd)
                self._history_index = -1
                self._temp_input = ""
            super().keyPressEvent(event)
        else:
            super().keyPressEvent(event)


class ConsolePanel(QWidget):
    """Console panel with colored log levels and interactive terminal input."""

    LEVEL_COLORS = {"INFO": INFO, "WARN": WARNING, "ERROR": ERROR, "SUCCESS": SUCCESS}

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()
        event_bus.log_message.connect(self._on_log)
        event_bus.console_output.connect(self._on_raw_output)

    def _setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(8)
        layout.setContentsMargins(0, 0, 0, 0)

        header = QHBoxLayout()
        header.setContentsMargins(16, 8, 16, 0)
        title = QLabel("Terminal & Console")
        title.setStyleSheet(f"font-weight: 600; color: {TEXT_SECONDARY}; font-size: 13px;")
        header.addWidget(title)
        header.addStretch()
        clear_btn = QPushButton("Clear")
        clear_btn.setFixedHeight(24)
        clear_btn.setStyleSheet("font-size: 11px; padding: 2px 8px;")
        clear_btn.clicked.connect(self._clear)
        header.addWidget(clear_btn)
        layout.addLayout(header)

        self._output = QPlainTextEdit()
        self._output.setReadOnly(True)
        self._output.setObjectName("console")
        self._output.setPlaceholderText("Console output and terminal session logs will appear here...")
        layout.addWidget(self._output)

        # Interactive command line input for the terminal with history support
        self._command_input = TerminalInput()
        self._command_input.setPlaceholderText("Enter CLI command (e.g. /vis, /help or raw python CLI command)")
        self._command_input.setStyleSheet(f"""
            QLineEdit {{
                background-color: #070707;
                border: 1px solid #1c1c1c;
                border-radius: 6px;
                color: #39ff14;
                font-family: 'Consolas', 'Courier New', monospace;
                font-size: 12px;
                padding: 10px;
                margin: 0 16px 12px 16px;
            }}
            QLineEdit:focus {{
                border: 1px solid #444444;
            }}
        """)
        self._command_input.returnPressed.connect(self._on_command_entered)
        layout.addWidget(self._command_input)

    def _on_command_entered(self) -> None:
        cmd = self._command_input.text().strip()
        if not cmd:
            return
        self._command_input.clear()

        # Display entered command in terminal
        self._output.appendHtml(
            f'<br/><span style="color:#39ff14;font-weight:bold;font-family:monospace;">$ {cmd}</span>'
        )
        self._auto_scroll()

        # Emit signal to run the custom CLI command
        event_bus.terminal_command_requested.emit(cmd)

    def _on_log(self, level: str, message: str) -> None:
        color = self.LEVEL_COLORS.get(level, TEXT_SECONDARY)
        self._output.appendHtml(
            f'<span style="color:{color};font-weight:600;">[{level}]</span> '
            f'<span style="color:{TEXT_SECONDARY};">{message}</span>'
        )
        self._auto_scroll()

    def _on_raw_output(self, text: str) -> None:
        self._output.appendPlainText(text)
        self._auto_scroll()

    def _clear(self) -> None:
        self._output.clear()

    def _auto_scroll(self) -> None:
        sb = self._output.verticalScrollBar()
        sb.setValue(sb.maximum())
