# AquaFlow Studio 1.1.3 — I-CAN fountain control

Previous build (1.1.2) connected, armed, and reported every frame as sent — and the
fountain did not move. This build changes what is doing the sending.

---

## AquaFlow now uses your script's code, not its own

`ican_client.py` is no longer a reference sitting beside the app. It **is** the transport.
It lives at `engine/ican_reference_client.py` inside the engine, and `ICANConnection`
instantiates its `ICANClient` and calls `set_channels()` / `all_off()` / `poll()`. The
bytes that reach the gateway come out of the file that ran your fountain.

A test now fails the build if anyone reintroduces a hand-rolled socket next to it.

## The specific thing that was probably wrong

AquaFlow set `SO_REUSEADDR` on its socket. Your client does not. That one option means:

- **Your client:** if port 2002 is already taken, the bind **fails**, loudly, naming the
  cause.
- **Old AquaFlow:** if port 2002 was already taken, the bind **succeeded anyway**. No
  error, no warning, a healthy-looking connection, every frame logged as sent — and
  nothing on the wire that the gateway would act on.

The vendor I-CAN software owns port 2002 whenever it is running. If it was open, or had
been open, that is a complete explanation for what you saw: green everywhere, no movement.

**1.1.3 refuses to connect in that situation** and tells you exactly why. So:

> If Connect now fails with a message about port 2002, that was the bug. Close the
> original I-CAN software — check Task Manager, not just the window — and connect again.

## Install

1. Close AquaFlow Studio.
2. Run `AquaFlowSetup-1.1.3.exe`. SmartScreen → More info → Run anyway.
3. **Help → About must say 1.1.3.**
4. **Close the original I-CAN software.** This is now the single most important step.

Network is unchanged and yours was already correct: `192.168.5.200 / 255.255.255.0`.

## Test

**Devices → Fountain Control (I-CAN)** — same six steps as before.

Two new things on screen:

- Under Connect: **`sending from local port 2002 → 192.168.5.2:200`**. If that does not
  say **2002**, stop — something else has the port.
- In the Activity log, every command now prints **the actual bytes sent**:
  ```
  4:16:10 PM  pump → ON  [08 00 00 00 01 00 01 00 00 00 00 00 00]
  ```

## Which channel to test — read this before you map anything

`group 1, channel 9` was **my example**, not a channel anyone has confirmed is wired to
equipment. I picked it off the addresses in an old capture. If nothing is connected to it,
AquaFlow will do everything correctly and nothing will move — which is exactly what you saw.

**Open `changes.txt` from your capture and use a group/channel that actually appears
there.** Those are the ones the real fountain uses. Lines look like:

```
   17.45s      1  [9, 13, 17, 21, 25, 29, 33, 37]
```

That would be group `1`, and channels `9, 13, 17, 21, ...` — map one of those.

If you can, send me the first 20 lines of `changes.txt` and I will tell you exactly what
to map, and can make AquaFlow import the whole map from the capture in one step.

## The check that settles it

With AquaFlow **closed**, on the same PC:

```
python ican_client.py --gateway 192.168.5.2 --group 1 --on 9
python ican_client.py --gateway 192.168.5.2 --group 1 --all-off
```

Use the **same group and channel** you tried in AquaFlow.

- **Nothing moves either way** → the channel is not wired to anything. Pick one from
  `changes.txt`. AquaFlow is fine.
- **Script moves it, AquaFlow does not** → compare the hex in the Activity log against
  what the script sends. They should be identical; if they are, the difference is the
  socket, and the port line will say so.
- **Both move it** → done.

## Send back

1. Version in Help → About.
2. The `sending from local port …` line.
3. Any error from Connect.
4. One line of hex from the Activity log.
5. Whether the script moves the same channel.
6. The first 20 lines of `changes.txt`.

If it still does not run, that is information, not failure — send it exactly as it
happened. The hex line and the port line are what I need.
