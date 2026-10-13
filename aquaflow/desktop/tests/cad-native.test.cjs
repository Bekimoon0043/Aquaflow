const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MAX_CAD_BYTES,ODA_NOTICE,autoCadScript,validateDrawing,convertCadDrawing,registerCadIpc,odaPolicy,resetOdaAcknowledgement,
 permittedEngines,enginesForRequest,getCadCapabilities}=require('../cad-native');
const dxf='0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n1\n0\nENDSEC\n0\nEOF\n';
function ipcFixture(){
 const handlers=new Map(),frame={},sender={mainFrame:frame},win={webContents:sender};
 let dialogCalls=0;
 registerCadIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async()=>{dialogCalls++;return {canceled:true};}},getMainWindow:()=>win});
 return {handlers,event:{sender,senderFrame:frame},dialogCalls:()=>dialogCalls};
}
test('validates actual DWG magic and rejects renamed DXF and incomplete drawings',()=>{
 assert.throws(()=>validateDrawing(Buffer.from(dxf),'dwg'),/genuine DWG/);
 assert.throws(()=>validateDrawing(Buffer.from('AC1032'),'dwg'),/genuine DWG/);
 assert.throws(()=>validateDrawing(Buffer.from('0\nSECTION\n'),'dxf'),/complete ASCII/);
 assert.throws(()=>validateDrawing(Buffer.from('AutoCAD Binary DXF'),'dxf'),/ASCII/);
 const bytes=Buffer.alloc(512);bytes.write('AC1032');validateDrawing(bytes,'dwg');validateDrawing(Buffer.from(dxf),'dxf');
});
test('bounds both CAD input types before starting an engine (100 MB, aligned with the backend importer)',()=>{
 assert.equal(MAX_CAD_BYTES,100*1024*1024);
 assert.throws(()=>validateDrawing(Buffer.alloc(MAX_CAD_BYTES+1),'dwg'),/100 MB/);
 assert.throws(()=>validateDrawing(Buffer.alloc(0),'dxf'),/100 MB/);
});
const AUTOCAD={kind:'autocad',file:'C:/AutoCAD/accoreconsole.exe',name:'AutoCAD 2022'};
const ODA={kind:'oda',file:'C:/ODA/ODAFileConverter.exe',name:'ODA File Converter'};
test('AF-CAD-018: AutoCAD stays the default; ODA needs the licence gate',()=>{
 resetOdaAcknowledgement();
 const unknown=odaPolicy({licenseEdition:'STRONG_BETA'});
 assert.equal(unknown.allowed,false);assert.equal(unknown.needsAcknowledgement,true);assert.match(unknown.notice,/non-commercial use only/);
 assert.deepEqual(permittedEngines([AUTOCAD,ODA],unknown),[AUTOCAD]);
 const commercial=odaPolicy({licenseEdition:'STUDIO',acknowledged:true});
 assert.equal(commercial.allowed,false);assert.equal(commercial.blocked,true);
 assert.equal(odaPolicy({licenseEdition:'STRONG_BETA'}).allowed,false,'a blocked commercial request never acknowledges');
 assert.equal(odaPolicy({licenseEdition:'PLAYER',commercialApproved:true}).allowed,true);
 assert.equal(odaPolicy({licenseEdition:'',acknowledged:true}).allowed,true);
 assert.equal(odaPolicy({licenseEdition:'NONE'}).allowed,true,'acknowledgement lasts for the session');
 assert.equal(odaPolicy({licenseEdition:'STUDIO'}).allowed,false,'commercial stays disabled even after a session acknowledgement');
 resetOdaAcknowledgement();
 assert.equal(odaPolicy({licenseEdition:'NONE'}).allowed,false);
});
test('AF-CAD-018: request routing returns acknowledgement / blocked results instead of running ODA',()=>{
 resetOdaAcknowledgement();
 const odaOnly={findEngines:()=>[ODA],commercialApproved:()=>false};
 const ask=enginesForRequest({licenseEdition:'STRONG_BETA'},odaOnly).result;
 assert.equal(ask.ok,false);assert.equal(ask.needsOdaAcknowledgement,true);assert.equal(ask.notice,ODA_NOTICE);
 const blocked=enginesForRequest({licenseEdition:'STUDIO',odaAcknowledged:true},odaOnly).result;
 assert.equal(blocked.odaBlocked,true);assert.match(blocked.error,/odaCommercialApproved/);
 const ok=enginesForRequest({licenseEdition:'STRONG_BETA',odaAcknowledged:true},odaOnly);
 assert.deepEqual(ok.engines,[ODA]);assert.equal(ok.notice,ODA_NOTICE);
 resetOdaAcknowledgement();
 const withAutocad=enginesForRequest({licenseEdition:'STUDIO'},{findEngines:()=>[AUTOCAD,ODA],commercialApproved:()=>false});
 assert.deepEqual(withAutocad.engines,[AUTOCAD]);assert.equal(withAutocad.notice,null);
 const caps=getCadCapabilities({engines:[ODA]});
 assert.equal(caps.engineKind,'oda');assert.equal(caps.odaNotice,ODA_NOTICE);assert.equal(caps.maxBytes,MAX_CAD_BYTES);
});
test('AF-CAD-018: an ODA-only install asks for acknowledgement through IPC before converting',async()=>{
 resetOdaAcknowledgement();
 const handlers=new Map(),frame={},sender={mainFrame:frame},win={webContents:sender};
 registerCadIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},getMainWindow:()=>win,findEngines:()=>[ODA],commercialApproved:()=>false});
 const dwg=Buffer.alloc(600);dwg.write('AC1032');
 const result=await handlers.get('cad:import-dwg')({sender,senderFrame:frame},new Uint8Array(dwg),{licenseEdition:'STRONG_BETA'});
 assert.equal(result.ok,false);assert.equal(result.needsOdaAcknowledgement,true);
 const blocked=await handlers.get('cad:import-dwg')({sender,senderFrame:frame},new Uint8Array(dwg),{licenseEdition:'STUDIO',odaAcknowledged:true});
 assert.equal(blocked.odaBlocked,true);
});
test('rejects missing engines and unsupported format conversions',async()=>{
 await assert.rejects(convertCadDrawing(Buffer.from(dxf),'dxf','dwg',{engines:[]}),/Native CAD engine|Install licensed/);
 await assert.rejects(convertCadDrawing(Buffer.from(dxf),'dxf','dxf'),/Unsupported CAD/);
 await assert.rejects(convertCadDrawing(Buffer.from(dxf),'pdf','dwg'),/Unsupported CAD/);
});
test('native scripts escape local paths, select the required DWG format and restore CAD preferences',()=>{
 const script=autoCadScript('C:\\temp\\quote"file.dwg','dwg');
 assert(script.includes('"_.SAVEAS" "2018"'));assert(script.includes('C:/temp/quote\\"file.dwg'));
 assert(script.includes('AQUAFLOW_CAD_ENTITY_COUNT'));assert(script.includes('(getvar v)'));assert(script.includes('(setvar (car p) (cdr p))'));
 assert(autoCadScript('C:/temp/out.dxf','dxf').includes('"_.DXFOUT" "C:/temp/out.dxf" "16"'));
});
test('rejects requests from other renderers and subframes without opening a dialog',async()=>{
 const f=ipcFixture();
 assert.equal((await f.handlers.get('cad:export-dwg')({sender:{}},{dxf})).ok,false);
 assert.equal((await f.handlers.get('cad:export-dwg')({...f.event,senderFrame:{}},{dxf})).ok,false);
 assert.equal((await f.handlers.get('cad:import-dwg')({sender:{}},new Uint8Array())).ok,false);
 assert.equal(f.dialogCalls(),0);
});
test('rejects invalid and oversized IPC payloads without opening a save dialog',async()=>{
 const f=ipcFixture();
 assert.equal((await f.handlers.get('cad:export-dwg')(f.event,{dxf:{}})).ok,false);
 assert.equal((await f.handlers.get('cad:export-dwg')(f.event,{dxf:'x'.repeat(MAX_CAD_BYTES+1)})).ok,false);
 assert.equal((await f.handlers.get('cad:import-dwg')(f.event,{path:'C:/other/file.dwg'})).ok,false);
 assert.equal((await f.handlers.get('cad:import-dwg')(f.event,new Uint8Array(MAX_CAD_BYTES+1))).ok,false);
 assert.equal(f.dialogCalls(),0);
});
test('invalid DWG input returns a clear error through IPC',async()=>{
 const f=ipcFixture(),result=await f.handlers.get('cad:import-dwg')(f.event,new Uint8Array(Buffer.from(dxf)));
 assert.equal(result.ok,false);assert.match(result.error,/genuine DWG/);
});
test('canceling the save dialog never runs a CAD engine or writes a drawing',async()=>{
 const f=ipcFixture(),capability=f.handlers.get('cad:capabilities')(f.event);
 if(!capability.available)return;
 assert.deepEqual(await f.handlers.get('cad:export-dwg')(f.event,{dxf,name:'4KILO'}),{canceled:true});
 assert.equal(f.dialogCalls(),1);
});
