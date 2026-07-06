"""
AF-HUB-016 — Protocol bus singleton lockdown.

Two ProtocolBus instances = two independent output paths. The old get_protocol_bus()
escape hatch could lazily create a second one. Now there is exactly one PRIMARY runtime
bus: the accessor always returns it, and a second primary is refused. (Throwaway
non-primary instances for loopback verification / unit tests remain allowed.)
"""
import pytest

import app_state  # importing sets the primary ProtocolBus
from engine.protocol_bus import ProtocolBus, get_protocol_bus


def test_accessor_returns_the_one_app_singleton_twice():
    a = get_protocol_bus()
    b = get_protocol_bus()
    assert a is b
    assert a is app_state.protocol_bus  # THE runtime bus, not a fresh instance


def test_second_primary_bus_is_blocked():
    # app_state already created the primary at import → a second primary must be refused.
    with pytest.raises(RuntimeError):
        ProtocolBus(primary=True)


def test_throwaway_non_primary_instances_are_allowed():
    # Loopback verification and unit tests legitimately build non-primary buses.
    a = ProtocolBus()
    b = ProtocolBus()
    assert a is not b
    assert a is not app_state.protocol_bus
    assert a._is_primary is False


def test_primary_identity_is_the_app_bus():
    assert ProtocolBus._primary is app_state.protocol_bus
    assert app_state.protocol_bus._is_primary is True
