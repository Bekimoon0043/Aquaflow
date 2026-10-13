"""
cad_recognition.py — AquaFlow AF-CAD-012 (+ AF-CAD-016 tag ↔ schedule join)

Deterministic, scored fountain-component recognition over the AF-CAD-010 import
JSON (`docs/CAD-IMPORT-CONTRACT.md`). Every candidate carries
`{source_handle, type, confidence, reasons[]}` for the human review step.

Signal priority (highest first):
  1. AQUAFLOW XDATA (exact on round-trips)
  2. user mapping-template rules (block / layer / attribute regex)
  3. attribute tags (TYPE / MODEL / …)
  4. multilingual layer / block-name keywords
  5. geometry signatures (repeated small circles on a ring or a line)
  6. instance counts

Fields (model, flow, height …) are filled from attributes, then from the schedule
row found through the nearest tag text, each with provenance. Recognition NEVER
invents hardware addresses: `dmx_address` / `channel` are only ever copied
verbatim from an attribute or schedule cell, and templates cannot set them.

Templates are stored as JSON in `$AQUAFLOW_DATA_DIR/cad_templates.json`
(default `~/.aquaflow`).
"""
from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from functools import lru_cache
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

TYPES = ("nozzle", "light", "pump", "valve", "equipment", "laser", "fire", "mist")
HARDWARE_FIELDS = {"dmx_address", "channel", "valve_channel", "address", "dmx_universe"}

# ───────────────────────────────────────────────────────────── keywords ──
# Latin keywords are matched on accent-stripped, upper-cased tokens. Keywords of
# ≤ 3 letters must equal a token (LED ≠ FILLED); longer ones may prefix a token.
# CJK / Arabic keywords are matched as substrings of the raw name.
KEYWORDS = {
    "mist": ["MIST", "FOG", "FOGGER", "NEBLINA", "NIEBLA", "NEBULIZADOR", "NEBEL", "BROUILLARD",
             "BRUME", "NEBBIA", "NEBULIZZATORE", "NEVOA", "雾", "喷雾", "ضباب"],
    "fire": ["FIRE", "FLAME", "FUEGO", "LLAMA", "FEUER", "FLAMME", "FEU", "FUOCO", "FIAMMA",
             "FOGO", "CHAMA", "火焰", "火", "نار", "لهب"],
    "laser": ["LASER", "LASERS", "激光", "ليزر"],
    "nozzle": ["NOZZLE", "NOZ", "NZ", "JET", "JETS", "BOQUILLA", "TOBERA", "CHORRO", "SURTIDOR",
               "DUSE", "DUESE", "DUESEN", "DUSEN", "BUSE", "AJUTAGE", "UGELLO", "UGELLI", "BOCAL",
               "BICO", "ESGUICHO", "GEYSER", "GEISER", "SHOOTER", "BUBBLER", "SPRAY", "FOUNTAINHEAD",
               "喷头", "喷嘴", "فوهة", "رشاش", "نافورة"],
    "valve": ["VALVE", "VALVES", "VALVULA", "ELECTROVALVULA", "ELETROVALVULA", "VENTIL",
              "MAGNETVENTIL", "VANNE", "ELECTROVANNE", "VALVOLA", "ELETTROVALVOLA", "SOLENOID",
              "SOLENOIDE", "SV", "阀", "电磁阀", "صمام"],
    "pump": ["PUMP", "PUMPS", "BOMBA", "BOMBAS", "MOTOBOMBA", "ELECTROBOMBA", "PUMPE", "PUMPEN",
             "POMPE", "POMPA", "POMPE", "泵", "水泵", "مضخة"],
    "light": ["LIGHT", "LIGHTS", "LIGHTING", "LED", "LEDS", "LAMP", "LUMINAIRE", "LUZ", "LUCES",
              "FOCO", "FOCOS", "LUMINARIA", "LEUCHTE", "LEUCHTEN", "LICHT", "SCHEINWERFER",
              "LUMIERE", "PROJECTEUR", "ECLAIRAGE", "LUCE", "LUCI", "FARO", "FARETTO",
              "ILLUMINAZIONE", "ILUMINACAO", "REFLETOR", "RGB", "RGBW", "SPOT", "SPOTLIGHT",
              "UPLIGHT", "灯", "照明", "ضوء", "إضاءة", "انارة"],
    "equipment": ["FILTER", "FILTRO", "FILTRE", "SKIMMER", "VFD", "INVERTER", "VARIADOR",
                  "FREQUENZUMRICHTER", "PANEL", "CABINET", "TABLERO", "CUADRO", "SCHALTSCHRANK",
                  "ARMOIRE", "QUADRO", "GATEWAY", "PLC", "CONTROLLER", "TANK", "DEPOSITO",
                  "HEATER", "CHLORINATOR", "DOSING", "ICAN", "控制柜", "过滤器", "لوحة"],
}
# Tie-break order when several types match one name (most specific first).
TYPE_ORDER = ("mist", "fire", "laser", "nozzle", "valve", "pump", "light", "equipment")
NEGATIVE_TOKENS = {"TEXT", "TXT", "DIM", "DIMS", "ANNO", "NOTE", "NOTES", "TITLE", "HATCH",
                   "PIPE", "PIPES", "TUBERIA", "ROHR", "SCHED", "SCHEDULE", "TABLE", "GRID"}

WATER_KEYWORDS = ["POOL", "BASIN", "WATER", "FOUNTAIN", "POND", "ESTANQUE", "VASO", "PILETA",
                  "PISCINA", "FUENTE", "LAMINA", "AGUA", "BECKEN", "BRUNNEN", "WASSER", "BASSIN",
                  "FONTAINE", "EAU", "VASCA", "FONTANA", "ACQUA", "TANQUE", "LAGO", "CHAFARIZ",
                  "水池", "水景", "حوض", "بركة"]
ISLAND_KEYWORDS = ["ISLAND", "ISLA", "ISLOTE", "INSEL", "ILE", "ILOT", "ISOLA", "ILHA", "PLANTER",
                   "JARDINERA", "岛", "جزيرة"]
