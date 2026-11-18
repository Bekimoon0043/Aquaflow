# Fountain components and materials for the Blender addon

## Purpose

This document defines the generic component/material library and the behavior used when AquaFlow does not contain a verified manufacturer model. These are visualization defaults, not product certification, hydraulic sign-off, or a substitute for commissioning data.

## Component behavior

### Clear, straight and arch nozzles

Clear nozzles use a coherent outlet and a flow/pressure-derived exit velocity. Arches use an aimed ballistic direction. Laminar products need low disturbance; they should not receive the same breakup/randomness as an aerated nozzle. Oase describes its Comet as a clear, wind-stable full jet with a flow rectifier and brass body ([Oase Comet](https://www.oase.com/cs-CZ/fountain-technology/comet-3-6-t-npt-us)).

### Aerated and foam nozzles

Aerated jets use air/water mixture appearance rather than clear-water emission. Injector behavior can be water-level dependent. Oase's Cascade 90 T explicitly describes air being drawn in and mixed, a fuller/lower pattern at excess water level, and recommends a non-return valve where changing water levels could drain back to injector height ([Oase Cascade 90 T](https://www.oase.com/cs-CZ/fountain-technology/cascade-90-t-int)). The addon records these relationships; it does not claim to solve injector gas entrainment in Mantaflow.

### Crown and fan nozzles

Representative outlets share flow and area. A multi-outlet product must not receive full single-outlet flow at every outlet. Oase's Crown Nozzle has 24 fixed inclined 6 mm outlets, demonstrating why the physical outlet count matters ([Oase Crown Nozzle](https://www.oase.com/en-GB/water-technology/crownnozzle-24-20-e)). The addon supports a declared `outletCount`, otherwise a labeled representative default.

### Bells, mushrooms and cascades

These are thin-film forms. Native mode uses representative radial or sheet inflows; proxy mode uses an editable film surface. Film thickness, breakup and rim instability still require product/shot tuning. A bulk-liquid mesh alone does not prove a stable bell or curtain.

### Mist

Mist is represented with scattering volume/particles, not as a bulk pool-filling jet. Product pressure, droplet size and wind are required for a more accurate model.

### Pumps

The simplified response follows the pump affinity relationships used in AquaFlow: flow varies approximately with speed, head with speed squared, and power with speed cubed. Grundfos documents the same affinity laws ([Pump handbook, p.104](https://magazines.grundfos.com/Grundfos/SU/UK/grundfos-pump-handbook/?Page=104)).

A programmed pump follows `pump_speed`. An unprogrammed pump implicitly follows the speed demanded by its nozzles. The first-order ramp uses `rampTimeConstantS`, or `rampTimeS/3`, otherwise the AquaFlow default 1.5 s. The addon does not duplicate AquaFlow's full Global Gradient network solve; it prepares time-varying Mantaflow boundary conditions.

### Valves

A linked valve gates its branch with a linear stroke. `responseTimeS`/`actuationTimeS` wins; defaults are 0.3 s for solenoids and 6 s for motorized valves. ASCO's engineering information shows that actual direct-acting response can be milliseconds, while larger/pilot-operated products vary substantially ([ASCO engineering information](https://marshallwnelson.com/wp-content/uploads/2017/08/ASCO-solenoid-valves-engineering-information.pdf)). Therefore the 0.3 s value is a conservative generic default, not a universal valve specification.

### Pipes and filling

Manual pipes become editable pressure-pipe/flange assets. `pipeLengthM` and `pipeDiameterM` determine branch volume. A jet cannot appear before that volume has filled when priming is modeled. Idle branches can drain. The renderer must not add arbitrary per-nozzle delays: identical commands and identical network data remain simultaneous.

### Filters, tanks and other equipment

Filters receive vessels, lids and drain geometry; their hydraulic role is additional pressure loss and maintenance, not water emission. Tanks/compressors are stored-volume equipment. Generic enclosures are used when no better component model exists.

### Lights

Lights have three distinct outputs:

1. A Cycles light with radiant-power estimate, cone/area distribution, physical source size and show animation.
2. A colored emissive lens that makes the actual source visible to camera/reflections.
3. Water and spray volume scattering that allows a beam to be seen. Clear water alone should not be emissive.

The environment is only a reflection/fill rig. It must not overpower the fixture colors. IES data remains preferable to estimated power.

## Material presets

| Asset key | Appearance / use | Physical starting values |
| --- | --- | --- |
| `stainless_316l` | Wet nozzle bodies, flanges, pump/valve metalwork | Metallic 1.0, roughness 0.22, anisotropy 0.35 |
| `brass` | Machined nozzle and valve bodies | Metallic 1.0, roughness 0.28 |
| `bronze` | Older/wet nozzle and valve bodies | Metallic 1.0, roughness 0.34 |
| `pvc` | Pressure pipes and plastic fittings | Non-metallic, roughness 0.46 |
| `hdpe` | Dark pressure pipes | Non-metallic, roughness 0.52 |
| `epdm` | Seals, gaskets, dark bore interiors | Non-metallic, roughness 0.76 |
| `glass` | Luminaire lens | IOR 1.5, transmission 0.9 |
| `cast_equipment` | Painted pump motor/equipment casing | Metallic 0.55, roughness 0.4 |
| `wet_tile` | Basin finishes | Non-metallic, roughness 0.24 |
| `concrete` | Deck/cast structure | Non-metallic, roughness 0.84 |

Crystal Fountains lists stainless steel, brass and bronze as nozzle materials and also discusses the role of maintenance and water quality ([Crystal Fountains](https://crystalfountains.com/product-category/traditional-nozzles/non-interactive-foam-nozzles/)). The material choice is not only cosmetic: stainless grade, water chemistry, galvanic pairing, seals and maintenance affect real service life. The addon does not infer corrosion resistance from a color preset.

## Engineering fields honored first

- `material`, `outletCount`, `flowLpm`, `pressureBar`, `nozzleDiaMm`, `jetHeightM`.
- `pumpId` / `supplyingPumpId`, `valveId` / `linkedValveId`.
- `rampTimeConstantS`, `rampTimeS`, `accelerationTimeS`.
- `responseTimeS`, `actuationTimeS`.
- `pipeLengthM`, `pipeDiameterM`, `pipesInitiallyFilled`, `drainWhenIdle`.
- `lumens`, `beamAngleDeg`, `mountHeightM`, `pairedNozzleId`, area dimensions and IES paths.

Missing values remain labeled estimates. Do not silently replace a product's declared engineering data with these generic presets.

## Water-containment rules

1. The visual wall and fluid collision wall are separate.
2. A continuous solidified collision ring prevents segment-gap seepage.
3. Collision thickness increases with voxel size at coarse preview resolutions.
4. Native emitters keep their actual radius. Under-resolved nozzles remain proxies or use a local domain instead of flooding the basin through enlarged emitters.
5. Rim overflow outflows remove excess recirculating water above the target level; a closed domain without drainage would overfill and submerge the jets.
6. External gutter outflows remove overspray/runoff outside the wall instead of letting it pool on the deck.
7. New simulations use a new cache version rather than reusing an older leaky cache.

These are preview robustness measures, not a guarantee against every possible leak at arbitrary geometry/resolution. Inspect the baked mesh and increase resolution for production.
