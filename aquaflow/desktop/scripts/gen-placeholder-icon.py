#!/usr/bin/env python3
"""
AF-PKG-005 — generate a BRANDED PLACEHOLDER app icon (build/icon.png, 256x256).

Pure stdlib (no Pillow). LuxuryCon brand: forest green #0D2A1A background with a gold
#C9A227 ring mark. electron-builder converts this PNG to icon.ico at pack time.

>>> PLACEHOLDER ONLY <<< The CEO must supply the real LuxuryCon logo (>=512x512 PNG);
drop it in as build/icon.png (or build/icon.ico) to replace this.
"""
import struct
import zlib
from pathlib import Path

SIZE = 256
FOREST = (0x0D, 0x2A, 0x1A)
GOLD = (0xC9, 0xA2, 0x27)


def _px(x, y):
    cx, cy = SIZE / 2.0, SIZE / 2.0
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    # Gold ring (annulus) as a clean placeholder logo mark.
    if 78 <= d <= 100:
        return GOLD
    # Gold centre dot.
    if d <= 30:
        return GOLD
    # Thin gold rounded border frame.
    m = 12
    if (m <= x < SIZE - m and m <= y < SIZE - m) and not (m + 4 <= x < SIZE - m - 4 and m + 4 <= y < SIZE - m - 4):
        return GOLD
    return FOREST


def build_png(path: Path):
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type 0 per scanline
        for x in range(SIZE):
            raw += bytes(_px(x, y))
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"[gen-icon] wrote {path} ({len(png)} bytes) — PLACEHOLDER, swap for the real logo")


if __name__ == "__main__":
    build_png(Path(__file__).resolve().parents[1] / "build" / "icon.png")
