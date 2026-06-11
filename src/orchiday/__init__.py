"""
Orchiday — Cross-platform no-code platform for hierarchical robot control.

Modular architecture:
    core/          — Core logic, no GUI dependencies
    hardware/      — Hardware abstraction (cameras, robots, safety)
    ai/            — AI/ML layer (LM Studio, LeRobot)
    orchestration/ — Orchestration engine (state machine)
    data/          — Data layer (datasets, labeling)
    ui/            — GUI layer (PySide6)
"""

__version__ = "0.1.0"
__app_name__ = "Orchiday"
