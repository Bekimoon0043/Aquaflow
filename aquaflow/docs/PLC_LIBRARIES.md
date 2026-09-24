# PLC integration libraries (bundled since 1.2.5)

AquaFlow's PLC panel (`Devices → PLC`) drives four controller families. Since
1.2.5 the three third-party protocol libraries ship **inside the engine**; there is
nothing to `pip install` on an operator PC.

| Family | Library in the bundle | Driver | Wire protocol |
|---|---|---|---|
| Siemens S7 | `python-snap7` 3.x (pure Python, no snap7.dll) + in-house raw S7comm fallback | `plc/plc_engine.py::SiemensS7Driver` | ISO-on-TCP / S7comm, TCP 102 |
| Modbus TCP | in-house `engine/modbus_client.py` | `ModbusTCPPLCDriver` | Modbus TCP, 502 |
| OPC UA | `asyncua` | `OPCUADriver` | OPC UA binary, 4840 |
| Allen-Bradley Logix | `pycomm3` | `AllenBradleyDriver` | EtherNet/IP + CIP Read/Write Tag, 44818 |

Delta / Mitsubishi / Omron connect through their Modbus TCP interface (said out loud in
the type picker). Beckhoff remains identify-only.

## Tag address formats

| Family | Address | Notes |
|---|---|---|
| Siemens S7 | `DB1.DBW0`, `DB1.DBD4`, `DB1.DBX2.0`, `DB1.DBB6` | Non-optimized DB, PUT/GET permitted. `DBD` is REAL when the tag type is REAL, else DWORD. Bits are read-modify-write of the byte. |
| OPC UA | NodeId string exactly as the server publishes it: `ns=3;s="DB_Fountain"."Pump1_Speed"`, `ns=2;i=1002` | Writes are typed from the node's own DataType (Boolean, Int16..UInt64, Float, Double, String). The IP field may hold the full endpoint, e.g. `opc.tcp://192.168.5.30:4840/OPCUA/Server`. |
| Allen-Bradley | Logix tag name: `Pump1_Speed`, `Speeds[2]`, `Program:MainProgram.Valve1` | Path = IP (+`:port` if not 44818) + `/slot` for a ControlLogix CPU not in slot 0. Types come from the controller's tag list when it serves one; otherwise the declared tag type is used (BOOL/INT/DINT/REAL; WORD→INT, DWORD→DINT). STRING and UDT members need the controller's tag list. |
| Modbus TCP | register/coil addresses as before | — |

Scale/offset apply to numeric values on read (`raw × scale + offset`) and are inverted on
write. Booleans are never scaled.

## Evidence status

| Driver | Tested against | Physical hardware |
|---|---|---|
| SiemensS7Driver (snap7 path) | `FakeS7Server` (in-house S7comm double): connect on the configured port, INT/REAL/BOOL write + read back | I-CAN site only; S7-1200 unverified |
| OPCUADriver | an `asyncua` Server in-process: Double/Boolean/Int32/Float typed reads and writes, scale/offset | none |
| AllenBradleyDriver | `cpppo` EtherNet/IP Logix simulator: connect, identity, typed reads with declared types; **writes unit-tested with a stub** (the simulator rejects pycomm3's connected Write Tag) | none |

Tests: `backend/tests/test_plc_libraries.py`, `test_plc_support.py`. The support matrix
that gates the type picker is `PLC_SUPPORT` in `plc/plc_engine.py`; `/api/plc/types`
and the frontend list mirror it and are pinned by test.

## Simulators for a bench test

- Siemens: TIA Portal + S7-PLCSIM needs **NetToPLCsim** (rack 0, slot 1) to be reachable;
  S7-PLCSIM Advanced (S7-1500) with a virtual Ethernet adapter is reachable directly.
- OPC UA: any server, e.g. `uaserver` from asyncua (`python -m asyncua.tools.uaserver`)
  or Prosys Simulation Server.
- Allen-Bradley: `python -m cpppo.server.enip -a 0.0.0.0:44818 Pump1_Speed=REAL Valve1=BOOL`
  (reads only; use Studio 5000 Logix Emulate or a real controller for writes).
