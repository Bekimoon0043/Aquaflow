#!/usr/bin/env python3
"""
generate_brand_assets.py — AquaFlow Studio brand-asset generator (AF-PKG branding).

Builds every packaging graphic from the LuxuryCon shield logo, adding the AquaFlow
water identity (blue droplet + wave accent) so the app is distinguishable in the taskbar.

Outputs (all into aquaflow/desktop/assets/):
    AquaFlow.ico        multi-size app icon  (256/128/64/48/32/16) — taskbar, window, shortcut
    aquashow.ico        .aquashow document icon (same mark, subtle document fold)
    icon.png            256x256 app icon (electron-builder win.icon fallback / About dialog)
    shield.png          clean LuxuryCon shield, trimmed (splash + About)
    splash.png          960x600 branded splash background (shield + wordmark + tagline)
    installerSidebar.bmp 164x314 NSIS welcome/finish sidebar
    installerHeader.bmp  150x57  NSIS page header

Brand system (see BRAND.md): the LuxuryCon shield is the CONSTANT across all platforms;
each platform adds one element + one accent colour. AquaFlow = shield + water + blue.

Requires: Pillow  (pip install Pillow)   — Python 3.9–3.12 recommended.
Run:      py -3.12 aquaflow/desktop/scripts/generate_brand_assets.py
Regenerate whenever the source logo changes.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit("Pillow is required.  Install it with:  pip install Pillow")

# ── brand palette ───────────────────────────────────────────────────────────────
FOREST      = (13, 42, 26)     # #0D2A1A  base forest green
FOREST_DARK = (10, 26, 15)     # #0A1A0F  splash/sidebar background
GOLD        = (201, 162, 39)   # #C9A227  LuxuryCon gold
GOLD_MUTED  = (150, 120, 40)   # muted gold for secondary text
WATER       = (30, 136, 229)   # #1E88E5  AquaFlow signature water-blue
WATER_DARK  = (21, 101, 192)   # #1565C0  droplet outline / shadow
WHITE       = (255, 255, 255)

# ── paths ───────────────────────────────────────────────────────────────────────
HERE      = Path(__file__).resolve().parent          # aquaflow/desktop/scripts
DESKTOP   = HERE.parent                               # aquaflow/desktop
ASSETS    = DESKTOP / "assets"
BUILD     = DESKTOP / "build"                         # electron-builder buildResources

LOGO_DIR  = Path(r"E:/samber coorporation/luxury con/LOGO/New revised LOGO")
SHIELD_SRC_CANDIDATES = [
    LOGO_DIR / "LuxCon Icon.png",        # cleanest shield-only source
    LOGO_DIR / "Pure Logo.psd",
    LOGO_DIR / "LuxCon Full refined.png",
    LOGO_DIR / "LuxCon Full.png",
]


# ── helpers ───────────────────────────────────────────────────────────────────────
def load_shield() -> Image.Image:
    """Load the shield source, autocrop transparent/near-white margins, return RGBA."""
    src = next((p for p in SHIELD_SRC_CANDIDATES if p.exists()), None)
    if src is None:
        sys.exit(f"No shield source found. Looked in: {LOGO_DIR}")
    print(f"  shield source: {src.name}")
    im = Image.open(src).convert("RGBA")

    # If the source is a full logo (tall), keep the shield region (top square-ish area).
    w, h = im.size
    if h > w * 1.15:
        im = im.crop((0, 0, w, int(w * 1.06)))

    return _autocrop(im)


def _autocrop(im: Image.Image, pad_ratio: float = 0.04) -> Image.Image:
    """Trim fully/near transparent borders; if opaque, trim near-white borders."""
    alpha = im.split()[3]
    bbox = alpha.getbbox()
    if bbox is None or (bbox[2] - bbox[0]) < im.width * 0.3:
        # No usable alpha — trim near-white on a white background instead.
        rgb = im.convert("RGB")
        bg = Image.new("RGB", rgb.size, (255, 255, 255))
        from PIL import ImageChops
        diff = ImageChops.difference(rgb, bg)
        bbox = diff.getbbox()
    if bbox:
        pad = int(max(im.size) * pad_ratio)
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad))
        im = im.crop(bbox)
    return im


def _fit(im: Image.Image, box: int) -> Image.Image:
    """Scale (preserving aspect) to fit within a box×box square — up OR down."""
    w, h = im.size
    scale = box / max(w, h)
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def _font(names, size: int):
    for n in names:
        for cand in (n, f"C:/Windows/Fonts/{n}"):
            try:
                return ImageFont.truetype(cand, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _draw_droplet(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int,
                  fill, outline, outline_w: int) -> None:
    """A classic teardrop: round bottom + pointed top, centred at (cx, cy) with radius r."""
    # round bottom
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    # pointed top — triangle from the circle's sides up to a point above
    tip_y = cy - int(r * 2.1)
    span = int(r * 0.86)
    draw.polygon([(cx - span, cy - int(r * 0.5)),
                  (cx + span, cy - int(r * 0.5)),
                  (cx, tip_y)], fill=fill)
    if outline_w:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=outline, width=outline_w)
        draw.line([(cx - span, cy - int(r * 0.5)), (cx, tip_y)], fill=outline, width=outline_w)
        draw.line([(cx + span, cy - int(r * 0.5)), (cx, tip_y)], fill=outline, width=outline_w)


def _water_mark(size: int, shield: Image.Image) -> Image.Image:
    """Compose the shield + AquaFlow water droplet on a transparent size×size canvas."""
    S = 1024
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Shield dominates the frame (~78% wide), centred, sitting slightly high so a small
    # water droplet can tuck into its lower point without hiding the "L".
    sh = _fit(shield, int(S * 0.78))
    sx = (S - sh.width) // 2
    sy = int(S * 0.04)
    canvas.alpha_composite(sh, (sx, sy))

    # Small droplet at the shield's lower tip → "water from the shield". Kept compact so the
    # shield stays legible at 16–32 px.
    cx = S // 2
    r = int(S * 0.093)
    cy = sy + sh.height - int(r * 0.4)

    # soft shadow
    d = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    _draw_droplet(ImageDraw.Draw(d), cx, cy + int(S * 0.010), r, (0, 0, 0, 90), None, 0)
    canvas.alpha_composite(d.filter(ImageFilter.GaussianBlur(S * 0.010)))

    d2 = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dd2 = ImageDraw.Draw(d2)
    _draw_droplet(dd2, cx, cy, r, WATER + (255,), WATER_DARK + (255,), max(2, S // 240))
    # specular shine — small, bright, upper-left (reads as a glossy water highlight)
    hx, hy, hr = cx - int(r * 0.34), cy - int(r * 0.30), int(r * 0.20)
    dd2.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 235))
    canvas.alpha_composite(d2)

    return canvas.resize((size, size), Image.LANCZOS)


# ── asset builders ────────────────────────────────────────────────────────────────
def build_all() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    shield = load_shield()

    # shield.png — clean trimmed shield for splash / About
    shield_png = _fit(shield, 512)
    shield_png.save(ASSETS / "shield.png")
    print("  wrote assets/shield.png", shield_png.size)

    # app mark (shield + water) at high res, then derive icon.png + .ico
    mark = _water_mark(512, shield)
    mark.save(ASSETS / "icon.png")
    (BUILD / "icon.png").write_bytes((ASSETS / "icon.png").read_bytes())  # keep buildResources in sync
    print("  wrote assets/icon.png + build/icon.png (256/512)")

    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    mark.save(ASSETS / "AquaFlow.ico", sizes=ico_sizes)
    mark.save(BUILD / "AquaFlow.ico", sizes=ico_sizes)  # buildResources copy for NSIS installer
    print("  wrote assets/AquaFlow.ico + build/AquaFlow.ico", [s[0] for s in ico_sizes])

    # document icon — same mark with a small gold document fold at top-left
    doc = mark.copy()
    dd = ImageDraw.Draw(doc)
    w = doc.width
    dd.polygon([(int(w*0.06), int(w*0.06)), (int(w*0.20), int(w*0.06)),
                (int(w*0.20), int(w*0.20)), (int(w*0.06), int(w*0.20))],
               fill=GOLD + (230,))
    dd.polygon([(int(w*0.16), int(w*0.06)), (int(w*0.20), int(w*0.06)),
                (int(w*0.20), int(w*0.10))], fill=GOLD_MUTED + (255,))
    doc.save(ASSETS / "aquashow.ico", sizes=ico_sizes)
    doc.save(BUILD / "aquashow.ico", sizes=ico_sizes)
    print("  wrote assets/aquashow.ico + build/aquashow.ico")

    _build_splash(shield)
    _build_installer_graphics(shield)
    print("Done. Assets in", ASSETS)


def _build_splash(shield: Image.Image) -> None:
    W, H = 960, 600
    img = Image.new("RGB", (W, H), FOREST_DARK)
    dr = ImageDraw.Draw(img)
    # clean premium look: a single thin water-blue hairline inset as a frame accent
    dr.rectangle([16, 16, W - 17, H - 17], outline=(28, 60, 92), width=2)

    sh = _fit(shield, 220)
    img.paste(sh.convert("RGB"), ((W - sh.width)//2, 70), sh)

    serif = _font(["georgiab.ttf", "georgia.ttf", "timesbd.ttf", "arialbd.ttf"], 54)
    small = _font(["georgia.ttf", "arial.ttf"], 24)
    tiny  = _font(["arial.ttf"], 18)

    def centre(text, y, font, fill):
        bb = dr.textbbox((0, 0), text, font=font)
        dr.text(((W - (bb[2]-bb[0]))//2, y), text, font=font, fill=fill)

    centre("AquaFlow Studio", 320, serif, GOLD)
    centre("by LuxuryCon", 390, small, GOLD_MUTED)
    # loading track (gold on forest) — the app updates status text over this via splash.html
    tx0, tx1, ty = 300, 660, 470
    dr.rounded_rectangle([tx0, ty, tx1, ty+10], radius=5, fill=FOREST)
    dr.rounded_rectangle([tx0, ty, tx0+180, ty+10], radius=5, fill=WATER)
    centre("Exceed Yourself", 520, tiny, GOLD_MUTED)

    img.save(ASSETS / "splash.png")
    print("  wrote assets/splash.png", (W, H))


def _build_installer_graphics(shield: Image.Image) -> None:
    # Sidebar 164x314
    W, H = 164, 314
    side = Image.new("RGB", (W, H), FOREST_DARK)
    dr = ImageDraw.Draw(side)
    for y in range(H):  # vertical gradient forest → darker
        t = y / H
        dr.line([(0, y), (W, y)],
                fill=(int(FOREST_DARK[0]+ (FOREST[0]-FOREST_DARK[0])*(1-t)),
                      int(FOREST_DARK[1]+ (FOREST[1]-FOREST_DARK[1])*(1-t)),
                      int(FOREST_DARK[2]+ (FOREST[2]-FOREST_DARK[2])*(1-t))))
    sh = _fit(shield, 120)
    side.paste(sh.convert("RGB"), ((W - sh.width)//2, 26), sh)
    f = _font(["georgiab.ttf", "arialbd.ttf"], 18)
    fs = _font(["arial.ttf"], 12)
    def c(text, y, font, fill):
        bb = dr.textbbox((0,0), text, font=font); dr.text(((W-(bb[2]-bb[0]))//2, y), text, font=font, fill=fill)
    c("AquaFlow", 168, f, GOLD); c("Studio", 190, f, GOLD)
    c("LuxuryCon", 285, fs, GOLD_MUTED)
    side.save(BUILD / "installerSidebar.bmp", "BMP")
    print("  wrote build/installerSidebar.bmp", (W, H))

    # Header 150x57
    W, H = 150, 57
    head = Image.new("RGB", (W, H), WHITE)
    dr = ImageDraw.Draw(head)
    sh = _fit(shield, 48)
    head.paste(sh.convert("RGB"), (6, (H - sh.height)//2), sh)
    fh = _font(["georgiab.ttf", "arialbd.ttf"], 15)
    dr.text((60, 12), "AquaFlow", font=fh, fill=FOREST)
    dr.text((60, 30), "Studio", font=_font(["arial.ttf"], 12), fill=GOLD_MUTED)
    head.save(BUILD / "installerHeader.bmp", "BMP")
    print("  wrote build/installerHeader.bmp", (W, H))


if __name__ == "__main__":
    build_all()
