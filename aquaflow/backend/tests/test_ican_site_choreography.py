from engine.ican_manual_patterns import CAPTURED_GROUP17_SUPPORT, normalize_pattern
from engine.ican_site_choreography import generate_site_pattern, infer_style, valve_groups


def test_legacy_positions_map_to_the_two_captured_32_output_banks():
    result = valve_groups([1, 32, 33, 64])
    assert result["1"] == [9, 40]
    assert result["9"] == [9, 40]
    assert result["2"] == [] and result["25"] == []
    assert result["17"] == list(CAPTURED_GROUP17_SUPPORT)


def test_prompt_generation_is_site_runnable_and_control_groups_stay_locked():
    pattern = generate_site_pattern(
        prompt="Dramatic center-out dance", duration_s=12, bpm=120)
    assert pattern["provenance"]["style"] == "center-out"
    assert pattern["duration_ms"] == 12_000
    assert all(step["groups"]["2"] == [] and step["groups"]["25"] == []
               for step in pattern["steps"])
    assert all(step["groups"]["17"] == list(CAPTURED_GROUP17_SUPPORT)
               for step in pattern["steps"])
    normalize_pattern(pattern)


def test_audio_generation_uses_music_duration_beats_and_energy():
    analysis = {
        "filename": "test.wav", "duration": 8.0, "bpm": 120,
        "analysis_method": "pcm-wav",
        "beats": [{"time": value / 2} for value in range(17)],
        "energy_profile": [0.2, 1.0] * 100,
    }
    pattern = generate_site_pattern(prompt="alternate", analysis=analysis)
    assert pattern["duration_ms"] == 8000
    assert len(pattern["steps"]) == 4
    assert pattern["music"]["analysis_method"] == "pcm-wav"
    assert pattern["provenance"]["kind"] == "site-audio-analysis"


def test_style_inference_understands_operator_language():
    assert infer_style("Make it move right to left") == "reverse-wave"
    assert infer_style("A soft gentle show") == "calm"
    assert infer_style("alternate odd and even jets") == "alternate"
