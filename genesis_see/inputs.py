"""What the user gave, how good it is, and what they have on hand (code, no model).

Before the investigation starts, GENESIS checks its own inputs: which pieces of
evidence are missing, whether the photos are sharp, bright and large enough to
read markings, and whether the video is long enough to time several blinks.
Each gap says what it costs, so the agent and the report adjust instead of
pretending the evidence is complete.

The user can also say what tools and parts they have. The "what to capture
next" advice is then rewritten into steps they can actually do (a multimeter
check instead of a photo, an oscilloscope probe instead of a guess).
"""
from __future__ import annotations

import re
from pathlib import Path

import cv2
import numpy as np

MATERIALS = {
    "multimeter": "Multimeter",
    "oscilloscope": "Oscilloscope",
    "soldering_iron": "Soldering iron",
    "spare_resistors": "Spare resistors",
    "spare_capacitors": "Spare capacitors",
    "breadboard": "Breadboard",
    "bench_supply": "Bench power supply",
    "arduino": "Arduino (Uno, Nano…)",
    "esp": "ESP32 or ESP8266",
    "logic_probe": "Logic probe",
    "magnifier": "Magnifier or macro lens",
}

MIN_SIDE = 1000           # px: below this, small markings get hard to read
SHARP = 60.0              # variance of the Laplacian on a 1000 px wide copy; below = blurry
DARK, BRIGHT = 55, 215    # mean grey level outside these = badly exposed


def normalize_materials(keys: list[str] | None, other: str | None = None) -> list[str]:
    """Known keys become their labels; free text is kept, split on commas."""
    out = [MATERIALS[k] for k in (keys or []) if k in MATERIALS]
    out += [s.strip()[:60] for s in re.split(r"[,;\n]", other or "") if s.strip()]
    return list(dict.fromkeys(out))[:16]


def has(materials: list[str] | None, *words: str) -> bool:
    text = " ".join(materials or []).lower()
    return any(w in text for w in words)


def micro_board(materials: list[str] | None) -> str | None:
    """Which measurement sketch target the user can run: 'esp32', 'esp8266', 'arduino' or None."""
    text = " ".join(materials or []).lower()
    if ("8266" in text or "nodemcu" in text or "wemos" in text) and "esp32" not in text:
        return "esp8266"
    if "esp" in text:
        return "esp32"
    if "arduino" in text or "uno" in text or "nano" in text:
        return "arduino"
    return None


BOARD_NAME = {"arduino": "Arduino", "esp32": "ESP32", "esp8266": "ESP8266"}


# ---------------------------------------------------------------- media quality --


def photo_quality(path: str) -> dict:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return {"path": str(path), "readable": False, "issues": ["can't be opened as an image"]}
    h, w = img.shape[:2]
    k = 1000 / w if w > 1000 else 1.0
    small = cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA) if k < 1 else img
    sharp = float(cv2.Laplacian(small, cv2.CV_64F).var())
    bright = float(small.mean())
    issues = []
    if max(w, h) < MIN_SIDE:
        issues.append(f"small ({w}x{h} px), so fine markings may be unreadable")
    if sharp < SHARP:
        issues.append("looks blurry, so markings and colour bands may be misread")
    if bright < DARK:
        issues.append("is dark, so colours may be misjudged")
    elif bright > BRIGHT:
        issues.append("is overexposed, so markings may be washed out")
    return {"path": str(path), "readable": True, "width": w, "height": h, "sharpness": round(sharp, 1),
            "brightness": round(bright, 1), "issues": issues}


def video_info(path: str) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {"path": str(path), "readable": False, "issues": ["can't be opened; record in MP4 (H.264)"]}
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    dur = n / fps if fps and n else 0.0
    issues = []
    if dur and dur < 2:
        issues.append(f"only {dur:.1f} s long; at least 5 s is needed to time a blink")
    elif dur and dur < 5:
        issues.append(f"only {dur:.1f} s long, so few blink cycles can be timed")
    if dur > 30:
        issues.append(f"{dur:.0f} s long; only the first 30 s are measured")
    if fps and fps < 20:
        issues.append(f"recorded at {fps:.0f} fps, so fast blinking can't be timed")
    return {"path": str(path), "readable": True, "duration_s": round(dur, 2), "fps": round(fps, 2),
            "width": w, "height": h, "issues": issues}


# ------------------------------------------------------------------- assessment --


