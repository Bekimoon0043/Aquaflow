/** Operator-authored, server-timed patterns for the real I-CAN fountain. */
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, apiUrl } from "../../utils/apiClient";

const GROUPS = [1, 2, 9, 17, 25];
const CONFIRM = "RUN MANUAL PATTERN";
const C = {
  line: "#0a2030", dim: "#526579", text: "#9bb0c3", bright: "#d8e7f4",
  accent: "#00aaff", ok: "#37d67a", warn: "#ffb020", danger: "#ff5c6c", bg: "#010409",
};

const button = (active = false, color = C.accent) => ({
  padding: "5px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer",
  background: active ? `${color}22` : "transparent", color: active ? color : C.text,
  border: `1px solid ${active ? `${color}88` : C.line}`, fontFamily: "monospace",
});

const input = {
  background: C.bg, border: `1px solid ${C.line}`, borderRadius: 3,
  color: C.bright, padding: "5px 7px", fontSize: 10, fontFamily: "monospace",
};

function emptyGroups() {
  return Object.fromEntries(GROUPS.map(group => [String(group), []]));
}

function emptyStep() {
  return { duration_ms: 1000, groups: emptyGroups() };
}

function newDraft() {
  return {
    id: "", name: "New Site Pattern", description: "",
    layout_id: "curved-six-pump-fountain-v1", steps: [emptyStep()],
  };
}

function hydratePattern(pattern) {
  return {
    ...newDraft(), ...pattern,
    steps: (pattern?.steps?.length ? pattern.steps : [emptyStep()]).map(step => ({
      duration_ms: Number(step.duration_ms) || 1000,
      groups: { ...emptyGroups(), ...(step.groups || {}) },
    })),
  };
}

function selectedCount(step) {
  return Object.values(step.groups || {}).reduce((sum, channels) => sum + channels.length, 0);
}

function stepFromAddresses(addresses, durationMs) {
  const groups = emptyGroups();
  for (const address of addresses || []) {
    groups[String(address.group)] = [...address.channels];
  }
  return { duration_ms: durationMs, groups };
}

