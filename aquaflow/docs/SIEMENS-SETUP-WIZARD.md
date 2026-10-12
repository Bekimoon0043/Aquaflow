# Siemens PLC setup: from your design to a running PLC

Open **Devices → PLC → Siemens Setup**. The wizard has seven steps. Each step is marked
with a green dot once it is complete. Underlined words open a short explanation when you
point at them.

| Step | What you do | What AquaFlow does |
|---|---|---|
| 1. Design | Click **New site from my design** | Builds a site from the pumps, valves, nozzles, lights and safety items in your Engineering design (details below). |
| 2. Hardware | Pick the CPU, signal board and modules you plan to buy | Counts the inputs and outputs you need against those you have, assigns every signal to a free terminal, names the exact part to add if something is short, and lists the parts with order numbers. |
| 3. Wiring | Check the I/O map | Shows one row per wire: device → PLC tag → address → module/channel → live value. Has a **Test** button per device, a **printable wiring sheet**, and TIA tag-table export/import. |
| 4. Export to TIA | Download the ZIP and follow the 6-step list | Packages the PLC program (DB, FB, cyclic OB call), `PLC-Tags-for-TIA-import.xlsx`, `WIRING-SCHEDULE.csv` and the guides. |
| 5. Connect | Choose PLCSIM or real PLC, enter the IP, click **Verify** | Read-only check: confirms the PLC runs the program exported for *this* site and that its heartbeat is moving. |
| 6. Test | Click **Run acceptance test** | Runs the checks listed below and stores a dated PASS/FAIL record. |
| 7. Run show | Compile in Show Programming → Compile / Siemens | Converts nozzle patterns into valve commands (details below). |

How step 1 turns your design into PLC devices:

- Nozzles are switched by solenoid valves. A nozzle uses the valve it is linked to, otherwise the nearest valve placed in the design. If the design has no valves, each nozzle gets its own valve.
- Each valve is fed by its nearest pump. You can change the supplying pump in the Wiring step.
- Fog, flame, laser and similar items are listed as "not controlled by the PLC", with the reason.
- Your Engineering layout is never replaced.

What the acceptance test in step 6 checks:

1. It verifies the PLC program.
2. It opens every valve for 2 s with its pump and reads back what the PLC reports.
3. It cycles every light.
4. It goes silent for 1.6 s to prove the PLC watchdog switches everything off. The PLC must then recover on a fresh OFF command.
5. It confirms all outputs are OFF at the end.

What the compile in step 7 does to your show:

- Nozzle patterns become valve open/close commands.
- Short pulses are stretched to the valve's minimum on-time, and tiny gaps are closed to respect its minimum off-time.
- A pump without its own speed clips runs at its show speed while any of its nozzles plays.
- Clips on devices the PLC does not drive are skipped and reported.

## Tag names

| Tag | Meaning | Type |
|---|---|---|
| `P01_Speed` | pump 1 speed reference to the VFD (0..27648 = 0..100 %) | Int, `%QW` |
| `P01_Run` | pump 1 run / enable | Bool, `%Q` |
| `P01_Running`, `P01_Fault` | VFD feedback / trip (optional) | Bool, `%I` |
| `V03_Open`, `V03_OpenFB` | valve 3 open command / limit-switch feedback | Bool |
| `L02_Red/Green/Blue` | RGB light bytes for a light interface (not a CPU output) | Byte, `%QB200+` |
| `SAFE_EStopOK`, `SAFE_LevelOK`, `SAFE_ThermalOK`, `SAFE_DriveOK`, `SAFE_PressureOK` | healthy-high safety inputs (1 = OK) | Bool, `%I` |

**Importing a tag table that already exists.** Some sites already have a PLC program. In TIA,
export **PLC tags → Show all tags → Export**, then open **Wiring → Import an existing TIA tag
table**. AquaFlow recognises tags in two ways:

- **Exact names:** tags that use the convention above.
- **Common names and comments:** for example `Pump1_SpeedRef`, `VFD1_Trip`, `EmergencyStop`, or a `Y3` tag with the comment "solenoid valve nozzle 3".

For every tag it shows its guess, a confidence and the reason. Nothing changes until you
tick the rows and press **Apply**.

## Hardware notes

- **CPU family.** Only the classic S7-1200 is supported: firmware V4.x, order numbers ending
  `-0XB0`. G2 and F (safety) CPUs are refused.
- **Pump speed needs an analog output.** The CPU 1212C and 1214C have none built in. For one
  pump add an **SB 1232 AQ1** (6ES7 232-4HA30-0XB0); for several, an **SM 1232 AQ2/AQ4**.
  The CPU 1215C has two built in.
- **Default addresses.** AquaFlow assigns the TIA Portal defaults:
  - CPU I/O starts at byte 0 (analog at word 64).
  - The signal board starts at byte 4 (analog at word 80).
  - Module slot 2 starts at byte 8 (analog at word 96), then +4 bytes (+16 analog) per slot.

  If you change a start address in TIA, enter the new one in AquaFlow.
- **Interposing relays.** DC/DC/DC outputs are 24 V transistor outputs, so solenoids and
  contactors need interposing relays. Your electrician confirms this.

## What PLCSIM proves and what it does not

A PLCSIM acceptance pass proves three things:

- the PLC program, the mapping and the S7 communication work;
- the PLC refuses to run without AquaFlow;
- the PLC turns everything off when the link drops.

It does **not** prove the wiring. Feedback in PLCSIM is "PLC-applied", never "physical".
On the real cabinet, run the acceptance test again with a person watching every outlet,
then record each device as commissioned.

## Changes that require a new export

The PLC program carries a checksum (signature) of the wiring. Changing any of these
changes the checksum:

- addresses;
- hardware;
- the DB number;
- safety inputs;
- devices added or removed.

AquaFlow then refuses to connect until you export and download the program again. This is
deliberate: it stops a show from running against the wrong program. Sites created before
this feature, such as the PLCSIM quick tests, keep working unchanged.
