"""
Tests for sub-task boundary marking during recording.

Two halves, matching the two sides of the protocol:

1. The record wrapper (_RECORD_WRAPPER_SRC) runs inside the user's LeRobot
   environment, so it is executed here against stub `lerobot` modules. What it
   must get right is the mark TIME BASE: LeRobot stores a frame's `timestamp`
   as frame_index / fps (LeRobotDataset.add_frame in
   lerobot/datasets/lerobot_dataset.py), so a mark is only
   comparable with the dataset — and therefore only usable by the splitter — if
   it is derived from the frames written so far, not from a wall clock. It also
   owns the episode lifecycle, because a re-recorded episode reuses its index
   and LeRobot's prose logging cannot distinguish the two takes.

2. LeRobotBridge consumes those protocol lines and maintains the marks sidecar.
"""

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from PySide6.QtCore import QCoreApplication

if QCoreApplication.instance() is None:
    _app = QCoreApplication([])

from orchiday.ai.lerobot_bridge import LeRobotBridge
from orchiday.core.events import event_bus


# ── Wrapper harness ──────────────────────────────────────────────────────────

class _FakeDataset:
    """Minimal stand-in for LeRobotDataset's recording surface."""

    def __init__(self, fps=30, num_episodes=0):
        self.fps = fps
        self.num_episodes = num_episodes
        self.frames = 0

    def add_frame(self, frame):
        self.frames += 1


@pytest.fixture()
def wrapper(tmp_path, monkeypatch):
    """Execute the wrapper source with `lerobot` stubbed out.

    Returns its module namespace plus helpers for driving it.
    """
    calls: list = []

    record_mod = types.ModuleType("lerobot.scripts.lerobot_record")

    def record_loop(**kwargs):
        calls.append(kwargs)
        # Simulate the frames a real record_loop would write
        dataset = kwargs.get("dataset")
        for _ in range(kwargs.get("_frames", 0)):
            dataset.add_frame({})

    record_mod.record_loop = record_loop
    record_mod.init_keyboard_listener = lambda: (None, {})
    record_mod.main = lambda: None

    lerobot = types.ModuleType("lerobot")
    scripts = types.ModuleType("lerobot.scripts")
    monkeypatch.setitem(sys.modules, "lerobot", lerobot)
    monkeypatch.setitem(sys.modules, "lerobot.scripts", scripts)
    monkeypatch.setitem(sys.modules, "lerobot.scripts.lerobot_record", record_mod)

    ctl_dir = tmp_path / "ctl"
    ctl_dir.mkdir()
    monkeypatch.setenv("ORCHIDAY_RECORD_CONTROL_DIR", str(ctl_dir))

    ns: dict = {"__name__": "orchiday_record_wrapper"}
    exec(compile(LeRobotBridge._RECORD_WRAPPER_SRC, "wrapper", "exec"), ns)

    ns["_calls"] = calls
    ns["_ctl_dir"] = ctl_dir
    ns["_record_mod"] = record_mod
    return ns


def _emitted(capsys) -> list[dict]:
    """Protocol events printed since the last read."""
    out = capsys.readouterr().out
    return [json.loads(line[len("[ORCHIDAY_REC]"):])
            for line in out.splitlines() if line.startswith("[ORCHIDAY_REC]")]


def _drop(ctl_dir: Path, name: str, payload: str = "1") -> None:
    (ctl_dir / name).write_text(payload, encoding="utf-8")


# ── Wrapper: mark timing ─────────────────────────────────────────────────────

def test_mark_time_is_derived_from_written_frames(wrapper, capsys):
    """t must equal frames/fps — the dataset's own timestamp formula."""
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()  # drive poll_once() manually, no background thread
    dataset = _FakeDataset(fps=30)

    # Start an episode and write 45 frames (1.5 s at 30 fps)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=45)
    # record_loop returned, so re-enter it the way a mark mid-episode looks:
    # begin the episode, feed frames, then mark.
    capsys.readouterr()

    wrapper["_STATE"].update({"recording": True, "frames": 0, "fps": 30.0,
                              "episode": 0, "counted": True})
    for _ in range(45):
        dataset.add_frame({})

    _drop(wrapper["_ctl_dir"], "mark#000000001", "approach")
    listener.poll_once()

    events = _emitted(capsys)
    assert len(events) == 1
    mark = events[0]
    assert mark["ev"] == "mark"
    assert mark["source"] == "frames"
    assert mark["frame"] == 45
    assert mark["t"] == pytest.approx(1.5)
    assert mark["label"] == "approach"


