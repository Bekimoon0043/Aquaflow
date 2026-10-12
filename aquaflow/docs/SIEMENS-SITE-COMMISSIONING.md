# Siemens site foundation

> **Obsolete v1 contract reference.** Do not commission a new PLC from the offsets below. Use `SIEMENS-RUNTIME-COMMISSIONING.md` and contract v2 in `SIEMENS-PLC-RUNTIME-CONTRACT.md`.

This workflow is separate from the commissioned 4KILO I-CAN implementation.
Use it for a new Siemens test site. It drives analog pump-speed references and
digital outlet valves through a dedicated, non-optimized command DB. It does
not compile/download Siemens programs or configure the PLC's hardware.

## First test without a PLC

1. Run the updated backend and frontend. Open **PLC Integration > Siemens Site**.
2. Keep the initial **one pump / four valve outlets** and click **Create simulated site**.
3. Click **Load layout in Engineering Design**, after saving any currently open design.
   The new layout has stable pump/valve IDs and one nozzle visual per valve.
4. Move the equipment/nozzles in Engineering Design as needed. Return to Siemens Site,
   click **Keep current engineering layout**, then **Save mapping** to preserve positions.
5. Click **Verify**, then **Arm**, then **Compile 60-second example**, then **Start simulation**.
6. Observe the outlet values: each of the four valves runs for 15 seconds; its pump
   is requested at 30%. Pump speed becomes zero when no supplying outlet is open.
7. Click **STOP / Disarm** at any point. Values become zero and another Start needs Arm.
   An application emergency stop/blackout also stops this runner.
8. **Test outlet · 3s / 10%** identifies just the selected outlet and its supplying
   pump. Simulation performs no network IO, regardless of the configured IP.

The simulation display shows requested command values and acknowledgements;
it is not measured jet height or physical pump/valve feedback. The first release
does not synchronize its independent runner with music playback or the 3D clock.

## Create your own Show Programmer pattern

1. Load this Siemens layout into Engineering Design, then open **Show Programmer**.
2. Click **More tools > Eng Fixtures** to import the engineering fixtures.
3. Click **Array Patterns** (the **Arrays** tab), then choose the saved Siemens site under **Siemens show output**.
4. Click **Load 60-second example** to get editable pump Speed and valve Open clips.
   This replaces the current timeline only after confirmation.
5. Edit start, duration and value. Pump values are percent, capped by the saved limit.
   Valve values must be **0 or 100**, without fades; respect minimum on/off times.
   Do not program the decorative nozzle's Speed/Pressure tracks for this contract.
   Program the actual mapped supplying pump and outlet valve instead.
6. Click **Compile current clips**. Unmapped fixtures, unsupported tracks/effects,
   overlapping commands, invalid fades and too-short valve pulses are rejected.
   Pump Speed supports linear fades; Pressure, RGB, motion and flame tracks do not
   route through this release. Existing other hardware workflows remain separate.
7. Verify, Arm and Start the simulation. Use the Siemens STOP button to stop the
   Siemens runner; the timeline's ordinary Play/Pause button previews the timeline.

Every mapping save changes its revision and clears the compiled show. Reload the
saved site in Show Programmer and recompile; no stale mapping is silently reused.
Sites and compiled shows are saved in `~/.aquaflow/siemens_sites.json`, or the
directory selected by `AQUAFLOW_DATA_DIR`. Restart restores configurations only;
verification, arming, sockets and running shows are never restored automatically.

## Setup when the S7-1200 arrives

1. Record the CPU order number, firmware, TIA version, expansion IO modules and VFD model.
   Check compatibility in Siemens documentation for the exact purchased CPU.
2. Have the site's controls engineer design the power/control wiring, independent
   hardware E-stop, motor trips, low-water interlocks and pressure relief.
   AquaFlow is an ordinary show controller; its generated source is not certified safety logic.
3. Enter the actual PLC IP/rack/slot/port and dedicated DB number (default **DB100**).
   Assign every pump an analog `%QW` output and digital `%Qx.y` enable. Assign each
   outlet valve its real digital output and supplying pump. Output locations may not overlap.
4. Enter healthy-high input locations for E-stop, water level, thermal, drive and pressure
   permission. All five are combined locally; blank inputs deliberately keep permission off.
   This initial template uses one site-wide healthy chain per category. Larger sites may
   need individual drive/zone interlocks added and reviewed in the PLC program.
