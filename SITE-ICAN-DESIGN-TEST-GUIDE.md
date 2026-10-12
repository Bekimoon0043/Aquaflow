# AquaFlow real-fountain design and music test

This build adds the site workflow under **Design > Pattern Designer > Site I-CAN**.
The studio creates editable absolute-state patterns for the recovered 64-valve
surface and runs them through the same gated I-CAN transport that already operated
the fountain.

## Show Programmer: AI and measured music as editable blocks (2026-09-16)

1. Open **Design > Engineering Designer** and the saved
   **4KILO Site Fountain - 7 Pump Corrected** project. Open **Design > Show Programmer**.
   Export any current work before replacing its timeline.
2. Click the **AI** tab in Show Programmer's right sidebar. This opens
   **AI / Music Show Builder**; the top application AI menu is separate.
3. For a prompt dance, enter a dance name and a command such as
   `Create a slow center-out wave with a strong finale`. Set **Duration** to 60
   and the manual BPM, then choose a movement or **Choose from prompt**.
   Click **Generate prompt blocks**. Generation leaves the existing timeline intact.
4. Click **Preview proposal in 3D**, then Play/Pause/Stop/seek. **Edit pattern**
   returns to the same proposal and settings. **Append prompt blocks to timeline**
   adds the dance after the current show's last clip or programmed OFF interval.
   An existing 60-second show plus a 60-second prompt dance becomes 120 seconds.
5. For music, choose the WAV under **Music choreography** or the toolbar music picker.
   Set **Duration** to 60, then click **Analyze selected music**. Wait for measured
   BPM and `pcm-wav` or `librosa`. The offline analyzer estimates tempo and measures
   beat times/energy; check alignment in preview. A low-confidence tempo is flagged.
   Metadata-only estimates are refused for automatic music choreography. Use a PCM
   WAV, or generate a prompt dance with a manual BPM instead.
6. Click **Generate music blocks**, then preview the proposal. It uses the first
   60 seconds of the selected track, or the track's length when shorter. Music
   begins at timeline 0. **Replace timeline with music blocks** explicitly replaces
   the current timeline and adds measured beat markers. **Undo** restores its previous
   clips and beats while staying in Show Programmer.
7. Open **Pattern Blocks** to rename, move, resize, duplicate or edit the generated
   phrases. **Detailed clips** edits individual valves. Generated phrases contain
   explicit clip timings rather than an array recipe; duplicate them to repeat their
   current edits, or **Edit movement and outlets** to regenerate the selected phrase
   using Arrays. Show Sections can save/layer these blocks too. Preview after changes.
8. **Save** stores the timeline locally; **Export** makes a transferable JSON show.
   These retain blocks, beat markers and source music information. They do not bundle
   the WAV: select the matching music again after restarting or transferring PCs.
9. In the Block sidebar, expand **3D preview / site controls** and use
   **Preview exact site valve pattern in 3D**. Then
   **Open site pattern controls (review / save / run)** opens the existing site editor
   without sending output. Review and save the draft, keep Repeat 1, select the matching
   WAV, and use the existing gateway/safety/output gates and `RUN MANUAL PATTERN` below.
   Generated support starts OFF; the full proven captured G17 support may be deliberately
   selected in conversion for the previously verified site setup. Individual pump and
   frequency choreography remains locked.

A ready example is `C:/Users/buroo/Downloads/4KILO-60-second-AI-music-6.json`.
Import it with the whole-show toolbar **Import**, then select `music-6.wav` for playback.
It uses the site's previous measured analysis (184.6 BPM, source 319.13 seconds),
seven editable blocks/788 clips, 194 excerpt beat markers and 51 exact states over
60 seconds, including final OFF. The existing backend accepts it. Support is OFF.
It has not been run on physical outputs in this build.

The assistant is an offline supported-style generator driven by prompt keywords,
beat positions and measured energy. It does not provide unrestricted language-model
reasoning or calibrated pump-height control. Generation uses mapped running valves
1–64 only; unresolved running outlets, foam and peacock can still be designed with
Arrays and simulated locally while commissioning is pending. Changing the music
invalidates its analysis/proposal; changing engineering identities, addresses or
tracks requires regenerating the proposal. Cancelling a request preserves the
timeline; an already uploaded audio analysis job may finish on the local backend.

