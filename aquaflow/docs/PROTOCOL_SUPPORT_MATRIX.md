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
| OPC UA | **UNSUPPORTED** | No implementation exists. |
| BACnet | **UNSUPPORTED** | No implementation exists. |

## History (why this exists)

An independent review (AF-HUB-014 trigger) found the old `SUPPORTED` list claimed MQTT,
OPC UA, and BACnet were supported, and `MQTTDriver.connect()`/`send()` returned fake
success while doing nothing. Anyone reading the matrix would have believed MQTT worked. It
does not. This matrix and the fail-closed MQTT driver make the support status truthful.
