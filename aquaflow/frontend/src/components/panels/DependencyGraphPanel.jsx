// DependencyGraphPanel.jsx — AquaFlow Equipment Dependency Graph (AQ-X-008)
//
// Visual representation of the equipment dependency graph: fixtures, their control
// groups and controllers (PLC hosts / DMX universes), and the dependencies between
// them — with dependency conflicts highlighted. Consumes the designed engineering
// fixtures and renders an SVG the operator can read at a glance.
import { useMemo } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import { buildDependencyGraph, layoutGraph } from "../../dependency/dependencyGraph";

const KIND_STYLE = {
  fixture:  { fill: "#0e2a3a", stroke: "#00d4ff", label: "Fixture" },
  group:    { fill: "#241a3a", stroke: "#8b5cf6", label: "Group" },
  plc:      { fill: "#3a2a10", stroke: "#f59e0b", label: "PLC host" },
  universe: { fill: "#10321f", stroke: "#22c55e", label: "DMX universe" },
};
const EDGE_COLOR = { member_of: "#8b5cf6", controlled_by: "#f59e0b", depends_on: "#00d4ff" };
const SEVERITY_COLOR = { critical: "#ef4444", warning: "#f59e0b" };
const NODE_W = 108;
const NODE_H = 40;

export default function DependencyGraphPanel() {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];

  const laid = useMemo(() => layoutGraph(buildDependencyGraph(fixtures)), [fixtures]);
  const posById = useMemo(() => Object.fromEntries(laid.nodes.map((n) => [n.id, n])), [laid]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🕸</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Equipment Dependencies
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>
          {laid.stats.fixtureCount} fixtures · {laid.stats.controllerCount} controllers ·{" "}
          <span style={{ color: laid.stats.conflictCount ? SEVERITY_COLOR.critical : "var(--text-muted)" }}>
            {laid.stats.conflictCount} conflict{laid.stats.conflictCount === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      {fixtures.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)", fontSize: 12 }}>
          No engineering fixtures yet — design a system to see its dependency graph.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <svg width="100%" viewBox={`0 0 ${laid.width} ${laid.height}`} role="img"
            aria-label="Equipment dependency graph"
            style={{ display: "block", minHeight: laid.height }}>
            {/* edges */}
            {laid.edges.map((e, i) => {
              const a = posById[e.from];
              const b = posById[e.to];
              if (!a || !b) return null;
              return (
                <line key={i} x1={a.x} y1={a.y + NODE_H / 2} x2={b.x} y2={b.y - NODE_H / 2}
                  stroke={EDGE_COLOR[e.kind] || "#555"} strokeWidth={1.2} opacity={0.5}
                  strokeDasharray={e.kind === "depends_on" ? "4 3" : undefined} />
              );
            })}
            {/* nodes */}
            {laid.nodes.map((n) => {
              const s = KIND_STYLE[n.kind] || KIND_STYLE.fixture;
              return (
                <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}>
                  <rect width={NODE_W} height={NODE_H} rx={7}
                    fill={s.fill} stroke={n.hasConflict ? SEVERITY_COLOR.critical : s.stroke}
                    strokeWidth={n.hasConflict ? 2.5 : 1.4} />
                  <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle"
                    fontSize={10} fill="#e5e7eb"
                    style={{ fontFamily: "var(--font-body)" }}>
                    {n.label.length > 15 ? n.label.slice(0, 14) + "…" : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* legend + conflicts */}
      <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)",
        padding: "8px 12px", flexShrink: 0, maxHeight: "38%", overflow: "auto" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          {Object.entries(KIND_STYLE).map(([k, s]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9,
              color: "var(--text-muted)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.fill,
                border: `1.5px solid ${s.stroke}` }} />
              {s.label}
            </span>
          ))}
        </div>
        {laid.conflicts.length === 0 ? (
          <div style={{ fontSize: 10, color: "#22c55e" }}>✓ No dependency conflicts.</div>
        ) : (
          laid.conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 10, color: "var(--text-secondary)", padding: "2px 0" }}>
              <span style={{ color: SEVERITY_COLOR[c.severity] || "#aaa", fontWeight: 600 }}>
                {c.severity === "critical" ? "⛔" : "⚠"} {c.type.replace(/_/g, " ")}
              </span>{" "}
              — {c.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
