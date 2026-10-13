# Lebu fountain pilot (AF-NEXT-002)

This is a portable pilot project. It is the reference design for Wave 0 of `AQUAFLOW-AI-CODER-BUILD-PLAN.md`.

| File | What it is |
| --- | --- |
| `Lebu_Fountain_Pilot.aqua` | The project. It is the only file you need to open the pilot. |
| `manifest.json` | Lists every asset with its role, sha256, size, required/optional flag and status (present or missing). Large CAD files are listed by hash and expected location and are **not** committed. |
| `../../tools/generate_lebu_fountain.mjs` | Regenerates the `.aqua` and `manifest.json`. The output is deterministic because the timestamp is fixed. |
| `../../tools/validate_lebu_fountain.mjs` | Loads the `.aqua` through the real loader, compiles the patterns and re-checks every manifest asset on the PC it runs on. |

## Open it

1. In AquaFlow Studio, open the Show Browser and choose **Open .aqua**. Select `Lebu_Fountain_Pilot.aqua`.
2. Open the 3D Preview. The camera starts on the saved view **Audience · base edge**.
3. To switch views, go to Render sidebar → **Saved views**. The four views are:
   - Plan · top-down
   - Audience · base edge
   - Three-quarter · apex side
   - Center feature close-up
4. Play the timeline. The show is 60 s and loops.
   - **Water:** perimeter chase, then mirrored side waves, then inner crown ripple with the hero pulse, then the finale.
   - **Lights:** moon white `#dff7ff` → cyan `#25bfff` → deep blue `#2266ff` → ice white → finale blue/white.

No dependency has to be relinked to see the layout and the programmed colours. The show has no audio file, 3D models or textures.

## Check the package on a new PC

```
cd aquaflow/frontend
npx vite-node ../tools/validate_lebu_fountain.mjs   # prints present/missing/changed for every asset
npx vitest run src/utils/__tests__/lebuPilot.test.js
```

Plain `node` cannot run the validator because the frontend uses extensionless imports. Use `vite-node`, which ships with vitest.

To regenerate the pilot, run `node aquaflow/tools/generate_lebu_fountain.mjs` from the repository root. The vitest fails if the committed `.aqua` drifts from the generator.

## Provenance

The full record is stored in the `.aqua` under `engineering.provenance`.

**From the drawing.** The source is `lebu fountain.dwg`: AC1021, `$INSUNITS = 6` (metres), layer `Layer 06$fountain`.
- The basin outline has three rational quadratic SPLINE corners (handles 5F60E, 5F610 and 5F612) joined by LINEs (5F60F, 5F611 and 5F613).
- These values were checked against `outputs/lebu_fountain_converted.dxf`.
- Fields that come from the drawing: geometry points, width/length, extents, the display depth-zone outline and the two overall measurements.

**Interpreted from the render (`Scene 9_1.png`).** The DWG fountain layer has no nozzle or light blocks, so all of the following were interpreted from the render:
- all 39 fixtures (15 perimeter jets, 15 paired RGB lights, 6 inner arches, 2 center jets and 1 center light)
- their engineering values
- the central sculpture island
- the groups, recipes and timeline
- the camera views

**Assumptions.**
- The 0.8 m basin depth is assumed.
- The nozzle and light data are generic estimates, not manufacturer data.
- The show is original. It is not a copy of a commissioned controller program.

**Missing sources.** The original DWG and `Scene 9_1.png` were not found on the authoring PC. `manifest.json` marks both as `missing`. Both are optional.

## Hardware

**None is mapped.** The project has these settings:
- `devices: []`
- `integrations.siemensSiteId: null`
- `hardware: { status: "unmapped", provisional: true, addresses: [] }`

Do not treat this pilot as evidence of a mapped or commissioned Lebu installation. Any address added later must carry `provisional: true` until site commissioning records exist. Control validation belongs to a separate commissioned or simulated Siemens/I-CAN test site.

## Earlier copies

The untracked originals are still in `<repo>/.tools/generate_lebu_fountain.mjs` and `validate_lebu_fountain.mjs`, and their output is `<repo>/outputs/Lebu_Fountain_CAD_Pattern.aqua`. They were left untouched.

The pilot design is identical to that output. The differences are:
- the name
- the saved camera views (`render.cameraMode: "named"`)
- `engineering.provenance`
- the explicit `hardware` record
