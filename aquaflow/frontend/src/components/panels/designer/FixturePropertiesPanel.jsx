/**
 * FixturePropertiesPanel.jsx — the Engineering Designer's fixture properties panel.
 *
 * AF-CAD-030: moved out of PoolGeometryDesigner.jsx; the ten near-identical per-family
 * field blocks are now one table (ENGINEERING_SECTIONS) rendered by one loop — same
 * labels, ranges, colours and keys as before.
 * AF-CAD-034: with more than one fixture selected the panel edits the SHARED fields of the
 * whole selection (rotation, depth zone, group label and every engineering field common to
 * all selected families); a field whose values differ shows "mixed" until it is set.
 */
import { getDefaultEngineering } from "../../../data/fixtureLibrary";
import SiemensFixtureLink from "../siemens/SiemensFixtureLink";
import FixtureTrustPanel from "../FixtureTrustPanel"; // AF-NEXT-012
import { FIXTURE_TYPES } from "../../../engineering/drafting/designerCatalog";
import { MIXED, sharedFieldValues } from "../../../engineering/drafting/selection";

const t = (f) => String(f?.type || "");
const KNOWN_FAMILY = (type) => /^(nozzle|light|pump|valve|solenoid|air|fuel|flame|motion|sensor|safety|control|power|vfd|filter|uv|dosing)/.test(type)
  || ["compressor", "fire", "1d", "2d", "3d", "plc", "dmx"].some((k) => type.includes(k));

