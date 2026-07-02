import { useState, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = API_BASE_URL;

const PRESET_CATEGORIES = [
  { key:"clip",   label:"Clip Presets",   icon:"◈", color:"#00aaff" },
  { key:"scene",  label:"Scene Banks",    icon:"⬡", color:"#ffcc00" },
  { key:"device", label:"Device Presets", icon:"⚙", color:"#00ccaa" },
  { key:"show",   label:"Show Templates", icon:"★", color:"#aa88ff" },
];

const BUILTIN_PRESETS = {
  clip: [
    { id:"p-c-001", name:"Gentle Wave",      tags:["calm","water"],    values:{ pump:0.3, valve:0.4, lighting:0.5, fog:0.2 } },
    { id:"p-c-002", name:"Grand Finale",     tags:["dramatic","peak"], values:{ pump:1.0, valve:1.0, lighting:1.0, flame:0.5 } },
    { id:"p-c-003", name:"Night Glow",       tags:["night","ambient"], values:{ pump:0.2, lighting:0.8, fog:0.6 } },
    { id:"p-c-004", name:"Power Surge",      tags:["energetic","peak"],values:{ pump:0.9, valve:0.8, lighting:0.9 } },
    { id:"p-c-005", name:"Mist Curtain",     tags:["fog","ambient"],   values:{ pump:0.1, fog:1.0, lighting:0.4 } },
    { id:"p-c-006", name:"Cascade Fall",     tags:["water","calm"],    values:{ pump:0.5, valve:0.6, lighting:0.3 } },
    { id:"p-c-007", name:"Laser Show",       tags:["dramatic","laser"],values:{ pump:0.3, laser:0.9, lighting:0.7 } },
    { id:"p-c-008", name:"Flame Dance",      tags:["flame","dramatic"],values:{ pump:0.4, flame:0.7, lighting:0.6 } },
  ],
  scene: [
    { id:"p-s-001", name:"Opening Ceremony", tags:["ceremony","grand"],  duration:120000 },
    { id:"p-s-002", name:"Ambient Idle",      tags:["ambient","calm"],   duration:60000 },
    { id:"p-s-003", name:"Closing Show",      tags:["dramatic","finale"],duration:180000 },
    { id:"p-s-004", name:"VIP Arrival",       tags:["elegant","peak"],   duration:90000 },
  ],
  device: [
    { id:"p-d-001", name:"Pump Full",    tags:["pump"],    values:{ speed:100 } },
    { id:"p-d-002", name:"Pump Half",    tags:["pump"],    values:{ speed:50 } },
    { id:"p-d-003", name:"RGB Cool",     tags:["lighting"],values:{ r:0, g:180, b:255 } },
    { id:"p-d-004", name:"RGB Warm",     tags:["lighting"],values:{ r:255, g:140, b:0 } },
    { id:"p-d-005", name:"RGB White",    tags:["lighting"],values:{ r:255, g:255, b:255 } },
  ],
  show: [
    { id:"p-t-001", name:"Wedding Show",    tags:["elegant","romantic"], tracks:4 },
    { id:"p-t-002", name:"Corporate Event", tags:["professional"],        tracks:3 },
    { id:"p-t-003", name:"Music Festival",  tags:["energetic","music"],   tracks:6 },
  ],
};

export default function PresetBrowser() {
  const [category, setCategory]         = useState("clip");
  const [search, setSearch]             = useState("");
  const [userPresets, setUserPresets]   = useState({clip:[],scene:[],device:[],show:[]});
  const [saving, setSaving]             = useState(false);
  const [saveName, setSaveName]         = useState("");
  const [selectedPreset, setSelected]   = useState(null);
  const [notification, setNotification] = useState(null);

  const currentShow = useShowStore(s => s.currentShow);
  const tracks      = useShowStore(s => s.timelineTracks || s.tracks || []);

  const notify = (msg, type="ok") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 2500);
  };

  const allPresets = [
    ...(BUILTIN_PRESETS[category] || []),
    ...(userPresets[category] || []),
  ];

  const filtered = search
    ? allPresets.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.tags||[]).some(t => t.includes(search.toLowerCase()))
      )
    : allPresets;

  const applyPreset = (preset) => {
    setSelected(preset.id);
    notify(`Applied: ${preset.name}`);
    // In a full implementation this would apply values to selected clip
  };

  const saveCurrentAsPreset = async () => {
    if (!saveName.trim()) return;
    const preset = {
      id: `user-${Date.now()}`,
      name: saveName.trim(),
      tags: ["user", "custom"],
      values: { pump:0.5, valve:0.5, lighting:0.5 }, // Would use actual selected clip values
      created_at: Date.now(),
      user: true,
    };
    setUserPresets(prev => ({
      ...prev,
      [category]: [...(prev[category]||[]), preset]
    }));
    setSaveName("");
    setSaving(false);
    notify(`Preset "${preset.name}" saved`);
  };

  const deleteUserPreset = (id) => {
    setUserPresets(prev => ({
      ...prev,
      [category]: (prev[category]||[]).filter(p => p.id !== id)
    }));
    notify("Preset deleted", "warn");
  };

  const cat = PRESET_CATEGORIES.find(c => c.key === category);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#040810", color:"#cce8ff", fontFamily:"monospace", fontSize:"11px" }}>

      {/* Header */}
      <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#030608", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ color:"#aa88ff", fontWeight:"bold", fontSize:12 }}>★ PRESET BROWSER</span>
        <div style={{ flex:1 }}/>
        {notification && (
          <span style={{ fontSize:10, color: notification.type==="ok" ? "#00ff88" : "#ffcc00", padding:"2px 8px", background:"#0a1520", borderRadius:3 }}>
            {notification.msg}
          </span>
        )}
        <button onClick={()=>setSaving(!saving)} style={{
          padding:"3px 8px", background:"#0a1520", color:"#aa88ff",
          border:"1px solid #aa88ff44", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10,
        }}>+ SAVE CURRENT</button>
      </div>

      {/* Save form */}
      {saving && (
        <div style={{ padding:"8px 12px", borderBottom:"1px solid #0a2030", background:"#050d18", display:"flex", gap:6, flexShrink:0 }}>
          <input value={saveName} onChange={e=>setSaveName(e.target.value)}
            placeholder={`Name this ${category} preset...`}
            style={{ flex:1, padding:"4px 8px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}
            onKeyDown={e=>{ if(e.key==="Enter") saveCurrentAsPreset(); }}
          />
          <button onClick={saveCurrentAsPreset} style={{ padding:"4px 10px", background:"#003520", color:"#00ff88", border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10 }}>SAVE</button>
          <button onClick={()=>setSaving(false)} style={{ padding:"4px 8px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:10 }}>✕</button>
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid #0a2030", background:"#030608", flexShrink:0 }}>
        {PRESET_CATEGORIES.map(c => (
          <button key={c.key} onClick={()=>setCategory(c.key)} style={{
            flex:1, padding:"6px 0", background:"transparent", border:"none",
            borderBottom: category===c.key ? `2px solid ${c.color}` : "2px solid transparent",
            color: category===c.key ? c.color : "#334455",
            fontFamily:"monospace", fontSize:9, cursor:"pointer",
            textTransform:"uppercase", letterSpacing:"0.05em",
          }}>{c.icon} {c.label.split(" ")[0]}</button>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding:"6px 10px", borderBottom:"1px solid #0a2030", flexShrink:0 }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder={`Search ${category} presets...`}
          style={{ width:"100%", padding:"4px 8px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontFamily:"monospace", fontSize:10 }}
        />
      </div>

      {/* Preset grid */}
      <div style={{ flex:1, overflowY:"auto", padding:8 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          {filtered.map(preset => (
            <div key={preset.id} onClick={()=>applyPreset(preset)} style={{
              padding:"8px 10px", background:"#050d18",
              border:`1px solid ${selectedPreset===preset.id ? `${cat.color}88` : "#0a2030"}`,
              borderRadius:5, cursor:"pointer",
              transition:"border-color 0.1s",
            }}
              onMouseEnter={e=>e.currentTarget.style.borderColor=`${cat.color}44`}
              onMouseLeave={e=>e.currentTarget.style.borderColor=selectedPreset===preset.id ? `${cat.color}88` : "#0a2030"}
            >
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                <span style={{ color: selectedPreset===preset.id ? cat.color : "#cce8ff", fontSize:11, fontWeight:"bold" }}>
                  {preset.user && <span style={{ color:"#aa88ff", marginRight:4 }}>★</span>}
                  {preset.name}
                </span>
                {preset.user && (
                  <button onClick={e=>{ e.stopPropagation(); deleteUserPreset(preset.id); }} style={{
                    background:"none", border:"none", color:"#334455", cursor:"pointer", fontSize:10, padding:0,
                  }}>✕</button>
                )}
              </div>
              <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                {(preset.tags||[]).map(tag => (
                  <span key={tag} style={{ fontSize:8, padding:"1px 5px", background:`${cat.color}11`, color:cat.color, borderRadius:2, border:`0.5px solid ${cat.color}33` }}>{tag}</span>
                ))}
              </div>
              {preset.values && (
                <div style={{ display:"flex", gap:3, marginTop:5 }}>
                  {Object.entries(preset.values).slice(0,4).map(([k,v]) => (
                    <div key={k} style={{ flex:1 }}>
                      <div style={{ fontSize:8, color:"#334455", marginBottom:1 }}>{k.slice(0,3)}</div>
                      <div style={{ height:2, background:"#0a1825", borderRadius:1, overflow:"hidden" }}>
                        <div style={{ width:`${Math.round(v*100)}%`, height:"100%", background:cat.color, opacity:0.7 }}/>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {preset.duration && (
                <div style={{ fontSize:9, color:"#334455", marginTop:4 }}>
                  {Math.floor(preset.duration/60000)}:{String(Math.floor((preset.duration%60000)/1000)).padStart(2,"0")} duration
                </div>
              )}
            </div>
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ color:"#223344", fontSize:10, textAlign:"center", padding:"20px 0" }}>
            No presets match "{search}"
          </div>
        )}
      </div>

      {/* Footer count */}
      <div style={{ padding:"4px 10px", borderTop:"1px solid #0a2030", fontSize:9, color:"#334455", flexShrink:0 }}>
        {filtered.length} presets · {(userPresets[category]||[]).length} user saved
      </div>
    </div>
  );
}
