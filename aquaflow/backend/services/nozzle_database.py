"""
nozzle_database.py — AquaFlow Stage 2, Priority 5 (AQ-S2-005)

Nozzle performance database for fountain hydraulic design.

A fountain nozzle's hydraulics follow the orifice discharge law

        Q = K * sqrt(P)

where Q is flow, P is the pressure (head) across the nozzle, and K is the
nozzle's discharge coefficient ("K factor"). Real manufacturer catalogs also
publish discrete pressure→flow (and pressure→jet-height) tables that do not
perfectly track a single K, so the database also supports interpolation across
tabulated catalog points.

Responsibilities:
  * store nozzle models and their K factors,
  * answer pressure↔flow queries by K factor and/or by interpolation of a
    manufacturer's tabulated pressure-flow curve,
  * organise nozzles into named manufacturer catalogs that can be loaded from
    JSON.

Units (consistent set): pressure in bar, flow in L/min, so K is in
L/min/sqrt(bar); jet height in metres. Callers may work in any consistent set —
the math is unit-agnostic.
"""
from __future__ import annotations

import json
import math
from bisect import bisect_left
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from services.equipment_provenance import cite, normalize_provenance, is_verified

DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_CATALOG_FILE = DATA_DIR / "nozzle_catalogs.json"


@dataclass
class NozzleModel:
    id: str
    manufacturer: str
    model: str
    k_factor: Optional[float] = None            # L/min/sqrt(bar)
    orifice_mm: Optional[float] = None
    nozzle_type: str = "jet"                    # jet | foam | fan | ring | cascade | mist
    # Tabulated catalog curve, list of {"pressure","flow","jet_height"?} points.
    pressure_flow_points: list[dict] = field(default_factory=list)
    notes: str = ""
    # AF-NEXT-012 — where these numbers come from (equipment_provenance schema).
    # Defaults to a generic estimate: data is never trusted unless it says why.
    provenance: dict = field(default_factory=dict)

    def __post_init__(self):
        self.provenance = normalize_provenance(self.provenance, kind="nozzle",
                                               model=self.model, manufacturer=self.manufacturer)

    def citation(self) -> dict:
        return cite(self.provenance, equipment_model=f"{self.id} ({self.model})".strip(),
                    kind="nozzle")

    # ── Derived K factor ──────────────────────────────────────────────────────
    def effective_k(self) -> Optional[float]:
        """K factor to use: the stored one, else least-squares-fit from the curve."""
        if self.k_factor is not None:
            return float(self.k_factor)
        pts = self._sorted_points()
        if not pts:
            return None
        # Q = K sqrt(P)  →  least squares K = Σ(Q·sqrt(P)) / Σ(P).
        num = sum(q * math.sqrt(p) for p, q, _ in pts)
        den = sum(p for p, _, _ in pts)
        return num / den if den > 0 else None

    # ── Pressure → flow ───────────────────────────────────────────────────────
    def flow_at_pressure(self, pressure: float) -> float:
        """Flow at a given pressure. Interpolates the catalog curve in the sqrt(P)
        domain if present, otherwise uses Q = K·sqrt(P)."""
        p = max(float(pressure), 0.0)
        pts = self._sorted_points()
        if len(pts) >= 2:
            pressures = [x[0] for x in pts]
            flows = [x[1] for x in pts]
            return self._interp_vs_pressure(p, pressures, flows)
        k = self.effective_k()
        if k is None:
            raise ValueError(f"Nozzle '{self.id}' has neither K factor nor catalog points")
        return k * math.sqrt(p)

    # ── Flow → pressure ───────────────────────────────────────────────────────
    def pressure_at_flow(self, flow: float) -> float:
        """Inverse: the pressure required to deliver a given flow. This is the
        exact inverse of ``flow_at_pressure`` — flow is linear in sqrt(P), so we
        interpolate sqrt(P) against flow and square the result."""
        q = max(float(flow), 0.0)
        pts = self._sorted_points()
        if len(pts) >= 2:
            flows = [x[1] for x in pts]
            sqrt_p = [math.sqrt(x[0]) for x in pts]
            s = self._interp_table(q, list(zip(flows, sqrt_p)))
            return max(s, 0.0) ** 2
        k = self.effective_k()
        if not k:
            raise ValueError(f"Nozzle '{self.id}' has neither K factor nor catalog points")
        return (q / k) ** 2

    # ── Pressure → jet height (if the catalog provides it) ────────────────────
    def jet_height_at_pressure(self, pressure: float) -> Optional[float]:
        pts = [(float(pt["pressure"]), float(pt["jet_height"]))
               for pt in self.pressure_flow_points if pt.get("jet_height") is not None]
        if len(pts) < 2:
            return None
        pts.sort()
        pressures = [p for p, _ in pts]
        heights = [h for _, h in pts]
        # Same sqrt(P)-domain interpolation as flow, for a self-consistent curve.
        return self._interp_vs_pressure(max(float(pressure), 0.0), pressures, heights)

    # ── Interpolation helpers ─────────────────────────────────────────────────
    def _sorted_points(self) -> list[tuple[float, float, Optional[float]]]:
        out = []
        for pt in self.pressure_flow_points:
            if pt.get("pressure") is None or pt.get("flow") is None:
                continue
            out.append((float(pt["pressure"]), float(pt["flow"]),
                        (None if pt.get("jet_height") is None else float(pt["jet_height"]))))
        out.sort(key=lambda x: x[0])
        return out

    @staticmethod
    def _interp_vs_pressure(p: float, pressures: list[float], values: list[float]) -> float:
        """Interpolate a value against pressure in the sqrt(P) domain, which is
        exact for an ideal Q ∝ sqrt(P) nozzle and near-linear for real ones.
        Extrapolates using the nearest segment's slope."""
        sp = [math.sqrt(x) for x in pressures]
        s = math.sqrt(p)
        n = len(sp)
        if s <= sp[0]:
            i, j = 0, 1
        elif s >= sp[-1]:
            i, j = n - 2, n - 1
        else:
            j = bisect_left(sp, s)
            i = j - 1
        if sp[j] == sp[i]:
            return values[i]
        t = (s - sp[i]) / (sp[j] - sp[i])
        return values[i] + t * (values[j] - values[i])

    @staticmethod
    def _interp_table(x: float, table: list[tuple[float, float]]) -> float:
        """Monotonic linear interpolation of table [(x_i, y_i)] at x, with
        nearest-segment extrapolation."""
        table = sorted(table, key=lambda p: p[0])
        xs = [p[0] for p in table]
        ys = [p[1] for p in table]
        if x <= xs[0]:
            i, j = 0, 1
        elif x >= xs[-1]:
            i, j = len(table) - 2, len(table) - 1
        else:
            j = bisect_left(xs, x)
            i = j - 1
        if xs[j] == xs[i]:
            return ys[i]
        t = (x - xs[i]) / (xs[j] - xs[i])
        return ys[i] + t * (ys[j] - ys[i])

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "manufacturer": self.manufacturer,
            "model": self.model,
            "k_factor": self.k_factor,
            "effective_k": self.effective_k(),
            "orifice_mm": self.orifice_mm,
            "nozzle_type": self.nozzle_type,
            "pressure_flow_points": self.pressure_flow_points,
            "notes": self.notes,
            "provenance": self.provenance,
            "verified": is_verified(self.provenance),
            "citation": self.citation(),
        }


