import { useEffect, useState } from "react";
import { SECTION_LIBRARY_KEY, MAX_SECTION_FILE_SIZE, readSectionLibrary, saveShowSection, validateShowSection } from "../../utils/showSections";
import { getPatternBlocks } from "../../utils/patternBlocks";
import { useICANPreviewStore } from "../../store/icanPreviewStore";

const button = { padding: "7px 9px", border: "1px solid #34526c", borderRadius: 4, background: "#12293b", color: "#bce7fc", cursor: "pointer", fontSize: 11 };
const input = { ...button, width: "100%", boxSizing: "border-box", margin: "4px 0 9px" };
const fieldLabel = { display: "block", marginTop: 8 };
function download(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function initialLibrary() {
  try { return { items: readSectionLibrary(localStorage.getItem(SECTION_LIBRARY_KEY)), error: "" }; }
  catch (error) { return { items: [], error: `Saved section library could not be read: ${error.message} Its stored data has been preserved. Import a valid library to restore it.` }; }
}

export default function ShowSectionEditor({ clips, blocks, selectedIds, onSelection, onArrange, onInsert, currentTime, notify }) {
  const previous = useICANPreviewStore.getState().sectionBuilderDraft || {};
  const [name, setName] = useState(previous.name || "My show section");
  const [start, setStart] = useState(previous.start ?? 0), [gap, setGap] = useState(previous.gap ?? 0);
  const [repeats, setRepeats] = useState(previous.repeats ?? 1);
  const [library, setLibrary] = useState(initialLibrary);
  const [templateId, setTemplateId] = useState(previous.templateId || "");
  const selected = blocks.filter(b => selectedIds.includes(b.id));
  const template = library.items.find(s => s.id === templateId) || library.items[0] || null;
  useEffect(() => {
    useICANPreviewStore.setState({ sectionBuilderDraft: { name, start, gap, repeats, templateId } });
  }, [name, start, gap, repeats, templateId]);
  const persist = values => {
    if (values.length > 32) throw new Error("The library supports 32 sections. Export and remove sections you no longer use.");
    const raw = JSON.stringify(values);
    if (raw.length > MAX_SECTION_FILE_SIZE * 2) throw new Error("The section library is full. Export and remove an older section.");
    localStorage.setItem(SECTION_LIBRARY_KEY, raw);
    setLibrary({ items: values, error: "" });
  };
  const attempt = action => { try { action(); } catch (error) { notify(error.message, "warning"); } };
  const save = () => attempt(() => {
    if (library.error) throw new Error(library.error);
    const section = saveShowSection(clips, selectedIds, name);
    if (library.items.some(s => s.name.toLowerCase() === section.name.toLowerCase())) throw new Error("That section name is already saved. Choose a new name; existing sections are never overwritten automatically.");
    persist([...library.items, section]); setTemplateId(section.id);
    notify(`Saved section “${section.name}”: ${selected.length} blocks, ${section.duration.toFixed(2)}s.`, "success");
  });
  const importFile = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_SECTION_FILE_SIZE * 2) throw new Error("The section import file is too large.");
      const value = JSON.parse(await file.text());
      const incoming = Array.isArray(value) ? readSectionLibrary(JSON.stringify(value)) : [validateShowSection(value)];
      if (library.error && !Array.isArray(value)) throw new Error("Import a full valid library to restore the damaged library; its stored data is preserved.");
      const current = library.error ? [] : library.items;
      const ids = new Set(current.map(s => s.id)), names = new Set(current.map(s => s.name.toLowerCase()));
      const additions = incoming.filter(s => !ids.has(s.id));
      if (additions.some(s => names.has(s.name.toLowerCase())) || new Set(additions.map(s => s.name.toLowerCase())).size !== additions.length) throw new Error("A section with this name already exists. Rename the exported section before importing it.");
      persist([...current, ...additions]);
      if (additions[0]) setTemplateId(additions[0].id);
      notify(`Imported ${additions.length} show sections. Existing sections were retained.`, "success");
    } catch (error) { notify(error.message, "warning"); }
    finally { event.target.value = ""; }
  };
  return <div style={{ padding: 12, fontSize: 11, color: "#b4d8ef" }}>
    <b style={{ fontSize: 14 }}>Reusable show sections</b>
    <p>Tick blocks on the left to combine their dances. Layer different zones at the same time, or sequence movements into a larger show.</p>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      <button style={button} onClick={() => onSelection(blocks.map(b => b.id))}>Select all blocks</button>
      <button style={button} onClick={() => onSelection([])}>Clear block selection</button>
    </div>
    <p style={{ color: "#7ee6de" }}>{selected.length} blocks selected{selected.length ? ` · ${new Set(selected.flatMap(b => b.members.map(c => c.fixtureId))).size} outlets` : ""}</p>
    {selected.map(b => <div key={b.id} style={{ fontSize: 10, marginBottom: 4 }}>{b.name} · {b.startTime.toFixed(2)}–{b.endTime.toFixed(2)}s</div>)}
    <label style={fieldLabel}>Start time (seconds)<input aria-label="Section start" type="number" min={0} step={0.1} style={input} value={start} onChange={e => setStart(e.target.value)} /></label>
    <button style={{ ...button, marginBottom: 9 }} onClick={() => setStart(Number(currentTime).toFixed(2))}>Use section playhead</button>
    <label style={fieldLabel}>Gap (seconds)<input aria-label="Section gap" type="number" min={0} step={0.1} style={input} value={gap} onChange={e => setGap(e.target.value)} /></label>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <button disabled={!selected.length} style={button} onClick={() => onArrange(selectedIds, { mode: "sequence", startTime: start, gap })}>Sequence selected blocks</button>
      <button disabled={!selected.length} style={button} onClick={() => onArrange(selectedIds, { mode: "layer", startTime: start, gap: 0 })}>Layer selected blocks</button>
      <button disabled={!selected.length} style={button} onClick={() => onArrange(selectedIds, { mode: "move", startTime: start, gap: 0 })}>Move selection together</button>
    </div>
    <p style={{ color: "#859fb7", fontSize: 10 }}>Sequence follows timeline order. Layer aligns starts; Move preserves relative offsets. Overlapping ON valves combine. Exact site conversion checks conflicting ON/OFF clips and commissioning limits.</p>
    <label style={fieldLabel}>Section name<input aria-label="Section name" style={input} value={name} onChange={e => setName(e.target.value)} /></label>
    <button disabled={!selected.length || !!library.error} style={{ ...button, width: "100%" }} onClick={save}>Save selected as section</button>
    <div style={{ borderTop: "1px solid #2d455c", marginTop: 16, paddingTop: 12 }}>
      <b>Saved section library · {library.items.length}</b>
      {library.error && <p role="alert" style={{ color: "#f6c877" }}>{library.error}</p>}
      <select aria-label="Saved show section" value={template?.id || ""} onChange={e => setTemplateId(e.target.value)} style={{ ...input, marginTop: 9 }}>
        {!template && <option value="">No sections saved yet</option>}
        {library.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {template && <p>{getPatternBlocks(template.clips).length} blocks · {template.clips.length} clips · {template.duration.toFixed(2)}s. Outlet identities stay linked to this engineering project.</p>}
      <label style={fieldLabel}>Section repeats<input aria-label="Section repeats" type="number" min={1} max={20} step={1} style={input} value={repeats} onChange={e => setRepeats(e.target.value)} /></label>
      <button style={{ ...button, width: "100%" }} disabled={!template} onClick={() => onInsert(template, { startTime: start, repeats, gap })}>Insert saved section</button>
      <p style={{ fontSize: 10, color: "#859fb7" }}>Repeats keep the section's internal layering and OFF gaps. The Gap field separates repeated sections. Insert creates independent editable blocks.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button disabled={!template} style={button} onClick={() => download(template, "aquaflow-show-section.json")}>Export selected section</button>
        <button disabled={!library.items.length} style={button} onClick={() => download(library.items, "aquaflow-section-library.json")}>Export section library</button>
        <label style={button}>Import sections<input aria-label="Import show sections" type="file" accept="application/json" onChange={importFile} style={{ display: "none" }} /></label>
        {template && <button style={{ ...button, color: "#fdb2bb" }} onClick={() => attempt(() => persist(library.items.filter(s => s.id !== template.id)))}>Remove saved section</button>}
      </div>
    </div>
  </div>;
}
