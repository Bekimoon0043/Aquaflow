import { describe, it, expect } from 'vitest';
import * as T from 'three';
import {
  centeredPoolPoints,
  deckWithOpening,
  polygonWaterGeometry,
  poolPerimeterSegments,
  poolShapeGeometry,
} from '../basinGeometry';

describe('basin paving clearance', () => {
  for (const pool of [{poolType:'circular',radius:10}, {poolType:'rectangular',width:20,length:12}]) {
    it(`leaves the ${pool.poolType} basin open instead of clipping water`, () => {
      const geo = deckWithOpening(T, pool);
      const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({side:T.DoubleSide}));
      mesh.updateMatrixWorld();
      const ray = new T.Raycaster(new T.Vector3(0,0,5), new T.Vector3(0,0,-1));
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      ray.set(new T.Vector3(15,0,5),new T.Vector3(0,0,-1));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      expect([...geo.attributes.uv.array].every(n=>n>=0 && n<=1)).toBe(true);
      geo.dispose(); mesh.material.dispose();
    });
  }

  it('preserves an asymmetric freeform outline for deck, water and coping', () => {
    const raw = [
      {x:2,y:2},{x:10,y:0},{x:16,y:2},{x:20,y:-1},{x:19,y:5},
      {x:16,y:3},{x:10,y:6},{x:2,y:4},{x:0,y:3},
    ];
    const points = centeredPoolPoints(raw);
    expect(points).toHaveLength(raw.length);
    expect(Math.min(...points.map(point => point.x))).toBeCloseTo(-10);
    expect(Math.max(...points.map(point => point.x))).toBeCloseTo(10);

    const deck = deckWithOpening(T, {poolType:'freeform',points});
    const water = polygonWaterGeometry(T, points, 48);
    expect(deck.index?.count || deck.attributes.position.count).toBeGreaterThan(0);
    expect(water.index.count).toBeGreaterThan(200);
    expect(poolPerimeterSegments(points)).toHaveLength(points.length);
    expect([...water.attributes.uv.array].every(n => n >= 0 && n <= 1)).toBe(true);
    deck.dispose(); water.dispose();
  });

  it('lays freeform water, floor and deck opening on the same side as walls and fixtures', () => {
    // Centred: apex (0,-4), base corners (±8,4). Walls/fixtures map plan y straight to world z.
    const points = centeredPoolPoints([{x:0,y:0},{x:8,y:8},{x:-8,y:8}]);
    const nearCorner = { x: 6, z: 3 };
    const mirrored = { x: 6, z: -3 };
    const flat = (geo) => {
      const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({side:T.DoubleSide}));
      mesh.rotation.x = -Math.PI / 2;
      mesh.updateMatrixWorld();
      return mesh;
    };
    const hits = (mesh, p) => new T.Raycaster(new T.Vector3(p.x, 5, p.z), new T.Vector3(0, -1, 0))
      .intersectObject(mesh).length > 0;

    const water = flat(polygonWaterGeometry(T, points, 48));
    const floor = flat(poolShapeGeometry(T, points));
    const deck = flat(deckWithOpening(T, {poolType:'freeform', points}));
    expect(hits(water, nearCorner)).toBe(true);
    expect(hits(water, mirrored)).toBe(false);
    expect(hits(floor, nearCorner)).toBe(true);
    expect(hits(floor, mirrored)).toBe(false);
    expect(hits(deck, nearCorner)).toBe(false);
    expect(hits(deck, mirrored)).toBe(true);

    const wall = poolPerimeterSegments(points)[0];
    expect(wall.z).toBeCloseTo((points[0].y + points[1].y) / 2);
    [water, floor, deck].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  });
});
