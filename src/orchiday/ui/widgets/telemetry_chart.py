"""
Telemetry Chart — native real-time double-buffered telemetry plotting.

Plots Raw actions (from Policy) in bright neon red and Safe actions
(after Low-Pass and Slew-Rate filters) in bright neon green.
"""

import collections
import logging
from PySide6.QtCore import Qt, Slot
from PySide6.QtGui import QPainter, QPen, QColor, QFont, QPainterPath
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QComboBox, QLabel

from orchiday.core.events import event_bus
from orchiday.ui import BG_MEDIUM, BG_DARKEST, TEXT_PRIMARY, TEXT_SECONDARY

log = logging.getLogger(__name__)


class TelemetryChart(QWidget):
    """
    High-performance real-time telemetry chart drawn natively using QPainter.

    Plots Raw actions (from Policy) in bright neon red and Safe actions
    (after Low-Pass and Slew-Rate filters) in bright neon green.
    """

    def __init__(self, num_points: int = 100, parent=None):
        super().__init__(parent)
        self._num_points = num_points
        self._axis_index = 0

        # Ring buffers for raw and safe values
        self._raw_history = collections.deque([0.0] * num_points, maxlen=num_points)
        self._safe_history = collections.deque([0.0] * num_points, maxlen=num_points)

        self._setup_ui()
        event_bus.safety_telemetry.connect(self._on_telemetry)

    def _setup_ui(self) -> None:
        self.setMinimumHeight(160)
        self.setStyleSheet(f"background-color: {BG_DARKEST}; border: 1px solid #1a1a1a; border-radius: 8px;")

    def set_axis_index(self, index: int) -> None:
        if 0 <= index < 6:
            self._axis_index = index
            self.update()

    @Slot(list, list)
    def _on_telemetry(self, raw_angles: list, safe_angles: list) -> None:
        if self._axis_index < len(raw_angles) and self._axis_index < len(safe_angles):
            self._raw_history.append(raw_angles[self._axis_index])
            self._safe_history.append(safe_angles[self._axis_index])
            self.update()  # Request repaint

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self.width()
        h = self.height()

        # Draw dark grid background
        painter.fillRect(0, 0, w, h, QColor(5, 5, 5))

        margin_left = 46
        margin_right = 16
        margin_top = 16
        margin_bottom = 20

        plot_w = w - margin_left - margin_right
        plot_h = h - margin_top - margin_bottom

        # Draw background grid
        grid_pen = QPen(QColor(24, 24, 24), 1, Qt.PenStyle.DashLine)
        painter.setPen(grid_pen)

        # Horizontal lines (value axis)
        num_y_divs = 4

        # Auto-scale grid range based on history to make small motions visible!
        all_vals = list(self._raw_history) + list(self._safe_history)
        if all_vals:
            mn, mx = min(all_vals), max(all_vals)
            span = mx - mn
            if span > 0.02:
                # Add 20% margin
                min_val = mn - span * 0.2
                max_val = mx + span * 0.2
            else:
                # Fallback if very static
                min_val = mn - 0.05
                max_val = mx + 0.05
        else:
            min_val, max_val = -3.14, 3.14

        for i in range(num_y_divs + 1):
            y = margin_top + int(plot_h * i / num_y_divs)
            painter.drawLine(margin_left, y, w - margin_right, y)

            # Value label
            val = max_val - (max_val - min_val) * i / num_y_divs
            painter.setPen(QColor(90, 90, 90))
            painter.setFont(QFont("Consolas", 8))
            painter.drawText(6, y + 4, f"{val:+.3f}")
            painter.setPen(grid_pen)

        # Vertical lines (time axis)
        num_x_divs = 10
        for i in range(num_x_divs + 1):
            x = margin_left + int(plot_w * i / num_x_divs)
            painter.drawLine(x, margin_top, x, h - margin_bottom)

        # Plot raw action path (Neon Red)
        raw_path = QPainterPath()
        raw_pen = QPen(QColor(255, 49, 49), 2, Qt.PenStyle.SolidLine)

        # Plot safe action path (Neon Green)
        safe_path = QPainterPath()
        safe_pen = QPen(QColor(57, 255, 20), 2, Qt.PenStyle.SolidLine)

        def val_to_y(val: float) -> int:
            norm = (val - min_val) / (max_val - min_val) if (max_val - min_val) != 0 else 0.5
            norm = max(0.0, min(1.0, norm))
            return margin_top + int(plot_h * (1.0 - norm))

        for i in range(self._num_points):
            x = margin_left + int(plot_w * i / (self._num_points - 1))

            raw_y = val_to_y(self._raw_history[i])
            safe_y = val_to_y(self._safe_history[i])

            if i == 0:
                raw_path.moveTo(x, raw_y)
                safe_path.moveTo(x, safe_y)
            else:
                raw_path.lineTo(x, raw_y)
                safe_path.lineTo(x, safe_y)

        # Draw curves
        painter.setPen(raw_pen)
        painter.drawPath(raw_path)

        painter.setPen(safe_pen)
        painter.drawPath(safe_path)


class LiveTelemetryPanel(QWidget):
    """Container widget that includes the TelemetryChart and axis selector."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self) -> None:
        self.setStyleSheet(f"""
            LiveTelemetryPanel {{
                background-color: {BG_MEDIUM};
                border: 1px solid #1c1c1c;
                border-radius: 10px;
            }}
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(10)

        # Header with dropdown selector
        header = QHBoxLayout()
        title = QLabel("Live Safety Telemetry")
        title.setStyleSheet(f"font-weight: 700; color: {TEXT_PRIMARY}; font-size: 13px; background: transparent; border: none;")
        header.addWidget(title)
        header.addStretch()

        self._axis_combo = QComboBox()
        self._axis_combo.setStyleSheet("""
            QComboBox {
                background-color: #0d0d0d; border: 1px solid #222; border-radius: 4px;
                color: #ccc; font-family: Consolas, monospace; font-size: 11px; padding: 4px 8px; min-width: 90px;
            }
        """)
        for i in range(6):
            self._axis_combo.addItem(f"Joint {i}", i)
        self._axis_combo.currentIndexChanged.connect(self._on_axis_changed)
        header.addWidget(self._axis_combo)

        # Led indicators for raw / safe
        raw_dot = QLabel("● Raw")
        raw_dot.setStyleSheet("color: #ff3131; font-size: 11px; font-weight: bold; background: transparent; border: none; padding-left: 10px;")
        header.addWidget(raw_dot)

        safe_dot = QLabel("● Safe")
        safe_dot.setStyleSheet("color: #39ff14; font-size: 11px; font-weight: bold; background: transparent; border: none; padding-left: 10px;")
        header.addWidget(safe_dot)

        layout.addLayout(header)

        # Chart
        self._chart = TelemetryChart(100)
        layout.addWidget(self._chart)

    def _on_axis_changed(self, index: int) -> None:
        self._chart.set_axis_index(index)
