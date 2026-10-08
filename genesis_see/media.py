"""Photos and video in, model-ready images and measurements out (OpenCV, no model)."""
from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np

from . import core


class MediaError(Exception):
    """A photo or video that can't be read, with a fix in the message."""


def photo_b64(path: str, max_side: int = 1600) -> str:
    """Load a photo (EXIF orientation applied), shrink it, return base64 JPEG."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise MediaError(f"Can't open the photo {path}. Use a JPEG or PNG file.")
    h, w = img.shape[:2]
    k = min(1.0, max_side / max(h, w))
    if k < 1:
        img = cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return base64.b64encode(buf.tobytes()).decode()


def file_b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def read_video(path: str, work_dir: str, max_seconds: float = 30.0, width: int = 160) -> tuple[dict, list[dict]]:
    """Measure what changes in a video. Returns (analysis, key frames).

    Frames are sampled at up to 30 per second, shrunk to `width` pixels and
    turned grey; the blinking element is found by brightness spread, not by a
    model. Key frames (light on / light off) are saved with the changing area
    boxed in magenta, so the observer subagent can say what it is.
    """
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise MediaError(f"Can't open the video {path}. Record in MP4 (H.264); on iPhone choose Settings > Camera > Formats > Most Compatible.")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = min(count / src_fps if count else max_seconds, max_seconds)
    if duration < 2:
        cap.release()
        raise MediaError("The video is under 2 seconds. Record 5 to 20 seconds so several blinks are captured.")
    fps = max(5, min(30, int(300 / duration)))
    frames, times, src_index = [], [], []
    i, next_t, height = 0, 0.0, None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = i / src_fps
        if t > duration:
            break
        if t + 1e-9 >= next_t:
            if height is None:
                height = max(2, round(width * frame.shape[0] / frame.shape[1]))
            small = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32))
            times.append(t)
            src_index.append(i)
            next_t += 1 / fps
        i += 1
    cap.release()
    if len(frames) < 10:
        raise MediaError("Too few frames could be read from the video. Try a different recording.")
    result = core.analyze_video(np.stack(frames), times)
    H, W = height, width
    boxes = [{"id": f"V{k + 1}", "box": [r["box"][1] / H * 1000, r["box"][0] / W * 1000, r["box"][3] / H * 1000, r["box"][2] / W * 1000]}
             for k, r in enumerate(result["regions"])]
    lead = next((r for r in result["regions"] if r["analysis"].get("periodic")), result["regions"][0] if result["regions"] else None)
    wanted = ([(src_index[lead["brightest_frame"]], "light on"), (src_index[lead["darkest_frame"]], "light off")] if lead
              else [(src_index[len(src_index) // 2], "middle")])
    keyframes = _save_keyframes(path, wanted, boxes, src_fps, work_dir)
    result["times"] = [round(t, 3) for t in times]
    result["region_boxes"] = boxes
    return result, keyframes


def _save_keyframes(path: str, wanted: list[tuple[int, str]], boxes: list[dict], src_fps: float, work_dir: str) -> list[dict]:
    Path(work_dir).mkdir(parents=True, exist_ok=True)
    targets = {idx: label for idx, label in wanted}
    cap = cv2.VideoCapture(str(path))
    out, i = [], 0
    while targets:
        ok, frame = cap.read()
        if not ok:
            break
        if i in targets:
            label = targets.pop(i)
            h, w = frame.shape[:2]
            k = min(1.0, 1280 / w)
            if k < 1:
                frame = cv2.resize(frame, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
                h, w = frame.shape[:2]
            pad, thick = max(4, w // 100), max(3, w // 300)
            for b in boxes:
                y0, x0, y1, x1 = b["box"]
                cv2.rectangle(frame, (int(x0 / 1000 * w) - pad, int(y0 / 1000 * h) - pad),
                              (int(x1 / 1000 * w) + pad, int(y1 / 1000 * h) + pad), (255, 0, 255), thick)
            file = Path(work_dir) / f"frame-{label.replace(' ', '-')}.jpg"
            cv2.imwrite(str(file), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            out.append({"path": str(file), "label": f"video frame, {label} ({i / src_fps:.2f} s)", "time_s": round(i / src_fps, 3),
                        "region_boxes": boxes})
        i += 1
    cap.release()
    order = [label for _, label in wanted]   # keep "light on" before "light off", whatever came first in time
    out.sort(key=lambda f: next((k for k, lab in enumerate(order) if f["label"].startswith(f"video frame, {lab} (")), 99))
    return out
