import {useEffect,useMemo,useRef,useState} from 'react';
import {FountainScene} from '../FountainScene_v6';
import {useEngineeringSync} from '../../../hooks/useEngineeringSync';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import {createFullShowPreview,evaluateFullShowPreview} from '../../../utils/fullShowPreview';
import {createICANPreviewPlan} from '../../../utils/icanPatternPreview';
import {getActiveScene} from '../camera/activeScene';
import {IconButton,PanelHeader,Toolbar,Select} from '../../../ui';
import {useFocusPreviewStore,clampRect} from './focusPreviewStore';
import {localizeClips} from './draftPreview';
import './focusPreview.css';
export default function FocusPreview(){const state=useFocusPreviewStore();const host=useRef(null),drag=useRef(null);
 useEffect(()=>{const resize=()=>state.setRect(useFocusPreviewStore.getState().rect);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 if(!state.open)return null;
 const move=e=>{if(!drag.current)return;const {x,y,rect,resize}=drag.current;state.setRect(resize?{...rect,width:rect.width+e.clientX-x,height:rect.height+e.clientY-y}:{...rect,x:rect.x+e.clientX-x,y:rect.y+e.clientY-y});};
 const start=(e,resize=false)=>{if(e.target.closest('button'))return;drag.current={x:e.clientX,y:e.clientY,rect:state.rect,resize};e.currentTarget.setPointerCapture(e.pointerId);};
 const end=()=>{if(!drag.current)return;const r=useFocusPreviewStore.getState().rect;const x=r.x<40?8:innerWidth-r.x-r.width<40?innerWidth-r.width-8:r.x;const y=r.y<100?70:innerHeight-r.y-r.height<65?innerHeight-r.height-32:r.y;state.setRect({...r,x,y});drag.current=null;};
 return <section ref={host} className="focus-preview" aria-label="Focus Preview" style={{left:state.rect.x,top:state.rect.y,width:state.rect.width,height:state.collapsed?28:state.rect.height}}><div className="focus-drag" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>drag.current=null}><PanelHeader title={`Focus Preview · ${state.selectionIds.length}`}><IconButton icon="pin" label="Pin focus preview" aria-pressed={state.pinned} onClick={state.togglePin}/><IconButton icon="chevron" label="Collapse focus preview" onClick={state.toggleCollapse}/><IconButton icon="close" label="Close focus preview" onClick={state.close}/></PanelHeader></div>{!state.collapsed&&<FocusScene/>}{!state.collapsed&&<div className="focus-resize" role="separator" aria-label="Resize focus preview" onPointerDown={e=>start(e,true)} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>drag.current=null}/>}</section>;
}
function FocusScene(){const canvas=useRef(null),host=useRef(null),sceneRef=useRef(null),visible=useRef(true),clock=useRef(0),live=useRef(null);const [playing,setPlaying]=useState(true),[loop,setLoop]=useState(true),[speed,setSpeed]=useState(1),[time,setTime]=useState(0),[error,setError]=useState('');
 const ids=useFocusPreviewStore(s=>s.selectionIds),draft=useFocusPreviewStore(s=>s.draftClips),draftError=useFocusPreviewStore(s=>s.error);const fixtures=useEngineeringStore(s=>s.fixtures),saved=useProjectStore(s=>s.programmer?.timelineClips);
 const local=useMemo(()=>localizeClips(draft||saved||[]),[draft,saved]);
 const plan=useMemo(()=>{try{return local.clips.length?createICANPreviewPlan(createFullShowPreview(local.clips,fixtures,'Draft',{skipUnsupported:true}),1):null;}catch{return null;}},[local,fixtures]);
 live.current={playing,loop,speed,plan,duration:local.duration,fixtures};
 useEffect(()=>{let scene,observer,resize,raf;try{scene=new FountainScene(canvas.current,{quality:'low',maxFps:30,particleBudgetScale:.2,environment:'night'});scene.init();scene.stopPattern();scene.orbitAuto=false;scene.setReviewOverlays(false);sceneRef.current=scene;
 resize=new ResizeObserver(()=>{const r=host.current?.getBoundingClientRect();if(r?.width&&r.height)scene.resize(r.width,r.height);});resize.observe(host.current);
 if(typeof IntersectionObserver!=='undefined'){observer=new IntersectionObserver(entries=>{visible.current=entries[0]?.isIntersecting!==false;scene.renderVisible=visible.current;});observer.observe(host.current);}
 let previous=performance.now(),draw=0;const tick=now=>{raf=requestAnimationFrame(tick);const dt=Math.min(.1,(now-previous)/1000);previous=now;if(document.hidden||!visible.current||now-draw<1000/30)return;const elapsed=(now-draw)/1000;draw=now;const v=live.current;if(v.playing){clock.current+=Math.min(.1,elapsed)*v.speed;if(clock.current>=v.duration){clock.current=v.loop?clock.current%v.duration:v.duration;if(!v.loop)setPlaying(false);}}if(v.plan)scene.setSignals(evaluateFullShowPreview(v.plan,clock.current,v.fixtures));scene.setCameraTime?.(clock.current);setTime(clock.current);};raf=requestAnimationFrame(tick);
 }catch(e){setError(e.message);}return()=>{cancelAnimationFrame(raf);resize?.disconnect();observer?.disconnect();scene?.dispose();sceneRef.current=null;};},[]);
 useEngineeringSync(sceneRef);
 useEffect(()=>{const scene=sceneRef.current;scene?.setSelectionOutline(ids);scene?.setIsolation(ids,{ghostOpacity:.15});scene?.frameFixtures(ids);},[ids,fixtures]);
 useEffect(()=>{clock.current=0;setTime(0);},[plan]);
 const seek=n=>{clock.current=n;setTime(n);};
 const openMain=()=>{const scene=getActiveScene();scene?.setSelectionOutline?.(ids);scene?.setIsolation?.(ids,{ghostOpacity:.15});scene?.frameFixtures?.(ids);};
 const programmable=fixtures.some(f=>ids.includes(f.id));
 return <><div className="focus-canvas" ref={host}><canvas ref={canvas}/>{(!ids.length||!programmable||error||draftError)&&<p className="focus-hint">{error||draftError||(!ids.length?'Select a fixture or group to preview.':'This selection has no programmable fixtures.')}</p>}</div><Toolbar aria-label="Focus transport"><IconButton icon={playing?'pause':'play'} label={playing?'Pause draft':'Play draft'} onClick={()=>setPlaying(v=>!v)}/><IconButton icon="loop" label="Loop draft" aria-pressed={loop} onClick={()=>setLoop(v=>!v)}/><input aria-label="Draft time" type="range" min={0} max={local.duration} step={.02} value={time} onChange={e=>seek(Number(e.target.value))}/><Select aria-label="Draft speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))} options={[.25,.5,1,1.5,2].map(value=>({value,label:`${value}×`}))}/><IconButton icon="frame" label="Open selection in main viewport" onClick={openMain}/></Toolbar><div className="focus-views">{['front','top','iso'].map(v=><button key={v} onClick={()=>sceneRef.current?.snapView(v)}>{v}</button>)}<button onClick={()=>{if(sceneRef.current)sceneRef.current.orbitAuto=!sceneRef.current.orbitAuto;}}>Orbit</button><output>{time.toFixed(1)} / {local.duration.toFixed(1)} s</output></div></>;
}
