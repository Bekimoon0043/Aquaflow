/**
 * workspaceUI.jsx — the panels that make the 3D view a workspace.
 *
 * Depence surrounds its Project View with a Library to drag fixtures from, a 3D-Hierarchy
 * showing the scene graph, a Transformation window for exact numbers, and a tool strip.
 * Those four are what let a designer BUILD rather than just look, so these are the four
 * built here.
 *
 * Presentational only. Every one of these takes the editor and renders from it — none
 * holds design state of its own, so the tree, the inspector and the viewport are always
 * showing the same graph rather than three drifting copies.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { NODE_TYPES } from "../sceneGraph";
import { FIXTURE_PALETTE, paletteSpec } from "../fixtureBridge";
import { TOOLS, SHORTCUTS } from "../editorSnapping";
import { BUILTIN_MODELS, importGlb, listImportedModels } from "../../modelLibrary";

const MONO = "monospace";
const C = {
  line: "#0a2030",
  dim: "#334455",
  text: "#8ea4b8",
  bright: "#cfe0f0",
  accent: "#00aaff",
  panel: "#030812",
};

const label = {
  color: C.dim, fontSize: 9, letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 5, fontFamily: MONO,
};

function btn(active, color = C.accent) {
  return {
    padding: "3px 8px", fontSize: 10, cursor: "pointer", borderRadius: 3,
    background: active ? `${color}22` : "transparent",
    color: active ? color : C.dim,
    border: `1px solid ${active ? color + "66" : C.line}`,
    fontFamily: MONO, flexShrink: 0,
  };
}

/** Re-render whenever the editor or its graph changes. */
function useEditorTick(editor) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick(t => t + 1);
    const offEditor = editor.subscribe(bump);
    const offGraph = editor.graph.subscribe(bump);
    return () => { offEditor(); offGraph(); };
  }, [editor]);
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
export function EditorToolbar({ editor, onExitEditor, onSave, saveLabel = "Save", scene }) {
  useEditorTick(editor);
  const [quad, setQuad] = useState(false);
  if (!editor) return null;
  const sel = editor.graph.selected();
  const history = editor.history.state();
  const canUngroup = sel.some(id => editor.graph.get(id)?.type === NODE_TYPES.GROUP);

  const Tool = ({ id, glyph, title }) => (
    <button title={title} onClick={() => editor.setTool(id)} style={btn(editor.tool === id)}>{glyph}</button>
  );

  return (
    <div style={{
      position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 22,
      display: "flex", gap: 4, alignItems: "center", padding: "6px 8px", borderRadius: 6,
      background: "rgba(3,8,18,0.88)", border: `1px solid ${C.line}`, backdropFilter: "blur(6px)",
    }}>
      <Tool id={TOOLS.SELECT} glyph="⬚" title="Select (Q)" />
      <Tool id={TOOLS.MOVE} glyph="✥" title="Move (W)" />
      <Tool id={TOOLS.ROTATE} glyph="⟳" title="Rotate (E)" />
      <span style={{ width: 1, height: 16, background: C.line, margin: "0 3px" }} />
      <button title="Focus selection (F)" onClick={() => editor.focusSelection()} style={btn(false)}>◎</button>
      <button title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo"}
        disabled={!history.canUndo} onClick={() => editor.undo()} style={btn(false)}>↶</button>
      <button title={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Y)` : "Nothing to redo"}
        disabled={!history.canRedo} onClick={() => editor.redo()} style={btn(false)}>↷</button>
      <button title="Duplicate (Ctrl+D)" disabled={!sel.length}
        onClick={() => editor.duplicateSelection()} style={btn(false)}>⧉</button>
      <button title="Group selection (Ctrl+G)" disabled={sel.length < 2}
        onClick={() => editor.groupSelection()} style={btn(false)}>⊞</button>
      <button title="Ungroup selection (Ctrl+Shift+G)" disabled={!canUngroup}
        onClick={() => editor.ungroupSelection()} style={btn(false)}>⊟</button>
      <button title="Delete (Del)" disabled={!sel.length}
        onClick={() => editor.deleteSelection()} style={btn(false, "#ff5c6c")}>🗑</button>
      <span style={{ width: 1, height: 16, background: C.line, margin: "0 3px" }} />
      <button title="Quad view — perspective + top / front / side"
        onClick={() => { const on = !quad; setQuad(on); scene?.setQuadView?.(on); }}
        style={btn(quad)}>⊞⊞</button>
      {onSave && <button title="Commit viewport layout to Engineering Design"
        onClick={onSave} style={btn(false, "#3ddc84")}>✓ {saveLabel}</button>}
      <span style={{ width: 1, height: 16, background: C.line, margin: "0 3px" }} />
      <span style={{ color: C.dim, fontSize: 9, fontFamily: MONO }}>
        {sel.length ? `${sel.length} selected` : "nothing selected"}
      </span>
      {onExitEditor && (
        <>
          <span style={{ width: 1, height: 16, background: C.line, margin: "0 3px" }} />
          <button title="Leave edit mode" onClick={onExitEditor} style={btn(false)}>✕</button>
        </>
      )}
    </div>
  );
}

// ── Library ─────────────────────────────────────────────────────────────────
export function LibraryPalette({ editor, compact = false }) {
  const [dragKey, setDragKey] = useState(null);
  const [imported, setImported] = useState([]);
  const [importMessage, setImportMessage] = useState("");
  const [category, setCategory] = useState("Nozzles");
  const fileRef = useRef(null);

  useEffect(() => { listImportedModels().then(setImported).catch(error => setImportMessage(error.message)); }, []);

  // Drag from the palette, drop into the 3D view — the way fixtures get into a scene
  // in Depence. The drop lands where the pointer meets the ground plane.
  const onDragStart = (key) => (e) => {
    setDragKey(key);
    e.dataTransfer.setData("text/aquaflow-fixture", key);
    e.dataTransfer.effectAllowed = "copy";
  };

  const grouped = FIXTURE_PALETTE.reduce((acc, f) => {
    const g = f.type === NODE_TYPES.NOZZLE ? "Nozzles"
      : f.type === NODE_TYPES.LIGHT ? "Lighting" : "Hydraulics";
    (acc[g] = acc[g] || []).push(f);
    return acc;
  }, {});
  const models = [...BUILTIN_MODELS, ...imported];
  const categories = ["Nozzles", "Lighting", "Hydraulics", "People", "Landscaping", "Buildings", "Imported"];
  const addFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await importGlb(file);
      setImported(list => [...list, asset]);
      setImportMessage(`${asset.name} is ready. Drag it into the 3D view.`);
    } catch (error) { setImportMessage(error?.message || "Could not import model."); }
  };

  return (
    <div>
      <div style={label}>Library</div>
      <div style={{ color: C.dim, fontSize: 9, fontFamily: MONO, marginBottom: 6 }}>
        Drag into the 3D view
      </div>
      <div style={{ display:"flex", gap:3, flexWrap:"wrap", paddingBottom:5, marginBottom:5 }}>
        {categories.map(name => <button key={name} onClick={() => setCategory(name)}
          style={{ ...btn(category === name), padding:"3px 6px", whiteSpace:"nowrap" }}>{name}</button>)}
      </div>
      {Object.entries(grouped).filter(([group]) => group === category).map(([group, items]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ color: C.text, fontSize: 9, fontFamily: MONO, marginBottom: 3 }}>{group}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
            {items.map(f => (
              <div key={f.key}
                draggable
                onDragStart={onDragStart(f.key)}
                onDragEnd={() => setDragKey(null)}
                title={`Drag ${f.label} into the scene`}
                style={{
                  ...btn(dragKey === f.key), cursor: "grab", textAlign: "center",
                  padding: "4px 2px", userSelect: "none",
                }}>
                {f.label}
              </div>
            ))}
          </div>
        </div>
      ))}
      {!["Nozzles", "Lighting", "Hydraulics"].includes(category) && <div style={{ marginTop: compact ? 2 : 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
        <div style={label}>3D Models · {category}</div>
        <div style={{ color: C.dim, fontSize: 9, fontFamily: MONO, marginBottom: 5 }}>
          Drag a person, tree or building into the view. Select it to move, rotate or resize.
        </div>
        {[category].map(group => {
          const items = models.filter(asset => asset.category === group);
          if (!items.length) return null;
          return <div key={group} style={{ marginBottom: 7 }}>
            <div style={{ color: C.text, fontSize: 9, fontFamily: MONO, marginBottom: 3 }}>{group}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
              {items.map(asset => <div key={asset.id} draggable
                onDragStart={event => {
                  setDragKey(asset.id);
                  event.dataTransfer.setData("text/aquaflow-model", asset.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => setDragKey(null)}
                title={`Drag ${asset.name} into the 3D view`}
                style={{ ...btn(dragKey === asset.id), cursor: "grab", textAlign: "center", padding: "4px 2px" }}>
                {asset.name}
              </div>)}
            </div>
          </div>;
        })}
        <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" onChange={addFile} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} style={btn(false)} title="Import a self-contained glTF Binary file exported from Blender">
          Import Blender GLB…
        </button>
        {importMessage && <div role="status" style={{ color: C.text, fontSize: 9, marginTop: 5 }}>{importMessage}</div>}
      </div>}
    </div>
  );
}

// ── Scene tree ──────────────────────────────────────────────────────────────
export function SceneTree({ editor }) {
  useEditorTick(editor);
  const [filter, setFilter] = useState("");
  if (!editor) return null;
  const graph = editor.graph;
  const rows = graph.flatten(filter ? { text: filter } : null);

  const glyph = (type) => ({
    [NODE_TYPES.GROUP]: "▣",
    [NODE_TYPES.NOZZLE]: "▲",
    [NODE_TYPES.LIGHT]: "◉",
    [NODE_TYPES.PUMP]: "⬢",
    [NODE_TYPES.VALVE]: "⬡",
    [NODE_TYPES.DISTRIBUTOR]: "⊟",
  }[type] || "◇");

  return (
    <div>
      <div style={label}>3D Hierarchy</div>
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="filter…"
        style={{
          width: "100%", boxSizing: "border-box", marginBottom: 5, padding: "3px 6px",
          background: "#010409", border: `1px solid ${C.line}`, borderRadius: 3,
          color: C.bright, fontSize: 10, fontFamily: MONO, outline: "none",
        }} />
      <div style={{ maxHeight: 190, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 3 }}>
        {rows.length === 0 && (
          <div style={{ padding: "8px 6px", color: C.dim, fontSize: 10, fontFamily: MONO }}>
            {filter ? "no match" : "scene is empty — drag a fixture in"}
          </div>
        )}
        {rows.map(({ node, depth }) => {
          const selected = graph.selection.has(node.id);
          const visible = node.visible;
          return (
            <div key={node.id}
              onClick={(e) => {
                graph.select([node.id], { additive: e.ctrlKey || e.metaKey || e.shiftKey });
                editor._repaintAll(); editor._updateGizmo(); editor._emit("selection");
              }}
              style={{
                display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
                padding: "2px 5px", paddingLeft: 5 + depth * 12,
                background: selected ? "#00aaff22" : "transparent",
                color: selected ? C.accent : (visible ? C.text : C.dim),
                fontSize: 10, fontFamily: MONO,
                borderBottom: `1px solid #06121c`,
              }}>
              <span style={{ opacity: 0.8 }}>{glyph(node.type)}</span>
              <span style={{
                flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                textDecoration: visible ? "none" : "line-through",
              }}>{node.name}</span>
              <span title={visible ? "Hide" : "Show"}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.setNodeVisible(node.id, !node.visible);
                }}
                style={{ opacity: visible ? 0.85 : 0.35, padding: "0 2px" }}>👁</span>
            </div>
          );
        })}
      </div>
      <div style={{ color: C.dim, fontSize: 9, fontFamily: MONO, marginTop: 4 }}>
        {graph.count()} objects
      </div>
    </div>
  );
}