## Show Programmer: reusable sections and layered patterns (2026-09-16)

1. Open the corrected **4KILO Site Fountain - 7 Pump Corrected** engineering project,
   then **Design > Show Programmer > Show Sections**.
2. Tick the checkboxes beside the blocks to combine. **Select all blocks** and
   **Clear block selection** change this selection. Clicking a block's name opens
   its individual inspector; return to **Show Sections** to work on the combination.
3. Set **Start time** and **Gap**. **Sequence selected blocks** places them one after
   another in their current timeline order. **Layer selected blocks** starts their
   movements simultaneously; choose different outlet selections/zones in Arrays
   for independent simultaneous dances. **Move selection together** preserves
   their relative timing. Use **Undo/Redo** to reverse/restore the entire action.
4. Enter a unique **Section name**, then click **Save selected as section**. The
   library records relative timings, internal layering and programmed OFF gaps.
   It also retains individually edited jets. Existing section names are preserved.
5. Scroll the sidebar to **Saved section library** and choose a section. This PC has:
   **4KILO 60-second three-block section** (three sequential 20-second blocks), and
   **4KILO 20-second valve duet** (two simultaneous 32-valve patterns, using odd and
   even valve numbers). These names refer to logical valve numbering; the hardware
   commissioning map still determines their physical positions.
6. Set the insertion **Start time**, **Section repeats** and **Gap**, then click
   **Insert saved section**. For example, a 20-second section repeated three times
   at time 0 with gap 0 creates a 60-second show. Insertion adds blocks to the current
   show; it does not clear existing blocks. To append to the existing 60-second
   example, use start 60. Each inserted block can be edited independently afterward.
7. **Export selected section** exports one reusable combination; **Export section
   library** exports all saved combinations. **Import sections** imports these files
   into the library. Whole-show toolbar **Import/Export** is separate and operates
   on the complete timeline. Sections stay linked to their original fixture IDs
   and matching tracks; a different fountain requires explicit mapping work.
8. For the ready 60-second layered example, use the whole-show toolbar **Import**
   with `C:/Users/buroo/Downloads/4KILO-60-second-layered-valve-duet.json`. This replaces
   the current in-session timeline; save/export any work first. It does not replace
   your locally saved show until you click **Save**. For just the reusable library,
   use sidebar **Import sections** with
   `C:/Users/buroo/Downloads/4KILO-show-section-library.json`.
9. Open **3D preview / site controls**, choose the appropriate 3D preview, and use
   Play/Pause/Stop/seek and **Edit pattern**. Preview again after editing. Real
   fountain rehearsal uses the existing Site I-CAN handoff and gates below.

The 60-second duet contains six independent blocks/1,920 outlet clips and 240 exact
valve states, including the final OFF interval. It uses only the 64 capture-mapped
running valves and leaves captured support OFF by default. The full proven G17
support option can be selected during conversion for the previously verified site
setup. No pump/frequency choreography or additional hardware addresses were added.
Simultaneous ON clips combine; conflicting ON/OFF values are rejected by exact
conversion. Foam/peacock sections can be layered in design preview while their
hardware conversion remains blocked. Section repetition is limited to 1–20, total
show length to 10 minutes, total clips to 20,000, and existing site conversion to
500 states. Preview heights remain illustrative; no physical test ran in this build.

## Show Programmer: edit whole pattern blocks (2026-09-16)

1. Open **Design > Engineering Designer**, then open the saved
   **4KILO Site Fountain - 7 Pump Corrected** project.
2. Open **Design > Show Programmer > Pattern Blocks**. This PC has a new locally
   saved 60-second example: **1 - Traveling blocks**, **2 - Mirrored blocks**,
   **3 - Return blocks**. Each lasts 20 seconds. Click **Load** if needed.
