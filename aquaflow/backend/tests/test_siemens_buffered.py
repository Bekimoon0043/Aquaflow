"""Frame-accurate Siemens playback (runtime contract v3).

The PLC keeps its own show clock in a 10-ms cyclic OB and applies timestamped command banks
from a lookahead ring the PC keeps filled.  These tests drive the real SiemensRuntime over
real S7comm against engine.fake_s7_server.FakeAquaFlowPlc, a model of the generated
AquaFlowSiteControl FB, with injected PC/network jitter.  No real PLC or PLCSIM is touched.
"""
import asyncio
import io
import random
import re
import statistics
import struct
import zipfile

import pytest

from engine import siemens_contract as C
from engine.fake_s7_server import FakeAquaFlowPlc, FakeS7Server
from engine.s7_client import S7Client
from engine.siemens_runtime import BankStream, SiemensRuntime, bank_schedule
from engine.siemens_site import SiteStore, compile_show, create_site, frame_from_values
from services.siemens_tia_package import CYCLIC_OB_REQUIREMENT, build_tia_package

# Measured numbers are collected here and printed by the jitter tests (pytest -s).
MEASURED = {}


# ── fixtures ─────────────────────────────────────────────────────────────────
def bench_site(min_ms=100):
    site = create_site()
    site["mode"] = "plcsim"
    site["plc"]["ip"] = "192.0.2.10"          # the client factory redirects to loopback
    pump = site["channels"][0]
    pump.update(output="%QW64", enable_output="%Q0.0")
    for index, channel in enumerate(site["channels"]):
        if channel["kind"] == "valve":
            channel.update(output=f"%Q0.{index}", min_on_ms=min_ms, min_off_ms=min_ms)
    return site


def cue_clips(site):
    """Cues on odd milliseconds, so 50/100-ms quantization would show."""
    pump, v1, v2, v3, v4 = site["channels"]
    clip = lambda ch, start, end: {"fixtureId": ch["id"], "type": "solenoid_open", "startTime": start,
                                   "duration": round(end - start, 3), "value": 100}
    return [
        {"fixtureId": pump["id"], "type": "pump_speed", "startTime": 0, "duration": 2.9, "value": 30},
        clip(v1, .333, 1.217), clip(v2, 1.217, 2.051), clip(v3, 2.051, 2.9), clip(v4, .613, .917),
    ]


def expected_transitions(site):
    _, v1, v2, v3, v4 = site["channels"]
    return [(333, v1["id"], True), (1217, v1["id"], False), (1217, v2["id"], True), (2051, v2["id"], False),
            (2051, v3["id"], True), (2900, v3["id"], False), (613, v4["id"], True), (917, v4["id"], False)]


async def bench(tmp_path, *, contract_version=C.CONTRACT_VERSION, clips=cue_clips, min_ms=100):
    store = SiteStore(tmp_path / "sites.json")
    site = store.save(bench_site(min_ms))
    store.save_show(site["id"], clips(site), site["revision"])
    site = store.get(site["id"])
    server = FakeS7Server()
    await server.start()
    plc = FakeAquaFlowPlc(server, site, contract_version=contract_version).start()
    runtime = SiemensRuntime(store, permit=lambda: True,
                             client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=1.0))
    return store, site, server, plc, runtime


async def teardown(runtime, plc, server):
    server.write_delay = server.read_delay = None
    try:
        await runtime.close()
    finally:
        plc.stop()
        await server.stop()


def output_changes(plc, channel_id, *, clock=True):
    """(time, state) every time one output changed while RUN (PLC clock or wall since RUN)."""
    key = "clock_ms" if clock else "since_run_ms"
    changes, last = [], False
    for event in plc.events:
        value = event["outputs"].get(channel_id, False)
        if value != last and event[key] is not None:
            changes.append((event[key], value))
        last = value
    return changes


