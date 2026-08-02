"""
LeRobot device-type catalogue — the single source of truth for what goes into
`--robot.type` and `--teleop.type`.

Why this file exists
--------------------
Orchiday used to derive the pair by string surgery on the follower name:

    leader   = robot_type.replace("_follower", "") + "_leader"
    follower = robot_type.replace("_leader", "")   + "_follower"

That happens to be right for the SO/Koch/OpenArm families and **wrong for every
other robot LeRobot registers**, because the leader is not always named after
the follower and several followers have no `_follower` suffix at all:

    lekiwi      -> "lekiwi_follower"     (registered name is just `lekiwi`)
    unitree_g1  -> "unitree_g1_leader"   (teleoperator is also just `unitree_g1`)
    reachy2     -> "reachy2_leader"      (teleoperator is `reachy2_teleoperator`)
    hope_jr_arm -> "hope_jr_arm_leader"  (teleoperator is `homunculus_arm`)

draccus resolves those flags against `RobotConfig` / `TeleoperatorConfig`
subclasses registered by name, so an invented name is not a warning — the
process dies on argument parsing before it ever reaches the hardware.

The names and pairings below are read off LeRobot 0.6.1:

* `@RobotConfig.register_subclass(...)` in `src/lerobot/robots/*/config_*.py`
* `@TeleoperatorConfig.register_subclass(...)` in `src/lerobot/teleoperators/*`
* the pairings LeRobot's own docs use in `lerobot-teleoperate` invocations
  (`docs/source/{unitree_g1,hope_jr,reachy2,lekiwi}.mdx`, `examples/lekiwi/`)

`connection` records how the robot is actually addressed, which is the second
half of the same truth: Orchiday's Connect tab hands out ONE serial port from
the pyserial scan and sends it as `--robot.port=`. That is only meaningful for
`serial` devices — a bimanual follower takes `--robot.left_arm_config.port` and
`--robot.right_arm_config.port`, a networked one takes an address and no port at
all. Those entries stay in the catalogue (so a project that names one is still
understood) but are flagged unsupported instead of being offered as if a single
tty would drive them.
"""

from __future__ import annotations

from dataclasses import dataclass

# Connection shapes, i.e. how LeRobot is told where the device is.
CONN_SERIAL = "serial"        # --robot.port=/dev/ttyACM0  (pyserial scan applies)
CONN_CAN = "can"              # --robot.port=can0          (CAN interface, not a tty)
CONN_BIMANUAL = "bimanual"    # --robot.{left,right}_arm_config.port=...
CONN_NETWORK = "network"      # --robot.ip_address / .robot_ip / .sdk_url, no port

# Only `serial` devices can be driven by the single port the Connect tab hands
# out. Everything else needs a flag Orchiday does not send yet.
SUPPORTED_CONNECTIONS = (CONN_SERIAL,)


@dataclass(frozen=True)
class DeviceType:
    """One robot LeRobot can drive, plus the teleoperator that leads it."""

    robot_type: str           # exact `--robot.type` value LeRobot registers
    leader_type: str | None   # exact `--teleop.type` value, None if there is none
    label: str                # what a human calls it
    connection: str           # one of the CONN_* constants
    port_flag: str            # the flag the port/address is actually passed in

    @property
    def supported(self) -> bool:
        """True when Orchiday can drive this device with one serial port."""
        return self.connection in SUPPORTED_CONNECTIONS

    @property
    def has_leader(self) -> bool:
        return self.leader_type is not None

    def to_dict(self) -> dict:
        return {
            "robot_type": self.robot_type,
            "leader_type": self.leader_type,
            "label": self.label,
            "connection": self.connection,
            "port_flag": self.port_flag,
            "supported": self.supported,
            "has_leader": self.has_leader,
        }