3. Click a block on the timeline or its name on the left. The **Block** sidebar
   displays its outlet count and timing. Change its name, start time or total
   duration, then click **Apply block timing / name**. Dragging a block moves all
   its clips; dragging its right edge stretches them together. **Fit show** makes
   the full dance visible. Use **Undo** and **Redo** to reverse or restore edits.
4. Change **Array cycles** and click **Apply cycles** to repeat the block's
   movement. **Duplicate after this block** copies the entire block after its end;
   move the copy or edit its movement to construct the next section of the show.
5. Click **Edit movement and outlets** to reopen that block in Arrays. Choose the
   movement, physical outlet selection/order and timing, then click **Update block**.
   This explicitly replaces the selected block's outlet clips. Other blocks remain.
   **Array Patterns** or **+ Create array block** creates an additional block.
6. Use **Detailed clips** for individual outlet changes. These edits are retained
   inside their block and disable cycle regeneration; duplication preserves them.
   **Ungroup into independent clips** removes block editing while retaining clips
   and their programmed timing. Existing older array files display as blocks;
   their missing recipes must be explicitly regenerated before changing cycles.
7. Open **3D preview / site controls** in the Block sidebar. Choose **Preview water
   design in 3D** for the engineering design, or **Preview exact site valve pattern
   in 3D** for the supported site's exact ON/OFF sequence. Use Play, Pause, Stop,
   seek and **Edit pattern**. After editing, preview again to load the revised dance.
8. Click **Save** to save the Show Programmer locally. **Export** creates a JSON
   show file for backup/transfer; **Import** restores block definitions and clips.
   **More tools** exposes existing backend show save/load controls. Selecting a WAV
   is separate from exporting JSON; retain the audio file for another PC.
9. For a physical rehearsal, return to **3D preview / site controls**, review the
   exact conversion result and click **Open site pattern controls (review / save /
   run)**. In the existing Site I-CAN editor set Repeat to 1, review/save the draft,
   connect the verified gateway, grant Safety and arm outputs, then type
   **RUN MANUAL PATTERN** to enable Run. Use **STOP PATTERN** to end the rehearsal.

The example uses only 64 capture-mapped running valves, with 0.5-second stage steps
and 0.4-second pulses. It converts to 240 states over exactly 60 seconds, including
the final OFF interval. It is a programming/preview example; this build did not run
the fountain. Captured G17 support defaults OFF. Enable its full proven support
state only for the previously verified site setup; it remains steady through valve
gaps. Foam/peacock and remaining unmapped valves are available for design simulation
but remain blocked from exact hardware conversion. Heights are illustrative.

Stretching scales pulse lengths, stage delays and gaps proportionally. Exact site
conversion enforces its 100 ms state minimum. Blocks must end within 10 minutes and
the show must stay within 20,000 clips; the existing site's 500-state limit can be
reached earlier. JSON remains an editable clip-based show, with block metadata on
one member per block. The existing I-CAN transport and commissioning gates are used.

## Preview the same Site I-CAN pattern in 3D (2026-09-16)

1. Open **Design > Engineering Designer > OPEN SAVED PROJECT…**.
2. Select **4KILO Site Fountain - 7 Pump Corrected** and click **OPEN SELECTED PROJECT**.
3. Open **Design > Pattern Designer > Site I-CAN**, then create or select a saved pattern.
4. Set **Repeat**, then click **PREVIEW THIS PATTERN IN 3D**.
5. Click **Play simulation** in the preview sidebar. Use **Pause simulation**, **Replay**,
   **Stop simulation**, or the position slider. The main toolbar transport also controls
   simulation while the green SIMULATION label is present.
6. Click **Edit pattern**, make changes, and click **PREVIEW THIS PATTERN IN 3D** again
   to load the revised draft. The draft survives these panel switches.
7. Choose **Exit simulation** to return to the normal show preview. Real fountain Run
   remains a separate action in the Site I-CAN editor with its existing safety gates.

