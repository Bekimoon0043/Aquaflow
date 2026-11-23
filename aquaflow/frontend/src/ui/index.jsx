import {useState, useRef} from 'react';
import Icon from './icons';
import './ui.css';
export {Icon};
export const Panel = ({children,className='',...p}) => <section className={`ui-panel ${className}`} {...p}>{children}</section>;
export const PanelHeader = ({title,children}) => <header className="ui-panel-header"><strong>{title}</strong>{children}</header>;
export const Section = ({title,children,defaultOpen=true}) => <details className="ui-section" open={defaultOpen || undefined}><summary>{title}</summary>{children}</details>;
export const Tabs = ({items,value,onChange}) => <div className="ui-tabs" role="tablist">{items.map(i=><button key={i.id} role="tab" aria-selected={value===i.id} onClick={()=>onChange(i.id)}>{i.label}</button>)}</div>;
export const Tooltip = ({label,shortcut,children}) => <span title={`${label}${shortcut ? ` (${shortcut})` : ''}`}>{children}</span>;
export const IconButton = ({icon,label,shortcut,...p}) => <button type="button" className="ui-icon-button" aria-label={label} title={`${label}${shortcut ? ` (${shortcut})` : ''}`} {...p}><Icon name={icon}/></button>;
export const Toolbar = ({children,...p}) => <div className="ui-toolbar" role="toolbar" {...p}>{children}</div>;
export const ToolbarGroup = ({children}) => <div className="ui-toolbar-group">{children}</div>;
export const PropertyGrid = ({children}) => <div className="ui-properties">{children}</div>;
export const PropertyRow = ({label,children}) => <div className="ui-property"><span>{label}</span><div>{children}</div></div>;
export function scrubValue(value,delta,{step=1,min=-Infinity,max=Infinity,shift=false,ctrl=false}={}) { return Math.max(min,Math.min(max,Number((value+delta*step*(shift?.1:ctrl?10:1)).toFixed(6)))); }
export function NumberField({value,onChange,units='',label,min,max,step=1,...p}) {
 const drag=useRef(null);
 return <div className="ui-number"><span title="Drag to adjust · Shift fine · Ctrl coarse" onPointerDown={e=>{drag.current={x:e.clientX,value:Number(value)};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)onChange(scrubValue(drag.current.value,e.clientX-drag.current.x,{min,max,step,shift:e.shiftKey,ctrl:e.ctrlKey}));}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>↔</span><input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={e=>{if(e.target.value!=='' && Number.isFinite(e.target.valueAsNumber))onChange(scrubValue(e.target.valueAsNumber,0,{min,max}));}} {...p}/><span>{units}</span></div>;
}
export const Slider = ({value,onChange,label,units='',min=0,max=100,...p}) => <label className="ui-slider"><input aria-label={label} type="range" value={value} min={min} max={max} onChange={e=>onChange(Number(e.target.value))} {...p}/><output>{value}{units}</output></label>;
export const Select = ({options,children,...p}) => <select className="ui-select" {...p}>{options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}{children}</select>;
export const ColorSwatch = p => <input className="ui-swatch" type="color" {...p}/>;
export const Checkbox = ({label,...p}) => <label className="ui-checkbox"><input type="checkbox" {...p}/>{label}</label>;
export const Toggle = p => <Checkbox {...p} role="switch"/>;
export const KeyframeButton = ({active,...p}) => <IconButton icon="keyframe" label="Toggle keyframe" aria-pressed={!!active} {...p}/>;
export const Toast = ({children,onClose}) => <div className="ui-toast" role="status">{children}{onClose && <IconButton icon="close" label="Dismiss" onClick={onClose}/>}</div>;
export function Menu({items,onClose}) {return <div className="ui-menu" role="menu" onKeyDown={e=>{if(e.key==='Escape')onClose?.();}}>{items.map(i=><button key={i.label} role="menuitem" disabled={i.disabled} onClick={()=>{i.onSelect();onClose?.();}}>{i.label}</button>)}</div>;}
export const ContextMenu = Menu;
export function Splitter({onResize,vertical=false,label='Resize panel'}) { const last=useRef(null); return <div className={`ui-splitter ${vertical?'vertical':''}`} role="separator" aria-label={label} aria-orientation={vertical?'horizontal':'vertical'} tabIndex={0} onKeyDown={e=>{if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();onResize(['ArrowLeft','ArrowUp'].includes(e.key)?-8:8);}}} onPointerDown={e=>{last.current=vertical?e.clientY:e.clientX;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(last.current===null)return;const n=vertical?e.clientY:e.clientX;onResize(n-last.current);last.current=n;}} onPointerUp={()=>last.current=null} onPointerCancel={()=>last.current=null}/>; }
