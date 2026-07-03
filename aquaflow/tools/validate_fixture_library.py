"""
validate_fixture_library.py — AquaFlow Stage 2, Priority 11 (AQ-S2-011)

Proves the three acceptance criteria for the fixture library expansion:
  1. Minimum 500 fixtures.
  2. Hydraulic metadata included (on every fixture).
  3. Electrical metadata included (on every fixture).

Validates the generated JSON (frontend/src/data/fixture_library_expanded.json).
Exit code 0 = all pass.

Run:  python tools/validate_fixture_library.py
"""
import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

JSON_FILE = Path(__file__).parent.parent / "frontend" / "src" / "data" / "fixture_library_expanded.json"

HYDRAULIC_KEYS = {"flowLpm", "pressureBar", "jetHeightM", "nozzleDiaMm", "connectionSize", "kFactor"}
ELECTRICAL_KEYS = {"voltageV", "powerW", "currentA", "phase", "controlProtocol", "ipRating"}

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


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

    # breadth: multiple categories
    cats = {f["category"] for f in fixtures}
    check("Fixtures span many categories", len(cats) >= 10, f"{len(cats)} categories")

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
    print(f"{passed}/{len(results)} checks passed  |  library size: {len(fixtures)} fixtures, "
          f"{len(cats)} categories")
    print("=" * 72)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