def assess(photos: list[str], video: str | None, note: str = "", materials: list[str] | None = None) -> dict:
    """A checklist of the evidence: what's there, what's missing, and what each gap costs."""
    pq = [photo_quality(p) for p in photos]
    vi = video_info(video) if video else None
    items, gaps = [], []

    def item(key, label, given, detail, impact=""):
        items.append({"key": key, "label": label, "given": given, "detail": detail, "impact": impact})
        if impact:
            gaps.append({"key": key, "text": impact})

    if pq:
        q = pq[0]
        item("front", "Front photo", True, f"{q.get('width', '?')}x{q.get('height', '?')} px" + (", " + "; ".join(q["issues"]) if q["issues"] else ", sharp"),
             f"Photo 1 {'; '.join(q['issues'])}" if q["issues"] else "")
    else:
        item("front", "Front photo", False, "missing",
             "No photo: parts are read only from video frames, which are smaller and blurrier" if vi else "No photo")
    if len(pq) > 1:
        q = pq[1]
        item("back", "Back photo", True, f"{q.get('width', '?')}x{q.get('height', '?')} px" + (", " + "; ".join(q["issues"]) if q["issues"] else ", sharp"),
             f"Photo 2 {'; '.join(q['issues'])}" if q["issues"] else "")
    else:
        item("back", "Back photo", False, "missing",
             "No photo of the back: connections come from the matched circuit pattern, not from traced copper")
    if vi:
        item("video", "Video", True, (f"{vi['duration_s']:.1f} s at {vi['fps']:.0f} fps" if vi.get("readable") else "unreadable")
             + (", " + "; ".join(vi["issues"]) if vi["issues"] else ""),
             f"The video is {'; '.join(vi['issues'])}" if vi["issues"] else "")
    else:
        item("video", "Video", False, "missing",
             "No video: behaviour can't be measured, so the explanation can't be checked against the real device")
    item("note", "What you know", bool(note.strip()), note.strip()[:80] or "none given (optional)")
    item("materials", "On hand", bool(materials), ", ".join(materials or []) or "none listed (optional)",
         "" if materials else "")
    evidence = sum(1 for i in items[:3] if i["given"])
    if not pq and not vi:
        verdict = "Nothing to investigate yet: add a photo or a video."
    elif not vi:
        verdict = "GENESIS can identify the parts and the likely circuit, but can't check it against the device without a video."
    elif not pq:
        verdict = "GENESIS can time the blinking, but will read parts only from small video frames; a front photo helps a lot."
    elif len(pq) < 2:
        verdict = "Ready. A back photo would let GENESIS trace the wiring instead of inferring it."
    else:
        verdict = "Ready: front, back and video given."
    return {"items": items, "gaps": gaps, "photos": pq, "video": vi, "evidence": evidence, "can_run": bool(pq or vi),
            "verdict": verdict, "materials": materials or []}


def observer_cautions(quality: list[dict]) -> list[str]:
    """Per-image warnings for the Observer, so it lowers confidence instead of guessing."""
    return [f"Photo {i + 1} {'; '.join(q['issues'])}: give a marking only if every character is crisp, otherwise null with LOW confidence."
            for i, q in enumerate(quality or []) if q.get("issues")]


# ---------------------------------------------------------- next steps by toolkit --


def _id(text: str) -> str | None:
    m = re.search(r"\b(O\d+)\b", text)
    return m.group(1) if m else None


