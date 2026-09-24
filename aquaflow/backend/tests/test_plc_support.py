"""
AF-IO-006 — the honest PLC support matrix (AF-HUB-014's discipline, applied to the
PLC subsystem).

What must hold:
  * the matrix names exactly the tiers the code delivers — siemens_s7 and
    modbus_tcp REAL, everything else GATED or UNSUPPORTED;
  * _create_driver never substitutes a Modbus driver for an unsupported type
    (the old fallback gave "Beckhoff TwinCAT" a Modbus connection to port 4840);
  * add_plc refuses non-REAL types BEFORE storing anything — no connection entry,
    no driver, no socket;
  * /api/plc/types offers only usable types and carries the full matrix.
"""
import asyncio

import pytest

from plc.plc_engine import (
    PLCManager,
    PLCConnection,
    PLCType,
    PLC_SUPPORT,
    REAL_PLC_TYPES,
    AllenBradleyDriver,
    ModbusTCPPLCDriver,
    OPCUADriver,
    SiemensS7Driver,
)


def _cfg(plc_type, port=502):
    return PLCConnection(id=f"t-{plc_type}", name="t", plc_type=PLCType(plc_type),
                         ip="127.0.0.1", port=port)


def test_matrix_is_exactly_what_the_code_delivers():
    assert PLC_SUPPORT["siemens_s7"] == "REAL"
    assert PLC_SUPPORT["modbus_tcp"] == "REAL"
    # 1.2.5: asyncua and pycomm3 are bundled and their drivers are tested against
    # independent servers (asyncua Server, cpppo Logix simulator).
    assert PLC_SUPPORT["opc_ua"] == "REAL"
    assert PLC_SUPPORT["allen_bradley"] == "REAL"
    assert sorted(REAL_PLC_TYPES) == ["allen_bradley", "modbus_tcp", "opc_ua", "siemens_s7"]
    # Every enum member is classified — nothing falls through to a default.
    for t in PLCType:
        assert t.value in PLC_SUPPORT
    assert PLC_SUPPORT["beckhoff"] == "UNSUPPORTED"
    for gated in ("delta", "mitsubishi", "omron"):
        assert PLC_SUPPORT[gated] == "GATED"


def test_no_silent_modbus_substitution():
    mgr = PLCManager()
    for t in ("beckhoff", "omron", "delta", "mitsubishi"):
        with pytest.raises(ValueError):
            mgr._create_driver(_cfg(t))


def test_real_types_get_their_own_driver():
    mgr = PLCManager()
    assert isinstance(mgr._create_driver(_cfg("siemens_s7", 102)), SiemensS7Driver)
    assert isinstance(mgr._create_driver(_cfg("modbus_tcp")), ModbusTCPPLCDriver)
    assert isinstance(mgr._create_driver(_cfg("opc_ua", 4840)), OPCUADriver)
    assert isinstance(mgr._create_driver(_cfg("allen_bradley", 44818)), AllenBradleyDriver)


def test_bundled_plc_libraries_import():
    """The three libraries the PLC panel lists are real dependencies now, not
    'pip install later' hints — and python-snap7 3.x needs no snap7.dll."""
    import snap7, asyncua, pycomm3  # noqa: F401
    assert int(snap7.__version__.split(".")[0]) >= 3
    assert SiemensS7Driver(_cfg("siemens_s7", 102))._has_snap7 is True
    assert OPCUADriver(_cfg("opc_ua", 4840))._has_opcua is True
    assert AllenBradleyDriver(_cfg("allen_bradley", 44818))._has_pycomm3 is True


def test_add_plc_refuses_before_storing_anything():
    mgr = PLCManager()
    result = asyncio.run(mgr.add_plc(_cfg("beckhoff", 4840)))
    assert result["refused"] is True
    assert result["connected"] is False
    assert "UNSUPPORTED" in result["error"]
    assert mgr._connections == {}          # nothing stored
    assert mgr._drivers == {}              # no driver, no socket


def test_gated_modbus_families_get_the_explicit_hint():
    mgr = PLCManager()
    result = asyncio.run(mgr.add_plc(_cfg("delta")))
    assert result["refused"] is True
    assert "modbus_tcp" in result["error"]  # points at the honest route


def test_types_route_lists_all_families_honestly():
    """All 8 families are visible (operator request), but every entry carries the
    truth: what it connects AS on the wire, and whether it is connectable at all.
    Nothing connectable may resolve to a non-REAL wire protocol — the old silent
    substitution can never come back through this surface."""
    from api.routes.plc import get_plc_types
    payload = asyncio.run(get_plc_types())
    by_id = {t["id"]: t for t in payload["types"]}
    assert set(by_id) == set(PLC_SUPPORT)                 # every family, none invented
    for t in payload["types"]:
        assert t["tier"] == PLC_SUPPORT[t["id"]]          # tier is the runtime truth
        if t["connectable"]:
            assert t["connect_as"] in REAL_PLC_TYPES      # only real drivers on the wire
        else:
            assert t["connect_as"] is None
    # The Modbus-speaking families route through modbus_tcp, said out loud.
    for gated in ("delta", "mitsubishi", "omron"):
        assert by_id[gated]["connect_as"] == "modbus_tcp"
        assert "Modbus" in by_id[gated]["label"]
    # Bundled-library families connect as themselves; Beckhoff stays identify-only.
    assert by_id["allen_bradley"]["connectable"] is True and by_id["allen_bradley"]["connect_as"] == "allen_bradley"
    assert by_id["opc_ua"]["connectable"] is True and by_id["opc_ua"]["connect_as"] == "opc_ua"
    assert by_id["beckhoff"]["connectable"] is False
    assert payload["support"]["plc_types"] == PLC_SUPPORT
    assert payload["support"]["usable"] == REAL_PLC_TYPES
