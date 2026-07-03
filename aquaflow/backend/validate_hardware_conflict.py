"""
validate_hardware_conflict.py — AquaFlow Stage 1, Priority 3 (AQ-S1-003)

Proves the two acceptance criteria for hardware conflict detection:
  1. Duplicate addresses are flagged before a show runs.
  2. A clear error message is shown to the operator (surfaced via
     get_hardware_conflicts(), last_error, and get_state()).

Runs entirely in-process against app_state.apply_show_payload + ShowEngine.play —
no server, no hardware. Exit code 0 = all checks pass.

Run:  python validate_hardware_conflict.py
"""
import asyncio
import sys

# Engine status prints use unicode glyphs; keep this harness console-safe on Windows.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app_state import apply_show_payload, show_engine


PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


def lighting_fixture(fid: str, universe: int, channel: int) -> dict:
    """A designed RGB lighting fixture pinned to an explicit DMX address."""
    return {
        "id": fid,
        "type": "rgb_light",
        "label": fid,
        "zone": "main",
        "universe": universe,
        "channel": channel,
    }


async def run() -> None:
    # ── Case A: two lighting fixtures forced onto the SAME DMX address ──────────
    # Each RGB fixture claims 4 channels (master+R+G+B). Both at U1 Ch1 overlap.
    conflicting_show = {
        "showId": "conflict-test",
        "duration": 10,
        "fixtures": [
            lighting_fixture("LIGHT_A", universe=1, channel=1),
            lighting_fixture("LIGHT_B", universe=1, channel=1),
        ],
        "groups": [],
        "tracks": [],
    }
    apply_show_payload(conflicting_show)

    conflicts = show_engine.get_hardware_conflicts()
    check("Conflicting show: duplicate address flagged", len(conflicts) > 0,
          f"conflicts={conflicts}")

    started = await show_engine.play()
    check("Conflicting show: play() blocked (returns False)", started is False,
          f"play() returned {started}")
    check("Conflicting show: engine did not enter PLAYING",
          show_engine.show_state.state.name != "PLAYING",
          f"state={show_engine.show_state.state.name}")

    state = show_engine.get_state()
    check("Conflicting show: get_state exposes hardware_conflicts",
          len(state.get("hardware_conflicts") or []) > 0,
          f"state.hardware_conflicts={state.get('hardware_conflicts')}")
    check("Conflicting show: clear operator error message present",
          bool(state.get("error")) and "conflict" in state["error"].lower(),
          f"error={state.get('error')!r}")

    # ── Case B: the SAME two fixtures on DISTINCT addresses → clean, must run ───
    clean_show = {
        "showId": "clean-test",
        "duration": 10,
        "fixtures": [
            lighting_fixture("LIGHT_A", universe=1, channel=1),
            lighting_fixture("LIGHT_B", universe=1, channel=5),
        ],
        "groups": [],
        "tracks": [],
    }
    apply_show_payload(clean_show)

    conflicts2 = show_engine.get_hardware_conflicts()
    check("Clean show: no conflicts flagged", len(conflicts2) == 0,
          f"conflicts={conflicts2}")

    started2 = await show_engine.play()
    check("Clean show: play() allowed (returns True)", started2 is True,
          f"play() returned {started2}")
    check("Clean show: last_error cleared after successful play",
          show_engine.last_error == "", f"last_error={show_engine.last_error!r}")

    state2 = show_engine.get_state()
    check("Clean show: get_state error field empty",
          not state2.get("error"), f"error={state2.get('error')!r}")

    await show_engine.stop()


def main() -> int:
    asyncio.run(run())
    print("\n" + "=" * 68)
    print("AQ-S1-003 Hardware Conflict Detection — Verification")
    print("=" * 68)
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
    print("-" * 68)
    print(f"{passed}/{total} checks passed")
    print("=" * 68)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
