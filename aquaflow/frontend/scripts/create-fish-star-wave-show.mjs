import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const round = value => Number(value.toFixed(3));
const output = resolve(process.argv[2] || "../../output/AquaFlow-Fish-Star-Wave.aqua");

// The reference is an asymmetric fish silhouette: rounded body at left, tapered
// peduncle and a split tail at right. Coordinates are metres in the engineering plane.
const poolPoints = [
  { x:-16.0, y:0.0 }, { x:-14.7, y:-3.5 }, { x:-11.2, y:-6.0 },
  { x:-6.0, y:-7.4 }, { x:0.0, y:-7.7 }, { x:5.8, y:-6.5 },
  { x:10.0, y:-3.7 }, { x:11.0, y:-2.4 }, { x:16.0, y:-6.8 },
  { x:15.0, y:-2.0 }, { x:12.8, y:0.0 }, { x:15.0, y:2.0 },
  { x:16.0, y:6.8 }, { x:11.0, y:2.4 }, { x:10.0, y:3.7 },
  { x:5.8, y:6.5 }, { x:0.0, y:7.7 }, { x:-6.0, y:7.4 },
  { x:-11.2, y:6.0 }, { x:-14.7, y:3.5 },
];

const perimeterLengths = poolPoints.map((point, index) => {
  const next = poolPoints[(index + 1) % poolPoints.length];
  return Math.hypot(next.x - point.x, next.y - point.y);
});
const perimeterLength = perimeterLengths.reduce((sum, length) => sum + length, 0);

function pointInsidePool(x, y) {
  let inside = false;
  for (let i = 0, j = poolPoints.length - 1; i < poolPoints.length; j = i++) {
    const a = poolPoints[i], b = poolPoints[j];
    if (((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
  }
  return inside;
}

function perimeterPoint(progress, insetMetres = 0.7) {
  let distance = ((progress % 1) + 1) % 1 * perimeterLength;
  for (let index = 0; index < poolPoints.length; index += 1) {
    const length = perimeterLengths[index];
    if (distance <= length) {
      const point = poolPoints[index], next = poolPoints[(index + 1) % poolPoints.length];
      const t = length ? distance / length : 0;
      const boundaryX = point.x + (next.x - point.x) * t;
      const boundaryY = point.y + (next.y - point.y) * t;
      const dx = next.x - point.x, dy = next.y - point.y;
      const nx = -dy / length, ny = dx / length;
      let x = boundaryX + nx * insetMetres, y = boundaryY + ny * insetMetres;
      if (!pointInsidePool(x, y)) { x = boundaryX - nx * insetMetres; y = boundaryY - ny * insetMetres; }
      // Very sharp concave corners can defeat either fixed normal. Walk gently toward
      // the pool centre until the installation point is safely wet.
      for (let attempt = 0; attempt < 12 && !pointInsidePool(x, y); attempt += 1) {
        x *= 0.94; y *= 0.94;
      }
      return { x:round(x), y:round(y), rotation:round(Math.atan2(dy, dx) * 180 / Math.PI) };
    }
    distance -= length;
  }
  return { x:0, y:0, rotation:0 };
}

const fixtures = [];
const water = (id, type, label, x, y, groupId, engineering = {}, rotation = 0) => fixtures.push({
  id, type, label, x:round(x), y:round(y), z:0, rotation:round(rotation),
  zone:groupId, groupId,
  engineering:{ designOnly:true, pressureBar:3.2, flowLpm:55, jetHeightM:3.0, ...engineering },
});
const light = (id, label, x, y, color="#35ff62") => fixtures.push({
  id, type:"light_uw_rgb_36w", label, x:round(x), y:round(y), z:0,
  rotation:0, zone:"rgb_lights", groupId:"rgb_lights", color,
  engineering:{ designOnly:true, wattage:36, beamRadiusM:5.5, color },
});

const waveGroups = [
  "running_fountain_jets", "outer_ring_jets", "arch_jets", "cascade_jets",
  "motion_1d_jets", "motion_2d_jets", "motion_3d_jets", "screen_jets",
];

// 72 closely spaced perimeter jets, divided into eight independently timed sectors.
for (let index = 0; index < 72; index += 1) {
  const p = perimeterPoint(index / 72, 0.72);
  const sector = Math.floor(index / 9);
  water(`fish-rim-${String(index + 1).padStart(2,"0")}`, "nozzle_straight_dn25",
    `Perimeter wave ${String(index + 1).padStart(2,"0")}`, p.x, p.y, waveGroups[sector],
    { pressureBar:2.8, flowLpm:42, jetHeightM:2.2 + 0.25 * Math.sin(index / 72 * Math.PI * 2) }, p.rotation);
}

// Reference front view: two dense rectangular water walls rising behind the centre.
for (const [side, cx, group] of [["L",-5.1,"foam_jets"],["R",5.1,"peacock_jets"]]) {
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const index = row * 5 + col;
      water(`tower-${side}-${String(index + 1).padStart(2,"0")}`, "nozzle_straight_dn32",
        `${side === "L" ? "Left" : "Right"} tower ${String(index + 1).padStart(2,"0")}`,
        cx + (col - 2) * 0.62, 1.45 + (row - 1.5) * 0.58, group,
        { pressureBar:4.1, flowLpm:75, jetHeightM:4.3 + row * 0.28 });
    }
  }
}

// Two circular foreground crowns visible as luminous rings in the reference.
for (const [side, cx, group] of [["L",-4.0,"foam_jets"],["R",4.0,"peacock_jets"]]) {
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    water(`crown-${side}-${String(index + 1).padStart(2,"0")}`, "nozzle_straight_dn25",
      `${side === "L" ? "Left" : "Right"} crown ${String(index + 1).padStart(2,"0")}`,
      cx + Math.cos(angle) * 1.25, -3.15 + Math.sin(angle) * 1.1, group,
      { pressureBar:3.1, flowLpm:48, jetHeightM:2.35 });
  }
}

