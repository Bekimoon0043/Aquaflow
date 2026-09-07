// plcConfig.js — pure helpers for the PLC panel's Connect tab (AF-DISC).
//
//   * a discovery prefill only fills the form — it never connects, saves or arms;
//   * a Siemens tag profile is sent ONLY when the operator selected AND confirmed it;
//   * Modbus verification reads only points the operator typed — no guessed addresses;
//   * verification outcomes are shown by their backend code, never softened.

export const PREFILL_KEY = "aquaflow.plcPrefill";
export const PREFILL_EVENT = "aquaflow:configure-plc";

export function applyPlcPrefill(form, prefill) {
  if (!prefill || !prefill.plc_type) return form;
  return {
    ...form,
    name: prefill.name || form.name,
    plc_type: prefill.plc_type,
    ip: prefill.ip || form.ip,
    port: Number(prefill.port ?? form.port),
    rack: Number(prefill.rack ?? form.rack ?? 0),
    slot: Number(prefill.slot ?? form.slot ?? 1),
    unit_id: Number(prefill.unit_id ?? form.unit_id ?? 1),
    prefilled_from: prefill.discovery_id || "discovery",
    prefill_vendor: prefill.vendor || "",
    prefill_model: prefill.model || "",
  };
}

export function buildConnectBody(form, wireType, { profileId = "", profileConfirmed = false } = {}) {
  const body = {
    id: `plc-${Date.now()}`,
    name: form.name,
    plc_type: wireType,
    ip: form.ip,
    port: Number(form.port),
    rack: Number(form.rack ?? 0),
    slot: Number(form.slot ?? 1),
    unit_id: Number(form.unit_id ?? 1),
  };
  if (wireType === "siemens_s7" && profileId) {
    body.profile_id = profileId;
    body.confirm_profile = !!profileConfirmed;
  }
  return body;
}

// A Siemens profile needs an explicit confirmation before Connect is allowed.
export function profileGateSatisfied(wireType, profileId, confirmed) {
  if (wireType !== "siemens_s7") return true;
  if (!profileId) return true;          // connecting without tags is allowed (nothing is read)
  return !!confirmed;
}

// "30001,input_register" / "%MW10 holding_register" / "3 discrete_input" — one per line.
export function parseModbusPoints(text) {
  const kinds = { ir: "input_register", input: "input_register", input_register: "input_register",
                  hr: "holding_register", holding: "holding_register", holding_register: "holding_register",
                  di: "discrete_input", discrete: "discrete_input", discrete_input: "discrete_input" };
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [address, kindRaw, countRaw] = line.split(/[\s,;]+/);
      const kind = kinds[(kindRaw || "").toLowerCase()] || "input_register";
      const count = Math.max(1, Math.min(16, parseInt(countRaw || "1", 10) || 1));
      return { id: `p${i + 1}:${address}`, address, kind, count };
    });
}

export const VERIFY_OUTCOME_STYLE = {
  verified: { color: "var(--green)", label: "VERIFIED" },
  heartbeat_static: { color: "#f59e0b", label: "READABLE — PROGRAM NOT RUNNING" },
  partial: { color: "#f59e0b", label: "PARTIAL" },
  no_points: { color: "var(--text-muted)", label: "NOTHING READ" },
};

export function verifyOutcomeStyle(outcome) {
  return VERIFY_OUTCOME_STYLE[outcome] || { color: "var(--red)", label: String(outcome || "failed").replace(/_/g, " ").toUpperCase() };
}

export function verifySummary(result) {
  if (!result) return "";
  const bits = [verifyOutcomeStyle(result.outcome).label];
  if (result.heartbeat && Array.isArray(result.heartbeat.samples) && result.heartbeat.samples.length) {
    bits.push(`heartbeat ${result.heartbeat.samples.join(" → ")}${result.heartbeat.changed ? " (moving)" : " (static)"}`);
  }
  if (Array.isArray(result.fields) && result.fields.length) {
    const ok = result.fields.filter((f) => f.status === "ok").length;
    bits.push(`${ok}/${result.fields.length} fields read`);
  }
  if (result.identity && result.identity.order_number) bits.push(result.identity.order_number);
  return bits.join(" · ");
}
