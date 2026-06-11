"""
LED indikátor stavu pro Orchiday.

Malý kruhový widget s barevnou tečkou a volitelnou animací pulzování.
"""

from PySide6.QtCore import (
    QEasingCurve,
    QPropertyAnimation,
    QRectF,
    QSize,
    Qt,
    Property,
)
from PySide6.QtGui import QColor, QPainter, QPainterPath, QRadialGradient
from PySide6.QtWidgets import QWidget

from orchiday.ui import SUCCESS, ERROR, WARNING, TEXT_MUTED


class StatusIndicator(QWidget):
    """
    Malý LED indikátor s animací pulzování.

    Stavy:
        "connected"  → zelená, pulzuje
        "disconnected" → červená, statická
        "warning"    → žlutá, statická
        "idle"       → šedá, statická
    """

    STATE_COLORS = {
        "connected": SUCCESS,
        "disconnected": ERROR,
        "warning": WARNING,
        "idle": TEXT_MUTED,
    }

    def __init__(self, parent=None, *, size: int = 12, state: str = "idle"):
        super().__init__(parent)
        self._size = size
        self._state = state
        self._glow_opacity = 0.6

        # Pulzovací animace
        self._pulse_animation = QPropertyAnimation(self, b"glow_opacity", self)
        self._pulse_animation.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._pulse_animation.setDuration(1200)
        self._pulse_animation.setStartValue(0.3)
        self._pulse_animation.setEndValue(0.8)
        self._pulse_animation.setLoopCount(-1)  # nekonečný loop

        self.setFixedSize(QSize(size + 8, size + 8))
        self._update_animation()

    # ── Property pro animaci ─────────────────────────────────────────────

    def _get_glow_opacity(self) -> float:
        return self._glow_opacity

    def _set_glow_opacity(self, val: float) -> None:
        self._glow_opacity = val
        self.update()

    glow_opacity = Property(float, _get_glow_opacity, _set_glow_opacity)

    # ── Stav ─────────────────────────────────────────────────────────────

    @property
    def state(self) -> str:
        return self._state

    def set_state(self, state: str) -> None:
        """Změní stav indikátoru."""
        self._state = state
        self._update_animation()
        self.update()

    def _update_animation(self) -> None:
        if self._state == "connected":
            self._pulse_animation.start()
        else:
            self._pulse_animation.stop()
            self._glow_opacity = 0.6

    # ── Vykreslení ───────────────────────────────────────────────────────

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        color_hex = self.STATE_COLORS.get(self._state, TEXT_MUTED)
        base_color = QColor(color_hex)

        center_x = self.width() / 2
        center_y = self.height() / 2
        radius = self._size / 2

        # Záře (glow)
        if self._state == "connected":
            glow_color = QColor(base_color)
            glow_color.setAlphaF(self._glow_opacity * 0.4)
            gradient = QRadialGradient(center_x, center_y, radius + 4)
            gradient.setColorAt(0, glow_color)
            gradient.setColorAt(1, QColor(0, 0, 0, 0))
            p.setBrush(gradient)
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QRectF(0, 0, self.width(), self.height()))

        # Hlavní tečka
        dot_gradient = QRadialGradient(center_x - 1, center_y - 1, radius)
        lighter = QColor(base_color)
        lighter.setAlphaF(1.0)
        dot_gradient.setColorAt(0, lighter.lighter(140))
        dot_gradient.setColorAt(1, base_color)

        p.setBrush(dot_gradient)
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(QRectF(center_x - radius, center_y - radius, self._size, self._size))

        p.end()

    def sizeHint(self) -> QSize:
        return QSize(self._size + 8, self._size + 8)
