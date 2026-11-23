export function Slider({ label, value, min, max, step = 1, suffix = '', onChange, hint }) {
  return <label className="pc-field" title={hint}><span>{label}</span>
    <span className="pc-num"><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
      <input type="number" min={min} max={max} step={step} value={value} aria-label={`${label} value`}
        onChange={e => { const v = Number(e.target.value); if (e.target.value !== '' && v >= min && v <= max) onChange(v); }} />
      {suffix && <small>{suffix}</small>}</span></label>;
}

export function Choice({ options, value, onChange, label }) {
  return <div className="pc-choices" role="radiogroup" aria-label={label}>
    {options.map(([id, title, hint]) => <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'on' : ''}
      onClick={() => onChange(id)} title={hint}><b>{title}</b><small>{hint}</small></button>)}
  </div>;
}
