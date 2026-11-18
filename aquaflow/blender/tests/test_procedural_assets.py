import struct

from aquaflow_studio.procedural_textures import generate_jet_sequence, unit


def test_original_jet_sequences_are_deterministic_and_valid(tmp_path):
    first = generate_jet_sequence(tmp_path / "water", "clear", frames=2, width=32, height=64)
    expected = first / "clear_mask_0001.png"
    assert expected.is_file()
    data = expected.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", data[16:24]) == (32, 64)
    assert (first / "clear_normal_0001.png").is_file()
    assert unit(42, 3) == unit(42, 3)
    assert unit(42, 3) != unit(43, 3)


def test_aerated_sequence_is_independent_asset(tmp_path):
    generate_jet_sequence(tmp_path, "aerated", frames=1, width=32, height=64)
    assert (tmp_path / "aerated_mask_0001.png").is_file()
    assert (tmp_path / "aerated_normal_0001.png").is_file()
