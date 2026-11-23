from pathlib import Path
import json, math, sys, ezdxf
from ezdxf.math import bulge_to_arc

src = Path(sys.argv[1])
out = Path(sys.argv[2])
doc = ezdxf.readfile(src)
ms = doc.modelspace()
CENTER = (35.0481, 14.1233)

def p3(p):
    return [round(p[0] / 1000, 4), round(p[1] / 1000, 4)]

def leaf(entity):
    if entity.dxftype() == 'INSERT':
        for child in entity.virtual_entities():
            yield from leaf(child)
    else:
        yield entity

def circle_points(entity):
    return [p3(x.dxf.center) for x in leaf(entity) if x.dxftype() == 'CIRCLE']

def unique(points, digits=3):
    result, seen = [], set()
    for x, y in points:
        key = (round(x, digits), round(y, digits))
        if key not in seen:
            seen.add(key)
            result.append([round(x, 4), round(y, 4)])
    return result

def sampled_path(entity, spacing=0.25):
    points = []
    vertices = list(entity.get_points())
    for a, b in zip(vertices, vertices[1:]):
        if not a[4]:
            length = math.hypot(b[0] - a[0], b[1] - a[1]) / 1000
            steps = max(1, math.ceil(length / spacing))
            for i in range(steps):
                t = i / steps
                points.append([(a[0] + (b[0] - a[0]) * t) / 1000, (a[1] + (b[1] - a[1]) * t) / 1000])
            continue
        center, _, _, radius = bulge_to_arc(a[:2], b[:2], a[4])
        radius /= 1000
        start = math.atan2(a[1] - center.y, a[0] - center.x)
        end = math.atan2(b[1] - center.y, b[0] - center.x)
        span = (end - start) % (2 * math.pi) if a[4] > 0 else -((start - end) % (2 * math.pi))
        steps = max(1, math.ceil(abs(span) * radius / spacing))
        for i in range(steps + 1):
            angle = start + span * i / steps
            points.append([center.x / 1000 + radius * math.cos(angle), center.y / 1000 + radius * math.sin(angle)])
    if vertices:
        points.append(p3(vertices[-1]))
    return unique(points, 4)

pool = sampled_path(doc.entitydb.get('E33'), 0.15)
pool.append(pool[0])
infinity = [p3(p) for p in doc.entitydb.get('FC6').get_points()]
one_d = [{'x': p3(e.dxf.insert)[0], 'y': p3(e.dxf.insert)[1], 'rotation': round(e.dxf.rotation, 3)}
         for e in ms.query('INSERT') if e.dxf.name == 'yiweipentou']
central_lights = unique([p3(e.dxf.insert) for e in ms.query('INSERT') if e.dxf.name == '灯（平面）'])
air20 = [p3(e.dxf.insert) for e in ms.query('INSERT') if e.dxf.name == 'rerrt45']
air50 = [p3(e.dxf.insert) for e in ms.query('INSERT') if e.dxf.name == '111']

central_straight = []
for e in ms.query('INSERT'):
    if e.dxf.name.startswith('*U') and 335 <= int(e.dxf.name[2:]) <= 419 and len(doc.blocks.get(e.dxf.name)) in (2, 4):
        central_straight.extend(circle_points(e))
central_straight = unique(p for p in central_straight
    if math.hypot(p[0] - CENTER[0], p[1] - CENTER[1]) < 20)

pillars = {}
for side, handles in [('left', ['F2C', 'F40', 'F43', 'F5D', 'U303']), ('right', ['F9D', 'FAF', 'FB2', 'FC1', 'U327'])]:
    points = []
    for handle in handles:
        entity = next(e for e in ms.query('INSERT') if e.dxf.name == f'*{handle}') if handle.startswith('U') else doc.entitydb.get(handle)
        if entity.dxftype() == 'INSERT':
            points.extend(circle_points(entity))
        else:
            points.extend(sampled_path(entity, 0.25))
    pillars[side] = unique(points)

layout = {
    'source': str(src), 'units': 'drawing units interpreted as millimetres; 68469 dimension confirms the scale',
    'pool': pool, 'infinity': infinity, 'oneD': one_d, 'centralLights': central_lights,
    'air20': air20, 'air50': air50, 'centralStraight': central_straight, 'pillars': pillars,
    'guides': {'oneDRadiusM': 5.5, 'varioRadiusM': 10.3, 'center': list(CENTER)},
}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'pool': len(pool), 'infinity': len(infinity), 'oneD': len(one_d), 'centralLights': len(central_lights),
    'air20': len(air20), 'air50': len(air50), 'centralStraight': len(central_straight),
    'pillars': {k: len(v) for k, v in pillars.items()}}, indent=2))
print(out)
