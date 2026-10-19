"""A placed pump's flow, head, power and efficiency drive the 3D preview's jet heights."""
import asyncio

import pytest

from api.routes import hydraulics_routes
from services.pump_duty import efficiency_fraction, pump_rating

BAR_TO_M = 10.19716213


def nozzles(n=6, flow_lpm=60.0, bar=0.4):
    return [{"id": f"n{i}", "x": float(i), "y": 0.0,
             "engineering": {"design_flow_lps": flow_lpm / 60.0, "design_pressure_m": bar * BAR_TO_M,
                             "pipe_diameter_m": 0.04}} for i in range(n)]


def pump(**eng):
    base = {"flowM3Hr": 22, "headM": 12, "flowLpm": 366.67, "powerKw": 1.5}
    return {"id": "p1", "type": "pump_submersible_1_5kw", "x": 0, "y": 0, "engineering": {**base, **eng}}


def solve(pumps=None, params=None):
    body = {"nozzles": nozzles(), "params": params or {"design_head_m": 40}, "volume_litres": 50000}
    if pumps:
        body["pumps"] = pumps
    return asyncio.run(hydraulics_routes.preview_physics(body))


def heights(res):
    return [res["nozzle_physics"][f"n{i}"]["jetHeightM"] for i in range(6)]


def test_efficiency_is_read_as_percent_or_fraction():
    assert efficiency_fraction(70) == pytest.approx(0.7)
    assert efficiency_fraction(0.7) == pytest.approx(0.7)
    assert efficiency_fraction(0) is None and efficiency_fraction(None) is None


def test_power_limited_pump_runs_slower_by_the_affinity_laws():
    # 22 m3/h @ 12 m needs 0.72 kW of water power; 1.5 kW at 30 % gives only 0.45 kW.
    r = pump_rating({"flowM3Hr": 22, "headM": 12, "powerKw": 1.5, "efficiency": 30})
    assert r["power_limited"]
    water = 1000 * 9.81 * 22 / 3600 * 12
    assert r["speed_ratio"] == pytest.approx((0.3 * 1500 / water) ** (1 / 3))
    assert not pump_rating({"flowM3Hr": 22, "headM": 12, "powerKw": 1.5, "efficiency": 70})["power_limited"]


def test_the_designers_flow_m3h_wins_over_the_library_flow_lpm():
    assert pump_rating({"flowM3Hr": 40, "flowLpm": 366.67, "headM": 12})["flow_m3s"] == pytest.approx(40 / 3600)


def test_without_pumps_the_fixed_design_head_is_unchanged():
    res = solve()
    assert "pump_operating_point" not in res
    assert all(h > 3 for h in heights(res))


def test_the_placed_pump_sets_the_supply_head():
    res = solve([pump(efficiency=70)])
    op = res["pump_operating_point"]
    assert 0 < op["head_m"] < 1.25 * 12           # on the pump curve, never above shutoff
    assert op["pumps"][0]["id"] == "p1" and not op["pumps"][0]["power_limited"]
    assert max(heights(res)) < max(heights(solve()))   # weaker than the old 40 m fixed head


def test_lowering_efficiency_lowers_every_jet():
    good, poor = solve([pump(efficiency=70)]), solve([pump(efficiency=25)])
    assert poor["pump_operating_point"]["head_m"] < good["pump_operating_point"]["head_m"]
    for hg, hp in zip(heights(good), heights(poor)):
        assert hp < hg
    assert any(v.get("code") == "PUMP_POWER_LIMITED" for v in poor["validation"])


def test_raising_head_or_flow_raises_the_jets():
    base = solve([pump(efficiency=70)])
    stronger = solve([pump(efficiency=70, headM=18, powerKw=3)])
    assert min(heights(stronger)) > max(heights(base)) * 0.99
    assert stronger["pump_operating_point"]["head_m"] > base["pump_operating_point"]["head_m"]


def test_two_pumps_in_parallel_deliver_more_than_one():
    one = solve([pump(efficiency=70)])
    two = solve([pump(efficiency=70), {**pump(efficiency=70), "id": "p2"}])
    assert two["pump_operating_point"]["head_m"] > one["pump_operating_point"]["head_m"]
    assert len(two["pump_operating_point"]["pumps"]) == 2