def cue_errors(plc, site, *, clock=True, required=True):
    errors = []
    for cue_ms, cid, state in expected_transitions(site):
        times = [t for t, value in output_changes(plc, cid, clock=clock) if value == state]
        if not times and not required:
            continue
        assert times, (cid, state, plc.events[-3:])
        errors.append(min(times, key=lambda t: abs(t - cue_ms)) - cue_ms)
    return errors


# ── contract layout ──────────────────────────────────────────────────────────
def test_contract_v3_layout_sizes_and_pdu_fit():
    assert (C.CONTRACT_VERSION, C.PROGRAM_VERSION, C.CYCLE_MS) == (3, 0x00030000, 10)
    assert (C.LEGACY_CONTRACT_VERSION, C.LEGACY_PROGRAM_VERSION, C.LEGACY_CYCLE_MS) == (2, 0x00020000, 100)
    assert C.COMMAND_SIZE == 208 and C.SLOT_SIZE == 212 == C.MAX_S7_WRITE
    # One slot is exactly one S7 Write Var at the S7-1200's 240-byte PDU: header 10 +
    # parameter 14 + data header 4 + payload 212.
    assert 10 + 14 + 4 + C.SLOT_SIZE == 240
    assert C.LEGACY_DB_SIZE == 472 and C.STREAM_CONTROL_OFFSET == C.LEGACY_DB_SIZE
    assert C.RING_OFFSET == 488 and C.DB_SIZE == 488 + 32 * 212 == 7272
    assert C.slot_offset(0) == 488 and C.slot_offset(33) == 488 + 212 and C.slot_offset(65535) == 488 + 31 * 212
    # The v3 clock fields live in the bytes the v2 header reserved; the v2 layout is unchanged.
    header_fields = [(C.LAST_LATE_OFFSET, 2), (C.SHOW_CLOCK_OFFSET, 4), (C.BUFFER_READ_OFFSET, 2),
                     (C.BUFFER_CAPACITY_OFFSET, 2), (C.WORST_LATE_OFFSET, 2), (C.BUFFER_STATUS_OFFSET, 2),
                     (C.APPLIED_AT_OFFSET, 4)]
    assert sum(size for _, size in header_fields) == 18
    spans = sorted((o, o + n) for o, n in header_fields + [(44, 4)])
    assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:])) and spans[-1][1] == C.HEADER_SIZE
    assert C.encode_slot(1234, bytes(208))[:4] == struct.pack(">I", 1234) and len(C.encode_slot(0, bytes(208))) == 212
    assert C.encode_stream_control(65537, 3, 1500) == struct.pack(">HHI", 1, 3, 1500)
    with pytest.raises(ValueError):
        C.encode_slot(0, bytes(10))


def _db_layout(source):
    """Byte offsets of the top-level fields of a non-optimized DB source (S7 rules: every
    non-byte element starts on an even byte; structs and arrays are padded to even)."""
    size = {"Bool": 1, "Byte": 1, "Word": 2, "UInt": 2, "Int": 2, "DWord": 4, "UDInt": 4, "DInt": 4}
    body = source.split("STRUCT", 1)[1].rsplit("END_STRUCT;", 1)[0]
    offsets, offset, lines = {}, 0, iter(body.splitlines())
    align = lambda o: o + (o % 2)
    for line in lines:
        line = line.split("//")[0].strip()
        if not line:
            continue
        name, kind = [x.strip() for x in line.rstrip(";").split(":", 1)]
        kind = kind.split(":=")[0].strip()
        array = re.match(r"Array\[(\d+)\.\.(\d+)\] of (\w+)", kind)
        count = int(array[2]) - int(array[1]) + 1 if array else 1
        element = array[3] if array else kind
        if element == "Struct":
            inner = 0
            for member in lines:
                member = member.split("//")[0].strip()
                if member.startswith("END_STRUCT"):
                    break
                mname, mkind = [x.strip() for x in member.rstrip(";").split(":", 1)]
                marray = re.match(r"Array\[(\d+)\.\.(\d+)\] of (\w+)", mkind)
                mcount = int(marray[2]) - int(marray[1]) + 1 if marray else 1
                mel = marray[3] if marray else mkind
                if size[mel] > 1:
                    inner = align(inner)
                inner += size[mel] * mcount
            width = align(inner)
            offset = align(offset)
        else:
            width = size[element]
            if width > 1 or array:
                offset = align(offset)
        offsets[name] = offset
        offset += width * count
    return offsets, align(offset)


