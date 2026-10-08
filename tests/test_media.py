"""OpenCV reads real H.264 files made by ffmpeg; the light is found and timed by code."""
from pathlib import Path

from genesis_see import media
from fakes import DUTY, F0, make_photo, make_video


def test_blinking_led_found_and_timed(tmp_path):
    v, frames = media.read_video(make_video(tmp_path / "blink.mp4"), str(tmp_path / "work"))
    a = v["regions"][0]["analysis"]
    assert abs(a["frequency_hz"] - F0) / F0 < 0.03, a
    assert abs(a["duty_cycle"] - DUTY) < 0.07
    x0, y0, x1, y1 = v["regions"][0]["box"]
    assert abs((x0 + x1) / 2 * 4 - 483) < 25 and abs((y0 + y1) / 2 * 4 - 243) < 25
    assert [f["label"].split(",")[1].split("(")[0].strip() for f in frames] == ["light on", "light off"]
    assert all(Path(f["path"]).exists() for f in frames)


def test_still_scene_and_bad_files(tmp_path):
    v, frames = media.read_video(make_video(tmp_path / "still.mp4", freq=0, seconds=5), str(tmp_path / "w"))
    assert not [r for r in v["regions"] if r["analysis"].get("periodic")]
    (tmp_path / "x.mp4").write_bytes(b"not a video")
    try:
        media.read_video(str(tmp_path / "x.mp4"), str(tmp_path / "w"))
        raise AssertionError("expected MediaError")
    except media.MediaError as e:
        assert "MP4" in str(e)


def test_photo_shrunk_to_jpeg(tmp_path):
    import base64
    data = base64.b64decode(media.photo_b64(make_photo(tmp_path / "p.png")))
    assert data[:2] == b"\xff\xd8"  # JPEG
