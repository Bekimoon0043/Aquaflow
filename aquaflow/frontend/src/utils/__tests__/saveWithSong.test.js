// Song inside saved files: Save asks once per project whether to keep the song inside; "yes"
// writes an .aquapkg with the song embedded (later Saves overwrite it), "no" keeps the .aqua.
// A package re-saved on a PC without the original song file still embeds it (from the opened
// package). Opening the package attaches the song. A missing song is located and verified.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveProject, packageProject, setSongPrompt, readSongChoice, getFileState, openProjectBytes, relinkAsset, parsePackage,
} from "../projectPersistence.js";
import { createKvSnapshotBackend, createMemoryKv, __resetSnapshotBackendForTests } from "../projectRecovery.js";
import { liveAssetFiles } from "../assetManifest.js";
import { zipText } from "../zipStore.js";
import useProjectStore from "../../store/projectStore.js";

const nodeSha = (data) => createHash("sha256").update(data).digest("hex");
const SONG = new Uint8Array([73, 68, 51, 4, 0, 1, 2, 3, 4, 5]);
const SONG_PATH = "C:/Music/song.mp3";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear() };
}

function makeBridge(files) {
  const writes = [];
  const bridge = {
    writes,
    saveDialog: vi.fn(async ({ kind }) => ({ ok: true, path: kind === "package" ? "C:/Shows/Song_Show.aquapkg" : "C:/Shows/Song_Show.aqua" })),
    save: vi.fn(async (req) => { writes.push(req); return { ok: true, path: req.path }; }),
    describeAssets: vi.fn(async (refs) => ({ ok: true, assets: refs.map((r) => (files.has(r.path)
      ? { id: r.id, found: true, via: "absolute", path: r.path, size: files.get(r.path).length, sha256: nodeSha(files.get(r.path)) }
      : { id: r.id, found: false })) })),
    readAsset: vi.fn(async (p) => (files.has(p) ? { ok: true, path: p, bytes: files.get(p) } : { ok: false, error: "ENOENT: not found" })),
    resolveAssets: vi.fn(async (refs) => ({ ok: true, assets: refs.map((r) => (files.has(r.path)
      ? { id: r.id, found: true, via: "absolute", path: r.path, size: files.get(r.path).length, sha256: nodeSha(files.get(r.path)) }
      : { id: r.id, found: false })) })),
    pickAsset: vi.fn(),
  };
  return bridge;
}

function loadSongProject(id = "song-proj") {
  useProjectStore.getState().loadProjectDocument({
    metadata: { id, name: "Song Show" }, workspace: {}, render: {}, integrations: {},
    programmer: { audioFileReference: { name: "song.mp3", size: SONG.length, type: "audio/mpeg", path: SONG_PATH }, timelineClips: [{ id: "c1", startTime: 0, duration: 2 }] },
  }, "Song Show");
}

