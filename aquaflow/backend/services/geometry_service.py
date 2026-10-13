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
from services.basin_model import basin_area, basin_for_point, migrate_project, normalize_basins

GEOMETRY_DIR = Path(__file__).parent.parent.parent / "geometry_projects"
GEOMETRY_DIR.mkdir(exist_ok=True)


class GeometryService:
    def save_project(self, project: dict) -> dict:
        # AF-NEXT-010: accept both the legacy single `geometry` and `basins[]`; store both.
        project = migrate_project(project)
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
        return migrate_project(json.loads(path.read_text()))

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
        basins = normalize_basins(project)
        if len(basins) > 1:
            # AF-NEXT-010: water surface of every basin (islands excluded).
            surface_area = sum(basin_area(b) for b in basins)
            volume = sum(basin_area(b) * (b.get("depth") or params.get("depth", 0.8)) for b in basins)
        elif pool_type == "circular":
            r = params.get("radius", 5)
            surface_area = math.pi * r ** 2
            volume = surface_area * params.get("depth", 0.8)
        else:
            surface_area = params.get("width", 10) * params.get("length", 10)
            volume = surface_area * params.get("depth", 0.8)
        volume_litres = volume * 1000.0

        # Real hydraulics: build a supply network from the designed nozzles and solve
        # it with the Hazen-Williams engine (services/hydraulic_solver.solve_network),
        # replacing the old linear turnover approximation.
        hydraulics = self._solve_pool_hydraulics(nozzles, params, volume_litres,
                                                 basins=basins if len(basins) > 1 else None)
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
            "basins": project.get("basins") or [],
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


    def _solve_pool_hydraulics(self, nozzles: list, params: dict, volume_litres: float,
                               basins: Optional[list] = None) -> dict:
        """
        Build a supply network from the designed nozzles and solve it with the real
        Hazen-Williams engine (services/hydraulic_solver.solve_network) — replacing the
        old linear ``turnover_rate_hint_hours`` approximation.

        A pump-discharge reservoir feeds a manifold, which branches to one demand node
        per nozzle (flow from the fixture's engineering spec, or a sensible default).
        Returns the real total design flow, the physically-correct pool turnover time,
        and the full solver solution (per-node pressure, per-pipe flow/head loss).

        AF-NEXT-010: with ``basins`` (two or more ``basin_model.normalize_basins``
        records) every nozzle is assigned to the basin that contains it (nearest
        outline, with a warning, when it lies outside every basin) and each basin gets
        its own main + manifold off the shared pump. ``basins`` / ``nozzle_basin`` in
        the result report flow, volume and turnover per basin. With one basin or none
        the network is exactly the historical single-manifold one.
        """
        default_flow_lps = 0.5      # L/s per nozzle when the fixture carries no spec
        design_head_m = float(params.get("design_head_m", 40.0))

        if not nozzles:
            return {"total_design_flow_m3s": 0.0, "total_design_flow_lpm": 0.0,
                    "turnover_time_hours": None, "hydraulic_solution": None,
                    "method": "hazen-williams", "note": "no nozzles in design"}

        multi = [b for b in (basins or []) if b.get("points")]
        multi = multi if len(multi) > 1 else []
        warnings: list = []
        assign: list = []                       # basin id per nozzle (None = single manifold)
        for n in nozzles:
            if not multi:
                assign.append(None)
                continue
            b, inside = basin_for_point(multi, float(n.get("x") or 0.0), float(n.get("y") or 0.0))
            assign.append(b["id"])
            if not inside:
                warnings.append(f"Nozzle {n.get('id')} is outside every basin; assigned to the nearest ({b['id']}).")

        def manifold_of(bid):
            return "MANIFOLD" if bid is None else f"MANIFOLD_{bid}"

        nodes = [{"id": "PUMP", "fixed_head": design_head_m, "elevation": 0.0}]
        pipes = []
        centres = {}
        for bid in dict.fromkeys(assign):
            idx = [i for i, a in enumerate(assign) if a == bid]
            xs = [float(nozzles[i].get("x") or 0.0) for i in idx]
            ys = [float(nozzles[i].get("y") or 0.0) for i in idx]
            centres[bid] = (sum(xs) / len(xs), sum(ys) / len(ys))
            nodes.append({"id": manifold_of(bid), "elevation": 0.0, "demand": 0.0})
            pipes.append({"id": "MAIN" if bid is None else f"MAIN_{bid}", "from": "PUMP", "to": manifold_of(bid),
                          "length": 10.0, "diameter": 0.15, "roughness": 130})
        total_flow = 0.0
        flow_by_basin: dict = {}
        for i, n in enumerate(nozzles):
            cx, cy = centres[assign[i]]
            eng = n.get("engineering") or {}
            flow_lps = float(eng.get("design_flow_lps", eng.get("flow_lps", default_flow_lps))
                             or default_flow_lps)
            demand = flow_lps / 1000.0
            total_flow += demand
            flow_by_basin[assign[i]] = flow_by_basin.get(assign[i], 0.0) + demand
            nx = float(n.get("x") or cx); ny = float(n.get("y") or cy)
            length = max(1.0, math.hypot(nx - cx, ny - cy))
            dia = float(eng.get("pipe_diameter_m", 0.05) or 0.05)

            # AQ-S2-002 Phase 2 — model the nozzle as a pressure-dependent EMITTER
            # rather than a fixed demand, so its flow (and therefore its jet height)
            # is solved from the head actually available at that point in the
            # network. The emitter coefficient is derived from the fixture's design
            # duty: k = Q_design / sqrt(p_design), i.e. the nozzle is calibrated to
            # pass its rated flow at its rated pressure and then behaves physically
            # away from that point. Falls back to a fixed demand when the fixture
            # carries no usable design pressure.
            design_head = float(eng.get("design_pressure_m", 0.0) or 0.0)
            elevation = float(eng.get("elevation_m", 0.0) or 0.0)
            node = {"id": f"NOZ{i}", "elevation": elevation}
            if demand > 0 and design_head > 0:
                node["emitter_k"] = demand / math.sqrt(design_head)
                node["discharge_coeff"] = float(eng.get("discharge_coeff", 0.97) or 0.97)
            else:
                node["demand"] = demand
            nodes.append(node)
            pipes.append({"id": f"P{i}", "from": manifold_of(assign[i]), "to": f"NOZ{i}",
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
        if multi:
            per = []
            for b in multi:
                q = flow_by_basin.get(b["id"], 0.0)
                vol_l = basin_area(b) * (b.get("depth") or float(params.get("depth", 0.8) or 0.8)) * 1000.0
                lph = q * 1000.0 * 3600.0
                per.append({"id": b["id"], "name": b.get("name"), "manifold": manifold_of(b["id"]),
                            "nozzle_ids": [str(nozzles[i].get("id") or f"NOZ{i}") for i, a in enumerate(assign) if a == b["id"]],
                            "total_design_flow_lpm": round(q * 60000.0, 2),
                            "surface_area_m2": round(basin_area(b), 2), "volume_litres": round(vol_l, 0),
                            "turnover_time_hours": round(vol_l / lph, 2) if lph > 0 else None})
            for rec in per:
                rec["nozzle_count"] = len(rec["nozzle_ids"])
            base["basins"] = per
            base["nozzle_basin"] = {str(n.get("id") or f"NOZ{i}"): assign[i] for i, n in enumerate(nozzles)}
            base["warnings"] = warnings
        try:
            solution = solve_network(network)
        except Exception as exc:                     # solver stays non-fatal for export
            return {**base, "hydraulic_solution": None, "note": f"solver error: {exc}"}

        # AQ-S2-002 Phase 2 — per-nozzle physics for the 3D preview, keyed by the
        # DESIGN nozzle id so the renderer can look each one up directly. Present
        # only for nozzles solved as emitters (pressure-dependent); demand-only
        # nozzles are omitted rather than given a fabricated velocity.
        node_by_id = {n.get("id"): n for n in solution.get("nodes", [])}
        nozzle_physics: dict = {}
        for i, n in enumerate(nozzles):
            node = node_by_id.get(f"NOZ{i}")
            if not node or not node.get("is_nozzle"):
                continue
            design_id = n.get("id") or f"NOZ{i}"
            nozzle_physics[str(design_id)] = {
                "exitVelocityMs": node.get("exit_velocity_ms"),
                "jetHeightM": node.get("jet_height_m"),
                "flowLpm": node.get("nozzle_flow_lpm"),
                "basis": node.get("jet_height_basis", "ESTIMATED"),
            }

        return {**base,
                "converged": solution.get("converged"),
                "hydraulic_solution": solution,
                "nozzle_physics": nozzle_physics,
                "validation": solution.get("validation", [])}


_service: Optional[GeometryService] = None

def get_geometry_service() -> GeometryService:
    global _service
    if _service is None:
        _service = GeometryService()
    return _service