def test_mark_time_ignores_wall_clock_lag(wrapper, capsys):
    """A control loop running below the target FPS must not shift marks.

    Wall-clock timing would place the mark at ~2 s of real time; the dataset
    only ever holds 60 frames, i.e. 2.0 s at 30 fps — but if the loop ran at
    half speed the dataset instead holds 30 frames == 1.0 s, and that is where
    the cut has to be.
    """
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()
    dataset = _FakeDataset(fps=30)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=30)
    capsys.readouterr()

    wrapper["_STATE"]["recording"] = True
    _drop(wrapper["_ctl_dir"], "mark#000000001")
    listener.poll_once()

    mark = _emitted(capsys)[0]
    assert mark["frame"] == 30
    assert mark["t"] == pytest.approx(1.0)


def test_mark_rejected_outside_an_episode(wrapper, capsys):
    """The reset pause is not recorded, so a mark there has no meaning."""
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()
    dataset = _FakeDataset(fps=30)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30)
    wrapper["_rec"].record_loop(fps=30)  # reset phase: called without a dataset
    capsys.readouterr()

    _drop(wrapper["_ctl_dir"], "mark#000000001")
    listener.poll_once()

    events = _emitted(capsys)
    assert [e["ev"] for e in events] == ["mark_rejected"]


# ── Wrapper: episode lifecycle ───────────────────────────────────────────────

def test_record_loop_reports_episode_and_reset_phases(wrapper, capsys):
    dataset = _FakeDataset(fps=30, num_episodes=3)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=10)
    wrapper["_rec"].record_loop(fps=30)

    events = _emitted(capsys)
    assert [e["ev"] for e in events] == ["episode_begin", "episode_end", "reset_begin"]
    assert events[0]["episode"] == 3
    assert events[0]["fps"] == 30
    assert events[0]["counted"] is True
    assert events[1]["frames"] == 10


def test_frame_counter_is_installed_once_per_dataset(wrapper, capsys):
    """Two episodes on the same dataset must not double-count frames."""
    dataset = _FakeDataset(fps=30)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=10)
    dataset.num_episodes = 1
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=4)

    events = _emitted(capsys)
    ends = [e for e in events if e["ev"] == "episode_end"]
    assert [e["frames"] for e in ends] == [10, 4]


def test_rerecord_announces_the_discarded_episode(wrapper, capsys):
    """lerobot clears the buffer and reuses the index — the app must be told."""
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()
    dataset = _FakeDataset(fps=30, num_episodes=2)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30, _frames=5)
    capsys.readouterr()
    wrapper["_STATE"]["recording"] = True

    _drop(wrapper["_ctl_dir"], "rerecord")
    listener.poll_once()

    events = _emitted(capsys)
    assert [e["ev"] for e in events] == ["control", "episode_discarded"]
    assert events[1]["episode"] == 2
    # Same three flags lerobot's own listener sets
    assert wrapper["_EVENTS"]["rerecord_episode"] is True
    assert wrapper["_EVENTS"]["exit_early"] is True


def test_control_sentinels_map_to_lerobot_event_flags(wrapper, capsys):
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()

    _drop(wrapper["_ctl_dir"], "next")
    listener.poll_once()
    assert wrapper["_EVENTS"]["exit_early"] is True

    _drop(wrapper["_ctl_dir"], "stop")
    listener.poll_once()
    assert wrapper["_EVENTS"]["stop_recording"] is True
    assert [e["action"] for e in _emitted(capsys) if e["ev"] == "control"] == ["next", "stop"]


def test_numbered_marks_are_consumed_in_order(wrapper, capsys):
    """Two marks within one poll interval must both survive, in order."""
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()
    dataset = _FakeDataset(fps=30)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30)
    capsys.readouterr()
    wrapper["_STATE"]["recording"] = True

    _drop(wrapper["_ctl_dir"], "mark#000000002", "second")
    _drop(wrapper["_ctl_dir"], "mark#000000001", "first")
    listener.poll_once()

    events = _emitted(capsys)
    assert [e["label"] for e in events] == ["first", "second"]
    assert not list(wrapper["_ctl_dir"].iterdir())


