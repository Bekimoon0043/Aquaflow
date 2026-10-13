/**
 * sceneBasin.js — basin, water surface and site-surface construction for
 * FountainScene (AF-3D-021: moved out of FountainScene_v6.js).
 *
 * Functions take the live FountainScene as `scene` and set the same fields the
 * methods always did. AF-3D-017 / AF-CAD-013 additions: islands (geometry.holes)
 * cut the floor, water and basin mask; optional geometry.floorLevel / wallHeight
 * drive the floor and wall heights.
 */
import {
  basinRings,
  centeredPoolPoints,
  centeredPoolHoles,
  deckWithOpening,
  maskedWaterGeometry,
  polygonWaterGeometry,
  poolPerimeterSegments,
  poolPolygonBounds,
  poolShapeGeometry,
} from "./basinGeometry";
import { basinMaskForPool, clipGeometryToMask, createBasinMask } from "./basinMask";
import { basinsInWorld } from "../../engineering/basins";
import { poolCenter } from "../../engineering/geometryContract";

/**
 * AF-NEXT-010: every basin of a multi-basin design in the world frame. The world origin
 * stays the primary basin's centre (poolCenter(geometry)), the same shift fixtures use, so
 * extra basins and their islands sit exactly where the designer drew them. Null for a
 * single-basin design (which keeps the historical path bit-for-bit).
 */
export function multiBasinWorld(geom) {
  const basins = geom?.basins;
  if (!Array.isArray(basins) || basins.length < 2 || !geom.geometry) return null;
  const world = basinsInWorld(basins, poolCenter(geom.geometry, geom.params || {}, geom.poolType));
  if (world.length < 2) return null;
  let ex = 0, ez = 0;
  basinRings(world).forEach(ring => ring.forEach(p => { ex = Math.max(ex, Math.abs(p.x)); ez = Math.max(ez, Math.abs(p.y)); }));
  return { primary: world[0], extra: world.slice(1), all: world, width: ex * 2, length: ez * 2 };
}
import { applyStoneMaps } from "./groundTextures";
import { WATER_VERT_V2, WATER_FRAG_V2, MAX_RIPPLES } from "./sceneShaders";
import { createCadUnderlay3D } from "./cadUnderlay3D";

