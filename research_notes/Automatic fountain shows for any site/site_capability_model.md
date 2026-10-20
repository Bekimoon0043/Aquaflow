# Site Capability Model: What Fountain Software Must Know About a Site to Generate Shows Automatically

Research notes from a 2026-10-20 web search session of about 16 tool calls. Many manufacturer pages (OASE) returned HTTP 429, and several datasheets could not be fetched. Many numbers below come from manufacturer product pages, retailer pages, or search-result summaries of them. Where a number is general engineering knowledge and not from a fetched source, it is listed under **Inferences** and marked that way.

---

## 1. Taxonomy of nozzles/effects and their control characteristics

### Takeaway
Each effect class has a different actuator and therefore a different "speed of change". Solenoid on/off works in tens of ms. A VFD pump moves height in about 1–3 s ramps, and manufacturers set minimum ramp times. Pneumatic shooters have refill/cycle times in the tens of seconds. Servo 2D/3D heads are pulse/position-controlled. A generator must store per-output actuator type, height-vs-flow/pressure curve, and rate limits. It cannot treat outputs as generic 0–100% channels.

### Cited Findings
**Straight/clear-jet (smooth-bore) nozzles: height ↔ flow/pressure tables exist per nozzle**
- The OASE Comet 3-5 T clear-jet datasheet tabulates water need (DWB) and pressure need (DDB) per fountain height, separately for fresh, pool and sea water. Examples: about 6.3 L/min at 1.0 m and about 9.3 L/min at 2.0 m, with the series covering 0.5–14 m heights — [OASE Comet3-5T datasheet](https://www.oase-livingwater.com/fileadmin/dp/media/images-cb/DOK/PRD/DB/DOK_PRD_DB_50959-Comet3-5T_%23SEN_%23AQU_%23V1.pdf) (values from search summary of the PDF)
- Larger Comet 10-12T: about 21 L/min at 0.5 m and about 68 L/min at 4.0 m — same OASE datasheet series (50968–50971) per search summary — [OASE datasheet](https://www.oase-livingwater.com/fileadmin/dp/media/images-cb/DOK/PRD/DB/DOK_PRD_DB_50959-Comet3-5T_%23SEN_%23AQU_%23V1.pdf)
- Ideal vertical jet kinematics: h = v²/2g. Example: v = 10 m/s through a 20 mm bore → ideal apex 5.10 m, Q = 188.5 L/min, round-trip (rise+fall) time 2.04 s, jet kinetic power 157 W. Real height is lower and real power higher — [FirgelliAuto luminous fountain](https://www.firgelliauto.com/blogs/mechanisms/luminous-fountain)
- Also from that source: solenoids give on/off bursts with a 30–60 ms response, VFDs ramp pump speed to vary height smoothly, and show-file sync drift of ~50 ms against audio is noticeable — [FirgelliAuto](https://www.firgelliauto.com/blogs/mechanisms/luminous-fountain) (secondary/blog source; per the search snippet; the fetched page body showed only kinematics)

**Foam / aerated / geyser / cascade**
- Geyser nozzles are water-level dependent. Cascade T nozzles mix air and water for a spume pattern. Achievable height depends mainly on the pump — [Water Garden UK, Geyser T](https://www.water-garden.co.uk/prod/geyser-t-fountain-nozzle); [Cascade T](https://www.water-garden.co.uk/prod/oase-cascade-t-nozzles)
- Foam nozzles (Schaumsprudler) work regardless of water level. The 35-10 E gives about 60 cm with a 4000 L/h-class pump, and the 55-15 E about 170 cm with an Aquarius Universal 21000 — [Cotswold Koi](https://www.cotswoldkoi.co.uk/product/oase-schaumsprudler-35-10-e/)
- The Cluster Eco 15-38 is rated up to 10 m, about 5 m with an Aquarius Eco Expert 22000 — [Cotswold Koi](https://www.cotswoldkoi.co.uk/product/oase-cluster-eco-15-38-fountain-nozzle/)

**Pneumatic shooters (air shooter / "super shooter")**
- The OASE Air Nozzle 24 E gives up to 21 m at max 5 bar air with a 24 V DC solenoid. The 20 E gives up to 15 m. Shot height rises with air pressure, and 60 m examples are "on request" — [OASE FT catalogue p.21](https://www.oase-livingwater.com/fileadmin/pageflip/32384_ft_katalog_gb/files/assets/basic-html/page21.html)
- The OASE AirNozzle 50 E is listed for 30–70 m heights at max 11 bar, 24 V DC, with a shooting frequency/refill time of 25 s — [OASE AirNozzle 50 E](https://www.oase.com/en-au/fountain-technology/airnozzle-50-e-50-m-vertical-01); [70 m variant](https://www.oase.com/pl-PL/fountain-technology/airnozzle-50-e-70-m-vertical-01)
- OASE advises sizing pipe volume and set pressure so residual pressure stays high after a shot. Varying set pressure changes jet height — [OASE catalogue p.21](https://www.oase-livingwater.com/fileadmin/pageflip/32384_ft_katalog_gb/files/assets/basic-html/page21.html)
- A generic high-energy air-pulse solenoid (Aignep 09F) opens and closes in about 100 ms. It is not a fountain product and serves only as a reference point — [SIAMS news](https://www.siams.ch/news-en/New-09F-Series-High-Energy-Air-Pulse-Solenoid-Valves/7085)

**Moving (swing/2D) nozzles**
- The OASE Multi-Directional Drive L 2D (DMX02) pivots max 200° on X and max 140° on Y, with a DMX speed channel. The deg/s value was not retrievable (HTTP 429) — [OASE MDD L 2D](https://www.oase.com/nl-NL/fountain-technology/multi-directional-drive-l-2d-dmx02) (via search snippet)
- INVT large music fountain: each 2D nozzle uses 2 servo axes (servo motor + reducer, one shaft horizontal, one vertical). Control is pulse-train from a music-fountain controller with 4 axes per card. Parameters include inertia adaptation, rigidity, homing/origin search at power-on, and reducer ratio. Fountain heights are 15–80 m on 9,000 m² — [INVT](https://www.invt.com/solutions/application-of-servo-system-in-large-music-fountain-113)
- Patents describe nozzles moved in two degrees of freedom about two roughly perpendicular axes using servo-motors — [US6053423](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6053423); robotic nozzle [US9492834](https://patents.google.com/patent/US9492834); nozzle positioning [US9315974](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9315974)

**Rotating nozzles**
- OASE rotating nozzles (5-15 E, 5-30 E): start-up from 0 to 100% of max height must take **no less than 3 s**. This is an explicit manufacturer ramp-rate constraint — [OASE rotating nozzle 5-30 E](https://www.oase.com/en/water-technology/rotating-nozzle-5-30-e-int); [5-15 E](https://www.oase.com/en/water-technology/rotating-nozzle-5-15-e-int)

**Lights**
- OASE ProfiLux LED XL RGBW Spot /DMX/02: **6 DMX channels (R, G, B, W, strobe, dimmer)**, 24 V DC, 50 W, 2.2 A, IP68 to 4 m depth. The Basic variant is rated to 2 m depth with up to 50,000 h life. DMX/RDM works only via the Underwater LED Driver Compact/DMX/02, with galvanic isolation between DMX and 24 V DC — [OASE ProfiLux XL RGBW Spot](https://www.oase.com/en/fountain-technology/profilux-led-xl-rgbw-spot-dmx02-int); [Flood](https://www.oase.com/en/fountain-technology/profilux-led-xl-rgbw-flooddmx02-int); [Basic](https://www.oase.com/it-IT/fountain-technology/profilux-basic-led-xl-rgbw-spot-dmx02)

### Inferences
- Treat these as **default rate-limit priors**, to be overridden by site commissioning data:
  - Solenoid-switched jet: valve 30–60 ms (blog source). Visible jet build-up is limited by the rise time to apex, roughly √(2h/g): about 1.0 s for 5 m and about 1.4 s for 10 m. The fall-out time after close is about the same. Physics inference: a "beat-accurate" off needs the water already in the air to fall, so visual off-latency ≈ fall time.
  - VFD pump: use a configurable accel/decel ramp. Use OASE's ≥3 s for 0→100% on rotating nozzles as a hard floor where specified, and otherwise a site-commissioned default (likely 1–5 s; **unsourced**).
  - Pneumatic shooter: one shot, then a refill lockout (25 s for the OASE 50 E). The generator must schedule shooters as discrete events with a cooldown, not as continuous channels.
  - Servo 2D: position + speed channels, homing at power-on, mechanical range limits (e.g. 200°×140°). Max deg/s must come from the device profile.
- For the pump-height relationship, the standard centrifugal pump affinity laws apply (general engineering knowledge, not fetched): Q ∝ n, H ∝ n², P ∝ n³. With jet height H_jet ≈ nozzle head, **jet height scales roughly with (f/f_max)²** for a VFD-driven single-nozzle pump, minus static head. A linear 0–100% "height" slider should map to frequency via a square root, e.g. f = f_min + (f_max−f_min)·√(h_target/h_max). Validate per site with a few measured points.

### Gaps
- No primary-source deg/s for musical-fountain swing servos. The OASE MDD datasheet was blocked. Typical Chinese music-fountain 2D swing nozzles are anecdotally around 30–90°/s, but this is **unverified**.
- No sourced values were found for laminar-jet "jumping jet" cut-off times, ring/crown or fan/peacock flows, mist/fog nozzle pressures (high-pressure mist is typically ~70 bar, **unverified**), fire effects, or water-screen projection specs.
- No manufacturer-published minimum on/off times for solenoid valves in fountain duty were found (water hammer and coil duty limits are the drivers).

---

## 2. Hydraulic topology and coupling

### Takeaway
Three topologies dominate: (a) one pump (often VFD) per effect or group, which gives independent proportional height; (b) one pump plus a manifold with solenoid valves per nozzle or group, which gives on/off with coupling, because opening more valves drops pressure and height on the others; and (c) hybrids. The capability model must encode **which outputs share a hydraulic source**, and the generator must budget total flow per source.

### Cited Findings
- Total pump head = static head + friction head + nozzle head loss. Worked example: 12 nozzles making a 6 ft spray through a 2.5 in pipe and distributor need about 19.3 ft head — [Scribd fountain tutorial](https://www.scribd.com/document/76824765/Tutorial-Fountain) (via search summary)
- Header vs nozzle losses: if header losses approach nozzle losses, the first nozzles take most of the flow and downstream ones starve — [Industrial Monitor Direct, spray header](https://industrialmonitordirect.com/blogs/knowledgebase/spray-wash-header-hydraulic-design-calculations). A forum rule of thumb says nozzle:header pressure-drop ratio >10 keeps maldistribution <~5% (anecdotal) — [Eng-Tips](https://www.eng-tips.com/threads/manifold-outlet-spacing.288276/post-53538)
- Header diameter ~1.5–3× the largest branch, with branches spaced ≥2× header diameter — [projectmaterials blog](https://www.blog.projectmaterials.com/quick-answers/epc/piping-manifold-header/)
- Safe-Rain: pump suction pipe ≥1.5–2× the pump inlet diameter with an eccentric reducer. Economic velocity from the pump outlet to nozzle sets is **1–1.8 m/s**. Header sizing can deliberately use head-loss slope to create a desired jet-height gradient — [Safe-Rain Tips of fountain design part 2](https://saferain.com/en/blog/tips-of-fountain-design-part-2/)
- Pool trade rule: ~5–6 ft/s (≈1.5–1.8 m/s) line velocity to limit friction loss and water hammer — [Boshart support](https://support.boshart.com/how-to-select-the-proper-size-of-tank-tee-or-constant-pressure-manifold); [WaterShapes Gutai hydraulics](https://watershapes.com/images/archives/indexed/WaterShapes200304-gutai-hydraulics-line-velocity-water-flow-system-design-piping.pdf) (PDF unreachable; per search summary). Process piping uses 3–6 m/s, which does not apply to fountains — [projectmaterials](https://www.blog.projectmaterials.com/quick-answers/epc/piping-manifold-header/)
- A thesis on a dancing-fountain header reports 117 m/s in a 2.5 in pipe at 9.25 L/s, which is physically implausible. **Do not use it** — [UNMER eprint](https://eprints.unmer.ac.id/id/eprint/4349/)
- Dry/plaza fountains: jet-height timing depends on the pump scheduling algorithm (start/stop and variable-speed time patterns per pump) needed to deliver the requested flows and pressures — [UPB Scientific Bulletin](https://scientificbulletin.upb.ro/static/pdfs/rez5e3_690095.pdf)
- Variable-frequency pumps with a controller setting speed from requested pressure (dynamic flow patterns) — [US6717383](https://patents.google.com/patent/US6717383); ultrasonic height feedback for fountain features — [US6427927](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6427927)
- Large music fountains use hundreds to thousands of servo-driven nozzles with pumps for 15–80 m heights — [INVT](https://www.invt.com/solutions/application-of-servo-system-in-large-music-fountain-113)

### Inferences
- **Coupling model:** represent a hydraulic graph as source (pump ± VFD) → header/manifold → valve (solenoid on/off or proportional) → nozzle(s). For each source, store a pump curve H(Q) at f_max and the affinity scaling. For each nozzle, store K such that Q = K·√(ΔP), from the manufacturer height/flow/pressure table. Solving the operating point for a given open-valve set gives the per-nozzle height. If the solve is too heavy, precompute a lookup table of "height factor vs number of open valves" during commissioning.
- **Generator constraints derived from this:** Σ Q_open ≤ Q_max(source, f). There is also a minimum flow per pump to avoid dead-heading, so a VFD pump with all its valves closed must be forced to idle or off, or a bypass must be required. And when valve count on a shared header changes, the predicted height shift must stay within tolerance, or the VFD must compensate. That needs a feed-forward table of f vs open-count.
- Also enforce valve open/close transition rates to avoid water hammer, a common practice with no sourced numeric value.

### Gaps
- No primary manufacturer wiring diagrams were found (Crystal Fountains, Lumiartecnia, Chinese makers). Not verified: the common practice that Chinese music fountains use one VFD per "water type" group plus solenoids per sub-group.
- No sourced numeric for minimum pump flow (% of BEP) or for dead-head protection timeouts.

---

## 3. Splash and wind envelope

### Takeaway
Rules of thumb run from calm-air splash radius ≈ jet height up to pool radius ≈ 2× jet height. Commercial wind controllers do stepwise height reduction (OASE: 3 stages + off) using cup anemometers with adjustable thresholds (Roman Fountains 0–25 mph ≈ 0–11.2 m/s). No vendor publishes default m/s set-points, so the generator must take them as site configuration.

### Cited Findings
- Splash extends horizontally over a radius approximately equal to the jet height in calm air. Safe-Rain recommends a wind gauge that shuts off the highest jets while the rest keeps running — [Safe-Rain](https://saferain.com/en/blog/tips-of-fountain-design-part-2/)
- Under normal wind, spray height should not exceed the distance from the jet to the nearest basin edge — [Delta Fountains](https://www.deltafountains.com/?p=772) (via search summary)
- A student fluid-mechanics report says designers restrict jet height to half the pool radius (pool radius ≈ 2× height, diameter ≈ 4× height) — [Scribd CE223 project](https://www.scribd.com/document/819237298/CE223Project-Grp1C) (low-authority source)
- Wind blows fine droplets away. Larger outlets give larger droplets that drift less — [Oz Water Gardens](https://ozwatergardens.com.au/?p=4071)
- OASE Wind-dependent Fountain Control 3 K + Anemometer K: fountain height in **3 stages or off**. Pumps can be switched individually or in 3 stages — [OASE wind control 3 K](https://www.oase.com/en-US/fountain-technology/wind-dependent-fountain-control-3-k-int); [Anemometer K](https://www.oase.com/en/water-technology/anemometer-k-int)
- Roman Fountains RWC wind control is UL-listed and does automatic spray-height reduction and/or shutdown. It uses a 3-cup anemometer with an adjustable trigger of **0–25 mph** and a 3-digit LED display — [Roman Fountains RWC](https://landscapearchitect.com/ladetails/landscape-product/fountains-equipment/roman-fountains-corp./rwc-sm-dul-wind-control)
- Hunter Wind-Clik (irrigation, used with fountains): wind threshold adjustable **8–24 mph** — [Hunter](https://api.hunterirrigation.com/print/pdf/node/913)
- Generic wind switches: DIP-configurable 1–30 m/s threshold — [DH Partner WRS-S](https://www.dh-partner.com/en/products/wrs-s.html)

### Inferences
- **Proposed model:** H_allowed(w) = H_design for w ≤ w1. Above w1, H_allowed falls linearly or stepwise toward H_min at w2, and is 0 (tall jets off) at ≥ w3. Add hysteresis and a time-averaging window (e.g. 10–60 s average with gust override) to avoid hunting. Defaults must be site-configured. A plausible but **unsourced** starting point is w1 ≈ 4–5 m/s, w2 ≈ 8 m/s, w3 ≈ 10–11 m/s, consistent with the 0–11.2 m/s range of the Roman Fountains device.
- **Splash envelope per nozzle:** radius r(h, w, θ_wind) = max(calm radius ≈ k·h with k≈1, from Safe-Rain) plus a downwind offset growing with w·t_flight, where t_flight ≈ 2√(2h/g). For a 10 m jet, t_flight ≈ 2.9 s. Even 2 m/s of drift on large drops gives several metres of downwind shift, and fine mist goes much further. The generator should cap each nozzle's height so its envelope stays inside the basin polygon minus a margin. **Directional:** use wind direction so that only jets near the downwind edge are reduced.
- Moving nozzles: the splash envelope depends on tilt angle. A 45° tilt sends water about 2× further horizontally than straight up for the same exit velocity (ideal range v²/g vs height v²/2g). The envelope check must cover tilt as well as height.

### Gaps
- No published vendor default m/s set-points (OASE, Crystal, WET). No droplet-drift field studies specific to fountains were found in this session.

---

## 4. Audience viewpoints and inferring "front"

### Takeaway
No sourced fountain-specific method for automatic front inference was found. The approach below is an engineering proposal built from site geometry.

### Cited Findings
- Safe-Rain's design series treats the fountain in relation to viewers and basin edges (splash toward walkways), but gives no sightline numbers — [Safe-Rain](https://saferain.com/en/blog/tips-of-fountain-design-part-2/)

### Inferences
- **Front inference heuristics** (proposal): (1) any explicit seating, stage, or viewing-terrace polygons in DXF/IFC layers win; (2) the side facing the largest open public area, plaza or promenade; (3) the side opposite a building facade or backdrop (the backdrop is "back"); (4) the side with most footpath length within ~2–3× max jet height; (5) the dominant symmetry axis of the nozzle layout (front is perpendicular to the long axis of linear arrays). Score each candidate direction and expose it for the user to confirm.
- Layering: put tall/central effects (shooters, central jets) at the back or centre, and low/near effects (curtains, low arcs, foam) at the front edge, so the farthest viewers are not occluded. Symmetry pairs mirror across the axis toward the main viewpoint.
- Viewing distance: the main viewpoint should see the full max height within a ~30–40° vertical field, so distance ≥ ~1.5–2× max height. This is a general visual-ergonomics heuristic, **unsourced**.

### Gaps
- No published fountain design guide numbers on sightlines or viewing angles were found.

---

## 5. Data formats and automatic group inference

### Takeaway
GDTF (DIN SPEC 15800) and MVR (DIN SPEC 15801) are the standard, parsable formats for fixture definitions (DMX modes, geometry) and scene layout. They can describe lights and generic devices, and fountain devices can be modelled as custom GDTF fixtures. Nozzle layouts typically arrive as DXF blocks/points. Groups can be inferred with RANSAC line/circle fitting plus mirror-symmetry detection.

### Cited Findings
- GDTF is an open standard describing entertainment devices (fixtures, trusses, media servers, lasers). The current edition is **DIN SPEC 15800:2022-02 (GDTF 1.2)**, which covers DMX desk use cases and visualization geometry. Concepts include DMXBreak (multiple start addresses) and Feature/FeatureGroup. GDTF 1.2 added geometry types (truss, laser, hoist, power distribution) — [GDTF spec on GitHub](https://github.com/mvrdevelopment/spec/blob/main/gdtf-spec.md); [GDTF-Share help](https://gdtf-share.com/help/); [LSi online](https://www.lsionline.com/updates-revealed-for-gdtf-standard)
- MVR is built on GDTF to exchange scenic/environmental information and complete show setups. GitHub carries MVR 1.6, and GDTF-Share cites **DIN SPEC 15801:2023-12** — [MVR spec](https://github.com/mvrdevelopment/spec/blob/main/mvr-spec.md); [GDTF-Share help](https://gdtf-share.com/help/)
- RANSAC circle detection in 2D point sets samples 3 points per hypothesis (the minimum for a circle) — [treeX arXiv 2509.03633](https://arxiv.org/pdf/2509.03633); Rust implementation [r3fit](https://lib.rs/crates/r3fit). RANSAC origin: Fischler & Bolles 1981, applied to circle fitting — [SRI RANSAC paper](https://static.aminer.org/pdf/PDF/000/387/686/a_ransac_based_approach_to_model_fitting_and_its_application.pdf)
- Mirror symmetry can be found by treating it as registration (state-of-the-art on 2D symmetry-line benchmarks) — [Finding Mirror Symmetry via Registration, arXiv 1611.05971](https://ar5iv.arxiv.org/html/1611.05971); sampling minimal match sets to hypothesise symmetry models and scoring consensus — [Tang, Tepper, Sapiro BMVC 2013](https://bmva-archive.org.uk/bmvc/2013/Papers/paper0115/paper0115.pdf); symmetry detection in 3D — [Bokeloh et al. 2009](https://www.cs.princeton.edu/courses/archive/spring11/cos598A/pdfs/Bokeloh09.pdf)

### Inferences
- **Pipeline proposal:**
  1. Parse DXF (e.g. ezdxf): INSERT block names/attributes → nozzle type, LWPOLYLINE → basin outline, layers → lights/pumps/seating. IFC uses IfcFlowTerminal/IfcPump/IfcValve where present. Lights come from MVR/GDTF, and PLC I/O from TIA Portal tag-table export (xlsx/csv: name, data type, address %Q/%IW, comment).
  2. Cluster by type first (same block/nozzle model), then DBSCAN on positions (eps ≈ 1.5× median nearest-neighbour spacing).
  3. Within each cluster, run RANSAC circle (3-point) and line (2-point) fits. Accept if ≥N inliers and residual < ~5% of spacing. Arcs are circle fits whose angular coverage is <360°. Order members by angle or arc-length to get a natural "chase" order.
  4. Symmetry: hypothesise axes from point pairs of the same type (perpendicular bisectors). Score by the fraction of points that reflect onto a same-type point within tolerance, and keep the best 1–2 axes. Also test rotational symmetry about circle centres (C_n). Emit "mirror pairs" for the generator.
  5. Cross-check groups against the PLC I/O list: outputs that share a valve or VFD tag are a **hardware group** (coupled), which overrides geometric grouping.
- Tag-name parsing (e.g. `RING1_V03`, `PUMP_VFD_2_HZ`) gives a strong prior for group membership. Use regex families.

### Gaps
- No fountain-specific GDTF profiles or a standard "nozzle library" exchange format were found. Manufacturer nozzle data exists as PDF datasheets (e.g. OASE height/flow/pressure tables), not machine-readable libraries.
- The Siemens TIA tag-table export format details were not researched in this session.

---

## 6. Encoding capability constraints for a generator

### Takeaway
The capability model is a typed graph of outputs, hydraulic sources and safety rules, with per-output kinematic limits. The generator emits intents (height, angle, colour, events), and a constraint solver/clamp layer enforces limits before output.

### Cited Findings
- Manufacturer ramp constraint example: 0→100% height in no less than 3 s (OASE rotating nozzles) — [OASE](https://www.oase.com/en/water-technology/rotating-nozzle-5-30-e-int)
- Event cooldown example: pneumatic shooter refill/shoot interval of 25 s — [OASE AirNozzle 50 E](https://www.oase.com/en-au/fountain-technology/airnozzle-50-e-50-m-vertical-01)
- Mechanical range example: 200° X / 140° Y — [OASE MDD L 2D](https://www.oase.com/nl-NL/fountain-technology/multi-directional-drive-l-2d-dmx02)
- Wind staging example: 3 stages + off, per-pump — [OASE wind control](https://www.oase.com/en-US/fountain-technology/wind-dependent-fountain-control-3-k-int)
- Servo homing on power-on/last-position recovery (the generator must wait for "homed" before motion) — [INVT](https://www.invt.com/solutions/application-of-servo-system-in-large-music-fountain-113)
- DMX light channel layout example (R,G,B,W,strobe,dim; 24 V DC 50 W) — [OASE ProfiLux](https://www.oase.com/en/fountain-technology/profilux-led-xl-rgbw-spot-dmx02-int)

### Inferences
Proposed schema, per output (JSON-like):
```
output: {
  id, type: jet|foam|shooter|swing2d|rotating|ring|fan|curtain|mist|light|fire|laser,
  actuator: solenoid|prop_valve|vfd_pump|servo|dmx|air_valve,
  position: {x,y,z}, groups: [...], mirror_of: id?, layer: front|mid|back,
  height_curve: [(signal, height_m, flow_lpm)],         // from datasheet/commissioning
  rate_limits: { up_pct_per_s, down_pct_per_s, min_on_ms, min_off_ms,
                 deg_per_s?, cooldown_s? },               // shooter cooldown, servo speed
  latency_ms: { command_to_visible, fall_time_at_hmax }, // for music pre-roll
  range: { angle_x:[-100,100], angle_y:[-70,70] },
  hydraulic_source: pump_id, valve_id,
  splash_radius_factor: ~1.0 (calm),
  wind_policy: { reduce_from_ms, off_from_ms, priority }
}
source(pump): { id, vfd: bool, f_min, f_max, ramp_s, Q_max, H(Q) curve, min_flow, outputs:[...] }
site: { basin_polygon, margin_m, front_vector, viewpoints:[...], symmetry_axes:[...],
        anemometer: tag, wind_avg_s, hysteresis_ms }
interlocks: [ low_water_level→all pumps off, e_stop, people_in_basin (dry plaza),
              pump_running_feedback, servo_homed, DMX_driver_ok, wind_stage ]
```
- **Generator enforcement:** (1) rate-limit and min on/off filters per channel; (2) per-source flow budget (Σ open-nozzle flow ≤ Q_max(f)) with VFD feed-forward to hold height as valve count changes; (3) wind clamp H ≤ H_allowed(w, direction); (4) splash-envelope check against the basin polygon, including tilt; (5) coupled groups are scheduled as one unit; (6) music pre-roll: send commands latency_ms early (rise time ≈ √(2h/g) plus valve/VFD delay) so the apex lands on the beat; (7) interlocks gate everything, and the generator never overrides PLC safety.
- **Safety:** low-water/dry-run protection on pumps, and dry-deck/plaza fountains need people detection. SELV for underwater lighting (24 V DC with galvanic isolation in OASE drivers). An exact SELV classification was not confirmed in the sources.

### Gaps
- No published standard schema for fountain capability models exists in the sources found. This schema is a synthesis.
- Electrical safety standards for fountains (e.g. NEC Article 680 Part V, IEC 60364-7-702) were not fetched in this session. They should be cited directly before relying on them.
