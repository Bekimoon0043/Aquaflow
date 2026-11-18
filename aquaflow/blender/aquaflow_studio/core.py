"""AquaFlow project normalization. This module deliberately has no bpy dependency."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

GRAVITY = 9.80665
WATER_DENSITY = 1000.0
DEFAULT_LUMENS_PER_RADIANT_WATT = 300.0


def finite(value, fallback=0.0):
    try:
        number = float(value)
        return number if math.isfinite(number) else float(fallback)
    except (TypeError, ValueError):
        return float(fallback)


def positive(value, fallback=None):
    number = finite(value, 0.0)
    return number if number > 0 else fallback


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, finite(value, low)))


def srgb_to_linear(value):
    value = clamp(value)
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_color(value, fallback="#ffffff"):
    text = str(value or fallback).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(character * 2 for character in text)
    if len(text) != 6 or any(character not in "0123456789abcdefABCDEF" for character in text):
        text = fallback.lstrip("#")
    srgb = tuple(int(text[index:index + 2], 16) / 255.0 for index in (0, 2, 4))
    return {"hex": "#" + text.lower(), "srgb": srgb, "linear": tuple(srgb_to_linear(channel) for channel in srgb)}


def fixture_category(fixture):
    explicit = str(fixture.get("kind") or "").lower()
    if explicit in {"water", "light", "effect"}:
        return explicit
    if explicit in {"pump", "valve", "equipment"}:
        return "equipment"
    kind = str(fixture.get("type") or "").lower()
    if kind.startswith("pipe") or "pipe_" in kind or any(token in kind for token in ("pump", "valve", "filter", "sensor", "compressor", "air_tank", "control_", "power_", "manifold")):
        return "equipment"
    if kind.startswith("light") or "luminaire" in kind or "underwater_light" in kind:
        return "light"
    if any(token in kind for token in ("flame", "laser", "fog_", "fire_")):
        return "effect"
    return "water"


def nozzle_family(fixture):
    kind = str(fixture.get("type") or "").lower()
    if any(token in kind for token in ("cascade", "curtain")):
        return "cascade"
    if any(token in kind for token in ("mushroom", "bell", "arum")):
        return "bell"
    if "mist" in kind or "fog" in kind:
        return "mist"
    if any(token in kind for token in ("peacock", "phoenix", "fan")):
        return "fan"
    if any(token in kind for token in ("rotating", "pirouette", "basket", "spinner")):
        return "rotating"
    if any(token in kind for token in ("crown", "willow", "ring")):
        return "crown"
    if any(token in kind for token in ("arch", "laminar", "jumping", "bullet")):
        return "arch"
    if any(token in kind for token in ("foam", "froth", "geyser", "aerat", "snowy", "volcano", "vulcan")):
        return "aerated"
    return "clear"


def engineering_of(document):
    engineering = document.get("engineering") or document.get("engineeringProject") or {}
    if engineering.get("engineering"):
        engineering = engineering["engineering"]
    return engineering


def pool_center(engineering):
    geometry = engineering.get("geometry") or {}
    params = engineering.get("params") or {}
    pool_type = str(engineering.get("pool_type") or engineering.get("poolType") or "").lower()
    if geometry.get("type") in {"circle", "ellipse"}:
        center = geometry.get("center") or {}
        return finite(center.get("x")), finite(center.get("y"))
    points = geometry.get("points") or []
    if points:
        xs = [finite(point.get("x")) for point in points]
        ys = [finite(point.get("y")) for point in points]
        return (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0
    if "circ" in pool_type or "ellip" in pool_type:
        return 0.0, 0.0
    return positive(params.get("width"), 12.0) / 2.0, positive(params.get("length"), 8.0) / 2.0


def world_point(point, center=(0.0, 0.0), height=None):
    """Engineering plan -> centered, Z-up Blender metres.

    AquaFlow preview coordinates are (x, height, plan_y). Blender glTF's usual
    destination is (x, -plan_y, height), which preserves handedness.
    """
    if height is None:
        height = point.get("z", 0.0)
    return (
        finite(point.get("x", point.get("position", {}).get("x"))) - center[0],
        -(finite(point.get("y", point.get("position", {}).get("y"))) - center[1]),
        finite(height),
    )


def saved_world_point(point):
    point = point or {}
    return finite(point.get("x")), -finite(point.get("z")), finite(point.get("y"))


def pool_outline(engineering, center, circle_segments=96):
    geometry = engineering.get("geometry") or {}
    params = engineering.get("params") or {}
    points = geometry.get("points") or []
    if len(points) >= 3:
        raw = points
    elif geometry.get("type") in {"circle", "ellipse"} or any(token in str(engineering.get("pool_type") or engineering.get("poolType") or "").lower() for token in ("circ", "ellip")):
        geometry_center = geometry.get("center") or {"x": center[0], "y": center[1]}
        radius = positive(geometry.get("radius"), positive(params.get("radius"), 6.0))
        rx = positive(geometry.get("rx"), radius)
        ry = positive(geometry.get("ry"), radius)
        raw = [
            {"x": finite(geometry_center.get("x")) + rx * math.cos(index * math.tau / circle_segments),
             "y": finite(geometry_center.get("y")) + ry * math.sin(index * math.tau / circle_segments)}
            for index in range(circle_segments)
        ]
    else:
        width = positive(params.get("width"), 12.0)
        length = positive(params.get("length"), 8.0)
        raw = [{"x": 0, "y": 0}, {"x": width, "y": 0}, {"x": width, "y": length}, {"x": 0, "y": length}]
    result = [world_point(point, center, 0.0)[:2] for point in raw]
    if len(result) > 2 and math.dist(result[0], result[-1]) < 1e-8:
        result.pop()
    return result


def nozzle_hydraulics(fixture):
    engineering = fixture.get("engineering") or {}
    family = nozzle_family(fixture)
    diameter_mm = positive(engineering.get("nozzleDiaMm"), positive(engineering.get("diameterMm"), 20.0))
    diameter_m = diameter_mm / 1000.0
    flow_lpm = positive(engineering.get("flowLpm"), positive(engineering.get("flow_lpm"), 0.0))
    flow_m3s = flow_lpm / 60000.0
    height_m = positive(engineering.get("jetHeightM"), positive(engineering.get("heightM"), 2.0))
    pressure_bar = positive(engineering.get("pressureBar"), positive(engineering.get("pressure_bar"), 0.0))
    area = math.pi * (diameter_m / 2.0) ** 2
    flow_velocity = flow_m3s / area if area > 0 and flow_m3s > 0 else None
    height_velocity = math.sqrt(2.0 * GRAVITY * height_m) if height_m > 0 else None
    pressure_velocity = 0.93 * math.sqrt(2.0 * pressure_bar * 100000.0 / WATER_DENSITY) if pressure_bar > 0 else None
    if flow_velocity:
        velocity, source = flow_velocity, "flow_lpm/nozzle_area"
    elif pressure_velocity:
        velocity, source = pressure_velocity, "pressure/discharge_coefficient"
    elif height_velocity:
        velocity, source = height_velocity, "sqrt(2*g*jet_height)"
    else:
        velocity, source = 5.0, "generic_estimate"
    velocity = clamp(velocity, 0.1, 50.0)
    ideal_height = velocity * velocity / (2.0 * GRAVITY)
    return {
        "diameter_m": diameter_m,
        "radius_m": diameter_m / 2.0,
        "flow_lpm": flow_lpm,
        "flow_m3s": flow_m3s,
        "velocity_mps": velocity,
        "velocity_source": source,
        "design_height_m": height_m,
        "ideal_height_m": ideal_height,
        "height_ratio": height_m / ideal_height if ideal_height > 0 else None,
        "family": family,
    }


def nozzle_direction(fixture):
    engineering = fixture.get("engineering") or {}
    family = nozzle_family(fixture)
    elevation = positive(engineering.get("elevationDeg"), 45.0 if family in {"arch", "crown"} else 90.0)
    azimuth = -math.radians(finite(fixture.get("rotation"), finite(engineering.get("aimAzimuthDeg"), 0.0)))
    elevation = math.radians(clamp(elevation, 1.0, 90.0))
    horizontal = math.cos(elevation)
    return (
        math.cos(azimuth) * horizontal,
        math.sin(azimuth) * horizontal,
        math.sin(elevation),
    )


def ies_reference(fixture):
    engineering = fixture.get("engineering") or {}
    photometry = fixture.get("photometry") or engineering.get("photometry") or {}
    candidates = [
        photometry.get("iesPath"), photometry.get("ies_path"),
        engineering.get("iesPath"), engineering.get("ies_path"),
    ]
    ies = photometry.get("ies") or engineering.get("ies")
    if isinstance(ies, str):
        candidates.append(ies)
    elif isinstance(ies, dict):
        candidates.extend([ies.get("path"), ies.get("file"), ies.get("uri")])
    return next((str(value) for value in candidates if value), None)


def radiant_power(fixture):
    engineering = fixture.get("engineering") or {}
    lumens = positive(engineering.get("lumens"), positive(fixture.get("lumens"), 0.0))
    wattage = positive(engineering.get("wattage"), positive(fixture.get("wattage"), 0.0))
    if lumens:
        return lumens / DEFAULT_LUMENS_PER_RADIANT_WATT, "lumens/300_lm_per_W_approximation", lumens
    if wattage:
        return wattage * 0.30, "30_percent_of_electrical_watts_estimate", None
    return positive(fixture.get("intensity"), 4.0) * 2.0, "legacy_intensity_estimate", None


def _fixture(document, raw, center, source_dir):
    category = fixture_category(raw)
    engineering = raw.get("engineering") or {}
    position = world_point(raw, center)
    stable_id = hashlib.sha1(json.dumps(raw, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:10]
    item = {
        "id": str(raw.get("id") or "fixture-" + stable_id),
        "type": str(raw.get("type") or "unknown"),
        "label": str(raw.get("label") or raw.get("id") or "Fixture"),
        "category": category,
        "group": str(raw.get("groupId") or raw.get("group_id") or raw.get("zone") or ""),
        "position": position,
        "rotation": finite(raw.get("rotation")),
        "color": hex_color(raw.get("color") or raw.get("params", {}).get("color") or engineering.get("color")),
        "visible": raw.get("visible", True) is not False,
        "raw": raw,
    }
    if category == "water":
        item.update(nozzle_hydraulics(raw))
        item["direction"] = nozzle_direction(raw)
        item["aerated"] = bool(engineering.get("aerated")) or item["family"] == "aerated"
    elif category == "light":
        watts, source, lumens = radiant_power(raw)
        area = raw.get("area") or engineering.get("area") or {}
        item.update({
            "radiant_watts": watts,
            "power_source": source,
            "lumens": lumens,
            "beam_angle_deg": clamp(engineering.get("beamAngleDeg"), 5.0, 170.0) if engineering.get("beamAngleDeg") else 56.0,
            "mount_height_m": positive(engineering.get("mountHeightM"), position[2] + 0.05),
            "aim_deg": finite(engineering.get("aimDeg"), 0.0),
            "aim_azimuth_deg": finite(engineering.get("aimAzimuthDeg"), item["rotation"]),
            "paired_nozzle_id": engineering.get("pairedNozzleId") or raw.get("pairedNozzleId"),
            "area": bool(raw.get("areaLight") or engineering.get("areaLight") or area),
            "area_width_m": positive(area.get("widthM"), 0.2),
            "area_length_m": positive(area.get("lengthM"), 0.2),
            "ies": ies_reference(raw),
        })
        if item["ies"] and not Path(item["ies"]).is_absolute():
            item["ies"] = str((source_dir / item["ies"]).resolve())
    return item


def collect_clips(document):
    clips = list(document.get("clips") or (document.get("show") or {}).get("clips") or [])
    seen = {str(clip.get("id")) for clip in clips if clip.get("id")}
    for track in document.get("timelineTracks") or []:
        for raw in track.get("clips") or []:
            clip = dict(raw)
            clip.setdefault("fixtureId", raw.get("fixtureId") or track.get("fixtureId") or track.get("deviceId"))
            clip.setdefault("type", raw.get("type") or track.get("type"))
            if clip.get("duration") is None and clip.get("end") is not None:
                clip["duration"] = finite(clip.get("end")) - finite(clip.get("startTime", clip.get("start", 0)))
            identifier = str(clip.get("id"))
            if identifier and identifier in seen:
                continue
            clips.append(clip)
            if identifier:
                seen.add(identifier)
    return clips


def normalize_project(document, source_dir="."): 
    if not isinstance(document, dict):
        raise ValueError("AquaFlow project must be a JSON object")
    engineering = engineering_of(document)
    fixtures_raw = engineering.get("fixtures") or document.get("fixtures") or []
    if not fixtures_raw:
        raise ValueError("The project contains no engineering fixtures")
    center = pool_center(engineering)
    source_dir = Path(source_dir)
    fixtures = [_fixture(document, raw, center, source_dir) for raw in fixtures_raw if isinstance(raw, dict)]
    show = document.get("show") or {}
    render = document.get("render") or {}
    duration = positive(show.get("duration"), positive(document.get("duration"), 60.0))
    fps = int(clamp(render.get("exportFps"), 1, 120)) if render.get("exportFps") else 30
    depth = positive((engineering.get("params") or {}).get("depth"), 0.8)
    surfaces = []
    for raw in engineering.get("site_surfaces") or engineering.get("siteSurfaces") or []:
        if not isinstance(raw, dict) or raw.get("visible", True) is False or len(raw.get("points") or []) < 3:
            continue
        surfaces.append({
            "id": str(raw.get("id") or "surface"),
            "label": str(raw.get("label") or raw.get("id") or "Site surface"),
            "type": str(raw.get("type") or "stone"),
            "color": hex_color(raw.get("color"), "#9a958c"),
            "elevation": positive(raw.get("elevation"), 0.02),
            "points": [world_point(point, center, 0.0)[:2] for point in raw["points"]],
        })
    pipes = []
    raw_pipes = engineering.get("manualPipes") or engineering.get("manual_pipes") or engineering.get("pipes") or []
    for index, raw in enumerate(raw_pipes):
        points = raw.get("points") or []
        if len(points) < 2:
            continue
        elevation = finite(raw.get("elevationM"), -0.2)
        pipes.append({
            "id": str(raw.get("id") or f"pipe-{index + 1}"),
            "label": str(raw.get("label") or raw.get("id") or f"Pipe {index + 1}"),
            "points": [world_point(point, center, elevation) for point in points],
            "diameter_m": positive(raw.get("diameterMm"), 50.0) / 1000.0,
            "material": str(raw.get("material") or "pvc"),
            "pumpId": raw.get("pumpId"),
            "valveId": raw.get("valveId"),
        })
    cameras = []
    for raw in render.get("cameraViews") or []:
        cameras.append({
            "id": str(raw.get("id") or "view"),
            "name": str(raw.get("name") or raw.get("id") or "View"),
            "position": saved_world_point(raw.get("position")),
            "target": saved_world_point(raw.get("target")),
        })
    warnings = []
    for fixture in fixtures:
        if fixture["category"] == "water" and fixture.get("height_ratio") and not 0.75 <= fixture["height_ratio"] <= 1.25:
            warnings.append(
                f"{fixture['id']}: design height {fixture['design_height_m']:.2f} m differs from the "
                f"flow/diameter ballistic estimate {fixture['ideal_height_m']:.2f} m; flow and diameter drive the native simulation."
            )
    return {
        "name": str(show.get("name") or engineering.get("name") or document.get("project", {}).get("name") or "AquaFlow Fountain"),
        "duration_s": duration,
        "fps": fps,
        "environment": str(render.get("environment") or "night"),
        "active_camera": str(render.get("activeCameraView") or ""),
        "center": center,
        "pool": {
            "points": pool_outline(engineering, center),
            "depth_m": depth,
            "waterline_m": -0.05,
        },
        "surfaces": surfaces,
        "fixtures": fixtures,
        "pipes": pipes,
        "cameras": cameras,
        "timelineTracks": document.get("timelineTracks") or [],
        "clips": collect_clips(document),
        "source_dir": str(source_dir),
        "warnings": warnings,
    }


def pool_edge_distance(position, points):
    if len(points) < 2:
        return float("inf")
    px, py = position[:2]
    best = float("inf")
    for first, second in zip(points, points[1:] + points[:1]):
        ax, ay = first
        bx, by = second
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        amount = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
        distance = math.hypot(px - (ax + amount * dx), py - (ay + amount * dy))
        best = min(best, distance)
    return best


def simulation_plan(project, scope="HERO", hero_id="", resolution=128):
    scope = str(scope or "HERO").upper()
    nozzles = [fixture for fixture in project["fixtures"] if fixture["category"] == "water" and fixture["family"] != "mist"]
    if scope == "PROXIES" or not nozzles:
        return {"scope": "PROXIES", "nozzles": [], "warnings": []}
    if scope == "HERO":
        selected = next((fixture for fixture in nozzles if fixture["id"] == hero_id), None)
        if not selected:
            selected = max(nozzles, key=lambda fixture: fixture["design_height_m"])
        nozzles = [selected]
    depth = project["pool"]["depth_m"]
    points = project["pool"]["points"]
    pool_width = max((point[0] for point in points), default=5.0) - min((point[0] for point in points), default=-5.0)
    pool_length = max((point[1] for point in points), default=4.0) - min((point[1] for point in points), default=-4.0)
    max_apex = max(fixture["position"][2] + fixture["ideal_height_m"] for fixture in nozzles)
    if scope == "HERO":
        nozzle = nozzles[0]
        radius = max(1.25, nozzle["design_height_m"] * 0.75, nozzle["velocity_mps"] * 0.35)
        min_corner = (nozzle["position"][0] - radius, nozzle["position"][1] - radius, -depth - 0.25)
        max_corner = (nozzle["position"][0] + radius, nozzle["position"][1] + radius, max_apex + 0.75)
    else:
        margin = 0.75
        min_corner = (-pool_width / 2.0 - margin, -pool_length / 2.0 - margin, -depth - 0.25)
        max_corner = (pool_width / 2.0 + margin, pool_length / 2.0 + margin, max_apex + 0.75)
    size = tuple(max_corner[index] - min_corner[index] for index in range(3))
    longest = max(size)
    voxel = longest / max(8, int(resolution))
    warnings = []
    for nozzle in nozzles:
        cells = nozzle["diameter_m"] / voxel
        nozzle["under_resolved"] = cells < 2.0
        nozzle["emitter_radius_m"] = nozzle["radius_m"]
        if nozzle["under_resolved"]:
            recommended = math.ceil(longest * 4.0 / nozzle["diameter_m"])
            warnings.append(
                f"{nozzle['id']}: nozzle spans {cells:.2f} voxels at resolution {resolution}. "
                f"Use about {recommended} divisions for four cells. Its actual radius is preserved; use a design proxy or a local domain instead of an enlarged emitter."
            )
    return {
        "scope": scope,
        "nozzles": nozzles,
        "min": min_corner,
        "max": max_corner,
        "center": tuple((min_corner[index] + max_corner[index]) / 2.0 for index in range(3)),
        "size": size,
        "resolution": int(resolution),
        "voxel_m": voxel,
        "warnings": warnings,
    }
