"""Pure AquaFlow timeline sampling for Blender keyframe generation."""

from __future__ import annotations

import math

from .core import clamp, finite, hex_color, srgb_to_linear

WATER_CHANNELS = {"device_intensity", "device_enable", "solenoid_open", "motion_intensity", "pump_speed", "water_master", "laser_intensity", "fire_intensity", "fog_density"}
LIGHT_MASTER = {"lighting_master", "device_intensity"}
RGB_CHANNELS = {"lighting_red": 0, "lighting_green": 1, "lighting_blue": 2}


def clip_window(clip):
    start = finite(clip.get("startTime", clip.get("start", 0.0)))
    if clip.get("duration") is not None:
        end = start + max(0.0, finite(clip.get("duration")))
    else:
        end = finite(clip.get("end"), start)
    return start, max(start, end)


def ramp_shape(curve, value):
    value = clamp(value)
    curve = str(curve or "linear").lower().replace("_", "-")
    if curve == "ease-in":
        return value * value
    if curve == "ease-out":
        return 1.0 - (1.0 - value) ** 2
    if curve in {"ease-in-out", "ease-both"}:
        return 2.0 * value * value if value < 0.5 else 1.0 - 2.0 * (1.0 - value) ** 2
    if curve == "step":
        return 0.0 if value < 0.5 else 1.0
    return value


def keyed_value(clip, local_time):
    keys = clip.get("keys") or []
    if len(keys) < 2 or len(keys) % 2:
        return None
    pairs = []
    for index in range(0, len(keys), 2):
        time, value = finite(keys[index], -1.0), finite(keys[index + 1], -1.0)
        if time < 0 or value < 0 or (pairs and time <= pairs[-1][0]):
            return None
        pairs.append((time, value))
    if local_time <= pairs[0][0]:
        return pairs[0][1]
    for (left_time, left_value), (right_time, right_value) in zip(pairs, pairs[1:]):
        if local_time <= right_time:
            if clip.get("keyMode") == "step":
                return left_value
            amount = (local_time - left_time) / (right_time - left_time)
            return left_value + (right_value - left_value) * amount
    return pairs[-1][1]


def clip_level(clip, time):
    start, end = clip_window(clip)
    if clip.get("muted") or clip.get("disabled") or not start <= time < end or end <= start:
        return 0.0
    keyed = keyed_value(clip, time - start)
    value = keyed if keyed is not None else finite(clip.get("value", clip.get("intensity", 0.0)))
    fade_in = max(0.0, finite(clip.get("fadeIn")))
    fade_out = max(0.0, finite(clip.get("fadeOut")))
    factors = [1.0]
    if fade_in:
        factors.append((time - start) / fade_in)
    if fade_out:
        factors.append((end - time) / fade_out)
    return clamp(value / 100.0) * ramp_shape(clip.get("curveType", clip.get("curve")), min(factors))


def htp(clips, channel_types, time):
    winning = 0.0
    source = None
    for clip in clips:
        if clip.get("type") not in channel_types:
            continue
        level = clip_level(clip, time)
        if level >= winning:
            winning = level
            source = clip
    return winning, source


def legacy_groups(project):
    tracks = [track for track in project["timelineTracks"] if not track.get("muted")]
    solo = {track.get("type") for track in tracks if track.get("solo")}
    if solo:
        tracks = [track for track in tracks if track.get("type") in solo]
    return {str(track.get("type") or track.get("id") or ""): track.get("clips") or [] for track in tracks}


def legacy_level(project, fixture, time, groups=None):
    groups = groups if groups is not None else legacy_groups(project)
    if fixture["group"] not in groups:
        return None, None
    winning = 0.0
    source = None
    for clip in groups[fixture["group"]]:
        current = clip_level(clip, time)
        if current >= winning:
            winning, source = current, clip
    return winning, source


def relevant_flat_clips(project, fixture):
    return [clip for clip in project["clips"] if str(clip.get("fixtureId") or "") == fixture["id"]]


def evaluate_fixture(project, fixture, time, groups=None, clips=None):
    level, legacy_source = legacy_level(project, fixture, time, groups)
    clips = relevant_flat_clips(project, fixture) if clips is None else clips
    base_hex = fixture["color"]["hex"]
    if fixture["category"] != "light":
        if clips:
            flat, _ = htp(clips, WATER_CHANNELS, time)
            level = flat
        if level is None:
            level = 1.0
        return {"level": clamp(level), "energy_factor": clamp(level), "color": fixture["color"]["linear"]}

    master, master_clip = htp(clips, LIGHT_MASTER, time)
    rgb_active = any(clip.get("type") in RGB_CHANNELS and clip_level(clip, time) > 0 for clip in clips)
    white, _ = htp(clips, {"lighting_white"}, time)
    if clips and not master and not rgb_active and not white:
        master = 0.0
    elif (rgb_active or white) and not master:
        master = 1.0
    if master_clip and master_clip.get("color"):
        base_hex = master_clip["color"]
    elif legacy_source and legacy_source.get("color"):
        base_hex = legacy_source["color"]
    color = hex_color(base_hex)
    if rgb_active:
        channels = []
        for channel_type, _ in RGB_CHANNELS.items():
            value, _ = htp(clips, {channel_type}, time)
            channels.append(value)
        color = {"srgb": tuple(channels), "linear": tuple(srgb_to_linear(value) for value in channels)}
    if level is not None:
        master = level
    linear = list(color["linear"])
    if white:
        linear = [channel + white for channel in linear]
    peak = max(linear, default=1.0)
    if peak > 1.0:
        linear = [channel / peak for channel in linear]
        energy_factor = master * peak
    else:
        energy_factor = master
    return {"level": clamp(master), "energy_factor": max(0.0, energy_factor), "color": tuple(linear)}


def animation_times(project, step_frames=1):
    duration = project["duration_s"]
    fps = project["fps"]
    times = {0.0, duration}
    step = max(1, int(step_frames)) / fps
    count = int(math.ceil(duration / step))
    times.update(min(duration, index * step) for index in range(count + 1))
    clips = list(project["clips"])
    for track in project["timelineTracks"]:
        clips.extend(track.get("clips") or [])
    for clip in clips:
        start, end = clip_window(clip)
        for value in (start, end, start + max(0.0, finite(clip.get("fadeIn"))), end - max(0.0, finite(clip.get("fadeOut")))):
            if 0 <= value <= duration:
                times.add(value)
        keys = clip.get("keys") or []
        for index in range(0, len(keys) - 1, 2):
            value = start + finite(keys[index], -1.0)
            if 0 <= value <= duration:
                times.add(value)
    return sorted(times)


def build_animation(project, step_frames=1):
    times = animation_times(project, step_frames)
    groups = legacy_groups(project)
    clips_by_fixture = {}
    for clip in project["clips"]:
        clips_by_fixture.setdefault(str(clip.get("fixtureId") or ""), []).append(clip)
    return {
        fixture["id"]: [
            {"time": time, "frame": int(round(time * project["fps"])) + 1,
             **evaluate_fixture(project, fixture, time, groups, clips_by_fixture.get(fixture["id"], []))}
            for time in times
        ]
        for fixture in project["fixtures"]
    }
