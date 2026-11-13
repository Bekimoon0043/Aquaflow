import { classifyFixtureType } from "../hooks/fixtureTypeMap.js";
import { jetFamilyOf } from "../components/preview/realWorldLook.js";

export const FIXTURE_MODEL_SCHEMA = "aquaflow-fixture-model";
export const FIXTURE_MODEL_VERSION = 1;

const text = (value) => String(value || "").trim();
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function legacyFamily(fixture, category) {
  if (category === "nozzle") return jetFamilyOf({ ...fixture, fixtureType: fixture.type });
  const value = text(fixture.type).toLowerCase();
  if (category === "light") {
    if (value.includes("moving") || value.includes("robotic")) return "moving_head";
    if (value.includes("linear") || value.includes("wash")) return "linear_wash";
    if (value.includes("ring")) return "ring";
    if (value.includes("projector") || value.includes("framing")) return "projector";
    if (value.includes("laser")) return "laser";
    return value.includes("spot") ? "spot" : "point";
  }
  if (value.includes("air") && value.includes("shoot")) return "air_shooter";
  if (value.includes("digital") || value.includes("curtain")) return "digital_curtain";
  if (value.includes("screen")) return "water_screen";
  if (value.includes("motion") || value.includes("robotic")) return "motion";
  if (value.includes("flame") || value.includes("fire")) return "flame";
  if (value.includes("fog") || value.includes("mist")) return "mist";
  return category;
}

function physicsFor(fixture, category) {
  const engineering = object(fixture.engineering);
  const physics = { ...object(fixture.physics) };
  if (category === "nozzle") {
    const outletCount = Number(engineering.orificeCount);
    return {
      ...physics,
      outletCount: Number.isFinite(outletCount) && outletCount > 0 ? Math.round(outletCount) : (physics.outletCount || 1),
      outletDiameterM: physics.outletDiameterM ?? (Number(engineering.outletDiaMm || engineering.nozzleDiaMm) > 0
        ? Number(engineering.outletDiaMm || engineering.nozzleDiaMm) / 1000 : null),
      dischargeCoefficient: physics.dischargeCoefficient ?? engineering.dischargeCoeff ?? null,
      designHeightM: physics.designHeightM ?? engineering.jetHeightM ?? null,
      designFlowM3S: physics.designFlowM3S ?? (Number(engineering.flowLpm) > 0 ? Number(engineering.flowLpm) / 60000 : null),
      designPressurePa: physics.designPressurePa ?? (Number(engineering.pressureBar) > 0 ? Number(engineering.pressureBar) * 1e5 : null),
      sprayAngleDeg: physics.sprayAngleDeg ?? engineering.sprayAngleDeg ?? null,
      breakup: { ...object(physics.breakup) },
      motion: { ...object(physics.motion) },
    };
  }
  return physics;
}

function photometryFor(fixture, category) {
  const engineering = object(fixture.engineering);
  const photometry = { ...object(fixture.photometry) };
  if (category !== "light" && !text(fixture.type).toLowerCase().includes("laser")) return photometry;
  return {
    ...photometry,
    fluxLm: photometry.fluxLm ?? engineering.lumens ?? null,
    beamAngleDeg: photometry.beamAngleDeg ?? engineering.beamAngleDeg ?? null,
    colorMode: photometry.colorMode ?? engineering.colorMode ?? (text(fixture.type).toLowerCase().includes("rgbw") ? "RGBW" : "RGB"),
    profile: photometry.profile ?? null,
    dimmerCurve: photometry.dimmerCurve ?? "linear",
    area: photometry.area ?? null,
  };
}

export function fixtureModelOf(fixture = {}) {
  const category = classifyFixtureType(fixture.type);
  const existing = object(fixture.model);
  return {
    schema: FIXTURE_MODEL_SCHEMA,
    version: FIXTURE_MODEL_VERSION,
    family: text(existing.family) || text(fixture.physics?.family) || legacyFamily(fixture, category),
    type: text(existing.type) || text(fixture.type),
    category,
    physics: physicsFor({ ...fixture, physics: existing.physics }, category),
    photometry: photometryFor({ ...fixture, photometry: existing.photometry }, category),
    visual3d: { ...object(existing.visual3d || fixture.visual3d) },
    capabilities: { ...object(existing.capabilities) },
  };
}

export function withFixtureModel(fixture) {
  if (!fixture || typeof fixture !== "object") return fixture;
  const model = fixtureModelOf(fixture);
  return fixture.model?.schema === FIXTURE_MODEL_SCHEMA && fixture.model?.version === FIXTURE_MODEL_VERSION
    ? fixture
    : { ...fixture, model };
}

export function migrateFixtureModels(project) {
  if (!project || !Array.isArray(project.fixtures)) return project;
  let changed = false;
  const fixtures = project.fixtures.map((fixture) => {
    const next = withFixtureModel(fixture);
    if (next !== fixture) changed = true;
    return next;
  });
  return changed ? { ...project, fixtures } : project;
}

export function modelIssues(fixture) {
  const model = fixtureModelOf(fixture);
  const issues = [];
  if (model.category === "nozzle") {
    if (!(model.physics.outletDiameterM > 0)) issues.push({ field: "physics.outletDiameterM", level: "estimate", text: "Outlet diameter is required for physical breakup." });
    if (!(model.physics.designPressurePa > 0)) issues.push({ field: "physics.designPressurePa", level: "estimate", text: "Nozzle pressure is required for pressure-derived launch velocity." });
  }
  if (model.category === "light" && !(model.photometry.fluxLm > 0)) {
    issues.push({ field: "photometry.fluxLm", level: "estimate", text: "Luminous flux is required for photometric lighting." });
  }
  return issues;
}
