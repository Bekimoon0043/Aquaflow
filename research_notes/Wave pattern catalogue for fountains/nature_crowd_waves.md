# Waves in nature and in crowds as models for fountain choreography

Scope: natural and crowd waves (ocean swell, chop, surf, tidal bore, tsunami, ripples, Kelvin wake, seiche, rain, the stadium wave, murmuration, honami, ECG, aurora, fireworks, flame flicker). For each one: measured numbers, a simple model that can set jet heights h(i,t) for a row, ring or grid, what makes it recognisable, and which musical moments it suits.

Notation used in the models: jets at positions x_i (row), angle θ_i (ring) or (x_i, y_i) (grid). H_max is the jet's maximum height and h_i(t) ∈ [0, H_max] is the commanded height. A "time-scale factor" s maps real periods (often minutes) to show periods (seconds). Fountain hardware has its own rise-time lag (often 0.3–1 s for VFD pumps), so effects faster than about 2–3 Hz will not show up in the water.

## Key Question 1: Measured shape and motion numbers, and the simplest models that reproduce the look

### Takeaway
Most of these waves can be built from four kinds of model. (1) A travelling sinusoid or Gerstner wave with the correct crest/trough asymmetry, a speed, and dispersion (swell, chop, ripples, wake, tsunami). (2) A standing wave, sin(kx)·cos(ωt) (seiche). (3) A step front followed by decaying undulations (bore, plunging surf). (4) An excitable-medium cellular automaton with three states: resting, active, refractory (stadium wave, murmuration agitation wave, rain rings, fireworks). Real speeds and periods must be time-scaled to the basin. What lets an audience recognise each wave is mostly its asymmetry (sharp crests, a steep front), its grouping (sets, whelps), its direction and its start/end behaviour, not exact physical values.

### Cited Findings

