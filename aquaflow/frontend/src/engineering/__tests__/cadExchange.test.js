import { describe, it, expect } from "vitest";
import DxfParser from "dxf-parser";
import { parseCadDxf, previewCadImport, applyCadImport, exportCadDxf } from "../cadExchange";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { createEngineeringHistory, commitEngineeringHistory, undoEngineeringHistory } from "../engineeringHistory";

const dxf = (entities, units=6, blocks="") => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n${blocks}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const circle = (layer,x,y,r=1,handle="AB") => `0\nCIRCLE\n5\n${handle}\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n`;
const line = (a,b) => `0\nLINE\n8\nPOOL_OUTLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
const square = line([0,0],[10,0])+line([10,0],[10,8])+line([10,8],[0,8])+line([0,8],[0,0]);
const project = () => ({name:"Measured site",id:"existing-project",params:{width:10,length:8,depth:1.2},
  pool_type:"freeform",geometry:{type:"freeform",closed:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:8},{x:0,y:8}]},
  fixtures:[{id:"jet-one",type:"nozzle_running",label:"Jet 水 1",x:2,y:3,rotation:17,engineering:{icanGroup:1,icanChannel:9,siteFunction:"running-fountain",jetHeight:4}}],
  manualPipes:[{id:"p1",points:[{x:1,y:1},{x:4,y:1},{x:4,y:5}],diameterMm:65,pipeType:"supply"}],
  depth_zones:[{id:"d1",zone:"deep",label:"Deep zone",depth:1.4,points:[{x:1,y:1},{x:2,y:1},{x:2,y:2}]}],
  measurements:[{x1:0,y1:0,x2:10,y2:0}],solved_hydraulics:{old:true}});

describe("AutoCAD DXF exchange",()=>{
  it("exports declared meter units, one marker per fixture and AutoCAD Y-up coordinates",()=>{
    const data=new DxfParser().parseSync(exportCadDxf(project()));
    expect(data.header.$ACADVER).toBe("AC1015");
    expect(data.header.$INSUNITS).toBe(6);
    const fixtures=data.entities.filter(e=>e.layer==="NOZZLES");
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].center).toMatchObject({x:2,y:-3});
    expect(data.tables.layer.layers).toHaveProperty("PIPEWORK");
    expect(data.tables.layer.layers).toHaveProperty("DEPTH_ZONES");
  });
  it("round-trips Unicode identity, measured layout, pipes, depth zones and dimensions",()=>{
    const original=project(), preview=previewCadImport(parseCadDxf(exportCadDxf(original)));
    const imported=applyCadImport(original,preview,{mode:"update"});
    expect(imported.id).toBe(original.id);
    expect(imported.geometry.points).toEqual(original.geometry.points);
    expect(imported.params.depth).toBe(1.2);
    expect(imported.fixtures[0]).toMatchObject({id:"jet-one",label:"Jet 水 1",x:2,y:3,rotation:17,engineering:original.fixtures[0].engineering});
    expect(imported.manualPipes[0]).toMatchObject({points:original.manualPipes[0].points,diameterMm:65});
    expect(imported.depth_zones[0]).toMatchObject({depth:1.4,points:original.depth_zones[0].points});
    expect(imported.measurements).toEqual(original.measurements);
    expect(imported.solved_hydraulics).toBeNull();
    expect(original.solved_hydraulics).toEqual({old:true});
  });
  it("round-trips the complete 4KILO layout without losing its existing I-CAN settings",()=>{
    const site=createICANSiteEngineeringProject();
    const imported=applyCadImport(site,previewCadImport(parseCadDxf(exportCadDxf(site))),{mode:"update"});
    expect(imported.fixtures).toHaveLength(site.fixtures.length);
    for(const fixture of site.fixtures){
      const next=imported.fixtures.find(f=>f.id===fixture.id);
      expect(next.x).toBeCloseTo(fixture.x,7);
      expect(next.y).toBeCloseTo(fixture.y,7);
      expect(next.type).toBe(fixture.type);
      expect(next.engineering).toEqual(fixture.engineering);
    }
  });
  it("uses CAD-edited coordinates instead of embedded identity metadata",()=>{
    const original=project();
    const exported=exportCadDxf(original).replace("10\n2\n20\n-3\n30\n0\n40\n0.12", "10\n6\n20\n-7\n30\n0\n40\n0.12");
    const imported=applyCadImport(original,previewCadImport(parseCadDxf(exported)),{mode:"update"});
    expect(imported.fixtures[0]).toMatchObject({x:6,y:7,engineering:original.fixtures[0].engineering});
  });
  it("creates new uncommissioned fixtures without trusting hardware settings from CAD",()=>{
    const original=project(), imported=applyCadImport(original,previewCadImport(parseCadDxf(exportCadDxf(original))),{mode:"new"});
    expect(imported.id).toBeNull();
    expect(imported.fixtures[0].engineering.icanGroup).toBeNull();
    expect(imported.fixtures[0].engineering.icanChannel).toBeNull();
    expect(imported.fixtures[0].engineering.plcChannel).toBeNull();
    expect(imported.fixtures[0].engineering.mappingStatus).toBe("commissioning-required");
  });
  it("imports an edited CAD annotation as the fixture name while preserving its control settings",()=>{
    const original=project(), exported=exportCadDxf(original);
    const edited=exported.replace(/(0\nTEXT\n[\s\S]*?\n1\n)[^\n]+/,"$1East jet");
    const imported=applyCadImport(original,previewCadImport(parseCadDxf(edited)),{mode:"update"});
    expect(imported.fixtures[0].label).toBe("East jet");
    expect(imported.fixtures[0].engineering).toEqual(original.fixtures[0].engineering);
  });
  it("ignores malformed label metadata and embedded hardware settings in an external drawing",()=>{
    const meta={kind:"fixture",id:"external-jet",type:"nozzle_running",label:{invalid:true},engineering:{icanGroup:99},icanChannel:99};
    const hex=Array.from(new TextEncoder().encode(JSON.stringify(meta)),b=>b.toString(16).padStart(2,"0")).join("");
    const drawing=dxf(square+circle("NOZZLES",2,-3,.12)+`1001\nAQUAFLOW\n1000\n${hex}\n`);
    const p=previewCadImport(parseCadDxf(drawing));
    expect(typeof p.fixtures[0].label).toBe("string");
    expect(applyCadImport(project(),p,{mode:"new"}).fixtures[0].engineering.icanChannel).toBeNull();
  });
  it("keeps omitted existing fixtures and adds unidentified CAD fixtures as uncommissioned",()=>{
    const original=project(), preview=previewCadImport(parseCadDxf(dxf(square+circle("NOZZLES",5,-4,.12))));
    const imported=applyCadImport(original,preview,{mode:"update"});
    expect(imported.fixtures).toHaveLength(2);
    expect(imported.fixtures.find(f=>f.id==="jet-one")).toEqual(original.fixtures[0]);
    expect(imported.fixtures.find(f=>f.id!=="jet-one").engineering.icanChannel).toBeNull();
  });
  it("converts a 36,000 mm pool and CAD fixture coordinates to meters",()=>{
    const p=previewCadImport(parseCadDxf(dxf(circle("POOL_OUTLINE",18000,6500,18000)+circle("NOZZLES",4000,-2000,120,"AC"),4)));
    expect(p.boundary.geometry).toMatchObject({center:{x:18,y:-6.5},radius:18});
    expect(p.fixtures[0]).toMatchObject({x:4,y:2});
  });
  it("requires explicit units for unitless drawings and allows overriding a wrong declaration",()=>{
    const parsed=parseCadDxf(dxf(square,0));
    expect(()=>previewCadImport(parsed)).toThrow(/units/);
    expect(previewCadImport(parsed,{units:"meters"}).boundary).toBeTruthy();
    expect(previewCadImport(parseCadDxf(dxf(circle("POOL_OUTLINE",0,0,1000),6)),{units:"millimeters"}).boundary.geometry.radius).toBe(1);
  });
  it("allows the operator to retain CAD Y orientation",()=>{
    const p=previewCadImport(parseCadDxf(dxf(circle("POOL_OUTLINE",3,5,4))),{flipY:false});
    expect(p.boundary.geometry.center).toEqual({x:3,y:5});
  });
  it("requires a boundary selection when the drawing contains several pools",()=>{
    const parsed=parseCadDxf(dxf(circle("POOL_OUTLINE",0,0,4)+circle("POOL_OUTLINE",10,0,2,"AC")));
    const p=previewCadImport(parsed);expect(p.candidates).toHaveLength(2);expect(p.boundary).toBeNull();
    expect(previewCadImport(parsed,{boundaryId:p.candidates[1].id}).boundary.geometry.radius).toBe(2);
    expect(()=>applyCadImport(project(),p)).toThrow(/boundary/);
  });
  it("joins an unordered/reversed closed boundary without inventing closure for an open one",()=>{
    const shuffled=line([10,8],[10,0])+line([0,0],[10,0])+line([0,8],[0,0])+line([10,8],[0,8]);
    expect(previewCadImport(parseCadDxf(dxf(shuffled))).boundary.area).toBeCloseTo(80);
    const p=previewCadImport(parseCadDxf(dxf(line([0,0],[10,0])+line([10,0],[10,8]))));
    expect(p.boundary).toBeNull();expect(p.warnings.join(" ")).toMatch(/Open/);
  });
  it("imports R12 POLYLINE and curved LWPOLYLINE boundaries",()=>{
    const old="0\nPOLYLINE\n8\nPOOL_OUTLINE\n66\n1\n70\n1\n"+[[0,0],[10,0],[10,8],[0,8]].map(([x,y])=>`0\nVERTEX\n10\n${x}\n20\n${y}\n`).join("")+"0\nSEQEND\n";
    expect(previewCadImport(parseCadDxf(dxf(old))).boundary.area).toBeCloseTo(80);
    const bulge="0\nLWPOLYLINE\n8\nPOOL_OUTLINE\n90\n3\n70\n1\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n10\n5\n20\n8\n";
    const p=previewCadImport(parseCadDxf(dxf(bulge)));
    expect(p.boundary.points.length).toBeGreaterThan(50);
    expect(p.boundary.area).toBeGreaterThan(75);
    expect(p.warnings.join(" ")).toMatch(/approximated/);
  });
  it.each([{type:"circle",center:{x:3,y:5},radius:4},{type:"ellipse",center:{x:3,y:5},rx:4,ry:7}])("preserves native curved geometry $type",geometry=>{
    const original={...project(),geometry};
    const p=previewCadImport(parseCadDxf(exportCadDxf(original)));
    expect(p.boundary.geometry).toEqual(geometry);
  });
  it("uses one fixture anchor per scaled/rotated CAD block",()=>{
    const blocks="0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nJET\n10\n0\n20\n0\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n0.12\n0\nENDBLK\n0\nENDSEC\n";
    const insert="0\nINSERT\n5\nAC\n8\nNOZZLES\n2\nJET\n10\n4\n20\n-6\n41\n2\n42\n2\n50\n90\n";
    const p=previewCadImport(parseCadDxf(dxf(square+insert,6,blocks)));
    expect(p.fixtures).toHaveLength(1);expect(p.fixtures[0]).toMatchObject({x:4,y:6,rotation:-90});
  });
  it("expands a pool block with translation, rotation, scale and a nonzero base point",()=>{
    const shape="0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n1\n20\n2\n10\n3\n20\n2\n10\n3\n20\n3\n10\n1\n20\n3\n";
    const blocks=`0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nBASIN\n10\n1\n20\n2\n${shape}0\nENDBLK\n0\nENDSEC\n`;
    const insert="0\nINSERT\n8\nPOOL_OUTLINE\n2\nBASIN\n10\n10\n20\n20\n41\n2\n42\n2\n50\n90\n";
    const p=previewCadImport(parseCadDxf(dxf(insert,6,blocks)),{flipY:false});
    expect(p.boundary.area).toBeCloseTo(8);expect(p.boundary.points[0].x).toBeCloseTo(10);expect(p.boundary.points[0].y).toBeCloseTo(20);
  });
  it("maps arbitrary CAD layers explicitly and collapses point/circle duplicate markers",()=>{
    const parsed=parseCadDxf(dxf(circle("A-SITE",0,0,10)+circle("W-JETS",2,3,.1)+"0\nPOINT\n8\nW-JETS\n10\n2\n20\n3\n"));
    expect(previewCadImport(parsed).fixtures).toHaveLength(0);
    const p=previewCadImport(parsed,{roles:{"A-SITE":"pool","W-JETS":"nozzle"}});
    expect(p.fixtures).toHaveLength(1);expect(p.warnings.join(" ")).toMatch(/Duplicate/);
  });
  it("skips reversed extrusion instead of silently mirroring the pool",()=>{
    const p=previewCadImport(parseCadDxf(dxf(circle("POOL_OUTLINE",0,0,4)+"210\n0\n220\n0\n230\n-1\n")));
    expect(p.boundary).toBeNull();expect(p.warnings.join(" ")).toMatch(/extrusion/);
  });
  it("rejects DWG, binary DXF, incomplete DXF, invalid coordinates and duplicate identities",()=>{
    expect(()=>parseCadDxf("AC1032")).toThrow(/DWG/);
    expect(()=>parseCadDxf("AutoCAD Binary DXF")).toThrow(/Binary/);
    expect(()=>parseCadDxf(dxf(square).replace("0\nEOF\n",""))).toThrow(/incomplete/);
    expect(()=>previewCadImport(parseCadDxf(dxf(circle("POOL_OUTLINE","NaN",0,4))))).toThrow();
    const original=project();original.fixtures.push({...original.fixtures[0],x:7});
    expect(()=>exportCadDxf(original)).toThrow(/unique/);
  });
  it("preserves project identity and all hardware records when undoing a CAD import",()=>{
    const original=project(), next=applyCadImport(original,previewCadImport(parseCadDxf(exportCadDxf(original))),{mode:"new"});
    const h=commitEngineeringHistory(createEngineeringHistory(original),next);
    expect(undoEngineeringHistory(h).present).toEqual(original);
  });
});
