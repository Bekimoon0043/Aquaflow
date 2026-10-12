"""
validate_fixture_library.py — AquaFlow Stage 2, Priority 11 (AQ-S2-011)

Proves the three acceptance criteria for the fixture library expansion:
  1. Minimum 500 fixtures.
  2. Hydraulic metadata included (on every fixture).
  3. Electrical metadata included (on every fixture).

Plus the physics / honesty invariants (library audit fix):
  * every item is flagged generic (source "generic", generic: true, dataSource note)
  * water-jet height <= 0.9 * pressure head  (h <= 0.9 * p[bar] * 10.197 m)
  * orifice flow consistency  Q ~= Cd * n * A * sqrt(2 g H) * 60000  (within 10 %)
  * pump wire-to-water efficiency rho*g*Q*H / P in 45-75 %
  * flowLpm and flowM3Hr agree when both are present; headM agrees with pressureBar
  * no duplicate labels
  * motor current I = P/(sqrt3*V*pf*eff) / P/(V*pf*eff); no 400 V single-phase loads

Validates the generated JSON (frontend/src/data/fixture_library_expanded.json).
Exit code 0 = all pass.

Run:  python tools/validate_fixture_library.py
"""
import json
import math
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

JSON_FILE = Path(__file__).parent.parent / "frontend" / "src" / "data" / "fixture_library_expanded.json"

HYDRAULIC_KEYS = {"flowLpm", "pressureBar", "jetHeightM", "nozzleDiaMm", "connectionSize", "kFactor"}
ELECTRICAL_KEYS = {"voltageV", "powerW", "currentA", "phase", "controlProtocol", "ipRating"}

G = 9.81
BAR_TO_M = 10.197
ORIFICE_TOL = 0.10
PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


