"""GENESIS "See it" core: deterministic, testable, no model calls.

The agents SEE (observer subagent) and EXPLAIN (reporter subagent). Measuring
the video, decoding values, matching patterns, predicting behaviour, listing
unknowns and checking the report all happen here, in plain code.
"""
from __future__ import annotations

import math
import re
from statistics import mean, pstdev
from typing import Any

import numpy as np

# ------------------------------------------------------------------ waveform --


def analyze_waveform(samples: list[float], dt: float, min_swing: float = 50.0) -> dict:
    """Levels, frequency and duty cycle, with hysteresis so noise can't fake edges."""
    n = len(samples)
    if n < 4 or not dt > 0:
        return {"periodic": False, "confidence": "LOW", "notes": ["too few samples to analyze"]}
    lo, hi = min(samples), max(samples)
    span = hi - lo
    out: dict[str, Any] = {"samples": n, "duration_s": round(n * dt, 3), "min": round(lo, 2), "max": round(hi, 2),
                           "mean": round(mean(samples), 2), "peak_to_peak": round(span, 2), "notes": []}
    if span < min_swing:
        out.update(periodic=False, confidence="HIGH")
        out["notes"].append("no change bigger than the noise")
        return out
    mid, hyst = (lo + hi) / 2, 0.1 * span
    high = samples[0] > mid
    rising: list[int] = []
    falling: list[int] = []
    for i, v in enumerate(samples):
        if not high and v > mid + hyst:
            high = True
            rising.append(i)
        elif high and v < mid - hyst:
            high = False
            falling.append(i)
    out.update(threshold=round(mid, 2), rising_edges=len(rising), falling_edges=len(falling),
               rising_idx=rising, falling_idx=falling)
    periods = [b - a for a, b in zip(rising, rising[1:])]
    if not periods:
        out.update(periodic=False, confidence="LOW")
        out["notes"].append("fewer than 2 full cycles: record for longer")
        return out
    mp = mean(periods)
    period = mp * dt
    jitter = pstdev(periods) / mp if len(periods) > 1 else 0.0
    duties = []
    for a, b in zip(rising, rising[1:]):
        f = next((x for x in falling if a < x < b), None)
        if f is not None:
            duties.append((f - a) / (b - a))
    out.update(periodic=True, cycles=len(periods), period_s=round(period, 4), frequency_hz=round(1 / period, 4),
               period_jitter=round(jitter, 4), duty_cycle=round(mean(duties), 4) if duties else None,
               frequency_resolution_hz=round((1 / period) * dt / period, 4))
    if len(periods) >= 5 and jitter < 0.05:
        out["confidence"] = "HIGH"
    elif len(periods) >= 2:
        out["confidence"] = "PROBABLE"
    else:
        out["confidence"] = "LOW"
        out["notes"].append("only one full cycle: record for longer")
    if jitter >= 0.05:
        out["notes"].append("cycle lengths vary by more than 5%")
    return out


# --------------------------------------------------------------------- video --


def changing_regions(frames: np.ndarray, min_std: float = 6.0, rel_threshold: float = 0.45,
                     min_area: int = 2, max_regions: int = 3, max_changing_fraction: float = 0.15) -> dict:
    """Find what changes over time WITHOUT a model: per-pixel brightness spread."""
    import cv2  # local import keeps the rest of the core usable without OpenCV

    std = frames.std(axis=0)
    smax = float(std.max()) if std.size else 0.0
    thr = max(min_std, smax * rel_threshold)
    mask = (std >= thr).astype(np.uint8)
    fraction = float(mask.mean()) if mask.size else 0.0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
    score = np.bincount(labels.ravel(), weights=std.ravel(), minlength=n)
    blobs = []
    for k in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[k])
        if area >= min_area:
            blobs.append({"area": area, "score": float(score[k]), "box": [x, y, x + w, y + h]})
    blobs.sort(key=lambda b: -b["score"])
    gm = frames.mean(axis=(1, 2))
    return {"regions": blobs[:max_regions], "std_max": round(smax, 2), "threshold": round(thr, 2),
            "changing_fraction": round(fraction, 4), "global_brightness_std": round(float(gm.std()), 2),
            "camera_moved": fraction > max_changing_fraction}


def trace_region(frames: np.ndarray, box: list[int]) -> list[float]:
    x0, y0, x1, y1 = box
    return [float(v) for v in frames[:, y0:y1, x0:x1].mean(axis=(1, 2))]


def pearson(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n < 3:
        return 0.0
    x, y = np.asarray(a[:n]), np.asarray(b[:n])
    if x.std() == 0 or y.std() == 0:
        return 0.0
    return float(np.corrcoef(x, y)[0, 1])


def analyze_video(frames: np.ndarray, times: list[float]) -> dict:
    """frames: (N, H, W) greyscale. Returns regions with traces and timing analysis."""
    n = len(frames)
    dt = (times[-1] - times[0]) / (n - 1) if n > 1 else 0.0
    found = changing_regions(frames)
    notes = []
    if found["camera_moved"]:
        notes.append("much of the picture changes: the camera moved or the lighting changed; hold the phone still")
    if not found["regions"]:
        notes.append("nothing in the video changes brightness noticeably")
    regions = []
    for i, r in enumerate(found["regions"]):
        trace = trace_region(frames, r["box"])
        a = analyze_waveform(trace, dt, 10)
        if a.get("periodic") and dt and a["frequency_hz"] > 0.25 / dt:
            a["notes"].append("close to the video's frame-rate limit; faster blinking could be mis-measured")
        regions.append({"index": i, "box": r["box"], "area": r["area"], "trace": [round(v, 1) for v in trace],
                        "analysis": a, "brightest_frame": int(np.argmax(trace)), "darkest_frame": int(np.argmin(trace))})
    relations = []
    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            c = pearson(regions[i]["trace"], regions[j]["trace"])
            relations.append({"a": i, "b": j, "correlation": round(c, 3),
                              "kind": "alternate" if c < -0.6 else "together" if c > 0.6 else "unrelated"})
    h, w = frames.shape[1:] if n else (0, 0)
    return {"frames": n, "dt": round(dt, 5), "fps": round(1 / dt, 2) if dt else 0, "duration_s": round(n * dt, 2),
            "width": int(w), "height": int(h), **found, "regions": regions, "relations": relations, "notes": notes}


# ------------------------------------------------------------ value decoding --

DIGIT = {"black": 0, "brown": 1, "red": 2, "orange": 3, "yellow": 4, "green": 5, "blue": 6, "violet": 7,
         "purple": 7, "grey": 8, "gray": 8, "white": 9}
MULT = {**{k: 10 ** v for k, v in DIGIT.items()}, "gold": 0.1, "silver": 0.01}
TOL = {"brown": 1, "red": 2, "green": 0.5, "blue": 0.25, "violet": 0.1, "grey": 0.05, "gray": 0.05, "gold": 5, "silver": 10}
E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8]
E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]


def nearest_standard(v: float, series: list[float] = E12) -> dict | None:
    if not v or v <= 0:
        return None
    dec = 10 ** math.floor(math.log10(v))
    best = None
    for d in (dec / 10, dec, dec * 10):
        for s in series:
            c = s * d
            err = abs(c - v) / v
            if best is None or err < best[1]:
                best = (c, err)
    return {"value": float(f"{best[0]:.6g}"), "rel_err": round(best[1], 4)}