No gateway connection or output arm is needed for preview. Preview transport sends no
hardware requests or global playback WebSocket commands. It uses fixture IDs and the
explicit I-CAN address metadata in the current engineering project, preserving corrected
nozzle positions and basin geometry. Step states replace each other; off steps, Stop, and
completion suppress idle decorative water. Mapped running valves 1–64 animate; the 12
unmapped running outlets, 16 foam outlets, and 8 peacock outlets stay off. Heights are
illustrative, not calibrated. Protected commands are identified but do not invent water
output or change the commissioning locks. A selected WAV plays locally with the preview;
the position slider and repeated passes synchronize that audio to the step clock.

## Show Programmer: visual arrays, zones and site handoff (2026-09-16)

1. Open the saved **4KILO Site Fountain - 7 Pump Corrected** engineering project.
2. Open **Design > Show Programmer > Arrays**. Site water outlets now have one
   clearly labeled **Valve ON/OFF** or **Design intensity (uncommissioned)** track;
   actual pump equipment stays separate. The compact toolbar keeps the timeline
   and array sidebar visible; **More tools** opens engineering import, zoom and
   additional validation/preview controls. Show Programmer uses its own timeline.
3. Choose a **Target array**. The default contains the 64 running valves with
   capture-derived addresses. All 100 outlets remain available for design simulation.
4. Click the plan dots to include/exclude individual outlets. **All**, **None**,
   **Odd**, **Even**, half-array selection and **Invert** help with large arrays.
   Hover a dot for its physical label. Enter a zone name and click **Save zone**;
   click that saved zone to reuse its fixture selection.
5. Choose one of 16 movements and an **Array order**. Physical numbering preserves
   the engineering outlet sequence; Engineering X follows corrected left-to-right
   positions. Mirrored Blocks, Traveling Window, Section Chase, Fill and Drain,
   Odd/Even, custom stages and the other movements operate on the selected array.
6. Set start, stage step, pulse length, repeats, gap and block size. Keep
   **Valve ON/OFF clips** selected for site-compatible sequences. Scrub **Preview
   stage** to see the active dots and physical outlet names before generating.
   Custom stage numbers refer to the selected array order, starting at 1.
   For example: `1-4 | off | 5-8 | odd | even | all`. Typos and out-of-range
   selectors are reported instead of silently changing the selection.
7. Click **Generate … Timeline Clips**. Append more patterns at a later start time
   to build the show. Save a named custom pattern to reuse its settings and selection.
   **Save** in the main Show Programmer toolbar persists the timeline locally;
   **Export** backs it up as a portable show JSON. Zones and array presets persist
   locally on this PC. Timeline, selected WAV and builder settings survive panel
   navigation during the current app session; reload the WAV after restarting.
8. Click **Preview water design in 3D**, then **Play simulation**. Design preview
   animates selected mapped and unmapped water outlets, including foam and peacock.
   Intensity and linear fades are illustrative; it does not claim calibrated heights
   or commissioned per-outlet hydraulic control. **Edit pattern** returns to this
   timeline with its clips and array settings preserved.
9. For mapped valve ON/OFF clips, use **Preview exact site valve pattern in 3D**.
   This conversion preserves overlaps, lead-in, silent gaps, programmed trailing OFF
   stages and the final all-group OFF state. It rejects unmapped outlets, equipment
   tracks, analogue values, fades, complex effects, conflicting ON/OFF overlaps,
   duplicate addresses, states shorter than 100 ms, over 500 states and shows over
   10 minutes. It does not drop unsupported tracks from a real-run conversion.
10. To use the captured support state, select **Hold the proven captured G17 support
    state through the valve sequence**. The default is OFF. When selected, the exact
    existing G17 state stays steady from the first ON clip through the last ON clip,
    including valve gaps, then goes OFF. This does not individually address the seven
    pumps or unlock frequency commands. Groups 2 and 25 remain empty.
11. Click **Open site pattern controls (review / save / run)**. It opens the existing
    Site I-CAN editor with the converted pattern and repeat 1. Opening this page sends
    no hardware commands. Review and save there, then use the existing gateway,
    safety-permit and output-arm procedure, type `RUN MANUAL PATTERN`, and click its
    real Run button. Its existing Stop button stops the real show. Simulation Stop
    remains a local preview action.

