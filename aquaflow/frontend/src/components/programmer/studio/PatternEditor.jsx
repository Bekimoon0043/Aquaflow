import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import PatternBuilder from './PatternBuilder';
import PatternCreator from './PatternCreator';
import {Tabs,PanelHeader,IconButton} from '../../../ui';
import {useFocusPreviewStore} from '../../preview/focus/focusPreviewStore';
const ArrayEditor=lazy(()=>import('../ArrayPatternBuilder'));
const Designer=lazy(()=>import('../../panels/PatternDesignerPanel'));
const Manual=lazy(()=>import('../../panels/FountainControlPanel'));
export {VisibilityBadge} from './PatternBuilder';
const modes=['preset','curve','path','motion','array','designer','manual'];
export default function PatternEditor({initialMode='preset',dock=false,...props}){
 const [mode,setMode]=useState(initialMode),[music,setMusic]=useState(null);const visited=useRef(new Set([initialMode]));visited.current.add(mode);
 const [target,setTarget]=useState(null);
 useEffect(()=>{if(dock){setTarget(document.getElementById('pattern-editor-dock'));window.dispatchEvent(new CustomEvent('aquaflow:activate-dock',{detail:{id:'pattern-editor'}}));}},[dock]);
 const change=value=>props.onChange(typeof value==='function'?value(props.studio):value);
 const exportFile=(name,text)=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const content=<section className="pattern-editor"><PanelHeader title="Pattern Editor"><IconButton icon="help" label="Pattern documentation" onClick={()=>window.dispatchEvent(new CustomEvent('aquaflow:open-panel',{detail:{panel:'docs'}}))}/><IconButton icon="close" label="Close Pattern Editor" onClick={props.onClose}/></PanelHeader><Tabs value={mode} onChange={m=>{useFocusPreviewStore.getState().clearDraft();setMode(m);}} items={[...modes,'music'].map(id=>({id,label:id==='music'?'Music':id[0].toUpperCase()+id.slice(1)}))}/>
 <div hidden={mode!=='preset'}><PatternBuilder {...props} active={mode==='preset'} musicTarget={music}/></div>
 {['curve','path','motion'].map(m=>visited.current.has(m)&&<div key={m} hidden={mode!==m}><PatternCreator {...props} active={mode===m} initialMode={m} onChange={change} onExportFile={props.onExportFile||exportFile}/></div>)}
 {visited.current.has('array')&&<div hidden={mode!=='array'}><Suspense fallback={<p>Loading array tools…</p>}><ArrayEditor fixtures={props.items} tracks={props.items.flatMap(i=>i.tracks||[])} onApply={plan=>{change(s=>({...s,legacyClips:[...s.legacyClips,...plan.clips]}));return true;}}/></Suspense></div>}
 {visited.current.has('designer')&&<div hidden={mode!=='designer'}><Suspense fallback={<p>Loading designer…</p>}><Designer/></Suspense></div>}
 {visited.current.has('manual')&&<div hidden={mode!=='manual'}><Suspense fallback={<p>Loading manual controls…</p>}><Manual/></Suspense></div>}
 <section className="pattern-editor-music" hidden={mode!=='music'} ref={setMusic} aria-label="Music panel"/>
 </section>;
 return target?createPortal(content,target):content;
}
