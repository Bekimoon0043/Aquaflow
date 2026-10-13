# AquaFlow colour pipeline

Status: AF-NEXT-013, 2026-10-13. This describes the code as it is. Mirrors and tests are listed at the end.

A show colour follows one of two paths after the timeline:

1. **Control path:** timeline → DMX/PLC bytes. The values stay sRGB-encoded.
2. **Preview path:** timeline → 3D preview. The values are decoded to linear light, lit, tone-mapped and encoded back to sRGB for the screen.

Both paths start from the same evaluated show frame (`frontend/src/show/evaluateShowFrame.js`, AF-NEXT-004).

```
clip.color "#rrggbb" (sRGB, gamma-encoded, what the colour picker shows)
        │  evaluateShowFrame(project, t)  — HTP, fades, RGB channel clips
        ▼
record.color = { hex, srgb:{r,g,b}, linear:{r,g,b} },  record.level (0..1)
record.output = srgb × level                                   (sRGB-encoded drive)
        │                                              │
        │ CONTROL                                      │ PREVIEW
        ▼                                              ▼
lightBytes(): byte = round(srgb × level × 255)   lightViewState(): { color: hex at full chroma,
→ DMX / Siemens PLC RGB bytes, unchanged         intensity: level (or peak of RGB-channel output) }
(backend/engine/show_frame.py mirrors this)            │ FountainScene._update (fixtureLightStates)
                                                       ▼
                                          THREE.Color(hex) → LINEAR sRGB primaries (ColorManagement)
                                          L.intensity = baseIntensity × level
                                                       │ FixtureLightField.setLights → encodeLight
                                                       ▼
                                          light texture: linear colour × intensity × FIELD_GAIN (1.71)
                                                       │ GLSL fieldLightN (clustered, ≤16 per cell)
                                                       ▼
                       per-sample linear HDR light: cone × windowed 1/(1+0.12 d²) × HG phase (g 0.6)
                       + AF-NEXT-013 overlap count n = Σe_i / max e_i
                                                       │ flDensityNormalize (n > 2 only)
                                                       │ pool surface: flSurfaceKnee → gains → flDenseSurface
                                                       ▼
                       scene-referred linear HDR (HalfFloat composer target, MSAA except eco)
                                                       │ OutputPass: renderer.toneMappingExposure ×
                                                       │ ACES (default) | AgX | Neutral, then linear → sRGB
                                                       ▼
                       display-referred sRGB → bloom (threshold 0.86) → grade → SMAA (high) → canvas
```

## 1. Timeline colour

- Clips, recipes and the colour picker store `#rrggbb`. This is **sRGB-encoded** (IEC 61966-2-1).
- `evaluateShowFrame` returns three forms of the colour:
  - `color.hex`
  - `color.srgb` (0..1, encoded)
  - `color.linear`, from `srgbToLinear`
- `record.output = color.srgb × level` is the drive value.
- The master level multiplies the **encoded** value. This keeps the control output byte-exact with the legacy evaluators.

## 2. Control output: timeline → DMX/PLC RGB

- `lightBytes(record)` computes `round(clamp01(srgb × level) × 255)` for each channel.
- The Siemens runtime uses the Python mirror (`backend/engine/show_frame.py`). Golden parity tests keep it within one 8-bit step.
- No linearisation happens on this path. A fixture receives the same numbers the designer picked.

> **Field verification:** how a fixture turns those bytes into light depends on its dimmer/gamma curve. Many LED drivers apply a gamma or "square-law" curve, which approximately undoes the sRGB encoding. Pure linear PWM does not. Use the site's commissioning record to state which applies. The preview assumes the swatch colour is the intended visible colour (section 3).

## 3. Preview: timeline → linear → fixture light field

- `lightViewState(record)` gives the renderer two values:
  - a full-chroma `hex`
  - an `intensity`: the master level, or the peak of the RGB-channel output when RGB channel clips drive the light
- `FountainScene._update` sets `L.color = new THREE.Color(hex)`. three's ColorManagement is on, so this is a **linear** colour.
  - It also sets `L.intensity = baseIntensity × level`. The level is used as a linear multiplier, which is a linear dimmer assumption. It is an approximation; see section 2.
- Runtime signal colours `{r, g, b}` (the timeline, manual pattern and I-CAN preview `lightingColor`) are **sRGB-encoded 0..1**. These are the same numbers the HUD shows as RGB × 255.
  - `sceneLighting.colorFromSignalColor` now decodes them with `setRGB(r, g, b, SRGBColorSpace)`.
  - Before AF-NEXT-013 it passed them to `new THREE.Color(r, g, b)` as if they were linear. Every mid-tone (for example `#55bfff`) rendered paler than its hex. Primaries, black and white were unaffected.
  - Test: `denseLightExposure.test.js › signal colour decoding`.
