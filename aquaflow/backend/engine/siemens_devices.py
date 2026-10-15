"""Siemens device model: which PLC tag is which pump, valve, nozzle, light or safety input.

The Siemens site runtime (siemens_site.py) knows *channels* (pump/valve/light bank slots) and
their absolute %Q/%I addresses. This module adds the layer an operator thinks in:

* devices come from the Engineering design (pumps, valves, nozzles, lights, safety items);
* every device has named I/O points ("P01_Speed", "V03_Open", "SAFE_EStopOK") with a role;
* a hardware catalog of classic S7-1200 (G1, firmware V4.x) CPUs, signal boards and signal
  modules gives AquaFlow the real address space, so addresses can be assigned automatically;
* TIA Portal PLC tag tables can be exported (and imported + recognised) so TIA and AquaFlow
  use the same names;
* Show Programmer clips on nozzles are translated into valve/pump commands.

Nothing here talks to a PLC. Channel ids, bank indexes and the routing fields that make up
the site signature are only changed by explicit design sync / address assignment, and the
caller is told whenever the PLC program must be re-exported.
"""
from __future__ import annotations

import copy
import csv
import io
import math
import re

from engine.show_frame import expand_keyed_clips
from engine.siemens_site import (
    CAPACITY, CONTRACT, _tia_defaults, signature, validate_site,
)
from engine.siemens_contract import (
    LIGHT_COMMAND_OFFSET, LIGHT_FEEDBACK_OFFSET, PUMP_COMMAND_OFFSET, PUMP_FEEDBACK_OFFSET,
    PUMP_FAULT_OFFSET, PUMP_RUNNING_OFFSET, VALVE_COMMAND_OFFSET, VALVE_FEEDBACK_OFFSET,
)

SAFETY_INPUTS = {
    "estop_ok": ("SAFE_EStopOK", "Emergency stop chain healthy (1 = OK)"),
    "level_ok": ("SAFE_LevelOK", "Water level OK (1 = OK, low water = 0)"),
    "thermal_ok": ("SAFE_ThermalOK", "Motor thermal / overload OK (1 = OK)"),
    "drive_ok": ("SAFE_DriveOK", "Drive (VFD) ready, no trip (1 = OK)"),
    "pressure_ok": ("SAFE_PressureOK", "Pressure switch OK (1 = OK)"),
}

# role -> (site field, address kind, data type, signal suffix, human label, required)
ROLES = {
    "pump_speed": ("output", "AQ", "Int", "Speed", "Speed reference to the VFD (0..27648 = 0..100%)", True),
    "pump_run": ("enable_output", "DQ", "Bool", "Run", "Run / enable command to the VFD or contactor", True),
    "pump_running": ("feedback_input", "DI", "Bool", "Running", "Running feedback from the VFD", False),
    "pump_fault": ("fault_input", "DI", "Bool", "Fault", "Fault / trip input from the VFD", False),
    "valve_open": ("output", "DQ", "Bool", "Open", "Open command to the solenoid valve", True),
    "valve_feedback": ("feedback_input", "DI", "Bool", "OpenFB", "Valve open feedback (limit switch)", False),
    "light_rgb": ("output", "QB", "Byte", "RGB", "Red, green and blue bytes (3 consecutive output bytes)", True),
}
KIND_ROLES = {
    "pump": ("pump_speed", "pump_run", "pump_running", "pump_fault"),
    "valve": ("valve_open", "valve_feedback"),
    "light": ("light_rgb",),
}
TAG_PREFIX = {"pump": "P", "valve": "V", "light": "L"}
VIRTUAL_LIGHT_BYTE = 200

# ─── hardware catalog ─────────────────────────────────────────────────────────
# Classic S7-1200 G1 only (firmware V4.x): the generated PLC program and the runtime
# contract are validated for this family. G2 and F (safety) CPUs are not supported.

FAMILIES = {
    "s7-1200": {"label": "S7-1200 G1", "firmware": r"V4\.\d", "firmware_text": "V4.x",
                "addressing": "s7-1200", "slots": (2, 9)},
    "s7-1500": {"label": "S7-1500", "firmware": r"V(?:2\.[89]|3\.\d|4\.\d)", "firmware_text": "V2.8 or newer",
                "addressing": "sequential", "slots": (2, 31)},
    "et200sp": {"label": "ET 200SP CPU", "firmware": r"V(?:2\.[89]|3\.\d|4\.\d)", "firmware_text": "V2.8 or newer",
                "addressing": "sequential", "slots": (2, 65)},
}


def _cpu(cid, label, order, di, dq, ai, aq, outputs, max_sm, note="", family="s7-1200", onboard=None):
    return {"id": cid, "kind": "cpu", "family": family, "label": label, "order_number": order, "di": di, "dq": dq,
            "ai": ai, "aq": aq, "outputs": outputs, "max_modules": max_sm, "note": note, "onboard": onboard or {}}


def _mod(mid, kind, label, order, di=0, dq=0, ai=0, aq=0, outputs="", note="", family="s7-1200"):
    return {"id": mid, "kind": kind, "family": family, "label": label, "order_number": order, "di": di, "dq": dq,
            "ai": ai, "aq": aq, "outputs": outputs, "note": note}