/** Engineering field sets per fixture family (order and conditions as in the original panel). */
export const ENGINEERING_SECTIONS = [
  { key: "nozzle", match: (y) => y.startsWith("nozzle"), color: "#ffcc00", fields: [
    ["Flow (LPM)", "flowLpm", 0, 5000, 1], ["Pressure (bar)", "pressureBar", 0, 30, 0.1], ["Jet Height (m)", "jetHeightM", 0, 100, 0.1],
    ["Nozzle Dia. (mm)", "nozzleDiaMm", 1, 500, 1], ["Spray Angle (°)", "sprayAngleDeg", 0, 180, 1],
  ], text: [
    { label: "PLC note", key: "plcChannel", title: "Free-text note. Real Siemens addresses are assigned in Devices → PLC → Siemens Setup and shown below." },
    { label: "Group", key: "group" },
  ], textGrid: true, siemens: true },
  { key: "light", match: (y) => y.startsWith("light"), color: "#ffcc00", fields: [
    ["Wattage (W)", "wattage", 0, 5000, 1], ["Voltage (V)", "voltage", 0, 1000, 1], ["Current (A)", "currentA", 0, 100, 0.1],
    ["Beam Angle (°)", "beamAngleDeg", 0, 180, 1], ["DMX Universe", "dmxUniverse", 1, 32, 1], ["DMX Address", "dmxAddress", 1, 512, 1],
  ], text: [{ label: "Group", key: "group" }] },
  { key: "pump", match: (y) => y.startsWith("pump"), color: "#00ffaa", fields: [
    ["Flow (m³/hr)", "flowM3Hr", 0, 5000, 1], ["Head (m)", "headM", 0, 200, 0.1], ["Power (kW)", "powerKw", 0, 1000, 0.1],
    ["Voltage (V)", "voltage", 0, 1000, 1], ["Efficiency (%)", "efficiency", 0, 100, 1],
  ], text: [] },
  { key: "valve", match: (y) => y.startsWith("valve") || y.startsWith("solenoid"), color: "#00ffaa", fields: [
    ["Diameter (DN)", "diameterMm", 0, 1000, 1], ["Flow Capacity (m³/hr)", "flowM3Hr", 0, 5000, 1], ["Pressure Rating (bar)", "pressureBar", 0, 100, 0.1],
    ["Voltage (V)", "voltage", 0, 1000, 1], ["Power (W)", "wattage", 0, 5000, 1], ["Response Time (ms)", "responseMs", 0, 10000, 10],
  ], text: [{ label: "Control Channel", key: "controlChannel" }] },
  { key: "air", match: (y) => y.startsWith("air") || y.includes("compressor"), color: "#00ffaa", fields: [
    ["Air Flow (L/min)", "airFlowLpm", 0, 50000, 1], ["Pressure (bar)", "pressureBar", 0, 50, 0.1], ["Tank Volume (L)", "tankVolumeL", 0, 10000, 1],
    ["Power (kW)", "powerKw", 0, 1000, 0.1], ["Voltage (V)", "voltage", 0, 1000, 1], ["Noise Level (dB)", "noiseDb", 0, 150, 1],
  ], text: [{ label: "Air Line / Zone", key: "airZone" }] },
  { key: "fuel", match: (y) => y.startsWith("fuel") || y.startsWith("flame") || y.includes("fire"), color: "#ff8844", fields: [
    ["Fuel Flow", "gasFlow", 0, 10000, 0.1], ["Tank Capacity (L)", "tankVolumeL", 0, 50000, 1], ["Operating Pressure (bar)", "pressureBar", 0, 50, 0.1],
    ["Ignition Power (W)", "wattage", 0, 5000, 1], ["Voltage (V)", "voltage", 0, 1000, 1], ["Flame Height (m)", "flameHeightM", 0, 30, 0.1],
  ], text: [{ label: "Safety Interlock / Zone", key: "safetyZone" }] },
  { key: "motion", match: (y) => y.startsWith("motion") || y.includes("1d") || y.includes("2d") || y.includes("3d"), color: "#00ffaa", fields: [
    ["Axis Count", "axisCount", 0, 3, 1], ["Pan Range (°)", "panRangeDeg", 0, 360, 1], ["Tilt Range (°)", "tiltRangeDeg", 0, 180, 1],
    ["Speed (°/s)", "speedDegPerSec", 0, 1000, 1], ["Torque (Nm)", "torqueNm", 0, 10000, 0.1], ["Power (W)", "wattage", 0, 5000, 1], ["Voltage (V)", "voltage", 0, 1000, 1],
  ], text: [{ label: "Motion Control Channel", key: "motionChannel" }] },
  { key: "sensor", match: (y) => y.startsWith("sensor") || y.startsWith("safety"), color: "#00ffaa", fields: [
    ["Digital Inputs", "digitalInputs", 0, 64, 1], ["Digital Outputs", "digitalOutputs", 0, 64, 1], ["Analog Inputs", "analogInputs", 0, 64, 1],
    ["Analog Outputs", "analogOutputs", 0, 64, 1], ["Voltage (V)", "voltage", 0, 1000, 1], ["Current (A)", "currentA", 0, 100, 0.1],
  ], text: [{ label: "Signal Type", key: "signalType", placeholder: "Digital Input / 4-20mA / Analog" }] },
  { key: "control", match: (y) => y.startsWith("control") || y.startsWith("power") || y.startsWith("vfd") || y.includes("plc") || y.includes("dmx"), color: "#00ffaa", fields: [
    ["Rated Power (W)", "wattage", 0, 100000, 1], ["Output Power (W)", "outputPowerW", 0, 100000, 1], ["Voltage (V)", "voltage", 0, 1000, 1],
    ["Current (A)", "currentA", 0, 1000, 0.1], ["DMX Channels", "dmxChannels", 0, 512, 1], ["Digital Inputs", "digitalInputs", 0, 256, 1],
    ["Digital Outputs", "digitalOutputs", 0, 256, 1], ["Analog Inputs", "analogInputs", 0, 256, 1], ["Analog Outputs", "analogOutputs", 0, 256, 1],
  ], text: [{ label: "Protocol / Cabinet Reference", key: "protocol", read: (e) => e.protocol || e.cabinetRef || "", placeholder: "DMX / Modbus / PLC / VFD Panel" }] },
  { key: "treatment", match: (y) => y.startsWith("filter") || y.startsWith("uv") || y.startsWith("dosing"), color: "#00ffaa", fields: [
    ["Flow Capacity (m³/hr)", "flowM3Hr", 0, 5000, 1], ["Pressure Rating (bar)", "pressureBar", 0, 100, 0.1], ["Power (W)", "wattage", 0, 50000, 1],
    ["Voltage (V)", "voltage", 0, 1000, 1], ["Dosing Rate (L/hr)", "dosingRateLHr", 0, 10000, 0.1], ["UV Dose", "uvDose", 0, 10000, 1],
  ], text: [{ label: "Media / Chemical / Lamp Type", key: "mediaType", read: (e) => e.mediaType || e.chemicalType || e.lampType || "", placeholder: "Sand / Cartridge / Chlorine / UV-C" }] },
  { key: "generic", match: (y) => !KNOWN_FAMILY(y), color: "#00ffaa", heading: "Generic Equipment Properties", fields: [
    ["Flow (L/min)", "flowLpm", 0, 50000, 1], ["Flow (m³/hr)", "flowM3Hr", 0, 5000, 1], ["Power (W)", "wattage", 0, 100000, 1],
    ["Power (kW)", "powerKw", 0, 1000, 0.1], ["Voltage (V)", "voltage", 0, 1000, 1], ["Pressure (bar)", "pressureBar", 0, 100, 0.1],
  ], text: [] },
];

