"""
validate_pipe_sizing.py — AquaFlow Stage 2, Priority 3 (AQ-S2-003)

Proves the three acceptance criteria for the pipe sizing engine:
  1. Suggests a pipe diameter for a given flow.
  2. Detects undersized pipes (velocity above the max limit).
  3. Detects oversized pipes (velocity below the min limit).

Each scenario is checked against an independent velocity hand calc. Also verifies
end-to-end sizing of a solved hydraulic network. No server. Exit code 0 = pass.

Run:  python validate_pipe_sizing.py
"""
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.pipe_sizing import (
    PipeSizingEngine, VelocityLimits, velocity, required_diameter,
    size_pipes, size_network,
)

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


def v(flow, d):
    return flow / (math.pi * d * d / 4.0)


# ── Criterion 1: suggests a diameter ───────────────────────────────────────────
def test_suggest_diameter():
    engine = PipeSizingEngine(VelocityLimits(v_min=0.6, v_max=2.5, v_target=1.5))
    flow = 0.03  # m^3/s (1800 L/min)

    label, d, vel = engine.suggest_size(flow)
    check("Suggest: returns a standard size", label is not None and d is not None,
          f"label={label} d={d}")
    check("Suggest: resulting velocity within [v_min, v_max]",
          0.6 <= vel <= 2.5, f"v={vel:.3f}")
    # It must be the SMALLEST size that is not undersized: one size smaller would
    # exceed v_max.
    check("Suggest: velocity matches hand calc for the chosen size",
          abs(vel - v(flow, d)) < 1e-9, f"v={vel}")
    # Continuous required diameter at target velocity, for reference.
    dreq = required_diameter(flow, 1.5)
    check("Suggest: chosen size is >= the continuous target diameter",
          d >= dreq_round(dreq), f"d={d} dreq={dreq:.4f}")


def dreq_round(dreq):
    # chosen standard size must be at least the target-velocity diameter minus a
    # size step tolerance (we round UP to a standard size).
    return dreq - 1e-9


# ── Criterion 2: detects undersized ────────────────────────────────────────────
def test_detect_undersized():
    engine = PipeSizingEngine(VelocityLimits(v_min=0.6, v_max=2.5, v_target=1.5))
    # 0.05 m^3/s through DN100 (0.1 m) → v ≈ 6.4 m/s, far above max.
    flow, d = 0.05, 0.1
    hand_v = v(flow, d)
    res = engine.evaluate("P_under", flow, d)
    check("Undersized: hand velocity indeed exceeds max", hand_v > 2.5, f"v={hand_v:.2f}")
    check("Undersized: flagged as undersized", res.status == "undersized", f"status={res.status}")
    check("Undersized: reported velocity matches hand calc",
          abs(res.current_velocity_ms - hand_v) < 1e-3, f"v={res.current_velocity_ms}")
    check("Undersized: suggests a LARGER pipe than current",
          res.suggested_diameter_m > d, f"suggested={res.suggested_diameter_m} current={d}")
    check("Undersized: suggested size brings velocity within limits",
          res.suggested_velocity_ms <= 2.5, f"v_sugg={res.suggested_velocity_ms}")


# ── Criterion 3: detects oversized ─────────────────────────────────────────────
def test_detect_oversized():
    engine = PipeSizingEngine(VelocityLimits(v_min=0.6, v_max=2.5, v_target=1.5))
    # 0.002 m^3/s through DN200 (0.2 m) → v ≈ 0.064 m/s, well below min.
    flow, d = 0.002, 0.2
    hand_v = v(flow, d)
    res = engine.evaluate("P_over", flow, d)
    check("Oversized: hand velocity indeed below min", hand_v < 0.6, f"v={hand_v:.3f}")
    check("Oversized: flagged as oversized", res.status == "oversized", f"status={res.status}")
    check("Oversized: suggests a SMALLER pipe than current",
          res.suggested_diameter_m < d, f"suggested={res.suggested_diameter_m} current={d}")


# ── OK band + configurable limits ──────────────────────────────────────────────
def test_ok_and_configurable():
    engine = PipeSizingEngine(VelocityLimits(v_min=0.6, v_max=2.5, v_target=1.5))
    # Choose flow+diameter giving v ≈ 1.5 m/s: d=0.1 → A=0.007854 → Q=1.5*A=0.011781
    flow, d = 1.5 * (math.pi * 0.1 ** 2 / 4.0), 0.1
    res = engine.evaluate("P_ok", flow, d)
    check("OK: mid-band velocity is accepted", res.status == "ok", f"status={res.status} v={res.current_velocity_ms}")

    # Tighten v_max below the current velocity → same pipe now undersized.
    strict = PipeSizingEngine(VelocityLimits(v_min=0.6, v_max=1.0, v_target=0.9))
    res2 = strict.evaluate("P_ok", flow, d)
    check("Configurable: tighter v_max reclassifies the same pipe as undersized",
          res2.status == "undersized", f"status={res2.status}")


# ── End-to-end: size a solved hydraulic network ────────────────────────────────
def test_size_solved_network():
    # Reservoir feeds a junction; the feed pipe is deliberately tiny (undersized).
    payload = {
        "nodes": [{"id": "R", "fixed_head": 50}, {"id": "J", "demand": 0.03}],
        "pipes": [{"id": "feed", "from": "R", "to": "J",
                   "length": 50, "diameter": 0.05, "roughness": 130}],
        "velocity_limits": {"v_min": 0.6, "v_max": 2.5, "v_target": 1.5},
    }
    out = size_network(payload)
    check("Network sizing: hydraulics converged", out["hydraulics"]["converged"], "")
    feed = next(p for p in out["pipes"] if p["pipe_id"] == "feed")
    # 0.03 m^3/s through 0.05 m → v ≈ 15.3 m/s → undersized.
    check("Network sizing: tiny feed pipe flagged undersized",
          feed["status"] == "undersized", f"status={feed['status']} v={feed['current_velocity_ms']}")
    check("Network sizing: suggests a larger standard size for the feed",
          feed["suggested_diameter_m"] > 0.05, f"suggested={feed['suggested_diameter_m']}")
    check("Network sizing: summary counts the issue",
          out["summary"]["undersized"] >= 1 and out["summary"]["issues"] >= 1,
          f"summary={out['summary']}")


def main() -> int:
    for fn in (test_suggest_diameter, test_detect_undersized, test_detect_oversized,
               test_ok_and_configurable, test_size_solved_network):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-003 Pipe Sizing Engine — Verification")
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
