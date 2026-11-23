#!/usr/bin/env node
// Installed/unpacked desktop smoke for the pattern designer. Read-only UI navigation:
// no hardware arm/start/test/deploy actions and no project save.
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.argv[2] || 9232);
const screenshot = process.argv[3] ? path.resolve(process.argv[3]) : null;
const expectedVersion = require('../package.json').version;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      const page = pages.find(p => p.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(p.url));
      if (page) return page;
    } catch {}
    await delay(400);
  }
  throw new Error(`No AquaFlow page on DevTools port ${port}`);
}

async function run() {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const handlers = pending.get(message.id); pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message)); else handlers.resolve(message.result || {});
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools WebSocket failed')); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools ${method} timed out`)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
    return result.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(250); }
    const body = await evaluate('document.body.innerText.slice(0, 3500)');
    throw new Error(`Timed out waiting for ${label}: ${body}`);
  };
  const click = async (text, label = text) => {
    const found = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes(${JSON.stringify(text)}) || (x.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
    if (!found) throw new Error(`Button not found: ${label}`);
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await waitFor("document.body && document.body.innerText.includes('Design')", 'studio shell');
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /continue with the current project/i.test(x.innerText)); if (b) b.click(); return true; })()`);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await evaluate("window.dispatchEvent(new CustomEvent('aquaflow:open-panel', { detail: { panel: 'preview' } }))");
    await waitFor("document.body.innerText.includes('Pattern assets (160)')", 'Bellagio pattern assets');
    await click('✎ Create pattern');
    await waitFor("!!document.querySelector('[role=dialog][aria-label=\"Pattern creator\"]')", 'pattern creator');
    const modes = await evaluate("[...document.querySelectorAll('[role=dialog][aria-label=\"Pattern creator\"] [role=radiogroup][aria-label=\"Pattern type\"] [role=radio]')].map(x => x.innerText)");
    for (const mode of ['Water', '1D Swing', '2D Aim', '3D Head']) if (!modes.some(text => text.includes(mode))) throw new Error(`Missing pattern mode ${mode}`);
    await click('Close pattern creator');
    await click('Pattern assets (160)');
    await waitFor("!!document.querySelector('[role=dialog][aria-label=\"Pattern assets\"]')", 'pattern asset browser');
    await evaluate(`(() => { const input = document.querySelector('input[aria-label=\"Search pattern assets\"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Ring draws clockwise'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor("!!document.querySelector('button[aria-label=\"Customize Ring draws clockwise\"]')", 'asset customization', 10000);
    const userAgent = await evaluate('navigator.userAgent');
    if (!userAgent.includes(`AquaFlowStudio/${expectedVersion}`)) throw new Error(`Wrong desktop version: ${userAgent}; expected ${expectedVersion}`);
    if (screenshot) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: false });
      fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    }
    console.log(JSON.stringify({ result: 'PASS', version: expectedVersion, modes: ['Water', '1D Swing', '2D Aim', '3D Head'],
      assets: 160, customize: 'Ring draws clockwise', screenshot, scope: 'installed UI only; no save and no hardware output' }, null, 2));
  } finally { try { ws.close(); } catch {} }
}
run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
