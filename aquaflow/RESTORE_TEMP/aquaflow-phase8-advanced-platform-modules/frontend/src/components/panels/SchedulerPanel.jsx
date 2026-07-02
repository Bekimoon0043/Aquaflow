import { useState, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/scheduler`;
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAY_SHORT = ["M","T","W","T","F","S","S"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const CAL_TYPES = [
  { id: "blackout", label: "Blackout (Closed)", color: "#ef4444" },
  { id: "holiday",  label: "Public Holiday",   color: "#f59e0b" },
  { id: "special",  label: "Special Event",    color: "#8b5cf6" },
  { id: "custom",   label: "Custom Schedule",  color: "#10b981" },
];

export default function SchedulerPanel() {
  const [tab, setTab] = useState("slots");
  const { currentShow, addServerLog } = useShowStore();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch(`${API}/status`).then(r=>r.json()).then(setStatus).catch(()=>{});
  }, []);

  return (
    <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", background:"var(--bg-panel)" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 12px", height:36, background:"var(--bg-surface)", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
        <span style={{ fontSize:13 }}>⏰</span>
        <span style={{ fontFamily:"var(--font-display)", fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:"var(--text-secondary)", textTransform:"uppercase" }}>
          Operating Hours
        </span>
        {status && (
          <span style={{ marginLeft:"auto", fontSize:9, fontFamily:"var(--font-mono)", color: status.active_slot ? "var(--green)" : "var(--text-muted)" }}>
            {status.active_slot ? "● RUNNING" : "○ IDLE"} · {status.today_slots} slots today
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0 }}>
        {[["slots","Time Slots"],["today","Today"],["week","Week View"],["calendar","Calendar"],["settings","Settings"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex:1, padding:"7px 0", background:"transparent", border:"none",
            borderBottom: tab===key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab===key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily:"var(--font-body)", fontSize:9, fontWeight: tab===key ? 600 : 400,
            textTransform:"uppercase", letterSpacing:"0.05em", cursor:"pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {tab==="slots"    && <SlotsTab currentShow={currentShow} addServerLog={addServerLog} />}
        {tab==="today"    && <TodayTab />}
        {tab==="week"     && <WeekTab />}
        {tab==="calendar" && <CalendarTab addServerLog={addServerLog} />}
        {tab==="settings" && <SettingsTab addServerLog={addServerLog} />}
      </div>
    </div>
  );
}

// ── Time Slots Tab ─────────────────────────────────────────────────────────────
function SlotsTab({ currentShow, addServerLog }) {
  const [slots, setSlots] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [sunTimes, setSunTimes] = useState(null);
  const [form, setForm] = useState({
    name: "Evening Show",
    show_id: currentShow?.id || "show-001",
    show_name: currentShow?.name || "Main Show",
    start_time: "19:00",
    stop_time: "21:30",
    days: [],
    loop: true,
    fade_in: 3,
    fade_out: 5,
    color: "#c9a227",
    relative_to: "",
    relative_offset_min: 0,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSlots();
    fetch(`${API}/sun-times?lat=9.0&lon=38.7`).then(r=>r.json()).then(setSunTimes).catch(()=>{});
  }, []);

  const loadSlots = async () => {
    try {
      const res = await fetch(`${API}/slots`);
      const data = await res.json();
      setSlots(data.slots || []);
    } catch {}
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/slots`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setSlots(s => [...s, data]);
      setShowForm(false);
      addServerLog({ level:"info", msg:`Time slot created: ${form.name} ${form.start_time}–${form.stop_time}` });
    } catch {
      addServerLog({ level:"warn", msg:"Save failed — backend offline" });
    } finally { setSaving(false); }
  };

  const toggleSlot = async (slot) => {
    try {
      const res = await fetch(`${API}/slots/${slot.id}/toggle`, { method:"POST" });
      const data = await res.json();
      setSlots(list => list.map(s => s.id===slot.id ? {...s, active: data.active} : s));
    } catch {}
  };

  const deleteSlot = async (id) => {
    try {
      await fetch(`${API}/slots/${id}`, { method:"DELETE" });
      setSlots(s => s.filter(x => x.id!==id));
      addServerLog({ level:"info", msg:"Time slot deleted" });
    } catch {}
  };

  const toggleDay = (d) => setForm(f => ({ ...f, days: f.days.includes(d) ? f.days.filter(x=>x!==d) : [...f.days, d] }));

  // Preset templates
  const PRESETS = [
    { name:"Morning Session",  start:"07:00", stop:"10:00", days:[0,1,2,3,4],    color:"#f59e0b" },
    { name:"Lunch Show",       start:"12:00", stop:"14:00", days:[],             color:"#10b981" },
    { name:"Evening Show",     start:"18:30", stop:"21:00", days:[],             color:"#c9a227" },
    { name:"Grand Night Show", start:"21:00", stop:"23:00", days:[4,5],          color:"#8b5cf6" },
    { name:"Sunrise Show",     start:"06:00", stop:"08:00", days:[], relative_to:"sunrise", relative_offset_min:-15, color:"#f97316" },
    { name:"Sunset Show",      start:"18:00", stop:"20:00", days:[], relative_to:"sunset",  relative_offset_min:-30, color:"#ef4444" },
  ];

  return (
    <div style={{ padding:12 }}>
      {/* Sun times */}
      {sunTimes && (
        <div style={{ display:"flex", gap:16, padding:"7px 12px", background:"rgba(201,162,39,0.06)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>SUNRISE TODAY</div>
            <div style={{ fontSize:15, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:700 }}>{sunTimes.sunrise}</div>
          </div>
          <div>
            <div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>SUNSET TODAY</div>
            <div style={{ fontSize:15, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:700 }}>{sunTimes.sunset}</div>
          </div>
          <div style={{ marginLeft:"auto", fontSize:9, color:"var(--text-muted)", alignSelf:"center" }}>Addis Ababa</div>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{slots.length} TIME SLOTS</span>
        <button className="btn primary" onClick={() => setShowForm(!showForm)} style={{ fontSize:11, padding:"4px 12px" }}>
          {showForm ? "✕ Cancel" : "+ Add Slot"}
        </button>
      </div>

      {/* Add slot form */}
      {showForm && (
        <div style={{ padding:12, background:"var(--bg-surface)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", marginBottom:12, animation:"fade-in 0.15s ease" }}>
          {/* Presets */}
          <SectionLabel>Quick Presets</SectionLabel>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:12 }}>
            {PRESETS.map((p,i) => (
              <button key={i} className="btn" onClick={() => setForm(f=>({...f,...p}))}
                style={{ fontSize:10, padding:"4px 8px", justifyContent:"flex-start", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:p.color, flexShrink:0 }} />
                {p.name}
              </button>
            ))}
          </div>

          <SectionLabel>Session Name</SectionLabel>
          <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{ fontSize:12, marginBottom:10 }} />

          <SectionLabel>Show</SectionLabel>
          <input className="input" value={form.show_name} onChange={e=>setForm(f=>({...f,show_name:e.target.value}))} placeholder="Show name" style={{ fontSize:11, marginBottom:10 }} />

          <SectionLabel>Time</SectionLabel>
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:3 }}>START</div>
              <input className="input" type="time" value={form.start_time} onChange={e=>setForm(f=>({...f,start_time:e.target.value}))} style={{ fontSize:13, fontFamily:"var(--font-mono)" }} />
            </div>
            <div style={{ fontSize:16, color:"var(--text-muted)", marginTop:14 }}>→</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:3 }}>STOP</div>
              <input className="input" type="time" value={form.stop_time} onChange={e=>setForm(f=>({...f,stop_time:e.target.value}))} style={{ fontSize:13, fontFamily:"var(--font-mono)" }} />
            </div>
          </div>

          {/* Relative to sunrise/sunset */}
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {[["","Fixed time"],["sunrise","Relative to Sunrise"],["sunset","Relative to Sunset"]].map(([val,label]) => (
              <button key={val} onClick={() => setForm(f=>({...f,relative_to:val}))} style={{
                flex:1, padding:"4px 6px", borderRadius:"var(--radius-sm)", cursor:"pointer", fontSize:9,
                background: form.relative_to===val ? "rgba(201,162,39,0.12)" : "var(--bg-raised)",
                border:`1px solid ${form.relative_to===val ? "var(--accent)" : "var(--border)"}`,
                color: form.relative_to===val ? "var(--accent)" : "var(--text-muted)",
              }}>{label}</button>
            ))}
          </div>
          {form.relative_to && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{ fontSize:10, color:"var(--text-muted)" }}>Offset (min)</span>
              <input className="input" type="number" value={form.relative_offset_min}
                onChange={e=>setForm(f=>({...f,relative_offset_min:parseInt(e.target.value)}))}
                style={{ width:70, fontSize:11, fontFamily:"var(--font-mono)" }} />
              <span style={{ fontSize:10, color:"var(--text-muted)" }}>(negative = before)</span>
            </div>
          )}

          <SectionLabel>Active Days</SectionLabel>
          <div style={{ display:"flex", gap:4, marginBottom:4 }}>
            {DAY_NAMES.map((d,i) => (
              <button key={i} onClick={() => toggleDay(i)} style={{
                flex:1, padding:"6px 4px", borderRadius:"var(--radius-sm)", cursor:"pointer", fontSize:10,
                background: form.days.includes(i) ? "rgba(201,162,39,0.15)" : "var(--bg-raised)",
                border:`1px solid ${form.days.includes(i) ? "var(--accent)" : "var(--border)"}`,
                color: form.days.includes(i) ? "var(--accent)" : "var(--text-muted)",
              }}>{d}</button>
            ))}
          </div>
          <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:10 }}>
            {form.days.length === 0 ? "Every day (no days selected = runs daily)" : `${form.days.length} day(s) selected`}
          </div>

          <div style={{ display:"flex", gap:16, marginBottom:12 }}>
            <Toggle label="Loop show" value={form.loop} onChange={v=>setForm(f=>({...f,loop:v}))} />
          </div>

          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:3 }}>FADE IN (sec)</div>
              <input className="input" type="number" value={form.fade_in} onChange={e=>setForm(f=>({...f,fade_in:parseFloat(e.target.value)}))} style={{ fontSize:11, fontFamily:"var(--font-mono)" }} />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:"var(--text-muted)", marginBottom:3 }}>FADE OUT (sec)</div>
              <input className="input" type="number" value={form.fade_out} onChange={e=>setForm(f=>({...f,fade_out:parseFloat(e.target.value)}))} style={{ fontSize:11, fontFamily:"var(--font-mono)" }} />
            </div>
          </div>

          <input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notes (optional)" style={{ fontSize:11, marginBottom:10 }} />

          <button className="btn primary" onClick={save} disabled={saving}
            style={{ width:"100%", justifyContent:"center", fontSize:12, padding:"8px" }}>
            {saving ? "Saving..." : "⏰ Create Time Slot"}
          </button>
        </div>
      )}

      {/* Slot list */}
      {slots.length === 0 ? (
        <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text-muted)", fontSize:11 }}>
          No time slots yet.<br/>Click + Add Slot to create your operating schedule.
        </div>
      ) : (
        <div>
          <SectionLabel>Schedule ({slots.length} slots)</SectionLabel>
          {slots.map(slot => (
            <SlotCard key={slot.id} slot={slot} onToggle={() => toggleSlot(slot)} onDelete={() => deleteSlot(slot.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotCard({ slot, onToggle, onDelete }) {
  const daysLabel = slot.days?.length > 0
    ? DAY_NAMES.filter((_,i) => slot.days.includes(i)).join(", ")
    : "Every day";

  return (
    <div style={{ padding:"10px 12px", marginBottom:8, background:"var(--bg-surface)", border:`1px solid ${slot.active ? "var(--border-mid)" : "var(--border)"}`, borderRadius:"var(--radius-md)", borderLeft:`3px solid ${slot.active ? (slot.color||"var(--accent)") : "var(--border)"}`, opacity: slot.active ? 1 : 0.6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background: slot.active ? "var(--green)" : "var(--text-muted)", boxShadow: slot.active ? "0 0 5px var(--green)" : "none" }} />
        <span style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)", flex:1 }}>{slot.name}</span>
        <span style={{ fontSize:10, color:"var(--text-muted)" }}>{slot.show_name}</span>
      </div>

      {/* Time bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
        <span style={{ fontSize:16, fontFamily:"var(--font-mono)", fontWeight:700, color: slot.color||"var(--accent)" }}>{slot.start_time}</span>
        <div style={{ flex:1, height:3, background:"var(--border)", borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", background: slot.color||"var(--accent)", borderRadius:2, opacity:0.7,
            width: (() => {
              const [sh,sm] = (slot.start_time||"0:0").split(":").map(Number);
              const [eh,em] = (slot.stop_time||"0:0").split(":").map(Number);
              const start = sh*60+sm, end = eh*60+em+(end<start?1440:0);
              const duration = Math.max(0, end-start);
              return `${Math.min(100, duration/14.4)}%`;
            })()
          }} />
        </div>
        <span style={{ fontSize:16, fontFamily:"var(--font-mono)", fontWeight:700, color: slot.color||"var(--accent)" }}>{slot.stop_time}</span>
      </div>

      {/* Days */}
      <div style={{ display:"flex", gap:3, marginBottom:6 }}>
        {DAY_SHORT.map((d,i) => (
          <span key={i} style={{ width:20, height:18, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:3, fontSize:9, fontFamily:"var(--font-mono)",
            background: (slot.days?.length===0 || slot.days?.includes(i)) ? `${slot.color||"#c9a227"}22` : "var(--bg-raised)",
            color: (slot.days?.length===0 || slot.days?.includes(i)) ? (slot.color||"var(--accent)") : "var(--text-muted)",
            border: `1px solid ${(slot.days?.length===0 || slot.days?.includes(i)) ? `${slot.color||"#c9a227"}44` : "var(--border)"}`,
          }}>{d}</span>
        ))}
        {slot.relative_to && (
          <span style={{ fontSize:9, color:"var(--text-muted)", marginLeft:4, alignSelf:"center" }}>
            {slot.relative_to === "sunrise" ? "☀" : "◐"} {slot.relative_offset_min > 0 ? "+" : ""}{slot.relative_offset_min}min
          </span>
        )}
        {slot.loop && <span style={{ fontSize:9, color:"var(--text-muted)", marginLeft:"auto" }}>⟳ loop</span>}
        {slot.run_count > 0 && <span style={{ fontSize:9, color:"var(--text-muted)" }}>×{slot.run_count}</span>}
      </div>

      <div style={{ display:"flex", gap:5 }}>
        <button className="btn" onClick={onToggle} style={{ fontSize:9, padding:"2px 10px" }}>
          {slot.active ? "⏸ Pause" : "▶ Enable"}
        </button>
        <button className="btn danger" onClick={onDelete} style={{ fontSize:9, padding:"2px 8px", marginLeft:"auto" }}>✕</button>
      </div>
    </div>
  );
}

// ── Today Tab ──────────────────────────────────────────────────────────────────
function TodayTab() {
  const [schedule, setSchedule] = useState(null);
  const now = new Date();

  useEffect(() => {
    fetch(`${API}/today`).then(r=>r.json()).then(setSchedule).catch(() => {
      setSchedule({ date: new Date().toISOString().split("T")[0], weekday: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][new Date().getDay()===0?6:new Date().getDay()-1], blackout: false, slots: [] });
    });
  }, []);

  if (!schedule) return <div style={{ padding:20, color:"var(--text-muted)", fontSize:11, textAlign:"center" }}>Loading...</div>;

  return (
    <div style={{ padding:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, padding:"10px 12px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)" }}>
        <div>
          <div style={{ fontSize:24, fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--accent)" }}>
            {now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:false })}
          </div>
          <div style={{ fontSize:11, color:"var(--text-muted)" }}>
            {schedule.weekday}, {new Date(schedule.date).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" })}
          </div>
        </div>
        {schedule.blackout ? (
          <div style={{ marginLeft:"auto", padding:"4px 10px", background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:"var(--radius-sm)", color:"var(--red)", fontSize:11 }}>
            🚫 BLACKOUT — {schedule.special}
          </div>
        ) : schedule.special ? (
          <div style={{ marginLeft:"auto", padding:"4px 10px", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.3)", borderRadius:"var(--radius-sm)", color:"#8b5cf6", fontSize:11 }}>
            ✦ {schedule.special}
          </div>
        ) : null}
      </div>

      {schedule.blackout ? (
        <div style={{ textAlign:"center", padding:"20px", color:"var(--red)", fontSize:12 }}>Fountain closed today</div>
      ) : schedule.slots.length === 0 ? (
        <div style={{ textAlign:"center", padding:"20px", color:"var(--text-muted)", fontSize:11 }}>No sessions scheduled for today</div>
      ) : (
        <div>
          <SectionLabel>Today's Sessions ({schedule.slots.length})</SectionLabel>
          {/* 24-hour timeline */}
          <div style={{ position:"relative", height:60, background:"var(--bg-surface)", borderRadius:"var(--radius-md)", marginBottom:12, overflow:"hidden", border:"1px solid var(--border)" }}>
            {/* Hour marks */}
            {[6,9,12,15,18,21].map(h => (
              <div key={h} style={{ position:"absolute", left:`${(h/24)*100}%`, top:0, bottom:0, width:1, background:"var(--border)" }}>
                <span style={{ position:"absolute", bottom:2, left:2, fontSize:8, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>{h}h</span>
              </div>
            ))}
            {/* Slot bars */}
            {schedule.slots.map((slot,i) => {
              const [sh,sm] = slot.start_time.split(":").map(Number);
              const [eh,em] = slot.stop_time.split(":").map(Number);
              const startPct = ((sh*60+sm)/1440)*100;
              const endPct   = ((eh*60+em)/1440)*100;
              return (
                <div key={i} style={{ position:"absolute", left:`${startPct}%`, width:`${Math.max(2, endPct-startPct)}%`, top:8, height:28, background:(slot.color||"#c9a227")+"44", border:`1px solid ${slot.color||"#c9a227"}`, borderRadius:3, overflow:"hidden" }}>
                  <span style={{ fontSize:8, fontFamily:"var(--font-mono)", color:slot.color||"var(--accent)", padding:"2px 3px", whiteSpace:"nowrap" }}>{slot.name}</span>
                </div>
              );
            })}
            {/* Now indicator */}
            <div style={{ position:"absolute", left:`${((now.getHours()*60+now.getMinutes())/1440)*100}%`, top:0, bottom:0, width:2, background:"var(--red)", zIndex:10 }} />
          </div>

          {schedule.slots.map((slot,i) => {
            const [sh,sm] = slot.start_time.split(":").map(Number);
            const [eh,em] = slot.stop_time.split(":").map(Number);
            const nowMins = now.getHours()*60+now.getMinutes();
            const startMins = sh*60+sm, endMins = eh*60+em;
            const isActive = nowMins >= startMins && nowMins < endMins;
            const isPast   = nowMins >= endMins;
            return (
              <div key={i} style={{ display:"flex", gap:12, padding:"8px 12px", marginBottom:6, background: isActive ? "rgba(201,162,39,0.06)" : "var(--bg-surface)", border:`1px solid ${isActive ? "var(--border-accent)" : "var(--border)"}`, borderRadius:"var(--radius-md)", opacity: isPast ? 0.5 : 1, borderLeft:`3px solid ${slot.color||"var(--accent)"}` }}>
                <div style={{ textAlign:"center", minWidth:50 }}>
                  <div style={{ fontSize:14, fontFamily:"var(--font-mono)", fontWeight:700, color: slot.color||"var(--accent)" }}>{slot.start_time}</div>
                  <div style={{ fontSize:9, color:"var(--text-muted)" }}>to {slot.stop_time}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)" }}>{slot.name}</div>
                  <div style={{ fontSize:10, color:"var(--text-muted)" }}>{slot.show_name}</div>
                </div>
                {isActive && <div style={{ alignSelf:"center", fontSize:10, color:"var(--green)", fontFamily:"var(--font-mono)" }}>● ACTIVE</div>}
                {isPast   && <div style={{ alignSelf:"center", fontSize:10, color:"var(--text-muted)" }}>✓ Done</div>}
                {!isActive && !isPast && (
                  <div style={{ alignSelf:"center", fontSize:10, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
                    in {startMins-nowMins}m
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Week View Tab ──────────────────────────────────────────────────────────────
function WeekTab() {
  const [week, setWeek] = useState([]);

  useEffect(() => {
    fetch(`${API}/week`).then(r=>r.json()).then(d=>setWeek(d.week||[])).catch(() => {
      const days = [];
      for (let i=0;i<7;i++) {
        const d = new Date(); d.setDate(d.getDate()+i);
        days.push({ date:d.toISOString().split("T")[0], weekday:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][d.getDay()===0?6:d.getDay()-1], blackout:false, slots:[] });
      }
      setWeek(days);
    });
  }, []);

  return (
    <div style={{ padding:12 }}>
      <SectionLabel>7-Day Schedule Overview</SectionLabel>
      {week.map((day, i) => {
        const isToday = i === 0;
        const d = new Date(day.date);
        return (
          <div key={day.date} style={{ marginBottom:8, background:"var(--bg-surface)", border:`1px solid ${isToday ? "var(--border-accent)" : "var(--border)"}`, borderRadius:"var(--radius-md)", overflow:"hidden" }}>
            {/* Day header */}
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 12px", background: isToday ? "rgba(201,162,39,0.06)" : "transparent", borderBottom: day.slots.length > 0 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontSize:12, fontWeight:600, color: isToday ? "var(--accent)" : "var(--text-primary)", minWidth:32 }}>{day.weekday}</span>
              <span style={{ fontSize:10, color:"var(--text-muted)" }}>{d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
              {isToday && <span style={{ fontSize:9, color:"var(--accent)", fontFamily:"var(--font-mono)" }}>TODAY</span>}
              {day.blackout && <span style={{ marginLeft:"auto", fontSize:9, color:"var(--red)" }}>🚫 {day.special}</span>}
              {!day.blackout && <span style={{ marginLeft:"auto", fontSize:10, color:"var(--text-muted)" }}>{day.slots.length} session{day.slots.length!==1?"s":""}</span>}
            </div>
            {/* Slots */}
            {!day.blackout && day.slots.map((slot,j) => (
              <div key={j} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 12px 5px 20px", borderBottom: j<day.slots.length-1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:slot.color||"var(--accent)", flexShrink:0 }} />
                <span style={{ fontSize:11, color:"var(--text-primary)", flex:1 }}>{slot.name}</span>
                <span style={{ fontSize:11, fontFamily:"var(--font-mono)", color:slot.color||"var(--accent)" }}>{slot.start_time}–{slot.stop_time}</span>
              </div>
            ))}
            {!day.blackout && day.slots.length === 0 && (
              <div style={{ padding:"5px 12px", fontSize:10, color:"var(--text-muted)" }}>No sessions</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Calendar Tab ───────────────────────────────────────────────────────────────
function CalendarTab({ addServerLog }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [calDays, setCalDays] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ type:"blackout", label:"", notes:"", color:"#ef4444" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadMonth(); }, [year, month]);

  const loadMonth = async () => {
    try {
      const res = await fetch(`${API}/calendar/${year}/${month+1}`);
      const data = await res.json();
      setCalDays(data.days||[]);
    } catch {}
  };

  const firstDay = new Date(year, month, 1).getDay();
  const adjustedFirst = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const getCalDay = (day) => {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return calDays.find(d => d.date === dateStr);
  };

  const saveCalDay = async () => {
    if (!selected || !form.label) return;
    setSaving(true);
    try {
      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(selected).padStart(2,"0")}`;
      const res = await fetch(`${API}/calendar`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ date:dateStr, ...form }),
      });
      const data = await res.json();
      setCalDays(d => [...d.filter(x=>x.date!==dateStr), data]);
      setSelected(null);
      addServerLog({ level:"info", msg:`Calendar: ${dateStr} marked as ${form.type}` });
    } catch {}
    setSaving(false);
  };

  const deleteCalDay = async (day) => {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    try {
      await fetch(`${API}/calendar/${dateStr}`, { method:"DELETE" });
      setCalDays(d => d.filter(x=>x.date!==dateStr));
    } catch {}
  };

  const prevMonth = () => { if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); };
  const nextMonth = () => { if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); };

  return (
    <div style={{ padding:12 }}>
      {/* Month navigation */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <button className="btn icon-btn" onClick={prevMonth}>‹</button>
        <span style={{ flex:1, textAlign:"center", fontSize:13, fontWeight:600, color:"var(--text-primary)" }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button className="btn icon-btn" onClick={nextMonth}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
        {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d => (
          <div key={d} style={{ textAlign:"center", fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)", padding:"2px 0" }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:12 }}>
        {Array.from({length:adjustedFirst}).map((_,i) => <div key={`e${i}`} />)}
        {Array.from({length:daysInMonth}).map((_,i) => {
          const day = i+1;
          const isToday = year===today.getFullYear() && month===today.getMonth() && day===today.getDate();
          const calDay = getCalDay(day);
          const isPast = new Date(year,month,day) < new Date(today.getFullYear(),today.getMonth(),today.getDate());
          return (
            <div key={day} onClick={() => setSelected(selected===day ? null : day)} style={{
              aspectRatio:"1", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              borderRadius:"var(--radius-sm)", fontSize:11, cursor:"pointer",
              background: calDay ? `${calDay.color}22` : isToday ? "rgba(201,162,39,0.1)" : "transparent",
              border: `1px solid ${isToday ? "var(--accent)" : calDay ? calDay.color+"55" : selected===day ? "var(--border-accent)" : "transparent"}`,
              color: isPast ? "var(--text-muted)" : isToday ? "var(--accent)" : "var(--text-secondary)",
              opacity: isPast ? 0.5 : 1,
            }}>
              {day}
              {calDay && <div style={{ width:4, height:4, borderRadius:"50%", background:calDay.color, marginTop:1 }} />}
            </div>
          );
        })}
      </div>

      {/* Selected day editor */}
      {selected && (
        <div style={{ padding:"10px 12px", background:"var(--bg-surface)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)", animation:"fade-in 0.15s ease" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)", marginBottom:8 }}>
            {MONTH_NAMES[month]} {selected}, {year}
          </div>
          {getCalDay(selected) ? (
            <div>
              <div style={{ fontSize:11, color:"var(--text-secondary)", marginBottom:8 }}>
                Marked as: <strong style={{ color: getCalDay(selected).color }}>{getCalDay(selected).type}</strong> — {getCalDay(selected).label}
              </div>
              <button className="btn danger" onClick={() => deleteCalDay(selected)} style={{ fontSize:10 }}>Remove Override</button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                {CAL_TYPES.map(t => (
                  <button key={t.id} onClick={() => setForm(f=>({...f,type:t.id,color:t.color}))} style={{
                    padding:"5px 8px", borderRadius:"var(--radius-sm)", cursor:"pointer", fontSize:10,
                    background: form.type===t.id ? `${t.color}15` : "var(--bg-raised)",
                    border:`1px solid ${form.type===t.id ? t.color : "var(--border)"}`,
                    color: form.type===t.id ? t.color : "var(--text-muted)", textAlign:"left",
                  }}>{t.label}</button>
                ))}
              </div>
              <input className="input" value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))}
                placeholder="Label (e.g. Ethiopian Christmas)" style={{ fontSize:11 }} />
              <button className="btn primary" onClick={saveCalDay} disabled={saving||!form.label}
                style={{ justifyContent:"center", fontSize:11 }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:8 }}>
        {CAL_TYPES.map(t => (
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:t.color }} />
            <span style={{ fontSize:9, color:"var(--text-muted)" }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings Tab ───────────────────────────────────────────────────────────────
function SettingsTab({ addServerLog }) {
  const [lat, setLat] = useState("9.0");
  const [lon, setLon] = useState("38.7");
  const [sunTimes, setSunTimes] = useState(null);

  const updateLocation = async () => {
    try {
      const res = await fetch(`${API}/location`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ lat:parseFloat(lat), lon:parseFloat(lon) }),
      });
      const data = await res.json();
      setSunTimes(data.sun_times);
      addServerLog({ level:"info", msg:`Location updated: ${lat}°N, ${lon}°E` });
    } catch {
      setSunTimes({ sunrise:"06:15", sunset:"18:45" });
    }
  };

  return (
    <div style={{ padding:12 }}>
      <SectionLabel>Location Settings</SectionLabel>
      <div style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6, marginBottom:10 }}>
        Used for accurate sunrise/sunset calculations and weather checks.
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
        <FieldRow label="Latitude"><input className="input" value={lat} onChange={e=>setLat(e.target.value)} style={{ fontSize:11, fontFamily:"var(--font-mono)" }} /></FieldRow>
        <FieldRow label="Longitude"><input className="input" value={lon} onChange={e=>setLon(e.target.value)} style={{ fontSize:11, fontFamily:"var(--font-mono)" }} /></FieldRow>
        <div style={{ fontSize:9, color:"var(--text-muted)", paddingLeft:70 }}>Addis Ababa: 9.0°N, 38.7°E</div>
      </div>
      <button className="btn primary" onClick={updateLocation} style={{ width:"100%", justifyContent:"center", fontSize:11, marginBottom:12 }}>
        ☀ Update Location & Sun Times
      </button>
      {sunTimes && (
        <div style={{ display:"flex", gap:16, padding:"10px 14px", background:"rgba(201,162,39,0.06)", border:"1px solid var(--border-accent)", borderRadius:"var(--radius-md)" }}>
          <div><div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>SUNRISE</div><div style={{ fontSize:18, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:700 }}>{sunTimes.sunrise}</div></div>
          <div><div style={{ fontSize:9, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>SUNSET</div><div style={{ fontSize:18, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:700 }}>{sunTimes.sunset}</div></div>
        </div>
      )}

      <SectionLabel>How It Works</SectionLabel>
      {[
        "Create time slots with start/stop times and select which days they run",
        "Leave days empty to run every day, or select specific days of the week",
        "Mark dates on the calendar as blackout (closed), holidays, or special events",
        "Sunrise/sunset slots automatically adjust daily based on your location",
        "The engine checks every 20 seconds and starts/stops shows automatically",
        "Shows fade in and fade out smoothly at the configured durations",
      ].map((s,i) => (
        <div key={i} style={{ display:"flex", gap:8, padding:"4px 0", fontSize:10, color:"var(--text-secondary)" }}>
          <span style={{ color:"var(--accent)" }}>{i+1}.</span> {s}
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize:9, fontWeight:600, fontFamily:"var(--font-mono)", color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:7, marginTop:12, borderBottom:"1px solid var(--border)", paddingBottom:3 }}>{children}</div>;
}
function FieldRow({ label, children }) {
  return <div style={{ display:"flex", alignItems:"center", gap:8 }}><span style={{ fontSize:10, color:"var(--text-muted)", width:65, flexShrink:0, textAlign:"right", fontFamily:"var(--font-mono)" }}>{label}</span><div style={{ flex:1 }}>{children}</div></div>;
}
function Toggle({ label, value, onChange }) {
  return <div style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }} onClick={() => onChange(!value)}><div style={{ width:30, height:15, borderRadius:8, background: value ? "rgba(201,162,39,0.2)" : "var(--bg-raised)", border:`1px solid ${value ? "var(--accent)" : "var(--border)"}`, position:"relative", transition:"all 0.15s", flexShrink:0 }}><div style={{ width:9, height:9, borderRadius:"50%", background: value ? "var(--accent)" : "var(--text-muted)", position:"absolute", top:2, left: value ? 17 : 2, transition:"left 0.15s" }} /></div><span style={{ fontSize:10, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span></div>;
}
