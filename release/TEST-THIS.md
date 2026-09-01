# AquaFlow Studio 1.1.5 — I-CAN fountain control

Your 1.1.4 screenshot ruled out most of what was left, and pointed at one thing I had
not done.

## What your screenshot proved

- **`gateway replied`** in green — the gateway answers now. The link is genuinely
  two-way. Network, socket and protocol are all confirmed working.
- **`sending from local port 2002`** — port 2002 was never the problem.
- **The import worked** — every channel your real show drove, all on group 0.

So the frames are correct, they leave the machine, and the gateway is alive and talking.
One difference was left.

## What this build changes: AquaFlow now streams, like the original software does

Your capture contains **19,152 output frames**. The original software does not send a
frame once and stop — it **streams the output state continuously**, several times a
second, every frame carrying the full absolute channel state. The frames in your capture
are about 250 ms apart.

AquaFlow sent **one** frame per button press and then went silent.

If the relay controller has an output watchdog — very common in fountain controllers —
it drops its relays when that stream stops. That produces exactly what you saw: correct
bytes, gateway alive, everything green, nothing moving.

AquaFlow now re-sends the current state at **10 Hz** the whole time the output is armed.
(Art-Net in AquaFlow already did this. I-CAN never did.)

Blackout streams **off** rather than going quiet, for the same reason: if the controller
latches its last state, silence would leave the relays closed.

### How to see it

When you arm the output the header now shows:

```
OUTPUT ARMED   streaming 10Hz · 1483 frames
```

If that counter is climbing, AquaFlow is streaming. If it says **NOT STREAMING**, tell me.

---

## Install

1. Close AquaFlow Studio.
2. Run `AquaFlowSetup-1.1.5.exe`. SmartScreen → More info → Run anyway.
3. **Help → About must say 1.1.5.**
4. Close the original I-CAN software.

## Test

**Devices → Fountain Control (I-CAN)**

0. Arm the safety system → `permit GRANTED`
1. Connect `192.168.5.2` / `200` / `2002` → check `gateway replied` and `local port 2002`
2. **Import from capture…** → `changes.txt`
3. Attach
4. Arm the output (`ARM OUTPUT`) → confirm the **streaming** counter is climbing
5. Press one channel button — leave it on for **10 seconds**, don't tap it

Step 5 matters. If the old behaviour was a watchdog dropping the relay, a quick tap would
have looked identical to nothing happening. Hold it on and watch the cabinet.

---

## The one test that settles it, if it still does not move

This distinguishes "AquaFlow is wrong" from "single frames don't work on this hardware".
With AquaFlow **closed**:

```
# A. single shot — one frame, then silence (what AquaFlow used to do)
python ican_client.py --gateway 192.168.5.2 --group 0 --on 9

# B. the streaming replay — many frames (what you ran when it worked)
python ican_client.py --gateway 192.168.5.2 --replay changes.txt
```

Use a channel that came from the import.

- **B moves the fountain, A does not** → the controller needs the continuous stream.
  That is exactly what 1.1.5 adds, and it should now work.
- **A moves it too** → single frames are fine, my streaming theory is wrong, and the
  problem is elsewhere. Tell me and I will keep looking.
- **Neither moves** → that channel is not the one. Try another from the import, or a
  whole group at once.

**Please run A and B.** Whichever way it comes out, it tells me something I cannot
determine from here, and it is the fastest way to the end of this.

## Send back

1. Version in Help → About
2. Does the **streaming** counter climb while armed?
3. What happened on a 10-second hold of one channel
4. **Result of A vs B above** — the important one
5. One hex line from the Activity log

If it still does not run, send it exactly as it happened. That is information, not failure.