def test_tia_package_generates_the_v3_db_fb_and_10ms_ob():
    site = bench_site()
    site["channels"][1].update(min_on_ms=130, min_off_ms=270)
    with zipfile.ZipFile(io.BytesIO(build_tia_package(site))) as archive:
        db = archive.read("AquaFlowSiteIO.db").decode()
        fb = archive.read("AquaFlowSiteControl.scl").decode()
        ob = archive.read("AquaFlowCycle.scl").decode()
        readme = archive.read("README.txt").decode()
        quickstart = archive.read("TIA-V17-PLUS-QUICKSTART.txt").decode()
        same_pc = archive.read("SAME-PC-PLCSIM-GUIDE.txt").decode()
        contract = __import__("json").loads(archive.read("runtime-contract.json"))
    offsets, size = _db_layout(db)
    assert size == C.DB_SIZE
    for name, expected in {"CycleMs": 34, "LastLateMs": C.LAST_LATE_OFFSET, "LastCommandAgeMs": 44,
                           "ShowClockMs": C.SHOW_CLOCK_OFFSET, "BufferReadIndex": C.BUFFER_READ_OFFSET,
                           "BufferCapacity": C.BUFFER_CAPACITY_OFFSET, "WorstLateMs": C.WORST_LATE_OFFSET,
                           "BufferStatus": C.BUFFER_STATUS_OFFSET, "AppliedAtMs": C.APPLIED_AT_OFFSET,
                           "PumpSpeed": C.PUMP_COMMAND_OFFSET, "ValveBits": C.VALVE_COMMAND_OFFSET,
                           "LightRGB": C.LIGHT_COMMAND_OFFSET, "PumpApplied": C.PUMP_FEEDBACK_OFFSET,
                           "LightActiveBits": C.LIGHT_ACTIVE_OFFSET, "BufferWriteIndex": C.BUFFER_WRITE_OFFSET,
                           "StreamKeepalive": C.STREAM_KEEPALIVE_OFFSET, "ValidUntilMs": C.VALID_UNTIL_OFFSET,
                           "Ring": C.RING_OFFSET}.items():
        assert offsets[name] == expected, name
    assert "CycleMs : UInt := 10" in db and "BufferCapacity : UInt := 32" in db
    # FB: show clock, ring apply, keepalive watchdog, underrun hold/stop, flush, ms min on/off.
    for token in ('"AquaFlowSiteIO".CycleMs := 10;', "#ShowClock := #ShowClock + 10;",
                  '"AquaFlowSiteIO".Ring[#Slot].AtMs > #ShowClock', "StreamKeepalive <> #LastKeepalive",
                  "#CommandAgeMs >= 1000", "(#ShowClock - #ValidUntil) >= 1000", "#StreamFault := 5;",
                  '"AquaFlowSiteIO".BufferReadIndex := "AquaFlowSiteIO".BufferWriteIndex;',
                  '"AquaFlowSiteIO".RejectedReason := 5;', "#ValveAgeMs[0] >= 130", "#ValveAgeMs[0] >= 270",
                  "#ValveAgeMs[0] := #ValveAgeMs[0] + 10;", "#PumpAllowed := #Running AND"):
        assert token in fb, token
    # The buffer cannot bypass the interlocks: permits/watchdog are evaluated before the ring is
    # read, the ring only feeds the snapshots, and valve/pump/output logic runs after it.
    assert fb.index("#LocalPermit :=") < fb.index("IF #Running AND #Buffered THEN") < fb.index("#Wanted :=")
    assert fb.index("(#CommandAgeMs >= 1000) THEN") < fb.index("IF #Running AND #Buffered THEN")
    assert fb.index("#Wanted :=") < fb.index("#PumpAllowed :=")
    assert fb.rindex('"AquaFlowSiteIO".AckSequence') > fb.rindex('"AquaFlowSiteIO".Status')
    assert "MissedCycles" not in fb
    assert "Cyclic interrupt, 10 ms" in ob and CYCLIC_OB_REQUIREMENT["cycle_us"] == 10000
    assert "10-ms" in readme and "FRAME-ACCURATE TIMING" in readme
    assert "Cyclic interrupt, 10 ms, phase 0" in quickstart and "from 100 ms to 10 ms" in quickstart
    assert "Cycle: 10 ms" in same_pc and "from 100 ms to 10 ms" in same_pc
    assert contract["cycle_ms"] == 10 and contract["buffer"]["ring"] == C.RING_OFFSET


