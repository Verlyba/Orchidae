"""
Custom toggle switch widget pro Orchiday.

Animovaný přepínač s plynulou barevnou tranzicí.
"""

from PySide6.QtCore import (
    QEasingCurve,
    QPropertyAnimation,
    QRectF,
    QSize,
    Qt,
    Property,
    Signal,
)
from PySide6.QtGui import QColor, QPainter, QPainterPath
from PySide6.QtWidgets import QAbstractButton

from orchiday.ui import ACCENT_PRIMARY, BG_HIGHLIGHT, TEXT_ON_ACCENT, TEXT_MUTED


class ToggleSwitch(QAbstractButton):
    """
    Animovaný toggle switch widget.

    Signály:
        toggled_value(bool): Emitováno při změně stavu.
    """

    toggled_value = Signal(bool)

    def __init__(self, parent=None, *, width=52, height=28):
        super().__init__(parent)
        self.setCheckable(True)
        self._width = width
        self._height = height
        self._margin = 3
        self._thumb_radius = (height - 2 * self._margin) // 2

        # Animace pozice "palce"
        self._position = 0.0
        self._animation = QPropertyAnimation(self, b"thumb_position", self)
        self._animation.setEasingCurve(QEasingCurve.Type.InOutCubic)
        self._animation.setDuration(200)

        self.toggled.connect(self._on_toggled)

    # ── Properties pro animaci ───────────────────────────────────────────

    def _get_thumb_position(self) -> float:
        return self._position

    def _set_thumb_position(self, pos: float) -> None:
        self._position = pos
        self.update()

    thumb_position = Property(float, _get_thumb_position, _set_thumb_position)

    # ── Události ─────────────────────────────────────────────────────────

    def _on_toggled(self, checked: bool) -> None:
        end_pos = 1.0 if checked else 0.0
        self._animation.setStartValue(self._position)
        self._animation.setEndValue(end_pos)
        self._animation.start()
        self.toggled_value.emit(checked)

    def sizeHint(self) -> QSize:
        return QSize(self._width, self._height)

    def hitButton(self, pos) -> bool:
        return self.contentsRect().contains(pos)

    # ── Vykreslení ───────────────────────────────────────────────────────

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = self._width
        h = self._height
        m = self._margin
        r = h / 2

        # Pozadí (track)
        track_color = QColor(ACCENT_PRIMARY) if self._position > 0.5 else QColor(BG_HIGHLIGHT)
        # Interpolace barvy
        if 0.0 < self._position <= 0.5:
            ratio = self._position * 2
            off_color = QColor(BG_HIGHLIGHT)
            on_color = QColor(ACCENT_PRIMARY)
            track_color = QColor(
                int(off_color.red() + (on_color.red() - off_color.red()) * ratio),
                int(off_color.green() + (on_color.green() - off_color.green()) * ratio),
                int(off_color.blue() + (on_color.blue() - off_color.blue()) * ratio),
            )
        elif self._position > 0.5:
            ratio = (self._position - 0.5) * 2
            off_color = QColor(ACCENT_PRIMARY)
            on_color = QColor(ACCENT_PRIMARY)
            track_color = on_color

        track_path = QPainterPath()
        track_path.addRoundedRect(QRectF(0, 0, w, h), r, r)
        p.fillPath(track_path, track_color)

        # Palec (thumb)
        thumb_x = m + self._position * (w - 2 * m - 2 * self._thumb_radius)
        thumb_y = m
        thumb_path = QPainterPath()
        thumb_path.addEllipse(
            QRectF(thumb_x, thumb_y, self._thumb_radius * 2, self._thumb_radius * 2)
        )
        p.fillPath(thumb_path, QColor(TEXT_ON_ACCENT))

        p.end()
