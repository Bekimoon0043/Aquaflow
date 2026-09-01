# AquaFlow Studio 1.1.4 — I-CAN fountain control

Two builds ago AquaFlow connected, armed, reported every frame as sent, and the fountain
did not move. This build changes two things: **what does the sending**, and **where the
channel numbers come from**.

---

## 1. Your script is now the transport

`ican_client.py` is no longer a reference sitting beside the app — it **is** the code that
sends. It lives at `engine/ican_reference_client.py` inside the engine, and AquaFlow
instantiates its `ICANClient` and calls `set_channels()` / `all_off()` / `poll()`. The
bytes that reach the gateway come out of the file that ran your fountain. A test fails the
build if anyone puts a hand-rolled socket back next to it.

## 2. The likely cause of the silent failure

AquaFlow set `SO_REUSEADDR` on its socket. Your client does not. That one option means:

- **Your client:** if port 2002 is taken, the bind **fails**, loudly, naming the cause.
- **Old AquaFlow:** if port 2002 was taken, the bind **succeeded anyway** — no error, a
  healthy-looking connection, every frame logged as sent, nothing the gateway would act on.

The vendor I-CAN software owns 2002 whenever it is running. If it was open — or had been —
that fully explains green everywhere and no movement.

> **1.1.4 now refuses to connect in that case and tells you why.** If Connect fails with a
> message about port 2002, that was the bug. Close the original I-CAN software — check
> Task Manager, not just the window — and connect again.

## 3. Import the channel map from your capture — do this instead of typing numbers

`group 1 / channel 9` was **my example**, not a channel anyone confirmed is wired to
equipment. If nothing is connected to it, AquaFlow does everything correctly and nothing
moves. That is very likely what you saw.

Your capture already knows the right answer. Every (group, channel) the **original**
software drove is, by definition, wired to something.

In step 2 there is now **`Import from capture…`**. Point it at either file from the capture
tool folder:

- `changes.txt` — parsed with the same regex your client uses for `--replay`, so a file
  that replays correctly imports correctly
- `capture.jsonl` — the machine-readable log

It creates every real channel at once, labelled `G1 C9`, `G1 C13`, … ready to attach. Rename
them as you identify what each one actually is.

---

## Install

1. Close AquaFlow Studio.
2. Run `AquaFlowSetup-1.1.4.exe`. SmartScreen → More info → Run anyway.
3. **Help → About must say 1.1.4.**
4. **Close the original I-CAN software.** Most important step.

Network unchanged, and yours was already correct: `192.168.5.200 / 255.255.255.0`.

## Test

**Devices → Fountain Control (I-CAN)**

0. **Arm the safety system** → `permit GRANTED`
1. **Connect** to `192.168.5.2` / `200` / `2002`.
   Check the new line underneath: **`sending from local port 2002 → 192.168.5.2:200`**.
   If it does not say **2002**, stop — something else has the port.
2. **Import from capture…** → pick `changes.txt`. Channels appear.
3. **Attach**
4. **Arm the output** — type `ARM OUTPUT`. Water off.
5. **Press one channel button.** Then **STOP ALL**.

Every command now prints the bytes it sent:

```
4:16:10 PM  G1 C9 → ON  [08 00 00 00 01 00 01 00 00 00 00 00 00]
```

That is the same frame `ican_client.py --group 1 --on 9` produces. If a channel does
nothing, the hex tells you whether AquaFlow sent what you think it sent.

## If it still does not move

With AquaFlow **closed**, on the same PC, using a channel that came from the import:

```
python ican_client.py --gateway 192.168.5.2 --group 1 --on 9
python ican_client.py --gateway 192.168.5.2 --group 1 --all-off
```

- **Neither moves** → that channel is not the one; try another from the import.
- **Script moves it, AquaFlow does not** → send me the hex line and the port line. With
  identical bytes and port 2002, the difference has to be something I can still find.
- **Both move** → done.

## Send back

1. Version in Help → About
2. The `sending from local port …` line
3. Any error from Connect
4. How many channels the import created, and from which file
5. One hex line from the Activity log
6. Whether the script moves that same channel

Send it exactly as it happened, including if it failed. The hex line and the port line are
what I need.