# Ordered: the arm setups Orchiday is built around first, then the rest of the
# registry so a project naming one of them is still recognised rather than
# silently string-mangled.
CATALOGUE: tuple[DeviceType, ...] = (
    DeviceType("so100_follower", "so100_leader", "SO-100", CONN_SERIAL, "--robot.port"),
    DeviceType("so101_follower", "so101_leader", "SO-101", CONN_SERIAL, "--robot.port"),
    DeviceType("koch_follower", "koch_leader", "Koch v1.1", CONN_SERIAL, "--robot.port"),
    DeviceType("omx_follower", "omx_leader", "OpenMANIPULATOR-X", CONN_SERIAL, "--robot.port"),
    DeviceType(
        "rebot_b601_follower", "rebot_102_leader", "reBot B601-DM",
        CONN_SERIAL, "--robot.port",
    ),
    # LeRobot has no CLI teleoperator for LeKiwi; its own example
    # (examples/lekiwi/teleoperate.py) drives it with an SO-100 leader arm plus
    # a keyboard, so the leader arm to calibrate is a real so100_leader.
    DeviceType("lekiwi", "so100_leader", "LeKiwi", CONN_SERIAL, "--robot.port"),
    DeviceType(
        "hope_jr_arm", "homunculus_arm", "HOPE-Jr Arm",
        CONN_SERIAL, "--robot.port",
    ),
    DeviceType(
        "hope_jr_hand", "homunculus_glove", "HOPE-Jr Hand",
        CONN_SERIAL, "--robot.port",
    ),
    # `port` here is a CAN interface name ("can0"), not a tty — the pyserial
    # scan will never list it, so the port dropdown would be empty and wrong.
    DeviceType(
        "openarm_follower", "openarm_leader", "OpenArm",
        CONN_CAN, "--robot.port",
    ),
    DeviceType(
        "bi_so_follower", "bi_so_leader", "Bimanual SO",
        CONN_BIMANUAL, "--robot.{left,right}_arm_config.port",
    ),
    DeviceType(
        "bi_openarm_follower", "bi_openarm_leader", "Bimanual OpenArm",
        CONN_BIMANUAL, "--robot.{left,right}_arm_config.port",
    ),
    DeviceType(
        "bi_rebot_b601_follower", "bi_rebot_102_leader", "Bimanual reBot B601-DM",
        CONN_BIMANUAL, "--robot.{left,right}_arm_config.port",
    ),
    DeviceType(
        "unitree_g1", "unitree_g1", "Unitree G1",
        CONN_NETWORK, "--robot.robot_ip",
    ),
    DeviceType(
        "reachy2", "reachy2_teleoperator", "Reachy 2",
        CONN_NETWORK, "--robot.ip_address",
    ),
    DeviceType(
        "lekiwi_client", "so100_leader", "LeKiwi Client",
        CONN_NETWORK, "--robot.remote_ip",
    ),
    DeviceType(
        "earthrover_mini_plus", "keyboard_rover", "EarthRover Mini+",
        CONN_NETWORK, "--robot.sdk_url",
    ),
)

_BY_ROBOT_TYPE: dict[str, DeviceType] = {d.robot_type: d for d in CATALOGUE}

# Leader -> the device it leads. A leader name that is also a robot name
# (`unitree_g1`) belongs to the robot lookup, and a leader shared by several
# robots (`so100_leader` leads both an SO-100 and a LeKiwi) resolves to the
# first, i.e. its own family — hence setdefault rather than a comprehension.
_BY_LEADER_TYPE: dict[str, DeviceType] = {}
for _d in CATALOGUE:
    if _d.leader_type and _d.leader_type not in _BY_ROBOT_TYPE:
        _BY_LEADER_TYPE.setdefault(_d.leader_type, _d)
del _d

DEFAULT_ROBOT_TYPE = "so100_follower"
DEFAULT_LEADER_TYPE = "so100_leader"


def catalogue() -> list[dict]:
    """The whole catalogue as plain dicts, for the API and the frontend."""
    return [d.to_dict() for d in CATALOGUE]


def entry_for(device_type: str | None) -> DeviceType | None:
    """
    Resolve any name a project might carry to a catalogue entry.

    Accepts the registered name, the matching leader name, and the shapes older
    Orchiday versions wrote to disk: a bare family ("so100"), or a name mangled
    by the old string surgery ("lekiwi_follower", "reachy2_leader"). Returns
    None only for a name that resembles nothing LeRobot registers.
    """
    if not device_type:
        return None
    name = device_type.strip()
    if not name:
        return None

    hit = _BY_ROBOT_TYPE.get(name) or _BY_LEADER_TYPE.get(name)
    if hit:
        return hit

    # Older projects stored a bare family name, or one the old derivation
    # mangled by appending a suffix the registry does not use.
    for suffix in ("_follower", "_leader"):
        if name.endswith(suffix):
            base = name[: -len(suffix)]
            hit = _BY_ROBOT_TYPE.get(base) or _BY_LEADER_TYPE.get(base)
            if hit:
                return hit
    hit = _BY_ROBOT_TYPE.get(f"{name}_follower")
    if hit:
        return hit
    return None


def follower_type_for(device_type: str | None) -> str:
    """The exact `--robot.type` for whatever the project calls this device."""
    entry = entry_for(device_type)
    return entry.robot_type if entry else DEFAULT_ROBOT_TYPE


def leader_type_for(device_type: str | None) -> str | None:
    """The exact `--teleop.type`, or None when the device has no leader."""
    entry = entry_for(device_type)
    if entry is None:
        return DEFAULT_LEADER_TYPE
    return entry.leader_type


def has_leader(device_type: str | None) -> bool:
    entry = entry_for(device_type)
    return entry.has_leader if entry else True


def is_supported(device_type: str | None) -> bool:
    """Can Orchiday drive this device with the one serial port it hands out?"""
    entry = entry_for(device_type)
    return entry.supported if entry else False


def normalize_pair(robot_type: str | None, teleop_type: str | None = "") -> tuple[str, str | None]:
    """
    Resolve a (robot, teleop) pair to names LeRobot really registers.

    `teleop_type` is honoured when it names a device in the catalogue — a user
    may legitimately lead an SO-101 follower with an SO-100 leader — and is
    otherwise resolved from the robot, which is the case that used to produce
    names like `lekiwi_leader`.
    """
    follower = follower_type_for(robot_type)

    if teleop_type:
        teleop_entry = entry_for(teleop_type)
        if teleop_entry is not None and teleop_entry.leader_type:
            return follower, teleop_entry.leader_type

    return follower, leader_type_for(robot_type)
