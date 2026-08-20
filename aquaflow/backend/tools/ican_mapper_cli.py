"""
ican_mapper_cli.py  —  the hands-on channel mapping method.

Reads an I-CAN capture (.pcapng or .etl), finds every (group, channel) the controller
drove, then walks you through them one at a time so you can name each real device.
Saves a channel map you (or AquaFlow) can reuse. PASSIVE: reads a file, drives nothing.

    py -3.12 ican_mapper_cli.py <capture.pcapng|.etl> [--map ican_channel_map.json]

At each channel you type a name and a type. Just press Enter to skip a channel.
Type 'q' to stop and save what you've done so far.
"""
import json, os, struct, subprocess, sys, collections

DEVICE_TYPES = ("lighting", "jet", "pump", "valve", "flame", "fog",
                "water_curtain", "laser", "aux", "unknown")


# ── capture decode (self-contained) ──────────────────────────────────────────
def to_pcapng(path):
    if path.lower().endswith(".pcapng"):
        return path
    out = os.path.splitext(path)[0] + ".pcapng"
    for verb in ("etl2pcap", "etl2pcapng"):
        try:
            subprocess.run(["pktmon", verb, path, "-o", out],
                           capture_output=True, check=True)
            if os.path.exists(out):
                return out
        except Exception:
            continue
    sys.exit("Could not convert .etl — provide a .pcapng, or install pktmon.")


def decode_groups(pcapng):
    """Return {group: sorted[channels]} for cmd 0x08 PC->GW frames on port 200/2002."""
    data = open(pcapng, "rb").read()
    off = 0
    groups = collections.defaultdict(set)
    while off + 12 <= len(data):
        bt, bl = struct.unpack_from("<II", data, off)
        if bl < 12 or off + bl > len(data):
            break
        if bt == 6:
            cl = struct.unpack_from("<I", data, off + 20)[0]
            pkt = data[off + 28: off + 28 + cl]
            if len(pkt) >= 34 and struct.unpack_from(">H", pkt, 12)[0] == 0x0800 \
                    and pkt[23] == 17:
                ihl = (pkt[14] & 0xf) * 4
                l4 = 14 + ihl
                sp, dp = struct.unpack_from(">HH", pkt, l4)
                pl = pkt[l4 + 8: l4 + 8 + 13]
                if dp == 200 and len(pl) == 13 and pl[0] == 0x08:
                    g = pl[4]
                    for i, byte in enumerate(pl[5:10]):
                        for b in range(8):
                            if byte & (1 << b):
                                groups[g].add(i * 8 + b + 1)
        off += bl
    return {g: sorted(chs) for g, chs in sorted(groups.items())}


# ── map persistence ──────────────────────────────────────────────────────────
def load_map(path):
    if os.path.exists(path):
        raw = json.load(open(path, encoding="utf-8"))
        return {f"{c['group']}:{c['channel']}": c for c in raw.get("channels", [])}
    return {}


def save_map(path, items):
    payload = {"version": "1.0",
               "channels": [items[k] for k in sorted(items,
                            key=lambda k: (int(k.split(':')[0]), int(k.split(':')[1])))]}
    json.dump(payload, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


def ask_type():
    print("   types:", ", ".join(DEVICE_TYPES))
    while True:
        t = input("   type [lighting]: ").strip().lower() or "lighting"
        if t in DEVICE_TYPES:
            return t
        print("   ! choose one of the listed types")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cap = sys.argv[1]
    map_path = "ican_channel_map.json"
    if "--map" in sys.argv:
        map_path = sys.argv[sys.argv.index("--map") + 1]

    groups = decode_groups(to_pcapng(cap))
    if not groups:
        print("No I-CAN control channels found in this capture.")
        print("Was it recorded on the fountain PC with devices firing? See README.")
        return

    items = load_map(map_path)
    total = sum(len(v) for v in groups.values())
    print(f"\nFound {total} channels across {len(groups)} device group(s).")
    print("Name each one. Press Enter to skip, 'q' to stop & save.\n")

    done = 0
    for group, channels in groups.items():
        print(f"── device group {group} ──")
        for ch in channels:
            key = f"{group}:{ch}"
            existing = items.get(key, {})
            cur = f"  (currently: {existing.get('label')})" if existing.get("label") else ""
            name = input(f"group {group}  channel {ch}{cur}  -> name: ").strip()
            if name.lower() == "q":
                save_map(map_path, items)
                print(f"\nSaved {done} labels to {map_path}. Run again any time to continue.")
                return
            if not name:
                continue
            dtype = ask_type()
            items[key] = {"group": group, "channel": ch, "label": name,
                          "device_type": dtype, "safety_max": 1.0,
                          "detected": True, "notes": ""}
            done += 1

    save_map(map_path, items)
    print(f"\nDone — {done} channels labelled, saved to {map_path}.")
    print("Send that file back and AquaFlow will use it as your device list.")


if __name__ == "__main__":
    main()