def _decode_bands_once(b: list[str]) -> dict | None:
    n = len(b)
    tol = 20.0
    if n == 3:
        digits, mult = b[:2], b[2]
    elif n == 4:
        digits, mult, tol = b[:2], b[2], TOL.get(b[3])
    elif n in (5, 6):
        digits, mult, tol = b[:3], b[3], TOL.get(b[4])
    else:
        return None
    if any(d not in DIGIT for d in digits) or mult not in MULT or tol is None:
        return None
    base = 0
    for d in digits:
        base = base * 10 + DIGIT[d]
    return {"ohms": float(f"{base * MULT[mult]:.6g}"), "tolerance_pct": tol}


def decode_bands(bands: list[str] | None) -> dict | None:
    """Bands as seen; the resistor may be upside down, so try both directions."""
    if not bands or len(bands) < 3:
        return None
    b = [str(c).lower().strip() for c in bands]
    tries = [(r, rev) for r, rev in ((_decode_bands_once(b), False), (_decode_bands_once(b[::-1]), True)) if r]
    if not tries:
        return None

    def score(t):
        r, rev = t
        s = 0
        if (b[0] if rev else b[-1]) in ("gold", "silver"):
            s += 2
        if nearest_standard(r["ohms"], E24)["rel_err"] < 0.001:
            s += 1
        return s

    tries.sort(key=score, reverse=True)
    best = tries[0]
    other = tries[1] if len(tries) > 1 else None
    return {"value": best[0]["ohms"], "tolerance_pct": best[0]["tolerance_pct"], "reversed": best[1],
            "ambiguous": bool(other) and score(best) == score(other) and best[0]["ohms"] != other[0]["ohms"],
            "alternative": other[0]["ohms"] if other else None}


SI = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9}


def parse_resistance(text: Any) -> float | None:
    if text is None:
        return None
    s = re.sub(r"\s+", "", str(text))
    s = re.sub(r"ohms?|Ω|ω", "", s, flags=re.I)
    m = re.fullmatch(r"(\d+)([RrkKM])(\d+)", s)  # 4k7, 4R7, 1M5
    if m:
        mul = 1 if m.group(2) in "Rr" else SI[m.group(2)]
        return float(f"{m.group(1)}.{m.group(3)}") * mul
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([kKM]?)[Rr]?", s)
    if m:
        d = m.group(1)
        if not m.group(2) and re.fullmatch(r"\d{3,4}", d) and not re.search(r"[Rr]$", s):
            base, exp = int(d[:-1]), int(d[-1])
            if len(d) == 3 and exp <= 6 and d[2] != "0":
                return float(base * 10 ** exp)        # SMD code: 103 = 10 k
            if len(d) == 4 and 0 < exp <= 6:
                return float(base * 10 ** exp)        # 4702 = 47 k
        return float(d) * (SI[m.group(2)] if m.group(2) else 1)
    return None


def _cap_prefix(p: str) -> float | None:
    if not p:
        return 1.0
    if p == "M":
        return 1e-6  # old "100MFD" labels mean microfarads
    return {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3}.get(p.lower())


def parse_capacitance(text: Any, ctype: str = "") -> float | None:
    if text is None:
        return None
    s = re.sub(r"\s+", "", str(text))
    m = re.search(r"(\d+(?:\.\d+)?)([pnuµμmM]?)F", s, flags=re.I)        # 100uF, 0.1µF, 100MFD
    if m and _cap_prefix(m.group(2)) is not None:
        return float(m.group(1)) * _cap_prefix(m.group(2))
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([pnuµμ])", s, flags=re.I)         # 10n, 100u
    if m:
        return float(m.group(1)) * _cap_prefix(m.group(2))
    m = re.fullmatch(r"(\d)([pnuµμ])(\d)", s, flags=re.I)                # 4u7
    if m:
        return float(f"{m.group(1)}.{m.group(3)}") * _cap_prefix(m.group(2))
    m = re.fullmatch(r"(\d{3})[JKMjkm]?", s)                              # 104 = 100 nF
    if m and "electrolytic" not in ctype:
        d = m.group(1)
        return int(d[:2]) * 10 ** int(d[2]) * 1e-12
    m = re.fullmatch(r"(\d+(?:\.\d+)?)", s)
    if m and "electrolytic" in ctype:
        return float(m.group(1)) * 1e-6                                   # electrolytics: uF
    return None


def value_of(c: dict) -> dict | None:
    """The part's value and how we know it. A human-entered value wins."""
    if c["type"] == "resistor":
        for src, basis in ((c.get("human_value"), "you"), (c.get("value_printed"), "printed"), (c.get("marking"), "printed")):
            v = parse_resistance(src)
            if v:
                return {"value": v, "unit": "ohm", "basis": basis, "tolerance_pct": 5}
        d = decode_bands(c.get("bands"))
        if d:
            return {"value": d["value"], "unit": "ohm", "basis": "colour bands", "tolerance_pct": d["tolerance_pct"],
                    "ambiguous": d["ambiguous"], "alternative": d["alternative"]}
        return None
    if c["type"].startswith("capacitor"):
        for src, basis in ((c.get("human_value"), "you"), (c.get("value_printed"), "printed"), (c.get("marking"), "printed")):
            v = parse_capacitance(src, c["type"])
            if v:
                return {"value": v, "unit": "F", "basis": basis, "tolerance_pct": 20 if "electrolytic" in c["type"] else 10}
    return None


def _g(x: float) -> str:
    return f"{x:.4g}"


def fmt_ohms(v: float | None) -> str:
    if v is None:
        return "?"
    if v >= 1e6:
        return f"{_g(v / 1e6)} MΩ"
    if v >= 1e3:
        return f"{_g(v / 1e3)} kΩ"
    return f"{_g(v)} Ω"


def fmt_farads(v: float | None) -> str:
    if v is None:
        return "?"
    if v >= 1e-6:
        return f"{_g(v / 1e-6)} µF"
    if v >= 1e-9:
        return f"{_g(v / 1e-9)} nF"
    return f"{_g(v / 1e-12)} pF"


def fmt_value(c: dict) -> str | None:
    if not c.get("value"):
        return None
    return fmt_ohms(c["value"]["value"]) if c["type"] == "resistor" else fmt_farads(c["value"]["value"])


# ---------------------------------------------------------------- components --

TYPES = ["resistor", "capacitor_electrolytic", "capacitor_ceramic", "capacitor_film", "ic", "transistor", "mosfet",
         "diode", "led", "ldr", "potentiometer", "relay", "crystal", "inductor", "connector", "battery", "switch",
         "button", "buzzer", "motor", "sensor_module", "display", "voltage_regulator", "dev_board", "transformer", "fuse",
         "optocoupler", "speaker", "microphone", "antenna", "servo", "stepper", "other"]
