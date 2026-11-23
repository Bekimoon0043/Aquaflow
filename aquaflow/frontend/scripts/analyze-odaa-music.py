from pathlib import Path
import json, math
import numpy as np
import soundfile as sf
from scipy import signal

root = Path('C:/Users/user/Documents/aquaflow')
audio, sr = sf.read(root / '.tmp/Odaa_music_analysis.wav')
if audio.ndim > 1:
    audio = audio.mean(axis=1)
audio = audio.astype(np.float32)
hop, nfft = 512, 1024
frames = np.lib.stride_tricks.as_strided(audio, shape=(len(audio) // hop, nfft), strides=(audio.strides[0] * hop, audio.strides[0]))
window = np.hanning(nfft).astype(np.float32)
rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
spectrum = np.abs(np.fft.rfft(frames * window, axis=1))
flux = np.maximum(np.diff(spectrum, axis=0), 0).sum(axis=1)
flux = np.maximum(flux - np.median(flux), 0)
flux /= np.percentile(flux, 99) + 1e-12
rate = sr / hop
peaks, props = signal.find_peaks(flux, distance=int(0.18 * rate), prominence=0.08, height=0.06)
onsets = np.round((peaks + 1) * hop / sr, 3).tolist()

# Beat-period score favors coherent tempi and their half/double-time aliases.
scores = []
for bpm in np.linspace(70, 180, 1101):
    lag = 60 / bpm * rate
    integer = int(round(lag))
    if integer < 2:
        continue
    score = np.corrcoef(flux[:-integer], flux[integer:])[0, 1]
    scores.append((float(score), round(float(bpm), 2)))
scores.sort(reverse=True)
best_bpm = scores[0][1]

sections = [(0,22,'Intro & Drum Ignition'),(23,45,'First Dance Drop & Horn Stabs'),(46,66,'Verse 1'),(67,89,'Pre-Chorus'),(90,108,'Call and Response'),(109,126,'Chorus 1 Climax'),(127,138,'Instrumental Interlude'),(139,157,'Verse 2'),(158,198,'Horse Gallop'),(199,258,'Verse 3 & Geerarsa'),(259,287,'Bridge Obsa'),(288,329,'Grand Finale')]
segment_report = []
for start, end, name in sections:
    a, b = int(start * rate), min(len(rms), int(end * rate))
    segment_report.append({'start': start, 'end': end, 'name': name,
        'rmsMeanDb': round(float(20 * np.log10(np.mean(rms[a:b]) + 1e-12)), 2),
        'rmsPeakDb': round(float(20 * np.log10(np.max(rms[a:b]) + 1e-12)), 2),
        'onsets': [t for t in onsets if start <= t < end]})
windows = [[5,10],[20,27],[104,113],[145,153],[240,249],[278,289],[316,328]]
accent_windows = {}
for a, b in windows:
    i0, i1 = int(a * rate), min(len(flux), int(b * rate))
    candidates = sorted(((float(flux[i]), round(i / rate, 3)) for i in range(i0, i1)), reverse=True)
    accent_windows[f'{a}-{b}'] = [{'time': t, 'strength': round(v, 3)} for v, t in candidates[:8]]
report = {'title': 'Yosan Getahun - 3Obsa', 'duration': 328.144399,
    'estimatedBpm': best_bpm, 'tempoCandidates': scores[:6], 'onsetCount': len(onsets),
    'segments': segment_report, 'accentWindows': accent_windows}
out = root / 'outputs/Odaa_music_analysis.json'
out.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'duration': report['duration'], 'estimatedBpm': best_bpm,
    'tempoCandidates': scores[:4], 'accentWindows': accent_windows}, indent=2))
