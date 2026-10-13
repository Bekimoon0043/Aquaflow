// ProvenanceBadge.jsx — AF-NEXT-012 (Fixture data trust)
// Source / confidence badge for equipment data. Generic estimates always read
// "Generic estimate — verify with supplier datasheet"; they are never styled as
// a manufacturer specification.
import { provenanceBadge } from "../../data/fixtureProvenance";

const TONES = {
  verified: { color: "#4ade80", border: "#166534", bg: "#052e16" },
  measured: { color: "#38bdf8", border: "#075985", bg: "#082f49" },
  generic: { color: "#fbbf24", border: "#78350f", bg: "#1c1204" },
};

/** Accepts a provenance block, or a citation ({dataSource|data_source, confidence, ...}). */
export function toProvenanceLike(p) {
  if (!p) return null;
  if (p.source) return p;
  const source = p.dataSource || p.data_source;
  if (!source) return null;
  return {
    source, confidence: p.confidence, model: p.equipmentModel || p.equipment_model,
    manufacturer: p.manufacturer, revision: p.revision, date: "",
    document: { title: p.document || "" },
  };
}

export default function ProvenanceBadge({ provenance, compact = false, style }) {
  const b = provenanceBadge(toProvenanceLike(provenance));
  const t = TONES[b.tone] || TONES.generic;
  return (
    <span
      data-testid="provenance-badge"
      data-source={b.tone}
      title={b.title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 5px",
        borderRadius: 3, border: `1px solid ${t.border}`, background: t.bg, color: t.color,
        fontSize: 8, fontFamily: "monospace", whiteSpace: "nowrap", lineHeight: 1.4, ...style,
      }}
    >
      {compact ? b.short : b.label}
      {!compact && b.tone !== "generic" && <span style={{ opacity: 0.75 }}>· {b.confidence}</span>}
    </span>
  );
}

/** Citation block (model · source · units · revision) for calculation results. */
export function CitationLine({ citation, style }) {
  if (!citation) return null;
  const units = citation.units && typeof citation.units === "object"
    ? Object.entries(citation.units).map(([k, v]) => `${k} ${v}`).join(", ")
    : citation.unitsBasis || "";
  return (
    <div data-testid="citation-line" style={{ fontSize: 8, color: "#7a96aa", lineHeight: 1.5, ...style }}>
      <ProvenanceBadge provenance={citation} compact />{" "}
      {citation.equipmentModel || citation.equipment_model} · rev {citation.revision || "—"}
      {units ? ` · ${units}` : ""}
    </div>
  );
}