PIPE_KEYWORDS = ["PIPE", "PIPES", "PIPING", "TUBERIA", "TUBERIAS", "TUBO", "TUBOS", "CANERIA",
                 "ROHR", "ROHRE", "ROHRLEITUNG", "LEITUNG", "TUYAU", "TUYAUTERIE", "CANALISATION",
                 "TUBAZIONE", "TUBAZIONI", "TUBULACAO", "HYDRAULIC", "HIDRAULICA", "SUPPLY",
                 "RETURN", "DISCHARGE", "SUCTION", "IMPULSION", "IMPULSION", "ASPIRACION",
                 "管", "管道", "أنبوب", "انابيب"]
WATER_TABLE = {"water": WATER_KEYWORDS}
ISLAND_TABLE = {"island": ISLAND_KEYWORDS}
PIPE_TABLE = {"pipe": PIPE_KEYWORDS}
WATER_PATTERN_TABLE = {"water": ["WATER", "AGUA"]}
PIPE_MATERIALS = [("PVC-U", "PVC"), ("UPVC", "PVC"), ("CPVC", "CPVC"), ("PVC", "PVC"),
                  ("HDPE", "HDPE"), ("PEAD", "HDPE"), ("PE100", "PE"), ("PE80", "PE"),
                  ("PPR", "PPR"), ("ABS", "ABS"), ("STAINLESS", "SS"), ("INOX", "SS"),
                  ("EDELSTAHL", "SS"), ("SS316", "SS"), ("SS304", "SS"), ("COPPER", "CU"),
                  ("COBRE", "CU"), ("KUPFER", "CU"), ("CUIVRE", "CU"), ("RAME", "CU"),
                  ("GALV", "GALV"), ("STEEL", "STEEL"), ("ACERO", "STEEL"), ("STAHL", "STEEL")]
LAND_KEYWORDS = {
    "grass": ["GRASS", "LAWN", "TURF", "CESPED", "GRAMA", "PASTO", "RASEN", "GAZON", "PELOUSE",
              "PRATO", "ERBA", "GRAMADO", "草", "عشب"],
    "paving": ["PAVING", "PAVER", "PAVERS", "PAVEMENT", "PAVIMENTO", "ADOQUIN", "BALDOSA",
               "SOLADO", "PFLASTER", "PLATTEN", "DALLAGE", "PAVE", "LASTRICATO", "CONCRETE",
               "HORMIGON", "BETON", "CALCESTRUZZO", "CONCRETO", "BRICK", "LADRILLO", "TILE",
               "AR-BRSTD", "AR-HBONE", "AR-CONC", "AR-B816", "AR-B88", "AR-PARQ1", "AR-RROOF",
               "BRSTONE", "DECK", "PLAZA", "铺装", "رصف"],
    "soil": ["SOIL", "EARTH", "TIERRA", "ERDE", "TERRE", "TERRA", "MULCH", "PLANTING",
             "PLANTACION", "BEET", "EARTH2", "土"],
    "rock": ["ROCK", "ROCA", "PIEDRA", "STEIN", "FELS", "ROCHE", "PIERRE", "ROCCIA", "PIETRA",
             "PEDRA", "GRAVEL", "GRAVA", "KIES", "GRAVIER", "GHIAIA", "CASCALHO", "STONE",
             "GRAVEL1", "石", "صخر"],
    "sand": ["SAND", "ARENA", "SABLE", "SABBIA", "AREIA", "AR-SAND", "沙", "رمل"],
}

# attribute / schedule header synonyms → field
FIELD_SYNONYMS = {
    "tag": ["TAG", "ID", "MARK", "REF", "REFERENCE", "ITEM", "NO", "NUM", "NUMBER", "POS",
            "POSITION", "ETIQUETA", "MARCA", "KENNUNG", "REPERE", "SIGLA", "CODIGO", "CODE",
            "NAME", "NOMBRE"],
    "type": ["TYPE", "TIPO", "TYP", "KIND", "CATEGORY", "CATEGORIA", "KATEGORIE", "DEVICE",
             "EQUIPMENT", "EQUIPO", "CLASS", "FUNCTION", "DESCRIPTION", "DESCRIPCION",
             "BESCHREIBUNG", "DESIGNATION", "DESCRIZIONE", "DESCRICAO", "DESC"],
    "model": ["MODEL", "MODELO", "MODELL", "MODELE", "MODELLO", "PART", "PARTNO", "ARTNR",
              "ARTICLE", "ARTICULO", "SKU", "PRODUCT", "PRODUCTO"],
    "flow_lpm": ["FLOW", "CAUDAL", "Q", "DURCHFLUSS", "FORDERSTROM", "DEBIT", "PORTATA", "VAZAO",
                 "LPM", "FLOWRATE"],
    "height_m": ["HEIGHT", "ALTURA", "HOHE", "HOEHE", "HAUTEUR", "ALTEZZA", "JETHEIGHT",
                 "SPRAYHEIGHT", "H"],
    "head_m": ["HEAD", "TDH", "CARGA", "ALTURAMANOMETRICA", "FORDERHOHE", "HMT", "PREVALENZA"],
    "power_kw": ["POWER", "KW", "POTENCIA", "LEISTUNG", "PUISSANCE", "POTENZA", "WATTS", "W"],
    "dn": ["DN", "DIA", "DIAMETER", "DIAMETRO", "SIZE", "CONNECTION", "CONEXION", "ANSCHLUSS",
           "INLET"],
    "dmx_address": ["DMX", "DMXADDR", "DMXADDRESS", "DMXADDRESSE", "DIRECCIONDMX", "DMXSTART",
                    "ADDRESS", "ADDR", "DIRECCION", "ADRESSE", "INDIRIZZO", "ENDERECO"],
    "channel": ["CHANNEL", "CH", "CANAL", "KANAL", "CANALE", "OUTPUT", "SALIDA", "AUSGANG"],
    "pump_id": ["PUMP", "PUMPID", "BOMBA", "PUMPE", "POMPE", "POMPA", "FEDBY", "CIRCUIT"],
    "color": ["COLOR", "COLOUR", "FARBE", "COULEUR", "COLORE", "COR"],
}
BASE_FIELDS = ("model", "flow_lpm", "height_m", "dmx_address", "pump_id")
NUMERIC_FIELDS = {"flow_lpm", "height_m", "head_m", "power_kw", "dn"}