SYNONYMS = [(r"motor driver|h.?bridge|driver (module|board)|l298|l9110|tb6612|drv88\d\d|a4988|uln200\d|mx1508|bts7960", "ic"),
            (r"servo", "servo"), (r"stepper|nema ?\d+|28byj", "stepper"),
            (r"arduino|nodemcu|wemos|lolin|devkit|dev.?board|development board|microcontroller board|esp32|esp8266|esp-\d|pro mini|d1 mini", "dev_board"),
            (r"transformer|flyback", "transformer"), (r"fuse|polyfuse|ptc", "fuse"),
            (r"opto|pc817|photocoupler", "optocoupler"), (r"microphone|\bmic\b|electret", "microphone"),
            (r"antenna|aerial", "antenna"), (r"speaker|loudspeaker", "speaker"),
            (r"electrolytic", "capacitor_electrolytic"), (r"ceramic|disc", "capacitor_ceramic"),
            (r"film|polyester|mylar", "capacitor_film"), (r"^cap", "capacitor_ceramic"),
            (r"photo.?resist|light.?dependent|ldr", "ldr"), (r"pot|trimmer", "potentiometer"),
            (r"regulator", "voltage_regulator"), (r"chip|integrated|^ic$", "ic"), (r"mosfet", "mosfet"),
            (r"transistor|bjt", "transistor"), (r"led", "led"), (r"diode", "diode"), (r"resistor", "resistor"),
            (r"relay", "relay"), (r"crystal|oscillator", "crystal"), (r"battery|cell", "battery"),
            (r"terminal|header|connector|jack|socket", "connector"), (r"buzzer|speaker|piezo", "buzzer"),
            (r"motor", "motor"), (r"switch", "switch"), (r"button", "button")]


def normalize_type(t: Any) -> str:
    s = str(t or "").lower().strip()
    if s in TYPES:
        return s
    for pat, v in SYNONYMS:
        if re.search(pat, s):
            return v
    return "other"


CONF = ("HIGH", "PROBABLE", "LOW")


def normalize_observation(raw: dict) -> dict:
    """Observer output -> evidence: components O1..On, board notes B1..Bn."""
    comps = []
    for i, c in enumerate(raw.get("components") or []):
        comp = {"id": f"O{i + 1}", "type": normalize_type(c.get("type")),
                "marking": (str(c["marking"]).strip() or None) if c.get("marking") else None,
                "bands": [str(x) for x in c["bands"]] if c.get("bands") else None,
                "value_printed": (str(c["value_printed"]).strip() or None) if c.get("value_printed") else None,
                "image": c.get("image") if isinstance(c.get("image"), int) else 1,
                "box": [float(v) for v in c["box"]] if isinstance(c.get("box"), list) and len(c["box"]) == 4 else None,
                "confidence": c.get("confidence") if c.get("confidence") in CONF else "PROBABLE",
                "evidence": str(c.get("evidence") or ""), "human_value": None, "status": "OBSERVED"}
        comp["value"] = value_of(comp)
        comps.append(comp)
    cr = raw.get("changing_region")
    ci = cr.get("component_index") if cr else None
    board = [{"id": f"B{i + 1}", "note": str(b.get("note") or ""), "image": b.get("image"),
              "confidence": b.get("confidence") if b.get("confidence") in CONF else "PROBABLE", "status": "OBSERVED"}
             for i, b in enumerate(raw.get("board") or [])]
    return {"components": comps, "board": board,
            "changing_region": {"component_id": comps[ci]["id"] if isinstance(ci, int) and 0 <= ci < len(comps) else None,
                                "type": normalize_type(cr.get("type")), "evidence": str(cr.get("evidence") or "")} if cr else None,
            "cannot_see": [str(s) for s in raw.get("cannot_see") or []]}


def set_human_value(comp: dict, text: str | None) -> dict | None:
    comp["human_value"] = str(text).strip() if text and str(text).strip() else None
    comp["value"] = value_of(comp)
    return comp["value"]


# ------------------------------------------------------------------ patterns --

RX = {
    "t555": re.compile(r"(^|[^0-9])555([^0-9]|$)|NE555|LM555|SE555|NA555|SA555|TLC555|LMC555|ICM7555|TS555|7555", re.I),
    "mcu": re.compile(r"ATTINY|ATMEGA|AT89|PIC1\d|PIC\d|STM32|STM8|ESP32|ESP8266|ESP-|CH32|CH55|RP2040|RP2350|N76E|STC\d|GD32|SAMD|NRF5|ATMEL|ARDUINO|NODEMCU|WEMOS|LOLIN|WROOM|WROVER|D1.?MINI", re.I),
    "arduino": re.compile(r"ARDUINO|ATMEGA328|ATMEGA32U4|ATMEGA2560|ATMEGA168|UNO|NANO|PRO.?MINI|LEONARDO|CH340", re.I),
    "esp": re.compile(r"ESP32|ESP8266|ESP-?\d\d?|NODEMCU|WEMOS|LOLIN|WROOM|WROVER|D1.?MINI", re.I),
    "opamp": re.compile(r"LM358|LM393|LM339|LM324|LM311|LM2903|TL07|TL08|NE5532|MCP60|LM741|UA741|OP07", re.I),
    "reg": re.compile(r"(^|[^0-9])78\d\d|(^|[^0-9])79\d\d|78L\d\d|LM317|LM337|AMS1117|LM1117|LD1117|HT73\d\d|HT75\d\d|MCP1700|XC6206", re.I),
    "buck": re.compile(r"LM2596|LM2576|MP1584|MP2307|MP2315|XL4015|XL4016|XL1509|TPS5430|TPS54\d+|AP3211|SY8\d{3}|LM2678", re.I),
    "boost": re.compile(r"MT3608|XL6009|SX1308|LM2577|XL6019|TPS6104\d|FP6291|B628", re.I),
    "charger": re.compile(r"TP4056|TP4057|MCP7383\d|IP5306|IP5328|LTC4054|CN3065|BQ2405\d|DW01|FS8205", re.I),
    "smps": re.compile(r"TNY\d+|LNK\d+|TOP2\d\d|VIPER\d+|OB22\d\d|OB25\d\d|FSD\d+|UC384[2-5]|NCP1\d{3}|LD7535|THX\d+|PN8\d{3}|SG6\d{3}|AP8\d{3}", re.I),
    "audio": re.compile(r"LM386|PAM8403|PAM8610|TDA20[0-9]\d|TDA7\d{3}|TPA3\d{3}|TPA2\d{3}|NS41\d\d|LM4871|XPT8871|HXJ8002|MAX98357", re.I),
    "usbserial": re.compile(r"CH340|CH341|CP210\d|FT232|PL2303|CH9102", re.I),
    "wireless": re.compile(r"HC-?0[56]|NRF24|NRF52|CC2541|CC2530|SX127\d|RFM9\d|ESP-?01|LORA|BLE|HM-?10|JDY-?\d+", re.I),
    "sensor": re.compile(r"DHT\d\d|HC-?SR0\d|BME\d{3}|BMP\d{3}|MPU-?\d{4}|ADXL\d+|DS18B20|HC-?SR501|LM35|SHT\d\d|VL53L\d|INA2\d\d|HX711|MQ-?\d", re.I),
    "mdrv": re.compile(r"L298|L293|L9110|DRV88|DRV87|TB6612|A4988|ULN200|ULN280|MX1508|BTS7960|IBT-?2|PCA9685|HG7881|MP6550|AT8236|TMC2\d{3}", re.I),
    "pir": re.compile(r"BISS0001", re.I),
    "bridge": re.compile(r"DB10\d|KBP\d|MB\d+S|GBU\d|KBL\d|W0\dM|DF0\d", re.I),
}


