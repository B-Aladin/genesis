"""Demo mode for the web UI: a sample board and scripted stand-ins for Gemini.

The real coordinator, tools, middleware, evidence gate, approvals, OpenCV video
measurement, pattern scoring, cross-check and skeptic all run. Only the model
calls are scripted, so a demo costs zero Gemini requests. Nothing here says
anything about how well Gemini reads a real board.
"""
from __future__ import annotations

import itertools
import re
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ConfigDict

from .agent import Models

_ids = itertools.count(1)

# Normalised layout of the sample board, (x0, y0, x1, y1) in 0..1 of the image.
LAYOUT = {
    "ic": (0.38, 0.40, 0.56, 0.52),
    "r1": (0.15, 0.22, 0.30, 0.28),
    "r2": (0.62, 0.22, 0.77, 0.28),
    "r3": (0.62, 0.69, 0.77, 0.75),
    "cap": (0.15, 0.59, 0.29, 0.73),
    "led": (0.83, 0.41, 0.89, 0.49),
}
BANDS_BGR = {"black": (20, 20, 20), "brown": (30, 60, 110), "red": (40, 40, 210), "orange": (30, 140, 245),
             "yellow": (40, 220, 245), "violet": (190, 70, 150), "gold": (60, 165, 205)}
F0 = 1.44 / ((1000 + 2 * 10000) * 100e-6)   # what a real 1k / 10k / 100 uF 555 does
DUTY = 11000 / 21000


def _box(key: str) -> list[int]:
    x0, y0, x1, y1 = LAYOUT[key]
    return [round(y0 * 1000), round(x0 * 1000), round(y1 * 1000), round(x1 * 1000)]


OBSERVATION = {
    "components": [
        {"type": "ic", "marking": "NE555P", "image": 1, "box": _box("ic"), "confidence": "HIGH", "evidence": "8-pin chip marked NE555P"},
        {"type": "resistor", "bands": ["brown", "black", "red", "gold"], "image": 1, "box": _box("r1"), "confidence": "PROBABLE",
         "evidence": "bands brown black red gold"},
        {"type": "resistor", "bands": ["brown", "black", "orange", "gold"], "image": 1, "box": _box("r2"), "confidence": "PROBABLE",
         "evidence": "bands brown black orange gold"},
        {"type": "resistor", "bands": ["yellow", "violet", "brown", "gold"], "image": 1, "box": _box("r3"), "confidence": "PROBABLE",
         "evidence": "bands yellow violet brown gold"},
        {"type": "capacitor_electrolytic", "value_printed": "100uF 16V", "image": 1, "box": _box("cap"), "confidence": "HIGH",
         "evidence": "can printed 100uF 16V"},
        {"type": "led", "image": 2, "box": _box("led"), "confidence": "HIGH", "evidence": "red LED, lit in image 2"},
    ],
    "changing_region": {"component_index": 5, "type": "led", "evidence": "lit in image 2, dark in image 3"},
    "board": [{"note": "9 V battery clip at the left edge", "image": 1, "confidence": "PROBABLE"}],
    "cannot_see": ["the copper traces on the back"],
}


# ------------------------------------------------------------------ sample media --


