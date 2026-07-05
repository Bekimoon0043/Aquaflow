"""
Contract tests for the Generative Fountain Designer (AQ-S5-006).

Asserts the three acceptance criteria:
  1. generates fountain concepts (distinct, complete, reproducible),
  2. produces an engineering package (complete ZIP + manifest),
  3. produces a construction package (complete ZIP + manifest).
"""
import io
import json
import zipfile

import pytest

from services.generative_designer import (
    generate_concepts, build_engineering_package, build_construction_package,
    concept_to_design, CONSTRUCTION_REQUIRED_DOCUMENTS)
from services.engineering_package import REQUIRED_DOCUMENTS

BRIEF = {"venue": "Grand Plaza", "area_m2": 300, "budget_usd": 400000,
         "style": "grand", "theme": "Desert Dawn", "depth_m": 1.4}


def _names(zip_bytes):
    return set(zipfile.ZipFile(io.BytesIO(zip_bytes)).namelist())


@pytest.fixture
def concept():
    return generate_concepts(BRIEF, count=3)[0]


# ── 1. concept generation ──────────────────────────────────────────────────────

def test_generates_distinct_concepts():
    concepts = generate_concepts(BRIEF, count=3)
    assert len(concepts) == 3
    assert len({c["archetype"] for c in concepts}) == 3
    for c in concepts:
        assert c["fixtures"] and c["pool"]["area_m2"] > 0
        assert c["estimate"]["total_cost_usd"] > 0
        assert len(c["narrative"]) > 40


def test_generation_is_deterministic():
    a = generate_concepts(BRIEF, count=3)
    b = generate_concepts(BRIEF, count=3)
    assert [c["name"] for c in a] == [c["name"] for c in b]
    assert [len(c["fixtures"]) for c in a] == [len(c["fixtures"]) for c in b]


def test_style_and_theme_reflected(concept):
    assert concept["style"] == "grand"
    assert concept["effects"].get("flame") is True
    assert concept["theme"] == "Desert Dawn"


def test_budget_cap_respected(concept):
    assert concept["estimate"]["total_cost_usd"] <= BRIEF["budget_usd"]
    assert concept["within_budget"] is True


def test_different_brief_differs():
    other = generate_concepts({"area_m2": 120, "style": "romantic"}, count=1)[0]
    base = generate_concepts(BRIEF, count=1)[0]
    assert other["name"] != base["name"]


def test_count_clamped_to_archetypes():
    assert len(generate_concepts(BRIEF, count=99)) == 3
    assert len(generate_concepts(BRIEF, count=1)) == 1


# ── 2. engineering package ─────────────────────────────────────────────────────

def test_engineering_package_complete(concept):
    zip_bytes, manifest = build_engineering_package(concept)
    assert len(zip_bytes) > 500
    names = _names(zip_bytes)
    assert all(d in names for d in REQUIRED_DOCUMENTS)
    assert manifest["complete"] is True
    assert manifest["pdf_supported"] and manifest["dxf_supported"]


def test_concept_to_design_carries_fixtures(concept):
    design = concept_to_design(concept)
    assert len(design["fixtures"]) == len(concept["fixtures"])
    assert design["pipes"]  # nozzles wired to a header


# ── 3. construction package ────────────────────────────────────────────────────

def test_construction_package_complete(concept):
    zip_bytes, manifest = build_construction_package(concept)
    assert len(zip_bytes) > 500
    names = _names(zip_bytes)
    assert all(d in names for d in CONSTRUCTION_REQUIRED_DOCUMENTS)
    assert manifest["complete"] is True
    assert manifest["pdf_supported"] is True


def test_construction_quantities_are_real(concept):
    zip_bytes, _ = build_construction_package(concept)
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    civ = json.loads(zf.read("civil_works.json"))
    elec = json.loads(zf.read("electrical_load.json"))
    assert civ["total_concrete_m3"] > 0
    assert civ["excavation_m3"] > 0
    assert elec["connected_load_kw"] > 0
    assert "phase,description" in zf.read("install_schedule.csv").decode("utf-8")