def _ctx(comps: list[dict], video: dict | None) -> dict:
    caps = [c for c in comps if c["type"].startswith("capacitor")]
    ics = [c for c in comps if c["type"] in ("ic", "voltage_regulator")]
    periodic = [r for r in (video or {}).get("regions", []) if r["analysis"].get("periodic") and r["analysis"]["confidence"] != "LOW"]
    has_video = bool(video and video.get("frames"))
    return {"comps": comps, "of": lambda t: [c for c in comps if c["type"] == t], "caps": caps, "ics": ics,
            "marked": lambda rx: [c for c in comps if c.get("marking") and rx.search(c["marking"])],
            "unreadable_ic": [c for c in ics if not c.get("marking") or c["confidence"] == "LOW"],
            "has_video": has_video, "periodic": periodic,
            "alternate": [r for r in (video or {}).get("relations", []) if r["kind"] == "alternate"]}


def _ids(lst):
    return [c["id"] for c in lst]


def _v(rs):
    return [f"V{r['index'] + 1}" for r in rs]


def _clue(text, weight, test, required=False):
    return {"text": text, "weight": weight, "test": test, "required": required}


def _ic_marked(rx_key, fallback):
    def t(x):
        m = x["marked"](RX[rx_key])
        if m:
            return {"s": 1, "ev": _ids(m)}
        if x["unreadable_ic"]:
            return {"s": fallback, "ev": _ids(x["unreadable_ic"]), "note": "an IC whose marking can't be read"}
        return {"s": 0}
    return t


def _count(t, need, partial=0.5, minimum=1):
    def f(x):
        lst = x["of"](t) if t != "caps" else x["caps"]
        return {"s": 1 if len(lst) >= need else partial if len(lst) >= minimum else 0, "ev": _ids(lst)}
    return f


def _outputs(types):
    def f(x):
        o = [c for c in x["comps"] if c["type"] in types]
        return {"s": 1 if o else 0, "ev": _ids(o)}
    return f


def _no_ic(x):
    return {"s": 0 if [c for c in x["ics"] if c["type"] == "ic"] else 1, "ev": []}


def _steady_blink(x):
    if not x["has_video"]:
        return None
    return {"s": 1 if x["periodic"] else 0, "ev": _v(x["periodic"])}


def _take_turns(x):
    if not x["has_video"]:
        return None
    if x["alternate"]:
        return {"s": 1, "ev": [f"V{r['a'] + 1}" for r in x["alternate"]] + [f"V{r['b'] + 1}" for r in x["alternate"]]}
    return {"s": 0.3 if x["periodic"] else 0, "ev": _v(x["periodic"])}


def _bonus(t):
    def f(x):
        lst = x["of"](t)
        return {"s": 1, "ev": _ids(lst)} if lst else None
    return f


def _mcu(x):
    """A microcontroller chip by its marking, or a whole Arduino / ESP development board."""
    m = x["marked"](RX["mcu"]) + [c for c in x["of"]("dev_board") if not RX["mcu"].search(c.get("marking") or "")]
    if m:
        return {"s": 1, "ev": _ids(m)}
    if x["unreadable_ic"]:
        return {"s": 0.3, "ev": _ids(x["unreadable_ic"]), "note": "an IC whose marking can't be read"}
    return {"s": 0}


def _family(key):
    def f(x):
        m = x["marked"](RX[key])
        return {"s": 1 if m else 0, "ev": _ids(m)}
    return f


def _marked_or(key, types=(), partial=0.6):
    """A part whose marking belongs to a family, or (weaker) a part of the right type."""
    def f(x):
        m = x["marked"](RX[key])
        if m:
            return {"s": 1, "ev": _ids(m)}
        t = [c for c in x["comps"] if c["type"] in types]
        return {"s": partial if t else 0, "ev": _ids(t)}
    return f


def _moving(x):
    m = x["of"]("motor") + x["of"]("servo") + x["of"]("stepper")
    return {"s": 1 if m else 0, "ev": _ids(m)}


def _driver(x):
    m = x["marked"](RX["mdrv"])
    if m:
        return {"s": 1, "ev": _ids(m)}
    t = x["of"]("transistor") + x["of"]("mosfet") + x["of"]("relay")
    if t:
        return {"s": 0.6, "ev": _ids(t)}
    servos = x["of"]("servo")       # hobby servos carry their own driver
    return {"s": 1 if servos and len(servos) == len(x["of"]("servo") + x["of"]("motor") + x["of"]("stepper")) else 0, "ev": _ids(servos)}


def _motor_driver(x):
    m = x["marked"](RX["mdrv"])
    if m:
        return {"s": 1, "ev": _ids(m)}
    t = [c for c in x["comps"] if c["type"] in ("transistor", "mosfet")]
    return {"s": 0.6 if t and x["of"]("motor") else 0, "ev": _ids(t)}


def _regulator(x):
    m = x["marked"](RX["reg"]) + [c for c in x["of"]("voltage_regulator") if not RX["reg"].search(c.get("marking") or "")]
    return {"s": 1 if m else 0, "ev": _ids(m)}


def _bridge(x):
    m = x["marked"](RX["bridge"])
    if m:
        return {"s": 1, "ev": _ids(m)}
    d = x["of"]("diode")
    return {"s": 1 if len(d) >= 4 else 0, "ev": _ids(d)}