TAG_RE = re.compile(r"^[A-Z]{1,5}[-_ .]?\d{1,4}[A-Z]?(?:[-_.]\d{1,3})?$", re.I)

AQUAFLOW_TYPE_MAP = {"nozzle": "nozzle", "light": "light", "pump": "pump", "vfd": "equipment",
                     "valve": "valve", "ican_gateway": "equipment", "laser": "laser",
                     "fire": "fire", "flame": "fire", "mist": "mist", "fog": "mist"}


# ───────────────────────────────────────────────────────────── text utils ──
def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.upper().replace("ß", "SS")


def _tokens(s: str) -> list:
    folded = _fold(s)
    parts = re.split(r"[^A-Z0-9]+", folded)
    out = []
    for p in parts:
        if not p:
            continue
        out.extend(x for x in re.findall(r"[A-Z]+|\d+", p))
    return out


def _is_cjk_or_arabic(kw: str) -> bool:
    return any(ord(ch) > 0x5FF for ch in kw)


_COMPILED_TABLES: dict = {}


def _compiled(table: dict) -> list:
    """[(key, [(keyword, folded, is_cjk)])] — folded once per table."""
    got = _COMPILED_TABLES.get(id(table))
    if got is None or got[0] is not table:
        rows = [(key, [(kw, re.sub(r"[^A-Z0-9]", "", _fold(kw)), _is_cjk_or_arabic(kw)) for kw in kws])
                for key, kws in table.items()]
        got = (table, rows)
        _COMPILED_TABLES[id(table)] = got
    return got[1]


@lru_cache(maxsize=8192)
def _keyword_hits_cached(name: str, table_id: int) -> tuple:
    table = _COMPILED_TABLES[table_id][1]
    toks = _tokens(name)
    tokset = set(toks)
    raw = str(name)
    folded_compact = re.sub(r"[^A-Z0-9]", "", _fold(name))
    hits = []
    for key, kws in table:
        for kw, k, cjk in kws:
            if cjk:
                if kw in raw:
                    hits.append((key, kw)); break
                continue
            if not k:
                continue
            if len(k) <= 3:
                if k in tokset:
                    hits.append((key, kw)); break
            elif any(t.startswith(k) for t in toks) or (len(k) >= 5 and k in folded_compact):
                hits.append((key, kw)); break
    return tuple(hits)


def keyword_hits(name: str, table: dict) -> list:
    """Return [(key, keyword)] hits for `name` against a {key: [keywords]} table."""
    if not name:
        return []
    _compiled(table)
    return list(_keyword_hits_cached(str(name), id(table)))


def classify_name(name: str) -> Optional[tuple]:
    """(type, keyword) for a block/layer/attribute name, using TYPE_ORDER for ties."""
    hits = keyword_hits(name, KEYWORDS)
    if not hits:
        return None
    by_type = {t: kw for t, kw in hits}
    for t in TYPE_ORDER:
        if t in by_type:
            return t, by_type[t]
    return None


def _has_negative(name: str) -> bool:
    return bool(set(_tokens(name)) & NEGATIVE_TOKENS)


def _field_for_header(header: str) -> Optional[str]:
    toks = _tokens(header)
    compact = "".join(t for t in toks if not t.isdigit())
    if not toks:
        return None
    for field, syns in FIELD_SYNONYMS.items():
        if compact in syns:
            return field
    for field, syns in FIELD_SYNONYMS.items():
        if toks[0] in syns and len(toks[0]) > 1:
            return field
    for field, syns in FIELD_SYNONYMS.items():
        if any(len(s) >= 4 and s in compact for s in syns):
            return field
    return None


_NUM_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def parse_number(value: Any, field: str, header: str = "") -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value)
    m = _NUM_RE.search(s)
    if not m:
        return None
    v = float(m.group(0).replace(",", "."))
    unit = _fold(s[m.end():] + " " + header)
    if field == "flow_lpm":
        if re.search(r"M3\s*/?\s*H|M³/H|CMH", unit):
            v = v * 1000.0 / 60.0
        elif re.search(r"L\s*/?\s*S\b|LPS", unit):
            v = v * 60.0
        elif "GPM" in unit:
            v = v * 3.785411784
        elif re.search(r"L\s*/?\s*H\b|LPH", unit):
            v = v / 60.0
    elif field in ("height_m", "head_m"):
        if re.search(r"\bMM\b", unit):
            v /= 1000.0
        elif re.search(r"\bCM\b", unit):
            v /= 100.0
        elif re.search(r"\bFT\b|FEET|'", unit):
            v *= 0.3048
    elif field == "power_kw":
        if re.search(r"\bW\b|WATT", unit) and not re.search(r"KW", unit):
            v /= 1000.0
        elif re.search(r"\bHP\b|\bCV\b|\bPS\b", unit):
            v *= 0.7457
    elif field == "dn":
        if re.search(r'"|\bIN\b|INCH|ZOLL|PULG', unit):
            v = round(v * 25.4)
    return round(v, 4)


def _norm_tag(s: str) -> str:
    s = re.sub(r"[\s\-_.]", "", _fold(s))
    return re.sub(r"\d+", lambda m: str(int(m.group(0))), s)


# ─────────────────────────────────────────────────────────── templates ──
def _templates_path() -> Path:
    root = Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow"))
    return root / "cad_templates.json"


def _load_store() -> dict:
    p = _templates_path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_store(store: dict) -> None:
    p = _templates_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, p)


