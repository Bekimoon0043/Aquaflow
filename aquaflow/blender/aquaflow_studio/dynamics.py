"""Standalone hydraulic response matching AquaFlow's show-hydraulics concepts.

This is a lightweight boundary-condition model for Blender, not the full network solver.
Pump affinity behavior, ramp constants, valve strokes and pipe-volume filling are applied
before the values become Mantaflow inflow keys. No hardware access is involved.
"""

from __future__ import annotations

import math

from .core import clamp, finite, positive


def equipment_kind(fixture):
    text = str((fixture.get("raw") or {}).get("type") or fixture.get("type") or "").lower()
    if "pump" in text:
        return "pump"
    if "valve" in text:
        return "valve"
    if text.startswith("pipe") or "pipe_" in text:
        return "pipe"
    if "filter" in text:
        return "filter"
    if "tank" in text or "compressor" in text:
        return "tank"
    return "equipment"


def engineering(fixture):
    return (fixture.get("raw") or {}).get("engineering") or {}


def linked_id(fixture, singular, alternate):
    raw = fixture.get("raw") or {}
    eng = engineering(fixture)
    if singular == "valveId":
        return eng.get("valveId") or eng.get("solenoidValveId") or eng.get("supplyingValveId") or raw.get(alternate) or raw.get(singular)
    return eng.get(singular) or raw.get(alternate) or raw.get(singular)


def programmed(project, fixture_id, channels):
    return any(str(clip.get("fixtureId") or "") == fixture_id and clip.get("type") in channels
               for clip in project["clips"])


def response_time(fixture, default):
    eng = engineering(fixture)
    tau = positive(eng.get("rampTimeConstantS"))
    if tau is None and positive(eng.get("rampTimeS", eng.get("accelerationTimeS"))):
        tau = eng["rampTimeS"] / 3.0
    return tau if tau is not None else default


def valve_response(fixture):
    eng = engineering(fixture)
    explicit = positive(eng.get("responseTimeS", eng.get("actuationTimeS")))
    if explicit is not None:
        return explicit
    text = str((fixture.get("raw") or {}).get("type") or "").lower()
    return 6.0 if any(token in text for token in ("motor", "butterfly", "ball", "actuat")) else 0.3


def pipe_volume(fixture):
    eng = engineering(fixture)
    length = positive(eng.get("pipeLengthM", eng.get("mainLengthM")), 0.0)
    diameter = positive(eng.get("pipeDiameterM", eng.get("pipe_diameter_m")), 0.05)
    return length * math.pi * diameter * diameter / 4.0


def command_map(animation, fixtures):
    times = sorted({key["time"] for fixture in fixtures for key in animation[fixture["id"]]})
    return times


def key_at(animation, fixture_id, indices, time):
    return animation[fixture_id][indices[fixture_id][round(time, 9)]]


