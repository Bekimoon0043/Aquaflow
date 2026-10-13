# AquaFlow next build: AI coder implementation plan

Date: 2026-10-13
Purpose: Turn the DEPENCE comparison into an executable plan for AquaFlow's fountain design, show programming, preview and control workflow.
Status: Planning document; no product changes are authorized by this document alone.

## Product goal

A designer should be able to import an actual fountain drawing, verify the equipment and hydraulic network, create patterns on a timeline, see the same result in 3D, compile it for the selected controller, test it safely, and hand over an auditable operating package. Every screen should refer to the same fixtures and the same show time.

The first release target is **one representative, fully traceable fountain project**. Use the existing Lebu design as the visual and CAD pilot, and a separate commissioned or simulated Siemens/I-CAN test site for control validation. Do not imply the Lebu project's hardware is mapped or commissioned unless site evidence proves it.

## Starting point and constraints

- AquaFlow already has a group-first Show Studio, CAD/DXF recognition, a 3D water renderer, hydraulic services, protocol drivers, and Siemens/PLCSIM workflows. Extend them rather than starting another parallel editor or renderer.
- `CURRENT_STATUS.md` dated 2026-10-13 says the newest CAD and 3D work is in source and not fully packaged; the desktop package manifest is currently 1.2.32. Determine the actual installed version before claiming a feature is available to operators.
- The worktree is extensively modified. Preserve all existing changes. Make a named baseline snapshot or an isolated branch/worktree before implementation; never use a destructive reset to obtain a clean tree.
- The latest status records two frontend fixture-artifact failures and one backend timing test failure. Reproduce and classify these first. A known failure is not a blanket waiver for a changed code path.
- Commissioning status is separate from protocol implementation. Software tests and PLCSIM are not proof that an installation is ready for unattended operation.
- Existing detailed roadmaps remain authoritative for scoped CAD and renderer tasks: `AF-CAD-DESIGN-RENDER-PLAN.md`, `AF-3D-REALISM-PLAN.md`, and `SHOW-PROGRAMMER-REDESIGN-PLAN.md`. This plan sets cross-system order and release gates.

## AI coder working method

Give the coder **one ticket at a time**. Each ticket should produce a small diff, a short engineering note, and an evidence record. The supervising engineer reviews the diff and user flow before the next ticket begins.

1. Read the relevant existing code, contracts and tests. Record the current behavior before editing.
2. State the data contract, failure behavior, and migration impact. Reuse canonical IDs and units; do not add another store or playback clock without an explicit migration plan.
3. Implement the smallest end-to-end slice, including the UI/API boundary where the task requires one.
4. Run focused tests, then the relevant broader suite and production build. For visual work, capture before/after images on a fixed camera and timestamp. For performance work, record hardware and actual frame time.
5. Report changed files, test commands/results, known limitations, and any behavior requiring field verification. Keep simulated output visibly labeled.
6. Do not automatically arm, start, pulse, or deploy to physical equipment. Such tests require the site's approved operator, interlocks, and a recorded commissioning procedure.

AI coder ticket template:

```text
Goal: <one user-visible or engineering outcome>
Read first: <specific files and existing contracts>
Implement: <bounded behavior, migration, error handling>
Do not change: <out-of-scope subsystems>
Acceptance: <observable end-to-end scenarios and numerical limits>
Evidence: <focused tests, broader test/build result, screenshots or trace>
Handoff: <diff summary, risks, rollback instructions>
```

## Delivery sequence

| Wave | Outcome | Tickets | Exit gate |
| --- | --- | --- | --- |
| 0 | Reproducible baseline and pilot project | AF-NEXT-001 to 003 | Existing failures classified; a portable pilot project opens in the current source app |
| 1 | One show state across timeline, 3D and compile | AF-NEXT-004 to 006 | The same timestamp yields matching fixture commands and preview state |
| 2 | Engineering truth during playback | AF-NEXT-007 to 009 | Pump, valve and nozzle limits affect the preview and compilation diagnostics |
| 3 | CAD and equipment reliability | AF-NEXT-010 to 012 | A real drawing round-trips without losing fixture identity or control mapping |
| 4 | Real-machine proof and operator workflow | AF-NEXT-013 to 016 | Bench evidence, performance budget and release package pass their gates |

### Wave 0: establish an honest baseline

**AF-NEXT-001 — Baseline and test triage.** Inventory current source, installer, license-independent startup, sample projects and test commands. Reproduce the two missing-artifact frontend failures and backend loopback timing failure. Fix tests if their fixtures are stale; fix product code if behavior is wrong. Save exact commands and results in a dated evidence note. Acceptance: a fresh coder can reproduce the baseline without resetting or deleting user changes.

