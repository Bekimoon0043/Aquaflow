// Real DWG exchange via an installed CAD engine. This module has no backend,
// network or controller dependencies. Converter jobs only see isolated files.
//
// AF-CAD-018 licensing rules:
//   * The user's own AutoCAD (accoreconsole.exe) is ALWAYS tried first and is the default.
//   * ODA File Converter is free for non-commercial use only. It is never bundled. It is
//     disabled for commercial AquaFlow licences (STUDIO / PLAYER) unless an administrator
//     records a written ODA decision by setting odaCommercialApproved (app-config.json or
//     AQUAFLOW_ODA_COMMERCIAL_APPROVED=1). For any other or unknown licence the user must
//     acknowledge the non-commercial notice once per app session.
//   * LibreDWG (GPLv3) is never linked, bundled or invoked.
//   * The converted DXF goes back to the renderer, which hands it to the backend ezdxf
//     importer (POST /api/cad/import); the size cap matches that importer (100 MB).
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");

const MAX_CAD_BYTES = 100 * 1024 * 1024; // aligned with POST /api/cad/import (AF-CAD-010)
const ODA_NOTICE = "ODA File Converter is free for non-commercial use only. Commercial use requires an ODA membership or written permission from the Open Design Alliance.";
const COMMERCIAL_EDITIONS = new Set(["STUDIO","PLAYER"]);
let odaAcknowledgedThisSession = false;

function readOdaCommercialApproved(env = process.env) {
  if (/^(1|true|yes)$/i.test(String(env.AQUAFLOW_ODA_COMMERCIAL_APPROVED || ""))) return true;
  try {
    const p = path.join(process.resourcesPath || "", "app-config.json");
    if (process.resourcesPath && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,"utf8")).odaCommercialApproved === true;
  } catch { /* a malformed admin config never enables ODA */ }
  return false;
}

/** ODA gate: {allowed, needsAcknowledgement, blocked, notice, reason}. */
function odaPolicy({licenseEdition, acknowledged=false, commercialApproved=false}={}) {
  const edition = String(licenseEdition || "UNKNOWN").toUpperCase();
  if (commercialApproved) return {allowed:true,needsAcknowledgement:false,blocked:false,notice:ODA_NOTICE,reason:"Commercial use approved by the administrator (odaCommercialApproved)."};
  if (COMMERCIAL_EDITIONS.has(edition)) return {allowed:false,needsAcknowledgement:false,blocked:true,notice:ODA_NOTICE,
    reason:"ODA File Converter is disabled for commercial AquaFlow licences until a written ODA licensing decision is recorded (odaCommercialApproved). Use AutoCAD, save the drawing as DXF, or run the AquaFlow AutoLISP export."};
  if (acknowledged) odaAcknowledgedThisSession = true;
  if (odaAcknowledgedThisSession) return {allowed:true,needsAcknowledgement:false,blocked:false,notice:ODA_NOTICE,reason:"Non-commercial use acknowledged for this session."};
  return {allowed:false,needsAcknowledgement:true,blocked:false,notice:ODA_NOTICE,reason:"Confirm non-commercial use to convert with ODA File Converter."};
}
function resetOdaAcknowledgement() { odaAcknowledgedThisSession = false; }

/** AutoCAD engines always; ODA only when the policy allows it. */
function permittedEngines(engines, policy) {
  return engines.filter(e => e.kind !== "oda" || policy.allowed);
}
const TIMEOUT_MS = 90000;
let conversionBusy = false;

function findCadEngines(env = process.env) {
  const engines = [];
  const add = (kind, file, name) => {
    if (file && fs.existsSync(file) && !engines.some(e => e.file === file)) engines.push({kind,file,name});
  };
  add("autocad",env.AQUAFLOW_ACCORECONSOLE,"Configured AutoCAD");
  const roots = [...new Set([env.ProgramW6432,env.ProgramFiles,"C:/Program Files"].filter(Boolean))];
  for (const root of roots) {
    const dir = path.join(root,"Autodesk");
    try {
      fs.readdirSync(dir,{withFileTypes:true})
        .filter(d => d.isDirectory() && /^AutoCAD (20\d\d)$/.test(d.name) && Number(d.name.slice(-4))>=2018)
        .sort((a,b)=>b.name.localeCompare(a.name))
        .forEach(d=>add("autocad",path.join(dir,d.name,"accoreconsole.exe"),d.name));
    } catch { /* An optional engine may be absent. */ }
  }
  add("oda",env.AQUAFLOW_ODA_CONVERTER,"ODA File Converter");
  for (const root of roots) {
    const dir = path.join(root,"ODA");
    try {
      fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name))
        .forEach(d=>add("oda",path.join(dir,d.name,"ODAFileConverter.exe"),"ODA File Converter"));
    } catch { /* The user can install ODA independently of AutoCAD. */ }
    add("oda",path.join(dir,"ODAFileConverter.exe"),"ODA File Converter");
  }
  return engines;
}