PATTERNS = [
    {"id": "astable555", "name": "555 timer blinker", "role": "function",
     "summary": "A 555 timer repeatedly charges a capacitor through two resistors and discharges it through one, switching its output on and off at a steady rate.",
     "clues": [_clue("an 8-pin IC marked 555", 5, _ic_marked("t555", 0.4), required=True),
               _clue("at least two resistors to set the timing", 1, _count("resistor", 2)),
               _clue("a timing capacitor", 1, _count("caps", 1)),
               _clue("an LED", 1, _count("led", 1)),
               _clue("a light that blinks at a steady rate", 3, _steady_blink)]},
    {"id": "multivibrator", "name": "Two-transistor flasher (astable multivibrator)", "role": "function",
     "summary": "Two transistors switch each other on and off through two capacitors, so two lights take turns.",
     "clues": [_clue("two transistors", 3, _count("transistor", 2, partial=0, minimum=99), required=True),
               _clue("two capacitors to set the timing", 2, _count("caps", 2, partial=0.4)),
               _clue("about four resistors", 1, _count("resistor", 4, partial=0.5, minimum=2)),
               _clue("two LEDs", 1, _count("led", 2, partial=0.4)),
               _clue("no IC doing the timing", 1, _no_ic),
               _clue("two lights that take turns", 3, _take_turns)]},
    {"id": "mcu_blinker", "name": "Microcontroller-driven output", "role": "function",
     "summary": "A programmed microcontroller switches the output; its behaviour lives in firmware, not in the parts' values.",
     "clues": [_clue("a microcontroller or Arduino / ESP board", 5, _mcu, required=True),
               _clue("no motors (a moving machine is a robot, not a blinker)", 1, lambda x: {"s": 0 if _moving(x)["s"] else 1, "ev": []}),
               _clue("an LED or other output", 1, _outputs(("led", "relay", "buzzer", "motor"))),
               _clue("a crystal", 1, _bonus("crystal")),
               _clue("visible activity in the video", 1, _steady_blink)]},
    {"id": "light_comparator", "name": "Light sensor with comparator", "role": "function",
     "summary": "A light-dependent resistor and a potentiometer feed a comparator, which switches the output when light crosses a threshold.",
     "clues": [_clue("a comparator or op-amp IC", 4, _ic_marked("opamp", 0.3), required=True),
               _clue("a light-dependent resistor", 3, _count("ldr", 1)),
               _clue("a potentiometer to set the threshold", 2, _count("potentiometer", 1)),
               _clue("an LED or relay output", 1, _outputs(("led", "relay", "buzzer"))),
               _clue("no steady blinking", 1, lambda x: None if not x["has_video"] else {"s": 0 if x["periodic"] else 1, "ev": []})]},
    {"id": "light_transistor", "name": "Light-controlled transistor switch", "role": "function",
     "summary": "A light-dependent resistor sets a transistor's base voltage, so the output turns on in the dark (or in light).",
     "clues": [_clue("a light-dependent resistor", 3, _count("ldr", 1), required=True),
               _clue("a transistor", 2, _count("transistor", 1)),
               _clue("no IC", 1, _no_ic),
               _clue("an LED or relay output", 1, _outputs(("led", "relay")))]},
    {"id": "relay_driver", "name": "Relay driver", "role": "function",
     "summary": "A transistor switches a relay coil; a diode across the coil absorbs the voltage spike when it turns off.",
     "clues": [_clue("a relay", 4, _count("relay", 1), required=True),
               _clue("a transistor", 2, _outputs(("transistor", "mosfet"))),
               _clue("a diode across the coil", 2, _count("diode", 1))]},
    {"id": "motor_driver", "name": "Motor driver", "role": "function",
     "summary": "A driver IC or transistor bridge switches current through a motor, often in both directions.",
     "clues": [_clue("a motor driver IC or power transistors", 4, _motor_driver, required=True),
               _clue("no controller (a driver board on its own)", 2, lambda x: {"s": 0 if _mcu(x)["s"] >= 1 else 1, "ev": []}),
               _clue("a motor", 2, _count("motor", 1)),
               _clue("protection diodes", 1, _bonus("diode"))]},
    {"id": "pir", "name": "PIR motion sensor", "role": "function",
     "summary": "A pyroelectric sensor behind a lens detects moving warm bodies; a BISS0001 chip turns that into an output pulse.",
     "clues": [_clue("a BISS0001 chip", 5, lambda x: {"s": 1 if x["marked"](RX["pir"]) else 0, "ev": _ids(x["marked"](RX["pir"]))}, required=True),
               _clue("two adjustment potentiometers", 1, _count("potentiometer", 2))]},
    {"id": "arduino_board", "name": "Arduino-compatible controller", "role": "supporting",
     "summary": "An AVR microcontroller (ATmega) on an Arduino or compatible board runs a sketch; its pins drive the outputs.",
     "clues": [_clue("an Arduino board or ATmega chip", 4, _family("arduino"), required=True),
               _clue("a 16 MHz crystal or resonator", 1, _bonus("crystal"))]},
    {"id": "esp_board", "name": "ESP32 / ESP8266 Wi-Fi controller", "role": "supporting",
     "summary": "An Espressif ESP32 or ESP8266 module runs the firmware and can talk over Wi-Fi (and Bluetooth on the ESP32); its pins are 3.3 V logic.",
     "clues": [_clue("an ESP32 or ESP8266 module or board", 4, _family("esp"), required=True)]},
    {"id": "robot_drive", "name": "Motorised robot or vehicle", "role": "function",
     "summary": "A controller reads its sensors and commands a motor driver, which switches battery power into the motors or servos; "
                "power, control, sensing and drive are separate layers that must agree on voltage, current and ground.",
     "clues": [_clue("motors, servos or steppers", 4, _moving, required=True),
               _clue("a motor driver (or transistors switching the motors)", 3, _driver),
               _clue("a microcontroller or Arduino / ESP board", 2, _mcu),
               _clue("a battery or power stage", 1, lambda x: {"s": 1 if x["of"]("battery") or x["of"]("voltage_regulator") or x["marked"](RX["buck"]) else 0,
                                                              "ev": _ids(x["of"]("battery"))}),
               _clue("sensors", 1, lambda x: {"s": 1, "ev": _ids(x["of"]("sensor_module") + x["marked"](RX["sensor"]))}
                     if x["of"]("sensor_module") or x["marked"](RX["sensor"]) else None)]},
    {"id": "mains_adapter", "name": "Switch-mode power supply (mains adapter)", "role": "function",
     "summary": "Mains AC is rectified and chopped at high frequency through a small transformer; an optocoupler feeds the output voltage back to the controller, which keeps it steady.",
     "clues": [_clue("a transformer", 3, _count("transformer", 1), required=True),
               _clue("a switching controller IC", 3, _marked_or("smps", ("ic",), 0.4)),
               _clue("an optocoupler for feedback", 2, _count("optocoupler", 1)),
               _clue("a bridge rectifier or four diodes", 1, _bridge),
               _clue("a fuse on the mains side", 1, _bonus("fuse"))]},
    {"id": "liion_charger", "name": "Li-ion battery charger", "role": "function",
     "summary": "A charger IC feeds a single lithium cell with constant current, then constant voltage up to 4.2 V; a protection chip cuts off over-discharge and short circuits.",
     "clues": [_clue("a Li-ion charger or protection IC", 5, _marked_or("charger", (), 0), required=True),
               _clue("a battery or battery connector", 1, _outputs(("battery", "connector"))),
               _clue("status LEDs", 1, _bonus("led"))]},
    {"id": "buck_converter", "name": "DC-DC buck converter (step-down)", "role": "function",
     "summary": "A switching regulator chops the input and smooths it through an inductor and capacitor, giving a lower voltage far more efficiently than a linear regulator.",
     "clues": [_clue("a buck regulator IC", 5, _marked_or("buck", (), 0), required=True),
               _clue("an inductor", 2, _count("inductor", 1)),
               _clue("a diode or second switch", 1, _bonus("diode")),
               _clue("input and output capacitors", 1, _count("caps", 2))]},
    {"id": "boost_converter", "name": "DC-DC boost converter (step-up)", "role": "function",
     "summary": "A switching regulator stores energy in an inductor and releases it through a diode, giving a higher voltage than its input.",
     "clues": [_clue("a boost regulator IC", 5, _marked_or("boost", (), 0), required=True),
               _clue("an inductor", 2, _count("inductor", 1)),
               _clue("a rectifier diode", 1, _bonus("diode")),
               _clue("a potentiometer to set the output", 1, _bonus("potentiometer"))]},
    {"id": "audio_amp", "name": "Audio amplifier", "role": "function",
     "summary": "An amplifier IC boosts a small audio signal to drive a speaker; capacitors couple the input and set the gain.",
     "clues": [_clue("an audio amplifier IC", 5, _marked_or("audio", (), 0), required=True),
               _clue("a speaker or speaker connector", 2, _outputs(("speaker", "buzzer", "connector"))),
               _clue("a volume potentiometer", 1, _bonus("potentiometer")),
               _clue("coupling capacitors", 1, _count("caps", 2))]},
    {"id": "sensor_module", "name": "Sensor module", "role": "function",
     "summary": "A sensor and its support parts on a small board, read by a microcontroller over a digital pin, I2C or an analog output.",
     "clues": [_clue("a sensor chip or sensor module", 5, _marked_or("sensor", ("sensor_module",), 0.6), required=True),
               _clue("a board on its own (no motors or controller board)", 2,
                     lambda x: {"s": 0 if _moving(x)["s"] or x["of"]("dev_board") else 1, "ev": []}),
               _clue("a header to connect it", 1, _bonus("connector")),
               _clue("a power LED", 1, _bonus("led"))]},
    {"id": "usb_serial", "name": "USB-to-serial interface", "role": "supporting",
     "summary": "A USB bridge chip lets a computer talk to the board's microcontroller over a serial port; it is how Arduino-style boards are programmed.",
     "clues": [_clue("a USB-serial chip (CH340, CP2102, FT232)", 4, _family("usbserial"), required=True)]},
    {"id": "wireless", "name": "Wireless module (Bluetooth, Wi-Fi, LoRa, 2.4 GHz)", "role": "supporting",
     "summary": "A radio module gives the device a wireless link; the antenna is usually a PCB trace or a small chip.",
     "clues": [_clue("a radio module marking", 4, _family("wireless"), required=True),
               _clue("an antenna", 1, _bonus("antenna"))]},
    {"id": "linear_regulator", "name": "Voltage regulator stage", "role": "supporting",
     "summary": "A regulator turns a higher supply voltage into a steady lower one, with capacitors on its input and output.",
     "clues": [_clue("a regulator IC", 4, _regulator, required=True),
               _clue("capacitors around it", 1, _count("caps", 2))]},
    {"id": "rectifier", "name": "Rectifier and filter", "role": "supporting",
     "summary": "Diodes turn AC into pulsing DC and a large capacitor smooths it.",
     "clues": [_clue("a bridge rectifier or four diodes", 3, _bridge, required=True),
               _clue("a large electrolytic capacitor", 1, _count("capacitor_electrolytic", 1))]},
]


