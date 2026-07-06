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

export function useEngineeringSync(sceneRef) {
  const lastKeyRef   = useRef(null);
  const syncTimerRef = useRef(null);

  const geometry    = useEngineeringStore(s => s.geometry);
  const params      = useEngineeringStore(s => s.params);
  const poolType    = useEngineeringStore(s => s.poolType);
  const fixtures    = useEngineeringStore(s => s.fixtures);
  const manualPipes = useEngineeringStore(s => s.manualPipes || s.pipes || []);
  const layers      = useEngineeringStore(s => s.layers);
  const lastUpdated = useEngineeringStore(s => s.lastUpdated);

  const pushToScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const key = JSON.stringify({ geometry, params, poolType,
      fx: fixtures.map(f=>({id:f.id,type:f.type,x:f.x,y:f.y,r:f.rotation,e:f.engineering})),
      lv: layers.map(l=>({k:l.key,v:l.visible}))
    });
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

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
  }, [geometry, params, poolType, fixtures, manualPipes, layers]);

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
    hasData: !!geometry || fixtures.length > 0,
    fixtureCount: fixtures.length,
    poolType,
  };
}