// ── Inspector / Transformation ──────────────────────────────────────────────
export function Inspector({ editor }) {
  useEditorTick(editor);
  const [draft, setDraft] = useState(null);

  const graph = editor?.graph;
  const ids = graph?.selected() || [];
  const single = ids.length === 1 ? graph.get(ids[0]) : null;

  // Reset the draft whenever the selection changes, so the fields show the new object
  // rather than half-typed values from the previous one.
  useEffect(() => { setDraft(null); }, [ids.join(",")]);

  const commit = useCallback((patch) => {
    if (!single) return;
    editor.setNodeTransform(single.id, patch);
  }, [single, graph, editor]);

  if (!editor) return null;
  if (ids.length === 0) {
    return (
      <div>
        <div style={label}>Transformation</div>
        <div style={{ color: C.dim, fontSize: 10, fontFamily: MONO }}>
          Select an object in the viewport or the hierarchy.
        </div>
      </div>
    );
  }
  if (!single) {
    return (
      <div>
        <div style={label}>Transformation</div>
        <div style={{ color: C.text, fontSize: 10, fontFamily: MONO }}>
          {ids.length} objects selected. The gizmo moves them together; select one to type
          exact values.
        </div>
      </div>
    );
  }

  const t = single.transform;
  const world = graph.worldPosition(single.id);

  const Num = ({ group, axis, value }) => {
    const key = `${group}.${axis}`;
    const shown = draft && draft.key === key ? draft.value : (Math.round(value * 1000) / 1000);
    return (
      <input
        value={shown}
        onChange={e => setDraft({ key, value: e.target.value })}
        onBlur={() => {
          if (draft && draft.key === key) {
            const v = parseFloat(draft.value);
            // An unparseable entry reverts rather than writing NaN into the scene.
            if (Number.isFinite(v)) commit({ [group]: { [axis]: v } });
            setDraft(null);
          }
        }}
        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setDraft(null); }}
        style={{
          width: "100%", boxSizing: "border-box", padding: "2px 4px",
          background: "#010409", border: `1px solid ${C.line}`, borderRadius: 3,
          color: C.bright, fontSize: 10, fontFamily: MONO, outline: "none",
        }} />
    );
  };

  const Row = ({ title, group, vec, unit }) => (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: C.text, fontSize: 9, fontFamily: MONO, marginBottom: 2 }}>
        {title} <span style={{ color: C.dim }}>{unit}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3 }}>
        {["x", "y", "z"].map(a => <Num key={a} group={group} axis={a} value={vec[a] || 0} />)}
      </div>
    </div>
  );

  return (
    <div>
      <div style={label}>Transformation</div>
      <input
        value={single.name}
        onChange={e => editor.setNodeName(single.id, e.target.value)}
        style={{
          width: "100%", boxSizing: "border-box", marginBottom: 6, padding: "3px 6px",
          background: "#010409", border: `1px solid ${C.line}`, borderRadius: 3,
          color: C.accent, fontSize: 11, fontFamily: MONO, outline: "none",
        }} />

      <Row title="Position" group="position" vec={t.position} unit="m" />
      <Row title="Rotation" group="rotation" vec={t.rotation} unit="deg" />

      <div style={{ marginBottom: 6 }}>
        <div style={{ color: C.text, fontSize: 9, fontFamily: MONO, marginBottom: 2 }}>Size</div>
        <input
          value={typeof t.scale === "number" ? t.scale : 1}
          onChange={e => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v > 0) commit({ scale: v });
          }}
          style={{
            width: "100%", boxSizing: "border-box", padding: "2px 4px",
            background: "#010409", border: `1px solid ${C.line}`, borderRadius: 3,
            color: C.bright, fontSize: 10, fontFamily: MONO, outline: "none",
          }} />
      </div>

      {single.parentId && (
        <div style={{ color: C.dim, fontSize: 9, fontFamily: MONO, marginBottom: 6 }}>
          World: {world.x.toFixed(2)}, {world.y.toFixed(2)}, {world.z.toFixed(2)} m
          <br />(local values shown above are relative to the parent)
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <button onClick={() => editor.setNodeVisible(single.id, !single.visible)}
          style={{ ...btn(false), flex: 1 }}>{single.visible ? "Hide" : "Show"}</button>
        <button onClick={() => editor.setNodeLocked(single.id, !single.locked)}
          style={{ ...btn(single.locked, "#ffaa33"), flex: 1 }}>{single.locked ? "Locked" : "Lock"}</button>
      </div>

      <FixtureProps editor={editor} node={single} />
    </div>
  );
}

