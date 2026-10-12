// Siemens device model helpers for the setup wizard and I/O map (pure, unit-tested).
import { FIXTURE_LIBRARY } from "../data/fixtureLibrary";
import { SIEMENS_API } from "./siemensSite";

const LIBRARY = new Map(FIXTURE_LIBRARY.map(item => [item.key, item]));

// Engineering fixtures → the device list the backend turns into Siemens channels.
// Unknown types keep an empty category: the backend then falls back to the type prefix
// instead of guessing (getFixtureType() would silently return the first library entry).
export function engineeringDevices(fixtures = []) {
  return fixtures.filter(f => f?.id && f.type).map(f => ({
    id: f.id, type: f.type, category: LIBRARY.get(f.type)?.category || "",
    label: f.label || f.name || LIBRARY.get(f.type)?.label || f.type,
    x: Number(f.x) || 0, y: Number(f.y) || 0, zone: f.zone || "",
    ...(f.linkedValveId ? { linkedValveId: f.linkedValveId } : {}),
    ...(f.supplyingPumpId ? { supplyingPumpId: f.supplyingPumpId } : {}),
  }));
}

export function designSummary(fixtures = []) {
  const counts = { pumps: 0, valves: 0, nozzles: 0, lights: 0, safety: 0, other: 0 };
  for (const device of engineeringDevices(fixtures)) {
    const category = device.category.toLowerCase();
    const type = device.type.toLowerCase();
    if (category === "pumps" || type.startsWith("pump")) counts.pumps++;
    else if (category === "valves" || type.startsWith("valve")) counts.valves++;
    else if (category === "nozzles" || type.startsWith("nozzle")) counts.nozzles++;
    else if (category === "lights" || type.startsWith("light")) counts.lights++;
    else if (["safety", "sensors"].includes(category) || type.startsWith("safety") || type.startsWith("sensor")) counts.safety++;
    else counts.other++;
  }
  return counts;
}

export const KIND_ICON = { pump: "Ⓟ", valve: "▣", light: "◉", safety: "⛨" };
export const KIND_LABEL = { pump: "Pumps (VFD)", valve: "Valves and the nozzles they feed", light: "RGB lights", safety: "Safety inputs" };

// Plain-language explanations for every Siemens word the operator meets.
export const GLOSSARY = {
  plc: ["PLC", "The industrial computer in the control cabinet. It switches the pumps, valves and lights. AquaFlow tells it what to do; the PLC does the actual switching and the safety checks."],
  s71200: ["S7-1200 G1", "The Siemens PLC family AquaFlow supports: CPUs whose order number has -x40-0XB0 (e.g. 6ES7 215-1AG40-0XB0). The newer S7-1200 G2 (-x50-0XB0) also uses firmware V4.x, so check the order number, not the firmware. G2 and F (safety) CPUs are not supported yet. Siemens stops selling G1 after 1 Oct 2027."],
  s71500: ["S7-1500 / ET 200SP", "Siemens' larger PLC family (and its compact ET 200SP CPU). AquaFlow uses the same program and connection as on the S7-1200: PUT/GET on, DB100 without optimized access, rack 0 / slot 1. Addresses count up from 0 in slot order. Not yet proven on PLCSIM Advanced or real hardware."],
  tia: ["TIA Portal", "Siemens' programming software. It is used once to load the AquaFlow program into the PLC. After that AquaFlow runs the show; TIA can stay closed."],
  plcsim: ["PLCSIM", "A simulated PLC that runs inside TIA Portal on this PC. Use it to prove everything before the real PLC is bought."],
  nettoplcsim: ["NetToPLCsim", "A free helper that makes standard PLCSIM reachable over the network (port 102), so AquaFlow can talk to it like a real PLC."],
  db: ["Data block (DB100)", "A memory area inside the PLC that AquaFlow writes its commands into and reads feedback from. AquaFlow uses DB100 by default."],
  nonoptimized: ["Non-optimized block access", "A DB setting in TIA. AquaFlow reads the DB by byte position, so 'Optimized block access' must be switched OFF for DB100."],
  putget: ["PUT/GET", "A PLC security setting that allows outside programs to read and write data. Turn it on in TIA: CPU properties → Protection & Security → Connection mechanisms → Permit access with PUT/GET."],
  rackslot: ["Rack 0 / Slot 1", "Where the CPU sits. For every S7-1200 this is always rack 0, slot 1. You normally never change it."],
  ip: ["IP address", "The network address of the PLC (for PLCSIM: the Windows PC address NetToPLCsim listens on). AquaFlow connects to port 102."],
  tag: ["PLC tag", "A readable name for one PLC input or output, for example P01_Speed = pump 1 speed. AquaFlow creates the tag table so TIA and AquaFlow use the same names."],
  address: ["Address (%I / %Q / %QW)", "Where a signal is wired: %I0.3 = digital input byte 0 bit 3, %Q8.1 = digital output byte 8 bit 1, %QW64 = analog output word 64. AquaFlow assigns these from the hardware you choose."],
  analog: ["Analog output (0..27648)", "Pump speed goes to the VFD as an analog signal. Siemens uses 0..27648 for 0..100%. The VFD must accept the same signal type (0-10 V or 0/4-20 mA)."],
  vfd: ["VFD", "Variable frequency drive: the box that changes the pump motor speed. The PLC gives it Run (digital) and Speed (analog)."],
  sb: ["Signal board", "A small add-on that clips into the front of the CPU (one per CPU), e.g. SB 1232 AQ1 adds one analog output."],
  sm: ["Signal module", "An I/O module that clips onto the right side of the CPU (slot 2, 3, …), e.g. SM 1222 DQ16 adds 16 digital outputs."],
  safety: ["Safety inputs (1 = OK)", "Emergency stop, water level, motor thermal, drive ready and pressure. Wired so that 1 means healthy; a broken wire reads 0 and stops the fountain."],
  heartbeat: ["Heartbeat", "A counter the PLC increases every 100 ms. If it stops moving, the PLC program is not running and AquaFlow will not start."],
  watchdog: ["Watchdog", "If AquaFlow goes silent for 1 second (cable pulled, PC crash), the PLC switches every output OFF on its own and waits for a fresh OFF command."],
  arm: ["Arm", "A deliberate 'ready to move water' step. AquaFlow checks safety, the PLC program and the heartbeat, then sends an all-OFF command before any show can start."],
  ob: ["OB200 (100 ms cyclic interrupt)", "The PLC block that calls the AquaFlow program exactly every 100 ms. Create it in TIA as a Cyclic interrupt OB with 100 ms."],
  commissioning: ["Commissioning", "Testing every real output on site with a person watching, then recording what happened. Required before physical shows."],
};

