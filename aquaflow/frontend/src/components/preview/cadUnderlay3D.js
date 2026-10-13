/**
 * cadUnderlay3D.js — AF-CAD-011: the locked CAD underlay on the 3D ground plane.
 *
 * WIRING API (for FountainScene_v6.js — this module does not touch the scene file):
 *
 *   import { createCadUnderlay3D } from './cadUnderlay3D';
 *   import { engineeringToWorld, poolCenter } from '../../engineering/geometryContract';
 *
 *   // underlay = useEngineeringStore.getState().cadUnderlay  (plan-frame JSON, may be null)
 *   const center = poolCenter(geometry, params, poolType);          // SAME centre as the pool
 *   const group = createCadUnderlay3D(underlay, {
 *     toWorld: (p) => engineeringToWorld(p, center),               // plan {x,y} → world {x,z}
 *     elevation: 0.015,                                            // metres above y = 0 (optional)
 *   });
 *   scene.add(group);
 *   group.setLayerVisible('A-SITE', false);   // per-layer toggle (mirrors underlay.layers[].visible)
 *   group.setVisible(false);                  // whole underlay
 *   group.applyVisibility(nextUnderlay);      // re-sync visibility after a store change (no rebuild)
 *   // on underlay/geometry change or scene teardown:
 *   scene.remove(group); group.dispose();
 *
 * Rebuild (dispose + create) when `underlay.items` or the pool centre changes; visibility-only
 * changes can use applyVisibility. Geometry is batched: ONE THREE.LineSegments per
 * layer/colour (draw calls = number of layer/colour pairs). Text items are not drawn in 3D.
 * Lines are unlit, depthWrite=false, so they never occlude water or fixtures.
 */
import * as THREE from 'three';
import { underlayBatches } from '../../engineering/cadUnderlay';

const identityToWorld = (p) => ({ x: p.x, z: p.y });

export function createCadUnderlay3D(underlay, { toWorld = identityToWorld, elevation = 0.015, opacity } = {}) {
  const group = new THREE.Group();
  group.name = 'cad-underlay';
  group.userData.cadUnderlay = true;
  const byLayer = new Map();
  const items = underlay?.items || [];
  const alpha = Math.max(0.05, Math.min(1, Number(opacity ?? underlay?.opacity) || 0.55));

  for (const batch of underlayBatches(underlay)) {
    const positions = [];
    const pushSeg = (ax, ay, bx, by) => {
      const a = toWorld({ x: ax, y: ay }), b = toWorld({ x: bx, y: by });
      positions.push(a.x, elevation, a.z, b.x, elevation, b.z);
    };
    for (const i of batch.items) {
      const item = items[i];
      if (item.kind === 'point') {
        pushSeg(item.x - 0.1, item.y, item.x + 0.1, item.y);
        pushSeg(item.x, item.y - 0.1, item.x, item.y + 0.1);
        continue;
      }
      const p = item.points, count = p.length / 2;
      for (let k = 0; k < count - 1; k++) pushSeg(p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3]);
      if (item.closed && count > 2) pushSeg(p[(count - 1) * 2], p[(count - 1) * 2 + 1], p[0], p[1]);
    }
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(batch.color), transparent: true, opacity: alpha, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `cad-underlay:${batch.layer}`;
    lines.userData.layer = batch.layer;
    lines.renderOrder = 1;
    lines.frustumCulled = true;
    group.add(lines);
    if (!byLayer.has(batch.layer)) byLayer.set(batch.layer, []);
    byLayer.get(batch.layer).push(lines);
  }

  group.setLayerVisible = (name, visible) => {
    (byLayer.get(name) || []).forEach((obj) => { obj.visible = !!visible; });
  };
  group.setVisible = (visible) => { group.visible = !!visible; };
  group.applyVisibility = (next) => {
    group.visible = next?.visible !== false;
    (next?.layers || []).forEach((l) => group.setLayerVisible(l.name, l.visible !== false));
  };
  group.getLayerNames = () => [...byLayer.keys()];
  group.dispose = () => {
    group.children.slice().forEach((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
      group.remove(obj);
    });
    byLayer.clear();
  };
  group.applyVisibility(underlay);
  return group;
}
