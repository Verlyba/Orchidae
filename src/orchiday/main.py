"""
Orchiday — Application entry point.

Launches the Qt application with the dark theme stylesheet.
"""

import sys
import logging

from PySide6.QtWidgets import QApplication
from PySide6.QtCore import Qt

from orchiday.ui.main_window import MainWindow
from orchiday.ui.styles.theme import get_stylesheet
from orchiday.core.constants import APP_DISPLAY_NAME


def setup_logging() -> None:
    """Configure structured logging."""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main() -> None:
    """Application entry point."""
    setup_logging()
    log = logging.getLogger(__name__)
    log.info("Starting %s...", APP_DISPLAY_NAME)

    app = QApplication(sys.argv)
    app.setApplicationName(APP_DISPLAY_NAME)
    app.setOrganizationName("Orchiday")
    app.setApplicationVersion("0.1.0")
    app.setStyleSheet(get_stylesheet())

    window = MainWindow()
    window.show()

    log.info("%s is ready.", APP_DISPLAY_NAME)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