**AF-NEXT-002 — Pilot project package.** Make a portable copy of the Lebu fountain project with the drawing-derived basin/fixtures, a short labeled pattern show, expected camera views and source provenance. Include external assets or a manifest that reports missing assets. Keep provisional hardware addresses clearly provisional. Acceptance: another PC can open it and see the same layout and programmed colors after relinking only clearly reported dependencies.

**AF-NEXT-003 — Journey map and contract inventory.** Trace one fixture from CAD block through Engineering ID, group, recipe, resolved clip, 3D signal, compiler command and controller mapping. Record every conversion of units, coordinates, channel values and color space. Acceptance: one diagram and contract table identify the single writer and reader for each field; inconsistencies become named tasks under Wave 1.

### Wave 1: make playback and preview agree

**AF-NEXT-004 — Canonical evaluated show frame.** Define a versioned, pure `evaluateShowFrame(project, time)` contract that includes fixture ID, effective level/color, pump/valve command, source clip or recipe, and diagnostics. Adapt existing `showModel`, `fullShowPreview`, runtime signal and compiler paths to consume it incrementally. Preserve legacy `.aqua` loading. Acceptance: golden tests compare the timeline, embedded 3D preview, full preview, video sampler and compiler at start, midpoint, fade boundary, loop boundary and blackout. No playhead reset after an ordinary edit.

**AF-NEXT-005 — State and timing parity.** Cover mute/solo inheritance, overlapping clips, fades, pattern phase, curves, tempo changes, sections and stop behavior. Define ownership of simulation time versus PLC follow time. Acceptance: deterministic replay of a fixed five-minute, 300-fixture show produces identical frames for repeated seeks and no unexplained color, level or timing differences between views.

**AF-NEXT-006 — Project recovery and dependencies.** Make project saves atomic and add recoverable autosave snapshots. Package audio, models and textures by manifest or embedded archive with content hashes and explicit missing-file diagnostics. Acceptance: forced app termination during an edit restores the last saved or autosaved state without corrupting the original; reopening on a second PC reports every missing asset before playback.

### Wave 2: connect choreography to fountain physics

**AF-NEXT-007 — Time-dependent hydraulic evaluator.** Connect the existing pump curves, network solver, valve data and nozzle physics to the evaluated show frame. Start with quasi-steady pressure/flow at each sampled time, then add measured or manufacturer-specified pump ramps, valve response and pipe fill delay. Keep creative instant-response mode as an explicit preview choice. Acceptance: an overloaded pump or a closed upstream valve lowers or removes affected jets in engineering preview and creates a named diagnostic; calculations use SI units and preserve solver convergence/error reports.

**AF-NEXT-008 — Safety and splash envelope.** Use active jet trajectories, basin polygons/islands, wind and splash impact data to show overspray across the timeline. Make assumptions visible, including gust factor and nozzle uncertainty. Acceptance: a jet predicted to leave the basin is highlighted at its source and landing region; preflight reports the timestamp and recommended correction. This is advisory until field calibration verifies it.

**AF-NEXT-009 — Preflight compiler gate.** Resolve show recipes once, then check missing fixture links, channel conflicts, pump/valve dependency failures, output limits, minimum on/off time, unsupported channels and unsafe transitions. Associate each issue with a timeline clip and Engineering item. Acceptance: unsafe or unmapped hardware commands cannot be sent; the UI offers a clear fix location; preview-only paths remain available with an unambiguous label.

### Wave 3: complete the design-to-equipment path

**AF-NEXT-010 — Multi-basin and CAD round-trip.** Complete `AF-CAD-013`; use the existing CAD coordinate contract and importer. Import a drawing with two basins and an island, confirm recognized fixtures, edit one item, export DXF, then re-import. Acceptance: basin boundaries, fixture IDs, layer, coordinates, and existing controller addresses survive without unexplained movement or duplicate devices. Unknown units require explicit confirmation.

**AF-NEXT-011 — Essential drafting tools.** Implement the existing `AF-CAD-030` through `AF-CAD-034` sequence first: command history, shared object snaps, typed coordinates/length, selection and basic groups. Continue with modify tools only after the common selection and snapping kernel passes. Acceptance: a novice can draw and connect a 12.5 m pipe to a nozzle port, undo it as one action, and repeat the operation in 2D/3D with the same geometry.

