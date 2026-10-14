#!/usr/bin/env node
/**
 * AF-NEXT-013 — real-GPU benchmark and fixed-scene screenshot runner.
 *
 *   node aquaflow/tools/gpu-bench/run.mjs                 # bench + shots
 *   node aquaflow/tools/gpu-bench/run.mjs --bench         # benchmark only
 *   node aquaflow/tools/gpu-bench/run.mjs --shots         # screenshots only
 *   options: --tiers low,medium,high  --sizes 20,100,300  --sample-ms 10000
 *            --warmup-ms 3000  --update-baseline  --threshold 24  --tolerance 0.02
 *            --angle d3d11  --ignore-gpu-blocklist  --date 2026-10-13
 *            --aqua <project.aqua>   bench this project instead of the bundled Lebu pilot
 *            --width 1440 --height 900   synthetic-site canvas (default 1920x1080)
 *            --vsync                 keep vsync/frame cap ON (what the desktop app runs with)
 *            --out-suffix <name>     evidence file suffix (keeps earlier evidence files)
 *
 * 1. Starts a Vite dev server for aquaflow/frontend on a free port (not 3000).
 * 2. Launches the local Electron 33 binary (hardware acceleration on, vsync off) on
 *    src/components/preview/__bench__/gpuBench.html at 1920x1080.
 * 3. Writes docs/evidence/AF-NEXT-013-gpu-<gpu-slug>.{json,md} and/or the screenshot
 *    set under docs/preview-realism/<date>/, then closes everything it started.
 * Nothing here talks to fountain hardware.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..", "..");            // aquaflow/
const repoDir = path.resolve(appDir, "..");
const frontendDir = path.join(appDir, "frontend");
const docsDir = path.join(repoDir, "docs");

// ─── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const doBench = flag("bench") || !flag("shots");
const doShots = flag("shots") || !flag("bench");
const tiers = opt("tiers", "eco,low,medium,high").split(",");
const sizes = opt("sizes", "20,100,300").split(",").map(Number);
const sampleMs = Number(opt("sample-ms", 10000));
const warmupMs = Number(opt("warmup-ms", 3000));
const today = opt("date", new Date().toLocaleDateString("sv-SE"));   // YYYY-MM-DD local
const SIZE_LIMIT = 300 * 1024;

// ─── machine facts ─────────────────────────────────────────────────────────
function ps(cmd) {
  try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 30000 }).trim(); }
  catch { return ""; }
}
function machineInfo() {
  const parse = s => { try { const j = JSON.parse(s); return Array.isArray(j) ? j : [j]; } catch { return []; } };
  const gpus = process.platform === "win32" ? parse(ps("Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,DriverDate,AdapterRAM,VideoProcessor,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress")) : [];
  const cpu = process.platform === "win32" ? parse(ps("Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ConvertTo-Json -Compress")) : [];
  const osInfo = process.platform === "win32" ? parse(ps("Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress"))[0] : null;
  return {
    gpus, cpu: cpu[0] || { Name: os.cpus()[0]?.model, NumberOfLogicalProcessors: os.cpus().length },
    os: osInfo || { Caption: `${os.type()} ${os.release()}` },
    ramGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    node: process.version, hostname: os.hostname(),
  };
}

const NVSMI = ["C:/Program Files/NVIDIA Corporation/NVSMI/nvidia-smi.exe", "C:/Windows/System32/nvidia-smi.exe"].find(p => fs.existsSync(p));
function nvsmiSample() {
  if (!NVSMI) return null;
  try {
    const out = execFileSync(NVSMI, ["--query-gpu=memory.used,memory.total,utilization.gpu,clocks.gr,temperature.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 4000 }).trim();
    const [used, total, util, clock, temp] = out.split(",").map(s => Number(s.trim()));
    return { t: Date.now(), usedMB: used, totalMB: total, util: Number.isFinite(util) ? util : null, clockMHz: Number.isFinite(clock) ? clock : null, tempC: Number.isFinite(temp) ? temp : null };
  } catch { return null; }
}

function findElectron() {
  const candidates = [
    process.env.ELECTRON_PATH,
    path.join(appDir, "desktop", "node_modules", "electron", "dist", "electron.exe"),
    path.join(appDir, "desktop", "node_modules", "electron", "dist", "electron"),
  ];
  const cache = path.join(repoDir, ".build-cache");
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter(d => d.startsWith("electron-dist-")).sort().reverse()) candidates.push(path.join(cache, d, "electron.exe"));
  }
  const hit = candidates.find(p => p && fs.existsSync(p));
  if (!hit) throw new Error("Electron binary not found. Run `npm install` in aquaflow/desktop or set ELECTRON_PATH.");
  return hit;
}

const slug = s => String(s || "unknown-gpu").toLowerCase().replace(/\(r\)|\(tm\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const aquaPath = opt("aqua", null);
const lebuAqua = () => JSON.parse(fs.readFileSync(aquaPath || path.join(appDir, "samples", "lebu-pilot", "Lebu_Fountain_Pilot.aqua"), "utf8"));
const synthW = Number(opt("width", 1920)), synthH = Number(opt("height", 1080));

// ─── screenshot scene set ──────────────────────────────────────────────────
function shotScenes() {
  const aqua = JSON.parse(fs.readFileSync(path.join(appDir, "samples", "lebu-pilot", "Lebu_Fountain_Pilot.aqua"), "utf8"));
  const base = { time: 4, seed: 1234, quality: "medium", environment: "night", width: 960, height: 540 };
  const synthView = { position: { x: 0, y: 13, z: 30 }, target: { x: 0, y: 1, z: 0 } };
  const syn = (name, extra, description) => ({ name, description, params: { ...base, content: "synthetic", view: synthView, ...extra } });
  const lebu = (name, viewId, extra = {}, description) => ({ name, description, params: { ...base, content: "lebu", aqua, viewId, ...extra } });
  return [
    syn("synthetic-300-allon-design-aces", { fixtures: 300, colors: "design", toneMapping: "aces" }, "300 fixtures, every light on in its design colour, ACES"),
    syn("synthetic-300-allon-design-aces-before", { fixtures: 300, colors: "design", toneMapping: "aces", densityNorm: false }, "Same, density normalisation OFF (pre-fix reference)"),
    syn("synthetic-300-allon-design-agx", { fixtures: 300, colors: "design", toneMapping: "agx" }, "300 all-on, AgX"),
    syn("synthetic-300-allon-design-neutral", { fixtures: 300, colors: "design", toneMapping: "neutral" }, "300 all-on, Neutral"),
    syn("synthetic-20-on-design-neutral", { fixtures: 20, colors: "design", toneMapping: "neutral" }, "20 fixtures, Neutral"),
    lebu("lebu-apex-three-quarter-neutral", "apex-three-quarter", { toneMapping: "neutral" }, "Lebu pilot, Neutral tone mapping"),
    syn("synthetic-300-allon-blue-aces", { fixtures: 300, colors: "runtime", toneMapping: "aces" }, "300 all-on, one runtime colour (#0066ff), ACES"),
    syn("synthetic-300-allon-blue-aces-before", { fixtures: 300, colors: "runtime", toneMapping: "aces", densityNorm: false }, "Same, density normalisation OFF"),
    syn("synthetic-20-on-design-aces", { fixtures: 20, colors: "design", toneMapping: "aces" }, "20 fixtures (sparse) — must match the pre-fix look"),
    syn("synthetic-20-on-design-aces-before", { fixtures: 20, colors: "design", toneMapping: "aces", densityNorm: false }, "20 fixtures, normalisation OFF"),
    lebu("lebu-base-audience", "base-audience", {}, "Lebu pilot, saved view Audience · base edge, design colours"),
    lebu("lebu-apex-three-quarter", "apex-three-quarter", {}, "Lebu pilot, Three-quarter · apex side"),
    lebu("lebu-apex-three-quarter-before", "apex-three-quarter", { densityNorm: false }, "Lebu, normalisation OFF"),
    lebu("lebu-plan-top", "plan-top", {}, "Lebu pilot, Plan · top-down"),
    lebu("lebu-center-feature", "center-feature", {}, "Lebu pilot, Center feature close-up"),
    lebu("lebu-apex-three-quarter-eco", "apex-three-quarter", { quality: "eco" }, "Lebu pilot on the eco tier (entry GPUs)"),
    syn("synthetic-300-allon-blue-eco", { fixtures: 300, colors: "runtime", toneMapping: "aces", quality: "eco" }, "300 all-on, runtime #0066ff, eco tier"),
  ];
}
const PAIRS = [
  ["synthetic-300-allon-design-aces-before", "synthetic-300-allon-design-aces"],
  ["synthetic-300-allon-blue-aces-before", "synthetic-300-allon-blue-aces"],
  ["synthetic-20-on-design-aces-before", "synthetic-20-on-design-aces"],
  ["lebu-apex-three-quarter-before", "lebu-apex-three-quarter"],
];

/** --ablate: medium / 100 fixtures with one feature off at a time (cost breakdown). */
const ABLATIONS = [
  null, { post: false }, { shadows: false }, { reflection: false }, { softDepth: false },
  { cones: false }, { particles: false }, { halfResSpray: true },
  { post: false, shadows: false, reflection: false },
  { msaa: 0 }, { bloom: false }, { grade: false }, { msaa: 0, halfResSpray: true },
];