**Ocean swell (trochoidal / Gerstner wave)**
- Gerstner wave in parametric (Lagrangian) form: X = a + (e^{kb}/k)·sin(k(a+ct)), Y = b − (e^{kb}/k)·cos(k(a+ct)). Each parcel moves in a circle. The free surface is an inverted trochoid with "sharper crests and flat troughs". — [Wikipedia: Trochoidal wave](https://en.wikipedia.org/wiki/Trochoidal_wave)
- Deep-water dispersion: c² = g/k, so c = √(gλ/2π) and T = √(2πλ/g). For λ = 100 m, c ≈ 12.5 m/s and T ≈ 8.0 s. The limiting wave (b_s = 0) has a cusped crest with height H = λ/π, i.e. steepness ≈ 0.318 (derived from the article's height formula). — [Wikipedia: Trochoidal wave](https://en.wikipedia.org/wiki/Trochoidal_wave)
- In deep-water gravity waves, group velocity is half the phase velocity. Individual crests appear at the back of a group, grow, and vanish at the front. This is the physical basis of swell "sets". — [Wikipedia: Capillary wave](https://en.wikipedia.org/wiki/Capillary_wave)

**Wind waves / chop (spectral superposition)**
- JONSWAP = the Pierson–Moskowitz spectrum multiplied by a peak-enhancement factor γ = 3.3 (σ = 0.07 below the peak, 0.09 above). γ = 1 recovers Pierson–Moskowitz. One parameterisation: ω_p = 22·(g²/(U₁₀F))^{1/3} and α = 0.076·(U₁₀²/(gF))^{0.22}. — [ffpack wave spectra docs](https://ffpack.readthedocs.io/en/latest/moduleCookbook/lsmWaveSpectra.html); [codecogs JONSWAP](https://codecogs.com/library/engineering/fluid_mechanics/waves/spectra/jonswap.php)
- Sources use different, non-interchangeable peak-frequency coefficients (22 in angular form vs 3.5 in a Hz form). — [ffpack](https://ffpack.readthedocs.io/en/latest/moduleCookbook/lsmWaveSpectra.html) vs [Trieste JonSwap.m](https://moodle2.units.it/pluginfile.php/816322/mod_resource/content/2/JonSwap.m)
- Ordinary wind waves have wavelengths of about 100 m. — [Wikipedia: Tsunami](https://en.wikipedia.org/wiki/Tsunami)

**Breaking surf / plunging wave**
- There are four breaker types. Spilling: gradual slopes, whitewater spills down the face, long-lasting. Plunging: steep slopes or reefs, the crest goes vertical, curls over and "drops onto the trough", releasing its energy at once. Collapsing: the lower face steepens and collapses. Surging: long-period, low-steepness waves that run up the beach with little foam. The Iribarren number classifies them, but the article gives no thresholds. — [Wikipedia: Breaking wave](https://en.wikipedia.org/wiki/Breaking_wave)
- Plunging sequence: the crest steepens and goes vertical, then overturns, then the jet collapses into a horizontal vortex with secondary eddies, then the flow becomes 3-D and turbulent. — [Wikipedia: Breaking wave](https://en.wikipedia.org/wiki/Breaking_wave)

**Tidal bore**
- Qiantang: up to 9 m high and up to 40 km/h (≈11 m/s), the world's largest. Severn: up to 2 m. Pororoca (Amazon): up to 4 m at 21 km/h. Turnagain Arm: 2 m at 20 km/h. Bono (Kampar): about 6 m. Mersey: 1.7 m. Trent Aegir: 1.5 m. — [Wikipedia: Tidal bore](https://en.wikipedia.org/wiki/Tidal_bore)
- There are two forms. A breaking bore is a single front with a roller. An undular bore is a smooth front followed by secondary waves ("whelps"). Bores occur only on the flood tide, where the tidal range typically exceeds 6 m. No Froude thresholds or whelp counts are given there. — [Wikipedia: Tidal bore](https://en.wikipedia.org/wiki/Tidal_bore)

**Tsunami**
- Deep ocean: speed well over 800 km/h, wavelength up to 200 km, amplitude about 1 m (often about 0.3 m offshore), and a period of 20–30 min per cycle in deep water. A damaging tsunami typically has a period of about 12 min. — [Wikipedia: Tsunami](https://en.wikipedia.org/wiki/Tsunami)
- c = √(gh). At 5,000 m depth that is about 224 m/s (806 km/h). In the shallows the speed drops below 80 km/h and the wavelength below 20 km, while the amplitude grows greatly. Drawback (the sea receding) can exceed hundreds of metres. In the 12-min example the sea recedes for about 3 min before the flooding ridge arrives about 6 min later. — [Wikipedia: Tsunami](https://en.wikipedia.org/wiki/Tsunami)

**Ripples from a dropped stone (gravity–capillary)**
- ω² = gk + (σ/ρ)k³. The minimum phase speed is about 0.23 m/s at λ ≈ 1.7 cm. Shorter waves are capillary-dominated, longer ones gravity-dominated. — [Wikipedia: Capillary wave](https://en.wikipedia.org/wiki/Capillary_wave)
- In the capillary regime the phase speed is 2/3 of the group speed, so crests appear at the front of a group and vanish at the back. In the gravity regime it is the reverse. Droplet impacts generate capillary waves. — [Wikipedia: Capillary wave](https://en.wikipedia.org/wiki/Capillary_wave)

**Kelvin wake**
- Each arm sits at arcsin(1/3) = 19.47° from the track, so the full V is about 39°, independent of speed. The wavelets inside the arms are at about 53° to the path. Transverse waves fill the V as curved arcs. At high Froude number a narrower V dominates. Shock angle θ = arcsin(c/v), deep water ω = √(gk), Fr = U/√(gL). — [Wikipedia: Kelvin wake pattern](https://en.wikipedia.org/wiki/Kelvin_wake_pattern)

**Seiche (standing wave)**
- Merian: T = 2L/√(gh) for an enclosed basin, e.g. 5 km long and 10 m deep gives about 1,000 s. Harmonics have T/2, T/3 and so on. Nodes have no vertical motion. — [Wikipedia: Seiche](https://en.wikipedia.org/wiki/Seiche)
- Examples: Lake Geneva about 73 min longitudinal and 10 min transverse. Lake Wakatipu 27 min with about 20 cm amplitude. Small harbours a few minutes and a few cm. — [Wikipedia: Seiche](https://en.wikipedia.org/wiki/Seiche)

**Stadium "Mexican" wave (La Ola)**
- Farkas, Helbing & Vicsek (Nature 419, 131, 2002) analysed waves from video and modelled them with "variants of models originally developed for the description of excitable media". — [arXiv cond-mat/0210073](https://arxiv.org/abs/cond-mat/0210073)
- Wikipedia's summary of the study: 14 waves in large Mexican stadiums, triggered by "a few dozen" fans, speed about 12 m/s (≈22 seats/s), about 15 seats wide, usually clockwise. — [Wikipedia: Wave (audience)](https://en.wikipedia.org/wiki/Wave_(audience))
- Conflict: the brief cites about 20 seats/s, a width of 6–12 m and about 25 people to trigger (consistent with the paper's abstract as commonly quoted). Wikipedia gives 22 seats/s and 15 seats. I could not read the PDF text (it is compressed) to confirm the exact wording. — [arXiv PDF](https://arxiv.org/pdf/cond-mat/0210073)

**Bird murmuration / agitation waves**
- In starling flocks under falcon attack (Rome; Procaccini et al. 2011), agitation waves average about 13.4 m/s, faster than the flock's own speed of about 10.6 m/s and close to the predator's speed. — [BirdGuides summary](https://www.birdguides.com/articles/waves-of-starlings/); [Hemelrijk et al. 2015, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4564680)
- The StarDisplay model (Hemelrijk) reproduces the waves through changes in orientation (rolling or banking), not density. Copying only 2–7 nearest neighbours is enough to give the empirical wave speed. Speed rises with the number and distance of neighbours copied, falls with reaction time, and is independent of flock size. — [Hemelrijk et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4564680)
- A 2019 follow-up analysed 16 wave events containing 44 pulses. — [Behav Ecol Sociobiol 2019](https://link.springer.com/10.1007/s00265-019-2734-4)

**Wheat / grass field waves (honami)**
- Honami propagate downstream across the canopy top. A gust sweeps down and bends a patch of stalks. Their phase speed tracks the convection speed of large eddies and has been reported to be significantly higher than the mean wind at canopy height. Plant stiffness helps select the frequency and wavelength. — [APS DFD 2023 abstract](https://meetings-archive.aps.org/dfd/2023/zc43/1); [Dupont et al. 2010, HAL](https://hal.archives-ouvertes.fr/hal-01020671)
- Whether coherent eddies "lock onto" the canopy waving frequency is disputed: a linear stability analysis says yes, the large-eddy simulation (LES) of Dupont et al. 2010 says no. — [Dupont et al. 2010](https://hal.archives-ouvertes.fr/hal-01020671); [Finnigan JFM commentary](https://resolve.cambridge.org/core/journals/journal-of-fluid-mechanics/article/waving-plants-and-turbulent-eddies/833E9687F35823F2862DD2C5F3408E89)

**Aurora**
- Pulsating aurora: quasi-periodic rise and fall over 2–20 s, patch size 10–200 km. The main pulsation runs from a few to a few tens of seconds. Observed patch periods include 4 s and 7 s. — [arXiv 2209.14545 review](https://arxiv.org/pdf/2209.14545); [JpGU 2012](https://www2.jpgu.org/meeting/2012/session/PDF/P-EM30/PEM30-09_e.pdf)
- Patch drift speeds vary from about 76 m/s to several km/s depending on the study and altitude mapping. — [Frontiers 2025](https://www.frontiersin.org/journals/astronomy-and-space-sciences/articles/10.3389/fspas.2025.1561439/full)

**Fireworks**
- Peony: a spherical break of stars with no tails. Chrysanthemum: like a peony but with glowing trails. Willow: glittering branches that must hang for at least 10 s. Palm: a thick rising tail (the "trunk"). Shell size sets the height and burst diameter. Professional shells burst at roughly 600–1,200 ft. — [fireworks.com glossary](https://fireworks.com/safety/glossary); [Red Apple Fireworks](https://www.redapplefireworks.com/blogs/we-love-fireworks/how-high-do-fireworks-go); [Montreal fireworks glossary](https://montreal-fireworks.com/pyro_glossary.html)

**Flames / flicker**
- Buoyant diffusion flames "puff" at about 10 Hz. A single candle can burn steadily, while 3 or more merged candles oscillate at about 10 Hz. Puffing frequency scales roughly as f ∝ D^(−1/2) with burner diameter, caused by periodic shedding of toroidal vortices. — [arXiv 2112.07240](https://arxiv.org/pdf/2112.07240); [Xia & Zhang, PolyU](https://ira.lib.polyu.edu.hk/bitstream/10397/106470/1/Xia_Vortex-Dynamical_Scaling_Theory.pdf); [PolyU news 2018](https://www.polyu.edu.hk/me/News-and-Events/News/2018/ME-researchers-unveiled-the-secret-of-the-flicking-of-diffusion-flames)

### Inferences
Below are proposed fountain models. They are my own engineering constructs, built on the cited physics. u ∈ [0,1] is a normalised height and h = H_base + u·(H_max − H_base).

1. **Ocean swell.** Use a Gerstner profile so the crests are sharp and the troughs flat. Phase φ_i = k·x_i − ωt. Solve the trochoid parametrically, or approximate it with u = ((1 + cos φ)/2)^p, where p ≈ 1.5–2.5 sharpens the crests. Add a "set" envelope by multiplying by a slow group envelope A(t,x) = 0.5·(1 + cos(Δk·x − Δω·t)) with Δω ≈ ω/7, which gives about 7 waves per set. Because group speed is c/2 in deep water, individual crests should visibly rise at the back of a set and fade at the front. Show tempo: period 4–10 s (time-scaled from 8–15 s swell), 1–2 crests visible across the row. Recognisable by slow, majestic, sharp-crested regular rollers that arrive in sets.
2. **Chop.** u = Σ_n a_n·cos(k_n·x − ω_n·t + ψ_n) with 8–16 components. Draw ω_n from a JONSWAP shape (peak ω_p, γ = 3.3, falling as ω^−5), set k_n = ω_n²/g (or a scaled equivalent), and give each component a random direction within ±30–45° for grids. Take a_n ∝ √(S(ω_n)Δω) and normalise to [0,1]. This is Tessendorf's method in miniature (Tessendorf's paper itself was not fetched). Recognisable by busy, irregular peaks with no single period. Raising γ makes it more swell-like and regular.
3. **Plunging surf.** Treat it as an event, not a loop. A travelling front at position X(t) = v·t. Ahead of the front, a smooth rise (an exp or cos² ramp over 2–4 jets). At the "break line" x_b, jets near the front spike (overshoot to H_max for about 0.3 s) and then drop rapidly to a low, noisy "whitewater" level (random 0.2–0.4 with fast jitter) that decays over 1–3 s. Spilling surf is the same without the spike and with a longer noisy tail. Recognisable by the build, then an abrupt crash, then a foamy decay.
4. **Tidal bore.** A single step front moving at v. Behind it, u = u_0 + A·e^{−(X−x)/L_d}·cos(k(X−x)), giving about 3–6 whelps that decay. A breaking bore drops the undulations and adds jitter at the front. Real numbers to suggest the scale: Severn about 2 m, Qiantang up to 9 m at about 11 m/s. One-way travel only; the water level behind the front stays raised. Recognisable by a single steep wall that keeps going and leaves a raised plateau behind it.
5. **Tsunami.** Start with a drawback: lower all jets along the approach direction below baseline (u → 0) for about 25% of the event. Then send a very long, low hump (wavelength longer than the row, so all jets rise almost together) whose amplitude grows as it reaches the "shore" end. Green's law (A ∝ h^−1/4) gives a ramp; I did not verify Green's law in a source. Finish with a slow recession. Recognisable by an ominous draw-down, then a rising wall with no visible crest spacing. This needs care on fountains because it is a dramatic, slow effect.
6. **Stone ripples.** Concentric rings from a source point r_0: u(r,t) = A·cos(k·(r − c·t))·window(r − c_g·t)/√r. Capillary rings (phase speed = 2/3 of group speed) create new crests at the outside edge of the ring packet. Practically: a ring packet of 3–5 crests expanding outward, crests fading toward the centre, and amplitude falling as 1/√r. Recognisable by expanding concentric rings from a point that thin out as they spread. This works on ring and grid layouts and on a row (as a two-sided outward pulse).
7. **Kelvin wake.** A moving "boat" point P(t) travels along a line of a grid (or a ring with the boat at the centre). Jets light up when the angle between (x − P) and the track direction is within about 19.5° ± 3° behind the boat, with a cos-spaced chevron of feathered arms (wavelets at 53°). Optional transverse arcs inside the V. Recognisable by a V trailing a moving point, with its angle fixed regardless of speed, which suits a "jet chasing" spotlight.
8. **Seiche (standing wave).** u = 0.5 + 0.5·sin(nπx/L)·cos(ωt), with mode n = 1 (see-saw, one node), 2 or 3. Nodes stay still. For a ring, use cos(mθ)·cos(ωt). Recognisable by a "sloshing" see-saw with stationary pivot points. It is easy to beat-lock: mode n at the beat, n+1 on accents.
9. **Rain on water.** A Poisson process of impact events at random grid positions with rate λ (scaled with intensity). Each impact gives a short spike plus a quick ring (as in item 6) with a 0.3–1 s lifetime, superposed with max() or a clipped sum. Recognisable by random, non-repeating pinpricks with tiny rings. Density maps naturally to hi-hat or shaker density.
10. **Stadium wave.** Use an excitable cellular automaton. States: resting (u = base), active (rise to peak and fall over T_active), refractory (cannot re-fire for T_ref). A jet fires when the weighted sum of active neighbours within radius R, biased toward one side to get the clockwise preference, exceeds a threshold. Seed with about 25 people's worth of simultaneous jets (scale it as a fraction of the row, e.g. 3–5 jets). Fan numbers: 12 m/s and about 15 seats wide, so a seat's stand-and-sit takes roughly 15/20 ≈ 0.7 s; use that time ratio, not the absolute speed. Design rule: width of about 10–20% of the ring's circumference, and one lap per 2–8 s depending on tempo. Refractory time must be longer than the active time so the wave travels one way. Recognisable by a single smooth pulse with a fixed width running round the ring, starting from a small "trigger" cluster, sometimes dying out or circling for several laps.
11. **Murmuration / agitation wave.** Over a grid, an orientation wave modelled as a travelling pulse whose front is shaped by nearest-neighbour copying (2–7 neighbours) with a reaction delay τ, so wave speed ≈ neighbour distance / τ. Represent it as a dark band (a height dip) or as a phase shift in a slowly drifting jet-height noise field. Add slow, fluid deformation of the overall "flock" outline with low-frequency curl noise. Recognisable by a dark ripple flashing through an otherwise cohesive, morphing mass, faster than the mass itself moves.
12. **Honami (wind over wheat).** u = base − D·G(x − v_g·t), where G is a gust patch (a 2-D Gaussian blob, randomly sized) moving downwind faster than the mean "wind". Each jet then springs back as a damped oscillator (its stiffness sets the natural sway frequency). Spawn gust patches randomly. Recognisable by soft bright/dark patches gliding in one direction over a uniform field, with a springy recovery.
13. **Heartbeat (ECG).** A per-beat template: small P bump, sharp tall QRS spike, broader T bump, then flat until the next beat. Lock it to tempo (lub-dub at 60–120 BPM). Rendering as a "trace" moving along a row (the ECG monitor sweep) makes it instantly readable. A flatline (all jets at minimum) followed by a restart is a strong dramatic device. (ECG timing numbers were not sourced; see Gaps.)
14. **Aurora curtains.** On a row or arc: a slowly moving smooth noise field (1-D Perlin/Simplex) for the curtain folds, plus a separate pulsation multiplier of 2–20 s period on patches. Fold motion should look slow and fluid, and pulsing patches should switch on and off at roughly 4–7 s periods. Recognisable by gentle, drifting, layered undulation where nothing is ever sharp. It pairs with green/violet lighting.
15. **Fireworks.** A launch (a single jet or a central group ramps quickly to max, like the "palm trunk"), then a burst (a ring or radial set of jets jumps to a high value at once, the "peony"), then a decay. Peony: abrupt cut-off. Chrysanthemum: a slower decay with twinkle. Willow: a slow droop of at least 10 s (the 10-second willow rule maps well to a long sustained fade). The burst size maps to the number of jets involved.
16. **Flame flicker.** Real puffing is about 10 Hz, too fast for most pumps, so time-scale it to about 1–3 Hz. Use a low-pass-filtered noise source plus occasional "lick" spikes (random short pulses), with adjacent jets correlated (the flame body) and higher spatial frequency toward the top. Recognisable by restless, upward-licking irregular motion with no clean period.

General recognisability levers (inferred): (a) **asymmetry**, meaning sharp crests and flat troughs, a steep front and gentle back, or a fast rise and slow fall; (b) **grouping**, meaning sets, whelps and ring packets; (c) **directionality and start/end**, meaning a trigger cluster, a drawback, a single front or a collapse; (d) **spatial/temporal ratio**, meaning how many crests fit across the array at once. A row of about 20 jets can only show about 1–4 wavelengths readably (at least 5 jets per wavelength).

### Gaps
- I could not extract the exact La Ola paper wording (the PDF stream was compressed and pypdf was not installed). Width in metres (6–12 m), "≤25 people" and the exact seats/s value rely on the brief or the Wikipedia summary, which disagree (20 vs 22 seats/s). The paper's model parameters (thresholds, active/refractory durations) were not obtained.
- Couzin's fish-school work and Cavagna/Giardina's scale-free correlations were not fetched. The murmuration numbers come only from the Procaccini/Hemelrijk line of work.
- Honami speed and wavelength numbers (typical m/s and m) were not found in the fetched abstracts.
- Iribarren thresholds for breaker types, the H/d ≈ 0.78 breaking criterion, Green's law and undular bore Froude thresholds were not confirmed by the fetched sources.
- ECG interval timings (P, QRS, T durations), aurora curtain fold speeds, rain-impact ring numbers, and fireworks burst timing/diameter vs shell size were not sourced. The "100 ft per inch" heuristic was not confirmed (one source cites a 70 ft/inch spectator-distance rule, which is a different thing).
- Tessendorf's "Simulating Ocean Water" was not fetched. Its use here (an FFT of a Phillips/JONSWAP spectrum) is from general knowledge.

## Key Question 2: Which musical moments each wave suits

### Takeaway
Map the physical time-scale and energy profile of each wave to the musical structure. Long, slow, low waves (swell, seiche, tsunami, aurora) suit sustained bass and pads and slow build-ups. Waves defined by a sudden front or burst (surf, bore, fireworks, rain, ECG) suit drops, drum hits and accents. Travelling single pulses with a clear direction (stadium wave, Kelvin wake, murmuration) suit melodic or vocal phrases and call-and-response.

### Cited Findings
- No source in this search links natural wave types to musical moments. The mapping below is inferred from the physical time-scales cited in Key Question 1: swell T ≈ 8 s for 100 m wavelength ([Trochoidal wave](https://en.wikipedia.org/wiki/Trochoidal_wave)); seiche periods of minutes and their harmonics ([Seiche](https://en.wikipedia.org/wiki/Seiche)); a sudden plunging energy release ([Breaking wave](https://en.wikipedia.org/wiki/Breaking_wave)); a 2–20 s aurora pulsation ([arXiv 2209.14545](https://arxiv.org/pdf/2209.14545)); a willow hang of at least 10 s ([fireworks.com](https://fireworks.com/safety/glossary)); and a stadium-wave trigger by a small group with steady travel ([Wikipedia: Wave (audience)](https://en.wikipedia.org/wiki/Wave_(audience))).

### Inferences
| Wave | Best musical moment | Sync suggestion |
|---|---|---|
| Ocean swell (+ sets) | Bass swells, intros, slow verses, ambient pads | Period = 1–2 bars; set envelope = 4–8 bars; amplitude follows low-band RMS |
| Chop (JONSWAP mix) | Busy verses, percussive textures, rising tension | γ and amplitude follow spectral flux; more components as density rises |
| Plunging surf | Drop / downbeat after a build; crash cymbal | Front travels during the riser; break on beat 1 of the drop; whitewater decays with the reverb tail |
| Tidal bore | Key change, new section entry, "march" theme | Front crosses the array over 1–2 bars; whelps on the following beats; plateau holds the new section |
| Tsunami | Big cinematic build into the finale | Drawback = breakdown/silence; rising wall = the build; hit at the climax |
| Stone ripples | Single accents, piano notes, pizzicato, vocal entries | One drop per note onset; source position follows pitch (low = left, high = right) |
| Kelvin wake | Lead melody, solo instrument, glissando | "Boat" position = melodic contour or time; V follows it |
| Seiche | Grooves with a clear backbeat, waltzes, see-saw call-and-response | Mode 1 at half-bar, mode 2 on doubled time; nodes as visual anchors |
| Rain on water | Hi-hats, shakers, quiet bridges, sparse piano | Impact rate = onset density in the high band |
| Stadium wave | Choruses, crowd moments, audience-participation songs, laps on repeated phrases | One lap per phrase (2–4 bars); trigger on the phrase start |
| Murmuration wave | Strings, choral swells, emotional bridges; agitation wave on a sudden accent | Mass morph = pad dynamics; dark wave = a stab or vocal inflection |
| Honami | Gentle acoustic, folk and pastoral passages | Gust rate = melodic-phrase rate; spring-back on note decays |
| Heartbeat / ECG | Tension intros, kick-drum-only sections, pre-drop silences, ballads about life and death | QRS on the kick; flatline for silence; restart on the drop |
| Aurora curtains | Ambient, atmospheric, slow vocal pads, outros | Fold drift slower than 1 bar; pulsation 2–8 s, unsynchronised for a dreamy feel |
| Fireworks (peony / chrysanthemum / willow) | Drum hits, accents, finales; willow for the final sustained chord | Launch on the pickup, burst on the hit, decay length = note release |
| Flame flicker | Rock or flamenco guitar, intense rhythmic sections, fire-themed songs | Flicker intensity follows mid-high energy; licks on snare or strums |

### Gaps
- I found no empirical study of which water-wave visuals audiences associate with which musical features. The mapping is design judgement and should be checked with user testing or showrunner review.
- How these effects look after real pump and VFD response (attenuation of fast components) was not researched. Each model needs a per-fixture low-pass/latency compensation check.
