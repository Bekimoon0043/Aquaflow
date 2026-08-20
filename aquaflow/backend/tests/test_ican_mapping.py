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


def test_registry_bridge_only_labelled(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    m.import_detections([{"group": 1, "channels": [9, 10]}])
    m.assign(1, 9, label="Lights", device_type="lighting")
    reg = m.to_device_registry()
    assert len(reg) == 1                          # unlabelled channel excluded
    assert reg[0]["protocol"] == "ican"
    assert reg[0]["ican_group"] == 1 and reg[0]["ican_channel"] == 9


def test_lighting_only_excludes_hazardous(tmp_path):
    m = ChannelMap(tmp_path / "map.json")
    m.assign(1, 1, label="Lights", device_type="lighting")
    m.assign(1, 2, label="Pump", device_type="pump")
    m.assign(1, 3, label="Flame", device_type="flame")
    safe = m.lighting_only_channels()
    assert [a.channel for a in safe] == [1]       # only the light
    assert "pump" in HAZARDOUS_TYPES and "flame" in HAZARDOUS_TYPES
