// controllerDiscovery.js — pure helpers for the Device Discovery → Controllers tab (AF-DISC).
//
// Everything here is side-effect free so it can be unit-tested in the node
// environment. The rules they encode:
//   * only REAL (drivable) earns green; identification is never drivability;
//   * a port-only result is "port match only" — never a confirmed protocol;
//   * a discovered device is never projected as online/healthy/configured;
//   * only Siemens/Modbus results with a backend prefill can open the PLC panel.

// `detection` is optional: when the row is a port-only hit (an open port, no protocol
// exchange) the badge must not advertise the FAMILY's drivability — we do not even know
// the device is that family yet. Such rows read UNVERIFIED whatever the tier.
export function controllerTierBadge(tier, detection) {
  if (detection && (detection.confidence === "port_only" || detection.stage === "port_open")) {
    return { color: "#f59e0b", label: "UNVERIFIED" };
  }
  switch (tier) {
    case "REAL": return { color: "var(--green)", label: "DRIVABLE" };
    case "GATED": return { color: "#f59e0b", label: "GATED" };
    default: return { color: "var(--red)", label: "IDENTIFY-ONLY" };
  }
}

export function confidenceLabel(confidence, stage) {
  if (confidence === "port_only" || stage === "port_open") return "port match only";
  if (stage === "identity_confirmed") return "identity confirmed";
  if (stage === "data_access_verified") return "data access verified";
  switch (confidence) {
    case "confirmed": return "protocol confirmed";
    case "probable": return "probable";
    default: return "unverified service";
  }
}

export const STAGE_LABELS = {
  host_seen: "host seen",
  port_open: "port open",
  protocol_confirmed: "protocol confirmed",
  identity_confirmed: "identity confirmed",
  data_access_verified: "data access verified",
  configured: "configured",
  commissioned: "commissioned",
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || "unverified";
}

// Discovery never hands the project an online/healthy device. Whatever the
// backend row says, the projection is "unverified" with no health value.
export function discoveredDeviceProjection(d) {
  return {
    id: `discovered-${d.ip}-${d.port}`,
    label: d.label,
    type: d.protocol || d.device_type || "unknown",
    protocol: d.protocol,
    ip: d.ip,
    port: d.port,
    status: "unverified",
    health: null,
    discovery_id: d.discovery_id,
    stage: d.stage || "port_open",
  };
}

// The PLC panel prefill. Only a backend-marked configurable result (a family
// with a REAL driver: Siemens S7, Modbus TCP, Allen Bradley Logix, OPC UA)
// yields one; everything else is identify-only.
const DEFAULT_PLC_PORT = { siemens_s7: 102, modbus_tcp: 502, allen_bradley: 44818, opc_ua: 4840 };
export function plcPrefillFromDetection(d) {
  if (!d || !d.configurable || !d.plc_prefill || !d.plc_prefill.plc_type) return null;
  const p = d.plc_prefill;
  const prefill = {
    name: p.name || `${p.vendor || d.vendor || "PLC"} @ ${d.ip}`,
    plc_type: p.plc_type,
    ip: p.ip || d.ip,
    port: Number(p.port ?? d.port ?? DEFAULT_PLC_PORT[p.plc_type] ?? 502),
    rack: Number(p.rack ?? 0),
    slot: Number(p.slot ?? (p.plc_type === "allen_bradley" ? 0 : 1)),
    unit_id: Number(p.unit_id ?? 1),
    vendor: p.vendor || d.vendor || "",
    model: p.model || d.model || "",
    discovery_id: d.discovery_id || "",
    profile_hint: p.profile_hint || "",
  };
  return prefill;
}

export function isIcanGateway(d) {
  return d?.catalog_id === "ican-music-fountain" || d?.protocol === "ican";
}

export function parseUnitIds(text) {
  const ids = String(text || "")
    .split(/[\s,;]+/)
    .map((t) => parseInt(t, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 247);
  const unique = [...new Set(ids)].slice(0, 8);
  return unique.length ? unique : [1];
}

export function buildDiscoverBody({ adapter, cidr, unitIds, includeIcan = true, includeVirtual = false }) {
  const body = { include_ican: includeIcan !== false, include_virtual: !!includeVirtual, unit_ids: parseUnitIds(unitIds) };
  const c = (cidr || "").trim();
  if (c) body.subnet = c;                 // explicit CIDR wins: only that range is swept
  else if (adapter) body.adapter = adapter;
  return body;
}

export function adapterOptionLabel(a) {
  if (!a) return "";
  const kind = a.kind && a.kind !== "physical" ? ` · ${a.kind}` : "";
  return `${a.name} — ${a.ip}/${a.prefix} (${a.subnet})${kind}`;
}

export function discoveryStatusLine(result) {
  if (!result) return "";
  const parts = [
    `${result.hosts_scanned ?? 0} hosts`,
    `${(result.subnets || []).join(", ") || "no subnet"}`,
    `ports ${(result.tcp_ports || []).join("/")}`,
    `${result.duration_s ?? 0}s`,
    "read-only probes",
  ];
  if (result.cancelled) parts.push("CANCELLED — partial");
  if (result.deadline_hit) parts.push("time budget hit — partial");
  return parts.join(" · ");
}

// Turn a fetch failure / non-2xx into one operator-readable line.
export function describeHttpError(err, fallback = "backend unreachable") {
  if (!err) return fallback;
  const msg = err.message || String(err);
  if (/^HTTP 409/.test(msg)) return "a discovery is already running — cancel it first";
  if (/^HTTP 400/.test(msg)) return msg.replace(/^HTTP 400\s*—?\s*/, "rejected: ");
  if (/^HTTP \d+/.test(msg)) return msg;
  return fallback;
}