def test_unmark_sentinel_does_not_collide_with_mark(wrapper, capsys):
    listener = wrapper["_OrchidayFileListener"]()
    listener.stop()
    dataset = _FakeDataset(fps=30)
    wrapper["_rec"].record_loop(dataset=dataset, fps=30)
    capsys.readouterr()
    wrapper["_STATE"]["recording"] = True

    _drop(wrapper["_ctl_dir"], "unmark#000000001")
    listener.poll_once()

    assert [e["ev"] for e in _emitted(capsys)] == ["unmark"]


# ── Bridge: consuming the protocol ───────────────────────────────────────────

@pytest.fixture()
def bridge(tmp_path):
    b = LeRobotBridge(python_executable="python")
    b._record_marks["pick_place"] = {
        "dataset": "local/pick_place",
        "marks_path": str(tmp_path / "pick_place.step_marks.json"),
        "fps": 30,
        "episodes": {},
        "current_episode": -1,
        "phase": "idle",
        "wrapper": False,
    }
    return b


def _feed(bridge, skill: str, **event) -> None:
    bridge._parse_recording_line("[ORCHIDAY_REC] " + json.dumps(event), skill)


def _marks(bridge, skill: str) -> dict:
    return bridge._record_marks[skill]["episodes"]


def test_bridge_stores_marks_with_derived_step_numbers(bridge):
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30, counted=True)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.5, frame=45, label="approach")
    _feed(bridge, "pick_place", ev="mark", episode=0, t=3.0, frame=90, label="grasp")

    assert _marks(bridge, "pick_place") == {"0": [
        {"t": 1.5, "step": 1, "label": "approach"},
        {"t": 3.0, "step": 2, "label": "grasp"},
    ]}


def test_bridge_persists_marks_next_to_the_dataset(bridge):
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=2.0, frame=60, label="lift")

    path = Path(bridge._record_marks["pick_place"]["marks_path"])
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["dataset"] == "local/pick_place"
    assert saved["fps"] == 30
    assert saved["episodes"]["0"][0]["t"] == 2.0


def test_rerecorded_episode_drops_its_marks(bridge):
    """The whole point: marks of a discarded take must never reach the split."""
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.0, frame=30, label="a")
    _feed(bridge, "pick_place", ev="episode_discarded", episode=0)

    assert _marks(bridge, "pick_place") == {}

    # The retried take reuses index 0 and starts from a clean slate
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=2.5, frame=75, label="a")
    assert _marks(bridge, "pick_place")["0"] == [{"t": 2.5, "step": 1, "label": "a"}]


def test_episode_begin_alone_clears_a_reused_index(bridge):
    """Belt and braces: even if the discard event is missed, the re-announced
    episode must not inherit marks from the take before it."""
    _feed(bridge, "pick_place", ev="episode_begin", episode=1, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=1, t=1.0, frame=30, label="a")
    _feed(bridge, "pick_place", ev="episode_begin", episode=1, fps=30)

    assert _marks(bridge, "pick_place") == {}


def test_earlier_episodes_survive_a_rerecord(bridge):
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.0, frame=30, label="a")
    _feed(bridge, "pick_place", ev="episode_begin", episode=1, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=1, t=1.2, frame=36, label="a")
    _feed(bridge, "pick_place", ev="episode_discarded", episode=1)

    assert list(_marks(bridge, "pick_place")) == ["0"]


def test_unmark_removes_only_the_last_mark(bridge):
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.0, frame=30, label="a")
    _feed(bridge, "pick_place", ev="mark", episode=0, t=2.0, frame=60, label="b")
    _feed(bridge, "pick_place", ev="unmark", episode=0)

    assert _marks(bridge, "pick_place")["0"] == [{"t": 1.0, "step": 1, "label": "a"}]


def test_unmark_on_empty_episode_is_harmless(bridge):
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="unmark", episode=0)
    assert _marks(bridge, "pick_place") == {}


def test_phase_events_track_the_record_loop(bridge):
    seen: list[str] = []
    event_bus.recording_phase.connect(lambda s, p: seen.append(p))
    try:
        _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
        _feed(bridge, "pick_place", ev="episode_end", episode=0, frames=100)
        _feed(bridge, "pick_place", ev="reset_begin", episode=0)
    finally:
        event_bus.recording_phase.disconnect()
    assert seen == ["record", "idle", "reset"]
    assert bridge._record_marks["pick_place"]["phase"] == "reset"