def draw_board(w: int, h: int, led_on: bool) -> np.ndarray:
    img = np.full((h, w, 3), (52, 92, 38), np.uint8)
    rng = np.random.default_rng(7)
    img = np.clip(img.astype(np.int16) + rng.integers(-6, 7, img.shape), 0, 255).astype(np.uint8)
    P = lambda x, y: (int(x * w), int(y * h))
    s = min(w, h)
    for y in np.linspace(0.12, 0.88, 9):                       # copper traces
        cv2.line(img, P(0.08, y), P(0.92, y), (60, 110, 48), max(1, s // 220))
    cv2.rectangle(img, P(0.02, 0.02), P(0.98, 0.98), (90, 150, 200), max(2, s // 160))
    cv2.line(img, P(0.0, 0.45), P(0.08, 0.45), (40, 40, 220), max(3, s // 90))     # battery clip
    cv2.line(img, P(0.0, 0.52), P(0.08, 0.52), (25, 25, 25), max(3, s // 90))
    x0, y0, x1, y1 = LAYOUT["ic"]
    cv2.rectangle(img, P(x0, y0), P(x1, y1), (28, 28, 30), -1)
    for i in range(4):
        px = x0 + (i + 0.5) * (x1 - x0) / 4
        for py in (y0 - 0.025, y1):
            cv2.rectangle(img, P(px - 0.008, py), P(px + 0.008, py + 0.025), (190, 190, 200), -1)
    cv2.putText(img, "NE555P", P(x0 + 0.02, (y0 + y1) / 2 + 0.012), cv2.FONT_HERSHEY_SIMPLEX, s / 900, (200, 200, 205), max(1, s // 400))
    for key, bands in (("r1", ["brown", "black", "red", "gold"]), ("r2", ["brown", "black", "orange", "gold"]),
                       ("r3", ["yellow", "violet", "brown", "gold"])):
        x0, y0, x1, y1 = LAYOUT[key]
        cv2.line(img, P(x0 - 0.03, (y0 + y1) / 2), P(x1 + 0.03, (y0 + y1) / 2), (180, 180, 185), max(2, s // 300))
        cv2.rectangle(img, P(x0, y0), P(x1, y1), (150, 200, 225), -1)
        for i, b in enumerate(bands):
            bx = x0 + (0.18 + i * 0.2) * (x1 - x0)
            cv2.rectangle(img, P(bx, y0), P(bx + 0.1 * (x1 - x0), y1), BANDS_BGR[b], -1)
    x0, y0, x1, y1 = LAYOUT["cap"]
    c, r = P((x0 + x1) / 2, (y0 + y1) / 2), int((x1 - x0) / 2 * w * 0.9)
    cv2.circle(img, c, r, (140, 70, 30), -1)
    cv2.ellipse(img, c, (r, r), 0, 200, 250, (200, 200, 200), max(3, s // 120))
    cv2.putText(img, "100uF", (c[0] - r // 2, c[1] + r // 8), cv2.FONT_HERSHEY_SIMPLEX, s / 1500, (230, 230, 230), max(1, s // 500))
    x0, y0, x1, y1 = LAYOUT["led"]
    c, r = P((x0 + x1) / 2, (y0 + y1) / 2), int((x1 - x0) / 2 * w)
    if led_on:
        glow = img.copy()
        cv2.circle(glow, c, int(r * 2.2), (80, 90, 255), -1)
        img = cv2.addWeighted(glow, 0.35, img, 0.65, 0)
        cv2.circle(img, c, r, (120, 140, 255), -1)
    else:
        cv2.circle(img, c, r, (30, 30, 120), -1)
    return img


def sample_media(folder: str | Path) -> tuple[str, str]:
    """Write the sample board photo and a 12 s blink video (once) and return their paths."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    photo, video = folder / "sample-board.jpg", folder / "sample-blink.mp4"
    if not photo.exists():
        cv2.imwrite(str(photo), draw_board(1200, 800, False), [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not video.exists():
        w, h, fps, seconds = 640, 360, 30, 12
        on, off = draw_board(w, h, True), draw_board(w, h, False)
        out = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        rng = np.random.default_rng(1)
        for i in range(fps * seconds):
            t = i / fps
            frame = on if (t % (1 / F0)) < DUTY / F0 else off
            noise = rng.integers(-4, 5, frame.shape, dtype=np.int16)
            out.write(np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8))
        out.release()
    return str(photo), str(video)


# -------------------------------------------------------------- scripted models --


class ScriptedModel(BaseChatModel):
    """A chat model whose answer comes from a Python function: a stand-in for Gemini."""
    model_config = ConfigDict(arbitrary_types_allowed=True)
    label: str
    fn: Callable[[list, list[str]], AIMessage]
    bound: list = []

    def bind_tools(self, tools, **kw):
        names = [getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None) for t in tools]
        return self.model_copy(update={"bound": names})

    @property
    def _llm_type(self) -> str:
        return "genesis-demo-script"

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        return ChatResult(generations=[ChatGeneration(message=self.fn(messages, list(self.bound)))])


def _call(name: str, **args) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"demo_{next(_ids)}", "type": "tool_call"}])


ORDER = ["watch_video", "observe_parts", "identify_parts", "match_patterns", "check_prediction", "list_unknowns"]
VALUE = re.compile(r"\b(O\d+)\b[^0-9]{0,24}?(\d+(?:\.\d+)?\s*[pnuµmkKM]?\s*\d*\s*(?:F|uF|nF|pF|ohm|Ω|R)?)", re.I)


def _status(system: str, key: str) -> str | None:
    m = re.search(rf"^- {key}: (.+)$", system, re.M)
    return m.group(1) if m else None


def _last_tool(messages: list, name: str) -> str | None:
    return next((str(m.content) for m in reversed(messages) if isinstance(m, ToolMessage) and m.name == name), None)


def _summary(messages: list, system: str) -> str:
    pattern = _status(system, "Pattern") or "no known circuit"
    check = _status(system, "Check") or "no check was possible"
    unknowns = _last_tool(messages, "list_unknowns") or ""
    back = re.search(r"(U\d+): Only one side of the board is visible", unknowns)
    verdict = check.split(":")[0]
    return (f"It is most likely a {pattern.split(' (')[0].lower()} [P1]. "
            f"The parts' prediction came out {verdict.lower()} against the blink the video measured [X1, V1]. "
            f"The single most useful thing to capture next is a photo of the back of the board"
            + (f" [{back.group(1)}]." if back else "."))


def coordinator(messages: list, tools: list[str]) -> AIMessage:
    system = messages[0].content if messages and messages[0].type == "system" else ""
    last = messages[-1]
    report_done = "Report: written" in system
    if isinstance(last, HumanMessage) and len([m for m in messages if isinstance(m, HumanMessage)]) > 1:
        m = VALUE.search(last.text)
        if m and "confirm_value" in tools:
            return _call("confirm_value", component_id=m.group(1).upper(), value=m.group(2).strip(),
                         reason="the user read it on the part")
        if report_done:
            return AIMessage(content=("Demo mode: follow-up answers are scripted, so I can only act on values. "
                                      "Tell me one you read, for example \"O5 is 47uF\", and I'll ask you to approve it, "
                                      "then re-check the circuit against the video. " + _summary(messages, system)))
    if isinstance(last, ToolMessage) and last.name == "write_report":
        return AIMessage(content=_summary(messages, system))
    for name in ORDER:
        if name in tools:
            return _call(name)
    if "write_report" in tools and not report_done:
        return _call("write_report")
    return AIMessage(content=_summary(messages, system))


def observer(messages: list, tools: list[str]) -> AIMessage:
    return _call("Observation", **OBSERVATION)


def _line(brief: str, id_: str) -> str:
    m = re.search(rf"^{id_} (.+)$", brief, re.M)
    return m.group(1) if m else ""


def reporter(messages: list, tools: list[str]) -> AIMessage:
    """Writes the report from the evidence brief, plus one invented sentence for the skeptic to catch."""
    brief = str(messages[-1].content)
    pattern = re.search(r'pattern "([^"]+)"', _line(brief, "P1"))
    meas = re.search(r"blinks at ([\d.]+) Hz", _line(brief, "V1"))
    pred = re.search(r"predicts ([\d.]+) Hz", _line(brief, "X1"))
    inferred = "X1 INFERRED" in brief
    unknown = [u for u in re.findall(r"^(U\d+) UNKNOWN: ([^.]+)\.", brief, re.M)]
    name = pattern.group(1).lower() if pattern else "device of unknown type"
    S = lambda text, *cites: {"text": text, "cites": list(cites)}
    how = [S(f"The light in the video blinks at {meas.group(1)} Hz.", "V1")] if meas else []
    if pred and meas:
        how.append(S(f"The parts predict {pred.group(1)} Hz, which matches the {meas.group(1)} Hz the video shows.", "X1", "V1"))
    elif inferred:
        how.append(S("A capacitor value was worked out from the blink rate, so it is probably right but not read.", "X1"))
    how.append(S("It was probably assembled from a hobby kit in 1998.", ))           # invented: the skeptic must flag it
    sections = [
        {"title": "What it is", "sentences": [S(f"This is probably a {name}.", "P1", "O1")]},
        {"title": "How it works", "sentences": [S("The timer charges and discharges the capacitor through the resistors, switching the LED on and off.", "P1", "O5", "O6")]},
        {"title": "How sure we are", "sentences": how},
        {"title": "What we still don't know", "sentences": [S(f"{t}.", u) for u, t in unknown[:2]] or [S("Nothing else is open.", "X1")]},
        {"title": "What to capture next", "sentences": [S("A photo of the back of the board would let us trace the copper.", unknown[0][0] if unknown else "X1")]},
    ]
    return _call("Report", sections=sections)


def models() -> Models:
    co = ScriptedModel(label="demo-coordinator", fn=coordinator)
    rep = ScriptedModel(label="demo-reporter", fn=reporter)
    return Models(coordinator=co, coordinator_flash=co, observer=ScriptedModel(label="demo-observer", fn=observer),
                  reporter=rep, reporter_flash=rep, researcher=co)


__all__: list[Any] = ["models", "sample_media", "OBSERVATION", "LAYOUT"]
