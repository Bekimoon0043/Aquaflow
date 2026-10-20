# Automatic Choreography Generation for Music-Driven Fountain (and Light) Shows

Note on sourcing: items marked "(paper knowledge)" were not re-fetched this session and come from the cited paper's abstract/known content; the URL is the primary arXiv/venue page. Everything else was confirmed in search or fetch results this session (2026-10-20).

## 1. Music-to-dance generation (EDGE, Bailando, FACT/AIST++, Lodge, POPDG, 2025-26 successors) and what transfers

### Takeaway
State-of-the-art dance generators are data-hungry learned models (diffusion / VQ + GPT) trained on hours of motion capture, but their *structural ideas* transfer directly: a coarse-to-fine hierarchy (global "primitives" then local fill), a discrete vocabulary of motion units (VQ codebook = pattern library), inpainting/editing constraints, and, most usefully for a no-data setting, ChoreoMaster's graph search over a library of phrases with choreographic-rule costs, which is a production system shipped in games.

### Cited Findings
- **EDGE (CVPR 2023)**: transformer-based diffusion model conditioned on Jukebox music features; supports editing via joint-wise conditioning and in-betweening; introduces a new physical-plausibility metric and a large user study showing significant improvement over prior SOTA — [EDGE arXiv 2211.10658](https://arxiv.org/abs/2211.10658)
- EDGE's metric is Physical Foot Contact (PFC), judging foot-ground plausibility via centre-of-mass acceleration without explicit physics; lower is better — [Walk Before You Dance, arXiv 2504.04634](https://arxiv.org/pdf/2504.04634); [arXiv 2603.08023](https://arxiv.org/pdf/2603.08023)
- (paper knowledge) EDGE generates long sequences by generating fixed-length chunks and stitching them with diffusion inpainting constraints on overlapping frames; adds a contact-consistency loss — [EDGE arXiv 2211.10658](https://arxiv.org/abs/2211.10658)
- (paper knowledge) **Bailando (CVPR 2022)**: learns a "choreographic memory" — a VQ-VAE codebook of quantized dance units (separate upper/lower body) — then a GPT selects code sequences conditioned on music, fine-tuned with an actor-critic RL stage whose reward includes beat alignment. Bailando++ (TPAMI 2023) extends this — [Bailando arXiv 2203.13055](https://arxiv.org/abs/2203.13055)
- (paper knowledge) **FACT / AIST++ (ICCV 2021)**: full-attention cross-modal transformer; AIST++ dataset ≈5.2 h of 3D dance across 10 genres, 1,408 sequences; introduced FID_k/FID_g and BAS — [AI Choreographer arXiv 2101.08779](https://arxiv.org/abs/2101.08779)
- **Lodge (CVPR 2024)**: two-stage coarse-to-fine diffusion; a global diffusion produces "characteristic dance primitives" capturing coarse music-dance relationship, then local diffusions fill detail in parallel guided by primitives and choreographic rules; a Foot Refine Block enforces foot-ground contact — [Lodge CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Li_Lodge_A_Coarse_to_Fine_Diffusion_Network_for_Long_Dance_CVPR_2024_paper.html); [GitHub THUSIGSICLAB/LODGE](https://github.com/THUSIGSICLAB/LODGE)
- **Lodge++**: authors state Lodge's primitives were temporally sparse and its choreography rules "oversimplified", so Lodge++ learns global choreography patterns in a compact implicit space; adds penetration guidance, foot refinement and a multi-genre discriminator — [Lodge++ arXiv 2410.20389](https://arxiv.org/html/2410.20389v1)
- (paper knowledge) **POPDG (CVPR 2024)**: popular-dance generation with a new PopDanceSet dataset, built on a diffusion backbone with an iDDPM-style model and an alignment module — [POPDG arXiv 2405.03178](https://arxiv.org/abs/2405.03178)
- **DanceChat (2025)**: an LLM acts as a "pseudo-choreographer", reading structured music descriptors (key, tempo, chord progression) plus genre and writing textual dance instructions that condition a diffusion motion generator; motivation: music→motion is one-to-many and ill-posed, text is a structured, interpretable intermediary; outperforms SOTA on AIST++ — [DanceChat arXiv 2506.10574](https://arxiv.org/html/2506.10574v2)
- Other 2025-26 successors seen: PAMD (plausibility-aware long dance diffusion), DanceEditor (iterative editing with open-vocabulary text), OpenDance (large-scale internet data), a Mamba-based diffusion model (2026) — [PAMD 2505.20056](https://arxiv.org/pdf/2505.20056); [DanceEditor 2508.17342](https://arxiv.org/pdf/2508.17342); [OpenDance 2506.07565](https://arxiv.org/pdf/2506.07565); [arXiv 2603.08023](https://arxiv.org/pdf/2603.08023)
- LLM group choreography: "Global Position Aware Group Choreography using LLM" (2025) targets multi-dancer music correlation and dancer-wise consistency — closest analogue to multi-area fountains — [arXiv 2503.09645](https://arxiv.org/html/2503.09645v1)
- **ChoreoMaster (SIGGRAPH 2021, NetEase + Tsinghua)**: learns a choreomusical embedding mapping music and dance phrases to a shared style+rhythm space, then a graph-based motion synthesis framework that "can robustly and efficiently generate high-quality dance motions following various choreographic rules"; described as production-ready, accepted by professional artists and used in several NetEase games — [ChoreoMaster PDF](https://cg.cs.tsinghua.edu.cn/papers/SIG-2021-ChoreoMaster.pdf); [3dvf](https://3dvf.com/en/siggraph-2021-choreomaster-can-make-cg-characters-dance)
- Follow-up describes ChoreoMaster-style matching as beat score + a structural penalty against excessive repeated patterns, with path search over the motion graph by dynamic programming (offline) or beam search (real time) — [Video Motion Graphs arXiv 2503.20218](https://arxiv.org/pdf/2503.20218)
- ChoreoGraph (2022) also does music-conditioned choreography over a style- and tempo-consistent dynamic motion graph — [ChoreoGraph arXiv 2207.07386](https://arxiv.org/pdf/2207.07386)

### Inferences
- Fountains output channel levels (pump %, valve on/off, light DMX), not joints; the analogue of a "motion unit" is a parameterised pattern template (e.g. "chase L→R across ring jets, 1 bar, height 70%"). Bailando's VQ codebook ≈ a hand-authored pattern library; Lodge's global primitives ≈ section-level "show arc" decisions; local diffusion ≈ deterministic pattern rendering.
- Foot-contact constraints map to fountain physics: pump ramp-rate limits, minimum valve dwell, water hammer, wind, nozzle min/max height, pump/VFD start latency. These are better enforced by a deterministic compiler/post-filter than learned.
- ChoreoMaster's motion-graph + DP/beam search with rule costs is the most transferable pattern because it needs only a library of units plus a scoring function, not a large paired dataset.
- End-to-end diffusion for fountains is not viable without a dataset of fountain shows paired with music, which does not exist publicly.

### Gaps
- Could not open the ChoreoMaster PDF (>10 MB) to confirm exact cost terms or whether an HMM/Viterbi formulation is used.
- Did not verify Bailando/FACT/POPDG/EDGE internals in this session beyond abstracts (marked as paper knowledge).

## 2. Music-to-light-show generation (stage lighting, DMX, xLights, Vixen, Hue)

### Takeaway
Learned light-show generation now exists (Skip-BART, ICLR 2026; SeqLight, 2026) and beats rule-based emotion→colour mapping in human studies, but it uses a few hundred video-derived examples, predicts only coarse hue/intensity, and struggles with long-term structure. Consumer tools (xLights community auto-sequencers, MaestroDMX) are rule/analysis-based: beat + section + energy detection mapped to effect templates.

### Cited Findings
- **Skip-BART** ("Automatic Stage Lighting Control: Is it a Rule-Driven Process or Generative Task?", ICLR 2026): frames lighting as generative; BART with skip connection from each music frame to the light frame; input OpenL3 embeddings (512-d, 1 s window, 0.1 s hop), output per-frame hue (180 bins) and value (256 bins) at 10 Hz, saturation fixed, single primary light, ≤102.4 s — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2); [ICLR 2026 poster](https://iclr.cc/virtual/2026/poster/10008746)
- Dataset RPMC-L2: 699 samples from 35 live shows, mostly rock/punk/metal; labels auto-extracted from video (hue = mode of bright-pixel hue histogram); split by show — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)
- Data-scarcity tricks: audio-only masked pre-training, transfer from PianoBART with DARE merging + LoRA, adaptive loss weights, and restricted stochastic temperature-controlled (RSTC) sampling that blocks sudden hue/value jumps between frames — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)
- Rule baseline: BiLSTM emotion classifier (DEAM) → Nijdam emotion-to-colour mapping. Human study (38 raters, 7-point, 6 dimensions): ground truth 4.51, Skip-BART 4.35 (n.s. vs GT, p=0.724), rule-based 2.67 (p<0.001); cross-domain (Suno-generated folk/R&B/jazz) Skip-BART 4.34 vs rule 3.34 — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)
- Limitations admitted: overly strong local fluctuations; weaker long-term rhythmic structure than ground truth — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)
- Code/weights released — [Hugging Face RS2002/Skip-BART](https://huggingface.co/RS2002/Skip-BART)
- **SeqLight** (2026): hierarchical framework mapping music to multi-light HSV; addresses earlier single-primary-light restriction; no public code listed — [NeurIPS 2026 poster](https://neurips.cc/virtual/2026/poster/150106); [emergentmind 2605.03660](https://www.emergentmind.com/papers/2605.03660)
- **xLights**: standard workflow is manual — load audio, map effects onto each model by timing cues; has built-in beat tracking — [learnchristmaslighting](https://www.learnchristmaslighting.com/blog/how-do-i-sequence-my-christmas-lights-to-music%2F)
- Community Auto Sequencer generates a full xLights sequence from MP3 detecting beats, tempo, sections and lyrics; can snap all props to one synchronized pattern for a marked section — [xlightsseq.com](https://xlightsseq.com/posts/9331/)
- An xLights MCP server (beta) analyses beats/structure/energy of an MP3 and writes a valid .xsq, with Automatic, Guided and Template modes — [glama.ai](https://glama.ai/mcp/servers/esrz93u497)
- **MaestroDMX**: commercial standalone box that tracks music events live and autonomously changes colour, dimmers, movement, effects; dims during spoken/silent sections; "no pre-analysis" needed; no LLM mentioned — [simplysoundandlighting](https://www.simplysoundandlighting.co.uk/products/maestro-dmx-lighting-designer-in-a-box)
- **LacyLights MCP**: LLM-facing server generating theatrical lighting scenes and cue sequences from natural language/script analysis, translating intent to DMX values (script-driven, not music-driven) — [glama LacyLights](https://glama.ai/mcp/servers/bbernstein/lacylights-mcp)

### Inferences
- Commercial practice for light shows is: audio analysis → section/beat/energy grid → template effects per prop group. That is the same shape as a fountain generator and is the right baseline.
- Skip-BART's RSTC sampling is an inference-time smoothness constraint, i.e. the learned-model community also bolts physical/aesthetic constraints on at decoding time.
- A learned colour/intensity curve model (Skip-BART-size) could be a small optional add-on for the fountain's lighting layer; its released weights are rock-biased.

### Gaps
- Did not find primary docs for Vixen auto-sequencing or Philips Hue Sync algorithms (Hue Sync is real-time audio-reactive; details not verified).
- SeqLight full method/data not read.

## 3. Fountain-specific research (incl. Chinese literature)

### Takeaway
Fountain-specific automatic choreography literature is very thin. The key academic work is Yoo & Lee (2009): onset/beat analysis + structure analysis + a Bayesian network learned from sample scenarios, with the authors noting poor large-scale coherence and moving toward pattern-based methods. Chinese literature found is mostly hardware (MCU/PLC) real-time spectrum→PWM mapping, not authored-show generation. No public fountain dataset was found.

### Cited Findings
- Yoo & Lee, "Automatic Musical Fountain Scenario Generation using Musical Information Analysis", ICMC 2009 (pp. 81-84): onset and beat analysis feed a structure analysis; new scenarios generated from a Bayesian network built on sample scenarios; much faster than manual — [ResearchGate](https://www.researchgate.net/publication/298979427_Automatic_Musical_Fountain_Scenario_Generation_Using_Musical_Information_Analysis); [Yonsei CGA lab](https://cga.yonsei.ac.kr/26fb79e7-b116-81ba-bc1b-ece97eed427b)
- "Creating Musical-Fountain Shows", IEEE CG&A 29(5):6-13, 2009, DOI 10.1109/MCG.2009.91; abstract stresses hand-programming cost so routines are rarely changed; summaries state probability-network scenarios lack large-scale coherence, motivating pattern-based methods — [ResearchGate](https://www.researchgate.net/publication/40020915_Creating_Musical-Fountain_Shows); [Yonsei CGA lab](https://cga.yonsei.ac.kr/26fb79e7-b116-8195-a463-d4cece8f3352)
- Student/low-cost fountain report notes skilled fountain programmers spend days to weeks per new performance — [KSCST abstract](https://www.kscst.org.in/sppArchive/public/Abstract/036/7021.pdf)
- Chinese academic example: MCU (MSP430/STM32) fountain using FFT spectrum → PWM jet heights (real-time spectrum display, not pre-authored) — [基于单片机的音乐喷泉设计, sciengine](https://cdn.sciengine.com/doi/pdfView/68FED636557C49D9B28356B5EB4F5380); [UESTC journal](https://www.sy.uestc.edu.cn/article/doi/10.12179/1672-4550.20190306)
- Industry-practitioner Chinese writing describes matching water-shape height, flow and angle to rhythm/pitch, using leaping/twisting/rotating shapes to convey emotion (conceptual) — [知乎 音乐喷泉同步](https://zhuanlan.zhihu.com/p/680709722); [CSDN 音乐程控喷泉](https://blog.csdn.net/wytiant/article/details/45539499)
- Searches for GA-based fountain choreography found none; nearest: GA beat-synchronised dance (WUCSE-2004-66; greedy vs GA) and a multi-objective GA for multi-dancer floor patterns (Lee & Lee, MTAP 2018) — the latter is spatially analogous to multi-area fountains — [WUSTL report](https://openscholarship.wustl.edu/cse_research/1035); [KAIST MTAP 2018](https://lava.kaist.ac.kr/?p=5428)

### Inferences
- The Yoo & Lee finding (local probabilistic models lack global coherence) is the same lesson as Lodge (need a global stage) — supports a hierarchical planner.
- Commercial fountain vendors' auto-programming (if any) is proprietary; a template-library + rules approach is the realistic state of the practice.

### Gaps
- CNKI full-text not accessible; Chinese searches surfaced no paper on 音乐喷泉 自动编排 using GA/Markov/emotion models. Absence may reflect search limits, not absence of literature.
- No public dataset of fountain shows paired with music found.

## 4. Constraint-aware generation (DP/Viterbi, ILP, grammars, beam search, RL)

### Takeaway
For a template library with physical constraints, the proven pattern is graph/sequence search: states = (pattern, params), transitions = feasibility + aesthetic costs, solved by DP/Viterbi offline or beam search, with hard constraints enforced by a compiler. RL (Bailando's actor-critic) and GA are alternatives but need a reward/fitness that is essentially the same scoring function.

### Cited Findings
- Graph-based dance methods find an optimal path through a motion graph aligned with music; DP for offline, beam search for real time; costs = beat score + structural penalty against excessive repetition + learned music-motion feature distance — [Video Motion Graphs arXiv 2503.20218](https://arxiv.org/pdf/2503.20218)
- ChoreoMaster's graph framework follows "various choreographic rules" (structure, rhythm, style compatibility) — [ChoreoMaster](https://cg.cs.tsinghua.edu.cn/papers/SIG-2021-ChoreoMaster.pdf)
- GA for beat-synchronising move sequences vs fast greedy — [WUSTL WUCSE-2004-66](https://openscholarship.wustl.edu/cse_research/1035); multi-objective GA for group spatial patterns — [KAIST](https://lava.kaist.ac.kr/?p=5428)
- (paper knowledge) Bailando uses actor-critic RL fine-tuning with a beat-alignment reward over a discrete codebook — [arXiv 2203.13055](https://arxiv.org/abs/2203.13055)
- Lodge applies choreographic rules within a hierarchical (global→local) structure — [Lodge](https://openaccess.thecvf.com/content/CVPR2024/html/Li_Lodge_A_Coarse_to_Fine_Diffusion_Network_for_Long_Dance_CVPR_2024_paper.html)
- Skip-BART's RSTC decoding restricts frame-to-frame jumps (constraint at sampling time) — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)

### Inferences
- Recommended formulation for fountains: hierarchical grammar show → section → phrase (bars) → pattern. At phrase level run Viterbi/DP over (pattern_id, area_set, intensity_level) states with costs: music-feature fit (energy↔height, onset density↔pattern speed, stem/band↔area), transition cost (ramp feasibility, pump reuse, visual continuity), repetition penalty (ChoreoMaster-style), section-arc target (build/peak/release), and hard constraints (max simultaneous pumps/power budget, min valve dwell, ramp rates, interlocks) as infinite cost or compiler clamps.
- ILP is useful only for resource allocation per time slice (e.g. power budget, which areas can run together); DP/beam over time is simpler and fast enough for a desktop app (song length ~ 100-300 phrases × few hundred states).
- Stochasticity for variety: sample top-k paths or add noise to costs (seeded), mirroring temperature sampling.

### Gaps
- No source found applying ILP/CSP specifically to fountain or light shows.

## 5. LLM-as-director approaches (2024-2026)

### Takeaway
The "LLM writes a structured plan, a deterministic/learned engine renders it" pattern is established in dance research (DanceChat) and appearing in lighting/sequencing tools (xLights MCP, LacyLights MCP), but no published music→LLM→DMX/fountain system with evaluation was found. It is best used for the top level (section intents, area emphasis, colour script) with schema validation and a deterministic compiler.

### Cited Findings
- DanceChat: LLM reads structured music descriptors and genre, writes textual instructions as an interpretable intermediary for a one-to-many mapping; improves over SOTA on AIST++ — [arXiv 2506.10574](https://arxiv.org/html/2506.10574v2)
- LLM group choreography using global positions (2025) — [arXiv 2503.09645](https://arxiv.org/html/2503.09645v1)
- xLights MCP server: Automatic/Guided/Template modes producing .xsq from beat/structure/energy analysis (beta) — [glama.ai](https://glama.ai/mcp/servers/esrz93u497)
- LacyLights MCP: AI translates artistic intent into DMX values and cue sequences from scripts — [glama LacyLights](https://glama.ai/mcp/servers/bbernstein/lacylights-mcp)
- Search found no published LLM agent that listens to music and writes DMX cues end-to-end — (negative result of search, see [glama LacyLights](https://glama.ai/mcp/servers/bbernstein/lacylights-mcp) / [MaestroDMX](https://www.simplysoundandlighting.co.uk/products/maestro-dmx-lighting-designer-in-a-box))

### Inferences
- LLMs cannot hear audio reliably as text; feed them a compact music analysis (sections with labels, bar times, energy curve per section, stems/instrument activity, tempo, key/mood) plus a site description (areas, effect types, capabilities, constraints) and require JSON output against a schema (sections → {intent, energy_target, areas, effect_families, colour_palette, transitions}).
- Risks: hallucinated area/effect IDs (mitigate with enum-constrained schema), timing drift (never let the LLM emit timestamps finer than section/phrase; the compiler snaps to beats), inconsistency across runs (cache/seed, offer N variants), cloud dependency/cost/latency and offline sites (must have a deterministic fallback planner), and no guarantee of safety (compiler is the sole authority on physical constraints).
- Evaluation: compare LLM-planned vs rule-planned shows in blind pairwise A/B on rendered previews.

### Gaps
- No peer-reviewed evaluation of LLM-directed light/fountain shows found.

## 6. Evaluation metrics and a small evaluation harness

### Takeaway
Dance metrics (BAS, FID_k/FID_g, diversity, PFC) are known to be flawed or dataset-dependent; the field relies on user studies. Skip-BART shows a practical recipe for small-scale evaluation: objective curve-tracking metrics plus a ~30-40 person 7-point rating study with ANOVA. For fountains, combine automatic checks (beat alignment, repetition, feasibility) with blind pairwise ratings of rendered simulation videos.

### Cited Findings
- BAS (Bailando-style): mean over music beats of exp(-min distance to nearest motion beat² / 2σ²), σ e.g. 3 — [arXiv 2504.04634](https://arxiv.org/pdf/2504.04634); higher is better — [DanceEditor 2508.17342](https://arxiv.org/pdf/2508.17342)
- EDGE argues BAS is fundamentally flawed: dance isn't about matching joint-speed minima to beats; one variant penalises good dances with minima between beats, another penalises dances that skip beats — [EDGE arXiv 2211.10658](https://arxiv.org/pdf/2211.10658)
- PFC as physical-plausibility metric — [arXiv 2603.08023](https://arxiv.org/pdf/2603.08023)
- Skip-BART objective metrics: RMSE/MAE (circular for hue) and correlation of absolute first-order differences (tracks change timing); subjective: 38 raters, 4 conditions, 6 dimensions, 7-point, repeated-measures ANOVA + Bonferroni t-tests; cross-domain test on Suno-generated songs — [arXiv 2506.01482](https://arxiv.org/html/2506.01482v2)
- EDGE relied on a large-scale user study for its main claim — [EDGE abstract](https://arxiv.org/abs/2211.10658)

### Inferences
- Fountain harness proposal:
  1. Automatic: (a) onset/beat alignment of *change events* (valve on, height step, colour change) with tolerance windows rather than strict BAS; (b) energy-correlation between per-bar music RMS and total water "visual mass"; (c) section-boundary alignment (changes within ±1 beat of detected sections); (d) repetition/diversity: n-gram repeat rate of pattern IDs, entropy of patterns per section, fraction of areas used; (e) feasibility: zero violations of ramp-rate, dwell, power budget, interlocks (hard gate); (f) peak usage (e.g. % time at ≥70% height in choruses).
  2. Human: render each show in the app's simulator to video, blind pairwise A/B (generated vs baseline vs hand-made) with Bradley-Terry/Elo ranking; 10-20 songs across genres; rate musicality, variety, climax, overall.
  3. Regression suite: fixed songs + fixed sites, store metric snapshots, fail on drop.
- FID-style metrics are not meaningful without a reference dataset of real fountain shows; skip.

### Gaps
- No fountain-specific evaluation protocol found in literature.

## 7. Recommended architecture for a desktop app without large training data

### Takeaway
Use a hierarchical, mostly deterministic pipeline: music analysis → show arc planner (rules, optional LLM) → per-phrase pattern selection by DP/beam search over a site-adapted template library with a scoring function → constraint compiler → simulation preview + automatic metrics. Learned models are optional add-ons (music embeddings for similarity, small colour model, preference-tuned scoring weights), not the core.

### Cited Findings
- Hierarchy needed for long-range coherence: Lodge global/local split — [Lodge](https://openaccess.thecvf.com/content/CVPR2024/html/Li_Lodge_A_Coarse_to_Fine_Diffusion_Network_for_Long_Dance_CVPR_2024_paper.html); fountain Bayesian-network scenarios lacked large-scale coherence → pattern-based methods — [Creating Musical-Fountain Shows](https://www.researchgate.net/publication/40020915_Creating_Musical-Fountain_Shows)
- Graph search over phrase library with rule costs is production-proven (ChoreoMaster in NetEase games) — [3dvf](https://3dvf.com/en/siggraph-2021-choreomaster-can-make-cg-characters-dance); DP/beam solvers — [arXiv 2503.20218](https://arxiv.org/pdf/2503.20218)
- Commercial light auto-sequencers use beat/section/energy/lyrics analysis + templates — [xlightsseq](https://xlightsseq.com/posts/9331/); [glama xLights MCP](https://glama.ai/mcp/servers/esrz93u497)
- Small learned light model feasible with ~700 samples + transfer learning + constrained sampling — [Skip-BART](https://arxiv.org/html/2506.01482v2)
- LLM as interpretable intermediate planner — [DanceChat](https://arxiv.org/html/2506.10574v2)

### Inferences
- Proposed layers:
  1. **Analysis**: beats/downbeats, sections (verse/chorus/drop), per-bar energy, onset density, stems (drums/bass/vocals/other) band energies, key/mood; optional audio embedding (OpenL3 as in Skip-BART).
  2. **Site model**: areas, effect primitives per area (jets, rings, shooters, mist, swing nozzles, lights), capability ranges, physical constraints (ramp rates, min dwell, max concurrent pumps/kW, interlocks), spatial layout (left/centre/right, depth).
  3. **Pattern library**: parameterised templates (chase, wave, pulse, stack/build, burst, sweep, mirror, alternate, fan) as functions of (areas, beat grid, intensity, speed) → channel curves; tagged with energy level, style, required effect types. Site-adaptation = instantiate templates over the site's areas automatically.
  4. **Arc planner**: rules (intro low/sparse → build → chorus peaks use most areas/height ≥70% → bridge contrast → final climax → outro) produce per-section targets (energy, area count, palette); optional LLM produces the same JSON for richer intent.
  5. **Phrase optimiser**: Viterbi/beam over phrases with costs (music fit, arc target, transition feasibility, repetition penalty, symmetry/spatial balance, "signature" moments on big hits); seeded sampling for variants.
  6. **Constraint compiler**: renders to channel timelines, enforces ramp/dwell/power/interlocks, latency pre-compensation (fire valves early by nozzle travel time), smoothing.
  7. **Evaluation & feedback**: metrics from §6; user edits/likes logged to tune scoring weights (simple Bradley-Terry or linear preference learning), enabling gradual data collection.
- Where learning adds value cheaply: section detection and stem separation (pretrained), music-pattern compatibility embedding learned later from user-edited shows (ChoreoMaster-style contrastive embedding once a few hundred pattern-phrase pairs exist), preference-learned scoring weights, optional colour-curve model.
- Data needs: core pipeline needs zero training data; preference tuning needs tens of rated A/B comparisons; a learned music-pattern embedding needs hundreds to thousands of labelled phrases; end-to-end diffusion would need hours of paired fountain shows (not available).

### Gaps
- No public benchmark to validate the claim that this architecture matches professional fountain programmers; must be validated with the harness above.