function getCadCapabilities({engines=findCadEngines()}={}) {
  const autocad=engines.some(e=>e.kind==="autocad"),oda=engines.some(e=>e.kind==="oda");
  return { available:engines.length>0,engine:engines[0]?.name || null,engineKind:engines[0]?.kind || null,
    autocadAvailable:autocad,odaAvailable:oda,odaNotice:oda ? ODA_NOTICE : null,maxBytes:MAX_CAD_BYTES,
    format:"AutoCAD 2018 DWG (AutoCAD 2022 compatible)",
    message:engines.length ? (autocad ? "AutoCAD detected (default DWG engine)." : "ODA File Converter detected. "+ODA_NOTICE)
      : "Install licensed AutoCAD 2018 or later for native DWG exchange, save drawings as DXF, or use the AquaFlow AutoLISP export." };
}

const lispPath = file => '"'+file.replaceAll("\\","/").replaceAll('"','\\"')+'"';
function autoCadScript(output,format) {
  const count='(setq af-set (ssget "_X" \'((410 . "Model"))))\n(princ (strcat "\\nAQUAFLOW_CAD_ENTITY_COUNT=" (itoa (if af-set (sslength af-set) 0)) "\\n"))\n';
  return '(setq af-vars (mapcar \'(lambda (v) (cons v (getvar v))) \'("FILEDIA" "CMDDIA" "PROXYNOTICE")))\n(setvar "FILEDIA" 0)\n(setvar "CMDDIA" 0)\n(setvar "PROXYNOTICE" 0)\n'
    + count + (format==="dwg" ? '(command "_.ZOOM" "_E")\n(command "_.SAVEAS" "2018" '+lispPath(output)+')\n'
      : '(command "_.DXFOUT" '+lispPath(output)+' "16")\n')
    + '(mapcar \'(lambda (p) (setvar (car p) (cdr p))) af-vars)\n(command "_.QUIT")\n';
}

function execute(file,args,cwd) {
  return new Promise((resolve,reject)=>{
    execFile(file,args,{cwd,windowsHide:true,timeout:TIMEOUT_MS,maxBuffer:4*1024*1024},(error,stdout,stderr)=>{
      const log=(stdout+"\n"+stderr).replaceAll("\0","");
      if(error) reject(new Error(error.killed ? "CAD conversion timed out. Check the CAD engine's license and try again."
        : "CAD engine could not convert the drawing: "+log.trim().slice(-1500)));
      else resolve(log);
    });
  });
}

function validateDrawing(bytes,format) {
  if (!bytes.length || bytes.length>MAX_CAD_BYTES) throw new Error("CAD drawings must be between 1 byte and 100 MB.");
  if (format==="dwg") {
    if (bytes.length<512 || !/^AC10\d\d$/.test(bytes.subarray(0,6).toString("ascii"))) throw new Error("The CAD engine did not produce a genuine DWG drawing.");
  } else {
    const text=bytes.toString("utf8");
    if (/^AutoCAD Binary DXF/.test(text) || !/\bSECTION\b/.test(text) || !/\bENTITIES\b/.test(text) || !/\bEOF\s*$/.test(text))
      throw new Error("The CAD engine did not produce a complete ASCII DXF drawing.");
  }
}

async function convertCadDrawing(input,from,to,{engines=findCadEngines()}={}) {
  if(!["dwg","dxf"].includes(from)||!["dwg","dxf"].includes(to)||from===to) throw new Error("Unsupported CAD conversion.");
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  validateDrawing(bytes,from);
  if(!engines.length) throw new Error(getCadCapabilities({engines}).message);
  if(conversionBusy) throw new Error("Another CAD conversion is running. Please wait for it to finish.");
  conversionBusy=true;
  let temporary;
  try {
    temporary=await fsp.mkdtemp(path.join(os.tmpdir(),"aquaflow-cad-"));
    const sourceDir=path.join(temporary,"input"),outputDir=path.join(temporary,"output");
    await fsp.mkdir(sourceDir);await fsp.mkdir(outputDir);
    const source=path.join(sourceDir,"drawing."+from),output=path.join(outputDir,"drawing."+to);
    await fsp.writeFile(source,bytes);
    const failures=[];
    for(const engine of engines) {
      try {
        await fsp.rm(output,{force:true});
        if(engine.kind==="autocad") {
          const script=path.join(temporary,"convert.scr");
          await fsp.writeFile(script,autoCadScript(output,to),"utf8");
          const log=await execute(engine.file,["/i",source,"/s",script,"/l","en-US"],temporary);
          const count=log.match(/AQUAFLOW_CAD_ENTITY_COUNT=(\d+)/);
          if(!count || Number(count[1])<1) throw new Error("AutoCAD did not load any model-space entities.");
        } else if(engine.kind==="oda") {
          await execute(engine.file,[sourceDir,outputDir,"ACAD2018",to.toUpperCase(),"0","1",path.basename(source)],temporary);
        } else throw new Error("Unsupported CAD engine.");
        const result=await fsp.readFile(output);validateDrawing(result,to);
        if(to==="dwg" && result.subarray(0,6).toString("ascii")!=="AC1032") throw new Error("The output is not the requested AutoCAD 2018/2022 DWG format.");
        return {bytes:result,engine:engine.name,format:to};
      } catch(e) {failures.push(engine.name+": "+e.message);}
    }
    throw new Error(failures.join("\n"));
  } finally {
    // Only the unique directory we just created is removed; no selected user
    // drawing, installation folder or fountain profile is ever a cleanup target.
    if(temporary) {
      const cleanup=path.resolve(temporary),parent=path.resolve(os.tmpdir());
      if(path.dirname(cleanup)!==parent || !path.basename(cleanup).startsWith("aquaflow-cad-")) throw new Error("Refused an unexpected CAD cleanup path.");
      await fsp.rm(cleanup,{recursive:true,force:true}).catch(()=>{});
    }
    conversionBusy=false;
  }
}

