// DocumentationPanel.jsx — AquaFlow Documentation Center (AQ-S4-006)
//
// Bundled, fully-offline help center: search the docs, browse by category, and read
// articles — all client-side (no network). Opens context-sensitively to the help for
// the panel the user was last on.
import { useMemo, useState } from "react";
import { ARTICLES, CATEGORIES } from "../../docs/articles";
import { search, contextHelp, getArticle, OFFLINE_AVAILABLE } from "../../docs/search";
import { getHelpContext } from "../../docs/helpContext";
import { usePanelAction } from "../../workspaces/navigation"; // AF-NEXT-014

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const CONTEXT_LABEL = {
  nodes: "Design", devices: "Devices", plc: "PLC", safety: "Safety", operator: "Operator",
  wind: "Wind Drift", validation: "Live Validation", dependencies: "Dependencies",
  engtools: "Engineering Tools", show_programmer: "Show Programmer", academy: "Training",
  preview: "3D Preview", audio: "Audio", ai: "AI",
};

export default function DocumentationPanel() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [category, setCategory] = useState(null);
  const helpCtx = getHelpContext();
  const [ctx, setCtx] = useState(helpCtx);
  // AF-NEXT-014: guidance links open a procedure article directly.
  usePanelAction("docs", ({ action, detail }) => {
    if (action === "article" && getArticle(detail?.articleId)) { setQuery(""); setSelectedId(detail.articleId); }
  });

  const results = useMemo(() => (query.trim() ? search(query) : []), [query]);
  const ctxHelp = useMemo(() => contextHelp(ctx), [ctx]);
  const article = selectedId ? getArticle(selectedId) : null;

  const byCategory = useMemo(() => {
    const list = category ? ARTICLES.filter((a) => a.category === category) : ARTICLES;
    return list;
  }, [category]);

  const contexts = [...new Set(ARTICLES.flatMap((a) => a.context))].sort();

  const open = (id) => { setSelectedId(id); };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>📚</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Documentation Center
        </span>
        <span style={{ marginLeft: "auto", fontSize: 9, color: OFFLINE_AVAILABLE ? "#22c55e" : "var(--text-muted)" }}>
          ● Offline ready · {ARTICLES.length} articles
        </span>
      </div>

      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
          placeholder="Search the documentation…"
          style={{ ...box, width: "100%", padding: "7px 10px", fontSize: 12, color: "var(--text-primary)" }} />
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* left: results / browse / context help */}
        <div style={{ width: 230, borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0, padding: 8 }}>
          {query.trim() ? (
            <>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>
                {results.length} result{results.length === 1 ? "" : "s"}</div>
              {results.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No matches.</div>}
              {results.map((r) => (
                <div key={r.id} onClick={() => open(r.id)} style={{ ...box, padding: 8, marginBottom: 5,
                  cursor: "pointer", borderColor: selectedId === r.id ? "var(--accent)" : "var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{r.title}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>{r.category}</div>
                  <div style={{ fontSize: 9.5, color: "var(--text-secondary)", marginTop: 3 }}>{r.snippet}</div>
                </div>
              ))}
            </>
          ) : (
            <>
              {ctxHelp.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: "var(--accent)", marginBottom: 4 }}>
                    HELP FOR {CONTEXT_LABEL[ctx]?.toUpperCase() || ctx.toUpperCase()}
                  </div>
                  {ctxHelp.map((h) => (
                    <div key={h.id} onClick={() => open(h.id)} style={{ ...box, padding: "6px 8px", marginBottom: 4,
                      cursor: "pointer", borderLeft: "3px solid var(--accent)" }}>
                      <span style={{ fontSize: 11 }}>{h.title}</span>
                    </div>
                  ))}
                </div>
              )}
              <select value={ctx || ""} onChange={(e) => setCtx(e.target.value)}
                style={{ ...box, width: "100%", padding: 5, fontSize: 10, color: "var(--text-primary)", marginBottom: 8 }}>
                <option value="">Context help for…</option>
                {contexts.map((c) => <option key={c} value={c}>{CONTEXT_LABEL[c] || c}</option>)}
              </select>

              <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>BROWSE</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                <span onClick={() => setCategory(null)} style={{ fontSize: 9, cursor: "pointer",
                  color: !category ? "var(--accent)" : "var(--text-muted)" }}>All</span>
                {CATEGORIES.map((c) => (
                  <span key={c} onClick={() => setCategory(c)} style={{ fontSize: 9, cursor: "pointer",
                    color: category === c ? "var(--accent)" : "var(--text-muted)" }}>· {c}</span>
                ))}
              </div>
              {byCategory.map((art) => (
                <div key={art.id} onClick={() => open(art.id)} style={{ padding: "5px 6px", cursor: "pointer",
                  fontSize: 11, borderRadius: 4,
                  background: selectedId === art.id ? "var(--bg-surface)" : "transparent",
                  color: selectedId === art.id ? "var(--text-accent)" : "var(--text-primary)" }}>
                  {art.title}
                </div>
              ))}
            </>
          )}
        </div>

        {/* right: article viewer */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {!article ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Search or select an article to read it. All documentation is bundled and works offline.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 9, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {article.category}</div>
              <h2 style={{ fontSize: 18, margin: "4px 0 10px", color: "var(--text-primary)" }}>{article.title}</h2>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)" }}>{article.body}</p>
              <div style={{ marginTop: 14, display: "flex", gap: 5, flexWrap: "wrap" }}>
                {article.tags.map((t) => (
                  <span key={t} style={{ ...box, padding: "2px 7px", fontSize: 9, color: "var(--text-muted)" }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
