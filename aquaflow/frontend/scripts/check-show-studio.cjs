// Isolated browser acceptance test: mounts only the editor with synthetic fixtures.
// Does not connect to a PLC or change the installed application's project.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('PAGE:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('CONSOLE:', message.text()); });
  try {
  await page.route('**/studio-test', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0"><div id="root" style="height:100vh"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const {default:ShowStudio} = await import('/src/components/programmer/studio/ShowStudio.jsx');
    import engineering from '/src/store/engineeringStore.js';
    import project from '/src/store/projectStore.js';
    window.studioTest = { engineering, project };
    engineering.getState().loadProject({ name:'320-fixture acceptance fountain', pool_type:'rectangular', params:{width:32,length:12,depth:.8}, geometry:{type:'polygon',points:[{x:0,y:0},{x:32,y:0},{x:32,y:12},{x:0,y:12}]}, fixtures:Array.from({length:320},(_,i)=>({id:'jet-'+i,type:'nozzle_geyser',label:'Jet '+(i+1),x:i%32,y:Math.floor(i/32),groupId:'ring-'+i%4,zone:'Basin A'})) });
    project.getState().setActivePanel('show_programmer');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(ShowStudio)));
  </script></body></html>` }));
  await page.goto('http://127.0.0.1:3013/studio-test');
  await page.getByText('320 items synced').waitFor();
  await page.getByRole('button', { name: 'ring-0', exact: true }).click();
  await page.getByRole('button', { name: '+ Pattern', exact: true }).click();
  await page.getByText('320 items synced').waitFor();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer?.studio?.recipes.length === 1);
  await page.getByRole('button', { name: '▶ Play preview' }).click();
  await page.waitForTimeout(350);
  assert.notEqual(await page.locator('output').innerText(), '00:00.00');
  await page.getByRole('button', { name: 'Ⅱ Pause' }).click();
  await page.getByLabel('Explorer grouping').selectOption('all');
  assert.ok(await page.locator('.sp-virtual .sp-item').count() < 50, 'Explorer is windowed');
  await page.getByLabel('Search Engineering items').fill('Jet 319');
  await page.getByRole('button', { name: /Jet 319/ }).click();
  await page.getByLabel('Search Engineering items').fill('');
  await page.screenshot({ path: path.resolve('../../../outputs/show-studio-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save .aqua', exact: true }).isEnabled();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save .aqua', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(path.resolve('../../../outputs/show-studio-320.aqua'));
  const before = await page.evaluate(() => window.studioTest.project.getState().programmer.studio);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 0);
  await page.keyboard.press('Control+y');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 1);
  await page.evaluate(() => { const p=window.studioTest.project; p.getState().loadProjectDocument({programmer:{timelineClips:[]},workspace:{activePanel:'show_programmer'}}); });
  await page.waitForFunction(() => window.studioTest.project.getState().programmer?.studio?.recipes.length === 0);
  await page.evaluate(s => window.studioTest.project.getState().loadProjectDocument({programmer:{studio:s},workspace:{activePanel:'show_programmer'}}), before);
  await page.waitForFunction(() => window.studioTest.project.getState().programmer?.timelineClips?.length === 160);
  // Exercise scoped AI approval with a deterministic server response, never real hardware.
  await page.route('**/api/ai/generate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ show: { notes: 'Acceptance-test response' }, analysis: { sections: [{ start: 0, end: 12, label: 'Opening', energy: .5 }, { start: 12, end: 24, label: 'Finale', energy: .8 }] } }) }));
  await page.getByLabel('Explorer grouping').selectOption('groupId');
  await page.getByRole('button', { name: 'ring-0', exact: true }).click();
  await page.getByRole('button', { name: 'AI compose', exact: true }).click();
  await page.getByRole('button', { name: 'Generate proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Preview proposed patterns', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.studioTest.project.getState().programmer.studio.recipes.length), 1, 'AI does not commit before Apply');
  await page.getByRole('button', { name: 'Apply selected patterns', exact: true }).click();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 3);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 1);
  await page.getByRole('button', { name: 'pattern', exact: true }).click();
  // Drag the one recipe and resize it, then restore before checking the renderer.
  const clip = page.locator('.sp-clip').first();
  const rect = await clip.boundingBox();
  await page.mouse.move(rect.x + 30, rect.y + 12); await page.mouse.down(); await page.mouse.move(rect.x + 94, rect.y + 12, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes[0].start === 2);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes[0].start === 0);
  // Curve editing uses the same runtime compiler, with an undoable source envelope.
  await page.getByLabel('Effect', { exact: true }).selectOption('curve');
  await page.getByLabel('Point level (%)', { exact: true }).fill('60');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes[0].envelope?.[1]?.value === .6);
  await page.getByLabel('Effect', { exact: true }).selectOption('wave');
  // Duplicate, marquee-select both, move together, copy/paste at the playhead, then undo.
  await page.locator('.sp-timeline').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 2);
  const timelineRect = await page.locator('.sp-timeline-scroll').boundingBox();
  await page.mouse.move(timelineRect.x + 208, timelineRect.y + 90); await page.mouse.down();
  await page.mouse.move(timelineRect.x + 735, timelineRect.y + 33, { steps: 6 }); await page.mouse.up();
  await page.locator('.sp-timeline').getByText('2 selected', { exact: true }).waitFor();
  const firstRect = await page.locator('.sp-clip').first().boundingBox();
  await page.mouse.move(firstRect.x + 25, firstRect.y + 12); await page.mouse.down(); await page.mouse.move(firstRect.x + 57, firstRect.y + 12, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.map(r => r.start).join(',') === '1,9');
  await page.locator('.sp-timeline').getByRole('button', { name: 'Copy', exact: true }).click();
  await page.locator('.sp-timeline').getByRole('button', { name: 'Paste', exact: true }).click();
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 4);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.studioTest.project.getState().programmer.studio.recipes.length === 1 && window.studioTest.project.getState().programmer.studio.recipes[0].start === 0);
  await page.getByRole('button', { name: '3D Water', exact: true }).click();
  await page.getByRole('button', { name: '▶ Play preview' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Ⅱ Pause' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.resolve('../../../outputs/show-studio-3d.png'), fullPage: true });
  console.log(JSON.stringify({ fixtureCount: 320, virtualRows: await page.locator('.sp-virtual .sp-item').count(), errors, documentRoundTrip: true, playback: true, undoRedo: true, scopedAiApproval: 'mock server', timelineDrag: true, curveEditor: true, batchMarqueeMoveCopyPaste: true }));
  assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.resolve('../../../outputs/show-studio-failure.png'), fullPage: true });
    console.log((await page.locator('body').innerText()).slice(0, 5000));
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