def tailor(unknowns: list[dict], materials: list[str] | None, components: list[dict] | None = None,
           assessment: dict | None = None) -> list[dict]:
    """Rewrite each 'capture next' into something the user can do with what they have,
    and add input-quality gaps the core list doesn't cover. Ids are renumbered U1.."""
    comps = {c["id"]: c for c in components or []}
    M = materials or []
    mb = micro_board(M)
    is555 = any(re.search(r"555", c.get("marking") or "") for c in comps.values())
    out = []
    for u in unknowns:
        u = dict(u)
        t = u["text"]
        cid = _id(t) or (u.get("ev") or [None])[0]
        comp = comps.get(cid or "")
        ctype = (comp or {}).get("type", "")
        how = None
        sk = None
        if "No video" in t and mb:
            how = (f"Time the output electrically instead: run the frequency sketch on your {BOARD_NAME[mb]}, "
                   "connected through the divider it describes to the pin that drives the LED")
            sk = {"kind": "frequency", "board": mb}
        elif "Roles not settled" in t and has(M, "multimeter"):
            how = ("With the board unpowered, set the multimeter to continuity: the resistor from the 555's pin 8 to pin 7 is RA, "
                   "the one from pin 7 to pins 2 and 6 is RB")
        elif "Only one side of the board" in t and has(M, "multimeter"):
            how = "Or map the wiring with the multimeter's continuity mode, board unpowered, lead by lead"
        elif comp and ctype == "resistor" and re.search(r"read differently|couldn't be read|low-confidence|would explain", t) and has(M, "multimeter"):
            how = f"Measure {cid} on the resistance range with the board unpowered; lift one lead for an exact reading"
        elif comp and ctype.startswith("capacitor") and re.search(r"worked out|couldn't be read|low-confidence|would explain", t):
            if has(M, "multimeter"):
                how = f"If your multimeter has a capacitance range, desolder one leg of {cid} and measure it"
            elif has(M, "spare capacitor") and has(M, "breadboard", "soldering"):
                how = f"Swap {cid} for a spare of known value and re-record: the blink rate should change in proportion"
        elif "Pixels can't show voltages" in t and not is555:
            if has(M, "oscilloscope"):
                how = "Probe the pin that drives the output: read its frequency, duty cycle and logic level directly"
            elif mb:
                how = f"Time the pin that drives the output with the frequency sketch on your {BOARD_NAME[mb]}"
                sk = {"kind": "frequency", "board": mb}
            elif has(M, "multimeter"):
                how = "Measure the supply voltage and the voltage across the LED while it is on"
        elif "Pixels can't show voltages" in t:
            if has(M, "oscilloscope"):
                how = ("Probe the timing capacitor (555 pins 2 and 6): expect a sawtooth between 1/3 and 2/3 of the supply; "
                       "probe pin 3 to read the frequency directly")
            elif mb:
                how = (f"Log the timing capacitor (555 pins 2 and 6) with your {BOARD_NAME[mb]} using the voltage sketch: "
                       "the Serial Plotter should show a sawtooth between 1/3 and 2/3 of the supply")
                sk = {"kind": "voltage", "board": mb}
            elif has(M, "multimeter"):
                how = ("Power the board and watch the DC voltage on 555 pins 2 and 6: at this slow blink it should rise and fall "
                       "between about 1/3 and 2/3 of the supply")
            elif has(M, "logic probe"):
                how = "Touch the logic probe to the 555's pin 3: its light should blink in step with the LED"
        elif re.search(r"low-confidence|couldn't be read|read differently", t) and has(M, "magnifier", "macro"):
            how = f"Photograph {cid or 'it'} through the magnifier or macro lens"
        if sk:
            u["sketch"] = sk
        if how:
            u["with"] = how
            generic_555 = not is555 and "555" in (u.get("ask") or "")
            u["ask"] = how + (f" (or: {u['ask'][0].lower() + u['ask'][1:]})" if u.get("ask") and not generic_555 else "")
        out.append(u)
    # Input-quality gaps that the core list doesn't already say
    said = " ".join(u["text"] for u in out).lower()
    extra = []
    if assessment and not assessment.get("photos") and assessment.get("video"):
        extra.append({"text": "No photo was given, so parts were read only from small video frames and their markings and values are less certain",
                      "ask": "A sharp photo of the front of the board, straight above, in good light"
                             + (", then close-ups through your magnifier" if has(M, "magnifier", "macro") else ""),
                      "ev": [], "input": True})
    for q in (assessment or {}).get("photos") or []:
        if q.get("issues") and "blurry" not in said:
            i = (assessment["photos"].index(q)) + 1
            fix = "Retake it in good light, phone held still, straight above" + (" or through your magnifier" if has(M, "magnifier", "macro") else "")
            extra.append({"text": f"Photo {i} {'; '.join(q['issues'])}", "ask": fix, "ev": [], "input": True})
    vi = (assessment or {}).get("video")
    if vi and vi.get("issues"):
        extra.append({"text": f"The video is {'; '.join(vi['issues'])}", "ask": "Record 10 to 20 s at 30 fps with the phone resting on something",
                      "ev": [], "input": True})
    mcu = [c for c in comps.values() if c["type"] == "dev_board" or re.search(r"ATMEGA|ATTINY|ESP|STM32|RP2040|PIC", c.get("marking") or "", re.I)]
    if mcu and "firmware" not in said:
        m = mcu[0]
        fw = {"text": f"{m['id']} is a programmable controller, so the blink pattern is set by its firmware, which pixels can't read",
              "ask": f"Read the firmware over USB if it isn't locked (Arduino IDE or esptool), or ask the owner for the sketch",
              "ev": [m["id"]], "input": False}
        if mb:
            fw["with"] = f"Replicate the visible behaviour on your {BOARD_NAME[mb]}: wire it as in the build list and time the original with the frequency sketch"
            fw["ask"] = fw["with"] + " (or: " + fw["ask"][0].lower() + fw["ask"][1:] + ")"
            fw["sketch"] = {"kind": "frequency", "board": mb}
        extra.insert(0, fw)
    last = [u for u in out if "Pixels can't show voltages" in u["text"]]
    body = [u for u in out if u not in last]
    final = body + extra + last
    for i, u in enumerate(final):
        u["id"] = f"U{i + 1}"
    return final
