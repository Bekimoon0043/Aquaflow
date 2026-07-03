"""
validate_nozzle_database.py — AquaFlow Stage 2, Priority 5 (AQ-S2-005)

Proves the three acceptance criteria for the nozzle performance database:
  1. Stores K factors.
  2. Supports pressure-flow interpolation (across tabulated catalog curves).
  3. Supports manufacturer catalogs (multiple, loadable, queryable).

Each result is cross-checked against an independent hand calculation of the
orifice law Q = K*sqrt(P) and of the sqrt-domain interpolation. No server.
Exit code 0 = all pass.

Run:  python validate_nozzle_database.py
"""
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.nozzle_database import NozzleModel, NozzleDatabase

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


# ── Criterion 1: stores K factors ──────────────────────────────────────────────
def test_stores_k_factor():
    db = NozzleDatabase(load_defaults=False)
    db.add_model(NozzleModel(id="N1", manufacturer="Acme", model="Jet-10", k_factor=10.0))
    m = db.get("N1")
    check("K factor: stored and retrievable", m is not None and m.k_factor == 10.0,
          f"k={getattr(m, 'k_factor', None)}")
    check("K factor: effective_k returns the stored value",
          m.effective_k() == 10.0, f"eff={m.effective_k()}")

    # Q = K sqrt(P): at P=4 bar → Q = 10*2 = 20 L/min.
    q = m.flow_at_pressure(4.0)
    check("K factor: flow follows Q = K*sqrt(P)", abs(q - 20.0) < 1e-9, f"Q={q}")
    # Inverse: pressure for Q=30 → (30/10)^2 = 9 bar.
    p = m.pressure_at_flow(30.0)
    check("K factor: inverse pressure_at_flow = (Q/K)^2", abs(p - 9.0) < 1e-9, f"P={p}")


# ── Criterion 1b: derive K from a catalog curve ────────────────────────────────
def test_derive_k_from_points():
    # Points exactly on Q = 12*sqrt(P): (1,12),(4,24),(9,36).
    m = NozzleModel(id="N2", manufacturer="Acme", model="Fit-12",
                    pressure_flow_points=[
                        {"pressure": 1, "flow": 12}, {"pressure": 4, "flow": 24},
                        {"pressure": 9, "flow": 36}])
    check("Derived K: least-squares fit recovers K=12",
          abs(m.effective_k() - 12.0) < 1e-6, f"K={m.effective_k()}")


# ── Criterion 2: pressure-flow interpolation ───────────────────────────────────
def test_interpolation():
    # Ideal points on Q = 10*sqrt(P): P=1,4,9 → Q=10,20,30.
    m = NozzleModel(id="N3", manufacturer="Acme", model="Interp",
                    pressure_flow_points=[
                        {"pressure": 1, "flow": 10}, {"pressure": 4, "flow": 20},
                        {"pressure": 9, "flow": 30}])
    # At an exact catalog point → exact value.
    check("Interp: returns exact value at a catalog point",
          abs(m.flow_at_pressure(4.0) - 20.0) < 1e-9, f"Q={m.flow_at_pressure(4.0)}")
    # Between points, sqrt-domain interpolation is exact for an ideal nozzle:
    # P=2.25 → sqrt=1.5 → Q=15.
    check("Interp: sqrt-domain interpolation matches hand calc (P=2.25 → 15)",
          abs(m.flow_at_pressure(2.25) - 15.0) < 1e-9, f"Q={m.flow_at_pressure(2.25)}")
    # Monotonic increasing with pressure.
    qs = [m.flow_at_pressure(p) for p in (1, 2, 3, 5, 8)]
    check("Interp: flow increases monotonically with pressure",
          all(a < b for a, b in zip(qs, qs[1:])), f"qs={qs}")

    # Non-ideal (off-K) points → plain linear-in-sqrt between the two bracketing
    # points. Points (1,10),(4,25): at P=2.25 (sqrt=1.5), t=(1.5-1)/(2-1)=0.5 →
    # Q = 10 + 0.5*(25-10) = 17.5.
    m2 = NozzleModel(id="N4", manufacturer="Acme", model="OffK",
                     pressure_flow_points=[{"pressure": 1, "flow": 10},
                                           {"pressure": 4, "flow": 25}])
    check("Interp: non-ideal curve interpolates linearly in sqrt(P) (→17.5)",
          abs(m2.flow_at_pressure(2.25) - 17.5) < 1e-9, f"Q={m2.flow_at_pressure(2.25)}")
    # Inverse round-trip on the interpolated curve.
    p_rt = m2.pressure_at_flow(17.5)
    check("Interp: pressure_at_flow round-trips (→2.25)", abs(p_rt - 2.25) < 1e-6, f"P={p_rt}")

    # Jet-height interpolation from a catalog that provides it.
    m3 = NozzleModel(id="N5", manufacturer="Acme", model="Height",
                     pressure_flow_points=[
                         {"pressure": 1, "flow": 20, "jet_height": 2.0},
                         {"pressure": 4, "flow": 40, "jet_height": 5.0}])
    jh = m3.jet_height_at_pressure(2.25)  # sqrt-domain: 2.0 + 0.5*(5-2)=3.5
    check("Interp: jet height interpolates from catalog (→3.5)",
          abs(jh - 3.5) < 1e-9, f"jh={jh}")


