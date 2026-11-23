from pathlib import Path
import zipfile, json, math, sys
from PIL import Image, ImageDraw, ImageFont

source = Path(sys.argv[1])
out = Path(sys.argv[2])
with zipfile.ZipFile(source) as z:
    project = json.loads(z.read('project.aqua'))
eng = project['engineering']
fixtures = eng['fixtures']
diagonal = set(member for g in eng.get('groups', []) if g.get('id', '').startswith('group-diagonalRainbow') and not g.get('id', '').endswith('Light') for member in g['members'])
W, H = 2400, 1500
im = Image.new('RGB', (W, H), '#071521')
d = ImageDraw.Draw(im)

def font(size, bold=False):
    try:
        return ImageFont.truetype(r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf', size)
    except OSError:
        return ImageFont.load_default()

def text(pos, value, size=23, color='#e7f5ff', bold=False):
    d.text(pos, value, font=font(size, bold), fill=color)

S = 23
OX, OY = 350, 820

def xy(x, y):
    return (OX + x * S, OY - y * S)

def line(points, color, width=2):
    if len(points) > 1:
        d.line(points, fill=color, width=width, joint='curve')

text((65, 34), 'ODAA AND ELDER — DWG-CORRECTED INFINITY FOUNTAIN', 38, '#ffffff', True)
text((65, 84), 'DESIGN-ONLY CAD PLAN  ·  exact DWG E33 pool and FC6 infinity  ·  no choreography yet', 22, '#85d9ef')
text((65, 118), '70.118 × 23.422 m concept boundary  ·  dimensions and equipment require site / supplier verification', 20, '#a8bfd0')

for basin in eng.get('basins', []):
    points = [xy(p['x'], p['y']) for p in basin['outer']]
    d.polygon(points, fill='#0c2c40')
    line(points, '#75d7ef', 5)
    line(points, '#b3efff', 1)

for guide in eng.get('guidePaths', eng.get('guide_paths', [])):
    points = [xy(p['x'], p['y']) for p in guide['points']]
    if len(points) > 1:
        line(points + [points[0]], guide.get('color') or '#ffffff', 2)

for f in fixtures:
    x, y = xy(f['x'], f['y'])
    typ, role = f['type'], f.get('groupId', '')
    if f['id'] in diagonal and not typ.startswith('light_'):
        r = 6
        d.polygon([(x, y-r), (x+r, y), (x, y+r), (x-r, y)], fill='#ff66cc', outline='#ffe0f2')
    elif typ.startswith('light_'):
        r = 2
        d.ellipse((x-r, y-r, x+r, y+r), fill='#85fa92')
    elif typ == 'motion_nozzle_1d_tilt_motor':
        r = 5
        d.polygon([(x, y-r), (x+r, y), (x, y+r), (x-r, y)], fill='#ffd082', outline='#fff0c4')
    elif typ == 'nozzle_solenoid_variodrop_oase':
        r = 6
        d.ellipse((x-r, y-r, x+r, y+r), outline='#ffe39a', width=2)
        d.ellipse((x-2, y-2, x+2, y+2), fill='#ffe39a')
    elif typ.startswith('nozzle_air_shooter'):
        r = 9
        color = '#45caff' if '50m' in f['id'] else '#77e6ff'
        d.ellipse((x-r, y-r, x+r, y+r), fill=color, outline='#d6f5ff', width=2)
        line([(x-12, y), (x+12, y)], color, 2)
        line([(x, y-12), (x, y+12)], color, 2)
    else:
        r = 3
        d.ellipse((x-r, y-r, x+r, y+r), outline='#e6f7ff', width=1)

# Overall dimensions.
y = 1100
line([(xy(0.027, 1.623)[0], y), (xy(70.145, 1.838)[0], y)], '#a4d9e8', 2)
for x in [xy(0.027, 1.623)[0], xy(70.145, 1.838)[0]]:
    line([(x, y-12), (x, y+12)], '#a4d9e8', 2)
text((1020, y+14), '70.118 m · DWG', 23, '#b9e6f2')
text((40, 550), '23.422 m', 22, '#b9e6f2')

# Compact schedule.
d.rectangle((55, 1240, 2345, 1455), fill='#0a1e2d', outline='#315b72', width=2)
text((80, 1260), f'DWG FIXTURE / LIGHT SCHEDULE  ·  {len(fixtures):,} fixtures  ·  0 timeline patterns', 25, '#ffffff', True)
counts = {}
for f in fixtures:
    role = f.get('groupId') or 'other'
    counts[role] = counts.get(role, 0) + 1
entries = [
    ('Infinity 1D', counts.get('infinity', 0), '#ffd082'),
    ('5.5 m ring 1D', counts.get('portraitCircle', 0), '#ffd082'),
    ('10.3 m Vario', counts.get('outerRing', 0), '#ffe39a'),
    ('Straight nozzles', counts.get('rays', 0) + counts.get('pillar-left', 0) + counts.get('pillar-right', 0), '#edfaff'),
    ('Diagonal Rainbow', len(diagonal), '#ff66cc'),
    ('20 m air blasts', sum(1 for f in fixtures if f['type'] == 'nozzle_air_shooter_24e_30m_oase'), '#77e6ff'),
    ('50 m air blasts', sum(1 for f in fixtures if f['type'] == 'nozzle_air_shooter_50e_50m_oase'), '#45caff'),
    ('DMX lights', sum(v for k, v in counts.items() if k.endswith('Light')), '#92ff9d'),
]
for i, (label, count, color) in enumerate(entries):
    col, row = i % 4, i // 4
    x, yy = 90 + col * 570, 1320 + row * 65
    d.rectangle((x, yy+4, x+16, yy+20), fill=color)
    text((x+28, yy), f'{label}: {count}', 23, '#dcecf4')
text((80, 1418), 'Pool E33 with exact bulges  ·  Infinity FC6 with 240 points  ·  Named DWG block positions preserved  ·  Concept only', 19, '#9fb9c9')
im.save(out)
print(out)
