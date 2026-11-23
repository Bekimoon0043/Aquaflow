import { useMemo, useState } from "react";
import ProvenanceBadge from "./ProvenanceBadge";
import { GENERIC_LABEL, isVerifiedProvenance } from "../../data/fixtureProvenance";

const PAGE_SIZE = 60;
export const FIXTURE_DRAG_MIME = "application/x-aquaflow-fixture";

export function fixtureToolForKey(key, fixtures = []) {
  const fixture = fixtures.find((entry) => entry.key === key);
  if (!fixture) return null;
  return ["nozzle", "light", "laser", "fireworks", "equipment"].find((tool) => fixtureMatchesTool(fixture, tool)) || null;
}

const isLaserProduct = (fixture, key) => String(fixture?.category || "") === "Laser" || key === "laser" || key.startsWith("laser_");
const isPyroProduct = (fixture, key) => String(fixture?.category || "").startsWith("Pyro") || key.startsWith("pyro_");

export function fixtureMatchesTool(fixture, tool) {
  const key = String(fixture?.key || "").toLowerCase();
  const laser = isLaserProduct(fixture, key), pyro = isPyroProduct(fixture, key);
  if (tool === "laser") return laser;
  if (tool === "fireworks") return pyro;
  if (laser || pyro) return false;
  if (tool === "nozzle") return key.startsWith("nozzle") || /jet|geyser|spray|mist|cascade/.test(key);
  if (tool === "light") return key.startsWith("light");
  if (tool === "equipment") return !fixtureMatchesTool(fixture, "nozzle") && !fixtureMatchesTool(fixture, "light");
  return false;
}

/** Laser and firework catalogues are long and alike, so they are browsed by family. */
export const browseByFamily = (tool) => tool === "laser" || tool === "fireworks";
const groupOf = (fixture, tool) => (browseByFamily(tool) ? fixture.family || fixture.category : fixture.category) || "Other";

export function filterFixtureLibrary(fixtures, { tool, query = "", category = "all" } = {}) {
  const q = query.trim().toLowerCase();
  return (fixtures || []).filter((fixture) => {
    if (!fixtureMatchesTool(fixture, tool)) return false;
    if (category !== "all" && groupOf(fixture, tool) !== category) return false;
    if (!q) return true;
    const hay = [fixture.label, fixture.key, fixture.category, fixture.manufacturer, fixture.family, fixture.model,
      ...(Array.isArray(fixture.tags) ? fixture.tags : [])];
    return hay.some((value) => String(value || "").toLowerCase().includes(q));
  });
}