# ── PLC logic, ticked by hand (deterministic) ────────────────────────────────
class Desk:
    """Plays the PC's part directly on the DB, one OB tick at a time."""

    def __init__(self, site, version=C.CONTRACT_VERSION):
        self.server = FakeS7Server()
        self.plc = FakeAquaFlowPlc(self.server, site, contract_version=version)
        self.site, self.seq, self.write = site, 0, 0
        self.db = self.server.dbs[100]

    def commit(self, bank, flags):
        self.seq += 1
        self.db[C.PUMP_COMMAND_OFFSET:C.COMMAND_END] = bank
        struct.pack_into(">H", self.db, 28, flags)
        struct.pack_into(">H", self.db, 26, self.seq)
        self.plc.tick()

    def push(self, at_ms, bank, valid_until, keepalive=None):
        self.db[C.slot_offset(self.write):C.slot_offset(self.write) + C.SLOT_SIZE] = C.encode_slot(at_ms, bank)
        self.write += 1
        self.control(valid_until, keepalive)

    def control(self, valid_until, keepalive=None):
        keep = struct.unpack_from(">H", self.db, C.STREAM_KEEPALIVE_OFFSET)[0] + 1 if keepalive is None else keepalive
        self.db[C.STREAM_CONTROL_OFFSET:C.STREAM_CONTROL_OFFSET + 8] = C.encode_stream_control(self.write, keep, valid_until)

    def word(self, offset):
        return struct.unpack_from(">H", self.db, offset)[0]

    def ticks(self, n, keepalive=True, valid_until=None):
        for _ in range(n):
            if keepalive:
                self.control(valid_until if valid_until is not None else struct.unpack_from(">I", self.db, C.VALID_UNTIL_OFFSET)[0])
            self.plc.tick()


def bank(site, **values):
    ids = {c["id"].rsplit("-", 2)[-2] + c["id"].rsplit("-", 1)[-1]: c["id"] for c in site["channels"]}
    return frame_from_values(site, {ids[k]: v for k, v in values.items()})[0]


def test_plc_applies_ring_banks_on_its_clock_and_enforces_ms_min_times():
    site = bench_site(min_ms=130)
    desk = Desk(site)
    v1 = site["channels"][1]["id"]
    desk.commit(bytes(208), 0)                                    # OFF handshake → Ready
    desk.push(0, bytes(208), 1000)
    desk.push(155, bank(site, valve1=100, pump1=20), 1000)        # wanted ON at 155 ms
    desk.push(205, bytes(208), 1000)                              # wanted OFF at 205 ms (< 130 ms on)
    desk.commit(bytes(208), C.FLAG_RUN | C.FLAG_BUFFERED)
    assert desk.plc.running and desk.plc.buffered and desk.plc.clock == 0
    desk.ticks(60)
    applied = [(a["at_ms"], a["clock_ms"]) for a in desk.plc.applied]
    assert applied == [(0, 0), (155, 160), (205, 210)]           # each within one 10-ms tick
    opened = [t for t, on in output_changes(desk.plc, v1) if on]
    closed = [t for t, on in output_changes(desk.plc, v1) if not on]
    assert opened == [160]
    assert closed == [290]                                        # held for min_on 130 ms, not 50
    assert desk.word(C.WORST_LATE_OFFSET) == 5 and desk.word(C.BUFFER_STATUS_OFFSET) & C.BUFFER_ACTIVE


