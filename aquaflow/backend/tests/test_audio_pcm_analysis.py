import wave

import numpy as np

from api.routes.audio import _analyze_pcm_wav
from services.beat_detection import generate_click_track


def test_pcm_wav_analysis_reads_real_duration_and_detects_click_tempo(tmp_path):
    sr = 11025
    samples = generate_click_track(120, 8, sr)
    path = tmp_path / "click.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sr)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    duration, bpm, _, _, energy, bass, beats, sections, confidence = _analyze_pcm_wav(path)
    assert duration == pytest.approx(8, abs=0.01)
    assert bpm == pytest.approx(120, abs=5)
    assert len(energy) == 200 and len(bass) == 200
    assert len(beats) >= 8 and len(sections) >= 4 and confidence >= 0.8


import pytest
