"""AquaFlow document and .aquapkg package loading."""

from __future__ import annotations

import json
import re
from pathlib import Path
from zipfile import ZipFile

import bpy


def safe_extract_package(source, destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if destination != target and destination not in target.parents:
                raise ValueError("Unsafe path in AquaFlow package: " + member.filename)
        archive.extractall(destination)
    return destination


def load_project_document(source):
    source = Path(source).expanduser().resolve()
    if source.suffix.lower() != ".aquapkg":
        with source.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle), source.parent
    destination = Path(bpy.path.abspath("//aquaflow_packages")) / re.sub(r"[^A-Za-z0-9_.-]+", "_", source.stem)
    safe_extract_package(source, destination)
    project_path = destination / "project.aqua"
    if not project_path.is_file():
        raise ValueError("The .aquapkg does not contain project.aqua")
    with project_path.open("r", encoding="utf-8-sig") as handle:
        document = json.load(handle)
    manifest_path = destination / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    document["_aquapkg"] = {"root": str(destination), "manifest": manifest}
    return document, destination


def import_packaged_models(document, target):
    package = document.get("_aquapkg")
    if not package:
        return []
    root = Path(package["root"])
    assets = package["manifest"].get("assets") or []
    imported = []
    for model in document.get("engineering", {}).get("site_models") or []:
        if model.get("visible", True) is False:
            continue
        asset_id = (model.get("props") or {}).get("assetId")
        record = next((asset for asset in assets if asset.get("id") == asset_id or asset.get("usedBy") == model.get("id")), None)
        if not record or not record.get("packaged"):
            continue
        path = root / record["packaged"]
        if not path.is_file():
            raise FileNotFoundError("Packaged site model is missing: " + str(path))
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        objects = list(set(bpy.data.objects) - before)
        for obj in objects:
            for collection in list(obj.users_collection):
                collection.objects.unlink(obj)
            target.objects.link(obj)
            obj["aquapkg_asset_id"] = asset_id or model["id"]
        imported.extend(objects)
    return imported
