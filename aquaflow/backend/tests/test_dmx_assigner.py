"""
Contract tests for Automatic DMX Address Assignment (AQ-X-001).

Asserts the three acceptance criteria:
  1. an auto-assignment algorithm that sizes and places every fixture type,
  2. conflict-free allocation (no two fixtures share a channel), and
  3. manual override — pinned addresses are honoured and everything packs around them.
"""
from services.dmx_assigner import (
    DMXFixture, assign_dmx, assign_from_dicts, channels_for, fixture_from_dict,
)
from services.device_registry import DeviceRegistry, DeviceAddress, Protocol


# ── 1. channel sizing for all fixture types ──────────────────────────────────

def test_channels_for_profile_and_type():
    assert channels_for("rgbw_4ch") == 4
    assert channels_for("moving_head_16ch") == 16
    assert channels_for("dimmer_1ch") == 1
    # unknown profile falls back to the type token
    assert channels_for("no_such_profile", "light_underwater_rgb") == 4
    assert channels_for(None, "moving_head_spot") == 14
    assert channels_for(None, "laser_scanner") == 2
    # completely unknown → default of 1, never zero/negative
    assert channels_for(None, None) == 1
    assert channels_for("", "") == 1


# ── 2. conflict-free auto assignment ─────────────────────────────────────────

def _occupied(fixtures):
    slots = set()
    for f in fixtures:
        for i in range(f.channels):
            slots.add((f.universe, f.channel + i))
    return slots


def test_auto_assign_is_conflict_free():
    fixtures = [DMXFixture(id=f"L{i}", channels=4) for i in range(10)]
    assign_dmx(fixtures)
    slots = _occupied(fixtures)
    # 10 fixtures × 4 channels, all distinct → no overlap
    assert len(slots) == 10 * 4
    # first fixture starts at U1 Ch1, packed contiguously
    assert all(f.universe == 1 for f in fixtures)
    assert sorted(f.channel for f in fixtures) == [1, 5, 9, 13, 17, 21, 25, 29, 33, 37]


def test_universe_rollover_at_512():
    # 130 fixtures × 4ch = 520 channels → must roll into universe 2.
    fixtures = [DMXFixture(id=f"L{i}", channels=4) for i in range(130)]
    _, warnings = assign_dmx(fixtures)
    universes = {f.universe for f in fixtures}
    assert universes == {1, 2}
    # no channel exceeds 512 and no overflow warning
    assert all(f.channel + f.channels - 1 <= 512 for f in fixtures)
    assert not any("overflow" in w.lower() for w in warnings)
    assert len(_occupied(fixtures)) == 130 * 4


# ── 3. manual override ───────────────────────────────────────────────────────

def test_manual_override_is_honoured_and_packed_around():
    # A fixture pinned to the LOW channels an auto fixture would otherwise grab.
    pinned = DMXFixture(id="PIN", channels=4, locked=True, universe=1, channel=1)
    auto1  = DMXFixture(id="A1", channels=4)
    auto2  = DMXFixture(id="A2", channels=4)
    _, warnings = assign_dmx([pinned, auto1, auto2])
    # manual address untouched
    assert (pinned.universe, pinned.channel) == (1, 1)
    # autos packed AROUND it, never on top of channels 1–4
    for a in (auto1, auto2):
        assert not (a.universe == 1 and 1 <= a.channel <= 4)
    assert len(_occupied([pinned, auto1, auto2])) == 3 * 4
    assert not any("collision" in w.lower() for w in warnings)


def test_manual_fixture_in_middle_creates_packable_gap():
    # Pin a 2ch fixture at Ch10; a 4ch fixture cannot fit in Ch9–12 gap under it,
    # but smaller fixtures should still fill the free channels conflict-free.
    pinned = DMXFixture(id="PIN", channels=2, locked=True, universe=1, channel=10)
    autos  = [DMXFixture(id=f"A{i}", channels=1) for i in range(12)]
    assign_dmx([pinned] + autos)
    slots = _occupied([pinned] + autos)
    assert (1, 10) in slots and (1, 11) in slots      # pin kept
    assert len(slots) == 2 + 12                        # nothing overlaps
    assert all((a.universe, a.channel) != (1, 10) for a in autos)


def test_manual_vs_manual_collision_is_reported():
    a = DMXFixture(id="M1", channels=4, locked=True, universe=1, channel=1)
    b = DMXFixture(id="M2", channels=4, locked=True, universe=1, channel=2)  # overlaps 2–4
    _, warnings = assign_dmx([a, b])
    assert any("collision" in w.lower() for w in warnings), warnings


# ── 4. dict adapter preserves order + resolves widths ────────────────────────

def test_assign_from_dicts_preserves_order_and_sizes():
    out, warnings = assign_from_dicts([
        {"id": "mh1", "type": "moving_head_spot"},           # 14ch
        {"id": "rgb1", "profile": "rgbw_4ch"},               # 4ch
        {"id": "pin", "universe": 1, "channel": 1, "channels": 2},  # manual
    ])
    ids = [a["id"] for a in out]
    assert ids == ["mh1", "rgb1", "pin"]                     # input order kept
    by = {a["id"]: a for a in out}
    assert by["mh1"]["channels"] == 14
    assert by["pin"]["locked"] is True and (by["pin"]["universe"], by["pin"]["channel"]) == (1, 1)
    # everything conflict-free
    slots = set()
    for a in out:
        for i in range(a["channels"]):
            slots.add((a["universe"], a["channel"] + i))
    assert len(slots) == 14 + 4 + 2


def test_fixture_from_dict_marks_explicit_address_as_manual():
    fx = fixture_from_dict({"id": "x", "type": "rgb_light", "universe": 2, "channel": 50})
    assert fx.locked and fx.is_pinned and fx.universe == 2 and fx.channel == 50
    auto = fixture_from_dict({"id": "y", "type": "rgb_light"})
    assert not auto.locked and auto.channels == 4


# ── 5. DeviceRegistry integration — conflict-free w/ pre-registered manual ────

def test_registry_auto_assign_packs_around_registered_manual():
    reg = DeviceRegistry()
    # A manually-addressed light already in the registry at U1 Ch1 (4ch).
    manual = DeviceAddress(device_id="MAN", device_type="light_rgb",
                           protocol=Protocol.ARTNET, dmx_universe=1, dmx_channel=1,
                           dmx_channels=4, dmx_profile="rgbw_4ch")
    reg.register(manual)
    # Two auto lights assigned afterwards must not collide with the manual one.
    autos = [DeviceAddress(device_id=f"A{i}", device_type="light_rgb",
                           protocol=Protocol.ARTNET, dmx_channels=4) for i in range(2)]
    warnings = reg.auto_assign_dmx(autos)
    assert reg.get("MAN").dmx_channel == 1                   # manual untouched
    for a in autos:
        d = reg.get(a.device_id)
        assert not (d.dmx_universe == 1 and 1 <= d.dmx_channel <= 4)
    assert reg.validate() == []                              # registry sees no collisions
    assert not any("collision" in w.lower() for w in warnings)
