# Viewpoint (anamorphic) installations with water/light, and lighting only the tops of fountain jets

Research date: 2026-10-26. Searches were capped at about 15 tool calls. Some vendor pages could not be fetched: watershapes.com refused the connection, and the Safe-Rain PDF returned 404. Where I give a number from a search-result snippet rather than a fetched page, the note says so.

## 1. Single-viewpoint / anamorphic installations: how they are built, and how tolerant they are to viewer movement

### Takeaway
The standard method is to project or photograph from the intended eye point, then place or paint the elements to match. Varini traces a projector image. Pras builds while looking through a camera. The image resolves only near that one station point, and published sources describe the tolerance only in words ("changes dramatically when the viewer moves only a short distance"). None of the sources I found gives a numeric tolerance, so the offset formula below is derived from geometry.

### Cited Findings
- Felice Varini first projects his design over the space, traces the projected image and then paints it. The finished work reads correctly from the spot where the projector stood. — [Laughing Squid](https://laughingsquid.com/large-scale-anamorphic-illusion-paintings-by-felice-varini/); [Gazi Univ. article "An Illusion Technique in Contemporary Art: Anamorphosis and Felice Varini"](https://avesis.gazi.edu.tr/yayin/b21ae6f0-bc71-428a-afb3-ea348426632b/an-illusion-technique-in-contemporary-art-anamorphosis-and-felice-varini)
- Varini's shapes recompose only from a vantage point at roughly the artist's eye height. From anywhere else they break into abstract fragments. — [Gazi Univ. article](https://avesis.gazi.edu.tr/yayin/b21ae6f0-bc71-428a-afb3-ea348426632b/an-illusion-technique-in-contemporary-art-anamorphosis-and-felice-varini)
- Scale example: Varini's 2014 Hasselt (Belgium) piece runs three ellipses over roads, walls and nearly 100 buildings, and they resolve from one spot in the city. — [Britannica](https://www.britannica.com/print/article/22654)
- Bernard Pras (French, b. 1952) builds 3-D assemblages of found objects (toys, packaging, household items). He picks objects by colour and size and watches the work take shape through his camera. The image is "comprehensible from a single, pre-defined point of view," and the final photograph is treated as part of the work. — [De Galerie Den Haag](https://www.degaleriedenhaag.nl/en/artist/bernard-pras_en/); [Street Art Utopia](https://streetartutopia.com/2021/09/02/tom-murphy-by-bernard-pras-in-galway-ireland/). (Most of these sources reuse the same biography text, so they are not independent.)
- Multi-plane anamorphic sculptures depend on one observation point. Changing the observation point or the picture plane "alters all those relationships, and the composition falls apart." — [UBC perspective notes](https://faculty.arts.ubc.ca/rfedoruk/perspective/15a.htm)
- An anamorphic work "can change dramatically when the viewer moves only a short distance." Many works have a "viewing point or viewing zone," and its size is not given. The listed factors are station point, eye height, viewing direction and viewing distance. — [Perspective Research Centre, "Anamorphosis aberrations"](https://perspectiveresearchcentre.com/anamorphosis-aberrations/)
- Stojakovic & Tepavcevic (2016, *Nexus Network Journal*) used parametric analysis to measure the distortion when the observer stands away from the preferred viewpoint. They also simulated on-site construction errors and proposed a design framework that keeps the damage to the illusion small. The abstract gives no numbers. — [Univ. Novi Sad abstract](https://www.arhns.uns.ac.rs/cdd/distortion-minimization-a-framework-for-the-design-of-plane-geometric-anamorphosis/); [DOI 10.1007/s00004-016-0302-z](https://link.springer.com/doi/10.1007/s00004-016-0302-z)
- Newer research on anamorphic sculpture (freeform reflective or refractive surfaces) optimises the viewpoint and the target image position together, to avoid unwanted optical effects and occlusions. — [ISTI-CNR seminar "Bending the light"](https://www.isti.cnr.it/announcements/seminars/256/announcements)
- Viewpoint dependence can also be the point of the work. Artemij Kopach's *Parallax* uses varied heads that appear to animate as the viewer walks past. — [Cifra, Parallax](https://cifra.com/project/parallax)
- Ned Kahn's water, fog and wind works (e.g. *Cloud Arbor*, Pittsburgh: fog nozzles on 30-ft poles; *Wind Arbor*, Marina Bay Sands: 260,000 hinged aluminium plates) are made to be seen from many positions. They are not single-viewpoint works. — [Art Outreach Singapore](https://www.artoutreachsingapore.org/post/wind-arbor-and-rain-oculus-by-ned-khan); [nedkahn.com](https://nedkahn.com/?p=35)

### Inferences
- **Practical build rule, from the Varini and Pras methods.** Put a camera or projector at the marked STAND HERE point, at the design eye height, and lay out every element against that view: jet tips, suspended objects, lit bands. A laser or projector at the eye point gives a physical check. Each target point should sit on the ray from the eye.
- **Parallax tolerance (my geometric derivation; no source found).** Take two elements on the same sight line at distances D1 (near) and D2 (far) from the eye. If the viewer moves sideways (or up or down) by Δ, the far element appears shifted relative to the near one by e = Δ·(D2 − D1)/D1, measured at the far element's distance. So the allowed viewer movement is **Δmax = e_allow · D1 / (D2 − D1)**.
  - Example: near jet tip at 6 m, far jet tip at 9 m, alignment allowed to be off by 0.15 m (about one jet-crown width). Then Δmax = 0.15 × 6 / 3 = 0.30 m.
  - The same formula covers eye-height error, using the vertical offset in place of Δ.
  - Tolerance therefore improves when the viewpoint is farther away (larger D1) and when the depth spread (D2 − D1) is smaller.
  - The relative depth spread matters most. A sculpture whose depth is small compared with the viewing distance is forgiving.
- **Eye height.** Viewer heights vary by about ±0.15 m (adult–adult) and more for children. One fix is to mark a design height of about 1.6 m and provide a step or platform. Another is to use a camera at a fixed height, as Pras does.
- **Water elements are not rigid.** Jet heights drift with wind, pump pressure and nozzle wear, which adds error on top of viewer error. Design so the image tolerates a few centimetres at each tip.

### Gaps
- I found no published numeric tolerance for viewer offset in anamorphic installations. The Stojakovic paper may contain one, but only the abstract was available.
- I found no documented single-viewpoint artwork made specifically from water jets. Digital water curtains ("water graphics" / graphical waterfalls) came up in search, but I found no viewing-angle data for them.

## 2. Lighting jets at night so the tops glow while the lower columns stay faint

### Takeaway
Water droplets scatter light strongly forward. A jet therefore looks brightest when the light comes from behind or from the side, toward the viewer, and the bright part is wherever the light actually hits droplets or spray. A clear laminar column lit from the base guides light along its whole length, so it glows end to end. The way to light only the top is to aim narrow beams at the break-up and spray zone from outside or above, keep the lower column out of the beam, and keep the background dark.

### Cited Findings
- **Forward scattering.** Water droplets are comparable in size to visible wavelengths, so they follow Mie scattering. The Mie phase function has "a very strong diffraction peak, a wide forward-scattering lobe," plus back-scatter features. For a typical 5 µm fog droplet the forward lobe is about 2.5° wide (FWHM). Larger droplets give an even sharper forward peak. — [arXiv 1709.05418, Deep Scattering](https://arxiv.org/pdf/1709.05418); [miepython: Mie Scattering and Fog](https://miepython.readthedocs.io/en/latest/05_fog.html); [NVIDIA approximate Mie paper](https://research.nvidia.com/labs/rtr/approximate-mie/publications/approximate-mie.pdf)
- **Rain Room as a precedent (rAndom International).** At the Barbican the team "settled on a single light source at the back to visually carve out every drop of rain" (Hannes Koch); a visitor described it as a single large white HMI. At LACMA a single white theatrical spot lit the rain from the side, turning it into "sheets glistening silver." At MoMA a spotlight at one side of the room produced rainbows. — [Ingenia](https://ingenia.org.uk/articles/inside-the-rain-room-no-umbrella-required/); [Wild Culture](https://wildculture.com/article/random-international-rain-room-barbican/1072); [Dunn-Edwards (LACMA)](https://www.dunnedwards.com/pros/blog/inside-lacmas-rain-room-las-most-captivating-exhibit/); [Smithsonian](https://www.smithsonianmag.com/science-nature/this-incredible-art-installation-makes-it-rain-everywhere-but-on-you-1676028/)
- **Clear laminar jets act as light guides.** Light entering at the nozzle reflects internally up the column, so a clean laminar jet glows end to end like a fibre optic. Bubbles, dirt or a scratched bore break this. — [AliExpress wiki article (vendor-grade source, low reliability)](https://www.aliexpress.com/s/wiki-ssr/article/fountain-nozzle-light). Luminous-fountain patents put the light source near the nozzle (EP 0 327 779 A1), and later designs describe light travelling inside the stream by repeated internal reflection (EP 0 862 016 B1). — [Firgelli, Luminous fountain mechanism](https://www.firgelliauto.com/blogs/mechanisms/luminous-fountain)
- **Ring lights around the nozzle light the whole column.** "By encircling the nozzle, the light travels up the entire column of water." — [Paradise Landscape Lighting / vendor content via search](https://www.paradiselandscapelighting.com/mastering-underwater-fountain-lighting-installation-guide/) (snippet; page not fetched)
- **Aerated jets.** Aerated water is "an effective carrier of light, due to the air bubbles" (Crystal Fountains). Aerated white water gives "a brighter, more dramatic night-time effect" than a clear stream. — [Crystal Fountains insights](https://crystalfountains.com/insights/water-effects-and-lighting-options-for-a-water-feature/); [Aquatic Pools & Fountains](https://aquaticpoolsandfountains.com/foam-nozzle-selection-premium-water-features/). WaterShapes is cited, via a search snippet only, as saying aerated effects need about **double the light intensity per vertical foot** compared with clear-stream nozzles. — [WaterShapes "Light Sensations"](https://watershapes.com/light-sensations/) (page refused connection; snippet only)
- **Beam choice and placement (WaterShapes, snippet).** Use spots for narrow, tall effects and medium floods for wider groupings. Keep foam away from the lens. Put the lens close to the water surface (about 1 inch). Place fixtures at least 2 ft from large aerated nozzles. — [WaterShapes](https://watershapes.com/light-sensations/)
- **Tall clear jets need precise aim.** A patent notes that clear jets thrown up to 15 m need "highly precise alignment of the beam path." — [EP2116760B1](https://patents.google.com/patent/EP2116760B1/en)

### Inferences
- **Why base lighting lights the whole jet.** A ring or underwater spot under the nozzle sends light up the column. In a laminar jet the light is guided all the way; in an aerated jet the bubbles scatter it from the bottom upward. Either way the lower column glows, which is the opposite of the goal.
- **Lighting only the upper band.** Use narrow spots (5–15°) mounted outside or beside the pool, below the band and aimed up at it, or on poles or overhead structures. Put the light on the far side of the jets from the viewer so the beam travels roughly toward the viewer: forward scattering then makes the tips glow and the unlit column stays dark. The beam must not hit the lower column, and the source must not be in the viewer's direct line (see glare below).
- **Beam geometry (my calculation).** A beam of full angle θ is about 2·d·tan(θ/2) wide at distance d:

  | Beam angle | Width at 1 m | Width at 3 m | Width at 5 m |
  |---|---|---|---|
  | 5° | ≈ 0.09 m | ≈ 0.26 m | ≈ 0.44 m |
  | 10° | ≈ 0.17 m | ≈ 0.52 m | ≈ 0.87 m |
  | 15° | ≈ 0.26 m | ≈ 0.79 m | ≈ 1.3 m |

  A 10° spot 3 m from a jet and aimed horizontally therefore lights a band about 0.5 m tall, plus soft spill beyond the edges. Lighting a chosen height band from 1–5 m away is geometrically achievable with 5–15° optics. A hard-edged band needs a framing or gobo projector; LED spots have soft edges and a spill halo beyond the rated beam angle.
- **Angle of incidence.** A beam aimed horizontally hits only the band at its own height. A beam aimed steeply upward from the base runs along the jet and lights much more of it. Mount fixtures at or near the target band height, or aim them steeply downward from above, to keep the lit band short.
- **Spray is easier to light than a clear column.** A clear jet's smooth side mostly lets light through or reflects it like a mirror, and a tight forward lobe sends most of the scattered light along the beam. The broken tip or crown scatters light in all directions and looks bright from many angles. A crown or foam-top nozzle plus side or back light is the easiest way to get "glowing tops."
- **Contrast.** No source I found gives a contrast threshold for when an unlit column "disappears." Practical target (inference, unsourced): keep the lower column at least 10× dimmer than the lit band and keep the backdrop dark. In fully dark surroundings the eye adapts, so even weak spill becomes visible.
- **Glare.** Hide the sources from the STAND HERE point. Use louvres or snoots, place fixtures behind the jets but outside the viewer's cone, or recess them below the coping. A visible source raises the threshold increment and lowers how well the viewer sees the lit tips (see the CIE TI definition below).

### Gaps
- I found no measured photometric study of how much light different parts of a jet scatter in different directions.
- I could not confirm the "double intensity per vertical foot" figure from the full WaterShapes page.

## 3. Products: narrow-beam fountain spots and outdoor framing projectors

### Takeaway
Narrow-beam (about 10–11°) IP68 underwater spots with roughly 500–750 lm exist (OASE ProfiLux 1100, Philips C-Splash 2 10°). Small RGB pond spots are about 25° and only around 200 lm. Hard-edged band lighting from outside the pool calls for IP66 framing or gobo projectors such as the Martin Exterior Projection series (about 5,000–6,000 lm).

### Cited Findings
- **OASE ProfiLux 1100 (white):** 24 W, **735 lm, 11° beam**, aimed at larger fountain displays. — [Water Garden UK](https://www.water-garden.co.uk/prod/profilux-1100-led-24v-flood-light-23-watts) (retailer)
- **OASE ProfiLux Garden LED RGB:** 24 V DC, **25° beam**, about 6 W, **213 lm** total (R/G/B 64/114/35, from one retailer table). Rated for continuous use to 4 m depth. Can be mounted underwater, on land with a spike, or on nozzle risers. Needs an OASE controller. — [OASE](https://www.oase.com/en/products-a-z/family/f/profilux-garden-led-rgb.1000926935.html); [Water Garden UK](https://www.water-garden.co.uk/prod/profilux-garden-led-rgb-spot-light). The lumen figure is unconfirmed by an official OASE datasheet.
- **Philips C-Splash 2, 10° clear lens:** **IP68, 10° beam, 583 lm** initial at 31.3 W, 24 V, brass housing, 50,000 h to L50, not dimmable. The RGB version gives more than 500 lm. — [Philips datasheet](https://www.assets.lighting.philips.com/is/content/PhilipsLighting/comf51809-pss-en_ae); [Philips datasheet 2](https://www.assets.lighting.philips.com/is/content/PhilipsLighting/fp910503700617-pss-en_ae)
- **WAC LED Underwater Spot:** IP68, 780+ lm, 3000 K, but a **60° beam**, so too wide for band lighting. Rated to 3 ft depth. — [Landscape Management](https://www.landscapemanagement.net/wac-landscape-lighting-intros-new-underwater-light/)
- **Safe-Rain dichroic fountain spots:** 25°, 38° and 45° beams, with lamps rated for jets no higher than 3 m (from a search snippet of the datasheet; the PDF URL now returns 404). — [Safe-Rain PDF](https://saferain.com/wp-content/uploads/2025/07/fountain-lighting_dichroic-lights.pdf)
- **Crystal Fountains LED130 illuminated foam jet:** a nozzle with integrated light, RGBW or tunable white, 30 W option. It lights the whole aerated column, so it is the opposite of tip-only lighting. — [Crystal Fountains](https://crystalfountains.com/product/led130-series-illuminated-foam-jet/)
- **Martin Exterior Projection Pro Compact:** IP66, IK08, C5 corrosion rating, **5,200 lm**, motorized 15–45° zoom. Optional **framing module with 4 independent blades** and a 4-gobo module. — [Creation Networks](https://creationnetworks.net/products/martin-exterior-projection-pro-compact-ip66-outdoor-image-projector-white) (retailer)
- **Martin Exterior Projection 500:** IP66, 230 W white LED, up to 6,100 lm, 4 beam-angle options, gobo wheel with animation, motorized focus. — [SoundPro](https://soundpro.com/products/martin-lighting-90506545) (retailer)

### Inferences
- **A blade-framed projector (Martin Exterior Projection Pro Compact plus framing module)** is the clearest way to cut a sharp-edged horizontal band across a row of jet tips from outside the pool. At 15° it covers a band about 0.8 m wide at 3 m or 1.3 m at 5 m, and the blades trim it down from there.
- **Narrow underwater spots can work too.** 10–11° units (ProfiLux 1100, C-Splash 2 10°) placed below and beside the jets, aimed at the tips, will light them, but their spill will also light part of the column. A housing that sits above the waterline lets the fixture be tilted more.

### Gaps
- I found no specifications for Hydrel, WE-EF, Lumascape or Bega underwater narrow-beam products in this session. Their datasheets should be checked directly.
- I found no laser-based method for lighting fountain jet tips with published data.

## 4. Background and dark-sky conditions

### Takeaway
A dark backdrop and low ambient light are the precedent: Rain Room lights a dark room with one source behind or beside the water. Outdoor lighting guidance (CIE 150:2017) sets limits for obtrusive light by environmental zone and defines the glare "threshold increment," but it gives no rule for fountain contrast.

### Cited Findings
- **Rain Room** runs in a darkened room with one bright white light behind or beside the water. Visitors become silhouettes and every drop stands out. — [Ingenia](https://ingenia.org.uk/articles/inside-the-rain-room-no-umbrella-required/); [Dunn-Edwards](https://www.dunnedwards.com/pros/blog/inside-lacmas-rain-room-las-most-captivating-exhibit/)
- **CIE 150:2017** (2nd edition, replaces 2003) sets obtrusive-light limits for zones E1 (intrinsically dark) to E4 (town centres), with pre- and post-curfew values. — [Austrian Standards listing](https://austrian-standards.at/en/shop/cie-150-2017~p2636130); [NSVV preview](https://www.nsvv.nl/wp-content/uploads/2018/07/Preview-TR-150-2017.pdf)
- **2003 values** (as cited by AGI32): vertical illuminance on nearby properties 2 lx (E1) to 25 lx (E4) pre-curfew, building façade luminance 0–25 cd/m², sign luminance 50–1,000 cd/m². These may differ in the 2017 edition. — [AGI32 paper](https://www.agi32.com/Downloads/News/PAPER%203C-P7_303_Rev_.pdf)
- **Threshold increment (TI)** is the percentage increase in the contrast threshold needed to see an object against its background when a glare source is present. CIE 150 treats it as a maximum. — [AGI32 paper](https://www.agi32.com/Downloads/News/PAPER%203C-P7_303_Rev_.pdf)

### Inferences
- **Put a dark, matte surface behind the jets as seen from the viewpoint.** Hedge, dark-painted wall, black-dyed pool floor or open sky all work. Turn off or shield nearby path and façade lights in the viewer's field of view so that low spill on the lower column stays below what the eye notices.
- **The pool floor matters.** A light-coloured floor reflects underwater light back up and brightens the lower columns. A dark floor or dark pool dye helps.

### Gaps
- I found no source that gives luminance-contrast requirements specifically for water features against dark backgrounds.