def score_patterns(comps: list[dict], video: dict | None) -> dict:
    x = _ctx(comps, video)
    results = []
    for p in PATTERNS:
        got = checked = total = 0.0
        excluded = False
        matched, missing, unknown = [], [], []
        for c in p["clues"]:
            total += c["weight"]
            r = c["test"](x)
            if r is None:
                unknown.append(c["text"])
                continue
            checked += c["weight"]
            got += c["weight"] * r["s"]
            if r["s"] > 0:
                matched.append({"text": r.get("note") or c["text"], "strength": r["s"], "ev": list(dict.fromkeys(r.get("ev") or []))})
            else:
                missing.append(c["text"])
                excluded = excluded or c["required"]
        score = round(got / checked, 3) if checked else 0
        if not excluded and score > 0:
            results.append({"id": p["id"], "name": p["name"], "role": p["role"], "summary": p["summary"], "score": score,
                            "coverage": round(checked / total, 3), "matched": matched, "missing": missing, "unknown": unknown})
    results.sort(key=lambda r: (-r["score"], -r["coverage"]))
    fn = [r for r in results if r["role"] == "function"]
    top = fn[0] if fn else None
    confidence = "NONE"
    if top:
        gap = top["score"] - (fn[1]["score"] if len(fn) > 1 else 0)
        if top["score"] >= 0.8 and top["coverage"] >= 0.75 and gap >= 0.25:
            confidence = "HIGH"
        elif top["score"] >= 0.6:
            confidence = "PROBABLE"
        elif top["score"] >= 0.3:
            confidence = "POSSIBLE"
    return {"ranked": results, "top": top, "confidence": confidence,
            "supporting": [r for r in results if r["role"] == "supporting" and r["score"] >= 0.6]}


# -------------------------------------------------------------- cross-checks --


def _best_light(video: dict | None) -> dict | None:
    p = [r for r in (video or {}).get("regions", []) if r["analysis"].get("periodic")]
    p.sort(key=lambda r: (r["analysis"]["confidence"] != "HIGH", -r["area"]))
    return p[0] if p else None


def _suggest_fix(comp: dict, needed: float, is_resistor: bool) -> dict | None:
    if not comp.get("value") or not needed or needed <= 0:
        return None
    have = comp["value"]["value"]
    ratio = needed / have
    fmt = fmt_ohms if is_resistor else fmt_farads
    for k in (10, 0.1):
        if abs(ratio / k - 1) < 0.15:
            return {"component": comp["id"], "needed": needed, "plausibility": 1,
                    "text": f"{comp['id']} would explain the video if it were {fmt(needed)} instead of {fmt(have)}: "
                            + ("one colour band (the multiplier) misread by one step" if is_resistor else "a label read ten times off")}
    std = nearest_standard(needed, E12 if is_resistor else E6)
    if std and std["rel_err"] < 0.06 and abs(ratio - 1) > 0.25:
        return {"component": comp["id"], "needed": needed, "plausibility": 0.6,
                "text": f"{comp['id']} would explain the video if it were about {fmt(std['value'])} (a standard value) instead of {fmt(have)}"}
    return None


