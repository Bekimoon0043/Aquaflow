"""
generate_fixture_library.py — AquaFlow Stage 2, Priority 11 (AQ-S2-011)

Deterministically generates the expanded AquaFlow fixture library: 500+ fountain
fixtures across all equipment families, each carrying BOTH a hydraulic metadata
block (`engineering`) and an electrical metadata block (`electrical`).

Output: frontend/src/data/fixture_library_expanded.json
Run:    python tools/generate_fixture_library.py

The generator is fully deterministic (no randomness) so the library is
reproducible and diff-stable.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

OUT = Path(__file__).parent.parent / "frontend" / "src" / "data" / "fixture_library_expanded.json"


def slug(*parts) -> str:
    s = "_".join(str(p) for p in parts).lower()
    return "".join(c if c.isalnum() or c == "_" else "_" for c in s).strip("_")


def amps(power_w: float, voltage: float, phase: int, pf: float = 0.9) -> float:
    if power_w <= 0 or voltage <= 0:
        return 0.0
    if phase == 3:
        return round(power_w / (math.sqrt(3) * voltage * pf), 3)
    if phase == 1:
        return round(power_w / (voltage * pf), 3)
    return round(power_w / voltage, 3)   # DC


def hyd(flow_lpm, pressure_bar, jet_h, dia_mm, dn, material="SS316", spray=90, group=""):
    k = round(flow_lpm / math.sqrt(pressure_bar), 3) if pressure_bar > 0 else 0.0
    return {
        "flowLpm": round(flow_lpm, 2),
        "pressureBar": round(pressure_bar, 3),
        "jetHeightM": round(jet_h, 2),
        "nozzleDiaMm": round(dia_mm, 1),
        "connectionSize": f"DN{dn}",
        "kFactor": k,
        "sprayAngleDeg": spray,
        "material": material,
        "group": group,
    }


def elec(voltage, power_w, phase, protocol, ip="IP68", dmx_ch=0):
    return {
        "voltageV": voltage,
        "powerW": round(power_w, 1),
        "currentA": amps(power_w, voltage, phase),
        "phase": phase,
        "controlProtocol": protocol,
        "dmxChannels": dmx_ch,
        "ipRating": ip,
    }


fixtures: list[dict] = []


def add(key, category, family, label, color, icon, engineering, electrical):
    fixtures.append({
        "key": key, "category": category, "family": family, "label": label,
        "color": color, "icon": icon,
        "engineering": engineering, "electrical": electrical,
    })


# ── 1) Water jets / nozzles ────────────────────────────────────────────────────
# (name, family, base_pressure_bar, height_per_bar, spray_angle, flow_coeff@DN25, color, icon)
JET_TYPES = [
    ("Straight Jet", "Vertical Jets", 1.0, 2.2, 6, 80, "#00aaff", "↑"),
    ("Aerated Jet", "Aerated Jets", 1.2, 1.6, 12, 120, "#66ccff", "❋"),
    ("Foam Jet", "Foam Jets", 0.8, 1.2, 20, 150, "#cceeff", "☁"),
    ("Cascade Jet", "Cascade", 0.6, 0.8, 30, 200, "#88ddff", "≋"),
    ("Fan Spray", "Fan Sprays", 1.5, 1.0, 110, 90, "#33bbff", "⟩"),
    ("Ring Jet", "Ring/Crown", 1.3, 1.8, 8, 70, "#00bbee", "◍"),
    ("Crown Jet", "Ring/Crown", 1.4, 1.9, 10, 75, "#00ccee", "♛"),
    ("Bell Jet", "Bell/Dome", 0.9, 0.6, 160, 110, "#99ddff", "◠"),
    ("Tulip Jet", "Bell/Dome", 1.0, 0.9, 140, 100, "#aaddff", "❀"),
    ("Fishtail Jet", "Fan Sprays", 1.6, 1.1, 100, 85, "#22aaff", "⋔"),
    ("Dandelion", "Sphere", 2.0, 1.4, 360, 130, "#bbeeff", "✺"),
    ("Sphere Jet", "Sphere", 2.2, 1.5, 360, 140, "#cceeff", "◯"),
    ("Comet Jet", "Vertical Jets", 1.8, 2.6, 5, 95, "#0099ff", "☄"),
    ("Geyser Jet", "Foam Jets", 1.6, 2.8, 15, 220, "#77ccff", "⇈"),
    ("Laminar Jet", "Laminar", 1.1, 3.2, 2, 60, "#55ccff", "│"),
    ("Jumping Jet", "Laminar", 1.3, 2.4, 3, 55, "#44bbff", "⤴"),
    ("Dancing Jet", "Motion", 1.5, 2.0, 8, 90, "#0088ff", "♪"),
    ("Mushroom", "Bell/Dome", 0.7, 0.5, 170, 105, "#a0d8ff", "☂"),
    ("Morning Glory", "Bell/Dome", 0.8, 0.7, 150, 115, "#b0e0ff", "❁"),
    ("Trumpet Jet", "Ring/Crown", 1.2, 1.6, 25, 88, "#00b0ee", "♬"),
    ("Peacock Jet", "Fan Sprays", 1.7, 1.3, 120, 92, "#11a0ff", "⋋"),
    ("Volcano Jet", "Foam Jets", 1.4, 2.0, 22, 210, "#88ccff", "▲"),
    ("Spray Jet", "Fan Sprays", 2.0, 0.9, 90, 70, "#33ccff", "☼"),
    ("Mist Jet", "Mist", 3.0, 0.4, 120, 25, "#ddeeff", "∴"),
]
DN_SIZES = [15, 20, 25, 32, 40, 50, 65, 80]

for name, family, p_bar, hpb, spray, coeff, color, icon in JET_TYPES:
    for dn in DN_SIZES:
        scale = (dn / 25.0) ** 2
        flow = coeff * scale
        pressure = p_bar
        height = hpb * pressure * (0.6 + 0.4 * (dn / 40.0))
        dia = dn * 0.7
        add(
            slug("nozzle", name, f"dn{dn}"),
            "Nozzles", family, f"{name} DN{dn}",
            color if color.startswith("#") and len(color) == 7 else "#00aaff", icon,
            hyd(flow, pressure, height, dia, dn, group=name),
            # Nozzles are switched by a solenoid/actuated valve — that is their
            # electrical interface.
            elec(24, 12, 0, "Modbus/Relay (solenoid valve)", ip="IP68"),
        )


# ── 2) Lighting ────────────────────────────────────────────────────────────────
LIGHT_TYPES = [
    ("Underwater PAR", "Underwater Lights", 30, "★", "#ffddaa"),
    ("Ring Light", "Ring Lights", 40, "◍", "#ffcc66"),
    ("Linear Bar", "Linear Lights", 15, "▬", "#ffee99"),
    ("Spotlight", "Spot Lights", 12, "✦", "#fff0cc"),
    ("Wash Light", "Wash Lights", 45, "◐", "#ffe0aa"),
    ("Pixel Dot", "Pixel Lights", 8, "•", "#ffddff"),
    ("Flood Light", "Flood Lights", 60, "▮", "#fff5cc"),
    ("Wall Washer", "Wash Lights", 25, "▤", "#ffe8bb"),
]
WATTAGES = [9, 18, 24, 36, 54, 72, 100, 144]
COLOR_MODES = [("RGB", 3), ("RGBW", 4)]

for tname, family, beam, icon, color in LIGHT_TYPES:
    for w in WATTAGES:
        for cmode, ch in COLOR_MODES:
            add(
                slug("light", tname, cmode, f"{w}w"),
                "Lights", family, f"{tname} {cmode} {w}W",
                color, icon,
                {  # optically-cooled fixtures still move water for cooling → minimal hydraulic
                    "flowLpm": 0.0, "pressureBar": 0.0, "jetHeightM": 0.0,
                    "nozzleDiaMm": 0.0, "connectionSize": "-", "kFactor": 0.0,
                    "sprayAngleDeg": beam, "material": "SS316/PC", "group": "Lighting",
                    "beamAngleDeg": beam,
                },
                elec(24, w, 0, "DMX/Art-Net", ip="IP68", dmx_ch=ch),
            )


# ── 3) Pumps / VFDs ────────────────────────────────────────────────────────────
PUMP_SERIES = [
    ("Inline VFD Pump", "Inline Pumps", "IP55"),
    ("Submersible VFD Pump", "Submersible Pumps", "IP68"),
    ("End-Suction Pump", "End-Suction Pumps", "IP55"),
]
PUMP_KW = [0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45]

for sname, family, ip in PUMP_SERIES:
    for kw in PUMP_KW:
        w = kw * 1000.0
        # Rough duty: flow ~ 60 L/min per kW, head ~ 2.5 bar typical.
        flow = 60 * kw
        head = 2.5 + 0.05 * kw
        dn = 25 if kw < 3 else 40 if kw < 7.5 else 65 if kw < 18.5 else 100
        add(
            slug("pump", sname, f"{kw}kw"),
            "Pumps", family, f"{sname} {kw} kW",
            "#88aa88", "⊚",
            hyd(flow, head, 0.0, dn, dn, material="Cast Iron/SS316", spray=0, group="Pump"),
            elec(400, w, 3, "Modbus (VFD)", ip=ip),
        )


# ── 4) Valves ──────────────────────────────────────────────────────────────────
VALVE_TYPES = [
    ("Gate Valve", "Isolation Valves", "Modbus/Relay", 40),
    ("Ball Valve", "Isolation Valves", "Modbus/Relay", 30),
    ("Butterfly Valve", "Isolation Valves", "Modbus (actuator)", 60),
    ("Solenoid Valve", "Control Valves", "Relay/Modbus", 15),
    ("Control Valve", "Control Valves", "Modbus/0-10V", 45),
    ("Check Valve", "Check Valves", "Passive", 0),
    ("Needle Valve", "Control Valves", "Manual/Modbus", 10),
    ("Knife Gate Valve", "Isolation Valves", "Modbus (actuator)", 55),
]
VALVE_DN = [15, 25, 40, 50, 80, 100, 150, 200]

for vname, family, proto, act_w in VALVE_TYPES:
    for dn in VALVE_DN:
        # Cv-based flow capacity, pressure drop ~0.3 bar nominal.
        flow = 40 * (dn / 25.0) ** 2
        voltage = 24 if act_w else 0
        phase = 1 if act_w else 0
        add(
            slug("valve", vname, f"dn{dn}"),
            "Valves", family, f"{vname} DN{dn}",
            "#aa8866", "⧗",
            hyd(flow, 0.3, 0.0, dn, dn, material="SS316", spray=0, group="Valve"),
            elec(voltage, act_w, phase, proto, ip="IP67"),
        )


# ── 5) Flame effects ───────────────────────────────────────────────────────────
FLAME_TYPES = [("Line Burner", "Line Flame"), ("Ring Burner", "Ring Flame"),
               ("Jet Burner", "Jet Flame"), ("Fireball Burner", "Fireball")]
FLAME_SIZE = [("S", 0.5, 15), ("M", 1.0, 30), ("L", 2.0, 55), ("XL", 3.5, 90)]
for fname, family in FLAME_TYPES:
    for sz, height, w in FLAME_SIZE:
        add(
            slug("flame", fname, sz),
            "Flame", family, f"{fname} {sz}",
            "#ff5522", "🔥",
            {  # flame gas manifold flow, water-cooled shroud
                "flowLpm": 5.0, "pressureBar": 0.5, "jetHeightM": height,
                "nozzleDiaMm": 12.0, "connectionSize": "DN15",
                "kFactor": round(5.0 / math.sqrt(0.5), 3),
                "sprayAngleDeg": 0, "material": "SS316L", "group": "Flame",
                "gasType": "Propane/LPG",
            },
            elec(24, w, 1, "Modbus (safety-interlocked)", ip="IP65", dmx_ch=1),
        )


# ── 6) Fog / mist machines ─────────────────────────────────────────────────────
FOG_TYPES = [("Mist Ring", "Mist"), ("Fog Jet", "Fog"),
             ("Low Fog Generator", "Low Fog"), ("Haze Machine", "Haze")]
FOG_SIZE = [("Compact", 400), ("Standard", 900), ("Pro", 1500), ("Stadium", 3000)]
for fgname, family in FOG_TYPES:
    for sz, w in FOG_SIZE:
        add(
            slug("fog", fgname, sz),
            "Fog", family, f"{fgname} {sz}",
            "#cccccc", "≈",
            hyd(8.0, 2.0, 0.5, 12, 15, material="SS304", spray=120, group="Fog"),
            elec(230, w, 1, "DMX/Relay", ip="IP54", dmx_ch=2),
        )


# ── 7) Laser projectors ────────────────────────────────────────────────────────
LASER_TYPES = [("RGB Laser", "Full-Colour Laser"), ("Green Laser", "Single-Colour Laser"),
               ("Beam Laser", "Beam Laser")]
LASER_CLASS = [("1W", 40), ("3W", 90), ("5W", 140), ("10W", 260)]
for lname, family in LASER_TYPES:
    for cls, w in LASER_CLASS:
        add(
            slug("laser", lname, cls),
            "Laser", family, f"{lname} {cls}",
            "#22ff88", "✷",
            {"flowLpm": 0.0, "pressureBar": 0.0, "jetHeightM": 0.0, "nozzleDiaMm": 0.0,
             "connectionSize": "-", "kFactor": 0.0, "sprayAngleDeg": 0,
             "material": "Aluminium", "group": "Laser"},
            elec(24, w, 0, "ILDA/DMX (interlocked)", ip="IP65", dmx_ch=8),
        )


# ── 8) Sensors & instrumentation ───────────────────────────────────────────────
SENSORS = [
    ("Level Sensor", "Level", "4-20mA/Modbus"), ("Pressure Transmitter", "Pressure", "4-20mA/Modbus"),
    ("Flow Meter", "Flow", "Modbus/Pulse"), ("Temperature Sensor", "Temperature", "4-20mA"),
    ("pH Sensor", "Water Quality", "Modbus"), ("Turbidity Sensor", "Water Quality", "4-20mA"),
    ("Leak Detector", "Safety", "Relay/Modbus"), ("Wind Sensor", "Environment", "Modbus"),
    ("Conductivity Sensor", "Water Quality", "4-20mA"), ("Chlorine Analyzer", "Water Quality", "Modbus"),
]
for sname, family, proto in SENSORS:
    add(
        slug("sensor", sname),
        "Sensors", family, sname, "#88ccaa", "◈",
        {"flowLpm": 0.0, "pressureBar": 0.0, "jetHeightM": 0.0, "nozzleDiaMm": 0.0,
         "connectionSize": "DN15", "kFactor": 0.0, "sprayAngleDeg": 0,
         "material": "SS316", "group": "Instrumentation"},
        elec(24, 3, 0, proto, ip="IP68"),
    )


# ── 9) Controls, power, filtration, air, water treatment, effects ──────────────
MISC = [
    ("Controls", "PLC Controllers", [
        ("Compact PLC", 24, 25, "Modbus/EtherCAT"), ("Modular PLC", 24, 60, "Modbus/EtherCAT"),
        ("Safety PLC", 24, 40, "Safety Bus"), ("DMX Node 4-Universe", 24, 8, "Art-Net/sACN"),
        ("DMX Node 16-Universe", 24, 15, "Art-Net/sACN"), ("HMI Panel 10in", 24, 30, "Modbus/OPC-UA"),
        ("HMI Panel 15in", 24, 45, "Modbus/OPC-UA"),
    ]),
    ("Power", "Power Supplies", [
        ("PSU 24V 480W", 230, 480, "Relay"), ("PSU 24V 960W", 230, 960, "Relay"),
        ("PSU 48V 1500W", 400, 1500, "Relay"), ("Distribution Panel 63A", 400, 0, "Modbus"),
        ("Distribution Panel 125A", 400, 0, "Modbus"),
    ]),
    ("Filtration", "Filters", [
        ("Sand Filter DN200", 0, 0, "Passive"), ("Cartridge Filter DN100", 0, 0, "Passive"),
        ("Bag Filter DN150", 0, 0, "Passive"), ("Self-Cleaning Filter DN200", 400, 750, "Modbus"),
        ("UV Sterilizer", 230, 320, "Relay/Modbus"),
    ]),
    ("Air Systems", "Air/Compressed", [
        ("Air Compressor 2.2kW", 400, 2200, "Modbus"), ("Air Shooter Valve", 24, 20, "Relay"),
        ("Air Blower 1.5kW", 400, 1500, "Modbus"), ("Air Manifold 8-way", 24, 10, "Relay"),
    ]),
    ("Water Treatment", "Dosing", [
        ("Chlorine Dosing Pump", 230, 60, "Modbus"), ("pH Dosing Pump", 230, 60, "Modbus"),
        ("Ozone Generator", 230, 300, "Relay/Modbus"), ("Flocculant Doser", 230, 45, "Modbus"),
    ]),
    ("Effects", "Special Effects", [
        ("Bubble Generator", 230, 120, "DMX/Relay"), ("Snow Machine", 230, 900, "DMX/Relay"),
        ("Confetti Cannon", 24, 40, "Relay"), ("Cryo Jet CO2", 24, 30, "DMX/Relay"),
        ("Spark Machine", 230, 400, "DMX (interlocked)"), ("Scent Diffuser", 24, 15, "Relay"),
        ("Wind FX Fan", 230, 750, "DMX/0-10V"),
    ]),
    ("Motion Systems", "Actuators", [
        ("1D Linear Actuator", 24, 90, "Modbus/CANopen"), ("2D Pan-Tilt Head", 24, 140, "Modbus/DMX"),
        ("3D Motion Platform", 400, 1100, "Modbus/CANopen"), ("Rotating Nozzle Drive", 24, 60, "Modbus"),
        ("Servo Jet Positioner", 24, 120, "CANopen"),
    ]),
    ("Safety", "Safety Devices", [
        ("Emergency Stop Station", 24, 2, "Safety Bus"), ("Light Curtain", 24, 12, "Safety Bus"),
        ("GFCI Module", 230, 5, "Relay"), ("Water Level Cutoff", 24, 3, "Relay/Modbus"),
    ]),
]
for category, family, items in MISC:
    for label, v, w, proto in items:
        phase = 3 if (v >= 400 and w >= 1000) else (1 if v >= 230 else 0)
        ip = "IP66" if category in ("Controls", "Power", "Safety") else "IP65"
        add(
            slug(category, label),
            category, family, label, "#99aabb", "▣",
            {"flowLpm": 0.0, "pressureBar": 0.0, "jetHeightM": 0.0, "nozzleDiaMm": 0.0,
             "connectionSize": "-", "kFactor": 0.0, "sprayAngleDeg": 0,
             "material": "Steel/Polymer", "group": family},
            elec(v, w, phase, proto, ip=ip),
        )


def main() -> int:
    # De-duplicate by key (defensive).
    seen, unique = set(), []
    for f in fixtures:
        if f["key"] in seen:
            continue
        seen.add(f["key"])
        unique.append(f)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(unique, indent=1))
    cats = sorted({f["category"] for f in unique})
    print(f"Generated {len(unique)} fixtures across {len(cats)} categories -> {OUT}")
    print("Categories:", ", ".join(cats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
