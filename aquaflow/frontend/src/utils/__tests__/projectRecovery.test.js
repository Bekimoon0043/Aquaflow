// AF-NEXT-006 — snapshot rotation, crash-recovery detection, asset manifest hashing and
// the missing/changed-asset report, .aquapkg round trip, legacy .aqua loading.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createKvSnapshotBackend, createMemoryKv, findRecoveryCandidate, planSnapshotRotation,
  acquireBrowserSessionLock, releaseBrowserSessionLock, __resetSnapshotBackendForTests,
} from "../projectRecovery.js";
import {
  collectAssetRefs, buildAssetManifest, verifyAssetManifest, relativeAssetPath, sha256Hex,
  hasManifest, describeAssetReport, packagedMemberName,
} from "../assetManifest.js";
import { createZip, readZip, crc32 } from "../zipStore.js";
import { createAssetResolver, loadProjectData, parsePackage, getFileState } from "../projectPersistence.js";
import { serializeShow } from "../showFile.js";
import { useShowStore } from "../../store/showStore.js";
import useEngineeringStore from "../../store/engineeringStore.js";
import useProjectStore from "../../store/projectStore.js";

const nodeSha = (data) => createHash("sha256").update(data).digest("hex");

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

const showState = {
  currentShow: { id: "show-1", name: "Recovery Pilot", bpm: 120, duration: 60, sampleRate: 48000, loop: false },
  nodes: [], connections: [], timelineTracks: [], devices: [], timelineZoom: 4, showGrid: true, snapToGrid: true,
};
const underlay = {
  format: "aquaflow-cad-underlay", version: 1, filename: "lebu.dxf", importedAt: "2026-10-01",
  items: [{ kind: "line", layer: "BASIN", color: "#fff", points: [0, 0, 10, 0], closed: false }],
};
function projectWithAssets() {
  const data = serializeShow(showState, { name: "Pool", fixtures: [], site_models: [
    { id: "m1", name: "Kiosk", props: { assetId: "custom:kiosk-1" } },
    { id: "m2", name: "Kiosk copy", props: { assetId: "custom:kiosk-1" } },
    { id: "tree", name: "Tree", props: { assetId: "venue:tree-common-1" } },
  ] }, {
    metadata: { id: "project-42", name: "Recovery Pilot" }, workspace: {}, render: {}, integrations: {},
    programmer: { audioFileReference: { name: "song.mp3", size: 11, type: "audio/mpeg", path: "C:/Shows/Pilot/audio/song.mp3" } },
  });
  // cad_underlay is normalized by serializeShow only when valid; attach the raw form directly.
  data.engineering.cad_underlay = underlay;
  return data;
}

afterEach(() => { __resetSnapshotBackendForTests(null); vi.restoreAllMocks(); });

describe("autosave snapshot rotation", () => {
  it("keeps the newest 10 per project, independent of other projects", async () => {
    let clock = 1_000_000;
    const kv = createMemoryKv();
    const backend = createKvSnapshotBackend(kv, { now: () => (clock += 1000), storage: memoryStorage() });
    for (let i = 1; i <= 13; i++) await backend.write("A", { rev: i }, { name: "A" });
    await backend.write("B", { rev: 1 }, { name: "B" });
    const a = await backend.list("A");
    expect(a).toHaveLength(10);
    expect((await backend.read(a[0].id)).project.rev).toBe(13);
    expect((await backend.read(a[9].id)).project.rev).toBe(4);
    expect(await backend.list("B")).toHaveLength(1);
    expect(kv.map.size).toBe(11);
  });

  it("planSnapshotRotation applies a global cap", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, projectKey: `p${i % 3}`, time: i }));
    const { keep, drop } = planSnapshotRotation(entries, 10, 4);
    expect(keep.map((e) => e.time)).toEqual([5, 4, 3, 2]);
    expect(drop).toHaveLength(2);
  });

  it("propagates storage failures instead of swallowing them", async () => {
    const kv = createMemoryKv();
    kv.put = async () => { throw new Error("QuotaExceededError"); };
    const backend = createKvSnapshotBackend(kv, { storage: memoryStorage() });
    await expect(backend.write("A", {}, {})).rejects.toThrow(/Quota/);
  });
});

