# AquaFlow ↔ S7-1215C Data Block Contract (AF-IO-005)

The published interface between AquaFlow's field I/O and the SIMATIC S7-1200 rack
(CPU 1215C DC/DC/DC, 6ES7215-1AG40-0XB0). The TIA-side engineer builds exactly this;
AquaFlow's default field-point config addresses exactly this. Neither side invents
addresses.

## The three settings that break everything when missed

1. **DB1 must be NON-OPTIMIZED.** Block properties → uncheck **"Optimized block
   access"**. Absolute addressing (`DB1.DBW0`) does not exist for an optimized
   block; every AquaFlow read will fail with an access error that looks like wiring
   trouble.
2. **Enable PUT/GET.** CPU properties → Protection & Security → Connection
   mechanisms → tick **"Permit access with PUT/GET communication from remote
   partner"**. Default is OFF on FW 4.x, and with it off every S7comm read fails.
3. **The heartbeat is a COUNTER the PLC increments** (cyclic OB, ~100 ms:
   `"AquaFlowIO".HEARTBEAT := "AquaFlowIO".HEARTBEAT + 1;`). A constant value
   proves nothing — a HALTED CPU serves static reads forever. AquaFlow judges PLC
   liveness on this value *changing*.

Network: PLC on **192.168.5.x** (e.g. `.10`), same subnet as the control PC
(`192.168.5.200`) and the I-CAN gateway (`192.168.5.2`). The CPU's two PROFINET
ports are a switch — PC → PLC → gateway chains without extra hardware.

## DB1 "AquaFlowIO" (non-optimized)

| Address    | Name            | Type | Dir (PLC view) | Meaning |
|------------|-----------------|------|----------------|---------|
| `DBW0`     | HEARTBEAT       | UInt | out            | +1 every cyclic pass (~100 ms), wraps at 65535 |
| `DBX2.0`   | ESTOP_OK        | Bool | out            | 1 = E-stop chain closed (monitor ONLY — the chain itself stays hardwired) |
| `DBX2.1`   | VFD_OK          | Bool | out            | 1 = ZONCEN VFD fault relay closed |
| `DBX2.2`   | THERMAL_OK      | Bool | out            | 1 = thermal contacts closed |
| `DBX2.3`   | LEVEL_FLOAT_OK  | Bool | out            | 1 = low-level float switch closed |
| `DBW4`     | LEVEL_RAW       | Int  | out            | raw AI counts, 0..27648 |
| `DBW6`     | PRESSURE_RAW    | Int  | out            | raw AI counts, 0..27648 |
| `DBW8`     | FLOW_RAW        | Int  | out            | raw AI counts, 0..27648 |
| `DBW10`    | VFD_SPEED_FB    | Int  | out            | speed feedback raw counts |
| `DBW12`    | CMD_PUMP_SPEED  | Int  | **in**         | AquaFlow → PLC: AO reference, 0..27648 (AF-IO-009) |
| `DBW14`    | CMD_FLAGS       | Word | **in**         | AquaFlow → PLC: bit 0 = output enable |

Spare space to `DBB63`; extend by appending, never by re-numbering.

## Analog channels

* The 1215C's **2 onboard AI are 0–10 V** — a cut wire reads 0 V, indistinguishable
  from a genuine zero, so AquaFlow performs **no broken-wire detection** on them.
* The **SM 1231 AI 8×13-bit (6ES7231-4HF32-0XB0)** is the recommended module:
  channel-configurable **4–20 mA**, where below 3.5 mA AquaFlow marks the point
  `FAULT` (broken loop ≠ empty tank). Copy raw channel words into the RAW fields
  above; scaling to engineering units lives in AquaFlow's field-point config.
* The 2 onboard **AO are 0–20 mA**. If the ZONCEN's speed reference input is
  0–10 V, use its current input or a 500 Ω dropping resistor — confirm against the
  ZONCEN terminal spec before wiring (AF-IO-009).

## Matching AquaFlow field-point config (`data/field_points.json`)

```json
{ "version": "1.0", "points": [
  {"id": "plc_hb",     "source": "s7:192.168.5.10", "address": "DB1.DBW0",
   "kind": "AI", "required": true,  "binds_to": "heartbeat"},
  {"id": "estop",      "source": "s7:192.168.5.10", "address": "DB1.DBX2.0",
   "kind": "DI", "raw_type": "bool", "required": true, "binds_to": "estop_chain_closed"},
  {"id": "vfd_ok",     "source": "s7:192.168.5.10", "address": "DB1.DBX2.1",
   "kind": "DI", "raw_type": "bool", "binds_to": "vfd_ok"},
  {"id": "thermal_ok", "source": "s7:192.168.5.10", "address": "DB1.DBX2.2",
   "kind": "DI", "raw_type": "bool", "binds_to": "thermal_ok"},
  {"id": "level",      "source": "s7:192.168.5.10", "address": "DB1.DBW4",
   "kind": "AI", "scale": 0.0000723, "unit": "m", "binds_to": "water_level_ok"},
  {"id": "pressure",   "source": "s7:192.168.5.10", "address": "DB1.DBW6",
   "kind": "AI", "scale": 0.000362, "unit": "bar", "binds_to": "pressure_ok"}
]}
```

`required` starts **false** on everything except the heartbeat and E-stop monitor;
flip it true per sensor as each is physically commissioned — that flip is the
commissioning acceptance step (AF-IO-004 withdraws the master permit whenever a
required point is not GOOD).

## Safety boundary (unchanged by any of this)

Reading the E-stop over S7comm is **monitoring**. The hardwired chain to the
SSR/contactor supply remains the thing that removes power; AquaFlow's read of it
stops the show and lights the UI, never more.

## TIA commissioning checklist

- [ ] DB1 created as above, **non-optimized**, downloaded
- [ ] Cyclic heartbeat increment running (watch DBW0 count in a watch table)
- [ ] PUT/GET permitted (Protection & Security → Connection mechanisms)
- [ ] CPU IP set on 192.168.5.x; reachable from the control PC (ping)
- [ ] AI raw words copied into DBW4/6/8 in OB1
- [ ] DI states copied into DBX2.x
- [ ] AquaFlow Field I/O panel shows the points GOOD with moving values
- [ ] Pull one sensor plug → its point goes FAULT/STALE and (if required) the
      permit drops — this is the acceptance test for AF-IO-004
