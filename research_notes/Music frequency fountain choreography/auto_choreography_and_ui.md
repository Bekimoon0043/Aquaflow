# Automatic music-driven choreography (fountains, light, dance) and timeline audio visualisation for choreographers

Research scope: (A) algorithms and evaluation methods that could generate fountain patterns automatically from music features; (B) UI conventions for showing audio in a choreography timeline. The focus is on ideas that can be built in a browser JS app.
Method: about 15 web searches and fetches. Several primary PDFs (Fukayama & Goto SMC 2015, ChoreoMaster SIGGRAPH 2021) could not be text-extracted in this environment, so their details come from abstracts and secondary summaries. These are flagged where they occur.

## A1. Published work on automatic fountain, light and dance choreography: which ideas transfer?

### Takeaway
Only one peer-reviewed paper turned up that is specifically about automatic fountain choreography: Yoo & Lee, ICMC 2009. It extracts onsets, beats and musical structure, then samples a fountain "scenario" from a Bayesian network trained on example scenarios written by people. That is a learned template/statistics approach on top of a beat and structure grid. The strongest ideas to borrow come from dance synthesis. Pattern segments are aligned to beats and stored as graph nodes, a graph search scores rhythm, style and transition costs, and self-similarity structure analysis makes repeated music sections get repeated choreography. Commercial and hobby light tools mostly use plain rule-based mapping of timing marks or frequency bands to effects, and users describe the results as mechanical.