- `encodeLight` packs the following into the light texture (`fixtureLightField.js`):
  - colour × intensity × `FIELD_GAIN`
  - position, range (= 3 × radius) and the beam cone
- Shaders evaluate `fieldLightN(p, toCam, g, coneW, maxGroups)`, which returns two things:
  - **rgb:** the linear HDR sum of the nearest ≤16 fixtures of the cluster cell
  - **a:** the overlap count `n = Σ e_i / max e_i`, where `e_i` is a fixture's peak channel at p. One fixture gives exactly 1, however bright. N comparable overlapping fixtures give about N.

### AF-NEXT-013 dense-overlap energy normalisation

| Stage | Where | Rule | 1–2 fixtures |
| --- | --- | --- | --- |
| `flDensityNormalize` | particles, core columns, pool surface | if n > 2: rgb × (2 / n)^0.85. This is a uniform scale, so hue and chroma are unchanged | identical |
| `flSurfaceKnee` | pool surface | the AF-3D-022 soft knee: linear to 0.8, asymptote 1.0 (peak channel) | unchanged |
| `flDenseSurface` | pool surface, **total** fixture term after the bleed, caustic, lift and specular gains | blends in from n = 2 to 4. Linear to 0.6, asymptote 1.0 HDR (peak channel). Uniform scale | identical |

Why 1.0 HDR: at the night exposure (1.55), three's ACES keeps a saturated LED colour's chroma at about 0.9 when the input is 1.0. At 3–4 it falls to 0.45 or lower (`colorPipeline.test.js`). Before this change, the dense pool term reached 3.3. The shader-mirror test (`denseLightExposure.test.js`) shows the effect for 300 overlapping `#0066ff` fixtures under ACES:

| | Peak HDR | Chroma |
| --- | --- | --- |
| Before | 3.29 | 0.41 |
| After | 1.12 | 0.62 |

Results for AgX and Neutral are in `docs/evidence/AF-NEXT-013.md`.

`uFieldDensityNormOff` (a shared field uniform) switches the normalisation off. Only the screenshot harness uses it, to render "before" images.

## 4. Tone mapping and output colour space

- The scene renders linear HDR into a `HalfFloatType` composer target.
  - The target is 4× MSAA on low, medium and high.
  - The `eco` tier uses no MSAA (`QUALITY_CONFIG.eco.msaa = 0`).
- `OutputPass` applies `renderer.toneMapping` and `toneMappingExposure`, then converts linear to sRGB (`renderer.outputColorSpace = SRGBColorSpace`).
  - Exposure presets are authored for ACES. AgX and Neutral receive a calibrated exposure that places mid-grey where ACES places it (`sceneModes.calibratedExposure`).
- Bloom, grade and SMAA run **after** tone mapping, on display-referred values (AF-3D bloom lesson).

**Known gap (not changed here):** the `low` tier has no composer and renders straight to the canvas. Custom `ShaderMaterial`s (water, particles, core columns, glow, cones, sky) do not include `tonemapping_fragment`/`colorspace_fragment`. On `low` they therefore write linear values with no tone mapping or sRGB encoding, while the built-in materials are tone-mapped.

- `eco`, `medium` and `high` all use the composer and are consistent.
- Recommended fix: add the two chunks to every custom fragment shader. They are no-ops when rendering into the composer's render target.

## 5. Video export

The baked video (`FountainScene.bakeVideo`) samples the same show frame at exact times. It renders through the same composer and reads back display-referred sRGB frames. No extra conversion happens.

## Mirrors and tests

| Code | Mirror / test |
| --- | --- |
| `evaluateShowFrame.srgbToLinear` / `lightBytes` | `backend/engine/show_frame.py`; golden parity tests |
| three r165 ACES/AgX/Neutral | `frontend/src/rendering/colorPipeline.js`; `rendering/__tests__/colorPipeline.test.js` |
| `fieldLightN`, `flDensityNormalize`, `flSurfaceKnee`, `flDenseSurface` | `clusteredLightN`, `densityNormalize`, `surfaceKnee`, `denseSurface` in `fixtureLightField.js`; `components/preview/__tests__/denseLightExposure.test.js` |
| Visual check | `node aquaflow/tools/gpu-bench/run.mjs --shots` → `docs/preview-realism/<date>/` |
