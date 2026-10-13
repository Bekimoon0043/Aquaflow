"""Persisted Siemens sites and a versioned absolute-address command contract.

This namespace deliberately has no dependency on I-CAN or its hardware profiles.
"""
from __future__ import annotations

import copy
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import struct
import uuid
import zlib

from engine.show_frame import evaluate_show_frame_at, valid_hex
from engine.siemens_contract import (
    CONTRACT_VERSION, DB_SIZE, LIGHT_CAPACITY, LIGHT_COMMAND_OFFSET, PUMP_CAPACITY,
    PUMP_COMMAND_OFFSET, PUMP_MODE_OFFSET, VALVE_CAPACITY,
    VALVE_COMMAND_OFFSET, blank_command,
)

CONTRACT = "aquaflow-siemens-site-v1"
CAPACITY = {"pump": PUMP_CAPACITY, "valve": VALVE_CAPACITY, "light": LIGHT_CAPACITY}


def _tia_defaults():
    return {
        "version": 20,
        "project_name": "AquaFlowSite",
        "device_name": "AquaFlowPLC",
        "cpu_name": "PLC_1",
        "cpu_type_identifier": "",
        "modules": [],
        "network_interface": "",
    }


def finite(value, name, low, high):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def integer(value, name, low, high):
    number = finite(value, name, low, high)
    if number != int(number):
        raise ValueError(f"{name} must be an integer")
    return int(number)


