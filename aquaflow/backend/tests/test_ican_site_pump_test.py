"""The site pump observation sequence uses recovered commands and excludes fire."""
from engine.ican_site_pump_test import (
    FIRE_PUMP_CHANNEL,
    FOAM_PUMP_CHANNEL,
    RUNNING_PUMP_CHANNEL,
    SITE_PUMP_TEST_DURATION_S,
    SITE_PUMP_TEST_EVENTS,
    SITE_PUMP_TEST_GROUPS,
    SITE_PUMP_TEST_SCHEDULE,
)


def _state_at(at_s: float) -> dict[int, tuple[int, ...]]:
    state = {group: () for group in SITE_PUMP_TEST_GROUPS}
    for event in SITE_PUMP_TEST_EVENTS:
        if event.at_s > at_s:
            break
        state[event.group] = event.channels
    return state


def test_pump_observation_test_has_four_minute_thirty_second_schedule():
    assert SITE_PUMP_TEST_DURATION_S == 240.0
    assert SITE_PUMP_TEST_GROUPS == (1, 2, 9, 17, 25)
    assert SITE_PUMP_TEST_SCHEDULE[0] == {
        "start_s": 0, "end_s": 60, "label": "Walk delay / all off"}
    assert all(item["start_s"] % 30 == 0 and item["end_s"] % 30 == 0
               for item in SITE_PUMP_TEST_SCHEDULE)
    assert SITE_PUMP_TEST_SCHEDULE[-1]["end_s"] == 240
    assert all(a.at_s <= b.at_s
               for a, b in zip(SITE_PUMP_TEST_EVENTS, SITE_PUMP_TEST_EVENTS[1:]))


def test_fire_outputs_are_absent_from_every_test_state():
    assert all(FIRE_PUMP_CHANNEL not in event.channels
               for event in SITE_PUMP_TEST_EVENTS if event.group == 17)
    assert all(not event.channels
               for event in SITE_PUMP_TEST_EVENTS if event.group == 25)


def test_recovered_water_functions_occupy_separate_observation_windows():
    assert all(not channels for channels in _state_at(30).values())

    running = _state_at(75)
    assert running[17] == (9, RUNNING_PUMP_CHANNEL)
    assert running[1] == tuple(range(9, 41))
    assert running[9] == tuple(range(9, 41))
    assert running[2] == ()

    assert all(not channels for channels in _state_at(105).values())

    foam = _state_at(125)
    assert foam[17] == (9, FOAM_PUMP_CHANNEL)
    assert foam[1] == foam[2] == foam[9] == foam[25] == ()
    assert all(not channels for channels in _state_at(140).values())

    peacock = _state_at(185)
    assert peacock[2]
    assert peacock[17] == (9,)
    assert peacock[1] == peacock[9] == peacock[25] == ()
    assert all(not channels for channels in _state_at(225).values())


def test_peacock_frequency_data_returns_to_zero_after_each_captured_pass():
    group2 = [event for event in SITE_PUMP_TEST_EVENTS if event.group == 2]
    assert any(event.channels for event in group2 if 180 <= event.at_s < 192.9)
    assert any(event.channels for event in group2 if 192.9 <= event.at_s < 205.8)
    assert _state_at(206)[2] == ()
