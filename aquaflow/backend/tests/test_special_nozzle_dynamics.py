"""Deterministic special-nozzle dynamics (services/special_nozzle_dynamics.py)."""
import pytest

from services.special_nozzle_dynamics import (CompressedAirShooter, DigitalWaterCurtain,
                                               simulate_compressed_air_shooter,
                                               simulate_digital_water_curtain)

MEASURED = {"source": "user_measured", "model": "Test special nozzle", "date": "2026-10-01",
            "confidence": "medium"}


def shooter_config(**overrides):
    config = {
        "tank_volume_m3": 0.1,
        "ambient_pressure_pa": 100000.0,
        "max_pressure_pa": 500000.0,
        "min_fire_pressure_pa": 200000.0,
        "shot_pressure_drop_pa": 100000.0,
        "recharge_rate_pa_s": 50000.0,
        "valve_open_duration_s": 0.25,
        "max_shots_per_burst": 3,
    }
    config.update(overrides)
    return config


def at(records, time_s, dt_s=0.1):
    return records[int(round(time_s / dt_s))]


def test_shooter_pressure_valve_duration_and_closed_fraction_recharge():
    result = simulate_compressed_air_shooter(shooter_config(), [0.0, 0.1, 0.3],
                                              duration_s=0.4, dt_s=0.1, provenance=MEASURED)
    records = result["records"]
    assert at(records, 0.0)["fire_accepted"] is True
    assert at(records, 0.0)["tank_pressure_pa"] == pytest.approx(400000.0)
    assert at(records, 0.0)["valve_open"] is True
    assert at(records, 0.1)["blocked_reason"] == "valve_open"
    assert at(records, 0.2)["valve_open"] is True
    assert at(records, 0.2)["valve_remaining_s"] == pytest.approx(0.05)
    # The valve closes halfway through [0.2, 0.3): 0.05 s × 50 kPa/s.
    assert at(records, 0.3)["fire_accepted"] is True
    assert at(records, 0.3)["tank_pressure_pa"] == pytest.approx(302500.0)
    assert at(records, 0.3)["shots_in_burst"] == 2
    assert result["stats"] == {"accepted_shots": 2, "blocked_requests": 1}
    assert result["units"]["pressure"] == "Pa (absolute)"
    assert result["equipment"]["data_source"] == "user_measured"
    assert result["data_provenance"]["all_verified"] is True
    assert any(row["key"] == "shooter_pressure_model" and row["source"] == "ASSUMED"
               for row in result["assumptions"])


def test_shooter_burst_locks_then_recharges_and_resets():
    config = shooter_config(max_pressure_pa=600000.0, shot_pressure_drop_pa=None,
                            shot_air_volume_m3=0.05, reset_pressure_pa=550000.0,
                            recharge_rate_pa_s=100000.0, valve_open_duration_s=0.1,
                            max_shots_per_burst=2)
    # 100 kPa × 0.05 m³ / 0.1 m³ = 50 kPa per shot.
    result = simulate_compressed_air_shooter(config, [0.0, 0.1, 0.2], 1.2, dt_s=0.1)
    records = result["records"]
    assert result["config"]["shot_pressure_drop_pa"] == pytest.approx(50000.0)
    assert at(records, 0.1)["fire_accepted"] is True
    assert at(records, 0.1)["tank_pressure_pa"] == pytest.approx(500000.0)
    assert at(records, 0.2)["state"] == "exhausted"
    assert at(records, 0.2)["blocked_reason"] == "burst_exhausted"
    assert at(records, 0.2)["ready"] is False
    assert at(records, 0.7)["state"] == "ready"
    assert at(records, 0.7)["tank_pressure_pa"] == pytest.approx(550000.0)
    assert at(records, 0.7)["shots_in_burst"] == 0
    assert at(records, 1.2)["tank_pressure_pa"] == pytest.approx(600000.0)


def test_shooter_blocks_on_low_pressure_until_recharged_and_is_repeatable():
    config = shooter_config(max_pressure_pa=600000.0, min_fire_pressure_pa=250000.0,
                            shot_pressure_drop_pa=300000.0, recharge_rate_pa_s=200000.0,
                            valve_open_duration_s=0.1, max_shots_per_burst=5)
    args = (config, [0.0, 0.1, 0.2], 1.0)
    first = simulate_compressed_air_shooter(*args, dt_s=0.1)
    second = simulate_compressed_air_shooter(*args, dt_s=0.1)
    assert first == second
    assert at(first["records"], 0.1)["tank_pressure_pa"] == pytest.approx(100000.0)
    assert at(first["records"], 0.2)["state"] == "recharging"
    assert at(first["records"], 0.2)["blocked_reason"] == "tank_pressure"
    assert at(first["records"], 1.0)["state"] == "ready"
    assert at(first["records"], 1.0)["tank_pressure_pa"] == pytest.approx(260000.0)


