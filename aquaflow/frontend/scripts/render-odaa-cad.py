from pathlib import Path
import zipfile, json, math
from PIL import Image, ImageDraw, ImageFont

SOURCE = Path(r'C:\Users\user\Desktop\Odaa_Elder_Infinity_Design.aquapkg')
OUT = Path(r'C:\Users\user\Desktop\Odaa_Elder_Infinity_CAD.png')
with zipfile.ZipFile(SOURCE) as z:
    project = json.loads(z.read('project.aqua'))
eng = project['engineering']
fixtures = eng['fixtures']
W, H = 2400, 1600
S = 45
CX, CY = 1200, 700
im = Image.new('RGB', (W, H), '#071521')
d = ImageDraw.Draw(im)
def font(size, bold=False):
    try: return ImageFont.truetype(r'C:\Windows\Fonts\arialbd.ttf' if bold else r'C:\Windows\Fonts\arial.ttf', size)
    except OSError: return ImageFont.load_default()
def xy(x, y): return (CX + x*S, CY - y*S)
def text(pos, value, size=24, color='#e7f5ff', bold=False): d.text(pos, value, font=font(size, bold), fill=color)
def line(points, color, width=2): d.line(points, fill=color, width=width, joint='curve')
def leader(label_pos, target, title, detail, color):
    x, y = label_pos; tx, ty = target
    end = (x + 380, y + 12) if x < CX else (x - 30, y + 12)
    line([end, (tx, ty)], color, 2)
    d.ellipse((tx-4, ty-4, tx+4, ty+4), fill=color)
    text((x, y), title, 25, color, True)
    text((x, y+34), detail, 21, '#c4d8e5')

# CAD grid, minor 0.5 m / major 2 m.
for x in range(-24, 25):
    px, _ = xy(x, 0)
    line([(px, 130), (px, 1260)], '#17364a' if x % 2 else '#24506a', 1)
for y in range(-14, 15):
    _, py = xy(0, y)
    line([(100, py), (2300, py)], '#17364a' if y % 2 else '#24506a', 1)
text((70, 38), 'ODAA AND ELDER — INFINITY FOUNTAIN', 38, '#ffffff', True)
text((70, 88), 'LAYER-SEPARATED CAD CONCEPT PLAN  ·  40 × 20 m concept  ·  NOT FOR CONSTRUCTION', 22, '#85d9ef')

# Pool fill and double CAD outline.
for basin in eng.get('basins', []):
    pts = [xy(p['x'], p['y']) for p in basin['outer']]
    d.polygon(pts, fill='#0c2c40')
    line(pts, '#75d7ef', 5)
    line(pts, '#b3efff', 1)

# Guides make the three paths readable, not just clouds of points.
for guide in eng.get('guidePaths', []):
    pts = [xy(p['x'], p['y']) for p in guide['points']]
    if len(pts) > 1:
        line(pts + [pts[0]], guide.get('color') or '#ffffff', 3)
ring = [f for f in fixtures if f.get('groupId') == 'ring']
if ring:
    pts = [xy(f['x'], f['y']) for f in ring]
    line(pts + [pts[0]], '#d5f5ff', 2)

# Fixture symbols by engineering role.
for f in fixtures:
    x, y = xy(f['x'], f['y']); typ = f['type']; role = f.get('groupId') or ''
    if typ.startswith('light_'):
        r = 2
        d.ellipse((x-r, y-r, x+r, y+r), fill='#85fa92')
    elif typ == 'motion_nozzle_1d_tilt_motor':
        r = 5
        d.polygon([(x, y-r), (x+r, y), (x, y+r), (x-r, y)], fill='#ffd082', outline='#fff0c4')
    elif typ == 'nozzle_solenoid_variodrop_oase':
        r = 8
        d.ellipse((x-r, y-r, x+r, y+r), outline='#ffe39a', width=3)
        d.ellipse((x-3, y-3, x+3, y+3), fill='#ffe39a')
    elif typ == 'nozzle_air_shooter_50e_50m_oase':
        r = 10
        d.ellipse((x-r, y-r, x+r, y+r), fill='#28bfff', outline='#d6f5ff', width=2)
        line([(x-15, y), (x+15, y)], '#28bfff', 2); line([(x, y-15), (x, y+15)], '#28bfff', 2)
    else:
        r = 3
        d.ellipse((x-r, y-r, x+r, y+r), outline='#e6f7ff', width=1)

