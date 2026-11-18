"""Original deterministic water-sprite textures; no external assets or dependencies."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


def unit(index, channel=0):
    value = (index * 2654435761 + channel * 2246822519 + 0x9E3779B9) & 0xFFFFFFFF
    value ^= value >> 16
    value = (value * 2246822519) & 0xFFFFFFFF
    value ^= value >> 13
    return (value & 0xFFFFFF) / 16777216.0


def png_bytes(width, height, pixels):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 7)) + chunk(b"IEND", b"")


def write_png(path, width, height, pixels):
    Path(path).write_bytes(png_bytes(width, height, pixels))


def droplets(variant):
    count = 76 if variant == "aerated" else 52
    return [
        (0.05 + unit(index, 0) * 0.9, unit(index, 1), 0.003 + unit(index, 2) * 0.012,
         0.004 + unit(index, 3) * 0.022, 0.3 + unit(index, 4) * 0.7, 0.5 + unit(index, 5) * 0.8)
        for index in range(count)
    ]


def frame_masks(width, height, frame, frames, variant):
    phase = frame / frames * math.tau
    aerated = variant == "aerated"
    mask = [[0] * (width * 3) for _ in range(height)]
    for y in range(height):
        v = y / (height - 1)
        center = 0.5 + 0.022 * math.sin(v * 15 + phase) + 0.011 * math.sin(v * 39 - phase * 2)
        width_at_y = (0.023 + 0.055 * v) * (1.5 if aerated else 1.0)
        for x in range(width):
            u = x / (width - 1)
            distance = abs(u - center)
            core = math.exp(-((distance / width_at_y) ** 2) * 1.8)
            filament = max(0.0, math.sin((u - center) * 155 + v * 24 + phase * 2)) ** 14
            filament *= math.exp(-distance / (0.08 + 0.22 * v)) * 0.36
            value = (core * (0.92 if aerated else 0.68) + filament) * (1.0 - v * 0.58)
            mask[y][x * 3:x * 3 + 3] = [round(min(1.0, value) * 255)] * 3
    for index, (base_x, base_y, rx, ry, strength, speed) in enumerate(droplets(variant)):
        cy = (base_y - frame / frames * speed) % 1.16 - 0.08
        cx = base_x + 0.018 * math.sin(phase + index)
        min_x, max_x = max(0, int((cx - rx * 2) * width)), min(width - 1, int((cx + rx * 2) * width))
        min_y, max_y = max(0, int((cy - ry * 2) * height)), min(height - 1, int((cy + ry * 2) * height))
        for y in range(min_y, max_y + 1):
            v = y / (height - 1)
            for x in range(min_x, max_x + 1):
                u = x / (width - 1)
                distance = ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2
                if distance < 4:
                    value = math.exp(-distance * 1.5) * strength * (0.35 + 0.65 * v)
                    offset = x * 3
                    current = mask[y][offset] / 255
                    combined = min(1.0, current + value)
                    mask[y][offset:offset + 3] = [round(combined * 255)] * 3
    return mask


def normal_from_mask(mask, width, height):
    result = []
    for y in range(height):
        row = []
        for x in range(width):
            left = mask[y][max(0, x - 1) * 3] / 255
            right = mask[y][min(width - 1, x + 1) * 3] / 255
            down = mask[max(0, y - 1)][x * 3] / 255
            up = mask[min(height - 1, y + 1)][x * 3] / 255
            nx, ny, nz = (left - right) * 2.2, (down - up) * 2.2, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            row.extend((round((nx / length * 0.5 + 0.5) * 255), round((ny / length * 0.5 + 0.5) * 255), round((nz / length * 0.5 + 0.5) * 255)))
        result.append(row)
    return result


def generate_jet_sequence(directory, variant="clear", frames=30, width=128, height=512):
    if variant not in {"clear", "aerated"}:
        raise ValueError("Jet variant must be clear or aerated")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    expected = [directory / f"{variant}_{kind}_{frame + 1:04d}.png" for kind in ("mask", "normal") for frame in range(frames)]
    if all(path.is_file() for path in expected):
        return directory
    for frame in range(frames):
        mask = frame_masks(width, height, frame, frames, variant)
        write_png(directory / f"{variant}_mask_{frame + 1:04d}.png", width, height, mask)
        write_png(directory / f"{variant}_normal_{frame + 1:04d}.png", width, height, normal_from_mask(mask, width, height))
    return directory
