# Fog, mist and atomised-water volumes for a glowing green fountain-tree canopy

Research notes, 2026-10-26. Method note: several primary datasheets (MeeFog Nozzles brochure PDF, MeeFog Cloudmaker datasheet, OASE mist-system page, Smithsonian article, McCray "Fog & Physics" blog) could NOT be fetched in this session (fetch errors / HTTP 403 / 429). Where a figure below comes from a search-result summary of a page and not a full read of it, it is marked "(snippet)". The report writer should treat those as needing a final check against the original page.

## 1. High-pressure fog nozzles: droplet size, flow, pressure, coverage, behaviour, wind

### Takeaway
"True fog" systems run at about 70 bar (1,000 psi) through orifices of about 0.15–0.3 mm, giving droplets of about 10–20 µm at roughly 0.1–0.2 L/min per nozzle. Fountain-grade "mist" nozzles run at only about 3 bar and give much coarser droplets. Fog this fine drifts with the air and does not fall like a jet, so wind sets the limit. No manufacturer publishes a hard "fog holds its shape up to X m/s" number.

### Cited Findings
- **Nakaya/Mee system (the original high-pressure fog):** water at over 1,000 psi (about 69 bar) is forced through 0.15 mm apertures (also described as "six thousandths of an inch"). A pin in the nozzle breaks the stream into droplets of about 17 µm, with a quoted range of 15–20 µm. Pure water, no additives. Developed 1969–70 with physicist Thomas Mee; Mee Industries (MeeFog) still uses the technology — [Smithsonian](https://www.smithsonianmag.com/science-nature/an-artist-creates-artificial-fog-in-san-francisco-24339206/) (snippet); [Galerie](https://galeriemagazine.com/fujiko-nakaya-bourse-de-commerce-fog/) (snippet)
- **OASE fountain technology:** "mist" nozzles work at about 3 bar and "fog" nozzles at about 80 bar; "the higher the pressure, the finer the water droplets" — [OASE Mist System](https://www.oase.com/en/fountain-technology/mist-system-int) (snippet; direct fetch returned HTTP 429)
- **Flow per 0.3 mm (0.012") nozzle at 70 bar:**
  - Danfoss anti-drip mist nozzle: 0.11 L/min (6.8 L/h), 60° spray, max 70 barg — [Danfoss 180Z1949](https://store.danfoss.com/en/p/180Z1949)
  - Big Dutchman 0.3 mm stainless nozzle: 6.3 L/h at 70 bar — [Big Dutchman](https://opc-test.bigdutchman.com/21-04-0745)
  - Fogco/Flowtech 0.012" standard mist nozzle: 0.11 L/min — [Flowtech](https://flowtech.co.uk/products/m331-24116/93512)
  - Generic brass 0.3 mm nozzles: 80–145 mL/min across 20–70 kg/cm² — [minisplitsystemsdirect](https://minisplitsystemsdirect.com/22x-brass-misting-nozzles-0-012-orifice-0-3-mm-10-24-unc/)
  - Cat Pumps green 0.3 mm ceramic nozzle: 0.06 gpm (about 0.23 L/min) at 1,015 psi. This is an outlier, about double the others, and probably reflects a different internal design — [Cat Pumps misting nozzles](https://catpumps.com/dynamic-literature/misting-nozzles-sell-sheet)
- **Spraying Systems Co. HP FogJet range:** 0.75–20 gph (2.84–75.7 L/h) at 1,000 psi (69 bar) — [Spraying Systems catalogue](https://www.spray.com/uk-ua/-/media/dam/industrial/usa/sales-material/catalog/cat75hyd_us_fine-spray_e.pdf) (snippet)
- **Scale examples:**
  - Exploratorium "Fog Bridge #72494" (2013): 46 m (150 ft) footbridge, 4 pumps, about 800 nozzles. Each side of the bridge is split into 3 valve-controlled sections. An anemometer on the pier roof makes the system fog only the upwind side, with control updated every 10 minutes. The bridge ran for 10 minutes every half hour — [Smithsonian](https://www.smithsonianmag.com/legacy_blog/an-artist-creates-artificial-fog-in-san-francisco/) (snippet); [MeeFog Exploratorium](https://www.meefog.com/2023/01/20/exploratorium/) (snippet)
  - Bellagio (WET): softened water stored in tanks feeds high-pressure fog lines out into the lake. A demonstration covered the lake in about 10 ft (3 m) of dense fog — [Wikipedia: Fountains of Bellagio](https://en.wikipedia.org/wiki/Fountains_of_Bellagio); [yourmileagemayvary](https://yourmileagemayvary.com/2019/03/24/how-do-the-fountains-at-the-bellagio-work-anyway/) (snippet)
- **Behaviour:** Nakaya's fog sculptures "roll down hills, hover over water, and bounce over structures". When the nozzles shut off, "the fog lifts just as quickly as it appeared". The Boston pieces ran for 2–18 minutes every half hour. For the Arnold Arboretum piece she studied prevailing winds and decades of weather data before choosing the site, and set several hundred jets so their sprays collided and threw up fog that tumbled downhill — [NRDC](https://www.nrdc.org/stories/ethereal-fog-sculptures-are-rolling-through-bostons-parks); [Boston Globe](https://www.bostonglobe.com/arts/art/2018/06/24/fog-sculptures-adorn-emerald-necklace/XH4Ku1ZeZpe4M6AzH6eOhL/story.html) (snippets)
- **Koolfog waterfall feature:** fog released at the base of a waterfall collects on the water and drifts downstream as the natural airflow carries it past the plunge pool — [LandscapeArchitect.com / Koolfog](https://landscapearchitect.com/ladetails/landscape-product/fog-systems/koolfog/waterfall-fog-features)
- **Wind limits (closest numbers found):**
  - Tsukuba aerosol fog-display research: images could be projected at wind speeds up to about 10 m/s. This was their own spray prototype, not a commercial unit — [Digital Nature Group, Tsukuba](https://digitalnature.slis.tsukuba.ac.jp/?p=1957)
  - Ordinary fountains: Wichita WaterWalk stops at winds above 15 mph (6.7 m/s) — [City of Wichita](https://www.wichita.gov/1165/Fountains-at-WaterWalk)
  - Roman Fountains wind control: 3-cup anemometer, adjustable 0–25 mph threshold, used to reduce jet height or shut the fountain down — [LandscapeArchitect.com](https://landscapearchitect.com/ladetails/landscape-product/fountains-equipment/roman-fountains-corp./rwc-sm-dul-wind-control)
  - Saferain anemometer: can lower VFD (pump inverter) frequency, stop pumps or turn off lights at a set wind speed — [Saferain](https://saferain.com/en/fountain-equipment/fountain-accessories/electrical/anemometer/)
- **Ultrasonic foggers (small-scale alternative):** consumer units use about 200 mL/h each. The Exo Terra unit works best 5–30 mm below the water surface. Pontec PondoFog is a floating 110 × 65 mm RGB-LED unit (IP68) with no published output — [Exo Terra manual](https://legacy.exo-terra.com/download/product_manuals/Fogger_Instruction_Manual.pdf); [Trixie](https://trixie.de/en/terraristics/terrarium-accessories/climate/fogger-ultrasonic-mist-generator-1001096183-1001096455); [Pontec](https://www.pontec.com/en/pontec-pondofog.html)

### Inferences
- At about 0.1 L/min per nozzle, a canopy ring of 40 nozzles uses only about 4–6 L/min (0.25–0.35 m³/h) at 70 bar. Hydraulically that is a small piston pump, roughly 1–2 kW class. This is my estimate from the flow figures (hydraulic power = Q × p ≈ 0.1 m³/h × 7 MPa ≈ 0.2 kW per 10 L/min, plus pump losses). No datasheet confirms it.
- 15–20 µm droplets have very low settling speed. In practice the fog moves with the air: it drifts downwind and sinks or rolls when the air is cooler and denser, as seen in the Nakaya behaviour. It will not "hang" in a canopy shape at several metres height unless something contains it or it is constantly renewed.
- Wind is the main enemy. Expect a fog canopy to look good only in near-calm air, roughly under 2–3 m/s (my estimate; there is no source for a fog-volume limit). Above that, the fog becomes a downwind streamer. Design the control so it switches nozzle banks on the upwind side (as the Exploratorium does) and fades fog out above a wind threshold.

### Gaps
- I could not read the MeeFog nozzle flow table, the Cloudmaker datasheet or Fogco's pump specs (fetch failures). Exact MeeFog per-nozzle gph and pump kW are not verified.
- I found no published wind speed (m/s) at which a fog cloud loses its shape outdoors. Manufacturers and the artist give qualitative statements only.
- No source gave a coverage per nozzle (m³ of visible fog per nozzle).

## 2. Holding fog in a 3D canopy shape: practical shapes

### Takeaway
Free fog cannot be held as a fixed 3D shape outdoors. Practical "shaped" fog comes from three things: continuous renewal from many nozzles placed along the shape, a physical container that traps it, or a laminar air curtain (FogScreen-type). Of these, a container is the most buildable way to get a fixed canopy: a water-film dome, a mesh or screen, or a canopy frame lined with nozzles.

### Cited Findings
- **Disney patent US7775457, "Fountain with fog-filled, illuminated water domes":** a fogger (for example an ultrasonic transducer) sits near the nozzle and discharges fog into a water dome formed by the fountain. A light source lights the trapped fog. This is directly the "fog trapped in a water shell" approach — [Justia patent 7775457](https://patents.justia.com/patent/7775457); [Google Patents](https://www.google.ca/patents/US7775457)
- **FogScreen-type laminar fog sheets:** the fog is formed into a laminar airflow inside a protective surrounding airflow, with the flow directed slowly through small channels. The earlier patent notes that the sheet's flatness degrades with distance because of friction with the surrounding still air and turbulence; air curtains on both sides are the fix — [US patent 6819487](https://patents.justia.com/patent/6819487); [Rakkolainen, MIT Lemelson](https://lemelson.mit.edu/resources/ismo-rakkolainen)
- **Korean study on fog screens:** the best dense, uniform screen came with aerosol and air-curtain flows of about 1.5 m/s and 2.55 m/s, with laminar flow and minimum shear — [KoreaScience](https://www.koreascience.or.kr/article/JAKO201714563378874.pdf) (snippet)
- **Nakaya's method for big volumes:** hundreds of nozzles, jets aimed to collide, and the shape set by topography and wind (rolling down a hillside, hovering over water) — [Boston Globe](https://www.bostonglobe.com/arts/art/2018/06/24/fog-sculptures-adorn-emerald-necklace/XH4Ku1ZeZpe4M6AzH6eOhL/story.html) (snippet)
- **Delta Fountains fog nozzles:** 1/4" nozzles fitted in sumps, nozzle wells or flush with a dry deck, usually fed from a spray ring or spray-bar header — [Delta Fountains](https://www.deltafountains.com/?p=1538) (snippet)
- **Koolfog in-deck fog fountain:** fog jets sit under the grating around variable fountain jets, with an LED under each jet that also lights the fog cloud as it builds — [LandscapeArchitect.com / Koolfog](https://landscapearchitect.com/ladetails/landscape-product/fog-systems/koolfogkoolfog-10444/fog-in-deck-fountain)

### Inferences
- **For a "tree canopy" several metres up, the practical options are:**
  - (a) A ring or array of high-pressure fog nozzles mounted on the canopy steel frame, at or near the jet heads, firing outward or inward. The cloud is constantly renewed and wind-trimmed by switching banks.
  - (b) An umbrella or dome-shaped water film or jets around the canopy that trap fog inside, following the Disney patent principle.
  - (c) Fine stainless mesh or a perforated shell that slows the air locally.
- Shapes that can be expected to read well: a cloud or ball around the nozzle cluster, a "skirt" sinking below the canopy, and a horizontal layer. Sharp-edged shapes cannot be expected outdoors.
- Because fog sinks and drifts, a fog-only canopy will tend to droop below the nozzles. Nozzles should sit at the top of the intended volume, not at its centre.

### Gaps
- I found no built case study of a fog-filled tree canopy at height with dimensions.
- I did not fetch Olafur Eliasson or Ned Kahn installation details (tool-call budget reached).
- I could not confirm a FogScreen commercial wind specification.

## 3. How coloured light renders in fog vs jets; light angles; brightness; green examples

### Takeaway
Fog droplets of 5–20 µm scatter light strongly forward (Mie regime). Fog glows brightest when lit from behind or from below toward the viewer, and looks much dimmer when lit from the viewer's side. Coloured LEDs under or behind the fog make it read as a lit volume, a stronger effect than on solid jets, which mainly light up at break-up points and surfaces.

### Cited Findings
- **Forward scattering:** for typical fog the asymmetry parameter g is close to +1, meaning strongly forward scattering. For the most common fog size (about 5 µm radius) the forward lobe is very narrow (FWHM about 2.5°). Plots cover radii of 1, 5, 10 and 20 µm. The Henyey-Greenstein phase function is a poor approximation for large droplets — [miepython "Mie Scattering and Fog" (S. Prahl)](https://miepython.readthedocs.io/en/latest/05_fog.html)
- **General Mie phase-function background** — [MTU scattering lecture slides](https://pages.mtu.edu/~scarn/teaching/GE4250/scattering_lecture_slides.pdf)
- **Lighting the fog:** OASE says fog nozzles make a light matrix "appear more voluminous, more majestic and dynamic" — [OASE](https://www.oase.com/en/fountain-technology/mist-system-int) (snippet)
- **Koolfog:** puts an LED under each jet so the fog cloud is lit from below — [Koolfog](https://landscapearchitect.com/ladetails/landscape-product/fog-systems/koolfogkoolfog-10444/fog-in-deck-fountain)
- **Pontec RGB fogger:** designed to sit directly under fountains so light, water and fog combine — [Pontec](https://www.pontec.com/en/pontec-pondofog.html)
- **RGBW ring lights:** Fountain People's FX-Series RGBW ring light mounts on the nozzle discharge pipe for 360° lighting of spray effects — [LandscapeArchitect.com](https://landscapearchitect.com/ladetails/landscape-product/water-safe-lighting/fountain-people/fx-series-fountain-led-rgbw-ring-light)
- **Bellagio:** uses white fountain lights (4,792 lights), not coloured ones — [Wikipedia](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)

### Inferences
- For a "STAND HERE" front viewpoint, put the green fixtures behind the canopy and aim them toward the viewer (backlight), or below it aiming up. Either way the viewer is near the forward-scatter direction. Front-lighting from the audience side wastes most of the light, because backscatter from fog is weak.
- The narrow forward lobe means fog glows most strongly when the viewer looks almost straight into the source. A slight off-axis backlight (about 10–30° from the line of sight) avoids glare while keeping the glow. This angle is a design judgment, not a sourced number.
- Saturated green LEDs (around 520–530 nm) suit this, because the eye is most sensitive near 555 nm and so green looks bright per watt. That is standard photometry, not taken from the sources above.

### Gaps
- I found no published lux or lumen requirement for lighting fog at night.
- I found no documented example of a green-lit fog fountain with photometric data.
- I did not research laser use in fog (outdoor laser safety and aviation rules would apply).

## 4. Combining fog with jets (fog at jet heads, mist from break-up, musical fountains)

### Takeaway
Fog combined with jets is established practice. Examples include fog nozzles placed around or under jets on decks (Koolfog, Delta), fog released into water domes (Disney patent), and lake-wide fog fields in musical shows (Bellagio). Fog has its own pump and supply line, separate from the jets.

### Cited Findings
- Koolfog in-deck fog plus variable jets, with LEDs under the jets lighting both — [Koolfog](https://landscapearchitect.com/ladetails/landscape-product/fog-systems/koolfogkoolfog-10444/fog-in-deck-fountain)
- Bellagio high-pressure fog from softened water, used as part of the choreographed show; wind is a significant operating factor — [Wikipedia](https://en.wikipedia.org/wiki/Fountains_of_Bellagio); [AEE Center](https://www.aeecenter.org/aee-news/operating-the-most-photographed-fountain-in-the-world/) (snippet)
- Disney fog-filled water domes — [Justia](https://patents.justia.com/patent/7775457)
- OASE offers 3-bar mist and 80-bar fog nozzles as part of its fountain range — [OASE](https://www.oase.com/en/fountain-technology/mist-system-int) (snippet)

### Inferences
- Mist from jet break-up (spray droplets in the 100 µm to mm range) falls back within seconds. It gives sparkle when lit, not a persistent volume. A persistent "fluffy" mass needs true 10–20 µm fog.
- For AquaFlow, fog should be its own show channel: a high-pressure pump plus solenoid valve banks, cued like a jet. Fog lags by seconds and lingers for tens of seconds after cut-off; the Nakaya fog "lifts quickly" once the nozzles stop. Plan ramp times accordingly.

### Gaps
- I found no source quantifying fog persistence time (seconds) after shut-off.
- I found no Chinese "fog fountain" manufacturer datasheet.

## 5. Water quality, maintenance, Legionella, wetting the audience

### Takeaway
Fog is an aerosol of breathable size, so Legionella control matters more than for coarse jets. Use softened or treated water, fine filtration and anti-drip nozzles, and manage the fountain under ASHRAE 188 / Guideline 12 and the CDC fountain toolkit. True fog barely wets people, but coarse mist and jet spray do.

### Cited Findings
- **CDC:** all decorative fountains produce aerosols. Do not place them where people at increased risk of Legionnaires' disease use the area (for example healthcare facilities). Monitor temperature and disinfectant residual at least weekly. Run the fountain at least daily and avoid idle periods. Clean immediately if the water is cloudy or odorous, or shows algae or biofilm. Key growth factors are sediment/biofilm, temperature, water age and disinfectant residual. Apply ASHRAE Guideline 12 — [CDC Decorative Fountain Module](https://www.cdc.gov/control-legionella/php/toolkit/decorative-fountain-module.html); [CDC Toolkit PDF](https://www.cdc.gov/control-legionella/media/pdfs/Control-Toolkit-Decorative.pdf)
- **ASHRAE:** Standard 188-2021 sets minimum Legionella risk-management requirements for building water systems. Guideline 12-2023 gives system-specific guidance including fountains — [ASHRAE news 2025](https://www.ashrae.org/about/news/2025/ashrae-highlights-resources-to-address-legionella-risk-and-water-supply-management)
- **Bellagio:** uses softened water stored in tanks for fog. This prevents scale in the micro-orifices — [Wikipedia](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)
- **Nakaya:** fog of pure water, no chemical additives — [Galerie](https://galeriemagazine.com/fujiko-nakaya-bourse-de-commerce-fog/) (snippet)
- **Danfoss:** markets an "anti-drip" version of its mist nozzle, which stops drips after shutdown — [Danfoss](https://store.danfoss.com/en/p/180Z1949)

### Inferences
- Feed the fog from a dedicated potable or treated, softened (or RO) supply, not recirculated basin water. Recirculated water carries biofilm and debris that both clog 0.15–0.3 mm orifices and raise the aerosol risk. Fine filtration upstream of the nozzles is standard for high-pressure fog (typically about 1–5 µm), but I did not get a datasheet figure to confirm that.
- Audience wetting: 15–20 µm fog evaporates or drifts and gives only a damp feel. Drift downwind onto the audience is the main nuisance, which is another reason for wind-switched nozzle banks.

### Gaps
- I did not obtain a filtration micron rating from a fog manufacturer's datasheet.
- I found no fog-specific Legionella limit or droplet-size risk guidance; the CDC and ASHRAE sources cover fountains in general.
