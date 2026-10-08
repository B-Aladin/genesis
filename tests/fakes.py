"""TEST DOUBLES ONLY: scripted chat models standing in for Gemini, so tests
cost no Gemini requests. They exercise the real agents, tools, middleware,
state, approvals and subagents; they say nothing about Gemini's own answers."""
from __future__ import annotations

import itertools
import re
import subprocess
from typing import Any, Callable

import cv2
import numpy as np
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ConfigDict

_ids = itertools.count(1)


class FnModel(BaseChatModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    label: str
    fn: Callable[[list, list[str]], AIMessage]
    log: Any = None          # Any: pydantic would copy a list, and the test would read the wrong one
    bound: list = []

    def bind_tools(self, tools, **kw):
        names = [getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None) for t in tools]
        return self.model_copy(update={"bound": names})

    @property
    def _llm_type(self) -> str:
        return "scripted-test-double"

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        system = messages[0].content if messages and messages[0].type == "system" else ""
        self.log.append({"label": self.label, "tools": sorted(self.bound), "system": system, "messages": messages})
        return ChatResult(generations=[ChatGeneration(message=self.fn(messages, list(self.bound)))])


def call(name: str, **args) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"call_{next(_ids)}", "type": "tool_call"}])


def scripted(plan: list) -> Callable:
    """Coordinator script. Each step is a tool name, (name, args), or ("text", reply).
    A step naming a tool the gate didn't offer fails the test."""
    steps = iter(plan)

    def fn(messages, tools):
        step = next(steps)
        if isinstance(step, tuple) and step[0] == "text":
            return AIMessage(content=step[1])
        name, args = (step, {}) if isinstance(step, str) else step
        assert name in tools, f"{name} was not offered; the gate offered {tools}"
        return call(name, **args)
    return fn


def observer(observation: dict, seen: list) -> Callable:
    def fn(messages, tools):
        seen.append(messages[-1].content)            # the multimodal blocks it received
        return call("Observation", **observation)
    return fn


def reporter(messages, tools):
    """Writes a report from the brief it is given, plus one invented sentence the skeptic must catch."""
    brief = messages[-1].content
    meas = re.search(r"V1 OBSERVED \w+: a light blinks at ([\d.]+) Hz", brief)
    pred = re.search(r"predicts ([\d.]+) Hz", brief)
    u = re.search(r"(U\d+) UNKNOWN", brief)
    how_sure = ({"text": f"The parts predict {pred.group(1)} Hz and the video shows {meas.group(1)} Hz.", "cites": ["X1", "V1"]}
                if pred and meas else {"text": "The capacitor value was worked out from the blink rate.", "cites": ["X1"]})
    return call("Report", sections=[
        {"title": "What it is", "sentences": [{"text": "This is probably a 555 timer blinker.", "cites": ["O1", "P1"]}]},
        {"title": "How sure we are", "sentences": [how_sure, {"text": "It was made in 1998.", "cites": []}]},
        {"title": "What we still don't know", "sentences": [{"text": "The copper on the back is not visible.", "cites": [u.group(1) if u else "U1"]}]},
    ])


OBSERVATION = {
    "components": [
        {"type": "ic", "marking": "NE555P", "image": 1, "box": [400, 380, 520, 560], "confidence": "HIGH", "evidence": "8-pin chip marked NE555P"},
        {"type": "resistor", "bands": ["brown", "black", "red", "gold"], "image": 1, "confidence": "PROBABLE", "evidence": "bands brown black red gold"},
        {"type": "resistor", "bands": ["brown", "black", "orange", "gold"], "image": 1, "confidence": "PROBABLE", "evidence": "bands brown black orange gold"},
        {"type": "resistor", "bands": ["yellow", "violet", "brown", "gold"], "image": 1, "confidence": "PROBABLE", "evidence": "bands yellow violet brown gold"},
        {"type": "capacitor_electrolytic", "value_printed": "100uF 16V", "image": 1, "confidence": "HIGH", "evidence": "can printed 100uF 16V"},
        {"type": "led", "image": 2, "confidence": "HIGH", "evidence": "red LED, lit in image 2"},
    ],
    "changing_region": {"component_index": 5, "type": "led", "evidence": "lit in image 2, dark in image 3"},
    "board": [{"note": "9 V battery clip at the left edge", "image": 1, "confidence": "PROBABLE"}],
    "cannot_see": ["the copper traces on the back"],
}

F0 = 1.44 / ((1000 + 2 * 10000) * 100e-6)   # what a real 1k / 10k / 100 uF 555 does
DUTY = 11000 / 21000


def make_video(path, freq=F0, duty=DUTY, seconds=12, extra="") -> str:
    led = (f"drawbox=x=470:y=230:w=26:h=26:color=0x401010:t=fill,"
           f"drawbox=x=470:y=230:w=26:h=26:color=0xff3a2a:t=fill:enable='lt(mod(t,1/{freq:.5f}),{duty:.4f}/{freq:.5f})'")
    parts = ["drawbox=x=120:y=90:w=180:h=110:color=0x202020:t=fill", "drawbox=x=360:y=60:w=40:h=120:color=0xc8b070:t=fill"]
    parts += ([led] if freq else []) + ([extra] if extra else []) + ["noise=alls=8:allf=t"]
    vf = ",".join(parts)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x1d3b2a:s=640x360:r=30:d={seconds}",
                    "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", str(path)], check=True)
    return str(path)


def make_photo(path) -> str:
    img = np.full((600, 800, 3), (42, 59, 29), np.uint8)
    cv2.rectangle(img, (300, 240), (450, 330), (30, 30, 30), -1)
    cv2.imwrite(str(path), img)
    return str(path)
