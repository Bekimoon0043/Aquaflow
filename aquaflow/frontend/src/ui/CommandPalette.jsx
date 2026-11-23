import {useEffect,useRef,useState} from 'react';
import {MENU_ITEMS} from '../components/topBarMenu';
const entries=[...new Map(Object.values(MENU_ITEMS).flat().filter(e=>['panel','action'].includes(e[1])).map(e=>[`${e[1]}:${e[2]}`,e])).values()];
export default function CommandPalette({onRun}) {
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');const prior=useRef(null);
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyP'){e.preventDefault();e.stopImmediatePropagation();prior.current=document.activeElement;setOpen(v=>!v);setQuery('');}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[]);
 const close=()=>{setOpen(false);prior.current?.focus();};const found=entries.filter(e=>e[0].toLowerCase().includes(query.toLowerCase()));
 if(!open)return null;
 return <div className="pro-palette-backdrop" onMouseDown={close}><section className="pro-palette" role="dialog" aria-modal="true" aria-label="All commands" onMouseDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')close();if(e.key==='ArrowDown'){e.preventDefault();const nodes=[...e.currentTarget.querySelectorAll('input,button')];nodes[(nodes.indexOf(document.activeElement)+1)%nodes.length]?.focus();}if(e.key==='Tab'){const nodes=[...e.currentTarget.querySelectorAll('input,button')];if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}}}><input autoFocus aria-label="Find any panel or action" placeholder="Find a panel or action…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&found[0]){close();onRun(found[0]);}}}/><div>{found.map(e=><button key={`${e[1]}:${e[2]}`} onClick={()=>{close();onRun(e);}}>{e[0]}<small>{e[1]}</small></button>)}</div><footer>Ctrl+Shift+P · Enter to run · Esc to close</footer></section></div>;
}
