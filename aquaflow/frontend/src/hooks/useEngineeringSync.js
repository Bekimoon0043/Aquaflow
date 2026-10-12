/**
 * useEngineeringSync.js — Engineering ↔ 3D Live Bridge (v2)
 * Fixed coordinate mapping and proper geometry update
 */
import { useEffect, useRef, useCallback } from "react";
import useEngineeringStore from "../store/engineeringStore";
import {
  fixturesToNozzleConfigs,
  geometryToPoolConfig,
  classifyFixtureType,
} from "./fixtureTypeMap";
// AF-HUB-003 — the engineering→3D centering shift goes through the one canonical helper.
import { centerToWorld } from "../engineering/geometryContract";
// AQ-S2-002 Phase 2 — solved hydraulics feed the preview's jet physics.
import { apiPost } from "../utils/apiClient";
import { buildHydraulicPreviewPayload } from "../engineering/hydraulicAdapter";
import { geometryMetrics } from "../engineering/poolGeometry";
import { selectEngineeringPipes } from "../engineering/engineeringProject";
import { toPreviewSiteSurfaces } from "../engineering/siteSurfaces";

export function useEngineeringSync(sceneRef) {
  const lastKeyRef   = useRef(null);
  const lastSceneRef = useRef(null);
  const syncTimerRef = useRef(null);

  const geometry    = useEngineeringStore(s => s.geometry);
  const params      = useEngineeringStore(s => s.params);
  const poolType    = useEngineeringStore(s => s.poolType);
  const fixtures    = useEngineeringStore(s => s.fixtures);
  const siteSurfaces = useEngineeringStore(s => s.siteSurfaces);
  const manualPipes = useEngineeringStore(s => selectEngineeringPipes(s));
  const layers      = useEngineeringStore(s => s.layers);
  const lastUpdated = useEngineeringStore(s => s.lastUpdated);

  const pushToScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const key = JSON.stringify({ geometry, params, poolType,
      // Include every renderer-visible fixture field. Previously, changing height,
      // visibility, tilt or light appearance could be ignored because the cache key
      // only watched plan position and Y rotation.
      fx: fixtures.map(f=>({
        id:f.id, type:f.type, x:f.x, y:f.y, z:f.z,
        r:f.rotation, ry:f.rotationY, tx:f.tiltX, tz:f.tiltZ,
        v:f.visible, c:f.color, i:f.intensity, radius:f.radius,
        zone:f.zone, groupId:f.groupId, e:f.engineering,
      })),
      surfaces: siteSurfaces,
      lv: layers.map(l=>({k:l.key,v:l.visible}))
    });
    if (key === lastKeyRef.current && scene === lastSceneRef.current) return;
    lastKeyRef.current = key;
    lastSceneRef.current = scene;

    // 1. Pool geometry
    const poolConfig = geometryToPoolConfig(geometry, params, poolType);
    if (poolConfig) scene.setPoolGeometry?.(poolConfig);

    // 2. Layer visibility filtering
    const visibleLayers = new Set(
      layers.filter(l => l.visible !== false).map(l => l.key)
    );
        const isLayerVisible = (fixture) => {
  const category = classifyFixtureType?.(fixture?.type);

  switch (category) {
    case "light":
      return visibleLayers.has("lights");

    case "equipment":
      return visibleLayers.has("equipment");

    case "effect":
      return visibleLayers.has("effects") ||
             visibleLayers.has("equipment");

    case "nozzle":
    default:
      return visibleLayers.has("nozzles");
  }
};

const visibleFixtures = fixtures.filter(f => isLayerVisible(f));
const nozzleFixtures = [];
const lightFixtures = [];
const equipmentFixtures = [];
const effectFixtures = [];

for (const f of visibleFixtures) {
  const category = classifyFixtureType?.(f?.type);

  switch (category) {
    case "light":
      lightFixtures.push(f);
      break;

    case "equipment":
      equipmentFixtures.push(f);
      break;

    case "effect":
      effectFixtures.push(f);
      break;

    case "nozzle":
    default:
      nozzleFixtures.push(f);
      break;
  }
}

   // 3. Convert to 3D nozzle configs
const { nozzleConfigs, lightConfigs } =
  fixturesToNozzleConfigs([
    ...nozzleFixtures,
    ...lightFixtures,
    ...effectFixtures,
  ]);

// 3b. Convert Engineering world coordinates → 3D preview coordinates.
// Rule:
// - Engineering keeps the real design coordinates.
// - 3D preview centers the pool at world origin.
// - Therefore, only the 3D preview copy is shifted.
// - The engineering store data must NEVER be modified here.
// getPoolBounds() now delegates to the canonical geometry contract, so its center is
// the single poolCenter() value; centerToWorld() applies exactly that shift.
const bounds = useEngineeringStore.getState().getPoolBounds?.();
const center = bounds ? { cx: bounds.cx, cy: bounds.cy } : null;

const shouldCenterFor3D =
  center && Number.isFinite(center.cx) && Number.isFinite(center.cy);

if (shouldCenterFor3D) {
  nozzleConfigs.forEach(n => { const w = centerToWorld(n, center); n.x = w.x; n.z = w.z; });
  lightConfigs.forEach(l => { const w = centerToWorld(l, center); l.x = w.x; l.z = w.z; });
}

const landscapeVisible = visibleLayers.has("landscape");
scene.setSiteSurfaces?.(
  landscapeVisible ? toPreviewSiteSurfaces(siteSurfaces, center || { cx: 0, cy: 0 }) : []
);

    // 4. Push to scene
    if (scene.setNozzlesFromEngineering) {
      scene.setNozzlesFromEngineering(nozzleConfigs);
    }
    if (scene.setEngineeringLights) {
      scene.setEngineeringLights(lightConfigs);
    }
if (scene.setEngineeringEquipment) {
  scene.setEngineeringEquipment(equipmentFixtures);
}

if (scene.setEngineeringEffects) {
  scene.setEngineeringEffects(effectFixtures);
}

if (scene.setEngineeringPipes) {
  scene.setEngineeringPipes(manualPipes);
}

// 5. AQ-S2-002 Phase 2 — solve the design's hydraulics and hand the per-nozzle
// results to the renderer, so jet heights become CALCULATED rather than
// estimated. Fire-and-forget: the preview must keep rendering (on the legacy
// estimates) if the backend is unreachable or the design is not solvable.
if (scene.setNozzlePhysics && nozzleConfigs.length) {
  const storeState = useEngineeringStore.getState();
  const metrics = geometryMetrics(geometry, params, storeState.depthZones || []);
  const solvePayload = buildHydraulicPreviewPayload({
    fixtures: nozzleFixtures,
    params,
    volumeLitres: metrics.capacityLitres,
  });
  apiPost("/hydraulics/preview-physics", solvePayload)
    .then(res => {
      const phys = res?.nozzle_physics;
      if (phys && Object.keys(phys).length) {
        scene.setNozzlePhysics(phys);
        if (Array.isArray(res.validation) && res.validation.length) {
          // Surface engineering findings without blocking the render.
          console.info("[aquaflow] hydraulic validation:",
            res.validation.map(v => `${v.severity}: ${v.message}`).join(" | "));
        }
      } else {
        scene.setNozzlePhysics(null);   // unsolved -> honest fallback to estimates
      }
    })
    .catch(() => { scene.setNozzlePhysics(null); });
}
  }, [geometry, params, poolType, fixtures, siteSurfaces, manualPipes, layers]);

  useEffect(() => {
    if (!lastUpdated) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(pushToScene, 80);
    return () => clearTimeout(syncTimerRef.current);
  }, [lastUpdated, pushToScene]);

  // Sync on scene mount
  useEffect(() => {
    if (sceneRef.current) pushToScene();
  });

  return {
    hasData: !!geometry || fixtures.length > 0 || siteSurfaces.length > 0,
    fixtureCount: fixtures.length,
    poolType,
  };
}