HARDWARE_CATALOG = [
    _cpu("cpu_1211c_dcdcdc", "CPU 1211C DC/DC/DC", "6ES7 211-1AE40-0XB0", 6, 4, 2, 0, "transistor 24 V DC", 0,
         "No analog output and no room for signal modules. Too small for a fountain with pump speed control."),
    _cpu("cpu_1212c_dcdcdc", "CPU 1212C DC/DC/DC", "6ES7 212-1AE40-0XB0", 8, 6, 2, 0, "transistor 24 V DC", 2,
         "No built-in analog output: add an SB 1232 AQ signal board or an SM 1232 module for VFD speed."),
    _cpu("cpu_1212c_acdcrly", "CPU 1212C AC/DC/RLY", "6ES7 212-1BE40-0XB0", 8, 6, 2, 0, "relay", 2,
         "Relay outputs; no built-in analog output."),
    _cpu("cpu_1214c_dcdcdc", "CPU 1214C DC/DC/DC", "6ES7 214-1AG40-0XB0", 14, 10, 2, 0, "transistor 24 V DC", 8,
         "No built-in analog output: add an SB 1232 AQ or SM 1232 for VFD speed."),
    _cpu("cpu_1214c_acdcrly", "CPU 1214C AC/DC/RLY", "6ES7 214-1BG40-0XB0", 14, 10, 2, 0, "relay", 8,
         "Relay outputs; no built-in analog output."),
    _cpu("cpu_1215c_dcdcdc", "CPU 1215C DC/DC/DC", "6ES7 215-1AG40-0XB0", 14, 10, 2, 2, "transistor 24 V DC", 8,
         "Two built-in analog outputs (0-20 mA) for two VFD speed references."),
    _cpu("cpu_1215c_acdcrly", "CPU 1215C AC/DC/RLY", "6ES7 215-1BG40-0XB0", 14, 10, 2, 2, "relay", 8,
         "Relay outputs; two built-in analog outputs (0-20 mA)."),
    _cpu("cpu_1217c_dcdcdc", "CPU 1217C DC/DC/DC", "6ES7 217-1AG40-0XB0", 14, 10, 2, 2, "transistor 24 V DC", 8,
         "Two built-in analog outputs (0-20 mA)."),
    _mod("sb_1232_aq1", "sb", "SB 1232 AQ1 (signal board)", "6ES7 232-4HA30-0XB0", aq=1,
         note="One analog output (±10 V or 0-20 mA) on the front of the CPU. One per CPU."),
    _mod("sb_1223_di2dq2", "sb", "SB 1223 DI2/DQ2 (signal board)", "6ES7 223-0BD30-0XB0", di=2, dq=2,
         outputs="transistor 24 V DC"),
    _mod("sb_1221_di4", "sb", "SB 1221 DI4 (signal board)", "6ES7 221-3BD30-0XB0", di=4),
    _mod("sb_1222_dq4", "sb", "SB 1222 DQ4 (signal board)", "6ES7 222-1BD30-0XB0", dq=4,
         outputs="transistor 24 V DC"),
    _mod("sm_1221_di8", "sm", "SM 1221 DI8", "6ES7 221-1BF32-0XB0", di=8),
    _mod("sm_1221_di16", "sm", "SM 1221 DI16", "6ES7 221-1BH32-0XB0", di=16),
    _mod("sm_1222_dq8", "sm", "SM 1222 DQ8", "6ES7 222-1BF32-0XB0", dq=8, outputs="transistor 24 V DC"),
    _mod("sm_1222_dq16", "sm", "SM 1222 DQ16", "6ES7 222-1BH32-0XB0", dq=16, outputs="transistor 24 V DC"),
    _mod("sm_1222_dq8_rly", "sm", "SM 1222 DQ8 RLY", "6ES7 222-1HF32-0XB0", dq=8, outputs="relay"),
    _mod("sm_1222_dq16_rly", "sm", "SM 1222 DQ16 RLY", "6ES7 222-1HH32-0XB0", dq=16, outputs="relay"),
    _mod("sm_1223_di8dq8", "sm", "SM 1223 DI8/DQ8", "6ES7 223-1BH32-0XB0", di=8, dq=8, outputs="transistor 24 V DC"),
    _mod("sm_1223_di16dq16", "sm", "SM 1223 DI16/DQ16", "6ES7 223-1BL32-0XB0", di=16, dq=16,
         outputs="transistor 24 V DC"),
    _mod("sm_1231_ai4", "sm", "SM 1231 AI4", "6ES7 231-4HD32-0XB0", ai=4),
    _mod("sm_1231_ai8", "sm", "SM 1231 AI8", "6ES7 231-4HF32-0XB0", ai=8),
    _mod("sm_1232_aq2", "sm", "SM 1232 AQ2", "6ES7 232-4HB32-0XB0", aq=2,
         note="Two analog outputs (±10 V or 0-20 mA) for VFD speed references."),
    _mod("sm_1232_aq4", "sm", "SM 1232 AQ4", "6ES7 232-4HD32-0XB0", aq=4,
         note="Four analog outputs (±10 V or 0-20 mA) for VFD speed references."),
    _mod("sm_1234_ai4aq2", "sm", "SM 1234 AI4/AQ2", "6ES7 234-4HE32-0XB0", ai=4, aq=2),
    # S7-1500 — same S7comm/DB100 contract (PUT/GET, non-optimized DB, rack 0 / slot 1, OB200 cyclic).
    _cpu("cpu_1511_1pn", "CPU 1511-1 PN", "6ES7 511-1AL03-0AB0", 0, 0, 0, 0, "", 30,
         "No built-in I/O: add signal modules (DI/DQ/AQ) in the rack. 2-port PROFINET switch.", family="s7-1500"),
    _cpu("cpu_1513_1pn", "CPU 1513-1 PN", "6ES7 513-1AM03-0AB0", 0, 0, 0, 0, "", 30,
         "No built-in I/O; larger memory than the 1511.", family="s7-1500"),
    _cpu("cpu_1511c_1pn", "CPU 1511C-1 PN (compact)", "6ES7 511-1CL03-0AB0", 16, 16, 5, 2, "transistor 24 V DC", 30,
         "Compact CPU with built-in 16 DI / 16 DQ / 5 AI / 2 AQ — two pump speeds without extra modules.",
         family="s7-1500", onboard={"ai": 0, "aq": 0, "di": 10, "dq": 4}),
    _cpu("cpu_1512c_1pn", "CPU 1512C-1 PN (compact)", "6ES7 512-1CM03-0AB0", 32, 32, 5, 2, "transistor 24 V DC", 30,
         "Compact CPU with built-in 32 DI / 32 DQ / 5 AI / 2 AQ.",
         family="s7-1500", onboard={"ai": 0, "aq": 0, "di": 10, "dq": 4}),
    _mod("s1500_di16", "sm", "DI 16x24VDC BA (S7-1500)", "6ES7 521-1BH10-0AA0", di=16, family="s7-1500"),
    _mod("s1500_dq16", "sm", "DQ 16x24VDC/0.5A BA (S7-1500)", "6ES7 522-1BH10-0AA0", dq=16,
         outputs="transistor 24 V DC", family="s7-1500"),
    _mod("s1500_ai8", "sm", "AI 8xU/I/RTD/TC ST (S7-1500)", "6ES7 531-7KF00-0AB0", ai=8, family="s7-1500"),
    _mod("s1500_aq4", "sm", "AQ 4xU/I ST (S7-1500)", "6ES7 532-5HD00-0AB0", aq=4, family="s7-1500",
         note="Four analog outputs (0-10 V / 4-20 mA) for VFD speed references."),
    # ET 200SP CPU — distributed compact controller, same contract.
    _cpu("cpu_1510sp_1pn", "CPU 1510SP-1 PN (ET 200SP)", "6ES7 510-1DK03-0AB0", 0, 0, 0, 0, "", 64,
         "ET 200SP CPU: add ET 200SP I/O modules on BaseUnits. Needs a BusAdapter for the PROFINET ports.",
         family="et200sp"),
    _mod("sp_di8", "sm", "DI 8x24VDC ST (ET 200SP)", "6ES7 131-6BF01-0BA0", di=8, family="et200sp"),
    _mod("sp_di16", "sm", "DI 16x24VDC ST (ET 200SP)", "6ES7 131-6BH01-0BA0", di=16, family="et200sp"),
    _mod("sp_dq8", "sm", "DQ 8x24VDC/0.5A ST (ET 200SP)", "6ES7 132-6BF01-0BA0", dq=8,
         outputs="transistor 24 V DC", family="et200sp"),
    _mod("sp_dq16", "sm", "DQ 16x24VDC/0.5A ST (ET 200SP)", "6ES7 132-6BH01-0BA0", dq=16,
         outputs="transistor 24 V DC", family="et200sp"),
    _mod("sp_aq2", "sm", "AQ 2xU/I HS (ET 200SP)", "6ES7 135-6HB00-0DA1", aq=2, family="et200sp",
         note="Two analog outputs for VFD speed references."),
]
CATALOG = {item["id"]: item for item in HARDWARE_CATALOG}
CATALOG_NOTE = ("Addresses are the TIA Portal defaults. S7-1200: CPU I/O from byte 0 / word 64, signal board "
                "byte 4 / word 80, signal module slot 2 from byte 8 / word 96, +4 bytes / +16 bytes per slot. "
                "S7-1500 and ET 200SP: TIA numbers inputs and outputs consecutively from 0 in slot order "
                "(compact CPUs: built-in analog at 0, digital inputs from byte 10, digital outputs from byte 4). "
                "If you changed a start address in TIA device configuration, enter it here.")


def default_hardware():
    return {"cpu": "cpu_1215c_dcdcdc", "firmware": "V4.4", "signal_board": "", "modules": []}


