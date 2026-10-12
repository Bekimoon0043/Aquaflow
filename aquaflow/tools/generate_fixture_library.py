"""
generate_fixture_library.py — AquaFlow Stage 2, Priority 11 (AQ-S2-011)

Deterministically generates the expanded AquaFlow fixture library: 500+ fountain
fixtures across all equipment families, each carrying BOTH a hydraulic metadata
block (`engineering`) and an electrical metadata block (`electrical`).

Every generated item is a GENERIC TEMPLATE — there is no manufacturer datasheet
behind it — so each one is flagged `generic: true`, `source: "generic"` and
carries `engineering.dataSource` telling the user to verify against the
supplier datasheet. The numbers are, however, made physically self-consistent:

  * jet height      h = eta * H,  H = p[bar] * 10.197 m,  eta <= 0.9
  * orifice flow    Q[L/min] = Cd * n * (pi/4 * d^2) * sqrt(2 g H) * 60000
  * pump duty       rho * g * Q * H = 45-75 % of the rated motor power
  * K factor        K = Q / sqrt(p)
  * motor current   I = P / (sqrt(3) * V * pf * eff)   (3-phase)
                    I = P / (V * pf * eff)              (1-phase)

Output: frontend/src/data/fixture_library_expanded.json
Run:    py -3.12 tools/generate_fixture_library.py
Check:  py -3.12 tools/validate_fixture_library.py

The generator is fully deterministic (no randomness) so the library is
reproducible and diff-stable. Keys are stable — saved projects reference them.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

OUT = Path(__file__).parent.parent / "frontend" / "src" / "data" / "fixture_library_expanded.json"

G = 9.81
RHO = 1000.0
BAR_TO_M = 10.197
GENERIC_SOURCE = "generic"
GENERIC_NOTE = "AquaFlow generic template — verify with the supplier datasheet"

# Motor-driven loads use typical induction-motor pf / efficiency; lights and
# electronics use pf 0.9 / eff 1.0 (mirrors deriveElectrical() in fixtureLibrary.js).
MOTOR_PF, MOTOR_EFF = 0.85, 0.88


def slug(*parts) -> str:
    s = "_".join(str(p) for p in parts).lower()
    return "".join(c if c.isalnum() or c == "_" else "_" for c in s).strip("_")


def amps(power_w: float, voltage: float, phase: int, pf: float = 0.9, eff: float = 1.0) -> float:
    if power_w <= 0 or voltage <= 0:
        return 0.0
    if phase == 3:
        return round(power_w / (math.sqrt(3) * voltage * pf * eff), 3)
    if phase == 1:
        return round(power_w / (voltage * pf * eff), 3)
    return round(power_w / voltage, 3)   # DC


def head_m(pressure_bar: float) -> float:
    return pressure_bar * BAR_TO_M


def orifice_flow_lpm(dia_mm: float, pressure_bar: float, cd: float, count: int = 1) -> float:
    """Q = Cd * n * A * sqrt(2 g H), in L/min."""
    if dia_mm <= 0 or pressure_bar <= 0:
        return 0.0
    area = math.pi / 4.0 * (dia_mm / 1000.0) ** 2
    return cd * count * area * math.sqrt(2 * G * head_m(pressure_bar)) * 60000.0


def jet_height(pressure_bar: float, eta: float) -> float:
    return min(eta, 0.9) * head_m(pressure_bar)


def hyd(flow_lpm, pressure_bar, jet_h, dia_mm, dn, material="SS316", spray=90, group="",
        cd=None, eta=None, count=None, conn=None):
    k = round(flow_lpm / math.sqrt(pressure_bar), 3) if pressure_bar > 0 and flow_lpm > 0 else 0.0
    out = {
        "flowLpm": round(flow_lpm, 2),
        "pressureBar": round(pressure_bar, 3),
        "jetHeightM": round(jet_h, 2),
        "nozzleDiaMm": round(dia_mm, 2),
        "connectionSize": conn if conn is not None else f"DN{dn}",
        "kFactor": k,
        "sprayAngleDeg": spray,
        "material": material,
        "group": group,
    }
    if cd is not None:
        out["dischargeCoeff"] = cd
    if eta is not None:
        out["heightEfficiency"] = eta
    if count is not None and count > 1:
        out["orificeCount"] = count
    return out


def no_water(material, group, conn="-", spray=0, **extra):
    """Hydraulic block for equipment that moves no water (keys kept for schema)."""
    out = {"flowLpm": 0.0, "pressureBar": 0.0, "jetHeightM": 0.0, "nozzleDiaMm": 0.0,
           "connectionSize": conn, "kFactor": 0.0, "sprayAngleDeg": spray,
           "material": material, "group": group}
    out.update(extra)
    return out


def elec(voltage, power_w, phase, protocol, ip="IP68", dmx_ch=0, motor=False):
    if voltage >= 380 and phase:
        phase = 3          # never a 400 V single-phase load
    pf, eff = (MOTOR_PF, MOTOR_EFF) if motor else (0.9, 1.0)
    out = {
        "voltageV": voltage,
        "powerW": round(power_w, 1),
        "currentA": amps(power_w, voltage, phase, pf, eff),
        "phase": phase,
        "controlProtocol": protocol,
        "dmxChannels": dmx_ch,
        "ipRating": ip,
    }
    if motor:
        out["powerFactor"] = pf
        out["efficiency"] = eff
    return out


fixtures: list[dict] = []


def add(key, category, family, label, color, icon, engineering, electrical):
    engineering = dict(engineering)
    engineering["dataSource"] = GENERIC_NOTE
    fixtures.append({
        "key": key, "category": category, "family": family, "label": label,
        "color": color, "icon": icon,
        "source": GENERIC_SOURCE, "generic": True,
        "engineering": engineering, "electrical": electrical,
    })


# ── 1) Water jets / nozzles ────────────────────────────────────────────────────
# (name, family, base_pressure_bar@DN15, eta, Cd, orifice/DN ratio, spray_angle, color, icon)
#   eta  — effective-height factor h/H (straight/laminar ~0.8-0.85, geyser/foam
#          ~0.6-0.7, fan/arch/ring ~0.5-0.6; bells, spheres and cascades are low
#          by design)
#   Cd   — discharge coefficient of the equivalent orifice
# The orifice is an EQUIVALENT circular diameter (annular / slot / multi-tube
# outlets expressed as one area), sized so the feed-pipe velocity stays below
# ~3.5 m/s.
JET_TYPES = [
    ("Straight Jet", "Vertical Jets", 1.0, 0.80, 0.93, 0.40, 6, "#00aaff", "↑"),
    ("Aerated Jet", "Aerated Jets", 1.2, 0.70, 0.75, 0.45, 12, "#66ccff", "❋"),
    ("Foam Jet", "Foam Jets", 0.8, 0.65, 0.70, 0.50, 20, "#cceeff", "☁"),
    ("Cascade Jet", "Cascade", 0.6, 0.30, 0.62, 0.55, 30, "#88ddff", "≋"),
    ("Fan Spray", "Fan Sprays", 1.5, 0.50, 0.80, 0.35, 110, "#33bbff", "⟩"),
    ("Ring Jet", "Ring/Crown", 1.3, 0.60, 0.85, 0.35, 8, "#00bbee", "◍"),
    ("Crown Jet", "Ring/Crown", 1.4, 0.60, 0.85, 0.35, 10, "#00ccee", "♛"),
    ("Bell Jet", "Bell/Dome", 0.9, 0.25, 0.85, 0.40, 160, "#99ddff", "◠"),
    ("Tulip Jet", "Bell/Dome", 1.0, 0.35, 0.85, 0.40, 140, "#aaddff", "❀"),
    ("Fishtail Jet", "Fan Sprays", 1.6, 0.50, 0.80, 0.35, 100, "#22aaff", "⋔"),
    ("Dandelion", "Sphere", 2.0, 0.15, 0.80, 0.35, 360, "#bbeeff", "✺"),
    ("Sphere Jet", "Sphere", 2.2, 0.15, 0.80, 0.35, 360, "#cceeff", "◯"),
    ("Comet Jet", "Vertical Jets", 1.8, 0.80, 0.90, 0.35, 5, "#0099ff", "☄"),
    ("Geyser Jet", "Foam Jets", 1.6, 0.65, 0.70, 0.45, 15, "#77ccff", "⇈"),
    ("Laminar Jet", "Laminar", 1.1, 0.85, 0.95, 0.35, 2, "#55ccff", "│"),
    ("Jumping Jet", "Laminar", 1.3, 0.80, 0.95, 0.35, 3, "#44bbff", "⤴"),
    ("Dancing Jet", "Motion", 1.5, 0.75, 0.90, 0.35, 8, "#0088ff", "♪"),
    ("Mushroom", "Bell/Dome", 0.7, 0.20, 0.85, 0.45, 170, "#a0d8ff", "☂"),
    ("Morning Glory", "Bell/Dome", 0.8, 0.25, 0.85, 0.45, 150, "#b0e0ff", "❁"),
    ("Trumpet Jet", "Ring/Crown", 1.2, 0.60, 0.85, 0.35, 25, "#00b0ee", "♬"),
    ("Peacock Jet", "Fan Sprays", 1.7, 0.50, 0.80, 0.35, 120, "#11a0ff", "⋋"),
    ("Volcano Jet", "Foam Jets", 1.4, 0.60, 0.70, 0.45, 22, "#88ccff", "▲"),
    ("Spray Jet", "Fan Sprays", 2.0, 0.45, 0.80, 0.30, 90, "#33ccff", "☼"),
]
DN_SIZES = [15, 20, 25, 32, 40, 50, 65, 80]


def jet_pressure(base_bar: float, dn: int) -> float:
    # Bigger jets are run at higher pressure for taller effects.
    return base_bar * (1.0 + 0.25 * math.log2(dn / 15.0))


def size_eta(eta: float, dn: int) -> float:
    # Larger jets lose relatively less height to air drag / break-up.
    return min(0.9, eta * (0.9 + 0.1 * min(dn, 50) / 50.0))


for name, family, p_bar, eta, cd, ratio, spray, color, icon in JET_TYPES:
    for dn in DN_SIZES:
        pressure = round(jet_pressure(p_bar, dn), 3)
        e = round(size_eta(eta, dn), 3)
        dia = round(ratio * dn, 1)
        add(
            slug("nozzle", name, f"dn{dn}"),
            "Nozzles", family, f"{name} DN{dn}",
            color if color.startswith("#") and len(color) == 7 else "#00aaff", icon,
            hyd(orifice_flow_lpm(dia, pressure, cd), pressure, jet_height(pressure, e), dia, dn,
                group=name, spray=spray, cd=cd, eta=e),
            # Nozzles are switched by a solenoid/actuated valve — that is their
            # electrical interface.
            elec(24, 12, 0, "Modbus/Relay (solenoid valve)", ip="IP68"),
        )

# Mist heads: clusters of 1 mm orifices on a 5 bar feed. The "height" is the
# spray-cloud height, not a jet.
MIST_P, MIST_ETA, MIST_CD, MIST_D = 5.0, 0.05, 0.70, 1.0
for dn in DN_SIZES:
    count = max(4, round(4 * (dn / 15.0) ** 2))
    add(
        slug("nozzle", "Mist Jet", f"dn{dn}"),
        "Nozzles", "Mist", f"Mist Jet DN{dn}", "#ddeeff", "∴",
        hyd(orifice_flow_lpm(MIST_D, MIST_P, MIST_CD, count), MIST_P,
            jet_height(MIST_P, MIST_ETA), MIST_D, dn, group="Mist Jet", spray=120,
            cd=MIST_CD, eta=MIST_ETA, count=count),
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
                no_water("SS316/PC", "Lighting", spray=beam, beamAngleDeg=beam,
                         colorMode=cmode, dmxChannels=ch),
                elec(24, w, 0, "DMX/Art-Net", ip="IP68", dmx_ch=ch),
            )


# ── 3) Pumps / VFDs ────────────────────────────────────────────────────────────
# Duty point from the motor rating: head rises with size per series, overall
# (wire-to-water) efficiency rises from ~50 % (0.75 kW) to ~65 % (45 kW), and
# flow follows from rho*g*Q*H = eta*P.
PUMP_SERIES = [
    # (name, family, ip, head = a + b*sqrt(kW) [m])
    ("Inline VFD Pump", "Inline Pumps", "IP55", 12.0, 6.0),
    ("Submersible VFD Pump", "Submersible Pumps", "IP68", 8.0, 5.0),
    ("End-Suction Pump", "End-Suction Pumps", "IP55", 15.0, 7.0),
]
PUMP_KW = [0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45]
PIPE_DN = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200]


def pump_efficiency(kw: float) -> float:
    frac = min(1.0, max(0.0, math.log(kw / 0.75) / math.log(60.0)))
    return 0.50 + 0.15 * frac


def pick_dn(flow_m3s: float, vmax: float = 3.0) -> int:
    for dn in PIPE_DN:
        if flow_m3s / (math.pi / 4 * (dn / 1000.0) ** 2) <= vmax:
            return dn
    return PIPE_DN[-1]


for sname, family, ip, h_a, h_b in PUMP_SERIES:
    for kw in PUMP_KW:
        w = kw * 1000.0
        head = round(h_a + h_b * math.sqrt(kw), 1)
        eff = pump_efficiency(kw)
        q_m3s = eff * w / (RHO * G * head)
        flow_lpm = q_m3s * 60000.0
        dn = pick_dn(q_m3s)
        eng = hyd(flow_lpm, head / BAR_TO_M, 0.0, 0.0, dn, material="Cast Iron/SS316",
                  spray=0, group="Pump")
        eng.update({
            "flowM3Hr": round(flow_lpm * 0.06, 2),
            "headM": head,
            "powerKw": kw,
            "pumpEfficiency": round(eff, 3),
        })
        add(
            slug("pump", sname, f"{kw}kw"),
            "Pumps", family, f"{sname} {kw} kW",
            "#88aa88", "⊚",
            eng,
            elec(400, w, 3, "Modbus (VFD)", ip=ip, motor=True),
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
        # Rated flow capacity at a nominal 0.3 bar pressure drop (pressureBar
        # here is the DROP across the valve, not the line pressure).
        flow = 40 * (dn / 25.0) ** 2
        voltage = 24 if act_w else 0
        eng = hyd(flow, 0.3, 0.0, dn, dn, material="SS316", spray=0, group="Valve")
        eng.update({"pressureDropBar": 0.3, "pressureRatingBar": 16})
        add(
            slug("valve", vname, f"dn{dn}"),
            "Valves", family, f"{vname} DN{dn}",
            "#aa8866", "⧗",
            eng,
            # 24 V actuators are DC.
            elec(voltage, act_w, 0, proto, ip="IP67"),
        )


# ── 5) Flame effects ───────────────────────────────────────────────────────────
# Gas burners move NO water: the gas supply is described by gasFlowLpm /
# gasPressureBar; jetHeightM carries the nominal flame height for the preview.
FLAME_TYPES = [("Line Burner", "Line Flame"), ("Ring Burner", "Ring Flame"),
               ("Jet Burner", "Jet Flame"), ("Fireball Burner", "Fireball")]
FLAME_SIZE = [("S", 0.5, 15, 5.0), ("M", 1.0, 30, 10.0), ("L", 2.0, 55, 20.0), ("XL", 3.5, 90, 35.0)]
for fname, family in FLAME_TYPES:
    for sz, height, w, gas_lpm in FLAME_SIZE:
        add(
            slug("flame", fname, sz),
            "Flame", family, f"{fname} {sz}",
            "#ff5522", "🔥",
            no_water("SS316L", "Flame", conn="DN15", jetHeightM=height, flameHeightM=height,
                     gasType="Propane/LPG", gasFlowLpm=gas_lpm, gasPressureBar=0.5,
                     heightBasis="flame"),
            # Safety-interlocked PLC control — flame is never on a DMX universe.
            elec(24, w, 0, "Modbus (safety-interlocked)", ip="IP65"),
        )


# ── 6) Fog / mist machines ─────────────────────────────────────────────────────
# Mist Ring / Fog Jet: self-contained 70 bar high-pressure water fog units
# (0.2 mm orifices, built-in plunger pump sized at ~55 % wire-to-water).
# Low Fog / Haze: fluid-based machines — no water connection.
HP_BAR, HP_D, HP_CD = 70.0, 0.2, 0.70
FOG_SIZE = [("Compact", 12), ("Standard", 24), ("Pro", 48), ("Stadium", 96)]
FLUID_SIZE = {"Compact": 400, "Standard": 900, "Pro": 1500, "Stadium": 3000}
for fgname, family in [("Mist Ring", "Mist"), ("Fog Jet", "Fog")]:
    for sz, count in FOG_SIZE:
        flow = orifice_flow_lpm(HP_D, HP_BAR, HP_CD, count)
        hyd_w = HP_BAR * 1e5 * flow / 60000.0
        power = round(hyd_w / 0.55, -1)
        eng = hyd(flow, HP_BAR, min(3.0, 0.5 + count / 48.0), HP_D, 15, material="SS304",
                  spray=120, group="Fog", cd=HP_CD, count=count, conn="DN10")
        eng["heightBasis"] = "cloud"
        add(
            slug("fog", fgname, sz),
            "Fog", family, f"{fgname} {sz}",
            "#cccccc", "≈",
            eng,
            elec(230, power, 1, "DMX/Relay", ip="IP54", dmx_ch=2, motor=True),
        )
for fgname, family in [("Low Fog Generator", "Low Fog"), ("Haze Machine", "Haze")]:
    for sz, _count in FOG_SIZE:
        add(
            slug("fog", fgname, sz),
            "Fog", family, f"{fgname} {sz}",
            "#cccccc", "≈",
            no_water("SS304", "Fog", spray=120, fluid="Fog/haze fluid"),
            elec(230, FLUID_SIZE[sz], 1, "DMX/Relay", ip="IP54", dmx_ch=2),
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
            no_water("Aluminium", "Laser", dmxChannels=8),
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
        no_water("SS316", "Instrumentation", conn="DN15"),
        elec(24, 3, 0, proto, ip="IP68"),
    )


# ── 9) Controls, power, filtration, air, water treatment, effects ──────────────
# (label, voltage, watts, protocol[, dmx channels])
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
        # Label carries the supply so it never collides with the curated
        # single-phase "Air Compressor 2.2kW (1-phase)".
        ("Air Compressor 2.2kW (3-phase)", 400, 2200, "Modbus"), ("Air Shooter Valve", 24, 20, "Relay"),
        ("Air Blower 1.5kW", 400, 1500, "Modbus"), ("Air Manifold 8-way", 24, 10, "Relay"),
    ]),
    ("Water Treatment", "Dosing", [
        ("Chlorine Dosing Pump", 230, 60, "Modbus"), ("pH Dosing Pump", 230, 60, "Modbus"),
        ("Ozone Generator", 230, 300, "Relay/Modbus"), ("Flocculant Doser", 230, 45, "Modbus"),
    ]),
    ("Effects", "Special Effects", [
        ("Bubble Generator", 230, 120, "DMX/Relay", 1), ("Snow Machine", 230, 900, "DMX/Relay", 2),
        ("Confetti Cannon", 24, 40, "Relay"), ("Cryo Jet CO2", 24, 30, "DMX/Relay", 1),
        ("Spark Machine", 230, 400, "DMX (interlocked)", 2), ("Scent Diffuser", 24, 15, "Relay"),
        ("Wind FX Fan", 230, 750, "DMX/0-10V", 1),
    ]),
    ("Motion Systems", "Actuators", [
        ("1D Linear Actuator", 24, 90, "Modbus/CANopen"), ("2D Pan-Tilt Head", 24, 140, "Modbus/DMX", 4),
        ("3D Motion Platform", 400, 1100, "Modbus/CANopen"), ("Rotating Nozzle Drive", 24, 60, "Modbus"),
        ("Servo Jet Positioner", 24, 120, "CANopen"),
    ]),
    ("Safety", "Safety Devices", [
        ("Emergency Stop Station", 24, 2, "Safety Bus"), ("Light Curtain", 24, 12, "Safety Bus"),
        ("GFCI Module", 230, 5, "Relay"), ("Water Level Cutoff", 24, 3, "Relay/Modbus"),
    ]),
]
MOTOR_WORDS = ("compressor", "blower", "pump", "fan", "motion platform")
for category, family, items in MISC:
    for item in items:
        label, v, w, proto = item[:4]
        dmx_ch = item[4] if len(item) > 4 else 0
        # 380/400 V supplies are 3-phase; 230 V is single-phase; 24 V is DC.
        phase = 3 if v >= 380 else (1 if v >= 200 else 0)
        motor = any(word in label.lower() for word in MOTOR_WORDS) and v >= 200
        ip = "IP66" if category in ("Controls", "Power", "Safety") else "IP65"
        # Keep the historical key (projects reference it) even though the
        # label now carries the supply.
        key_label = "Air Compressor 2.2kW" if label.startswith("Air Compressor 2.2kW") else label
        extra = {"dmxChannels": dmx_ch} if dmx_ch else {}
        add(
            slug(category, key_label),
            category, family, label, "#99aabb", "▣",
            no_water("Steel/Polymer", family, **extra),
            elec(v, w, phase, proto, ip=ip, dmx_ch=dmx_ch, motor=motor),
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
