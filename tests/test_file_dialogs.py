"""
Tests for the cross-platform native file/folder pickers.

No dialog can actually be opened on a headless machine, so what is checked
here is everything that decides *which* dialog gets opened and with what
arguments — the part that silently breaks when someone adds a platform branch:

- the file and directory variants really are different commands (a folder
  picker offered for the Python interpreter path was the original bug),
- every platform has a path through the code (Linux, Windows, macOS),
- cancelling and "no dialog toolkit installed" both yield "" instead of raising,
- the caption is sanitized, because it lands inside AppleScript / PowerShell
  source rather than in argv.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.core import file_dialogs as fd


# ── Command builders ──────────────────────────────────────────────────────

def test_macos_file_and_folder_use_different_verbs():
    assert "choose file" in fd.macos_command(fd.FILE, "T")[-1]
    assert "choose folder" in fd.macos_command(fd.DIRECTORY, "T")[-1]


def test_linux_directory_adds_directory_flag_file_does_not():
    zenity_dir, kdialog_dir = fd.linux_commands(fd.DIRECTORY, "T")
    zenity_file, kdialog_file = fd.linux_commands(fd.FILE, "T")
    assert "--directory" in zenity_dir
    assert "--directory" not in zenity_file
    assert "--getexistingdirectory" in kdialog_dir
    assert "--getopenfilename" in kdialog_file
    # zenity first (GTK is present on far more desktops), kdialog as fallback
    assert zenity_dir[0] == "zenity" and kdialog_dir[0] == "kdialog"


def test_windows_uses_matching_winforms_dialog():
    assert "FolderBrowserDialog" in fd.windows_command(fd.DIRECTORY, "T")[-1]
    assert "OpenFileDialog" in fd.windows_command(fd.FILE, "T")[-1]
    assert fd.windows_command(fd.FILE, "T")[0] == "powershell"


def test_title_reaches_every_platform_command():
    title = "Vyberte spustac"
    assert title in fd.macos_command(fd.FILE, title)[-1]
    assert any(title in " ".join(cmd) for cmd in fd.linux_commands(fd.FILE, title))
    assert title in fd.windows_command(fd.FILE, title)[-1]


@pytest.mark.parametrize(
    "raw",
    ['a"b', "a'b", "a\\b", "a`b", "a$b", "line1\nline2"],
)
def test_title_sanitizer_strips_script_breaking_characters(raw):
    cleaned = fd._sanitize_title(raw, "fallback")
    for ch in '"\'\\`$\n':
        assert ch not in cleaned


def test_title_sanitizer_falls_back_when_empty():
    assert fd._sanitize_title("", "fallback") == "fallback"
    assert fd._sanitize_title("   ", "fallback") == "fallback"
    assert fd._sanitize_title(None, "fallback") == "fallback"


def test_title_is_length_capped():
    assert len(fd._sanitize_title("x" * 500, "fallback")) <= 120


# ── pick_path dispatch ────────────────────────────────────────────────────

def test_unknown_kind_is_a_programming_error():
    with pytest.raises(ValueError):
        fd.pick_path("socket", "T")


def _record(monkeypatch, run_result=""):
    """Capture the commands pick_path would run, without running them."""
    seen: list[list[str]] = []

    def fake_run(cmd):
        seen.append(cmd)
        return run_result

    monkeypatch.setattr(fd, "_run", fake_run)
    monkeypatch.setattr(fd, "_tk_pick", lambda kind, title: "")
    return seen


def test_linux_tries_zenity_then_kdialog(monkeypatch):
    seen = _record(monkeypatch)
    assert fd.pick_path(fd.FILE, "T", system="Linux") == ""
    assert [c[0] for c in seen] == ["zenity", "kdialog"]


def test_linux_stops_at_first_dialog_that_answers(monkeypatch):
    seen = _record(monkeypatch, run_result="/home/u/bin/python")
    assert fd.pick_path(fd.FILE, "T", system="Linux") == "/home/u/bin/python"
    assert [c[0] for c in seen] == ["zenity"]


def test_macos_uses_osascript(monkeypatch):
    seen = _record(monkeypatch, run_result="/usr/bin/python3")
    assert fd.pick_path(fd.DIRECTORY, "T", system="Darwin") == "/usr/bin/python3"
    assert seen[0][0] == "osascript"


def test_windows_prefers_tkinter_over_powershell(monkeypatch):
    seen = _record(monkeypatch)
    monkeypatch.setattr(fd, "_tk_pick", lambda kind, title: r"C:\Python311\python.exe")
    assert fd.pick_path(fd.FILE, "T", system="Windows") == r"C:\Python311\python.exe"
    assert seen == []  # PowerShell never spawned when tkinter answered


def test_windows_falls_back_to_powershell(monkeypatch):
    seen = _record(monkeypatch)
    assert fd.pick_path(fd.FILE, "T", system="Windows") == ""
    assert [c[0] for c in seen] == ["powershell"]


def test_cancel_returns_empty_string_not_none(monkeypatch):
    _record(monkeypatch)
    for system in ("Linux", "Darwin", "Windows"):
        assert fd.pick_path(fd.DIRECTORY, "T", system=system) == ""


def test_tkinter_is_the_last_resort_on_every_platform(monkeypatch):
    monkeypatch.setattr(fd, "_run", lambda cmd: "")
    monkeypatch.setattr(fd, "_tk_pick", lambda kind, title: "/picked/by/tk")
    for system in ("Linux", "Darwin", "Windows"):
        assert fd.pick_path(fd.FILE, "T", system=system) == "/picked/by/tk"


# ── _run robustness ───────────────────────────────────────────────────────

def test_run_returns_empty_when_binary_is_missing():
    # zenity/kdialog are simply absent on most machines — that must not raise.
    assert fd._run(["definitely-not-a-real-dialog-binary-xyz"]) == ""


def test_run_returns_empty_on_nonzero_exit():
    # Every dialog reports "user cancelled" with a non-zero exit code.
    assert fd._run([sys.executable, "-c", "import sys; print('/some/path'); sys.exit(1)"]) == ""


def test_run_strips_trailing_newline():
    assert fd._run([sys.executable, "-c", "print('/home/user/lerobot')"]) == "/home/user/lerobot"


def test_tk_pick_never_raises_without_a_display(monkeypatch):
    monkeypatch.setenv("DISPLAY", "")
    assert isinstance(fd._tk_pick(fd.FILE, "T"), str)