**AF-NEXT-012 — Fixture data trust.** Add source and confidence metadata to nozzle, pump, valve and light data. Start with a small, licensed set of manufacturer-provided or user-measured models. Keep generic estimates labeled and prevent them from being represented as manufacturer specifications. Acceptance: each engineering calculation and BOM line cites its equipment model, data source, units and revision; replacing a fixture type recomputes dependent calculations and flags changed control footprints.

### Wave 4: prove the release and field workflow

**AF-NEXT-013 — Real GPU calibration.** Run the existing 20/100/300-fixture benchmark on representative entry, midrange and high-end Windows GPUs. Record resolution, driver, quality tier, median and worst-frame time, particles, draw calls and memory. Fix the known dense all-lights-on exposure washout and add fixed-scene screenshot comparisons. Acceptance: published quality recommendations are based on measured hardware; medium quality remains usable on the agreed target PC; timeline color and 3D emitted color follow one documented color-space pipeline.

**AF-NEXT-014 — Guided operator workspaces.** Present four top-level journeys: Design, Program, Commission and Operate. Reuse existing panels and actions. Add project-specific guidance for first CAD import, group/pattern creation, preflight, PLCSIM test and safe commissioning. Acceptance: a new operator can complete the pilot project without discovering hidden legacy panels; each warning opens the responsible object or procedure.

**AF-NEXT-015 — Controlled integration and commissioning.** Run simulation, PLCSIM and protocol loopback first. Then execute the existing site checklist under an approved operator on each physical target: I-CAN, Art-Net/sACN, Modbus and Siemens as applicable. Record exact hardware, firmware, wiring, latency, output mapping, blackout, watchdog, network loss and restart results. Acceptance: each protocol/device is labeled `simulated`, `bench verified`, `site commissioned` or `unsupported` in the app and handover; no general claim of field readiness from a single site.

**AF-NEXT-016 — Signed release package.** Build the desktop app with frontend and engine from the same revision; verify version, license behavior, migration of prior `.aqua` files, pilot project, crash recovery, installer/uninstaller and offline startup. Deliver a changelog, known limitations, sample project and commissioning record. Acceptance: a clean Windows installation opens the pilot and passes the documented smoke test; rollback to the previous installer is available without losing project files.

## Gates between waves

- **Wave 0 → 1:** baseline is reproducible and the pilot opens. Existing test failures have owners and explanations.
- **Wave 1 → 2:** a single golden show proves frame parity across program, preview and compile. Existing saved projects migrate correctly.
- **Wave 2 → 3:** engineering preview and preflight agree on pressure, flow and safety findings for the pilot. Invalid hardware output fails closed.
- **Wave 3 → 4:** CAD and equipment records round-trip with stable IDs and provenance. No silent mapping changes.
- **Release:** performance is measured on real GPUs, automated regression is green except any explicitly documented unrelated baseline issue, and physical control claims are backed by site records.

## First AI coder assignment

Start with **AF-NEXT-001**. Its handoff should contain: the exact source revision and desktop version, the test baseline, reproduction of the recorded failures, a pilot-project inventory, and a list of files that Wave 1 will change. Then assign **AF-NEXT-002** and **AF-NEXT-003**. These three tickets establish evidence for the architecture changes and avoid redoing already implemented work.

Ready-to-paste first assignment:

```text
Implement AF-NEXT-001 from AQUAFLOW-AI-CODER-BUILD-PLAN.md.
Read CURRENT_STATUS.md, aquaflow/TESTING.md, aquaflow/frontend/package.json,
aquaflow/backend/pytest.ini, aquaflow/desktop/package.json and the three roadmap files.
Preserve the heavily modified worktree. Do not reset, clean or overwrite user changes.
Record source and installed versions. Run the relevant frontend and backend baseline
tests, reproduce the reported two missing-artifact frontend failures and backend
loopback timing failure, and determine whether each is a test-fixture, environment,
or product defect. Make only a narrowly scoped fix where evidence is sufficient.
Deliver a dated evidence note with commands, results, remaining risks, and the
specific source files/contracts AF-NEXT-002 and AF-NEXT-003 should inspect.
Do not connect to or activate physical fountain hardware.
```

## Effort and decision points

The waves are dependency order, not fixed calendar promises. Use one to three day coding tickets where possible. Review each wave before continuing. Hardware commissioning duration depends on site access, devices and an authorized operator. Manufacturer data and format support depend on permissions and source availability. MVR/GDTF, SMPTE, advanced rendering, drones, lasers and projection can follow after the fountain pilot meets the release gate.