const sectionsFor = (type) => ENGINEERING_SECTIONS.filter((s) => s.match(type));

const fieldLabel = { color: "#7ab", fontSize: 8, marginBottom: 2 };
const inputStyle = (color) => ({ width: "100%", padding: "3px 5px", background: "#06121c", color, border: "1px solid #0a3040", borderRadius: 3, fontSize: 10, fontFamily: "monospace" });

function NumberField({ label, value, min, max, step, color, onChange, mixed = false }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={fieldLabel}>{label}</div>
      <input type="number" min={min} max={max} step={step} value={mixed ? "" : (value ?? 0)} placeholder={mixed ? "mixed" : undefined}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value || 0))} style={inputStyle(color)} />
    </div>
  );
}

function TextField({ label, value, onChange, title, placeholder, mixed = false }) {
  return (
    <div>
      <div style={fieldLabel} title={title}>{label}</div>
      <input value={mixed ? "" : (value || "")} placeholder={mixed ? "mixed" : placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} style={inputStyle("#ffcc00")} />
    </div>
  );
}

/** Single-fixture engineering fields (the original panel, table-driven). */
function EngineeringFields({ fixture, engineering, onEngineering }) {
  const type = t(fixture);
  return sectionsFor(type).map((section) => (
    <div key={section.key}>
      {section.heading && <div style={{ color: "#7ab", fontSize: 8, marginBottom: 4 }}>{section.heading}</div>}
      {section.fields.map(([label, key, min, max, step]) => (
        <NumberField key={key} label={label} min={min} max={max} step={step} color={section.color}
          value={engineering[key]} onChange={(v) => onEngineering(key, v)} />
      ))}
      {section.text.length > 0 && (
        <div style={section.textGrid ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 } : undefined}>
          {section.text.map((field) => (
            <TextField key={field.key} label={field.label} title={field.title} placeholder={field.placeholder}
              value={field.read ? field.read(engineering) : engineering[field.key]} onChange={(v) => onEngineering(field.key, v)} />
          ))}
        </div>
      )}
      {section.siemens && <SiemensFixtureLink fixtureId={fixture?.id} />}
    </div>
  ));
}

/** Engineering fields common to every selected family (for multi-edit). */
export function sharedEngineeringFields(fixtures = []) {
  if (!fixtures.length) return [];
  const sets = fixtures.map((f) => new Map(sectionsFor(t(f)).flatMap((s) => s.fields.map((field) => [field[1], { field, color: s.color }]))));
  const [first, ...rest] = sets;
  return [...first.entries()].filter(([key]) => rest.every((m) => m.has(key))).map(([, v]) => v);
}

