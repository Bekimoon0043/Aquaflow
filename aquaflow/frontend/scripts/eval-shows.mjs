// Show evaluation harness: every generator × site × song → scorecard (JSON + HTML).
//
//   npx vite-node --root . scripts/eval-shows.mjs [--out dir] [--gen a,b] [--pkg show.aquapkg ...]
//
// Synthetic songs and sites come from evalCorpus.js; each --pkg adds a real site + song
// (its Engineering fixtures, stored song analysis and stems).
import fs from 'node:fs';
import path from 'node:path';
import { readZip, zipText } from '/src/utils/zipStore.js';
import { makeSong, SONGS, SITES } from '/src/components/programmer/studio/evalCorpus.js';
import { GENERATORS, runCase, siteContext } from '/src/components/programmer/studio/showGenerators.js';
import { readStudio } from '/src/components/programmer/studio/showModel.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = opt('--out', 'eval-out');
const gens = opt('--gen', Object.keys(GENERATORS).join(',')).split(',');
const pkgs = args.flatMap((a, i) => (a === '--pkg' ? [args[i + 1]] : []));
fs.mkdirSync(out, { recursive: true });

const cases = [];
const songs = Object.entries(SONGS).map(([id, s]) => ({ id, ...makeSong(s) }));
for (const [siteId, make] of Object.entries(SITES)) {
  const site = siteContext(make().fixtures);
  for (const song of songs) cases.push({ siteId, site, siteName: make().name, song });
}
for (const p of pkgs) {
  const proj = JSON.parse(zipText(readZip(fs.readFileSync(p)).get('project.aqua')));
  const analysis = Object.values(proj.programmer?.musicCache || {})[0];
  const stems = proj.programmer?.stems?.items || [];
  if (!analysis || !stems.length) { console.warn(`skip ${p}: no stored song analysis / stems`); continue; }
  const site = siteContext(proj.engineering.fixtures, { ...readStudio(proj.programmer), recipes: [] });
  cases.push({ siteId: path.basename(p, '.aquapkg'), site, siteName: proj.engineering.projectName || path.basename(p), song: { id: 'song', name: analysis.name || 'song', analysis, stems } });
}

const rows = [];
for (const gen of gens) {
  for (const c of cases) {
    const r = runCase(gen, c.site, c.song);
    rows.push({ generator: gen, site: c.siteId, siteName: c.siteName, song: c.song.id, songName: c.song.name, score: r.score, pass: r.pass,
      gates: r.gates.counts, metrics: r.metrics, detail: r.detail, clips: r.clips, genMs: r.genMs, issues: r.issues.length });
    console.log(`${gen.padEnd(14)} ${c.siteId.padEnd(10)} ${c.song.id.padEnd(9)} score ${String(r.score).padStart(5)} ${r.pass ? 'PASS' : 'FAIL ' + JSON.stringify(r.gates.counts)} · switched active ${r.detail.switchedActive} (climax ${r.detail.switchedActiveClimax}) · looks ${r.detail.distinctLooks} · ${r.genMs} ms`);
  }
}
const summary = gens.map((g) => {
  const mine = rows.filter((r) => r.generator === g);
  const avg = (f) => Math.round(1000 * mine.reduce((s, r) => s + f(r), 0) / mine.length) / 1000;
  return { generator: g, cases: mine.length, score: avg((r) => r.score), passRate: avg((r) => (r.pass ? 1 : 0)),
    metrics: Object.fromEntries(Object.keys(mine[0].metrics).map((k) => [k, avg((r) => r.metrics[k])])) };
});
const card = { createdAt: new Date().toISOString(), summary, rows };
fs.writeFileSync(path.join(out, 'scorecard.json'), JSON.stringify(card, null, 1));
fs.writeFileSync(path.join(out, 'scorecard.html'), html(card));
console.log('\n' + summary.map((s) => `${s.generator}: score ${s.score} · pass ${Math.round(s.passRate * 100)} % · ${JSON.stringify(s.metrics)}`).join('\n'));
console.log(`→ ${path.resolve(out, 'scorecard.html')}`);

function html(card) {
  const keys = Object.keys(card.rows[0]?.metrics || {});
  const cell = (v) => `<td style="background:hsl(${Math.round(120 * v)} 60% 35%)">${v.toFixed(2)}</td>`;
  return `<!doctype html><meta charset="utf-8"><title>AquaFlow show scorecard</title>
<style>body{font:13px system-ui;background:#10141a;color:#e6e9ee;padding:16px}table{border-collapse:collapse}td,th{padding:4px 8px;border:1px solid #2a3240;text-align:right}th{background:#1b2230}td:first-child,td:nth-child(2),td:nth-child(3){text-align:left}</style>
<h1>Show scorecard</h1><p>${card.createdAt}</p>
<h2>Summary</h2><table><tr><th>Generator</th><th>Cases</th><th>Score</th><th>Pass</th>${keys.map((k) => `<th>${k}</th>`).join('')}</tr>
${card.summary.map((s) => `<tr><td>${s.generator}</td><td>${s.cases}</td><td>${s.score}</td><td>${Math.round(100 * s.passRate)} %</td>${keys.map((k) => cell(s.metrics[k])).join('')}</tr>`).join('')}</table>
<h2>Cases</h2><table><tr><th>Generator</th><th>Site</th><th>Song</th><th>Score</th><th>Gates</th>${keys.map((k) => `<th>${k}</th>`).join('')}<th>Switched active</th><th>Looks</th></tr>
${card.rows.map((r) => `<tr><td>${r.generator}</td><td>${r.siteName}</td><td>${r.songName}</td><td>${r.score}</td><td>${r.pass ? 'pass' : JSON.stringify(r.gates)}</td>${keys.map((k) => cell(r.metrics[k])).join('')}<td>${r.detail.switchedActive}</td><td>${r.detail.distinctLooks}</td></tr>`).join('')}</table>`;
}