def validate_site(site):
    site = copy.deepcopy(site)
    if site.get("contract") != CONTRACT:
        raise ValueError("Unsupported Siemens site contract")
    if site.get("mode") not in ("simulated", "plcsim", "physical"):
        raise ValueError("Choose internal simulation, PLCSIM network, or physical mode")
    if not str(site.get("name", "")).strip():
        raise ValueError("Site name is required")
    plc = site["plc"]
    plc["db"] = integer(plc["db"], "DB", 100, 65535)
    plc["port"] = integer(plc.get("port", 102), "Port", 1, 65535)
    plc["rack"] = integer(plc.get("rack", 0), "Rack", 0, 7)
    plc["slot"] = integer(plc.get("slot", 1), "Slot", 0, 31)
    plc["expected_order_number"] = str(plc.get("expected_order_number", "")).strip()[:80]
    plc["expected_firmware"] = str(plc.get("expected_firmware", "")).strip()[:32]
    if site["mode"] in ("plcsim", "physical"):
        ip = ipaddress.IPv4Address(plc.get("ip", ""))
        if ip.is_unspecified or ip.is_multicast or ip.is_loopback or int(ip) == 0xFFFFFFFF:
            raise ValueError("Networked Siemens modes require a unicast PLC or bridge IPv4 address")
    tia = site.setdefault("tia", _tia_defaults())
    for key, default in _tia_defaults().items():
        tia.setdefault(key, copy.deepcopy(default))
    tia["version"] = integer(tia["version"], "TIA Portal version", 17, 21)
    for key, label in (("project_name", "TIA project name"), ("device_name", "TIA device name"),
                       ("cpu_name", "TIA CPU name")):
        value = str(tia.get(key, "")).strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", value):
            raise ValueError(f"{label} must start with a letter and contain only letters, digits or underscore")
        tia[key] = value
    identifier = str(tia.get("cpu_type_identifier", "")).strip()
    if identifier and (not identifier.startswith("OrderNumber:") or len(identifier) > 160 or any(c in identifier for c in "\r\n")):
        raise ValueError("CPU TypeIdentifier must be copied exactly from the TIA hardware catalog")
    tia["cpu_type_identifier"] = identifier
    tia["network_interface"] = str(tia.get("network_interface", "")).strip()[:160]
    modules = tia.get("modules")
    if not isinstance(modules, list) or len(modules) > 64:
        raise ValueError("TIA modules must be a list of at most 64 entries")
    seen_positions = set()
    for module in modules:
        if not isinstance(module, dict):
            raise ValueError("Every TIA module must be an object")
        module["position"] = integer(module.get("position"), "Module position", 1, 65535)
        if module["position"] in seen_positions:
            raise ValueError("TIA module positions must be unique")
        seen_positions.add(module["position"])
        module["name"] = str(module.get("name", "")).strip()
        module["type_identifier"] = str(module.get("type_identifier", "")).strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", module["name"]):
            raise ValueError("TIA module names must start with a letter and contain only letters, digits or underscore")
        if (not module["type_identifier"].startswith("OrderNumber:") or
                len(module["type_identifier"]) > 160 or any(c in module["type_identifier"] for c in "\r\n")):
            raise ValueError("Module TypeIdentifier must be copied exactly from the TIA hardware catalog")
    ids, banks, addresses = set(), set(), set()
    for channel in site["channels"]:
        kind = channel.get("kind")
        if kind not in CAPACITY:
            raise ValueError("Channels must be pumps, valves or lights")
        channel["index"] = integer(channel["index"], "Channel index", 0, CAPACITY[kind] - 1)
        if not channel.get("id") or channel["id"] in ids or (kind, channel["index"]) in banks:
            raise ValueError("Duplicate channel id or bank index")
        ids.add(channel["id"])
        banks.add((kind, channel["index"]))
        channel["max_percent"] = finite(channel.get("max_percent", 40), "Maximum percent", 1, 100)
        channel["min_on_ms"] = integer(channel.get("min_on_ms", 500), "Minimum on time", 100, 30000)
        channel["min_off_ms"] = integer(channel.get("min_off_ms", 500), "Minimum off time", 100, 30000)
        channel["commissioned"] = channel.get("commissioned") is True
        if kind != "pump" and channel.get("enable_output"):
            raise ValueError("Only pumps have a separate enable output")
        if channel["commissioned"] and not str(channel.get("observation", "")).strip():
            raise ValueError("Commissioning requires an observed physical response")
        output_pattern = {"pump": r"%QW\d+", "valve": r"%Q\d+\.[0-7]", "light": r"%QB\d+"}[kind]
        for field, pattern in (("output", output_pattern),
                               ("enable_output", r"%Q\d+\.[0-7]")):
            address = str(channel.get(field, "")).strip().upper()
            if address and not re.fullmatch(pattern, address):
                raise ValueError(f"Invalid {field}: pumps use %QW, valves/enables %Qx.y, and RGB lights %QB")
            channel[field] = address
            if address:
                # Detect overlapping byte/bit locations, including QW versus Q bit.
                match = re.fullmatch(r"%QW(\d+)", address)
                light_match = re.fullmatch(r"%QB(\d+)", address)
                if match:
                    locations = {(int(match[1]) + b, bit) for b in range(2) for bit in range(8)}
                elif light_match:
                    locations = {(int(light_match[1]) + b, bit) for b in range(3) for bit in range(8)}
                else:
                    locations = {tuple(map(int, address[2:].split(".")))}
                if addresses & locations:
                    raise ValueError("Overlapping physical output addresses")
                addresses |= locations
        for field in ("feedback_input", "fault_input"):
            address = str(channel.get(field, "")).strip().upper()
            if address and not re.fullmatch(r"%I\d+\.[0-7]", address):
                raise ValueError(f"{field} must be a digital %Ix.y input")
            channel[field] = address
    pumps = {c["id"] for c in site["channels"] if c["kind"] == "pump"}
    for channel in site["channels"]:
        if channel["kind"] == "valve" and channel.get("pump_id") not in pumps:
            raise ValueError("Every valve must name its supplying pump")
    for pump in (c for c in site["channels"] if c["kind"] == "pump"):
        if not any(c.get("pump_id") == pump["id"] for c in site["channels"]):
            raise ValueError("Every pump requires at least one mapped outlet valve")
    inputs = site.setdefault("inputs", {})
    for name in ("estop_ok", "level_ok", "thermal_ok", "drive_ok", "pressure_ok"):
        address = str(inputs.get(name, "")).strip().upper()
        if address and not re.fullmatch(r"%I\d+\.[0-7]", address):
            raise ValueError(f"{name} must be a digital %Ix.y input")
        inputs[name] = address
    return site