export const WIZARD_STEPS = [
  { key: "design", label: "Design", hint: "Use the pumps, valves, nozzles and lights you designed" },
  { key: "hardware", label: "Hardware", hint: "Choose the PLC and modules; AquaFlow assigns the addresses" },
  { key: "wiring", label: "Wiring", hint: "See which PLC tag is which device" },
  { key: "export", label: "Export to TIA", hint: "Load the program and tag table into the PLC" },
  { key: "connect", label: "Connect", hint: "Reach PLCSIM or the real PLC and verify it" },
  { key: "test", label: "Test", hint: "Pulse each device and prove the watchdog" },
  { key: "run", label: "Run show", hint: "Compile your show and run it" },
];

export function wizardProgress(site, { acceptance, status } = {}) {
  const channels = site?.channels || [];
  const required = channels.every(c => c.output && (c.kind !== "pump" || c.enable_output));
  const safety = ["estop_ok", "level_ok", "thermal_ok", "drive_ok", "pressure_ok"].every(k => site?.inputs?.[k]);
  return {
    design: Boolean(site && channels.length),
    hardware: Boolean(site?.hardware),
    wiring: Boolean(site && channels.length && required && safety),
    export: Boolean(site && required),
    connect: Boolean(status?.verified && status?.hardware_verified),
    test: Boolean(acceptance?.passed),
    run: Boolean(site?.show?.clips?.length),
  };
}

const PERMIT_BITS = { estop_ok: 2, level_ok: 4, thermal_ok: 8, drive_ok: 16, pressure_ok: 32 };

// The live value shown next to one I/O point (null = no live data for this point).
export function livePointValue(point, status) {
  if (!status) return null;
  if (point.kind === "safety") {
    if (!status.hardware_verified || status.permit_bits == null) return null;
    return { on: Boolean(status.permit_bits & PERMIT_BITS[point.role]), text: status.permit_bits & PERMIT_BITS[point.role] ? "OK" : "NOT OK" };
  }
  const commanded = status.values?.[point.device_id];
  const feedback = status.feedback_valid ? status.feedback?.[point.device_id] : null;
  switch (point.role) {
    case "pump_speed": return typeof commanded === "number" ? { on: commanded > 0, text: `${commanded.toFixed(0)}%` } : null;
    case "pump_run": return typeof commanded === "number" ? { on: commanded > 0, text: commanded > 0 ? "RUN" : "OFF" } : null;
    case "pump_running": return feedback ? { on: feedback.running, text: feedback.running ? "RUNNING" : "STOPPED" } : null;
    case "pump_fault": return feedback ? { on: !feedback.fault, text: feedback.fault ? "FAULT" : "OK", alarm: feedback.fault } : null;
    case "valve_open": return typeof commanded === "number" ? { on: commanded > 0, text: commanded > 0 ? "OPEN" : "CLOSED" } : null;
    case "valve_feedback": return feedback ? { on: feedback.open, text: feedback.open ? "OPEN" : "CLOSED" } : null;
    case "light_rgb": return commanded && typeof commanded === "object" ? { on: commanded.red + commanded.green + commanded.blue > 0, text: `${commanded.red}/${commanded.green}/${commanded.blue}` } : null;
    default: return null;
  }
}