describe("crash-recovery detection", () => {
  const snaps = [
    { id: "s2", projectKey: "A", savedAt: "2026-10-13T10:05:00Z" },
    { id: "s1", projectKey: "A", savedAt: "2026-10-13T09:00:00Z" },
  ];
  it("offers the newest snapshot after an unclean exit when it is newer than the clean save", () => {
    const r = findRecoveryCandidate({ uncleanExit: true, snapshots: snaps, cleanSaves: { A: { savedAt: "2026-10-13T10:00:00Z" } } });
    expect(r.snapshot.id).toBe("s2");
    expect(r.lastCleanSaveAt).toBe("2026-10-13T10:00:00.000Z");
  });
  it("offers nothing after a clean exit, or when the clean save is newer", () => {
    expect(findRecoveryCandidate({ uncleanExit: false, snapshots: snaps, cleanSaves: {} })).toBeNull();
    expect(findRecoveryCandidate({ uncleanExit: true, snapshots: snaps, cleanSaves: { A: { savedAt: "2026-10-13T11:00:00Z" } } })).toBeNull();
  });
  it("a never-saved project is recoverable", () => {
    expect(findRecoveryCandidate({ uncleanExit: true, snapshots: snaps, cleanSaves: {} }).snapshot.id).toBe("s2");
  });
  it("browser session lock: leftover lock = unclean; released lock = clean", () => {
    const storage = memoryStorage();
    expect(acquireBrowserSessionLock(storage).uncleanExit).toBe(false);
    expect(acquireBrowserSessionLock(storage).uncleanExit).toBe(true); // killed tab: lock never released
    releaseBrowserSessionLock(storage);
    expect(acquireBrowserSessionLock(storage).uncleanExit).toBe(false);
  });
  it("kv backend combines lock + clean saves into recovery info", async () => {
    let clock = Date.parse("2026-10-13T10:00:00Z");
    const storage = memoryStorage();
    const backend = createKvSnapshotBackend(createMemoryKv(), { now: () => clock, storage, session: { uncleanExit: true } });
    await backend.markClean("A");
    clock += 60_000;
    await backend.write("A", { rev: 2 }, { name: "A", originalPath: "C:/Shows/a.aqua" });
    const candidate = findRecoveryCandidate(await backend.recoveryInfo());
    expect(candidate.snapshot.originalPath).toBe("C:/Shows/a.aqua");
  });
});

