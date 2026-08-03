"""
Tests for `OrchidayController._test_lm_connection()` — the background thread
that pings the LLM/VLM endpoints after a project opens (or its model config
changes) and reports the result via `event_bus`.

`scripts/verify.sh` intermittently printed an uncaught "Exception in thread
... RuntimeError: Signal source has been deleted" from this exact thread —
by the time the (real, possibly slow) HTTP probe resolves, the Qt object
graph it reports to can already be gone (project closed, test/process
tearing down), and the old code's own `except Exception` handler re-emitted
on the same dead signal, so the *handler* raised too. These tests reproduce
that failure deterministically (no timing race) by making `event_bus.emit()`
raise `RuntimeError` outright, and assert the thread body survives it.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.core.controller import OrchidayController
from orchiday.core.events import event_bus


class _FakePM:
    def __init__(self):
        self.current_project = None
        self.current_path = None


class _FakeClient:
    """Stands in for `LMStudioClient`: a scripted `test_connection()`."""

    def __init__(self, ok: bool = False, message: str = "connection refused", raises: Exception | None = None):
        self.base_url = "http://localhost:1234/v1"
        self._ok = ok
        self._message = message
        self._raises = raises

    async def test_connection(self):
        if self._raises is not None:
            raise self._raises
        return self._ok, self._message


def _make_controller(llm_client=None, vlm_client=None) -> OrchidayController:
    ctrl = OrchidayController.__new__(OrchidayController)  # skip heavy __init__
    ctrl.pm = _FakePM()
    ctrl.llm_client = llm_client
    ctrl.vlm_client = vlm_client
    return ctrl


class _DeadSignal:
    """A signal whose emitter has been torn down: exactly the shape of the
    real `RuntimeError` PySide raises for a deleted `QObject`."""

    def emit(self, *args):
        raise RuntimeError("Signal source has been deleted")


def test_survives_deleted_signal_on_failed_connection(monkeypatch):
    """The common case: both probes fail, and the signal that would report
    that is already gone. Must not raise out of the thread body."""
    monkeypatch.setattr(event_bus, "model_connection_fail", _DeadSignal())
    monkeypatch.setattr(event_bus, "model_connection_ok", _DeadSignal())
    monkeypatch.setattr(event_bus, "log_message", _DeadSignal())

    ctrl = _make_controller(
        llm_client=_FakeClient(ok=False, message="connection refused"),
        vlm_client=_FakeClient(ok=False, message="connection refused"),
    )

    ctrl._test_lm_connection()  # must not raise


def test_survives_deleted_signal_on_successful_connection(monkeypatch):
    """Same, but down the `ok` branch (`model_connection_ok`/`log_message`)."""
    monkeypatch.setattr(event_bus, "model_connection_fail", _DeadSignal())
    monkeypatch.setattr(event_bus, "model_connection_ok", _DeadSignal())
    monkeypatch.setattr(event_bus, "log_message", _DeadSignal())

    ctrl = _make_controller(
        llm_client=_FakeClient(ok=True),
        vlm_client=_FakeClient(ok=True),
    )

    ctrl._test_lm_connection()  # must not raise


def test_survives_deleted_signal_when_probe_itself_raises(monkeypatch):
    """The outer `except Exception` fallback path — the one whose own
    re-emit used to be what actually escaped the thread uncaught."""
    monkeypatch.setattr(event_bus, "model_connection_fail", _DeadSignal())
    monkeypatch.setattr(event_bus, "model_connection_ok", _DeadSignal())
    monkeypatch.setattr(event_bus, "log_message", _DeadSignal())

    ctrl = _make_controller(
        llm_client=_FakeClient(raises=ConnectionError("boom")),
        vlm_client=None,
    )

    ctrl._test_lm_connection()  # must not raise


def test_still_reports_real_results_when_signal_is_alive(monkeypatch):
    """The guard must not swallow legitimate emissions — only a genuinely
    dead signal source. With a live `event_bus`, results still get through."""
    received: list[tuple] = []
    monkeypatch.setattr(event_bus, "model_connection_fail", type("S", (), {"emit": lambda self, *a: received.append(("fail", *a))})())
    monkeypatch.setattr(event_bus, "model_connection_ok", type("S", (), {"emit": lambda self, *a: received.append(("ok", *a))})())
    monkeypatch.setattr(event_bus, "log_message", type("S", (), {"emit": lambda self, *a: received.append(("log", *a))})())

    ctrl = _make_controller(
        llm_client=_FakeClient(ok=False, message="connection refused"),
        vlm_client=_FakeClient(ok=True),
    )

    ctrl._test_lm_connection()

    assert ("fail", "llm_ceo", "connection refused") in received
    assert ("ok", "vlm_inspector") in received
