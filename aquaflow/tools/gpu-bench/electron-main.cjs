/**
 * electron-main.cjs — AF-NEXT-013 GPU bench / screenshot driver (Electron main process).
 *
 * Launched by run.mjs as:  electron electron-main.cjs <job.json>
 * The job names the dev-server URL, the runs to execute and where to write results.
 * Hardware acceleration stays ON (Electron default, same as the shipped desktop app).
 * vsync and the frame-rate cap are disabled so frame time reflects the GPU/CPU cost,
 * not the 60 Hz display. The GPU blocklist is honoured unless the job opts out.
 */
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const jobPath = process.argv.find(a => a.endsWith(".json") && fs.existsSync(a));
if (!jobPath) { console.error("[gpu-bench] no job file"); process.exit(2); }
const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));

if (!job.vsync) {   // --vsync keeps the 60 Hz cadence the desktop app actually runs with
  app.commandLine.appendSwitch("disable-gpu-vsync");
  app.commandLine.appendSwitch("disable-frame-rate-limit");
}
app.commandLine.appendSwitch("force-device-scale-factor", "1");
if (job.ignoreGpuBlocklist) app.commandLine.appendSwitch("ignore-gpu-blocklist");
if (job.angle) app.commandLine.appendSwitch("use-angle", job.angle);   // e.g. d3d11 (Windows default)

const log = (...a) => console.log("[gpu-bench]", ...a);

async function waitReady(win) {
  for (let i = 0; i < 600; i++) {
    const ok = await win.webContents.executeJavaScript("!!(window.__gpuBench && window.__gpuBench.ready)").catch(() => false);
    if (ok) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error("bench page did not become ready (is the Vite dev server up?)");
}

function gpuProcessMemoryMB() {
  const gpu = app.getAppMetrics().find(m => m.type === "GPU");
  return gpu?.memory ? Number((gpu.memory.workingSetSize / 1024).toFixed(1)) : null;
}

/** Pixel diff of two equally sized BGRA bitmaps. Returns ratio + a diff PNG. */
function diffImages(a, b, { threshold = 24 } = {}) {
  const sa = a.getSize(), sb = b.getSize();
  if (sa.width !== sb.width || sa.height !== sb.height) return { sizeMismatch: true, ratio: 1, meanAbs: 255 };
  const A = a.toBitmap(), B = b.toBitmap();
  const out = Buffer.alloc(A.length);
  let differing = 0, sumAbs = 0;
  const n = sa.width * sa.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2]));
    sumAbs += (Math.abs(A[o] - B[o]) + Math.abs(A[o + 1] - B[o + 1]) + Math.abs(A[o + 2] - B[o + 2])) / 3;
    if (d > threshold) {
      differing++;
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 255; out[o + 3] = 255;           // red (BGRA)
    } else {
      const g = ((A[o] + A[o + 1] + A[o + 2]) / 3) * 0.35;
      out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return {
    ratio: differing / n, differing, pixels: n, meanAbs: Number((sumAbs / n).toFixed(3)),
    diffPng: nativeImage.createFromBitmap(out, { width: sa.width, height: sa.height }).toPNG(),
  };
}

/**
 * Washout metrics of an image (sRGB bytes): mean HSV saturation of lit pixels (max
 * channel > 40) and the share of lit pixels that are near-white (every channel > 230).
 */
function colourStats(img) {
  const B = img.toBitmap();
  let lit = 0, satSum = 0, white = 0;
  for (let o = 0; o < B.length; o += 4) {
    const b = B[o], g = B[o + 1], r = B[o + 2];
    const mx = Math.max(r, g, b);
    if (mx <= 40) continue;
    lit++;
    satSum += (mx - Math.min(r, g, b)) / mx;
    if (r > 230 && g > 230 && b > 230) white++;
  }
  return { litPixels: lit, meanSaturation: lit ? Number((satSum / lit).toFixed(4)) : 0, nearWhiteShare: lit ? Number((white / lit).toFixed(4)) : 0 };
}

