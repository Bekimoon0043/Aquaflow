/** Scene-space bounds; independent of basin size. Never mutates design fixtures. */
export function fixtureBounds(fixtures,ids){const wanted=new Set(ids);const list=fixtures.filter(f=>wanted.has(f.id)&&Number.isFinite(Number(f.x))&&Number.isFinite(Number(f.z)));if(!list.length)return null;const min={x:Infinity,y:0,z:Infinity},max={x:-Infinity,y:1,z:-Infinity};for(const f of list){min.x=Math.min(min.x,Number(f.x)-.3);max.x=Math.max(max.x,Number(f.x)+.3);min.z=Math.min(min.z,Number(f.z)-.3);max.z=Math.max(max.z,Number(f.z)+.3);max.y=Math.max(max.y,(Number(f.y)||0)+(Number(f.designHeightM)||2));}const center={x:(min.x+max.x)/2,y:(min.y+max.y)/2,z:(min.z+max.z)/2};return {min,max,center,radius:Math.hypot(max.x-min.x,max.y-min.y,max.z-min.z)/2};}
export function isolationWeight(id,ids,ghostOpacity=.15,hidden=[]){if(hidden.has?.(id)||hidden.includes?.(id))return 0;return ids?.size&&!ids.has(id)?Math.max(0,Math.min(1,ghostOpacity)):1;}

/**
 * Signal heat-map colour for a fixture output level 0..1, as 0xRRGGBB.
 * Off is a cool blue, then cyan → green → yellow → red at full output (engineering "jet" scale).
 */
export function heatColor(level) {
  const t = Math.max(0, Math.min(1, Number(level) || 0));
  const stops = [[0, [0x22, 0x44, 0xaa]], [.25, [0x19, 0xb4, 0xd2]], [.5, [0x3c, 0xc8, 0x5a]], [.75, [0xf0, 0xc8, 0x28]], [1, [0xe6, 0x32, 0x28]]];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, a] = stops[i], [t1, b] = stops[i + 1];
  const k = (t - t0) / (t1 - t0);
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
