# Fountains of Bellagio · Tiësto — rebuilt on the real layout

**Output:** `Desktop/Bellagio_Tiesto_Real_Layout.aquapkg`, built by `aquaflow/frontend/scripts/build-bellagio-tiesto.mjs` from Kimi's `Bellagio_Tiesto_Full_Site_Show.aquapkg` (only its song is reused).

## The show

Tiësto's Bellagio show premiered on 17 Sept 2014. It is a medley of three tracks from *A Town Called Paradise*: "Footprints", "Rocky" and "Red Lights". WET choreographed it, and it is the only EDM show the fountain has run ([Las Vegas Sun](https://lasvegassun.com/blogs/kats-report/2014/sep/15/tiesto-wades-new-production-bellagio-fountains-sho/), [Dancing Astronaut](https://dancingastronaut.com/2014/09/watch-tiestos-town-called-paradise-makes-bellagio-fountains-debut/), [Travel Weekly](https://www.travelweekly.com/North-America-Travel/Tiesto-medley-now-playing-at-Bellagio-Fountains)).

Three films were used:

- **Official film:** "Tiesto - Bellagio Fountains, Las Vegas", YouTube `iNQpcDuE6e4`, 293 s. Its soundtrack is bit-identical to the reference audio in Kimi's package (cross-correlation 1.0, lag 0.0 s), so a moment in the film is the same moment in the show.
- **Front view at night:** YouTube `DS_Z432yaiE`. This is a different song, used for the hardware seen from the Strip.
- **Third film:** YouTube `bu7JAXaaGyE`.

## Layout, read from the films

The official film's drone shots (0:15–0:33 from the south-east, top-down at 2:42) give the layout:

- **One long line** of nozzles runs across the lake, about 300 m long. Its ends curve back toward the hotel.
- **A big ring** sits tangent to the audience side of the line. It is double: an outer circle of oarsmen and shooters, and an inner circle of mini-shooters. Extreme-shooters stand in the centre.
- **A smaller ring** sits tangent further south and has its own centre column.
- **Fog** rolls over the lake around the ring at 1:30–1:45, 2:45–3:00 and 3:45.
- **White light only.** It reads warm gold on camera ([Wikipedia](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)).

The equipment counts are Bellagio's published ones: 208 oarsmen, 798 mini-shooters, 192 super-shooters and 16 extreme-shooters, which is 1,214 nozzles. Their reach is 100, 240 and 460 ft ([Wikipedia](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)). An air shooter must refill its 200 psi receiver after each shot ([phcppros](https://www.phcppros.com/articles/2835-an-engineering-marvel)), so the build checks that no shooter refires within 3.5 s.

| Family | Model in AquaFlow | Count | Where |
|---|---|---|---|
| Oarsmen | 1D swing nozzle (`motion_nozzle_1d_tilt_motor`), 22 m jet, ±60° | 208 | 128 on the line (swing along the line), 48 on the big ring and 32 on the small ring (swing radially: in = dome, out = crown) |
| Mini-shooters | Comet jet DN25 set to 30 m | 798 | a row in front of the line, the outer and inner rings of the big ring, the small ring |
| Super-shooters | Comet jet DN80 set to 73 m | 192 | a row behind the line; the big and small rings |
| Extreme-shooters | Comet jet DN80 set to 140 m | 16 | 6 at the big ring centre, 4 at the small ring centre, 3 at each line end |
| Lights | warm white `#ffca82` (gold on the film) | 1,214 | one underwater lamp under every nozzle, paired with it |
| Fog | fog unit | 24 | along the line and round the big ring |

## Choreography: song time = film time

The tempo is 128.02 BPM, with the first beat at 0.239 s (1 bar = 1.875 s). The hits come from the song's energy curve.

