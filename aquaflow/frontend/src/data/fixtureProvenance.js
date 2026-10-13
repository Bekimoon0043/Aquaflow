// fixtureProvenance.js — AF-NEXT-012 (Fixture data trust)
//
// Frontend mirror of backend/services/equipment_provenance.py. One provenance
// schema for every fixture-library item, verified model, BOM line and engineering
// result (see docs/FIXTURE-DATA-PROVENANCE.md):
//
//   { source: "manufacturer_datasheet" | "user_measured" | "generic_estimate",
//     manufacturer, model, document: { title, url, file }, revision, date,
//     units: { quantity: unit }, confidence: "high" | "medium" | "low",
//     licence, notes }
//
// Trust rules: generic estimates are always confidence "low" and always display
// GENERIC_LABEL — never as a manufacturer spec. A "manufacturer_datasheet" claim
// without manufacturer/model/document/revision/licence (or a "user_measured" claim
// without model/date) is downgraded to a generic estimate.

export const SOURCE_MANUFACTURER = "manufacturer_datasheet";
export const SOURCE_MEASURED = "user_measured";
export const SOURCE_GENERIC = "generic_estimate";
export const PROVENANCE_SOURCES = [SOURCE_MANUFACTURER, SOURCE_MEASURED, SOURCE_GENERIC];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"];

export const GENERIC_LABEL = "Generic estimate — verify with supplier datasheet";
export const GENERIC_REVISION = "aquaflow-generic-2026.10";

export const SOURCE_LABELS = {
  [SOURCE_MANUFACTURER]: "Manufacturer datasheet",
  [SOURCE_MEASURED]: "User measured",
  [SOURCE_GENERIC]: GENERIC_LABEL,
};

export const PROVENANCE_UNITS = {
  nozzle: { pressure: "bar", flow: "L/min", jet_height: "m", k_factor: "L/min/sqrt(bar)", orifice: "mm" },
  pump: { flow: "m3/s", head: "m", efficiency: "fraction 0..1", power: "W" },
  valve: { kv: "m3/h/sqrt(bar)", flow: "m3/h", pressure_drop: "bar" },
  light: { power: "W", voltage: "V", dmx_channels: "channels", beam_angle: "deg", luminous_flux: "lm" },
  pipe: { diameter: "m", flow: "m3/s", velocity: "m/s", length: "m" },
  equipment: { flow: "L/min", power: "W", voltage: "V" },
};

const s = (v) => (v === undefined || v === null ? "" : String(v).trim());

function normDocument(raw) {
  if (typeof raw === "string") return /^https?:\/\//.test(raw) ? { title: "", url: raw, file: "" } : { title: raw, url: "", file: "" };
  const d = raw && typeof raw === "object" ? raw : {};
  return { title: s(d.title), url: s(d.url), file: s(d.file) };
}

/** Equipment kind of a library entry / placed fixture (for unit sets). */
export function equipmentKind(fixtureOrEntry = {}) {
  const cat = String(fixtureOrEntry.category || "");
  const key = String(fixtureOrEntry.key || fixtureOrEntry.type || "");
  if (cat === "Nozzles" || /^nozzle/.test(key)) return "nozzle";
  if (cat === "Pumps" || /^pump/.test(key)) return "pump";
  if (cat === "Lights" || /^light|^laser/.test(key)) return "light";
  if (cat === "Valves" || /^valve|^solenoid/.test(key)) return "valve";
  return "equipment";
}

export function genericProvenance({ kind = "equipment", model = "", manufacturer = "", notes = "", units } = {}) {
  return {
    source: SOURCE_GENERIC,
    manufacturer: s(manufacturer),
    model: s(model),
    document: { title: "AquaFlow generic template", url: "", file: "" },
    revision: GENERIC_REVISION,
    date: "",
    units: { ...(units || PROVENANCE_UNITS[kind] || {}) },
    confidence: "low",
    licence: "AquaFlow internal estimate — not supplier data",
    notes: s(notes) || GENERIC_LABEL,
    label: GENERIC_LABEL,
  };
}

/** Problems that stop `raw` being trusted as the source it claims ([] = OK). */
export function validateProvenance(raw) {
  if (!raw || typeof raw !== "object") return ["provenance must be an object"];
  const errors = [];
  const source = s(raw.source);
  if (!PROVENANCE_SOURCES.includes(source)) return [`source must be one of ${PROVENANCE_SOURCES.join(", ")}`];
  const conf = s(raw.confidence);
  if (conf && !CONFIDENCE_LEVELS.includes(conf)) errors.push(`confidence must be one of ${CONFIDENCE_LEVELS.join(", ")}`);
  const doc = normDocument(raw.document);
  if (source === SOURCE_MANUFACTURER) {
    for (const k of ["manufacturer", "model", "revision", "licence"]) {
      if (!s(raw[k])) errors.push(`manufacturer_datasheet requires '${k}'`);
    }
    if (!doc.title && !doc.url && !doc.file) errors.push("manufacturer_datasheet requires a document title, URL or file");
  } else if (source === SOURCE_MEASURED) {
    for (const k of ["model", "date"]) if (!s(raw[k])) errors.push(`user_measured requires '${k}'`);
  } else if (conf && conf !== "low") {
    errors.push("generic_estimate confidence is always 'low'");
  }
  return errors;
}