def test_prose_episode_tracking_yields_to_the_wrapper(bridge):
    """LeRobot re-logs "Recording episode 0" for a retried take, which would
    otherwise look like a brand new episode. Once the wrapper protocol is
    live, the prose parser must not touch the marks state."""
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.0, frame=30, label="a")

    bridge._parse_recording_line("INFO Recording episode 0", "pick_place")

    assert _marks(bridge, "pick_place")["0"] == [{"t": 1.0, "step": 1, "label": "a"}]


def test_unparseable_event_is_ignored(bridge):
    bridge._parse_recording_line("[ORCHIDAY_REC] not json at all", "pick_place")
    assert _marks(bridge, "pick_place") == {}


def test_mark_step_requires_a_running_recording(bridge):
    # No QProcess is registered, so the sentinel cannot be delivered.
    assert bridge.mark_step("pick_place", label="x")["ok"] is False
    assert bridge.undo_step_mark("pick_place")["ok"] is False
    assert bridge.mark_step("unknown_skill")["ok"] is False


# ── Dataset identity: marks must land next to the data they annotate ─────────
#
# The marks sidecar is addressed by repo_id, and so are the split sub-datasets
# and the training target. LeRobot >= 0.6 can rename the dataset on creation,
# so the wrapper reports the name the dataset object really carries and the
# bridge checks it instead of assuming.

def test_episode_begin_reports_the_datasets_real_identity(wrapper, capsys):
    dataset = _FakeDataset(fps=30)
    dataset.repo_id = "local/pick_place"
    dataset.root = "/data/lerobot/local/pick_place"

    wrapper["_rec"].record_loop(dataset=dataset, fps=30)

    begin = next(e for e in _emitted(capsys) if e["ev"] == "episode_begin")
    assert begin["repo_id"] == "local/pick_place"
    assert begin["root"] == "/data/lerobot/local/pick_place"


def test_matching_repo_id_leaves_the_marks_path_alone(bridge):
    original = bridge._record_marks["pick_place"]["marks_path"]
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30,
          repo_id="local/pick_place", root="/data/local/pick_place")

    assert bridge._record_marks["pick_place"]["marks_path"] == original
    assert bridge._record_marks["pick_place"]["dataset"] == "local/pick_place"


def test_renamed_dataset_re_points_the_marks_sidecar(bridge, tmp_path):
    """If LeRobot records elsewhere, the marks follow the real directory —
    orphaned marks would silently yield an empty orchestration split."""
    real_root = tmp_path / "lerobot" / "local" / "pick_place_20260802_120000"
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30,
          repo_id="local/pick_place_20260802_120000", root=str(real_root))
    _feed(bridge, "pick_place", ev="mark", episode=0, t=1.0, frame=30, label="a")

    state = bridge._record_marks["pick_place"]
    assert state["dataset"] == "local/pick_place_20260802_120000"
    assert Path(state["marks_path"]) == real_root.parent / f"{real_root.name}.step_marks.json"
    written = json.loads(Path(state["marks_path"]).read_text(encoding="utf-8"))
    assert written["dataset"] == "local/pick_place_20260802_120000"
    assert written["episodes"]["0"] == [{"t": 1.0, "step": 1, "label": "a"}]


def test_identity_is_checked_once_not_every_episode(bridge, tmp_path):
    real_root = tmp_path / "stamped"
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30,
          repo_id="local/stamped", root=str(real_root))
    relocated = bridge._record_marks["pick_place"]["marks_path"]

    # A later episode reporting the same (already accepted) name must not
    # re-trigger the relocation machinery.
    _feed(bridge, "pick_place", ev="episode_begin", episode=1, fps=30,
          repo_id="local/stamped", root=str(real_root))

    assert bridge._record_marks["pick_place"]["marks_path"] == relocated


def test_older_wrapper_without_identity_fields_is_accepted(bridge):
    """episode_begin from a wrapper that reports no repo_id must not be read
    as 'renamed to empty string'."""
    original = bridge._record_marks["pick_place"]["marks_path"]
    _feed(bridge, "pick_place", ev="episode_begin", episode=0, fps=30)

    assert bridge._record_marks["pick_place"]["marks_path"] == original
    assert bridge._record_marks["pick_place"]["dataset"] == "local/pick_place"
