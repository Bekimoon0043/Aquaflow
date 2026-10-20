# Physically Accurate, Real-Time Fountain Water Simulation for Show Previsualisation

Scope note: About 17 tool calls were used. Several primary sources could not be read: the Trettel PDF refused the connection, the EPJ fountain-model PDF returned 403, WaterShapes refused the connection, and one arXiv fetch was refused by the fetch tool. Lines marked **[background, unverified]** come from standard textbook knowledge, not from a page fetched in this session. Every one of them is also listed under Gaps so the report writer can decide whether to use it. Lines marked **[computed]** are arithmetic from stated formulas.

## Jet physics: trajectory with drag, breakup, droplet sizes, why real jets fall short of v²/2g

### Takeaway
Ideal height is H = v₀²/2g, with v₀ ≈ Cv·√(2ΔP/ρ). A real jet reaches h = η·H. The height efficiency η falls as H rises and as nozzle diameter shrinks, because the jet breaks into drops that feel air drag. η depends mainly on a Froude-type number (Arato, Crow & Miller, summarised by Trettel 2015). A good real-time model is: an intact column up to the breakup length, then drops with quadratic drag, plus a calibrated η per nozzle.

### Cited Findings
- Torricelli ideal height h₀ = v₀²/(2g); 10 m/s at the exit gives about 5.1 m. Friction between the jet and the still air slows the jet before it reaches the top. The paper ties the shortfall to the jet's diameter growing with height and models it with a Darcy-type loss. — [arXiv 0801.4160](https://arxiv.org/pdf/0801.4160)
- Trettel (2015) defines jet height efficiency ηh ≡ h/H (actual height over drag-free height V₀²/2g). It cites vertical-fountain experiments by Arato, Crow and Miller, which found ηh to be a function of a Froude-type parameter. Only the search snippet was seen; the full PDF was unreachable. — [Trettel 2015](http://www.trettel.us/pubs/2015/Trettel-2015-Theoretical-range-and-trajectory-of-a-water-jet.pdf)
- Freeman's 1888–89 tests of smooth-bore nozzles still underpin fire-stream hydraulics. The related reach formula is for horizontal reach, not vertical height. — [Fire Engineering: straight-stream reach](https://www.fireengineering.com/firefighting-equipment/fireground-hydraulics-straight-stream-reach/)
- Smooth-bore discharge, US units: gpm = 29.72·D²·√P (D in inches, P in psi). — [Fire Engineering: pump operator's equation](https://www.fireengineering.com/firefighting/every-pump-operators-basic-equation/)
- Pressure-head conversion: 1 kPa ≈ 0.102 m water column, 400 kPa ≈ 40.8 m, 1 kg/cm² ≈ 10 m. Jet height depends on nozzle type, flow and base pressure, and losses are computed with Bernoulli, Darcy-Weisbach and K-factor fittings. — [SafeRain: hydraulic calculations for architectural fountains](https://saferain.com/en/blog/hydraulic-calculations-for-architectural-fountains/)
- Historical fountain practice, qualitative: a bore that is too small "lacks weight and power to pierce the air and falls back as vapour or mist", and one that is too large will not rise. Air resistance, friction at the nozzle and pipe friction all reduce height. Real performance was found by trial with an adjustable nozzle. — [Gardenvisit (P. J. Francois)](https://www.gardenvisit.com/book/gardening_tools_equipment_and_buildings/chapter_7_edifices_(for_storage_bees_ice_shelters_etc)/water_supply_for_fountain_jets)
- Breakup regimes for a free jet as velocity rises: dripping, Rayleigh, wind-induced, atomisation. Dripping occurs at very low liquid Weber number. — [arXiv 2409.07056](https://arxiv.org/pdf/2409.07056)
- Five regimes are often used: Rayleigh, first wind-induced, sinuous, second wind-induced, atomisation. The Rayleigh-to-first-wind transition occurs at a constant *liquid* Weber number, and the later transitions at constant *gas* Weber numbers. — [Phys. Rev. Fluids 5, 044001](https://link.aps.org/doi/10.1103/PhysRevFluids.5.044001)
- Regimes classified from photographs are often inaccurate, and breakup length is the better objective measure. Breakup length plateaus as jet velocity rises (without cavitation or Mach effects). — [Trettel, engrXiv preprint](https://engrxiv.org/preprint/download/740/version/1128/1657/1115)
- Empirical breakup-length correlations disagree considerably with each other, even in crossflow. — [KoreaScience review](https://koreascience.kr/journal/OMHHBZ/v18n1.pub)
- Gunn & Kinzer (1949, J. Meteorology 6(4):243–248) remains the "gold standard" for drop terminal velocity. Under turbulence, mean fall speeds can be 25–30% below the Gunn-Kinzer values. — [AMT 2017-401 preprint](https://amt.copernicus.org/preprints/amt-2017-401/amt-2017-401.pdf)

### Inferences
- **Equations of motion for a drop or jet parcel** [background]: dv/dt = g − k·|v_rel|·v_rel, where v_rel = v − v_wind and k = 3·ρ_air·C_d/(4·ρ_w·D). For D = 1 mm and C_d ≈ 0.5, k ≈ 0.45 m⁻¹ [computed], so terminal velocity √(g/k) ≈ 4.7 m/s. That is close to the roughly 4 m/s Gunn-Kinzer figure for 1 mm drops. Use C_d from a Re-dependent law, such as Schiller-Naumann (C_d = 24/Re·(1+0.15Re^0.687) for Re < 1000, and 0.44 above).
- **The intact jet column has almost no drag per unit mass**, because k scales with 1/D, where D is the jet diameter rather than the drop diameter. Height loss therefore comes mainly from the part above the breakup point. Model each nozzle as (a) a coherent column up to L_b, then (b) drops with D_drop ≈ 1.9·d_jet in the Rayleigh regime [background: classic Rayleigh-Plateau result, fastest-growing wavelength ≈ 9.02·r], with a wide distribution (log-normal or gamma) in wind-induced or atomisation regimes.
- **Dimensionless groups to compute per nozzle:** We_l = ρ_w·v²·d/σ, We_g = ρ_air·v²·d/σ, Oh = μ/√(ρ_w·σ·d), Re = ρ_w·v·d/μ. Example [computed]: d = 10 mm and v = 20 m/s (about 2 bar) give We_g ≈ 66, which puts large fountain jets in the wind-induced or atomisation regime. Laminar jets are the deliberate exception.
- **Practical height model** [background, unverified]: the Lueger-type form h = H/(1 + φ·H), with φ ≈ 0.25/(d + (0.1·d)³) for d in mm and H in m. For d = 10 mm and H = 20 m, h ≈ 13.7 m (η ≈ 0.69) [computed]. For d = 25 mm and the same H, h ≈ 17.8 m (η ≈ 0.89). This matches the qualitative rule: larger bore, higher efficiency. Treat φ as a per-nozzle calibration parameter and do not hard-code it.
- **Aerated, foam and geyser jets** are much less dense and much more draggy. Model them as a column with low η (likely below 0.5) and a high spawn rate of large, low-density white particles. No numbers were found.
- **Mist** (atomised droplets, roughly 10–100 µm) has terminal velocity well below 1 m/s, so wind dominates its motion. Simulate it as advected sprites or a volume, not as ballistic drops.

### Gaps
- The full Trettel 2015 text, the Arato-Crow-Miller η(Fr) curve and the original Lueger coefficient could not be retrieved. The Lueger φ formula above is from memory and must be verified, for example in German fountain literature (Lueger, *Lexikon der gesamten Technik*) or the EPJ 2019 fountain model paper, which returned 403.
- No published droplet size distribution was found for fountain nozzles specifically.
- The Gunn-Kinzer numeric table was not retrieved. The values 1 mm ≈ 4 m/s, 2 mm ≈ 6.5 m/s and 5 mm ≈ 9 m/s are background knowledge.

## Nozzle-specific spray models and parameterisation from manufacturer data

### Takeaway
Manufacturers give height against flow and pressure (and pump pairing), but rarely spray angle or drop size. The emitter should be driven by a per-nozzle table (pressure → height, flow), from which exit velocity and a calibrated η are back-solved.

### Cited Findings
- The OASE Comet 3-5T datasheet lists jet heights of 4/5/6 m with matching flow and pressure values (column headings were not readable in the extract). The fountain height range is 0.5–14 m, and the nozzle is "water-level independent". — [OASE Comet 3-5T datasheet](https://www.oase-livingwater.com/fileadmin/dp/media/images-cb/DOK/PRD/DB/DOK_PRD_DB_50959-Comet3-5T_%23SEN_%23AQU_%23V1.pdf)
- For OASE Geyser Jet nozzles, "the pump selected ... ultimately dictates the height". Selection tables pair Aquarius pumps with jet heights. — [Water Garden UK: Geyser T](https://www.water-garden.co.uk/prod/geyser-t-fountain-nozzle)
- Cluster Eco 15-38 pump pairings: Aquarius Eco Expert 22000 gives about 5 m maximum and 44000 gives 7 m. — [Water Garden UK: Cluster Eco](https://www.water-garden.co.uk/prod/nozzle-cluster-eco-15-38)
- Cascade T nozzles depend on water level and need a stable level, which matters for foam/geyser types whose look depends on submergence. — [Water Garden UK: Cascade T](https://www.water-garden.co.uk/prod/oase-cascade-t-nozzles)
- Fontana describes laminar jets as a dedicated "special water effect" product class. — [Fontana Fountains: Laminar Jet](https://fontanafountains.com/products/spray-systems/special-water-effects/laminar-jet/)

### Inferences
Suggested emitter parameter schema (inferred design):
- **Straight or comet jet:** one ribbon or tube of radius d/2 up to L_b, then drop particles. Parameters: d, Cv, η-calibration (or φ), tilt, azimuth.
- **Geyser or foam:** a thick, white, low-η column. Particles are large, opaque, high-drag "clumps" with height jitter of ±10–20% (assumed). The effect is sensitive to water level.
- **Ring or crown:** N jets on a circle of radius R, each tilted outward by an angle α. Instance the straight-jet model N times with a shared pressure.
- **Fan or peacock:** M jets spread across a fan angle θ in one plane, or a thin sheet emitter. Sheets break up by a sheet (not jet) mechanism, so use a sheet ribbon that ruptures into ligaments at a radius.
- **Curtain or water screen:** a line emitter with a planar sheet, used as a projection surface. Render it as a thin animated sheet mesh with noise.
- **Rotating basket or swing nozzle:** a straight jet whose direction comes from a servo or rotation angle θ(t). Each emitted parcel inherits the nozzle direction at its emission time. This produces the characteristic curved "lagging" streak automatically in a particle system, but not in a static tube.
- **Mist:** a volume or sprite emitter with drift.
- **Back-solving from data:** from the (P, Q, h) rows, v₀ = Q/A_eff, H = v₀²/2g, η = h/H. Fit φ, or fit the drag k per nozzle so that the simulated peak matches h.

### Gaps
- No manufacturer data sheet with spray angles, drop sizes or response times was found. Full OASE, Crystal Fountains and Fontana tables still need to be scraped.
- No formal model for foam-jet air entrainment was found.

## Dynamics: flight time, valve open/close fronts, VFD ramps, servo speed, lead times

### Takeaway
Water in flight is a delay line. A jet of height h needs about √(2h/g) to reach its peak (more with drag), and the front and tail of a valve pulse travel up the jet. Choreography therefore needs per-nozzle lead times, roughly 1–3 s for 5–20 m jets, plus valve and pump ramp delays. Large valves are deliberately slowed to avoid water hammer.

### Cited Findings
- Large flows "require large cutoff periods to avoid problems associated with the water hammer effect and vibrations, which may result in drawn out responses". This makes it hard to sync water to music and lights, which respond faster. — [US4844341A Cibernetic fountain patent](https://patents.google.com/patent/US4844341)
- Fast solenoid valves for valve-array displays respond in under 25 ms, with a 50 ms PLC scan per frame. This is from a hobbyist-grade source, so treat it as illustrative. — [Industrial Monitor Direct: PLC musical fountain](https://industrialmonitordirect.com/blogs/knowledgebase/plc-musical-water-fountain-valve-control-implementation)
- Most fountain control sends pre-defined signals at set times, so the whole show is pre-programmed. — [TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)
- Show fountains are commonly programmed over DMX, and programmers adjust timing in the field. — [Pool & Spa Marketing: show fountains](https://poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/print)

### Inferences
- **Rise time to the peak** (drag-free) is t_up = √(2h/g) [computed]: 1 m takes 0.45 s, 5 m takes 1.01 s, 10 m takes 1.43 s, 20 m takes 2.02 s, and 50 m takes 3.19 s. The full arc (up and down) is twice that, longer with drag because the descent is drag-limited. A jet "fully formed" from nozzle to basin takes about 2·t_up after the valve opens.
- **Valve opening:** the jet front is the leading parcel and rises along the ballistic path. The tip height over time is z(t) = v₀t − ½gt², capped at h. Because v₀ ramps up while the valve opens, later parcels are faster and can catch earlier ones; the front bunches into a "cap" or blob, which is visible in real footage. A particle system reproduces this naturally if the emission speed follows v₀(t) = Cv·√(2·ΔP(t)/ρ).
- **Valve closing:** the column detaches from the nozzle, and the last parcels (slow, if the valve closes gradually) fall first. The visible column "hangs" for about t_up and then collapses. The tail-end delay equals the full flight time.
- **VFD pump ramp:** model ΔP(t) as a first-order lag or ramp from the drive's acceleration time. Pump head scales with the square of speed (affinity law), so h ∝ n² and v₀ ∝ n. A linear frequency ramp therefore gives a quadratic height ramp. [background]
- **Lead time per cue:** t_lead = t_valve/VFD response + t_up(h_target), so a music accent on the peak needs the command that much earlier. The simulator should compute this per nozzle and display it on the timeline. AquaFlow can derive it automatically from the same model.
- **Moving nozzles:** with servo angular speed ω, the trajectory shape lags by roughly ω·t_flight. The visible curve of a swinging jet is the locus of parcels emitted at different angles; it is not a rigid rotation.

### Gaps
- No published measured values were found for show-valve opening times, VFD ramp settings in fountain practice, or servo slew rates from fountain manufacturers.
- The WaterShapes choreography article was unreachable.

## Wind: drift, height reduction, splash footprint

### Takeaway
Drift scales strongly and inversely with drop size. Mist drifts almost with the wind, while millimetre drops are moderately deflected. The splash footprint is computed by integrating particle landings with v_rel = v − v_wind, and fountains use anemometer-based height reduction for exactly this reason.

### Cited Findings
- Fall speeds in turbulent air can be 25–30% below still-air terminal velocity, which affects residence time and therefore drift. — [AMT 2017-401 preprint](https://amt.copernicus.org/preprints/amt-2017-401/amt-2017-401.pdf)
- Sprinkler-irrigation literature models droplet velocity and trajectory with drag (ASCE 1989, "Equations Describing Sprinkler Droplet Velocity"). This is the closest engineering analogue for fountain overspray footprints. — [ASCE J. Irrig. Drain. Eng. 1989](https://ascelibrary.com/doi/10.1061/%28ASCE%290733-9437%281989%29115%3A2%28156%29)

### Inferences
- **Drift estimate:** in the relaxation-time limit, a drop with response time τ = v_t/g carried in wind U moves horizontally ≈ U·(t_flight − τ·(1 − e^(−t/τ))). Drops of 1 mm (v_t ≈ 4 m/s, τ ≈ 0.4 s) falling from 10 m in a 5 m/s wind drift several metres. Drops of 100 µm (v_t ≈ 0.3 m/s) move essentially with the air. [computed, from background v_t values]
- **Footprint computation:** run N sampled parcels per nozzle through the drag ODE with a wind vector and gust spectrum, then histogram the landing (x, y) positions into a 2D grid. The basin overspray fraction is the share outside the basin polygon. This can run on the CPU in Python offline (RK4, dt = 5 ms; about 1e5 parcels per nozzle takes seconds) or in the GPU particle pass.
- **Wind compensation:** reduce the height set-point as wind speed rises, a common practice. This is implementable as h_max(U) such that the 95th-percentile landing radius stays within the basin.

### Gaps
- No fountain-specific measured overspray data or anemometer threshold standards were found.

## Real-time techniques: GPU particles, ribbons, SPH/FLIP cost, LOD, numbers, offline export

### Takeaway
For hundreds of nozzles, a full fluid solver (SPH/FLIP) is not feasible in real time. Offline FLIP fountains are heavy even in Houdini. The workable approach is analytic or ballistic GPU particles (WebGPU compute, with a WebGL2 transform-feedback fallback) plus ribbon or tube meshes for the coherent column, with LOD. Budgets of about 1–2 M particles total are plausible on a mid-range GPU.

### Cited Findings
- Simulating and rendering 10 million particles in raw WebGPU ran at about 63 fps on a GTX 1060. — [TU Wien thesis, Peter 2023](https://cg.tuwien.ac.at/research/publications/2023/PETER-2023-PSW)
- A WebGPU SPH real-time demo ran 100k particles at 60 fps with 8 substeps (480 Hz). This is a low-authority source. — [WebGPU SPH demo page](https://irc.pcper.com/webgpu-particles.html)
- CPU particle updates bottleneck around 50k particles, while WebGPU compute shaders reach millions. Use `instancedArray` for persistent GPU buffers in three.js TSL. — [Utsubo: 100 three.js tips (2026)](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- A three.js forum GPGPU galaxy runs 2M particles fully on the GPU. — [three.js forum](https://discourse.threejs.org/t/gpgpu-galaxy-particles/88937)
- WebGPU has shipped in Chrome and Edge since v113 and in Safari 26. The WebGPU renderer in three.js falls back to WebGL2. — [Utsubo: WebGPU migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- The SideFX fountain tutorial (SOP-level FLIP) says detailed fountain sims are heavy. It splits them into smaller sims and recombines them, uses wedge tests for solver settings, and uses SOP Whitewater for bubbles. — [SideFX: How to simulate a small fountain](https://www.sidefx.com/tutorials/how-to-simulate-a-small-fountain/)
- Scale reference: a showcase FLIP waterfall used about 5 M particles for water and 6 M for whitewater, offline. — [80.lv: water over rocks with Houdini FLIP](https://origin.80.lv/articles/realistic-water-cascading-over-rocks-with-houdini-s-flip)
- Unreal Niagara Fluids provides grid-based water simulations, but they are local and costly. — [80.lv: Niagara Fluids](https://80.lv/articles/working-with-niagara-fluids-to-create-water-simulations)

### Inferences
- **Recommended architecture:**
  1. *Column:* per nozzle, an instanced tube or ribbon mesh with its spine sampled analytically (ballistic and drag curve, or a stored trajectory) up to L_b. Vertex shader noise adds surface ripples. One draw call for all jets via instancing.
  2. *Particles:* a single pooled GPU buffer (position, velocity, size, age, nozzle id). A compute pass integrates the drag ODE (semi-implicit Euler is enough at 60 Hz; use 2 substeps for fast jets). Emission speed comes from the timeline-driven ΔP(t).
  3. *Splash and mist:* a spawn-on-impact particle population at the basin plane, plus a low-res mist sprite or froxel volume.
- **Budget** (inferred from the cited throughput): 300 nozzles × 2–5k live particles ≈ 0.6–1.5 M particles. That is well under the 10 M at about 63 fps seen on a GTX 1060, leaving headroom for overdraw, which is usually the real limit for alpha-blended sprites. Keep the sprite count moderate, use soft particles, and render the particle pass at half resolution.
- **LOD:** far nozzles use only the column ribbon plus a few large impostor sprites. Near nozzles add full drops. Cull by frustum per nozzle.
- **Determinism for scrubbing:** a show preview must support seek. Either make particles a pure function of (emit time, nozzle, seed), which works when wind is constant and allows analytic or closed-form integration, or pre-roll by t_flight_max (about 3–4 s) after a seek.
- **WebGL2 fallback:** use transform feedback or ping-pong float textures (the GPUComputationRenderer pattern).
- **Offline export:** for D5 or Blender, write per-frame particle caches. OpenVDB via `pyopenvdb`, or Alembic points via the `alembic` Python bindings, can be produced by the Python backend using the same ODE. The parcel model then becomes a "ground truth" shared by the preview and the export. [background]

### Gaps
- No laptop-specific (integrated or mobile GPU) WebGPU particle benchmarks were found.
- The exact particle count of the official three.js `webgpu_compute_particles` example was not verified.
- No published Niagara fountain-specific setup was found.

## Lighting of water: underwater spots, foam, refraction, bloom, RGB

### Takeaway
Droplets scatter strongly forward (Mie). A jet lit from below glows most when viewed looking toward the light, that is, from above or down the jet. Real-time approximations use a forward-peaked phase function (Henyey-Greenstein, or the Jendersie-d'Eon Mie fit) per particle or ribbon, single scattering only, plus bloom.

### Cited Findings
- Henyey-Greenstein, with anisotropy g from −1 (back) through 0 (isotropic) to +1 (forward), is the standard phase function. — [Maxon C4D: volumetric rendering](https://help.maxon.net/c4d/en-us/Content/html/What_is_Volumetric_Rendering.html.md)
- The Jendersie & d'Eon phase function approximates water-droplet Mie scattering with a stronger forward peak than Henyey-Greenstein. It is used in recent real-time cloud rendering. — [UW: Real-Time Rendering of Atmospheric Clouds](https://digital.lib.washington.edu/researchworks/items/fdd6d0c2-e3fa-4914-9735-62177b690370)
- Real-time methods usually ignore multiple scattering. Wrenninge-style multi-octave approximations are a workaround. — [same UW thesis](https://digital.lib.washington.edu/researchworks/items/fdd6d0c2-e3fa-4914-9735-62177b690370/full)
- Particle-based clouds for games (Harris, GDC 2002) used precomputed multiple forward scattering and first-order anisotropic scattering at runtime. — [Harris GDC 2002](https://aurora.cs.uaf.edu/~olawlor/academic/thesis/ref/RTCloudsForGames_HarrisGDC2002.pdf)
- Froxel-grid volumetric fog (Wronski, SIGGRAPH 2014) is the engine-standard real-time volumetric approach. — [Wronski 2014](https://www.advances.realtimerendering.com/s2014/wronski/bwronski_volumetric_fog_siggraph2014.pdf)

### Inferences
- **Underwater spot lighting a jet:** for each particle or ribbon fragment, compute the in-cone test against the spotlight (position, direction, cone angle, RGB from DMX). Contribution = I·HG(cosθ, g ≈ 0.7–0.85)·attenuation. Sum over a small light count per jet; usually 1–3 fixtures per nozzle are mounted at the nozzle, so lights can be bound per nozzle id. This avoids a global many-light problem.
- **Foam whiteness:** foam and aerated water are high-albedo, near-isotropic scatterers (white). Coherent laminar jets are transparent and mostly show specular highlights and a refracted background. Use a per-nozzle "aeration" parameter to blend from refractive to diffuse-white.
- **Bloom and HDR:** render in linear HDR, apply bloom on bright scattered light, then tone-map (ACES or AgX). RGB fixture colours should be converted from DMX RGB(W) to linear light with the fixture's gamma. Without HDR, saturated LEDs on white foam look washed out.
- **Basin glow:** a cheap additive decal or volume cone above each underwater fixture.

### Gaps
- No source was found specifically on rendering underwater-lit fountain jets in real time, and no measured phase-function values for spray were found.

## Validation against real footage

### Takeaway
No public fountain-jet video dataset was found. Validation must be home-grown: measure peak height and timing from calibrated video, then fit η (or φ) and drag per nozzle.

### Cited Findings
- Regime and breakup classification from images is often inaccurate, so objective, measured breakup length is preferred. This applies to any video-based calibration. — [Trettel, engrXiv](https://engrxiv.org/preprint/download/740/version/1124/1653/1111)
- The sprinkler droplet-velocity equations (ASCE 1989) were developed against measured droplet trajectories, a precedent for calibrating drag models to observed throw. — [ASCE 1989](https://ascelibrary.com/doi/10.1061/%28ASCE%290733-9437%281989%29115%3A2%28156%29)

### Inferences
Suggested calibration procedure:
1. Film each nozzle side-on with a scale reference (a known nozzle spacing or a measuring pole) on a fixed tripod, at 60–240 fps.
2. Background-subtract and threshold the water, which is bright when backlit or lit at night. Take the topmost connected pixel per frame as the tip height z(t).
3. From valve-open events, fit z(t) to the simulated tip curve to estimate the delay and v₀. From the steady state, measure h and fit η or φ. From the collapse after close, check the fall time to fit drag k.
4. Use optical flow (OpenCV Farnebäck or RAFT) on the column to estimate the velocity profile and check against v₀(z).
5. Repeat at several VFD speeds to fit h(n) and confirm the n² scaling.
6. Report error metrics: peak height error (%), rise-time error (ms), landing radius (from top-down footage).

### Gaps
- No public dataset of fountain jet footage with ground-truth pressure and flow was found.
- No published work was found on tracking the jet-tip pose for fountains specifically.
