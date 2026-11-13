// Inspector fields of a pyro pattern: how the positions fire, and when each burst / ignition falls.
// The pattern's Start is the first BURST (place it on the beat); each shell is lit its lift time earlier.
import { PYRO_MODES } from '../../../show/pyro';

const s2 = v => `${Number(v).toFixed(2)} s`;

export default function PyroRecipeFields({ recipe, clips = [], onChange }) {
  const mode = recipe.pyro?.mode || 'single';
  const cues = clips.filter(c => c.studioRecipeId === recipe.id && c.type === 'pyro_fire').sort((a, b) => a.startTime - b.startTime);
  const set = patch => onChange({ pyro: { ...(recipe.pyro || {}), ...patch } });
  return <div className="sp-pyro-fields">
    <label>Firing<select aria-label="Pyro firing" value={mode} onChange={e => set({ mode: e.target.value })}>{PYRO_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {mode === 'chase' && <label>Chase step (s)<input type="number" min={0.05} max={10} step={0.05} value={recipe.pyro?.intervalS ?? 0.5} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) set({ intervalS: n }); }} /></label>}
    <p className="sp-help">Start = first burst (put it on the beat). {mode === 'sweep' || mode === 'barrage' ? 'Duration = time the bursts are spread over. ' : ''}AquaFlow lights each position its lift time earlier (pre-fire) and never fires pyro itself: export the firing script for the firing system.</p>
    {cues.length > 0 && <table className="sp-pyro-cues" aria-label="Pyro cues"><thead><tr><th>Position</th><th>Ignition</th><th>Burst</th></tr></thead><tbody>
      {cues.slice(0, 12).map(c => <tr key={c.id}><td>{String(c.name || '').split(' · ')[1] || c.fixtureId}</td><td>{s2(c.startTime)}</td><td>{s2(c.pyro?.burstTime ?? c.startTime)}</td></tr>)}
    </tbody></table>}
    {cues.length > 12 && <p className="sp-help">…and {cues.length - 12} more cue(s).</p>}
  </div>;
}
