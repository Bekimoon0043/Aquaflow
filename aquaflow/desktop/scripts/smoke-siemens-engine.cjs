// Local packaged-engine smoke test. No PLC connection or physical output action.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findFreePort, waitForHealth, stopEngine } = require('../launcher');

(async () => {
  const root = path.resolve(__dirname, '..');
  const exe = path.resolve(process.argv[2] || path.join(root, 'resources/engine/aquaflow-engine.exe'));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'resources/app-config.json'), 'utf8'));
  if (!config.licenseSecret) throw new Error('Bundled configuration is incomplete');
  const data = fs.mkdtempSync(path.join(root, 'resources/smoke-1216-'));
  const port = await findFreePort(18080);
  const child = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AQUAFLOW_LICENSE_SECRET: config.licenseSecret, AQUAFLOW_DATA_DIR: data,
      AQUAFLOW_HOST: '127.0.0.1', AQUAFLOW_PORT: String(port), PYTHONIOENCODING: 'utf-8' } });
  let logs = '';
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-5000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-5000); });
  const request = async (suffix, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/siemens-sites${suffix}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(value));
    return value;
  };
  try {
    await waitForHealth(port, { timeoutMs: 45000 });
    const site = await request('/1212c-starter', { name: 'Packaged engine smoke — simulation only', tia_version: 17 });
    const readiness = await request(`/${site.id}/readiness`);
    const verified = await request(`/${site.id}/verify`, {});
    if (verified.quality !== 'SIMULATED_NOT_HARDWARE') throw new Error('Expected local simulation');
    await request(`/${site.id}/arm`, {});
    await request(`/${site.id}/start`, {});
    await new Promise(resolve => setTimeout(resolve, 1200));
    const running = await request(`/${site.id}/status`);
    if (!running.running) throw new Error('Simulation failed to run');
    await request(`/${site.id}/stop`, {});
    const stopped = await request(`/${site.id}/status`);
    if (stopped.running || !stopped.stop_confirmed || stopped.armed) throw new Error('Simulation did not stop safely');
    console.log(JSON.stringify({ result: 'PASS', scope: 'packaged engine, internal simulation only; NOT PLCSIM',
      readiness: readiness.status, runningObserved: running.running, stopped: stopped.stop_confirmed, isolatedData: data }, null, 2));
  } catch (error) { console.error(logs.replaceAll(config.licenseSecret, '[redacted]')); throw error; }
  finally { await stopEngine(child); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