def test_plc_underrun_holds_the_last_bank_then_stops_and_flushes():
    site = bench_site()
    desk = Desk(site)
    v1 = site["channels"][1]["id"]
    desk.commit(bytes(208), 0)
    desk.push(0, bank(site, valve1=100, pump1=20), 300)
    desk.commit(bank(site, valve1=100, pump1=20), C.FLAG_RUN | C.FLAG_BUFFERED)
    desk.ticks(50, valid_until=300)                               # clock 500: 200 ms past ValidUntil
    assert desk.plc.running and desk.word(C.BUFFER_STATUS_OFFSET) & C.BUFFER_UNDERRUN
    assert desk.plc.outputs[v1] is True                           # hold, as a stalled stream did
    desk.ticks(80, valid_until=300)                               # 1000 ms past → safe stop
    assert not desk.plc.running and not desk.plc.ready
    assert desk.word(22) == 5 and desk.plc.outputs[v1] is False
    assert desk.word(C.BUFFER_READ_OFFSET) == desk.word(C.BUFFER_WRITE_OFFSET)
    desk.commit(bytes(208), C.FLAG_RUN | C.FLAG_BUFFERED)          # no auto-restart without OFF
    assert not desk.plc.running and desk.word(30) == 2
    desk.commit(bytes(208), 0)                                    # fresh OFF clears the latch
    assert desk.word(22) == 0 and desk.plc.ready


def test_plc_keepalive_watchdog_and_permit_drop_buffered_outputs():
    site = bench_site()
    desk = Desk(site)
    v1 = site["channels"][1]["id"]
    desk.commit(bytes(208), 0)
    desk.push(0, bank(site, valve1=100, pump1=20), 60000)
    desk.commit(bank(site, valve1=100, pump1=20), C.FLAG_RUN | C.FLAG_BUFFERED)
    desk.ticks(150)                                               # keepalive every tick: 1.5 s fine
    assert desk.plc.running and desk.plc.outputs[v1] is True
    desk.ticks(99, keepalive=False)
    assert desk.plc.running                                       # 990 ms silent: still inside 1 s
    desk.ticks(1, keepalive=False)
    assert not desk.plc.running and desk.word(22) == 2 and desk.plc.outputs[v1] is False
    # permit loss
    desk2 = Desk(site)
    desk2.commit(bytes(208), 0)
    desk2.push(0, bank(site, valve1=100, pump1=20), 60000)
    desk2.commit(bank(site, valve1=100, pump1=20), C.FLAG_RUN | C.FLAG_BUFFERED)
    desk2.ticks(20)
    desk2.plc.local_permit = False
    desk2.ticks(1)
    assert not desk2.plc.running and desk2.word(22) == 1 and not any(
        v for v in desk2.plc.outputs.values() if v is True)


def test_plc_rejects_invalid_rings_and_streamed_buffered_switch():
    site = bench_site()
    desk = Desk(site)
    desk.commit(bytes(208), 0)
    desk.push(0, bytes(208), 5000)
    desk.push(500, bytes(208), 5000)
    desk.push(400, bytes(208), 5000)                              # time runs backwards
    desk.commit(bytes(208), C.FLAG_RUN | C.FLAG_BUFFERED)
    desk.ticks(60)
    assert not desk.plc.running and desk.word(22) == 4
    # an impossible write counter (more pending than slots)
    desk = Desk(site)
    desk.commit(bytes(208), 0)
    desk.write = 40
    desk.control(5000)
    desk.commit(bytes(208), C.FLAG_RUN | C.FLAG_BUFFERED)
    assert not desk.plc.running and desk.word(22) == 4
    # streamed RUN then a buffered RUN commit: refused, outputs off, fresh OFF needed
    desk = Desk(site)
    desk.commit(bytes(208), 0)
    desk.commit(bank(site, valve1=100), C.FLAG_RUN)
    assert desk.plc.running and not desk.plc.buffered
    desk.commit(bank(site, valve1=100), C.FLAG_RUN | C.FLAG_BUFFERED)
    assert not desk.plc.running and desk.word(30) == 5


