"""
Tests for the LeRobot device-type catalogue.

The defect these pin down: Orchiday derived `--teleop.type` by appending
`_leader` to the follower family name, which invents a type for every robot
whose leader is not named after it. draccus resolves those flags against
registered subclasses, so an invented name is not a warning — the process dies
during argument parsing, before it ever touches the hardware.

Every name asserted below was read off LeRobot 0.6.1: the `register_subclass`
decorators under `src/lerobot/{robots,teleoperators}/`, and the pairings
LeRobot's own docs use in `lerobot-teleoperate` invocations.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from orchiday.core import device_types as dt


# Every name LeRobot 0.6.1 registers, transcribed from its decorators. Any type
# the catalogue emits has to be in one of these two sets.
LEROBOT_ROBOT_TYPES = {
    "bi_openarm_follower", "bi_rebot_b601_follower", "bi_so_follower",
    "earthrover_mini_plus", "hope_jr_arm", "hope_jr_hand", "koch_follower",
    "lekiwi", "lekiwi_client", "omx_follower", "openarm_follower",
    "reachy2", "rebot_b601_follower", "so100_follower", "so101_follower",
    "unitree_g1",
}

LEROBOT_TELEOP_TYPES = {
    "bi_openarm_leader", "bi_openarm_mini", "bi_rebot_102_leader",
    "bi_so_leader", "gamepad", "homunculus_arm", "homunculus_glove",
    "keyboard", "keyboard_ee", "keyboard_rover", "koch_leader", "omx_leader",
    "openarm_leader", "openarm_mini", "phone", "reachy2_teleoperator",
    "rebot_102_leader", "so100_leader", "so101_leader", "unitree_g1",
}


# ── The catalogue may not invent names ───────────────────────────────────────

def test_every_robot_type_is_one_lerobot_registers():
    for entry in dt.CATALOGUE:
        assert entry.robot_type in LEROBOT_ROBOT_TYPES, (
            f"{entry.robot_type!r} is not a registered LeRobot robot type")


def test_every_leader_type_is_one_lerobot_registers():
    for entry in dt.CATALOGUE:
        if entry.leader_type is not None:
            assert entry.leader_type in LEROBOT_TELEOP_TYPES, (
                f"{entry.leader_type!r} is not a registered LeRobot teleoperator type")


def test_robot_types_are_unique():
    names = [e.robot_type for e in dt.CATALOGUE]
    assert len(names) == len(set(names))


# ── The four pairings the old string surgery got wrong ───────────────────────

@pytest.mark.parametrize("robot_type,expected_leader", [
    # These four are the regression. The old derivation produced
    # `lekiwi_leader`, `unitree_g1_leader`, `reachy2_leader` and
    # `hope_jr_arm_leader` — none of which LeRobot registers.
    ("lekiwi", "so100_leader"),            # examples/lekiwi/teleoperate.py
    ("unitree_g1", "unitree_g1"),          # docs/source/unitree_g1.mdx
    ("reachy2", "reachy2_teleoperator"),   # docs/source/reachy2.mdx
    ("hope_jr_arm", "homunculus_arm"),     # docs/source/hope_jr.mdx
    ("hope_jr_hand", "homunculus_glove"),  # docs/source/hope_jr.mdx
    # and the families the old derivation happened to get right, which must
    # keep working unchanged
    ("so100_follower", "so100_leader"),
    ("so101_follower", "so101_leader"),
    ("koch_follower", "koch_leader"),
    ("openarm_follower", "openarm_leader"),
    ("bi_so_follower", "bi_so_leader"),
    ("bi_openarm_follower", "bi_openarm_leader"),
    ("rebot_b601_follower", "rebot_102_leader"),
])
def test_leader_type_matches_lerobot(robot_type, expected_leader):
    assert dt.leader_type_for(robot_type) == expected_leader


@pytest.mark.parametrize("robot_type", [
    "lekiwi", "unitree_g1", "reachy2", "hope_jr_arm", "hope_jr_hand",
    "earthrover_mini_plus", "lekiwi_client",
])
def test_suffixless_robots_keep_their_registered_name(robot_type):
    """`lekiwi` is `--robot.type=lekiwi`, never `lekiwi_follower`."""
    assert dt.follower_type_for(robot_type) == robot_type


# ── Names older projects may carry on disk ───────────────────────────────────

@pytest.mark.parametrize("stored,expected_robot", [
    ("so100", "so100_follower"),          # bare family, written by old versions
    ("so100_leader", "so100_follower"),   # the leader half of the same setup
    ("lekiwi_follower", "lekiwi"),        # mangled by the old derivation
    ("reachy2_leader", "reachy2"),        # mangled by the old derivation
    ("unitree_g1_follower", "unitree_g1"),
])
def test_legacy_names_still_resolve(stored, expected_robot):
    assert dt.follower_type_for(stored) == expected_robot


def test_unknown_name_falls_back_to_the_default_pair():
    robot, leader = dt.normalize_pair("something_nobody_registers")
    assert (robot, leader) == (dt.DEFAULT_ROBOT_TYPE, dt.DEFAULT_LEADER_TYPE)


def test_so100_leader_resolves_to_its_own_family_not_lekiwi():
    """`so100_leader` leads both an SO-100 and a LeKiwi; it belongs to SO-100."""
    assert dt.entry_for("so100_leader").robot_type == "so100_follower"


# ── normalize_pair: an explicitly chosen leader is honoured ──────────────────

def test_explicit_leader_is_kept_when_it_names_a_real_device():
    robot, leader = dt.normalize_pair("so101_follower", "so100_leader")
    assert robot == "so101_follower"
    assert leader == "so100_leader"


def test_explicit_leader_that_names_nothing_falls_back_to_the_robots_own():
    robot, leader = dt.normalize_pair("reachy2", "reachy2_leader_typo")
    assert robot == "reachy2"
    assert leader == "reachy2_teleoperator"


def test_normalize_pair_never_emits_an_unregistered_name():
    for entry in dt.CATALOGUE:
        robot, leader = dt.normalize_pair(entry.robot_type)
        assert robot in LEROBOT_ROBOT_TYPES
        assert leader is None or leader in LEROBOT_TELEOP_TYPES


# ── Connection shape: only a serial device can take the one port the UI gives ─

@pytest.mark.parametrize("robot_type,connection", [
    ("so100_follower", dt.CONN_SERIAL),
    ("lekiwi", dt.CONN_SERIAL),
    ("openarm_follower", dt.CONN_CAN),        # --robot.port is a CAN interface
    ("bi_so_follower", dt.CONN_BIMANUAL),     # two ports, no --robot.port
    ("reachy2", dt.CONN_NETWORK),             # --robot.ip_address
    ("unitree_g1", dt.CONN_NETWORK),          # --robot.robot_ip
])
def test_connection_shape(robot_type, connection):
    assert dt.entry_for(robot_type).connection == connection


def test_only_serial_devices_are_offered_as_supported():
    for entry in dt.CATALOGUE:
        assert entry.supported == (entry.connection == dt.CONN_SERIAL)


def test_unsupported_entries_name_the_flag_lerobot_actually_wants():
    """
    The reason a device is out of reach is structured, not prose: the shape it
    is addressed by and the flag that carries it. The page composes the
    sentence from those two, so the backend ships no translated text.
    """
    for entry in dt.CATALOGUE:
        if not entry.supported:
            assert entry.port_flag.startswith("--robot."), entry.robot_type
            assert entry.port_flag != "--robot.port" or entry.connection == dt.CONN_CAN


def test_unknown_device_is_not_reported_as_supported():
    assert dt.is_supported("something_nobody_registers") is False


# ── The dict the API hands the frontend ──────────────────────────────────────

def test_catalogue_dicts_carry_what_the_page_renders():
    entries = dt.catalogue()
    assert entries, "catalogue must not be empty"
    for e in entries:
        assert set(e) == {
            "robot_type", "leader_type", "label", "connection",
            "port_flag", "supported", "has_leader",
        }
    by_type = {e["robot_type"]: e for e in entries}
    assert by_type["lekiwi"]["leader_type"] == "so100_leader"
    assert by_type["bi_so_follower"]["supported"] is False


# ── The bridge must go through the catalogue, not its own copy ───────────────

def test_the_bridge_normalizer_agrees_with_the_catalogue():
    """
    The bridge is what actually writes `--robot.type` / `--teleop.type` onto the
    command line. If it ever grows a second derivation, this fails.
    """
    from PySide6.QtCore import QCoreApplication
    if QCoreApplication.instance() is None:
        QCoreApplication([])
    from orchiday.ai.lerobot_bridge import LeRobotBridge

    for entry in dt.CATALOGUE:
        robot, teleop = LeRobotBridge._normalize_device_types(entry.robot_type)
        assert robot == entry.robot_type
        assert teleop == (entry.leader_type or dt.DEFAULT_LEADER_TYPE)
        assert teleop in LEROBOT_TELEOP_TYPES


def test_labels_are_language_neutral():
    """
    The label is rendered verbatim in both languages — the page cannot
    translate it — so it must be a product name, not prose. Czech diacritics
    are the tell; a run of this project already shipped "HOPE-Jr rameno" into
    the English UI.
    """
    czech = set("ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ")
    for entry in dt.CATALOGUE:
        assert not (set(entry.label) & czech), (
            f"{entry.robot_type} label {entry.label!r} is not language neutral")
