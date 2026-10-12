# Siemens easy workflow

This is the supported operator path for TIA Portal V17 or later:

```text
AquaFlow design and compiled timeline
             ↓
TIA V17+ commissioning ZIP
             ↓
TIA Portal imports DB + FB + 100 ms cyclic OB
             ↓
TIA compiles and downloads once
             ↓
TIA closes
             ↓
AquaFlow verifies DB contract and runs the show
```

Open **PLC → Siemens Site** and use the **Easy Siemens workflow** panel.

For the first same-PC TIA/PLCSIM check, click **Create ready 20-second TIA/PLCSIM
test**. AquaFlow creates a simulation-only site with DB100, one pump, two valves,
non-overlapping test outputs and a compiled 20-second pattern. This avoids manual
address entry and cannot send network output until the operator later selects Physical
mode, supplies an address and saves the change.

1. Load the site layout into Engineering Design, build the water dance in Show Programmer, select the Siemens site and click **Compile current clips**.
2. Map each pump speed and enable output, valve output, RGB-light output, feedback/fault input and the five healthy-high safety inputs. Save the mapping.
3. Click **Export TIA V17+ + pattern**. The ZIP contains the TIA sources, compiled AquaFlow pattern, timeline CSV, I/O schedule, connection profile, contract manifest, `TIA-V17-PLUS-QUICKSTART.txt` and `SAME-PC-PLCSIM-GUIDE.txt`.
4. For manual V17 import, generate the interface DB and control FB from their sources. Create OB200 `AquaFlowCycle` directly in TIA as a 100 ms cyclic interrupt with phase 0 and paste the supplied call. This makes the event class explicit instead of assuming an imported organization-block source received the correct event. Use `PLCSIM-ONLY-cyclic-call.txt` only in an isolated simulator; physical hardware requires reviewed healthy-high inputs.
5. Configure the exact CPU/modules/network, enable the approved PUT/GET connection, confirm non-optimized DB access, compile with zero errors and download.
6. Close TIA Portal. In AquaFlow choose Physical mode and enter the physical PLC IP. With standard PLCSIM plus NetToPLCsim, enter the Windows bridge IP. Save and click **Verify PLC connection**.
7. Commission one outlet at a time before arming a complete physical show.

The pattern files in the ZIP provide an exact portable record of the show and site signature. AquaFlow remains the show scheduler. The PLC owns deterministic I/O application, interlocks, feedback and the communication-loss watchdog.

The export does not represent source generation as successful Siemens compilation or download. Those stages occur in TIA Portal and must be confirmed by the operator.
