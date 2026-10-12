import asyncio

from api.routes.ai_engine import OptimizeRequest, optimize_energy


def test_energy_optimization_accepts_frontend_request_shape():
    result = asyncio.run(optimize_energy(OptimizeRequest(
        bpm=120,
        tracks=[{
            "type": "pump", "label": "Pump 1",
            "clips": [{"intensity": 20}, {"intensity": 80}],
        }],
    )))
    assert result["estimated_savings"] == "5%"
    assert result["optimizations"][0]["track"] == "Pump 1"