let bridge;
beforeEach(() => {
  globalThis.localStorage = memoryStorage();
  const win = new EventTarget();
  globalThis.window = win;
  bridge = makeBridge(new Map([[SONG_PATH, SONG]]));
  win.aquaflow = { project: bridge };
  __resetSnapshotBackendForTests(createKvSnapshotBackend(createMemoryKv(), { storage: memoryStorage() }));
  liveAssetFiles.clear();
});
afterEach(() => {
  setSongPrompt(null);
  __resetSnapshotBackendForTests(null);
  delete globalThis.window;
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

const packageMembers = (req) => {
  const { data, files } = parsePackage(req.bytes);
  return { data, files, manifest: JSON.parse(zipText(files.get("manifest.json"))) };
};

describe("Save with the song inside", () => {
  it("asks once; 'keep inside' saves an .aquapkg with the song, and the next Save overwrites it silently", async () => {
    loadSongProject("p-embed");
    const prompt = vi.fn(async () => "embed");
    setSongPrompt(prompt);
    const first = await saveProject();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0].song.name).toBe("song.mp3");
    expect(first.kind).toBe("package");
    expect(bridge.saveDialog).toHaveBeenCalledWith(expect.objectContaining({ kind: "package" }));
    const req = bridge.writes[0];
    expect(req.kind).toBe("package");
    expect(req.projectKey).toBe("p-embed"); // recorded as the project's clean save
    const { data, files, manifest } = packageMembers(req);
    const song = manifest.assets.find((a) => a.id === "audio:programmer");
    expect(song.packaged).toBeTruthy();
    expect([...files.get(song.packaged)]).toEqual([...SONG]);
    expect(data.programmer.timelineClips).toEqual([{ id: "c1", startTime: 0, duration: 2 }]);
    expect(getFileState()).toMatchObject({ path: "C:/Shows/Song_Show.aquapkg", kind: "package" });
    expect(readSongChoice("p-embed")).toBe("embed");
    expect(useProjectStore.getState().dirty).toBe(false);

    await saveProject();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(bridge.saveDialog).toHaveBeenCalledTimes(1); // no dialog: same package path
    expect(bridge.writes[1]).toMatchObject({ path: "C:/Shows/Song_Show.aquapkg", kind: "package" });
  });

  it("'save without the song' keeps the plain .aqua and is remembered", async () => {
    loadSongProject("p-ref");
    const prompt = vi.fn(async () => "reference");
    setSongPrompt(prompt);
    await saveProject();
    await saveProject();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(bridge.writes.map((w) => w.kind)).toEqual(["aqua", "aqua"]);
    expect(readSongChoice("p-ref")).toBe("reference");
    const saved = JSON.parse(bridge.writes[0].content);
    expect(saved.programmer.audioFileReference.path).toBe(SONG_PATH);
  });

  it("cancel writes nothing and asks again next time", async () => {
    loadSongProject("p-cancel");
    const prompt = vi.fn(async () => "cancel");
    setSongPrompt(prompt);
    expect(await saveProject()).toBeNull();
    expect(bridge.save).not.toHaveBeenCalled();
    expect(readSongChoice("p-cancel")).toBeNull();
    await saveProject();
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("a show without a song saves as before, without asking", async () => {
    useProjectStore.getState().loadProjectDocument({ metadata: { id: "p-nosong", name: "Quiet" }, programmer: { timelineClips: [] } }, "Quiet");
    const prompt = vi.fn();
    setSongPrompt(prompt);
    await saveProject();
    expect(prompt).not.toHaveBeenCalled();
    expect(bridge.writes[0].kind).toBe("aqua");
  });

  it("an opened package re-saves with its song even when the original song path is not on this PC", async () => {
    loadSongProject("p-move");
    setSongPrompt(async () => "embed");
    await saveProject();
    const pkgBytes = bridge.writes[0].bytes;
    // "Another PC": the song file is not on disk; the package is the only copy.
    bridge = makeBridge(new Map());
    globalThis.window.aquaflow = { project: bridge };
    liveAssetFiles.clear();
    localStorage.clear();
    const attached = [];
    window.addEventListener("aquaflow:asset-attached", (e) => attached.push(e.detail.id));
    const { report } = await openProjectBytes({ bytes: pkgBytes, path: "D:/Copied/Song_Show.aquapkg" });
    expect(report.items.find((i) => i.id === "audio:programmer").status).toBe("ok");
    expect(attached).toContain("audio:programmer");
    const prompt = vi.fn();
    setSongPrompt(prompt);
    await saveProject(); // opened from a package: stays a package, no question
    expect(prompt).not.toHaveBeenCalled();
    const req = bridge.writes[0];
    expect(req.path).toBe("D:/Copied/Song_Show.aquapkg");
    const { files, manifest } = packageMembers(req);
    const song = manifest.assets.find((a) => a.id === "audio:programmer");
    expect([...files.get(song.packaged)]).toEqual([...SONG]);
  });

  it("Package Project (menu) still asks for a path and does not change the current file", async () => {
    loadSongProject("p-pkg");
    const res = await packageProject();
    expect(res.embedded).toBe(1);
    expect(bridge.writes[0].projectKey).toBeUndefined();
  });
});

describe("Locating a missing song", () => {
  const item = { id: "audio:programmer", role: "audio", name: "song.mp3", type: "audio/mpeg", status: "missing", sha256: nodeSha(SONG) };

  it("the same file verifies OK and is attached with its new path", async () => {
    loadSongProject("p-locate");
    bridge.pickAsset.mockResolvedValue({ ok: true, path: "E:/Found/song.mp3", sha256: nodeSha(SONG) });
    bridge.readAsset.mockResolvedValue({ ok: true, path: "E:/Found/song.mp3", bytes: SONG });
    const attached = [];
    window.addEventListener("aquaflow:asset-attached", (e) => attached.push(e.detail.file));
    const res = await relinkAsset(item);
    expect(res.status).toBe("ok");
    expect(res.warning).toBeNull();
    expect(attached[0].aquaflowPath).toBe("E:/Found/song.mp3");
    expect(useProjectStore.getState().programmer.audioFileReference.path).toBe("E:/Found/song.mp3");
  });

  it("a different file, or one without a saved hash, is accepted with a warning", async () => {
    loadSongProject("p-locate2");
    const other = new Uint8Array([9, 9, 9]);
    bridge.pickAsset.mockResolvedValue({ ok: true, path: "E:/Other/song.mp3", sha256: nodeSha(other) });
    bridge.readAsset.mockResolvedValue({ ok: true, path: "E:/Other/song.mp3", bytes: other });
    const warnings = [];
    window.addEventListener("aquaflow:project-status", (e) => { if (e.detail.level === "warn") warnings.push(e.detail.text); });
    const different = await relinkAsset(item);
    expect(different.status).toBe("relinked-different");
    expect(different.warning).toMatch(/not the same file/);
    const unhashed = await relinkAsset({ ...item, sha256: null });
    expect(unhashed.status).toBe("relinked");
    expect(unhashed.warning).toMatch(/could not be verified/);
    expect(warnings).toHaveLength(2);
  });

  it("cancelling the file picker changes nothing", async () => {
    bridge.pickAsset.mockResolvedValue({ canceled: true });
    expect(await relinkAsset(item)).toBeNull();
  });
});
