"""Four-minute observation test for the recovered 4KILO water functions.

The old controller configuration and the hardware capture agree on these outputs:

* device 327, ``Running Fountain pump`` -> group 17 channel 29
* device 333, ``Foam pump``             -> group 17 channel 30
* device 330, ``Peacock pump``          -> group 2 frequency data
* device 335, ``Fire pump``             -> group 17 channel 31

The fire output is deliberately absent.  The Peacock section replays only a frequency
waveform already sent by the original controller; it does not invent or stretch a VFD
value.  The four middle motors share the one Running Fountain command in the recovered
configuration, so this test identifies control functions rather than individual motor
contactors.
"""
from __future__ import annotations

from engine.ican_site_demo_sequence import SITE_DEMO_EVENTS, SiteDemoEvent


SITE_PUMP_TEST_DURATION_S = 240.0
SITE_PUMP_TEST_GROUPS = (1, 2, 9, 17, 25)

RUNNING_PUMP_CHANNEL = 29
FOAM_PUMP_CHANNEL = 30
FIRE_PUMP_CHANNEL = 31

# The first captured Peacock/VFD passage.  It starts and ends at zero and ran on the
# real fountain as part of the proven one-minute replay.
_PEACOCK_SOURCE_START_S = 17.56
_PEACOCK_SOURCE_END_S = 30.46
_PEACOCK_SPAN_S = _PEACOCK_SOURCE_END_S - _PEACOCK_SOURCE_START_S
_PEACOCK_EVENTS = tuple(
    event for event in SITE_DEMO_EVENTS
    if event.group == 2
    and _PEACOCK_SOURCE_START_S <= event.at_s <= _PEACOCK_SOURCE_END_S
)


def _event(at_s: float, group: int, channels=()) -> SiteDemoEvent:
    return SiteDemoEvent(float(at_s), int(group), tuple(int(c) for c in channels))


def _build_events() -> tuple[SiteDemoEvent, ...]:
    events: list[SiteDemoEvent] = []

    # 0:00-1:00 — walk/observation delay.  Establish every captured group OFF.
    events.extend(_event(0, group) for group in SITE_PUMP_TEST_GROUPS)

    # 1:00-1:30 — Running Fountain function.  The first 64 valve outputs are opened
    # one second before the recovered pump command and remain open one second after it
    # stops.  This avoids starting the pump against a closed commanded valve surface.
    all_32 = tuple(range(9, 41))
    events.extend((_event(59, 1, all_32), _event(59, 9, all_32)))
    events.append(_event(60, 17, (9, RUNNING_PUMP_CHANNEL)))
    events.append(_event(89, 17, (9,)))
    events.extend((_event(90, 1), _event(90, 9), _event(90, 17)))

    # 1:30-2:00 — all off.

    # 2:00-2:30 — Foam function.  Its recovered output was continuously active for
    # 12.70 seconds in the proven capture, so retain that proven maximum and leave the
    # rest of the 30-second observation window off.
    events.append(_event(120, 17, (9, FOAM_PUMP_CHANNEL)))
    events.append(_event(132.7, 17))

    # 2:30-3:00 — all off.

    # 3:00-3:30 — Peacock/VFD function.  Replay the proven 12.90-second waveform twice
    # inside the slot.  Group 17 channel 31 and group 25 stay off, so the fire function
    # cannot be triggered by this test.
    events.append(_event(180, 17, (9,)))
    for repetition in range(2):
        offset = 180.0 + repetition * _PEACOCK_SPAN_S
        for source in _PEACOCK_EVENTS:
            events.append(_event(
                offset + source.at_s - _PEACOCK_SOURCE_START_S,
                2,
                source.channels,
            ))
    events.extend((_event(206, 2), _event(210, 17)))

    # 3:30-4:00 — all off. ICANSiteDemo also blackouts every group on completion,
    # manual stop, safety loss, disconnect, or exception.
    return tuple(sorted(events, key=lambda item: item.at_s))


SITE_PUMP_TEST_EVENTS = _build_events()


SITE_PUMP_TEST_SCHEDULE = (
    {"start_s": 0, "end_s": 60, "label": "Walk delay / all off"},
    {"start_s": 60, "end_s": 90, "label": "Running Fountain (four middle motors share this command)"},
    {"start_s": 90, "end_s": 120, "label": "All off / observe stop"},
    {"start_s": 120, "end_s": 150, "label": "Foam / front function (12.7 s active, then off)"},
    {"start_s": 150, "end_s": 180, "label": "All off / observe stop"},
    {"start_s": 180, "end_s": 210, "label": "Peacock / rear function (captured VFD waveform)"},
    {"start_s": 210, "end_s": 240, "label": "Final all off"},
)
