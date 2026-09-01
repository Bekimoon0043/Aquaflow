"""I-CAN channel map: assignment, validation, persistence, registry bridge, safety."""
import json

from engine.ican_mapping import ChannelMap, HAZARDOUS_TYPES


def test_assign_and_get(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    a = m.assign(1, 9, label="Pool ring lights", device_type="lighting")
    assert a.label == "Pool ring lights" and a.device_type == "lighting"
    assert m.get(1, 9).label == "Pool ring lights"
    assert m.get(9, 9) is None


def test_bad_device_type_rejected(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    try:
        m.assign(1, 1, device_type="rocket")
        assert False, "should have raised"
    except ValueError:
        pass


def test_import_detections_then_label(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    added = m.import_detections([{"group": 1, "channels": [9, 10, 11]},
                                 {"group": 2, "channels": [1]}])
    assert added == 4
    assert len(m.unlabelled()) == 4               # all start unknown
    m.assign(1, 9, label="Jets", device_type="jet")
    assert len(m.unlabelled()) == 3
    # re-import keeps existing labels
    m.import_detections([{"group": 1, "channels": [9]}])
    assert m.get(1, 9).label == "Jets"


def test_persistence_roundtrip(tmp_path):
    p = tmp_path / "map.json"
    m = ChannelMap(p)
    m.assign(3, 5, label="Center geyser", device_type="jet", safety_max=0.8)
    m.save()
    again = ChannelMap(p).load()
    a = again.get(3, 5)
    assert a.label == "Center geyser" and a.safety_max == 0.8
    assert json.loads(p.read_text())["channels"][0]["label"] == "Center geyser"


def test_registry_bridge_excludes_only_genuinely_unlabelled(tmp_path):
    """An unlabelled assignment is still excluded — but an IMPORTED one is no longer
    unlabelled.

    This test used to assert that channels from a capture stayed out of the registry
    until the operator renamed each one. The intent was "do not drive what you have not
    identified", but the effect on site was that importing a capture produced a screen
    full of correct channel numbers that Attach silently ignored. Identification is not
    what makes a channel safe here: arming is, plus the typed confirmation and a
    deliberate press of that one channel's button. The registry is the set of channels
    that can be ADDRESSED, not the set that will fire.
    """
    m = ChannelMap(tmp_path / "map.json")
    m.import_detections([{"group": 1, "channels": [9, 10]}])
    m.assign(1, 9, label="Lights", device_type="lighting")
    reg = m.to_device_registry()
    assert len(reg) == 2, "imported channels must be attachable"
    lights = [d for d in reg if d["device_id"] == "ican-1-9"][0]
    assert lights["protocol"] == "ican"
    assert lights["ican_group"] == 1 and lights["ican_channel"] == 9
    assert lights["label"] == "Lights"            # an explicit label always wins

    # A channel with the label explicitly cleared is still excluded.
    m.assign(1, 10, label="")
    assert [d["device_id"] for d in m.to_device_registry()] == ["ican-1-9"]


def test_lighting_only_excludes_hazardous(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    m.assign(1, 1, label="Lights", device_type="lighting")
    m.assign(1, 2, label="Pump", device_type="pump")
    m.assign(1, 3, label="Flame", device_type="flame")
    safe = m.lighting_only_channels()
    assert [a.channel for a in safe] == [1]       # only the light
    assert "pump" in HAZARDOUS_TYPES and "flame" in HAZARDOUS_TYPES


# ── building the map from a capture of the original software ─────────────────

def test_capture_import_parses_changes_txt_and_jsonl_identically():
    """changes.txt is parsed with the SAME regex the reference client uses for
    --replay, so a file that replays correctly also imports correctly."""
    from engine.ican_capture_import import parse_capture

    changes = """OUTPUT CHANGES  (one line per actual change, per group)
==============================================================================
  time     group  channels now on
------------------------------------------------------------------------------
    8.26s      1  [9, 13]
   17.45s      1  [9, 13, 17, 21]
   18.90s      1  (all off)
   19.10s      9  [10, 39]
------------------------------------------------------------------------------
3 change(s). Repeated identical frames are omitted.
"""
    jsonl = "\n".join([
        '{"kind": "session", "tool": "ican_capture 1.0"}',
        '{"kind": "frame", "dir": "PC->GW", "group": 1, "channels": [9, 13]}',
        '{"kind": "frame", "dir": "PC->GW", "group": 1, "channels": [9, 13, 17, 21]}',
        '{"kind": "frame", "dir": "PC->GW", "group": 1, "channels": []}',
        '{"kind": "frame", "dir": "PC->GW", "group": 9, "channels": [10, 39]}',
    ])
    expected = [{"group": 1, "channels": [9, 13, 17, 21]},
                {"group": 9, "channels": [10, 39]}]
    assert parse_capture(changes) == expected
    assert parse_capture(jsonl) == expected


def test_capture_import_ignores_gateway_replies_and_junk():
    from engine.ican_capture_import import parse_capture
    # A GW->PC frame is not a command and its bytes are a different layout.
    assert parse_capture('{"kind": "frame", "dir": "GW->PC", "group": 1, "channels": [4]}') == []
    assert parse_capture("not a capture at all\nnor this line") == []
    assert parse_capture("") == []


def test_imported_channels_are_attachable(tmp_path):
    """The bug this guards: import_detections used to leave the label blank, and
    to_device_registry() skips unlabelled assignments — so the operator saw the right
    numbers on screen and Attach did nothing with them."""
    from engine.ican_mapping import ChannelMap
    m = ChannelMap(path=tmp_path / "m.json")
    added = m.import_detections([{"group": 1, "channels": [9, 13]}])
    assert added == 2
    reg = m.to_device_registry()
    assert [d["device_id"] for d in reg] == ["ican-1-9", "ican-1-13"]
    assert all(d["label"] for d in reg), "imported channels must carry a label"


def test_capture_import_preserves_labels_you_already_set(tmp_path):
    from engine.ican_mapping import ChannelMap
    m = ChannelMap(path=tmp_path / "m.json")
    m.assign(1, 9, label="North jet", device_type="pump")
    m.import_detections([{"group": 1, "channels": [9, 13]}])
    assert m.get(1, 9).label == "North jet"
    assert m.get(1, 9).device_type == "pump"


def test_capture_import_skips_unaddressable_channels(tmp_path):
    from engine.ican_mapping import ChannelMap
    m = ChannelMap(path=tmp_path / "m.json")
    m.import_detections([{"group": 0, "channels": [1, 41, 999]}])
    assert [(a.group, a.channel) for a in m.all()] == [(0, 1)]
