"""
dmx_assigner.py — AquaFlow Recovery, AQ-X-001

Automatic DMX address assignment for all fixture types.

This is the conflict-free allocator that turns a list of DMX/Art-Net/sACN fixtures
into concrete (universe, channel) addresses. It was previously only a naive
sequential packer on ``DeviceRegistry`` that ignored fixtures already sitting at a
manual address — so an auto-assigned fixture could silently land on top of a
manually-pinned one. This module fixes that:

  1. **Auto-assignment for all fixture types** — a profile/type → channel-width map
     covers dimmers, RGB/RGBW/RGBA, moving heads, lasers, fog/haze, pixel bars, etc.
     (``channels_for``), so every fixture reserves the right number of channels.

  2. **Conflict-free allocation** — a channel-occupancy grid is reserved first for
     every locked/manual fixture, then unlocked fixtures are first-fit packed into
     the remaining free gaps. No two fixtures ever share a channel; overflow past a
     universe rolls to the next one; genuine overlaps are reported, never silently
     overwritten.

  3. **Manual override** — any fixture marked ``locked`` (or carrying an explicit
     universe+channel) keeps its address; the allocator packs everything else
     *around* it.

Pure and hardware-free: operates on light ``DMXFixture`` records so it is trivially
testable and reusable from the DeviceRegistry, the fixture bridge, and the API.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_UNIVERSE_SIZE = 512      # DMX512: 512 channels per universe
MAX_UNIVERSE          = 32768    # Art-Net addressable universe ceiling

# Channel width by DMX personality / profile name. Keys are matched
# case-insensitively; anything unknown falls back to a type-based guess.
PROFILE_CHANNELS: dict[str, int] = {
    "switch_1ch": 1, "dimmer_1ch": 1, "single": 1, "intensity": 1,
    "rgb": 3, "rgb_3ch": 3,
    "dimmer_rgb": 4, "rgb_4ch": 4, "rgbw_4ch": 4, "rgba_4ch": 4,
    "rgbw_5ch": 5, "rgba_5ch": 5, "rgbd_5ch": 5,
    "rgbwa_6ch": 6, "rgbaw_6ch": 6,
    "rgbwauv_7ch": 7,
    "rgbw_8ch": 8,
    "moving_head_basic": 11, "moving_head": 14, "moving_head_14ch": 14,
    "moving_head_16ch": 16, "moving_head_24ch": 24,
    "laser_1ch": 1, "laser": 2, "laser_2ch": 2, "laser_8ch": 8,
    "fog_1ch": 1, "fog": 1, "haze_2ch": 2, "fog_2ch": 2,
    "pixel_bar_8": 24, "pixel_bar_12": 36, "pixel_bar_16": 48,
}

# Channel width by control class / fixture-type token (fallback when the profile
# is unknown). Matched as substrings against the lowercased type.
_TYPE_CHANNELS: tuple[tuple[tuple[str, ...], int], ...] = (
    (("moving", "mover", "wash_beam"),                 14),
    (("pixel", "matrix", "bar_rgb"),                    24),
    (("rgbw", "rgba"),                                   5),
    (("rgb", "colour", "color", "wash"),                4),
    (("light", "led", "spot", "under", "par", "beam"),  4),
    (("laser",),                                         2),
    (("fog", "haze", "mist", "smoke"),                  1),
    (("dimmer", "white", "single", "strobe"),           1),
)


def channels_for(profile: Optional[str] = None,
                 device_type: Optional[str] = None,
                 default: int = 1) -> int:
    """
    Resolve how many DMX channels a fixture consumes.

    Priority: explicit ``profile`` name → fixture-``device_type`` token → ``default``.
    Always returns at least 1.
    """
    if profile:
        w = PROFILE_CHANNELS.get(str(profile).strip().lower())
        if w:
            return max(1, w)
    if device_type:
        t = str(device_type).strip().lower()
        for tokens, width in _TYPE_CHANNELS:
            if any(tok in t for tok in tokens):
                return max(1, width)
    return max(1, int(default))


# ── Fixture record ────────────────────────────────────────────────────────────

@dataclass
class DMXFixture:
    """A single fixture the allocator places (or honours) in the DMX space."""
    id:       str
    channels: int            = 1
    profile:  str            = ""
    locked:   bool           = False        # honour universe+channel, never move it
    universe: Optional[int]  = None
    channel:  Optional[int]  = None

    @property
    def is_pinned(self) -> bool:
        """A manually-addressed fixture: locked with a concrete address."""
        return bool(self.locked and self.universe and self.channel)


def fixture_from_dict(d: dict) -> Optional[DMXFixture]:
    """
    Build a ``DMXFixture`` from a loose fixture dict (API / designed-show payload).

    Recognises id/fixtureId, an explicit universe + channel (which imply a manual
    override), a channels count, and a profile or type from which the channel width
    is derived when none is given. Returns None when there is no usable id.
    """
    if not isinstance(d, dict):
        return None
    fid = d.get("id") or d.get("fixtureId") or d.get("device_id")
    if not fid:
        return None

    universe = _as_int(d.get("universe"), d.get("dmxUniverse"), d.get("dmx_universe"))
    channel  = _as_int(d.get("channel"), d.get("dmxChannel"), d.get("dmx_channel"),
                       d.get("dmxAddress"), d.get("startChannel"))
    profile  = str(d.get("profile") or d.get("dmx_profile") or "")
    dtype    = str(d.get("type") or d.get("fixtureType") or d.get("device_type") or "")

    channels = _as_int(d.get("channels"), d.get("dmx_channels"), d.get("channelCount"))
    if channels is None:
        channels = channels_for(profile, dtype)

    # An explicit address, or an explicit lock flag, marks a manual override.
    locked = bool(d.get("locked") or d.get("manual") or (universe and channel))

    return DMXFixture(
        id=str(fid), channels=max(1, channels), profile=profile,
        locked=locked, universe=universe, channel=channel,
    )


def _as_int(*vals) -> Optional[int]:
    for v in vals:
        if v is None or v == "":
            continue
        try:
            return int(v)
        except (ValueError, TypeError):
            continue
    return None


# ── Occupancy grid ────────────────────────────────────────────────────────────

class _Occupancy:
    """Tracks which (universe, channel) slots are taken, for conflict detection."""

    def __init__(self, universe_size: int):
        self.size = universe_size
        self._used: dict[tuple[int, int], str] = {}

    def range_free(self, universe: int, channel: int, count: int) -> bool:
        if channel < 1 or channel + count - 1 > self.size:
            return False
        return all((universe, channel + i) not in self._used for i in range(count))

    def reserve(self, universe: int, channel: int, count: int, owner: str) -> list[tuple[int, int, str]]:
        """Claim a range for ``owner``; returns any (universe, ch, existing-owner) collisions."""
        collisions: list[tuple[int, int, str]] = []
        for i in range(count):
            key = (universe, channel + i)
            existing = self._used.get(key)
            if existing is not None and existing != owner:
                collisions.append((universe, channel + i, existing))
            else:
                self._used[key] = owner
        return collisions

    def first_free(self, count: int, start_universe: int, start_channel: int,
                   max_universe: int) -> Optional[tuple[int, int]]:
        """First-fit search for a free contiguous ``count``-channel block."""
        universe, channel = start_universe, max(1, start_channel)
        while universe <= max_universe:
            if channel + count - 1 > self.size:
                universe += 1
                channel = 1
                continue
            if self.range_free(universe, channel, count):
                return universe, channel
            channel += 1
        return None


# ── Core allocation ───────────────────────────────────────────────────────────

def assign_dmx(
    fixtures: list[DMXFixture],
    start_universe: int = 1,
    start_channel: int = 1,
    universe_size: int = DEFAULT_UNIVERSE_SIZE,
    max_universe: int = MAX_UNIVERSE,
) -> tuple[list[DMXFixture], list[str]]:
    """
    Assign conflict-free DMX addresses to ``fixtures`` in place.

    Manually-pinned fixtures (``is_pinned``) keep their address and are reserved
    first; every other fixture is first-fit packed into the remaining free channels,
    rolling to the next universe when one fills. Returns the same list plus a list of
    warning strings (manual-vs-manual collisions, per-universe overflow, exhaustion).
    """
    warnings: list[str] = []
    occ = _Occupancy(universe_size)

    pinned = [f for f in fixtures if f.is_pinned]
    auto   = [f for f in fixtures if not f.is_pinned]

    # 1. Reserve every manual override first so auto-assignment packs around them.
    for f in pinned:
        n = max(1, int(f.channels))
        end = f.channel + n - 1
        if end > universe_size:
            warnings.append(
                f"DMX overflow: manual '{f.id}' ends at U{f.universe} Ch{end} (> {universe_size})"
            )
        for u, c, other in occ.reserve(f.universe, f.channel, n, f.id):
            warnings.append(
                f"DMX collision: U{u} Ch{c} — manual '{f.id}' overlaps '{other}'"
            )

    # 2. First-fit pack the rest into the free gaps. Widest first for tighter packing;
    #    stable within equal widths so assignment order is deterministic.
    for f in sorted(auto, key=lambda x: -max(1, int(x.channels))):
        n = max(1, int(f.channels))
        if n > universe_size:
            warnings.append(f"DMX oversize: '{f.id}' needs {n} ch (> {universe_size}/universe)")
            continue
        slot = occ.first_free(n, start_universe, start_channel, max_universe)
        if slot is None:
            warnings.append(f"DMX space exhausted: cannot place '{f.id}' ({n} ch)")
            continue
        u, c = slot
        occ.reserve(u, c, n, f.id)
        f.universe, f.channel = u, c

    return fixtures, warnings


def assign_from_dicts(
    fixture_dicts: list[dict],
    start_universe: int = 1,
    start_channel: int = 1,
    universe_size: int = DEFAULT_UNIVERSE_SIZE,
) -> tuple[list[dict], list[str]]:
    """
    Convenience wrapper for API / payload callers.

    Accepts loose fixture dicts, resolves channel widths + manual overrides, runs the
    allocator, and returns a list of assignment dicts (id, universe, channel,
    channels, profile, locked) plus warnings. Input order is preserved.
    """
    parsed: list[DMXFixture] = []
    skipped: list[str] = []
    for d in fixture_dicts or []:
        fx = fixture_from_dict(d)
        if fx is None:
            skipped.append(str((d or {}).get("id", "?")))
        else:
            parsed.append(fx)

    order = {f.id: i for i, f in enumerate(parsed)}
    assign_dmx(parsed, start_universe, start_channel, universe_size)
    parsed.sort(key=lambda f: order[f.id])

    warnings: list[str] = []
    if skipped:
        warnings.append(f"skipped {len(skipped)} fixture(s) without an id")

    result = [
        {
            "id": f.id,
            "universe": f.universe,
            "channel": f.channel,
            "channels": f.channels,
            "profile": f.profile,
            "locked": f.locked,
        }
        for f in parsed
    ]
    return result, warnings
