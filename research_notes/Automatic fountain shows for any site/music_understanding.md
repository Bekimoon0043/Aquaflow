# Music understanding for automatic fountain choreography (state of the art, Oct 2026)

Scope note: ~17 tool calls. Items marked "(prior knowledge, unverified this session)" come from the researcher's background knowledge and were NOT confirmed against a primary source in this session. Treat them as leads to check, not facts.

## 1. Stem separation (Demucs / HTDemucs / RoFormer / MDX / Spleeter / Open-Unmix)

### Takeaway
For commercial use, HTDemucs (MIT code; weights in the same MIT repo) is the safe default: ~9.0 dB SDR, roughly 1.5x track duration on CPU (~6 min for a 4-min song), and there is now an ONNX export. RoFormer models have higher SDR (~12 dB avg BS-RoFormer with extra data), but many popular community weights are CC-BY-NC-SA and they are slow and heavy on CPU. Licence must be checked per checkpoint.

### Cited Findings
- Demucs is MIT-licensed. The repo is now archived/read-only ("not maintained anymore"), and maintenance moved to the fork github.com/adefossez/demucs (bug fixes only) — [facebookresearch/demucs](https://github.com/facebookresearch/demucs)
- Models: `htdemucs` (default; trained on MUSDB + 800 extra songs), `htdemucs_ft` (fine-tuned, ~4x slower, somewhat better), `htdemucs_6s` (adds piano and guitar; README: piano "is not working great at the moment") — [Demucs README](https://github.com/facebookresearch/demucs)
- HTDemucs scores 9.00 dB SDR on MUSDB18-HQ test (9.20 dB with sparse attention + per-source fine-tuning, which was not released). Hybrid Demucs v3 scores 7.7 dB — [Demucs README](https://github.com/facebookresearch/demucs)
- CPU: "processing time should be roughly equal to 1.5 times the duration of the track" — [Demucs README](https://github.com/facebookresearch/demucs)
- HT-Demucs FT ONNX export reported (2026), ~1.31x faster than PyTorch on CPU with numerical parity (vendor claim) — [stemsplit.io blog](https://stemsplit.io/blog/htdemucs-ft-onnx-export.md)
- Mel-RoFormer beats BS-RoFormer on vocals, drums and other on MUSDB18HQ; BS-RoFormer is slightly better on bass. BS-RoFormer trained with extra songs reaches 11.99 dB average SDR — [Mel-Band RoFormer paper](https://arxiv.org/html/2310.01809v1)
- Licence conflict on RoFormer weights: one artifact bundle lists BS-RoFormer-SW and Mel-Band RoFormer (Kim) weights as CC-BY-NC-SA-4.0 — [Ryan5453/unblend](https://huggingface.co/Ryan5453/unblend). Another ONNX export of Kim's Mel-Band RoFormer vocals model says MIT, with architecture code from lucidrains' BS-RoFormer (MIT) — [audiojs/mel-roformer](https://huggingface.co/audiojs/mel-roformer)
- A BS-RoFormer ONNX export notes the architecture is MIT, but whether MUSDB18-HQ's research-only terms carry over to trained weights is "unsettled" — [silverdaw/bs-roformer-rhythm-onnx](https://huggingface.co/silverdaw/bs-roformer-rhythm-onnx)
- Mel-Band RoFormer vocal model is ~228M parameters (CoreAI conversion) — [mlboydaisuke/MelBandRoformer-Vocal-CoreAI](https://huggingface.co/mlboydaisuke/MelBandRoformer-Vocal-CoreAI). CPU-only users report high CPU usage and slow latency; the implementation is GPU-optimised — [Mel-Band-Roformer issue #3](https://forgejo.us2.navan.dev/github/Mel-Band-Roformer-Vocal-Model/issues/3)
- The `audio_separator` (python-audio-separator) package runs BS-/Mel-RoFormer checkpoints (Viperx, Aufr33) — [HF Space using audio_separator](https://huggingface.co/spaces/theneos/audio-separator/blob/2cc588ee195d3b2743d118766ff991df57dfeb3b/separwator.py)
- Spleeter is MIT-licensed (TensorFlow; 2/4/5-stem models) — [Deezer newsroom](https://newsroom-deezer.com/2020/02/releasing-spleeter-deezer-research-source-separation-engine/); [PyPI listing](https://cloudsmith.com/navigator/pypi/spleeter). Vocals SDR: Spleeter mask 6.55, Open-Unmix 6.32 (JOSS paper table) — [Spleeter JOSS paper](https://joss.theoj.org/papers/10.21105/joss.02154.pdf)
- Open-Unmix was trained only on the 150 songs of MUSDB18 — [waxy.org](https://waxy.org/2019/11/fast-and-free-music-separation-with-deezers-machine-learning-library/)

### Inferences
- A 4-min song with HTDemucs on a laptop CPU takes about 6 min in PyTorch, or roughly 4.5 min with ONNX. `htdemucs_ft` would take about 4x longer, which is too slow for interactive use. Separation will dominate the total analysis budget.
- Choreography only needs drums, bass, vocals and "other" envelopes and onsets, not audiophile SDR. So 4-stem HTDemucs (or even Spleeter at ~6.5 dB) is sufficient, and RoFormer's +3 dB is not worth the licence risk and the CPU cost.
- HTDemucs's MIT weights plus an ONNX export make it the only top-tier separator that plausibly runs in onnxruntime-node or a PyInstaller backend with clean commercial terms.
- Note: the All-In-One structure analyzer runs Demucs internally, so separation can be shared between the two.

### Gaps
- No primary-source per-checkpoint licences for MDX-Net (UVR) models, and no Open-Unmix licence was found this session. (Prior knowledge, unverified: Open-Unmix code is MIT, and UVR/MDX community weights have mixed or unclear terms.)
- No independent CPU benchmark of RoFormer against HTDemucs on a 4-min track.
- The Demucs weight licence is not stated separately from the MIT repo licence. One source says "no explicit licence identified" for HTDemucs weights ([unblend](https://huggingface.co/Ryan5453/unblend)). Legal should confirm.

## 2. Beat / downbeat / meter (beat_this, madmom, BeatNet, Essentia)

### Takeaway
beat_this (CPJKU, ISMIR 2024) is the best commercially usable choice: MIT code and weights, a ~20M-parameter model (78 MB) or a ~2M small model (8 MB), beat F1 89.1 and downbeat F1 78.3 on GTZAN, and no DBN or meter assumption. madmom's code is BSD-like, but its trained models are CC BY-NC-SA 4.0, so madmom processors cannot ship in a commercial product without a JKU licence.

### Cited Findings
- beat_this code and published weights are MIT. Some training data is copyrighted or under restricted CC licences, which users must assess themselves — [CPJKU/beat_this](https://github.com/CPJKU/beat_this)
- Checkpoint sizes: `final*` / `fold*` ~78 MB, `small*` ~8.1 MB. Distributed as PyTorch Lightning checkpoints; no ONNX mentioned. madmom is optional (only for `--dbn`) — [CPJKU/beat_this](https://github.com/CPJKU/beat_this)
- Parameters: main ~20M, small ~2M (Hung et al. ~4M) — [Beat This! paper](https://arxiv.org/html/2407.21658)
- GTZAN test: Beat This beat F1 89.1, downbeat F1 78.3. Small model: 88.8 / 77.2. Hung et al. with DBN: 88.7 / 75.6. Without DBN, the continuity metrics (CMLt/AMLt) are lower — [Beat This! paper](https://arxiv.org/html/2407.21658)
- 8-fold CV beat / downbeat F1: Harmonix 95.8 / 90.7, Ballroom 97.5 / 95.3, Beatles 94.5 / 88.8, RWC Pop 96.1 / 93.7, Candombe 99.7 / 99.7, RWC Classical 77.1 / 66.3, ASAP (piano) 76.3 / 61.2, SMC (hard) 62.7 — [Beat This! paper](https://arxiv.org/html/2407.21658)
- No DBN; the model avoids the DBN's 3-or-4-beats-per-bar assumption. It "can still fail, especially for difficult and underrepresented genres" — [arXiv abstract](https://arxiv.org/abs/2407.21658); [paper HTML](https://arxiv.org/html/2407.21658)
- madmom licence: source code is permissive (BSD-style), but model/data files (.npy, .npz, .h5, .pkl…, "Processors (i.e. saved models)") are CC BY-NC-SA 4.0. Commercial use requires contacting Gerhard Widmer (JKU) — [madmom LICENSE](https://github.com/CPJKU/madmom/blob/main/LICENSE)

### Inferences
- With the small beat_this model (2M params), CPU inference on a 4-min song should take only seconds, although no runtime was published. Exporting to ONNX is plausible because it is a plain PyTorch transformer/conv net, but this is unverified.
- Avoid `--dbn` (it pulls in madmom, whose models are non-commercial, although the DBN itself is code, not weights) unless continuity matters. A simple custom tempo-smoothing post-process can replace it.
- Use downbeats to align pattern changes to bar and phrase boundaries (4/8/16-bar phrases).

### Gaps
- BeatNet licence and accuracy were not retrieved this session.
- Essentia library licence was not retrieved. (Prior knowledge, unverified: Essentia C++/Python is AGPL-3.0 with commercial licences from MTG, and RhythmExtractor2013 is DSP-based, not deep learning.)
- No published CPU runtime for beat_this.

## 3. Structure segmentation (All-In-One, SongFormer, MSAF)

### Takeaway
All-In-One (MIT code) gives beats, downbeats, BPM and functional segment labels in one pass, with ~74% label accuracy on Harmonix. SongFormer (2025) is state of the art at ~80% accuracy and HR.5F 0.70, but it is a 0.7B-parameter, CUDA-oriented model on MuQ/MusicFM backbones (MuQ weights are CC-BY-NC). Expect verse/chorus labels to be wrong about 20–25% of the time, so boundaries plus energy are more reliable than labels.

### Cited Findings
- All-In-One outputs BPM, beats, downbeats, beat positions within the bar, and segments with labels `start, end, intro, outro, break, bridge, inst, solo, verse, chorus`. Optional frame-level activations and embeddings at 100 FPS — [mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one)
- All-In-One code is MIT; no separate weight licence is stated. Dependencies: PyTorch, NATTEN (manual install on Linux/Windows), madmom (from GitHub source), Demucs (separation), and optionally FFmpeg — [mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one)
- Runtime: 10 songs (33 min) in 73 s on an RTX 4090 + i9-10940X (GPU). Trained on Harmonix Set with 8-fold CV — [mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one)
- SongFormBench-Harmonix label ACC / HR.5F / HR3F: All-In-One 0.740 / 0.596 / 0.730; SongFormer 0.795–0.807 / ~0.70 / ~0.78; LinkSeg 0.780 / 0.630 / 0.762; Gemini 2.5 Pro 0.748 / 0.423 / 0.813. On Chinese songs (SongFormBench-CN): All-In-One 0.834 ACC, SongFormer up to 0.891 — [SongFormer paper](https://arxiv.org/html/2510.02797v2)
- SongFormer uses seven label categories (pre-chorus mapped to verse at evaluation) and fuses MuQ and MusicFM representations at 30 s and 420 s windows — [SongFormer paper](https://arxiv.org/html/2510.02797v2)
- SongFormer HF card: "CC BY 4.0" badge (scope unclear), 0.7B params F32, 24 kHz input, examples use `cuda:0`. Code and checkpoints released 30 Sep 2025 — [HF ASLP-lab/SongFormer](https://huggingface.co/ASLP-lab/SongFormer); [GitHub](https://github.com/aslp-lab/songformer)
- MuQ code is MIT, but MuQ weights (MuQ-large-msd-iter, MuQ-MuLan) are CC-BY-NC 4.0 — [SongFormer's MuQ README](https://huggingface.co/spaces/ASLP-lab/SongFormer/blob/main/src/third_party/MuQ/README.md)

### Inferences
- All-In-One is the most practical choice: one MIT pipeline produces beats, downbeats and labels and reuses Demucs. But it depends on madmom (CC BY-NC-SA models). Check whether it loads madmom model files or only uses madmom DSP/DBN code before shipping. Windows packaging of NATTEN is a known pain point.
- SongFormer's licence is risky (it inherits MuQ CC-BY-NC weights) and it is heavy (0.7B params on CPU). Not recommended for a desktop commercial build.
- A fountain show tolerates label errors if each segment gets a "role" from energy rank (lowest = intro/verse, highest = chorus/drop). Use the labels as hints and the energy as the truth.
- Fallback: a classic self-similarity / novelty segmentation (librosa or MSAF-style Foote novelty on chroma + MFCC) has no weight-licence issue and is fast.

### Gaps
- MSAF licence and accuracy were not retrieved.
- No CPU runtime for All-In-One or SongFormer.
- SongFormer licence scope (code vs weights) is unclear.

## 4. Build-up / drop / tension and energy arcs

### Takeaway
There is no widely adopted, permissively licensed open drop-detection model. The academic baseline is Yadati et al. (ISMIR 2014). Practical systems derive drops and build-ups heuristically from loudness (EBU R128 short-term), spectral novelty, the drum-stem envelope and segment boundaries.

### Cited Findings
- Yadati, Larson, Liem, Hanjalic (TU Delft), "Detecting Drops in Electronic Dance Music", ISMIR 2014, pp. 143–148: a two-stage approach (model drop acoustics, then locate the key moment), evaluated with SoundCloud comment timestamps as weak labels — [ISMIR 2014 PDF](https://archives.ismir.net/ismir2014/paper/000297.pdf)
- MediaEval 2014 multimodal drop detection (Aljanaki et al.) combined crowdsourcing, SoundCloud comments and audio — [CEUR MediaEval 2014](https://ceur-ws.org/Vol-1263/mediaeval2014_submission_88.pdf)
- A GitHub drop-detector claims F1 0.95 against 0.71 for Yadati (third-party claim, unverified) — [felixmeyer6/drop-detector](https://github.com/felixmeyer6/drop-detector)

### Inferences
- Recommended heuristics: a build-up is a rising short-term loudness plus rising spectral centroid/flux over 4–16 bars, often with a drum-stem dropout or snare roll (an onset-density increase) just before the boundary. A drop is a downbeat at a segment boundary where low-band (bass stem) energy and loudness jump sharply after a low-energy gap. These map naturally to fountain "tension" (rising heights, building chase speed) and "release" (full-jet hit on the drop downbeat).
- Energy arc: compute EBU R128 short-term (3 s) or momentary (400 ms) loudness per beat, normalise it per song, and smooth it at bar level. Use it to scale height, the number of active groups and the colour intensity.

### Gaps
- No modern (2023–2026) open drop/build-up model with a confirmed licence was found.
- pyloudnorm and librosa licences were not verified this session. (Prior knowledge, unverified: pyloudnorm is MIT and librosa is ISC.)

## 5. Emotion / mood and embeddings

### Takeaway
Essentia's ready-made mood, arousal/valence and danceability models are the most complete set, with ONNX and TF.js versions, but they are CC BY-NC-SA 4.0. Commercial use needs a proprietary licence from MTG. MERT and MuQ embedding weights are CC-BY-NC. LAION CLAP may be Apache-2.0 (unconfirmed), making it the likely commercially usable route for zero-shot "mood → palette" via text prompts.

### Cited Findings
- Essentia models are CC BY-NC-SA 4.0. They are "also available under a proprietary license on request" from MTG — [Essentia models](https://essentia.upf.edu/models.html)
- Available models: binary moods (aggressive, happy, party, relaxed, sad) on VGGish/YAMNet/Discogs-EffNet/MusiCNN/OpenL3 backbones; moods_mirex (5 clusters); mtg_jamendo_moodtheme (56 classes); arousal/valence regression (1–9) trained on DEAM, emoMusic, MuSe; danceability; genre_discogs400/519 — [Essentia models](https://essentia.upf.edu/models.html)
- Formats: TensorFlow .pb + JSON metadata; some also as TF.js and ONNX (some ONNX with dynamic batch) — [Essentia models](https://essentia.upf.edu/models.html)
- MuQ / MuQ-MuLan weights are CC-BY-NC 4.0 — [MuQ README](https://huggingface.co/spaces/ASLP-lab/SongFormer/blob/main/src/third_party/MuQ/README.md). MERT-v1-330M is CC-BY-NC 4.0 and MERT-v2-FullSong is CC BY-NC 4.0 (third-party listing) — [mixpeek MERT-v2](https://mixpeek.com/model/m-a-p/MERT-v2-FullSong); [HF MERT-v2-FullSong](https://huggingface.co/m-a-p/MERT-v2-FullSong)
- LAION CLAP HTSAT-fused is listed as Apache-2.0 (aggregator only, not confirmed against LAION) — [aggregator](https://thegtmdirectory.com/models/laion-clap-htsat-fused/clap-htsat-fused)

### Inferences
- Mood → colour mapping: use arousal for saturation, brightness and speed, and valence for hue (warm against cool), per segment. With CLAP, compute the cosine similarity of segment audio embeddings against text prompts ("euphoric", "melancholic", "triumphant", "calm") and map each prompt to a palette. This needs no NC-licensed classifier if CLAP is confirmed Apache-2.0.
- A licence-free fallback: hand-crafted arousal from loudness, tempo, onset density and spectral centroid, and rough valence from major/minor mode estimation (key detection). This is crude but shippable.
- Licensing the Essentia models from MTG is a realistic commercial option if the accuracy matters.

### Gaps
- Accuracy figures (R², F1) for the Essentia mood and arousal/valence models were not retrieved.
- CLAP licence not confirmed from the LAION repo. MusiCNN licence not checked.

## 6. Vocals: activity, lyrics alignment, pitch

### Takeaway
Vocal activity can be derived cheaply from the separated vocal stem's RMS envelope (with gating). Pitch tracking options include PESTO (~130k params, 12x real time on CPU) and CREPE/torchcrepe. Lyrics alignment via Whisper derivatives is possible, but no licences or singing accuracy were verified this session.

### Cited Findings
- PESTO is a self-supervised pitch estimator with ~130k parameters, reported to run 12x faster than real time on a consumer CPU — [PESTO, Sony CSL](https://cslmusicteam.sony.fr/news/new-paper-pesto-a-novel-method-for-pitch-estimation-with-a-self-supervised-transposition-equivariant-objective/); [arXiv 2309.02265](https://arxiv.org/abs/2309.02265)

### Inferences
- Vocal phrases are contiguous regions where the vocal-stem loudness is above a threshold, merged across gaps under ~300 ms. They map well to "melody" fountain elements: an arc or sweep that follows a phrase, with height tracking the pitch contour (PESTO or pYIN on the vocal stem).
- Word-level lyrics alignment is probably overkill for fountains. Phrase onsets and offsets plus the pitch contour carry most of the choreographic value.
- (Prior knowledge, unverified: OpenAI Whisper code and weights are MIT; stable-ts is MIT; torchcrepe is MIT; CREPE is MIT; PESTO is LGPL-3.0; librosa pYIN is ISC. Verify before use.)

### Gaps
- Licences for stable-ts, WhisperX, torchcrepe, CREPE and PESTO were not confirmed this session.
- No sourced accuracy for Whisper-based lyrics alignment on sung vocals, or for non-English (Amharic) lyrics.

## 7. Non-Western music (Ethiopian / East African / Arabic) and compound meter

### Takeaway
There is effectively no MIR literature or benchmark for beat tracking on Ethiopian music, and none was found for Arabic maqam/iqa'at either. Models are trained mostly on Western 4/4 and 3/4 data. Expect degraded downbeat accuracy and tempo-octave or meter confusions on 6/8 and 12/8 grooves (e.g. Ethiopian chik-chika, reportedly 6/8 or 12/8). Tempo/meter override controls are therefore essential.

### Cited Findings
- Training data skews toward 3/4 and 4/4. Downbeat detection relies on chord-change cues that may be weak in non-Western traditions. Annotating complex meters requires culturally aware experts — [Carnatic meter tracking 2025](https://arxiv.org/pdf/2509.11241); [TISMIR article](https://transactions.ismir.net/articles/170)
- The performance of state-of-the-art deep learning models on Carnatic music "remains largely unexplored" — [arXiv 2509.11241](https://arxiv.org/abs/2509.11241v1)
- Human-in-the-loop adaptation (Candombe, Bambuco, Piano Phase) yielded F-measure gains of 2–5x over state of the art with minimal user annotation. Transfer learning with small annotated sets worked for Greek folk music — [ISMIR 2021](https://archives.ismir.net/ismir2021/paper/000065.pdf); [UC thesis/paper](https://baes.uc.pt/bitstream/10316/95810/1/electronics-10-01518%20%281%29.pdf)
- Beat This achieves 99.7 F1 on Candombe (Afro-Uruguayan) in cross-validation, but this is in-distribution training data — [Beat This! paper](https://arxiv.org/html/2407.21658)
- Chik-chika is described as 6/8 or 12/8 (an unsourced promotional page, low reliability) — [events listing](https://events.musicofourdesire.com/events/Los-Angeles/genre/amharic-pop/tonight)
- All-In-One labels transferred well to Chinese pop (0.834 ACC on SongFormBench-CN), suggesting structure labels generalise across pop idioms — [SongFormer paper](https://arxiv.org/html/2510.02797v2)

### Inferences
- Design for correction: let users tap or nudge the tempo, set the beats-per-bar (3, 4, 6 or 12), and shift the downbeat. Human-in-the-loop correction yields large gains, per the literature above.
- Beat This has no DBN meter constraint, which favours compound meters in principle, but this is untested on Ethiopian material. A small in-house annotated set of Ethiopian and Arabic songs (20–50 tracks) is recommended for validation, and possibly for fine-tuning under beat_this's MIT licence.
- Energy, onset and stem-based choreography is largely culture-agnostic. Only beat, downbeat and section labels are at risk.

### Gaps
- No Ethiopian, Eritrean or Arabic beat-tracking evaluation was found. This is a real research gap, not a search failure.

## 8. Packaging and time budget for a 4-min song on a laptop CPU

### Takeaway
A bundled PyInstaller Python (PyTorch or onnxruntime) backend is the realistic route. Stem separation dominates: about 4.5–6 min with HTDemucs on CPU. Everything else (beat_this small, loudness, novelty, PESTO, CLAP) plausibly adds under 1 min. Browser/WebGPU is feasible only for the small models.

### Cited Findings
- HTDemucs CPU time is ~1.5x track duration — [Demucs README](https://github.com/facebookresearch/demucs). The ONNX export is ~1.31x faster than PyTorch on CPU — [stemsplit.io](https://stemsplit.io/blog/htdemucs-ft-onnx-export.md)
- Essentia offers ONNX and TF.js variants of some models — [Essentia models](https://essentia.upf.edu/models.html)
- A Mel-RoFormer ONNX fp16 build is published, targeted at GPU — [audiojs/mel-roformer](https://huggingface.co/audiojs/mel-roformer)
- PESTO runs 12x real time on CPU — [Sony CSL](https://cslmusicteam.sony.fr/news/new-paper-pesto-a-novel-method-for-pitch-estimation-with-a-self-supervised-transposition-equivariant-objective/)
- All-In-One requires NATTEN, which needs a manual or source build on Windows — [all-in-one](https://github.com/mir-aidj/all-in-one)

### Inferences
- Suggested commercial-safe pipeline (pending licence checks):
  1. Demucs htdemucs 4-stem in ONNX (~4–5 min CPU; cache the result per song hash).
  2. beat_this small model for beats and downbeats (seconds).
  3. Novelty and energy segmentation, plus All-In-One labels if the madmom and NATTEN issues are resolved.
  4. EBU R128 loudness and per-stem envelopes and onsets.
  5. Vocal phrases plus a PESTO pitch contour.
  6. Mood from CLAP prompts or hand-crafted arousal/valence.

  Total time is about 5–7 min on CPU, or under 1 min on a GPU.
- Offer a "fast mode" that skips separation (beats, loudness and novelty on the full mix only, under 30 s), with an optional background "full analysis".
- Avoid in commercial builds without a licence: madmom models, Essentia models, MERT, MuQ (and therefore SongFormer), and CC-BY-NC-SA RoFormer weights.

### Gaps
- No measured end-to-end CPU timings for beat_this, All-In-One, CLAP or SongFormer.
- onnxruntime-node or WebGPU compatibility of the HTDemucs ONNX graph (STFT ops) was not verified.
