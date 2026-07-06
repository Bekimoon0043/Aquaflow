"""
AF-HUB-014 — Protocol support honesty gate.

The old code claimed MQTT/OPC UA/BACnet were supported and MQTTDriver returned fake
success. These tests enforce the truthful state: MQTT fails closed, the SUPPORTED list
and the four-tier matrix reflect reality, and unsupported protocols cannot be added.
"""
import asyncio

from engine.protocol_bus import (
    ProtocolBus, MQTTDriver, PROTOCOL_SUPPORT, REAL_PROTOCOLS, SUPPORT_TIER_MEANING,
)


def test_mqtt_connect_fails_closed_no_fake_success():
    drv = MQTTDriver("10.0.0.9", 1883)
    assert asyncio.run(drv.connect()) is False
    assert drv.is_connected is False
    assert drv.SUPPORT_TIER == "GATED"


def test_mqtt_send_fails_closed_no_fake_success():
    drv = MQTTDriver("10.0.0.9")
    assert asyncio.run(drv.send({"topic": "x", "payload": {"v": 1}})) is False


def test_supported_list_contains_only_real_protocols():
    bus = ProtocolBus()
    assert set(bus.SUPPORTED) == set(REAL_PROTOCOLS)
    for claimed in ("mqtt", "opcua", "bacnet"):
        assert claimed not in bus.SUPPORTED


def test_support_matrix_has_four_honest_tiers():
    assert set(SUPPORT_TIER_MEANING) == {"REAL", "SIMULATED", "GATED", "UNSUPPORTED"}
    assert PROTOCOL_SUPPORT["dmx"] == "REAL"
    assert PROTOCOL_SUPPORT["artnet"] == "REAL"
    assert PROTOCOL_SUPPORT["sacn"] == "REAL"
    assert PROTOCOL_SUPPORT["modbus"] == "REAL"
    assert PROTOCOL_SUPPORT["mqtt"] == "GATED"
    assert PROTOCOL_SUPPORT["opcua"] == "UNSUPPORTED"
    assert PROTOCOL_SUPPORT["bacnet"] == "UNSUPPORTED"


def test_add_device_refuses_gated_and_unsupported_protocols():
    bus = ProtocolBus()
    assert asyncio.run(bus.add_device("mqtt", {"ip": "10.0.0.9"})) is False
    assert asyncio.run(bus.add_device("opcua", {"ip": "10.0.0.9"})) is False
    assert asyncio.run(bus.add_device("bacnet", {"ip": "10.0.0.9"})) is False
    # no driver was silently added for a non-usable protocol
    assert not any(k.startswith(("mqtt", "opcua", "bacnet")) for k in bus._drivers)


def test_status_and_matrix_report_the_honest_classification():
    bus = ProtocolBus()
    status = bus.get_status()
    assert status["protocol_support"]["mqtt"] == "GATED"
    matrix = bus.protocol_support_matrix()
    assert matrix["usable"] == list(REAL_PROTOCOLS)
    assert "mqtt" not in matrix["usable"]
    assert set(matrix["tiers"]) == {"REAL", "SIMULATED", "GATED", "UNSUPPORTED"}