def test_shooter_rejects_ambiguous_air_consumption_and_non_grid_duration():
    config = shooter_config(shot_air_volume_m3=0.02)
    with pytest.raises(ValueError, match="exactly one"):
        CompressedAirShooter(config, 0.01)
    with pytest.raises(ValueError, match="integer multiple"):
        simulate_compressed_air_shooter(shooter_config(), [], 0.15, dt_s=0.1)


def test_curtain_packet_edges_have_independent_open_and_close_delays():
    outlets = [{"id": "A", "open_delay_s": 0.2, "close_delay_s": 0.1},
               {"id": "B", "open_delay_s": 0.1, "close_delay_s": 0.2}]
    result = simulate_digital_water_curtain(outlets,
                                             [{"id": "p", "start_s": 0.0, "end_s": 0.5,
                                               "pattern": "11"}],
                                             duration_s=0.8, dt_s=0.1, provenance=MEASURED)
    frames = result["frames"]
    assert at(frames, 0.0)["output_bits"] == [0, 0]
    assert at(frames, 0.1)["output_bits"] == [0, 1]
    assert at(frames, 0.2)["output_bits"] == [1, 1]
    assert at(frames, 0.5)["command_bits"] == [0, 0]
    assert at(frames, 0.5)["output_bits"] == [1, 1]
    assert at(frames, 0.6)["output_bits"] == [0, 1]
    assert at(frames, 0.7)["output_bits"] == [0, 0]
    assert at(frames, 0.5)["active_packets"] == []       # start inclusive, end exclusive
    assert result["outlets"]["A"]["equipment"]["data_source"] == "user_measured"
    assert result["outlets"]["A"]["open_delay_steps"] == 2
    assert result["outlets"]["B"]["close_delay_steps"] == 2
    assert all(row["equipment"] for row in result["outlets"].values())


def test_curtain_arbitrary_timed_pattern_and_back_to_back_packets():
    outlets = [{"id": "A"}, {"id": "B"}]
    result = simulate_digital_water_curtain(outlets, [
        {"id": "sequence", "start_s": 0.0, "end_s": 0.4,
         "pattern": [[1, 0], [0, 1], [1, 1]], "frame_period_s": 0.1},
        {"id": "next", "start_s": 0.4, "end_s": 0.5, "pattern": "01"},
    ], duration_s=0.6, dt_s=0.1)
    frames = result["frames"]
    assert [at(frames, t)["output_bits"] for t in (0.0, 0.1, 0.2, 0.3)] == [
        [1, 0], [0, 1], [1, 1], [1, 1]]
    # The old packet's end is applied before the new packet's start at 0.4 s.
    assert at(frames, 0.4)["output_bits"] == [0, 1]
    assert at(frames, 0.4)["active_packets"] == ["next"]
    assert at(frames, 0.5)["output_bits"] == [0, 0]
    assert result["packets"][0]["frames"][2]["bits"] == [1, 1]


def test_curtain_reversal_cancels_pending_transition_and_times_round_up():
    curtain = DigitalWaterCurtain([{"id": "slow", "open_delay_s": 0.25}], 0.1)
    assert curtain.step("1")["state"]["slow"] == "opening"
    assert curtain.step("0")["state"]["slow"] == "closed"
    assert curtain.step("0")["open"]["slow"] is False
    assert curtain.step("0")["open"]["slow"] is False   # no stale opening at the old due step

    result = simulate_digital_water_curtain(
        [{"id": "slow", "open_delay_s": 0.15}],
        [{"start_s": 0.051, "end_s": 0.65, "pattern": [1]}], 0.8, dt_s=0.1)
    assert result["packets"][0]["scheduled_start_s"] == pytest.approx(0.1)
    assert result["packets"][0]["scheduled_end_s"] == pytest.approx(0.7)
    assert at(result["frames"], 0.2)["output_bits"] == [0]
    assert at(result["frames"], 0.3)["output_bits"] == [1]
    assert at(result["frames"], 0.7)["output_bits"] == [0]


def test_curtain_validates_pattern_width_and_default_provenance():
    with pytest.raises(ValueError, match="expected 2"):
        simulate_digital_water_curtain([{"id": "A"}, {"id": "B"}],
                                        [{"start_s": 0.0, "end_s": 0.2, "pattern": "1"}],
                                        0.3, dt_s=0.1)
    result = simulate_digital_water_curtain([{"id": "A"}], [], 0.2, dt_s=0.1)
    assert result["equipment"][0]["data_source"] == "generic_estimate"
    assert result["data_provenance"]["generic_items"] == 1
    assert any(row["key"] == "A.open_delay_s" and row["source"] == "DEFAULT"
               for row in result["assumptions"])
