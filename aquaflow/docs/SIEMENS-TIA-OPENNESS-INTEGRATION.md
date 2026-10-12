# Siemens engineering inside AquaFlow

AquaFlow's Siemens site workflow now separates four facts:

1. **Source generated** — AquaFlow generated reviewable SCL/DB source and an I/O schedule.
2. **TIA project generated** — Siemens TIA Portal Openness created a real project, selected the exact catalog CPU, added declared modules, and generated blocks from the AquaFlow sources.
3. **Compiled** — Siemens `ICompilable` returned zero errors for the current site revision and program signature.
4. **Downloaded** — Siemens `DownloadProvider` reported completion for the selected physical target. AquaFlow leaves the CPU in STOP.

An S7 connection, a ZIP export, or a successful AquaFlow simulation does not imply any later stage.

## Required Siemens installation

- Windows 10/11 supported by the chosen TIA release
- Licensed STEP 7 Basic or Professional that supports the purchased S7-1200 CPU
- Matching TIA Portal Openness option installed from the same TIA setup
- Current Windows user added to the local **Siemens TIA Openness** group, followed by sign-out/sign-in
- Visual Studio 2017 or later plus .NET Framework 4.8 SDK to build the version-bound bridge
- Every HSP/option package used by the selected CPU and modules

Build `tools/tia-openness-bridge` against the exact installed `PublicAPI\Vxx` directory. Set `AQUAFLOW_TIA_BRIDGE` to the resulting executable during development, or stage the executable as `resources/tia-openness-bridge/AquaFlow.TiaBridge.exe` in a packaged installation. The bridge reports the loaded `Siemens.Engineering.dll` file version and refuses every engineering operation when it does not match the TIA version saved in the site.

## Why AquaFlowCycle is required

`AquaFlowSiteControl` treats one invocation as 100 ms. Its command watchdog trips after ten missed calls and its valve minimum-on/minimum-off counters are generated in 100 ms ticks. Calling it from OB1 would therefore make a nominal one-second watchdog and every valve dwell limit vary with PLC scan time. Calling it from two OBs would double-count time and can change pump/valve sequencing.

The block must run exactly once from a 100 ms cyclic interrupt OB. The compile bridge now checks all of these facts before asking Siemens to compile:

- the IO block is the configured DB number;
- the selected CPU item still has the exact saved TIA hardware-catalog `TypeIdentifier`;
- `AquaFlowCycle` exists, has OB number 200 or higher, and Siemens reports a cyclic-interrupt secondary type;
- Siemens reports `CyclicTime = 100000` microseconds and `PhaseOffset = 0`;
- an Openness XML export of the OB contains the `AquaFlowSiteControlInstance` call and all five healthy-high safety arguments.

A block with the correct name alone no longer passes this gate.

## Cyclic OB automation

`Generate TIA project` now performs the former manual step. AquaFlow generates `AquaFlowCycle.scl` with the reviewed call, asks the selected installed TIA release to create the initial OB, and exports that OB through Openness. This gives AquaFlow a version-native SimaticML document with the correct Siemens namespaces, schema and generated content. AquaFlow changes only `AutoNumber`, `Number` and `SecondaryType`, reimports the OB through Siemens `PlcBlockComposition.Import`, and reads the resulting CPU-specific properties back.

Project generation succeeds only when Siemens confirms all of the following:

1. `AquaFlowCycle` is an S7-1200 cyclic interrupt OB.
2. Its number is 200 or higher.
3. `CyclicTime` is 100000 microseconds and `PhaseOffset` is zero.
4. Its exported code contains the exact instance call and all five healthy-high safety parameters.
5. The IO DB number and CPU TypeIdentifier match the saved AquaFlow site.

This avoids shipping a fixed SimaticML template from a different TIA version. If the selected CPU or TIA release does not support the round trip, the Siemens import/readback fails, the project is not recorded as generated, and compilation/download remain blocked. The same validation runs again before compilation and before physical download.

## Operator workflow

1. Create a Siemens site in **PLC Integration > Siemens Site**.
2. Enter pump/valve counts, safety inputs, physical outputs and commissioning limits.
3. Enter the TIA version and copy the CPU `TypeIdentifier` exactly from TIA's installed hardware catalog. Do the same for every signal/communication module and enter its rack position.
4. Save the site. Any later routing, limit, CPU or module change invalidates the previous engineering result.
5. Confirm the TIA status box says **READY**.
6. Select **Generate TIA project**. AquaFlow creates the hardware station, imports its DB/control FB and automatically creates and verifies `AquaFlowCycle` through Siemens Openness.
7. Select **Compile with Siemens**. AquaFlow verifies the CPU, DB number, OB event/timing and reviewed call again, then records every Siemens diagnostic. A zero-error result is the only state recorded as compiled.
8. Keep the site in simulation until wiring, E-stop, water level, drive trips, pressure relief, VFD limits and substitute outputs have been checked by the responsible controls engineer.
9. Set a unicast PLC IP, physical mode and the exact Siemens PG/PC interface. Save, regenerate and compile because this is a new revision.
10. Secure physical outputs, verify CPU order/firmware and every module against the cabinet, ensure no show is running, type `DOWNLOAD <site name>`, and acknowledge CPU STOP. Allow memory reinitialization only for a new/known-safe CPU or after reviewing the loss of retained values, then select **Download to PLC**. The bridge opens that project again, repeats program verification and recompiles it immediately before invoking the Siemens download provider; a saved earlier compile state cannot by itself authorize download.
11. Resolve any Siemens prompt AquaFlow refuses. AquaFlow aborts on target mismatch, protection change, memory reset, active tests, unrecognized callbacks, or missing credentials. It never bypasses access protection and never selects post-download RUN.
12. Inspect read-only TIA/AquaFlow status. Put the CPU into RUN under the site's commissioning procedure, then use AquaFlow **Verify**, **Arm**, and single-outlet commissioning before running a show.

## Current verification boundary

The Python orchestration, revision/signature gates, generated source, CPU/TIA compatibility gates, cyclic-OB round-trip contract, fake bridge operations, compile/download failure handling and no-Siemens failure path are testable on an ordinary development PC. The .NET bridge must be built against the exact Siemens release because Siemens' API is version-bound. This machine has no Siemens PublicAPI installed, so the new SimaticML round trip has not been compiled or executed against an actual Siemens assembly here. This repository has not compiled or downloaded through TIA Portal on a real S7-1200. Hardware catalog identifiers, module positions, cyclic event assignment, download callbacks and CPU behavior must be validated on the purchased bench PLC before production use.

The proven I-CAN gateway/control implementation is separate and is not referenced by this workflow.
