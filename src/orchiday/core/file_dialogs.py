"""
Native file/folder pickers — one implementation for Linux, Windows and macOS.

The web UI has "Procházet" buttons next to every path field. Those need a real
OS dialog, because the browser cannot hand back an absolute filesystem path
(a ``<input type=file>`` only yields the file *name*), and LeRobot is driven by
absolute paths: the Python interpreter, the cloned repository, the dataset
storage root.

Each platform is tried in the order that gives the most native-looking dialog
and then falls back:

    macOS    osascript (Finder)                     -> tkinter
    Linux    zenity (GTK) -> kdialog (KDE)          -> tkinter
    Windows  tkinter (ships with python.org builds) -> PowerShell WinForms

Everything returns ``""`` when the user cancels or no dialog toolkit exists —
never an exception — so the caller can treat "cancelled" and "unavailable"
the same way: leave the field untouched.

The command builders are separated from the process spawning so they can be
unit-tested on a headless machine, where no dialog can actually open.
"""

from __future__ import annotations

import logging
import platform
import subprocess

log = logging.getLogger(__name__)

# A dialog either picks an existing directory or an existing file.
DIRECTORY = "directory"
FILE = "file"

_DIALOG_TIMEOUT = 120  # seconds; the user may take a while to browse


def _sanitize_title(title: str, fallback: str) -> str:
    """
    Titles reach AppleScript and PowerShell as *source code*, not as argv, so
    quotes and newlines there would break the script (or worse). Keep it to a
    plain single-line label.
    """
    cleaned = " ".join(str(title or "").split())
    cleaned = cleaned.replace('"', "").replace("'", "").replace("\\", "").replace("`", "")
    cleaned = cleaned.replace("$", "")
    return cleaned[:120] or fallback


# ── Per-platform command builders (pure — unit-testable) ──────────────────

def macos_command(kind: str, title: str) -> list[str]:
    """`osascript` invocation returning a POSIX path on stdout."""
    verb = "choose file" if kind == FILE else "choose folder"
    script = f'POSIX path of ({verb} with prompt "{title}")'
    return ["osascript", "-e", script]


def linux_commands(kind: str, title: str) -> list[list[str]]:
    """Ordered list of Linux dialog commands; the first one present wins."""
    zenity = ["zenity", "--file-selection", f"--title={title}"]
    if kind == DIRECTORY:
        zenity.append("--directory")
    kdialog = ["kdialog", "--title", title]
    kdialog += ["--getexistingdirectory", "."] if kind == DIRECTORY else ["--getopenfilename", "."]
    return [zenity, kdialog]


def windows_command(kind: str, title: str) -> list[str]:
    """PowerShell + WinForms fallback for when tkinter is unavailable."""
    if kind == DIRECTORY:
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
            f"$d.Description = '{title}'; "
            "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"
        )
    else:
        script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$d = New-Object System.Windows.Forms.OpenFileDialog; "
            f"$d.Title = '{title}'; "
            "if ($d.ShowDialog() -eq 'OK') { $d.FileName }"
        )
    return ["powershell", "-NoProfile", "-Command", script]


# ── Runners ───────────────────────────────────────────────────────────────

def _run(cmd: list[str]) -> str:
    """Run a dialog command; "" on cancel, missing binary or any failure."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=_DIALOG_TIMEOUT)
    except FileNotFoundError:
        return ""            # dialog tool not installed — try the next one
    except Exception as e:   # noqa: BLE001 — a dialog must never crash the request
        log.debug("Dialog command %s failed: %s", cmd[0], e)
        return ""
    if proc.returncode != 0:
        return ""            # non-zero is how every one of them reports "cancelled"
    return proc.stdout.strip()


def _tk_pick(kind: str, title: str) -> str:
    """Last-resort dialog via tkinter (bundled with most CPython builds)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as e:  # noqa: BLE001 — headless / no Tk build
        log.debug("tkinter unavailable for file dialog: %s", e)
        return ""
    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        if kind == DIRECTORY:
            picked = filedialog.askdirectory(title=title)
        else:
            picked = filedialog.askopenfilename(title=title)
        return (picked or "").strip()
    except Exception as e:  # noqa: BLE001 — no display, broken Tk, …
        log.debug("tkinter dialog failed: %s", e)
        return ""
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass


def pick_path(kind: str, title: str = "", system: str | None = None) -> str:
    """
    Open a native picker and return the chosen absolute path.

    Returns "" for cancel and for "this machine has no usable dialog" alike —
    the UI reports both as "nothing selected" and keeps the previous value.
    """
    if kind not in (FILE, DIRECTORY):
        raise ValueError(f"kind must be {FILE!r} or {DIRECTORY!r}, got {kind!r}")

    default = "Select a file" if kind == FILE else "Select a folder"
    title = _sanitize_title(title, default)
    system = (system or platform.system()).lower()

    if "darwin" in system:
        picked = _run(macos_command(kind, title))
    elif "windows" in system or system == "nt":
        # tkinter first on Windows: it renders the modern Explorer dialog,
        # while the PowerShell FolderBrowserDialog is the old tree widget.
        picked = _tk_pick(kind, title)
        if picked:
            return picked
        picked = _run(windows_command(kind, title))
    else:
        picked = ""
        for cmd in linux_commands(kind, title):
            picked = _run(cmd)
            if picked:
                break

    if picked:
        return picked
    return _tk_pick(kind, title)
