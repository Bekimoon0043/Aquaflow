# Audio feature extraction for music-synchronised fountain choreography

Scope: what to compute from a song or its stems (drums, bass, vocals, other) to drive a dancing-water fountain, with parameters a JavaScript implementation can copy. Defaults are quoted from library source code (librosa, madmom, SuperFlux, WLED) where possible. Those are primary sources for the defaults, but not peer-reviewed evaluations.

## 1. Frequency band splits (sub-bass to brilliance, alternatives, instrument isolation)

### Takeaway
The common 7-band audio-engineering split is 20-60 / 60-250 / 250-500 / 500-2k / 2k-4k / 4k-6k / 6k-20k Hz. Practical light-organ code (WLED) uses 16 log-spaced channels from about 43 Hz to 9.3 kHz, with per-band pink-noise gain correction that rises steeply toward the treble.

### Cited Findings
- Teach Me Audio's 7-band scheme:
  - Sub-bass 20-60 Hz (bass guitar's lowest note is about 41 Hz)
  - Bass 60-250 Hz
  - Low midrange 250-500 Hz
  - Midrange 500 Hz-2 kHz
  - Upper midrange 2-4 kHz (percussive attack; vocals most prominent here)
  - Presence 4-6 kHz
  - Brilliance 6-20 kHz

  [Teach Me Audio](https://www.teachmeaudio.com/mixing/techniques/audio-spectrum)
- The MSGEQ7 7-band analyser chip, widely used in LED visualisers, has centre frequencies of 63 Hz, 160 Hz, 400 Hz, 1 kHz, 2.5 kHz, 6.25 kHz and 16 kHz (about 1.3-octave spacing). Source: search-result summary of the MSGEQ7 datasheet/product page; the datasheet itself was not opened. [Little Bird MSGEQ7](https://littlebirdelectronics.com.au/products/graphic-equalizer-display-filter-msgeq7.json)
- WLED AudioReactive analysis settings: 22,050 Hz sample rate, 512-point FFT (43 Hz bins, 256 usable), Blackman-Harris window, FFT task about every 21 ms. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)
- WLED maps FFT bins to 16 GEQ channels as follows. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)

  | Channel | Approx. range (Hz) | Notes |
  |---|---|---|
  | 0 | 43-86 | |
  | 1 | 86-129 | |
  | 2 | 129-216 | |
  | 3 | 216-301 | |
  | 4 | 301-430 | |
  | 5 | 430-560 | |
  | 6 | 560-818 | |
  | 7 | 818-1120 | |
  | 8 | 1120-1421 | |
  | 9 | 1421-1895 | |
  | 10 | 1895-2412 | |
  | 11 | 2412-3015 | |
  | 12 | 3015-3704 | |
  | 13 | 3704-4479 | |
  | 14 | 4479-7106 | scaled ×0.88 |
  | 15 | 7106-9259 | scaled ×0.70 |

- WLED's pink-noise correction gains for channels 0-15 are 1.70, 1.71, 1.73, 1.78, 1.68, 1.56, 1.55, 1.63, 1.79, 1.62, 1.80, 2.06, 2.47, 3.35, 6.83 and 9.55. Treble bands need about 4-6× more gain than bass bands to look equally active. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)
- FastLED's WLED-compatible 16-bin mode uses log spacing from 20 to 16,000 Hz. Its example groupings are bass = bins 0-1 (20-80 Hz), mid = bins 6-7 (320-640 Hz) and treble = bins 14-15 (5,120-16,000 Hz). The FastLED equalizer defaults to a 90-5,120 Hz range. [FastLED FrequencyBinMapper](https://fastled.io/docs/d0/ddf/classfl_1_1audio_1_1_frequency_bin_mapper.html); [FastLED equalizer.h](https://fastled.io/docs/d4/d84/equalizer_8h.html)
- In librosa, the onset-strength front end defaults to a mel spectrogram with fmax = sr/2 (sr = 22,050, n_fft = 2048, hop = 512). In madmom/SuperFlux, the front end is a log filterbank with 24 bands per octave between 30 Hz and 17 kHz. [librosa onset.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/onset.py); [SuperFlux.py](https://raw.githubusercontent.com/CPJKU/SuperFlux/master/SuperFlux.py)
- The madmom docs note that "filter banks with 24 bands per octave (i.e. quarter-tone resolution) usually yield good results" for onset detection. [madmom onsets.py](https://raw.githubusercontent.com/CPJKU/madmom/main/madmom/features/onsets.py)

### Inferences
These are engineering judgement built from the cited ranges plus the instrument ranges given in the task brief. They have not been validated against any source.

- **Kick drum:** body band 40-100 Hz (or 45-120 Hz), plus a click band of 2-5 kHz for timing precision.
  - On a full mix the bass guitar shares 40-250 Hz. Running onset detection (not energy) on 40-120 Hz is the main kick discriminator.
  - On a separated drums stem, plain 40-120 Hz energy plus onsets is sufficient.
- **Snare:** body 150-250 Hz and crack 2-5 kHz. Use a coincident onset in both bands with no onset at 40-100 Hz.
- **Hi-hats and cymbals:** above 6-8 kHz (the Teach Me Audio "brilliance" band; WLED channel 15 at 7-9 kHz).
- **Bass guitar:** 40-250 Hz, best taken from the bass stem rather than by band-pass.
- **Vocals:** fundamental 80-1,100 Hz, intelligibility/presence 1-4 kHz. On a full mix, vocals cannot be isolated by band-pass, because guitars, keys and snare overlap them. Use the vocals stem.
- **Recommended bands for a 2048-FFT analyser at 44.1 kHz (21.5 Hz bins):**

  | Band | Range (Hz) |
  |---|---|
  | sub | 20-60 |
  | bass | 60-250 |
  | low-mid | 250-500 |
  | mid | 500-2k |
  | high-mid | 2k-4k |
  | presence | 4k-6k |
  | brilliance | 6k-16k |

  - Normalise each band by its own running maximum (AGC) rather than by a global maximum, because of the steep spectral tilt shown by WLED's pink correction.
  - A 512-point FFT at 22 kHz (43 Hz bins, as in WLED) cannot resolve sub-bass from bass. Use 2048 or more points, or a 4096-point FFT for the bottom bands.

### Gaps
- The AES, iZotope and Sweetwater band definitions were not fetched, so there is no cross-check of the 7-band edges. Edges vary between sources, for example presence is sometimes given as 4-6 kHz and sometimes as 2-5 kHz.
- No sourced numbers were retrieved for Bark (24 critical bands) or 1/3-octave ISO centre frequencies. These are standard (ISO 266 preferred frequencies 25 Hz-20 kHz; Zwicker Bark) but not cited here.
- No published study evaluates band edges for kick/snare/hat isolation. The drum-transcription literature would be the source.

## 2. Onset detection (spectral flux, SuperFlux, complex domain, adaptive thresholds, peak picking)

### Takeaway
Use log-magnitude spectral flux, half-wave rectified, on a log-frequency or mel filterbank. SuperFlux adds a 3-bin maximum filter before differencing to suppress vibrato. Then normalise the novelty curve and peak-pick against a moving local mean plus a fixed delta, with a 20-30 ms minimum gap between onsets.

### Cited Findings
- **librosa `onset_strength_multi` defaults:** sr 22,050, n_fft 2048, hop 512 (23.2 ms, 43 fps), lag 1, max_size 1 (no max filter), detrend False, center True, mel feature, mean aggregation across bands. The `channels=` argument gives per-band (multi-channel) onset envelopes. [librosa onset.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/onset.py)
- **librosa `onset_detect` peak-picking defaults**, specified in seconds and converted to frames. [librosa onset.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/onset.py)
  - pre_max = 30 ms, post_max = 0 ms (+1 frame)
  - pre_avg = 100 ms, post_avg = 100 ms (+1 frame)
  - wait = 30 ms
  - delta = 0.07 on an envelope normalised to [0, 1]
  - backtrack False
  - A peak must:
    - be the local maximum over [n − pre_max, n + post_max];
    - be at least the local mean over [n − pre_avg, n + post_avg] plus delta;
    - be more than `wait` frames after the previous onset.
- **SuperFlux reference implementation defaults (Böck & Widmer, DAFx 2013):** [SuperFlux.py](https://raw.githubusercontent.com/CPJKU/SuperFlux/master/SuperFlux.py)
  - frame 2048, fps 200 (hop about 220.5 samples at 44.1 kHz)
  - filterbank of 24 bands per octave, 30 Hz-17 kHz
  - log magnitude log(1·X + 1)
  - frequency maximum filter of 3 bins
  - diff_frames from ratio 0.5, which gives 2 frames for a 2048 Hann window at 44.1 kHz
  - threshold 1.1 (about 0.25 if LGD weighting is used)
  - pre_avg 0.15 s, pre_max 0.01 s, post_avg 0 s, post_max 0.05 s
  - combine 30 ms
- **madmom `OnsetPeakPickingProcessor` class defaults:** fps 100, threshold 0.5, combine 0.03 s, and smoothing, pre/post avg/max and delay all 0. The `SpectralOnsetProcessor` example uses `superflux` at fps 200 with 24 bands. [madmom onsets.py](https://raw.githubusercontent.com/CPJKU/madmom/main/madmom/features/onsets.py)
- **Dixon (DAFx 2006)** compared magnitude (spectral flux), phase (weighted phase deviation) and complex-domain (rectified complex difference) detection functions. Datasets were 1,060 onsets of mixed instruments and 106,054 piano onsets. A "similarly high level of performance" is obtainable from all three, which contradicts earlier claims that complex-domain methods are superior. [DAFx archive](https://dafx.de/paper-archive/details/_kscRgr98aSFW4l-j1YJuA)
- **WLED's "beat"** is a threshold peak detector, not true onset detection. Settings: FFT bin above maxVol (default 31) with a minimum 100 ms gap; time-domain peaks above 0.5 with an 80 ms gap; flag auto-cleared after 50 ms. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)

### Inferences
- **JavaScript recipe for offline analysis at 44.1 kHz:**
  1. STFT 2048, Hann window, hop 441 (100 fps), or hop 512 (86 fps).
  2. Log-frequency filterbank at 12-24 bands/octave, or 40-128 mel bands.
  3. Compress with log(1 + λ·|X|), λ about 1-100.
  4. Apply a 3-bin maximum filter across frequency (SuperFlux).
  5. Compute the difference against frame t − 1 or t − 2 and half-wave rectify.
  6. Sum per band group to get per-band onset curves (kick 40-120 Hz, snare 150-250 Hz + 2-5 kHz, hats above 6 kHz).
  7. Peak-pick with the librosa parameters (30 ms local max, 100 ms mean window, delta 0.05-0.1 after normalisation, 30 ms wait).
- For fountains, mechanical valve and pump response (tens to hundreds of ms) dwarfs onset-timing error, so 10 ms precision is not needed. Use `wait` of 50-100 ms for valve triggers to avoid chatter.
- Run onset detection per stem (drums stem → kick/snare/hat bands). This is far more robust than doing it on the full mix.

### Gaps
- Dixon 2006's exact F-measures and peak-picking constants were not extracted, because the PDF could not be parsed in this environment.
- The SuperFlux paper's reported F-measures were not retrieved.
- Bello et al. 2005 (onset tutorial) was not fetched.

## 3. Beat, tempo, downbeat tracking

### Takeaway
librosa implements Ellis 2007: autocorrelation tempo estimation with a log-normal prior centred at 120 BPM, then dynamic-programming beat placement with tightness 100. madmom's RNN/DBN trackers are the stronger alternative, but they are Python-only. For a fountain, compute beats and downbeats offline once and store them as a timeline.

### Cited Findings
- **librosa `beat_track` defaults:** sr 22,050, hop 512, start_bpm 120, tightness 100, trim True. Tempo is estimated from the onset envelope when bpm is not given. [librosa beat.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/beat.py)
- **librosa `tempo` defaults:** [librosa rhythm.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/feature/rhythm.py)
  - start_bpm 120, std_bpm 1.0 (in octaves)
  - ac_size 8.0 s autocorrelation window
  - max_tempo 320 BPM
  - global mean aggregation
  - prior log-weight −0.5·((log2(bpm) − log2(120))/1.0)², added to log1p(1e6·tempogram) before the argmax
- **librosa `plp` (predominant local pulse, a per-frame pulse curve):** tempo_min 30, tempo_max 300, win_length 384 frames, uniform prior. [librosa beat.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/beat.py)

### Inferences
- **JavaScript beat tracker:**
  1. Autocorrelate the onset envelope (100 fps) over an 8 s window.
  2. Weight lags by a log-Gaussian centred at 120 BPM with a 1-octave σ and pick the tempo.
  3. Run the Ellis DP: score(t) = onset(t) + max over τ of [score(τ) − tightness·(log((t − τ)/period))²], with tightness about 100.
  4. Backtrace from the best final beat.
- Expect octave errors (half or double tempo), especially for tempos near 60-80 or 160-180 BPM. Let the operator override the tempo, or tap.
- **Downbeat and bar detection** (no number retrieved):
  - Simple heuristic: assume 4/4 and pick the beat phase (0-3) whose beats have the highest summed low-band (kick/bass) onset strength. Combine this with the chroma-change (harmonic-change) peaks that tend to fall on bar 1.
  - Phrase boundaries in pop/EDM are typically 4, 8 or 16 bars long.

### Gaps
- Ellis 2007's exact front end (believed to be 8 kHz resampling, 32 ms window, 4 ms hop, 40 mel bands) and its MIREX 2006 accuracy were not verified, because the PDF was not parseable. Treat these as unconfirmed.
- No MIREX beat/downbeat F-measures for librosa vs madmom were retrieved. madmom's DBN beat-tracker and downbeat-tracker parameters were not fetched.

## 4. Envelope features (RMS/loudness, attack/release smoothing, dB normalisation, LUFS)

### Takeaway
Light-organ practice uses asymmetric smoothing: a fast attack (time constant about 20-80 ms) and a slow release (about 0.5-2 s), plus a slow automatic gain control (AGC) time constant (seconds) to normalise level.

### Cited Findings
- **WLED FFT output smoothing:**
  - Rise: fftAvg = 0.75·new + 0.25·old, which settles in about 2 cycles (about 50 ms) at the 21 ms FFT cycle.
  - Fall coefficient depends on decayTime: 0.22 if under 1 s, 0.17 if under 2 s (the default), 0.14 if under 3 s, otherwise 0.10.

  [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)
- **WLED dynamics limiter:** attack 80 ms and decay 1,400 ms by default. The signal-level average uses sampleAvg = (15·old + new)/16. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)
- **WLED AGC** is a PI controller with three presets (normal / vivid / lazy). Gain is clamped to 1/64-32. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)

  | Parameter | normal | vivid | lazy |
  |---|---|---|---|
  | Kp | 0.6 | 1.5 | 0.65 |
  | Ki | 1.7 | 1.85 | 1.2 |
  | Fast follow (about 0.15 s) | 1/192 | 1/128 | 1/256 |
  | Slow follow (about 2-15 s) | 1/6144 | 1/4096 | 1/8192 |
  | Output smoothing | 1/12 | 1/6 | 1/16 |

- **scottlawsonbc audio-reactive-led-strip** uses asymmetric exponential filters (higher alpha means faster response). [visualization.py](https://raw.githubusercontent.com/scottlawsonbc/audio-reactive-led-strip/master/python/visualization.py)

  | Filter | alpha_rise | alpha_decay |
  |---|---|---|
  | gain normalisation | 0.99 | 0.001 |
  | mel_gain | 0.99 | 0.01 |
  | mel smoothing | 0.99 | 0.5 |
  | energy pixel buffer | 0.99 | 0.1 |
  | red channel | 0.99 | 0.2 |
  | blue channel | 0.5 | 0.1 |

  This is near-instant rise with slow fall, and a very slow-decaying running-max gain.

### Inferences
- **Recommended control envelope per band or stem:**
  1. RMS over 2048-sample frames at 50-100 fps.
  2. Convert to dB, then map −60…0 dBFS relative to the track's (or stem's) 95th-percentile level onto 0-1.
  3. One-pole smoothing with α = 1 − exp(−Δt/τ): τ_attack about 30-80 ms, τ_release about 300-1,500 ms.
  4. Add AGC as a running max with a slow decay (τ about 5-15 s) for live input. Offline, normalise against whole-song statistics instead.
- Water has inertia, so pump-height control should use a longer release (about 0.5-2 s) than lights. Jet/valve "shots" should come from onsets, not from the envelope.
- **LUFS (ITU-R BS.1770) loudness** is useful for normalising whole songs so the same choreography gain works across tracks. Momentary (400 ms) and short-term (3 s) windows are the standard; this is from general knowledge, not fetched in this session.

### Gaps
- The ITU-R BS.1770 / EBU R128 text (K-weighting filter coefficients, 400 ms / 3 s windows, −70 LUFS absolute gate) was not fetched in this session.
- The QLC+, Hyperion and Resolume/MadMapper audio-analysis smoothing constants were not retrieved.

## 5. Spectral centroid, flatness, pitch (YIN/pYIN/CREPE), chroma/key/chord

### Takeaway
pYIN (librosa defaults: 2048 frame, 512 hop, 100 thresholds, Beta(2, 18) threshold prior) on the vocals stem gives a melody contour that can drive nozzle position, sweep or height. Centroid gives brightness, which can drive colour temperature or spray type.

### Cited Findings
- **librosa `yin` defaults:** fmin and fmax required, sr 22,050, frame_length 2048, hop = frame_length/4 = 512, trough_threshold 0.1. Reference: de Cheveigné & Kawahara, JASA 111(4), 2002. [librosa pitch.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/core/pitch.py)
- **librosa `pyin` defaults:** frame 2048, hop 512, n_thresholds 100, beta_parameters (2, 18), boltzmann_parameter 2, resolution 0.1 semitone, max_transition_rate 35.92 octaves/s, switch_prob 0.01, no_trough_prob 0.01. Outputs are f0, voiced_flag and voiced_prob. Reference: Mauch & Dixon, ICASSP 2014. [librosa pitch.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/core/pitch.py)

### Inferences
- **Choreography mappings** (design suggestions, not sourced):
  - Spectral centroid (Hz, smoothed over about 200 ms) → brightness, colour hue or temperature.
  - Spectral flatness (0 = tonal, 1 = noisy) → mist/fog vs solid jets; high flatness suggests cymbal washes, risers or white-noise sweeps in EDM build-ups.
  - pYIN f0 on the vocals stem (fmin about 65 Hz, fmax about 1,100 Hz) → nozzle sweep angle or jet height following the melody. Gate by voiced_prob > 0.5.
  - Chroma (12-bin) → harmonic mood or colour palette; changes in chroma flag chord changes and bar lines.
  - Key (major/minor) → overall palette.
- A full YIN in JavaScript is cheap: a difference function over 2048 samples per hop. The pYIN HMM is more work. A practical route is YIN plus median filtering (5-9 frames) plus a voicing threshold.

### Gaps
- CREPE (Kim et al. 2018) parameters and licence were not fetched. CREPE uses 16 kHz input, 1024-sample frames and 10 ms steps per general knowledge, but this is unverified here.
- No sources were retrieved for key detection (Krumhansl-Schmuckler profiles) or chord-recognition accuracy.
- The spectral centroid and flatness formulas are standard, but no source was fetched.

## 6. Structural segmentation (verse/chorus/drop/build-up)

### Takeaway
Foote's checkerboard-kernel novelty on a self-similarity matrix of beat-synchronous features finds section boundaries. The kernel size sets the time scale, typically 16-64 beats or tens of seconds. EDM drops are detectable from energy, low-band and texture changes; the leading academic reference is Yadati et al., ISMIR 2014.

### Cited Findings
- The checkerboard kernel width determines which segment lengths the novelty score is sensitive to, and multiple widths can be combined. [FXPAL TRECVID paper](https://www-nlpir.nist.gov/projects/tv2003/active/hidden/confdetails/papers/fxpal.paper.pdf)
- Example kernel sizes:
  - 50 × 50 frames at 0.5 s resolution (about 25 s), from a tabla segmentation study. [arXiv 2211.08790](https://arxiv.org/pdf/2211.08790)
  - A 32 × 32 Gaussian-weighted checkerboard. [Kauppinen et al. WASPAA 2013](https://homepages.tuni.fi/tuomas.virtanen/papers/Kauppinen-WASPAA2013-final.pdf)
  - A 32-beat Gaussian kernel. [foote.py segmentation repo](https://code.soundsoftware.ac.uk/hg/segmentation/file/294f66d285af/foote.py)
- Tutorial with implementation: [AudioLabs FMP C4S4 Novelty Segmentation](https://audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S4_NoveltySegmentation.html)
- **Yadati, Larson, Liem & Hanjalic, "Detecting Drops in Electronic Dance Music", ISMIR 2014, pp. 143-148:** a two-stage approach that models the drop's sound characteristics, then adds temporal structure through a "watershed moment". [ISMIR 2014 PDF](https://archives.ismir.net/ismir2014/paper/000297.pdf)
- **Other drop/build-up work:**
  - A MediaEval 2014 multimodal drop-prediction entry. [CEUR-WS](https://ceur-ws.org/Vol-1263/mediaeval2014_submission_88.pdf)
  - EDMFormer (2026), a transformer for EDM structure with the EDM-98 dataset. [arXiv 2603.08759](https://arxiv.org/abs/2603.08759)
  - An open-source detector with 29 features and XGBoost that claims F1 0.95 vs 0.71 for the original. This claim is unverified and self-reported. [felixmeyer6/drop-detector](https://github.com/felixmeyer6/drop-detector)

### Inferences
- **JavaScript recipe:**
  1. Compute beat-synchronous features: chroma (12), MFCC 1-13 or band energies, and RMS.
  2. Build a cosine self-similarity matrix.
  3. Slide a Gaussian checkerboard kernel 16-32 beats wide (4-8 bars in 4/4).
  4. Peak-pick the novelty curve with about an 8-bar minimum spacing.
  5. Snap the boundaries to downbeats.
- **Simple EDM heuristics:**
  - Build-up: rising spectral centroid or flatness, rising onset density (snare rolls), and falling sub-bass energy over 8-16 bars.
  - Drop: an abrupt jump in sub-bass/bass RMS (for example more than 6-10 dB within 1 beat) right after a low-bass section, aligned to a downbeat.
  - Use these to schedule a fountain "finale" or full-height burst.

### Gaps
- Foote 2000's original kernel sizes and the Yadati feature list and accuracy figures were not extracted.
- Typical section lengths in seconds for pop/EDM are not sourced here; 8/16-bar phrases is a domain convention.

## 7. Stem separation (Demucs, Spleeter, Open-Unmix) vs DSP HPSS

### Takeaway
Demucs v4 (HT Demucs) is the quality leader at about 9.0 dB SDR on MUSDB-HQ, with MIT-licensed code, but it is archived and needs about 1.5× track length to process. Open-Unmix UMX-L is about 4.9-7.2 dB per stem, and its weights are CC BY-NC-SA (non-commercial). Median-filter HPSS (kernel 31) is a cheap, licence-free JavaScript fallback that splits a mix into percussive and harmonic parts only.

### Cited Findings
- **Demucs (Défossez):** [facebookresearch/demucs](https://github.com/facebookresearch/demucs)
  - HT Demucs reaches 9.00 dB SDR on the MUSDB HQ test set; the fine-tuned v4 gets 9.0, and Hybrid Demucs v3 gets 7.7.
  - Models:
    - htdemucs (default; 7.8 s max segment)
    - htdemucs_ft (about 4× slower)
    - htdemucs_6s (adds piano and guitar; piano is weak)
    - mdx_extra (trained including the MUSDB test set, so its scores are not clean)
  - Code licence is MIT; the weight licence is not stated.
  - Speed is about 1.5× track duration. GPU needs at least 3 GB, about 7 GB with default arguments.
  - The repository is archived; the maintained fork is adefossez/demucs.
- **Spleeter (Deezer):** MIT code; pretrained models in 2 stems, 4 stems (vocals/drums/bass/other) and 5 stems (+piano); "100x faster than real-time" on GPU. The README gives no SDR and no separate model licence. [deezer/spleeter](https://github.com/deezer/spleeter)
- **Open-Unmix:** MIT code. UMX-L weights are "only licensed for non-commercial use (CC BY-NC-SA 4.0)". umxhq is full bandwidth (22.05 kHz); umx is limited to 16 kHz. [sigsep/open-unmix-pytorch](https://github.com/sigsep/open-unmix-pytorch)

  | Target | UMX | UMXHQ | UMXL |
  |---|---|---|---|
  | Vocals | 6.32 | 6.25 | 7.21 |
  | Bass | 5.23 | 5.07 | 6.02 |
  | Drums | 5.73 | 6.04 | 7.15 |
  | Other | 4.02 | 4.28 | 4.89 |

- **librosa `hpss` defaults:** kernel_size 31 (both horizontal and vertical median filters), power 2.0, mask False, margin 1.0. References: Fitzgerald, DAFx 2010; Driedger, Müller & Disch, ISMIR 2014 (margin > 1 adds a residual component). [librosa decompose.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/decompose.py)

### Inferences
- **For a commercial fountain product:**
  - Demucs (MIT code) is the best candidate, but confirm the weight licence first.
  - Avoid UMX-L weights (non-commercial).
  - Run separation offline, server-side or desktop, once per song, then cache the stems.
- **JavaScript HPSS** (free, real-time capable):
  1. Take the STFT magnitude.
  2. Median-filter across time (31 frames) to get the harmonic estimate H, and across frequency (31 bins) to get the percussive estimate P.
  3. Build soft masks P²/(H² + P²).
  4. Feed the percussive part to onset detection and the harmonic part to chroma/pitch.

  This gives drums vs tonal, but not bass vs vocals.

### Gaps
- No SDR for Spleeter was retrieved (its wiki has it).
- No per-stem SDR for htdemucs was retrieved.
- Weight licences for Demucs and Spleeter models were not confirmed.
- No browser/ONNX runtime benchmarks were retrieved.

## 8. Control frame rates and latency

### Takeaway
Practical systems analyse at about 43-100 fps (hop 10-23 ms) and send control data at about 50 Hz (20 ms). WLED's FFT cycle is about 21 ms with 20 ms UDP sync. Onset research uses 100-200 fps, which is more than a fountain needs.

### Cited Findings
- WLED timing: FFT task about every 21 ms, UDP audio-sync transmit every 20 ms (50 Hz), receive checked every 10 ms. [WLED audio_reactive.cpp](https://raw.githubusercontent.com/wled/WLED/main/usermods/audioreactive/audio_reactive.cpp)
- librosa defaults are hop 512 at 22,050 Hz (about 43 fps). SuperFlux uses 200 fps and madmom peak picking assumes 100 fps. [librosa onset.py](https://raw.githubusercontent.com/librosa/librosa/main/librosa/onset.py); [SuperFlux.py](https://raw.githubusercontent.com/CPJKU/SuperFlux/master/SuperFlux.py); [madmom onsets.py](https://raw.githubusercontent.com/CPJKU/madmom/main/madmom/features/onsets.py)

### Inferences
- **Fountain design:**
  - Analyse offline at 100 fps (hop 441 at 44.1 kHz).
  - Downsample control curves to 20-50 Hz for the PLC/DMX link (DMX512 refreshes at up to about 44 Hz per universe).
  - Pre-compensate the hydraulic delay by firing valve/pump commands earlier by the measured nozzle latency (typically tens to hundreds of ms per device). This needs per-device measurement and is not sourced.
- Because analysis is offline (pre-programmed shows), non-causal (zero-phase) smoothing and look-ahead are allowed. That removes the lag that live light-organs suffer.

### Gaps
- No sourced figures were found for water jet or valve response times.
- The DMX512 refresh rate given above is from general knowledge and was not fetched in this session.
