"""
`POST /api/settings` must only announce a project change when the project
actually changed.

The endpoint used to emit `project_opened` for every request that reached it,
including one carrying nothing but the UI language. The frontend answers that
event with `onProjectOpened()` — a full project reload, which among other
things resets the selected skill to the first one in the tree and re-runs the
hardware scan.

The visible consequence was on the data-collection tab, and it was not
cosmetic: with the third sub-step selected, the recording panel showed
`local/<task>/<third_step>` as the repo id `lerobot-record` writes into.
Flipping the UI language moved it to `local/<task>` — a different dataset,
with no click anywhere near the recording panel. A take started after that
would have landed in the parent task's dataset, where the sub-task boundary
marks the whole comparison depends on do not belong.

Language is global config: it is stored in `AppConfig`, applies with no project
open at all, and touches nothing inside the project file.
"""

from __future__ import annotations

import pathlib
from contextlib import contextmanager

import pytest


@pytest.fixture
def settings_client(tmp_path, monkeypatch):
    """TestClient with a scratch projects_dir and one project open."""
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    import orchiday.server as server

    monkeypatch.setattr(type(server.pm._config), "projects_dir",
                        property(lambda self: tmp_path), raising=False)
    opened = server.pm.current_project
    try:
        with fastapi_testclient.TestClient(server.app) as client:
            made = client.post("/api/projects", json={
                "name": "Broadcast fixture", "slug": "broadcast_fixture",
                "scene_description": "a bench",
            })
            assert made.status_code == 200, made.text
            path = made.json()["project"]["_path"]
            assert client.post("/api/projects/open", json={"path": path}).status_code == 200
            yield client, server
    finally:
        server.pm.current_project = opened


class _SignalSpy:
    """Stands in for one signal on the bus, recording what is emitted."""

    def __init__(self, real):
        self._real = real
        self.emitted: list = []

    def emit(self, *args):
        self.emitted.append(args[0] if len(args) == 1 else args)

    def __getattr__(self, name):
        return getattr(self._real, name)


class _BusSpy:
    """The event bus with `project_opened` swapped for a spy.

    A spy object rather than a connected slot: `event_bus` is a `QObject`, and
    TestClient runs the endpoint on the portal thread, so a real Qt connection
    made from the test thread is queued and never delivered without an event
    loop — a slot would record nothing and every assertion here would pass
    vacuously. Replacing the module-level `event_bus` sidesteps Qt entirely.
    """

    def __init__(self, real):
        self._real = real
        self.project_opened = _SignalSpy(real.project_opened)

    def __getattr__(self, name):
        return getattr(self._real, name)


@contextmanager
def _broadcasts(server):
    """Capture every `project_opened` the endpoint emits inside the block."""
    spy = _BusSpy(server.event_bus)
    real = server.event_bus
    server.event_bus = spy
    try:
        yield spy.project_opened.emitted
    finally:
        server.event_bus = real


@pytest.mark.parametrize("payload", [
    {"language": "en"},
    {"language": "cs"},
    {"lerobot_dir": "/opt/lerobot"},
    {"python_path": "/usr/bin/python3"},
])
def test_global_preferences_do_not_announce_a_project_change(settings_client, payload):
    client, server = settings_client
    with _broadcasts(server) as seen:
        res = client.post("/api/settings", json=payload)

    assert res.status_code == 200, res.text
    assert res.json()["ok"] is True
    assert seen == [], (
        f"{payload} touches no project field, but the endpoint announced a "
        f"project change — the frontend reloads the project on that event and "
        f"loses the selected skill"
    )


@pytest.mark.parametrize("payload", [
    {"scene_description": "a bench with a cube"},
    {"dataset_storage_dir": "/data/lerobot"},
    {"robot_type": "so101_follower"},
    {"follower_port": "/dev/ttyACM0"},
    {"leader_port": "/dev/ttyACM1"},
    {"sequential_loop_interval": 3},
])
def test_project_fields_still_announce_a_project_change(settings_client, payload):
    client, server = settings_client
    with _broadcasts(server) as seen:
        res = client.post("/api/settings", json=payload)

    assert res.status_code == 200, res.text
    assert len(seen) == 1, (
        f"{payload} changes the open project — the frontend has to be told, "
        f"or it keeps showing the old value"
    )


def test_a_mixed_request_still_announces_the_project_part(settings_client):
    """Language alongside a real project edit must not suppress the broadcast."""
    client, server = settings_client
    with _broadcasts(server) as seen:
        res = client.post("/api/settings", json={
            "language": "en", "scene_description": "a bench with two cubes",
        })

    assert res.status_code == 200, res.text
    assert len(seen) == 1
    assert server.pm.current_project["scene_description"] == "a bench with two cubes"


# ── A partial update must not clear the fields it does not carry ──────────
#
# Every string field on SettingsConfig used to default to "", which the
# endpoint could not tell apart from an explicitly-sent empty value. The
# language toggle posts {"language": ...} alone, so every language switch also
# wrote empty ports and the catalogue's fallback arm type into the project —
# and saved it. The app then refused to record ("Není nakonfigurován sériový
# port Followera") because it genuinely no longer had a port.

_CONFIGURED = {
    "robot_type": "so101_follower",
    "follower_port": "/dev/ttyACM0",
    "leader_port": "/dev/ttyACM1",
    "dataset_storage_dir": "/data/lerobot",
}


@pytest.mark.parametrize("partial", [
    {"language": "en"},
    {"scene_description": "a bench with a cube"},
    {"lerobot_dir": "/opt/lerobot"},
    {"sequential_loop_interval": 2.5},
])
def test_a_partial_update_leaves_the_robot_configuration_alone(settings_client, partial):
    client, server = settings_client
    assert client.post("/api/settings", json=_CONFIGURED).status_code == 200

    assert client.post("/api/settings", json=partial).status_code == 200

    project = server.pm.current_project
    for key, value in _CONFIGURED.items():
        assert project[key] == value, (
            f"{partial} does not carry {key}, but it was overwritten with "
            f"{project[key]!r} — the robot is no longer configured"
        )


def test_the_wipe_also_reached_the_project_file_on_disk(settings_client):
    """Not just the in-memory copy — `save_project()` persisted the damage."""
    import json

    client, server = settings_client
    assert client.post("/api/settings", json=_CONFIGURED).status_code == 200
    path = pathlib.Path(server.pm.current_project["_path"]) / "project.json"

    assert client.post("/api/settings", json={"language": "en"}).status_code == 200

    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["follower_port"] == "/dev/ttyACM0"
    assert on_disk["leader_port"] == "/dev/ttyACM1"
    assert on_disk["robot_type"] == "so101_follower"


def test_an_explicit_empty_string_still_clears_a_port(settings_client):
    """"Not sent" and "sent empty" are different requests — only one clears."""
    client, server = settings_client
    assert client.post("/api/settings", json=_CONFIGURED).status_code == 200

    assert client.post("/api/settings", json={"follower_port": ""}).status_code == 200

    assert server.pm.current_project["follower_port"] == ""
    # …and only that one.
    assert server.pm.current_project["leader_port"] == "/dev/ttyACM1"


def test_the_language_is_still_persisted_globally(settings_client):
    """Not broadcasting must not turn into not saving."""
    client, server = settings_client
    from orchiday.core.config import AppConfig

    assert client.post("/api/settings", json={"language": "en"}).status_code == 200
    assert AppConfig().get("language") == "en"
    assert client.post("/api/settings", json={"language": "cs"}).status_code == 200
    assert AppConfig().get("language") == "cs"
