# Siemens readiness — 7 October 2026

## Outcome

Software checks are not an on-equipment acceptance certificate. No physical PLC,
pump, valve or protection circuit was connected for this audit. The user's earlier
TIA V17 / PLCSIM success is useful historical evidence, not a repeat test of this
revision. No physical PLC downloads or output writes were attempted.

The intended purchase is interpreted as a **classic S7-1200 CPU 1212C DC/DC/DC**.
Confirm its complete order number and firmware before configuring hardware. Do not
substitute a G2 or fail-safe variant just because its model includes “1212”.

### Update 9 October 2026: G1 end of sale and G2 firmware

- Siemens announced the discontinuation of S7-1200 G1 for **1 Nov 2026**. New G1 CPUs and
  modules can be ordered until **1 Oct 2027**, then spare parts only. Siemens says new
  features go to G2.
- G2 firmware is now **V4.1** as well, so firmware no longer separates G1 from G2. Only the
  order number does: G1 is `6ES7 21x-1xx40-0XB0`, G2 is `-1xx50-0XB0`.
  `engine/siemens_hardware.py::classify_s7_1200` reports G1, G2, F or unknown, and
  Identify CPU shows the result.
- The G2 CPU 1212C (`6ES7 212-1AG50`) has no built-in analog I/O. The G1 1212C has no
  analog output either, so it needs an SB 1232 AQ for VFD speed.
- **Recommended purchase today:** G1 **CPU 1215C DC/DC/DC `6ES7 215-1AG40-0XB0`**. It has 2
  analog outputs and 2 PROFINET ports. On the order, write “no substitution with G2 / -x50
  parts”.
- **Fixed:** the order-number gate rejected the G1 CPU 1214C (`-1AG40`, not `-1AE40`).
- **Planned:** an OPC UA site transport for G2 (FW V4.1+) and S7-1500, and S7-1500 /
  ET 200SP on the existing S7comm contract.

## Implemented

- PLC → Siemens Site has a CPU 1212C simulation starter: one pump, two valves,
  five example interlock inputs and a 20-second alternating show. No physical IP,
  firmware, catalog item or commissioning approval is invented.
- A read-only readiness panel reviews saved mappings, ignored inputs, hardware
  dependencies, observations and supported families. It is included in every TIA
  ZIP as `commissioning-readiness.json`. It never claims hardware acceptance.
- Changing simulation/physical mode, controller target, mapping or limits clears
  channel commissioning approval. Existing observation text remains as history.
- Valve/light fault inputs and light feedback were accepted but unused by the
  generator. Export and physical arming now refuse these unsupported bindings;
  implement reviewed PLC-side interlocks instead of assuming they work.
- The automatic engineering catalog check no longer accepts every 21x prefix.
  It admits only the explicit classic hardware-40 / V4 standard CPU pattern;
  G2, F and unknown variants require separate validation.

## Hardware requirements before buying accessories

The classic CPU 1212C DC/DC/DC has eight digital inputs, six digital outputs and
two analog inputs, **not an integrated analog output**. AquaFlow's present speed
mapping writes a 0–27648 analog command to `%QW`; select a compatible AO signal
board/module and a compatible VFD interface, then verify addressing, signal range,
scaling, enable wiring and protection with the installation engineer. The starter's
`%QW64` is a virtual laboratory address, not an assigned physical terminal.

Do not connect motors or unsuitable solenoid loads directly to CPU outputs. The
cabinet needs correctly rated interfaces/drivers, power supplies, protection and
independent safety circuitry. Three RGB `%QB` process-image bytes are not a DMX
transmitter. Ordinary AquaFlow/PLC interlocks are not a safety-rated E-stop system.

