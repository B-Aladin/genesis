"""Demo mode for the web UI: a sample board and scripted stand-ins for Gemini.

The real coordinator, tools, middleware, evidence gate, approvals, OpenCV video
measurement, pattern scoring, cross-check and skeptic all run. Only the model
calls are scripted, so a demo costs zero Gemini requests. Nothing here says
anything about how well Gemini reads a real board.
"""
from __future__ import annotations

import itertools
import json
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
    "device": {"kind": "LED blinker kit on perfboard", "labels": [], "ports": ["9 V battery clip"], "confidence": "PROBABLE"},
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


# ---- second sample: an ESP32 development board blinking an LED through a resistor
ESP_LAYOUT = {"dev": (0.26, 0.22, 0.58, 0.80), "r": (0.66, 0.40, 0.80, 0.46), "led": (0.86, 0.55, 0.92, 0.64)}
ESP_HZ, ESP_DUTY = 1.0, 0.5


def _esp_box(key: str) -> list[int]:
    x0, y0, x1, y1 = ESP_LAYOUT[key]
    return [round(y0 * 1000), round(x0 * 1000), round(y1 * 1000), round(x1 * 1000)]


ESP_OBSERVATION = {
    "components": [
        {"type": "dev_board", "marking": "ESP32-DEVKITC", "image": 1, "box": _esp_box("dev"), "confidence": "HIGH",
         "evidence": "black development board with a silver ESP32-WROOM module and a micro-USB port"},
        {"type": "resistor", "bands": ["red", "red", "brown", "gold"], "image": 1, "box": _esp_box("r"), "confidence": "PROBABLE",
         "evidence": "bands red red brown gold"},
        {"type": "led", "image": 2, "box": _esp_box("led"), "confidence": "HIGH", "evidence": "red LED, lit in image 2"},
    ],
    "device": {"kind": "ESP32 development board on a breadboard", "labels": ["ESP32", "DEVKITC"], "ports": ["micro-USB"],
               "confidence": "HIGH"},
    "changing_region": {"component_index": 2, "type": "led", "evidence": "lit in image 2, dark in image 3"},
    "board": [{"note": "a USB cable powers the development board", "image": 1, "confidence": "PROBABLE"}],
    "cannot_see": ["which GPIO pin the resistor is wired to"],
}