### A 60-second block dance to try first

On an empty Show Programmer timeline choose the capture-addressed running valves,
**All** selection, **Block Chase**, start **0**, step **0.5 s**, pulse **0.4 s**,
block size **8**, repeats **15**, gap **0**, and **Valve ON/OFF clips** selected.
Generate **960 clips**. The resulting pattern has **240 absolute valve states**
and lasts exactly **60 seconds**, including the trailing OFF interval. Preview it
first, select captured support if using that proven operating state, and hand it
to the existing Site I-CAN controls with repeat **1**. The existing backend
validator accepts this generated pattern; no physical show was started during
development verification. A lead-in can be added with Start time if needed; that
adds to the total duration.

## Existing hardware protections

- Group 2 is locked because the old database identifies a separate frequency controller.
- Group 25 is locked because the old database places rear/fire outputs in that range.
- Group 17 is either off or the exact captured support state that ran successfully.
- The importer omits the old pump, frequency, lighting, fire and valve 65-76 commands.
- Every stop, completed show, safety loss, disconnect or error ends with an all-group blackout.

## Prepare the fountain PC

1. Close the original Chinese I-CAN fountain application.
2. Connect the USB Ethernet adapter directly to the fountain network.
3. Set only that adapter to IPv4 `192.168.5.200`, mask `255.255.255.0`.
4. Leave its default gateway and DNS empty.
5. Open AquaFlow Studio.

## Open the hardware gates

1. Open **Operations > Fountain Control - I-CAN Gateway**.
2. Arm the global safety system. Confirm that the permit says **GRANTED**.
3. Connect manually to gateway `192.168.5.2`, gateway port `200`, local port `2002`.
4. Confirm the connection state is connected. A read-only verification response is useful,
   but output uses the already proven fire-and-forget gateway path.
5. Type `ARM OUTPUT` and click **ARM OUTPUT**.

Keep a person at the physical emergency stop and keep the basin clear during every first run.

## Create a pattern from a command

1. Open **Design > Pattern Designer > Site I-CAN**.
2. Enter a command such as `Create a slow center-out wave with a strong finale`.
3. Set seconds and BPM, or choose a style.
4. Click **Create editable draft**.
5. Inspect every step. Groups 2 and 25 must remain empty. Group 17 must show either zero
   channels or the seven captured support channels.
6. Give the draft a name and click **Save**.
7. For the first physical check, shorten it to 10-15 seconds and set Repeat to 1.
8. Type `RUN MANUAL PATTERN`, click **RUN MANUAL PATTERN**, and watch the fountain.
9. Click **STOP PATTERN** immediately if the physical result differs from the expected zone.

## Analyze music and create a dance

1. In the same Site I-CAN tab, choose a WAV file under **Automatic music choreography**.
2. Wait for the line showing duration, detected BPM and `pcm-wav`.
3. Correct the BPM field if the detector chose half-time or double-time.
4. Describe the desired movement in the prompt and click **Create dance from music**.
5. Save and inspect the generated steps.
6. Leave the same WAV selected. The editor shows `music: filename.wav` beside the run controls.
7. Type `RUN MANUAL PATTERN` and Run. AquaFlow starts the server-timed pattern and local audio
   together. Stop stops both immediately.

## Import and run the six old shows

1. Click **Import the 6 built-in programs** once. Re-importing updates the same six IDs and
   does not create duplicates.
2. Select one from the pattern list: `Legacy - music-1`, `music-3`, `music-4`, `music-5`,
   `music-6`, or `He's a Pirate`.
3. Choose the WAV with the matching filename in the music selector.
4. Inspect and save any edits.
5. For the first check, copy a small section into a new 10-15 second pattern. Run that short
   pattern first.
6. When the short check is correct, select the full imported pattern, keep Repeat at 1,
   type the run phrase, and start it.

The old application's proprietary action blobs are never executed. The importer preserves
the sample-frame section timing and translates named 76-valve effects into the commissioned
64-valve design surface. It is a safe structural reconstruction, so operators should review
and refine the converted motion in the step editor before treating it as the final artistic show.
