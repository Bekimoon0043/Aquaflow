# Wave and effect engines (lighting, pixel and fountain): catalogue, parameters, phase distribution, music mapping and hydraulic constraints

Research date: 2026-10-20. Limit: 18 tool calls. Primary sources were MA Lighting help, WLED docs and FX.cpp source, the xLights manual, the Avolites manual and forum, Wikipedia and press coverage of WET shows, and Chinese fountain supplier pages. Text marked "(unverified, from background knowledge)" is not cited. Treat it as a hypothesis to check.

## Q1. How do professional lighting consoles (grandMA2, grandMA3, Avolites, ETC) define effects and distribute phase across fixtures?

### Takeaway
All the major consoles use the same model. A periodic waveform (the "form" or "shape") runs at a speed in BPM or Hz between a low and a high value. Each fixture gets a phase offset in degrees, spread evenly across the selection. Groups, blocks and wings remap fixture index to phase index (grandMA2 does this in the effect editor, grandMA3 through MAtricks). Width or duty cycle and attack/decay or transition shape the pulse. A fountain engine can copy this model directly.

### Cited Findings
- grandMA2 effect editor parameters ([MA help: predefined effects](https://help.malighting.com/grandMA2/en/help/key_effects_predefined.html)):
  - **Form**: the shape of the effect.
  - **Rate**: a speed factor. Rate 1 = 60 BPM.
  - **Speed**: in BPM, Hz or seconds.
  - **Speed Group**: links the effect to a rate or speed master.
  - **Dir**: direction.
  - **Low / High value**: the effect range. It can be a range such as "a Thru b".
  - **Phase**: "the time offset that individual fixtures use within the effect", distributed over the fixtures. It is set in degrees, and a range can be entered (for example 0 Thru 360).
  - **Width**: the duty share. For PWM, a width of 20% gives the high value for 20% of the cycle and the low value for 80%. Width does not apply to the Chase form.
  - **Attack / Decay**: fade-in and fade-out shaping. Only the Random, PWM and Chaser forms have them.
  - **Groups**: "divides the phases according to the number of groups".
  - **Blocks**: "works with Phase so that neighbouring fixtures run the same phase".
  - **Wings**: "applies the phase starting from the outside and moving inward". In Pan effects with 2 wings, one wing is inverted so the fixtures run toward each other.
  - **Single Shot**: runs the effect once instead of looping.
  - **Interleave**: chooses which fixtures take part.
- In grandMA2, forms are the basis of every effect and are edited in a form pool as graphs. Multidimensional forms arrived in v2.3 ([MA help: create forms](https://help.malighting.com/grandMA2/en/help/key_effects_create_forms.html); [MA2 v2.3 release notes](https://help.malighting.com/grandMA2/en/help/release_notes/key_rn_v2_3.html)).
- The Chase form gives a hard on/off. Users soften it with ramp forms. This is anecdotal ([ControlBooth thread](https://www.controlbooth.com/threads/effects-on-ma2.35588/latest)).
- A MAtricks plugin API describes wings: 0 = no wings, 2 = symmetrical. Interleave splits a selection into interleaved blocks. Pulse-wave direction can be Left, Right, In (centre-out), Out (edges-in) or Random ([MA2plugins MAtricks docs](https://www.mintlify.com/HugoOtth/MA2plugins/api/matricks)). This is third-party.
- grandMA3 phasers are built from steps, not from a form library ([grandMA3 2.3 Phasers](https://help.malighting.com/grandMA3/2.3/HTML/phaser.html)):
  - A phaser is two or more steps. For example, dimmer 100% then 0% gives a smooth fade loop.
  - **Width** (per step): the time from the start of one step to the start of the next, as a percentage of a beat. At 120 BPM, 100% = 0.5 s, 0% = instant and 200% = 1 s.
  - **Transition**: the share of the width spent moving to the new value. For example, 10% of a 1 s step means the move takes 0.1 s, then the value holds.
  - **Accel / Decel**: the curve shape. 0% is linear. -100% on both gives a sine-like curve.
  - **Speed** (BPM / Hz / s per beat): 120 BPM = 2 Hz.
  - **Phase**: degrees per fixture.
  - **Measure**: beats per loop. A 4-beat measure at 120 BPM repeats every 2 s.
  - **Sync**: gives predictable timing and phase on recall.
  - **Stomp**: freezes a running phaser to a static value.
- grandMA3 PWM recipe: Transition 0 and Width 50 ([grandMA3 keyword Width](https://help.malighting.com/grandMA3/2.3/HTML/keyword_width.html)).
- Avolites Titan ([Avolites shape generator manual](https://manual.avolites.com/docs/effects/shape-generator)):
  - A shape is "an automatic sequence of values which modify a particular attribute" (dimmer, colour, position and so on). Each shape has a Size and a Speed, which playback faders or Speed and Size masters can control.
  - Size 0 hides the shape but leaves it running.
  - **Spread** offsets the shape along the fixtures in selection order. The order can be edited with "Fixture Order".
  - Block shapes stop other shapes from running.
  - A Key Frame Shape Generator lets you build custom shapes.
- In Avolites, Spread and Phase set the same offset: phase = 360/n where Spread = n ([Avolites forum](https://forum.avolites.com/viewtopic.php?p=4424); see also [Blue Room "Avolites shapes – the maths"](https://www.blue-room.org.uk/topic/57474-avolites-shapes-the-maths/)).

### Inferences
- A general phase-distribution function an engine could use. This is synthesised from the MA definitions above.
  - **Inputs**: the fixture order index i (0..N-1), groups G, blocks B, wings W, and a phase range [φ0, φ1].
  - **Blocks**: j = floor(i / B), so B neighbours share a phase. This gives M = ceil(N/B) phase slots.
  - **Groups**: j = j mod G, so the phase pattern repeats every G slots.
  - **Wings** (W > 1): split the slots into W wings and mirror alternate wings, j' = (wing odd) ? (L-1-j_local) : j_local. Every wing then runs from its own start toward its end. With W = 2 and centre-out, both halves start at the centre.
  - **Phase**: φ_i = φ0 + (φ1 − φ0) · j' / (count − 1) (or / count for a closed 360° loop).
  - **Output**: value_i(t) = low + (high − low) · form(frac(t·f + φ_i/360)), where f = BPM/60 × rate.
- Mapping to fountains:
  - A **row** of jets maps to a 1-D phase, giving a running wave.
  - **Wings = 2** on a row gives a mirrored or "V" wave, either centre-out or outside-in.
  - A **ring** with phase 0..360 over N jets gives a rotating wave. A phase of 0..720 gives two crests.
  - **Blocks = 2..4** make jets move in pairs or quads, which reads better at distance and suits slow valves.
  - **Groups = 2** with phase 0/180 gives an alternating (odd/even) "cross" or "zig-zag".
- grandMA3's step-based Width and Transition model maps directly onto solenoid jets. Set Transition = 0 for on/off and choose Width so the on-time is at least the valve minimum (see Q4).

### Gaps
- The exact grandMA2 built-in form list was not reached in an official page. Background knowledge (unverified) gives: Chase, Ramp, Ramp Plus, Ramp Minus, Sin, Cos, Step, Phase 1/2/3, PWM, Bump, Swing, Random, Flyout, Pan, Tilt, Circle. Verify against the MA2 manual's form pool.
- The grandMA3 MAtricks page (XGroup/XBlock/XWings, Phase From/To, X/Y/Z axes) was not fetched. The 404 on the guessed "phaser_phase" URL suggests the path is something like `matricks.html` in the 2.x manual.
- I did not research ETC Eos effects. Background knowledge (unverified) says Eos has step, absolute and relative effects, with Entry/Exit modes, Grouping, Mode (Cross/Parallel/Wave), Cycle time and Duration. Verify on the ETC Eos manual "Effects" chapter.
- The Avolites built-in shape list and its Wings/Groups equivalents were not retrieved.

## Q2. Which pixel-mapping effect catalogues exist (WLED, xLights, Resolume/Madrix), and how are their waves computed?

### Takeaway
WLED's FX.cpp is the best implementable reference. Each effect is a short closed-form function of time, pixel index, speed and intensity. Sine travelling waves, triangle/cubic waves, physics effects (bouncing balls, popcorn, drip) and particle bursts (fireworks, starburst, ripple) are all simple enough to port to a jet array. xLights Wave has a small, clear parameter set.

### Cited Findings
- All WLED formulas below are paraphrased from [WLED FX.cpp (main)](https://raw.githubusercontent.com/wled/WLED/main/wled00/FX.cpp), licensed EUPL-1.2. Effect IDs and slider names come from [WLED effects docs](https://kno.wled.ge/features/effects/).

| Effect (ID) | Sliders | How it is computed |
|---|---|---|
| Running (15) | Speed, Wave width | `x_scale = intensity>>2`, `counter = (now*speed)>>9`, then `s = sin8(i*x_scale − counter)`. The pixel is a blend from bg to palette by s. A Saw variant remaps the phase. Dual mirrors the wave. |
| Theater (13) | Speed, Gap size | `width = 3 + (intensity>>4)`, `cycleTime = 50 + (255−speed)` ms. The pixel is on when `i % width == aux0` (a step chase). |
| Scanner, i.e. Larson (40), and Scanner Dual (60) | Speed, Fade rate | The head moves end to end at `map(speed,0,255,96,2)` frames per traverse and reverses at the ends, with an optional pause of `custom1*25` ms. The trail fades by `255−intensity`. |
| Sinelon (92) | Speed, Trail | `pos = beatsin16(speed/10, 0, LEN−1)`, a sinusoidal ping-pong, with `fade(intensity)` as the trail. A dual variant mirrors it. |
| Sine Wave | | `step += speed/16`, `bri = cubicwave8(i*(intensity/4) + step)`. Intensity sets the spatial frequency. |
| Phased | | `phase += speed/32`, `val = (i+1)*16 + phase*(i%5+1)/2`, `b = max(0, cubicwave8(val) − (255−intensity))`. Intensity acts as a threshold, which makes a duty cycle. |
| Wavesins (184) | Speed, Brightness variation, Starting color, Range of colors, Color variation | `bri = sin8(now/4 + i*intensity)`. |
| Lake (75) | Speed | Three `beatsin8` oscillators at sp = speed/10: `index = cos8(i*15 + w1)/2 + cubicwave8(i*23 + w2)/2`, `lum = max(0, index − w3)`. Two spatial waves of different wavelength plus a moving threshold give organic water. |
| Pacifica (101) | Speed, Angle | Four layered sine waves at different speeds. Each layer's angle is `(120+intensity)*i`, and the layer speeds come from `beatsin16(3 or 4,179,269)`. When summed brightness passes a threshold, whitecaps are added. |
| Colorwaves (67) / Pride 2015 | Speed, Hue | Several `beatsin88` slow LFOs modulate the spatial frequency (`thetaInc` 25–40·256), the brightness depth (96–224) and the hue increment. The result is a non-repeating, breathing wave. |
| Plasma (97) | Phase, Intensity | `idx = cubicwave8(i*(2+3*(speed>>5)) + p1)/2 + cos8(i*(1+2*(speed>>5)) + p2)/2`. p1 and p2 come from `beatsin8(6..7)`. Intensity subtracts a moving threshold. |
| Chunchun (111) | Speed, Gap size | `numBirds = 2 + LEN/8`. Each bird's position is `sin16(counter − k*span)`, with `counter = now*(6+speed/16)` and span set by intensity. This is a group of phase-offset sine positions. |
| Bouncing Balls (91) | Gravity, # of balls, Overlay | g = −9.81 and `h = (0.5*g*t + v0)*t`. Each bounce multiplies v0 by `0.9 − i/n²`. Speed scales time. Intensity sets the ball count. |
| Popcorn | | Gravity is `(−0.0001 − speed/200000)*LEN`. Kernels launch randomly (about 0.8% chance per frame) to a peak of 50–100% of LEN, with `v = sqrt(−2*g*peak)`. |
| Drip | | Drops swell, fall under gravity and bounce with `v = −v/4`. |
| Ripple (79) | Speed, Wave #, Overlay | Ripples spawn at random positions with probability set by intensity. The radius grows with `(state/decay)*(speed+1)`. Amplitude rises as a triangle wave, then decays linearly. |
| Ripple Peak (148) | Fade rate, Max # of ripples, Select bin, Volume (min) | Audio peaks trigger the ripples. |
| Fireworks (42) | Frequency | Random sparks with probability set by intensity, `fade(128)` and a blur. |
| Starburst | | Burst chance per frame is about `1/(144 − speed/2)`. Each burst has a 250 ms white ignite, a 1500 ms fade and 3 to 6+intensity/32 fragments that decelerate (`v −= 3v·dt`) and mirror symmetrically. |
| Twinkle (17) | Speed, Intensity | Random pixels from an LCG light up at intervals of `cycleTime = 20 + (255−speed)*5` ms, up to `map(intensity,1..LEN)` pixels at once. |
| Meteor (76) | Speed, Trail length | The head moves at `((speed>>2)+8)` with a size of LEN/20. The trail decays randomly. |
| Dancing Shadows (112) | Speed, # of shadows | Between 2 and 49 "spots", each with a random speed, direction and width of 1 to 9, blended at alpha 128. |

- xLights Wave effect ([xLights manual: Wave](https://manual.xlights.org/xlights/effects/off/wave)):
  - Wave Type: Sine, Decaying Sine, Square, Triangle or Fractal/Ivy.
  - Number of Waves.
  - Thickness of Wave.
  - Scale Height of Wave.
  - Speed.
  - Wave Direction: L→R or R→L.
  - Mirror Wave.
  - Y Offset.
  - Fill colours: single, palette or rainbow.
  - Value Curves can animate any parameter.

### Inferences
- WLED's speed and intensity are 0–255 sliders, not tempo. To lock an effect to tempo, replace `now*speed` with beat-phase. For example, `counter = 256 * beats_elapsed * cycles_per_beat`. The `beatsin8(bpm, ...)` helpers that Lake, Pacifica and Colorwaves use already take BPM-like arguments (in FastLED's 8.8 fixed-point form for `beatsin88`).
- Effects that suit binary solenoid jets:
  - Theater/chase (a step function)
  - Scanner (a single head; drop the fade trail, or use the trail as jet height on proportional valves)
  - Bouncing Balls and Popcorn (their physics can drive a "ball" of water up a row of jets, or the height of a single proportional jet)
  - Fireworks/Starburst (random bursts mirrored around a centre jet)
  - Twinkle (random jets)
- Effects that need continuous control (VFD or proportional valve heights), because they rely on smooth brightness: Running, Sine, Lake, Pacifica, Plasma and Colorwaves. On on/off jets, threshold them the way WLED's Phased and Lake already do with `max(0, wave − cutoff)`.

### Gaps
- The full xLights descriptions for Ripple, Spirals, Butterfly, Bars, Pinwheel, Shockwave, Meteors, Fire, Plasma, Twinkle and VU Meter were not fetched. The guessed manual URL returned 404. The manual's sitemap is at manual.xlights.org/xlights/sitemap.md.
- I did not research Madrix or Resolume effect lists.
- The WLED "Oscillate", "Two Dots" and "Ripple" code paths were only partly read. The file is 488k characters and I read the first 200k.

## Q3. What effects do fountain makers offer, and how do choreographers use waves on rows, rings and arrays?

### Takeaway
I found no published, standard fountain effect library like the MA form list. Fountain programming is mostly timeline-based: each nozzle, valve and light is keyframed against the music, increasingly in a physics-aware 3-D tool such as Depence or WET's in-house VirtualWET. Effects come from the hardware vocabulary: shooters (bursts), oarsmen (moving nozzles), swing and fan nozzles, chasing nozzles, and rings and rows run as phase-offset chases.

### Cited Findings
- Depence (Syncronorm) offers real-time hydrodynamic simulation ("advanced physics engine that calculates the hydrodynamic behaviour of fountains in real-time"). A dependency system links nozzles to valves and valves to pumps for the hydrodynamic and lighting calculations. It scales to hundreds of nozzles, synchronised with lasers, video, lighting and fireworks ([Syncronorm Depence fountains](https://syncronorm.com/products/depence2/visualization/fountains)). The Depence R4 Fountain Module lists at about €10,086 ([Pangolin listing](https://pangolin.com/en-nl/products/depence-fountain-module.oembed)).
- Fluidra used Depence for the Turkistan City Hall fountains ([Syncronorm news](https://www.syncronorm.com/newsitem/fluidra-use-depence-for-the-turkistan-city-hall-fountains)). OASE Living Water is also a Depence user and partner ([Syncronorm news: OASE](https://www.syncronorm.com/newsitem/oase-living-water)).
- Fountain control is largely "sending the pre-defined by artist control signals to hydraulic units in certain moment of time" ([TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)).
- Some systems react to sound live: one "listens" to the beat, volume and intensity and maps them to levels of jet activity ([WaterShapes "Shall We Dance"](https://watershapes.com/shall-we-dance/)).
- Chasing nozzles make low arcs "that meander throughout the fountain" and are choreographed as chase scenes ([WaterShapes](https://watershapes.com/?p=32542)).
- Nozzle-based effects include pop-jet, wave and splash, for example on an OASE Varionaut installation ([OASE Megyeház Square project](https://oase-livingwater.com/ru_RU/fountains-lakes/projects/public-areas/megyehaz-square.html)).
- Bellagio (WET) ([Wikipedia: Fountains of Bellagio](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)):
  - Jets: 208 oarsmen (about 77 ft), 798 mini-shooters (about 100 ft), 192 super-shooters (about 240 ft) and 16 extreme-shooters (about 460 ft, added 2005), roughly 1,214 jets in total.
  - Shooters are fired with compressed air at up to 500 psi from 10 compressors. Each oarsman moves 140 gal/min.
  - There are 4,792 lights.
  - Every nozzle and light is programmed individually. Two minutes of music can take up to a week to choreograph. Shows are adjusted for wind.
- Bellagio's oarsmen are "individually programmable so direction can change at any time" and were built by Sarcos ([Las Vegas Magazine](https://lasvegasmagazine.com/entertainment/2020/jun/21/behind-the-scenes-bellagio-fountains-vegas/); [yourmileagemayvary](https://yourmileagemayvary.com/2018/01/04/how-do-the-fountains-at-the-bellagio-work-anyway/)). The extreme-shooter install year conflicts: 2005 on Wikipedia, 2003 on yourmileagemayvary.
- Dubai Fountain (WET) ([Wikipedia: Dubai Fountain](https://en.wikipedia.org/wiki/Dubai_Fountain); [Gulf News](https://gulfnews.com/uae/testing-of-the-dubai-fountain-begins-1.476033); [Architect Magazine](https://www.architectmagazine.com/?p=212023)):
  - Jets are Shooters, Oarsmen and "water robots", described as "robotic water jets".
  - About 6,600 lights plus 25 colour projectors.
  - The show was built in WET's proprietary VirtualWET and has more than 1,000 individually choreographed elements. It was designed to "sway" to Arabic and world music.
- Chinese suppliers ([Himalaya Music Fountain](https://www.aajjo.com/product/big-music-fountain-in-bursa-himalayamusicfountain); [Beijing Orient Ming-Quan](https://freshdi.com/supplier/Beijing-Orient-Ming-Quan-Fountain-Equipment-Co-Ltd-); [Made-in-China listings](https://m.made-in-china.com/catlist/Programmable-Fountain-1261090000.html)):
  - They name effects by nozzle or mechanism: fan, peacock, comet, dandelion, mushroom, windmill, swing (1-D and 2-D DMX swing nozzles), rolling swing, running fountain, and "round shake" (a 4-circle design).
  - These are marketing pages without specs.

### Inferences
- What the cited hardware implies, plus standard practice (unverified):
  - **Rows of on/off jets**: a "running water" chase (Theater/Scanner style), a mirrored V (wings = 2), a ping-pong, and odd/even alternation.
  - **Rings**: rotation with phase 0..360°, a "breathing" ring where all jets share one phase with height following the envelope, and a pinwheel with groups k and blocks.
  - **Moving nozzles (oarsmen, swing)**: a sine on the pan or tilt angle with phase spread along the row gives the "sway" or "rolling" wave. Wings = 2 makes the two halves lean toward and away from each other, which is the "cross" or "fan" look.
  - **Shooters**: event-triggered on musical hits, often sequenced across the lake as a fast chase. This is a "racing" wave of bursts, like Starburst or Fireworks.
- A rolling or racing wave at Bellagio scale is a phase-offset pulse over shooters, plus a sine on the oarsmen angle. Since moving a shooter takes no time, the "speed" of a racing wave is simply the chase step time.

### Gaps
- No OASE WECS/WEPS effect-block documentation was found online. It appears to be catalogue- or partner-only.
- No list of Depence fountain "effect generator" or macro types was found.
- No authoritative Chinese controller manual listing effect names ("running water", "dancing water", "cross") was found. Only nozzle product names turned up.
- No primary WET source describes the oarsmen's angle range, speed or named signature moves.

## Q4. How are effects mapped to music, and what hydraulic constraints apply (solenoids, proportional valves, VFD pumps, moving nozzles)?

### Takeaway
Lighting engines lock effect speed to BPM or speed masters, with per-step timing in beats (grandMA3 Width and Measure). Fountains add hard physical limits:
- valve response from tens to hundreds of ms
- water flight time
- pump ramp
- wind

So hits must be fired early by a lead time, and effect speeds must be capped per device class. I found few cited numbers for VFD ramps or nozzle deg/s.

### Cited Findings
- Tempo locking in lighting consoles:
  - grandMA2: Rate 1 = 60 BPM, and a Speed Group links the effect to a speed or rate master ([MA2 predefined effects](https://help.malighting.com/grandMA2/en/help/key_effects_predefined.html)).
  - grandMA3: Speed in BPM or Hz, a SpeedMaster per attribute, Measure in beats, and Width in percent of a beat ([grandMA3 Phasers](https://help.malighting.com/grandMA3/2.3/HTML/phaser.html)).
  - Avolites: Speed and Size masters ([Avolites manual](https://manual.avolites.com/docs/effects/shape-generator)).
- Audio reactivity in WLED: Ripple Peak spawns ripples on audio peaks, with a frequency-bin select and a minimum volume ([WLED effects](https://kno.wled.ge/features/effects/)).
- Fountains: a beat, volume and intensity listener drives levels of jet activity ([WaterShapes](https://watershapes.com/shall-we-dance/)). WET choreographs by hand to music. Bellagio adjusts for wind ([Wikipedia Bellagio](https://en.wikipedia.org/wiki/Fountains_of_Bellagio)).
- Solenoid valve timing: plunger motion takes tens of ms, and larger piston or pilot valves take low hundreds of ms to open. Coil inductance adds a few ms. The CETOP method defines response as reaching 90% of outlet pressure on opening and 10% on closing ([Tameson: solenoid valve response time](https://tameson.com/pages/solenoid-valve-response-time)). One patent cites 600–800 ms for a particular design ([USPTO 5161775](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5161775)).
- A blog claims fountain valves respond in under 25 ms with a 20 Hz control frame. This is a single, unverified source ([Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/plc-musical-water-fountain-valve-control-implementation)).
- Safe Rain sells underwater solenoid valves for interactive play fountains ([Safe Rain](https://saferain.com/en/blog/new-underwater-solenoid-valves-for-interactive-play-fountains/)). No timing figure was captured.

### Inferences
- Music-mapping recipe, synthesised from the console models above:
  - **speed**: the effect frequency is f = BPM/60 × rate, with rate in {1/4, 1/2, 1, 2}. Keep phase continuous when the tempo changes. This is grandMA3's Sync idea.
  - **hits/onsets**: trigger single-shot effects (MA "Single Shot"), such as shooter bursts, Starburst or Ripple-Peak style events.
  - **energy/RMS**: map to amplitude (the High value or Size master), meaning jet height or VFD speed.
  - **spectral bands**: map to groups. For example, bass to centre or large jets and highs to the outer ring.
  - **sections**: change form, phase spread or wings at section boundaries.
- Device-class limits to enforce. These are design rules derived from the cited timings. The ~1 s solenoid figure in the brief is a conservative choice, not something a source establishes.
  - **Solenoid on/off jets**: force Transition = 0 and quantise each step's on-time and off-time to at least t_min (configurable; 0.3–1 s is plausible for a visible column). Fire early by t_valve + t_rise, where water flight time to a height h is about sqrt(2h/g). That is about 1.4 s to rise 10 m and about 3.1 s to 48 m, ignoring drag. Cap chase steps at roughly 1/(2·t_min) Hz per jet.
  - **Proportional valves**: smooth forms (sin, ramp) are fine. Low-pass the output to the valve's slew rate.
  - **VFD pumps**: treat them as a slew-limited amplitude, with acceleration and deceleration ramps of seconds. Use them for the envelope and swell, not for beat-rate modulation. Waves faster than the ramp should run on valves instead.
  - **Moving nozzles**: cap angular velocity (deg/s) and acceleration. A sine sway of amplitude A at frequency f needs a peak speed of 2πfA. For example, ±30° at 0.5 Hz needs about 94°/s. If that exceeds the limit, lower A or f, or use a beat subdivision.

### Gaps
- No cited figures were found for VFD acceleration ramp times in fountain pumps, moving-nozzle deg/s ratings (Bellagio oarsmen, DMX swing nozzles), or a manufacturer-stated minimum solenoid on/off time. Datasheets from OASE (Varionaut), Safe Rain, Crystal Fountains or Chinese DMX swing-nozzle vendors would be needed.
- No primary source was found on how WET, OASE or Chinese controllers implement live beat-locking as opposed to pre-programming.
