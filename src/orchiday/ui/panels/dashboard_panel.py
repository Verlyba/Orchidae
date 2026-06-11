"""
Unified Robot Dashboard — purpose-built control center for Orchiday.

Layout: Two horizontal rows of visual blocks.
  Row 1 (HARDWARE):  Robot Config  |  Camera Feeds
  Row 2 (INTELLIGENCE):  AI Orchestrator  |  Skills & Training

Each block has a colored accent header bar and clear visual separation.
No scroll areas, no splitters — purely dynamic layout.
"""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame, QGridLayout, QHBoxLayout, QLabel,
    QVBoxLayout, QWidget,
)

from orchiday.core.project_manager import ProjectManager
from orchiday.ui import (
    BG_DARK, BG_DARKEST, BG_MEDIUM, BG_LIGHT, BORDER,
    ACCENT_PRIMARY, ACCENT_SECONDARY, SUCCESS, INFO, WARNING,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
)
from orchiday.ui.panels.robot_panel import RobotPanel
from orchiday.ui.panels.camera_panel import CameraPanel
from orchiday.ui.panels.skill_panel import SkillPanel
from orchiday.ui.panels.model_panel import ModelPanel


# ── Accent colours per section ──────────────────────────────────────────
_ACCENT_ROBOT = "#a78bfa"     # Purple
_ACCENT_CAMERA = "#06b6d4"    # Cyan
_ACCENT_AI = "#f59e0b"        # Amber
_ACCENT_SKILLS = "#34d399"    # Emerald


class _SectionBlock(QWidget):
    """
    A visual block with:
      - 3px coloured left-border accent
      - Subtle header bar with icon + title
      - Embedded content widget
    """

    def __init__(self, title: str, accent_color: str, icon: str, content: QWidget, parent=None):
        super().__init__(parent)
        self.setObjectName("section_block")

        # Root stylesheet — the left-border accent + rounded card look
        self.setStyleSheet(f"""
            #section_block {{
                background-color: {BG_MEDIUM};
                border: 1px solid {BORDER};
                border-left: 3px solid {accent_color};
                border-radius: 10px;
            }}
        """)

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── Header bar ──────────────────────────────────────────────────
        header = QWidget()
        header.setFixedHeight(36)
        header.setStyleSheet(f"""
            background-color: {BG_LIGHT};
            border-top-left-radius: 10px;
            border-top-right-radius: 10px;
            border-bottom: 1px solid {BORDER};
        """)
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(14, 0, 14, 0)
        h_lay.setSpacing(8)

        icon_lbl = QLabel(icon)
        icon_lbl.setStyleSheet(f"font-size: 14px; color: {accent_color}; background: transparent; border: none;")
        h_lay.addWidget(icon_lbl)

        title_lbl = QLabel(title)
        title_lbl.setStyleSheet(f"""
            font-weight: 700; font-size: 12px; letter-spacing: 1.2px;
            color: {accent_color}; text-transform: uppercase;
            background: transparent; border: none;
        """)
        h_lay.addWidget(title_lbl)
        h_lay.addStretch()

        root.addWidget(header)

        # ── Content ─────────────────────────────────────────────────────
        # Make content transparent so the block card is the visual container
        if not content.objectName():
            content.setObjectName(f"content_{id(content)}")
        content.setStyleSheet(f"#{content.objectName()} {{ background: transparent; border: none; }}")
        root.addWidget(content, stretch=1)


class DashboardPanel(QWidget):
    """
    Two-row dashboard with four purpose-built visual blocks.
    """

    def __init__(self, project_manager: ProjectManager, parent=None):
        super().__init__(parent)
        self._pm = project_manager
        self._setup_ui()

    # ────────────────────────────────────────────────────────────────────
    def _setup_ui(self) -> None:
        self.setStyleSheet(f"background-color: {BG_DARKEST};")

        outer = QVBoxLayout(self)
        outer.setContentsMargins(20, 16, 20, 20)
        outer.setSpacing(12)

        # ── Top bar ─────────────────────────────────────────────────────
        top_bar = QHBoxLayout()
        top_bar.setSpacing(12)

        title = QLabel("Robot Control Center")
        title.setStyleSheet(
            f"font-weight: 800; font-size: 20px; color: {TEXT_PRIMARY}; letter-spacing: 0.5px;"
        )
        top_bar.addWidget(title)

        dot = QLabel("●")
        dot.setStyleSheet(f"color: {SUCCESS}; font-size: 8px; padding-top: 4px;")
        top_bar.addWidget(dot)

        sub = QLabel("Teleoperation & Inference")
        sub.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px; font-weight: 500; padding-top: 2px;")
        top_bar.addWidget(sub)
        top_bar.addStretch()

        outer.addLayout(top_bar)

        # ── Thin separator ──────────────────────────────────────────────
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setFixedHeight(1)
        sep.setStyleSheet(f"background-color: {BORDER}; border: none;")
        outer.addWidget(sep)

        # ── Grid (2 rows × 2 cols) ─────────────────────────────────────
        grid = QGridLayout()
        grid.setSpacing(16)

        # Row 0, Col 0 — Environment Configuration (EnvHub & Hardware)
        self._robot_panel = RobotPanel(self._pm, compact=True, parent=self)
        block_robot = _SectionBlock("Environment", _ACCENT_ROBOT, "🌍", self._robot_panel)
        grid.addWidget(block_robot, 0, 0)

        # Row 0, Col 1 — Camera Feeds
        self._camera_panel = CameraPanel(self._pm, compact=True, parent=self)
        block_camera = _SectionBlock("Camera Feeds", _ACCENT_CAMERA, "📷", self._camera_panel)
        grid.addWidget(block_camera, 0, 1)

        # Row 1, Col 0 — Models
        self._model_panel = ModelPanel(self._pm, compact=True, parent=self)
        block_ai = _SectionBlock("Models", _ACCENT_AI, "🧠", self._model_panel)
        grid.addWidget(block_ai, 1, 0)

        # Row 1, Col 1 — Skills & Training
        self._skill_panel = SkillPanel(self._pm, compact=True, parent=self)
        block_skills = _SectionBlock("Skills & Training", _ACCENT_SKILLS, "🎯", self._skill_panel)
        grid.addWidget(block_skills, 1, 1)

        # Even distribution
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        grid.setRowStretch(0, 1)
        grid.setRowStretch(1, 1)

        outer.addLayout(grid, stretch=1)
