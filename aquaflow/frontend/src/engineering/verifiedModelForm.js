// verifiedModelForm.js — AF-NEXT-012 (Fixture data trust)
//
// Turns the "add verified model" form into a backend equipment-registry record
// (POST /api/equipment/models) and checks it with the same trust rules the
// backend enforces, so the user sees problems before submitting. Only
// manufacturer_datasheet and user_measured records are accepted — generic
// estimates stay in the generic library.
import { PROVENANCE_UNITS, SOURCE_MANUFACTURER, SOURCE_MEASURED, validateProvenance } from "../data/fixtureProvenance.js";

export const VERIFIED_KINDS = ["nozzle", "pump", "valve", "light"];

export const POINTS_HINT = {
  nozzle: "pressure_bar, flow_lpm, jet_height_m (one measured point per line)",
  pump: "flow_m3s, head_m (one curve point per line, >= 3 points)",
};

export function emptyVerifiedForm(kind = "nozzle") {
  return {
    kind, source: SOURCE_MEASURED, label: "", model: "", manufacturer: "", fixtureKey: "",
    date: "", revision: "", documentTitle: "", documentUrl: "", documentFile: "",
    confidence: "medium", licence: "", notes: "",
    points: "", kv: "", size: "", powerW: "", dmxChannels: "", voltageV: "", beamAngleDeg: "",
  };
}

/** Parse "a, b, c" lines into number rows; returns { rows, bad } (bad = 1-based line numbers). */
export function parsePointLines(text = "", width = 2) {
  const rows = [];
  const bad = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const nums = t.split(/[,;\t ]+/).filter(Boolean).map(Number);
    if (nums.length < width || nums.some((v) => !Number.isFinite(v))) bad.push(i + 1);
    else rows.push(nums);
  });
  return { rows, bad };
}

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

export function buildVerifiedModelRecord(form) {
  const errors = [];
  const kind = form.kind;
  if (!VERIFIED_KINDS.includes(kind)) errors.push("Choose an equipment kind.");
  if (![SOURCE_MANUFACTURER, SOURCE_MEASURED].includes(form.source)) {
    errors.push("Verified models must be a manufacturer datasheet or a user measurement.");
  }
  if (!String(form.label || "").trim()) errors.push("Label is required.");

  const provenance = {
    source: form.source,
    manufacturer: String(form.manufacturer || "").trim(),
    model: String(form.model || form.label || "").trim(),
    document: { title: String(form.documentTitle || "").trim(), url: String(form.documentUrl || "").trim(), file: String(form.documentFile || "").trim() },
    revision: String(form.revision || "").trim(),
    date: String(form.date || "").trim(),
    units: { ...(PROVENANCE_UNITS[kind] || {}) },
    confidence: form.confidence || "medium",
    licence: String(form.licence || "").trim(),
    notes: String(form.notes || "").trim(),
  };
  errors.push(...validateProvenance(provenance));

  let data = {};
  if (kind === "nozzle") {
    const { rows, bad } = parsePointLines(form.points, 2);
    if (bad.length) errors.push(`Unreadable point line(s): ${bad.join(", ")}.`);
    const pts = rows.map(([pressure, flow, jet]) => ({ pressure, flow, ...(Number.isFinite(jet) ? { jet_height: jet } : {}) }));
    if (pts.length < 2) errors.push("Enter at least 2 measured pressure/flow points.");
    if (pts.some((p) => p.pressure <= 0 || p.flow < 0)) errors.push("Pressure must be > 0 bar and flow >= 0 L/min.");
    data = { nozzle_type: "jet", pressure_flow_points: pts };
  } else if (kind === "pump") {
    const { rows, bad } = parsePointLines(form.points, 2);
    if (bad.length) errors.push(`Unreadable point line(s): ${bad.join(", ")}.`);
    if (rows.length < 3) errors.push("Enter at least 3 flow/head curve points.");
    if (rows.some(([q, h]) => q < 0 || h < 0)) errors.push("Flow and head must be >= 0.");
    data = { flows: rows.map((r) => r[0]), heads: rows.map((r) => r[1]) };
  } else if (kind === "valve") {
    const kv = num(form.kv);
    if (!(kv > 0)) errors.push("Kv must be > 0 (m3/h/sqrt(bar)).");
    data = { kv, ...(form.size ? { size: String(form.size) } : {}) };
  } else if (kind === "light") {
    const ch = num(form.dmxChannels);
    const w = num(form.powerW);
    if (!Number.isInteger(ch) || ch < 0) errors.push("DMX channels must be a whole number >= 0.");
    if (!(w >= 0)) errors.push("Power must be >= 0 W.");
    data = { power_w: w, dmx_channels: ch };
    if (form.voltageV !== "") data.voltage_v = num(form.voltageV);
    if (form.beamAngleDeg !== "") data.beam_angle_deg = num(form.beamAngleDeg);
  }

  const record = {
    kind, label: String(form.label || "").trim(), provenance, data,
    ...(form.fixtureKey ? { fixture_key: form.fixtureKey } : {}),
  };
  return { record, errors };
}