def apply_hydraulic_response(project, animation):
    """Return new animation keys with pump/valve/pipe dynamics applied.

    Unassigned nozzles use the only pump when one exists. With no pump/valve equipment,
    the project keeps AquaFlow's fixed-design-head behavior and its timing is unchanged.
    """
    fixtures = project["fixtures"]
    pumps = [fixture for fixture in fixtures if equipment_kind(fixture) == "pump"]
    valves = [fixture for fixture in fixtures if equipment_kind(fixture) == "valve"]
    nozzles = [fixture for fixture in fixtures if fixture["category"] == "water" and fixture["family"] != "mist"]
    if not nozzles or (not pumps and not valves):
        return animation, {"mode": "fixed_design_head", "pumps": 0, "valves": 0}
    result = {fixture_id: [dict(key) for key in keys] for fixture_id, keys in animation.items()}
    times = command_map(animation, fixtures)
    indices = {fixture["id"]: {round(key["time"], 9): index for index, key in enumerate(animation[fixture["id"]])}
               for fixture in fixtures}
    pump_for = {}
    for nozzle in nozzles:
        linked = linked_id(nozzle, "pumpId", "supplyingPumpId")
        pump_for[nozzle["id"]] = linked or (pumps[0]["id"] if len(pumps) == 1 else None)
    valve_for = {nozzle["id"]: linked_id(nozzle, "valveId", "linkedValveId") for nozzle in nozzles}
    pump_state = {pump["id"]: 0.0 for pump in pumps}
    valve_state = {valve["id"]: 0.0 for valve in valves}
    fill = {nozzle["id"]: pipe_volume(nozzle) if engineering(nozzle).get("pipesInitiallyFilled") else 0.0
            for nozzle in nozzles}
    volumes = {nozzle["id"]: pipe_volume(nozzle) for nozzle in nozzles}
    pump_programmed = {pump["id"]: programmed(project, pump["id"], {"pump_speed"}) for pump in pumps}
    previous = times[0] if times else 0.0
    snapshots = []
    for time in times:
        dt = max(0.0, time - previous)
        previous = time
        desired = {nozzle["id"]: key_at(animation, nozzle["id"], indices, time)["level"] for nozzle in nozzles}
        demanded_speed = {}
        for pump in pumps:
            members = [nozzle for nozzle in nozzles if pump_for[nozzle["id"]] == pump["id"]]
            demanded_speed[pump["id"]] = math.sqrt(max((desired[nozzle["id"]] for nozzle in members), default=0.0))
        for pump in pumps:
            pid = pump["id"]
            target = key_at(animation, pid, indices, time)["level"] if pump_programmed[pid] else demanded_speed[pid]
            tau = response_time(pump, 1.5)
            pump_state[pid] += (target - pump_state[pid]) * (1.0 - math.exp(-dt / max(0.001, tau)))
        for valve in valves:
            vid = valve["id"]
            members = [nozzle for nozzle in nozzles if valve_for[nozzle["id"]] == vid]
            if programmed(project, vid, {"solenoid_open", "device_enable", "device_intensity"}):
                target = key_at(animation, vid, indices, time)["level"]
            else:
                target = 1.0 if any(desired[nozzle["id"]] > 0.005 for nozzle in members) else 0.0
            response = valve_response(valve)
            if response <= 0:
                valve_state[vid] = target
            else:
                change = dt / response
                valve_state[vid] = min(target, valve_state[vid] + change) if target > valve_state[vid] else max(target, valve_state[vid] - change)
        for nozzle in nozzles:
            nid = nozzle["id"]
            pid, vid = pump_for[nid], valve_for[nid]
            if pid and pump_programmed.get(pid):
                pump_factor = pump_state[pid]
            elif pid and demanded_speed.get(pid, 0.0) > 1e-8:
                pump_factor = min(1.0, pump_state[pid] / demanded_speed[pid])
            else:
                pump_factor = 1.0 if not pumps else 0.0
            valve_factor = valve_state.get(vid, 1.0)
            level = desired[nid] * pump_factor * valve_factor
            volume = volumes[nid]
            if volume > 0:
                flow = nozzle["flow_m3s"] * level
                if level > 0.0001:
                    fill[nid] = min(volume, fill[nid] + flow * dt)
                elif engineering(nozzle).get("drainWhenIdle", True):
                    fill[nid] = max(0.0, fill[nid] - nozzle["flow_m3s"] * dt)
                if fill[nid] < volume - 1e-9:
                    level = 0.0
            index = indices[nid][round(time, 9)]
            result[nid][index]["level"] = clamp(level)
            result[nid][index]["energy_factor"] = clamp(level)
            result[nid][index]["hydraulic_fill"] = 1.0 if volume <= 0 else fill[nid] / volume
            result[nid][index]["pump_speed"] = pump_state.get(pid)
            result[nid][index]["valve_open"] = valve_state.get(vid, 1.0)
        snapshots.append({"time": time, "pumps": dict(pump_state), "valves": dict(valve_state)})
    diagnostics = {
        "mode": "pump_valve_pipe_response",
        "pumps": len(pumps),
        "valves": len(valves),
        "model": "Q∝speed, head∝speed²; first-order pump ramp; linear valve stroke; pipe-volume fill",
        "snapshots": snapshots,
    }
    return result, diagnostics
