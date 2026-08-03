"""
Identifiers — the single definition of what a skill or project may be called,
and of the LeRobot dataset identity derived from that name.

Deliberately a leaf module: it imports nothing from Orchiday, so the wizard's
live check can answer before a project (and therefore a controller, the LeRobot
bridge and the AI clients) exists.

Why this file exists
--------------------
A skill slug is not a label. It is used verbatim as:

* a directory name inside the project (`<project>/skills/<slug>/`),
* the LeRobot dataset identity — `local/<slug>` for a top-level task,
  `local/<parent>/<step>` for a sub-step (see `controller.dataset_repo_id`),
* and therefore a directory under `$HF_LEROBOT_HOME/<repo_id>` and the value of
  `--dataset.repo_id` / `--job_name` on the command line.

Nothing validated it. The name typed into the wizard was lower-cased, stripped
of diacritics and handed straight to `mkdir` and to LeRobot, so a perfectly
ordinary task name could produce an identifier that fails somewhere the user
cannot see the connection:

    "Eval test"     -> eval_test  -> lerobot-record REFUSES to start (see below)
    "Con"           -> con        -> Windows cannot create that directory
    "Úklid stolu"   -> _klid_stolu (project modal did not strip diacritics)
                                  -> leading "_", not a valid Hub-style name
    "!!!"           -> ""         -> mkdir on the skills root itself
    same name twice -> same slug  -> silently OVERWRITES the first skill

Each rule below is grounded in something that actually breaks, not in taste:

``EVAL_PREFIX``
    LeRobot 0.6.1 `src/lerobot/scripts/lerobot_record.py:433` raises
    ``ValueError`` for any dataset whose repo name starts with ``eval_`` —
    those names are reserved for ``lerobot-rollout``. It checks
    ``repo_id.split("/", 1)[-1]``, so for us that is ``<slug>`` (top-level) or
    ``<parent>/<step>`` (sub-step): the prefix is fatal on a top-level task and
    on the parent of a step. LeRobot 0.4.4 has no such check, which is exactly
    why it must be caught here — the app must not produce a project that works
    on one LeRobot version and dies on the next.

``CHARSET`` / ``START_CHAR``
    ``/`` and ``\\`` would silently change the depth of the repo_id (a
    "top-level" task named ``a/b`` becomes a sub-dataset), ``..`` would write
    outside ``$HF_LEROBOT_HOME``, and ``<>:"|?*`` plus control characters
    cannot appear in a Windows path at all. A leading ``-`` reads as a flag on
    the command line. Restricting to ``[a-z0-9][a-z0-9_-]*`` covers all of
    that with one rule instead of a blacklist that will miss the next case.
    Lower-case only, because macOS and Windows filesystems are
    case-insensitive: ``Grasp`` and ``grasp`` would be two skills in
    `project.json` sharing one directory.

``WINDOWS_RESERVED``
    ``con``, ``prn``, ``aux``, ``nul``, ``com1``-``com9``, ``lpt1``-``lpt9``
    are device names on Windows; creating a directory with one of those names
    fails there and nowhere else. The app has to run on all three platforms.

``TOO_LONG``
    The slug travels into ``$HF_LEROBOT_HOME/local/<parent>/<step>/…`` plus
    LeRobot's own chunk/episode sub-paths. Windows' default path limit is 260
    characters, so two 48-character slugs already spend 100 of them.

``DUPLICATE``
    `ProjectManager.add_skill()` overwrote `skill.json` and the
    `skills_details` entry of an existing slug without a word — the previous
    skill's description and its recorded episodes' owner simply vanished.

Validation applies when something is *created*. Projects already on disk are
never re-checked, so an identifier from an older version keeps working.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

# Kinds of identifier. They share the charset rules; only a skill slug becomes
# a LeRobot repo_id, so only a skill is subject to the `eval_` reservation.
KIND_SKILL = "skill"
KIND_PROJECT = "project"
#: A robot/camera id is written verbatim into REST paths (`/api/robots/{id}`,
#: `/api/cameras/{id}`) that FastAPI resolves one path segment at a time, and
#: `ProjectManager.add_robot()` uses it as a directory name under `robots/`.
#: An id containing "/" therefore does two different kinds of damage: it
#: silently 404s every `{robot_id}`/`{camera_id}` route the frontend builds by
#: string interpolation, and — for a robot — it changes which directory gets
#: written to (or, with "..", writes outside the project). Same charset rule
#: as KIND_PROJECT fixes both.
KIND_ROBOT = "robot"
KIND_CAMERA = "camera"

# Reason codes. These are identifiers, not prose: the backend must not ship
# translated sentences to the browser (a Czech string from the API showed up in
# the English UI once already), so it reports the code plus the values that go
# into the sentence, and the page composes it through i18n.
EMPTY = "empty"
CHARSET = "charset"
START_CHAR = "start_char"
TOO_LONG = "too_long"
EVAL_PREFIX = "eval_prefix"
WINDOWS_RESERVED = "windows_reserved"
DUPLICATE = "duplicate"

#: Longest accepted identifier. See ``TOO_LONG`` above.
MAX_LEN = 48

#: The one accepted shape: starts alphanumeric, then lower-case alphanumerics,
#: underscores and dashes.
_VALID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_START_RE = re.compile(r"^[a-z0-9]")
_ALLOWED_CHAR_RE = re.compile(r"[a-z0-9_-]")

#: Names Windows reserves for character devices. Compared case-insensitively;
#: our charset is lower-case anyway, but the list is written out in full so the
#: reason is readable at the call site.
WINDOWS_RESERVED_NAMES = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{i}" for i in range(1, 10)]
    + [f"lpt{i}" for i in range(1, 10)]
)

#: The prefix LeRobot reserves for `lerobot-rollout` output.
EVAL_RESERVED_PREFIX = "eval_"


def dataset_repo_id(parent_slug: str, skill_slug: str) -> str:
    """The LeRobot `repo_id` a skill's demonstrations live under.

    Pure and dependency-free on purpose: the new-skill wizard has to show the
    identity a not-yet-created skill would get, and it must be the *same*
    string the recorder and the trainer will use. Deriving it a second time in
    the browser or in the API layer is how those drift apart.

    - a **top-level task** owns the whole recorded episode → ``local/<task>``.
      That is the ACT baseline: one policy trained on everything.
    - a **sub-step** owns a slice cut out of its parent by the splitter →
      ``local/<parent>/<step>``. Those are the orchestration policies.

    `OrchidayController._dataset_repo_id_for()` is the stateful wrapper that
    looks the parent up in the open project and then calls this.
    """
    parent = (parent_slug or "").strip()
    return f"local/{parent}/{skill_slug}" if parent else f"local/{skill_slug}"


@dataclass(frozen=True)
class SlugProblem:
    """Why an identifier was rejected, in a form the UI can translate."""

    code: str
    params: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {"code": self.code, "params": dict(self.params)}


class InvalidSlug(ValueError):
    """Raised when something tries to create an object with a bad identifier.

    Carries the structured `problem` so the API can hand the page a reason code
    instead of a sentence.
    """

    def __init__(self, problem: SlugProblem) -> None:
        super().__init__(f"invalid slug ({problem.code})")
        self.problem = problem


def suggest_slug(name: str) -> str:
    """Turn a human name into the identifier this module would accept.

    One definition, shared by the wizard's live preview and by the API — the
    app used to carry three copies of this and they disagreed: the project
    modal did not strip diacritics, so "Úklid stolu" became ``_klid_stolu``
    there and ``uklid_stolu`` in the skill wizard.
    """
    # NFD splits "ú" into "u" + combining accent; dropping the combining marks
    # leaves the ASCII letter behind instead of deleting the whole character.
    decomposed = unicodedata.normalize("NFD", name or "")
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    slug = ascii_only.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = slug.strip("_")
    # A leading digit is fine; a leading "_" or "-" is not, and stripping above
    # already removed those. What can still be wrong is length and the two
    # reserved-name rules, which are fixed here so the suggestion is always
    # something `validate_slug` accepts.
    slug = slug[:MAX_LEN].rstrip("_-")
    if slug.startswith(EVAL_RESERVED_PREFIX):
        slug = slug[len(EVAL_RESERVED_PREFIX):] or "task"
        slug = slug.lstrip("_-") or "task"
    if slug in WINDOWS_RESERVED_NAMES:
        slug = f"{slug}_task"
    return slug


def validate_slug(
    slug: str,
    *,
    kind: str = KIND_SKILL,
    taken: Iterable[str] = (),
) -> SlugProblem | None:
    """Check one identifier. Returns ``None`` when it is usable.

    Args:
        slug: the candidate identifier, exactly as it would be written to disk.
        kind: ``KIND_SKILL`` (also becomes a LeRobot repo_id) or
            ``KIND_PROJECT`` (a directory name only).
        taken: identifiers already in use in the same namespace. Compared
            case-insensitively because macOS and Windows filesystems are.
    """
    candidate = (slug or "").strip()

    if not candidate:
        return SlugProblem(EMPTY)

    if len(candidate) > MAX_LEN:
        return SlugProblem(TOO_LONG, {"max": str(MAX_LEN), "len": str(len(candidate))})

    if not _VALID_RE.match(candidate):
        bad = sorted({c for c in candidate if not _ALLOWED_CHAR_RE.match(c)})
        if bad:
            # Control characters would be invisible in the message; name them.
            shown = "".join(c if c.isprintable() else f"\\x{ord(c):02x}" for c in bad)
            return SlugProblem(CHARSET, {"chars": shown})
        # Charset is fine, so the only way to fail the pattern is the first
        # character (`_foo`, `-foo`).
        if not _START_RE.match(candidate):
            return SlugProblem(START_CHAR, {"char": candidate[0]})
        return SlugProblem(CHARSET, {"chars": candidate[0]})

    if kind == KIND_SKILL and candidate.startswith(EVAL_RESERVED_PREFIX):
        return SlugProblem(EVAL_PREFIX, {"prefix": EVAL_RESERVED_PREFIX})

    if candidate in WINDOWS_RESERVED_NAMES:
        return SlugProblem(WINDOWS_RESERVED, {"slug": candidate})

    lowered = {str(t).strip().lower() for t in taken}
    if candidate.lower() in lowered:
        return SlugProblem(DUPLICATE, {"slug": candidate})

    return None