/** Complete provenance block; missing / invalid trust claims downgrade to generic. */
export function normalizeProvenance(raw, { kind = "equipment", model = "", manufacturer = "" } = {}) {
  if (!raw || typeof raw !== "object" || !Object.keys(raw).length) {
    return genericProvenance({ kind, model, manufacturer });
  }
  const source = s(raw.source);
  const units = raw.units && typeof raw.units === "object" ? raw.units : PROVENANCE_UNITS[kind];
  const problems = validateProvenance(raw);
  if (source !== SOURCE_GENERIC && problems.length) {
    return {
      ...genericProvenance({ kind, model: s(raw.model) || model, manufacturer: s(raw.manufacturer) || manufacturer, notes: s(raw.notes), units }),
      downgradedFrom: source || "unspecified",
      downgradeReason: problems.join("; "),
    };
  }
  if (source === SOURCE_GENERIC) {
    const g = genericProvenance({ kind, model: s(raw.model) || model, manufacturer: s(raw.manufacturer) || manufacturer, notes: s(raw.notes), units });
    if (s(raw.revision)) g.revision = s(raw.revision);
    return g;
  }
  return {
    source,
    manufacturer: s(raw.manufacturer) || manufacturer,
    model: s(raw.model) || model,
    document: normDocument(raw.document),
    revision: s(raw.revision),
    date: s(raw.date),
    units: { ...(units || {}) },
    confidence: s(raw.confidence) || (source === SOURCE_MANUFACTURER ? "high" : "medium"),
    licence: s(raw.licence || raw.license),
    notes: s(raw.notes),
    label: SOURCE_LABELS[source],
  };
}

export const isVerifiedProvenance = (p) => Boolean(p) && (p.source === SOURCE_MANUFACTURER || p.source === SOURCE_MEASURED);

/** Badge text/tone for the UI. Generic items always read GENERIC_LABEL. */
export function provenanceBadge(p) {
  const prov = p && PROVENANCE_SOURCES.includes(p.source) ? p : genericProvenance();
  if (prov.source === SOURCE_MANUFACTURER) {
    return { short: "DATASHEET", label: SOURCE_LABELS[SOURCE_MANUFACTURER], tone: "verified", confidence: prov.confidence,
      title: `${prov.manufacturer} ${prov.model} · ${prov.document?.title || prov.document?.url || prov.document?.file} rev ${prov.revision} · confidence ${prov.confidence}` };
  }
  if (prov.source === SOURCE_MEASURED) {
    return { short: "MEASURED", label: SOURCE_LABELS[SOURCE_MEASURED], tone: "measured", confidence: prov.confidence,
      title: `${prov.model} · measured ${prov.date}${prov.revision ? ` rev ${prov.revision}` : ""} · confidence ${prov.confidence}` };
  }
  return { short: "GENERIC", label: GENERIC_LABEL, tone: "generic", confidence: "low",
    title: `${GENERIC_LABEL}${prov.downgradeReason ? ` (claimed ${prov.downgradedFrom}: ${prov.downgradeReason})` : ""}` };
}

export function unitsText(units) {
  return Object.entries(units || {}).map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Citation attached to BOM lines / calculation results: which equipment model,
 * which data source, which units and which revision.
 */
export function citeProvenance(p, { equipmentModel = "", kind = "equipment", units } = {}) {
  const prov = p && PROVENANCE_SOURCES.includes(p.source) ? p : genericProvenance({ kind, model: equipmentModel });
  const doc = prov.document || {};
  return {
    equipmentModel: s(equipmentModel) || s(prov.model) || "unspecified",
    manufacturer: s(prov.manufacturer),
    dataSource: prov.source,
    sourceLabel: SOURCE_LABELS[prov.source] || GENERIC_LABEL,
    confidence: prov.confidence || "low",
    units: { ...(units || prov.units || PROVENANCE_UNITS[kind] || {}) },
    revision: s(prov.revision) || "unrevisioned",
    document: s(doc.title || doc.url || doc.file),
  };
}

/** Same rule as backend summarize(): how much of a result rests on generic data. */
export function summarizeCitations(citations = []) {
  const bySource = { [SOURCE_MANUFACTURER]: 0, [SOURCE_MEASURED]: 0, [SOURCE_GENERIC]: 0 };
  for (const c of citations) {
    const src = c?.dataSource || c?.data_source || SOURCE_GENERIC;
    bySource[src] = (bySource[src] || 0) + 1;
  }
  const generic = bySource[SOURCE_GENERIC];
  return {
    items: citations.length,
    bySource,
    genericItems: generic,
    allVerified: citations.length > 0 && generic === 0,
    warning: generic ? `${generic} of ${citations.length} item(s) use generic estimates — verify with supplier datasheets before procurement or commissioning.` : "",
  };
}
