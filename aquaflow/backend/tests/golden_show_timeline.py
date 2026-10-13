"""Regenerate frontend/src/preflight/__tests__/golden/overload-timeline.json's response from
its recorded request with the real evaluator (AF-NEXT-007). Run from aquaflow/backend."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from services.show_hydraulics import evaluate_show_hydraulics  # noqa: E402

GOLDEN = pathlib.Path(__file__).resolve().parents[2] / "frontend/src/preflight/__tests__/golden/overload-timeline.json"

if __name__ == "__main__":
    data = json.loads(GOLDEN.read_text(encoding="utf-8"))
    req = data["request"]
    res = evaluate_show_hydraulics(req["project"], req["show"], req["options"])
    res["stats"]["elapsedMs"] = 0
    data["response"] = {**res, "revision": "golden", "cached": False}
    GOLDEN.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print("wrote", GOLDEN, len(res["diagnostics"]), "diagnostics")