def validate_template(template: dict) -> dict:
    """Validate and normalise a mapping template; raises ValueError."""
    if not isinstance(template, dict):
        raise ValueError("template must be an object")
    name = str(template.get("name") or "").strip()
    if not name or len(name) > 120 or not re.fullmatch(r"[\w .\-()+&]+", name):
        raise ValueError("template name is required (letters, digits, space . - _ ( ) + &)")
    rules = template.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError("template.rules must be a non-empty list")
    out_rules = []
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict):
            raise ValueError(f"rule {i} must be an object")
        match = rule.get("match")
        if match not in ("block", "layer", "attrib"):
            raise ValueError(f"rule {i}: match must be block|layer|attrib")
        pattern = str(rule.get("pattern") or "")
        try:
            re.compile(pattern, re.I)
        except re.error as exc:
            raise ValueError(f"rule {i}: bad regex: {exc}") from exc
        rtype = rule.get("type")
        if rtype not in TYPES and rtype != "ignore":
            raise ValueError(f"rule {i}: type must be one of {', '.join(TYPES)} or ignore")
        if match == "attrib" and not rule.get("attrib"):
            raise ValueError(f"rule {i}: attrib rules need an 'attrib' tag name")
        fields = rule.get("fields") or {}
        if not isinstance(fields, dict):
            raise ValueError(f"rule {i}: fields must be an object")
        bad = sorted(set(fields) & HARDWARE_FIELDS)
        if bad:
            raise ValueError(f"rule {i}: templates cannot assign hardware addresses ({', '.join(bad)})")
        r = {"match": match, "pattern": pattern, "type": rtype, "fields": fields}
        if match == "attrib":
            r["attrib"] = str(rule["attrib"])
        out_rules.append(r)
    out = {"name": name, "rules": out_rules}
    if template.get("description"):
        out["description"] = str(template["description"])[:500]
    if template.get("tag_radius_m") is not None:
        out["tag_radius_m"] = float(template["tag_radius_m"])
    return out


def list_templates() -> list:
    return [v for _, v in sorted(_load_store().items())]


def get_template(name: str) -> Optional[dict]:
    return _load_store().get(name)


def save_template(template: dict) -> dict:
    t = validate_template(template)
    store = _load_store()
    store[t["name"]] = t
    _save_store(store)
    return t


def delete_template(name: str) -> bool:
    store = _load_store()
    if name not in store:
        return False
    del store[name]
    _save_store(store)
    return True


def _template_match(template: Optional[dict], block: str, layer: str, attribs: dict):
    if not template:
        return None
    for rule in template.get("rules", []):
        try:
            rx = re.compile(rule["pattern"], re.I)
        except (re.error, KeyError, TypeError):
            continue
        m = rule.get("match")
        if m == "block" and block and rx.search(block):
            return rule, f"template rule block ~ /{rule['pattern']}/"
        if m == "layer" and layer and rx.search(layer):
            return rule, f"template rule layer ~ /{rule['pattern']}/"
        if m == "attrib":
            want = _fold(rule.get("attrib", ""))
            for k, v in (attribs or {}).items():
                if _fold(k) == want and rx.search(str(v)):
                    return rule, f"template rule attribute {k} ~ /{rule['pattern']}/"
    return None


# ───────────────────────────────────────────────────────── geometry sigs ──
def _fit_circle(pts):
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    rs = [math.hypot(p[0] - cx, p[1] - cy) for p in pts]
    r = sum(rs) / n
    if r <= 0:
        return None
    dev = max(abs(x - r) for x in rs) / r
    angles = sorted(math.atan2(p[1] - cy, p[0] - cx) for p in pts)
    gaps = [angles[i + 1] - angles[i] for i in range(n - 1)] + [angles[0] + 2 * math.pi - angles[-1]]
    return (cx, cy, r, dev, max(gaps))


def _line_fit(pts):
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - cx) ** 2 for p in pts)
    syy = sum((p[1] - cy) ** 2 for p in pts)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in pts)
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    dx, dy = math.cos(theta), math.sin(theta)
    along = sorted((p[0] - cx) * dx + (p[1] - cy) * dy for p in pts)
    perp = max(abs(-(p[0] - cx) * dy + (p[1] - cy) * dx) for p in pts)
    length = along[-1] - along[0]
    gaps = [along[i + 1] - along[i] for i in range(n - 1)]
    mean = length / (n - 1) if n > 1 else 0
    even = mean > 0 and max(abs(g - mean) for g in gaps) <= 0.25 * mean
    return length, perp, even