/** Type-specific properties, below the shared transform block. */
function FixtureProps({ editor, node }) {
  const set = (k, v) => editor.setNodeProps(node.id, { [k]: v }, k);

  if (node.type === NODE_TYPES.NOZZLE) {
    const types = FIXTURE_PALETTE.filter(f => f.type === NODE_TYPES.NOZZLE);
    return (
      <div>
        <div style={label}>Nozzle</div>
        <select
          value={node.props.nozzleType || "jet_1d"}
          onChange={e => set("nozzleType", e.target.value)}
          style={{
            width: "100%", padding: "3px 4px", background: "#010409",
            border: `1px solid ${C.line}`, borderRadius: 3, color: C.bright,
            fontSize: 10, fontFamily: MONO, outline: "none",
          }}>
          {types.map(t => <option key={t.key} value={t.props.nozzleType}>{t.label}</option>)}
        </select>
      </div>
    );
  }

  if (node.type === NODE_TYPES.LIGHT) {
    return (
      <div>
        <div style={label}>Light</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
          <input type="color" value={node.props.color || "#3aa0ff"}
            onChange={e => set("color", e.target.value)}
            style={{ width: 32, height: 22, background: "none", border: `1px solid ${C.line}`, borderRadius: 3 }} />
          <input type="range" min="0" max="1" step="0.05"
            value={node.props.intensity ?? 0.85}
            onChange={e => set("intensity", parseFloat(e.target.value))}
            style={{ flex: 1 }} />
        </div>
        <div style={{ color: C.dim, fontSize: 9, fontFamily: MONO }}>
          Intensity {(node.props.intensity ?? 0.85).toFixed(2)}
        </div>
      </div>
    );
  }
  return null;
}