// Resolve the engines a request may use. Returns {engines, notice} or {result} (an IPC error).
function enginesForRequest(options={},{findEngines=findCadEngines,commercialApproved=readOdaCommercialApproved}={}) {
  const all=findEngines();
  const policy=odaPolicy({licenseEdition:options.licenseEdition,acknowledged:options.odaAcknowledged===true,commercialApproved:commercialApproved()});
  const engines=permittedEngines(all,policy);
  if(engines.length) return {engines,notice:engines[0].kind==="oda" ? ODA_NOTICE : null};
  if(all.some(e=>e.kind==="oda")) return {result:{ok:false,error:policy.reason,notice:ODA_NOTICE,
    needsOdaAcknowledgement:policy.needsAcknowledgement,odaBlocked:policy.blocked}};
  return {result:{ok:false,error:getCadCapabilities({engines:all}).message}};
}

function registerCadIpc({ipcMain,dialog,getMainWindow,findEngines=findCadEngines,commercialApproved=readOdaCommercialApproved}) {
  const senderAllowed=event=>{const win=getMainWindow();return win && event.sender===win.webContents && (!event.senderFrame || event.senderFrame===event.sender.mainFrame);};
  ipcMain.handle("cad:capabilities",event=>senderAllowed(event)?getCadCapabilities({engines:findEngines()}):{available:false,message:"Untrusted CAD request."});
  ipcMain.handle("cad:export-dwg",async(event,request)=>{
    if(!senderAllowed(event))return {ok:false,error:"Untrusted CAD request."};
    try {
      if(typeof request?.dxf!=="string" || Buffer.byteLength(request.dxf,"utf8")>MAX_CAD_BYTES) throw new Error("Choose a drawing no larger than 100 MB.");
      const selected=enginesForRequest(request,{findEngines,commercialApproved});if(selected.result) return selected.result;
      const name=String(request.name||"AquaFlow-Fountain").replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,100).replace(/\.(dwg|dxf)$/i,"")||"AquaFlow-Fountain";
      const selection=await dialog.showSaveDialog(getMainWindow(),{title:"Export AutoCAD DWG",defaultPath:name+".dwg",filters:[{name:"AutoCAD DWG drawing",extensions:["dwg"]}]});
      if(selection.canceled || !selection.filePath)return {canceled:true};
      const destination=/\.dwg$/i.test(selection.filePath)?selection.filePath:selection.filePath+".dwg";
      const result=await convertCadDrawing(Buffer.from(request.dxf,"utf8"),"dxf","dwg",{engines:selected.engines});
      await fsp.writeFile(destination,result.bytes);
      return {ok:true,path:destination,engine:result.engine,format:"AC1032",size:result.bytes.length,notice:selected.notice};
    }catch(e){return {ok:false,error:e.message};}
  });
  // DWG → ASCII DXF. The renderer sends the DXF to the backend importer (POST /api/cad/import).
  ipcMain.handle("cad:import-dwg",async(event,input,options)=>{
    if(!senderAllowed(event))return {ok:false,error:"Untrusted CAD request."};
    try {
      if(!(input instanceof Uint8Array) || input.byteLength>MAX_CAD_BYTES) throw new Error("Choose a DWG drawing no larger than 100 MB.");
      validateDrawing(Buffer.from(input.buffer,input.byteOffset,input.byteLength),"dwg");
      const selected=enginesForRequest(options||{},{findEngines,commercialApproved});if(selected.result) return selected.result;
      const result=await convertCadDrawing(Buffer.from(input),"dwg","dxf",{engines:selected.engines});
      return {ok:true,dxf:result.bytes.toString("utf8"),engine:result.engine,notice:selected.notice};
    }catch(e){return {ok:false,error:e.message};}
  });
}

module.exports={MAX_CAD_BYTES,ODA_NOTICE,COMMERCIAL_EDITIONS,findCadEngines,getCadCapabilities,autoCadScript,validateDrawing,convertCadDrawing,
  odaPolicy,resetOdaAcknowledgement,permittedEngines,enginesForRequest,readOdaCommercialApproved,registerCadIpc};