def validate_hardware(hardware):
    hardware = copy.deepcopy(hardware or {})
    cpu = CATALOG.get(hardware.get("cpu"))
    if not cpu or cpu["kind"] != "cpu":
        raise ValueError("Choose a CPU from the list (S7-1200 G1, S7-1500 or ET 200SP)")
    family = FAMILIES[cpu["family"]]
    hardware["firmware"] = str(hardware.get("firmware") or ("V4.4" if cpu["family"] == "s7-1200" else "V3.1")).strip()[:16]
    if not re.fullmatch(family["firmware"], hardware["firmware"]):
        if cpu["family"] == "s7-1200":
            raise ValueError("AquaFlow supports classic S7-1200 G1 CPUs (order numbers ending -x40-0XB0) with "
                             "firmware V4.x. Note: S7-1200 G2 (-x50) also uses V4.x firmware and is not supported yet.")
        raise ValueError(f"{family['label']} CPUs need firmware {family['firmware_text']} for this AquaFlow contract")
    board = hardware.get("signal_board") or ""
    if board and (board not in CATALOG or CATALOG[board]["kind"] != "sb"):
        raise ValueError("Unknown signal board")
    if board and cpu["family"] != "s7-1200":
        raise ValueError("Signal boards exist only on the S7-1200")
    hardware["signal_board"] = board
    modules, slots = [], set()
    for entry in hardware.get("modules") or []:
        item = CATALOG.get(entry.get("catalog"))
        if not item or item["kind"] != "sm":
            raise ValueError("Unknown signal module")
        if item["family"] != cpu["family"]:
            raise ValueError(f"{item['label']} does not fit a {family['label']} CPU")
        low, high = family["slots"]
        slot = int(entry.get("slot") or (max(slots, default=1) + 1))
        if not low <= slot <= high or slot in slots:
            raise ValueError(f"Signal modules use unique slots {low}..{high}")
        slots.add(slot)
        clean = {"catalog": item["id"], "slot": slot}
        for key in ("di_start", "dq_start", "ai_start", "aq_start"):
            if entry.get(key) not in (None, ""):
                clean[key] = int(entry[key])
                if not 0 <= clean[key] <= 1023:
                    raise ValueError(f"{key} must be 0..1023")
        modules.append(clean)
    if len(modules) > cpu["max_modules"]:
        raise ValueError(f"{cpu['label']} accepts at most {cpu['max_modules']} signal module(s)")
    hardware["modules"] = sorted(modules, key=lambda m: m["slot"])
    return hardware


def hardware_points(hardware):
    """Every physical I/O point of a hardware configuration, in assignment preference order."""
    hardware = validate_hardware(hardware)
    points = []

    def digital(kind, start_byte, count, owner, slot):
        prefix = "%I" if kind == "DI" else "%Q"
        for n in range(count):
            points.append({"type": kind, "address": f"{prefix}{start_byte + n // 8}.{n % 8}",
                           "module": owner, "slot": slot, "channel": n})

    def analog(kind, start_word, count, owner, slot):
        prefix = "%IW" if kind == "AI" else "%QW"
        for n in range(count):
            points.append({"type": kind, "address": f"{prefix}{start_word + n * 2}",
                           "module": owner, "slot": slot, "channel": n})

    cpu = CATALOG[hardware["cpu"]]
    if FAMILIES[cpu["family"]]["addressing"] == "sequential":
        _sequential_points(hardware, cpu, digital, analog)
        return _no_overlap(points)
    digital("DI", 0, cpu["di"], cpu["label"], 1)
    digital("DQ", 0, cpu["dq"], cpu["label"], 1)
    analog("AI", 64, cpu["ai"], cpu["label"], 1)
    analog("AQ", 64, cpu["aq"], cpu["label"], 1)
    if hardware["signal_board"]:
        board = CATALOG[hardware["signal_board"]]
        digital("DI", 4, board["di"], board["label"], "SB")
        digital("DQ", 4, board["dq"], board["label"], "SB")
        analog("AI", 80, board["ai"], board["label"], "SB")
        analog("AQ", 80, board["aq"], board["label"], "SB")
    for module in hardware["modules"]:
        item, slot = CATALOG[module["catalog"]], module["slot"]
        label = f"{item['label']} (slot {slot})"
        byte, word = 8 + (slot - 2) * 4, 96 + (slot - 2) * 16
        digital("DI", module.get("di_start", byte), item["di"], label, slot)
        digital("DQ", module.get("dq_start", byte), item["dq"], label, slot)
        analog("AI", module.get("ai_start", word), item["ai"], label, slot)
        analog("AQ", module.get("aq_start", word), item["aq"], label, slot)
    return _no_overlap(points)


def _no_overlap(points):
    seen = set()
    for point in points:
        if point["address"] in seen:
            raise ValueError(f"Two modules use {point['address']}; check the start addresses")
        seen.add(point["address"])
    return points


def _sequential_points(hardware, cpu, digital, analog):
    """S7-1500 / ET 200SP: TIA gives each module the next free bytes of the I and Q areas, from 0,
    in slot order. Compact CPUs keep their built-in analog at 0 and digital I/O at bytes 10 (in) / 4 (out)."""
    next_in = next_out = 0
    if cpu["onboard"]:
        onboard = cpu["onboard"]
        analog("AI", onboard["ai"], cpu["ai"], cpu["label"], 1)
        analog("AQ", onboard["aq"], cpu["aq"], cpu["label"], 1)
        digital("DI", onboard["di"], cpu["di"], cpu["label"], 1)
        digital("DQ", onboard["dq"], cpu["dq"], cpu["label"], 1)
        next_in = max(onboard["ai"] + 2 * cpu["ai"], onboard["di"] + math.ceil(cpu["di"] / 8))
        next_out = max(onboard["aq"] + 2 * cpu["aq"], onboard["dq"] + math.ceil(cpu["dq"] / 8))
    for module in hardware["modules"]:
        item, slot = CATALOG[module["catalog"]], module["slot"]
        label = f"{item['label']} (slot {slot})"
        if item["di"]:
            start = module.get("di_start", next_in)
            digital("DI", start, item["di"], label, slot)
            next_in = max(next_in, start + math.ceil(item["di"] / 8))
        if item["ai"]:
            start = module.get("ai_start", next_in)
            analog("AI", start, item["ai"], label, slot)
            next_in = max(next_in, start + 2 * item["ai"])
        if item["dq"]:
            start = module.get("dq_start", next_out)
            digital("DQ", start, item["dq"], label, slot)
            next_out = max(next_out, start + math.ceil(item["dq"] / 8))
        if item["aq"]:
            start = module.get("aq_start", next_out)
            analog("AQ", start, item["aq"], label, slot)
            next_out = max(next_out, start + 2 * item["aq"])


# ─── tags ─────────────────────────────────────────────────────────────────────

def channel_tag(channel):
    tag = str(channel.get("tag") or "").strip()
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,23}", tag):
        return tag
    return f"{TAG_PREFIX[channel['kind']]}{channel['index'] + 1:02d}"


def plc_tag_name(channel, role):
    custom = (channel.get("plc_tags") or {}).get(role)
    if custom:
        return custom
    return f"{channel_tag(channel)}_{ROLES[role][3]}"


def _db_address(site, channel, role):
    db, i = site["plc"]["db"], channel["index"]
    return {
        "pump_speed": f"DB{db}.DBW{PUMP_COMMAND_OFFSET + 2 * i}",
        "pump_run": f"DB{db}.DBW{PUMP_COMMAND_OFFSET + 2 * i} > 0",
        "pump_running": f"DB{db}.DBX{PUMP_RUNNING_OFFSET + i // 8}.{i % 8}",
        "pump_fault": f"DB{db}.DBX{PUMP_FAULT_OFFSET + i // 8}.{i % 8}",
        "valve_open": f"DB{db}.DBX{VALVE_COMMAND_OFFSET + i // 8}.{i % 8}",
        "valve_feedback": f"DB{db}.DBX{VALVE_FEEDBACK_OFFSET + i // 8}.{i % 8}",
        "light_rgb": f"DB{db}.DBB{LIGHT_COMMAND_OFFSET + 3 * i}..{LIGHT_COMMAND_OFFSET + 3 * i + 2}",
    }[role]