def geometry_signatures(circles: list, min_count: int = 4, max_group: int = 800) -> dict:
    """Map circle index → reason for circles in rings / evenly spaced lines.

    `circles` is a list of dicts with `center` and `radius` (metres).
    """
    by_r = defaultdict(list)
    for i, c in enumerate(circles):
        by_r[round(c["radius"], 3)].append(i)
    out = {}
    for r, idxs in by_r.items():
        if len(idxs) < min_count or len(idxs) > max_group:
            continue   # very large equal-circle sets are patterns, not fixture layouts
        pts = [circles[i]["center"] for i in idxs]
        # single-linkage clusters at 3 × median nearest-neighbour spacing
        nn = []
        for a in pts:
            d = min(math.hypot(a[0] - b[0], a[1] - b[1]) for b in pts if b is not a)
            nn.append(d)
        nn_sorted = sorted(nn)
        thr = 3 * nn_sorted[len(nn_sorted) // 2] + 1e-9
        parent = list(range(len(pts)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        for a in range(len(pts)):
            for b in range(a + 1, len(pts)):
                if math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) <= thr:
                    parent[find(a)] = find(b)
        clusters = defaultdict(list)
        for k in range(len(pts)):
            clusters[find(k)].append(k)
        for members in clusters.values():
            if len(members) < min_count:
                continue
            groups = [members]
            mp = [pts[k] for k in members]
            fit = _fit_circle(mp)
            length, perp, even = _line_fit(mp)
            is_line = length > 0 and perp <= max(0.01 * length, 0.005) and even
            if fit and fit[3] > 0.03 and not is_line:
                # concentric rings: split members by distance from the centroid
                cx, cy = fit[0], fit[1]
                ds = sorted((math.hypot(pts[k][0] - cx, pts[k][1] - cy), k) for k in members)
                groups, cur = [], [ds[0]]
                for d, k in ds[1:]:
                    if d - cur[-1][0] > max(0.03 * d, 0.02):
                        groups.append([q for _, q in cur])
                        cur = []
                    cur.append((d, k))
                groups.append([q for _, q in cur])
                groups = [g for g in groups if len(g) >= min_count]
            for g in groups:
                gp = [pts[k] for k in g]
                f = _fit_circle(gp)
                if f and f[3] <= 0.03 and f[4] <= math.pi * 0.75 and f[2] > 2 * r:
                    reason = f"geometry: {len(g)} equal circles (r={r:g} m) on a ring of radius {f[2]:.2f} m"
                    for k in g:
                        out[idxs[k]] = ("ring", reason)
                    continue
                length, perp, even = _line_fit(gp)
                if length > 0 and perp <= max(0.01 * length, 0.005) and even:
                    reason = f"geometry: {len(g)} equal circles (r={r:g} m) evenly spaced on a line"
                    for k in g:
                        out.setdefault(idxs[k], ("line", reason))
    return out


# ─────────────────────────────────────────────────────────── schedules ──
def build_schedule_index(tables: list) -> dict:
    """normalised tag → {table_handle, row_tag, values: {field: (value, header)}, type_text}"""
    index = {}
    for t in tables or []:
        rows = t.get("rows") or []
        if len(rows) < 2:
            continue
        header_idx = 0
        # skip a title row (single filled cell) above the header
        if sum(1 for c in rows[0] if str(c).strip()) <= 1 and len(rows) > 2:
            header_idx = 1
        header = [str(h) for h in rows[header_idx]]
        fields = [_field_for_header(h) for h in header]
        title = " ".join(str(c) for c in rows[0]) if header_idx else ""
        key_col = fields.index("tag") if "tag" in fields else 0
        for row in rows[header_idx + 1:]:
            if key_col >= len(row):
                continue
            key = str(row[key_col]).strip()
            if not key:
                continue
            values = {}
            type_text = title
            for ci, cell in enumerate(row):
                if ci == key_col or ci >= len(fields):
                    continue
                f = fields[ci]
                cell_s = str(cell).strip()
                if not cell_s:
                    continue
                if f == "type":
                    type_text = (type_text + " " + cell_s).strip()
                elif f:
                    values.setdefault(f, (cell_s, header[ci]))
            index.setdefault(_norm_tag(key), {"table_handle": t.get("handle"), "row_tag": key,
                                               "values": values, "type_text": type_text,
                                               "source": t.get("source")})
    return index


# ──────────────────────────────────────────────────────────── recognize ──
def _fields_from_pairs(pairs: dict, provenance_prefix: str, fields: dict, prov: dict,
                       reasons: list, verbatim_label: str):
    for key, raw in pairs.items():
        f = _field_for_header(key)
        if not f or f in ("tag", "type") or raw in (None, ""):
            continue
        if fields.get(f) is not None:
            continue
        if f in NUMERIC_FIELDS:
            v = parse_number(raw, f, key)
            if v is None:
                continue
        elif f in HARDWARE_FIELDS:
            v = str(raw).strip()   # verbatim — never parsed into a different address
        else:
            v = str(raw).strip()
        fields[f] = v
        if f in HARDWARE_FIELDS:
            prov[f] = f"{provenance_prefix} {key} ({verbatim_label})"
        else:
            prov[f] = f"{provenance_prefix} {key}"


def recognize(imp: dict, template: Optional[dict] = None, tag_radius_m: Optional[float] = None) -> dict:
    """Score fountain components in an AF-CAD-010 import result."""
    if isinstance(template, str):
        template = get_template(template)
    if template:
        try:
            template = validate_template(template)
        except ValueError:
            template = None
    radius = float(tag_radius_m or (template or {}).get("tag_radius_m") or 1.5)
    entities = imp.get("entities") or []
    inserts = imp.get("inserts") or []
    tables = imp.get("tables") or []
    outlines = imp.get("closed_outlines") or []

    raw: list = []   # candidate dicts before ids

    def new_cand(source_handle, kind_src, position, z, rotation, block, layer, attribs, xdata):
        return {"source_handle": source_handle, "source_kind": kind_src, "type": None,
                "confidence": 0.0, "reasons": [], "position": [position[0], position[1]],
                "z": z, "rotation_deg": rotation, "block": block, "layer": layer,
                "attribs": dict(attribs or {}), "tag": None,
                "fields": {f: None for f in BASE_FIELDS}, "field_provenance": {},
                "aquaflow_id": None, "_xdata": xdata or {}, "_priority": 99, "_evidence": set()}

    def apply(c, ctype, conf, reason, priority, evidence):
        c["_evidence"].add(evidence)
        if c["type"] is None:
            c["type"], c["_priority"], c["confidence"] = ctype, priority, conf
            c["reasons"].append(reason)
        elif priority < c["_priority"]:          # stronger signal wins
            if c["type"] != ctype:
                c["reasons"].append(f"{reason} — overrides weaker signal ({c['type']})")
                c["confidence"] = conf
            else:
                c["confidence"] = min(0.99, max(conf, c["confidence"]) + 0.02)
                c["reasons"].append(reason)
            c["type"], c["_priority"] = ctype, priority
        elif ctype == c["type"]:
            c["confidence"] = min(0.98, max(c["confidence"], conf) + 0.04)
            c["reasons"].append(reason)
        else:
            c["confidence"] = max(0.05, c["confidence"] - 0.1)
            c["reasons"].append(f"conflicting weaker signal: {reason}")

    def score(c, block_name, layer, attribs, xdata, is_entity_circle=False):
        aq = (xdata or {}).get("AQUAFLOW") or {}
        ignored = False
        # 1. XDATA
        if aq:
            aid = aq.get("id") or aq.get("fixtureId")
            if aid is not None:
                c["aquaflow_id"] = str(aid)
            atype = str(aq.get("type") or aq.get("kind") or "")
            mapped = AQUAFLOW_TYPE_MAP.get(atype.lower())
            if mapped is None:
                cl = classify_name(atype)
                mapped = cl[0] if cl else None
            if mapped is None and aq.get("kind") == "fixture":
                mapped = "nozzle" if "nozzle" in atype.lower() else None
            if mapped:
                apply(c, mapped, 0.99, f"AQUAFLOW XDATA type={atype}", 1, "xdata")
                c["fields"]["aquaflow_type"] = atype
                c["field_provenance"]["aquaflow_type"] = "AQUAFLOW XDATA"
        # 2. template
        tm = _template_match(template, block_name, layer, attribs)
        if tm:
            rule, why = tm
            if rule["type"] == "ignore" and c["_priority"] > 1:
                ignored = True
            elif rule["type"] != "ignore":
                apply(c, rule["type"], 0.95, f"{why} (template {template['name']})", 2, "template")
                for k, v in (rule.get("fields") or {}).items():
                    if k in HARDWARE_FIELDS:
                        continue
                    if c["fields"].get(k) is None:
                        c["fields"][k] = v
                        c["field_provenance"][k] = f"template {template['name']}"
        # 3. attributes
        for k, v in (attribs or {}).items():
            if _field_for_header(k) == "type":
                cl = classify_name(str(v))
                if cl:
                    apply(c, cl[0], 0.88, f"attribute {k}={v}", 3, "attrib")
        if attribs and any(_field_for_header(k) in ("model", "flow_lpm", "height_m") for k in attribs):
            if c["type"]:
                c["confidence"] = min(0.98, c["confidence"] + 0.03)
            c["reasons"].append("attributes " + ", ".join(f"{k}={v}" for k, v in list(attribs.items())[:4]))
        # 4. keywords
        if block_name:
            cl = classify_name(block_name)
            if cl:
                apply(c, cl[0], 0.8, f"block name matches {cl[1]}", 4, "block")
        if layer:
            cl = classify_name(layer)
            if cl:
                conf = 0.62 if not _has_negative(layer) else 0.35
                if is_entity_circle:
                    conf -= 0.02
                apply(c, cl[0], conf, f"layer {layer} matches {cl[1]}", 4, "layer")
        return ignored

    # ── candidates from inserts
    for ins in inserts:
        if ins.get("xref"):
            continue
        name = ins.get("effective_name") or ins.get("block") or ""
        sh = ins.get("instance_id") or ins.get("handle")
        c = new_cand(sh, "insert", ins.get("position", [0, 0]),
                     (ins.get("position") or [0, 0, 0])[2] if len(ins.get("position") or []) > 2 else 0.0,
                     ins.get("rotation_deg", 0.0), name, ins.get("layer", ""),
                     ins.get("attribs"), ins.get("xdata"))
        c["_depth"] = ins.get("depth", 0)
        c["_parent"] = ins.get("parent_handle")
        c["_block_path"] = ins.get("block_path") or []
        if score(c, name, ins.get("layer", ""), ins.get("attribs"), ins.get("xdata")):
            continue
        raw.append(c)

    # ── candidates from top-level circles / points
    circles = [e for e in entities if e.get("kind") == "circle" and not e.get("block_path")]
    sigs = geometry_signatures([c for c in circles if c["radius"] <= 0.25])
    small = [c for c in circles if c["radius"] <= 0.25]
    small_ids = {id(c): i for i, c in enumerate(small)}
    for e in entities:
        if e.get("block_path"):
            continue
        k = e.get("kind")
        if k == "circle":
            pos = e["center"]
        elif k == "point":
            pos = e["position"]
        else:
            continue
        c = new_cand(e.get("handle"), k, pos, e.get("z", 0.0), 0.0, None, e.get("layer", ""),
                     {}, e.get("xdata"))
        if k == "circle":
            c["fields"]["radius_m"] = e["radius"]
        if score(c, None, e.get("layer", ""), {}, e.get("xdata"), is_entity_circle=True):
            continue
        if k == "circle" and id(e) in small_ids and small_ids[id(e)] in sigs:
            _, reason = sigs[small_ids[id(e)]]
            apply(c, "nozzle", 0.5, reason, 5, "geometry")
        if k == "circle" and e["radius"] > 0.25 and c["_priority"] >= 4 and not c["aquaflow_id"]:
            c["type"] = None   # big circles on keyword layers are outlines, not devices
        if c["type"] is None:
            continue
        if k == "point" and c["_priority"] >= 4:
            c["confidence"] = min(c["confidence"], 0.5)
        raw.append(c)

    # ── nested inserts. A parent typed only by its (inherited) layer is a container
    # (e.g. a RING block of nozzles): drop it and keep its typed children. A parent
    # typed by its own block name / attributes / XDATA / template is the device:
    # drop same-type descendants (symbol parts), keep different-type ones.
    typed = [c for c in raw if c["type"]]
    by_handle = {c["source_handle"]: c for c in typed if c["source_kind"] == "insert"}
    has_typed_child = set()
    for c in typed:
        if c["source_kind"] == "insert":
            path = c.get("_block_path", [])
            for k in range(1, len(path) + 1):
                has_typed_child.add("/".join(str(h) for h in path[:k]))
    keep = []
    for c in typed:
        if c["source_kind"] != "insert":
            keep.append(c)
            continue
        if c["_evidence"] <= {"layer"} and c["source_handle"] in has_typed_child:
            continue
        path = c.get("_block_path", [])
        dup = False
        for k in range(1, len(path) + 1):
            p = by_handle.get("/".join(str(h) for h in path[:k]))
            if p and p["type"] == c["type"] and not (p["_evidence"] <= {"layer"}):
                dup = True
                break
        if not dup:
            keep.append(c)

    # ── 6. instance counts
    groups_count = Counter(("block:" + c["block"]) if c["block"] else ("layer:" + (c["layer"] or ""))
                           for c in keep)
    for c in keep:
        key = ("block:" + c["block"]) if c["block"] else ("layer:" + (c["layer"] or ""))
        c["group"] = key
        n = groups_count[key]
        if n >= 4 and c["_priority"] > 1:
            c["confidence"] = min(0.97, c["confidence"] + 0.03)
            c["reasons"].append(f"{n} instances in group {key}")

    # ── tags: own attributes first, then nearest tag text (global greedy)
    sched = build_schedule_index(tables)
    table_boxes = [t.get("bbox") for t in tables if t.get("bbox")]

    def in_table(p):
        return any(b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3] for b in table_boxes)
    for c in keep:
        for k, v in c["attribs"].items():
            if _field_for_header(k) == "tag" and str(v).strip():
                c["tag"] = str(v).strip()
                c["field_provenance"]["tag"] = f"attribute {k}"
                break
    texts = [e for e in entities if e.get("kind") == "text"
             and e.get("source") not in ("ATTRIB", "ACAD_TABLE")
             and (TAG_RE.match(e.get("text", "").strip()) or _norm_tag(e.get("text", "")) in sched)
             and not in_table(e["position"])]
    pairs = []
    cell = max(radius, 1e-6)
    buckets = defaultdict(list)
    for ti, t in enumerate(texts):
        buckets[(math.floor(t["position"][0] / cell), math.floor(t["position"][1] / cell))].append(ti)
    for ci, c in enumerate(keep):
        if c["tag"]:
            continue
        gx, gy = math.floor(c["position"][0] / cell), math.floor(c["position"][1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for ti in buckets.get((gx + dx, gy + dy), ()):
                    t = texts[ti]
                    d = math.hypot(t["position"][0] - c["position"][0], t["position"][1] - c["position"][1])
                    if d <= radius:
                        pairs.append((d, ci, ti))
    pairs.sort()
    used_c, used_t = set(), set()
    for d, ci, ti in pairs:
        if ci in used_c or ti in used_t:
            continue
        used_c.add(ci); used_t.add(ti)
        keep[ci]["tag"] = texts[ti]["text"].strip()
        keep[ci]["field_provenance"]["tag"] = f"text {texts[ti].get('handle')} {d:.2f} m away"
        keep[ci]["reasons"].append(f"tag text '{keep[ci]['tag']}' {d:.2f} m away")

    # ── fields: attributes, then schedule row
    for c in keep:
        _fields_from_pairs(c["attribs"], "attribute", c["fields"], c["field_provenance"],
                           c["reasons"], "verbatim from drawing")
        if c["tag"]:
            row = sched.get(_norm_tag(c["tag"]))
            if row:
                label = f"schedule row {row['row_tag']}"
                _fields_from_pairs({h: v for f, (v, h) in row["values"].items()}, label + " column",
                                   c["fields"], c["field_provenance"], c["reasons"],
                                   "verbatim from schedule")
                c["reasons"].append(f"joined to {label} ({row['source']})")
                cl = classify_name(row["type_text"]) if row["type_text"] else None
                if cl:
                    if cl[0] == c["type"]:
                        c["confidence"] = min(0.98, c["confidence"] + 0.05)
                    elif c["_priority"] >= 4:
                        c["reasons"].append(f"schedule says {cl[0]} (was {c['type']})")
                        c["type"] = cl[0]
                        c["_priority"] = 3
                        c["confidence"] = max(c["confidence"], 0.8)
                else:
                    c["confidence"] = min(0.98, c["confidence"] + 0.02)
        c["confidence"] = round(max(0.0, min(1.0, c["confidence"])), 3)

    candidates = []
    for i, c in enumerate(keep):
        c["id"] = f"cand_{i}"
        for k in ("_xdata", "_priority", "_depth", "_parent", "_block_path", "source_kind",
                  "_evidence"):
            c.pop(k, None)
        out = {"id": c.pop("id")}
        out.update(c)
        candidates.append(out)

    # ── groups
    gstats = defaultdict(lambda: {"types": Counter(), "conf": []})
    for c in candidates:
        g = gstats[c["group"]]
        g["types"][c["type"]] += 1
        g["conf"].append(c["confidence"])
    groups = [{"key": k, "type": v["types"].most_common(1)[0][0], "count": len(v["conf"]),
               "mean_confidence": round(sum(v["conf"]) / len(v["conf"]), 3)}
              for k, v in sorted(gstats.items())]

    basins = _recognize_basins(outlines, candidates)
    pipes = _recognize_pipes(entities)
    land = _recognize_land(entities)
    return {"candidates": candidates, "basins": basins, "pipes": pipes, "land": land,
            "groups": groups, "template_used": (template or {}).get("name")}


def _recognize_basins(outlines: list, candidates: list) -> list:
    from services.cad_import import outline_exclusion, point_in_polygon
    # depth zones, dimensions, measurements, non-pool AQUAFLOW kinds are never basins/islands
    outlines = [o for o in outlines
                if not o.get("excluded", outline_exclusion(o.get("layer", ""), o.get("xdata")))]
    by_handle = {o["handle"]: o for o in outlines}
    xkind = {o["handle"]: str((((o.get("xdata") or {}).get("AQUAFLOW") or {}).get("kind") or "")).lower()
             for o in outlines}
    water = {}
    for o in outlines:
        if xkind[o["handle"]] == "island":
            continue
        if xkind[o["handle"]] in ("pool", "basin"):
            water[o["handle"]] = (0.99, ["AQUAFLOW XDATA kind=pool"])
            continue
        if keyword_hits(o["layer"], ISLAND_TABLE):
            continue
        hits = keyword_hits(o["layer"], WATER_TABLE)
        if hits:
            water[o["handle"]] = (0.85, [f"layer {o['layer']} matches {hits[0][1]}"])
    pts = [c["position"] for c in candidates if c["type"] in ("nozzle", "light", "mist", "fire")]
    for o in outlines:
        if o["handle"] in water or o.get("block_path") or o["area_m2"] < 1.0:
            continue
        inside = sum(1 for p in pts if point_in_polygon(p, o["points"]))
        if inside:
            # only the smallest outline containing the fixtures (not the site boundary)
            child_hit = any(by_handle.get(h) is not None and
                            any(point_in_polygon(p, by_handle[h]["points"]) for p in pts)
                            for h in o.get("hole_handles", []))
            if not child_hit:
                water[o["handle"]] = (0.6, [f"closed outline contains {inside} fountain devices"])
    out = []
    for o in outlines:
        if o["handle"] in water:
            conf, reasons = water[o["handle"]]
            # skip a 'basin' that is itself inside another basin → island candidate handled below
            parent = o.get("parent_handle")
            if parent in water and xkind[o["handle"]] not in ("pool", "basin")                     and not keyword_hits(o["layer"], WATER_TABLE):
                continue
            out.append({"source_handle": o["handle"], "role": "basin", "points": o["points"],
                        "holes": o["holes"],
                        "hole_handles": list(o.get("hole_handles", [])), "area_m2": o["area_m2"],
                        "layer": o["layer"], "confidence": conf, "reasons": reasons})
    basin_handles = {b["source_handle"] for b in out}
    for o in outlines:
        if o["handle"] in basin_handles:
            continue
        parent = o.get("parent_handle")
        isl = keyword_hits(o["layer"], ISLAND_TABLE)
        if xkind[o["handle"]] == "island":
            out.append({"source_handle": o["handle"], "role": "island", "points": o["points"],
                        "holes": o["holes"], "hole_handles": list(o.get("hole_handles", [])),
                        "area_m2": o["area_m2"], "layer": o["layer"], "confidence": 0.99,
                        "reasons": ["AQUAFLOW XDATA kind=island"]
                        + ([f"closed outline inside basin {parent}"] if parent in basin_handles else [])})
        elif parent in basin_handles:
            out.append({"source_handle": o["handle"], "role": "island", "points": o["points"],
                        "holes": o["holes"], "hole_handles": list(o.get("hole_handles", [])),
                        "area_m2": o["area_m2"], "layer": o["layer"],
                        "confidence": 0.85 if isl else 0.7,
                        "reasons": ([f"layer {o['layer']} matches {isl[0][1]}"] if isl else [])
                        + [f"closed outline inside basin {parent}"]})
        elif isl and not o.get("block_path"):
            out.append({"source_handle": o["handle"], "role": "island", "points": o["points"],
                        "holes": o["holes"], "hole_handles": list(o.get("hole_handles", [])),
                        "area_m2": o["area_m2"], "layer": o["layer"], "confidence": 0.5,
                        "reasons": [f"layer {o['layer']} matches {isl[0][1]} (no enclosing basin)"]})
    return out


_DN_RE = re.compile(r"(?:\bDN\s*(\d{2,4}))|(?:[ØФ⌀]\s*(\d{2,4}))|(?:\b(\d{2,4})\s*MM\b)", re.I)
_INCH_RE = re.compile(r"(\d+(?:[.,]\d+)?|\d+/\d+|\d+\s+\d+/\d+)\s*(?:\"|IN\b|INCH|PULG)", re.I)


def _dn_from_text(s: str) -> Optional[int]:
    if not s:
        return None
    m = _DN_RE.search(_fold(s) if "Ø" not in s else s.upper())
    if m:
        v = next(g for g in m.groups() if g)
        return int(v)
    return None


def _material_from_text(s: str) -> Optional[str]:
    f = re.sub(r"[^A-Z0-9-]", "", _fold(s))
    for kw, mat in PIPE_MATERIALS:
        if kw in f:
            return mat
    return None


def _recognize_pipes(entities: list) -> list:
    texts = [e for e in entities if e.get("kind") == "text" and e.get("source") != "ATTRIB"]
    pipe_texts = [t for t in texts if _dn_from_text(t["text"]) or _material_from_text(t["text"])]
    out = []
    for e in entities:
        if e.get("kind") != "polyline" or e.get("block_path"):
            continue
        layer = e.get("layer", "")
        aq = ((e.get("xdata") or {}).get("AQUAFLOW") or {})
        is_pipe = aq.get("kind") == "pipe" or bool(keyword_hits(layer, PIPE_TABLE))
        if not is_pipe:
            continue
        dn = None
        material = None
        prov = {}
        if aq.get("diameterMm"):
            dn = int(round(float(aq["diameterMm"])))
            prov["dn"] = "AQUAFLOW XDATA"
        if dn is None and _dn_from_text(layer):
            dn = _dn_from_text(layer)
            prov["dn"] = f"layer {layer}"
        material = _material_from_text(layer)
        if material:
            prov["material"] = f"layer {layer}"
        if (dn is None or material is None) and pipe_texts:
            pts = e["points"]
            best = None
            for t in pipe_texts:
                d = min(_seg_dist(t["position"], pts[i], pts[i + 1]) for i in range(len(pts) - 1)) \
                    if len(pts) > 1 else math.hypot(t["position"][0] - pts[0][0], t["position"][1] - pts[0][1])
                lim = max(1.0, 5 * (t.get("height") or 0.2))
                if d <= lim and (best is None or d < best[0]):
                    best = (d, t)
            if best:
                t = best[1]
                if dn is None and _dn_from_text(t["text"]):
                    dn = _dn_from_text(t["text"])
                    prov["dn"] = f"text '{t['text']}'"
                if material is None and _material_from_text(t["text"]):
                    material = _material_from_text(t["text"])
                    prov["material"] = f"text '{t['text']}'"
        out.append({"source_handle": e["handle"], "points": e["points"], "closed": e.get("closed", False),
                    "dn": dn, "material": material, "layer": layer, "provenance": prov})
    return out


def _seg_dist(p, a, b) -> float:
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def _recognize_land(entities: list) -> list:
    out = []
    for e in entities:
        if e.get("kind") != "hatch":
            continue
        layer = e.get("layer", "")
        pattern = e.get("pattern", "")
        if keyword_hits(layer, WATER_TABLE) or keyword_hits(pattern, WATER_PATTERN_TABLE):
            continue
        material, why = None, None
        hits = keyword_hits(pattern, LAND_KEYWORDS)
        if hits:
            material, why = hits[0][0], f"hatch pattern {pattern}"
        else:
            hits = keyword_hits(layer, LAND_KEYWORDS)
            if hits:
                material, why = hits[0][0], f"layer {layer}"
        if not material:
            # AquaFlow-written land hatches (either DXF writer) carry kind=land + type.
            aq = ((e.get("xdata") or {}).get("AQUAFLOW") or {})
            if str(aq.get("kind") or "").lower() == "land" and \
                    str(aq.get("type") or "").lower() in LAND_KEYWORDS:
                material, why = str(aq["type"]).lower(), "AQUAFLOW XDATA kind=land"
        if not material:
            continue
        out.append({"source_handle": e["handle"], "material": material, "loops": e["loops"],
                    "layer": layer, "pattern": pattern, "reason": why})
    return out
