"""
Loss Chart — native real-time double-buffered training Loss visualization.

Plots training Loss going down over epochs in bright neon blue.
"""

import logging
from PySide6.QtCore import Qt, Slot
from PySide6.QtGui import QPainter, QPen, QColor, QFont, QPainterPath
from PySide6.QtWidgets import QWidget

from orchiday.ui import BG_DARKEST, TEXT_PRIMARY, TEXT_SECONDARY, BORDER

log = logging.getLogger(__name__)


class LossChart(QWidget):
    """
    High-performance native Loss visualization chart.
    Draws a neon-blue spline curve showing decreasing Loss values over epochs.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self._loss_history: list[tuple[int, float]] = []  # List of (epoch, loss) tuples
        self.setMinimumHeight(100)
        self.setStyleSheet(f"background-color: {BG_DARKEST}; border: 1px solid {BORDER}; border-radius: 8px;")

    def add_loss_point(self, epoch: int, loss: float) -> None:
        """Add a new epoch/loss data point and trigger a repaint."""
        self._loss_history.append((epoch, loss))
        self.update()

    def clear(self) -> None:
        """Clear all historical loss points."""
        self._loss_history.clear()
        self.update()

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self.width()
        h = self.height()

        # Draw dark background
        painter.fillRect(0, 0, w, h, QColor(6, 7, 10))

        margin_left = 46
        margin_right = 16
        margin_top = 16
        margin_bottom = 20

        plot_w = w - margin_left - margin_right
        plot_h = h - margin_top - margin_bottom

        # Draw background grid
        grid_pen = QPen(QColor(16, 22, 35), 1, Qt.PenStyle.DashLine)
        painter.setPen(grid_pen)

        # Horizontal grid divisions
        num_y_divs = 3
        
        # Calculate Y range based on loss history
        if self._loss_history:
            losses = [p[1] for p in self._loss_history]
            mn_loss, mx_loss = min(losses), max(losses)
            span = mx_loss - mn_loss
            if span > 0.0001:
                # Add 15% margin to prevent curve from touching top/bottom margins
                min_y = max(0.0, mn_loss - span * 0.15)
                max_y = mx_loss + span * 0.15
            else:
                min_y = max(0.0, mn_loss - 0.1)
                max_y = mx_loss + 0.1
        else:
            min_y, max_y = 0.0, 1.0

        for i in range(num_y_divs + 1):
            y = margin_top + int(plot_h * i / num_y_divs)
            painter.drawLine(margin_left, y, w - margin_right, y)

            # Value label
            val = max_y - (max_y - min_y) * i / num_y_divs
            painter.setPen(QColor(90, 105, 120))
            painter.setFont(QFont("Consolas", 8))
            painter.drawText(6, y + 4, f"{val:.4f}")
            painter.setPen(grid_pen)

        # Vertical grid divisions (epochs)
        num_x_divs = 5
        for i in range(num_x_divs + 1):
            x = margin_left + int(plot_w * i / num_x_divs)
            painter.drawLine(x, margin_top, x, h - margin_bottom)

            # Epoch label at the bottom axis
            if self._loss_history:
                epochs = [p[0] for p in self._loss_history]
                mn_ep, mx_ep = min(epochs), max(epochs)
                val_ep = mn_ep + int((mx_ep - mn_ep) * i / num_x_divs)
            else:
                val_ep = i * 10
            
            painter.setPen(QColor(90, 105, 120))
            painter.setFont(QFont("Consolas", 8))
            painter.drawText(x - 8, h - 6, str(val_ep))
            painter.setPen(grid_pen)

        # Draw Loss curve (Neon Cyan/Blue)
        if len(self._loss_history) >= 2:
            path = QPainterPath()
            curve_pen = QPen(QColor(0, 191, 255), 2, Qt.PenStyle.SolidLine)
            
            epochs = [p[0] for p in self._loss_history]
            mn_ep, mx_ep = min(epochs), max(epochs)
            ep_span = mx_ep - mn_ep if mx_ep != mn_ep else 1.0

            def pt_to_xy(ep: int, loss_val: float) -> tuple[int, int]:
                norm_x = (ep - mn_ep) / ep_span
                norm_y = (loss_val - min_y) / (max_y - min_y) if (max_y - min_y) != 0 else 0.5
                norm_y = max(0.0, min(1.0, norm_y))
                
                x = margin_left + int(plot_w * norm_x)
                y = margin_top + int(plot_h * (1.0 - norm_y))
                return x, y

            for i, (ep, val) in enumerate(self._loss_history):
                x, y = pt_to_xy(ep, val)
                if i == 0:
                    path.moveTo(x, y)
                else:
                    path.lineTo(x, y)

            painter.setPen(curve_pen)
            painter.drawPath(path)

            # Highlight current point
            curr_ep, curr_loss = self._loss_history[-1]
            cx, cy = pt_to_xy(curr_ep, curr_loss)
            painter.setBrush(QColor(0, 191, 255))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(cx - 3, cy - 3, 6, 6)

            # Show floating text of current loss
            painter.setPen(QColor(230, 240, 255))
            painter.setFont(QFont("Consolas", 8, QFont.Weight.Bold))
            painter.drawText(w - 110, margin_top + 12, f"Loss: {curr_loss:.5f}")
        elif len(self._loss_history) == 1:
            # Draw a single dot
            epochs = [p[0] for p in self._loss_history]
            mn_ep = min(epochs)
            curr_ep, curr_loss = self._loss_history[-1]
            norm_y = (curr_loss - min_y) / (max_y - min_y) if (max_y - min_y) != 0 else 0.5
            cx = margin_left + int(plot_w / 2)
            cy = margin_top + int(plot_h * (1.0 - norm_y))
            
            painter.setBrush(QColor(0, 191, 255))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(cx - 4, cy - 4, 8, 8)

            painter.setPen(QColor(230, 240, 255))
            painter.setFont(QFont("Consolas", 8, QFont.Weight.Bold))
            painter.drawText(w - 110, margin_top + 12, f"Loss: {curr_loss:.5f}")
        else:
            # Empty state text
            painter.setPen(QColor(70, 85, 105))
            painter.setFont(QFont("Inter", 9))
            painter.drawText(margin_left + 20, h // 2 + 4, "Waiting for training loss data...")