def io_points(site):
    """Flat, human-readable list of every device signal and where it is wired."""
    by_address = {}
    if site.get("hardware"):
        try:
            by_address = {p["address"]: p for p in hardware_points(site["hardware"])}
        except ValueError:
            by_address = {}
    points = []
    for channel in site["channels"]:
        for role in KIND_ROLES[channel["kind"]]:
            field, addr_type, data_type, _, label, required = ROLES[role]
            address = channel.get(field) or ""
            where = by_address.get(address)
            note = ""
            if channel["kind"] == "light":
                note = ("RGB bytes for a light interface (DMX/analog). Not a physical CPU output."
                        if not where else "")
            elif address and by_address and not where:
                note = "Address is not on the selected hardware"
            points.append({
                "device_id": channel["id"], "device_name": channel.get("name", ""), "kind": channel["kind"],
                "tag": channel_tag(channel), "role": role, "label": label, "required": required,
                "direction": "input" if addr_type == "DI" else "output", "data_type": data_type,
                "address": address, "plc_tag": plc_tag_name(channel, role),
                "module": where["module"] if where else "", "slot": where["slot"] if where else "",
                "module_channel": where["channel"] if where else None,
                "db_address": _db_address(site, channel, role), "note": note,
                "fixture_id": channel.get("fixture_id") or "", "nozzle_ids": channel.get("nozzle_ids") or [],
                "pump_id": channel.get("pump_id") or "",
            })
    for key, (tag, label) in SAFETY_INPUTS.items():
        address = site.get("inputs", {}).get(key) or ""
        where = by_address.get(address)
        points.append({
            "device_id": f"safety:{key}", "device_name": label.split(" (")[0], "kind": "safety",
            "tag": "SAFE", "role": key, "label": label, "required": True, "direction": "input",
            "data_type": "Bool", "address": address, "plc_tag": tag,
            "module": where["module"] if where else "", "slot": where["slot"] if where else "",
            "module_channel": where["channel"] if where else None, "db_address": "",
            "note": "" if address else "Unwired: the PLC program will treat this permit as missing",
            "fixture_id": (site.get("safety_devices") or {}).get(key, ""), "nozzle_ids": [], "pump_id": "",
        })
    return points


# ─── design → devices ─────────────────────────────────────────────────────────

SAFETY_KEYWORDS = (
    ("estop_ok", ("emergency", "estop", "e_stop", "e-stop")),
    ("level_ok", ("level", "float")),
    ("pressure_ok", ("pressure",)),
    ("thermal_ok", ("thermal", "overload", "temperature")),
)


def _design_kind(device):
    category = str(device.get("category") or "").lower()
    kind = str(device.get("type") or "").lower()
    if category == "pumps" or kind.startswith("pump"):
        return "pump"
    if category == "valves" or kind.startswith("valve"):
        return "valve"
    if category == "nozzles" or kind.startswith("nozzle"):
        return "nozzle"
    if category == "lights" or kind.startswith("light"):
        return "light"
    if category in ("safety", "sensors") or kind.startswith(("safety", "sensor")):
        return "safety"
    return "other"


def _distance(a, b):
    try:
        return math.hypot(float(a.get("x", 0)) - float(b.get("x", 0)), float(a.get("y", 0)) - float(b.get("y", 0)))
    except (TypeError, ValueError):
        return 0.0


def _nearest(item, candidates):
    return min(candidates, key=lambda c: _distance(item, c)) if candidates else None


def design_devices(devices, options=None):
    """Turn Engineering fixtures into Siemens channels + a report a person can read.

    `devices` is a list of {id, type, category, label, x, y, zone, linkedValveId?, supplyingPumpId?}.
    Nozzles are switched by solenoid valves: a nozzle uses its linked valve, else the nearest valve
    placed in the design, else AquaFlow creates one valve per nozzle.
    """
    options = options or {}
    default_max = float(options.get("max_percent", 40))
    show_percent = float(options.get("show_percent", 30))
    groups = {"pump": [], "valve": [], "nozzle": [], "light": [], "safety": [], "other": []}
    seen = set()
    for device in devices or []:
        did = str(device.get("id") or "").strip()
        if not did or did in seen:
            continue
        seen.add(did)
        groups[_design_kind(device)].append(device)
    notes, unsupported = [], []
    channels = []
    pumps = groups["pump"]
    if not pumps and (groups["valve"] or groups["nozzle"]):
        pumps = [{"id": "aquaflow-main-pump", "label": "Main pump", "x": 0, "y": 0, "implied": True}]
        notes.append("Your design has no pump. AquaFlow added 'Main pump'; add a pump in Engineering to "
                     "replace it.")
    valves = [dict(v) for v in groups["valve"]]
    placed_valves = list(valves)
    valve_by_id = {v["id"]: v for v in valves}
    nozzle_links = {}
    implied_valves = 0
    for nozzle in groups["nozzle"]:
        linked = valve_by_id.get(nozzle.get("linkedValveId"))
        if not linked and placed_valves:
            linked = _nearest(nozzle, placed_valves)
        if not linked:
            linked = {"id": f"{nozzle['id']}-valve", "label": f"Valve for {nozzle.get('label') or nozzle['id']}",
                      "x": nozzle.get("x", 0), "y": nozzle.get("y", 0), "zone": nozzle.get("zone", ""),
                      "implied": True, "supplyingPumpId": nozzle.get("supplyingPumpId")}
            valves.append(linked)
            valve_by_id[linked["id"]] = linked
            implied_valves += 1
        nozzle_links.setdefault(linked["id"], []).append(nozzle["id"])
    if implied_valves:
        notes.append(f"{implied_valves} nozzle(s) have no valve in the design, so AquaFlow gave each one its "
                     "own solenoid valve.")
    pump_ids = {p["id"] for p in pumps}
    auto_linked = 0
    for valve in valves:
        if valve.get("supplyingPumpId") not in pump_ids:
            valve["supplyingPumpId"] = _nearest(valve, pumps)["id"]
            auto_linked += 1
    if auto_linked:
        notes.append(f"{auto_linked} valve(s) were linked to the nearest pump. Change the supplying pump in "
                     "the I/O map if the pipework is different.")
    supplied = {v["supplyingPumpId"] for v in valves}
    dropped = [p for p in pumps if p["id"] not in supplied]
    for pump in dropped:
        notes.append(f"{pump.get('label') or pump['id']} feeds no valve or nozzle, so it is not controlled. "
                     "Every Siemens pump must have at least one outlet (the PLC will not run a pump "
                     "against closed valves).")
    pumps = [p for p in pumps if p["id"] in supplied]
    lights = groups["light"]
    for kind, items in (("pump", pumps), ("valve", valves), ("light", lights)):
        if len(items) > CAPACITY[kind]:
            raise ValueError(f"The Siemens contract supports at most {CAPACITY[kind]} {kind}s; "
                             f"the design has {len(items)}")
    for index, pump in enumerate(pumps):
        channels.append({"id": pump["id"], "fixture_id": "" if pump.get("implied") else pump["id"],
                         "name": pump.get("label") or f"Pump {index + 1}", "kind": "pump", "index": index,
                         "zone": pump.get("zone") or "", "tag": f"P{index + 1:02d}",
                         "max_percent": default_max, "show_percent": min(show_percent, default_max)})
    for index, valve in enumerate(valves):
        channels.append({"id": valve["id"], "fixture_id": "" if valve.get("implied") else valve["id"],
                         "name": valve.get("label") or f"Valve {index + 1}", "kind": "valve", "index": index,
                         "zone": valve.get("zone") or "", "tag": f"V{index + 1:02d}",
                         "pump_id": valve["supplyingPumpId"], "nozzle_ids": nozzle_links.get(valve["id"], []),
                         "max_percent": default_max})
    for index, light in enumerate(lights):
        channels.append({"id": light["id"], "fixture_id": light["id"],
                         "name": light.get("label") or f"Light {index + 1}", "kind": "light", "index": index,
                         "zone": light.get("zone") or "", "tag": f"L{index + 1:02d}", "max_percent": default_max})
    safety_devices = {}
    for item in groups["safety"]:
        text = f"{item.get('type', '')} {item.get('label', '')}".lower()
        for key, words in SAFETY_KEYWORDS:
            if key not in safety_devices and any(w in text for w in words):
                safety_devices[key] = item["id"]
                break
    for item in groups["other"]:
        unsupported.append({"id": item["id"], "label": item.get("label") or item["id"], "type": item.get("type", ""),
                            "reason": "Not a pump, valve, nozzle or RGB light, so the Siemens contract cannot "
                                      "drive it. Control it through its own interface."})
    for channel in channels:
        channel.setdefault("output", "")
        channel.setdefault("enable_output", "")
        channel.setdefault("feedback_input", "")
        channel.setdefault("fault_input", "")
        channel.setdefault("min_on_ms", 500)
        channel.setdefault("min_off_ms", 500)
        channel.setdefault("commissioned", False)
        channel.setdefault("observation", "")
    return {"channels": channels, "safety_devices": safety_devices, "unsupported": unsupported, "notes": notes,
            "counts": {"pumps": len(pumps), "valves": len(valves), "nozzles": len(groups["nozzle"]),
                       "lights": len(lights), "unsupported": len(unsupported)}}