def cross_check_555(comps: list[dict], video: dict | None) -> dict:
    light = _best_light(video)
    if not light:
        return {"available": False, "reason": "the video shows no steady blinking to compare against"}
    fm, dm = light["analysis"]["frequency_hz"], light["analysis"].get("duty_cycle")
    R = [c for c in comps if c["type"] == "resistor" and c.get("value")]
    C = [c for c in comps if c["type"].startswith("capacitor")]
    if len(R) < 2:
        return {"available": False, "reason": "fewer than two resistor values are known",
                "needs": [c["id"] for c in comps if c["type"] == "resistor" and not c.get("value")]}
    if not C:
        return {"available": False, "reason": "no capacitor was seen"}
    cands = []
    for ra in R:
        for rb in R:
            if ra is rb:
                continue
            for c in C:
                k = ra["value"]["value"] + 2 * rb["value"]["value"]
                d_hi = (ra["value"]["value"] + rb["value"]["value"]) / k
                wiring, ed = None, 0.0
                if dm is not None:
                    wiring, d = ("high", d_hi) if abs(d_hi - dm) <= abs(1 - d_hi - dm) else ("low", 1 - d_hi)
                    ed = abs(d - dm)
                if c.get("value"):
                    fp = 1.44 / (k * c["value"]["value"])
                    ef = abs(fp - fm) / fm
                    tol = 0.25 if "electrolytic" in c["type"] else 0.12
                    cands.append({"ra": ra, "rb": rb, "c": c, "fp": fp, "ef": ef, "ed": ed, "tol": tol, "wiring": wiring,
                                  "solved": False, "rank": ef / tol + ed * 2})
                else:
                    cv = 1.44 / (k * fm)
                    std = nearest_standard(cv, E6)
                    plausible = 1e-10 < cv < 0.1
                    cands.append({"ra": ra, "rb": rb, "c": c, "c_solved": cv, "c_standard": std, "ed": ed, "wiring": wiring,
                                  "solved": True, "rank": (0 if plausible else 10) + std["rel_err"] * 2 + ed * 2})
    known = sorted((c for c in cands if not c["solved"]), key=lambda c: c["rank"])
    solved = sorted((c for c in cands if c["solved"]), key=lambda c: c["rank"])
    # A real, read value that fits beats a value worked out backwards. If nothing
    # read fits but an unread capacitor exists, that one is probably the timer.
    best = known[0] if known else None
    if not (best and best["ef"] <= best["tol"]) and solved and solved[0]["rank"] < 10:
        best = solved[0]
    best = best or solved[0]
    out = {"available": True, "pattern": "astable555", "considered": len(cands),
           "roles": {"RA": best["ra"]["id"], "RB": best["rb"]["id"], "C": best["c"]["id"]},
           "measured": {"frequency_hz": fm, "duty": dm, "region": f"V{light['index'] + 1}"},
           "formula": "f = 1.44 / ((RA + 2 x RB) x C)",
           "led_wiring": {"high": "the LED lights while the output is high (LED from pin 3 to ground)",
                          "low": "the LED lights while the output is low (LED from supply to pin 3)"}.get(best["wiring"])}
    if best["solved"]:
        ra, rb = best["ra"]["value"]["value"], best["rb"]["value"]["value"]
        lo, hi = 1.44 / ((ra * 1.05 + 2 * rb * 1.05) * fm), 1.44 / ((ra * 0.95 + 2 * rb * 0.95) * fm)
        return {**out, "verdict": "INFERRED", "inferred": {
            "component": best["c"]["id"], "value": best["c_solved"], "range": [lo, hi], "standard": best["c_standard"]["value"],
            "text": f"{best['c']['id']}'s label wasn't read, so its value was worked out from the blink rate: about "
                    f"{fmt_farads(best['c_solved'])}, most likely a standard {fmt_farads(best['c_standard']['value'])}"}}
    verdict = "CONSISTENT" if best["ef"] <= best["tol"] else "CONTRADICTED"
    res = {**out, "verdict": verdict, "predicted": {"frequency_hz": round(best["fp"], 4)},
           "error_pct": round(best["ef"] * 100, 1), "tolerance_pct": best["tol"] * 100}
    alts = [c for c in known if c is not best and c["ef"] <= c["tol"]
            and (c["ra"] is not best["ra"] or c["rb"] is not best["rb"] or c["c"] is not best["c"])]
    if verdict == "CONSISTENT" and alts:
        role_sets = list(dict.fromkeys(f"RA {c['ra']['id']}, RB {c['rb']['id']}, C {c['c']['id']}" for c in alts))[:3]
        res["alternatives"] = role_sets
        res["ambiguity"] = (f"the parts can also be assigned as {'; or '.join(role_sets)} and still fit the video, "
                            "so which resistor does which job is not settled by pixels alone")
    if verdict == "CONSISTENT" and dm is not None and best["ed"] > 0.1:
        res["note"] = "the blink rate matches, but the on-time doesn't fit any simple wiring; the LED may be driven differently"
    if verdict == "CONTRADICTED":
        k = best["ra"]["value"]["value"] + 2 * best["rb"]["value"]["value"]
        cval = best["c"]["value"]["value"]
        sug = [_suggest_fix(best["c"], 1.44 / (k * fm), False),
               _suggest_fix(best["rb"], (1.44 / (cval * fm) - best["ra"]["value"]["value"]) / 2, True),
               _suggest_fix(best["ra"], 1.44 / (cval * fm) - 2 * best["rb"]["value"]["value"], True)]
        res["suggestions"] = sorted((s for s in sug if s), key=lambda s: -s["plausibility"])
    return res


def cross_check_multivibrator(comps: list[dict], video: dict | None) -> dict:
    light = _best_light(video)
    if not light:
        return {"available": False, "reason": "the video shows no steady blinking to compare against"}
    fm = light["analysis"]["frequency_hz"]
    R = [c for c in comps if c["type"] == "resistor" and c.get("value")]
    C = [c for c in comps if c["type"].startswith("capacitor") and c.get("value")]
    if len(R) < 2 or len(C) < 2:
        return {"available": False, "reason": "need two known resistor values and two known capacitor values"}
    cands = []
    for i in range(len(R)):
        for j in range(i + 1, len(R)):
            for a in range(len(C)):
                for b in range(len(C)):
                    if a != b:
                        T = 0.693 * (R[i]["value"]["value"] * C[a]["value"]["value"] + R[j]["value"]["value"] * C[b]["value"]["value"])
                        cands.append({"r1": R[i], "r2": R[j], "c1": C[a], "c2": C[b], "fp": 1 / T, "ef": abs(1 / T - fm) / fm})
    best = min(cands, key=lambda c: c["ef"])
    return {"available": True, "pattern": "multivibrator", "considered": len(cands),
            "roles": {"R1": best["r1"]["id"], "R2": best["r2"]["id"], "C1": best["c1"]["id"], "C2": best["c2"]["id"]},
            "formula": "T = 0.693 x (R1 x C1 + R2 x C2)",
            "measured": {"frequency_hz": fm, "region": f"V{light['index'] + 1}"},
            "predicted": {"frequency_hz": round(best["fp"], 4)}, "error_pct": round(best["ef"] * 100, 1), "tolerance_pct": 25.0,
            "verdict": "CONSISTENT" if best["ef"] <= 0.25 else "CONTRADICTED"}


def cross_check(pattern_id: str, comps: list[dict], video: dict | None) -> dict:
    if not video or not video.get("frames"):
        return {"available": False, "reason": "no video, so there's no behaviour to check the parts against"}
    if pattern_id == "astable555":
        return cross_check_555(comps, video)
    if pattern_id == "multivibrator":
        return cross_check_multivibrator(comps, video)
    return {"available": False, "reason": "no behaviour formula for this pattern yet"}


# -------------------------------------------------------------- investigator --


def investigate(components: list[dict], patterns: dict | None, check: dict | None, video: dict | None,
                photo_count: int, cannot_see: list[str] | None = None) -> list[dict]:
    U: list[dict] = []

    def add(text, ask=None, ev=()):
        U.append({"id": f"U{len(U) + 1}", "text": text, "ask": ask, "ev": list(ev)})

    for c in components:
        if (c["type"] == "resistor" or c["type"].startswith("capacitor")) and not c.get("value"):
            add(f"{c['id']}'s value couldn't be read", f"A sharp close-up of {c['id']} in good light", [c["id"]])
        elif (c.get("value") or {}).get("ambiguous"):
            add(f"{c['id']}'s colour bands read differently from each end ({fmt_ohms(c['value']['value'])} or {fmt_ohms(c['value']['alternative'])})",
                f"A close-up of {c['id']} showing which end has the gold or silver band", [c["id"]])
        elif c["confidence"] == "LOW":
            add(f"{c['id']} is a low-confidence sighting", f"A closer photo of {c['id']}", [c["id"]])
    fn = [r for r in (patterns or {}).get("ranked", []) if r["role"] == "function"]
    if len(fn) > 1 and fn[0]["score"] - fn[1]["score"] < 0.2:
        a, b = fn[0], fn[1]
        add(f'"{a["name"]}" and "{b["name"]}" fit almost equally well',
            f"Evidence for or against: {b['missing'][0]}" if b["missing"] else f"A photo that shows {a['missing'][0] if a['missing'] else 'the IC markings clearly'}")
    if not video or not video.get("frames"):
        add("No video, so behaviour can't be measured", "A 10-second video of the device working, phone held still")
    elif video.get("camera_moved"):
        add("The camera moved during the video", "The same video with the phone resting on something")
    if check and check.get("ambiguity"):
        add(f"Roles not settled: {check['ambiguity']}",
            "A sharp close-up of the back of the board around the 555, to follow the copper from pins 6, 7 and 8" if photo_count >= 2
            else "A photo of the back of the board, to follow the copper from the 555's pins 6, 7 and 8")
    if check and check.get("verdict") == "CONTRADICTED":
        for s in check.get("suggestions") or []:
            add(s["text"], f"A close-up of {s['component']}'s label or bands", [s["component"]])
    if check and check.get("verdict") == "INFERRED":
        add(check["inferred"]["text"], f"A close-up of {check['inferred']['component']}'s label to confirm", [check["inferred"]["component"]])
    if photo_count < 2:
        add("Only one side of the board is visible, so connections come from the pattern, not from traced copper", "A photo of the back of the board")
    for s in cannot_see or []:
        if not re.search(r"back|underneath|other side|trace", s, re.I):
            add(f"Not visible: {s}")
    add("Pixels can't show voltages", "Part 3: the RECON probe measures what photos can't (a 555's timing capacitor should swing between one third and two thirds of the supply)")
    return U