def draw_esp_board(w: int, h: int, led_on: bool) -> np.ndarray:
    img = np.full((h, w, 3), (232, 232, 228), np.uint8)              # breadboard
    P = lambda x, y: (int(x * w), int(y * h))
    s = min(w, h)
    for gy in np.linspace(0.08, 0.92, 26):
        for gx in np.linspace(0.05, 0.95, 40):
            cv2.circle(img, P(gx, gy), max(1, s // 260), (150, 150, 150), -1)
    x0, y0, x1, y1 = ESP_LAYOUT["dev"]
    cv2.rectangle(img, P(x0, y0), P(x1, y1), (30, 30, 32), -1)
    cv2.rectangle(img, P(x0 + 0.04, y0 + 0.03), P(x1 - 0.04, y0 + 0.30), (190, 192, 196), -1)
    cv2.putText(img, "ESP32", P(x0 + 0.09, y0 + 0.19), cv2.FONT_HERSHEY_SIMPLEX, s / 700, (60, 60, 60), max(1, s // 300))
    cv2.putText(img, "DEVKITC", P(x0 + 0.08, y0 + 0.42), cv2.FONT_HERSHEY_SIMPLEX, s / 1100, (210, 210, 210), max(1, s // 500))
    for gy in np.linspace(y0 + 0.05, y1 - 0.05, 19):
        for gx in (x0 + 0.015, x1 - 0.015):
            cv2.circle(img, P(gx, gy), max(2, s // 160), (60, 175, 215), -1)
    cv2.rectangle(img, P((x0 + x1) / 2 - 0.03, y1 - 0.02), P((x0 + x1) / 2 + 0.03, y1 + 0.03), (160, 160, 160), -1)
    cv2.line(img, P(x1 - 0.015, 0.43), P(0.64, 0.43), (40, 200, 230), max(2, s // 150))            # jumper to the resistor
    cv2.line(img, P(0.89, 0.64), P(0.89, 0.88), (20, 20, 20), max(2, s // 150))
    cv2.line(img, P(0.89, 0.88), P(x1 - 0.015, 0.88), (20, 20, 20), max(2, s // 150))
    cv2.line(img, P(x1 - 0.015, 0.88), P(x1 - 0.015, y1 - 0.05), (20, 20, 20), max(2, s // 150))
    x0, y0, x1, y1 = ESP_LAYOUT["r"]
    cv2.line(img, P(x0 - 0.02, (y0 + y1) / 2), P(x1 + 0.06, (y0 + y1) / 2), (170, 170, 175), max(2, s // 300))
    cv2.line(img, P(x1 + 0.06, (y0 + y1) / 2), P(0.885, 0.56), (170, 170, 175), max(2, s // 300))
    cv2.rectangle(img, P(x0, y0), P(x1, y1), (150, 200, 225), -1)
    for i, b in enumerate(["red", "red", "brown", "gold"]):
        bx = x0 + (0.18 + i * 0.2) * (x1 - x0)
        cv2.rectangle(img, P(bx, y0), P(bx + 0.1 * (x1 - x0), y1), BANDS_BGR[b], -1)
    x0, y0, x1, y1 = ESP_LAYOUT["led"]
    c, r = P((x0 + x1) / 2, (y0 + y1) / 2), int((x1 - x0) / 2 * w)
    if led_on:
        glow = img.copy()
        cv2.circle(glow, c, int(r * 2.2), (80, 90, 255), -1)
        img = cv2.addWeighted(glow, 0.35, img, 0.65, 0)
        cv2.circle(img, c, r, (120, 140, 255), -1)
    else:
        cv2.circle(img, c, r, (30, 30, 120), -1)
    return img


# ---- third sample: a two-wheel robot car (Arduino Uno, L298N, two TT motors, 2 x 18650, HC-SR04)
ROBOT_LAYOUT = {"uno": (0.34, 0.10, 0.62, 0.42), "drv": (0.36, 0.56, 0.60, 0.88), "bat": (0.05, 0.50, 0.28, 0.90),
                "sr04": (0.70, 0.04, 0.96, 0.24), "m1": (0.72, 0.38, 0.92, 0.52), "m2": (0.72, 0.72, 0.92, 0.86),
                "led": (0.555, 0.15, 0.575, 0.18)}
ROBOT_HZ, ROBOT_DUTY = 1.0, 0.5


def _robot_box(key: str) -> list[int]:
    x0, y0, x1, y1 = ROBOT_LAYOUT[key]
    return [round(y0 * 1000), round(x0 * 1000), round(y1 * 1000), round(x1 * 1000)]


ROBOT_OBSERVATION = {
    "components": [
        {"type": "dev_board", "marking": "ARDUINO UNO R3", "image": 1, "box": _robot_box("uno"), "confidence": "HIGH",
         "evidence": "blue Arduino Uno board with an ATmega328P and a USB-B socket"},
        {"type": "ic", "marking": "L298N", "image": 1, "box": _robot_box("drv"), "confidence": "HIGH",
         "evidence": "red L298N motor driver module with a black heatsink and screw terminals"},
        {"type": "motor", "image": 1, "box": _robot_box("m1"), "confidence": "HIGH", "evidence": "yellow TT gear motor driving the right wheel"},
        {"type": "motor", "image": 1, "box": _robot_box("m2"), "confidence": "HIGH", "evidence": "yellow TT gear motor driving the left wheel"},
        {"type": "battery", "marking": "18650", "image": 1, "box": _robot_box("bat"), "confidence": "HIGH",
         "evidence": "holder with two 18650 Li-ion cells in series"},
        {"type": "sensor_module", "marking": "HC-SR04", "image": 1, "box": _robot_box("sr04"), "confidence": "HIGH",
         "evidence": "ultrasonic distance sensor with two silver transducers"},
        {"type": "led", "image": 2, "box": _robot_box("led"), "confidence": "PROBABLE", "evidence": "small LED marked L on the Uno, lit in image 2"},
    ],
    "device": {"kind": "two-wheel robot car", "labels": ["UNO", "L298N", "HC-SR04", "18650"], "ports": ["USB-B", "battery switch"],
               "confidence": "HIGH"},
    "connections": [
        {"a": 4, "a_pin": "+", "b": 1, "b_pin": "12V", "kind": "wire", "confidence": "HIGH"},
        {"a": 4, "a_pin": "-", "b": 1, "b_pin": "GND", "kind": "wire", "confidence": "HIGH"},
        {"a": 1, "a_pin": "GND", "b": 0, "b_pin": "GND", "kind": "wire", "confidence": "PROBABLE"},
        {"a": 1, "a_pin": "5V", "b": 0, "b_pin": "5V", "kind": "wire", "confidence": "PROBABLE"},
        {"a": 1, "a_pin": "OUT1", "b": 2, "b_pin": "red", "kind": "wire", "confidence": "HIGH"},
        {"a": 1, "a_pin": "OUT2", "b": 2, "b_pin": "black", "kind": "wire", "confidence": "HIGH"},
        {"a": 1, "a_pin": "OUT3", "b": 3, "b_pin": "red", "kind": "wire", "confidence": "HIGH"},
        {"a": 1, "a_pin": "OUT4", "b": 3, "b_pin": "black", "kind": "wire", "confidence": "HIGH"},
        {"a": 5, "a_pin": "VCC", "b": 0, "b_pin": "5V", "kind": "wire", "confidence": "LOW"},
    ],
    "changing_region": {"component_index": 6, "type": "led", "evidence": "lit in image 2, dark in image 3"},
    "board": [{"note": "a battery switch sits between the 18650 holder and the driver", "image": 1, "confidence": "PROBABLE"}],
    "cannot_see": ["the jumper wires from the Uno's pins to IN1-IN4 are bundled and can't be followed"],
}


def draw_robot(w: int, h: int, led_on: bool) -> np.ndarray:
    img = np.full((h, w, 3), (205, 214, 222), np.uint8)                       # acrylic chassis
    P = lambda x, y: (int(x * w), int(y * h))
    s = min(w, h)
    for y in (0.36, 0.70):                                                   # wheels
        cv2.rectangle(img, P(0.93, y), P(0.99, y + 0.2), (30, 30, 30), -1)
    def box(key, color, label=None, text_color=(240, 240, 240)):
        x0, y0, x1, y1 = ROBOT_LAYOUT[key]
        cv2.rectangle(img, P(x0, y0), P(x1, y1), color, -1)
        if label:
            cv2.putText(img, label, P(x0 + 0.02, (y0 + y1) / 2 + 0.015), cv2.FONT_HERSHEY_SIMPLEX, s / 1100, text_color, max(1, s // 400))
    box("uno", (130, 110, 0), "UNO R3")
    x0, y0, x1, y1 = ROBOT_LAYOUT["uno"]
    cv2.rectangle(img, P(x0 + 0.02, y0 + 0.02), P(x0 + 0.08, y0 + 0.10), (190, 190, 190), -1)        # USB-B
    box("drv", (40, 40, 190), "L298N")
    x0, y0, x1, y1 = ROBOT_LAYOUT["drv"]
    cv2.rectangle(img, P(x0 + 0.06, y0 + 0.04), P(x1 - 0.06, y0 + 0.14), (25, 25, 25), -1)           # heatsink
    box("bat", (40, 40, 40))
    x0, y0, x1, y1 = ROBOT_LAYOUT["bat"]
    for i in range(2):
        cv2.rectangle(img, P(x0 + 0.02 + i * 0.105, y0 + 0.03), P(x0 + 0.115 + i * 0.105, y1 - 0.03), (200, 120, 40), -1)
    box("sr04", (160, 90, 20), "HC-SR04")
    x0, y0, x1, y1 = ROBOT_LAYOUT["sr04"]
    for cx in (x0 + 0.06, x1 - 0.06):
        cv2.circle(img, P(cx, (y0 + y1) / 2 + 0.03), int(0.045 * w), (200, 200, 200), -1)
    for k in ("m1", "m2"):
        box(k, (40, 200, 240), "TT", (40, 40, 40))
    for a, b, col in ((ROBOT_LAYOUT["bat"], ROBOT_LAYOUT["drv"], (40, 40, 220)), (ROBOT_LAYOUT["drv"], ROBOT_LAYOUT["m1"], (40, 40, 220)),
                      (ROBOT_LAYOUT["drv"], ROBOT_LAYOUT["m2"], (30, 30, 30)), (ROBOT_LAYOUT["drv"], ROBOT_LAYOUT["uno"], (60, 160, 60))):
        cv2.line(img, P(a[2], (a[1] + a[3]) / 2), P(b[0], (b[1] + b[3]) / 2), col, max(2, s // 250))
    x0, y0, x1, y1 = ROBOT_LAYOUT["led"]
    c = P((x0 + x1) / 2, (y0 + y1) / 2)
    if led_on:
        glow = img.copy()
        cv2.circle(glow, c, int(0.03 * w), (80, 200, 255), -1)
        img = cv2.addWeighted(glow, 0.4, img, 0.6, 0)
        cv2.circle(img, c, max(3, int(0.008 * w)), (120, 230, 255), -1)
    else:
        cv2.circle(img, c, max(3, int(0.008 * w)), (40, 90, 120), -1)
    return img


def sample_media(folder: str | Path, board: str = "555") -> tuple[str, str]:
    """Write a sample board photo and a 12 s blink video (once) and return their paths.
    board: "555" (a 555 blinker) or "esp" (an ESP32 board blinking an LED)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    draw, hz, duty, name = {"esp": (draw_esp_board, ESP_HZ, ESP_DUTY, "esp-board"), "robot": (draw_robot, ROBOT_HZ, ROBOT_DUTY, "robot")}.get(
        board, (draw_board, F0, DUTY, "board"))
    photo = folder / f"sample-{name}.jpg"
    video = folder / f"sample-{name}-blink.mp4" if name != "board" else folder / "sample-blink.mp4"
    if not photo.exists():
        cv2.imwrite(str(photo), draw(1200, 800, False), [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not video.exists():
        w, h, fps, seconds = 640, 360, 30, 12
        on, off = draw(w, h, True), draw(w, h, False)
        out = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        rng = np.random.default_rng(1)
        for i in range(fps * seconds):
            t = i / fps
            frame = on if (t % (1 / hz)) < duty / hz else off
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
    nxt = re.search(r"(U\d+): [^.]+\.(?: Next: (.+?)\.(?= U\d+:|$))?", unknowns)
    verdict = check.split(":")[0]
    first = (f"It is most likely a {pattern.split(' (')[0].lower()} [P1]. " if "none" not in pattern.lower()
             else "No known circuit fits the parts that were seen [P1]. ")
    if verdict in ("CONSISTENT", "CONTRADICTED"):
        second = f"The parts' prediction came out {verdict.lower()} against the blink the video measured [X1, V1]. "
    elif verdict == "INFERRED":
        second = "A part value was worked out from the measured blink; it needs your confirmation [X1]. "
    else:
        second = f"The explanation couldn't be checked against the device: {check.split(': ', 1)[-1]} [X1]. "
    step = nxt.group(2) if nxt and nxt.group(2) else "a photo of the back of the board"
    return first + second + f"Most useful next step: {step[0].lower() + step[1:]} [{nxt.group(1) if nxt else 'U1'}]."


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


def esp_observer(messages: list, tools: list[str]) -> AIMessage:
    return _call("Observation", **ESP_OBSERVATION)


def robot_observer(messages: list, tools: list[str]) -> AIMessage:
    return _call("Observation", **ROBOT_OBSERVATION)


def observer(messages: list, tools: list[str]) -> AIMessage:
    """Sees the sample board. From video frames alone (no photo) it reads less: the capacitor's
    print is too small to read and colour bands are less certain, as a real observer would report."""
    blocks = messages[-1].content
    text = blocks[0]["text"] if isinstance(blocks, list) else str(blocks)
    if "(uploaded)" in text:
        return _call("Observation", **OBSERVATION)
    obs = json.loads(json.dumps(OBSERVATION))
    for c in obs["components"]:
        c["image"] = 1
        if c["type"] == "resistor":
            c["confidence"] = "LOW"
        if c["type"].startswith("capacitor"):
            c.update(value_printed=None, confidence="PROBABLE", evidence="blue can; its print is too small to read in the video frame")
    obs["changing_region"]["evidence"] = "lit in image 1, dark in image 2"
    obs["cannot_see"].append("the capacitor's printed value (too small in the video frames)")
    return _call("Observation", **obs)


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
    first_next = re.search(r"^(U\d+) UNKNOWN: [^\n]*?Next: ([^\n]+?)\.?$", brief, re.M)
    name = pattern.group(1).lower() if pattern else "device of unknown type"
    summary = re.search(r'pattern "[^"]+"\. ([^.]+\.)', _line(brief, "P1"))
    how_it_works = summary.group(1) if summary else "How it works can't be said without a matching circuit."
    S = lambda text, *cites: {"text": text, "cites": list(cites)}
    how = [S(f"The light in the video blinks at {meas.group(1)} Hz.", "V1")] if meas else []
    if pred and meas:
        how.append(S(f"The parts predict {pred.group(1)} Hz, which matches the {meas.group(1)} Hz the video shows.", "X1", "V1"))
    elif inferred:
        how.append(S("A capacitor value was worked out from the blink rate, so it is probably right but not read.", "X1"))
    how.append(S("It was probably assembled from a hobby kit in 1998.", ))           # invented: the skeptic must flag it
    sections = [
        {"title": "What it is", "sentences": [S(f"This is probably a {name}.", "P1", "O1")]},
        {"title": "How it works", "sentences": [S(how_it_works, "P1")]},
        {"title": "How sure we are", "sentences": how},
        {"title": "What we still don't know", "sentences": [S(f"{t}.", u) for u, t in unknown[:2]] or [S("Nothing else is open.", "X1")]},
        {"title": "What to capture next", "sentences": [S(f"{first_next.group(2)}." if first_next else "A photo of the back of the board would let us trace the copper.",
                                                          first_next.group(1) if first_next else (unknown[0][0] if unknown else "X1"))]},
    ]
    return _call("Report", sections=sections)


def models(board: str = "555") -> Models:
    co = ScriptedModel(label="demo-coordinator", fn=coordinator)
    rep = ScriptedModel(label="demo-reporter", fn=reporter)
    obs = {"esp": esp_observer, "robot": robot_observer}.get(board, observer)
    return Models(coordinator=co, coordinator_flash=co, observer=ScriptedModel(label="demo-observer", fn=obs),
                  reporter=rep, reporter_flash=rep, researcher=co)


__all__: list[Any] = ["models", "sample_media", "OBSERVATION", "LAYOUT"]
