"""The hardware-proven one-minute I-CAN demo and its stop/blackout contract."""
from __future__ import annotations

import asyncio
import hashlib

import pytest

from engine import ican_reference_client as reference
from engine.ican_site_demo import ICANSiteDemo, SiteDemoStartError
from engine.ican_site_demo_sequence import (
    SITE_CAPTURE_SHA256,
    SITE_DEMO_DURATION_S,
    SITE_DEMO_EVENTS,
    SITE_DEMO_GROUPS,
    SITE_SEQUENCE_SHA256,
    SiteDemoEvent,
)


class FakeConnection:
    def __init__(self, *, connected=True, armed=True):
        self.connected = connected
        self.armed = armed
        self.sent = []
        self.blackouts = 0

    def status(self):
        return {
            "state": "connected" if self.connected else "disconnected",
            "output_enabled": self.armed,
        }

    async def send_output(self, group, channels, **kwargs):
        self.sent.append((group, tuple(channels), kwargs))
        return self.connected and self.armed

    async def blackout(self):
        self.blackouts += 1
        return True


def test_embedded_site_sequence_is_the_exact_one_minute_capture_segment():
    assert SITE_CAPTURE_SHA256 == "49dca4c5c5cf2debe4e9ee11c0eb0ccffd26031586073877faf6f553ed2fd3d2"
    assert SITE_DEMO_DURATION_S == 60.0
    assert len(SITE_DEMO_EVENTS) == 2503
    assert SITE_DEMO_GROUPS == (1, 2, 9, 17, 25)
    assert SITE_DEMO_EVENTS[0] == SiteDemoEvent(
        0.0, 1, (9, 13, 17, 21, 25, 29, 33, 37))
    assert SITE_DEMO_EVENTS[-1].at_s == 59.98
    assert all(0 <= e.at_s < 60 and 1 <= e.group and
               all(1 <= channel <= 40 for channel in e.channels)
               for e in SITE_DEMO_EVENTS)
    assert all(a.at_s <= b.at_s for a, b in zip(SITE_DEMO_EVENTS, SITE_DEMO_EVENTS[1:]))

    canonical = "\n".join(
        f"{round(e.at_s * 1000)},{e.group},{reference.channels_to_mask(e.channels).hex()}"
        for e in SITE_DEMO_EVENTS)
    assert hashlib.sha256(canonical.encode("ascii")).hexdigest() == SITE_SEQUENCE_SHA256


def test_demo_replays_in_order_and_always_blacks_out():
    events = (
        SiteDemoEvent(0.0, 1, (9, 13)),
        SiteDemoEvent(0.01, 9, (10, 14)),
        SiteDemoEvent(0.02, 17, (9, 25)),
    )

    async def run():
        conn = FakeConnection()
        demo = ICANSiteDemo(events, duration_s=0.03, safety_permit=lambda: True)
        started = await demo.start(conn)
        assert started["running"] is True
        await asyncio.wait_for(demo._task, timeout=1)
        return conn, demo.status()

    conn, status = asyncio.run(run())
    assert [(g, c) for g, c, _ in conn.sent] == [
        (1, (9, 13)), (9, (10, 14)), (17, (9, 25))]
    assert all(call[2] == {"confirmed": True, "user": "site-demo"}
               for call in conn.sent)
    assert conn.blackouts == 1
    assert status["outcome"] == "completed"
    assert status["frames_sent"] == 3 and status["running"] is False


def test_stop_interrupts_the_backend_task_and_blacks_out_immediately():
    events = (
        SiteDemoEvent(0.0, 1, (9,)),
        SiteDemoEvent(5.0, 1, (13,)),
    )

    async def run():
        conn = FakeConnection()
        demo = ICANSiteDemo(events, duration_s=10, safety_permit=lambda: True)
        await demo.start(conn)
        await asyncio.sleep(0.02)
        status = await demo.stop("stopped")
        return conn, status

    conn, status = asyncio.run(run())
    assert [(g, c) for g, c, _ in conn.sent] == [(1, (9,))]
    assert conn.blackouts == 1
    assert status["outcome"] == "stopped" and status["running"] is False


def test_safety_permit_is_checked_during_playback_and_loss_forces_blackout():
    permit = {"value": True}
    events = (SiteDemoEvent(0.0, 1, (9,)), SiteDemoEvent(5.0, 9, (13,)))

    async def run():
        conn = FakeConnection()
        demo = ICANSiteDemo(events, duration_s=10,
                            safety_permit=lambda: permit["value"])
        await demo.start(conn)
        permit["value"] = False
        await asyncio.wait_for(demo._task, timeout=1)
        return conn, demo.status()

    conn, status = asyncio.run(run())
    assert len(conn.sent) == 1 and conn.blackouts == 1
    assert status["outcome"] == "safety_stopped"
    assert "withdrawn" in status["error"]


@pytest.mark.parametrize(
    "connection,permit,message",
    [
        (FakeConnection(connected=False), True, "connect"),
        (FakeConnection(armed=False), True, "arm I-CAN output"),
        (FakeConnection(), False, "safety system"),
    ],
)
def test_demo_refuses_to_start_until_all_operator_gates_are_open(connection, permit, message):
    async def run():
        demo = ICANSiteDemo((SiteDemoEvent(0.0, 1, (9,)),),
                            duration_s=0.01, safety_permit=lambda: permit)
        with pytest.raises(SiteDemoStartError, match=message):
            await demo.start(connection)

    asyncio.run(run())


def test_start_status_and_stop_routes_control_the_backend_runner(monkeypatch):
    from api.routes import ican_routes

    async def run():
        conn = FakeConnection()
        demo = ICANSiteDemo(
            (SiteDemoEvent(0.0, 1, (9,)), SiteDemoEvent(30.0, 9, (13,))),
            duration_s=60,
            safety_permit=lambda: True,
        )
        monkeypatch.setattr(ican_routes, "_conn", conn)
        monkeypatch.setattr(ican_routes, "_site_demo", demo)

        started = await ican_routes.start_site_demo()
        assert started["running"] is True and started["duration_s"] == 60
        assert ican_routes.site_demo_status is not None
        live = await ican_routes.site_demo_status()
        assert live["run_id"] == started["run_id"]

        stopped = await ican_routes.stop_site_demo()
        assert stopped["running"] is False and stopped["outcome"] == "stopped"
        # Runner cleanup plus the route's unconditional STOP cleanup.
        assert conn.blackouts == 2

    asyncio.run(run())
