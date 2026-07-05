"""
generative_designer.py — AquaFlow Stage 5, AQ-S5-006

Generative Fountain Designer: turn a short design brief (venue size, budget, style,
theme) into fully-formed fountain *concepts*, then emit the two downstream deliverable
packages for the chosen concept.

Pipeline:
  1. generate_concepts(brief, count) — deterministically synthesise several distinct
     concepts. Each lays out a pool + a real fixture arrangement (nozzles, uplights,
     effect emitters) using one of three spatial archetypes (radial rotunda / grand
     canal / clustered cascade), a costed estimate, and a written narrative.
  2. build_engineering_package(concept) — the engineering ZIP (reuses the existing
     engineering_package builder: CAD DXF, BOM XLSX, P&ID SVG, cover PDF, manifest…).
  3. build_construction_package(concept) — a construction ZIP: civil/structural works,
     equipment room, electrical load, plumbing schedule, a phased install programme,
     a safety plan, a cover PDF and a checksummed manifest.

  * generates fountain concepts — `generate_concepts()` returns distinct, complete,
    reproducible concepts (same brief → same concepts),
  * produces an engineering package — `build_engineering_package()` returns a complete
    engineering ZIP + manifest,
  * produces a construction package — `build_construction_package()` returns a complete
    construction ZIP + manifest.

Deterministic (RNG seeded from the brief) and dependency-free (PDF/manifest written
directly), so it is fully unit-tested.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import random
import zipfile
from datetime import date

from services.engineering_package import build_pdf, build_package

# ── Component catalog (USD unit costs; jet specs in metres / L·min⁻¹) ──────────
# Rough but concrete figures so the estimate and packages are meaningful.
CATALOG = {
    "geyser_nozzle":    {"cost": 1200, "jet_height_m": 15.0, "flow_lpm": 220, "kind": "nozzle"},
    "laminar_jet":      {"cost": 850,  "jet_height_m": 6.0,  "flow_lpm": 60,  "kind": "nozzle"},
    "fan_jet":          {"cost": 450,  "jet_height_m": 3.5,  "flow_lpm": 90,  "kind": "nozzle"},
    "ring_jet":         {"cost": 300,  "jet_height_m": 2.5,  "flow_lpm": 45,  "kind": "nozzle"},
    "foam_jet":         {"cost": 380,  "jet_height_m": 1.2,  "flow_lpm": 130, "kind": "nozzle"},
    "mist_nozzle":      {"cost": 120,  "jet_height_m": 0.6,  "flow_lpm": 8,   "kind": "nozzle"},
    "rgbw_led_uplight": {"cost": 260,  "jet_height_m": 0.0,  "flow_lpm": 0,   "kind": "lighting"},
    "flame_emitter":    {"cost": 3200, "jet_height_m": 0.0,  "flow_lpm": 0,   "kind": "effect"},
    "fog_machine":      {"cost": 1400, "jet_height_m": 0.0,  "flow_lpm": 0,   "kind": "effect"},
    "laser_projector":  {"cost": 5600, "jet_height_m": 0.0,  "flow_lpm": 0,   "kind": "effect"},
}

# Style → palette + effect emphasis + signature nozzle. Keeps concepts on-brief.
STYLE_PROFILES = {
    "romantic":  {"adj": "Azure", "effects": {"fog": True}, "hero": "laminar_jet",
                  "palette": ["#6d214f", "#b33771", "#f8a5c2"]},
    "grand":     {"adj": "Imperial", "effects": {"fog": True, "flame": True}, "hero": "geyser_nozzle",
                  "palette": ["#1B1464", "#5758BB", "#EA2027"]},
    "playful":   {"adj": "Sunburst", "effects": {"fog": True}, "hero": "fan_jet",
                  "palette": ["#f6b93b", "#e55039", "#78e08f"]},
    "modern":    {"adj": "Aether", "effects": {"fog": True, "laser": True}, "hero": "laminar_jet",
                  "palette": ["#12CBC4", "#0652DD", "#FDA7DF"]},
    "dramatic":  {"adj": "Vulcan", "effects": {"fog": True, "flame": True, "laser": True},
                  "hero": "geyser_nozzle", "palette": ["#2C3A47", "#B53471", "#EA2027"]},
}
DEFAULT_STYLE = "modern"

ARCHETYPES = [
    {"key": "radial", "word": "Rotunda",
     "story": "concentric rings of jets orbit a central hero geyser"},
    {"key": "canal", "word": "Canal",
     "story": "twin runs of jets frame a reflective promenade"},
    {"key": "cluster", "word": "Cascade",
     "story": "clustered pods step water down tiered cascades"},
]

# Construction package must always contain these.
CONSTRUCTION_REQUIRED_DOCUMENTS = [
    "manifest.json", "construction_cover.pdf", "civil_works.json", "structural_spec.json",
    "equipment_room.json", "electrical_load.json", "plumbing_schedule.json",
    "install_schedule.csv", "safety_plan.txt", "README.txt",
]


# ── Brief parsing ─────────────────────────────────────────────────────────────

def _brief_dims(brief: dict) -> tuple[float, float]:
    """Resolve a pool length×width (m) from the brief (area, or explicit dims)."""
    length = float(brief.get("length_m") or 0)
    width = float(brief.get("width_m") or 0)
    if length > 0 and width > 0:
        return length, width
    area = float(brief.get("area_m2") or 0)
    if area <= 0:
        area = 240.0
    # Golden-ish 5:3 basin.
    width = math.sqrt(area * 3.0 / 5.0)
    length = area / width
    return round(length, 1), round(width, 1)


def _style_key(brief: dict) -> str:
    s = str(brief.get("style") or brief.get("mood") or "").lower()
    for key in STYLE_PROFILES:
        if key in s:
            return key
    # a few synonyms
    if any(w in s for w in ("elegant", "wedding", "intimate")):
        return "romantic"
    if any(w in s for w in ("epic", "monument", "iconic", "landmark")):
        return "grand"
    if any(w in s for w in ("fun", "family", "kids", "whimsical")):
        return "playful"
    if any(w in s for w in ("fire", "intense", "bold")):
        return "dramatic"
    return DEFAULT_STYLE


def _seed(brief: dict) -> int:
    blob = json.dumps(brief, sort_keys=True, default=str)
    return int(hashlib.sha256(blob.encode("utf-8")).hexdigest(), 16) % (2**32)


# ── Fixture layout archetypes ─────────────────────────────────────────────────

def _fixture(idx: int, model: str, x: float, y: float) -> dict:
    spec = CATALOG[model]
    return {
        "id": f"FX-{idx:03d}", "type": model, "label": f"{model} {idx}",
        "x": round(x, 2), "y": round(y, 2),
        "engineering": {"partNumber": model.upper().replace("_", "-")},
        "spec": {"jet_height_m": spec["jet_height_m"], "flow_lpm": spec["flow_lpm"]},
    }


def _layout(archetype: str, length: float, width: float, hero: str,
            n_nozzles: int, rng: random.Random) -> list[dict]:
    cx, cy = length / 2.0, width / 2.0
    fixtures: list[dict] = []
    i = 0

    def add(model, x, y):
        nonlocal i
        i += 1
        fixtures.append(_fixture(i, model, x, y))

    if archetype == "radial":
        add(hero, cx, cy)                                   # central hero
        rings = max(1, min(4, n_nozzles // 8))
        remaining = n_nozzles - 1
        for r in range(1, rings + 1):
            radius = (min(length, width) / 2.0) * (r / (rings + 1))
            count = max(4, remaining // (rings - r + 1))
            remaining -= count
            for k in range(count):
                ang = 2 * math.pi * k / count
                model = "ring_jet" if r % 2 else "laminar_jet"
                add(model, cx + radius * math.cos(ang), cy + radius * math.sin(ang))
                if k % 3 == 0:
                    add("rgbw_led_uplight", cx + radius * math.cos(ang), cy + radius * math.sin(ang))
    elif archetype == "canal":
        rows = [width * 0.2, width * 0.8]
        per_row = max(3, n_nozzles // 2)
        for ry in rows:
            for k in range(per_row):
                x = length * (k + 0.5) / per_row
                add("fan_jet", x, ry)
                if k % 2 == 0:
                    add("rgbw_led_uplight", x, ry)
        for k in range(max(2, per_row // 2)):               # central laminar spine
            add("laminar_jet", length * (k + 0.5) / max(2, per_row // 2), cy)
    else:  # cluster
        pods = max(2, min(6, n_nozzles // 6))
        cols = max(1, int(round(math.sqrt(pods))))
        for p in range(pods):
            px = length * ((p % cols) + 1) / (cols + 1)
            py = width * ((p // cols) + 1) / (pods // cols + 2)
            add("foam_jet", px, py)                         # pod centre
            for k in range(5):
                ang = 2 * math.pi * k / 5
                add("ring_jet", px + 1.2 * math.cos(ang), py + 1.2 * math.sin(ang))
            add("rgbw_led_uplight", px, py)

    return fixtures


def _add_effects(fixtures: list[dict], effects: dict, length: float, width: float) -> None:
    i = len(fixtures)
    cx, cy = length / 2.0, width / 2.0
    if effects.get("fog"):
        i += 1; fixtures.append(_fixture(i, "fog_machine", cx, 0.5))
    if effects.get("flame"):
        for fx_x in (length * 0.25, length * 0.75):
            i += 1; fixtures.append(_fixture(i, "flame_emitter", fx_x, cy))
    if effects.get("laser"):
        i += 1; fixtures.append(_fixture(i, "laser_projector", cx, width - 0.5))


# ── Concept generation ────────────────────────────────────────────────────────

def _estimate(fixtures: list[dict], area: float, depth: float) -> dict:
    equipment_cost = sum(CATALOG[f["type"]]["cost"] for f in fixtures)
    # Civil: basin construction + waterproofing per m², excavation, and an equipment room.
    excavation_m3 = round(area * (depth + 0.6), 1)
    civil_cost = round(area * 900 + 45000)
    total_flow = sum(CATALOG[f["type"]]["flow_lpm"] for f in fixtures)
    return {
        "fixture_count": len(fixtures),
        "equipment_cost_usd": equipment_cost,
        "civil_cost_usd": civil_cost,
        "total_cost_usd": equipment_cost + civil_cost,
        "peak_flow_lpm": total_flow,
        "excavation_m3": excavation_m3,
    }


def generate_concepts(brief: dict, count: int = 3) -> list[dict]:
    """Deterministically generate `count` distinct fountain concepts from a brief."""
    brief = brief or {}
    length, width = _brief_dims(brief)
    area = round(length * width, 1)
    depth = float(brief.get("depth_m") or 1.2)
    style_key = _style_key(brief)
    style = STYLE_PROFILES[style_key]
    theme = str(brief.get("theme") or brief.get("name") or "").strip()
    budget = float(brief.get("budget_usd") or 0)
    rng = random.Random(_seed(brief))

    # Nozzle count scales with area, capped, and trimmed if a budget is given.
    base_nozzles = int(max(8, min(120, area / 6.0)))

    concepts = []
    n = max(1, min(len(ARCHETYPES), int(count)))
    for a_i in range(n):
        arch = ARCHETYPES[a_i]
        sub = random.Random(rng.random())
        n_nozzles = base_nozzles + sub.randint(-2, 4)
        hero = style["hero"]
        fixtures = _layout(arch["key"], length, width, hero, max(6, n_nozzles), sub)
        _add_effects(fixtures, style["effects"], length, width)
        est = _estimate(fixtures, area, depth)

        # Budget trim: drop the most expensive optional fixtures until within budget.
        if budget > 0 and est["total_cost_usd"] > budget:
            trimmable = sorted(
                [f for f in fixtures if CATALOG[f["type"]]["kind"] != "effect"],
                key=lambda f: CATALOG[f["type"]]["cost"], reverse=True)
            while trimmable and _estimate(fixtures, area, depth)["total_cost_usd"] > budget \
                    and len(fixtures) > 6:
                fixtures.remove(trimmable.pop(0))
            est = _estimate(fixtures, area, depth)

        name = f"{style['adj']} {arch['word']}"
        hero_h = CATALOG[hero]["jet_height_m"]
        signature = [
            f"Central {hero.replace('_', ' ')} rising to {hero_h:g} m",
            f"{est['fixture_count']} programmable fixtures across {area:g} m²",
            arch["story"].capitalize(),
        ]
        if style["effects"].get("flame"):
            signature.append("Fire emitters for finale accents")
        if style["effects"].get("laser"):
            signature.append("Laser projection over the water screen")

        narrative = (
            f"{name} is a {style_key} water feature{f' themed “{theme}”' if theme else ''}. "
            f"{arch['story'].capitalize()} within a {length:g}×{width:g} m basin, choreographed "
            f"across {est['fixture_count']} fixtures with a peak demand of {est['peak_flow_lpm']} L/min.")

        concepts.append({
            "id": f"{style_key}-{arch['key']}",
            "name": name, "style": style_key, "theme": theme,
            "archetype": arch["key"], "narrative": narrative,
            "palette": style["palette"],
            "pool": {"shape": "rectangular", "length_m": length, "width_m": width,
                     "depth_m": depth, "area_m2": area},
            "effects": dict(style["effects"]),
            "signature_elements": signature,
            "fixtures": fixtures,
            "estimate": est,
            "within_budget": (budget <= 0) or (est["total_cost_usd"] <= budget),
        })
    return concepts


# ── Concept → canonical design (for the engineering package) ──────────────────

def concept_to_design(concept: dict) -> dict:
    """Project a concept into the canonical design payload the packagers consume."""
    pool = concept.get("pool", {})
    pipes = []
    nozzles = [f for f in concept.get("fixtures", [])
               if CATALOG.get(f["type"], {}).get("kind") == "nozzle"]
    # A simple ring/spine main feeding each nozzle from a header node.
    for f in nozzles:
        pipes.append({"from": "HEADER", "to": f["id"], "label": f["type"]})
    return {
        "name": concept.get("name", "AquaFlow Concept"),
        "projectName": concept.get("name"),
        "poolType": pool.get("shape", "rectangular"),
        "pool": pool,
        "fixtures": concept.get("fixtures", []),
        "pipes": pipes,
        "palette": concept.get("palette", []),
    }


def build_engineering_package(concept: dict) -> tuple[bytes, dict]:
    """Engineering ZIP + manifest for a concept (reuses the engineering packager)."""
    return build_package(concept_to_design(concept))


# ── Construction package ──────────────────────────────────────────────────────

def _construction_documents(concept: dict) -> dict:
    pool = concept.get("pool", {})
    est = concept.get("estimate", {})
    area = float(pool.get("area_m2") or 0)
    depth = float(pool.get("depth_m") or 1.2)
    length = float(pool.get("length_m") or 0)
    width = float(pool.get("width_m") or 0)
    project = concept.get("name", "AquaFlow Concept")

    fixtures = concept.get("fixtures", [])
    n_lighting = sum(1 for f in fixtures if CATALOG.get(f["type"], {}).get("kind") == "lighting")
    n_effect = sum(1 for f in fixtures if CATALOG.get(f["type"], {}).get("kind") == "effect")
    n_nozzle = sum(1 for f in fixtures if CATALOG.get(f["type"], {}).get("kind") == "nozzle")

    # Civil / structural quantities (concrete basin, waterproofing, excavation, rebar).
    wall_h = depth + 0.3
    perimeter = 2 * (length + width)
    slab_m3 = round(area * 0.25, 1)                     # 250 mm base slab
    wall_m3 = round(perimeter * wall_h * 0.25, 1)       # 250 mm walls
    concrete_m3 = round(slab_m3 + wall_m3, 1)
    civil = {
        "excavation_m3": est.get("excavation_m3", round(area * (depth + 0.6), 1)),
        "basin": {"length_m": length, "width_m": width, "depth_m": depth},
        "base_slab_m3": slab_m3, "wall_m3": wall_m3, "total_concrete_m3": concrete_m3,
        "waterproofing_m2": round(area + perimeter * wall_h, 1),
        "rebar_tonnes": round(concrete_m3 * 0.11, 2),   # ~110 kg/m³
    }
    structural = {
        "basin_wall_thickness_mm": 250, "base_slab_thickness_mm": 250,
        "concrete_grade": "C35/45 (water-retaining, BS EN 1992-3)",
        "rebar_grade": "B500B", "cover_mm": 40,
        "expansion_joints": max(2, int(perimeter // 12)),
        "hydrostatic_uplift_check": "required — provide drainage/anchorage per soil report",
    }

    # Electrical load: pumps sized from peak flow, plus lighting + effects.
    peak_flow = est.get("peak_flow_lpm", 0)
    pump_kw = round(max(1.5, peak_flow / 1000.0 * 8.0), 1)   # ~8 kW per 1000 L/min head
    lighting_kw = round(n_lighting * 0.03, 2)
    effect_kw = round(n_effect * 2.0, 2)
    connected_kw = round(pump_kw + lighting_kw + effect_kw + 3.0, 2)   # +3 kW controls
    electrical = {
        "connected_load_kw": connected_kw,
        "pumps_kw": pump_kw, "lighting_kw": lighting_kw, "effects_kw": effect_kw,
        "controls_kw": 3.0,
        "supply": "400V 3-phase" if connected_kw > 15 else "230V single-phase",
        "main_breaker_a": int(math.ceil(connected_kw * 1000 / (400 * 1.732 * 0.9) if connected_kw > 15
                                        else connected_kw * 1000 / (230 * 0.9))),
        "rcd_protection": "30 mA RCD on all submerged circuits (mandatory)",
        "earthing": "equipotential bonding of all metalwork + basin rebar",
    }

    # Plumbing schedule.
    plumbing = {
        "supply_header_mm": 150 if peak_flow > 800 else 100,
        "nozzle_count": n_nozzle,
        "return_drains": max(2, int(area // 40)),
        "makeup_supply_mm": 25, "overflow_mm": 100,
        "filtration_turnover_h": 6,
        "balance_tank_m3": round(area * 0.15, 1),
    }
    equipment_room = {
        "footprint_m2": round(max(18.0, area * 0.12), 1),
        "pumps": max(1, int(math.ceil(pump_kw / 7.5))),
        "filtration": "media + cartridge polishing",
        "location": "below-grade adjacent to basin",
        "access": "min 900 mm clear, 2h fire-rated door, sump + drainage",
    }

    # Phased install programme (weeks).
    schedule = [
        ("1. Site setup & excavation", 2),
        ("2. Basin reinforcement & concrete pour", 3),
        ("3. Waterproofing & curing", 2),
        ("4. Equipment room & pump install", 2),
        ("5. Pipework & nozzle installation", 3),
        ("6. Electrical & controls", 2),
        ("7. Lighting & effects", 1),
        ("8. Commissioning, balancing & testing", 2),
    ]
    csv_lines = ["phase,description,duration_weeks,start_week"]
    start = 1
    for label, dur in schedule:
        csv_lines.append(f"{label.split('.')[0]},{label.split('. ', 1)[1]},{dur},{start}")
        start += dur
    total_weeks = start - 1

    safety = (
        f"AquaFlow Studio — Construction Safety Plan\nProject: {project}\n"
        f"Generated: {date.today().isoformat()}\n\n"
        "1. Excavation: shore/batter all faces > 1.2 m; barricade open basin.\n"
        "2. Confined space: equipment room entry permit + gas testing.\n"
        "3. Electrical: no energisation until RCD + earthing verified; lockout/tagout.\n"
        "4. Water: basin kept drained until commissioning; drowning controls during fill.\n"
        "5. Effects: flame/laser interlocks proven before public operation.\n"
        "6. Handover: as-builts, O&M manuals, and operator training required.\n")

    docs = {
        "civil_works.json": json.dumps(civil, indent=2).encode("utf-8"),
        "structural_spec.json": json.dumps(structural, indent=2).encode("utf-8"),
        "equipment_room.json": json.dumps(equipment_room, indent=2).encode("utf-8"),
        "electrical_load.json": json.dumps(electrical, indent=2).encode("utf-8"),
        "plumbing_schedule.json": json.dumps(plumbing, indent=2).encode("utf-8"),
        "install_schedule.csv": ("\n".join(csv_lines) + "\n").encode("utf-8"),
        "safety_plan.txt": safety.encode("utf-8"),
    }

    cover_lines = [
        f"Project: {project}", f"Date: {date.today().isoformat()}", "",
        "CONSTRUCTION PACKAGE", "----------------------------------------",
        f"Basin: {length:g} x {width:g} x {depth:g} m  ({area:g} m2)",
        f"Excavation: {civil['excavation_m3']:g} m3",
        f"Concrete: {concrete_m3:g} m3 ({structural['concrete_grade']})",
        f"Rebar: {civil['rebar_tonnes']:g} t ({structural['rebar_grade']})",
        f"Waterproofing: {civil['waterproofing_m2']:g} m2",
        f"Connected load: {connected_kw:g} kW ({electrical['supply']})",
        f"Pumps: {equipment_room['pumps']} / {pump_kw:g} kW",
        f"Programme: {total_weeks} weeks over {len(schedule)} phases",
        "",
        "DOCUMENTS", "----------------------------------------",
        "- civil_works.json ......... excavation, concrete, waterproofing quantities",
        "- structural_spec.json ..... basin structural specification",
        "- equipment_room.json ...... plant room layout",
        "- electrical_load.json ..... connected load + protection",
        "- plumbing_schedule.json ... headers, drains, filtration",
        "- install_schedule.csv ..... phased construction programme",
        "- safety_plan.txt .......... construction safety plan",
    ]
    docs["construction_cover.pdf"] = build_pdf(f"{project} — Construction Package", cover_lines)
    docs["README.txt"] = (
        f"AquaFlow Studio — Construction Package\nProject: {project}\n"
        f"Generated: {date.today().isoformat()}\n\n"
        "Civil, structural, MEP and programme deliverables to build the fountain. "
        "Open construction_cover.pdf first; JSON files carry the engineering quantities; "
        "install_schedule.csv opens in any spreadsheet.\n").encode("utf-8")
    return docs


def _manifest(project: str, docs: dict, required: list[str]) -> dict:
    documents = []
    for name in sorted(docs):
        blob = docs[name]
        documents.append({"name": name, "format": name.rsplit(".", 1)[-1].lower(),
                          "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()[:16]})
    present = set(docs)
    missing = [d for d in required if d not in present]
    formats = sorted({d["format"] for d in documents})
    return {
        "project": project, "generated": date.today().isoformat(),
        "document_count": len(documents), "documents": documents, "formats": formats,
        "required_documents": required, "complete": not missing,
        "missing_documents": missing,
        "pdf_supported": "pdf" in formats,
    }


def build_construction_package(concept: dict) -> tuple[bytes, dict]:
    """Construction ZIP + manifest for a concept."""
    project = concept.get("name", "AquaFlow Concept")
    docs = _construction_documents(concept)
    manifest = _manifest(project, {**docs, "manifest.json": b"{}"},
                         CONSTRUCTION_REQUIRED_DOCUMENTS)
    docs["manifest.json"] = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(docs):
            zf.writestr(name, docs[name])
    return buf.getvalue(), manifest


def package_filename(concept: dict, kind: str) -> str:
    name = str(concept.get("name") or "aquaflow_concept")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "concept"
    return f"{safe}_{kind}_package.zip"