| Time (s) | Section | Patterns |
|---|---|---|
| 0–6 | Intro | the rings glow in the dark |
| 6.24 | Opening hit | two columns from the big- and small-ring extremes (the film shows two columns from the air) |
| 13–24 | Ring draws on | the outer ring draws clockwise and the inner ring rises; a second column at 12.96 |
| 24–37 | Crown | the ring oarsmen lean out; the line draws on from the north end to the south |
| 37–60 | Build | the ring oarsmen cross (X), the crown rotates, the small ring wakes; shooters at 56.7 |
| 60–72 | Curtain | the line becomes a mini-shooter wall with the oarsmen combing it |
| 72 | Impact | every super-shooter, the ring and end extremes, fog rolls in |
| 76–120 | Footprints groove | leaning arcs travel along the line, the curtain chases, the ring forms a dome; fog and shooters at 110 |
| 120–134 | Drop | line and rings pump on the beat, fast sweeps; shooters fire in alternating halves |
| 134–150 | Breakdown | fog, the ring alone with a dome, slow columns in the haze |
| 150–180 | Walls | the wall rises, arcs lean and travel, shooters race the line, tall shooters behind the wall |
| 180–196 | Bass section | fog bank, deep dome, a slow ripple along the line |
| 195.6 | Big hit | all super-shooters and all extremes |
| 198–227 | Build and drop | arcs swing across, shooter chases, a light **flash** at 216.24 (seen in the film), converge-and-split |
| 227–250 | Double ring | the outer and inner rings spin opposite ways under a tall crown, then a dip with fog and a dome |
| 250–270 | Red Lights | the line returns, rings with shooters, finale build |
| 270.5–289 | Finale | everything; shooter waves; peak at 286; last shot at 289.18; then the lake goes still |

## 1D dances and the sung words (second pass)

**1D oarsman dances along the line.** Every swing is checked against a 90°/s drive limit; the fastest is 52°/s.

| Time | Dance |
|---|---|
| 0:37 | **Cross**: odd and even oarsmen swing in mirror image, so neighbouring jets cross into an X lattice |
| 1:38 | **Scissors**: mirror-image pairs snap past each other |
| 2:00 | **Scissors on the beat** for the drop |
| 2:30 | **Fan**: the north and south halves open outward and close back |
| 3:37 | **Rowing**: the whole line leans together |
| 4:10 | **Travelling cross**: the X points run along the line |
| 4:30 | Crossing sweeps in the finale |

Before this pass, three sweeps asked for 100–256°/s. They were slowed to within the drive's rating.

**The water follows the lyrics.** No captions exist for the film. Sung phrases were found in the song's centre channel instead: vocals are mixed in the centre and the synths are wide. The detector looked at voiced frames in the 250–3500 Hz band.

- **What was found:** 15 phrases and 232 word onsets, stored in `scripts/data/bellagio-tiesto-vocals.json`.
- **Check against the film:** the film starts drawing the ring on the first vocal entry (12.7 s) and raises the crown on the next one (24.4 s).
- **How it plays:** each phrase is a "Sung line" pattern, sampled 20 times a second. Each word gives a pulse that ripples out from the centre of a singer group, and that group's lights flash with it.
- **Singer groups:**
  - **Footprints verses:** the inner ring.
  - **Calls at 1:28–2:36:** the small ring and the centre of the line.
  - **Vocal run at 3:15–3:45:** the middle 80 m of the line.
- **Limit:** word timing is estimated from audio energy, not transcribed lyrics.

## Lighting (third pass)

Read from the official film and the two audience videos:

- **Every jet has a hot core at the water line.** A lamp sits under each nozzle and shines up into the aerated base, so the bottom metres glow almost white.
- **The stream carries the light up.** A coherent jet works like a light guide. Light enters at the base and travels inside the stream, leaking out where the surface roughens and the stream breaks into drops. A 22 m oarsman arc stays lit end to end. A 73 m super-shooter's crown is a dim glow over a blazing base.
- **Spray mist glows.** Fine spray hangs over the crowns and boils up where the water lands. It drifts for seconds and glows only where the lamps' upward beams reach it.
- **The lake glows around the lamps.** Pools of light sit on the surface around each running jet.
- **Reflections are streaks.** Wind ripples smear every lit jet into broken vertical streaks.
- **Unlit water is almost invisible** at night.
- **The light follows the water.** It flashes on the biggest hits, such as the 3:36 flash.

