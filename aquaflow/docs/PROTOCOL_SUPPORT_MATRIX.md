# AquaFlow Protocol Support Matrix (AF-HUB-014)

Honest, four-tier classification of every control protocol the code references. The
authoritative source is `engine/protocol_bus.py::PROTOCOL_SUPPORT`; this document must
match it (and the live `GET /api/hardware/protocols` endpoint).

## Tiers

| Tier | Meaning |
| --- | --- |
| **REAL** | Implemented + tested driver. *Field* verification on real fixtures is a separate gate (the hardware-commissioning flag, AF-HUB-000C) — "REAL protocol" ≠ "hardware commissioned". |
| **SIMULATED** | Loopback only, not field-real. |
| **GATED** | Code exists but is explicitly disabled — cannot connect or send. |
| **UNSUPPORTED** | Not implemented at all. |

## Matrix

| Protocol | Tier | Notes |
| --- | --- | --- |
| DMX512 | **REAL** | Driven via the Art-Net/sACN path; loopback-verified in `hardware_verifier`. |
| Art-Net | **REAL** | `protocols/artnet_driver.py`; loopback-verified. |
| sACN (E1.31) | **REAL** | `protocols/sacn_driver.py`; loopback-verified. |
| Modbus TCP | **REAL** | `ModbusTCPDriver`; drives pumps/valves/flame. |
| MQTT | **GATED** | `MQTTDriver` is a stub. AF-HUB-014 disabled it: `connect()`/`send()` fail closed (return False, never fake success). `add_device("mqtt", …)` is refused. Do not re-enable without a real, tested implementation. |
| OPC UA | **UNSUPPORTED** (as a bus transport) | No protocol-bus transport exists. Note: the separate **PLC subsystem** has a real OPC UA *client* driver (`plc/plc_engine.py::OPCUADriver`) for reading/writing PLC tags — it requires the optional `asyncua` library and **fails closed** (connect returns False) when it is not installed. That PLC tag client is not a show-output transport and does not change this matrix. |
| BACnet | **UNSUPPORTED** | No implementation exists. |

### Discovery-only protocols (read-only identification, not show transports)

| Protocol | Tier | Notes |
| --- | --- | --- |
| PROFINET DCP Identify | **REAL** (identify) | `engine/profinet_dcp.py`. One Identify-All frame per scan on the selected adapter; no Set/Get/Hello/Signal exists. Windows needs the user-installed **Npcap** runtime (not bundled — see `docs/PROFINET_DCP_WINDOWS.md`); Linux uses AF_PACKET. Fails closed with an install hint. |
| S7comm identify (COTP + setup + SZL) | **REAL** (identify) | `engine/s7_identify.py`, strictly validated, read-only. |
| Modbus FC43/14 identify | **REAL** (identify) | `engine/modbus_client.py::read_device_identification_full`. |
| EtherNet/IP ListIdentity | **REAL** (identify-only) | `engine/enip_identify.py`; Allen-Bradley remains not drivable. |
| I-CAN gateway probe | **REAL** (identify) | The existing read-only 0x03 poll in `engine/ican_discovery.py`; control lives in the unchanged Fountain Control implementation. |

## History (why this exists)

An independent review (AF-HUB-014 trigger) found the old `SUPPORTED` list claimed MQTT,
OPC UA, and BACnet were supported, and `MQTTDriver.connect()`/`send()` returned fake
success while doing nothing. Anyone reading the matrix would have believed MQTT worked. It
does not. This matrix and the fail-closed MQTT driver make the support status truthful.
