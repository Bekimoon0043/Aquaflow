# How the fountain industry maps music to water and light choreography

Scope note: These notes come from about 20 searches and fetches. Primary sources reached were patents (Google Patents), a TalTech master's thesis read in full, the Grand Haven Musical Fountain technical page, and press interviews with WET staff. Many manufacturer pages, especially Chinese vendor and VFD pages, are marketing material and are flagged as such. I could not retrieve OASE WECS, Lumiartecnia, Crystal Fountains, Aquatique, Laservision or Syncronorm manuals, so nothing below describes those products' internals.

---

## 1. How professional companies and their software turn music into water (manual vs automatic)

### Takeaway
At the top end (WET Design for Bellagio and Dubai, Longwood Gardens, Grand Haven, Fountain People), every show is choreographed by hand. A person places cues on a timeline that runs against the audio, with a 3D simulator in between. Big operators do not use automatic frequency-to-nozzle mapping. The two most-named timeline tools are Syncronorm Depence and the Himalaya "Choreography System". Both output DMX.

### Cited Findings
- **Manual programming is the norm.** In most automated shows the choreography is still "painstakingly programmed by hand", and some shows are still played live from a console. — [Wikipedia: Musical fountain](https://en.wikipedia.org/wiki/Musical_fountain)
- **The TalTech thesis on pre-programmed shows:** "Almost 100% of dancing fountains are pre-choreographed, which means that all control signals are pre-defined. Not real-time." It also says almost every major company uses its own proprietary software. That software lets the artist define fountain movement in the time domain for each specific song, then stores the result as a program on the controller or streams it to the controller in real time. — [Satov, TalTech MSc thesis "Development of Experimental Self-Choreographed Dancing Fountain"](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)
- **WET Design (Bellagio):** WET's proprietary simulator lets choreographers "essentially sketch the choreography offsite". Kenny Ortega's team built short sequences in "Virtualwet" before putting them on the lake. Claire Kahn (WET) reportedly said it can take a week to get two minutes right. Her stated goal is "capturing the spirit (of the song) rather than being literal". Ortega: "You try to make the water hear the music." — [ABC News: Bellagio Fountains Learn New Dances](https://abcnews.com/Travel/las-vegas-bellagio-fountains-learn-dances/story?id=15167280)
- **Kahn on leading the music:** the fountain should not follow the music; it should feel as if the music follows the fountain. She works with more than 1,000 jets in named classes: "oarsmen", "mini-shooters", "super-shooters" and "extreme shooters". — [Review-Journal: What it takes to keep Bellagio Fountains going](https://www.reviewjournal.com/?p=1502215); [yourmileagemayvary.com: How DO the Bellagio fountains work](https://yourmileagemayvary.com/2019/03/24/how-do-the-fountains-at-the-bellagio-work-anyway/). These are secondary summaries of the interviews.
- **Peter Kopik (WET director of choreography) on Game of Thrones:** the hard part was matching the score's constant intensity without exhausting the audience, so the water has to carry the same energy and drama. On the Tiësto medley he said fast EDM was a new challenge. He programmed it with the DJ at WET's California studio and then on site at Bellagio. — [Washington Times/AP 2019](https://www.washingtontimes.com/news/2019/apr/1/game-of-thrones-takes-over-bellagio-fountains-in-l/); [ET Online: Tiësto](https://www.etonline.com/music/151242_tiesto_music_comes_to_life_with_dancing_las_vegas_fountains)
- **Guest-designed show (2025):** Scott Krupa spent four months designing one Bellagio show with the WET studio. — [KTNV](https://www.ktnv.com/news/there-is-a-new-bellagio-fountains-show-coming-and-its-choreographed-by-a-guest)
- **Dubai Fountain (WET):** choreography starts in a computer simulation, then a team fine-tunes it on site. One song takes 2–4 weeks. The fountain can perform up to about 1,000 "expressions". — [The National: Dubai Fountain, the stories behind the music](https://www.thenationalnews.com/lifestyle/dubai-fountain-the-stories-behind-the-music-1.698740); [Wikipedia: Dubai Fountain](https://en.wikipedia.org/wiki/Dubai_Fountain)
- **Grand Haven Musical Fountain (USA):** proprietary choreography software in Java, playback in C#, PLC back end, audio as .wav files. Earlier systems embedded control codes in an audio track. Modern shows average about 1,500 commands per song and reach up to about 6,000. A 25-minute themed show had up to 17,000 water and lighting commands. Sweeps can follow or oppose each other, travel long or short paths, hold or oscillate, at **7 discrete speeds**. Named effects: Rings, Candelabras, Sweeps, Peacock, Voice, Bazookas, front water curtain, Helix, WAVE (50 nozzles). Lighting is 43 RGB fixtures on one DMX universe. — [Grand Haven Musical Fountain: Technical](https://www.ghfountain.org/technical)
- **Fountain People (Pool & Spa trade feature):** each display is "manually choreographed beat-by-beat to music". Water "chase" scenes are timed to the score and water movement is synchronised to crescendos. Light intensity and colour are adjusted together with the water. Shows are programmed in DMX at the office, and on-site programming takes 2–3 weeks when needed. Hardware: 52 vertical chasing nozzles, 6 robotic nozzles, 60 RGB LED fixtures, fog and mist. — [Pool & Spa Marketing: Show fountains](https://www.poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/2/)
- **Longwood Gardens (Syncronorm):** for live DJ sets the designers (Tim Martin, Nate Hart) build "foundational fountain movements" plus a library of pre-programmed lighting looks and moods. They switch, layer and fade between them live as the music changes. "Certain tempos, rhythms, and musical keys naturally evoke specific emotions." The robotic nozzles rotate 180°. — [Longwood Gardens blog, 2026-08-05](https://longwoodgardens.org/blog/2026-08-05/when-water-becomes-instrument)
- **Himalaya (Chinese manufacturer; marketing page):** fountain software uses the audio track as the timeline, usually one track per water pattern. Named tools: Himalaya Music Fountain "Choreography System" and Syncronorm Depence. Protocol is DMX/RDM. Every jet has an underwater solenoid valve for sequence, group and chase effects, and each nozzle has a pressure valve for height. — [chinamusicfountain.com: How does a music fountain work](https://chinamusicfountain.com/what-is-a-music-fountain-and-how-does-a-music-fountain-work/)
- **Syncronorm's single-programming claim:** the same Depence programming drives both the visualiser and the real fountain, so a show is programmed only once. The vendor describes this as new because visualisation and programming used to be separate jobs. — [SyncD Connect: water show choreography](https://www.syncdconnect.com/post/water-show-choreography-company-india) (vendor page)
- **DMX512 timing:** a full 512-channel universe refreshes at up to about 44 Hz. — [Huiqi Fountain: DMX control systems](https://www.huiqifountain.com/blogs/brand/dmx-fountain-control-system) (vendor page; the figure matches the DMX512 standard)
- **Chinese practice (encyclopedic source):** music fountains are program-controlled fountains with a music control system added. Audio or MIDI is decoded and turned into water and light commands. One software package claims to segment audio at about 10 ms precision and auto-classify emotion ("激昂/欢快/悲哀", roughly "rousing/cheerful/sad") before generating control signals. — [Baidu Baike: 音乐喷泉 (music fountain)](https://baike.baidu.com/item/%E9%9F%B3%E4%B9%90%E5%96%B7%E6%B3%89/1632227) (unverified claim)

### Inferences
- An AquaFlow "auto-choreography" feature competes with hand programming, which takes days to weeks per song. The realistic goal is a good first draft that a human then edits on the timeline, which is what every professional workflow above implies. It should not try to be a real-time spectrum-follower.
- The Grand Haven design (discrete effect "vocabularies" such as sweeps with 7 speeds, follow/oppose and hold/oscillate) is a good model for a parameterised effect library that an algorithm can choose from.

### Gaps
- No primary manuals or documentation found for OASE WECS, Crystal Fountains, Lumiartecnia, Fontana, Safe-Rain, Aquatique Show or Laservision. Nothing found on whether Depence has audio analysis or auto-programming (my search found no evidence either way).
- No WET patent on automatic choreography was found in this pass.

---

## 2. Chinese "music fountain controllers" and real-time audio-frequency modes: band splits, channels, mapping

### Takeaway
Real-time "声控" (sound-control) controllers split the audio into 3 bands (low, mid, high), at most about 6. Each band's envelope drives either a VFD pump (height) or on/off solenoid groups. I found no commercial datasheet with exact crossover frequencies. The only concrete Hz values come from the classic "colour organ" design: Low 60–150 Hz, Mid 200–600 Hz, High 800–2200 Hz. Engineers who built this report that it looks like "jumping water" and lacks artistic value.

### Cited Findings
- **Colour-organ bands used for a fountain prototype:** "Low Channel 60-150 Hz, Mid channel 200-600 Hz, and High channel 800-2200 Hz", each driving a pump by PWM when its band has energy. Verdict: "from technical point of view it looks fine, but from artistic point of view it is a total disaster … not the Dancing fountain but just a jumping water." The author recommends this light-organ approach only for idle/standby mode and says "Show mode" needs a different method. — [Satov, TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)
- **What replaced it in the thesis:** an artist-configured library of musical patterns. Examples given: a specific instrument (bass drum, splash cymbal, violin), a specific note, a specific moment of the song, and "quick jump from quiet to loud". Each pattern is mapped to a fountain movement. Detection methods: algorithmic (loudness change, Goertzel or FFT tone detection), fingerprinting, and machine learning. Example rule: "shoot from all the nozzles if there [is a] really huge change in loudness in a short moment of time." Analysis frames are under 20 ms, but water updates can be much slower. — [Satov, TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)
- **Chinese 89C51 microcontroller controller (blog plus 2018 journal article):**
  - Up to **6 frequency bands**, simplest form 3 (high, mid, low).
  - **Mid band** drives splash shapes such as "雪松" (snow pine) and "礼花" (fireworks).
  - **Mid-high band** drives rotating, swinging and straight-jet shapes.
  - Audio also drives light colour and brightness.
  - Valve flow is set by a stepper-driven valve. Since the music-to-flow relationship is about logarithmic, a lookup table converts the ADC value.
  - Debounce: pulses closer than **0.8 s are ignored for pumps** and closer than **0.5 s for valves**.
  - Delays: pump mode delays the valve 0.3 s and the music 0.4 s; valve-only mode delays the music 0.1 s.
  - VU filter capacitor: 20 µF for whole-music following, about 100 µF (slower) for choosing shape combinations.
  - In supply-type fountains the pump starts only above an amplitude threshold.
  
  — [cnblogs: 用单片机设计的音乐喷泉控制器 (music fountain controller designed with a microcontroller)](https://www.cnblogs.com/fm1029/p/15376612.html)
- **Chinese overviews:** the traditional method uses three bands (low, mid, high) for shape control, which is "not fine enough in the frequency domain". Pumps use VFD speed control that follows signal strength. Multi-function valves and universal nozzles are PLC-controlled. One vendor says delay can be trimmed on site to **0.1 s**. — summarised from [Hangzhou Huayi Fountain technical support](http://www.hypq.com.cn/m/tec/index_83.html) and [Frecon music fountain solution](https://www.frecon.com.cn/solution/178.html). The search summary did not say which of the two pages carried each point.
- **VFD vendors (marketing):** audio is converted to a standard **0–5 V DC** analogue signal that sets VFD speed, so pump output follows the music. — [CHZIRI](https://www.chziri.com/news/chziri-vfd-was-successfully-installed-on-the-music-fountain). Alternative: a DMX value **0–255** is mapped to 0–10 V or 4–20 mA for VFD frequency. — [chinamusicfountain.com: What is a DMX pump](https://chinamusicfountain.com/what-is-a-dmx-pump/)
- **Pump response (marketing claim):** DC brushless DMX pumps respond in about **20–50 ms**, while VFD-driven AC pumps are slower. — [chinamusicfountain.com: DMX pump](https://chinamusicfountain.com/what-is-a-dmx-pump/)
- **Academic Chinese example:** MSP430 and STM32 boards run an FFT and PWM-drive each jet's height so the row of jets draws the spectrum shape in real time. Analysis and actuation run on separate MCUs. — [UESTC journal 10.12179/1672-4550.20190306](https://www.sy.uestc.edu.cn/article/doi/10.12179/1672-4550.20190306)
- **Cornell student build:** a Walsh transform splits audio into **8 bands** for 8 solenoid jets. The 8 came from the number of pins on an 8-bit MCU port, not from any musical reason. It has a "single-valve" mode (fire only the band with the most energy) and a thresholded multi-valve mode. — [Cornell ECE4760 Musical Water Fountain](https://people.ece.cornell.edu/land/courses/ece4760/FinalProjects/s2006/tj39vls25tmd29/tj39vls25tmd29/index.htm)
- **Chinese style heuristic:** light, fast music suits fast jumping shapes, and lyrical music suits slow-flowing water curtains. Water and light start and end times in a section should coincide. — [CSDN: PLC + VFD music fountain design](https://blog.csdn.net/qq_40828705/article/details/145208702) (via search summary; student-level source)

### Inferences
- A defensible default for an AquaFlow real-time or "idle" mode: 3 bands at about 60–150 / 200–600 / 800–2200 Hz (colour organ), or up to 6 bands. Use attack and release smoothing, plus refire-interval limits of about 0.5 s per valve and 0.8 s per pump. Use a log-to-linear lookup to turn band level into valve or VFD command.
- "Show mode" should instead be event and section driven: onsets, loudness jumps, instrument stems. This matches both the thesis conclusion and professional practice.

### Gaps
- I found no Alibaba or Made-in-China datasheet with exact band crossovers or channel counts for commercial "audio spectrum" fountain controllers (Longxin, Huaxin, Beijing Water Show). The 60–150/200–600/800–2200 Hz figures are colour-organ figures, not a fountain-vendor spec.
- A Baidu-wiki page claimed rules like "low → large volume, high → fine spray" with ±50 ms figures, but the source's reliability is low and I did not verify it.

---

## 3. Which water effects suit which musical elements

### Takeaway
Industry sources support these pairings in general terms: powerful or tall jets and shooters for drums, brass, climaxes and big accents; chasers and jumping jets for rhythmic, fast material; swing or robotic nozzles for flowing melodic motion; mist, fog and curtains for soft or atmospheric passages; synchronised full-height bursts for crescendos and sudden loudness jumps. Nobody publishes a formal rulebook. These pairings are stated or implied by choreographers and vendors, not standardised.

### Cited Findings
- **Effect palette per element (vendor):** aerated jets give tall plumes, laminar jets give smooth arcs, and mist gives an "ethereal" fine spray. Variable-speed pumps let flow intensity follow the music's dynamics, "dramatic flourishes or subtle ripples". Powerful jets "resemble drums or brass instruments". — [fountains.com: Aquatic Harmony](https://fountains.com/aquatic-harmony-the-art-of-music-and-water-choreography-in-fountains/); [fountains.com: musical notes](https://fountains.com/water-to-sound-harmony-designing-fountains-that-resemble-musical-notes/) (vendor marketing)
- **Swing vs digital jets:** motorised 2D/3D swing nozzles give "continuous, flowing motion". Digital or jumping jets cut the stream into short segments. — [SyncD Connect: How to build a musical fountain](https://www.syncdconnect.com/post/how-to-build-musical-fountain) (vendor)
- **Shooters (Dubai):** high-pressure shooters make a loud "boom". The tallest ("Extreme Shooters") are used least in each show because building that pressure takes so long. — [Wikipedia: Dubai Fountain](https://en.wikipedia.org/wiki/Dubai_Fountain)
- **Fog as background:** "a fog system capturing light as if to fill in the background". — [WaterShapes: Fountain Fascination](https://watershapes.com/fountain-fascination/)
- **Chase and crescendo:** chase scenes are timed to the score and water is synchronised to crescendos. — [Pool & Spa Marketing](https://www.poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/2/)
- **Loudness jump → all jets:** "shoot from all the nozzles" on a huge loudness change in a short time. — [Satov, TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)
- **Band → shape (Chinese controller):** mid band → splash shapes (snow pine, fireworks); mid-high band → rotating, swinging and straight jets. — [cnblogs](https://www.cnblogs.com/fm1029/p/15376612.html)
- **Fire as accent:** at Wynn Macau, fire bursts punctuate passionate phrases. — [Architect Magazine: Performance Lake at Wynn Macau](https://www.architectmagazine.com/?p=217143) (via search summary)
- **Kopik on pacing:** with constantly intense music, the choreography must avoid tiring the audience. This implies holding back peak effects even when the music stays loud. — [Washington Times/AP](https://www.washingtontimes.com/news/2019/apr/1/game-of-thrones-takes-over-bellagio-fountains-in-l/)

### Inferences
Implementable mapping table. This is synthesis: each row combines the cited heuristics above with pump and valve physics; the table as a whole is not a published standard.

| Music feature | Effect class | Parameter rule |
|---|---|---|
| Kick / bass onset (low band, about 60–150 Hz) | Shooters, central tall jets, VFD pump surge | Height ∝ onset strength (log-mapped). Pre-trigger by hydraulic latency (0–600 ms per US6276612). Save tallest shooters for downbeats of big sections (Dubai uses them least). |
| Snare / hats / percussive highs | Solenoid chasers, jumping/digital jets, small jets | One step per 8th or 16th note. Respect a valve refire minimum of about 0.5 s per valve, so rotate valves round-robin. |
| Melody / vocal line | 2D/3D swing nozzles, robotic heads, laminar arcs | Continuous motion. Amplitude follows phrase contour, and pitch could map to tilt angle (this pitch-to-tilt idea is mine, not sourced). |
| Pads / strings / quiet sections | Mist, fog, curtains, low slow waves | Low VFD, slow fades. "Lyrical → slow-flowing curtain" (Chinese heuristic). |
| Crescendo / drop / big loudness jump | All-jets synchronised burst, full height, white flash | Fire on the detected loudness jump. Ramp the VFD in advance of the drop. |
| Sustained high energy | Rotate effect families | Avoid fatigue (Kopik). Do not keep everything at max. |

### Gaps
- No published WET, Crystal or OASE "rulebook" mapping instruments to nozzle classes. The table above is a synthesis.

---

## 4. Tempo → motion (chase, wave and swing speed vs BPM; phrase-level pattern changes)

### Takeaway
No source gives an explicit formula such as "one swing cycle per bar". Professionals program "beat-by-beat" by hand and use discrete speed steps (Grand Haven sweeps have 7 speeds). Sections and mood shifts trigger changes in the active effect family. Musically sensible rules must therefore be inferred.

### Cited Findings
- Displays are choreographed "beat-by-beat". — [Pool & Spa Marketing](https://www.poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/2/)
- Sweeps run at one of **7 speeds**, follow or oppose, long or short travel, hold or oscillate. — [Grand Haven Technical](https://www.ghfountain.org/technical)
- Tempo, rhythm, key and shifts in mood prompt changes of look at Longwood. — [Longwood blog](https://longwoodgardens.org/blog/2026-08-05/when-water-becomes-instrument)
- One Chinese overview gives the example of MIDI being split into tempo levels that are matched to pump pressure, and suggests aligning on timestamps. — [Baidu b2bwiki: 自动控制技术在音乐喷泉中 (automatic control technology in music fountains)](https://b2bwiki.baidu.com/article/d1vju1pftjst2bqditn0) (low-reliability; via search summary)
- Water reacts more slowly than light, so the analysis rate can be "way slower" than visualiser frame rates. — [Satov, TalTech thesis](https://digikogu.taltech.ee/en/Download/6b43eeb3-863d-48d1-b51f-5e0001868d41)

### Inferences
- Snap motion periods to musical units chosen from the actuator's feasible range. Swing nozzles: one full oscillation per 1 bar at 60–100 BPM and per 2 beats at fast tempi. Chasers: one step per 8th or 16th note. Waves: one traverse per bar or 2 bars. Change the effect family at phrase boundaries (4/8/16 bars) and at detected section changes.
- Quantise speeds to a small set of discrete steps (as Grand Haven does) so the result looks deliberate.

### Gaps
- No primary source states a BPM-to-period rule for swing nozzles or chase speed. Mechanical maximum swing rates were not found.

---

## 5. Lighting colour conventions

### Takeaway
Practice is mood-driven and per section: a library of looks is recalled, layered and faded as the music changes, and colour moves together with the water. Sources confirm instant snaps and flashes as accent tools. I found no published convention tying specific colours to key or mode (for example, minor = blue).

### Cited Findings
- Library of pre-programmed lighting looks and moods, recalled, layered, faded and transitioned as the music shifts. LEDs can snap on and off instantly. — [Longwood blog](https://longwoodgardens.org/blog/2026-08-05/when-water-becomes-instrument)
- Light intensity and colour are adjusted together with the water, beat by beat. — [Pool & Spa Marketing](https://www.poolspamarketing.com/trade/features/show-fountains-attract-visitors-choreographed-music-water-lights/2/)
- Grand Haven RGB fixtures do colour fades, strobes and "twinkles". — [Grand Haven Technical](https://www.ghfountain.org/technical)
- Chinese controllers let the audio signal drive light colour and brightness. — [cnblogs](https://www.cnblogs.com/fm1029/p/15376612.html)
- Programmable lights add "another layer of emotion" (Wynn Macau). — [Architect Magazine](https://www.architectmagazine.com/?p=217143)

### Inferences
- Implementable default: palette per section (energy and valence → warm vs cool), slow crossfades on pads, white or high-intensity flash on big accents and drops, and brightness following the water height or envelope.

### Gaps
- No source on key-to-colour or warm/cool conventions specific to fountains.

---

## 6. Patents on music-driven or automatic fountain choreography

### Takeaway
The patent record is mostly older analogue or band-split systems (1950s–2000s) that map band energy to pumps and valves, plus latency compensation. I found no WET patent on automatic choreography in this pass.

### Cited Findings
- **US 2,868,055** "Audio frequency controlled fountain": filters split audio into discrete bands, and rectified band signals set pump behaviour so nozzle height tracks loudness. — [Google Patents US2868055](https://www.google.ca/patents/US2868055)
- **US 3,294,322:** band filters separate audio to control jets and lamps. — cited inside the search summary of the [US5439170](https://patents.google.com/patent/US5439170) prior art. Not checked directly.
- **US 4,376,404** "Apparatus for translating sound into a visual display": low, middle and high band-pass channels drive spray groups. Higher detected melody frequency → greater discharge amplitude. — [USPTO PDF 4376404](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4376404)
- **US 5,439,170** "Illuminated water fountain": filters split music into frequency bands and intensities that drive **16 valves** and the lighting. — [Google Patents US5439170](https://patents.google.com/patent/US5439170)
- **US 6,276,612** "Synchronized fountain and method":
  - Digital crossover splits audio into high, medium and low bands.
  - Bands are delayed to compensate for mechanical lag, **0–600 ms** (claim 9), and light and speaker signals are delayed too.
  - The number of active nozzles changes with input amplitude.
  - No Hz crossovers are given.
  
  — [Google Patents US6276612](https://patents.google.com/patent/US6276612)
- **US 9,099,067** "Apparatus and method for generating effects based on audio signal analysis" (FFT, sustained-frequency detection triggers effects). Also pixelated water display design tools (US 11,813,629 and US 12,508,614). Not read in detail. — [USPTO 9099067](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9099067); [USPTO 11813629](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11813629)
- **CN2698460Y** "Karaoke music fountain": separate bass and mid/high pumps driven by a frequency divider, so spray height follows the audio in real time. — [Google Patents CN2698460Y](https://www.google.ca/patents/CN2698460Y?cl=en)

### Inferences
- Latency compensation, meaning sending water commands ahead of the audio by the per-actuator hydraulic delay, is the most consistently documented engineering rule. US6276612 claims 0–600 ms, and the Chinese controller uses 0.1–0.4 s. AquaFlow should store a per-device lead time.

### Gaps
- No WET Design, Crystal Fountains or OASE patent on automatic music-to-choreography generation was found. A dedicated assignee search on Google Patents is recommended.
- CNKI or CNIPA patents on 音乐喷泉 频谱 (music fountain spectrum) and 节拍 编排 (beat choreography) were not retrieved directly.