def test_v2_program_ignores_the_buffer_flag_and_keeps_100ms_ticks():
    site = bench_site(min_ms=130)
    desk = Desk(site, version=C.LEGACY_CONTRACT_VERSION)
    assert desk.plc.cycle_ms == 100 and len(desk.db) == C.LEGACY_DB_SIZE
    desk.commit(bytes(208), 0)
    desk.commit(bank(site, valve1=100, pump1=20), C.FLAG_RUN | C.FLAG_BUFFERED)
    assert desk.plc.running and not desk.plc.buffered


# ── schedule ─────────────────────────────────────────────────────────────────
def test_bank_schedule_places_cues_on_exact_ms_and_ends_off():
    site = bench_site()
    show = compile_show(site, cue_clips(site))
    banks = list(bank_schedule(site, show))
    times = [at for at, _, _ in banks]
    assert times == sorted(times) and times[0] == 0 and times[-1] == 2900
    assert {333, 613, 917, 1217, 2051, 2900} <= set(times)
    assert banks[-1][1] == bytes(208)
    # fades are sampled every 50 ms
    pump = site["channels"][0]
    v1 = site["channels"][1]
    fade = compile_show(site, [{"fixtureId": pump["id"], "type": "pump_speed", "startTime": 0, "duration": 2,
                                "value": 40, "fadeIn": 1, "fadeOut": 0},
                               {"fixtureId": v1["id"], "type": "solenoid_open", "startTime": 0, "duration": 2, "value": 100}])
    fade_times = [at for at, _, _ in bank_schedule(site, fade)]
    assert fade_times[:4] == [0, 50, 100, 150] and 1000 in fade_times and 1050 not in fade_times