# ------------------------------------------------------------ evidence brief --


def component_line(c: dict) -> str:
    bits = [c["type"].replace("_", " ")]
    if c.get("marking"):
        bits.append(f'marking "{c["marking"]}"')
    if c.get("value"):
        src = c["value"]["basis"] + (f": {' '.join(c['bands'])}" if c.get("bands") and c["value"]["basis"] == "colour bands" else "")
        bits.append(f"{fmt_value(c)} (from {src})")
    elif c["type"] == "resistor" or c["type"].startswith("capacitor"):
        bits.append("value not read")
    return f"{c['id']} {c['status']} {c['confidence']}: {', '.join(bits)}. Seen: {c['evidence']}"


def build_brief(st: dict) -> str:
    """Everything the reporter may use, each line with an id. Nothing else exists."""
    L = ["EVIDENCE (only these ids exist)"]
    L += [component_line(c) for c in st.get("components") or []]
    L += [f"{b['id']} OBSERVED {b['confidence']}: {b['note']}" for b in st.get("board") or []]
    for d in st.get("datasheets") or []:
        L.append(f"{d['id']} RESEARCHED {d['confidence']}: {d['component_id']} is {d['identity']}. {d['function']} "
                 f"Facts: {'; '.join(d['key_facts']) or 'none'}. Sources: {', '.join(d['sources'])}")
    cr = st.get("changing_region")
    if cr and cr.get("component_id"):
        L.append(f"The changing area in the video is {cr['component_id']} ({cr['evidence']}).")
    v = st.get("video")
    if v and v.get("frames"):
        for i, r in enumerate(v["regions"]):
            a = r["analysis"]
            L.append(f"V{i + 1} OBSERVED {a['confidence']}: a light blinks at {round(a['frequency_hz'], 3)} Hz (period {round(a['period_s'], 2)} s), "
                     f"on {round((a.get('duty_cycle') or 0) * 100)}% of the time, {a['cycles']} cycles in {round(v['duration_s'], 1)} s of video"
                     if a.get("periodic") else f"V{i + 1} OBSERVED: an area changes brightness without a steady rhythm")
        for r in v["relations"]:
            if r["kind"] != "unrelated":
                L.append(f"V{r['a'] + 1} and V{r['b'] + 1} {'take turns' if r['kind'] == 'alternate' else 'change together'}.")
        if not v["regions"]:
            L.append("V0 OBSERVED: nothing in the video visibly changes.")
    p = st.get("patterns") or {}
    for i, r in enumerate((p.get("ranked") or [])[:3]):
        found = "; ".join(m["text"] + (f" ({', '.join(m['ev'])})" if m["ev"] else "") for m in r["matched"]) or "none"
        L.append(f'P{i + 1} INFERRED{" " + p["confidence"] if i == 0 else ""}: pattern "{r["name"]}". {r["summary"]} '
                 f"Clues found: {found}. Missing: {'; '.join(r['missing']) or 'none'}. Not checked: {'; '.join(r['unknown']) or 'none'}.")
    x = st.get("check")
    if x and x.get("available"):
        roles = ", ".join(f"{k}={v}" for k, v in x["roles"].items())
        if x["verdict"] == "INFERRED":
            L.append(f"X1 INFERRED: {x['inferred']['text']}. Formula {x['formula']}, roles {roles}, measured {round(x['measured']['frequency_hz'], 3)} Hz.")
        else:
            extra = (f" On-time suggests {x['led_wiring']}." if x.get("led_wiring") else "") + \
                    (f" Note: {x['ambiguity']}." if x.get("ambiguity") else "") + \
                    (f" Possible explanations: {'; '.join(s['text'] for s in x['suggestions'])}." if x.get("suggestions") else "")
            L.append(f"X1 {x['verdict']}: formula {x['formula']} with {roles} predicts {round(x['predicted']['frequency_hz'], 3)} Hz; "
                     f"the video measured {round(x['measured']['frequency_hz'], 3)} Hz ({x['error_pct']}% apart; allowed {x['tolerance_pct']:g}% for part tolerances).{extra}")
    else:
        L.append(f"X1 UNKNOWN: no prediction checked ({(x or {}).get('reason', 'not run')}).")
    for u in st.get("unknowns") or []:
        L.append(f"{u['id']} UNKNOWN: {u['text']}." + (f" Next: {u['ask']}." if u.get("ask") else ""))
    return "\n".join(L)


def evidence_ids(st: dict) -> list[str]:
    v = st.get("video") or {}
    regions = v.get("regions") or []
    return ([c["id"] for c in st.get("components") or []] + [b["id"] for b in st.get("board") or []]
            + [d["id"] for d in st.get("datasheets") or []]
            + [f"V{i + 1}" for i in range(len(regions))] + (["V0"] if v.get("frames") and not regions else [])
            + [f"P{i + 1}" for i in range(min(3, len((st.get("patterns") or {}).get("ranked") or [])))]
            + ["X1"] + [u["id"] for u in st.get("unknowns") or []])


# ------------------------------------------------------------------- skeptic --

_STANDALONE = re.compile(r"(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)")
_ANY = re.compile(r"\d+(?:\.\d+)?")


def skeptic_check(report: dict, valid_ids: list[str], evidence_text: str) -> dict:
    """Every sentence must cite evidence that exists, and every number in it
    must already appear in the evidence the reporter was given."""
    grounded = [float(m) for m in _ANY.findall(evidence_text)]
    valid = set(valid_ids)
    out_sections, claims, flagged = [], 0, 0
    for sec in report.get("sections") or []:
        sents = []
        for s in sec.get("sentences") or []:
            text, cites = str(s.get("text") or ""), [str(c) for c in s.get("cites") or []]
            flags = []
            if not cites:
                flags.append("cites no evidence")
            bad = [c for c in cites if c not in valid]
            if bad:
                flags.append(f"cites evidence that doesn't exist: {', '.join(bad)}")
            nums = [float(n) for n in _STANDALONE.findall(re.sub(r"\[[^\]]*\]", "", text))]
            nums = [n for n in nums if not (n.is_integer() and n <= 10)]
            loose = [n for n in nums if not any((g == n) if g == 0 else abs(n - g) / abs(g) <= 0.03 for g in grounded)]
            if loose:
                flags.append(f"number not found in the evidence: {', '.join(f'{n:g}' for n in loose)}")
            claims += 1
            flagged += bool(flags)
            sents.append({"text": text, "cites": cites, "flags": flags})
        out_sections.append({"title": sec.get("title", ""), "sentences": sents})
    return {"sections": out_sections, "claims": claims, "flagged": flagged}
