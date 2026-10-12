import { useEffect, useMemo, useState } from "react";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import {
  ARRAY_PATTERN_LIBRARY,
  ARRAY_TARGETS,
  createArrayPatternPlan,
  getArrayTargetFixtures,
} from "../../utils/arrayPatternEngine";
import ArrayNozzleSelector from "./ArrayNozzleSelector";

const STORAGE_KEY = "aquaflow_custom_array_patterns_v1";
const ZONE_KEY = "aquaflow_array_zones_v1";
const readZones = () => { try { const value = JSON.parse(localStorage.getItem(ZONE_KEY) || "[]"); return Array.isArray(value) ? value.filter(z => typeof z.name === "string" && Array.isArray(z.fixtureIds)) : []; } catch { return []; } };

const fieldStyle = {
  width: "100%",
  padding: "7px 8px",
  borderRadius: 5,
  border: "1px solid #26384d",
  background: "#08111f",
  color: "#e2e8f0",
  fontSize: 11,
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  marginBottom: 4,
  color: "#8fa3bf",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const readPresets = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export default function ArrayPatternBuilder({ fixtures = [], tracks = [], currentTime = 0, bpm = 128, onApply, editingBlock = null, onCancelEdit }) {
  const previous = useICANPreviewStore.getState().arrayBuilderDraft || {};
  const beatDuration = 60 / Math.max(1, Number(bpm || 128));
  const [target, setTarget] = useState(previous.target ?? "mapped_running");
  const [patternId, setPatternId] = useState(previous.patternId ?? "section_chase");
  const [startTime, setStartTime] = useState(previous.startTime ?? Number(currentTime || 0).toFixed(2));
  const [stepDuration, setStepDuration] = useState(previous.stepDuration ?? 0.5);
  const [pulseDuration, setPulseDuration] = useState(previous.pulseDuration ?? 0.4);
  const [intensity, setIntensity] = useState(previous.intensity ?? 100);
  const [repeats, setRepeats] = useState(previous.repeats ?? 1);
  const [repeatGap, setRepeatGap] = useState(previous.repeatGap ?? 0);
  const [blockSize, setBlockSize] = useState(previous.blockSize ?? 4);
  const [replaceTarget, setReplaceTarget] = useState(previous.replaceTarget ?? false);
  const [customProgram, setCustomProgram] = useState(previous.customProgram ?? "all | off | odd | even | center | edges");
  const [presetName, setPresetName] = useState("");
  const [customPresets, setCustomPresets] = useState(readPresets);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState(previous.selectedFixtureIds ?? null);
  const [order, setOrder] = useState(previous.order ?? "outlet");
  const [valveMode, setValveMode] = useState(previous.valveMode ?? true);
  const [zones, setZones] = useState(readZones);
  const [previewStage, setPreviewStage] = useState(previous.previewStage ?? 0);
  useEffect(() => {
    if (!editingBlock?.recipe) return;
    const r = editingBlock.recipe;
    setTarget(r.target); setPatternId(r.patternId); setStartTime(r.startTime); setStepDuration(r.stepDuration); setPulseDuration(r.pulseDuration);
    setIntensity(r.intensity); setRepeats(r.repeats); setRepeatGap(r.repeatGap); setBlockSize(r.blockSize); setCustomProgram(r.customProgram);
    setSelectedFixtureIds(r.selectedFixtureIds ?? null); setOrder(r.order); setValveMode(r.valveMode); setReplaceTarget(false); setPreviewStage(0);
  }, [editingBlock?.id]);
  useEffect(() => {
    useICANPreviewStore.setState({ arrayBuilderDraft: { target, patternId, startTime, stepDuration, pulseDuration, intensity, repeats, repeatGap, blockSize, replaceTarget, customProgram, selectedFixtureIds, order, valveMode, previewStage } });
  }, [target, patternId, startTime, stepDuration, pulseDuration, intensity, repeats, repeatGap, blockSize, replaceTarget, customProgram, selectedFixtureIds, order, valveMode, previewStage]);
  const availableFixtures = useMemo(() => getArrayTargetFixtures(fixtures, target), [fixtures, target]);
  const changeTarget = value => { setTarget(value); setSelectedFixtureIds(null); setPreviewStage(0); };
  const updateZones = next => { localStorage.setItem(ZONE_KEY, JSON.stringify(next)); setZones(next); };

  const plan = useMemo(() => { try { return createArrayPatternPlan({
    fixtures,
    tracks,
    target,
    patternId,
    startTime,
    stepDuration,
    pulseDuration,
    intensity,
    repeats,
    repeatGap,
    blockSize,
    customProgram,
    selectedFixtureIds, order, valveMode,
  }); } catch (error) { return { error: error.message, fixtures: [], stages: [], clips: [], missingTrackFixtureIds: [], duration: 0 }; }
  }, [fixtures, tracks, target, patternId, startTime, stepDuration, pulseDuration, intensity, repeats, repeatGap, blockSize, customProgram, selectedFixtureIds, order, valveMode]);

  const selectedPattern = ARRAY_PATTERN_LIBRARY.find((pattern) => pattern.id === patternId);
  const uncommissionedCount = plan.fixtures.filter((fixture) =>
    String(fixture.engineering?.mappingStatus || "").includes("commissioning")
  ).length;
  const sharedFunctionTarget = target.startsWith("foam") || target === "peacock";

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const preset = {
      id: `custom-${Date.now()}`,
      name,
      target,
      patternId,
      stepDuration,
      pulseDuration,
      intensity,
      repeats,
      repeatGap,
      blockSize,
      customProgram,
      selectedFixtureIds, order, valveMode,
    };
    const next = [...customPresets.filter((item) => item.name.toLowerCase() !== name.toLowerCase()), preset];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setCustomPresets(next);
    setPresetName("");
  };

  const loadPreset = (preset) => {
    setTarget(preset.target || "running");
    setPatternId(preset.patternId || "custom");
    setStepDuration(Number(preset.stepDuration || beatDuration));
    setPulseDuration(Number(preset.pulseDuration || beatDuration * 0.8));
    setIntensity(Number(preset.intensity ?? 80));
    setRepeats(Number(preset.repeats || 1));
    setRepeatGap(Number(preset.repeatGap || 0));
    setBlockSize(Number(preset.blockSize || 4));
    setCustomProgram(preset.customProgram || "all");
    setSelectedFixtureIds(preset.selectedFixtureIds ?? null);
    setOrder(preset.order || "outlet");
    setValveMode(preset.valveMode ?? false);
  };

  const removePreset = (id) => {
    const next = customPresets.filter((preset) => preset.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setCustomPresets(next);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#0b1320" }}>
      <div style={{ marginBottom: 12 }}>
        {editingBlock && <div style={{ padding: 8, marginBottom: 8, color: "#bfe7ff", border: "1px solid #37699a", fontSize: 10 }}>
          Updating block: <b>{editingBlock.name}</b>. Generate replaces this block's outlet clips; other blocks stay intact.
          <button style={{ ...fieldStyle, marginTop: 5, cursor: "pointer" }} onClick={onCancelEdit}>Cancel block update</button>
        </div>}
        <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 800 }}>Array Pattern Builder</div>
        <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.45, marginTop: 3 }}>
          Select a zone, choose a movement, set its timing, then generate clips. Preview the timeline in 3D before opening the separate site run controls.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Target array</label>
          <select aria-label="Target array" value={target} onChange={(event) => changeTarget(event.target.value)} style={fieldStyle}>
            {ARRAY_TARGETS.map((item) => <option key={item.id} value={item.id}>{item.label} ({getArrayTargetFixtures(fixtures, item.id).length})</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Pattern</label>
          <select aria-label="Array movement" value={patternId} onChange={(event) => { setPatternId(event.target.value); setPreviewStage(0); }} style={fieldStyle}>
            {ARRAY_PATTERN_LIBRARY.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.label}</option>)}
          </select>
          <div style={{ color: "#52657a", fontSize: 9, marginTop: 4 }}>{selectedPattern?.description}</div>
        </div>

        <NumberField label="Start time (s)" value={startTime} min={0} step={0.1} onChange={setStartTime} />
        <div style={{ display: "flex", alignItems: "end" }}>
          <button onClick={() => setStartTime(Number(currentTime || 0).toFixed(2))} style={{ ...fieldStyle, cursor: "pointer", color: "#7dd3fc" }}>
            Use playhead {Number(currentTime || 0).toFixed(2)}s
          </button>
        </div>
        <NumberField label="Stage step (s)" value={stepDuration} min={0.05} step={0.05} onChange={setStepDuration} />
        <NumberField label="Pulse length (s)" value={pulseDuration} min={0.05} step={0.05} onChange={setPulseDuration} />
        {!valveMode && <NumberField label="Design intensity %" value={intensity} min={0} max={100} step={1} onChange={setIntensity} />}
        <NumberField label="Repeats" value={repeats} min={1} max={100} step={1} onChange={setRepeats} />
        <NumberField label="Repeat gap (s)" value={repeatGap} min={0} step={0.1} onChange={setRepeatGap} />
        <NumberField label="Block size" value={blockSize} min={1} max={100} step={1} onChange={setBlockSize} />
      </div>
      <label style={{ display: "flex", gap: 6, marginTop: 10, color: "#bce9d6", fontSize: 10 }}>
        <input type="checkbox" checked={valveMode} onChange={e => { setValveMode(e.target.checked); if (e.target.checked) setIntensity(100); }} />Valve ON/OFF clips (no height or pump commands)
      </label>
      <div style={{ color: "#778da5", fontSize: 9, marginTop: 4 }}>Site valve clips open fully. Design intensity and fades are simulation only until hydraulic control is commissioned.</div>
      <label style={{ ...labelStyle, marginTop: 9 }}>Array order</label>
      <select aria-label="Array order" value={order} onChange={e => setOrder(e.target.value)} style={fieldStyle}>
        <option value="outlet">Physical outlet numbering</option><option value="x">Engineering X: left to right</option><option value="reverse">Reverse outlet numbering</option>
      </select>
      <ArrayNozzleSelector fixtures={availableFixtures} selectedIds={selectedFixtureIds} onChange={ids => { setSelectedFixtureIds(ids); setPreviewStage(0); }}
        activeIds={(plan.stages[Math.min(previewStage, plan.stages.length - 1)] || []).map(i => plan.fixtures[i]?.id)}
        zones={zones.filter(z => z.fixtureIds.some(id => fixtures.some(f => f.id === id)))}
        onSaveZone={(name, fixtureIds) => updateZones([...zones.filter(z => z.name.toLowerCase() !== name.toLowerCase()), { id: `zone-${Date.now()}`, name, fixtureIds }])}
        onDeleteZone={id => updateZones(zones.filter(z => z.id !== id))}
        onLoadZone={zone => { setTarget("all_water"); setSelectedFixtureIds(zone.fixtureIds); setPreviewStage(0); }} />
      {plan.stages.length > 0 && <div style={{ color: "#cde6f7", fontSize: 10 }}>
        Preview stage {Math.min(previewStage + 1, plan.stages.length)} / {plan.stages.length} · Numbers below follow the selected array order.
        <input aria-label="Array preview stage" type="range" min={0} max={plan.stages.length - 1} value={Math.min(previewStage, plan.stages.length - 1)} onChange={e => setPreviewStage(Number(e.target.value))} style={{ width: "100%" }} />
        <div style={{ overflowWrap: "anywhere", color: "#fde68a" }}>{(plan.stages[Math.min(previewStage, plan.stages.length - 1)] || []).map(i => `${i + 1}: ${plan.fixtures[i]?.label || plan.fixtures[i]?.id}`).join(" · ") || "All selected outlets OFF"}</div>
      </div>}

      <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        {[0.5, 1, 2, 4].map((division) => (
          <button
            key={division}
            onClick={() => {
              const duration = valveMode ? Math.max(0.2, Math.round(beatDuration / division * 10) / 10) : beatDuration / division;
              setStepDuration(Number(duration.toFixed(3)));
              setPulseDuration(valveMode ? Math.max(0.1, Number((duration - 0.1).toFixed(1))) : Number((duration * 0.8).toFixed(3)));
            }}
            style={{ ...fieldStyle, width: "auto", flex: 1, cursor: "pointer", padding: "5px 3px", color: "#c4b5fd" }}
          >
            {division === 0.5 ? "2 beats" : division === 1 ? "1 beat" : division === 2 ? "1/2 beat" : "1/4 beat"}
          </button>
        ))}
      </div>

      {patternId === "custom" && (
        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Custom stages</label>
          <textarea
            value={customProgram}
            onChange={(event) => setCustomProgram(event.target.value)}
            rows={4}
            style={{ ...fieldStyle, resize: "vertical", fontFamily: "monospace", lineHeight: 1.5 }}
          />
          <div style={{ color: "#64748b", fontSize: 9, marginTop: 4, lineHeight: 1.4 }}>
            Separate stages with <b style={{ color: "#94a3b8" }}>|</b>. Use numbers within the selected array, ranges, comma groups, <b>odd</b>, <b>even</b>, <b>center</b>, <b>edges</b>, <b>all</b>, or <b>off</b>.
          </div>
        </div>
      )}

      {!editingBlock && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={replaceTarget} onChange={(event) => setReplaceTarget(event.target.checked)} />
        Replace existing clips on the selected target tracks
      </label>}

      <div style={{ marginTop: 12, padding: 10, border: "1px solid #1e3a4f", borderRadius: 7, background: "#08111f" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, fontSize: 10 }}>
          <Summary label="Outlets" value={plan.fixtures.length} />
          <Summary label="Stages" value={plan.stages.length} />
          <Summary label="Clips" value={plan.clips.length} />
          <Summary label="Duration" value={`${plan.duration.toFixed(2)}s`} />
        </div>
        {plan.missingTrackFixtureIds.length > 0 && (
          <div style={{ color: "#fbbf24", fontSize: 9, marginTop: 7 }}>
            {plan.missingTrackFixtureIds.length} selected outlets do not yet have a programmable track.
          </div>
        )}
        <StagePreview stages={plan.stages} fixtureCount={plan.fixtures.length} />
      </div>

      {(uncommissionedCount > 0 || sharedFunctionTarget) && (
        <div style={{ marginTop: 8, padding: "8px 9px", border: "1px solid #92400e", borderRadius: 6, background: "rgba(120,53,15,0.18)", color: "#fbbf24", fontSize: 9, lineHeight: 1.45 }}>
          {uncommissionedCount > 0 && <div>{uncommissionedCount} selected outlet mappings still require commissioning.</div>}
          {sharedFunctionTarget && <div>This site currently exposes this bank as a shared pump function. Per-outlet stages are available for design and simulation; hardware compilation remains protected.</div>}
        </div>
      )}

      <button
        disabled={!plan.clips.length || plan.missingTrackFixtureIds.length > 0}
        onClick={() => onApply?.(plan, { replaceTarget, target, patternId })}
        style={{
          width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 7,
          border: "1px solid #22c55e", background: plan.clips.length ? "linear-gradient(135deg,#14532d,#15803d)" : "#1f2937",
          color: plan.clips.length ? "#dcfce7" : "#64748b", fontWeight: 800, cursor: plan.clips.length ? "pointer" : "not-allowed",
        }}
      >
        {editingBlock ? `Update block (${plan.clips.length} clips)` : `Generate ${plan.clips.length} Timeline Clips`}
      </button>
      {plan.error && <div role="alert" style={{ color: "#fda4af", fontSize: 10, marginTop: 7 }}>{plan.error}</div>}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1e293b" }}>
        <label style={labelStyle}>Save current settings as a custom pattern</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Pattern name" style={fieldStyle} />
          <button onClick={savePreset} disabled={!presetName.trim()} style={{ ...fieldStyle, width: 64, cursor: "pointer", color: "#7dd3fc" }}>Save</button>
        </div>
        {customPresets.map((preset) => (
          <div key={preset.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "6px 7px", border: "1px solid #1e293b", borderRadius: 5 }}>
            <button onClick={() => loadPreset(preset)} style={{ background: "none", border: 0, color: "#cbd5e1", fontSize: 10, cursor: "pointer", textAlign: "left", flex: 1 }}>{preset.name}</button>
            <button onClick={() => removePreset(preset.id)} title="Delete custom pattern" style={{ background: "none", border: 0, color: "#ef4444", cursor: "pointer" }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, ...props }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input aria-label={label} type="number" value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle} {...props} />
    </div>
  );
}

function Summary({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}><span>{label}</span><b style={{ color: "#7dd3fc" }}>{value}</b></div>;
}

function StagePreview({ stages, fixtureCount }) {
  if (!stages.length || !fixtureCount) return null;
  const visibleStages = stages.slice(0, 6);
  return (
    <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px solid #172638" }}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>First {visibleStages.length} stages</div>
      {visibleStages.map((stage, stageIndex) => {
        const active = new Set(stage);
        return (
          <div key={stageIndex} style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 3 }}>
            <span style={{ width: 18, color: "#52657a", fontFamily: "monospace", fontSize: 8 }}>{stageIndex + 1}</span>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${fixtureCount}, minmax(1px, 1fr))`, gap: 1 }}>
              {Array.from({ length: fixtureCount }, (_, fixtureIndex) => (
                <span key={fixtureIndex} style={{ height: 5, minWidth: 1, borderRadius: 2, background: active.has(fixtureIndex) ? "#22c55e" : "#1e293b" }} />
              ))}
            </div>
          </div>
        );
      })}
      {stages.length > visibleStages.length && <div style={{ marginLeft: 23, color: "#52657a", fontSize: 8 }}>+ {stages.length - visibleStages.length} more stages</div>}
    </div>
  );
}