export default function FixturePropertiesPanel({
  fixtures, selectedIndices = [], params, safeDepthZones, solvedHydraulics, poolMetrics,
  onUpdateFixtures, onApplyTrust, onHydraulics, onDelete, onSelectSimilar, onGroup, onUngroup, groupCount = 0,
}) {
  const selected = selectedIndices.map((i) => fixtures[i]).filter(Boolean);
  if (!selected.length) return null;
  const update = (patchFn, label) => onUpdateFixtures((prev) => prev.map((f, i) => (selectedIndices.includes(i) ? patchFn(f) : f)), label);
  const setEngineering = (key, value) => update((f) => ({ ...f, engineering: { ...(f.engineering || getDefaultEngineering(f.type)), [key]: value } }));
  const actions = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
      <button type="button" onClick={onSelectSimilar} title="Select every fixture of the same type / CAD block"
        style={{ padding: 4, background: "#06121c", color: "#7fd8ff", border: "1px solid #16415a", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>SELECT SIMILAR</button>
      {groupCount > 0
        ? <button type="button" onClick={onUngroup} style={{ padding: 4, background: "#06121c", color: "#ffcc88", border: "1px solid #5a4316", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>UNGROUP</button>
        : <button type="button" onClick={onGroup} disabled={selected.length < 2} style={{ padding: 4, background: "#06121c", color: selected.length < 2 ? "#334455" : "#ffcc88", border: "1px solid #5a4316", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>GROUP</button>}
    </div>
  );

  if (selected.length > 1) {
    const shared = sharedFieldValues(selected, ["rotation", "zone", "engineering.group"]);
    const engFields = sharedEngineeringFields(selected);
    const engValues = sharedFieldValues(selected.map((f) => ({ ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } })), engFields.map(({ field }) => `engineering.${field[1]}`));
    return (
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #0a2030" }} data-testid="multi-fixture-properties">
        <div style={{ color: "#ffcc00", fontSize: 9, marginBottom: 5, fontWeight: "bold" }}>⧉ {selected.length} FIXTURES SELECTED</div>
        {actions}
        <NumberField label="Rotation (°)" min={0} max={360} step={5} color="#ffcc00" value={shared.rotation} mixed={shared.rotation === MIXED}
          onChange={(v) => update((f) => ({ ...f, rotation: v }), "Rotate fixtures")} />
        <div style={{ marginBottom: 5 }}>
          <div style={fieldLabel}>Depth zone</div>
          <select aria-label="Depth zone" value={shared.zone === MIXED ? "" : (shared.zone || "medium")} onChange={(e) => update((f) => ({ ...f, zone: e.target.value }))}
            style={{ width: "100%", padding: "3px", background: "#0a1825", color: "#cce8ff", border: "1px solid #0a2535", borderRadius: 3, fontSize: 9, fontFamily: "monospace" }}>
            {shared.zone === MIXED && <option value="">mixed</option>}
            {safeDepthZones.map((z) => <option key={z.key} value={z.key}>{z.label} ({z.depth}m)</option>)}
          </select>
        </div>
        <TextField label="Group" value={shared["engineering.group"]} mixed={shared["engineering.group"] === MIXED} onChange={(v) => setEngineering("group", v)} />
        {engFields.length > 0 && (
          <div style={{ margin: "8px 0", padding: "7px", background: "#050d14", border: "1px solid #0a3040", borderRadius: 4 }}>
            <div style={{ color: "#ffcc00", fontSize: 9, fontWeight: "bold", marginBottom: 6 }}>⚙ SHARED ENGINEERING DATA</div>
            {engFields.map(({ field: [label, key, min, max, step], color }) => (
              <NumberField key={key} label={label} min={min} max={max} step={step} color={color}
                value={engValues[`engineering.${key}`]} mixed={engValues[`engineering.${key}`] === MIXED} onChange={(v) => setEngineering(key, v)} />
            ))}
          </div>
        )}
        <button type="button" onClick={onDelete} style={{ width: "100%", padding: "4px", background: "#1a0808", color: "#ff4444", border: "1px solid #ff444422", borderRadius: 3, cursor: "pointer", fontSize: 9 }}>
          ✕ Delete {selected.length} fixtures&nbsp;&nbsp;<span style={{ opacity: 0.65 }}>DEL</span>
        </button>
      </div>
    );
  }

  const sf = selected[0];
  const ft = FIXTURE_TYPES.find((type) => type.key === sf.type);
  if (!ft) return null;
  const sfEngineering = { ...getDefaultEngineering(sf.type), ...(sf.engineering || {}) };
  const span = Math.max(params.width, params.length, params.radius || 0) + 2;
  return (
    <div style={{ padding: "8px 10px", borderBottom: "1px solid #0a2030" }}>
      <div style={{ color: ft.color, fontSize: 9, marginBottom: 5, fontWeight: "bold" }}>
        {ft.icon} {sf.label}
      </div>
      {/* AF-NEXT-012: data source badge, solved-result citation, type replacement + control-footprint review */}
      <FixtureTrustPanel fixture={sf} fixtures={fixtures} solvedHydraulics={solvedHydraulics}
        hydraulicParams={params} volumeLitres={poolMetrics.capacityLitres}
        onApply={onApplyTrust} onHydraulics={onHydraulics} />
      {actions}
      {[["X pos (m)", "x"], ["Y pos (m)", "y"], ["Rotation (°)", "rotation"]].map(([label, key]) => (
        <div key={key} style={{ marginBottom: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ color: "#7ab", fontSize: 9 }}>{label}</span>
            <span style={{ color: ft.color, fontSize: 9 }}>{(sf[key] || 0).toFixed(1)}</span>
          </div>
          <input type="range"
            min={key === "rotation" ? 0 : -span}
            max={key === "rotation" ? 360 : span}
            step={key === "rotation" ? 5 : 0.1} value={sf[key] || 0}
            onChange={(e) => update((f) => ({ ...f, [key]: parseFloat(e.target.value) }))}
            style={{ width: "100%" }} />
        </div>
      ))}
      <div style={{ margin: "8px 0", padding: "7px", background: "#050d14", border: "1px solid #0a3040", borderRadius: 4 }}>
        <div style={{ color: "#ffcc00", fontSize: 9, fontWeight: "bold", marginBottom: 6 }}>⚙ ENGINEERING DATA</div>
        <EngineeringFields fixture={sf} engineering={sfEngineering} onEngineering={setEngineering} />
      </div>
      <div style={{ marginBottom: 5 }}>
        <div style={{ color: "#7ab", fontSize: 9, marginBottom: 2 }}>Depth zone</div>
        <select value={sf.zone || "medium"} onChange={(e) => update((f) => ({ ...f, zone: e.target.value }))}
          style={{ width: "100%", padding: "3px", background: "#0a1825", color: "#cce8ff", border: "1px solid #0a2535", borderRadius: 3, fontSize: 9, fontFamily: "monospace" }}>
          {safeDepthZones.map((z) => <option key={z.key} value={z.key}>{z.label} ({z.depth}m)</option>)}
        </select>
      </div>
      <button title="Delete selected fixture · Delete / Backspace" onClick={onDelete}
        style={{ width: "100%", padding: "4px", background: "#1a0808", color: "#ff4444", border: "1px solid #ff444422", borderRadius: 3, cursor: "pointer", fontSize: 9 }}>
        ✕ Delete fixture&nbsp;&nbsp;<span style={{ opacity: 0.65 }}>DEL</span>
      </button>
    </div>
  );
}