/** Compact keyboard reference, generated from the same table that dispatches them. */
export function ShortcutHint() {
  return (
    <div>
      <div style={label}>Shortcuts</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 6px" }}>
        {SHORTCUTS.map(s => (
          <RowHint key={s.command + s.key} k={s.label} d={s.desc} />
        ))}
        <RowHint k="Shift" d="Snap 10cm / 5°" />
        <RowHint k="Ctrl+drag" d="Duplicate while moving" />
        <RowHint k="Alt+drag" d="Orbit / free placement" />
        <RowHint k="Right-drag" d="Pan" />
      </div>
    </div>
  );
}

function RowHint({ k, d }) {
  return (
    <>
      <span style={{ color: C.accent, fontSize: 9, fontFamily: MONO, whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ color: C.dim, fontSize: 9, fontFamily: MONO }}>{d}</span>
    </>
  );
}

/** Drop target wrapper for the viewport — accepts library drags. */
export function useLibraryDrop(editor) {
  const onDragOver = useCallback((e) => {
    if (!editor?.enabled) return;
    if (e.dataTransfer.types.includes("text/aquaflow-fixture") || e.dataTransfer.types.includes("text/aquaflow-model")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, [editor]);

  const onDrop = useCallback((e) => {
    if (!editor?.enabled) return;
    const modelId = e.dataTransfer.getData("text/aquaflow-model");
    if (modelId) {
      e.preventDefault();
      const model = BUILTIN_MODELS.find(asset => asset.id === modelId);
      editor.dropAt(e.clientX, e.clientY, {
        type: NODE_TYPES.MODEL, name: model?.name || "Imported 3D model", props: { assetId: modelId },
      });
      return;
    }
    const key = e.dataTransfer.getData("text/aquaflow-fixture");
    if (!key) return;
    e.preventDefault();
    const count = editor.graph.byType(paletteSpec(key)?.type || "").length;
    const spec = paletteSpec(key, count + 1);
    if (spec) editor.dropAt(e.clientX, e.clientY, spec);
  }, [editor]);

  return { onDragOver, onDrop };
}