# Dimension strings and arrows.
y = 1210
line([(xy(-20, -10)[0], y), (xy(20, -10)[0], y)], '#a4d9e8', 2)
for x in [xy(-20, -10)[0], xy(20, -10)[0]]:
    line([(x, y-12), (x, y+12)], '#a4d9e8', 2)
text((CX-100, y+18), '40.00 m · CONCEPT', 22, '#b9e6f2')
x = 90
line([(x, xy(-20, -10)[1]), (x, xy(-20, 10)[1])], '#a4d9e8', 2)
text((24, 675), '20.00 m', 22, '#b9e6f2')

# Required annotations with leaders.
leader((110, 170), xy(-17, 5), 'POOL SHAPE', 'D-shaped red-line site boundary', '#8ee7ff')
leader((120, 430), xy(-13, 2), 'INFINITY PATH', f"{sum(1 for f in fixtures if f.get('groupId') == 'infinity')} × 1D nozzles · figure-eight", '#ffd082')
leader((120, 850), xy(-11, -1.8), 'BLUE DOTS', '9 × 50 m compressor / air sprays', '#45caff')
leader((1760, 175), xy(0.4, 8.7), 'OUTER CIRCLE', '14 × radial 1D swinging nozzles', '#ffe39a')
leader((1760, 390), xy(3.5, 5.8), 'PORTRAIT CIRCLE', '28 × 1D moving nozzles', '#ffd082')
leader((1770, 610), xy(5.4, 3.5), 'SUN SHAPE', 'Straight nozzles around the circle', '#edfaff')
leader((1770, 900), xy(1.5, -0.4), 'OLD MAN + ODAA', 'Green light only · no water jets', '#92ff9d')
leader((150, 1100), xy(-12.7, -2), 'TWO SIDE SHAPES', 'Straight-nozzle outlines', '#edfaff')
leader((1690, 1100), xy(12.7, -2), 'INNER SHAPES', 'Integrated green lights only', '#92ff9d')

# Compact layer schedule.
d.rectangle((55, 1320, 2345, 1550), fill='#0a1e2d', outline='#315b72', width=2)
text((80, 1340), 'FIXTURE / LIGHT SCHEDULE', 24, '#ffffff', True)
counts = {}
for f in fixtures:
    role = f.get('groupId') or 'other'
    counts[role] = counts.get(role, 0) + 1
entries = [
    ('Infinity 1D', counts.get('infinity', 0), '#ffd082'),
    ('Portrait-circle 1D', counts.get('portraitCircle', 0), '#ffd082'),
    ('Outer radial 1D', counts.get('outerRing', 0), '#ffe39a'),
    ('50 m sprays', counts.get('compressors', 0), '#45caff'),
    ('Straight nozzles', sum(1 for f in fixtures if f['type'] == 'nozzle_straight_dn15'), '#edfaff'),
    ('RGB lights', sum(1 for f in fixtures if f['type'].startswith('light_')), '#92ff9d'),
]
for i, (label, count, color) in enumerate(entries):
    col = i % 3; row = i // 3
    x = 90 + col*750; yy = 1390 + row*65
    d.rectangle((x, yy+4, x+16, yy+20), fill=color)
    text((x+28, yy), f'{label}: {count}', 24, '#dcecf4')
text((80, 1520), 'Concept visualization only. Supplier data, hydraulics, compressed air, electrical mapping, splash containment and commissioning remain unverified.', 19, '#9fb9c9')
im.save(OUT)
print(OUT)