def site_from_design(name, devices, *, project_id="", options=None, hardware=None, site_id=None):
    import uuid
    result = design_devices(devices, options)
    if not result["channels"]:
        raise ValueError("The design has no pumps, valves, nozzles or lights for a Siemens PLC to control")
    site = {"id": site_id or str(uuid.uuid4()), "name": name or "Fountain", "revision": 1, "contract": CONTRACT,
            "mode": "simulated",
            "plc": {"ip": "", "port": 102, "rack": 0, "slot": 1, "db": 100,
                    "expected_order_number": "", "expected_firmware": ""},
            "tia": _tia_defaults(), "inputs": {}, "channels": result["channels"], "show": None,
            "safety_devices": result["safety_devices"],
            "source": {"kind": "engineering", "project_id": project_id},
            "hardware": validate_hardware(hardware or default_hardware())}
    return validate_site(site), result


def sync_from_design(site, devices, options=None):
    """Re-read the design into an existing site, keeping addresses and commissioning of known devices."""
    result = design_devices(devices, options)
    old = {c["id"]: c for c in site["channels"]}
    keep = ("output", "enable_output", "feedback_input", "fault_input", "max_percent", "show_percent",
            "min_on_ms", "min_off_ms", "commissioned", "observation", "plc_tags", "tag")
    used = {kind: {c["index"] for c in site["channels"] if c["kind"] == kind and c["id"] in
                   {n["id"] for n in result["channels"]}} for kind in CAPACITY}
    added, kept = [], []
    channels = []
    for new in result["channels"]:
        previous = old.get(new["id"])
        if previous and previous["kind"] == new["kind"]:
            merged = {**new, **{k: previous[k] for k in keep if k in previous}, "index": previous["index"]}
            kept.append(new["id"])
        else:
            free = next(i for i in range(CAPACITY[new["kind"]]) if i not in used[new["kind"]])
            used[new["kind"]].add(free)
            merged = {**new, "index": free, "tag": f"{TAG_PREFIX[new['kind']]}{free + 1:02d}"}
            added.append(new["id"])
        channels.append(merged)
    removed = [c["id"] for c in site["channels"] if c["id"] not in {n["id"] for n in channels}]
    updated = copy.deepcopy(site)
    updated["channels"] = channels
    updated["safety_devices"] = {**(site.get("safety_devices") or {}), **result["safety_devices"]}
    updated.setdefault("source", {"kind": "engineering", "project_id": ""})
    updated = validate_site(updated)
    result.update(added=added, removed=removed, kept=kept,
                  program_changed=signature(updated) != signature(site))
    return updated, result


# ─── automatic address assignment ─────────────────────────────────────────────

def assign_addresses(site, hardware=None, options=None):
    """Assign every device signal to a free point of the chosen hardware.

    Returns (site, report). Required signals that do not fit are reported with the module to add.
    Existing addresses that lie on the hardware are kept unless options.reassign_all is true.
    """
    options = options or {}
    site = copy.deepcopy(site)
    hardware = validate_hardware(hardware or site.get("hardware") or default_hardware())
    site["hardware"] = hardware
    points = hardware_points(hardware)
    free = {kind: [p for p in points if p["type"] == kind] for kind in ("DI", "DQ", "AI", "AQ")}
    by_address = {p["address"]: p for p in points}
    keep_existing = not options.get("reassign_all")
    pump_feedback = options.get("pump_feedback", True)
    pump_fault = options.get("pump_fault", True)
    valve_feedback = options.get("valve_feedback", False)
    wire_safety = options.get("safety_inputs", True)

    taken = set()
    if keep_existing:
        for channel in site["channels"]:
            for field in ("output", "enable_output", "feedback_input", "fault_input"):
                if channel.get(field) in by_address:
                    taken.add(channel[field])
        for address in (site.get("inputs") or {}).values():
            if address in by_address:
                taken.add(address)
    for kind in free:
        free[kind] = [p for p in free[kind] if p["address"] not in taken]

    missing = {"DI": 0, "DQ": 0, "AQ": 0}
    skipped = []
    assigned = 0

    def take(kind):
        return free[kind].pop(0)["address"] if free[kind] else None

    def place(target, field, kind, required, label):
        nonlocal assigned
        current = target.get(field) or ""
        if keep_existing and current in by_address:
            return
        address = take(kind)
        if address:
            target[field] = address
            assigned += 1
        else:
            target[field] = ""
            if required:
                missing[kind] += 1
            else:
                skipped.append(label)

    inputs = site.setdefault("inputs", {})
    if wire_safety:
        for key in SAFETY_INPUTS:
            place(inputs, key, "DI", True, key)
    pumps = [c for c in site["channels"] if c["kind"] == "pump"]
    valves = [c for c in site["channels"] if c["kind"] == "valve"]
    for pump in pumps:
        place(pump, "enable_output", "DQ", True, f"{pump['name']} run")
        place(pump, "output", "AQ", True, f"{pump['name']} speed")
    for valve in valves:
        place(valve, "output", "DQ", True, f"{valve['name']} open")
    if pump_feedback:
        for pump in pumps:
            place(pump, "feedback_input", "DI", False, f"{pump['name']} running feedback")
    if pump_fault:
        for pump in pumps:
            place(pump, "fault_input", "DI", False, f"{pump['name']} fault input")
    if valve_feedback:
        for valve in valves:
            place(valve, "feedback_input", "DI", False, f"{valve['name']} open feedback")
    # RGB fixtures need a light interface; keep them in a clearly virtual byte area.
    light_byte = int(options.get("light_start_byte", VIRTUAL_LIGHT_BYTE))
    for light in sorted((c for c in site["channels"] if c["kind"] == "light"), key=lambda c: c["index"]):
        light["output"] = f"%QB{light_byte}"
        light_byte += 3

    suggestions = _hardware_suggestions(hardware, missing)
    report = {
        "assigned": assigned, "missing": {k: v for k, v in missing.items() if v}, "skipped_optional": skipped,
        "suggestions": suggestions, "complete": not any(missing.values()),
        "notes": [CATALOG_NOTE] + (["RGB lights use virtual output bytes from %QB200. They need a DMX/analog "
                                    "light interface programmed in TIA; a bare CPU cannot dim RGB lights."]
                                   if any(c["kind"] == "light" for c in site["channels"]) else []),
    }
    if not report["complete"]:
        return site, report  # do not validate a half-wired site as final
    try:
        site = validate_site(site)
    except ValueError as exc:
        report["complete"] = False
        report["error"] = str(exc)
    return site, report


