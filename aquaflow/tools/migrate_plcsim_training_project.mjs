#!/usr/bin/env node
/**
 * Combine the step-6 PLCSIM training artifacts into AquaFlow's unified v1.1
 * project envelope. The Siemens site identity and compiled contract are kept
 * unchanged so the existing TIA Portal / PLCSIM project remains compatible.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const packageDir = path.join(repoRoot, "outputs", "AquaFlow-PLCSIM-Training-Fountain-20s");
const engineeringPath = path.join(packageDir, "AquaFlow-PLCSIM-Training-Fountain-20s.aquaflow.json");
const showPath = path.join(packageDir, "AquaFlow-PLCSIM-Training-Fountain-20s.show.json");
const outputPath = path.join(packageDir, "AquaFlow-PLCSIM-Training-Fountain-20s.aqua");

const engineering = JSON.parse(fs.readFileSync(engineeringPath, "utf8"));
const program = JSON.parse(fs.readFileSync(showPath, "utf8"));
const now = new Date().toISOString();
const siteId = "c45b81b0-ebca-42a1-8d2d-1675ec811dd1";
const name = program.metadata?.title || engineering.name || "AquaFlow PLCSIM Training Fountain - 20s";

const project = {
  aquaflow: "1.1",
  savedAt: now,
  show: {
    id: `show-${siteId}`,
    name,
    bpm: Number(program.bpm || program.metadata?.bpm || 120),
    duration: Number(program.metadata?.estimatedDuration || program.audioDuration || 20),
    sampleRate: 48000,
    loop: true,
  },
  nodes: [],
  connections: [],
  timelineTracks: [],
  devices: [],
  engineering,
  project: {
    id: `project-${siteId}`,
    name,
    schemaVersion: 2,
    revision: 1,
    createdAt: now,
    modifiedAt: now,
    source: "plcsim-training-step-6",
  },
  workspace: {
    activePanel: "programmer",
  },
  render: {
    environment: "night",
    cameraMode: "orbit",
    quality: "high",
    pattern: "none",
    lightColor: "#22c55e",
    windX: 0,
    windZ: 0,
    waveResponse: 1.15,
    waveDamping: 0.985,
    waveBoundaryDamping: 0.82,
    reviewMode: true,
    reviewOverlays: false,
    showPerformance: true,
    sidebarOpen: true,
    sidebarTab: "render",
    editMode: true,
    exportResolution: "1080p",
    exportFps: 60,
    bakeStart: 0,
    bakeDuration: 20,
    bakeAudio: false,
  },
  programmer: {
    timelineClips: Array.isArray(program.timelineClips) ? program.timelineClips : [],
    beatMarkers: Array.isArray(program.beatMarkers) ? program.beatMarkers : [],
    cues: Array.isArray(program.cues) ? program.cues : [],
    audioFile: null,
    audioFileReference: null,
    audioBuffer: null,
    audioDuration: Number(program.audioDuration || 20),
    currentTime: 0,
    zoom: Number(program.zoom || 40),
    timelineView: "tracks",
    selectedBlockId: null,
    sectionBlockIds: [],
    rightTab: "clip",
  },
  integrations: {
    siemensSiteId: siteId,
    siemensSiteRevision: 6,
    siemensDbNumber: 100,
    siemensSiteSignature: "0x4794E8BA",
    transport: "s7comm",
    testTarget: "TIA Portal V17 PLCSIM via NetToPLCsim",
    plcAddress: "192.168.43.41",
    rack: 0,
    slot: 1,
  },
  automation: {
    audioData: null,
    manualPatterns: null,
    manualPatternMeta: null,
    manualPriority: false,
    manualPatternConfig: null,
    generatedTracks: Array.isArray(program.generatedTracks) ? program.generatedTracks : [],
  },
  ui: {
    timelineZoom: 4,
    showGrid: true,
    snapToGrid: true,
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
console.log(outputPath);