def physics_checks(fixtures, tag=""):
    """Physics / honesty invariants. Run on the generated JSON and, when Node is
    available, on the merged curated + generated FIXTURE_LIBRARY."""
    def check(name, ok, detail=""):
        results.append((f"{tag}{name}", PASS if ok else FAIL, detail))

    # ── honesty: every item is a generic template ───────────────────────────
    not_generic = [f["key"] for f in fixtures
                   if f.get("generic") is not True or f.get("source") != "generic"
                   or "datasheet" not in str((f.get("engineering") or {}).get("dataSource", ""))]
    check("Every fixture is flagged generic with a datasheet note", not not_generic,
          f"{len(not_generic)} unflagged (e.g. {not_generic[:3]})")

    labels = {}
    for f in fixtures:
        labels.setdefault(f.get("label"), []).append(f["key"])
    dup_labels = {l: k for l, k in labels.items() if len(k) > 1}
    check("No duplicate labels", not dup_labels, f"{len(dup_labels)} duplicated (e.g. {list(dup_labels)[:3]})")

    no_plc = [f["key"] for f in fixtures if "plcChannel" in (f.get("engineering") or {})]
    check("No per-type plcChannel defaults", not no_plc, f"{len(no_plc)} carry plcChannel")

    # ── water physics ──────────────────────────────────────────────────────
    nozzles = [f for f in fixtures if f["category"] == "Nozzles"]
    bad_height, bad_orifice = [], []
    for f in nozzles:
        eng = f["engineering"]
        p, h = float(eng.get("pressureBar", 0)), float(eng.get("jetHeightM", 0))
        head = p * BAR_TO_M
        if eng.get("heightBasis") not in ("fall",) and h > 0.9 * head + 1e-6:
            bad_height.append(f"{f['key']} h={h} head={head:.2f}")
        d, q = float(eng.get("nozzleDiaMm", 0)), float(eng.get("flowLpm", 0))
        if d > 0 and p > 0:
            cd = float(eng.get("dischargeCoeff", 0) or 0)
            n = int(eng.get("orificeCount", 1) or 1)
            if not 0.55 <= cd <= 0.98:
                bad_orifice.append(f"{f['key']} Cd={cd}")
                continue
            q_ref = cd * n * math.pi / 4 * (d / 1000) ** 2 * math.sqrt(2 * G * head) * 60000
            if abs(q - q_ref) > ORIFICE_TOL * q_ref:
                bad_orifice.append(f"{f['key']} Q={q} orifice={q_ref:.1f}")
    check("Jet height <= 0.9 x pressure head (all nozzles)", not bad_height,
          f"{len(bad_height)} violate (e.g. {bad_height[:3]})")
    check("Nozzle flow matches orifice equation within 10 %", not bad_orifice,
          f"{len(bad_orifice)} inconsistent (e.g. {bad_orifice[:3]})")

    # Fog units with water orifices follow the same orifice law.
    bad_fog = []
    for f in fixtures:
        eng = f["engineering"]
        if f["category"] == "Fog" and eng.get("flowLpm", 0) > 0:
            cd, n = eng.get("dischargeCoeff", 0), eng.get("orificeCount", 1)
            head = eng["pressureBar"] * BAR_TO_M
            q_ref = cd * n * math.pi / 4 * (eng["nozzleDiaMm"] / 1000) ** 2 * math.sqrt(2 * G * head) * 60000
            if not q_ref or abs(eng["flowLpm"] - q_ref) > ORIFICE_TOL * q_ref:
                bad_fog.append(f["key"])
    check("High-pressure fog flow matches orifice equation", not bad_fog,
          f"{len(bad_fog)} inconsistent (e.g. {bad_fog[:3]})")

    # ── pumps ──────────────────────────────────────────────────────────────
    bad_pump = []
    for f in fixtures:
        if f["category"] != "Pumps":
            continue
        eng = f["engineering"]
        q_m3s = float(eng.get("flowM3Hr", 0)) / 3600.0
        head = float(eng.get("headM", 0))
        kw = float(eng.get("powerKw", 0)) or float(f["electrical"].get("powerW", 0)) / 1000.0
        eff = 1000 * G * q_m3s * head / (kw * 1000) if kw > 0 else 0
        if not 0.45 <= eff <= 0.75:
            bad_pump.append(f"{f['key']} eff={eff:.2f}")
    check("Pump hydraulic power is 45-75 % of motor kW", not bad_pump,
          f"{len(bad_pump)} out of range (e.g. {bad_pump[:3]})")

    # ── unit self-consistency ──────────────────────────────────────────────
    bad_units = []
    for f in fixtures:
        eng = f["engineering"]
        if "flowLpm" in eng and "flowM3Hr" in eng:
            if abs(float(eng["flowLpm"]) * 0.06 - eng["flowM3Hr"]) > 0.02 * max(eng["flowM3Hr"], 0.01) + 0.01:
                bad_units.append(f"{f['key']} flowLpm/flowM3Hr")
        if "headM" in eng and eng.get("pressureBar", 0) > 0:
            if abs(eng["pressureBar"] * BAR_TO_M - eng["headM"]) > 0.02 * eng["headM"] + 0.05:
                bad_units.append(f"{f['key']} headM/pressureBar")
    check("flowLpm/flowM3Hr and headM/pressureBar agree", not bad_units,
          f"{len(bad_units)} inconsistent (e.g. {bad_units[:3]})")

    # ── electrical ─────────────────────────────────────────────────────────
    bad_elec = []
    for f in fixtures:
        e = f["electrical"]
        v, p, ph = e["voltageV"], e["powerW"], e["phase"]
        if v >= 380 and ph == 1:
            bad_elec.append(f"{f['key']} 400V 1-phase")
            continue
        if p > 0 and v > 0:
            pf, eff = e.get("powerFactor", 0.9), e.get("efficiency", 1.0)
            ref = p / (math.sqrt(3) * v * pf * eff) if ph == 3 else p / (v * pf * eff) if ph == 1 else p / v
            if abs(e["currentA"] - ref) > 0.01 * ref + 0.002:
                bad_elec.append(f"{f['key']} I={e['currentA']} ref={ref:.3f}")
    check("Currents follow P/(sqrt3*V*pf*eff); no 400 V single-phase", not bad_elec,
          f"{len(bad_elec)} inconsistent (e.g. {bad_elec[:3]})")

    bad_dmx = [f["key"] for f in fixtures
               if "DMX" in f["electrical"]["controlProtocol"] and f["category"] in ("Lights", "Laser", "Fog")
               and not f["electrical"].get("dmxChannels")]
    for f in fixtures:
        if f["category"] != "Lights":
            continue
        ch = f["electrical"].get("dmxChannels")
        ok = 12 <= (ch or 0) <= 16 if "moving_head" in f["key"] else ch in (1, 3, 4)
        if not ok:
            bad_dmx.append(f"{f['key']} ch={ch}")
    check("DMX-controlled lights/lasers/fog declare a channel footprint", not bad_dmx,
          f"{len(bad_dmx)} inconsistent (e.g. {bad_dmx[:3]})")