How AquaFlow does it:

- **The show:** 1,214 lamps, one paired with each nozzle. Each lamp is lit only where water is in its light, so every water pattern is also the light pattern.
- **House level:**
  - 90 % for the opening and the groove
  - 50 % for the breakdown
  - 95 % for the walls
  - 55 % for the bass section
  - 100 % from the big hit to the end
- **Hit flashes:** every lamp punches to full and settles within a second at 1:12, 2:00, 3:16, 3:36, 4:30 and 4:49.
- **The Studio renderer** (`EasyScene` show mode):
  - per-drop light from its lamp: a light-guide term that fades with the metres travelled, plus the hot core near the lamp;
  - a camera-exposure streak behind each drop (1/40 s), so streams read continuous as on film;
  - lit mist puffs inside the lamps' beam cones;
  - lamp pools on the lake;
  - streaked, gusty reflections;
  - moonlight-only night lighting, with bloom on the hot cores.
- **Size:** 2,428 fixtures, 160 patterns and 31,772 clips. The lamps hold one clip per section rather than copying every water pattern; copying put the show over 88 MB and 41,900 clips, and it would not open.

## Light play, no fog, new cameras (fourth pass)

- **No fog anywhere:** there are no fog fixtures. The Studio look's spray-mist clouds are now a Render-tab option ("Spray mist clouds"), off by default, so the air is clear.
- **Lamps follow their own water:** each lamp burns only while its jet runs, plus the seconds its water is still in the air. AquaFlow compiles the water first, reads each jet's level every 0.1 s, and turns that into the lamp's on/off times, rounded to 0.5 s and grouped so lamps that behave alike share one editable group.
  - Shooter lamps blast at full.
  - Oarsmen and mini-shooters follow the section's house level.
- **Light plays on its own,** as in the film:
  - Light only, on a still lake:
    - 0:00–0:06: the ring lamps circle in the dark.
    - 2:15–2:29: a running light along the still line.
    - 3:00–3:16: light waves over the still curtain row.
  - Light dances over the water:
    - 1:00: bands of light run along the curtain.
    - 1:38: odd and even oarsmen flash alternately on the beat.
    - 2:14: the ring breathes.
    - 3:00: the ring lamps kick with the bass.
    - 3:18: a strobe builds into the 3:36 flash.
    - 3:47: the double ring's lamps spin in opposite directions.
    - 4:10: crossing light.
  - Every lamp flashes at the three biggest hits: 1:12, 3:36 and 4:30.
- **Cameras:** a film edit, with one moving shot per section (glides, orbits, crane-ups, push-ins) and cuts on the music. Every key is at least 3 m up.
  - The old track dipped under the water because the spline overshot between a 210 m top view and a 5 m low shot.
  - The app now stops a cut from bending the shots on either side of it, and never lets the camera sample below 0.5 m.
- **Size:** 2,428 fixtures, 1,373 patterns, 33,514 clips, 65.2 MB.

## Simplifications (not verified against WET's data)

- **Dimensions:** the lake outline, the 300 m line, the 48 m and 22 m rings and the spacings are estimated from the drone footage, not surveyed.
- **Oarsmen:** modelled as one-axis swing nozzles, as the user asked. WET's real oarsman mechanism is proprietary.
- **Shooters:** modelled as water jets whose level pulses. The real ones are air-powered bursts.
- **Lights:** one lamp per nozzle stands in for Bellagio's 4,792 lights. The light model is tuned by eye against the films, not measured.
- **Pumps:** no pumps are modelled, so the show plays from its timeline. The Easy Fountain Design panel will report the nozzles as "no pump".
