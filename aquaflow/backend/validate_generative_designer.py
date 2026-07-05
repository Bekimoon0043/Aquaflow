"""
validate_generative_designer.py — AQ-S5-006 verification

Scenarios for the Generative Fountain Designer:
  1. generates fountain concepts (distinct, complete, reproducible),
  2. produces an engineering package (complete ZIP + manifest),
  3. produces a construction package (complete ZIP + manifest).

Run:  python backend/validate_generative_designer.py   (from the aquaflow/ dir)
"""
import io
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.generative_designer import (
    generate_concepts, build_engineering_package, build_construction_package,
    concept_to_design, CONSTRUCTION_REQUIRED_DOCUMENTS)
from services.engineering_package import REQUIRED_DOCUMENTS

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def _names(zip_bytes):
    return set(zipfile.ZipFile(io.BytesIO(zip_bytes)).namelist())


BRIEF = {"venue": "Grand Plaza", "area_m2": 300, "budget_usd": 400000,
         "style": "grand", "theme": "Desert Dawn", "depth_m": 1.4}

print("== 1. generates fountain concepts ==")
concepts = generate_concepts(BRIEF, count=3)
check("three concepts generated", len(concepts) == 3, str(len(concepts)))
check("concepts have distinct archetypes",
      len({c["archetype"] for c in concepts}) == 3)
c0 = concepts[0]
check("concept has a name + narrative", bool(c0["name"]) and len(c0["narrative"]) > 40)
check("concept lays out fixtures", len(c0["fixtures"]) >= 6, str(len(c0["fixtures"])))
check("concept sizes a pool", c0["pool"]["area_m2"] > 0)
check("concept carries a costed estimate", c0["estimate"]["total_cost_usd"] > 0,
      str(c0["estimate"]["total_cost_usd"]))
check("grand style reflected (flame effect on)", c0["effects"].get("flame") is True)
check("theme carried into the concept", c0["theme"] == "Desert Dawn")
# reproducibility
again = generate_concepts(BRIEF, count=3)
check("generation is deterministic (same brief → same concepts)",
      [c["name"] for c in again] == [c["name"] for c in concepts] and
      [len(c["fixtures"]) for c in again] == [len(c["fixtures"]) for c in concepts])
# budget respected
check("concept respects the budget cap", c0["estimate"]["total_cost_usd"] <= BRIEF["budget_usd"],
      str(c0["estimate"]["total_cost_usd"]))
# a different brief yields different concepts
other = generate_concepts({"area_m2": 120, "style": "romantic"}, count=3)
check("a different brief yields a different design",
      other[0]["name"] != concepts[0]["name"])

print("== 2. produces an engineering package ==")
eng_zip, eng_manifest = build_engineering_package(c0)
check("engineering package is a non-trivial ZIP", len(eng_zip) > 500, str(len(eng_zip)))
names = _names(eng_zip)
missing = [d for d in REQUIRED_DOCUMENTS if d not in names]
check("all required engineering documents present", not missing, f"missing={missing}")
check("engineering manifest reports complete", eng_manifest["complete"] is True)
check("engineering package supports PDF + DXF",
      eng_manifest["pdf_supported"] and eng_manifest["dxf_supported"])
check("design projection carries the fixtures",
      len(concept_to_design(c0)["fixtures"]) == len(c0["fixtures"]))

print("== 3. produces a construction package ==")
con_zip, con_manifest = build_construction_package(c0)
check("construction package is a non-trivial ZIP", len(con_zip) > 500, str(len(con_zip)))
cnames = _names(con_zip)
cmissing = [d for d in CONSTRUCTION_REQUIRED_DOCUMENTS if d not in cnames]
check("all required construction documents present", not cmissing, f"missing={cmissing}")
check("construction manifest reports complete", con_manifest["complete"] is True)
check("construction package includes a cover PDF", con_manifest["pdf_supported"] is True)

# spot-check real construction quantities
civ = zipfile.ZipFile(io.BytesIO(con_zip)).read("civil_works.json").decode("utf-8")
import json as _json
civ = _json.loads(civ)
check("civil works has a positive concrete volume", civ["total_concrete_m3"] > 0,
      str(civ["total_concrete_m3"]))
elec = _json.loads(zipfile.ZipFile(io.BytesIO(con_zip)).read("electrical_load.json").decode("utf-8"))
check("electrical load computed", elec["connected_load_kw"] > 0, str(elec["connected_load_kw"]))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
