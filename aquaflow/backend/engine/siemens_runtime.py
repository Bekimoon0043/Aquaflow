"""Supervised S7-1200 runtime for PLCs commissioned with TIA Portal.

Internal simulation never constructs a network client. PLCSIM-network and physical
modes use classic S7comm absolute DB access and therefore require the non-optimized
DB and access settings documented by the generated TIA package.
"""
from __future__ import annotations

import asyncio
import time

from engine.s7_client import S7Client
from engine.s7_identify import s7_handshake
from engine.siemens_contract import (
    COMMAND_SIZE, FLAG_RUN, FLAG_STAGING, FEEDBACK_SIZE, HEADER_SIZE,
    PUMP_COMMAND_OFFSET, PUMP_FEEDBACK_OFFSET, decode_feedback, describe_header,
    parse_header, validate_header,
)
from engine.siemens_site import frame_at, frame_from_values, signature
from services.siemens_readiness import unsupported_input_bindings


class SiemensRuntime:
    def __init__(self, store, permit=None, client_factory=S7Client, identity_provider=s7_handshake):
        self.store = store
        self.permit = permit or (lambda: False)
        self.client_factory = client_factory
        self.identity_provider = identity_provider
        self.states = {}
        self.tasks = {}
        self.clients = {}
        self.locks = {}

    def status(self, sid):
        site = self.store.get(sid)
        state = dict(self.states.get(sid, {}))
        last_rx_at = state.get("last_rx_at")
        age = max(0.0, time.time() - last_rx_at) if last_rx_at else None
        state.update(id=sid, mode=site["mode"], revision=site["revision"],
                     last_rx_age_seconds=round(age, 1) if age is not None else None,
                     telemetry_fresh=(site["mode"] == "simulated" or
                                      (age is not None and age <= 2)),
                     quality=("SIMULATED_NOT_HARDWARE" if site["mode"] == "simulated" else
                              "PLCSIM_S7COMM_VERIFIED" if site["mode"] == "plcsim" and state.get("hardware_verified") else
                              "PLCSIM_S7COMM_UNVERIFIED" if site["mode"] == "plcsim" else
                              "S7COMM_CONTRACT_VERIFIED" if state.get("hardware_verified") else
                              "S7COMM_RUNTIME_HARDWARE_UNVERIFIED"),
                     running=sid in self.tasks and not self.tasks[sid].done(),
                     # AF-NEXT-009: internal simulation is a preview path, never hardware output.
                     output_label=("PREVIEW ONLY — not sent to hardware" if site["mode"] == "simulated" else None))
        return state

    def diagnostics(self, sid):
        status = self.status(sid)
        client = self.clients.get(sid)
        status["transport"] = {
            "protocol": "ISO-on-TCP / classic S7comm Read Var + Write Var",
            "connected": bool(client and client.is_connected),
            "last_error": getattr(client, "last_error", ""),
            "last_tx_hex": getattr(client, "last_tx_hex", "")[-512:],
            "last_rx_hex": getattr(client, "last_rx_hex", "")[-512:],
        }
        return status

    def _lock(self, sid):
        return self.locks.setdefault(sid, asyncio.Lock())

    def ensure_idle(self, sid):
        if sid in self.tasks and not self.tasks[sid].done():
            raise ValueError("Stop playback before editing or compiling this site")

    async def invalidate(self, sid):
        self.ensure_idle(sid)
        await self.stop(sid)
        client = self.clients.pop(sid, None)
        if client:
            await client.close()
        self.states.pop(sid, None)

    def _allowed(self):
        result = self.permit()
        if isinstance(result, dict):
            return all(result.get(k) is True for k in ("permit", "pump_enable", "valve_enable"))
        return result is True

    def _assert_owner(self, sid, site):
        if site["mode"] == "simulated":
            return
        for other, state in self.states.items():
            if other == sid or not (state.get("armed") or (other in self.tasks and not self.tasks[other].done())):
                continue
            candidate = self.store.get(other)
            if candidate["mode"] != "simulated" and candidate["plc"]["ip"] == site["plc"]["ip"]:
                raise ValueError("Another armed Siemens site owns this PLC; stop it first")

    async def _header(self, site, client):
        raw = await client.read_bytes(site["plc"]["db"], 0, HEADER_SIZE)
        header = parse_header(raw)
        validate_header(header, signature(site))
        return describe_header(header)

    async def _feedback(self, site, client):
        raw = await client.read_bytes(site["plc"]["db"], PUMP_FEEDBACK_OFFSET, FEEDBACK_SIZE)
        return decode_feedback(raw, site["channels"])

    async def identify(self, sid):
        site = self.store.get(sid)
        if site["mode"] == "simulated":
            raise ValueError("CPU identity is available only for a networked Siemens site")
        plc = site["plc"]
        result = await self.identity_provider(plc["ip"], plc["port"], plc["rack"], plc["slot"],
                                              connect_timeout=.75, timeout=1.0)
        result = result.to_dict() if hasattr(result, "to_dict") else dict(result)
        from engine.siemens_hardware import classify_s7_1200
        order = (result.get("identity") or {}).get("order_number")
        if order:
            result["cpu_generation"] = classify_s7_1200(order)
        return result

    async def _check_expected_identity(self, site):
        expected_order = site["plc"].get("expected_order_number", "")
        expected_firmware = site["plc"].get("expected_firmware", "")
        if not expected_order and not expected_firmware:
            return None
        identity = await self.identify(site["id"])
        if identity.get("stage") != "identity_confirmed":
            raise ValueError("The PLC answered S7comm but did not expose the identity needed for compatibility checking")
        actual = identity.get("identity") or {}
        if expected_order and actual.get("order_number") != expected_order:
            raise ValueError(f"CPU order number {actual.get('order_number') or 'unknown'} does not match {expected_order}")
        if expected_firmware and actual.get("firmware_version") != expected_firmware:
            raise ValueError(f"CPU firmware {actual.get('firmware_version') or 'unknown'} does not match {expected_firmware}")
        return identity

    async def verify(self, sid):
        async with self._lock(sid):
            self.ensure_idle(sid)
            site = self.store.get(sid)
            state = self.states.setdefault(sid, {})
            state.update(verified=False, hardware_verified=False, armed=False, error=None,
                         feedback={}, feedback_valid=False, connection_state="verifying",
                         requires_rearm=True)
            if site["mode"] == "simulated":
                state.update(verified=True, verified_revision=site["revision"], plc_permit=True,
                             plc_heartbeat=0, stop_confirmed=True, connection_state="simulated",
                             contract_version=2, feedback={}, feedback_valid=True, identity=None)
                return self.status(sid)
            old = self.clients.pop(sid, None)
            if old:
                await old.close()
            plc = site["plc"]
            client = self.client_factory(plc["ip"], port=plc["port"], rack=plc["rack"],
                                         slot=plc["slot"], timeout=.5)
            try:
                identity = await self._check_expected_identity(site)
                if not await client.connect():
                    detail = str(getattr(client, "last_error", "") or "").strip()
                    message = "Cannot establish a validated S7 connection"
                    if detail:
                        message += f": {detail}"
                    raise ValueError(message)
                first = await self._header(site, client)
                await asyncio.sleep(.25)
                second = await self._header(site, client)
                if first["plc_heartbeat"] == second["plc_heartbeat"]:
                    raise ValueError("PLC heartbeat is not moving; check the 100-ms cyclic block call")
                if second["plc_running"]:
                    raise ValueError("PLC runtime contract is already running; stop its current controller before verification")
                feedback = await self._feedback(site, client)
                now = time.time()
                self.clients[sid] = client
                state.update(second, verified=True, hardware_verified=True, verified_revision=site["revision"],
                             heartbeat_seen=time.monotonic(), sequence=second["ack"], feedback=feedback,
                             feedback_valid=True,
                             identity=identity, connected_at=now, last_rx_at=now,
                             connection_state="verified_idle", stop_confirmed=True, requires_rearm=True)
            except BaseException as exc:
                state.update(connection_state="failed", error=str(exc), stop_confirmed=False)
                await client.close()
                raise
            return self.status(sid)

    async def reconnect(self, sid):
        """Reconnect and re-verify, but never re-arm or resume a previous show."""
        state = self.states.setdefault(sid, {})
        state["reconnect_attempts"] = state.get("reconnect_attempts", 0) + 1
        return await self.verify(sid)

    async def _commit(self, sid, site, payload, run):
        if len(payload) != COMMAND_SIZE:
            raise ValueError(f"Command frame must be {COMMAND_SIZE} bytes")
        state = self.states[sid]
        sequence = (state.get("sequence", 0) + 1) & 0xFFFF
        heartbeat = (state.get("aquaflow_heartbeat", 0) + 1) & 0xFFFF
        if site["mode"] == "simulated":
            state.update(sequence=sequence, ack=sequence, command_sequence=sequence,
                         aquaflow_heartbeat=heartbeat, plc_running=run, feedback_sequence=sequence,
                         last_ack_at=time.time())
            return
        client, db = self.clients[sid], site["plc"]["db"]
        state["sequence"] = sequence
        actions = (
            lambda: client.write_word(db, 28, FLAG_STAGING),
            lambda: client.write_bytes(db, PUMP_COMMAND_OFFSET, payload),
            lambda: client.write_word(db, 18, heartbeat),
            lambda: client.write_word(db, 28, FLAG_RUN if run else 0),
            lambda: client.write_word(db, 26, sequence),
        )
        for action in actions:
            if not await action():
                raise ValueError("PLC refused a command frame")
        state.update(sequence=sequence, aquaflow_heartbeat=heartbeat, last_tx_at=time.time())
        deadline = time.monotonic() + .7
        while time.monotonic() < deadline:
            header = await self._header(site, client)
            if header["ack"] == sequence and header["feedback_sequence"] == sequence:
                feedback = await self._feedback(site, client)
                if header["plc_heartbeat"] != state.get("plc_heartbeat"):
                    state["heartbeat_seen"] = time.monotonic()
                state.update(header, feedback=feedback, feedback_valid=True,
                             last_rx_at=time.time(), last_ack_at=time.time())
                if run and not header["plc_running"]:
                    reason = header.get("rejected_reason") or header.get("fault")
                    raise ValueError(f"PLC acknowledged the frame but refused RUN: {reason}")
                return
            await asyncio.sleep(.02)
        raise ValueError("PLC did not acknowledge the committed command and feedback; outputs are unconfirmed")

    async def arm(self, sid, flow_path_confirmed=False, *, commissioning=False):
        async with self._lock(sid):
            self.ensure_idle(sid)
            site, state = self.store.get(sid), self.states.setdefault(sid, {})
            if not state.get("verified") or state.get("verified_revision") != site["revision"]:
                raise ValueError("Verify this saved site before arming")
            if site["mode"] != "simulated":
                self._assert_owner(sid, site)
                issues = unsupported_input_bindings(site)
                if issues:
                    raise ValueError(" ".join(issues))
                if not flow_path_confirmed:
                    raise ValueError("Confirm isolated PLCSIM or a safe water flow path, then enable the safety permits")
                # The safety kernel publishes permit outputs on its next 50 Hz
                # tick. An operator can click Prepare & Arm immediately after
                # master ARM, before those outputs have caught up with its state.
                for _ in range(10):
                    if self._allowed():
                        break
                    await asyncio.sleep(.025)
                if not self._allowed():
                    raise ValueError("Confirm isolated PLCSIM or a safe water flow path, then enable the safety permits")
                controlled = [c for c in site["channels"] if c["kind"] in ("pump", "valve", "light")]
                if site["mode"] == "physical" and not commissioning and not all(c["commissioned"] and "plcsim" not in c.get("observation", "").lower() for c in controlled):
                    raise ValueError("Record commissioning observations for every controlled channel")
                if any(not c["output"] or (c["kind"] == "pump" and not c["enable_output"]) for c in controlled):
                    raise ValueError("Configure physical pump, valve and light addresses before arming")
                first = await self._header(site, self.clients[sid])
                await asyncio.sleep(.25)
                header = await self._header(site, self.clients[sid])
                if first["plc_heartbeat"] == header["plc_heartbeat"]:
                    raise ValueError("PLC heartbeat is not moving; verify the CPU is in RUN before arming")
                if header["plc_running"]:
                    raise ValueError("PLC already reports RUN; stop its current controller before arming")
                if not header["plc_permit"]:
                    raise ValueError("PLC local safety permit is off")
            state["armed"] = False
            await self._commit(sid, site, bytes(COMMAND_SIZE), False)
            if state.get("plc_running"):
                raise ValueError("PLC still reports RUN after the stop handshake")
            state.update(armed=True, stop_confirmed=True, error=None, requires_rearm=False,
                         connection_state="armed_idle")
            return self.status(sid)

    async def test_outlet(self, sid, valve_id, seconds=3, flow_path_confirmed=False):
        from engine.siemens_site import finite, compile_show
        seconds = finite(seconds, "Commissioning seconds", .5, 5)
        site = self.store.get(sid)
        valve = next((c for c in site["channels"] if c["id"] == valve_id and c["kind"] == "valve"), None)
        if not valve:
            raise ValueError("Select one mapped outlet valve to test")
        pump = next(c for c in site["channels"] if c["id"] == valve["pump_id"])
        clips = [dict(fixtureId=valve["id"], type="solenoid_open", startTime=0, duration=seconds, value=100),
                 dict(fixtureId=pump["id"], type="pump_speed", startTime=0, duration=seconds,
                      value=min(10, pump["max_percent"]))]
        show = compile_show(site, clips)
        await self.arm(sid, flow_path_confirmed, commissioning=True)
        return await self._start_task(sid, site, lambda: self._play(sid, site, show),
                                      first_frame=frame_at(site, show, 0), commissioning_test=True)

    async def test_device(self, sid, device_id, seconds=3, flow_path_confirmed=False):
        """Commissioning pulse for one device: a valve (with its pump at 10%), a pump (through
        its first outlet, so it never runs against closed valves) or an RGB light colour cycle."""
        from engine.siemens_site import finite, compile_show
        site = self.store.get(sid)
        channel = next((c for c in site["channels"] if c["id"] == device_id), None)
        if not channel:
            raise ValueError("Select a mapped Siemens device to test")
        if channel["kind"] == "valve":
            return await self.test_outlet(sid, device_id, seconds, flow_path_confirmed)
        if channel["kind"] == "pump":
            outlet = next((c for c in sorted(site["channels"], key=lambda c: c["index"])
                           if c["kind"] == "valve" and c.get("pump_id") == device_id), None)
            if not outlet:
                raise ValueError(f"{channel['name']} has no outlet valve to test through")
            return await self.test_outlet(sid, outlet["id"], seconds, flow_path_confirmed)
        # A colour cycle needs time to see red, green and blue; short requests are lengthened.
        seconds = finite(max(float(seconds), 1.5), "Commissioning seconds", 1.5, 6)
        third = seconds / 3
        clips = [dict(fixtureId=device_id, type="lighting_master", startTime=0, duration=seconds, value=100)]
        clips += [dict(fixtureId=device_id, type=f"lighting_{colour}", startTime=i * third, duration=third, value=100)
                  for i, colour in enumerate(("red", "green", "blue"))]
        show = compile_show(site, clips)
        await self.arm(sid, flow_path_confirmed, commissioning=True)
        return await self._start_task(sid, site, lambda: self._play(sid, site, show),
                                      first_frame=frame_at(site, show, 0), commissioning_test=True)

    async def peek(self, sid):
        """Read-only snapshot of the PLC DB for the live monitor. While a show runs the
        play loop owns the connection, so the latest values it read are returned instead."""
        site = self.store.get(sid)
        state = self.states.setdefault(sid, {})
        running = sid in self.tasks and not self.tasks[sid].done()
        snapshot = {"mode": site["mode"], "source": "none", "running": running, "armed": bool(state.get("armed"))}
        if site["mode"] == "simulated":
            return {**snapshot, "source": "preview", "values": state.get("values") or {}}
        client = self.clients.get(sid)
        if running or not client or not state.get("verified"):
            keys = ("plc_heartbeat", "aquaflow_heartbeat", "plc_permit", "permit_bits", "status_bits", "plc_running",
                    "plc_ready", "watchdog_healthy", "fault", "rejected_reason", "ack", "command_sequence",
                    "feedback_sequence", "last_command_age_ms")
            return {**snapshot, "source": "last_frame" if running else "not_connected",
                    "header": {k: state.get(k) for k in keys}, "values": state.get("values") or {},
                    "feedback": state.get("feedback") if state.get("feedback_valid") else {},
                    "read_at": state.get("last_rx_at")}
        async with self._lock(sid):
            if sid in self.tasks and not self.tasks[sid].done():
                return await self.peek(sid)
            try:
                header = await self._header(site, client)
                feedback = await self._feedback(site, client)
            except Exception as exc:
                state.update(feedback_valid=False)
                return {**snapshot, "source": "error", "error": str(exc)}
            now = time.time()
            state.update(last_rx_at=now)
            return {**snapshot, "source": "plc", "header": header, "feedback": feedback,
                    "values": state.get("values") or {}, "read_at": now}

    async def watchdog_probe(self, sid, flow_path_confirmed=False, silence=1.6):
        """Prove the PLC's command watchdog: go silent while OFF, expect the PLC to drop Ready
        with fault 2 (watchdog), then recover with a fresh OFF handshake. Outputs stay OFF."""
        site = self.store.get(sid)
        if site["mode"] == "simulated":
            raise ValueError("The watchdog test needs PLCSIM or a real PLC")
        await self.arm(sid, flow_path_confirmed, commissioning=True)
        async with self._lock(sid):
            self.ensure_idle(sid)
            state, client = self.states[sid], self.clients[sid]
            before = await self._header(site, client)
            state["armed"] = False
            await asyncio.sleep(silence)
            during = await self._header(site, client)
            tripped = (not during["watchdog_healthy"] and during["fault_code"] == 2
                       and not during["plc_ready"] and not during["plc_running"])
            await self._commit(sid, site, bytes(COMMAND_SIZE), False)
            after = await self._header(site, client)
            recovered = bool(after["watchdog_healthy"] and after["fault_code"] != 2)
            state.update(armed=False, stop_confirmed=True, requires_rearm=True, connection_state="verified_idle",
                         values={c["id"]: 0 for c in site["channels"]})
            return {"tripped": tripped, "recovered": recovered, "silence_seconds": silence,
                    "before": {k: before[k] for k in ("watchdog_healthy", "plc_ready", "fault")},
                    "during": {k: during[k] for k in ("watchdog_healthy", "plc_ready", "fault", "last_command_age_ms")},
                    "after": {k: after[k] for k in ("watchdog_healthy", "plc_ready", "fault")}}

    async def _start_task(self, sid, site, coroutine_factory, *, first_frame, **state_patch):
        async with self._lock(sid):
            self.ensure_idle(sid)
            if self.store.get(sid)["revision"] != site["revision"] or not self.states[sid].get("armed"):
                raise ValueError("Site changed or was disarmed before start")
            state = self.states[sid]
            if site["mode"] != "simulated":
                if not self._allowed():
                    raise ValueError("Safety permit is off")
                # The PLC clears Ready after ten 100-ms cycles without a command.
                # Arm's OFF acknowledgement can therefore expire while an operator
                # moves the mouse to Start. Refresh OFF immediately before RUN.
                try:
                    await self._commit(sid, site, bytes(COMMAND_SIZE), False)
                    if state.get("plc_running") or not state.get("plc_permit"):
                        raise ValueError("PLC is running or its local permit is off")
                    payload, values = first_frame
                    await self._commit(sid, site, payload, True)
                except Exception as exc:
                    state.update(armed=False, error=str(exc), requires_rearm=True,
                                 feedback_valid=False, connection_state="start_rejected")
                    try:
                        await self._safe_zero(sid, site)
                    except Exception as stop_exc:
                        state.update(verified=False, hardware_verified=False,
                                     connection_state="stop_unconfirmed", stop_confirmed=False,
                                     error=f"Start rejected: {exc}; Stop unconfirmed: {stop_exc}")
                    raise
                state["values"] = values
            self.states[sid].update(error=None, elapsed=0, stop_confirmed=False,
                                    connection_state="running", **state_patch)
            self.tasks[sid] = asyncio.create_task(coroutine_factory())
            return self.status(sid)

    async def start(self, sid):
        site, state = self.store.get(sid), self.states.setdefault(sid, {})
        show = site.get("show")
        if not state.get("armed") or not show or show["revision"] != site["revision"]:
            raise ValueError("Compile the show and explicitly arm this saved site first")
        # AF-NEXT-009 fail-closed gate: re-run the preflight on the saved show for the current
        # site revision (a show saved by an older compiler gets the current rules too).
        # Internal simulation never writes S7 and stays available as a labelled preview.
        if site["mode"] != "simulated":
            from services.preflight import assert_preflight_ok, siemens_target
            assert_preflight_ok({"clips": show["clips"]}, siemens_target(site))
        if site["mode"] != "simulated" and not self._allowed():
            raise ValueError("Safety permit is off")
        self._assert_owner(sid, site)
        return await self._start_task(sid, site, lambda: self._play(sid, site, show),
                                      first_frame=frame_at(site, show, 0), runtime_mode="show")

    async def start_manual(self, sid, values):
        site, state = self.store.get(sid), self.states.setdefault(sid, {})
        if not state.get("armed"):
            raise ValueError("Verify and arm before starting manual control")
        unknown = set(values) - {c["id"] for c in site["channels"]}
        if unknown:
            raise ValueError(f"Unknown Siemens channel(s): {', '.join(sorted(unknown))}")
        payload, normalized = frame_from_values(site, values)
        if site["mode"] != "simulated" and not self._allowed():
            raise ValueError("Safety permit is off")
        self._assert_owner(sid, site)
        return await self._start_task(sid, site, lambda: self._hold(sid, site, payload, normalized),
                                      first_frame=(payload, normalized), runtime_mode="manual", values=normalized)

    async def _supervise(self, sid, site):
        if site["mode"] == "simulated":
            return
        header = await self._header(site, self.clients[sid])
        if not self._allowed() or not header["plc_permit"]:
            raise ValueError("Safety permit withdrawn")
        state = self.states[sid]
        now = time.monotonic()
        if header["plc_heartbeat"] != state.get("plc_heartbeat"):
            state["heartbeat_seen"] = now
        if now - state.get("heartbeat_seen", now) > 1:
            raise ValueError("PLC heartbeat stopped")
        state.update(header)

    async def _play(self, sid, site, show):
        started = time.monotonic()
        try:
            while True:
                elapsed = time.monotonic() - started
                if elapsed >= show["duration"]:
                    break
                await self._supervise(sid, site)
                payload, values = frame_at(site, show, elapsed)
                await self._commit(sid, site, payload, True)
                self.states[sid].update(values=values, elapsed=elapsed)
                await asyncio.sleep(.1)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.states[sid].update(error=str(exc), verified=False, hardware_verified=False,
                                    feedback_valid=False,
                                    connection_state="lost", requires_rearm=True)
        finally:
            await self._finish(sid, site)

    async def _hold(self, sid, site, payload, values):
        started = time.monotonic()
        try:
            while True:
                await self._supervise(sid, site)
                await self._commit(sid, site, payload, True)
                self.states[sid].update(values=values, elapsed=time.monotonic() - started)
                await asyncio.sleep(.1)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.states[sid].update(error=str(exc), verified=False, hardware_verified=False,
                                    feedback_valid=False,
                                    connection_state="lost", requires_rearm=True)
        finally:
            await self._finish(sid, site)

    async def _finish(self, sid, site):
        state = self.states[sid]
        state["armed"] = False
        try:
            await self._safe_zero(sid, site)
            if state.get("connection_state") not in ("lost", "stopped_reverify_required"):
                state["connection_state"] = "verified_idle"
            else:
                state["feedback_valid"] = False
        except Exception as exc:
            state.update(verified=False, hardware_verified=False, feedback_valid=False,
                         connection_state="stop_unconfirmed", stop_confirmed=False, requires_rearm=True,
                         error=f"{state.get('error') or ''} Stop unconfirmed: {exc}".strip())

    async def _safe_zero(self, sid, site):
        state = self.states[sid]
        state.update(armed=False, stop_confirmed=False)
        try:
            await self._commit(sid, site, bytes(COMMAND_SIZE), False)
        except Exception:
            # Cancellation can interrupt a read while its S7 reply is in flight.
            # That stream cannot be reused: the next request can receive the old
            # reply and fail its PDU reference check. Reconnect once, validate the
            # same site's DB contract, and send a complete OFF frame again.
            client = self.clients.get(sid)
            if site["mode"] == "simulated" or client is None or client.is_connected:
                raise
            if not await client.connect():
                raise ValueError(f"Cannot reconnect to confirm OFF: {client.last_error}")
            await self._header(site, client)
            await self._commit(sid, site, bytes(COMMAND_SIZE), False)
            state.update(verified=False, hardware_verified=False, requires_rearm=True,
                         connection_state="stopped_reverify_required", error=None)
        if state.get("plc_running"):
            raise ValueError("PLC acknowledged OFF but still reports RUN")
        state.update(values={c["id"]: 0 for c in site["channels"]},
                     stop_confirmed=True)

    async def stop(self, sid):
        async with self._lock(sid):
            site = self.store.get(sid)
            task = self.tasks.pop(sid, None)
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            if sid in self.states and (site["mode"] == "simulated" or sid in self.clients) and (
                not self.states[sid].get("stop_confirmed") or self.states[sid].get("armed")
            ):
                try:
                    await self._safe_zero(sid, site)
                    if self.states[sid].get("stop_confirmed") and self.states[sid].get("connection_state") == "stop_unconfirmed":
                        self.states[sid].update(connection_state="verified_idle", error=None)
                except Exception as exc:
                    self.states[sid].update(armed=False, verified=False, hardware_verified=False,
                                            feedback_valid=False,
                                            connection_state="stop_unconfirmed", stop_confirmed=False,
                                            requires_rearm=True,
                                            error=f"Stop unconfirmed: {exc}")
            return self.status(sid)

    async def emergency_stop(self):
        await asyncio.gather(*(self.stop(sid) for sid in list(self.states)), return_exceptions=False)

    async def blackout(self):
        await self.emergency_stop()

    async def close(self):
        await self.emergency_stop()
        await asyncio.gather(*(client.close() for client in self.clients.values()))
        self.clients.clear()