describe("asset manifest", () => {
  it("collects audio, imported site models (deduplicated), and the CAD underlay; skips built-ins", () => {
    const refs = collectAssetRefs(projectWithAssets());
    expect(refs.map((r) => [r.id, r.role, r.source])).toEqual([
      ["audio:programmer", "audio", "file"],
      ["model:custom:kiosk-1", "site_model", "library"],
      ["cad_underlay", "cad_underlay", "embedded"],
    ]);
  });

  it("relative paths are computed against the project folder", () => {
    expect(relativeAssetPath("C:/Shows/Pilot/pilot.aqua", "C:/Shows/Pilot/audio/song.mp3")).toBe("audio/song.mp3");
    expect(relativeAssetPath("C:\\Shows\\Pilot\\pilot.aqua", "C:\\Shows\\Music\\song.mp3")).toBe("../Music/song.mp3");
    expect(relativeAssetPath("C:/Shows/p.aqua", "D:/Music/song.mp3")).toBeNull();
    expect(relativeAssetPath(null, "C:/x.mp3")).toBeNull();
  });

  it("hashes with SHA-256 and records size, path and relative path", async () => {
    const audio = new TextEncoder().encode("audio-bytes");
    const glb = new TextEncoder().encode("glb-bytes");
    const data = projectWithAssets();
    const manifest = await buildAssetManifest(data, {
      projectPath: "C:/Shows/Pilot/pilot.aqua",
      describe: async (refs) => refs.map((r) => ({ id: r.id, found: true, path: r.path, size: audio.length, sha256: nodeSha(audio) })),
      readLibrary: async () => glb,
    });
    expect(await sha256Hex("abc")).toBe(nodeSha("abc"));
    const byId = Object.fromEntries(manifest.assets.map((a) => [a.id, a]));
    expect(byId["audio:programmer"]).toMatchObject({ sha256: nodeSha(audio), size: 11, relativePath: "audio/song.mp3" });
    expect(byId["model:custom:kiosk-1"].sha256).toBe(nodeSha(glb));
    expect(byId.cad_underlay.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verification reports every missing and changed asset; embedded underlay edits are detected", async () => {
    const data = projectWithAssets();
    data.assetManifest = await buildAssetManifest(data, {
      describe: async (refs) => refs.map((r) => ({ id: r.id, found: true, path: r.path, size: 11, sha256: nodeSha("audio-bytes") })),
      readLibrary: async () => new TextEncoder().encode("glb-bytes"),
    });
    expect(hasManifest(data)).toBe(true);
    // Second PC: audio exists but was re-encoded, the GLB is not in this library.
    const report = await verifyAssetManifest(data, {
      resolve: async (asset) => (asset.role === "audio" ? { found: true, path: "E:/song.mp3", size: 12, sha256: nodeSha("other-bytes") } : { found: false }),
    });
    expect(report.total).toBe(3);
    expect(report.changed.map((i) => i.id)).toEqual(["audio:programmer"]);
    expect(report.missing.map((i) => i.id)).toEqual(["model:custom:kiosk-1"]);
    expect(report.ok.map((i) => i.id)).toEqual(["cad_underlay"]);
    expect(report.needsAttention).toBe(true);
    expect(describeAssetReport(report).join("\n")).toMatch(/MISSING\s+site_model\s+Kiosk/);

    data.engineering.cad_underlay = { ...underlay, items: [] };
    const edited = await verifyAssetManifest(data, { resolve: async () => ({ found: false }) });
    expect(edited.items.find((i) => i.id === "cad_underlay").status).toBe("changed");
  });
});

describe(".aquapkg packages", () => {
  it("ZIP round trip with CRC checking", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }, { name: "assets/b.bin", data: new Uint8Array([1, 2, 3]) }]);
    const files = readZip(zip);
    expect(new TextDecoder().decode(files.get("a.txt"))).toBe("hello");
    expect([...files.get("assets/b.bin")]).toEqual([1, 2, 3]);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const damaged = zip.slice(); damaged[36] ^= 0xff; // flip a byte of a.txt's data (30-byte header + 5-byte name)
    expect(() => readZip(damaged)).toThrow(/CRC/);
  });

  it("embedded assets verify from the package; a tampered member is reported as changed", async () => {
    const audio = new TextEncoder().encode("audio-bytes");
    const data = projectWithAssets();
    data.assetManifest = await buildAssetManifest(data, {
      describe: async (refs) => refs.map((r) => ({ id: r.id, found: true, path: r.path, size: audio.length, sha256: nodeSha(audio) })),
      readLibrary: async () => null,
    });
    const audioEntry = data.assetManifest.assets.find((a) => a.id === "audio:programmer");
    audioEntry.packaged = packagedMemberName(audioEntry);
    const pkg = createZip([{ name: "project.aqua", data: JSON.stringify(data) }, { name: audioEntry.packaged, data: audio }]);
    const { data: opened, files } = parsePackage(pkg);
    const resolve = createAssetResolver({ packageFiles: files, bridge: null, readLibrary: async () => null });
    const report = await verifyAssetManifest(opened, { resolve });
    expect(report.items.find((i) => i.id === "audio:programmer")).toMatchObject({ status: "ok", resolvedVia: "package" });
    expect(report.missing.map((i) => i.id)).toEqual(["model:custom:kiosk-1"]);

    files.set(audioEntry.packaged, new TextEncoder().encode("tampered!!!"));
    const tampered = await verifyAssetManifest(opened, { resolve: createAssetResolver({ packageFiles: files, bridge: null, readLibrary: async () => null }) });
    expect(tampered.changed.map((i) => i.id)).toEqual(["audio:programmer"]);
  });
});

describe("opening projects", () => {
  const memoryBackend = () => createKvSnapshotBackend(createMemoryKv(), { storage: memoryStorage() });

  it("a legacy .aqua without a manifest loads unchanged and produces no asset report", async () => {
    __resetSnapshotBackendForTests(memoryBackend());
    const legacy = serializeShow(showState, { name: "Legacy Pool", fixtures: [] }, {
      metadata: { id: "legacy-1", name: "Recovery Pilot" }, workspace: {}, render: {}, integrations: {}, programmer: null,
    });
    const { state, report } = await loadProjectData(JSON.parse(JSON.stringify(legacy)), { path: "C:/Shows/legacy.aqua" });
    expect(report).toBeNull();
    expect(state.currentShow.name).toBe("Recovery Pilot");
    expect(useShowStore.getState().currentShow.name).toBe("Recovery Pilot");
    expect(useEngineeringStore.getState().getProjectPayload().name).toBe("Legacy Pool");
    expect(useProjectStore.getState().metadata.id).toBe("legacy-1");
    expect(getFileState().path).toBe("C:/Shows/legacy.aqua");
  });

  it("a project with a manifest is verified before load returns (report available before playback)", async () => {
    __resetSnapshotBackendForTests(memoryBackend());
    const data = projectWithAssets();
    data.assetManifest = await buildAssetManifest(data, { readLibrary: async () => null });
    const { report } = await loadProjectData(JSON.parse(JSON.stringify(data)), { path: "D:/OtherPC/pilot.aqua" });
    // No desktop bridge in the test → disk files cannot be found: reported, not ignored.
    expect(report.missing.map((i) => i.id).sort()).toEqual(["audio:programmer", "model:custom:kiosk-1"]);
    expect(useShowStore.getState().currentShow.name).toBe("Recovery Pilot");
  });
});