# ── Criterion 3: manufacturer catalogs ─────────────────────────────────────────
def test_catalogs():
    db = NozzleDatabase(load_defaults=False)
    n = db.load_catalog({
        "manufacturer": "Acme",
        "nozzles": [
            {"id": "A1", "model": "J1", "k_factor": 10},
            {"id": "A2", "model": "J2", "k_factor": 20},
        ],
    })
    db.load_catalog({
        "manufacturer": "Globe",
        "nozzles": [{"id": "G1", "model": "F1", "k_factor": 15}],
    })
    check("Catalogs: load returns model count", n == 2, f"n={n}")
    check("Catalogs: multiple manufacturers tracked",
          db.manufacturers() == ["Acme", "Globe"], f"{db.manufacturers()}")
    check("Catalogs: list by manufacturer filters correctly",
          [m.id for m in db.list_models("Acme")] == ["A1", "A2"]
          and [m.id for m in db.list_models("Globe")] == ["G1"],
          f"acme={[m.id for m in db.list_models('Acme')]}")
    check("Catalogs: query a specific model by id",
          abs(db.query("A2", pressure=4.0)["flow"] - 40.0) < 1e-9,
          f"{db.query('A2', pressure=4.0)}")


# ── Default seed catalogs load from disk ───────────────────────────────────────
def test_default_catalogs():
    db = NozzleDatabase()  # loads data/nozzle_catalogs.json
    check("Defaults: seed catalogs loaded from disk", len(db.list_models()) >= 3,
          f"count={len(db.list_models())}")
    check("Defaults: a K-factor nozzle answers Q=K*sqrt(P)",
          db.get("AF-GEYSER-25") is not None
          and abs(db.query("AF-GEYSER-25", pressure=4.0)["flow"] - 42.0 * 2) < 1e-6,
          f"{db.query('AF-GEYSER-25', pressure=4.0) if db.get('AF-GEYSER-25') else 'missing'}")
    check("Defaults: a tabulated nozzle interpolates within its curve",
          db.get("OASE-FOAM-30") is not None
          and 64.0 < db.query("OASE-FOAM-30", pressure=1.5)["flow"] < 90.0,
          f"{db.query('OASE-FOAM-30', pressure=1.5) if db.get('OASE-FOAM-30') else 'missing'}")


def main() -> int:
    for fn in (test_stores_k_factor, test_derive_k_from_points, test_interpolation,
               test_catalogs, test_default_catalogs):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-005 Nozzle Performance Database — Verification")
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
    total = len(results)
    print("-" * 72)
    print(f"{passed}/{total} checks passed")
    print("=" * 72)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