# ── runtime against the emulated PLC, with jitter ────────────────────────────
def test_buffered_playback_lands_every_cue_within_one_plc_tick_under_jitter(tmp_path):
    async def scenario():
        store, site, server, plc, runtime = await bench(tmp_path)
        rng = random.Random(7)
        server.write_delay = lambda: rng.uniform(0, .2)          # 0..200 ms on every S7 write
        server.read_delay = lambda: rng.uniform(0, .02)
        try:
            sid = site["id"]
            verified = await runtime.verify(sid)
            assert verified["timing"]["mode"] == "buffered" and verified["timing"]["notice"] is None
            await runtime.arm(sid, True)
            started = await runtime.start(sid)
            assert started["running"] and started["timing"]["mode"] == "buffered"
            await asyncio.sleep(.6)
            live = runtime.status(sid)["timing"]
            assert live["plcClockMs"] is not None and live["aheadMs"] > 0
            await asyncio.wait_for(runtime.tasks[sid], 15)
            status = runtime.status(sid)
            assert status["error"] is None, status["error"]
            assert status["stop_confirmed"] and not status["armed"]
            late = [a["late_ms"] for a in plc.applied]
            assert late and all(0 <= x < C.CYCLE_MS for x in late), late
            errors = cue_errors(plc, site)
            assert all(0 <= e < C.CYCLE_MS for e in errors), errors
            assert status["timing"]["worstLateMs"] < C.CYCLE_MS
            assert status["timing"]["underruns"] == 0
            wall = cue_errors(plc, site, clock=False)
            MEASURED["buffered"] = {"plc_clock_err_ms": errors, "wall_err_ms": [round(w, 1) for w in wall],
                                    "worst_late_ms": status["timing"]["worstLateMs"], "writes": server.writes}
            # Outputs end OFF on the PLC clock at 2.9 s and the ring is flushed after Stop.
            assert not any(v is True or (isinstance(v, float) and v > 0) for v in plc.outputs.values())
            db = server.dbs[100]
            assert struct.unpack_from(">H", db, C.BUFFER_READ_OFFSET) == struct.unpack_from(">H", db, C.BUFFER_WRITE_OFFSET)
            print("\nMEASURED buffered", MEASURED["buffered"])
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_old_contract_program_falls_back_to_streaming_with_an_update_notice(tmp_path):
    async def scenario():
        store, site, server, plc, runtime = await bench(tmp_path, contract_version=C.LEGACY_CONTRACT_VERSION)
        rng = random.Random(7)
        # Five writes per streamed commit: 0..40 ms each keeps the old program inside its own
        # 1-s watchdog. (0..200 ms per write would trip it — one reason v3 exists.)
        server.write_delay = lambda: rng.uniform(0, .04)
        flags_seen = set()
        try:
            sid = site["id"]
            verified = await runtime.verify(sid)
            assert verified["contract_version"] == 2
            assert verified["timing"]["mode"] == "streamed"
            assert "update" in verified["timing"]["notice"].lower() or "Download" in verified["timing"]["notice"]
            await runtime.arm(sid, True)
            await runtime.start(sid)
            while not runtime.tasks[sid].done():
                flags_seen.add(struct.unpack_from(">H", server.dbs[100], 28)[0])
                await asyncio.sleep(.05)
            status = runtime.status(sid)
            assert status["error"] is None, status["error"]
            assert not any(f & C.FLAG_BUFFERED for f in flags_seen)       # never the v3 flag
            assert status["timing"]["mode"] == "streamed" and status["timing"]["worstLateMs"] > 0
            errors = cue_errors(plc, site, clock=False, required=False)
            MEASURED["streamed"] = {"wall_err_ms": [round(e, 1) for e in errors],
                                    "estimated_worst_late_ms": status["timing"]["worstLateMs"]}
            print("\nMEASURED streamed (v2 fallback, same jitter)", MEASURED["streamed"])
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


class FrozenHorizonRuntime(SiemensRuntime):
    """A PC that keeps sending keepalives but stops extending the ring (a stuck streamer)."""

    def _valid_until(self, stream, horizon_ms):
        return min(600, super()._valid_until(stream, horizon_ms))


