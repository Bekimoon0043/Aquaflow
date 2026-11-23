import {useEffect,useState} from 'react';
import {IconButton,Splitter} from '../index';
import {ZONES,defaultDock,loadDock,saveDock} from './dockModel';
import './dock.css';
export default function DockLayout({workspace,panels}) {
 const [state,setState]=useState(()=>({workspace,layout:loadDock(workspace,panels)}));
 const layout=state.workspace===workspace?state.layout:loadDock(workspace,panels);
 useEffect(()=>{if(state.workspace!==workspace)setState({workspace,layout});},[workspace]);
 const update=fn=>setState(s=>({workspace,layout:fn(s.workspace===workspace?s.layout:layout)}));
 useEffect(()=>{if(state.workspace!==workspace)return;const t=setTimeout(()=>saveDock(workspace,state.layout),180);return()=>clearTimeout(t);},[state,workspace]);
 useEffect(()=>{const reset=()=>update(()=>defaultDock(panels));window.addEventListener('aquaflow:reset-layout',reset);return()=>window.removeEventListener('aquaflow:reset-layout',reset);},[workspace,panels]);
 useEffect(()=>{const activate=e=>{const id=e.detail?.id;if(panels.some(p=>p.id===id))update(s=>{const z=s.zones[id];return {...s,active:{...s.active,[z]:id},collapsed:{...s.collapsed,[z]:false}};});};window.addEventListener('aquaflow:activate-dock',activate);return()=>window.removeEventListener('aquaflow:activate-dock',activate);},[workspace,panels]);
 const move=(id,zone)=>update(s=>({...s,zones:{...s.zones,[id]:zone},active:{...s.active,[zone]:id},collapsed:{...s.collapsed,[zone]:false}}));
 const size=z=>panels.some(p=>layout.zones[p.id]===z)?layout.collapsed[z]?28:layout.sizes[z]:0;
 const resize=(z,d)=>update(s=>({...s,sizes:{...s.sizes,[z]:Math.max(120,Math.min(700,s.sizes[z]+d))}}));
 return <div className="ui-dock" style={{gridTemplateColumns:`${size('left')}px 4px minmax(160px,1fr) 4px ${size('right')}px`,gridTemplateRows:`minmax(100px,1fr) 4px ${size('bottom')}px`}}>
 {ZONES.map(zone=><div key={zone} className={`dock-zone dock-${zone}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('application/aquaflow-panel');if(panels.some(p=>p.id===id))move(id,zone);}}><div className="dock-tabs" role="tablist" aria-label={`${zone} panels`}>{panels.filter(p=>layout.zones[p.id]===zone).map(p=><button key={p.id} role="tab" draggable onDragStart={e=>e.dataTransfer.setData('application/aquaflow-panel',p.id)} aria-selected={layout.active[zone]===p.id} onClick={()=>update(s=>({...s,active:{...s.active,[zone]:p.id},collapsed:{...s.collapsed,[zone]:false}}))}>{p.label}</button>)}{zone!=='center'&&<IconButton icon="chevron" label={`Collapse ${zone} dock`} onClick={()=>update(s=>({...s,collapsed:{...s.collapsed,[zone]:!s.collapsed[zone]}}))}/>}</div></div>)}
 {panels.map(p=>{const zone=layout.zones[p.id]||p.zone;return <section key={p.id} className={`dock-content dock-${zone}`} hidden={layout.active[zone]!==p.id||layout.collapsed[zone]}><div className="dock-destination"><label>Dock <select aria-label={`Dock ${p.label}`} value={zone} onChange={e=>move(p.id,e.target.value)}>{ZONES.map(z=><option key={z}>{z}</option>)}</select></label></div><div className="dock-body">{p.content}</div></section>;})}
 <div className="dock-resize-left"><Splitter onResize={d=>resize('left',d)}/></div><div className="dock-resize-right"><Splitter onResize={d=>resize('right',-d)}/></div><div className="dock-resize-bottom"><Splitter vertical onResize={d=>resize('bottom',-d)}/></div>
 </div>;
}