export function groupPoints(points = []) {
  const devices = new Map();
  for (const point of points) {
    if (!devices.has(point.device_id)) devices.set(point.device_id, { id: point.device_id, kind: point.kind, name: point.device_name, tag: point.tag, nozzleIds: point.nozzle_ids, pumpId: point.pump_id, fixtureId: point.fixture_id, points: [] });
    devices.get(point.device_id).points.push(point);
  }
  const groups = { pump: [], valve: [], light: [], safety: [] };
  for (const device of devices.values()) groups[device.kind]?.push(device);
  return groups;
}

export function missingRequired(points = []) {
  return points.filter(p => p.required && !p.address);
}

export function wiringSheetHtml(site, points = [], bom = []) {
  const esc = value => String(value ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const byModule = new Map();
  for (const point of points) {
    const key = point.module || (point.address ? "Not on the selected hardware (virtual / light interface)" : "NOT WIRED");
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(point);
  }
  const sections = [...byModule.entries()].map(([module, rows]) => `<h2>${esc(module)}</h2><table><thead><tr><th>Address</th><th>Channel</th><th>PLC tag</th><th>Device</th><th>Signal</th><th>Dir.</th><th>Checked</th></tr></thead><tbody>${
    rows.sort((a, b) => String(a.address).localeCompare(String(b.address), undefined, { numeric: true })).map(p => `<tr><td>${esc(p.address || "—")}</td><td>${p.module_channel ?? ""}</td><td>${esc(p.plc_tag)}</td><td>${esc(p.device_name)}</td><td>${esc(p.label)}</td><td>${p.direction === "input" ? "IN" : "OUT"}</td><td>☐</td></tr>`).join("")
  }</tbody></table>`).join("");
  const bomRows = bom.map(b => `<tr><td>${esc(b.position)}</td><td>${esc(b.item)}</td><td>${esc(b.order_number)}</td><td>${esc(b.firmware || "")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Wiring sheet · ${esc(site?.name)}</title><style>
body{font:12px/1.4 Arial,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #111}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.meta{color:#444}
@media print{body{margin:10mm}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
<h1>AquaFlow wiring sheet — ${esc(site?.name)}</h1><div class="meta">Site revision ${esc(site?.revision)} · DB${esc(site?.plc?.db)} · generated ${esc(new Date().toLocaleString())}. Safety inputs are healthy-high: 1 = OK.</div>
${bomRows ? `<h2>PLC hardware</h2><table><thead><tr><th>Position</th><th>Item</th><th>Order number</th><th>Firmware</th></tr></thead><tbody>${bomRows}</tbody></table>` : ""}
${sections}</body></html>`;
}

export async function downloadFrom(path, filename) {
  const response = await fetch(`${SIEMENS_API}${path}`);
  if (!response.ok) {
    let detail = response.statusText;
    try { detail = (await response.json()).detail || detail; } catch { /* binary error */ }
    throw new Error(detail);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function printHtml(html) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 250);
}

// Turn a raw S7 / contract error into what the operator should do next ("" when unknown).
export function explainS7Error(message = "", site = null) {
  const text = String(message);
  const where = site?.plc ? `${site.plc.ip}:${site.plc.port}` : "the PLC address";
  const db = site?.plc?.db ?? 100;
  if (/IncompleteReadError|0 bytes read|connection reset|forcibly closed|WinError 10054/i.test(text))
    return site?.mode === "plcsim"
      ? "NetToPLCsim accepted the connection but hung up, so it cannot reach PLCSIM behind it. Make sure PLCSIM is running with the CPU in RUN, then in NetToPLCsim press Stop Server and Start Server again. The station's PLCSIM IP must be your simulated CPU's address."
      : "The device at that address accepted the connection but hung up. Check that it is the PLC, that PUT/GET is permitted, and rack 0 / slot 1.";
  if (/refused|WinError 10061/i.test(text))
    return `Nothing is listening at ${where}. ${site?.mode === "plcsim" ? "Start NetToPLCsim (Start Server) and use this PC's current network address." : "Check the PLC is powered, on the network, and the IP is right."}`;
  if (/timed out|timeout|unreachable|WinError 1006[05]|WinError 10051/i.test(text))
    return `No answer from ${where}. The address may be wrong — this PC's address changes when you join a different Wi-Fi.`;
  if (/does not match this site's exported TIA package/i.test(text))
    return `The PLC runs a different AquaFlow program than this site (or uses another DB number; this site uses DB${db}). Download the current TIA package (Export step), or set the DB number the PLC really uses.`;
  if (/magic/i.test(text))
    return `DB${db} in the PLC is not the AquaFlow data block. Check the DB number, and that the program from the Export step was downloaded.`;
  if (/heartbeat is not moving/i.test(text))
    return "The PLC answers but its program is not running: put the CPU in RUN and check the 100 ms cyclic block calls the AquaFlow program.";
  if (/already running/i.test(text))
    return "The PLC still runs a previous show. Press STOP, then verify again.";
  return "";
}

export function addressOnThisPc(ip, adapters = []) {
  return adapters.some(adapter => adapter.ip === ip);
}
