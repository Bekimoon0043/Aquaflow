# AquaFlow Studio 1.1.2 — I-CAN fountain control

Test this on the site PC, on the fountain network. **I have not run it against the
gateway. Nothing here is confirmed on hardware — that is what this build is for.**

---

## What was wrong

`ican_client.py` ran the fountain. AquaFlow could not. Same protocol, same network,
same machine. The difference was one line of logic.

AquaFlow's `connect()` sent a `0x08` probe to the gateway and **refused to go any
further unless the gateway replied**. It closed the socket and went to `ERROR`. Every
command after that was rejected with `REFUSED: state error` before a single byte was
sent.

But the gateway **does not reply to `0x08` frames**. Your capture says so — 8085 frames,
no acks. I-CAN control is fire-and-forget, which is exactly why your script works: it
never reads anything back. AquaFlow was waiting for an answer that the hardware is never
going to give, so it was waiting forever.

Discovery had the same bug, and worse: it probed using `0x08` — the opcode that closes
relays — sent to every host on the subnet during a scan.

## What changed

`ican_client.py` is now the authority. It is committed at
`aquaflow/tools/reference/ican_client.py`, and the test suite **imports it and compares
AquaFlow's frames against it byte for byte**. If they ever drift apart, the build fails.

| | before | now |
|---|---|---|
| Group id | `group & 0xFF` in byte 4 | big-endian uint32 in bytes 1-4 |
| Probe | `0x08` (the output opcode) | `0x03` channel-address poll |
| No reply from gateway | `ERROR`, socket closed, all output refused | connects, marked **unverified**, output works |
| Blackout | group 0 only | every group that has been driven |
| Duplicate frame | reported failure, wedged the retry loop | reported success |
| Channel 41+ | silently dropped | rejected when you map it |

Two of those were live safety bugs. Blackout only sent group 0 — with jets mapped on
groups 1 and 9, **STOP ALL stopped nothing**. And a channel outside 1-40 was silently
discarded, so a mapped jet would never fire and never report an error.

---

## Install

1. Close AquaFlow Studio if it is running.
2. Run `AquaFlowSetup-1.1.2.exe`. SmartScreen will warn — More info, Run anyway. The
   build is unsigned; that is expected and was a deliberate Tier A decision.
3. It upgrades the existing per-user install and keeps your data.
4. Confirm **Help → About** says **1.1.2**. If it says 1.1.1 the old build is still
   running and nothing below means anything.

## Network

Same as for your script: this PC needs a static address on the gateway subnet, e.g.
`192.168.5.200 / 255.255.255.0`. **Turn Wi-Fi off** so nothing routes the wrong way.

**Close the original I-CAN software before testing.** It holds UDP port 2002, which is
the port the gateway expects commands from. If AquaFlow cannot get 2002 it falls back to
a random port and shows a red warning saying so — if you see that warning, the vendor
software is still running.

## Test

Open **Devices → Fountain Control (I-CAN)**. The panel is six steps, top to bottom.

0. **Arm the safety system.** Without the master permit every command is clamped to zero
   and the fountain will not move no matter what else you arm.
1. **Find the gateway.** Press Discover. If nothing answers, type `192.168.5.2`, port
   `200`, local port `2002` and press Connect — the direct path is the one your script
   uses and it does not depend on discovery working.
   - Header says **"gateway replied"** → the gateway answered the `0x03` poll.
   - Header says **"unverified"** → it did not answer. **This is not a failure.** Your
     capture shows control does not need a reply. Keep going.
2. **Map the channels.** Start with exactly one you can see, e.g. group `1`, channel `9`,
   label it, type `pump`. Add it.
3. **Attach** — routes it to the runtime. Still disarmed.
4. **Arm the output** — type `ARM OUTPUT`. Water off. Watch the cabinet, not the screen.
5. **Press the channel button.** Then **STOP ALL**.

Then try `Run test sequence` — each mapped channel on, then off, in order.

**A lit button means the frame was sent, not that the relay closed.** The gateway does
not acknowledge. The cabinet is the only source of truth.

## The A/B check, if it does not work

`ican_client.py` is in this zip. On the same PC, with AquaFlow closed:

```
python ican_client.py --gateway 192.168.5.2 --group 1 --on 9
python ican_client.py --gateway 192.168.5.2 --group 1 --all-off
```

- **Script works, AquaFlow does not** → the fault is in AquaFlow. Send me the log from
  the panel's Activity box and the port warning if you saw one.
- **Neither works** → the fault is network or cabinet state, not this build.

## What to send back

1. Version in Help → About.
2. Header state: `connected` and `gateway replied` or `unverified`.
3. Did the red **port 2002** warning appear?
4. Did the jet move on the channel button? On the test sequence? Did STOP ALL stop it?
5. The Activity log text.
6. Whether the script still works on that same PC.

If it does not work, that is a useful result — send it exactly as it happened rather
than trying to make it work. The details are what tell me where the next fault is.
