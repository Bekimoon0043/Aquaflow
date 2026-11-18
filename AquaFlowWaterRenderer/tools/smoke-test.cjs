const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.RENDERER_TEST_PORT) || 9444;
const project = process.env.RENDERER_PROJECT || path.resolve('../.tmp/Lebu_Fountain_Quiet_Wave_30s.aquapkg');
const screenshot = path.resolve('water-renderer-smoke.png');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  let page;
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      page = pages.find(p => p.type === 'page' && p.url.startsWith('file:'));
      if (page) break;
    } catch {}
    await sleep(300);
  }
  if (!page) throw new Error('Renderer page did not open');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result || {}); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id:n, method, params })); });
  const evaluate = async expression => { const r=await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true }); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  const errors = [];
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || JSON.stringify(m.params.exceptionDetails)); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result || {}); };
  await send('Page.reload', { ignoreCache:true });
  await sleep(1200);
  for (let i = 0; i < 30 && !(await evaluate("document.readyState==='complete'")); i++) await sleep(200);
  const doc = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', { nodeId:doc.root.nodeId, selector:'#fileWelcome' });
  await send('DOM.setFileInputFiles', { nodeId:input.nodeId, files:[project] });
  await evaluate("document.getElementById('fileWelcome').dispatchEvent(new Event('change',{bubbles:true}))");
  for (let i = 0; i < 80 && !(await evaluate("document.getElementById('jets').textContent==='12'")); i++) await sleep(250);
  await evaluate("document.getElementById('play').click()");
  await sleep(2500);
  const result = await evaluate(`(()=>{const c=document.querySelector('canvas');return {project:document.getElementById('project')?.textContent,jets:document.getElementById('jets')?.textContent,duration:document.getElementById('duration')?.textContent,time:document.getElementById('time')?.textContent,canvas:c?[c.width,c.height]:null,gl:c?(c.getContext('webgl2')?'webgl2':'webgl1'):null,dropHidden:document.getElementById('drop')?.classList.contains('hidden'),toast:document.getElementById('toast')?.textContent,body:document.body.innerText.slice(0,500)}})()`);
  const shot = await send('Page.captureScreenshot', { format:'png', fromSurface:true });
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  ws.close();
  console.log(JSON.stringify({ ...result, errors, screenshot }, null, 2));
  if (result.jets !== '12' || !result.dropHidden || errors.length) process.exitCode = 1;
}
run().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
