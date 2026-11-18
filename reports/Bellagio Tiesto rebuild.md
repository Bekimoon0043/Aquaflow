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
| Lights | warm white `#ffd9a6` | 208 | one per oarsman |
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

## Simplifications (not verified against WET's data)

- **Dimensions:** the lake outline, the 300 m line, the 48 m and 22 m rings and the spacings are estimated from the drone footage, not surveyed.
- **Oarsmen:** modelled as one-axis swing nozzles, as the user asked. WET's real oarsman mechanism is proprietary.
- **Shooters:** modelled as water jets whose level pulses. The real ones are air-powered bursts.
- **Pumps:** no pumps are modelled, so the show plays from its timeline. The Easy Fountain Design panel will report the nozzles as "no pump".
