// SimulationCacheSection.jsx — Export3DPanel: the show as an OpenVDB volume sequence and/or
// a PLY particle cache for Houdini, Blender, Unreal, Maya/Arnold, Cinema 4D, Octane.
import { useMemo, useRef, useState } from "react";
import useProjectStore from "../../store/projectStore";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { createFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan } from "../../utils/icanPatternPreview";
import { apiPost } from "../../utils/apiClient";
import { buildHydraulicPreviewPayload } from "../../engineering/hydraulicAdapter";
import { AXIS_PRESETS, SIM_DEFAULTS, exportSimulationCache, safeBaseName } from "../../export3d/simulationCache";
import { openDesktopFolderWriter, createZipWriter } from "../preview/finalRender";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const label = { fontSize: 9.5, color: "var(--text-muted)", marginBottom: 3 };
const input = { width: "100%", padding: "5px 6px", background: "var(--bg-panel)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 4, fontSize: 11 };

/** The show the 3D preview plays: the loaded preview plan, else the programmer's compiled clips. */
export function resolveShowPlan(previewPlan, timelineClips, fixtures, name) {
  if (previewPlan?.visualClips?.length) return { plan: previewPlan, source: "the show loaded in the 3D preview" };
  if (Array.isArray(timelineClips) && timelineClips.length) {
    try {
      const pattern = createFullShowPreview(timelineClips, fixtures, name, { skipUnsupported: true });
      return { plan: createICANPreviewPlan(pattern, 1), source: "the Show Programmer timeline" };
    } catch {
      return { plan: null, source: null };
    }
  }
  return { plan: null, source: null };
}

async function openBrowserFolderWriter() {
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  let bytes = 0;
  const at = async (name, data, position) => {
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable({ keepExistingData: true });
    await w.write({ type: "write", position, data });
    await w.close();
  };
  const sizes = new Map();
  return {
    where: dir.name,
    async write(name, data) {
      const file = await dir.getFileHandle(name, { create: true });
      const w = await file.createWritable();
      await w.write(data);
      await w.close();
      sizes.set(name, data.byteLength);
      bytes += data.byteLength;
    },
    async append(name, data) {
      const end = sizes.get(name) || 0;
      await at(name, data, end);
      sizes.set(name, end + data.byteLength);
      bytes += data.byteLength;
    },
    async patch(name, offset, data) { await at(name, data, offset); },
    async finish() { return null; },
    get bytes() { return bytes; },
  };
}

async function openWriter(name) {
  const bridge = typeof window !== "undefined" ? window.aquaflow?.render : null;
  if (bridge) return openDesktopFolderWriter(bridge, { title: "Choose a folder for the simulation cache" });
  if (typeof window !== "undefined" && window.showDirectoryPicker) return openBrowserFolderWriter();
  const { createZip } = await import("../../utils/zipStore");
  return createZipWriter({ createZip, name });
}

/** One-click targets: what each kind of program can read. */
export const SIM_TARGETS = [
  { id: "d5", label: "D5 Render · 3ds Max · Maya · Cinema 4D · Unreal",
    hint: "Alembic water mesh (.abc, animated) + the pool and site (.fbx). Give the water a water material.",
    opts: { alembic: true, vdb: false, ply: false, blenderScene: false, velocity: false, axes: "yup_m" } },
  { id: "blender", label: "Blender — complete scene",
    hint: "VDB water lit by the RGB fixtures, animated RGB lights, pool, site, camera — run the .py once and it saves a .blend.",
    opts: { alembic: true, vdb: true, ply: false, blenderScene: true, velocity: false, axes: "zup_m" } },
  { id: "houdini", label: "Houdini · VFX (volumes + particles)",
    hint: "OpenVDB sequence (density, vel, Cd) and a PLY particle cache with velocities.",
    opts: { alembic: false, vdb: true, ply: true, blenderScene: false, velocity: true, axes: "yup_m" } },
];

export default function SimulationCacheSection({ fixtures, name, design = null }) {
  const timelineClips = useProjectStore((s) => s.programmer?.timelineClips);
  const previewPlan = useICANPreviewStore((s) => s.plan);
  const show = useMemo(() => resolveShowPlan(previewPlan, timelineClips, fixtures, name),
    [previewPlan, timelineClips, fixtures, name]);
  const duration = show.plan ? Number(show.plan.duration) || 0 : SIM_DEFAULTS.staticSeconds;

  const [opts, setOpts] = useState({ ...SIM_DEFAULTS, ...SIM_TARGETS[0].opts, end: null, useHydraulics: true });
  const [target, setTarget] = useState(SIM_TARGETS[0].id);
  const pickTarget = (t) => { setTarget(t.id); setOpts((o) => ({ ...o, ...t.opts })); };
  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setTarget("custom");
    setOpts((o) => ({ ...o, [k]: e.target.type === "number" || ["fps", "voxelSize", "meshVoxelSize"].includes(k) ? (v === "" ? null : Number(v)) : v }));
  };
  const end = opts.end != null && opts.end > 0 ? Math.min(opts.end, duration) : duration;
  const start = Math.max(0, Math.min(Number(opts.start) || 0, end));
  const frames = Math.max(0, Math.floor((end - start) * opts.fps + 1e-6) + 1);
  const preset = AXIS_PRESETS[opts.axes];

  const [job, setJob] = useState(null);       // { frame, total, bytes, particles }
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const abort = useRef(null);

  const run = async () => {
    setError(""); setStatus("");
    const writer = await openWriter(`${safeBaseName(name)}_simulation`).catch((e) => { setError(e.message); return null; });
    if (!writer) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setJob({ frame: 0, total: frames, bytes: 0, particles: 0 });
    try {
      let nozzlePhysics = null;
      if (opts.useHydraulics) {
        try {
          const res = await apiPost("/hydraulics/preview-physics", buildHydraulicPreviewPayload({ fixtures, pumps: fixtures }));
          nozzlePhysics = res?.nozzle_physics && Object.keys(res.nozzle_physics).length ? res.nozzle_physics : null;
        } catch { nozzlePhysics = null; }
      }
      const manifest = await exportSimulationCache({
        fixtures, plan: show.plan, nozzlePhysics, name, writer, signal: ctrl.signal, design,
        options: { ...opts, start, end },
        onProgress: (p) => setJob(p),
      });
      const blob = await writer.finish();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = writer.where; document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      setStatus(`Wrote ${manifest.frames} frames (${(manifest.stats.bytes / 1e6).toFixed(1)} MB) to ${writer.where}`
        + (nozzlePhysics ? " — jet heights from the hydraulic solve." : "."));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setJob(null);
      abort.current = null;
    }
  };

  return (
    <div style={{ ...box, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Whole simulation for 3D software</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}>
          The water of the show, frame by frame, from the same emitters, physics and RGB lighting as the 3D
          preview. {show.plan
            ? <>Source: {show.source} ({duration.toFixed(1)} s).</>
            : <>No show loaded — every nozzle runs at 100 % for {SIM_DEFAULTS.staticSeconds} s.</>}
        </div>
      </div>

      <div role="radiogroup" aria-label="Export for" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {SIM_TARGETS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={target === t.id} onClick={() => pickTarget(t)} style={{
            ...box, padding: 8, textAlign: "left", cursor: "pointer",
            borderColor: target === t.id ? "var(--accent)" : "var(--border)", outline: target === t.id ? "1px solid var(--accent)" : "none" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{t.label}</div>
            <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.35 }}>{t.hint}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <div><div style={label}>Start (s)</div>
          <input type="number" min={0} max={duration} step={0.5} value={opts.start ?? 0} onChange={set("start")} style={input} aria-label="Simulation start" /></div>
        <div><div style={label}>End (s)</div>
          <input type="number" min={0} max={duration} step={0.5} value={opts.end ?? ""} placeholder={duration.toFixed(1)} onChange={set("end")} style={input} aria-label="Simulation end" /></div>
        <div><div style={label}>Frame rate</div>
          <select value={opts.fps} onChange={set("fps")} style={input} aria-label="Simulation frame rate">
            {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select></div>
        <div><div style={label}>{opts.alembic && !opts.vdb ? "Mesh detail" : "Voxel size"}</div>
          {opts.alembic && !opts.vdb ? (
            <select value={opts.meshVoxelSize} onChange={set("meshVoxelSize")} style={input} aria-label="Mesh detail">
              {[[0.03, "Fine (3 cm, large file)"], [0.05, "Standard (5 cm)"], [0.08, "Light (8 cm)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : (
          <select value={opts.voxelSize} onChange={set("voxelSize")} style={input} aria-label="Voxel size">
            {[[0.02, "2 cm (fine, large)"], [0.03, "3 cm"], [0.05, "5 cm"], [0.1, "10 cm (draft)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>)}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div><div style={label}>Target software (axes and units)</div>
          <select value={opts.axes} onChange={set("axes")} disabled={opts.blenderScene} style={input} aria-label="Target axes">
            {Object.entries(AXIS_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select></div>
        <div><div style={label}>Particle density</div>
          <select value={opts.particleRate} onChange={(e) => setOpts((o) => ({ ...o, particleRate: Number(e.target.value) }))} style={input} aria-label="Particle density">
            {[[2, "Draft"], [4, "Standard"], [8, "Dense"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--text-secondary)" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.alembic} onChange={set("alembic")} /> Alembic water mesh (.abc)</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.vdb} onChange={set("vdb")} /> OpenVDB volumes (.vdb)</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.blenderScene} onChange={set("blenderScene")} /> Blender scene builder (.py + lights + pool)</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.color} onChange={set("color")} /> RGB light colour on the water</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.velocity} disabled={!opts.vdb} onChange={set("velocity")} /> Velocity grid (off for Unreal)</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.ply} onChange={set("ply")} /> Particle cache (.ply)</label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={opts.useHydraulics} onChange={set("useHydraulics")} /> Jet heights from the hydraulic solve (pumps)</label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {!job ? (
          <button onClick={run} disabled={!fixtures.length || !frames || (!opts.vdb && !opts.ply && !opts.alembic)} style={{
            padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", background: "var(--accent)",
            color: "#04121a", fontWeight: 700, fontSize: 12 }}>
            ⬇ Export {frames} frames
          </button>
        ) : (
          <button onClick={() => abort.current?.abort()} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border)",
            background: "var(--bg-panel)", color: "var(--text-primary)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
        )}
        <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
          {job
            ? `Frame ${job.frame}/${job.total} · ${(job.bytes / 1e6).toFixed(1)} MB · ${job.particles?.toLocaleString?.() ?? 0} droplets`
            : `${opts.alembic ? `${safeBaseName(name)}_water.abc` : ""}${opts.alembic && opts.vdb ? " + " : ""}${opts.vdb ? `${safeBaseName(name)}.0001.vdb … (${preset.label.split(" — ")[1]})` : ""}`}
        </span>
      </div>
      {status && <div style={{ fontSize: 11, color: "#22c55e" }}>{status}</div>}
      {error && <div style={{ fontSize: 11, color: "#ef4444" }}>{error}</div>}
    </div>
  );
}
