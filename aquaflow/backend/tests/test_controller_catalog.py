"""
AF-CAT-001 — tests for the controller catalog + auto-detection.

What must hold:
  * catalog integrity: unique ids, every drivable-protocol entry's tier agrees
    with the runtime support matrices (the catalog can never promise a driver
    the runtime lacks), every REAL entry says where to configure it;
  * the I-CAN entry carries the REVERSE-ENGINEERED site profile exactly
    (gateway 192.168.5.2:200, local port 2002, group 0, 10 Hz refresh) and its
    notes preserve the protocol facts (fire-and-forget, BE-uint32 group);
  * identification is protocol-level, not port-level: a real S7 handshake maps
    to the Siemens entry; a Modbus stack WITHOUT FC43 still identifies as
    generic Modbus (the well-formed exception is the proof); FC43 vendor
    strings map to the specific entry; identify-only families are marked
    NOT drivable;
  * FC43 parsing in the client is correct against the scripted server.
"""
import asyncio

import pytest

from engine.controller_catalog import (
    CATALOG,
    all_entries,
    catalog_dict,
    entries_for_tcp_port,
    get_entry,
)
from engine.controller_identify import identify_service
from engine.fake_s7_server import FakeS7Server
from engine.protocol_bus import PROTOCOL_SUPPORT
from plc.plc_engine import PLC_SUPPORT
from tests.test_modbus_client import ScriptedModbusServer


# ── catalog integrity ───────────────────────────────────────────────────────────
def test_catalog_ids_unique_and_nonempty():
    ids = [e.id for e in CATALOG]
    assert len(ids) == len(set(ids))
    assert len(ids) >= 15
    for e in CATALOG:
        assert e.vendor and e.model and e.category and e.tier


def test_tiers_agree_with_runtime_support():
    """The catalog can never advertise drivability the runtime doesn't have.
    Catalog protocols that the PLC panel drives under another name (EtherNet/IP
    → plc_type allen_bradley) are resolved through CONFIGURABLE_PROTOCOLS — the
    same map discovery uses to build the PLC prefill."""
    from engine.controller_identify import CONFIGURABLE_PROTOCOLS
    for e in CATALOG:
        plc_key = CONFIGURABLE_PROTOCOLS.get(e.protocol, e.protocol)
        if plc_key in PLC_SUPPORT:
            assert e.tier == PLC_SUPPORT[plc_key], e.id
        elif e.protocol in PROTOCOL_SUPPORT:
            assert e.tier == PROTOCOL_SUPPORT[e.protocol], e.id
        else:
            # No driver namespace at all → must not claim REAL.
            assert e.tier != "REAL", e.id


def test_real_entries_are_actionable():
    for e in CATALOG:
        if e.tier == "REAL":
            assert e.configure_in, f"{e.id} is drivable but doesn't say where to configure"
            assert e.default_config, f"{e.id} is drivable but has no config prefill"


def test_site_ican_profile_is_the_reverse_engineered_truth():
    e = get_entry("ican-music-fountain")
    assert e is not None and e.tier == "REAL"
    cfg = e.default_config
    assert cfg["gateway_ip"] == "192.168.5.2"
    assert cfg["gateway_port"] == 200
    assert cfg["local_port"] == 2002
    assert cfg["group"] == 0
    assert cfg["refresh_hz"] == 10
    # The protocol facts that took packet captures to learn must survive in text.
    for fact in ("FIRE-AND-FORGET", "BIG-ENDIAN", "STREAM"):
        assert fact in e.notes.upper()
    assert "everse-engineered" in e.source


def test_port_index_and_dict_shape():
    assert any(e.id == "siemens-s7-1200" for e in entries_for_tcp_port(102))
    assert any(e.id == "modbus-generic" for e in entries_for_tcp_port(502))
    d = catalog_dict()
    assert d["count"] == len(CATALOG)
    assert "ican-music-fountain" in d["drivable"]
    assert "allen-bradley-logix" in d["drivable"]          # pycomm3 bundled (1.2.5)
    assert "opcua-server" in d["drivable"]                 # asyncua bundled (1.2.5)
    assert "beckhoff-ads" not in d["drivable"]


# ── identification (protocol-level, against the fakes) ─────────────────────────
def test_s7_handshake_identifies_siemens():
    async def run():
        server = FakeS7Server()
        await server.start()
        found = await identify_service("127.0.0.1", server.port, 102)
        await server.stop()
        return found

    found = asyncio.run(run())
    assert len(found) == 1
    d = found[0]
    assert d.catalog_id == "siemens-s7-1200"
    assert d.confidence == "confirmed"
    assert d.drivable is True
    assert d.suggested_config["ip"] == "127.0.0.1"


def test_modbus_without_fc43_is_generic_modbus():
    async def run():
        server = ScriptedModbusServer()      # ident=None → ILLEGAL_FUNCTION on FC43
        await server.start()
        found = await identify_service("127.0.0.1", server.port, 502)
        await server.stop()
        return found

    found = asyncio.run(run())
    assert len(found) == 1
    assert found[0].catalog_id == "modbus-generic"
    assert found[0].confidence == "confirmed"
    assert found[0].drivable is True


def test_fc43_vendor_string_maps_to_specific_entry():
    async def run():
        server = ScriptedModbusServer()
        server.ident = ("Advantech", "ADAM-6017", "A1.02")
        await server.start()
        found = await identify_service("127.0.0.1", server.port, 502)
        await server.stop()
        return found

    found = asyncio.run(run())
    assert found[0].catalog_id == "advantech-adam-6000"
    assert found[0].identity["vendor"] == "Advantech"
    assert found[0].identity["product"] == "ADAM-6017"


def test_fc43_client_parsing():
    from engine.modbus_client import ModbusTCPClient

    async def run():
        server = ScriptedModbusServer()
        server.ident = ("Moxa", "ioLogik E1240", "2.1")
        await server.start()
        c = ModbusTCPClient("127.0.0.1", server.port)
        assert await c.connect()
        ident = await c.read_device_identification()
        await c.close()
        await server.stop()
        return ident

    ident = asyncio.run(run())
    assert ident == {"vendor": "Moxa", "product": "ioLogik E1240", "revision": "2.1"}


def test_port_hint_families_are_low_confidence_and_not_drivable():
    async def run():
        # A plain TCP listener on the "MELSEC" port — no protocol behind it.
        server = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        found = await identify_service("127.0.0.1", port, 5007)
        server.close()
        await server.wait_closed()
        return found

    found = asyncio.run(run())
    assert len(found) == 1
    assert found[0].catalog_id == "mitsubishi-melsec"
    assert found[0].confidence == "port_only"
    assert found[0].drivable is False


def test_dead_port_identifies_nothing():
    async def run():
        probe = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
        dead = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()
        return await identify_service("127.0.0.1", dead, 102)

    assert asyncio.run(run()) == []


# ── routes ─────────────────────────────────────────────────────────────────────
def test_catalog_routes():
    from api.routes.controllers import controller_catalog, controller_entry
    from fastapi import HTTPException

    async def run():
        cat = await controller_catalog()
        one = await controller_entry("ican-music-fountain")
        try:
            await controller_entry("no-such-thing")
            missing = False
        except HTTPException as e:
            missing = e.status_code == 404
        return cat, one, missing

    cat, one, missing = asyncio.run(run())
    assert cat["count"] == len(CATALOG)
    assert one["default_config"]["gateway_port"] == 200
    assert missing is True