// A true five-point star outline sampled uniformly along its ten edges.
const starVertices = Array.from({length:10}, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  const radius = index % 2 === 0 ? 3.25 : 1.38;
  return { x:Math.cos(angle) * radius, y:Math.sin(angle) * radius - 0.15 };
});
for (let edge = 0; edge < 10; edge += 1) {
  const a = starVertices[edge], b = starVertices[(edge + 1) % 10];
  for (let step = 0; step < 3; step += 1) {
    const t = step / 3;
    const index = edge * 3 + step;
    water(`star-${String(index + 1).padStart(2,"0")}`, "nozzle_straight_dn25",
      `Star outline ${String(index + 1).padStart(2,"0")}`,
      a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, "center_jets",
      { pressureBar:3.4, flowLpm:52, jetHeightM:2.9 });
  }
}

// Hero geyser: the dominant 10–12 m centre column in the elevation reference.
water("hero-geyser", "nozzle_volcano", "Hero centre geyser", 0, -0.15, "center_jets",
  { pressureBar:6.8, flowLpm:320, jetHeightM:11.5, nozzleDiameterMm:50 });

// Green RGB underwater lighting follows the outline and reinforces the central star.
for (let index = 0; index < 48; index += 1) {
  const p = perimeterPoint((index + 0.5) / 48, 0.42);
  light(`rim-light-${String(index + 1).padStart(2,"0")}`, `Perimeter RGB ${String(index + 1).padStart(2,"0")}`, p.x, p.y);
}
for (let index = 0; index < 12; index += 1) {
  const angle = index / 12 * Math.PI * 2;
  light(`center-light-${String(index + 1).padStart(2,"0")}`, `Centre RGB ${String(index + 1).padStart(2,"0")}`,
    Math.cos(angle) * 4.25, Math.sin(angle) * 3.35 - 0.15);
}

let clipCounter = 0;
const tracks = new Map();
function cue(groupId, start, end, intensity, label, extra = {}) {
  if (!tracks.has(groupId)) tracks.set(groupId, {
    id:`track-${groupId}`, label:groupId.replaceAll("_"," ").toUpperCase(), type:groupId,
    color:groupId === "rgb_lights" ? "#35ff62" : "#16d8ff", deviceId:null, muted:false, solo:false, clips:[],
  });
  tracks.get(groupId).clips.push({
    id:`fish-wave-cue-${++clipCounter}`, start:round(start), end:round(end),
    label, intensity, groupId, fadeIn:0.18, fadeOut:0.22, ...extra,
  });
}

// Act I — clockwise then counter-clockwise travelling wave around the fish outline.
waveGroups.forEach((group, index) => cue(group, 0.35 + index * 0.68, 2.0 + index * 0.68, 94, `Clockwise wave ${index + 1}`));
[...waveGroups].reverse().forEach((group, index) => cue(group, 7.0 + index * 0.62, 8.55 + index * 0.62, 88, `Reverse wave ${index + 1}`));

