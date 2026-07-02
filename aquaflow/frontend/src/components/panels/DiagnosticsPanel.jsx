import { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../../config";

const API = API_BASE_URL;

const LEVEL_COLORS = {
  info:"#00aaff", warning:"#ffcc00", error:"#ff4444", critical:"#ff0000"
};
const CATEGORY_COLORS = {
  safety:"#ff6644", transport:"#00aaff", device:"#00ccaa",
  protocol:"#aa88ff", compiler:"#ffcc00", system:"#7ab"
};

export default function DiagnosticsPanel() {
  const [events,  setEvents]  = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter,  setFilter]  = useState({ level:"", category:"", search:"" });
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit:200 });
      if (filter.level)    params.set("level",    filter.level);
      if (filter.category) params.set("category", filter.category);
      const [evRes, sumRes] = await Promise.all([
        fetch(`${API}/diagnostics/events?${params}`),
        fetch(`${API}/diagnostics/summary`),
      ]);
      if (evRes.ok)  { const d = await evRes.json();  setEvents(d.events || []); }
      if (sumRes.ok) { setSummary(await sumRes.json()); }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter.level, filter.category]);
  useEffect(() => {
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [filter]);

  const filtered = filter.search
    ? events.filter(e => e.message?.toLowerCase().includes(filter.search.toLowerCase()) || e.source?.toLowerCase().includes(filter.search.toLowerCase()))
    : events;

  const exportCSV = () => {
    const rows = [["time","level","category","source","message"]];
    filtered.forEach(e => rows.push([
      new Date(e.timestamp*1000).toISOString(),
      e.level, e.category, e.source,
      `"${(e.message||"").replace(/"/g,'""')}"`
    ]));
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aquaflow-diagnostics-${Date.now()}.csv`;
    a.click();
  };

  const clearAll = async () => {
    await fetch(`${API}/diagnostics/clear`, { method:"DELETE" });
    setEvents([]); setSummary(null);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", display:"flex", alignItems:"center", gap:10, flexShrink:0, flexWrap:"wrap" }}>
        <span style={{ color:"#00aaff", fontSize:13, fontWeight:"bold" }}>DIAGNOSTICS</span>
        <div style={{ flex:1 }}/>
        <button onClick={load} style={smallBtn("#00aaff")}>↺ REFRESH</button>
        <button onClick={exportCSV} style={smallBtn("#00ccaa")}>↓ CSV</button>
        <button onClick={clearAll} style={smallBtn("#ff4444")}>✕ CLEAR</button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display:"flex", gap:6, padding:"8px 10px", borderBottom:"1px solid #0a2030", flexShrink:0, flexWrap:"wrap" }}>
          {[
            ["Total events",    summary.total_events,        "#7ab"],
            ["Last hour",       summary.last_hour,           "#00aaff"],
            ["Errors (1hr)",    summary.errors_last_hour,    summary.errors_last_hour > 0 ? "#ff4444" : "#00ff88"],
            ["Warnings (1hr)",  summary.warnings_last_hour,  summary.warnings_last_hour > 0 ? "#ffcc00" : "#00ff88"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ flex:"1 1 80px", padding:"5px 8px", background:"#050d18", border:"1px solid #0a2030", borderRadius:4 }}>
              <div style={{ color:"#334455", fontSize:8 }}>{label}</div>
              <div style={{ color, fontSize:16, fontWeight:"bold" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display:"flex", gap:6, padding:"6px 10px", borderBottom:"1px solid #0a2030", flexShrink:0, flexWrap:"wrap" }}>
        <input
          placeholder="Search messages..."
          value={filter.search}
          onChange={e => setFilter(f => ({...f, search:e.target.value}))}
          style={{ flex:"2 1 120px", padding:"3px 8px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}
        />
        <select value={filter.level} onChange={e => setFilter(f => ({...f, level:e.target.value}))}
          style={{ flex:"1 1 80px", padding:"3px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>
        <select value={filter.category} onChange={e => setFilter(f => ({...f, category:e.target.value}))}
          style={{ flex:"1 1 100px", padding:"3px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}>
          <option value="">All categories</option>
          <option value="safety">Safety</option>
          <option value="transport">Transport</option>
          <option value="device">Device</option>
          <option value="protocol">Protocol</option>
          <option value="compiler">Compiler</option>
          <option value="system">System</option>
        </select>
        <span style={{ color:"#334455", fontSize:9, alignSelf:"center" }}>{filtered.length} events</span>
      </div>

      {/* Event list */}
      <div style={{ flex:1, overflowY:"auto", padding:"6px 10px" }}>
        {loading && filtered.length === 0 && (
          <div style={{ color:"#334455", fontSize:10, textAlign:"center", padding:"20px 0" }}>Loading...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ color:"#334455", fontSize:10, textAlign:"center", padding:"20px 0" }}>No events match the current filters</div>
        )}
        {filtered.map((ev, i) => (
          <div key={ev.id || i} style={{
            display:"flex", gap:8, padding:"5px 8px", marginBottom:2,
            background:"#050d18", borderRadius:3,
            borderLeft:`2px solid ${LEVEL_COLORS[ev.level]||"#334455"}`,
          }}>
            <span style={{ color:"#334455", fontSize:9, whiteSpace:"nowrap", flexShrink:0 }}>
              {new Date((ev.timestamp||0)*1000).toLocaleTimeString()}
            </span>
            <span style={{
              fontSize:9, padding:"0 5px", borderRadius:2,
              background:`${LEVEL_COLORS[ev.level]||"#334455"}22`,
              color: LEVEL_COLORS[ev.level]||"#334455",
              flexShrink:0, alignSelf:"center",
            }}>{ev.level}</span>
            <span style={{
              fontSize:9, padding:"0 5px", borderRadius:2,
              background:`${CATEGORY_COLORS[ev.category]||"#334455"}22`,
              color: CATEGORY_COLORS[ev.category]||"#334455",
              flexShrink:0, alignSelf:"center",
            }}>{ev.category}</span>
            <span style={{ color:"#556677", fontSize:9, flexShrink:0 }}>{ev.source}</span>
            <span style={{ color:"#cce8ff", fontSize:10, flex:1 }}>{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function smallBtn(color) {
  return {
    padding:"3px 10px", background:"#0a1825", color,
    border:`1px solid ${color}44`, borderRadius:3,
    cursor:"pointer", fontFamily:"monospace", fontSize:10,
  };
}
