"""Deterministic, fixed-step models for compressed-air shooters and water curtains.

All public inputs and outputs use SI units. The models are pure Python: they do not
read clocks, perform I/O, or access hardware. Event times and response delays that
fall between steps are rounded up to the next step, so an effect never starts early.
"""
from __future__ import annotations

import math

from services.equipment_provenance import cite, normalize_provenance, summarize

CONTRACT = "aquaflow-special-nozzle-dynamics"
VERSION = "1.0.0"


def _num(value, name, minimum=None, allow_zero=True):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")
    try:
        value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if minimum is not None and (value < minimum or (not allow_zero and value <= minimum)):
        raise ValueError(f"{name} must be {'>' if not allow_zero else '>='} {minimum}")
    return value


def _positive_int(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _grid_steps(duration_s, dt_s):
    duration_s = _num(duration_s, "duration_s", 0.0)
    dt_s = _num(dt_s, "dt_s", 0.0, allow_zero=False)
    steps = int(round(duration_s / dt_s))
    if not math.isclose(steps * dt_s, duration_s, rel_tol=0.0, abs_tol=dt_s * 1e-8):
        raise ValueError("duration_s must be an integer multiple of dt_s")
    return steps, dt_s


def _step_at_or_after(time_s, dt_s):
    return int(math.ceil(time_s / dt_s - 1e-10))


def _delay_steps(delay_s, dt_s):
    return _step_at_or_after(delay_s, dt_s) if delay_s > 0.0 else 0


def _equipment(provenance, model, units):
    normalized = normalize_provenance(provenance, kind="nozzle", model=model)
    return cite(normalized, equipment_model=model, kind="nozzle", units=units)


def _bits(pattern, outlet_count):
    if isinstance(pattern, str):
        compact = "".join(ch for ch in pattern if ch not in " ,|_\t\r\n")
        if not compact or any(ch not in "01" for ch in compact):
            raise ValueError("a pattern string must contain only 0 and 1 bits")
        values = list(compact)
    elif isinstance(pattern, (list, tuple)):
        values = list(pattern)
    else:
        raise ValueError("pattern must be a bit string or a sequence")
    if len(values) != outlet_count:
        raise ValueError(f"pattern has {len(values)} bits; expected {outlet_count}")
    bits = []
    for value in values:
        if value is True or value == 1 or value == "1":
            bits.append(True)
        elif value is False or value == 0 or value == "0":
            bits.append(False)
        else:
            raise ValueError("pattern bits must be booleans or 0/1")
    return bits


class CompressedAirShooter:
    """One shooter advanced by fixed ``dt_s`` intervals.

    ``step()`` processes a fire request at the current sample, returns the state at
    that sample, then integrates recharge to the next sample. A shot removes
    ``ambient_pressure_pa * shot_air_volume_m3 / tank_volume_m3`` Pa immediately.
    At most one request can be processed per step.
    """

    def __init__(self, config, dt_s, provenance=None):
        config = dict(config or {})
        self.dt_s = _num(dt_s, "dt_s", 0.0, allow_zero=False)
        self.tank_volume_m3 = _num(config.get("tank_volume_m3"), "tank_volume_m3", 0.0, allow_zero=False)
        self.ambient_pressure_pa = _num(config.get("ambient_pressure_pa", 101325.0),
                                        "ambient_pressure_pa", 0.0, allow_zero=False)
        self.max_pressure_pa = _num(config.get("max_pressure_pa"), "max_pressure_pa",
                                    self.ambient_pressure_pa, allow_zero=False)
        self.min_fire_pressure_pa = _num(config.get("min_fire_pressure_pa"), "min_fire_pressure_pa",
                                         self.ambient_pressure_pa)
        if self.min_fire_pressure_pa > self.max_pressure_pa:
            raise ValueError("min_fire_pressure_pa cannot exceed max_pressure_pa")
        self.pressure_pa = _num(config.get("initial_pressure_pa", self.max_pressure_pa),
                                "initial_pressure_pa", self.ambient_pressure_pa)
        if self.pressure_pa > self.max_pressure_pa:
            raise ValueError("initial_pressure_pa cannot exceed max_pressure_pa")
        self.recharge_rate_pa_s = _num(config.get("recharge_rate_pa_s"), "recharge_rate_pa_s", 0.0)
        self.valve_open_duration_s = _num(config.get("valve_open_duration_s"),
                                          "valve_open_duration_s", 0.0, allow_zero=False)
        self.max_shots_per_burst = _positive_int(config.get("max_shots_per_burst", 1),
                                                 "max_shots_per_burst")
        self.reset_pressure_pa = _num(config.get("reset_pressure_pa", self.max_pressure_pa),
                                      "reset_pressure_pa", self.min_fire_pressure_pa)
        if self.reset_pressure_pa > self.max_pressure_pa:
            raise ValueError("reset_pressure_pa cannot exceed max_pressure_pa")

        shot_volume = config.get("shot_air_volume_m3")
        pressure_drop = config.get("shot_pressure_drop_pa")
        if (shot_volume is None) == (pressure_drop is None):
            raise ValueError("specify exactly one of shot_air_volume_m3 or shot_pressure_drop_pa")
        if shot_volume is not None:
            self.shot_air_volume_m3 = _num(shot_volume, "shot_air_volume_m3", 0.0, allow_zero=False)
            self.shot_pressure_drop_pa = (self.ambient_pressure_pa * self.shot_air_volume_m3
                                          / self.tank_volume_m3)
        else:
            self.shot_air_volume_m3 = None
            self.shot_pressure_drop_pa = _num(pressure_drop, "shot_pressure_drop_pa", 0.0, allow_zero=False)
        if self.shot_pressure_drop_pa > self.max_pressure_pa - self.ambient_pressure_pa:
            raise ValueError("one shot cannot consume more than the tank's available compressed air")

        self._step_index = 0
        self._valve_remaining_s = 0.0
        self._shots_in_burst = 0
        self._burst_exhausted = False
        self._accepted_shots = 0
        self._blocked_requests = 0
        model = str(config.get("model") or "compressed-air shooter")
        self.equipment = _equipment(provenance or config.get("provenance"), model, {
            "time": "s", "tank_volume": "m3", "pressure": "Pa (absolute)",
            "shot_air_volume": "m3 at ambient_pressure_pa", "recharge_rate": "Pa/s",
        })
        self.assumptions = [
            {"key": "shooter_pressure_model", "value": "isothermal ideal gas", "unit": None,
             "source": "ASSUMED", "note": "Shot air volume is free-air equivalent at ambient_pressure_pa; "
                                          "pressure drop is immediate and tank temperature is constant."},
            {"key": "shooter_recharge", "value": "linear while valve closed", "unit": "Pa/s",
             "source": "ASSUMED", "note": "Recharge is capped at max_pressure_pa and receives credit for the "
                                          "closed fraction of the step in which the valve closes."},
            {"key": "shooter_fixed_step", "value": self.dt_s, "unit": "s", "source": "SETTING",
             "note": "Requests are processed at step starts and rounded up to a step; at most one shot per step."},
            {"key": "shooter_burst_reset", "value": self.reset_pressure_pa, "unit": "Pa",
             "source": "SETTING", "note": "A burst is locked after max_shots_per_burst until this pressure is reached."},
        ]
        if "initial_pressure_pa" not in config:
            self.assumptions.append({"key": "shooter_initial_pressure", "value": self.max_pressure_pa,
                                     "unit": "Pa", "source": "DEFAULT", "note": "Tank starts fully charged."})

    @property
    def time_s(self):
        return self._step_index * self.dt_s

    @property
    def valve_open(self):
        return self._valve_remaining_s > 0.0

    def _state(self):
        if self.valve_open:
            return "firing"
        if self._burst_exhausted:
            return "exhausted"
        if self.pressure_pa < self.min_fire_pressure_pa:
            return "recharging"
        return "ready"

    def step(self, fire=False):
        if self._burst_exhausted and self.pressure_pa >= self.reset_pressure_pa:
            self._burst_exhausted = False
            self._shots_in_burst = 0

        accepted = False
        blocked_reason = None
        if fire:
            if self.valve_open:
                blocked_reason = "valve_open"
            elif self._burst_exhausted:
                blocked_reason = "burst_exhausted"
            elif self.pressure_pa < self.min_fire_pressure_pa:
                blocked_reason = "tank_pressure"
            else:
                accepted = True
                self._accepted_shots += 1
                self._shots_in_burst += 1
                self.pressure_pa = max(self.ambient_pressure_pa,
                                       self.pressure_pa - self.shot_pressure_drop_pa)
                self._valve_remaining_s = self.valve_open_duration_s
                if self._shots_in_burst >= self.max_shots_per_burst:
                    self._burst_exhausted = True
        if fire and not accepted:
            self._blocked_requests += 1

        state = self._state()
        record = {
            "time_s": self.time_s,
            "state": state,
            "ready": state == "ready",
            "fire_requested": bool(fire),
            "fire_accepted": accepted,
            "blocked_reason": blocked_reason,
            "tank_pressure_pa": self.pressure_pa,
            "valve_open": self.valve_open,
            "valve_remaining_s": self._valve_remaining_s,
            "shots_in_burst": self._shots_in_burst,
            "accepted_shots": self._accepted_shots,
            "blocked_requests": self._blocked_requests,
        }

        closed_s = self.dt_s
        if self.valve_open:
            closed_s = max(0.0, self.dt_s - self._valve_remaining_s)
            self._valve_remaining_s = max(0.0, self._valve_remaining_s - self.dt_s)
        if closed_s > 0.0:
            self.pressure_pa = min(self.max_pressure_pa,
                                   self.pressure_pa + self.recharge_rate_pa_s * closed_s)
        self._step_index += 1
        return record


def simulate_compressed_air_shooter(config, fire_times_s, duration_s, dt_s=0.01, provenance=None):
    """Return a fixed-grid shooter timeline, including equipment and assumptions."""
    steps, dt_s = _grid_steps(duration_s, dt_s)
    shooter = CompressedAirShooter(config, dt_s, provenance)
    requests = {}
    request_rows = []
    for requested_time in fire_times_s or []:
        requested_time = _num(requested_time, "fire time", 0.0)
        if requested_time > duration_s:
            raise ValueError("fire times must lie within duration_s")
        index = _step_at_or_after(requested_time, dt_s)
        requests[index] = True
        request_rows.append({"requested_time_s": requested_time, "step": index,
                             "scheduled_time_s": index * dt_s})
    records = [shooter.step(requests.get(index, False)) for index in range(steps + 1)]
    citations = [shooter.equipment]
    return {
        "contract": CONTRACT,
        "version": VERSION,
        "kind": "compressed_air_shooter",
        "dt_s": dt_s,
        "duration_s": steps * dt_s,
        "units": {"time": "s", "pressure": "Pa (absolute)", "tank_volume": "m3",
                  "shot_air_volume": "m3 at ambient_pressure_pa", "recharge_rate": "Pa/s"},
        "config": {
            "tank_volume_m3": shooter.tank_volume_m3,
            "ambient_pressure_pa": shooter.ambient_pressure_pa,
            "max_pressure_pa": shooter.max_pressure_pa,
            "min_fire_pressure_pa": shooter.min_fire_pressure_pa,
            "reset_pressure_pa": shooter.reset_pressure_pa,
            "recharge_rate_pa_s": shooter.recharge_rate_pa_s,
            "valve_open_duration_s": shooter.valve_open_duration_s,
            "max_shots_per_burst": shooter.max_shots_per_burst,
            "shot_air_volume_m3": shooter.shot_air_volume_m3,
            "shot_pressure_drop_pa": shooter.shot_pressure_drop_pa,
        },
        "requests": request_rows,
        "records": records,
        "equipment": shooter.equipment,
        "assumptions": shooter.assumptions,
        "data_provenance": summarize(citations),
        "stats": {"accepted_shots": shooter._accepted_shots, "blocked_requests": shooter._blocked_requests},
    }


class DigitalWaterCurtain:
    """Independent binary solenoids with interruptible open/close delays.

    A changed command restarts that outlet's delay. A command back to the current
    physical state cancels a pending transition, preventing stale delayed edges.
    ``step()`` accepts a bit sequence/string or an ID mapping (omitted IDs close).
    """

    def __init__(self, outlets, dt_s, provenance=None):
        self.dt_s = _num(dt_s, "dt_s", 0.0, allow_zero=False)
        if not isinstance(outlets, (list, tuple)) or not outlets:
            raise ValueError("outlets must be a non-empty sequence")
        self.outlets = []
        self.assumptions = [
            {"key": "curtain_fixed_step", "value": self.dt_s, "unit": "s", "source": "SETTING",
             "note": "Packet edges and response delays are rounded up to the next fixed step."},
            {"key": "curtain_delay_model", "value": "interruptible pure delay", "unit": None,
             "source": "ASSUMED", "note": "A reversed command restarts or cancels the pending transition; "
                                          "hydraulic travel after solenoid actuation is not modelled."},
        ]
        seen = set()
        for index, raw in enumerate(outlets):
            raw = dict(raw or {})
            outlet_id = str(raw.get("id") or f"outlet-{index}")
            if outlet_id in seen:
                raise ValueError(f"duplicate outlet id: {outlet_id}")
            seen.add(outlet_id)
            open_delay = _num(raw.get("open_delay_s", 0.0), f"{outlet_id}.open_delay_s", 0.0)
            close_delay = _num(raw.get("close_delay_s", 0.0), f"{outlet_id}.close_delay_s", 0.0)
            model = str(raw.get("model") or f"digital water-curtain solenoid {outlet_id}")
            equipment = _equipment(raw.get("provenance") or provenance, model,
                                   {"time": "s", "open_delay": "s", "close_delay": "s"})
            outlet_assumptions = []
            for key, value in (("open_delay_s", open_delay), ("close_delay_s", close_delay)):
                if key not in raw:
                    outlet_assumptions.append({"key": f"{outlet_id}.{key}", "value": value, "unit": "s",
                                               "source": "DEFAULT", "note": "No response delay data supplied."})
            self.outlets.append({
                "id": outlet_id, "open_delay_s": open_delay, "close_delay_s": close_delay,
                "open_delay_steps": _delay_steps(open_delay, self.dt_s),
                "close_delay_steps": _delay_steps(close_delay, self.dt_s),
                "equipment": equipment, "assumptions": outlet_assumptions,
            })
            self.assumptions.extend(outlet_assumptions)
        self._ids = [outlet["id"] for outlet in self.outlets]
        self._command = [False] * len(self.outlets)
        self._open = [False] * len(self.outlets)
        self._pending = [None] * len(self.outlets)
        self._due_step = [None] * len(self.outlets)
        self._step_index = 0

    @property
    def time_s(self):
        return self._step_index * self.dt_s

    def _commands(self, commands):
        if isinstance(commands, dict):
            unknown = set(commands) - set(self._ids)
            if unknown:
                raise ValueError(f"unknown outlet IDs: {sorted(unknown)}")
            return _bits([commands.get(outlet_id, False) for outlet_id in self._ids], len(self._ids))
        return _bits(commands, len(self._ids))

    def step(self, commands):
        commands = self._commands(commands)
        for index, target in enumerate(commands):
            self._command[index] = target
            if target == self._open[index]:
                self._pending[index] = None
                self._due_step[index] = None
            elif self._pending[index] != target:
                delay_key = "open_delay_steps" if target else "close_delay_steps"
                self._pending[index] = target
                self._due_step[index] = self._step_index + self.outlets[index][delay_key]
        for index, pending in enumerate(self._pending):
            if pending is not None and self._due_step[index] <= self._step_index:
                self._open[index] = pending
                self._pending[index] = None
                self._due_step[index] = None

        states = []
        for index, is_open in enumerate(self._open):
            if self._pending[index] is None:
                states.append("open" if is_open else "closed")
            else:
                states.append("opening" if self._pending[index] else "closing")
        record = {
            "time_s": self.time_s,
            "commanded": dict(zip(self._ids, self._command)),
            "open": dict(zip(self._ids, self._open)),
            "pending": dict(zip(self._ids, self._pending)),
            "state": dict(zip(self._ids, states)),
        }
        self._step_index += 1
        return record


def _packet_events(packet, packet_index, outlet_count, duration_s, dt_s):
    packet = dict(packet or {})
    packet_id = str(packet.get("id") or f"packet-{packet_index}")
    start_s = _num(packet.get("start_s"), f"{packet_id}.start_s", 0.0)
    end_s = _num(packet.get("end_s"), f"{packet_id}.end_s", 0.0)
    if end_s <= start_s or end_s > duration_s:
        raise ValueError(f"{packet_id} requires 0 <= start_s < end_s <= duration_s")
    pattern = packet.get("pattern", packet.get("bits"))
    nested = (isinstance(pattern, (list, tuple)) and bool(pattern)
              and isinstance(pattern[0], (list, tuple, str)))
    frame_period_s = None
    if nested:
        frame_period_s = _num(packet.get("frame_period_s"), f"{packet_id}.frame_period_s", 0.0, allow_zero=False)
        frames = [_bits(frame, outlet_count) for frame in pattern]
    else:
        frames = [_bits(pattern, outlet_count)]
    start_step = _step_at_or_after(start_s, dt_s)
    end_step = _step_at_or_after(end_s, dt_s)
    events = []
    frame_rows = []
    for frame_index, bits in enumerate(frames):
        requested_time = start_s + frame_index * (frame_period_s or 0.0)
        if requested_time >= end_s:
            raise ValueError(f"{packet_id} has a pattern frame at or after its end_s")
        step = _step_at_or_after(requested_time, dt_s)
        events.append((step, 1, packet_index, frame_index, bits))
        frame_rows.append({"requested_time_s": requested_time, "step": step,
                           "scheduled_time_s": step * dt_s, "bits": [int(bit) for bit in bits]})
    events.append((end_step, 0, packet_index, len(frames), [False] * outlet_count))
    metadata = {"id": packet_id, "start_s": start_s, "end_s": end_s,
                "start_step": start_step, "end_step": end_step,
                "scheduled_start_s": start_step * dt_s, "scheduled_end_s": end_step * dt_s,
                "frame_period_s": frame_period_s, "frames": frame_rows}
    return metadata, events


def simulate_digital_water_curtain(outlets, packets, duration_s, dt_s=0.001, provenance=None):
    """Return a fixed-grid curtain timeline for arbitrary spatial or timed patterns.

    A flat packet pattern is held from packet start to end. A nested pattern is a
    timed sequence requiring ``frame_period_s``. Packet end always commands every
    outlet closed. Ends are processed before starts at the same step, making
    back-to-back packets deterministic; overlapping packets use input order.
    """
    steps, dt_s = _grid_steps(duration_s, dt_s)
    curtain = DigitalWaterCurtain(outlets, dt_s, provenance)
    events = []
    packet_rows = []
    for packet_index, packet in enumerate(packets or []):
        metadata, packet_events = _packet_events(packet, packet_index, len(curtain.outlets),
                                                 steps * dt_s, dt_s)
        packet_rows.append(metadata)
        events.extend(packet_events)
    events.sort(key=lambda event: event[:4])
    events_by_step = {}
    for event in events:
        events_by_step.setdefault(event[0], []).append(event)

    ids = [outlet["id"] for outlet in curtain.outlets]
    output = {
        outlet["id"]: {"commanded": [], "open": [], "pending": [], "state": [],
                       "open_delay_s": outlet["open_delay_s"], "close_delay_s": outlet["close_delay_s"],
                       "open_delay_steps": outlet["open_delay_steps"],
                       "close_delay_steps": outlet["close_delay_steps"],
                       "equipment": outlet["equipment"], "assumptions": outlet["assumptions"]}
        for outlet in curtain.outlets
    }
    frames = []
    commands = [False] * len(ids)
    for index in range(steps + 1):
        for event in events_by_step.get(index, []):
            commands = event[4]
        record = curtain.step(commands)
        active = [packet["id"] for packet in packet_rows
                  if packet["start_step"] <= index < packet["end_step"]]
        frames.append({"time_s": record["time_s"],
                       "command_bits": [int(record["commanded"][outlet_id]) for outlet_id in ids],
                       "output_bits": [int(record["open"][outlet_id]) for outlet_id in ids],
                       "outlet_states": [record["state"][outlet_id] for outlet_id in ids],
                       "active_packets": active})
        for outlet_id in ids:
            row = output[outlet_id]
            for key in ("commanded", "open", "pending", "state"):
                row[key].append(record[key][outlet_id])

    citations = [outlet["equipment"] for outlet in curtain.outlets]
    return {
        "contract": CONTRACT,
        "version": VERSION,
        "kind": "digital_water_curtain",
        "dt_s": dt_s,
        "duration_s": steps * dt_s,
        "units": {"time": "s", "open_delay": "s", "close_delay": "s", "bits": "0=closed, 1=open"},
        "outlet_ids": ids,
        "outlets": output,
        "packets": packet_rows,
        "frames": frames,
        "equipment": citations,
        "assumptions": curtain.assumptions,
        "data_provenance": summarize(citations),
        "stats": {"samples": len(frames), "packets": len(packet_rows), "outlets": len(ids)},
    }
