import {compileStudio} from '../../programmer/studio/showModel';
import {buildPatternUnit} from '../../programmer/studio/patternPresets';
export function buildDraftClips(studio,options,items){const temporary={...studio,recipes:[],legacyClips:[]};const result=buildPatternUnit(temporary,{...options,options:{...options.options,start:0},items,unitId:null,replaceIds:[]});return compileStudio(result.studio,items).clips;}
export function localizeClips(clips=[]){if(!clips.length)return {clips:[],duration:1};const origin=Math.min(...clips.map(c=>Number(c.startTime)||0));const local=clips.map(c=>({...c,startTime:(Number(c.startTime)||0)-origin}));return {clips:local,duration:Math.max(1,...local.map(c=>c.startTime+(Number(c.duration)||0)))};}
