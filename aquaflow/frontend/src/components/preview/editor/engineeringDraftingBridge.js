/**
 * engineeringDraftingBridge.js — AF-CAD-031..033: connects the 3D scene editor to the
 * engineering store through the shared drafting kernel.
 *
 *   createPlanFrame(store)        world (x,z) ⇄ plan (x,y) using the canonical geometry
 *                                 contract + pool centre, the live design for snapping,
 *                                 and commitPipe() — a pipe drafted in 3D is written to the
 *                                 store as ONE shared-history transaction;
 *   createStoreSceneHistory(store) SharedSceneHistory whose undo/redo patch the store.
 *
 * `store` is the zustand engineering store (useEngineeringStore) — injectable for tests.
 */
import { engineeringToWorld, poolCenter, worldToEngineering } from "../../../engineering/geometryContract";
import { patchToStoreFields, sharedDraftingHistory } from "../../../engineering/drafting/commands";
import { SharedSceneHistory } from "./sharedSceneHistory";

const centerOf = (s) => poolCenter(s.geometry, s.params, s.poolType);
const storePipes = (s) => (Array.isArray(s.manualPipes) && s.manualPipes.length ? s.manualPipes : (s.pipes || []));

/** The engineering document fields the 3D editor reads/writes. */
export function storeDocument(s) {
  return { fixtures: s.fixtures || [], siteModels: s.siteModels || [], manualPipes: storePipes(s), groups: s.groups || [] };
}

export function createPlanFrame(store, { history = sharedDraftingHistory } = {}) {
  return {
    toPlan: (world) => {
      const p = worldToEngineering({ x: world.x, y: 0, z: world.z }, centerOf(store.getState()));
      return { x: p.x, y: p.y };
    },
    toWorld: (plan) => engineeringToWorld({ x: plan.x, y: plan.y }, centerOf(store.getState())),
    getDesign: () => {
      const s = store.getState();
      return { fixtures: s.fixtures || [], pipes: storePipes(s), geometry: s.geometry, basins: s.basins, siteSurfaces: s.siteSurfaces };
    },
    commitPipe: (pipe) => {
      const s = store.getState();
      const before = { manualPipes: storePipes(s) };
      const after = { manualPipes: [...before.manualPipes, pipe] };
      history.record({ label: "Add pipe", source: "3d", before, after });
      s.updateEngineering(patchToStoreFields(after));
    },
  };
}

export function createStoreSceneHistory(store, { history = sharedDraftingHistory, flush = null } = {}) {
  return new SharedSceneHistory({
    history,
    flush,
    getPresent: () => storeDocument(store.getState()),
    applyPatch: (patch) => store.getState().updateEngineering(patchToStoreFields(patch)),
  });
}
