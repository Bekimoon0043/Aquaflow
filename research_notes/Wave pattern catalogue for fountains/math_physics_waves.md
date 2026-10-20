# Mathematical and physical wave types as fountain/light choreography

Conventions used throughout (my own, for implementation; not from a source):
- Line/path: jet i of N at p = i/(N−1) ∈ [0,1] (closed ring: p = i/N, so p wraps). Grid: (x, y) ∈ [0,1]², centred coords u = x−0.5, v = y−0.5. Ring/polar: θ = 2πi/N, r = radius normalised to [0,1].
- Phase φ(i,t) = 2π(t/T − k·p). T = temporal period (s), k = number of crests visible along the path (spatial wavenumber in "cycles per path"). Crest speed = 1/(k·T) path-lengths/s; each jet sees one crest per T.
- Level L ∈ [0,1]. Map any bipolar wave w ∈ [−1,1] with L = 0.5 + 0.5·A·w (A ≤ 1 amplitude), or add a floor: L = Lmin + (1−Lmin)·(0.5+0.5w).
- On/off rendering of a continuous L: on if L > θ_thr. For L = 0.5+0.5cos φ, duty = arccos(2θ_thr − 1)/π (θ_thr = 0.5 → 50 %).
- Hard constraints assumed in the brief: solenoid = binary with min 1 s on and min 1 s off → per-jet cycle ≥ 2 s (≤ 0.5 Hz), and both duty·T ≥ 1 s and (1−duty)·T ≥ 1 s. Proportional (VFD/prop valve) = slew-limited at s ≈ 1/2…1/3 full-range per second (2–3 s full range).

## Q1. Exact formulas, parameters, appearance (line / ring / grid) and on-off vs proportional degradation, per wave type

### Takeaway
Every requested wave reduces to a compact closed form L(i,t) built from a phase φ = 2π(t/T − k·p) (or a radial/angular equivalent) plus a shaping function; most of the physics forms (standing wave, beats, damped oscillation, chirp, soliton, Burgers shock, Bessel membrane modes, Lissajous, Poisson) are textbook-sourced below, while the shader-shaping functions (impulses, pulses, smoothstep) come from Inigo Quilez / The Book of Shaders. Solenoid arrays can render only patterns whose per-jet on and off dwell is ≥ 1 s (so per-jet period ≥ 2 s), which turns all smooth shapes into moving "blocks"; proportional valves preserve shape only if the waveform's slope is ≤ ~0.33–0.5 full-range/s, which for a full-swing sine means T ≳ 6–9 s.

### Cited Findings