Source: [Siemens CPU 1212C datasheet](https://support.industry.siemens.com/teddatasheet/?caller=SIOS&format=pdf&language=en&mlfbs=6ES7212-1AE40-0XB0).

## This PC

- TIA Portal V17 and S7-PLCSIM V17 installation directories detected.
- Siemens PublicAPI V17 detected (also older compatibility API folders).
- AquaFlow TIA bridge executable not found by the configured bridge search.
- The audit process token did not report Siemens TIA Openness group membership.
  Check membership for the actual signed-in desktop account; a new sign-in is
  required after an administrator changes group membership.
- MSBuild/.NET Framework developer tooling was not found through PATH/vswhere;
  `dotnet --list-sdks` returned no SDKs. A runtime alone cannot build the bridge.

Automatic project creation/compilation/download therefore remains unavailable.
Manual ZIP import into licensed TIA remains the available workflow. To enable
automation, provision the bridge build prerequisites from
`tools/tia-openness-bridge/README.md`, build against the installed PublicAPI V17,
resolve group membership, and verify actual TIA compilation. Do not equate merely
finding a DLL with successful programming. No machine-wide security/group settings
were changed by this audit.

## Supported scope

| Target | Current AquaFlow status |
| --- | --- |
| Classic standard S7-1200 hardware-40 / V4 | Generator target; exact catalog compilation and hardware acceptance still required |
| S7-1200 G2 | Not validated; TIA V20+ and a dedicated compatibility review required |
| S7-1500 / ET 200SP CPU | Not validated; CPU-specific cyclic OB, access, catalog and memory checks required |
| TIA-supported S7-300 / S7-400 / WinAC | Not supported by this generator; legacy SCL/DB/OB adapter required |
| Safety / technology / software variants | No blanket support and no generated safety program |

TIA supporting a CPU does not automatically make AquaFlow's S7-1200 program suitable
for that CPU. The current gate deliberately does not advertise universal Siemens
programming. [Siemens G2 version requirements](https://docs.tia.siemens.cloud/r/simatic_s7_1200_g2_manual_collection_enus_20/plc-concepts-configuration-and-programming/compatibility-between-step-7-versions-and-the-s7-1200-g2-cpu?contentId=4qlyiYI3RPKhHbEM5cgHUQ).

## Use the starter

1. In the updated development build, open PLC → Siemens Site → Create a new site
   or PLCSIM test → Create CPU 1212C starter (simulation).
2. Review the readiness panel. Export its TIA ZIP. The separate offline package in
   `outputs/siemens-1212c-readiness-2026-10-07/` is also available for TIA inspection;
   it has its own site UUID/signature, so do not mix it with a newly created UI site.
3. Follow the ZIP's TIA quickstart: select the exact CPU/firmware, generate sources,
   assign the non-optimized DB number, create the 100 ms cyclic call, compile and
   download to an isolated simulator. Simulator-only forced interlocks must never
   be transferred to an installation with connected outputs.
4. Standard PLCSIM network testing requires the existing NetToPLCsim workflow.
   A TCP connection and moving heartbeat verify the runtime contract, not actuators.
5. Before real commissioning, replace every lab address and select actual hardware,
   save, regenerate/recompile, and perform the acceptance checklist below.

## Physical acceptance still required

- Verify exact order/firmware, installed modules, process-image addresses and wiring.
- Independently verify E-stop/protection circuits and each healthy-high interlock.
- Isolate outputs; confirm compiled code starts safely and outputs are off.
- Observe one outlet/drive at a time under a qualified commissioning procedure;
  record real responses, limits and feedback, not simulation notes.
- Test normal stop, PLC STOP, communications loss and watchdog output-off behavior.
- Confirm reconnection and CPU restart do not automatically arm or resume the show.
- Check feedback polarity, faults, actual hydraulic flow path and pressure limits.
- Complete signed acceptance before enabling normal fountain operation.

## Verification evidence

- Full backend suite: 925 passed, 21 skipped. The skipped fix-strategy tests require
  an absent `EVALUATION_REPORT.md` artifact; no test failures were reported.
- 149 backend communication/runtime/commissioning/safety tests passed, including
  fake-S7 protocol integration. This is not a Siemens compiler or hardware test.
- 588 frontend tests passed across 57 files.
- Frontend production build passed (existing large-bundle warning remains).
- Desktop installer was not rebuilt or replaced in this task. These source changes
  are not yet part of the previously installed v1.2.15 executable.