def signature(site):
    # Labels and observations do not change the PLC program; routing and limits do.
    fields = ("id", "kind", "index", "pump_id", "output", "enable_output", "feedback_input",
              "fault_input", "max_percent", "min_on_ms", "min_off_ms")
    program = {"contract": CONTRACT, "wire_contract": CONTRACT_VERSION,
               "id": site["id"], "db": site["plc"]["db"], "inputs": site["inputs"],
               "tia_hardware": {"cpu": site.get("tia", {}).get("cpu_type_identifier", ""),
                                "modules": site.get("tia", {}).get("modules", [])},
               "channels": [{k: c.get(k) for k in fields} for c in site["channels"]]}
    return zlib.crc32(json.dumps(program, sort_keys=True).encode()) & 0xFFFFFFFF


def create_site(name="New Siemens Test Site", pumps=1, valves=4, lights=0, mode="simulated", ip="", db=100):
    pumps = integer(pumps, "Pumps", 1, 16)
    valves = integer(valves, "Valves", pumps, 512)
    lights = integer(lights, "Lights", 0, LIGHT_CAPACITY)
    sid = str(uuid.uuid4())
    channels = []
    for kind, count in (("pump", pumps), ("valve", valves), ("light", lights)):
        for index in range(count):
            channel = {"id": f"{sid}-{kind}-{index + 1}", "name": f"{kind.title()} {index + 1}",
                       "kind": kind, "index": index, "zone": "Test zone", "output": "", "enable_output": "",
                       "feedback_input": "", "fault_input": "",
                       "max_percent": 40, "min_on_ms": 500, "min_off_ms": 500,
                       "commissioned": False, "observation": ""}
            if kind == "valve":
                channel["pump_id"] = f"{sid}-pump-{index % pumps + 1}"
            channels.append(channel)
    return validate_site({"id": sid, "name": name, "revision": 1, "contract": CONTRACT, "mode": mode,
                          "plc": {"ip": ip, "port": 102, "rack": 0, "slot": 1, "db": db,
                                  "expected_order_number": "", "expected_firmware": ""},
                          "tia": _tia_defaults(), "inputs": {}, "channels": channels, "show": None})


def create_tia_plcsim_test(name="TIA V17 PLCSIM Test - 20s", tia_version=17):
    """Create the smallest useful Siemens lab project with no physical network output.

    The addresses are intentionally obvious test addresses.  They are not a claim about
    any customer's cabinet and must be replaced before physical commissioning.
    """
    site = create_site(name=name, pumps=1, valves=2, lights=0, mode="simulated", db=100)
    site["tia"]["version"] = integer(tia_version, "TIA Portal version", 17, 21)
    site["tia"].update({
        "project_name": "AquaFlowSimpleTest",
        "device_name": "AquaFlowPLC",
        "cpu_name": "PLC_1",
    })
    pump = next(channel for channel in site["channels"] if channel["kind"] == "pump")
    valves = [channel for channel in site["channels"] if channel["kind"] == "valve"]
    pump.update(name="Test Pump 1", zone="PLCSIM test", output="%QW64",
                enable_output="%Q0.0", max_percent=30)
    for index, valve in enumerate(valves, 1):
        valve.update(name=f"Test Valve {index}", zone="PLCSIM test",
                     output=f"%Q0.{index}", pump_id=pump["id"])
    site = validate_site(site)
    clips = [
        {"fixtureId": pump["id"], "type": "pump_speed", "startTime": 0,
         "duration": 20, "value": 20, "fadeIn": 0, "fadeOut": 0},
        {"fixtureId": valves[0]["id"], "type": "solenoid_open", "startTime": 0,
         "duration": 10, "value": 100, "fadeIn": 0, "fadeOut": 0},
        {"fixtureId": valves[1]["id"], "type": "solenoid_open", "startTime": 10,
         "duration": 10, "value": 100, "fadeIn": 0, "fadeOut": 0},
    ]
    site["show"] = compile_show(site, clips)
    return site


