"""
Tests for the runtime dependency set a fresh clone gets from `pip install .`.

These exist because of one failure mode in particular: Orchiday's entire live
channel is a single WebSocket at /ws. Uvicorn ships no WebSocket implementation
of its own (bare `uvicorn` requires only click and h11), so without
`websockets` or `wsproto` installed the server answers the upgrade request with
404 and logs "No supported WebSocket library detected". The page still loads
and every REST call still works, so nothing looks broken — but the console dock
stays empty, process start/stop never registers, and recording, calibration and
step-mark events never reach the UI. Silent, and invisible to every other check
in scripts/verify.sh, which never starts the server.
"""

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))


def _declared_dependencies() -> list[str]:
    """Runtime dependencies as declared in pyproject.toml.

    Parsed with a regex rather than tomllib so the test says the same thing on
    Python 3.10 (tomllib landed in 3.11 and the project supports >=3.10).
    """
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    block = re.search(r"^dependencies\s*=\s*\[(.*?)^\]", text, re.S | re.M)
    assert block, "pyproject.toml has no [project].dependencies list"
    # Comments inside the list may quote error messages; only the code counts.
    body = re.sub(r"#[^\n]*", "", block.group(1))
    return re.findall(r'"([^"]+)"', body)


def _requirement_names(specs: list[str]) -> set[str]:
    """Strip version specifiers and extras: 'uvicorn[standard]>=0.27' -> 'uvicorn'."""
    return {re.split(r"[<>=!~\[;\s]", s, 1)[0].strip().lower() for s in specs}


# ── The WebSocket implementation must be declared, not just happen to be there ──

def test_websocket_implementation_is_declared():
    """A fresh clone must get a WebSocket library from `pip install .` alone."""
    names = _requirement_names(_declared_dependencies())
    has_explicit = bool(names & {"websockets", "wsproto"})
    # `uvicorn[standard]` pulls websockets in as an extra, which is equally fine.
    has_extra = any(
        s.lower().startswith("uvicorn[") and "standard" in s.lower()
        for s in _declared_dependencies()
    )
    assert has_explicit or has_extra, (
        "No WebSocket implementation is declared. Uvicorn has none built in, so "
        "/ws would answer 404 and every live event in the UI would be lost. "
        "Add 'websockets' (or use the uvicorn[standard] extra)."
    )


def test_websocket_implementation_is_importable():
    """And it must actually be installed in the environment running the server."""
    try:
        import websockets  # noqa: F401
    except ImportError:
        try:
            import wsproto  # noqa: F401
        except ImportError:
            pytest.fail(
                "Neither 'websockets' nor 'wsproto' is installed — uvicorn would "
                "reject the /ws upgrade with 404 and the UI would show no live "
                "events at all. Run scripts/setup-dev.sh."
            )


# ── The dependency list must stay installable and complete ─────────────────

def test_every_declared_dependency_is_importable():
    """Catches a dependency that is declared but never actually installed."""
    module_for = {
        "fastapi": "fastapi",
        "uvicorn": "uvicorn",
        "pydantic": "pydantic",
        "httpx": "httpx",
        "pyside6": "PySide6",
        "opencv-python": "cv2",
        "numpy": "numpy",
        "pyserial": "serial",
        "certifi": "certifi",
        "python-multipart": "multipart",
        "websockets": "websockets",
        "wsproto": "wsproto",
    }
    missing = []
    for name in _requirement_names(_declared_dependencies()):
        module = module_for.get(name)
        assert module, f"unknown dependency {name!r} — add it to module_for in this test"
        try:
            __import__(module)
        except ImportError:
            missing.append(f"{name} (import {module})")
    assert not missing, f"declared but not importable: {missing}"


# ── The bridge that pushes events into the socket must be wired on startup ──

def test_event_bridge_is_wired_by_the_asgi_lifespan():
    """Connecting the socket is not enough — something must broadcast into it.

    `web_bridge.connect_event_bus()` used to live in `main()` only, so any entry
    point that starts the ASGI app directly (`uvicorn orchiday.server:app`, the
    packaged runner) came up with a socket that accepted clients and answered
    pings but never pushed a single event. Exactly once per process is what is
    required: zero means a dead console and frozen button states, twice means
    every log line and progress event arrives duplicated.
    """
    fastapi_testclient = pytest.importorskip("fastapi.testclient")

    import orchiday.server as server
    from orchiday.web_events import web_bridge

    calls: list[int] = []
    original = web_bridge.connect_event_bus
    web_bridge.connect_event_bus = lambda: calls.append(1)  # type: ignore[method-assign]
    try:
        with fastapi_testclient.TestClient(server.app):
            pass
    finally:
        web_bridge.connect_event_bus = original  # type: ignore[method-assign]

    assert calls == [1], (
        f"lifespan called connect_event_bus() {len(calls)} time(s), expected exactly 1"
    )


def test_server_declares_the_websocket_route_the_frontend_connects_to():
    """The frontend connects to `/ws`; the server must expose exactly that path."""
    server_src = (ROOT / "src" / "orchiday" / "server.py").read_text(encoding="utf-8")
    assert '@app.websocket("/ws")' in server_src

    # The logic layer moved to frontend/src/legacy/app.ts in the React port.
    app_ts = (ROOT / "frontend" / "src" / "legacy" / "app.ts").read_text(encoding="utf-8")
    assert re.search(r"new WebSocket\(`\$\{proto\}://\$\{host\}/ws`\)", app_ts), (
        "app.ts no longer connects to /ws — keep this test and the server route in sync"
    )


# ── "No project open" is a state, not an error ──

def test_current_project_endpoint_answers_200_with_no_project_open():
    """`GET /api/project` must not 404 just because nothing is open yet.

    The frontend asks for the current project on every load, before the user has
    opened one. Answering 404 made the browser log a console error on every
    fresh start of the app — permanent noise that hides the errors that matter
    (this is how the missing `</div>` and the dead `/ws` went unnoticed for
    several releases). All three callers test for `project` being truthy, so a
    null answer carries the same information without the error.
    """
    fastapi_testclient = pytest.importorskip("fastapi.testclient")

    import orchiday.server as server

    opened = server.pm.current_project
    server.pm.current_project = None
    try:
        with fastapi_testclient.TestClient(server.app) as client:
            res = client.get("/api/project")
    finally:
        server.pm.current_project = opened

    assert res.status_code == 200, (
        f"GET /api/project answered {res.status_code} with no project open; "
        "the frontend logs that as a console error on every load"
    )
    assert res.json().get("project") is None