def load_merged_library():
    """Dump the merged FIXTURE_LIBRARY (curated + generated, normalized) via
    vite-node. Returns None when Node / the frontend deps are unavailable."""
    import shutil
    import subprocess
    import tempfile
    frontend = JSON_FILE.parent.parent.parent
    runner = frontend / "node_modules" / "vite-node" / "vite-node.mjs"
    node = shutil.which("node")
    if not node or not runner.exists():
        return None
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "dump_fixture_library.mjs"
        script.write_text(
            'import { FIXTURE_LIBRARY } from "/src/data/fixtureLibrary.js";\n'
            'process.stdout.write("@@LIB@@" + JSON.stringify(FIXTURE_LIBRARY));\n',
            encoding="utf-8")
        try:
            out = subprocess.run([node, str(runner), str(script)], cwd=str(frontend),
                                 capture_output=True, text=True, encoding="utf-8", timeout=120)
        except Exception:
            return None
    if "@@LIB@@" not in out.stdout:
        return None
    return json.loads(out.stdout.split("@@LIB@@", 1)[1])


def main() -> int:
    fixtures = json.loads(JSON_FILE.read_text())

    # 1) count
    check("Minimum 500 fixtures", len(fixtures) >= 500, f"count={len(fixtures)}")

    # unique keys
    keys = [f.get("key") for f in fixtures]
    check("All fixture keys are unique and present",
          len(keys) == len(set(keys)) and all(keys),
          f"unique={len(set(keys))} total={len(keys)}")

    # 2) hydraulic metadata on every fixture
    missing_hyd = [f["key"] for f in fixtures
                   if not HYDRAULIC_KEYS <= set((f.get("engineering") or {}).keys())]
    check("Hydraulic metadata present on every fixture", not missing_hyd,
          f"missing on {len(missing_hyd)} (e.g. {missing_hyd[:3]})")

    # 3) electrical metadata on every fixture
    missing_elec = [f["key"] for f in fixtures
                    if not ELECTRICAL_KEYS <= set((f.get("electrical") or {}).keys())]
    check("Electrical metadata present on every fixture", not missing_elec,
          f"missing on {len(missing_elec)} (e.g. {missing_elec[:3]})")

    # electrical values are internally consistent (I ≈ P/(V·pf) etc. — just sanity)
    bad_current = []
    for f in fixtures:
        e = f["electrical"]
        if e["powerW"] > 0 and e["voltageV"] > 0 and e["currentA"] <= 0:
            bad_current.append(f["key"])
    check("Powered fixtures have a non-zero computed current", not bad_current,
          f"{len(bad_current)} powered fixtures with zero current")

    # kFactor consistency for water fixtures (Q = K*sqrt(P))
    bad_k = []
    for f in fixtures:
        eng = f["engineering"]
        if eng.get("flowLpm", 0) > 0 and eng.get("pressureBar", 0) > 0:
            k = eng["flowLpm"] / (eng["pressureBar"] ** 0.5)
            if abs(k - eng.get("kFactor", 0)) > 0.5:
                bad_k.append(f["key"])
    check("Water fixtures have a consistent K factor (Q=K√P)", not bad_k,
          f"{len(bad_k)} inconsistent (e.g. {bad_k[:3]})")

    physics_checks(fixtures)

    # breadth: multiple categories
    cats = {f["category"] for f in fixtures}
    check("Fixtures span many categories", len(cats) >= 10, f"{len(cats)} categories")

    merged = load_merged_library()
    if merged is None:
        print("[SKIP] merged curated+generated library check (node / vite-node unavailable)")
    else:
        check("[merged] library size >= 500", len(merged) >= 500, f"count={len(merged)}")
        physics_checks(merged, "[merged] ")

    print("\n" + "=" * 72)
    print("AQ-S2-011 Fixture Library Expansion — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    print("-" * 72)
    merged_note = f", merged library {len(merged)}" if merged is not None else ""
    print(f"{passed}/{len(results)} checks passed  |  generated: {len(fixtures)} fixtures, "
          f"{len(cats)} categories{merged_note}")
    print("=" * 72)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
