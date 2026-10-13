import { useMemo, useState } from "react";
import ProvenanceBadge from "./ProvenanceBadge";
import { GENERIC_LABEL, isVerifiedProvenance } from "../../data/fixtureProvenance";

const PAGE_SIZE = 60;

export function fixtureMatchesTool(fixture, tool) {
  const key = String(fixture?.key || "").toLowerCase();
  if (tool === "nozzle") return key.startsWith("nozzle") || /jet|geyser|spray|mist|cascade/.test(key);
  if (tool === "light") return key.startsWith("light") || key.startsWith("laser");
  if (tool === "equipment") return !fixtureMatchesTool(fixture, "nozzle") && !fixtureMatchesTool(fixture, "light");
  return false;
}

export function filterFixtureLibrary(fixtures, { tool, query = "", category = "all" } = {}) {
  const q = query.trim().toLowerCase();
  return (fixtures || []).filter((fixture) => {
    if (!fixtureMatchesTool(fixture, tool)) return false;
    if (category !== "all" && String(fixture.category || "Other") !== category) return false;
    if (!q) return true;
    return [fixture.label, fixture.key, fixture.category, fixture.manufacturer]
      .some((value) => String(value || "").toLowerCase().includes(q));
  });
}

export default function FixtureLibraryBrowser({ fixtures, tool, selectedKey, onSelect }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const toolFixtures = useMemo(() => (fixtures || []).filter((fixture) => fixtureMatchesTool(fixture, tool)), [fixtures, tool]);
  const categories = useMemo(
    () => [...new Set(toolFixtures.map((fixture) => fixture.category || "Other"))].sort(),
    [toolFixtures]
  );
  const filtered = useMemo(
    () => filterFixtureLibrary(fixtures, { tool, query, category }),
    [fixtures, tool, query, category]
  );
  const visible = filtered.slice(0, limit);
  // AF-NEXT-012 — trust summary for the list (library items without a verified
  // provenance are generic estimates and are labelled as such).
  const verifiedCount = filtered.filter((fixture) => isVerifiedProvenance(fixture.provenance)).length;

  return (
    <div style={{ padding: "8px 10px", borderBottom: "1px solid #0a2030" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#7a96aa", fontSize: 10, marginBottom: 6 }}>
        <span>FIXTURE LIBRARY</span><span>{filtered.length}/{toolFixtures.length}</span>
      </div>
      {filtered.length > verifiedCount && (
        <div data-testid="library-generic-note" style={{ color: "#fbbf24", fontSize: 9, marginBottom: 5, lineHeight: 1.4 }}>
          {verifiedCount === 0 ? "All items: " : `${filtered.length - verifiedCount} item(s): `}{GENERIC_LABEL}
        </div>
      )}
      <input
        aria-label="Search fixture library"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
        placeholder="Search model, type, manufacturer…"
        style={{ width: "100%", padding: "6px 7px", marginBottom: 5, background: "#06121c", color: "#cce8ff", border: "1px solid #16415a", borderRadius: 4, fontSize: 11 }}
      />
      <select
        aria-label="Fixture category"
        value={category}
        onChange={(event) => { setCategory(event.target.value); setLimit(PAGE_SIZE); }}
        style={{ width: "100%", padding: 5, marginBottom: 6, background: "#06121c", color: "#a9c4d6", border: "1px solid #16415a", borderRadius: 4, fontSize: 10 }}
      >
        <option value="all">All categories</option>
        {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
      </select>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 240, overflowY: "auto" }}>
        {visible.map((fixture) => (
          <button
            key={fixture.key}
            type="button"
            aria-pressed={selectedKey === fixture.key}
            onClick={() => onSelect(fixture.key)}
            style={{
              display: "grid", gridTemplateColumns: "20px 1fr", gap: 6, alignItems: "center",
              width: "100%", padding: "6px 7px", textAlign: "left", cursor: "pointer",
              background: selectedKey === fixture.key ? "#073146" : "#0a1825",
              color: selectedKey === fixture.key ? fixture.color : "#8aa4b5",
              border: `1px solid ${selectedKey === fixture.key ? fixture.color + "77" : "#123044"}`,
              borderRadius: 4, fontFamily: "monospace", fontSize: 10,
            }}
          >
            <span aria-hidden="true" style={{ color: fixture.color, fontSize: 13 }}>{fixture.icon}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fixture.label}</span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 4, color: "#587286", fontSize: 9 }}>
                <span>{fixture.category || "Other"}</span>
                <ProvenanceBadge provenance={fixture.provenance} compact />
              </span>
              {selectedKey === fixture.key && (
                <span style={{ display: "block", marginTop: 3 }}><ProvenanceBadge provenance={fixture.provenance} /></span>
              )}
            </span>
          </button>
        ))}
        {!visible.length && <div style={{ padding: 12, color: "#7890a0", textAlign: "center", fontSize: 10 }}>No matching fixtures.</div>}
      </div>
      {filtered.length > visible.length && (
        <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)}
          style={{ width: "100%", marginTop: 5, padding: 5, background: "#0a2535", color: "#8fc4dd", border: "1px solid #16415a", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>
          Show more ({filtered.length - visible.length} remaining)
        </button>
      )}
    </div>
  );
}