export default function FixtureLibraryBrowser({ fixtures, tool, selectedKey, onSelect }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const toolFixtures = useMemo(() => (fixtures || []).filter((fixture) => fixtureMatchesTool(fixture, tool)), [fixtures, tool]);
  const byFamily = browseByFamily(tool);
  const categories = useMemo(
    () => [...new Set(toolFixtures.map((fixture) => groupOf(fixture, tool)))].sort(),
    [toolFixtures, tool]
  );
  const filtered = useMemo(() => {
    const list = filterFixtureLibrary(fixtures, { tool, query, category });
    // Families keep their catalogue order inside each group.
    if (!byFamily) return list;
    const order = [...new Set(list.map((f) => groupOf(f, tool)))];
    return [...list].sort((a, b) => order.indexOf(groupOf(a, tool)) - order.indexOf(groupOf(b, tool)));
  }, [fixtures, tool, query, category, byFamily]);
  const visible = filtered.slice(0, limit);
  // AF-NEXT-012 — trust summary for the list (library items without a verified
  // provenance are generic estimates and are labelled as such).
  const verifiedCount = filtered.filter((fixture) => isVerifiedProvenance(fixture.provenance)).length;

  return (
    <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--info)", fontSize: 11, marginBottom: 6 }}>
        <span>{tool === "laser" ? "LASER CATALOGUE" : tool === "fireworks" ? "FIREWORKS CATALOGUE" : "FIXTURE LIBRARY"}</span><span>{filtered.length}/{toolFixtures.length}</span>
      </div>
      <div style={{ color: "var(--info)", fontSize: 11, marginBottom: 6, lineHeight: 1.4 }}>Drag a model onto the plan, or click it and then click the plan. Select the placed part to edit its properties.</div>
      {filtered.length > verifiedCount && (
        <div data-testid="library-generic-note" style={{ color: "var(--warn)", fontSize: 11, marginBottom: 5, lineHeight: 1.4 }}>
          {verifiedCount === 0 ? "All items: " : `${filtered.length - verifiedCount} item(s): `}{GENERIC_LABEL}
        </div>
      )}
      <input
        aria-label="Search fixture library"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
        placeholder="Search model, type, manufacturer…"
        style={{ width: "100%", padding: "6px 7px", marginBottom: 5, background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid color-mix(in srgb, var(--info) 40%, var(--border))", borderRadius: 4, fontSize: 11 }}
      />
      <select
        aria-label="Fixture category"
        value={category}
        onChange={(event) => { setCategory(event.target.value); setLimit(PAGE_SIZE); }}
        style={{ width: "100%", padding: 5, marginBottom: 6, background: "var(--bg-base)", color: "var(--info)", border: "1px solid color-mix(in srgb, var(--info) 40%, var(--border))", borderRadius: 4, fontSize: 11 }}
      >
        <option value="all">{byFamily ? "All families" : "All categories"}</option>
        {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </select>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 240, overflowY: "auto" }}>
        {visible.map((fixture, index) => (<div key={fixture.key} style={{ display: "contents" }}>
          {byFamily && (index === 0 || groupOf(visible[index - 1], tool) !== groupOf(fixture, tool)) && (
            <div role="heading" aria-level={4} style={{ color: tool === "laser" ? "var(--violet)" : "var(--warn)", fontSize: 11, fontWeight: 800, letterSpacing: 0.5, margin: "4px 0 1px" }}>
              {groupOf(fixture, tool).toUpperCase()}
            </div>
          )}
          <button
            key={fixture.key}
            type="button"
            draggable
            title="Drag onto the pool plan, or click to select and then click the plan"
            aria-pressed={selectedKey === fixture.key}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(FIXTURE_DRAG_MIME, fixture.key);
              event.dataTransfer.setData("text/plain", fixture.key);
              onSelect(fixture.key);
            }}
            onClick={() => onSelect(fixture.key)}
            style={{
              display: "grid", gridTemplateColumns: "20px 1fr", gap: 6, alignItems: "center",
              width: "100%", padding: "6px 7px", textAlign: "left", cursor: "pointer",
              background: selectedKey === fixture.key ? "var(--bg-surface)" : "var(--bg-base)",
              color: selectedKey === fixture.key ? fixture.color : "var(--info)",
              border: `1px solid ${selectedKey === fixture.key ? fixture.color + "77" : "#123044"}`,
              borderRadius: 4, fontFamily: "monospace", fontSize: 11,
            }}
          >
            <span aria-hidden="true" style={{ color: fixture.color, fontSize: 13 }}>{fixture.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fixture.label}</span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 4, color: "var(--info)", fontSize: 11 }}>
                <span>{byFamily ? (fixture.summary || fixture.category || "Other") : (fixture.category || "Other")}</span>
                <ProvenanceBadge provenance={fixture.provenance} compact />
              </span>
              {selectedKey === fixture.key && (
                <span style={{ display: "block", marginTop: 3 }}><ProvenanceBadge provenance={fixture.provenance} /></span>
              )}
            </span>
          </button>
        </div>))}
        {!visible.length && <div style={{ padding: 12, color: "var(--text-muted)", textAlign: "center", fontSize: 11 }}>No matching fixtures.</div>}
      </div>
      {filtered.length > visible.length && (
        <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)}
          style={{ width: "100%", marginTop: 5, padding: 5, background: "var(--bg-panel)", color: "var(--info)", border: "1px solid color-mix(in srgb, var(--info) 40%, var(--border))", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
          Show more ({filtered.length - visible.length} remaining)
        </button>
      )}
    </div>
  );
}
