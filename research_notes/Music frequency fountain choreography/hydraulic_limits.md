# Hydraulic and physical response limits for music-synchronised fountain choreography

Scope: how fast fountain water effects can follow music (actuator response, jet ballistics, pipe filling, water hammer, shooters), and how programmers compensate with lead time. Sources are mostly vendor pages and general engineering references. No primary datasheet from a fountain-specific "high-speed digital solenoid" maker, and no Depence/WinDMX manual section on "water delay", could be retrieved. Those gaps are flagged below.

## 1. Solenoid valve response times, water hammer, minimum pulse and switching frequency

### Takeaway
Small direct-acting solenoids switch in about 30 ms. Pilot-operated (servo-assisted) valves of DN15–DN50 open in 50–190 ms but can take 180–1300 ms to close, and closing gets slower as size grows. Fountain "water-graphics" valves are claimed at 2–25 ms. A choreography generator should store separate open and close latencies per valve class, and must not assume closing is as fast as opening.

### Cited Findings
- Response time is measured from coil energising until outlet pressure reaches 90% of its stable value (opening), and from de-energising until pressure falls to 10% (closing). The test uses air at 6 bar, 20 °C, and the method follows CETOP, so water figures can differ. — [Tameson: Solenoid valve response time](https://tameson.com/pages/solenoid-valve-response-time)
- "Small direct acting solenoid valves react much quicker than semi-direct or indirect acting valves." Direct-acting is about 30 ms; indirect (pilot) valves can reach 1000 ms or more. — [Tameson](https://tameson.com/pages/solenoid-valve-response-time)
- JP Fluid Control table, open/close in ms (as reproduced by Tameson):
  - 1/8"–1/4" direct-acting: 30/30.
  - 1/4"–1/2" semi-direct: 50/400.
  - 3/8"–1/2" indirect: 50/180, 70/300 and 80/300.
  - 3/4" (DN20): 70/220, 80/800 and 90/550.
  - 1" (DN25): 80/250 and 100/800.
  - 1-1/4" (DN32): 120/280 and 100/800.
  - 1-1/2" (DN40): 160/360 and 110/1100.
  - 2" (DN50): 190/540 and 120/1300.
  - For the larger sizes the source does not clearly assign each pair to a model.
  — [Tameson](https://tameson.com/pages/solenoid-valve-response-time)
- With AC coils the coil can energise at any point in the voltage cycle, which adds jitter to armature travel. Coil heating raises resistance and lengthens response. — [Tameson](https://tameson.com/pages/solenoid-valve-response-time); search summary of the same page
- A high-pressure, high-flow patent cites conventional large valve response "in the neighborhood of 600 to 800 milliseconds". — [US5161775](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5161775)
- Fountain-specific claims (vendor):
  - Watershow advertises its water-graphic valves as opening in 2–5 ms. — [Watershow 2G+96 Watergraphic](https://watershow.de/en/watergraphic/2g-96-watergraphic/)
  - A PLC tutorial for a water-curtain fountain specifies valves "< 25 ms (typical for 20+ Hz operation)", a 20 Hz frame rate (50 ms per line) and PLC scan time under 50 ms. This is a knowledge-base example, not a datasheet. — [Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/plc-musical-water-fountain-valve-control-implementation)
- A water-display patent notes that each valve assembly "requires up to 1/10 of second to form a water drop". — [US8556190 / US9199264, via search](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8556190)
- High-speed pneumatic (not water) solenoids such as the Matrix 850 series: under 5 ms open, under 2 ms close, 200 Hz maximum cycle. This is an upper bound on solenoid technology, not representative of DN25+ water valves. — [Bibus Matrix 850](https://bibus.my/products-solutions/pneumatics/valves/high-speed-valves/matrix-series-850)
- Water hammer:
  - Fast valve closure abruptly stops flow and creates a pressure spike that can damage pipes and valves.
  - Mitigations: larger pipe diameter, hammer arrestors, slower valves (electric ball valves respond in a few seconds), and good fixing.
  — [Tameson](https://tameson.com/pages/solenoid-valve-response-time)
- Joukowsky/critical closure time:
  - The critical closure time is t_c = 2L/a, with L the pipe length and a the pressure-wave speed.
  - A closure faster than t_c produces the full Joukowsky surge Δp = ρ·a·Δv.
  - A slower closure gives a lower surge (Michaud's formula).
  - For nonlinear valves such as butterflies, multiply the closure time by 4 or more.
  — [FIRGELLI surge calculator](https://www.firgelliauto.com/blogs/calculators/surge-analysis-water-hammer-calculator); [Eng-Tips thread](https://www.eng-tips.com/threads/water-hammer-formula.81043/post-301037); [LMNO Engineering](https://lmnoeng.com/WaterHammer/impulse.php)

### Inferences
- Default per-class latencies for a generator (opening = time until the jet starts to form; closing = time until flow stops):
  - Fountain high-speed or water-graphic valves: open 5–25 ms, close 5–25 ms (vendor claims).
  - Small direct-acting DN8–DN15: about 30/30 ms.
  - Pilot-operated DN15–DN25: about 50–100 ms open, 200–800 ms close.
  - Pilot-operated DN32–DN50: about 100–190 ms open, 300–1300 ms close.
  - Motorised ball valves: about 1–5 s, so they are unusable for beat-level effects.
- Pilot-operated valves need a minimum differential pressure to open fully (general knowledge, not retrieved here). In a gravity or low-pressure manifold they may open slowly or partially.
- Water hammer is a real constraint on fast valves. The wave speed a in water-filled steel pipe is typically about 1000–1400 m/s (general engineering knowledge, not sourced in this pass).
  - For a 20 m branch, t_c = 2·20/1200 ≈ 33 ms, so any valve closing in under about 33 ms behaves as an instantaneous closure.
  - The resulting surge is Δp ≈ 1000·1200·Δv. For a 2 m/s pipe velocity that is about 2.4 MPa (≈24 bar).
  - So high-speed valve banks need low pipe velocity (large headers), short branches, accumulators or arrestors. The generator should also avoid closing many large valves on the same pump in the same frame. Stagger closures by about 20–50 ms, or ramp the pump down first.
- Minimum pulse width and maximum switching rate:
  - A valve cannot produce a meaningful pulse shorter than roughly its open time plus close time.
  - That gives about 20–50 ms for water-graphic valves (20–25 Hz, consistent with the 20 Hz frame rate above) and about 60 ms for small direct-acting valves (about 8–15 Hz).
  - Large pilot valves are limited to about 0.3–1.5 s (under about 1–3 Hz). This last figure is derived, not vendor-stated.

### Gaps
- No datasheet was retrieved from Burkert, ASCO/Emerson or Danfoss stating water-service response times for DN15–DN80, or a manufacturer-stated maximum cycle rate (cycles/s) for musical-fountain use.
- No fountain-supplier datasheet (OASE, Safe-Rain, Fontana, Himalaya "digital solenoid") with explicit open/close ms values was obtained. The OASE Jumping Jet catalogue fetch failed.
- No published "recommended minimum on-time" for musical fountain solenoids was found. Solenoid duty-cycle and coil-heating limits for rapid pulsing are also undocumented here.

## 2. VFD-driven pump response (ramp times, height tracking, minimum frequency, wear)

### Takeaway
Fountain VFDs are typically set to accelerate and decelerate in about 1–5 s. A Chinese music-fountain inverter guide uses 5 s/5 s as a starting point, and general pump practice puts the upper accel bound at about 5–15 s. VFD height changes are therefore phrase-level (about 0.5–5 s) effects, not beat-level effects. The generator should rate-limit pump setpoint changes and should not chase individual beats with pumps.

### Cited Findings
- The FRECON music-fountain inverter solution lists Accel time 1 = 5 s and Decel time 1 = 5 s ("adjust according to the actual situation in the field"). The setpoint comes from PLC analog input AI1, with a speed range of 0–60 Hz. It claims PLC+VFD gives "rapid response" compared with relay or solenoid control, but gives no number. — [FRECON Music Fountain Solution](https://www.frecon-inverter.com/en-solution/352.html)
- General centrifugal pump practice:
  - About 15 s accel is "probably acceptable".
  - Some pump makers void the warranty if accel is longer than 5 s, because at low speed there is not enough head to move water.
  — [Mike Holt forum: VFD Accel and Decel Time](https://forums.mikeholt.com/threads/vfd-accel-and-decel-time.2552272/) (forum, moderate reliability)
- A vertical turbine example used about 10 s accel and is explicitly application-specific. The maximum allowable accel time should come from the pump and motor suppliers. — [Industrial Monitor Direct: Vertical Turbine Pump VFD](https://industrialmonitordirect.com/blogs/knowledgebase/vertical-turbine-pump-vfd-selecting-and-configuring)
- A Schneider ATV212 default accel/decel of 30 s is a factory default, not a recommendation. — [Scribd: Programming ATV212](https://www.scribd.com/document/825211515/Programming-ATV212)
- A fountain-control patent describes VFD-like "gentle to rapid ramping between two flow rates", "short to long constant flows" and flow "spikes". — [US6717383B1](https://patents.google.com/patent/US6717383)
- The Fontana VPA Series integrates the VFD in the pump, has a "fast-response motor" for "bursts, explosions", is controlled over DMX/RDM, and is a small 200 W/24 V DC unit with 10 m maximum head. — [Fontana Fountains VPA](https://fontanafountains.com/products/spray-systems/special-water-effects/programmable-fountain-kit-with-dmx-pump-vpa-series/)
- One Depence project calibrated simulated heights and motor speeds against site videos, which implies real pump and drive dynamics are tuned per site. — [Syncronorm: Van Phuc City Fountain](https://www.syncronorm.com/newsitem/van-phuc-city-fountain-created-with-depence-r3)

### Inferences
- Pump affinity laws (standard): head ∝ n² and jet height ≈ head (ideal), so height ∝ f². At 50% frequency the head is only 25%.
  - Below roughly 30–40% speed a centrifugal pump may not overcome static and nozzle head and the jet collapses.
  - The generator should therefore enforce a per-pump minimum frequency (a "jet just visible" floor, commonly about 15–25 Hz on 50 Hz motors).
  - The floor figure is practitioner convention and needs site calibration. It is not sourced.
- Effective height-tracking lag is drive ramp + hydraulic inertia + jet flight time. With a 1–2 s ramp, a pump cannot follow 120 BPM beats (0.5 s), and realistic pump "pulses" come at about 1 per 2–4 s.
- Small DC/BLDC DMX pumps (Fontana VPA class, under about 10 m) are faster than large AC pump + VFD sets, so treat them as a separate actuator class with shorter ramps.
- Wear considerations:
  - Short ramps raise motor current and mechanical stress.
  - Rapid decel can trip the drive on DC-bus overvoltage unless braking is fitted.
  - Frequent large swings cause surge in pipes.
  - These are general VFD knowledge and are not sourced here.

### Gaps
- No Danfoss, ABB or Siemens fountain-specific application note giving accel/decel values was retrieved.
- No measured "jet height vs time" step response for a VFD pump was found.
- No source stated a minimum frequency for fountain pumps.

## 3. Motorised/proportional valves and servo swing (1D/2D/3D) nozzles

### Takeaway
DMX 2D swing drives published by OASE top out at 60–72 °/s, so a full 90° sweep takes about 1.25–1.5 s. Swing effects can follow phrase or bar structure, but not individual fast beats over large angles.

### Cited Findings
- OASE Multi Directional Drive S 2D /DMX/02: maximum swing speed 72 °/s, range 90° per axis. — [OASE MDD S 2D](https://www.oase.com/pl-PL/fountain-technology/multi-directional-drive-s-2d-dmx02)
- OASE MDD L 2D /DMX/02: maximum swing speed 72 °/s, factory range 140/140°, adjustable to 200/140°. It uses 8 DMX channels with a speed channel per axis. — [OASE MDD L 2D](https://www.oase.com/en-AU/fountain-technology/multi-directional-drive-l-2d-dmx02)
- OASE MDD XL 2D /DMX/02: maximum swing speed 60 °/s. — [OASE MDD XL 2D](https://dev.oase.com/nl-NL/fountain-technology/multi-directional-drive-xl-2d-dmx02)
- OASE Swivel L /DMX/02 (1D): 180° factory range and a DMX speed channel. No °/s figure is published. — [OASE Swivel L](https://www.oase.com/hu-HU/fountain-technology/swivel-l-dmx02)
- Grand Haven Musical Fountain produces about five discrete height "levels" by opening valves by different amounts (proportional or partial valve opening). — [Wikipedia: Grand Haven Musical Fountain](https://en.wikipedia.org/wiki/Grand_Haven_Musical_Fountain)
- Electric (motorised) ball valves respond "in a few seconds". — [Tameson](https://tameson.com/pages/solenoid-valve-response-time)

### Inferences
- Time to reach a target angle is t = Δθ / ω_max plus acceleration overhead. At 72 °/s:
  - ±15° wiggle ≈ 0.42 s, roughly 1 beat at 140 BPM.
  - 45° ≈ 0.63 s.
  - 90° ≈ 1.25 s.
  - 180° ≈ 2.5 s.
- A generator should cap per-beat swing amplitude at about ω_max × beat_period × 0.8. At 120 BPM that is about 29° per beat.
- The water at the jet tip lags the nozzle angle by its flight time (section 4). A fast swing produces a curved "whip", so the visual position at apex trails the nozzle by t_flight.
- Motorised proportional valves (seconds) are scene-level only.

### Gaps
- No 3D or other-vendor (Safe-Rain, Crystal Fountains, Himalaya) swing nozzle °/s specs were found.
- No data was found on servo acceleration limits, DMX-to-speed mapping, or the response of fast proportional or servo valves used for height modulation.

## 4. Jet ballistics: rise, fall, total visual cycle, and what can pulse on a beat

### Takeaway
In the ideal case (no drag), a vertical jet of height h needs exit speed v = √(2gh). The first water reaches the apex after t_up = √(2h/g) and falls back after about another t_up. Real jets need more pressure and the leading front is slower, so these are lower bounds on delay. Only jets under about 1.2 m can rise within one 120 BPM beat. A full up-and-down cycle within one beat needs h ≤ about 0.3 m.

### Cited Findings
- Torricelli: ideal fountain height h = v²/2g, ignoring friction with air. For example, v₀ = 10 m/s gives about 5.1 m. — [arXiv 0801.4160](https://arxiv.org/pdf/0801.4160); [Physics Arena](https://physics-arena.duckdns.org/problems/243)
- Air drag on a jet can be modelled as a Darcy-type head loss. In the paper's example the loss is small. — [arXiv 0801.4160](https://arxiv.org/pdf/0801.4160)
- Hutton (historical): air resistance is about ∝ v², so the height deficit grows with jet height. — [Hutton's Dictionary, "jet d'eau"](https://words.fromoldbooks.org/Hutton-Mathematical-and-Philosophical-Dictionary/h/jet-d-eau.html)
- A fire-stream "effective height" formula exists, of the form H_e ≈ (2/3)(H − 0.113H²/d). The text was garbled in the source and must be verified before use. — [Brainscape flashcards](https://brainscape.com/flashcards/theoretical-and-effective-height-of-a-je-1248037/packs/2377490) (low reliability)
- An open-source fountain show scheduler (5d-fountain-song-show):
  - A 10 m jet has 14 m/s exit speed and takes 1.43 s to reach apex. That is 4.1 beats at 174 BPM.
  - It fires tall centre jets "over two seconds earlier" than the cue.
  - Tall nozzles mark phrase structure and short ones mark the pulse.
  - It targets roughly one cue every ~1/3 s.
  - It self-reports 0.00 ms mean apex error on synthetic data (unverified).
  — [GitHub: Yoo-yipeee/5d-fountain-song-show](https://github.com/Yoo-yipeee/5d-fountain-song-show)

### Inferences (computed from t_up = √(2h/g), g = 9.81 m/s²; ideal, no drag, no valve or pipe delay)

| Jet height h | Exit speed √(2gh) | t_up (to apex) | Up + down (≈2·t_up) | Beats at 120 BPM (rise) |
|---|---|---|---|---|
| 0.3 m | 2.4 m/s | 0.25 s | 0.49 s | 0.5 |
| 0.5 m | 3.1 m/s | 0.32 s | 0.64 s | 0.64 |
| 1 m | 4.4 m/s | 0.45 s | 0.90 s | 0.9 |
| 1.23 m | 4.9 m/s | 0.50 s | 1.00 s | 1.0 |
| 2 m | 6.3 m/s | 0.64 s | 1.28 s | 1.3 |
| 3 m | 7.7 m/s | 0.78 s | 1.56 s | 1.6 |
| 5 m | 9.9 m/s | 1.01 s | 2.02 s | 2.0 |
| 10 m | 14.0 m/s | 1.43 s | 2.86 s | 2.9 |
| 20 m | 19.8 m/s | 2.02 s | 4.04 s | 4.0 |
| 30 m | 24.3 m/s | 2.47 s | 4.95 s | 4.9 |
| 50 m | 31.3 m/s | 3.19 s | 6.39 s | 6.4 |
| 100 m | 44.3 m/s | 4.52 s | 9.03 s | 9.0 |

- Constraints for beat-period T:
  - Rise within one beat requires h ≤ g·T²/2. For T = 0.5 s (120 BPM) that is h ≤ 1.23 m.
  - Full rise and fall within one beat (so separate pulses read as distinct) requires h ≤ g·T²/8. For T = 0.5 s that is h ≤ 0.31 m.
  - At 2T (pulse every 2 beats, 1.0 s) the limits are h ≤ 4.9 m (rise) and h ≤ 1.23 m (full cycle).
- Taller jets can still be fired every beat as overlapping "packets" (jumping-jet style), since valve pulse rate is independent of flight time. But a packet's apex arrives t_up after firing, and it can only look distinct if the valve is fully closed between pulses: pulse period ≥ t_open + t_close + minimum visible gap.
- The bottom of a jet persists after valve close. The column takes about t_up to drain from the nozzle to the apex and about 2·t_up to finish falling, so a "cut" on the beat is visually smeared by up to 2·t_up.
- Real jets need more pressure than ideal and the leading front is retarded by air drag and break-up. Budget t_up,real ≈ 1.1–1.3 × t_up,ideal for tall jets. This factor is a heuristic and must be calibrated, ideally from video, as Syncronorm did at Van Phuc.

### Gaps
- No peer-reviewed measurement of the jet-front rise time of a starting jet vs. steady-state height was found. Nor was a validated drag-corrected formula with nozzle diameter dependence.

## 5. Pipe filling / water-column delay and air in lines

### Takeaway
No fountain-specific source quantified fill delay. From first principles, an empty branch adds t_fill ≈ V_branch / Q before the jet appears, often hundreds of ms to seconds. Air pockets add compressibility (spongy, delayed, sputtering starts). Branches should stay primed (non-draining, check valves, valve close to the nozzle) for beat-accurate effects.

### Cited Findings
- Water-level stability matters for consistent shots: OASE says that "for a long-term stable operation, it is important to keep the water level constant" (AirNozzle). — [OASE AirNozzle family](https://www.oase-professional.com/en/family/f/airnozzle.1001037299.html)
- No source in this pass gave numeric pipe-fill delays for fountains.

### Inferences
- t_fill = A·L_empty / Q = (π d²/4)·L_empty / Q. Example: an empty 5 m length of DN50 (≈9.8 L) at 5 L/s takes about 2 s before full-pressure flow. An empty 1 m of DN25 (≈0.5 L) at 1 L/s takes about 0.5 s.
- Even with primed pipes, accelerating the water column takes time. The rigid-column time constant is about L·v/(g·H): for 20 m of pipe at 2 m/s with 10 m head, about 0.4 s. This is a standard rigid-column estimate, not sourced here. So long pipe runs between valve and nozzle add hundreds of ms beyond the solenoid's electrical response.
- Design rule for the generator: per-channel latency = valve open time + column-acceleration time + (fill time if the branch drains) + jet flight time to the target height. Calibrate on site with a high-frame-rate video of a valve trigger next to a visible or audible marker.

### Gaps
- No measured data from fountain installations on fill delay, priming practice, or air-release valve placement was found.

## 6. Industry practice for audio-to-water latency compensation (lead time / pre-delay)

### Takeaway
Pre-programmed (timecoded) shows compensate by firing early, by roughly flight time + actuator latency, which is about 0.3 s for small jets and 1.5–3 s for 10–30 m jets. Live audio-reactive systems cannot compensate this way. No vendor manual was found that documents a per-channel "water delay" parameter (Depence, WinDMX, WET, Crystal Fountains), so that remains unconfirmed.

### Cited Findings
- 5d-fountain-song-show reads the whole track first and "fires water EARLY so it arrives on time". Tall centre jets fire "over two seconds earlier" than their musical cue. — [GitHub](https://github.com/Yoo-yipeee/5d-fountain-song-show)
- Syncronorm Depence:
  - Its "advanced physics engine … calculates the hydrodynamic behavior of fountains in real-time", and "dependencies" link nozzles, valves and pumps for the hydrodynamic calculation.
  - The page does not mention a delay or offset parameter.
  - Pangolin says real-equipment physical characteristics are simulated in real time.
  — [Syncronorm Depence fountains](https://syncronorm.com/products/depence2/visualization/fountains); [Pangolin Depence Fountain Module](https://pangolin.com/products/depence-fountain-module)
- OASE WEPS (for the WECS III controller) plays shows "synchronously to the music … accurately to the second" with up to 1024 DMX channels. Depence is offered for larger shows. — [OASE WEPS](https://www.oase.com/en-US/fountain-technology/weps-software)
- A university prototype fountain reacts to the real-time audio signal, so it cannot use look-ahead. — [Search result: Najah University repository](https://repository.najah.edu/bitstreams/a0251789-b6bf-40c9-84e2-6d939e9f2d1f/download)

### Inferences
- Recommended lead (pre-roll) per cue for a generator, so that the water peak lands on the beat:
  - lead = t_valve_open + t_column (+ t_fill if draining) + t_up(h)·k_drag, with k_drag ≈ 1.1–1.3.
  - For VFD cues, add part of the ramp time.
  - Example lead values:

    | Effect | Lead |
    |---|---|
    | Water-graphic valve, 0.5 m jet | 0.03 + 0.32 ≈ 0.35 s |
    | DN25 pilot valve, 3 m jet | 0.08 + 0.1 + 0.78×1.2 ≈ 1.1 s |
    | 10 m jet | ≈ 1.8–2.0 s |
    | 30 m jet | ≈ 3 s |
    | VFD swell to a peak | lead ≈ ramp time to target + t_up |
- Valve closes also need lead: valve close latency (often longer than open for pilot valves) plus the visual drain time.
- The "0.3–1.0 s pre-fire" range in the brief is consistent with small and medium jets (under about 3 m). Taller effects need 1.5–3+ s.
- For live or real-time music input, either delay the audio by the maximum lead (a common AV approach, not sourced here) or accept late water.
- Store latency per channel (actuator class + height), not one global offset.

### Gaps
- The Depence manual (help.depence.com), WinDMX, WET and Crystal Fountains documentation on "water delay"/"pre-delay" could not be retrieved or found. Whether these tools expose explicit per-channel delay fields is unconfirmed.

## 7. Shooters / pneumatic water cannons

### Takeaway
Air-driven shooters fire as single shots with refill/recharge times of about 4–25 s, scaling with height. Vendor data puts the rate at about 2–6 shots per minute. They are accent or "hit" effects for downbeats, drops and climaxes and need multi-second planning, so the generator must enforce a per-unit cooldown.

### Cited Findings
- OASE AirNozzle range 6–70 m (vendor specs):
  - 6 m vertical: refill 4 s at ≤1 bar.
  - 14 m: 4 s at 2 bar.
  - 20 m horizontal: 10 s, 10 L per shot, 24 mm orifice, ≤5 bar.
  - 30 m: 6 s at 6 bar.
  - 50 m: 25 s at 11 bar.
  - "two to six fountain shots per minute, depending on the product variant".
  — [OASE AirNozzle 24 E-20 m horizontal](https://www.oase.com/en/fountain-technology/airnozzle-24-e-20-m-horizontal-01-int); [OASE AirNozzle family](https://www.oase-professional.com/en/family/f/airnozzle.1001037299.html)
- Chinese supplier air-explosion nozzle: 20 m, 6 s refill, 10 L per shot, ≤8 bar (vendor claim). — [chinamusicfountain.com](https://chinamusicfountain.com/portfolio/air-explosion-water-fountain-nozzle/)
- Crystal Fountains Titan TNN air-driven nozzle: 10–100 ft shot height, 5 s recharge, water-level dependent (vendor claim). — [Crystal Fountains TNN](https://crystalfountains.com/product/titan-tnn-series/)
- At Bellagio, pneumatic shooter height is set by air pressure (Proportion-Air regulators). — [Proportion-Air blog](https://proportionair.com/blog/proportion-air-power-fountains-of-bellagio/)

### Inferences
- Shooter lead = air valve open latency + barrel expulsion time + t_up(h). For a 50 m shot the ballistic part alone is about 3.2 s, so lead is about 3.5 s. For 20 m it is about 2.2–2.5 s.
- Cooldown constraint: next_fire ≥ last_fire + refill_time. At 120 BPM a 10 s refill means at most one shot per 20 beats (5 bars) per unit. Use several units in rotation for denser accents.

### Gaps
- No vendor-stated firing delay (trigger to water exit) was found for any shooter.
- Air-receiver recharge time (compressor capacity), as distinct from water refill, is not documented in the retrieved sources.