### Cited Findings
**Fountain-specific**
- Yoo, M.-J. & Lee, I.-K., "Automatic Musical Fountain Scenario Generation using Musical Information Analysis," ICMC 2009 (Montreal), pp. 81–84. The system extracts onset and beat information, analyses musical structure for timing, and generates new scenarios with a Bayesian network trained on sample (human-authored) scenarios. The only evaluation claim visible is that generation is much faster than manual authoring. The abstract gives no quantitative metric. — [Yonsei CGA lab page](https://cga.yonsei.ac.kr/26fb79e7-b116-81ba-bc1b-ece97eed427b)
- The same authors have a Korean-language example-based version of the fountain work. — [koreascience.kr PDF](https://koreascience.kr/article/CFKO200819463922700.pdf) (identified via search summary; not read in full)
- Chinese patent CN103473423A (fountain simulation system) says in its background section that signal analysis can generate some drive signals automatically, but the automatic shows look mechanical and lack artistry. Large music fountains are therefore still programmed by directors and technicians who adjust the water rhythm by hand. This is the motivation for a simulator/editor rather than full automation. — [Google Patents CN103473423A](https://patents.google.com/patent/CN103473423A/zh)
- A Chinese microcontroller paper ("基于单片机的音乐喷泉设计", Music fountain design based on a microcontroller) uses an FFT spectrum to drive jet height via PWM. This is direct spectrum-to-height mapping with no beat tracking or choreography. — [UESTC journal, doi 10.12179/1672-4550.20190306](https://www.sy.uestc.edu.cn/article/doi/10.12179/1672-4550.20190306) (from search summary)
- Commercial "spontaneous choreography": H2Oarts describes a system that analyses the sounds at the fountain zone's speakers and responds to them in real time. A "Dancing Fountain" product claims to turn music into a self-choreographed water dance in real time. These are marketing claims, not evaluated methods. — [WaterShapes "Shall We Dance"](https://watershapes.com/shall-we-dance/)

**Light shows**
- Benton Wilson's MIT thesis (2022) on automatic music-lighting generation found that training a model on prior concert videos did not work. He instead built a Python abstraction for designing audio-based light shows, which assumes the audio is known in advance (pre-analysis). — [MIT DSpace 1721.1/147314](https://dspace.mit.edu/handle/1721.1/147314?show=full)
- An ASU student project used Spotify-derived tempo/beat data plus lyrics, fed to an AI model, to produce DMX light shows. — [ASU FORGE PDF](https://forge.engineering.asu.edu/wp-content/uploads/2022/04/Kang-Yi-Lim.pdf)
- US patent 9763311 (portable interactive lighting) maps tempo to colour and amplitude to brightness, and sends RGB over DMX. This is the canonical rule-based mapping. — [USPTO 9763311](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9763311)
- MaestroDMX is a standalone controller that analyses music in real time and generates lighting with no pre-analysis. The claims come from vendor/reseller copy. — [Huss Licht-Ton listing](https://www.huss-licht-ton.de/print_product_info.php/products_id/56473)

**Dance generation (transferable structure)**
- Fukayama & Goto (SMC 2015), "Music content driven automated choreography with beat-wise motion connectivity constraints." It uses a probabilistic framework that combines several music features by concatenating dance motion segments. Constraints on motion connectivity at beat boundaries keep transitions clean. — [AIST PDF](https://staff.aist.go.jp/m.goto/PAPER/SMC2015fukayama.pdf); [DancePedia summary](https://scrapbox.io/DancePedia/Music_content_driven_automated_choreography_with_beat-wise_motion_connectivity_constraints)
- Structural segmentation can be done with a self-similarity matrix (SSM) of frame-wise acoustic features such as MFCCs or chroma. Choreography can then reuse similar dance for segments with the same label, with more energetic movement in choruses. — [AIST SMC 2015 PDF, via search summary](https://staff.aist.go.jp/m.goto/PAPER/SMC2015fukayama.pdf)
- ChoreoMaster (SIGGRAPH 2021, Tsinghua) learns a choreomusical embedding and plugs it into a graph-based motion synthesis framework aimed at style, rhythm and structure. — [ChoreoMaster PDF](https://cg.cs.tsinghua.edu.cn/papers/SIG-2021-ChoreoMaster.pdf); [DancePedia](https://scrapbox.io/DancePedia/ChoreoMaster_:_Choreography-Oriented_Music-Driven_Dance_Synthesis)
- ChoreoGraph (ACM MM 2022, HKUST) aligns motion sequences to beats using music segments and makes them nodes of a Dynamic Motion Graph. Transitions are scored on style, tempo and smoothness. — [HKUST research portal](https://researchportal.hkust.edu.hk/en/publications/choreograph-music-conditioned-automatic-dance-choreography-over-a/)
- Kim et al. (2003/2006), as described by later papers, are early motion-graph methods. They search a path through a database of dance segments to fit the music, with rhythmic/beat constraints on the search. Recurring patterns such as mirroring and repetition reinforce musical structure. This is secondary-source only. — [arXiv 2505.23738 "How Animals Dance"](https://arxiv.org/abs/2505.23738)
- A City University of Hong Kong patent extracts MFCC, chroma, envelope and peak features, detects beats, and reorders existing dance segments by feature similarity. This is retrieval and reassembly. — [CityU KTO IP portal](https://www.cityu.edu.hk/kto/industry/find-new-opportunities-our-ip-portal-0/s/system-and-method-for-generating-music-driven-choreography-based-on-music)
- AI Choreographer / FACT (AIST++ dataset) introduced the Beat Alignment Score. EDGE (CVPR 2023) and Bailando are later deep generative models evaluated on the same metrics. — [AI Choreographer arXiv 2101.08779](https://arxiv.org/pdf/2101.08779); [EDGE supplemental](https://openaccess.thecvf.com/content/CVPR2023/supplemental/Tseng_EDGE_Editable_Dance_CVPR_2023_supplemental.pdf)
- "Feel The Music: Automatically Generating A Dance For An Input Song" (arXiv 2006.11905) is another automatic dance-from-song approach. — [arXiv 2006.11905](https://arxiv.org/pdf/2006.11905)

### Inferences
- For a browser fountain app, the practical recipe is a combination of these sources:
  1. Beat/bar/onset grid.
  2. Structural segmentation from a chroma/MFCC SSM, giving section labels A/B/chorus.
  3. A library of pre-authored fountain motifs (patterns) tagged by energy level, length in beats and "character".
  4. Per-section retrieval: choose the motif whose tags match the section's RMS energy, spectral centroid and onset density.
  5. Reuse the same motif choice for every section with the same label (repetition follows musical repetition), with optional mirroring or variation.
  6. Transition costs between motifs (pump ramp limits, valve state compatibility), solved by Viterbi/DP over beats.

  This copies the motion-graph / ChoreoGraph structure, and none of it needs deep learning.
- Yoo & Lee's Bayesian network trained on human scenarios suggests a lightweight learning path: collect statistics (motif transitions, motif given energy level) from the user's own hand-programmed shows, then sample or argmax from them. A Markov chain over motif tokens is the simplest JS version.
- Deep generative dance models (FACT, EDGE, Bailando) need large paired datasets. No fountain equivalent of AIST++ exists, so they don't transfer directly. Their evaluation metrics do transfer (see A2).
- The patent's "mechanical, lacks artistry" remark and the LOR user complaints (A3) suggest positioning auto-generation as a first-draft generator that a person then edits on the timeline, not a finished show.

### Gaps
- I could not read the full text of Yoo & Lee 2009 (the network variables and structure analysis method are unknown), Fukayama & Goto 2015 (PDF not extractable here) or ChoreoMaster (PDF over the fetch limit). Exact cost terms and numbers are unverified.
- I found no CNKI papers specifically on "音乐喷泉 自动编排" (automatic choreography for music fountains) with beat tracking or optimisation. One Chinese-language search returned only the patent and the FFT/PWM paper. A dedicated CNKI/Wanfang search was not possible.
- I found no post-2015 peer-reviewed paper on automatic fountain choreography.

## A2. How quality is evaluated

### Takeaway
Dance generation has standard objective metrics: Beat Alignment Score (BAS), FID_k / FID_g for realism, and Diversity (mean pairwise feature distance). User studies supplement them. Fountain and light work reports mostly speed of authoring or qualitative impressions. BAS and diversity are cheap to compute in JS and adapt directly to fountain cues.

### Cited Findings
- BAS was introduced with AIST++. It measures how close each kinematic beat is to its nearest music beat. Music beats come from librosa, and kinematic beats are local minima of kinetic velocity. — [AI Choreographer arXiv 2101.08779](https://arxiv.org/pdf/2101.08779)
- Reported BAS values: EDGE ≈ 0.26–0.27, Bailando ≈ 0.23, FACT ≈ 0.22 (review summary). Another 2026 AIST++ table lists Bailando 0.2332 against ground truth 0.2374. Ground truth itself scores only about 0.24, so BAS should not be pushed toward 1.0. — [Liner review of EDGE](https://liner.com/review/edge-editable-dance-generation-from-music); [InfiniteDance arXiv 2603.13375](https://arxiv.org/pdf/2603.13375)
- FID_k (kinematic) and FID_g (geometric) measure realism, and lower is better. EDGE's authors observed that FID_k/FID_g fluctuated during training and correlated weakly with how good the output looked. — [EDGE CVPR 2023 supplemental](https://openaccess.thecvf.com/content/CVPR2023/supplemental/Tseng_EDGE_Editable_Dance_CVPR_2023_supplemental.pdf)
- Diversity is the mean pairwise Euclidean distance in kinematic/geometric feature space. Closer to ground-truth diversity counts as better. — [Lodge arXiv 2403.10518](https://arxiv.org/pdf/2403.10518); [GCDance arXiv 2502.18309](https://arxiv.org/pdf/2502.18309)
- Metric reproductions vary. One paper's numbers for EDGE differ from the original, probably because of different sequence counts and durations. — [search summary of FreeDance ICCV 2025 supplemental](https://openaccess.thecvf.com/content/ICCV2025/supplemental/Zhao_FreeDance_Towards_Harmonic_ICCV_2025_supplemental.pdf)
- Yoo & Lee (fountain) report only an authoring-speed benefit. — [Yonsei CGA](https://cga.yonsei.ac.kr/26fb79e7-b116-81ba-bc1b-ece97eed427b)

### Inferences
- Fountain BAS analogue: define "fountain beats" as times of sharp change in the output (jet height derivative peaks, light on/off edges, valve open events). Score `mean over fountain beats of exp(-d²/2σ²)` against music beats or onsets, with σ ≈ 50–100 ms, accounting for the pump/hydraulic latency offset. (AIST++ BAS uses this Gaussian form, but check the exact formula in arXiv 2101.08779.)
- An energy-match score is the correlation between the music RMS/loudness envelope and the aggregate water height or flow envelope over a section.
- A structure-consistency score is the similarity between choreography for sections that share a label, minus similarity for sections with different labels.
- Diversity is the count or entropy of distinct motifs used per minute, to penalise one pattern repeated for the whole song.
- None of these give human preference. A/B user rating of generated versus hand-made shows remains the gold standard (EDGE notes that FID does not correlate with perception).

### Gaps
- I did not retrieve the exact BAS formula constant (σ) from the primary paper.
- I found no published evaluation metrics for fountain or DMX auto-generation.

## A3. Commercial and hobby auto-generators: mapping rules and timing tracks

### Takeaway
Hobby tools (xLights, Vixen, Light-O-Rama) all centre on timing tracks: beat, bar, onset, chord, notes and lyrics marks, generated by built-in analysis or Queen Mary Vamp plugins. Effects are dropped onto these grids by hand, or by theme rules in LOR's "Instant Sequence". Automatic results depend on the song, and users find them hit-or-miss.

### Cited Findings
- xLights timing tracks are added from Sequence Settings → Timing. Options include fixed Metronome intervals (non-editable until "Make Timing Track Variable"), Audio Tempo (mark per detected beat), Audio Onsets (percussive onsets), Audio Chords (marks labelled with chord names) and Speech Recognizer (macOS). The remaining dropdown entries come from Vamp plugins and appear only if those are installed. — [xLights manual: Timing Tracks](https://manual.xlights.org/xlights/chapters/chapter-four-sequencer/timing-tracks)
- xLights also supports a manual tapper (press "t" during playback), import of .txt/PGO/LMS/LOR/LSP/.xml/.xtiming timing files, "Import Notes" from MIDI, Audacity or MusicXML, and lyric timing tracks broken into phrases, words and phonemes. — [xLights manual](https://manual.xlights.org/xlights/chapters/chapter-four-sequencer/timing-tracks)
- In xLights, timing marks form a grid, but "once the effects are dropped they have no relation to the original timing marks that were used to drop them." Timing marks are also timing effects with start and end edges. — [xLights manual](https://manual.xlights.org/xlights/chapters/chapter-four-sequencer/timing-tracks)
- The Queen Mary Vamp plugin set includes a Bar and Beat Tracker, a Note Onset Detector with a sensitivity parameter (higher sensitivity detects more onsets, rightly or wrongly), Polyphonic Transcription and others. Version 1.7 is GPL. — [QM Vamp plugin docs](https://vamp-plugins.org/plugin-doc/qm-vamp-plugins.html)
- Users report problems. Vamp beats were correct in the first half of a song but too close together in the second half. Hand-tapped marks land 1–2 frames after waveform peaks and must be slid into place. — [AusChristmasLighting: copy beat timings](https://auschristmaslighting.com/threads/copy-beat-timings-to-end-of-song.15094/); [AusChristmasLighting: waveform out of sync](https://auschristmaslighting.com/threads/sequencing-waveform-out-of-sync.14136/latest)
- Vixen: Tools → Audio → Beat/Bar detection generates mark collections from the audio track. — [Vixen docs: audio functions](https://www.vixenlights.com/docs/usage/sequencer/sequencer-basics/audio-functions/)
- Light-O-Rama SuperStar "Instant Sequence" (Tools → Instant Sequence, Ctrl+I): open an audio file, then "Sequence All". Timing marks come from audio analysis, and effects are generated from those marks plus theme, colour and movement variation settings. — [LOR help: Instant Sequences](https://www.lightorama.com/help/instant_sequences.htm)
- One LOR user said Instant Sequence was "just making random light patterns to no beat at all". A reply said it triggers from frequencies, works better on some songs than others, and that "complex songs with notes all over the place don't work as well", and suggested the Timing map button. — [LOR forum](https://forums.lightorama.com/topic/29083-instant-sequence/)
- LedFx is a network-based real-time audio-reactive LED effect engine. — [LedFx docs](https://ledfx.readthedocs.io/en/docs); [GitHub](https://github.com/LedFx)

### Inferences
- An AquaFlow equivalent would have timing tracks: Beats, Bars (downbeats), Onsets (with sensitivity), Sections (from SSM), and optionally Notes/Chords per stem. Beats and onsets can be computed in the browser with Web Audio plus a JS port of spectral-flux onset detection and beat tracking. Libraries such as Essentia.js or Meyda exist, though they are not covered in these sources.
- LOR's design is worth copying: generation from timing marks plus a "theme" of allowed patterns, colours and movement. It is simple, and a person can edit the output.
- Keep a "regenerate/re-snap to timing track" option, because xLights' "no relation after drop" causes drift when the grid is corrected.

### Gaps
- No sources on Lumiartecnia's or Chinese fountain vendors' "automatic programming" features, or on Hue Sync and Nanoleaf Rhythm mapping rules.
- LedFx's effect internals (mel bands, beat effects) were not found in the docs I retrieved.
- Light-O-Rama SuperStar's intensity and frequency-mapping rules are not documented in the retrieved pages.

## B. How timeline editors show audio to choreographers

### Takeaway
The standard convention is an overview waveform plus a zoomable detail waveform, often coloured by frequency band, with beat, bar and timing-mark lanes stacked under it. rekordbox's official colours are 3-band: low = blue, mid = orange, high = white. RGB mode is low = red, mid = green, high = blue. For long songs in the browser, the established approach is precomputed min/max peak data at several samples-per-pixel levels, drawn on canvas (BBC peaks.js / waveform-data.js / audiowaveform).

### Cited Findings
- rekordbox (official) offers three waveform colour modes. **3-band**: high = white, mid = orange, low = blue. **RGB**: high = blue, mid = green, low = red. **2-colour**: high = white, low = blue. — [rekordbox DJ feature page](https://rekordbox.com/en/feature/djing/)
- A community post describes rekordbox 3-band as red lows / orange mids / blue highs, which contradicts the official page. Treat the official mapping as authoritative. A Substack explainer agrees with the official blue/amber mapping. — [rekordbox official](https://rekordbox.com/en/feature/djing/); [Substack "Secret language of waveforms"](https://reallychrism.substack.com/p/the-secret-language-of-waveforms); [Engine DJ community](https://community.enginedj.com/t/waveform-different-from-what-is-actually-sounding/54200)
- Other DJ apps (djay/Algoriddim) have a 3-band waveform mode as a user-requested feature. — [Algoriddim community](https://community.algoriddim.com/t/3-band-waveform-mode/42714)
- xLights draws the waveform above the timing grid, and timing tracks are rows of marks under it. — [xLights manual](https://manual.xlights.org/xlights/chapters/chapter-four-sequencer/timing-tracks)
- Vixen's timeline waveform shows a general shape that gains detail when zoomed. The default is a full stereo view with each channel spreading from the centre, switchable to mono (View → Full Waveform). Height can be resized by dragging and reset by double-click, and View → Lock Waveform Height prevents accidental resizing. — [Vixen docs](https://www.vixenlights.com/docs/usage/sequencer/sequencer-basics/audio-functions/)
- BBC peaks.js draws waveforms on HTML canvas at several zoom levels set as samples-per-pixel arrays, e.g. `zoomLevels: [512, 1024, 2048, 4096]`. It loads precomputed waveform data (binary or JSON) from `dataUri`. — [peaks.js GitHub](https://github.com/bbc/peaks.js)
- audiowaveform (BBC, C++) generates the waveform data files from MP3/WAV/FLAC/Ogg. waveform-data.js reads them in the browser, or generates the data with Web Audio, and supports resample, offset and segment operations. — [waveform-data.js GitHub](https://github.com/bbc/waveform-data.js)
- In a JUCE forum thread, developers discuss implementing a multi-coloured (frequency-coloured) waveform. — [JUCE forum](https://forum.juce.com/t/multicoloured-waveform/21085)

### Inferences (recommended design for a browser fountain editor)
- **What to draw (top to bottom):**
  1. Overview strip of the whole song with the viewport rectangle.
  2. Detail waveform, 3-band coloured. Draw each band's peak envelope as a separate filled layer in z-order low, mid, high, or blend RGB per column as rekordbox RGB mode does.
  3. Section lane (coloured blocks labelled A/B/Chorus from the SSM, with the same colour for repeated labels).
  4. Bar lane (heavier lines with bar numbers) and beat lane (thin ticks, maybe emphasising downbeats).
  5. Onset lane (small triangles, with a sensitivity slider like QM's onset detector).
  6. Optional stem lanes (drums/bass/vocals/other), each a small mono waveform, matching the 1.2.48 "music stems" feature in this repo.
  7. Pattern/cue lanes per fountain group.
- **Band split for colour:** low < ~200–250 Hz, mid ~250 Hz–2.5 kHz, high > ~2.5 kHz. These cut-offs are typical engineering choices; no source confirms rekordbox's exact crossovers. Precompute with OfflineAudioContext and BiquadFilterNodes (lowpass/bandpass/highpass) and store min/max or RMS per bucket for each band.
- **Rendering long songs:** precompute a peak pyramid (e.g. 256, 512, 1024, 2048, 4096 … samples per pixel, each level made by min/max-merging pairs from the level below), choose the nearest level at or below the current zoom, and draw only the visible range on canvas. For very wide timelines, use tiled canvases or an OffscreenCanvas worker. Draw peak (min/max) as the outer lighter shape and RMS as the inner darker shape, the DAW convention.
- **Spectrogram view (optional toggle):** log-frequency axis, perceptual colour map (viridis/magma), computed once via FFT in a worker and cached as image tiles per zoom level.
- **Interactions:** snap-to-grid with selectable target (beat / half-beat / bar / onset / section boundary), with Shift or Alt to toggle snap off. Drag a pattern from the library onto a section block to fill the whole section, auto-quantised to bars. Selecting a section highlights all sections with the same label, with a "apply to all repeats" action. Tap-tempo / "t" key marker entry as in xLights. Nudge all marks by N ms to compensate for hydraulic latency. Keep links between placed cues and the timing marks so cues can re-snap if the grid changes (fixing the xLights limitation).

### Gaps
- No primary sources retrieved for Serato or Traktor colour conventions, or for Depence, WinDMX or grandMA timecode views.
- No primary source on rekordbox or Serato stem-lane display, or on the exact band crossover frequencies used by DJ software.
- I did not retrieve audiowaveform documentation detailing its multi-resolution file layout. The pyramid recommendation is an engineering inference consistent with peaks.js's zoomLevels design.