Physics/maths building blocks (sourced):
- Standing wave = sum of two counter-propagating equal waves: y_R = y_max sin(2πx/λ − ωt), y_L = y_max sin(2πx/λ + ωt), sum y = 2y_max sin(2πx/λ)cos(ωt); nodes at x = nλ/2, antinodes at x = (2n+1)λ/4, spacing λ/2; the pattern does not travel. — [Wikipedia: Standing wave](https://en.wikipedia.org/wiki/Standing_wave)
- Beats: cos(2πf₁t) + cos(2πf₂t) = 2cos(2π(f₁+f₂)/2·t)·cos(2π(f₁−f₂)/2·t); perceived beat frequency |f₁ − f₂| (envelope magnitude repeats at twice the envelope cosine frequency). — [Wikipedia: Beat (acoustics)](https://en.wikipedia.org/wiki/Beat_(acoustics))
- Linear chirp: f(t) = f₀ + c·t, c = (f₁−f₀)/T, phase φ(t) = φ₀ + 2π(c t²/2 + f₀ t). Exponential chirp: f(t) = f₀·k^(t/T), k = f₁/f₀, phase φ(t) = φ₀ + 2π f₀ T (k^(t/T) − 1)/ln k. — [Wikipedia: Chirp](https://en.wikipedia.org/wiki/Chirp)
- Square wave Fourier series: x(t) = (4/π) Σ_{k≥1} sin(2π(2k−1)f t)/(2k−1) — odd harmonics only; pulse wave duty cycle = high time / period; square = 50 % duty. — [Wikipedia: Square wave (waveform)](https://en.wikipedia.org/wiki/Square_wave_(waveform))
- Gibbs phenomenon: truncated Fourier sums overshoot by ≈ 8.95 % of the jump (0.0894899 × jump); Fejér (non-negative kernel) summation eliminates it, sigma-approximation / Riesz summation reduce it. — [Wikipedia: Gibbs phenomenon](https://en.wikipedia.org/wiki/Gibbs_phenomenon)
- Underdamped oscillation: x(t) = A e^(−ζω_n t) cos(ω_d t + φ), ω_d = ω_n√(1−ζ²); envelope ±A e^(−ζω_n t), time constant τ = 1/(ζω_n), half-life ln2/(ζω_n). — [Wikipedia: Damping](https://en.wikipedia.org/wiki/Damping)
- KdV soliton: φ(x,t) = −(c/2) sech²[(√c/2)(x − ct − a)] — speed c, amplitude ∝ c, width ∝ 1/√c (taller solitons are faster and narrower). — [Wikipedia: Korteweg–De Vries equation](https://en.wikipedia.org/wiki/Korteweg%E2%80%93De_Vries_equation); Scott Russell: "speed depends on the size of the wave, and its width on the depth of water" — [Wikipedia: Soliton](https://en.wikipedia.org/wiki/Soliton)
- Gaussian wave packet: Gaussian envelope × carrier e^(ik₀x); the envelope moves at group velocity, carrier crests at phase velocity; non-dispersive packets keep shape, dispersive ones spread (width ∝ √(1+4t²) in the free-particle example). — [Wikipedia: Wave packet](https://en.wikipedia.org/wiki/Wave_packet)
- Breaking / shock: inviscid Burgers u_t + u u_x = 0 has implicit solution u = f(x − u t); faster parts overtake slower ones, the front steepens and breaks at t_b = −1/min f′(x). Viscous travelling shock: u = c − ((f⁺−f⁻)/2)·tanh[(f⁺−f⁻)/(4ν)·(x − ct)], c = (f⁺+f⁻)/2, shock width ∝ ν. — [Wikipedia: Burgers' equation](https://en.wikipedia.org/wiki/Burgers%27_equation)
- Two-source interference: equal waves with phase difference Δφ sum to amplitude 2A|cos(Δφ/2)|; constructive at Δφ = 2nπ, destructive at (2n+1)π. — [Wikipedia: Wave interference](https://en.wikipedia.org/wiki/Wave_interference)
- Circular membrane (drum/round-plate approximation) modes: u_mn = (A cos ω t + B sin ω t)·J_m(α_mn r/a)·(C cos mθ + D sin mθ), α_mn = n-th zero of J_m, ω_mn = α_mn c/a; m nodal diameters, n−1 interior nodal circles; e.g. α₀₁ = 2.40483, α₁₁ = 3.83171, α₁₂ = 7.01559. — [Wikipedia: Vibrations of a circular membrane](https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane)
- Chladni figures: a resonating plate divides into regions vibrating in opposite phase separated by nodal lines; Chladni's law approximates modal frequencies (the article gives no equation). — [Wikipedia: Chladni figure](https://en.wikipedia.org/wiki/Chladni_figure)
- Spirals: logarithmic r = a e^(kφ), constant pitch angle tan α = k, turn spacing grows geometrically; Archimedean spirals have constant turn spacing. — [Wikipedia: Logarithmic spiral](https://en.wikipedia.org/wiki/Logarithmic_spiral)
- Lissajous: x = A sin(at + δ), y = B sin(bt); a/b sets lobe counts, δ sets apparent rotation; rational a/b closes, a slightly detuned ratio makes the figure precess/rotate. — [Wikipedia: Lissajous curve](https://en.wikipedia.org/wiki/Lissajous_curve)
- Poisson process with rate λ: inter-arrival times exponential with mean 1/λ; counts in time t are Poisson(λt). — [Wikipedia: Poisson point process](https://en.wikipedia.org/wiki/Poisson_point_process)
- Bounce: coefficient of restitution e = √(h/H) → h_n = e^(2n) h₀; (standard kinematics stated alongside) each bounce's flight time scales as eⁿ, total time t₀(1+e)/(1−e). — [Wikipedia: Coefficient of restitution](https://en.wikipedia.org/wiki/Coefficient_of_restitution)
- Noise: value noise interpolates random lattice values (blocky); Perlin gradient noise (1985) interpolates random gradients; simplex noise (Perlin 2001) uses a simplex grid (N+1 corners instead of 2^N), fewer directional artefacts; smoothstep fade 3f²−2f³, Perlin's improved quintic fade 6f⁵−15f⁴+10f³; output is continuous and deterministic ("smooth randomness"). — [The Book of Shaders ch. 11](https://thebookofshaders.com/11/)
- Shaping functions (Inigo Quilez): expImpulse(x,k) = h·e^(1−h), h = kx, peak 1 at x = 1/k (fast attack, slow decay, "for envelopes and triggers"); cubicPulse(x,c,w) = 1 − s²(3−2s), s = |x−c|/w, 0 outside w (compact-support Gaussian substitute); parabola(x,k) = (4x(1−x))^k; pcurve(x,a,b) asymmetric peak; gain(x,k) contrast remap; sinc(x,k) = sin(π(kx−1))/(π(kx−1)) for bounces; expStep(x,k) = 2^(−x^k) (sharp S-step). — [Inigo Quilez: Useful little functions](https://iquilezles.org/articles/functions/)

Fountain-hardware context:
- Solenoid valves can only open/close (no proportional flow) and opening/closing produces water-hammer pressure spikes; proportional/servo valves open gradually but on shared manifolds individual nozzle changes affect manifold pressure (vendor source — promotional). — [WaterShapes: A Breakthrough in Fountain Flow Control?](https://watershapes.com/?p=47890)
- Fast-solenoid "graphic" water curtains drive a row of valves from a bitmap frame-by-frame; one how-to cites <25 ms response for 20+ Hz and ~80 nozzles (blog-grade source). — [Industrial Monitor Direct: PLC musical fountain valve control](https://industrialmonitordirect.com/blogs/knowledgebase/plc-musical-water-fountain-valve-control-implementation); see also [Wikipedia: Sequencing fountain](https://en.wikipedia.org/wiki/Sequencing_fountain)

### Inferences
(Formulas below are my implementation forms derived from the cited maths; parameter "good-look" ranges are design judgement, not sourced.)

Global degradation rules (derived from the brief's hardware limits):
- Solenoid (1 s on / 1 s off min): per-jet frequency ≤ 0.5 Hz; any pattern must satisfy duty·T ≥ 1 s and (1−duty)·T ≥ 1 s, so T ≥ 2 s at 50 % duty, T ≥ 4 s at 25 % duty. Spatial motion is NOT limited — a crest can move across many jets per second as long as each individual jet dwells ≥ 1 s (wide crests). So on solenoids: prefer long-period, wide-crest travelling patterns; reduce shapes to "lit block moves". Enforce with a per-jet hysteresis/min-dwell filter after thresholding.
- Proportional, slew s (≈0.33–0.5 /s): a waveform passes undistorted only if max|dL/dt| ≤ s. For L = 0.5+0.5A sin φ, max slope = πA/T → need T ≥ πA/s: full swing (A=1) T ≥ 6.3 s (2 s ramp) to 9.4 s (3 s ramp). Faster sines degrade into triangles of reduced peak-to-peak ≈ s·T/2. Sharp shapes (square, saw drop, pluck attack, shock front, heartbeat) are rounded to ramps of ≥ 2–3 s. Pre-compensate by scheduling commands ahead (start ramp before the beat) and by reducing amplitude rather than letting the valve lag.
- Spatial sampling: N jets sample space; a wave needs ≥ ~4 jets per wavelength to read as smooth and ≥ 2 to avoid aliasing (Nyquist), so k ≤ N/4 (line) — e.g. 20 jets → k ≤ 5, 150 jets → k ≤ ~37 (but for readability k ≈ 1–4 is best).

Per wave type (L for line/path; ring uses θ in place of 2πp with integer k so it closes; grid uses the stated 2D form):

1. Sine travelling wave: L = 0.5 + 0.5A·cos(2π(t/T − k·p)). Params: T 2–16 s (≈1–4 bars), k 0.5–3, A 0.6–1. Line: crests run end to end (k<1 = one rolling swell). Ring: integer k crests chase round the ring (k=1 = "rotating high side"). Grid: plane wave L = 0.5+0.5cos(2π(t/T − k(x cosα + y sinα))) sweeping in direction α. On/off: threshold → moving blocks of width duty/k path; OK if T ≥ 2 s. Proportional: ideal medium; obey T ≥ ~6–9 s for full swing or lower A.

2. Standing wave: L = 0.5 + 0.5A·sin(πm·p)·cos(2πt/T) (m antinode count; line ends as nodes) or |sin(πm p)·cos(2πt/T)| for "all heights positive" (rectified, doubles apparent frequency). Equivalent to averaging two travelling waves with ±k. Line: fixed nodes stay low, antinodes pump. Ring: L = 0.5+0.5cos(mθ)cos(2πt/T) → 2m lobes alternating ("breathing flower"). Grid: cos(πm x)cos(πn y)cos(2πt/T) (see Chladni). On/off: becomes alternating groups (antinode groups A vs B swap each half-period) — reads well, needs T/2 ≥ 1 s. Proportional: excellent, nodes need a floor so they are not "dead".

3. Square / pulse-width wave: L = [frac(t/T − k p) < D] (D = duty 0..1). Line: hard-edged block chase; D small → narrow "runner". Ring: rotating sectors. Grid: moving bars. On/off: native shape; constraint D·T ≥ 1 s and (1−D)T ≥ 1 s. Proportional: edges become 2–3 s ramps → trapezoid; use only when T ≥ ~8 s or accept softening.

4. Triangle: L = 1 − |2·frac(t/T − k p) − 1|. Constant-slope rise/fall, slope 2/T per s → proportional valves render it exactly when T ≥ 2/s ≈ 4–6 s (the most "valve-friendly" periodic shape). On/off: identical to 50 % square after threshold.

5. Sawtooth: ramp-up L = frac(t/T − k p); ramp-down L = 1 − frac(...). Line: "filling" ramp that resets — the sudden drop gives a strong directional push (the eye reads travel direction from the slow side). Ring: rotating sweep like a radar. On/off: threshold gives a square — direction cue lost unless D small. Proportional: reset edge becomes a ramp of 2–3 s → shape becomes asymmetric triangle; still reads as directional. Rise portion needs T ≥ 1/s (≈2–3 s).

6. Exponential attack–decay (pluck): per jet with trigger time t_i = t₀ + d·p (d = sweep delay): τ = t − t_i; L = 0 for τ<0, else (τ/τ_a)·e^(1−τ/τ_a) (Quilez expImpulse, peak at τ_a) or two-stage L = (1 − e^(−τ/τ_a))·e^(−τ/τ_d). Params τ_a 0.05–0.3 s (lights), τ_d 0.5–4 s. Line: a "plucked string" flash propagating. Ring/grid: trigger order by angle or radius. On/off: becomes a fixed ≥1 s pulse — loses the decay (lights can still do it). Proportional: attack limited to ~2–3 s full scale, so a pluck is a slow swell; better use short-attack only on lights, water "decay" side is fine (decay τ_d ≥ ~1.5 s).

7. Damped oscillation: L = 0.5 + 0.5·e^(−τ/τ_d)·cos(2π τ/T_d) after trigger (τ = t − t_i); or position-domain "ringing" L = 0.5 + 0.5e^(−p/ℓ)cos(2π(t/T − k p)) (ring-down along the line from a source). ζ ≈ 0.05–0.2 gives 3–8 visible swings. On/off: decay invisible; renders as a few alternating pulses of fixed length — weak. Proportional: works if T_d ≥ 6 s; amplitude envelope is easy (slow).

8. Chirp / accelerating wave: phase Φ(t) = 2π(f₀ t + c t²/2) (linear) or 2πf₀T(k^(t/T) − 1)/ln k (exponential); L = 0.5 + 0.5cos(Φ(t) − 2πk p). Use for build-ups (riser → drop). Line/ring: crests visibly accelerate (spinning up). On/off: speed-up is only visible until per-jet cycle hits 2 s; beyond that switch to spatial acceleration (move a wide block faster across jets) instead of increasing per-jet frequency. Proportional: amplitude must shrink as frequency rises (A ≤ sT/π) — design the chirp to "tighten" with lowering amplitude, or cap f₁ at ≈0.15 Hz for full swing.

9. Beats: L = 0.5 + 0.25A[cos 2π(t/T₁ − k₁p) + cos 2π(t/T₂ − k₂p)]; envelope period = 1/|1/T₁ − 1/T₂|. Spatially (k₁≈k₂, same T) gives a slowly moving "group" envelope; temporally (T₁≈T₂) whole array swells and fades. Line: wave packets of crests drifting. Ring: lobes that grow and vanish. On/off: carrier must be ≥ 2 s per cycle, so the beat envelope is very long (e.g. carrier 2 s vs 2.2 s → 22 s envelope) — readable mostly as density changes. Proportional: good; the slow envelope is the main read.

10. Two-point-source interference (ripple tank): sources S₁, S₂ in plane; d_j = |(x,y) − S_j|; w = cos(2π(t/T − d₁/λ)) + cos(2π(t/T − d₂/λ)); L = 0.5 + 0.25w (or use amplitude |cos(π(d₁−d₂)/λ)| for the static fringe map). Nodal lines are hyperbolae where d₁ − d₂ = (n+½)λ. Grid: classic moiré of moving rings with still dark lanes. Line: if line passes between sources, gives stationary alternating bright/dark bands = standing-wave-like. Ring: lobes. Needs a 2D layout ≥ ~8×8 to read. On/off: fringes become blotchy; OK only with λ spanning ≥ 3 jets. Proportional: good with T ≥ 6 s.

11. Circular/radial ripple: L = 0.5 + 0.5cos(2π(t/T − r/λ)) with r = distance from centre (or from a chosen point); add 1/(1 + r/r₀) or e^(−r/ℓ) decay for realism. Grid/concentric rings: expanding rings ("stone in pond"). Line: centre-out mirrored chase (symmetric from middle). Ring (single circle): all jets equidistant from centre → whole ring pulses together (degenerates to a temporal pulse) — use concentric rings of jets instead. On/off: excellent as expanding rings of blocks. Proportional: good.

12. Spiral / rotating arm: arms m, Archimedean: L = 0.5+0.5cos(m(θ − Ωt) − 2π r/b) (constant arm spacing b); logarithmic: replace 2πr/b by (m/ k)·ln(r/a)·... i.e. phase m(θ − Ωt) − ln(r)/tanα. Ω = 2π/T. Single ring: reduces to a rotating m-lobe chase (sine wave with integer k = m). Concentric rings / grid: rotating pinwheel; Archimedean looks like a vinyl groove, log looks like a galaxy/nautilus. Line: it becomes a travelling wave. On/off: rotating sectors — very legible. Proportional: good if Ω slow.

13. Lissajous / phase-offset 2D: moving "spot" P(t) = (0.5 + 0.45 sin(2πa t/T + δ), 0.5 + 0.45 sin(2πb t/T)); L(i) = exp(−|x_i − P(t)|²/(2σ²)) (or cubicPulse). On a ring: L = 0.5+0.5cos(θ − 2πt/T)·… or use two jet groups driven by sin(at+δ), sin(bt) for x/y "axes". a/b = 1:2, 2:3, 3:4 look good; slight detune makes the figure precess. Grid: a gliding blob tracing figure-8s. On/off: spot becomes a set of ≥1 s lit jets — spot must move slowly (≤ σ per s). Proportional: σ must be wide (≥ 2–3 jets) so per-jet slope stays under slew.

14. Fourier synthesis: w = Σ_{h odd ≤ H} sin(h·φ)/h · (4/π) (square), triangle uses (−1)^((h−1)/2) sin(hφ)/h²·8/π², saw uses Σ (−1)^(h+1) sin(hφ)/h·2/π; φ = 2π(t/T − k p); L = 0.5+0.5w clamped. Animate H from 1→7 to "sharpen" a sine into a square on a build-up; Gibbs overshoot ≈ 9 % will clip at 0/1 — apply Fejér/σ weights (sinc(h/H)) to avoid ringing. On/off: meaningless (it is already square). Proportional: higher harmonics exceed slew — harmonic h requires T/h ≥ ~6 s, so in practice only H ≤ 3 is visible on water; full effect on lights.

15. Gaussian wave packet / soliton: packet L = exp(−((p − p_c(t))/σ)²/2)·(0.5+0.5cos 2π(k p − t/T)) with p_c = v t (wraps on ring); soliton L = sech²((p − v t)/w) — tie w to v (taller=faster) for physical feel. Line: single travelling hump ("wave runs down the line"). Ring: hump circulating. Grid: a moving ridge (line soliton) or blob. On/off: a lit block of width ≈ 2w jets moving; each jet dwell = 2w/(v) must be ≥ 1 s → v ≤ 2w/1 s (path-units). Proportional: hump rise time at a jet ≈ w/v must be ≥ ~2–3 s for full height, else lower peak.

16. Breaking wave / shock front: asymmetric profile L = 0.5 + 0.5·(1 − tanh((ξ)/w_f)) for front ahead, with slow tail: e.g. L = (ξ<0 ? exp(ξ/ℓ_tail) : exp(−ξ/w_front)), ξ = p − v t, w_front ≪ ℓ_tail; or animate steepening by iterating u = f(p − u t) (Burgers) until t_b then hold. Reads as a surf wave: sharp leading edge, long trailing slope. On/off: asymmetry lost (block). Proportional: steep front cannot exceed slew — on water make the TRAILING side the slow (decay) side and lead with lights (strobe) to fake the sharp edge.

17. Noise (Perlin/simplex flow): L = 0.5 + 0.5·n(x·f_s + v_x t, y·f_s + v_y t, z₀ + t/T_evolve) using 2D/3D simplex; fBm: Σ_o 0.5^o n(2^o ·…), 2–3 octaves. Line: use 2D noise (p·f_s, t/T). Ring: sample noise on a circle (cos θ, sin θ)·R so it wraps seamlessly. Grid: drifting clouds. f_s ≈ 1–3 features across array; T_evolve 4–20 s. On/off: becomes random-ish clusters — enforce min dwell; reads as "organic glitter". Proportional: very natural (noise is smooth, low slope if T long).

18. Cymatics / Chladni: square plate (common shader approximation, free-plate): w = cos(nπu')cos(mπv') − cos(mπu')cos(nπv') with u',v' ∈ [0,1]; L = 1 − smoothstep(0, ε, |w|) highlights nodal lines (sand lines), or L = |w| for antinodes. Circular: w = J_m(α_mn r)·cos(mθ)·cos(2πt/T). Transition between (n,m) pairs on bar changes. Grid: the iconic pattern. Ring of jets: only the angular factor survives → cos(mθ) lobes (2m alternating). Line: cos·cos degenerates to a standing wave. On/off: nodal-line pattern renders as a static picture; good as stills that switch every ≥ 1 s. Proportional: morph between modes with crossfade ≥ 3 s.

19. Random sparkle (Poisson): each jet fires at rate λ (events/s); inter-arrival exponential mean 1/λ; each event = pulse of length D (≥1 s on solenoids) or a pluck envelope; global density ρ = λ·D (fraction on). Optionally bias λ by music energy. Line/ring/grid: twinkling. On/off: fine if after each event a ≥1 s refractory period is enforced (λ_eff ≤ 0.5/s/jet). Proportional: sparkle becomes slow bloom unless pulse ≥ 3 s; best on lights or in combination (lights sparkle, water breathes).

20. Bounce (gravity easing): within bounce n of duration T_n = T₀·eⁿ: L = h_n·4s(1−s), s = τ_n/T_n ∈ [0,1], h_n = e^(2n) (the parabola is exact ballistic shape); or easeOutBounce for a single drop. e ≈ 0.5–0.75 gives 3–6 visible bounces; total time T₀(1+e)/(1−e)-type geometric sum. Apply with per-jet delay d·p to get a cascade. On/off: only first 1–2 bounces with T_n ≥ 2 s survive. Proportional: first bounce must have T₀ ≥ ~4–6 s for full height; later bounces get clipped by slew — naturally looks like a damped bounce anyway. Note real water jets are ballistic, so a jet's own rise/fall is already a "bounce".

21. Heartbeat (double pulse): per beat period T_hb: L = A₁·g(τ, 0, σ) + A₂·g(τ, Δ, σ), g = exp(−((τ−c)/σ)²/2) or cubicPulse, τ = frac(t/T_hb)·T_hb, Δ ≈ 0.25–0.35·T_hb, A₂ ≈ 0.6–0.8 A₁ ("lub-dub"). Use p-delay for a pulse travelling outward from centre. On/off: at T_hb = 2 s the two pulses are < 1 s apart → impossible on one jet; alternate the lub/dub between two jet groups instead (group A on for lub, group B for dub). Proportional: water can only do a single swell per beat at realistic T_hb; carry the double pulse on lights.

### Gaps
- No source found giving the exact square-plate Chladni closed form for a free-edge plate; cos·cos − cos·cos is a widely used approximation (shader practice), not an exact free-plate eigenmode — the true free-plate modes need numerical solution (Ritz). Flagged as approximation.
- Heartbeat, pluck two-stage envelope, spiral-with-log-phase and Lissajous-spot mapping formulas are design constructions, not sourced from a reference.
- HyperPhysics pages were unreachable (certificate error), so ripple-tank hyperbola formula is derived from Wikipedia's phase condition rather than cited directly.
- No authoritative source quantified real jet hydraulic lag (fill/rise time of a water column) vs valve ramp; the ~2–3 s full-range and 1 s on/off values are taken from the brief, not verified.

## Q2. How to tie T (and spatial parameters) to music tempo

### Takeaway
Express every temporal parameter in beats: T = n_beats·60/BPM, with n chosen from {1/2, 1, 2, 4 (=1 bar in 4/4), 8, 16}, and phase-lock to the beat grid (t measured from the downbeat). Hardware limits push water periods to the bar/phrase scale while lights can run at the beat/sub-beat scale.

### Cited Findings
- Beat/envelope frequency of summed tones equals |f₁−f₂|, so a slow envelope can be set to a bar/phrase length by detuning periods. — [Wikipedia: Beat (acoustics)](https://en.wikipedia.org/wiki/Beat_(acoustics))
- Chirp phase formulas (above) allow frequency to rise over a set duration T — usable for build-ups that land on a downbeat. — [Wikipedia: Chirp](https://en.wikipedia.org/wiki/Chirp)
- Music-reactive fountains synchronise water movement to real-time audio, e.g. band-split audio driving individual solenoids. — [Cornell ECE4760 Musical Water Fountain](https://people.ece.cornell.edu/land/courses/ece4760/FinalProjects/s2006/tj39vls25tmd29/tj39vls25tmd29/index.htm); [Wikipedia: Sequencing fountain](https://en.wikipedia.org/wiki/Sequencing_fountain)

### Inferences
- Beat length b = 60/BPM (120 BPM → 0.5 s; 90 → 0.667 s; 140 → 0.43 s). Bar = 4b in 4/4.
- Solenoid water: per-jet cycle ≥ 2 s ⇒ T ≥ ceil(2/b) beats; at 120 BPM that is ≥ 4 beats = 1 bar (50 % duty). Spatial chases can still step one jet per beat (crest speed = jets/beat) as long as crest width ≥ 2 beats of travel.
- Proportional water full swing: T ≥ ~6–9 s ⇒ 2–4 bars at 120 BPM; tie T to 2/4/8 bars; use smaller amplitude for 1-bar motion.
- Lights: any T from ⅛ beat upward; heartbeat/pluck/sparkle lock to individual beats/onsets.
- Phase-lock: φ = 2π((t − t_downbeat)/T − k p) so crests arrive at array end (or ring start) exactly on downbeats; choose k p offsets so a full traverse = 1 or 2 bars (k = 1, T = bar for line).
- Beats/chirp: detune T₂ = T₁·(1 ± 1/M) so the envelope period = M·T₁ = a phrase (e.g. 8 bars). Chirp from f₀ to f₁ over 4–8 bars ending at the drop; then cut to standing/burst.
- Event-driven types (pluck, sparkle, bounce, heartbeat, ripple from point) take trigger times from onsets/downbeats rather than periodic T; schedule water triggers ahead by the valve latency/ramp time so the peak (not the start) lands on the beat.
- Section mapping suggestion: verse = sine/noise slow; pre-chorus = chirp/Fourier sharpening; chorus = square/standing/spiral; breakdown = beats/soliton; drop = radial ripple + sparkle.

### Gaps
- No source found on audience perception thresholds for tempo-sync accuracy (how much water lag is tolerated); typical practice of pre-triggering is inferred.

## Q3. Which read well at audience distance with 20–150 jets

### Takeaway
At distance, large-scale, low-k, high-contrast, slow patterns read best: travelling sine/soliton chases with 1–3 crests, standing-wave "breathing" alternation, rotating spirals/sectors on rings, radial ripples on grids, and square-block chases on solenoids. Fine-detail types (high-harmonic Fourier, Chladni nodal lines, two-source fringes, double-pulse heartbeat, damped ringing) need ≥ ~60–150 jets in 2D and/or lights to read.

### Cited Findings
- Bitmap/graphic water curtains need fast valves (<25 ms, ~80 nozzles in one example) to draw readable images, i.e. fine spatial detail requires many fast actuators. — [Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/plc-musical-water-fountain-valve-control-implementation) (blog-grade)
- Solenoid on/off can't meter flow and switching causes water hammer; proportional valves allow gradual height changes. — [WaterShapes](https://watershapes.com/?p=47890) (vendor)
- Simplex noise avoids the directional artefacts of grid-based noise — relevant for organic-looking 2D fields. — [The Book of Shaders ch. 11](https://thebookofshaders.com/11/)

### Inferences
- Readability ranking (my judgement, 20–150 jets):
  - Tier A (reads at any count ≥ 20, both valve types): travelling sine (k ≤ 2), square/block chase, standing-wave alternation, soliton/single hump, rotating sector/spiral on a ring, radial ripple (grid or concentric rings), sawtooth sweep (direction cue).
  - Tier B (needs ≥ ~40 jets or proportional valves): triangle, beats/wave packets, Lissajous spot, noise flow, bounce cascade, chirp (spatial acceleration), breaking wave (needs proportional + lights).
  - Tier C (needs 2D ≥ ~10×10 or lights; subtle on water): two-source interference, Chladni/Bessel modes, Fourier harmonic build (H > 3), damped ringing, heartbeat double-pulse, Poisson sparkle (great on lights; "fizz" on water).
- Rules of thumb: keep wavelength ≥ 6–8 jets for 20–40-jet lines (k ≤ 3–5), ≥ 10 jets for crisp crests; contrast (Lmin→1) matters more than shape at distance — add a floor only for "breathing" looks; slower is more legible on water (crest traverse ≥ 1 bar).
- Layering is the main trick: water carries the low-frequency envelope (period ≥ 2 s solenoid, ≥ 6 s proportional), lights carry the fast detail (pluck, sparkle, heartbeat, harmonics, shock edge) using the same L(i,t) formula at higher frequency — keeps one mathematical pattern consistent across both media.
- Ring layouts make integer-k patterns (rotations, standing lobes, spirals) especially legible since the eye tracks rotation; radial ripple degenerates on a single ring (all equidistant).

### Gaps
- No empirical/academic source found measuring legibility of fountain patterns vs jet count or viewing distance; ranking above is reasoned, not measured.
- No source found directly comparing chase timing on solenoid vs proportional fountains.