def create_1212c_starter(name="CPU 1212C fountain starter - simulation", tia_version=17):
    site = create_tia_plcsim_test(name, tia_version)
    site["tia"]["project_name"] = "AquaFlow1212CStarter"
    site["inputs"] = dict(zip(
        ("estop_ok", "level_ok", "thermal_ok", "drive_ok", "pressure_ok"),
        (f"%I0.{bit}" for bit in range(5))))
    site["starter_profile"] = {
        "cpu": "Classic S7-1200 CPU 1212C DC/DC/DC",
        "purpose": "Simulation only; exact catalog order number and firmware must be selected in TIA",
        "analog_output": "%QW64 is virtual. CPU 1212C has no built-in AO; select and configure compatible hardware before physical use.",
    }
    # Do not guess the purchased order number, firmware, module or physical IP.
    site = validate_site(site)
    site["show"] = compile_show(site, site["show"]["clips"])
    return site


def create_tia_plcsim_large_io_test(name="S7-1215C Large I-O PLCSIM Test - 60s", tia_version=17):
    """Create an observable CPU 1215C lab using its integrated digital/analog I/O.

    The mapping consumes both integrated analog outputs, all ten integrated digital
    outputs and five integrated digital inputs. RGB fixtures remain DB-only because
    a bare CPU 1215C has no integrated RGB/DMX output hardware.
    """
    site = create_site(name=name, pumps=2, valves=8, lights=4, mode="simulated", db=100)
    site["tia"]["version"] = integer(tia_version, "TIA Portal version", 17, 21)
    site["tia"].update({
        "project_name": "AquaFlow1215CLargeIO",
        "device_name": "AquaFlowPLC",
        "cpu_name": "PLC_1",
    })
    # NetToPLCsim may not expose a reliable SZL order number. Keep runtime identity
    # expectations blank for this simulation profile and prove compatibility through
    # the exact DB signature/contract/heartbeat handshake instead.
    site["plc"].update({"expected_order_number": "", "expected_firmware": ""})
    site["inputs"] = {
        "estop_ok": "%I0.0",
        "level_ok": "%I0.1",
        "thermal_ok": "%I0.2",
        "drive_ok": "%I0.3",
        "pressure_ok": "%I0.4",
    }

    pumps = [channel for channel in site["channels"] if channel["kind"] == "pump"]
    valves = [channel for channel in site["channels"] if channel["kind"] == "valve"]
    lights = [channel for channel in site["channels"] if channel["kind"] == "light"]
    for index, pump in enumerate(pumps):
        pump.update(
            name=f"Lab Pump {index + 1}", zone=f"Pump bank {index + 1}",
            output=f"%QW{64 + index * 2}", enable_output=f"%Q0.{index}",
            max_percent=35, commissioned=True,
            observation="PLCSIM-only logical output; not commissioned for physical hardware",
        )
    valve_outputs = [f"%Q0.{bit}" for bit in range(2, 8)] + ["%Q1.0", "%Q1.1"]
    for index, (valve, output) in enumerate(zip(valves, valve_outputs)):
        pump = pumps[index % len(pumps)]
        valve.update(
            name=f"Lab Valve {index + 1}", zone=f"Alternating bank {index % 2 + 1}",
            output=output, pump_id=pump["id"], min_on_ms=500, min_off_ms=500,
            commissioned=True,
            observation="PLCSIM-only logical output; not commissioned for physical hardware",
        )
    for index, light in enumerate(lights):
        light.update(
            name=f"Simulated RGB Group {index + 1}", zone="PLCSIM extended process image",
            output=f"%QB{100 + index * 3}", commissioned=True,
            observation="PLCSIM-only logical output; not commissioned for physical hardware",
        )

    site["lab_profile"] = {
        "id": "s7-1215c-integrated-large-io-v1",
        "cpu": "CPU 1215C DC/DC/DC",
        "order_number": "6ES7 215-1AG40-0XB0",
        "simulated_cpu_ip": "192.168.0.1",
        "inputs_to_force_true": ["%I0.0", "%I0.1", "%I0.2", "%I0.3", "%I0.4"],
        "analog_outputs": {"%QW64": "Pump 1 speed", "%QW66": "Pump 2 speed"},
        "digital_outputs": {
            "%Q0.0": "Pump 1 enable", "%Q0.1": "Pump 2 enable",
            **{output: f"Valve {index + 1}" for index, output in enumerate(valve_outputs)},
        },
        "simulated_extended_outputs": {
            light["output"]: f"{light['name']} RGB base byte" for light in lights
        },
        "note": "PLCSIM laboratory mapping only; verify actual cabinet addresses before physical use.",
    }
    site = validate_site(site)

    clips = []
    for pump in pumps:
        clips.append({"fixtureId": pump["id"], "type": "pump_speed", "startTime": 0,
                      "duration": 60, "value": 25, "fadeIn": 2, "fadeOut": 2})
    # Four alternating pairs, then each bank, then all eight outlets.
    for pair in range(4):
        for valve in valves[pair * 2:pair * 2 + 2]:
            clips.append({"fixtureId": valve["id"], "type": "solenoid_open",
                          "startTime": pair * 8, "duration": 8, "value": 100,
                          "fadeIn": 0, "fadeOut": 0})
    for valve in valves[0::2]:
        clips.append({"fixtureId": valve["id"], "type": "solenoid_open", "startTime": 32,
                      "duration": 10, "value": 100, "fadeIn": 0, "fadeOut": 0})
    for valve in valves[1::2]:
        clips.append({"fixtureId": valve["id"], "type": "solenoid_open", "startTime": 42,
                      "duration": 10, "value": 100, "fadeIn": 0, "fadeOut": 0})
    for valve in valves:
        clips.append({"fixtureId": valve["id"], "type": "solenoid_open", "startTime": 52,
                      "duration": 8, "value": 100, "fadeIn": 0, "fadeOut": 0})
    colors = ("red", "green", "blue")
    for index, light in enumerate(lights):
        clips.append({"fixtureId": light["id"], "type": "lighting_master", "startTime": 0,
                      "duration": 60, "value": 70, "fadeIn": 1, "fadeOut": 1})
        for segment, color in enumerate(colors):
            clips.append({"fixtureId": light["id"], "type": f"lighting_{color}",
                          "startTime": segment * 20, "duration": 20,
                          "value": 100 if segment == index % 3 else 45,
                          "fadeIn": 1, "fadeOut": 1})
    site["show"] = compile_show(site, clips)
    return site