def _hardware_suggestions(hardware, missing):
    cpu = CATALOG[hardware["cpu"]]
    room = cpu["max_modules"] - len(hardware["modules"])
    if cpu["family"] != "s7-1200":
        return _family_suggestions(cpu, missing, room)
    out = []
    if missing.get("AQ"):
        if not hardware["signal_board"] and missing["AQ"] == 1:
            out.append({"add": "sb_1232_aq1", "why": "1 more analog output for a pump speed reference"})
        else:
            count = math.ceil(missing["AQ"] / 4)
            out.append({"add": "sm_1232_aq4", "count": count,
                        "why": f"{missing['AQ']} more analog output(s) for pump speed references"})
    if missing.get("DQ"):
        count = math.ceil(missing["DQ"] / 16)
        out.append({"add": "sm_1222_dq16", "count": count,
                    "why": f"{missing['DQ']} more digital output(s) for valves and pump run commands"})
    if missing.get("DI"):
        count = math.ceil(missing["DI"] / 16)
        out.append({"add": "sm_1221_di16", "count": count,
                    "why": f"{missing['DI']} more digital input(s) for safety inputs"})
    needed = sum(s.get("count", 1) for s in out if CATALOG[s["add"]]["kind"] == "sm")
    for suggestion in out:
        item = CATALOG[suggestion["add"]]
        suggestion.update(label=item["label"], order_number=item["order_number"])
    if needed > room:
        out.append({"add": "", "label": "Bigger CPU", "order_number": "",
                    "why": f"{cpu['label']} has room for {room} more module(s) but {needed} are needed. "
                           "Choose a CPU 1214C/1215C (8 module slots)."})
    return out


def _family_suggestions(cpu, missing, room):
    modules = {"s7-1500": ("s1500_aq4", 4, "s1500_dq16", 16, "s1500_di16", 16),
               "et200sp": ("sp_aq2", 2, "sp_dq16", 16, "sp_di16", 16)}[cpu["family"]]
    aq_id, aq_n, dq_id, dq_n, di_id, di_n = modules
    out = []
    for kind, module, per, why in (("AQ", aq_id, aq_n, "analog output(s) for pump speed references"),
                                   ("DQ", dq_id, dq_n, "digital output(s) for valves and pump run commands"),
                                   ("DI", di_id, di_n, "digital input(s) for safety inputs")):
        if missing.get(kind):
            item = CATALOG[module]
            out.append({"add": module, "count": math.ceil(missing[kind] / per), "label": item["label"],
                        "order_number": item["order_number"], "why": f"{missing[kind]} more {why}"})
    if sum(s["count"] for s in out) > room:
        out.append({"add": "", "label": "More module slots", "order_number": "",
                    "why": f"{cpu['label']} has room for {room} more module(s)."})
    return out


def hardware_bom(hardware):
    hardware = validate_hardware(hardware)
    lines = [{"item": CATALOG[hardware["cpu"]]["label"], "order_number": CATALOG[hardware["cpu"]]["order_number"],
              "firmware": hardware["firmware"], "position": "slot 1", "family": CATALOG[hardware["cpu"]]["family"]}]
    if hardware["signal_board"]:
        board = CATALOG[hardware["signal_board"]]
        lines.append({"item": board["label"], "order_number": board["order_number"], "position": "signal board"})
    for module in hardware["modules"]:
        item = CATALOG[module["catalog"]]
        lines.append({"item": item["label"], "order_number": item["order_number"], "position": f"slot {module['slot']}"})
    return lines


# ─── TIA PLC tag table export ─────────────────────────────────────────────────

TIA_TAG_HEADERS = ["Name", "Path", "Data Type", "Logical Address", "Comment",
                   "Hmi Visible", "Hmi Accessible", "Hmi Writeable", "Typeobject ID", "Version ID"]


def tag_rows(site, table="AquaFlow"):
    rows = []
    for point in io_points(site):
        if not point["address"]:
            continue
        if point["role"] == "light_rgb":
            base = int(point["address"][3:])
            for offset, colour in enumerate(("Red", "Green", "Blue")):
                rows.append([point["plc_tag"].replace("_RGB", f"_{colour}"), table, "Byte", f"%QB{base + offset}",
                             f"AquaFlow: {point['device_name']} {colour.lower()} (0-255)"])
            continue
        comment = f"AquaFlow: {point['device_name']} - {point['label']}"
        if point["kind"] == "valve" and point["nozzle_ids"]:
            comment += f" ({len(point['nozzle_ids'])} nozzle(s))"
        rows.append([point["plc_tag"], table, point["data_type"], point["address"], comment[:500]])
    return rows


def tia_tag_table_xlsx(site, table="AquaFlow"):
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.title = "PLC Tags"
    sheet.append(TIA_TAG_HEADERS)
    for row in tag_rows(site, table):
        sheet.append(row + ["True", "True", "True", "", ""])
    constants = book.create_sheet("User Constants")
    constants.append(["Name", "Path", "Data Type", "Value", "Comment"])
    for column in ("A", "B", "C", "D", "E"):
        sheet.column_dimensions[column].width = {"A": 22, "B": 12, "C": 10, "D": 16, "E": 60}[column]
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def tag_table_csv(site):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Name", "Path", "Data Type", "Logical Address", "Comment"])
    writer.writerows(tag_rows(site))
    return out.getvalue()


# ─── TIA tag table import + recognition ───────────────────────────────────────

def read_tag_table(data, filename=""):
    """Read a TIA 'PLC Tags' export (.xlsx) or a CSV with Name / Data Type / Logical Address / Comment."""
    rows = []
    if filename.lower().endswith(".xlsx") or data[:2] == b"PK":
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheets = [book["PLC Tags"]] if "PLC Tags" in book.sheetnames else book.worksheets
        for sheet in sheets:
            rows.extend([[("" if v is None else str(v)) for v in row] for row in sheet.iter_rows(values_only=True)])
    else:
        text = data.decode("utf-8-sig", errors="replace")
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t") if text.strip() else csv.excel
        rows = [row for row in csv.reader(io.StringIO(text), dialect)]
    header_at = next((i for i, row in enumerate(rows)
                      if any(str(c).strip().lower() == "name" for c in row)
                      and any("address" in str(c).strip().lower() for c in row)), None)
    if header_at is None:
        raise ValueError("No 'Name' and 'Logical Address' columns found. Export the PLC tag table from TIA "
                         "Portal (PLC tags → Export) and import that file.")
    header = [str(c).strip().lower() for c in rows[header_at]]

    def col(*names):
        return next((i for i, h in enumerate(header) if h in names), None)

    name_i, addr_i = col("name"), col("logical address", "address")
    type_i, comment_i = col("data type", "datatype", "type"), col("comment")
    tags = []
    for row in rows[header_at + 1:]:
        if name_i is None or name_i >= len(row) or not str(row[name_i]).strip():
            continue
        get = lambda i: str(row[i]).strip() if i is not None and i < len(row) else ""
        tags.append({"name": get(name_i), "address": get(addr_i).upper().replace(" ", ""),
                     "data_type": get(type_i), "comment": get(comment_i)})
    if len(tags) > 5000:
        raise ValueError("Tag table has more than 5000 tags")
    return tags