// ── Pool / surface / lasers / venue ─────────────────────────────────────
export function buildPool(scene) {
  const T=scene.THREE;
  const geom=scene.poolGeometry;
  if (scene._poolObjects) scene._poolObjects.forEach(o => { if(o.parent) o.parent.remove(o); });
  scene._poolObjects = [];

  let poolRadius=6, poolW=12, poolL=8, poolType='circular', poolPoints=[], poolHoles=[];
  if (geom?.params) {
    poolRadius=geom.params.radius||6;
    poolW=geom.params.width||12;
    poolL=geom.params.length||8;
    const t=geom.poolType||'circular';
    const polygon = centeredPoolPoints(geom.geometry?.points || []);
    const polygonal = (t==='lshape'||t==='freeform'||t==='false_lake'||t==='false_river') && polygon.length >= 3;
    poolType = polygonal ? 'freeform' : t==='rectangular' || t==='lshape' || t==='freeform'
      || t==='false_lake' || t==='false_river' ? 'rectangular' : t==='elliptical' ? 'ellipse' : t;
    if (polygonal) {
      poolPoints = polygon;
      // Islands, centred by the same rule as the outline (AF-CAD-013).
      poolHoles = centeredPoolHoles(geom.geometry?.points || [], geom.geometry?.holes || []);
      const bounds = poolPolygonBounds(poolPoints);
      poolW = bounds?.width || poolW;
      poolL = bounds?.length || poolL;
    }
  }
  const multi = multiBasinWorld(geom);
  if (multi) {
    // Symmetric extents about the origin: splash bounds, height field and venue cover every basin.
    poolType = 'freeform'; poolPoints = multi.primary.outer; poolHoles = multi.primary.holes;
    poolW = multi.width; poolL = multi.length;
  }
  scene._poolRadius=poolRadius; scene._poolW=poolW; scene._poolL=poolL; scene._poolType=poolType;
  scene._poolPoints=poolPoints;
  scene._poolHoles=poolHoles;
  scene._extraBasins = multi ? multi.extra : [];
  scene._basinMask?.dispose?.();
  scene._basinMask = multi
    ? createBasinMask(multi.all.map(b => ({ outer: b.outer, holes: b.holes })))
    : poolType === 'freeform'
      ? basinMaskForPool({ type: 'freeform', points: poolPoints, holes: poolHoles }) : null;

  // Optional design heights. Defaults reproduce the historical basin exactly: floor
  // at -0.45 m, wall from the floor up to the 0.45 m kerb, coping on top.
  const levels = basinLevels(geom?.geometry);
  scene._poolFloorY = levels.floorY;

  const gt = scene._ensureGroundTextures();

  const deckMat = new T.MeshStandardMaterial({ color:0x10151b, roughness:0.78, metalness:0.12 });
  if (gt) { applyStoneMaps(deckMat, gt.deck); deckMat.metalness = 0.05; }
  const deckExtent = multi ? Math.max(80, Math.max(poolW, poolL) + 20) : 80;
  const deck = new T.Mesh(deckWithOpening(T, { poolType, radius: poolRadius, width: poolW, length: poolL, points:poolPoints,
    extraBasins: scene._extraBasins }, deckExtent), deckMat);
  deck.rotation.x=-Math.PI/2; deck.position.y=-0.02; deck.receiveShadow=true;
  scene.scene.add(deck); scene._poolObjects.push(deck);

  const wallGeo = poolType==='circular'
    ? new T.CylinderGeometry(poolRadius+0.18, poolRadius+0.18, 0.45, 64, 1, true)
    : new T.BoxGeometry(poolW+0.35, 0.45, poolL+0.35);
  const wallMat = new T.MeshStandardMaterial({ color:0x252535, roughness:0.65, metalness:0.25 });
  if (gt) {
    applyStoneMaps(wallMat, poolType === 'circular' ? gt.wallCyl : gt.wallBox, { normalScale: 0.6 });
    wallMat.metalness = 0.08;
  }
  const wall = new T.Group();
  if (poolType === 'circular') {
    const shell = new T.Mesh(wallGeo, wallMat);
    wallMat.side = T.DoubleSide;
    wall.add(shell);
  } else if (poolType === 'freeform') {
    wallGeo.dispose();
    [poolPoints, ...poolHoles].flatMap(ring => poolPerimeterSegments(ring)).forEach(segment => {
      const side = new T.Mesh(new T.BoxGeometry(segment.length + 0.14, levels.wallHeight, 0.18), wallMat);
      side.position.set(segment.x, levels.wallCenterY, segment.z);
      side.rotation.y = -segment.rotation;
      side.castShadow = true;
      wall.add(side);
    });
  } else {
    wallGeo.dispose();
    // Four walls, not a solid box whose top occludes the whole basin.
    for (const [w, l, x, z] of [[poolW+0.35,0.18,0,poolL/2+0.09], [poolW+0.35,0.18,0,-poolL/2-0.09], [0.18,poolL,poolW/2+0.09,0], [0.18,poolL,-poolW/2-0.09,0]]) {
      const side = new T.Mesh(new T.BoxGeometry(w, levels.wallHeight, l), wallMat);
      side.position.set(x, levels.wallCenterY, z); side.castShadow = true; wall.add(side);
    }
  }
  wall.position.y=0;
  scene.scene.add(wall); scene._poolObjects.push(wall);

  const copingMat = new T.MeshStandardMaterial({color:0x999aaa,roughness:0.2,metalness:0.7});
  // Polished stone, not chrome: with a real albedo the high metalness read as
  // smoked mirror and swallowed the texture.
  if (gt) { applyStoneMaps(copingMat, gt.coping, { normalScale: 0.4 }); copingMat.metalness = 0.22; }
  if (poolType==='circular') {
    const coping = new T.Mesh(new T.TorusGeometry(poolRadius+0.18,0.09,8,64), copingMat);
    // A torus is generated standing in the XY plane. Without this rotation the pool
    // rim was installed VERTICALLY — a giant archway hooping over the water, its
    // lower half buried under the deck. Only circular pools build a torus coping,
    // which is why rectangular layouts (box copings) never showed it.
    coping.rotation.x = -Math.PI/2;
    coping.position.y=0.46; scene.scene.add(coping); scene._poolObjects.push(coping);
  } else if (poolType==='freeform') {
    [poolPoints, ...poolHoles].flatMap(ring => poolPerimeterSegments(ring)).forEach(segment => {
      const coping = new T.Mesh(new T.BoxGeometry(segment.length + 0.12, 0.09, 0.22), copingMat);
      coping.position.set(segment.x, levels.copingY, segment.z);
      coping.rotation.y = -segment.rotation;
      scene.scene.add(coping); scene._poolObjects.push(coping);
    });
  } else {
    const s1 = poolW + 0.35;
    const s2 = poolL + 0.35;
    const c1 = new T.Mesh(new T.BoxGeometry(s1,0.09,0.18), copingMat);
    c1.position.set(0,levels.copingY, poolL/2+0.175); scene.scene.add(c1); scene._poolObjects.push(c1);
    const c2 = new T.Mesh(new T.BoxGeometry(s1,0.09,0.18), copingMat);
    c2.position.set(0,levels.copingY,-poolL/2-0.175); scene.scene.add(c2); scene._poolObjects.push(c2);
    const c3 = new T.Mesh(new T.BoxGeometry(0.18,0.09,s2), copingMat);
    c3.position.set(poolW/2+0.175,levels.copingY,0); scene.scene.add(c3); scene._poolObjects.push(c3);
    const c4 = new T.Mesh(new T.BoxGeometry(0.18,0.09,s2), copingMat);
    c4.position.set(-poolW/2-0.175,levels.copingY,0); scene.scene.add(c4); scene._poolObjects.push(c4);
  }

  const floorGeo = poolType==='circular' ? new T.CircleGeometry(poolRadius,64)
    : poolType==='freeform' ? poolShapeGeometry(T, poolPoints, poolHoles)
    : new T.PlaneGeometry(poolW,poolL);
  const floorMat = new T.MeshStandardMaterial({color:0x08101e,roughness:0.95});
  // Mosaic basin lining — visible through the water and under the caustics.
  if (gt) applyStoneMaps(floorMat, gt.basin, { normalScale: 0.45 });
  const floor = new T.Mesh(floorGeo,floorMat);
  floor.rotation.x=-Math.PI/2; floor.position.y=levels.floorY;
  scene.scene.add(floor); scene._poolObjects.push(floor);

  // Island tops: solid deck at kerb height inside each hole.
  poolHoles.forEach(hole => {
    const top = new T.Mesh(poolShapeGeometry(T, hole), deckMat);
    top.rotation.x = -Math.PI / 2; top.position.y = levels.kerbY; top.receiveShadow = true;
    scene.scene.add(top); scene._poolObjects.push(top);
  });

  // AF-NEXT-010: extra basins — floor, walls, coping and island tops at their own levels.
  scene._extraBasins.forEach(b => buildExtraBasin(scene, b, { wallMat, copingMat, floorMat, deckMat }));

  const gridHelper = new T.GridHelper(40,40,0x263447,0x101b29);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.32;
  gridHelper.position.y=-0.5; scene.scene.add(gridHelper); scene._poolObjects.push(gridHelper);

  // The shadow frustum is sized from the pool, which only exists now.
  scene._refitShadows();
}