async function runShots(win, results) {
  const s = job.shots;
  fs.mkdirSync(s.outDir, { recursive: true });
  fs.mkdirSync(s.baselineDir, { recursive: true });
  for (const cfg of s.scenes) {
    const t0 = Date.now();
    log("shot", cfg.name);
    const r = await win.webContents.executeJavaScript(`window.__gpuBench.shot(${JSON.stringify(cfg.params)})`);
    const img = nativeImage.createFromDataURL(r.png);
    const png = img.toPNG();
    const jpg = img.toJPEG(s.jpegQuality || 85);
    fs.writeFileSync(path.join(s.outDir, `${cfg.name}.png`), png);
    fs.writeFileSync(path.join(s.outDir, `${cfg.name}.jpg`), jpg);
    const basePng = path.join(s.baselineDir, `${cfg.name}.png`);
    const rec = { name: cfg.name, description: cfg.description, ms: Date.now() - t0, width: r.width, height: r.height,
      counts: r.counts, drawCalls: r.drawCalls, triangles: r.triangles, exposure: r.exposure, toneMapping: r.toneMapping,
      pngBytes: png.length, jpgBytes: jpg.length, colour: colourStats(img), params: { ...cfg.params, aqua: cfg.params.aqua ? "(Lebu pilot .aqua)" : undefined } };
    if (fs.existsSync(basePng) && !s.updateBaseline) {
      const d = diffImages(img, nativeImage.createFromPath(basePng), { threshold: s.threshold });
      rec.compare = { baseline: basePng, ratio: Number(d.ratio.toFixed(5)), meanAbs: d.meanAbs, sizeMismatch: !!d.sizeMismatch,
        tolerance: s.tolerance, pass: !d.sizeMismatch && d.ratio <= s.tolerance };
      if (d.diffPng) fs.writeFileSync(path.join(s.outDir, `${cfg.name}.diff.png`), d.diffPng);
    } else {
      fs.writeFileSync(basePng, png);
      rec.compare = { baseline: basePng, created: true };
    }
    results.shots.push(rec);
  }
  // Before/after pairs (same scene, density normalisation off vs on).
  results.pairs = [];
  for (const [a, b] of s.pairs || []) {
    const pa = path.join(s.outDir, `${a}.png`), pb = path.join(s.outDir, `${b}.png`);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) continue;
    const d = diffImages(nativeImage.createFromPath(pa), nativeImage.createFromPath(pb), { threshold: s.threshold });
    const ca = colourStats(nativeImage.createFromPath(pa)), cb = colourStats(nativeImage.createFromPath(pb));
    results.pairs.push({ a, b, ratio: Number(d.ratio.toFixed(5)), meanAbs: d.meanAbs,
      satBefore: ca.meanSaturation, satAfter: cb.meanSaturation, whiteBefore: ca.nearWhiteShare, whiteAfter: cb.nearWhiteShare });
  }
}

async function runBench(win, results) {
  for (const cfg of job.bench.runs) {
    log("bench", cfg.quality, cfg.fixtures);
    const startedAt = Date.now();
    const r = await win.webContents.executeJavaScript(`window.__gpuBench.bench(${JSON.stringify(cfg)})`);
    results.bench.push({ ...r, startedAt, endedAt: Date.now(), gpuProcessWorkingSetMB: gpuProcessMemoryMB() });
    // Let the GPU process settle between runs.
    await new Promise(res => setTimeout(res, 800));
  }
}

app.whenReady().then(async () => {
  const results = { job: { mode: job.mode, url: job.url }, startedAt: Date.now(), bench: [], shots: [] };
  const win = new BrowserWindow({
    width: job.window?.width || 1920, height: job.window?.height || 1080, x: 0, y: 0,
    show: true, backgroundColor: "#000000", autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  results.console = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2 && results.console.length < 200) { results.console.push(message.slice(0, 2000)); console.log("[page]", message.slice(0, process.env.AF_BENCH_LOG_CHARS ? Number(process.env.AF_BENCH_LOG_CHARS) : 400)); }
  });
  try {
    await win.loadURL(job.url);
    await waitReady(win);
    results.webgl = await win.webContents.executeJavaScript("window.__gpuBench.info()");
    results.gpuFeatureStatus = app.getGPUFeatureStatus();
    try { results.gpuInfo = await app.getGPUInfo("basic"); } catch (e) { results.gpuInfo = { error: String(e) }; }
    results.electron = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node };
    if (job.bench) await runBench(win, results);
    if (job.shots) await runShots(win, results);
    results.ok = true;
  } catch (e) {
    results.ok = false;
    results.error = String(e?.stack || e);
    console.error("[gpu-bench]", results.error);
  }
  results.endedAt = Date.now();
  fs.writeFileSync(job.resultPath, JSON.stringify(results, null, 2));
  win.destroy();
  app.exit(results.ok ? 0 : 1);
});