// Act II — paired water towers, alternating then locking together.
cue("foam_jets", 12.0, 14.4, 82, "Left tower rise");
cue("peacock_jets", 13.0, 15.4, 82, "Right tower rise");
cue("foam_jets", 15.7, 19.1, 98, "Twin tower hold");
cue("peacock_jets", 15.7, 19.1, 98, "Twin tower hold");

// Act III — central star and hero geyser breathe before the finale.
cue("center_jets", 19.4, 24.0, 96, "Star and hero reveal", {pattern:"pulse", cycles:2});

// Act IV — full composition, matching the bright green reference frame.
waveGroups.forEach((group, index) => cue(group, 24.2, 31.5, 92 - index * 2, "Full perimeter crown"));
cue("foam_jets", 24.2, 31.5, 100, "Finale left tower");
cue("peacock_jets", 24.2, 31.5, 100, "Finale right tower");
cue("center_jets", 24.2, 31.5, 100, "Finale star and geyser");

// Outro — a last travelling ripple empties the pool gracefully.
waveGroups.forEach((group, index) => cue(group, 31.7 + index * 0.42, 33.0 + index * 0.42, 72, `Outro ripple ${index + 1}`));
cue("rgb_lights", 0, 36.5, 100, "Emerald illumination", { color:"#35ff62", pattern:"pulse", cycles:10, fadeIn:0.8, fadeOut:1.1 });

const timelineTracks = [...tracks.values()].map(track => ({
  ...track,
  clips:track.clips.sort((a,b) => a.start - b.start),
}));

const layers = [
  ["pool_outline","Pool Outline","#00aaff"], ["water_surface","Water Surface","#0044aa"],
  ["nozzles","Nozzles","#00ccaa"], ["lights","Lights","#ffcc00"],
  ["measurements","Measurements","#ffcc00"], ["annotations","Annotations","#ffcc00"],
  ["pipework","Pipework","#ff8800"], ["equipment","Equipment","#888888"],
].map(([key,label,color]) => ({key,label,color,visible:true,locked:false}));

const project = {
  aquaflow:"1.0",
  savedAt:new Date().toISOString(),
  show:{ id:"fish-star-wave-reference-v1", name:"Emerald Fish — Star Wave Spectacular", bpm:120, duration:36.5, sampleRate:48000, loop:true },
  nodes:[], connections:[], timelineTracks, devices:[],
  engineering:{
    format:"AquaFlowPoolGeometry", version:"1.0", id:"fish-star-wave-reference-v1",
    name:"Emerald Fish — Star Wave Spectacular", pool_type:"freeform",
    params:{ width:32, length:15.4, radius:8, depth:0.85 },
    geometry:{ type:"freeform", points:poolPoints, closed:true },
    fixtures, site_models:[], layers, measurements:[
      {id:"overall-length",type:"linear",label:"Overall length",value:32,unit:"m",start:{x:-16,y:8.4},end:{x:16,y:8.4}},
      {id:"overall-width",type:"linear",label:"Body width",value:15.4,unit:"m",start:{x:-16.8,y:-7.7},end:{x:-16.8,y:7.7}},
    ],
    depth_zones:[{ id:"main-basin", zone:"deep", label:"Main display basin", depth:0.85, color:"#08759a", points:poolPoints }],
    manualPipes:[], pipes:[], hydraulics:null, solved_hydraulics:null, bom:[],
    reference_analysis:{
      source:"Three supplied simulation frames", theme:"green illuminated fish basin with star centre",
      water_fixture_count:fixtures.filter(fixture => !fixture.type.startsWith("light_")).length,
      light_fixture_count:fixtures.filter(fixture => fixture.type.startsWith("light_")).length,
      choreography:"clockwise wave, reverse wave, twin towers, star reveal, full finale, outro ripple",
    },
  },
  ui:{ timelineZoom:18, showGrid:true, snapToGrid:true },
};

mkdirSync(dirname(output), {recursive:true});
writeFileSync(output, `${JSON.stringify(project, null, 2)}\n`, "utf8");
console.log(JSON.stringify({output, fixtures:fixtures.length, water:fixtures.filter(f => !f.type.startsWith("light_")).length,
  lights:fixtures.filter(f => f.type.startsWith("light_")).length, tracks:timelineTracks.length,
  clips:timelineTracks.reduce((sum, track) => sum + track.clips.length, 0)}, null, 2));