class NozzleDatabase:
    """In-memory nozzle store organised by manufacturer catalog."""

    def __init__(self, load_defaults: bool = True, load_verified: bool = True):
        self._models: dict[str, NozzleModel] = {}
        self._catalogs: dict[str, set[str]] = {}   # manufacturer -> {model ids}
        if load_defaults:
            self.load_default_catalogs()
        if load_verified:
            self.load_verified_models()

    def load_verified_models(self, registry=None) -> int:
        """AF-NEXT-012 — add manufacturer-datasheet / user-measured nozzles from the
        equipment registry (data/equipment_models + the user data dir)."""
        try:
            from services.equipment_registry import get_equipment_registry
            reg = registry or get_equipment_registry()
            records = reg.list("nozzle")
        except Exception:
            return 0
        for r in records:
            d = r.get("data") or {}
            prov = r.get("provenance") or {}
            self.add_model(NozzleModel(
                id=r["id"],
                manufacturer=prov.get("manufacturer") or ("User measured" if prov.get("source") == "user_measured" else "Unknown"),
                model=prov.get("model") or r.get("label", ""),
                k_factor=(None if d.get("k_factor") in (None, "") else float(d["k_factor"])),
                orifice_mm=(None if d.get("orifice_mm") in (None, "") else float(d["orifice_mm"])),
                nozzle_type=str(d.get("nozzle_type", "jet")),
                pressure_flow_points=list(d.get("pressure_flow_points", [])),
                notes=str(prov.get("notes", "")),
                provenance=prov,
            ))
        return len(records)

    # ── Loading ────────────────────────────────────────────────────────────────
    def load_default_catalogs(self) -> int:
        if DEFAULT_CATALOG_FILE.exists():
            try:
                data = json.loads(DEFAULT_CATALOG_FILE.read_text())
                return self.load_catalogs(data)
            except Exception:
                return 0
        return 0

    def load_catalogs(self, data) -> int:
        """Load one catalog dict or a list of catalog dicts. Returns count loaded."""
        catalogs = data.get("catalogs", data) if isinstance(data, dict) else data
        if isinstance(catalogs, dict):
            catalogs = [catalogs]
        count = 0
        for cat in catalogs or []:
            count += self.load_catalog(cat)
        return count

    def load_catalog(self, catalog: dict) -> int:
        """
        Load a single manufacturer catalog:
            {"manufacturer": "Acme", "nozzles": [{...NozzleModel...}, ...]}
        Returns the number of nozzle models loaded.
        """
        manufacturer = str(catalog.get("manufacturer", "Unknown"))
        # Catalog-level provenance applies to every model unless the model has its own.
        # A catalog without one is a generic estimate (normalize_provenance default).
        catalog_prov = catalog.get("provenance") if isinstance(catalog.get("provenance"), dict) else {}
        loaded = 0
        for n in catalog.get("nozzles", catalog.get("models", [])):
            model = NozzleModel(
                id=str(n.get("id") or f"{manufacturer}:{n.get('model')}"),
                manufacturer=manufacturer,
                model=str(n.get("model", "")),
                k_factor=(None if n.get("k_factor") is None else float(n["k_factor"])),
                orifice_mm=(None if n.get("orifice_mm") is None else float(n["orifice_mm"])),
                nozzle_type=str(n.get("nozzle_type", "jet")),
                pressure_flow_points=list(n.get("pressure_flow_points", [])),
                notes=str(n.get("notes", "")),
                provenance=(n.get("provenance") if isinstance(n.get("provenance"), dict)
                            else catalog_prov),
            )
            self.add_model(model)
            loaded += 1
        return loaded

    def add_model(self, model: NozzleModel) -> None:
        self._models[model.id] = model
        self._catalogs.setdefault(model.manufacturer, set()).add(model.id)

    # ── Lookup ──────────────────────────────────────────────────────────────────
    def get(self, model_id: str) -> Optional[NozzleModel]:
        return self._models.get(model_id)

    def manufacturers(self) -> list[str]:
        return sorted(self._catalogs.keys())

    def list_models(self, manufacturer: Optional[str] = None) -> list[NozzleModel]:
        if manufacturer is not None:
            ids = self._catalogs.get(manufacturer, set())
            return [self._models[i] for i in sorted(ids)]
        return [self._models[i] for i in sorted(self._models.keys())]

    # ── Query ────────────────────────────────────────────────────────────────────
    def query(self, model_id: str, pressure: Optional[float] = None,
              flow: Optional[float] = None) -> dict:
        model = self.get(model_id)
        if model is None:
            raise KeyError(f"Nozzle model '{model_id}' not found")
        result = {
            "id": model.id,
            "manufacturer": model.manufacturer,
            "model": model.model,
            "k_factor": model.effective_k(),
            "units": {"pressure": "bar", "flow": "L/min", "jet_height": "m",
                      "k_factor": "L/min/sqrt(bar)"},
            "provenance": model.provenance,
            "citation": model.citation(),
        }
        if pressure is not None:
            result["pressure"] = float(pressure)
            result["flow"] = round(model.flow_at_pressure(pressure), 6)
            jh = model.jet_height_at_pressure(pressure)
            if jh is not None:
                result["jet_height"] = round(jh, 4)
        if flow is not None:
            result["flow_input"] = float(flow)
            result["pressure_required"] = round(model.pressure_at_flow(flow), 6)
        return result


# ── Module-level singleton ─────────────────────────────────────────────────────
_db: Optional[NozzleDatabase] = None


def get_nozzle_database() -> NozzleDatabase:
    global _db
    if _db is None:
        _db = NozzleDatabase()
    return _db


def reload_nozzle_database() -> NozzleDatabase:
    """Rebuild the singleton (after a verified model is added/removed)."""
    global _db
    _db = NozzleDatabase()
    return _db
