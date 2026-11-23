import {create} from 'zustand';
export function clampRect(rect={},width=globalThis.innerWidth||1440,height=globalThis.innerHeight||900){const w=Math.max(280,Math.min(width-16,Number(rect.width)||360)),h=Math.max(200,Math.min(height-80,Number(rect.height)||240));return {width:w,height:h,x:Math.max(8,Math.min(width-w-8,Number.isFinite(rect.x)?rect.x:width-w-24)),y:Math.max(70,Math.min(height-h-32,Number.isFinite(rect.y)?rect.y:height-h-48))};}
const read=()=>{try{return clampRect(JSON.parse(localStorage.getItem('aquaflow.focus.rect')));}catch{return clampRect();}};
export const useFocusPreviewStore=create((set,get)=>({selectionIds:[],draftStudio:null,draftClips:null,open:false,pinned:false,collapsed:false,rect:read(),error:'',
 select(ids){const next=[...new Set(ids||[])];if(next.join('|')===get().selectionIds.join('|'))return;set({selectionIds:next,open:next.length>0||get().pinned});},
 publish({selectionIds,draftStudio=null,draftClips=null,error=''}){set({selectionIds:[...new Set(selectionIds||get().selectionIds)],draftStudio,draftClips,error,open:true});},
 clearDraft(){set({draftStudio:null,draftClips:null,error:''});},
 setRect(rect){const next=clampRect(rect);set({rect:next});try{localStorage.setItem('aquaflow.focus.rect',JSON.stringify(next));}catch{}},
 close(){set({open:false});},togglePin(){set({pinned:!get().pinned});},toggleCollapse(){set({collapsed:!get().collapsed});}
}));