class SiteStore:
    def __init__(self, path):
        self.path = Path(path)

    def all(self):
        if not self.path.exists():
            return []
        # Apply additive schema defaults in memory so older saved sites can be edited
        # and re-saved without a separate migration command.
        return [validate_site(site) for site in json.loads(self.path.read_text(encoding="utf-8"))["sites"]]

    def get(self, sid):
        for site in self.all():
            if site["id"] == sid:
                return copy.deepcopy(site)
        raise KeyError("Siemens site not found")

    def save(self, site, expected_revision=None):
        site = validate_site(site)
        sites = self.all()
        old = next((s for s in sites if s["id"] == site["id"]), None)
        if old:
            if expected_revision != old["revision"]:
                raise ValueError("Site changed; reload before saving")
            site["revision"] = old["revision"] + 1
            # Any edit invalidates the compiled show. Keep its clips (not a compiled show) so
            # the operator can recompile them against the new revision in one click.
            if old.get("show"):
                site["previous_show_clips"] = old["show"]["clips"]
            site["show"] = None
            # Lab observations and observations for a different cabinet/mapping
            # cannot authorize the new installation. Text is retained for history.
            if (old["mode"] != site["mode"] or signature(old) != signature(site)
                    or old["plc"] != site["plc"]):
                for channel in site["channels"]:
                    channel["commissioned"] = False
        self._write([s for s in sites if s["id"] != site["id"]] + [site])
        return site

    def save_show(self, sid, clips, revision):
        sites = self.all()
        site = next((s for s in sites if s["id"] == sid), None)
        if not site:
            raise KeyError("Siemens site not found")
        if revision != site["revision"]:
            raise ValueError("Site changed; reload before compiling")
        site["show"] = compile_show(site, clips)
        self._write(sites)
        return site["show"]

    def _write(self, sites):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".pending")
        temporary.write_text(json.dumps({"version": 1, "sites": sites}, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)


def compile_show(site, clips):
    """Compile Show Programmer clips into the Siemens absolute-address show.

    AF-NEXT-009: validation runs through the preflight gate (services.preflight), which
    resolves the show once and collects EVERY problem instead of stopping at the first.
    For API compatibility a refused show still raises ValueError - a PreflightError whose
    message names the error(s) and whose ``issues`` carry clip/fixture IDs and fix targets.
    """
    if not clips or len(clips) > 20000:
        raise ValueError("Provide between 1 and 20000 clips")
    from services.preflight import PreflightError, run_preflight, siemens_target
    result = run_preflight({"clips": clips}, siemens_target(site))
    if not result["ok"]:
        raise PreflightError(result)
    channels = {c["id"]: c for c in site["channels"]}
    output = []
    for clip in clips:
        if clip.get("muted") is True or clip.get("disabled") is True:
            continue
        cid = clip.get("fixtureId")
        channel = channels[cid]
        duration = finite(clip.get("duration"), "Clip duration", .1, 1800)
        compiled = {"fixtureId": cid, "type": clip.get("type"),
                    "startTime": finite(clip.get("startTime", 0), "Clip start", 0, 1800),
                    "duration": duration, "value": finite(clip.get("value"), "Clip value", 0, 100),
                    "fadeIn": finite(clip.get("fadeIn", 0), "Fade in", 0, duration),
                    "fadeOut": finite(clip.get("fadeOut", 0), "Fade out", 0, duration)}
        # AF-NEXT-004: a light clip's programmed colour is part of the command. Earlier
        # versions dropped it here, so Show Studio colours never reached the RGB bytes.
        color = valid_hex(clip.get("color")) if channel["kind"] == "light" else None
        if color:
            compiled["color"] = color
        if clip.get("id") is not None:
            compiled["id"] = str(clip["id"])[:120]
        output.append(compiled)
    return {"revision": site["revision"], "signature": signature(site), "clips": output,
            "duration": max(c["startTime"] + c["duration"] for c in output)}


def show_project(site, show):
    """The canonical show-frame project for a compiled Siemens show (channels are fixtures)."""
    return {"fixtures": [{"id": c["id"], "kind": c["kind"]} for c in site["channels"]],
            "clips": show["clips"], "duration": show.get("duration")}


def evaluate_site_frame(site, show, elapsed, *, loop=False, blackout=False, stopped=False):
    """Canonical frame (engine.show_frame) for a compiled show at `elapsed` seconds."""
    return evaluate_show_frame_at(show_project(site, show), elapsed,
                                  {"loop": loop, "blackout": blackout, "stopped": stopped})


def frame_values(site, frame):
    """Map a canonical frame onto Siemens channel values (0..100, light master + RGB)."""
    values = {}
    for channel in site["channels"]:
        record = frame["fixtures"].get(channel["id"])
        if channel["kind"] == "light":
            srgb = record["color"]["srgb"] if record else {"r": 0.0, "g": 0.0, "b": 0.0}
            values[channel["id"]] = {"master": (record["level"] if record else 0.0) * 100,
                                     "red": srgb["r"] * 100, "green": srgb["g"] * 100, "blue": srgb["b"] * 100}
        elif channel["kind"] == "valve":
            values[channel["id"]] = 100.0 if frame["valves"].get(channel["id"], {}).get("open") else 0.0
        else:
            values[channel["id"]] = frame["pumps"].get(channel["id"], {}).get("speed", 0.0) * 100
    return values


def frame_at(site, show, elapsed, *, loop=False, blackout=False):
    """Encode the PLC command bank for `elapsed` seconds of show time.

    Evaluation is delegated to the canonical show frame so the PLC follows exactly what
    the timeline and 3D preview show, including a light clip's programmed colour.
    """
    frame = evaluate_site_frame(site, show, elapsed, loop=loop, blackout=blackout)
    return frame_from_values(site, frame_values(site, frame))


def frame_from_values(site, values):
    """Encode one complete command bank from normalized channel values."""
    payload = blank_command()
    normalized = {c["id"]: ({"master": 100.0, "red": 0.0, "green": 0.0, "blue": 0.0}
                                  if c["kind"] == "light" else 0.0) for c in site["channels"]}
    for channel in site["channels"]:
        if channel["id"] in values:
            normalized[channel["id"]] = copy.deepcopy(values[channel["id"]])
    for channel in site["channels"]:
        if channel["kind"] == "valve":
            valve_value = finite(normalized[channel["id"]], f"{channel['name']} command", 0, 100)
            if valve_value not in (0, 100):
                raise ValueError(f"{channel['name']} manual command must be 0 or 100")
            normalized[channel["id"]] = valve_value
        if channel["kind"] == "valve" and normalized[channel["id"]] > 0:
            index = channel["index"]
            payload[VALVE_COMMAND_OFFSET - PUMP_COMMAND_OFFSET + index // 8] |= 1 << (index % 8)
    for channel in site["channels"]:
        if channel["kind"] == "pump":
            requested = finite(normalized[channel["id"]], f"{channel['name']} command", 0, 100)
            outlets_open = any(normalized[c["id"]] > 0 for c in site["channels"] if c.get("pump_id") == channel["id"])
            percent = min(requested, channel["max_percent"]) if outlets_open else 0
            normalized[channel["id"]] = percent
            struct.pack_into(">H", payload, PUMP_COMMAND_OFFSET - PUMP_COMMAND_OFFSET + channel["index"] * 2,
                             round(percent * 27648 / 100))
            payload[PUMP_MODE_OFFSET - PUMP_COMMAND_OFFSET + channel["index"]] = 1 if percent else 0
        elif channel["kind"] == "light":
            source = normalized[channel["id"]]
            if not isinstance(source, dict):
                source = {"master": finite(source, f"{channel['name']} command", 0, 100),
                          "red": 100.0, "green": 100.0, "blue": 100.0}
            master = finite(source.get("master", 100), f"{channel['name']} master", 0, 100)
            rgb = [round(finite(source.get(key, 0), f"{channel['name']} {key}", 0, 100) * master * 255 / 10000)
                   for key in ("red", "green", "blue")]
            start = LIGHT_COMMAND_OFFSET - PUMP_COMMAND_OFFSET + channel["index"] * 3
            payload[start:start + 3] = bytes(rgb)
            normalized[channel["id"]] = {"master": master, "red": rgb[0], "green": rgb[1], "blue": rgb[2]}
    return bytes(payload), normalized


def bench_clips(site):
    """A sixty-second example, no physical writes. Individual outlet segments."""
    clips = []
    valves = [c for c in site["channels"] if c["kind"] == "valve"]
    for pump in (c for c in site["channels"] if c["kind"] == "pump"):
        clips.append({"fixtureId": pump["id"], "type": "pump_speed", "startTime": 0, "duration": 60,
                      "value": min(30, pump["max_percent"])})
    segment = 60 / len(valves)
    if segment * 1000 < max(c["min_on_ms"] for c in valves):
        raise ValueError("Too many valves for the 60-second example; create longer individual clips")
    for index, valve in enumerate(valves):
        clips.append({"fixtureId": valve["id"], "type": "solenoid_open", "startTime": index * segment,
                      "duration": segment, "value": 100})
    for light in (c for c in site["channels"] if c["kind"] == "light"):
        clips.extend([
            {"fixtureId": light["id"], "type": "lighting_master", "startTime": 0, "duration": 60, "value": 70},
            {"fixtureId": light["id"], "type": "lighting_red", "startTime": 0, "duration": 20, "value": 100},
            {"fixtureId": light["id"], "type": "lighting_green", "startTime": 20, "duration": 20, "value": 100},
            {"fixtureId": light["id"], "type": "lighting_blue", "startTime": 40, "duration": 20, "value": 100},
        ])
    return clips
