import { API_BASE_URL } from "../config";
import { createDefaultEngineeringProject } from "../engineering/engineeringProject";

export const SIEMENS_API = `${API_BASE_URL}/siemens-sites`;

export function siemensPackageName(site) {
  const safe = String(site?.name || "Site").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "Site";
  const version = Number(site?.tia?.version) || 17;
  return `AquaFlow-${safe}-TIA-V${version}-Commissioning.zip`;
}

export function siemensEasyWorkflowState(site, dirty = false) {
  const channels = site?.channels || [];
  const patternReady = Boolean(site?.show?.clips?.length);
  const outputsMapped = Boolean(channels.length) && channels.every(channel =>
    Boolean(channel.output) && (channel.kind !== "pump" || Boolean(channel.enable_output)));
  const safetyMapped = ["estop_ok", "level_ok", "thermal_ok", "drive_ok", "pressure_ok"]
    .every(key => Boolean(site?.inputs?.[key]));
  const connectionReady = ["plcsim", "physical"].includes(site?.mode) && Boolean(site?.plc?.ip) &&
    Number(site?.plc?.port) > 0 && Number(site?.plc?.db) >= 100;
  return { patternReady, outputsMapped, safetyMapped, saved: Boolean(site) && !dirty, connectionReady };
}

export async function siemensRequest(path = "", method = "GET", body) {
  const response = await fetch(`${SIEMENS_API}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : JSON.stringify(result.detail || result));
  return result;
}

export function siemensEngineeringLayout(site) {
  if (site.engineering) return { ...site.engineering, id: site.id, name: site.name };
  const project = createDefaultEngineeringProject();
  const valves = site.channels.filter(c => c.kind === "valve");
  const pumps = site.channels.filter(c => c.kind === "pump");
  const lights = site.channels.filter(c => c.kind === "light");
  return {
    ...project, id: site.id, name: site.name,
    fixtures: [
      ...pumps.map((c, index) => ({ id: c.id, type: "pump_submersible_1_5kw", label: c.name,
        x: 2 + index, y: 6, rotation: 0, groupId: "siemens_pumps", siemensSiteId: site.id })),
      ...valves.flatMap((c, index) => {
        const x = 1 + (index % 16) * .6, y = 2 + Math.floor(index / 16) * .4;
        return [
          { id: c.id, type: "valve_solenoid_dn25_24v", label: c.name, x, y: y + .2, rotation: 0,
            groupId: "siemens_valves", supplyingPumpId: c.pump_id, siemensSiteId: site.id },
          { id: `${c.id}-nozzle`, type: "nozzle_geyser", label: `Nozzle ${index + 1}`, x, y, rotation: 0,
            groupId: "siemens_nozzles", linkedValveId: c.id, supplyingPumpId: c.pump_id, siemensSiteId: site.id },
        ];
      }),
      ...lights.map((c, index) => ({ id: c.id, type: "light_rgb", label: c.name,
        x: 2 + index * .5, y: 3, rotation: 0, groupId: "siemens_lights", siemensSiteId: site.id })),
    ],
  };
}

export function programmerSiemensClips(clips) {
  return clips.map((clip, index) => ({ ...clip, id: `siemens-example-${index}`, effects: [],
    fadeIn: 0, fadeOut: 0, curveType: "linear",
    name: clip.type === "pump_speed" ? "Supplying pump speed" : clip.type === "solenoid_open" ? "Outlet open" : clip.type,
    color: clip.type === "pump_speed" ? "#00d4ff" : clip.type === "solenoid_open" ? "#8b5cf6" : "#f59e0b",
    parameter: "intensity", source: "siemens-example",
    trackId: `${clip.fixtureId}-${clip.type === "pump_speed" ? "speed" : clip.type === "solenoid_open" ? "open" : clip.type.replace("lighting_", "")}`,
  }));
}
