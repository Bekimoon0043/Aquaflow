# Music model licence register

AquaFlow Studio is sold commercially. This register lists every music-analysis model or
library the show generator uses or may use, its licence, and whether it may ship in the
installer. **No model with a non-commercial (NC) licence may be bundled** without a written
licence from its owner. Sources: `reports/Automatic fountain shows for any site.md` and its notes.

| Component | Used for | Code licence | Weights licence | Status in AquaFlow | Sign-off |
|---|---|---|---|---|---|
| AquaFlow browser analysis (`musicAnalysis.js`, `stemSplit.js`, `stemAnalysis.js`, `stemBands.js`) | beats, sections, stems (harmonic/percussive), bands | own code | none (no model) | **Shipped** | — |
| AquaFlow engine deep analysis (`backend/services/deep_music.py`) | loudness, structure, builds/drops, mood, vocal phrases | own code (numpy) | none (no model) | **Shipped** | — |
| beat_this (CPJKU, 2024) | beats / downbeats | MIT | MIT | Optional plug-in, used only when installed | Legal check recommended before bundling |
| HTDemucs v4 (Meta) via ONNX | stem separation | MIT (repo archived) | not separately stated | Optional plug-in, **not bundled** | Needs legal confirmation of the weights |
| Spleeter (Deezer) | stem separation (fallback) | MIT | MIT | Not used (the browser split covers the fallback) | — |
| madmom models | beats / downbeats | BSD code | **CC BY-NC-SA** | **Do not ship** | Commercial licence from JKU needed |
| Essentia models (MTG) | mood, danceability, arousal / valence | AGPL / commercial | **CC BY-NC-SA** | **Do not ship** | Commercial licence from MTG needed |
| MERT, MuQ (and SongFormer, built on MuQ) | music embeddings, structure | — | **Non-commercial** | **Do not ship** | — |
| BS-RoFormer / Mel-RoFormer community checkpoints | stem separation | MIT code | often **CC BY-NC-SA** (per checkpoint) | **Do not ship** unless a checkpoint's licence is confirmed permissive | — |
| All-In-One structure analyzer | structure labels | MIT | depends on madmom + NATTEN | Not used | Check madmom use before any bundling |
| LAION CLAP | text-prompt mood → palette | Apache-2.0 (aggregator listing only) | unconfirmed | Not used | Confirm licence from the source repo first |
| PESTO | pitch | believed LGPL (unverified) | unverified | Not used (YIN in `stemAnalysis.js` is used) | — |

How plug-ins are switched on: `deep_music.available_plugins()` reports what is installed in the
engine; nothing is downloaded automatically. Add a row here, with its sign-off, before adding
any new model.
