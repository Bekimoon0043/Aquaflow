import asyncio

from api.routes import hydraulics_routes


def test_preview_route_surfaces_solver_method_and_solution(monkeypatch):
    solved = {
        "converged": True,
        "method": "hazen-williams",
        "nozzle_physics": {"n1": {"jetHeightM": 2.4}},
        "validation": [],
        "total_design_flow_lpm": 120.0,
        "turnover_time_hours": 8.0,
        "hydraulic_solution": {"nodes": [{"id": "PUMP"}], "pipes": []},
    }

    class Service:
        def _solve_pool_hydraulics(self, nozzles, params, volume):
            assert nozzles[0]["engineering"]["design_flow_lps"] == 2
            assert volume == 57600
            return solved

    monkeypatch.setattr(hydraulics_routes, "get_geometry_service", lambda: Service())
    result = asyncio.run(hydraulics_routes.preview_physics({
        "nozzles": [{"id": "n1", "engineering": {"design_flow_lps": 2}}],
        "params": {"design_head_m": 40},
        "volume_litres": 57600,
    }))

    assert result["converged"] is True
    assert result["method"] == "hazen-williams"
    assert result["hydraulic_solution"] == solved["hydraulic_solution"]
    assert result["nozzle_physics"]["n1"]["jetHeightM"] == 2.4
