import * as THREE from '../../aquaflow/frontend/node_modules/three/build/three.module.js';
import { OrbitControls } from '../../aquaflow/frontend/node_modules/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../../aquaflow/frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { unzipSync, strFromU8 } from '../../aquaflow/frontend/node_modules/three/examples/jsm/libs/fflate.module.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const state = { data: null, files: null, duration: 30, time: 0, playing: false, recording: false, last: performance.now(), quality: 'balanced', jets: [], groups: new Map(), recipes: [], center: { x: 0, y: 0 }, water: null, droplets: null, jetCores: [], foam: [], siteRoot: null, fpsFrames: 0, fpsAt: performance.now() };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
$('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91b7c5);
scene.fog = new THREE.FogExp2(0xa9c5cc, 0.012);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.05, 500);
camera.position.set(9, 8, -16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.target.set(0, 0.3, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 2;
controls.maxDistance = 80;

const hemi = new THREE.HemisphereLight(0xcfefff, 0x4b4739, 1.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0ce, 3.1);
sun.position.set(-12, 18, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
sun.shadow.camera.right = sun.shadow.camera.top = 24;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 55;
sun.shadow.bias = -0.00015;
scene.add(sun);

const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { uTop: { value: new THREE.Color(0x4b8eb1) }, uHorizon: { value: new THREE.Color(0xd9e8e7) }, uGround: { value: new THREE.Color(0x75816c) } },
  vertexShader: `varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `varying vec3 vWorld;uniform vec3 uTop,uHorizon,uGround;void main(){float h=normalize(vWorld).y;vec3 c=h>0.?mix(uHorizon,uTop,pow(h,.55)):mix(uHorizon,uGround,min(1.,-h*2.));gl_FragColor=vec4(c,1.);}`
}));
scene.add(sky);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ color: 0x9b998d, roughness: 0.92, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.58;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(160, 160, 0xffffff, 0xffffff);
grid.position.y = -0.572;
grid.material.opacity = 0.055;
grid.material.transparent = true;
scene.add(grid);

const waterVertex = `
  uniform float uTime,uWave;uniform int uImpactCount;uniform vec3 uImpacts[32];uniform float uImpactPower[32];varying vec3 vNormalW;varying vec3 vWorld;varying float vFoam;
  float heightAt(vec2 p){float h=sin(dot(p,vec2(.82,.57))*2.2+uTime*1.05)*.016;h+=sin(dot(p,vec2(-.31,.95))*4.1-uTime*1.52)*.008;h+=sin(dot(p,vec2(.96,-.28))*7.7+uTime*2.1)*.0035;float foam=0.;for(int i=0;i<32;i++){if(i>=uImpactCount)break;float d=distance(p,uImpacts[i].xz);float q=uImpactPower[i];h+=sin(d*9.5-uTime*5.8)*exp(-d*.72)*.016*q;foam+=smoothstep(.22,.0,abs(d-mod(uTime*.34,1.8)))*q;}vFoam=foam;return h*uWave;}
  void main(){vec3 p=position;float e=.035;float h=heightAt(p.xz);float hx=heightAt(p.xz+vec2(e,0.));float hz=heightAt(p.xz+vec2(0.,e));p.y+=h;vec3 n=normalize(vec3(h-hx,e,h-hz));vNormalW=normalize(mat3(modelMatrix)*n);vWorld=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`;
const waterFragment = `
  precision highp float;uniform float uTime,uClarity;uniform vec3 uSunDir;varying vec3 vNormalW;varying vec3 vWorld;varying float vFoam;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float caustic(vec2 p){float a=sin(p.x*4.8+sin(p.y*3.2+uTime))*sin(p.y*5.3-sin(p.x*2.7-uTime*.8));return pow(max(0.,a),5.);}
  void main(){vec3 N=normalize(vNormalW);vec3 V=normalize(cameraPosition-vWorld);float ndv=max(dot(N,V),0.);float fresnel=.02+.98*pow(1.-ndv,5.);vec3 sky=mix(vec3(.70,.86,.90),vec3(.18,.43,.58),clamp(reflect(-V,N).y*.5+.5,0.,1.));float depthTint=mix(.28,.82,uClarity);vec3 body=mix(vec3(.015,.19,.24),vec3(.11,.55,.65),depthTint);vec3 H=normalize(V+normalize(uSunDir));float spec=pow(max(dot(N,H),0.),190.)*2.8;float c=caustic(vWorld.xz)*.12;vec3 col=mix(body+c*vec3(.55,.95,1.),sky,fresnel)+spec*vec3(1.,.88,.68);col=mix(col,vec3(.82,.96,.97),clamp(vFoam*.34,0.,.65));float alpha=mix(.80,.94,fresnel);gl_FragColor=vec4(col,alpha);}`;

function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (((a.z > z) !== (b.z > z)) && x < (b.x - a.x) * (z - a.z) / ((b.z - a.z) || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

function densePolygonGeometry(points, divisions) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  const nx = divisions, nz = Math.max(16, Math.round(divisions * (maxZ - minZ) / Math.max(.1, maxX - minX)));
  const dx = (maxX - minX) / nx, dz = (maxZ - minZ) / nz;
  const verts = [], indices = [];
  for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) verts.push(minX + ix * dx, 0, minZ + iz * dz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const cx = minX + (ix + .5) * dx, cz = minZ + (iz + .5) * dz;
    if (!pointInPolygon(cx, cz, points)) continue;
    const a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

function shapeGeometry(points) {
  const s = new THREE.Shape();
  points.forEach((p, i) => i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z));
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function materialForSurface(surface) {
  const kind = String(surface.type || '').toLowerCase();
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(surface.color || (kind.includes('grass') ? '#4f7839' : '#9f9a8d')), roughness: kind.includes('grass') ? .96 : .84, metalness: 0 });
}

function clearProject() {
  if (state.siteRoot) scene.remove(state.siteRoot);
  state.siteRoot = new THREE.Group();
  scene.add(state.siteRoot);
  state.jets = []; state.groups.clear(); state.recipes = []; state.water = null; state.droplets = null; state.jetCores = []; state.foam = [];
}

function normalizeProject(data) {
  const eng = data.engineering || data.engineeringProject || {};
  const fixtures = Array.isArray(eng.fixtures) ? eng.fixtures : [];
  const nozzles = fixtures.filter(f => String(f.type || '').startsWith('nozzle_') || /jet|nozzle/i.test(f.type || ''));
  let raw = eng.geometry?.points || [];
  if (raw.length < 3) {
    const xs = nozzles.map(f => Number(f.x) || 0), zs = nozzles.map(f => Number(f.y ?? f.z) || 0);
    const minX = Math.min(...xs, -5), maxX = Math.max(...xs, 5), minZ = Math.min(...zs, -3), maxZ = Math.max(...zs, 3);
    raw = [{x:minX-1,y:minZ-1},{x:maxX+1,y:minZ-1},{x:maxX+1,y:maxZ+1},{x:minX-1,y:maxZ+1}];
  }
  const cx = raw.reduce((s,p)=>s+(Number(p.x)||0),0)/raw.length;
  const cz = raw.reduce((s,p)=>s+(Number(p.y ?? p.z)||0),0)/raw.length;
  state.center = { x: cx, y: cz };
  const points = raw.map(p => ({ x:(Number(p.x)||0)-cx, z:(Number(p.y ?? p.z)||0)-cz }));
  return { eng, fixtures, nozzles, points };
}

async function buildProject(data, files) {
  clearProject();
  state.data = data; state.files = files; state.duration = Math.max(.1, Number(data.show?.duration) || 30); state.time = 0;
  const { eng, fixtures, nozzles, points } = normalizeProject(data);
  const root = state.siteRoot;

  const basinFloor = new THREE.Mesh(shapeGeometry(points), new THREE.MeshStandardMaterial({ color: 0x6b9baa, roughness: .34, metalness: .02 }));
  basinFloor.position.y = -.42; basinFloor.receiveShadow = true; root.add(basinFloor);
  const tile = new THREE.Mesh(shapeGeometry(points), new THREE.MeshStandardMaterial({ color: 0xa5d2dc, roughness: .6, transparent: true, opacity: .24 }));
  tile.position.y = -.405; root.add(tile);

  const qDiv = state.quality === 'eco' ? 72 : state.quality === 'cinematic' ? 170 : 112;
  const impacts = Array.from({length:32},()=>new THREE.Vector3());
  const powers = Array.from({length:32},()=>0);
  const mat = new THREE.ShaderMaterial({ transparent:true, depthWrite:true, side:THREE.DoubleSide, vertexShader:waterVertex, fragmentShader:waterFragment, uniforms:{ uTime:{value:0},uWave:{value:.44},uClarity:{value:.72},uSunDir:{value:new THREE.Vector3().copy(sun.position).normalize()},uImpactCount:{value:Math.min(32,nozzles.length)},uImpacts:{value:impacts},uImpactPower:{value:powers} } });
  state.water = new THREE.Mesh(densePolygonGeometry(points, qDiv), mat); state.water.position.y = -.04; state.water.renderOrder = 2; root.add(state.water);

  const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p.x,.03,p.z)), true, 'centripetal');
  const rim = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(80,points.length*2), .105, 8, true), new THREE.MeshStandardMaterial({color:0xd9d2be,roughness:.52}));
  rim.castShadow = rim.receiveShadow = true; root.add(rim);

  for (const surface of (eng.site_surfaces || [])) {
    const ps = (surface.points || []).map(p=>({x:(Number(p.x)||0)-state.center.x,z:(Number(p.y ?? p.z)||0)-state.center.y}));
    if(ps.length<3) continue;
    const mesh = new THREE.Mesh(shapeGeometry(ps), materialForSurface(surface)); mesh.position.y=(Number(surface.elevation)||0)-.54; mesh.receiveShadow=true; root.add(mesh);
  }

  const lightFixtures = fixtures.filter(f => String(f.type || '').startsWith('light_'));
  for (const f of lightFixtures) {
    const x=(Number(f.x)||0)-state.center.x,z=(Number(f.y ?? f.z)||0)-state.center.y;
    const disc=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.025,18),new THREE.MeshStandardMaterial({color:0xe8fbff,emissive:new THREE.Color(f.color||'#9deaff'),emissiveIntensity:4,roughness:.2}));
    disc.position.set(x,-.015,z);root.add(disc);
  }

  state.jets = nozzles.slice(0,32).map((f,i)=>({ id:f.id,index:i,x:(Number(f.x)||0)-state.center.x,z:(Number(f.y ?? f.z)||0)-state.center.y,groupId:f.groupId||'',height:clamp(Number(f.engineering?.jetHeightM)||.8,.12,4),intensity:0 }));
  for (const g of (data.programmer?.studio?.groups || [])) state.groups.set(g.id, g);
  state.recipes = (data.programmer?.studio?.recipes || []).filter(r => !r.muted);
  makeJets(root);
  addFallbackSculpture(root, points);
  await loadPackagedModels(data, files, root).catch(e=>toast(`Embedded model skipped: ${e.message}`));
  fitCamera(points, data.render);
  $('project').textContent=data.show?.name||data.project?.name||'AquaFlow project'; $('jets').textContent=state.jets.length; $('duration').textContent=`${state.duration.toFixed(1)} s`; $('end').textContent=formatTime(state.duration); $('drop').classList.add('hidden');
  toast(`Loaded ${state.jets.length} nozzles · ${state.duration.toFixed(1)} second show`);
}

function makeJets(root) {
  const count=state.jets.length, per=state.quality==='eco'?42:state.quality==='cinematic'?120:72;
  const pos=[],origin=[],phase=[],index=[],seed=[];
  for(let j=0;j<count;j++)for(let i=0;i<per;i++){pos.push(0,0,0);origin.push(state.jets[j].x,0,state.jets[j].z);phase.push(i/per);index.push(j);seed.push(((i*73+j*19)%101)/101);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('aOrigin',new THREE.Float32BufferAttribute(origin,3));geo.setAttribute('aPhase',new THREE.Float32BufferAttribute(phase,1));geo.setAttribute('aIndex',new THREE.Float32BufferAttribute(index,1));geo.setAttribute('aSeed',new THREE.Float32BufferAttribute(seed,1));
  const uniforms={uTime:{value:0},uSpray:{value:.58},uIntensity:{value:Array.from({length:32},()=>0)},uHeight:{value:Array.from({length:32},(_,i)=>state.jets[i]?.height||.5)},uCenter:{value:new THREE.Vector2(0,0)}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.NormalBlending,uniforms,vertexShader:`uniform float uTime,uSpray;uniform float uIntensity[32],uHeight[32];attribute vec3 aOrigin;attribute float aPhase,aIndex,aSeed;varying float vAlpha,vGlint;void main(){int ix=int(aIndex+.5);float power=uIntensity[ix];float age=fract(aPhase+uTime*(.72+aSeed*.12));float h=uHeight[ix]*(.14+.86*power);float y=4.*h*age*(1.-age);vec2 inward=normalize(-aOrigin.xz+vec2(.0001));float drift=(age*age)*h*.16;float jitter=sin(age*35.+aSeed*31.)*.012*uSpray;vec3 p=aOrigin+vec3(inward.x*drift+jitter,y,inward.y*drift-jitter);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=(1.1+uSpray*2.4)*(34./max(3.,-mv.z))*smoothstep(0.,.08,power);vAlpha=smoothstep(0.,.05,power)*(.28+.48*sin(3.14159*age));vGlint=aSeed;}`,fragmentShader:`varying float vAlpha,vGlint;void main(){vec2 q=gl_PointCoord-.5;float d=length(q);if(d>.5)discard;float a=smoothstep(.5,.08,d)*vAlpha;vec3 c=mix(vec3(.35,.77,.88),vec3(.95,1.,1.),smoothstep(.15,.5,gl_PointCoord.y)+vGlint*.18);gl_FragColor=vec4(c,a);}`});
  state.droplets=new THREE.Points(geo,material);state.droplets.frustumCulled=false;state.droplets.renderOrder=4;root.add(state.droplets);
  const coreMat=new THREE.MeshPhysicalMaterial({color:0xa8e9f1,roughness:.05,metalness:0,transmission:.35,transparent:true,opacity:.48,depthWrite:false,ior:1.333,emissive:0x174b58,emissiveIntensity:.25});
  for(const jet of state.jets){const core=new THREE.Mesh(new THREE.CylinderGeometry(.028,.058,1,10,1,true),coreMat.clone());core.position.set(jet.x,.5,jet.z);core.scale.y=.01;core.renderOrder=3;root.add(core);state.jetCores.push(core);const foam=new THREE.Mesh(new THREE.RingGeometry(.09,.15,30),new THREE.MeshBasicMaterial({color:0xe9ffff,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false}));foam.rotation.x=-Math.PI/2;foam.position.set(jet.x,-.015,jet.z);root.add(foam);state.foam.push(foam);}
}

function addFallbackSculpture(root, points){
  const radius=Math.max(1.1,Math.min(2.3,(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)))*.12));
  const base=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius*1.1,.25,64),new THREE.MeshStandardMaterial({color:0x83786b,roughness:.32,metalness:.22}));base.position.y=.1;base.castShadow=true;root.add(base);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(radius*.58,.13,24,96),new THREE.MeshPhysicalMaterial({color:0xcbd1d1,metalness:.82,roughness:.12,clearcoat:1}));ring.position.y=radius*.63+.2;ring.rotation.x=.15;ring.castShadow=true;ring.userData.fallback=true;root.add(ring);
}

async function loadPackagedModels(data,files,root){if(!files)return;const assets=data.assetManifest?.assets||[];let loaded=0;for(const asset of assets){if(asset.role!=='site_model'||!asset.packaged)continue;const bytes=files[asset.packaged];if(!bytes)continue;const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});root.add(gltf.scene);loaded++;}if(loaded){root.children.filter(o=>o.userData?.fallback).forEach(o=>o.visible=false);}}

function fitCamera(points,render){const view=(render?.cameraViews||[]).find(v=>v.id===render?.activeCameraView)||(render?.cameraViews||[])[0];if(view?.position){camera.position.set(view.position.x,view.position.y,view.position.z);const t=view.target||{x:0,y:0,z:0};controls.target.set(t.x,t.y,t.z);}else{const span=Math.max(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z)));camera.position.set(span*.58,span*.52,-span*.95);controls.target.set(0,0,0);}controls.update();}

function envelopeValue(points,t){if(!points?.length)return 1;if(t<=points[0].time)return points[0].value;if(t>=points.at(-1).time)return points.at(-1).value;for(let i=1;i<points.length;i++){if(t<=points[i].time){const a=points[i-1],b=points[i],q=(t-a.time)/(b.time-a.time);return lerp(a.value,b.value,q);}}return 0;}
function timelineLevel(t){const tracks=state.data?.timelineTracks||[];let value=0;for(const track of tracks){if(track.muted||!/water|jet|pump|ring/i.test(`${track.id} ${track.label} ${track.type}`))continue;for(const c of track.clips||[])if(t>=c.start&&t<c.end)value=Math.max(value,(Number(c.intensity)||0)/100);}return value||.32;}
function evaluateJets(t){const fallback=timelineLevel(t);const values=Array(state.jets.length).fill(0);let programmed=false;for(const r of state.recipes){if(!/water|jet|front|left|right|tip/i.test(`${r.groupId} ${r.name}`))continue;const group=state.groups.get(r.groupId);if(!group)continue;const members=group.memberFixtureIds||[];const dur=Math.max(.1,Number(r.duration)||state.duration);let local=(t-(Number(r.start)||0))/dur;if(local<0||local>1)continue;const cycles=Math.max(1,Math.round(Number(r.cycles)||1));members.forEach((id,k)=>{const ji=state.jets.findIndex(j=>j.id===id);if(ji<0)return;const orderPhase=members.length>1?k/(members.length-1):0;const phase=((local*cycles-orderPhase*(Number(r.spread)||0))%1+1)%1;let e=r.effect==='static'?1:envelopeValue(r.envelope||[{time:0,value:.3},{time:.5,value:1},{time:1,value:.3}],phase);values[ji]=Math.max(values[ji],e*(Number(r.intensity)||50)/100);programmed=true;});}if(!programmed)values.fill(fallback);return values;}

function updateWater(t){if(!state.water)return;const values=evaluateJets(t);state.water.material.uniforms.uTime.value=t;state.water.material.uniforms.uWave.value=Number($('waves').value)/100;state.water.material.uniforms.uClarity.value=Number($('clarity').value)/100;const p=state.water.material.uniforms.uImpactPower.value;const imp=state.water.material.uniforms.uImpacts.value;values.forEach((v,i)=>{state.jets[i].intensity=v;p[i]=v;imp[i].set(state.jets[i].x,0,state.jets[i].z);});if(state.droplets){state.droplets.material.uniforms.uTime.value=t;state.droplets.material.uniforms.uSpray.value=Number($('spray').value)/100;state.droplets.material.uniforms.uIntensity.value=values;}state.jetCores.forEach((m,i)=>{const jet=state.jets[i],v=values[i]||0,h=jet.height*(.14+.86*v);m.visible=v>.015;m.position.y=h*.5-.01;m.scale.set(.65+v*.45,h,.65+v*.45);m.material.opacity=.24+.38*v;});state.foam.forEach((m,i)=>{const v=values[i]||0,q=(t*.38+i*.17)%1;m.scale.setScalar(.7+q*2.6);m.material.opacity=(1-q)*v*.38;});}

function formatTime(v){const m=Math.floor(v/60),s=Math.floor(v%60),cs=Math.floor((v%1)*100);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;}
function renderFrame(now){requestAnimationFrame(renderFrame);const dt=Math.min(.5,(now-state.last)/1000);state.last=now;if(state.playing&&state.data){state.time+=dt;if(state.time>=state.duration){state.time=state.recording?state.duration:state.time%state.duration;if(state.recording)state.playing=false;}updateWater(state.time);}$('time').textContent=formatTime(state.time);$('progress').style.width=`${100*state.time/state.duration}%`;controls.update();renderer.render(scene,camera);state.fpsFrames++;if(now-state.fpsAt>1000){$('fps').textContent=`${Math.round(state.fpsFrames*1000/(now-state.fpsAt))} fps`;state.fpsFrames=0;state.fpsAt=now;}}
requestAnimationFrame(renderFrame);

async function readFile(file){try{const bytes=new Uint8Array(await file.arrayBuffer());let data,files=null;if(file.name.toLowerCase().endsWith('.aquapkg')||bytes[0]===80&&bytes[1]===75){files=unzipSync(bytes);if(!files['project.aqua'])throw new Error('Package has no project.aqua');data=JSON.parse(strFromU8(files['project.aqua']));}else data=JSON.parse(new TextDecoder().decode(bytes));if(!data?.aquaflow)throw new Error('Not a valid AquaFlow project');await buildProject(data,files);}catch(e){toast(`Could not open file: ${e.message}`,5000);}}
function toast(message,ms=2600){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),ms);}

for(const id of ['file','fileWelcome'])$(id).addEventListener('change',e=>{if(e.target.files?.[0])readFile(e.target.files[0]);e.target.value='';});
$('play').onclick=()=>{if(!state.data)return toast('Open an AquaFlow file first');if(state.time>=state.duration-.02)state.time=0;state.playing=!state.playing;$('play').textContent=state.playing?'❚❚':'▶';};
$('timeline').onclick=e=>{if(!state.data)return;const r=e.currentTarget.getBoundingClientRect();state.time=clamp((e.clientX-r.left)/r.width)*state.duration;updateWater(state.time);};
$('camera').onclick=()=>state.data&&fitCamera(normalizeProject(state.data).points,state.data.render);
$('capture').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download=`${(state.data?.show?.name||'AquaFlow').replace(/[^a-z0-9]+/gi,'_')}_${state.time.toFixed(2)}s.png`;a.click();toast('PNG captured');};
$('record').onclick=async()=>{if(!state.data)return toast('Open an AquaFlow file first');if(!window.MediaRecorder)return toast('This browser cannot record video');const stream=renderer.domElement.captureStream(30),chunks=[];let mime='video/webm;codecs=vp9';if(!MediaRecorder.isTypeSupported(mime))mime='video/webm';const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8_000_000});rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:mime}));a.download=`${(state.data.show?.name||'AquaFlow').replace(/[^a-z0-9]+/gi,'_')}_water.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);state.recording=false;$('record').textContent='Record show';toast('Video saved');};state.time=0;state.recording=true;state.playing=true;$('play').textContent='❚❚';$('record').textContent='Recording…';rec.start();const stop=()=>{if(state.recording&&state.time>=state.duration-.02)rec.stop();else setTimeout(stop,100)};stop();};

function applyQuality(){state.quality=$('quality').value;const ratio=state.quality==='eco'?1:state.quality==='cinematic'?Math.min(devicePixelRatio,2):Math.min(devicePixelRatio,1.5);renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=state.quality!=='eco';$('resolution').textContent=`${renderer.domElement.width}×${renderer.domElement.height}`;if(state.data)buildProject(state.data,state.files);}
$('quality').onchange=applyQuality;
for(const [id,suffix] of [['clarity','%'],['waves','%'],['spray','%'],['sun','°']])$(id).oninput=()=>{$(`${id}Out`).textContent=`${$(id).value}${suffix}`;if(id==='sun'){const a=Number($(id).value)*Math.PI/180;sun.position.set(Math.cos(a)*15,18,Math.sin(a)*15);if(state.water)state.water.material.uniforms.uSunDir.value.copy(sun.position).normalize();}};
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);$('resolution').textContent=`${renderer.domElement.width}×${renderer.domElement.height}`;});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>{e.preventDefault();if(e.dataTransfer.files?.[0])readFile(e.dataTransfer.files[0]);});
applyQuality();