export default function ICANManualPatternEditor({
  connected, armed, permit, siteDemoRunning, channelTestRunning, status, setStatus, say, refresh,
  incomingPattern, reloadKey, audioFile, onPatternChange,
}) {
  const [layout, setLayout] = useState(null);
  const [saved, setSaved] = useState([]);
  const [draft, setDraft] = useState(newDraft);
  const [activeStep, setActiveStep] = useState(0);
  const [activeGroup, setActiveGroup] = useState(1);
  const [repeat, setRepeat] = useState(1);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState("");
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");
  const wasRunningRef = useRef(false);

  const loadSaved = async () => {
    const result = await apiGet("/ican/manual-patterns");
    setSaved(result.patterns || []);
  };

  useEffect(() => {
    apiGet("/ican/site-layout").then(setLayout).catch(() => setLayout(null));
    loadSaved().catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    if (!incomingPattern) return;
    setDraft(hydratePattern(incomingPattern));
    setActiveStep(0);
  }, [incomingPattern]);

  useEffect(() => { loadSaved().catch(() => setSaved([])); }, [reloadKey]);

  useEffect(() => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = audioFile ? URL.createObjectURL(audioFile) : "";
    audioRef.current = audioUrlRef.current ? new Audio(audioUrlRef.current) : null;
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    };
  }, [audioFile]);

  useEffect(() => {
    if (wasRunningRef.current && !status?.running && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    wasRunningRef.current = !!status?.running;
  }, [status?.running]);

  useEffect(() => { onPatternChange?.(draft); }, [draft, onPatternChange]);

  const totalMs = useMemo(
    () => draft.steps.reduce((sum, step) => sum + Number(step.duration_ms || 0), 0) * repeat,
    [draft.steps, repeat]);
  const step = draft.steps[Math.min(activeStep, draft.steps.length - 1)] || emptyStep();
  const activeChannels = new Set(step.groups?.[String(activeGroup)] || []);
  const groupLocked = activeGroup === 17 || activeGroup === 2 || activeGroup === 25;

  const updateStep = (index, updater) => {
    setDraft(current => ({
      ...current,
      steps: current.steps.map((item, i) => i === index ? updater(item) : item),
    }));
  };

  const toggleChannel = channel => updateStep(activeStep, current => {
    const key = String(activeGroup);
    const channels = new Set(current.groups[key] || []);
    if (channels.has(channel)) channels.delete(channel); else channels.add(channel);
    return { ...current, groups: { ...current.groups, [key]: [...channels].sort((a, b) => a - b) } };
  });

  const clearGroup = () => updateStep(activeStep, current => ({
    ...current, groups: { ...current.groups, [String(activeGroup)]: [] },
  }));

  const setAllGroup = () => updateStep(activeStep, current => ({
    ...current, groups: { ...current.groups, [String(activeGroup)]: Array.from({ length: 40 }, (_, i) => i + 1) },
  }));

  const clearStep = () => updateStep(activeStep, current => ({ ...current, groups: emptyGroups() }));

  const togglePreset = preset => updateStep(activeStep, current => {
    const next = Object.fromEntries(GROUPS.map(group => [
      String(group), [...(current.groups[String(group)] || [])],
    ]));
    const alreadyOn = preset.addresses.every(address =>
      address.channels.every(channel => next[String(address.group)]?.includes(channel)));
    for (const address of preset.addresses) {
      const channels = new Set(next[String(address.group)] || []);
      address.channels.forEach(channel => alreadyOn ? channels.delete(channel) : channels.add(channel));
      next[String(address.group)] = [...channels].sort((a, b) => a - b);
    }
    return { ...current, groups: next };
  });

  const addStep = copy => {
    const source = copy ? draft.steps[activeStep] : emptyStep();
    const item = JSON.parse(JSON.stringify(source));
    setDraft(current => ({ ...current, steps: [...current.steps, item] }));
    setActiveStep(draft.steps.length);
  };

  const removeStep = () => {
    if (draft.steps.length === 1) return;
    setDraft(current => ({ ...current, steps: current.steps.filter((_, i) => i !== activeStep) }));
    setActiveStep(Math.max(0, activeStep - 1));
  };

  const useOpeningPulseTemplate = () => {
    const opening = layout?.presets?.find(item => item.id === "proven-opening");
    if (!opening) return;
    setDraft(current => ({
      ...current, id: "", name: "Opening Pulse", steps: [
        stepFromAddresses(opening.addresses, 2000), emptyStep(),
      ],
    }));
    setActiveStep(0);
  };

  const useBankWaveTemplate = () => {
    const banks = ["middle-a", "middle-b", "middle-c", "middle-d"]
      .map(id => layout?.presets?.find(item => item.id === id)).filter(Boolean);
    const opening = layout?.presets?.find(item => item.id === "proven-opening");
    if (banks.length !== 4 || !opening) return;
    const support = opening.addresses.filter(address => address.group === 17);
    setDraft(current => ({
      ...current, id: "", name: "Four-Bank Wave", steps: [
        ...banks.map(bank => stepFromAddresses([...bank.addresses, ...support], 1000)),
        emptyStep(),
      ],
    }));
    setActiveStep(0);
  };

  const savePattern = async () => {
    setBusy("save");
    try {
      const result = await apiPost("/ican/manual-patterns", draft);
      setDraft(hydratePattern(result));
      await loadSaved();
      say?.(`saved manual pattern: ${result.name}`, "ok");
    } catch (error) {
      say?.(`manual pattern save failed — ${error.message}`, "err");
    } finally { setBusy(""); }
  };

  const deletePattern = async () => {
    if (!draft.id) return;
    setBusy("delete");
    try {
      const response = await fetch(apiUrl(`/ican/manual-patterns/${encodeURIComponent(draft.id)}`), {
        method: "DELETE", headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDraft(newDraft());
      setActiveStep(0);
      await loadSaved();
      say?.("manual pattern deleted", "info");
    } catch (error) {
      say?.(`manual pattern delete failed — ${error.message}`, "err");
    } finally { setBusy(""); }
  };

  const runPattern = async () => {
    setBusy("run");
    try {
      const result = await apiPost("/ican/manual-pattern/run", {
        pattern: draft, repeat: Number(repeat), confirm: confirmText,
      });
      setStatus?.(result);
      say?.(`manual pattern started: ${draft.name}`, "ok");
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(error => say?.(`music playback blocked — ${error.message}`, "warn"));
      }
      await refresh?.();
    } catch (error) {
      say?.(`manual pattern start failed — ${error.message}`, "err");
    } finally { setBusy(""); }
  };

  const stopPattern = async () => {
    setBusy("stop");
    try {
      const result = await apiPost("/ican/manual-pattern/stop", {});
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      setStatus?.(result);
      say?.("manual pattern stopped — all driven groups off", "warn");
      await refresh?.();
    } catch (error) {
      say?.(`manual pattern stop failed — ${error.message}`, "err");
    } finally { setBusy(""); }
  };

  const canRun = connected && armed && permit && !siteDemoRunning && !channelTestRunning && !status?.running
    && confirmText === CONFIRM && !busy;
  const progress = status?.duration_s
    ? Math.min(100, (Number(status.elapsed_s || 0) / status.duration_s) * 100) : 0;

  return (
    <div style={{ fontFamily: "monospace", color: C.text }}>
      <div style={{ padding: 8, border: `1px solid ${C.line}`, borderRadius: 4, marginBottom: 8 }}>
        <div style={{ color: C.bright, marginBottom: 5 }}>Site layout from the photographs and operator description</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(130px,1fr))", gap: 5 }}>
          {(layout?.sections || []).map(section => (
            <div key={section.id} style={{ background: C.bg, padding: 6, borderRadius: 3 }}>
              <div style={{ color: C.accent }}>{section.label}</div>
              <div style={{ fontSize: 9 }}>{section.outputs} output{section.outputs === 1 ? "" : "s"} · {section.pumps} pump{section.pumps === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
        <div style={{ color: C.warn, fontSize: 9, marginTop: 6, lineHeight: 1.45 }}>
          Address presets below are capture-derived candidates. The ninth front output, six pump addresses,
          pump ordering and group 17 functions still require physical commissioning.
        </div>
        <div style={{ color: C.dim, fontSize: 9, marginTop: 5, lineHeight: 1.45 }}>
          Cabinet photos confirm the I-CAN NETCAN converter, Music Fountain Control System,
          solid-state load relays and separate multi-pole power circuits. Their labels do not reveal
          the I-CAN address translation. Group 17 is therefore locked to
          all-off or its captured support state so a possible pump/contactor circuit cannot be patterned arbitrarily.
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
        <select style={{ ...input, minWidth: 150 }} value={draft.id}
          onChange={event => {
            const found = saved.find(item => item.id === event.target.value);
            if (found) { setDraft(hydratePattern(found)); setActiveStep(0); }
            else { setDraft(newDraft()); setActiveStep(0); }
          }}>
          <option value="">New pattern</option>
          {saved.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input style={{ ...input, flex: "1 1 160px" }} value={draft.name}
          onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
          placeholder="Pattern name" />
        <button style={button(false, C.ok)} disabled={!!busy || !draft.name.trim()} onClick={savePattern}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button style={button(false, C.danger)} disabled={!!busy || !draft.id} onClick={deletePattern}>Delete</button>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 7 }}>
        <span style={{ fontSize: 9, color: C.dim, alignSelf: "center" }}>Start from:</span>
        <button style={button(false, C.ok)} disabled={!layout} onClick={useOpeningPulseTemplate}>Opening pulse</button>
        <button style={button(false, C.warn)} disabled={!layout} onClick={useBankWaveTemplate}>Four-bank wave candidate</button>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 7 }}>
        {draft.steps.map((item, index) => (
          <button key={index} style={button(activeStep === index, C.accent)} onClick={() => setActiveStep(index)}>
            {index + 1}: {(item.duration_ms / 1000).toFixed(1)}s · {selectedCount(item)} on
          </button>
        ))}
        <button style={button(false)} onClick={() => addStep(true)}>+ Copy step</button>
        <button style={button(false)} onClick={() => addStep(false)}>+ Off step</button>
        <button style={button(false, C.danger)} disabled={draft.steps.length === 1} onClick={removeStep}>Remove</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
        <span style={{ fontSize: 9 }}>Step {activeStep + 1} duration</span>
        <input type="number" min="100" max="60000" step="100" style={{ ...input, width: 75 }}
          value={step.duration_ms}
          onChange={event => updateStep(activeStep, current => ({
            ...current, duration_ms: Math.max(100, Math.min(60000, Number(event.target.value) || 100)),
          }))} />
        <span style={{ fontSize: 9 }}>ms</span>
        <button style={button(false, C.warn)} onClick={clearStep}>All groups off</button>
      </div>

      <div style={{ marginBottom: 7 }}>
        <div style={{ fontSize: 9, color: C.dim, marginBottom: 4 }}>
          Proven captured state and provisional physical presets
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(layout?.presets || []).map(preset => {
            const on = preset.addresses.every(address =>
              address.channels.every(channel => step.groups?.[String(address.group)]?.includes(channel)));
            const color = preset.confidence === "hardware-proven" ? C.ok : C.warn;
            return <button key={preset.id} style={button(on, color)} onClick={() => togglePreset(preset)}
              title={preset.confidence === "hardware-proven"
                ? "Exact state from the sequence that ran this fountain"
                : "Candidate address grouping; confirm during commissioning"}>{preset.label}</button>;
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
        {GROUPS.map(group => (
          <button key={group} style={button(activeGroup === group)} onClick={() => setActiveGroup(group)}>
            Group {group} ({step.groups?.[String(group)]?.length || 0})
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(30px,1fr))", gap: 3, marginBottom: 5 }}>
        {Array.from({ length: 40 }, (_, index) => index + 1).map(channel => (
          <button key={channel} style={{ ...button(activeChannels.has(channel), C.ok), padding: "5px 2px" }}
            disabled={groupLocked} onClick={() => toggleChannel(channel)}>{channel}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
        <button style={button(false)} disabled={groupLocked} onClick={setAllGroup}>Select group 1-40</button>
        <button style={button(false)} onClick={clearGroup}>Clear group {activeGroup}</button>
      </div>
      {groupLocked && (
        <div style={{ color: C.warn, fontSize: 9, marginTop: -6, marginBottom: 10 }}>
          {activeGroup === 17
            ? "Group 17 is locked to the exact Captured G17 support state or off."
            : `Group ${activeGroup} may control frequency, pump, or fire equipment and is locked until commissioned.`}
        </div>
      )}

      <div style={{ padding: 8, border: `1px solid ${status?.running ? C.ok : C.line}`, borderRadius: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 9 }}>Repeat</label>
          <input type="number" min="1" max="20" style={{ ...input, width: 48 }} value={repeat}
            onChange={event => setRepeat(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
          <span style={{ fontSize: 9, color: C.dim }}>total {(totalMs / 1000).toFixed(1)}s</span>
          {audioFile && <span style={{ fontSize: 9, color: C.ok }} title={audioFile.name}>music: {audioFile.name}</span>}
          <input style={{ ...input, width: 175 }} placeholder={`type: ${CONFIRM}`}
            value={confirmText} onChange={event => setConfirmText(event.target.value)} />
          <button style={button(!!status?.running, C.ok)} disabled={!canRun} onClick={runPattern}>
            {status?.running ? "RUNNING" : "RUN MANUAL PATTERN"}
          </button>
          <button style={button(false, C.danger)} disabled={!status?.running || !!busy} onClick={stopPattern}>STOP PATTERN</button>
        </div>
        <div style={{ height: 4, background: C.line, marginTop: 7, overflow: "hidden", borderRadius: 2 }}>
          <div style={{ width: `${progress}%`, height: "100%", background: status?.running ? C.ok : C.accent }} />
        </div>
        <div style={{ fontSize: 9, marginTop: 5, color: status?.error ? C.danger : C.dim }}>
          {status?.running
            ? `${status.pattern_name} · pass ${status.pass_index}/${status.repeat} · step ${status.step_index + 1}/${status.step_count} · ${status.remaining_s}s remaining`
            : status?.outcome && status.outcome !== "idle"
              ? `last result: ${status.outcome}${status.error ? ` — ${status.error}` : ""}`
              : "Draft and preview states freely. Hardware Run requires Safety, output arm, and the typed phrase."}
        </div>
        {(!connected || !permit || !armed || siteDemoRunning || channelTestRunning) && (
          <div style={{ color: C.warn, fontSize: 9, marginTop: 4 }}>
            {!connected ? "Connect the gateway first."
              : !permit ? "Arm the safety system first."
                : !armed ? "Arm I-CAN output first."
                  : siteDemoRunning ? "Stop the one-minute site demo first."
                    : "Stop the manual channel test first."}
          </div>
        )}
      </div>
    </div>
  );
}
