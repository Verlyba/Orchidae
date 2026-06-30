"""UI panels package."""

from orchiday.ui.panels.project_panel import ProjectPanel
from orchiday.ui.panels.robot_panel import RobotPanel
from orchiday.ui.panels.camera_panel import CameraPanel
from orchiday.ui.panels.model_panel import ModelPanel
from orchiday.ui.panels.skill_panel import SkillPanel
from orchiday.ui.panels.orchestration_panel import OrchestrationPanel
from orchiday.ui.panels.console_panel import ConsolePanel
from orchiday.ui.panels.dashboard_panel import DashboardPanel
from orchiday.ui.panels.calibration_panel import CalibrationPanel

__all__ = [
    "ProjectPanel", "RobotPanel", "CameraPanel",
    "ModelPanel", "SkillPanel", "OrchestrationPanel", "ConsolePanel",
    "DashboardPanel", "CalibrationPanel",
]
