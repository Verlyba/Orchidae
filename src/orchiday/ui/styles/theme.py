"""
Orchiday dark theme — Qt stylesheet and helper functions.
"""

from orchiday.ui import (
    BG_DARKEST, BG_DARK, BG_MEDIUM, BG_LIGHT, BG_HIGHLIGHT,
    ACCENT_PRIMARY, ACCENT_SECONDARY, ACCENT_HOVER,
    SUCCESS, WARNING, ERROR, INFO,
    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, TEXT_ON_ACCENT,
    BORDER, BORDER_LIGHT,
    BORDER_RADIUS, BORDER_RADIUS_SM, BORDER_RADIUS_LG,
    SPACING_SM, SPACING_MD, SPACING_LG,
    FONT_FAMILY, FONT_MONO,
    FONT_SIZE_SM, FONT_SIZE_MD, FONT_SIZE_LG, FONT_SIZE_XL, FONT_SIZE_XXL,
)


def get_stylesheet() -> str:
    """Return the complete Qt stylesheet for the dark theme."""
    return f"""
    /* ══════════════════════════════════════════════════════════════════
       GLOBAL SETTINGS
       ══════════════════════════════════════════════════════════════════ */

    * {{
        font-family: {FONT_FAMILY};
        font-size: {FONT_SIZE_MD};
        color: {TEXT_PRIMARY};
    }}

    QMainWindow {{
        background-color: {BG_DARK};
    }}

    QWidget {{
        background-color: transparent;
    }}

    /* ══════════════════════════════════════════════════════════════════
       SCROLLBARS
       ══════════════════════════════════════════════════════════════════ */

    QScrollBar:vertical {{
        background: {BG_DARK};
        width: 8px;
        margin: 0;
        border-radius: 4px;
    }}

    QScrollBar::handle:vertical {{
        background: {BG_HIGHLIGHT};
        min-height: 30px;
        border-radius: 4px;
    }}

    QScrollBar::handle:vertical:hover {{
        background: {BORDER_LIGHT};
    }}

    QScrollBar::add-line:vertical,
    QScrollBar::sub-line:vertical {{
        height: 0;
    }}

    QScrollBar:horizontal {{
        background: {BG_DARK};
        height: 8px;
        margin: 0;
        border-radius: 4px;
    }}

    QScrollBar::handle:horizontal {{
        background: {BG_HIGHLIGHT};
        min-width: 30px;
        border-radius: 4px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       SIDEBAR
       ══════════════════════════════════════════════════════════════════ */

    #sidebar {{
        background-color: {BG_DARKEST};
        border-right: 1px solid {BORDER};
    }}

    #sidebar QPushButton {{
        background-color: transparent;
        border: none;
        border-radius: {BORDER_RADIUS};
        padding: 12px 16px;
        text-align: left;
        color: {TEXT_SECONDARY};
        font-size: {FONT_SIZE_MD};
    }}

    #sidebar QPushButton:hover {{
        background-color: {BG_LIGHT};
        color: {TEXT_PRIMARY};
    }}

    #sidebar QPushButton:checked,
    #sidebar QPushButton[active="true"] {{
        background-color: {BG_MEDIUM};
        color: {ACCENT_PRIMARY};
        border-left: 3px solid {ACCENT_PRIMARY};
    }}

    #sidebar_logo {{
        font-size: {FONT_SIZE_XL};
        font-weight: bold;
        color: {ACCENT_PRIMARY};
        padding: 20px 16px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       PANELY / KARTY
       ══════════════════════════════════════════════════════════════════ */

    #content_area {{
        background-color: {BG_DARK};
    }}

    .card {{
        background-color: {BG_MEDIUM};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS_LG};
        padding: {SPACING_LG};
    }}

    .card:hover {{
        border-color: {BORDER_LIGHT};
    }}

    .card_header {{
        font-size: {FONT_SIZE_LG};
        font-weight: 600;
        color: {TEXT_PRIMARY};
        padding-bottom: {SPACING_SM};
    }}

    .card_subtitle {{
        font-size: {FONT_SIZE_SM};
        color: {TEXT_SECONDARY};
    }}

    /* ══════════════════════════════════════════════════════════════════
       TLAČÍTKA
       ══════════════════════════════════════════════════════════════════ */

    QPushButton {{
        background-color: {BG_LIGHT};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS};
        padding: 8px 20px;
        color: {TEXT_PRIMARY};
        font-weight: 500;
    }}

    QPushButton:hover {{
        background-color: {BG_HIGHLIGHT};
        border-color: {BORDER_LIGHT};
    }}

    QPushButton:pressed {{
        background-color: {BG_MEDIUM};
    }}

    QPushButton:disabled {{
        background-color: {BG_MEDIUM};
        color: {TEXT_MUTED};
        border-color: {BORDER};
    }}

    QPushButton#primary_button {{
        background-color: {ACCENT_PRIMARY};
        color: {TEXT_ON_ACCENT};
        border: none;
        font-weight: 600;
    }}

    QPushButton#primary_button:hover {{
        background-color: {ACCENT_HOVER};
    }}

    QPushButton#primary_button:pressed {{
        background-color: {ACCENT_SECONDARY};
    }}

    QPushButton#danger_button {{
        background-color: transparent;
        color: {ERROR};
        border: 1px solid {ERROR};
    }}

    QPushButton#danger_button:hover {{
        background-color: {ERROR};
        color: {TEXT_ON_ACCENT};
    }}

    QPushButton#success_button {{
        background-color: {SUCCESS};
        color: {BG_DARKEST};
        border: none;
        font-weight: 600;
    }}

    /* ══════════════════════════════════════════════════════════════════
       VSTUPY
       ══════════════════════════════════════════════════════════════════ */

    QLineEdit, QTextEdit, QPlainTextEdit {{
        background-color: {BG_LIGHT};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS_SM};
        padding: 8px 12px;
        color: {TEXT_PRIMARY};
        selection-background-color: {ACCENT_SECONDARY};
    }}

    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus {{
        border-color: {ACCENT_PRIMARY};
    }}

    QLineEdit::placeholder {{
        color: {TEXT_MUTED};
    }}

    /* ══════════════════════════════════════════════════════════════════
       DROPDOWN / COMBOBOX
       ══════════════════════════════════════════════════════════════════ */

    QComboBox {{
        background-color: {BG_LIGHT};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS_SM};
        padding: 8px 12px;
        color: {TEXT_PRIMARY};
        min-width: 120px;
    }}

    QComboBox:hover {{
        border-color: {BORDER_LIGHT};
    }}

    QComboBox::drop-down {{
        border: none;
        width: 24px;
    }}

    QComboBox QAbstractItemView {{
        background-color: {BG_MEDIUM};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS_SM};
        selection-background-color: {ACCENT_SECONDARY};
        color: {TEXT_PRIMARY};
        padding: 4px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       SLIDER
       ══════════════════════════════════════════════════════════════════ */

    QSlider::groove:horizontal {{
        background: {BG_HIGHLIGHT};
        height: 6px;
        border-radius: 3px;
    }}

    QSlider::handle:horizontal {{
        background: {ACCENT_PRIMARY};
        width: 16px;
        height: 16px;
        margin: -5px 0;
        border-radius: 8px;
    }}

    QSlider::handle:horizontal:hover {{
        background: {ACCENT_HOVER};
    }}

    QSlider::sub-page:horizontal {{
        background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
            stop:0 {ACCENT_PRIMARY}, stop:1 {ACCENT_HOVER});
        border-radius: 3px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       PROGRESS BAR
       ══════════════════════════════════════════════════════════════════ */

    QProgressBar {{
        background-color: {BG_HIGHLIGHT};
        border: none;
        border-radius: 4px;
        height: 8px;
        text-align: center;
    }}

    QProgressBar::chunk {{
        background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
            stop:0 {ACCENT_PRIMARY}, stop:1 {ACCENT_HOVER});
        border-radius: 4px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       LABELS
       ══════════════════════════════════════════════════════════════════ */

    QLabel {{
        background: transparent;
    }}

    QLabel#section_title {{
        font-size: {FONT_SIZE_XXL};
        font-weight: 700;
        color: {TEXT_PRIMARY};
        padding-bottom: {SPACING_SM};
    }}

    QLabel#section_subtitle {{
        font-size: {FONT_SIZE_MD};
        color: {TEXT_SECONDARY};
    }}

    /* ══════════════════════════════════════════════════════════════════
       GROUP BOX
       ══════════════════════════════════════════════════════════════════ */

    QGroupBox {{
        background-color: {BG_MEDIUM};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS_LG};
        padding: {SPACING_LG};
        padding-top: 32px;
        margin-top: 8px;
        font-weight: 600;
    }}

    QGroupBox::title {{
        subcontrol-origin: margin;
        subcontrol-position: top left;
        padding: 4px 12px;
        color: {TEXT_SECONDARY};
    }}

    /* ══════════════════════════════════════════════════════════════════
       TAB WIDGET
       ══════════════════════════════════════════════════════════════════ */

    QTabWidget::pane {{
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS};
        background-color: {BG_MEDIUM};
    }}

    QTabBar::tab {{
        background-color: {BG_LIGHT};
        border: 1px solid {BORDER};
        border-bottom: none;
        padding: 8px 20px;
        margin-right: 2px;
        border-top-left-radius: {BORDER_RADIUS_SM};
        border-top-right-radius: {BORDER_RADIUS_SM};
        color: {TEXT_SECONDARY};
    }}

    QTabBar::tab:selected {{
        background-color: {BG_MEDIUM};
        color: {ACCENT_PRIMARY};
        border-bottom: 2px solid {ACCENT_PRIMARY};
    }}

    QTabBar::tab:hover:!selected {{
        color: {TEXT_PRIMARY};
    }}

    /* ══════════════════════════════════════════════════════════════════
       TOOLTIP
       ══════════════════════════════════════════════════════════════════ */

    QToolTip {{
        background-color: {BG_HIGHLIGHT};
        border: 1px solid {BORDER_LIGHT};
        border-radius: {BORDER_RADIUS_SM};
        padding: 6px 10px;
        color: {TEXT_PRIMARY};
        font-size: {FONT_SIZE_SM};
    }}

    /* ══════════════════════════════════════════════════════════════════
       KONZOLE
       ══════════════════════════════════════════════════════════════════ */

    #console {{
        background-color: {BG_DARKEST};
        font-family: {FONT_MONO};
        font-size: {FONT_SIZE_SM};
        color: {TEXT_SECONDARY};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS};
        padding: {SPACING_SM};
    }}

    /* ══════════════════════════════════════════════════════════════════
       SPLITTER
       ══════════════════════════════════════════════════════════════════ */

    QSplitter::handle {{
        background-color: {BORDER};
    }}

    QSplitter::handle:horizontal {{
        width: 1px;
    }}

    QSplitter::handle:vertical {{
        height: 1px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       MENU
       ══════════════════════════════════════════════════════════════════ */

    QMenuBar {{
        background-color: {BG_DARKEST};
        border-bottom: 1px solid {BORDER};
        padding: 2px;
    }}

    QMenuBar::item {{
        background: transparent;
        padding: 6px 12px;
        border-radius: {BORDER_RADIUS_SM};
        color: {TEXT_SECONDARY};
    }}

    QMenuBar::item:selected {{
        background-color: {BG_LIGHT};
        color: {TEXT_PRIMARY};
    }}

    QMenu {{
        background-color: {BG_MEDIUM};
        border: 1px solid {BORDER};
        border-radius: {BORDER_RADIUS};
        padding: 4px;
    }}

    QMenu::item {{
        padding: 8px 32px 8px 16px;
        border-radius: {BORDER_RADIUS_SM};
        color: {TEXT_PRIMARY};
    }}

    QMenu::item:selected {{
        background-color: {ACCENT_SECONDARY};
        color: {TEXT_ON_ACCENT};
    }}

    QMenu::separator {{
        height: 1px;
        background: {BORDER};
        margin: 4px 8px;
    }}

    /* ══════════════════════════════════════════════════════════════════
       STATUS BAR
       ══════════════════════════════════════════════════════════════════ */

    QStatusBar {{
        background-color: {BG_DARKEST};
        border-top: 1px solid {BORDER};
        color: {TEXT_SECONDARY};
        font-size: {FONT_SIZE_SM};
    }}

    QStatusBar::item {{
        border: none;
    }}
    """
