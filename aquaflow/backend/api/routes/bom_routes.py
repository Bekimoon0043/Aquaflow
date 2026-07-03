"""
bom_routes.py — AquaFlow Stage 2, Priority 9 (AQ-S2-009)

API surface for the automatic BOM generator: roll a design (or a hydraulic
network) up into a costed bill of materials with supplier references, and export
it as JSON, CSV, or a downloadable .xlsx workbook.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from services.bom_generator import BOMGenerator, generate_bom, generate_from_network

router = APIRouter()

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/generate")
async def generate(model: dict, format: str = Query("json", pattern="^(json|csv|xlsx)$")):
    """
    Generate a BOM from a design model.

    ?format=json (default) returns the lines + summary; csv/xlsx return a
    downloadable file.
    """
    try:
        if format == "xlsx":
            gen = BOMGenerator(project=model.get("project", "AquaFlow Studio"),
                               currency=model.get("currency", "USD")).generate(model)
            return Response(content=gen.to_xlsx_bytes(), media_type=_XLSX_MIME,
                            headers={"Content-Disposition": 'attachment; filename="bom.xlsx"'})
        if format == "csv":
            gen = BOMGenerator(project=model.get("project", "AquaFlow Studio"),
                               currency=model.get("currency", "USD")).generate(model)
            return Response(content=gen.to_csv(), media_type="text/csv",
                            headers={"Content-Disposition": 'attachment; filename="bom.csv"'})
        return generate_bom(model)
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/from-network")
async def from_network(network: dict, format: str = Query("json", pattern="^(json|csv|xlsx)$")):
    """Build a BOM directly from a hydraulic-solver network."""
    try:
        result = generate_from_network(network)
        if format == "json":
            return result
        # Rehydrate a generator from the derived rows for file export.
        gen = BOMGenerator(currency=network.get("currency", "USD"))
        from services.bom_generator import BOMLine
        gen.lines = [BOMLine(
            item=l["item"], category=l["category"], description=l["description"],
            quantity=l["quantity"], unit=l["unit"], manufacturer=l["manufacturer"],
            part_number=l["part_number"], supplier=l["supplier"],
            unit_cost=l["unit_cost"], currency=l.get("currency", "USD"), notes=l["notes"],
        ) for l in result["lines"]]
        if format == "xlsx":
            return Response(content=gen.to_xlsx_bytes(), media_type=_XLSX_MIME,
                            headers={"Content-Disposition": 'attachment; filename="bom.xlsx"'})
        return Response(content=gen.to_csv(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="bom.csv"'})
    except Exception as e:
        raise HTTPException(400, detail=str(e))
