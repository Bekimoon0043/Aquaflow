import asyncio

from api.routes.hydraulics_routes import special_air_shooter, special_digital_curtain


def test_air_shooter_route_runs_real_state_machine():
    result = asyncio.run(special_air_shooter({
        "config": {"tank_volume_m3": 0.1, "max_pressure_pa": 500000, "min_fire_pressure_pa": 200000,
                   "shot_pressure_drop_pa": 100000, "recharge_rate_pa_s": 50000,
                   "valve_open_duration_s": 0.1, "max_shots_per_burst": 2},
        "fire_times_s": [0], "duration_s": 0.2, "dt_s": 0.1,
    }))
    assert result["kind"] == "compressed_air_shooter"
    assert result["stats"]["accepted_shots"] == 1
    assert result["records"][0]["valve_open"] is True


def test_digital_curtain_route_holds_packet_between_edges():
    result = asyncio.run(special_digital_curtain({
        "outlets": [{"id": "a", "open_delay_s": 0.1, "close_delay_s": 0.1}],
        "packets": [{"start_s": 0, "end_s": 0.3, "pattern": "1"}],
        "duration_s": 0.4, "dt_s": 0.1,
    }))
    assert result["kind"] == "digital_water_curtain"
    assert result["frames"][1]["output_bits"] == [1]
    assert result["frames"][2]["command_bits"] == [1]
    assert result["frames"][4]["output_bits"] == [0]