/** --ablate-eco: the Lebu pilot on eco at 1440x900, one lever at a time. */
const ECO_ABLATIONS = [
  { ablate: null }, { ablate: { post: false } }, { ablate: { bloom: false } }, { ablate: { grade: false } },
  { ablate: { softDepth: false } }, { ablate: { particles: false } }, { renderScale: 0.8 },
];

// ─── markdown ──────────────────────────────────────────────────────────────
function benchMarkdown(r) {
  const g = r.machine.gpus.map(x => `${x.Name} (driver ${x.DriverVersion})`).join("; ");
  const lines = [
    `# AF-NEXT-013 GPU benchmark — ${r.gpuName}`, "",
    `Measured ${new Date(r.startedAt).toISOString()} with \`node aquaflow/tools/gpu-bench/run.mjs --bench\`.`, "",
    "| Machine | |", "| --- | --- |",
    `| GPU (Win32_VideoController) | ${g} |`,
    `| WebGL renderer | ${r.webgl?.renderer} (${r.webgl?.vendor}), WebGL ${r.webgl?.webgl} |`,
    `| CPU | ${r.machine.cpu.Name} (${r.machine.cpu.NumberOfCores ?? "?"}C/${r.machine.cpu.NumberOfLogicalProcessors ?? "?"}T) |`,
    `| RAM | ${r.machine.ramGB} GB |`,
    `| OS | ${r.machine.os.Caption} ${r.machine.os.Version || ""} |`,
    `| Runtime | Electron ${r.electron?.electron} / Chrome ${r.electron?.chrome}, ${r.config.vsync ? "vsync ON (as the desktop app)" : "vsync off, frame-rate limit off"}, device scale 1 |`,
    `| GPU feature status | webgl2: ${r.gpuFeatureStatus?.webgl2}, gpu_compositing: ${r.gpuFeatureStatus?.gpu_compositing} |`,
    `| Window / canvas | canvas ${r.bench[0]?.resolution?.width}x${r.bench[0]?.resolution?.height} CSS px, pixel ratio 1 |`,
    `| Window | warm-up ${r.config.warmupMs} ms, sample ${r.config.sampleMs} ms, camera: benchCameraAt() orbit r=30 m h=13 m |`,
    "",
    "Synthetic site (40 x 22 m basin, ~64 % nozzles / 36 % RGB lights, all water and all lights on, runtime colour #0066ff, night, ACES).",
    "", "| Tier | Scene: fixtures (noz/lights) | Buffer | Mean ms (fps) | Median ms | p95 ms | p99 ms | Max ms | Frames | Draw calls | Triangles | Particles | GPU mem est. MB | VRAM used Δ MB (nvidia-smi) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const b of r.bench) {
    const f = b.frameTime;
    const ab = b.ablate ? ` − ${Object.entries(b.ablate).map(([k, v]) => `${k}=${v}`).join(", ")}` : "";
    const what = b.content === "lebu" ? `${r.config.aqua || "Lebu pilot"} ` : "";
    const sc = b.renderScale && b.renderScale !== 1 ? ` @ scale ${b.renderScale}` : "";
    lines.push(`| ${b.quality}${ab}${sc} | ${what}${b.fixtures} (${b.nozzles}/${b.lights}) | ${b.resolution.drawingBuffer.width}x${b.resolution.drawingBuffer.height} | **${f.meanMs} (${f.meanFps})** | ${f.medianMs} | ${f.p95Ms} | ${f.p99Ms} | ${f.maxMs} | ${f.frames} | ${b.drawCalls.median} | ${b.triangles.median.toLocaleString("en-US")} | ${b.particles.median.toLocaleString("en-US")} ${b.particles.backend} | ${b.gpuMemoryEstimateMB ?? "–"} | ${b.vramDeltaMB ?? "–"} |`);
  }
  lines.push("", "Frame time = interval between consecutive requestAnimationFrame callbacks (CPU + GPU, vsync off).",
    "**Mean** (= sampled time / frames) is the throughput figure to quote: with vsync off Chrome lets the CPU run ahead and then blocks on the GPU queue, so on a GPU-bound machine single intervals alternate between ~5 ms and several hundred ms and the median can badly flatter the real frame rate.",
    "GPU mem est. = bytes the page allocated through WebGL (textures, buffers, renderbuffers; drawing buffer excluded) — a lower bound.",
    "VRAM used Δ = nvidia-smi memory.used peak during the run minus the idle reading before the bench started (whole GPU, includes the desktop).", "");
  return lines.join("\n");
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main() {
  const electron = findElectron();
  const machine = machineInfo();
  console.log("[gpu-bench] electron:", electron);
  console.log("[gpu-bench] GPU:", machine.gpus.map(g => g.Name).join(", "));

  const { createServer } = await import(pathToFileURL(path.join(frontendDir, "node_modules", "vite", "dist", "node", "index.js")).href);
  const server = await createServer({ root: frontendDir, configFile: path.join(frontendDir, "vite.config.js"), logLevel: "warn",
    server: { port: 5317, strictPort: false, open: false, hmr: false } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, "");
  const url = `${base}/src/components/preview/__bench__/gpuBench.html`;
  console.log("[gpu-bench] page:", url);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "af-gpu-bench-"));
  const resultPath = path.join(tmp, "result.json");
  const realismDir = path.join(docsDir, "preview-realism");
  const localDir = path.join(realismDir, "_local");
  const job = {
    mode: [doBench && "bench", doShots && "shots"].filter(Boolean).join("+"), url, resultPath,
    angle: opt("angle", null), ignoreGpuBlocklist: flag("ignore-gpu-blocklist"), vsync: flag("vsync"),
    window: { width: 1920, height: 1080 },
    bench: doBench ? { runs: flag("ablate-eco") ? ECO_ABLATIONS.map(ablate => ({ quality: "eco", content: "lebu", aqua: lebuAqua(), width: 1440, height: 900, warmupMs, sampleMs,
        cameraPath: { radius: 16, height: 6, period: 60, start: 0.4 }, ...ablate }))
      : flag("ablate") ? ABLATIONS.map(ablate => ({ quality: "medium", fixtures: 100, width: 1920, height: 1080, warmupMs, sampleMs, ablate }))
      : [
        ...tiers.flatMap(q => sizes.map(n => ({ quality: q, fixtures: n, width: synthW, height: synthH, warmupMs, sampleMs }))),
        // The Lebu pilot at this PC's native 1440x900 (AF-NEXT-013 eco target: >= 30 fps).
        ...(flag("no-lebu") ? [] : tiers.flatMap(q => [1, ...(q === "eco" || q === "low" ? [] : [0.6])].map(renderScale => ({
          quality: q, content: "lebu", aqua: lebuAqua(), width: 1440, height: 900, warmupMs, sampleMs, renderScale,
          cameraPath: { radius: 16, height: 6, period: 60, start: 0.4 } })))),
      ] } : null,
    shots: doShots ? {
      scenes: shotScenes().filter(sc => !opt("only", null) || sc.name.includes(opt("only", null))), pairs: PAIRS,
      outDir: path.join(localDir, today), baselineDir: path.join(localDir, "baseline"),
      updateBaseline: flag("update-baseline"), threshold: Number(opt("threshold", 24)), tolerance: Number(opt("tolerance", 0.02)), jpegQuality: 85,
    } : null,
  };
  // Seed the local baseline from the committed one (only the small images are committed).
  if (doShots) {
    const committed = path.join(realismDir, "baseline");
    fs.mkdirSync(job.shots.baselineDir, { recursive: true });
    if (fs.existsSync(committed)) for (const f of fs.readdirSync(committed).filter(f => f.endsWith(".png"))) {
      const dst = path.join(job.shots.baselineDir, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(path.join(committed, f), dst);
    }
  }
  const jobPath = path.join(tmp, "job.json");
  fs.writeFileSync(jobPath, JSON.stringify(job));

  const idleVram = nvsmiSample();
  const vram = [];
  const poll = NVSMI ? setInterval(() => { const s = nvsmiSample(); if (s) vram.push(s); }, 1000) : null;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;   // set by some IDE/agent shells; it would make electron.exe act as node
  const child = spawn(electron, [path.join(here, "electron-main.cjs"), jobPath], { stdio: "inherit", env });
  const code = await new Promise(res => child.on("exit", c => res(c)));
  if (poll) clearInterval(poll);
  await server.close();
  if (!fs.existsSync(resultPath)) throw new Error(`Electron exited with ${code} and no result`);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!result.ok) throw new Error(result.error);

  const gpuName = result.webgl?.renderer?.match(/ANGLE \([^,]+, ([^(]+?)(?: \(|,|\))/)?.[1]?.trim() || machine.gpus[0]?.Name || "unknown";
  const out = { task: "AF-NEXT-013", gpuName, machine, webgl: result.webgl, gpuFeatureStatus: result.gpuFeatureStatus,
    gpuInfo: result.gpuInfo, electron: result.electron, startedAt: result.startedAt, endedAt: result.endedAt,
    config: { tiers, sizes, sampleMs, warmupMs, vsync: flag("vsync"), aqua: aquaPath ? path.basename(aquaPath) : null }, nvidiaSmi: NVSMI ? { idle: idleVram } : null };

  if (doBench) {
    out.bench = result.bench.map(b => {
      const during = vram.filter(s => s.t >= b.startedAt && s.t <= b.endedAt);
      const peak = during.length ? Math.max(...during.map(s => s.usedMB)) : null;
      return { ...b, vramPeakMB: peak, vramDeltaMB: peak != null && idleVram ? peak - idleVram.usedMB : null,
        gpuUtilMax: during.length ? Math.max(...during.map(s => s.util ?? 0)) : null };
    });
    const evDir = path.join(docsDir, "evidence");
    fs.mkdirSync(evDir, { recursive: true });
    const suffix = opt("out-suffix", null);
    const stem = path.join(evDir, `AF-NEXT-013-gpu-${slug(gpuName)}${flag("ablate") ? "-ablation" : flag("ablate-eco") ? "-eco-ablation" : ""}${suffix ? `-${suffix}` : ""}`);
    fs.writeFileSync(`${stem}.json`, JSON.stringify(out, null, 2));
    fs.writeFileSync(`${stem}.md`, benchMarkdown(out));
    console.log("[gpu-bench] wrote", `${stem}.md`);
    console.table(out.bench.map(b => ({ tier: b.quality + (b.ablate ? " " + JSON.stringify(b.ablate) : "") + (b.renderScale !== 1 ? ` x${b.renderScale}` : ""), scene: `${b.content || "synthetic"} ${b.resolution.width}x${b.resolution.height}`, fixtures: b.fixtures, meanMs: b.frameTime.meanMs, fps: b.frameTime.meanFps, medianMs: b.frameTime.medianMs, p99: b.frameTime.p99Ms, max: b.frameTime.maxMs, draws: b.drawCalls.median, tris: b.triangles.median, vramDelta: b.vramDeltaMB })));
  }

  if (doShots) {
    // Committable set: JPEG review copies (and PNG baselines) only when <= 300 KB;
    // everything full-size stays under the gitignored _local/ folder, recorded by hash.
    const ignore = path.join(realismDir, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, ["# Full-size captures, diffs and over-limit baselines (see baseline/baseline-manifest.json)", "_local/", ""].join("\n"));
    const pubDir = path.join(realismDir, today);
    const pubBase = path.join(realismDir, "baseline");
    fs.mkdirSync(pubDir, { recursive: true });
    fs.mkdirSync(pubBase, { recursive: true });
    const manifest = { task: "AF-NEXT-013", date: today, gpuName, webgl: result.webgl?.renderer, sizeLimitBytes: SIZE_LIMIT,
      threshold: job.shots.threshold, tolerance: job.shots.tolerance, scenes: [], pairs: result.pairs || [] };
    for (const s of result.shots) {
      const localPng = path.join(job.shots.outDir, `${s.name}.png`);
      const localJpg = path.join(job.shots.outDir, `${s.name}.jpg`);
      const rec = { ...s, pngSha256: sha256(localPng), committed: [] };
      if (s.jpgBytes <= SIZE_LIMIT) { fs.copyFileSync(localJpg, path.join(pubDir, `${s.name}.jpg`)); rec.committed.push(`${today}/${s.name}.jpg`); }
      const basePng = path.join(job.shots.baselineDir, `${s.name}.png`);
      if (fs.existsSync(basePng)) {
        rec.baselineSha256 = sha256(basePng);
        rec.baselineBytes = fs.statSync(basePng).size;
        if (rec.baselineBytes <= SIZE_LIMIT) { fs.copyFileSync(basePng, path.join(pubBase, `${s.name}.png`)); rec.committed.push(`baseline/${s.name}.png`); }
      }
      manifest.scenes.push(rec);
    }
    fs.writeFileSync(path.join(pubDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(pubBase, "baseline-manifest.json"), JSON.stringify({
      task: "AF-NEXT-013", gpuName, note: "Per-machine baseline. PNGs over the size limit live in _local/baseline (gitignored); hashes below.",
      scenes: manifest.scenes.map(s => ({ name: s.name, sha256: s.baselineSha256, bytes: s.baselineBytes, params: s.params })),
    }, null, 2));
    console.table(manifest.scenes.map(s => ({ scene: s.name, jpgKB: Math.round(s.jpgBytes / 1024), pngKB: Math.round(s.pngBytes / 1024), diff: s.compare?.ratio ?? (s.compare?.created ? "baseline created" : "–"), pass: s.compare?.pass ?? "" })));
    console.table(manifest.pairs);
    const failed = manifest.scenes.filter(s => s.compare && s.compare.pass === false);
    if (failed.length) { console.error("[gpu-bench] screenshot regressions:", failed.map(s => s.name).join(", ")); process.exitCode = 3; }
  }
}

main().catch(e => { console.error("[gpu-bench] FAILED:", e?.stack || e); process.exit(1); });