_WORDS = {
    "pump": ("pump", "pmp", "vfd", "motor", "inverter", "drive"),
    "speed": ("speed", "spd", "freq", "hz", "ref", "setpoint", "rpm", "velocity"),
    "run": ("run", "start", "enable", "en", "on", "cmd", "command"),
    "running": ("running", "runfb", "fb", "feedback", "status", "isrunning", "run_fb"),
    "fault": ("fault", "trip", "alarm", "flt", "err", "error"),
    "valve": ("valve", "vlv", "sv", "solenoid", "sol", "nozzle", "noz", "jet", "outlet"),
    "light": ("light", "led", "lamp", "rgb", "lt", "spot"),
}
_SAFETY_WORDS = (
    ("estop_ok", ("estop", "e_stop", "emergency", "emstop", "notaus", "not_aus", "emergencystop")),
    ("level_ok", ("level", "float", "lvl", "lowwater", "low_water", "waterlow")),
    ("thermal_ok", ("thermal", "overload", "thermistor", "ptc", "motorprotect", "temp")),
    ("drive_ok", ("drive_ok", "driveok", "vfd_ok", "vfdok", "vfdready", "drive_ready", "inverter_ok")),
    ("pressure_ok", ("pressure", "press", "psw", "pr_sw")),
)


def _address_shape(address):
    if re.fullmatch(r"%Q\d+\.[0-7]", address):
        return "DQ"
    if re.fullmatch(r"%I\d+\.[0-7]", address):
        return "DI"
    if re.fullmatch(r"%QW\d+", address):
        return "AQ"
    if re.fullmatch(r"%IW\d+", address):
        return "AI"
    if re.fullmatch(r"%QB\d+", address):
        return "QB"
    return "other"


def _tokens(text):
    text = re.sub(r"([a-z])([A-Z])", r"\1_\2", text)
    text = re.sub(r"(\d+)", r"_\1_", text)
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if t]


def _has(tokens, joined, words):
    return any(w in tokens or (len(w) > 3 and w in joined) for w in words)


def recognize_tag(tag):
    """Guess what one PLC tag controls. Returns role, device kind/number, confidence and why."""
    name, comment, address = tag.get("name", ""), tag.get("comment", ""), tag.get("address", "")
    shape = _address_shape(address)
    result = {**tag, "shape": shape, "role": "", "kind": "", "number": None, "safety": "",
              "colour": "", "confidence": 0.0, "reason": ""}
    convention = re.fullmatch(r"(P|V|L)(\d{1,3})_(Speed|Run|Running|Fault|Open|OpenFB|Red|Green|Blue)",
                              name, re.IGNORECASE)
    if convention:
        prefix, number, signal = convention[1].upper(), int(convention[2]), convention[3].lower()
        role = {("P", "speed"): "pump_speed", ("P", "run"): "pump_run", ("P", "running"): "pump_running",
                ("P", "fault"): "pump_fault", ("V", "open"): "valve_open", ("V", "openfb"): "valve_feedback",
                ("L", "red"): "light_rgb", ("L", "green"): "light_rgb", ("L", "blue"): "light_rgb"}.get((prefix, signal))
        if role:
            result.update(role=role, kind={"P": "pump", "V": "valve", "L": "light"}[prefix], number=number,
                          colour=signal if prefix == "L" else "", confidence=.98,
                          reason="AquaFlow tag naming convention")
            return _check_shape(result)
    safe = re.fullmatch(r"SAFE_(EStop|Level|Thermal|Drive|Pressure)OK", name, re.IGNORECASE)
    if safe:
        key = f"{safe[1].lower()}_ok"
        result.update(safety=key, role="safety", kind="safety", confidence=.98, reason="AquaFlow tag naming convention")
        return _check_shape(result)
    tokens = _tokens(f"{name} {comment}")
    joined = "_".join(tokens)
    number_match = re.search(r"(\d+)", name) or re.search(r"(\d+)", comment)
    number = int(number_match[1]) if number_match else None
    for key, words in _SAFETY_WORDS:
        if _has(tokens, joined, words) and shape in ("DI", "AI"):
            if shape == "AI":
                result.update(reason="Analog sensor: AquaFlow's Siemens site uses digital OK inputs. "
                                     "Wire a switch or set a threshold in the PLC.", confidence=.3)
                return result
            result.update(safety=key, role="safety", kind="safety", confidence=.8,
                          reason=f"Name/comment mentions {key.replace('_ok', '').replace('estop', 'emergency stop')}")
            return result
    is_pump, is_valve, is_light = (_has(tokens, joined, _WORDS[k]) for k in ("pump", "valve", "light"))
    if is_light and shape == "QB":
        colour = next((c for c in ("red", "green", "blue") if c in tokens or c[0] in tokens[1:]), "")
        result.update(role="light_rgb", kind="light", number=number, colour=colour, confidence=.75 if colour else .55,
                      reason="Light tag on an output byte")
        return result
    if is_pump:
        if shape == "AQ":
            result.update(role="pump_speed", kind="pump", number=number,
                          confidence=.85 if _has(tokens, joined, _WORDS["speed"]) else .65,
                          reason="Pump/VFD tag on an analog output")
        elif shape == "DQ":
            result.update(role="pump_run", kind="pump", number=number,
                          confidence=.8 if _has(tokens, joined, _WORDS["run"]) else .6,
                          reason="Pump/VFD tag on a digital output")
        elif shape == "DI" and _has(tokens, joined, _WORDS["fault"]):
            result.update(role="pump_fault", kind="pump", number=number, confidence=.8,
                          reason="Pump/VFD fault on a digital input")
        elif shape == "DI":
            result.update(role="pump_running", kind="pump", number=number,
                          confidence=.75 if _has(tokens, joined, _WORDS["running"]) else .55,
                          reason="Pump/VFD feedback on a digital input")
        if result["role"]:
            return result
    if is_valve:
        if shape == "DQ":
            result.update(role="valve_open", kind="valve", number=number, confidence=.8,
                          reason="Valve/nozzle tag on a digital output")
        elif shape == "DI":
            result.update(role="valve_feedback", kind="valve", number=number, confidence=.65,
                          reason="Valve tag on a digital input")
        if result["role"]:
            return result
    result["reason"] = "Not recognised as a pump, valve, light or safety signal"
    return result


def _check_shape(result):
    expected = {"pump_speed": "AQ", "pump_run": "DQ", "pump_running": "DI", "pump_fault": "DI", "valve_open": "DQ",
                "valve_feedback": "DI", "light_rgb": "QB", "safety": "DI"}[result["role"]]
    if result["shape"] != expected:
        result["confidence"] = .3
        result["reason"] += f"; but {result['address'] or 'no address'} is not a {expected} address"
    return result


def suggest_mapping(site, tags):
    """Recognise every tag and propose which site device / safety input it should drive."""
    recognised = [recognize_tag(t) for t in tags]
    channels = {kind: sorted((c for c in site["channels"] if c["kind"] == kind), key=lambda c: c["index"])
                for kind in CAPACITY}
    numbers = {kind: sorted({r["number"] for r in recognised if r["kind"] == kind and r["number"] is not None})
               for kind in CAPACITY}
    for r in recognised:
        r["target"] = ""
        if r["role"] == "safety":
            r["target"] = f"safety:{r['safety']}"
        elif r["kind"] in channels and r["role"]:
            pool = channels[r["kind"]]
            by_tag = next((c for c in pool if r["number"] is not None and
                           channel_tag(c).upper() == f"{TAG_PREFIX[r['kind']]}{r['number']:02d}"), None)
            if by_tag:
                r["target"] = by_tag["id"]
            elif r["number"] is not None and r["number"] in numbers[r["kind"]]:
                rank = numbers[r["kind"]].index(r["number"])
                if rank < len(pool):
                    r["target"] = pool[rank]["id"]
        r["accepted"] = bool(r["target"]) and r["confidence"] >= .7
    lights = {}
    for r in recognised:
        if r["role"] == "light_rgb" and r["target"]:
            lights.setdefault(r["target"], {})[r["colour"] or "red"] = r
    for target, colours in lights.items():
        red = colours.get("red")
        if red:
            base = int(red["address"][3:])
            ok = all(colours.get(c) and int(colours[c]["address"][3:]) == base + i
                     for i, c in enumerate(("red", "green", "blue")) if c in colours)
            if not ok:
                for r in colours.values():
                    r.update(accepted=False, reason=r["reason"] + "; red/green/blue must be 3 consecutive bytes")
    summary = {"tags": len(recognised), "recognised": sum(1 for r in recognised if r["role"]),
               "matched": sum(1 for r in recognised if r["target"]),
               "auto_accepted": sum(1 for r in recognised if r["accepted"])}
    return {"suggestions": recognised, "summary": summary}