export function disposeSiteSurfaces(scene) {
  if (!scene._siteSurfaceGroup) return;
  scene._siteSurfaceGroup.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
    else object.material?.dispose?.();
  });
  scene._siteSurfaceGroup.parent?.remove(scene._siteSurfaceGroup);
  scene._siteSurfaceGroup = null;
}

export function buildSiteSurfaces(scene) {
  scene._disposeSiteSurfaces();
  if (!scene.scene || !Array.isArray(scene._siteSurfaces) || !scene._siteSurfaces.length) return;
  const T = scene.THREE;
  const group = new T.Group();
  group.name = "Engineering Site Surfaces";

  const presets = {
    grass:  { color: 0x4f8a3c, roughness: 0.96, metalness: 0.0 },
    paving: { color: 0x999287, roughness: 0.82, metalness: 0.03 },
    soil:   { color: 0x775137, roughness: 1.0, metalness: 0.0 },
    rock:   { color: 0x6f747b, roughness: 0.9, metalness: 0.02 },
    sand:   { color: 0xc4ad78, roughness: 1.0, metalness: 0.0 },
  };

  scene._siteSurfaces.forEach((surface, surfaceIndex) => {
    const points = Array.isArray(surface?.points) ? surface.points : [];
    if (surface?.visible === false || points.length < 3) return;
    const shape = new T.Shape();
    shape.moveTo(Number(points[0].x || 0), -Number(points[0].z || 0));
    points.slice(1).forEach((point) => shape.lineTo(Number(point.x || 0), -Number(point.z || 0)));
    shape.closePath();

    const preset = presets[surface.type] || presets.grass;
    const material = new T.MeshStandardMaterial({
      color: surface.color || preset.color,
      roughness: preset.roughness,
      metalness: preset.metalness,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new T.Mesh(new T.ShapeGeometry(shape), material);
    mesh.name = surface.label || `Site Surface ${surfaceIndex + 1}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012 + Math.max(-0.01, Math.min(2, Number(surface.elevation || 0)));
    mesh.receiveShadow = true;
    group.add(mesh);

    const borderPoints = points.map((point) => new T.Vector3(
      Number(point.x || 0),
      mesh.position.y + 0.008,
      Number(point.z || 0),
    ));
    borderPoints.push(borderPoints[0].clone());
    const border = new T.Line(
      new T.BufferGeometry().setFromPoints(borderPoints),
      new T.LineBasicMaterial({ color: material.color.clone().multiplyScalar(1.35) }),
    );
    border.name = `${mesh.name} Border`;
    group.add(border);
  });

  scene._siteSurfaceGroup = group;
  scene.scene.add(group);
}

export function buildWaterSurface(scene) {
  const T=scene.THREE;
  scene._syncHeightFieldPool();
  if (scene.waterSurface?.parent) scene.waterSurface.parent.remove(scene.waterSurface);
  const segs=48;
  // Both shapes use a tessellated PLANE; a circular basin is cut to shape in the
  // fragment stage. CircleGeometry is a fan with vertices only on its rim, so it
  // had no interior to displace — round pools were flat no matter how the waves
  // were tuned, and ripples would have been invisible on them entirely.
  const geo = scene._poolType==='circular'
    ? new T.PlaneGeometry(scene._poolRadius*2, scene._poolRadius*2, 96, 96)
    : scene._poolType==='freeform' && scene._extraBasins?.length
      ? maskedWaterGeometry(T, scene._basinMask, 160)       // every basin, islands cut out
      : scene._poolType==='freeform'
        ? clipGeometryToMask(polygonWaterGeometry(T, scene._poolPoints, 112), scene._basinMask)
        : new T.PlaneGeometry(scene._poolW, scene._poolL, segs, segs);

  scene.waterMat = new T.ShaderMaterial({
    vertexShader: WATER_VERT_V2, fragmentShader: WATER_FRAG_V2,
    transparent:true, side:T.FrontSide, depthWrite:false,
    uniforms:{
      uTime:           {value:0},
      uIntensity:      {value:1.0},
      uWind:           {value:0},
      uLightColor:     {value:new T.Color(0x0066ff)},
      uLightIntensity: {value:0.5},
      uDeepColor:      {value:new T.Color(0x010c1c)},
      uShallowColor:   {value:new T.Color(0x0c3558)},
      uSkyColor:       {value:new T.Color(0x030810)},
      uRoughness:      {value:0.3},
      uCameraPos:      {value:new T.Vector3()},
      // Planar reflection. Strength stays 0 until a probe has actually rendered a
      // frame, so the water falls back to the flat sky term rather than sampling an
      // empty target and going black.
      uReflectTex:      {value: scene._reflection ? scene._reflection.texture : null},
      uReflectMatrix:   {value: scene._reflection ? scene._reflection.textureMatrix : new T.Matrix4()},
      uReflectStrength: {value: 0.0},
      // Refraction onto the basin floor + the impact-ripple ring buffer (R3).
      uFloorTex:    {value: scene._groundTex?.basin?.map || null},
      uHasFloorTex: {value: scene._groundTex?.basin?.map ? 1.0 : 0.0},
      uFloorY:      {value: scene._poolFloorY ?? -0.45},
      uFloorScale:  {value: 2.0},
      // Water's extinction coefficients: red is absorbed roughly an order of
      // magnitude faster than blue, which is why depth reads blue-green.
      uAbsorb:      {value: new T.Vector3(0.46, 0.09, 0.06)},
      uPoolShape:   {value: new T.Vector4(
        scene._poolType === 'circular' ? 1 : 0,
        scene._poolRadius || 6, scene._poolW || 12, scene._poolL || 8)},
      uRipples:     {value: Array.from({length: MAX_RIPPLES}, () => new T.Vector4())},
      uRippleCount: {value: 0},
      uHeightTex:   {value: scene._heightTex || null},
      uHeightEnabled: {value: scene._heightTex ? 1.0 : 0.0},
      uHeightTexel: {value: 1 / Math.max(1, scene._heightField?.resolution || 1)},
      uWaveExtent:  {value: scene._heightField?.extent || 32},
      uWaveHeightScale: {value: scene._heightField?.maxHeight || 0.22},
      ...scene._fieldLights.uniforms,
    }
  });
  scene.waterSurface = new T.Mesh(geo, scene.waterMat);
  scene.waterSurface.rotation.x=-Math.PI/2;
  scene.waterSurface.position.y=0.02;
  scene.scene.add(scene.waterSurface);
  // Environment is built before the water on init; initialize these here too.
  scene._setWaterPalette();
}

/** One extra basin of a multi-basin design (world-centred plan rings, own levels). */
export function buildExtraBasin(scene, basin, { wallMat, copingMat, floorMat, deckMat }) {
  const T = scene.THREE;
  const levels = basinLevels(basin);
  const add = (mesh) => { scene.scene.add(mesh); scene._poolObjects.push(mesh); return mesh; };
  const rings = [basin.outer, ...(basin.holes || [])];
  const wall = new T.Group();
  rings.flatMap(ring => poolPerimeterSegments(ring)).forEach(segment => {
    const side = new T.Mesh(new T.BoxGeometry(segment.length + 0.14, levels.wallHeight, 0.18), wallMat);
    side.position.set(segment.x, levels.wallCenterY, segment.z);
    side.rotation.y = -segment.rotation;
    side.castShadow = true;
    wall.add(side);
    const coping = new T.Mesh(new T.BoxGeometry(segment.length + 0.12, 0.09, 0.22), copingMat);
    coping.position.set(segment.x, levels.copingY, segment.z);
    coping.rotation.y = -segment.rotation;
    wall.add(coping);
  });
  add(wall);
  const floor = add(new T.Mesh(poolShapeGeometry(T, basin.outer, basin.holes || []), floorMat));
  floor.rotation.x = -Math.PI / 2; floor.position.y = levels.floorY;
  (basin.holes || []).forEach(hole => {
    const top = add(new T.Mesh(poolShapeGeometry(T, hole), deckMat));
    top.rotation.x = -Math.PI / 2; top.position.y = levels.kerbY; top.receiveShadow = true;
  });
}

/**
 * Basin heights from optional geometry fields. Defaults are the historical constants
 * (floor -0.45 m, kerb 0.45 m, wall 0.9 m centred on y = 0, coping at 0.46 m).
 */
export function basinLevels(geometry = {}) {
  const fl = Number(geometry?.floorLevel);
  const floorY = Number.isFinite(fl) && fl < 0 ? Math.max(-10, fl) : -0.45;
  const wh = Number(geometry?.wallHeight);
  const wallHeight = Number.isFinite(wh) && wh > 0 ? Math.min(10, wh) : 0.45 - floorY;
  const kerbY = floorY + wallHeight;
  return { floorY, wallHeight, wallCenterY: floorY + wallHeight / 2, kerbY, copingY: kerbY + 0.01 };
}

/**
 * AF-CAD-011 wiring: show (or replace / clear) the locked CAD underlay on the ground
 * plane. Rebuilds only when the underlay's `items` or the pool centre changes; a
 * visibility-only change re-syncs the existing batches.
 *
 * @param {object|null} underlay  engineeringStore.cadUnderlay (plan frame)
 * @param {object} opts { toWorld: plan {x,y} → world {x,z}, centerKey: string }
 */
export function setCadUnderlay(scene, underlay, { toWorld, centerKey = "" } = {}) {
  const items = underlay?.items || null;
  const prev = scene._cadUnderlay;
  if (prev && prev.items === items && prev.centerKey === centerKey) {
    prev.group.applyVisibility(underlay);
    return prev.group;
  }
  if (prev) { prev.group.parent?.remove(prev.group); prev.group.dispose(); }
  scene._cadUnderlay = null;
  if (!scene.scene || !items?.length) return null;
  const group = createCadUnderlay3D(underlay, { toWorld, elevation: 0.015 });
  scene.scene.add(group);
  scene._cadUnderlay = { group, items, centerKey };
  return group;
}