def test_underrun_holds_then_safe_stops_and_runtime_reports_it(tmp_path):
    async def scenario():
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(bench_site())
        store.save_show(site["id"], cue_clips(site), site["revision"])
        site = store.get(site["id"])
        server = FakeS7Server()
        await server.start()
        plc = FakeAquaFlowPlc(server, site).start()
        runtime = FrozenHorizonRuntime(store, permit=lambda: True,
                                       client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=1.0))
        runtime.lookahead_ms = 300
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.wait_for(runtime.tasks[sid], 10)
            status = runtime.status(sid)
            assert "buffer_underrun" in status["error"]
            assert status["timing"]["underruns"] >= 1
            assert status["stop_confirmed"] and not status["armed"] and status["requires_rearm"]
            # The PLC held the last bank after 600 ms and stopped itself 1 s later.
            assert not any(v is True for v in plc.outputs.values())
            last_running = max(e["clock_ms"] for e in plc.events if e["clock_ms"] is not None)
            assert last_running < 600 + C.UNDERRUN_LIMIT_MS
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_stop_drops_outputs_and_clears_the_ring(tmp_path):
    async def scenario():
        store, site, server, plc, runtime = await bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.sleep(.7)                                # v1 and v4 open, pump running
            assert any(v is True for v in plc.outputs.values())
            db = server.dbs[100]
            assert struct.unpack_from(">H", db, C.BUFFER_WRITE_OFFSET) != struct.unpack_from(">H", db, C.BUFFER_READ_OFFSET)
            stopped = await runtime.stop(sid)
            assert stopped["stop_confirmed"] and not stopped["running"] and not stopped["armed"]
            await asyncio.sleep(.05)
            assert not any(v is True or (isinstance(v, float) and v > 0) for v in plc.outputs.values())
            assert struct.unpack_from(">H", db, C.BUFFER_READ_OFFSET) == struct.unpack_from(">H", db, C.BUFFER_WRITE_OFFSET)
            assert struct.unpack_from(">H", db, C.BUFFER_STATUS_OFFSET)[0] == 0
            assert struct.unpack_from(">I", db, C.SHOW_CLOCK_OFFSET)[0] == 0
            assert db[C.PUMP_COMMAND_OFFSET:C.COMMAND_END] == bytes(208)
            # A new show starts from an empty ring at the PLC's read counter.
            if not runtime.status(sid)["verified"]:
                await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.sleep(.5)
            assert runtime.status(sid)["error"] is None
            await runtime.stop(sid)
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_lost_pc_link_lets_the_plc_drop_outputs_by_itself(tmp_path):
    async def scenario():
        store, site, server, plc, runtime = await bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.sleep(.5)
            assert plc.running
            server.write_delay = lambda: 3.0                     # PC writes no longer arrive
            frozen = plc.ticks
            for _ in range(150):
                if not plc.running:
                    break
                await asyncio.sleep(.01)
            silent_ms = (plc.ticks - frozen) * C.CYCLE_MS
            assert not plc.running and silent_ms <= C.WATCHDOG_MS + 300
            assert struct.unpack_from(">H", server.dbs[100], 22)[0] == 2
            assert not any(v is True for v in plc.outputs.values())
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_plc_heartbeat_loss_stops_the_buffered_show(tmp_path):
    async def scenario():
        store, site, server, plc, runtime = await bench(tmp_path)
        try:
            sid = site["id"]
            await runtime.verify(sid)
            await runtime.arm(sid, True)
            await runtime.start(sid)
            await asyncio.sleep(.3)
            plc.freeze_heartbeat = True
            await asyncio.wait_for(runtime.tasks[sid], 5)
            status = runtime.status(sid)
            assert "heartbeat stopped" in status["error"]
            assert status["stop_confirmed"] and not status["armed"] and not status["verified"]
            assert not plc.running and not any(v is True for v in plc.outputs.values())
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_verify_refuses_a_v3_program_in_a_100ms_ob(tmp_path):
    async def scenario():
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(bench_site())
        server = FakeS7Server()
        await server.start()
        plc = FakeAquaFlowPlc(server, site)
        plc.cycle_ms = 100                                         # OB200 left at TIA's 100-ms default
        plc.start()
        runtime = SiemensRuntime(store, permit=lambda: True,
                                 client_factory=lambda host, **kw: S7Client("127.0.0.1", port=server.port, timeout=1.0))
        try:
            with pytest.raises(ValueError, match="10 ms cyclic interrupt"):
                await runtime.verify(site["id"])
            assert server.writes == 0
        finally:
            await teardown(runtime, plc, server)
    asyncio.run(scenario())


def test_simulated_site_reports_preview_timing(tmp_path):
    async def scenario():
        store = SiteStore(tmp_path / "sites.json")
        site = store.save(create_site())
        runtime = SiemensRuntime(store, permit=lambda: True)
        status = await runtime.verify(site["id"])
        assert status["timing"]["mode"] == "preview"
        await runtime.close()
    asyncio.run(scenario())


def test_bank_stream_tracks_applied_values():
    site = bench_site()
    stream = BankStream(site, compile_show(site, cue_clips(site)))
    stream.write_index = 3
    stream.queued.extend([(0, "a"), (333, "b"), (613, "c")])
    assert stream.mark_applied(1) == "a" and len(stream.queued) == 2
    assert stream.mark_applied(3) == "c" and not stream.queued