def apply_mapping(site, accepted):
    """Apply operator-confirmed tag → device links. Each item: {target, role, address, name, colour?}."""
    site = copy.deepcopy(site)
    channels = {c["id"]: c for c in site["channels"]}
    applied = 0
    for item in accepted:
        target, role, address = item.get("target", ""), item.get("role", ""), str(item.get("address", "")).upper()
        if target.startswith("safety:"):
            key = target.split(":", 1)[1]
            if key not in SAFETY_INPUTS:
                raise ValueError(f"Unknown safety input {key}")
            site.setdefault("inputs", {})[key] = address
            applied += 1
            continue
        channel = channels.get(target)
        if not channel or role not in KIND_ROLES[channel["kind"]]:
            raise ValueError(f"{item.get('name') or address} cannot drive that device")
        if role == "light_rgb":
            colour = item.get("colour") or "red"
            if colour != "red":
                continue  # the red byte is the base; green/blue follow it
        channel[ROLES[role][0]] = address
        if item.get("name"):
            channel.setdefault("plc_tags", {})[role] = str(item["name"])[:64]
        applied += 1
    return validate_site(site), applied


# ─── show translation (nozzles → valves, pump follows its outlets) ─────────────

LEVEL_TRACKS = {"pump_speed", "pump_pressure", "device_intensity", "device_enable", "solenoid_open",
                "motion_intensity", "solenoid_duration"}
LIGHT_TRACKS = {"lighting_master", "lighting_red", "lighting_green", "lighting_blue"}


def translate_show(site, clips):
    """Convert Show Programmer clips on design items into Siemens channel clips.

    * clips on a nozzle open its valve while the level is above zero (valves are on/off);
    * clips on a valve or pump pass through (pump speed is capped at its ceiling);
    * a pump without its own speed clips follows its outlets: it runs at its show speed while any of
      its valves is open;
    * valve windows are merged and stretched to respect minimum on/off times.
    """
    channels = {c["id"]: c for c in site["channels"]}
    valve_of_nozzle = {n: c["id"] for c in site["channels"] if c["kind"] == "valve" for n in c.get("nozzle_ids") or []}
    windows = {c["id"]: [] for c in site["channels"] if c["kind"] == "valve"}
    pump_clips, light_clips = {}, []
    report = {"input": len(clips), "nozzle_clips": 0, "ignored": 0, "ignored_devices": [], "capped": 0,
              "stretched": 0, "merged": 0, "auto_pumps": []}
    for clip in expand_keyed_clips(clips):   # keyed clips -> constant clips (values read below)
        if clip.get("muted") is True or clip.get("disabled") is True:
            continue
        fid, kind = clip.get("fixtureId"), clip.get("type", "")
        try:
            start = max(0.0, float(clip.get("startTime", 0)))
            duration = float(clip.get("duration", 0))
            value = float(clip.get("value", 0))
        except (TypeError, ValueError):
            report["ignored"] += 1
            continue
        if duration <= 0:
            continue
        channel = channels.get(fid)
        if fid in valve_of_nozzle and kind in LEVEL_TRACKS:
            report["nozzle_clips"] += 1
            if value > 0:
                windows[valve_of_nozzle[fid]].append([start, start + duration])
        elif channel and channel["kind"] == "valve" and kind in LEVEL_TRACKS:
            if value > 0:
                windows[fid].append([start, start + duration])
        elif channel and channel["kind"] == "pump" and kind in LEVEL_TRACKS:
            capped = min(value, channel["max_percent"])
            report["capped"] += capped < value
            pump_clips.setdefault(fid, []).append({**_base(clip), "fixtureId": fid, "type": "pump_speed",
                                                   "startTime": start, "duration": duration, "value": capped})
        elif channel and channel["kind"] == "light" and kind in LIGHT_TRACKS:
            light_clip = {**_base(clip), "fixtureId": fid, "type": kind, "startTime": start,
                          "duration": duration, "value": max(0.0, min(100.0, value))}
            # AF-NEXT-004: keep the programmed colour so it reaches the RGB output bytes.
            if isinstance(clip.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", clip["color"]):
                light_clip["color"] = clip["color"].lower()
            light_clips.append(light_clip)
        else:
            report["ignored"] += 1
            if fid and fid not in report["ignored_devices"]:
                report["ignored_devices"].append(fid)
    out = []
    for vid, spans in windows.items():
        valve = channels[vid]
        min_on = valve["min_on_ms"] / 1000
        stretched = []
        for begin, end in spans:
            if end - begin < min_on:
                end = begin + min_on
                report["stretched"] += 1
            stretched.append([begin, end])
        merged = _merge_windows(stretched, valve["min_off_ms"] / 1000, report)
        for begin, end in merged:
            out.append({"fixtureId": vid, "type": "solenoid_open", "startTime": round(begin, 3),
                        "duration": round(min(end, 1800) - begin, 3), "value": 100, "fadeIn": 0, "fadeOut": 0})
        windows[vid] = merged
    for pump in (c for c in site["channels"] if c["kind"] == "pump"):
        own = pump_clips.get(pump["id"])
        if own:
            out.extend(_flatten_pump(own))
            continue
        spans = [w for c in site["channels"] if c.get("pump_id") == pump["id"] for w in windows.get(c["id"], [])]
        speed = min(float(pump.get("show_percent", 30)), pump["max_percent"])
        for begin, end in _merge_windows(spans, 0, None):
            out.append({"fixtureId": pump["id"], "type": "pump_speed", "startTime": round(begin, 3),
                        "duration": round(min(end, 1800) - begin, 3), "value": speed, "fadeIn": 0, "fadeOut": 0})
        if spans:
            report["auto_pumps"].append({"pump": pump["name"], "percent": speed})
    out.extend(light_clips)
    report["output"] = len(out)
    return out, report


def _base(clip):
    return {"fadeIn": float(clip.get("fadeIn", 0) or 0), "fadeOut": float(clip.get("fadeOut", 0) or 0)}


def _merge_windows(spans, min_gap, report):
    merged = []
    for begin, end in sorted(spans):
        if merged and begin - merged[-1][1] < max(min_gap, 1e-6):
            if report is not None and begin > merged[-1][1]:
                report["merged"] += 1
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([begin, end])
    return merged


def _flatten_pump(clips):
    """Overlapping speed clips on one pump: later clips win where they overlap."""
    clips = sorted(clips, key=lambda c: c["startTime"])
    out = []
    for clip in clips:
        if out and out[-1]["startTime"] + out[-1]["duration"] > clip["startTime"]:
            previous = out[-1]
            previous["duration"] = round(clip["startTime"] - previous["startTime"], 3)
            if previous["duration"] <= 0.1:
                out.pop()
            else:
                previous["fadeOut"] = min(previous["fadeOut"], previous["duration"])
                previous["fadeIn"] = min(previous["fadeIn"], previous["duration"] - previous["fadeOut"])
        out.append(dict(clip))
    return out
