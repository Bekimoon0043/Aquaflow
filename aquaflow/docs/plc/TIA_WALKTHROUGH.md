# TIA Portal walkthrough — programming the 1215C for AquaFlow

You + Claude, pair-programming: you click, Claude guides. The two source files in
this folder are the ENTIRE program — you will not write a line of code, only
import, wire addresses, and download. Paste a screenshot into the chat any time
something doesn't match these steps.

**You need:** TIA Portal (V16 or newer; Basic edition is enough — the 1215C is a
Basic-family CPU), a Windows PC, an Ethernet cable to the PLC, 24 V on the PM 1207.

---

## Step 1 — Project + hardware (10 min)

1. TIA Portal → **Create new project** → name it `AquaFlow-Fountain` → Create.
2. **Devices & networks → Add new device → Controllers → SIMATIC S7-1200 →
   CPU 1215C DC/DC/DC → 6ES7215-1AG40-0XB0**. Pick the firmware version printed
   on the CPU's front (or the highest offered). → OK.
3. If the SM 1222 DQ16 is mounted: in Device view, drag **DQ 16x24VDC
   (6ES7222-1BH32-0XB0)** from the catalog into slot 2. (Same later for the
   SM 1231 AI when it arrives.)

## Step 2 — IP address (2 min)

1. Device view → click the PROFINET port (the green RJ45 on the CPU picture) →
   **Properties → Ethernet addresses**.
2. IP: **192.168.5.10**, mask **255.255.255.0**. No router.

## Step 3 — PUT/GET, the setting everyone misses (1 min)

1. Click the CPU (the whole rectangle) → **Properties → Protection & Security →
   Connection mechanisms**.
2. Tick **"Permit access with PUT/GET communication from remote partner"**.
   Without this, every AquaFlow read fails with an error that looks like a
   wiring problem. (On the same Protection page, access level "Full access (no
   protection)" is fine for the bench.)

## Step 4 — Import the two sources (5 min)

1. Project tree → your PLC → **External source files → Add new external file** →
   select `AquaFlowIO.db`, then again for `AquaFlow_Main.scl` (copy both from
   `aquaflow/docs/plc/` to the TIA PC first).
2. Select BOTH files → right-click → **Generate blocks from source**. Accept the
   warning about overwriting. You now have data block `AquaFlowIO` (DB1) and
   function `AquaFlow_Main` under Program blocks.
3. **Verify DB1 is non-optimized**: right-click `AquaFlowIO` → Properties →
   Attributes → "Optimized block access" must be UNCHECKED (the source sets
   this; just confirm). If it is checked, the import went wrong — stop and ask.
4. **Verify it is number 1**: Properties → General → Number = 1, "Manual"
   numbering. AquaFlow addresses DB**1** absolutely.

## Step 5 — Call the program (2 min)

1. Open **Program blocks → Main [OB1]**.
2. Drag `AquaFlow_Main` from the project tree into the first empty network.
   That's the whole OB1.

## Step 6 — Check the I/O addresses (5 min)

`AquaFlow_Main.scl` assumes the defaults: DI at `%I0.x`, onboard AI at
`%IW64/%IW66`, onboard AO at `%QW64`. Device view → click the CPU → **Properties
→ DI/DO and AI/AO** show the real start addresses. If they differ, edit only the
`%`-addresses inside `AquaFlow_Main` (double-click it) — never the DB layout.

## Step 7 — Download (5 min)

1. Toolbar → **Download to device** (the blue arrow). Interface: your PC's
   Ethernet adapter → **Start search** → the CPU appears → Load.
2. Accept "overwrite all", then **Start module** when asked. RUN LED goes green.

## Step 8 — Prove it before AquaFlow ever connects (5 min)

1. Project tree → **Watch and force tables → Add new watch table**. Add:
   `"AquaFlowIO".HEARTBEAT`, `"AquaFlowIO".ESTOP_OK`, `"AquaFlowIO".LEVEL_RAW`.
2. Click the glasses icon (Monitor). **HEARTBEAT must be counting up fast.**
   If it counts, the program runs and the DB is live — the single most
   important pre-check.
3. Toggle your test switch on %I0.0 → ESTOP_OK flips.

## Step 9 — Hand over to AquaFlow

1. On the AquaFlow PC (192.168.5.200): `ping 192.168.5.10`.
2. Put the field-point config in place (`data/field_points.json` — the exact
   JSON is in `docs/S7_DB_CONTRACT.md`, including the two `cmd_*` points).
3. Start the backend → PLC panel → **Field I/O** tab:
   - points GOOD, values moving, heartbeat **ALIVE**;
   - stop the CPU from TIA (Online → Stop) → heartbeat **DEAD**, readings
     STALE, permit withdrawn — while the cable never moved;
   - restart the CPU → everything recovers by itself.
4. Then run the commissioning checklist at the end of `S7_DB_CONTRACT.md`.

---

## When something doesn't match

Paste into the chat: a screenshot of what you see, or the exact error text from
TIA's "Info → Compile" pane. Typical first-day traps, pre-answered:

| Symptom | Cause |
|---|---|
| AquaFlow: connect ok, every read errors | PUT/GET not ticked (Step 3) |
| AquaFlow: item error ADDRESS_OUT_OF_RANGE | DB is optimized, or not number 1 (Step 4.3/4.4) |
| Heartbeat frozen in the watch table | `AquaFlow_Main` not called in OB1 (Step 5) |
| AI value stuck at 0 | wrong `%IW` start address (Step 6) |
| Download can't find the CPU | PC NIC not on 192.168.5.x |
