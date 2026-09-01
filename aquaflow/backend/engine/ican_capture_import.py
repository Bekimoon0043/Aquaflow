"""
Build a channel map from a capture of the ORIGINAL fountain software.

The hard question on site is not "can we send a frame" — that is settled — it is
"which group and channel is which piece of equipment". Typing numbers in by hand
guesses at that. A capture answers it: every (group, channel) the real show drove is
a channel that is definitely wired to something.

Accepts either artifact produced by tools/ican_capture.py:

  * changes.txt   — the human-readable transitions, one line per change:
                        17.45s      1  [9, 13, 17, 21, 25]
                        18.90s      1  (all off)
                    Parsed with the SAME regex the reference client uses for
                    --replay, so a file that replays correctly also imports
                    correctly. There is no second dialect to keep in sync.

  * capture.jsonl — the machine-readable log, one JSON object per line, where a
                    frame record carries "group" and "channels" already decoded.

Pure parsing. No sockets, no map mutation, no I/O beyond the text handed in.
"""
from __future__ import annotations

import json
import logging

from engine.ican_reference_client import LINE_RE

logger = logging.getLogger("ican.capture_import")


def parse_capture(text: str) -> list[dict]:
    """Return [{"group": int, "channels": [int, ...]}, ...], one entry per group.

    Channels are the UNION of everything that group was ever seen driving across the
    whole capture — a show turns channels on and off constantly, so any single moment
    understates the equipment. "(all off)" lines contribute nothing, which is correct:
    they prove a group exists but name no channel.
    """
    seen: dict[int, set[int]] = {}

    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue

        # capture.jsonl — a decoded frame record.
        if line.startswith("{"):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if rec.get("kind") != "frame":
                continue
            # Only what the CONTROLLER sent. A gateway reply is not a command, and
            # its bytes do not carry a group/channel mask in the same layout.
            if rec.get("dir") not in (None, "PC->GW"):
                continue
            channels = rec.get("channels")
            if not isinstance(channels, list):
                continue
            group = int(rec.get("group", 0))
            seen.setdefault(group, set()).update(int(c) for c in channels)
            continue

        # changes.txt — a transition line.
        m = LINE_RE.match(raw)
        if not m:
            continue
        group = int(m.group(2))
        body = m.group(3)
        bucket = seen.setdefault(group, set())
        if body != "(all off)":
            for part in body.strip("[]").split(","):
                part = part.strip()
                if part:
                    bucket.add(int(part))

    out = [{"group": g, "channels": sorted(chs)} for g, chs in sorted(seen.items())]
    logger.info("capture import: %d group(s), %d channel(s)",
                len(out), sum(len(o["channels"]) for o in out))
    return out
