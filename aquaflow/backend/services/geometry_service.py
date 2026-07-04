"""
geometry_service.py — AquaFlow Phase 9
Pool geometry persistence and export service.
Stores pool geometry projects and exports them for the hydraulic solver.
"""
import json
import hashlib
import math
import time
from pathlib import Path
from typing import Optional

from services.hydraulic_solver import solve_network

GEOMETRY_DIR = Path(__file__).parent.parent.parent / "geometry_projects"
GEOMETRY_DIR.mkdir(exist_ok=True)


class GeometryService:
    def save_project(self, project: dict) -> dict:
        pid = f"pool-{hashlib.md5(project.get('name','').encode()).hexdigest()[:8]}-{int(time.time())}"
        project["id"] = pid
        project["saved_at"] = time.time()
        path = GEOMETRY_DIR / f"{pid}.json"
        path.write_text(json.dumps(project, indent=2, ensure_ascii=False))
        return {"ok": True, "id": pid, "path": str(path)}

    def list_projects(self) -> list:
        projects = []
        for f in sorted(GEOMETRY_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
            try:
                data = json.loads(f.read_text())
                projects.append({
                    "id": data.get("id", f.stem),
                    "name": data.get("name", "Unnamed"),
                    "pool_type": data.get("pool_type", "unknown"),
                    "fixture_count": len(data.get("fixtures", [])),
                    "saved_at": data.get("saved_at"),
                })
            except Exception:
                pass
        return projects

    def load_project(self, project_id: str) -> Optional[dict]:
        path = GEOMETRY_DIR / f"{project_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text())

    def delete_project(self, project_id: str) -> bool:
        path = GEOMETRY_DIR / f"{project_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def export_for_hydraulics(self, project_id: str) -> Optional[dict]:
        project = self.load_project(project_id)
        if not project:
            return None
        geom = project.get("geometry", {})
        params = project.get("params", {})
        fixtures = project.get("fixtures", [])
        nozzle_keywords = (
            "nozzle",
            "jet",
            "laminar",
            "cannon",
            "geyser",
            "cascade",
            "waterfall",
            "foam",
            "mist",
            "fan",
            "aerator",
            "pirouette",
            "rotating",
            "motion",
            "jumping",
            "water_screen",
        )

        light_keywords = (
            "light",
            "rgb",
            "rgbw",
            "led",
            "moving_head",
            "spot",
            "spotlight",
            "underwater",
        )

        equipment_keywords = (
            "pump",
            "valve",
            "filter",
            "sensor",
            "control",
            "controller",
            "panel",
            "plc",
            "vfd",
            "manifold",
            "air_compressor",
            "compressor",
            "air_tank",
            "tank",
            "chemical",
            "dosing",
            "uv",
            "junction",
            "power",
            "cable",
            "pipe",
            "return",
            "drain",
            "supply",
        )

        effect_keywords = (
            "flame",
            "fire",
            "fog",
            "smoke",
            "haze",
            "laser",		
            "co2",
            "spark",
            "special_fx",
        )

        nozzle_types = []
        light_types = []
        equipment_types = []
        effect_types = []
        unknown_types = []

        for f in fixtures:
            ftype = str(f.get("type", "")).lower()

            if any(k in ftype for k in nozzle_keywords):
                nozzle_types.append(f)

            elif any(k in ftype for k in light_keywords):
                light_types.append(f)

            elif any(k in ftype for k in equipment_keywords):
                equipment_types.append(f)

            elif any(k in ftype for k in effect_keywords):
                effect_types.append(f)

            else:
                unknown_types.append(f)

        nozzles = nozzle_types
        lights = light_types
        equipment = equipment_types
        effects = effect_types
        unknown = unknown_types
        pool_type = project.get("pool_type", "rectangular")
        if pool_type == "circular":
            r = params.get("radius", 5)
            surface_area = math.pi * r ** 2
        else:
            surface_area = params.get("width", 10) * params.get("length", 10)
        volume = surface_area * params.get("depth", 0.8)
        volume_litres = volume * 1000.0

        # Real hydraulics: build a supply network from the designed nozzles and solve
        # it with the Hazen-Williams engine (services/hydraulic_solver.solve_network),
        # replacing the old linear turnover approximation.
        hydraulics = self._solve_pool_hydraulics(nozzles, params, volume_litres)
        hydraulics.update({
            "surface_area_m2": round(surface_area, 2),
            "volume_m3": round(volume, 2),
            "volume_litres": round(volume_litres, 0),
            "design_depth_m": params.get("depth", 0.8),
        })
        return {
            "project_id": project_id,
            "project_name": project.get("name"),
            "pool_type": pool_type,
            "geometry": geom,
            "dimensions": params,
            "hydraulics": hydraulics,
            "nozzle_positions": [
                {
                    "id": n.get("id"),
                    "x": n.get("x"),
                    "y": n.get("y"),
                    "type": n.get("type"),
                    "zone": n.get("zone"),
                    "groupId": n.get("groupId"),
                    "engineering": n.get("engineering", {}),
                }
                for n in nozzles
            ],
            "light_positions": [
                {
                    "id": l.get("id"),
                    "x": l.get("x"),
                    "y": l.get("y"),
                    "type": l.get("type"),
                    "zone": l.get("zone"),
                    "groupId": l.get("groupId"),
                    "color": l.get("color"),
                    "engineering": l.get("engineering", {}),
                }
                for l in lights
            ],
            "fixture_count": len(fixtures),
            "nozzle_count": len(nozzles),
            "light_count": len(lights),
            "equipment_count": len(equipment),
            "effect_count": len(effects),
            "unknown_count": len(unknown),

            "equipment_positions": [
                {
                    "id": e.get("id"),
                    "x": e.get("x"),
                    "y": e.get("y"),
                    "type": e.get("type"),
                    "zone": e.get("zone"),
                    "engineering": e.get("engineering", {}),
                }
                for e in equipment
            ],

            "effects": [
                {
                    "id": e.get("id"),
                    "type": e.get("type"),
                    "x": e.get("x"),
                    "y": e.get("y"),
                    "zone": e.get("zone"),
                    "groupId": e.get("groupId"),
                    "color": e.get("color"),
                    "engineering": e.get("engineering", {}),
                }
                for e in effects
            ],

            "unknown_fixtures": [
                {
                    "id": e.get("id"),
                    "type": e.get("type"),
                    "x": e.get("x"),
                    "y": e.get("y"),
                }
                for e in unknown
            ],
        }


    def _solve_pool_hydraulics(self, nozzles: list, params: dict, volume_litres: float) -> dict:
        """
        Build a supply network from the designed nozzles and solve it with the real
        Hazen-Williams engine (services/hydraulic_solver.solve_network) — replacing the
        old linear ``turnover_rate_hint_hours`` approximation.

        A pump-discharge reservoir feeds a manifold, which branches to one demand node
        per nozzle (flow from the fixture's engineering spec, or a sensible default).
        Returns the real total design flow, the physically-correct pool turnover time,
        and the full solver solution (per-node pressure, per-pipe flow/head loss).
        """
        default_flow_lps = 0.5      # L/s per nozzle when the fixture carries no spec
        design_head_m = float(params.get("design_head_m", 40.0))

        if not nozzles:
            return {"total_design_flow_m3s": 0.0, "total_design_flow_lpm": 0.0,
                    "turnover_time_hours": None, "hydraulic_solution": None,
                    "method": "hazen-williams", "note": "no nozzles in design"}

        xs = [float(n.get("x") or 0.0) for n in nozzles]
        ys = [float(n.get("y") or 0.0) for n in nozzles]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)

        nodes = [{"id": "PUMP", "fixed_head": design_head_m, "elevation": 0.0},
                 {"id": "MANIFOLD", "elevation": 0.0, "demand": 0.0}]
        pipes = [{"id": "MAIN", "from": "PUMP", "to": "MANIFOLD",
                  "length": 10.0, "diameter": 0.15, "roughness": 130}]
        total_flow = 0.0
        for i, n in enumerate(nozzles):
            eng = n.get("engineering") or {}
            flow_lps = float(eng.get("design_flow_lps", eng.get("flow_lps", default_flow_lps))
                             or default_flow_lps)
            demand = flow_lps / 1000.0
            total_flow += demand
            nx = float(n.get("x") or cx); ny = float(n.get("y") or cy)
            length = max(1.0, math.hypot(nx - cx, ny - cy))
            dia = float(eng.get("pipe_diameter_m", 0.05) or 0.05)
            nodes.append({"id": f"NOZ{i}", "elevation": 0.0, "demand": demand})
            pipes.append({"id": f"P{i}", "from": "MANIFOLD", "to": f"NOZ{i}",
                          "length": length, "diameter": dia, "roughness": 130})

        network = {"method": "hazen-williams", "nodes": nodes, "pipes": pipes}
        flow_l_per_h = total_flow * 1000.0 * 3600.0
        turnover = round(volume_litres / flow_l_per_h, 2) if flow_l_per_h > 0 else None
        base = {
            "total_design_flow_m3s": round(total_flow, 6),
            "total_design_flow_lpm": round(total_flow * 60000.0, 2),
            "turnover_time_hours": turnover,
            "method": "hazen-williams",
        }
        try:
            solution = solve_network(network)
        except Exception as exc:                     # solver stays non-fatal for export
            return {**base, "hydraulic_solution": None, "note": f"solver error: {exc}"}
        return {**base, "converged": solution.get("converged"), "hydraulic_solution": solution}


_service: Optional[GeometryService] = None

def get_geometry_service() -> GeometryService:
    global _service
    if _service is None:
        _service = GeometryService()
    return _service