5. Save mapping and **Export TIA package (.zip)**. It contains DB/FB external sources,
   cyclic call instructions, IO schedule, site configuration and a detailed README.
6. In TIA, configure the exact CPU and modules. Generate the external-source blocks,
   assign the interface DB its specified number, and verify the offsets below. Create
   the FB instance with non-retentive state and call it exactly once in a **100-ms cyclic
   interrupt OB**, using the generated call. Do not also call it from OB1.
7. Configure the CPU's permitted S7 PUT/GET communication/access protection. Compile
   and review all TIA diagnostics before downloading. These sources have not been
   compiled in TIA or tested on the purchased hardware by this build.
8. Set VFD acceleration/deceleration, permissible speed range and loss-of-reference
   behaviour. Configure safe CPU STOP substitute values for every output module.
9. Disconnect other software controlling this PLC, including the legacy AquaFlow
   Connect/Tag Browser workflow. Use only the Siemens Site runner for this command DB.
   This runner prevents two of its own armed sites from claiming the same PLC.
10. Switch the saved site to **PHYSICAL**. Save and export/download the final matching
    program if input/output locations, dependencies or speed/timing limits changed.
11. **Verify** performs reads only: DB signature, frame identity and moving heartbeat.
    A successful network connection alone does not arm outputs. Use Safety Monitor to
    establish genuine master/pump/valve permissions with the site's real safety inputs.
    If the existing safety configuration cannot supply those permissions, commission its
    Field I/O first; this feature deliberately does not bypass the safety kernel.
12. With staff at the fountain, confirm the flow path and run one **3-second outlet test**.
    It opens only the chosen valve and requests its supplying pump at at most 10%.
    If this is below the drive's working speed, do not remove drive protection or guess
    a higher setting: have the controls engineer establish the proper commissioning procedure.
13. Record the actual observed physical response for each pump and valve. Confirm that
    the nozzle association, wiring and pump supply are correct. Save those observations.
    Regular shows require all pump/valve commissioning records; outlet tests are the
    bounded exception used to gather those records.
14. Re-Verify, explicitly **Arm**, compile your show, then **Start PLC show**. Arming sends
    an acknowledged OFF handshake. Stop and every playback completion disarm the runner.
15. Before an attended show, test operator Stop, hardware E-stop, low-water/drive trips,
    frozen heartbeat, network removal, CPU STOP and application shutdown. Restore the
    fault, then Verify/Arm/Start explicitly. A fault must never restart the show itself.

**An OFF command acknowledgement confirms PLC acceptance, not physically stopped water.**
Loss of network access is reported as **Stop unconfirmed**. The PLC command watchdog
withdraws outputs after approximately one second without fresh committed commands.
Electrical trips and the independent E-stop must work without the computer/network.

## Contract `aquaflow-siemens-site-v1`

This is a new contract and does not change `aquaflow-s7-1215c-v1`/DB1.

| Byte | Field | Owner |
| --- | --- | --- |
| 0 | Magic WORD 0xAF02 | PLC |
| 2 | Heartbeat UINT, advances each 100-ms cycle | PLC |
| 4 | Permit WORD, bit 0 local healthy chain | PLC |
| 6 | Status WORD, bit 0 RUN | PLC |
| 8 | Site signature DWORD | PLC |
| 12 | Acknowledged sequence UINT | PLC |
| 14 | Reserved WORD | PLC |
| 16 | Committed command sequence UINT | AquaFlow |
| 18 | Flags WORD: bit 0 RUN, bit 15 BUSY | AquaFlow |
| 20–51 | 16 pump UINT speed references, raw 0–27648 | AquaFlow |
| 52–115 | 512 valve bits | AquaFlow |
| 116–211 | RGB bytes reserved, adapter not implemented | Reserved |

The writer sets BUSY, writes the command banks, clears BUSY/sets RUN, and commits
a new sequence last. It waits for acknowledgement. The PLC double-checks sequence/
flags before adopting the snapshot and requires a fresh OFF after a trip. The PLC
also enforces pump outlet gating, speed ceilings and valve on/off timing. Fault/STOP
overrides valve minimum times so an emergency cannot be delayed by a pulse timer.

Next phases: hardware qualification with the purchased CPU, individual actuator
feedback, RGB/DMX integration, a shared music/3D execution clock, and TIA Openness
automation. None is represented as already physically commissioned here.
