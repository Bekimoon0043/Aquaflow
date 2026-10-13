#!/usr/bin/env node
// AF-NEXT-016 — read-only desktop release smoke through Chromium DevTools.
// Launch the unpacked/installed app with --remote-debugging-port=<port> and an
// isolated --user-data-dir first. This script opens the bundled pilot and the
// controller catalog; it never arms, starts, pulses, deploys or writes hardware.

const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.argv[2] || 9231);
const screenshot = process.argv[3] ? path.resolve(process.argv[3]) : null;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function target() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((item) => item.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(item.url));
      if (page) return page;
    } catch {}
    await delay(500);
  }
  throw new Error(`No AquaFlow page found on DevTools port ${port}`);
}

async function run() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("DevTools WebSocket failed"));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Evaluation failed");
    return response.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(300);
    }
    const buttons = await evaluate("[...document.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean).slice(0, 80)");
    const body = await evaluate("document.body.innerText.slice(0, 2500)");
    throw new Error(`Timed out waiting for ${label}; buttons: ${buttons.join(' | ')}; body: ${body}`);
  };

  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await waitFor("document.body && document.body.innerText.includes('Design')", "studio shell");

    const license = await evaluate(`(async () => {
      const u = new URL(location.href);
      const api = u.searchParams.get('api');
      return fetch(api + '/license/status').then(r => r.json());
    })()`);
    if (!license?.valid) throw new Error(`License is not valid: ${license?.status || "unknown"}`);

    const version = await evaluate("navigator.userAgent");
    if (!version.includes("AquaFlowStudio/1.2.33")) throw new Error(`Wrong desktop version: ${version}`);

    const resourceHosts = await evaluate(`[...new Set(performance.getEntriesByType('resource')
      .map(e => { try { return new URL(e.name).hostname; } catch { return ''; } })
      .filter(Boolean))]`);
    if (resourceHosts.some((host) => !["127.0.0.1", "localhost"].includes(host))) {
      throw new Error(`Unexpected external startup resource: ${resourceHosts.join(", ")}`);
    }

    if (!(await evaluate("document.body.innerText.includes('Lebu Fountain · Pilot')"))) {
      let pilotAction = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        const pilot = buttons.find(x => /pilot/i.test(x.innerText));
        if (pilot) { pilot.click(); return 'pilot'; }
        const start = buttons.find(x => x.innerText.trim() === 'Start');
        if (start) { start.click(); return 'start'; }
        return '';
      })()`);
      if (pilotAction === "start") {
        await waitFor("[...document.querySelectorAll('button')].some(x => /pilot/i.test(x.innerText))", "Start card");
        pilotAction = await evaluate(`(() => {
          const b = [...document.querySelectorAll('button')].find(x => /pilot/i.test(x.innerText));
          if (!b) return ''; b.click(); return 'pilot';
        })()`);
      }
      if (pilotAction !== "pilot") throw new Error("Bundled pilot button was not found");
    }
    await waitFor("document.body.innerText.includes('Lebu Fountain · Pilot')", "bundled Lebu pilot");

    const commissionClicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /commission/i.test(x.innerText));
      if (!b) return false; b.click(); return true;
    })()`);
    if (!commissionClicked) throw new Error("Commission workspace button was not found");
    await waitFor("[...document.querySelectorAll('button')].some(x => /device discovery/i.test(x.innerText))", "Commission navigation");
    const devicesClicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /device discovery/i.test(x.innerText));
      if (!b) return false; b.click(); return true;
    })()`);
    if (!devicesClicked) throw new Error("Device Discovery navigation button was not found");
    await waitFor("document.body.innerText.toLowerCase().includes('device discovery')", "Device Discovery panel", 10000);
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /^controllers$/i.test(x.innerText.trim()));
      if (!b) return false; b.click(); return true;
    })()`);
    await waitFor("document.body.innerText.toLowerCase().includes('controller catalog (20)')", "controller catalog");
    const body = await evaluate("document.body.innerText");
    for (const label of ["BENCH VERIFIED", "SIMULATED", "UNSUPPORTED"]) {
      if (!body.includes(label)) throw new Error(`Missing controller evidence label: ${label}`);
    }

    if (screenshot) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(screenshot, Buffer.from(shot.data, "base64"));
    }

    console.log(JSON.stringify({
      result: "PASS",
      version: "1.2.33",
      license: license.status,
      edition: license.edition,
      pilot: "Lebu Fountain · Pilot",
      controllerLabels: ["BENCH VERIFIED", "SIMULATED", "UNSUPPORTED"],
      startupResourceHosts: resourceHosts,
      screenshot,
      scope: "isolated desktop UI; no hardware output actions",
    }, null, 2));
  } finally {
    try { ws.close(); } catch {}
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
