var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports),s=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},c=(n,r,o)=>(o=n==null?{}:e(i(n)),s(r||!n||!n.__esModule||!a.call(n,`default`)?t(o,`default`,{value:n,enumerable:!0}):o,n)),l=(e=>typeof require<`u`?require:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof require<`u`?require:e)[t]}):e)(function(e){if(typeof require<`u`)return require.apply(this,arguments);throw Error('Calling `require` for "'+e+"\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.")});(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var u=`"""GENESIS Part 1, "See it": photos and video in, an evidence-backed reconstruction out."""
__version__ = "0.1.0"
`,d=`"""GENESIS "See it" core: deterministic, testable, no model calls.\r
\r
The agents SEE (observer subagent) and EXPLAIN (reporter subagent). Measuring\r
the video, decoding values, matching patterns, predicting behaviour, listing\r
unknowns and checking the report all happen here, in plain code.\r
"""\r
from __future__ import annotations\r
\r
import math\r
import re\r
from statistics import mean, pstdev\r
from typing import Any\r
\r
import numpy as np\r
\r
# ------------------------------------------------------------------ waveform --\r
\r
\r
def analyze_waveform(samples: list[float], dt: float, min_swing: float = 50.0) -> dict:\r
    """Levels, frequency and duty cycle, with hysteresis so noise can't fake edges."""\r
    n = len(samples)\r
    if n < 4 or not dt > 0:\r
        return {"periodic": False, "confidence": "LOW", "notes": ["too few samples to analyze"]}\r
    lo, hi = min(samples), max(samples)\r
    span = hi - lo\r
    out: dict[str, Any] = {"samples": n, "duration_s": round(n * dt, 3), "min": round(lo, 2), "max": round(hi, 2),\r
                           "mean": round(mean(samples), 2), "peak_to_peak": round(span, 2), "notes": []}\r
    if span < min_swing:\r
        out.update(periodic=False, confidence="HIGH")\r
        out["notes"].append("no change bigger than the noise")\r
        return out\r
    mid, hyst = (lo + hi) / 2, 0.1 * span\r
    high = samples[0] > mid\r
    rising: list[int] = []\r
    falling: list[int] = []\r
    for i, v in enumerate(samples):\r
        if not high and v > mid + hyst:\r
            high = True\r
            rising.append(i)\r
        elif high and v < mid - hyst:\r
            high = False\r
            falling.append(i)\r
    out.update(threshold=round(mid, 2), rising_edges=len(rising), falling_edges=len(falling),\r
               rising_idx=rising, falling_idx=falling)\r
    periods = [b - a for a, b in zip(rising, rising[1:])]\r
    if not periods:\r
        out.update(periodic=False, confidence="LOW")\r
        out["notes"].append("fewer than 2 full cycles: record for longer")\r
        return out\r
    mp = mean(periods)\r
    period = mp * dt\r
    jitter = pstdev(periods) / mp if len(periods) > 1 else 0.0\r
    duties = []\r
    for a, b in zip(rising, rising[1:]):\r
        f = next((x for x in falling if a < x < b), None)\r
        if f is not None:\r
            duties.append((f - a) / (b - a))\r
    out.update(periodic=True, cycles=len(periods), period_s=round(period, 4), frequency_hz=round(1 / period, 4),\r
               period_jitter=round(jitter, 4), duty_cycle=round(mean(duties), 4) if duties else None,\r
               frequency_resolution_hz=round((1 / period) * dt / period, 4))\r
    if len(periods) >= 5 and jitter < 0.05:\r
        out["confidence"] = "HIGH"\r
    elif len(periods) >= 2:\r
        out["confidence"] = "PROBABLE"\r
    else:\r
        out["confidence"] = "LOW"\r
        out["notes"].append("only one full cycle: record for longer")\r
    if jitter >= 0.05:\r
        out["notes"].append("cycle lengths vary by more than 5%")\r
    return out\r
\r
\r
# --------------------------------------------------------------------- video --\r
\r
\r
def changing_regions(frames: np.ndarray, min_std: float = 6.0, rel_threshold: float = 0.45,\r
                     min_area: int = 2, max_regions: int = 3, max_changing_fraction: float = 0.15) -> dict:\r
    """Find what changes over time WITHOUT a model: per-pixel brightness spread."""\r
    import cv2  # local import keeps the rest of the core usable without OpenCV\r
\r
    std = frames.std(axis=0)\r
    smax = float(std.max()) if std.size else 0.0\r
    thr = max(min_std, smax * rel_threshold)\r
    mask = (std >= thr).astype(np.uint8)\r
    fraction = float(mask.mean()) if mask.size else 0.0\r
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)\r
    score = np.bincount(labels.ravel(), weights=std.ravel(), minlength=n)\r
    blobs = []\r
    for k in range(1, n):\r
        x, y, w, h, area = (int(v) for v in stats[k])\r
        if area >= min_area:\r
            blobs.append({"area": area, "score": float(score[k]), "box": [x, y, x + w, y + h]})\r
    blobs.sort(key=lambda b: -b["score"])\r
    gm = frames.mean(axis=(1, 2))\r
    return {"regions": blobs[:max_regions], "std_max": round(smax, 2), "threshold": round(thr, 2),\r
            "changing_fraction": round(fraction, 4), "global_brightness_std": round(float(gm.std()), 2),\r
            "camera_moved": fraction > max_changing_fraction}\r
\r
\r
def trace_region(frames: np.ndarray, box: list[int]) -> list[float]:\r
    x0, y0, x1, y1 = box\r
    return [float(v) for v in frames[:, y0:y1, x0:x1].mean(axis=(1, 2))]\r
\r
\r
def pearson(a: list[float], b: list[float]) -> float:\r
    n = min(len(a), len(b))\r
    if n < 3:\r
        return 0.0\r
    x, y = np.asarray(a[:n]), np.asarray(b[:n])\r
    if x.std() == 0 or y.std() == 0:\r
        return 0.0\r
    return float(np.corrcoef(x, y)[0, 1])\r
\r
\r
def analyze_video(frames: np.ndarray, times: list[float]) -> dict:\r
    """frames: (N, H, W) greyscale. Returns regions with traces and timing analysis."""\r
    n = len(frames)\r
    dt = (times[-1] - times[0]) / (n - 1) if n > 1 else 0.0\r
    found = changing_regions(frames)\r
    notes = []\r
    if found["camera_moved"]:\r
        notes.append("much of the picture changes: the camera moved or the lighting changed; hold the phone still")\r
    if not found["regions"]:\r
        notes.append("nothing in the video changes brightness noticeably")\r
    regions = []\r
    for i, r in enumerate(found["regions"]):\r
        trace = trace_region(frames, r["box"])\r
        a = analyze_waveform(trace, dt, 10)\r
        if a.get("periodic") and dt and a["frequency_hz"] > 0.25 / dt:\r
            a["notes"].append("close to the video's frame-rate limit; faster blinking could be mis-measured")\r
        regions.append({"index": i, "box": r["box"], "area": r["area"], "trace": [round(v, 1) for v in trace],\r
                        "analysis": a, "brightest_frame": int(np.argmax(trace)), "darkest_frame": int(np.argmin(trace))})\r
    relations = []\r
    for i in range(len(regions)):\r
        for j in range(i + 1, len(regions)):\r
            c = pearson(regions[i]["trace"], regions[j]["trace"])\r
            relations.append({"a": i, "b": j, "correlation": round(c, 3),\r
                              "kind": "alternate" if c < -0.6 else "together" if c > 0.6 else "unrelated"})\r
    h, w = frames.shape[1:] if n else (0, 0)\r
    return {"frames": n, "dt": round(dt, 5), "fps": round(1 / dt, 2) if dt else 0, "duration_s": round(n * dt, 2),\r
            "width": int(w), "height": int(h), **found, "regions": regions, "relations": relations, "notes": notes}\r
\r
\r
# ------------------------------------------------------------ value decoding --\r
\r
DIGIT = {"black": 0, "brown": 1, "red": 2, "orange": 3, "yellow": 4, "green": 5, "blue": 6, "violet": 7,\r
         "purple": 7, "grey": 8, "gray": 8, "white": 9}\r
MULT = {**{k: 10 ** v for k, v in DIGIT.items()}, "gold": 0.1, "silver": 0.01}\r
TOL = {"brown": 1, "red": 2, "green": 0.5, "blue": 0.25, "violet": 0.1, "grey": 0.05, "gray": 0.05, "gold": 5, "silver": 10}\r
E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8]\r
E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]\r
E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]\r
\r
\r
def nearest_standard(v: float, series: list[float] = E12) -> dict | None:\r
    if not v or v <= 0:\r
        return None\r
    dec = 10 ** math.floor(math.log10(v))\r
    best = None\r
    for d in (dec / 10, dec, dec * 10):\r
        for s in series:\r
            c = s * d\r
            err = abs(c - v) / v\r
            if best is None or err < best[1]:\r
                best = (c, err)\r
    return {"value": float(f"{best[0]:.6g}"), "rel_err": round(best[1], 4)}\r
\r
\r
def _decode_bands_once(b: list[str]) -> dict | None:\r
    n = len(b)\r
    tol = 20.0\r
    if n == 3:\r
        digits, mult = b[:2], b[2]\r
    elif n == 4:\r
        digits, mult, tol = b[:2], b[2], TOL.get(b[3])\r
    elif n in (5, 6):\r
        digits, mult, tol = b[:3], b[3], TOL.get(b[4])\r
    else:\r
        return None\r
    if any(d not in DIGIT for d in digits) or mult not in MULT or tol is None:\r
        return None\r
    base = 0\r
    for d in digits:\r
        base = base * 10 + DIGIT[d]\r
    return {"ohms": float(f"{base * MULT[mult]:.6g}"), "tolerance_pct": tol}\r
\r
\r
def decode_bands(bands: list[str] | None) -> dict | None:\r
    """Bands as seen; the resistor may be upside down, so try both directions."""\r
    if not bands or len(bands) < 3:\r
        return None\r
    b = [str(c).lower().strip() for c in bands]\r
    tries = [(r, rev) for r, rev in ((_decode_bands_once(b), False), (_decode_bands_once(b[::-1]), True)) if r]\r
    if not tries:\r
        return None\r
\r
    def score(t):\r
        r, rev = t\r
        s = 0\r
        if (b[0] if rev else b[-1]) in ("gold", "silver"):\r
            s += 2\r
        if nearest_standard(r["ohms"], E24)["rel_err"] < 0.001:\r
            s += 1\r
        return s\r
\r
    tries.sort(key=score, reverse=True)\r
    best = tries[0]\r
    other = tries[1] if len(tries) > 1 else None\r
    return {"value": best[0]["ohms"], "tolerance_pct": best[0]["tolerance_pct"], "reversed": best[1],\r
            "ambiguous": bool(other) and score(best) == score(other) and best[0]["ohms"] != other[0]["ohms"],\r
            "alternative": other[0]["ohms"] if other else None}\r
\r
\r
SI = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9}\r
\r
\r
def parse_resistance(text: Any) -> float | None:\r
    if text is None:\r
        return None\r
    s = re.sub(r"\\s+", "", str(text))\r
    s = re.sub(r"ohms?|Ω|ω", "", s, flags=re.I)\r
    m = re.fullmatch(r"(\\d+)([RrkKM])(\\d+)", s)  # 4k7, 4R7, 1M5\r
    if m:\r
        mul = 1 if m.group(2) in "Rr" else SI[m.group(2)]\r
        return float(f"{m.group(1)}.{m.group(3)}") * mul\r
    m = re.fullmatch(r"(\\d+(?:\\.\\d+)?)([kKM]?)[Rr]?", s)\r
    if m:\r
        d = m.group(1)\r
        if not m.group(2) and re.fullmatch(r"\\d{3,4}", d) and not re.search(r"[Rr]$", s):\r
            base, exp = int(d[:-1]), int(d[-1])\r
            if len(d) == 3 and exp <= 6 and d[2] != "0":\r
                return float(base * 10 ** exp)        # SMD code: 103 = 10 k\r
            if len(d) == 4 and 0 < exp <= 6:\r
                return float(base * 10 ** exp)        # 4702 = 47 k\r
        return float(d) * (SI[m.group(2)] if m.group(2) else 1)\r
    return None\r
\r
\r
def _cap_prefix(p: str) -> float | None:\r
    if not p:\r
        return 1.0\r
    if p == "M":\r
        return 1e-6  # old "100MFD" labels mean microfarads\r
    return {"p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "μ": 1e-6, "m": 1e-3}.get(p.lower())\r
\r
\r
def parse_capacitance(text: Any, ctype: str = "") -> float | None:\r
    if text is None:\r
        return None\r
    s = re.sub(r"\\s+", "", str(text))\r
    m = re.search(r"(\\d+(?:\\.\\d+)?)([pnuµμmM]?)F", s, flags=re.I)        # 100uF, 0.1µF, 100MFD\r
    if m and _cap_prefix(m.group(2)) is not None:\r
        return float(m.group(1)) * _cap_prefix(m.group(2))\r
    m = re.fullmatch(r"(\\d+(?:\\.\\d+)?)([pnuµμ])", s, flags=re.I)         # 10n, 100u\r
    if m:\r
        return float(m.group(1)) * _cap_prefix(m.group(2))\r
    m = re.fullmatch(r"(\\d)([pnuµμ])(\\d)", s, flags=re.I)                # 4u7\r
    if m:\r
        return float(f"{m.group(1)}.{m.group(3)}") * _cap_prefix(m.group(2))\r
    m = re.fullmatch(r"(\\d{3})[JKMjkm]?", s)                              # 104 = 100 nF\r
    if m and "electrolytic" not in ctype:\r
        d = m.group(1)\r
        return int(d[:2]) * 10 ** int(d[2]) * 1e-12\r
    m = re.fullmatch(r"(\\d+(?:\\.\\d+)?)", s)\r
    if m and "electrolytic" in ctype:\r
        return float(m.group(1)) * 1e-6                                   # electrolytics: uF\r
    return None\r
\r
\r
def value_of(c: dict) -> dict | None:\r
    """The part's value and how we know it. A human-entered value wins."""\r
    if c["type"] == "resistor":\r
        for src, basis in ((c.get("human_value"), "you"), (c.get("value_printed"), "printed"), (c.get("marking"), "printed")):\r
            v = parse_resistance(src)\r
            if v:\r
                return {"value": v, "unit": "ohm", "basis": basis, "tolerance_pct": 5}\r
        d = decode_bands(c.get("bands"))\r
        if d:\r
            return {"value": d["value"], "unit": "ohm", "basis": "colour bands", "tolerance_pct": d["tolerance_pct"],\r
                    "ambiguous": d["ambiguous"], "alternative": d["alternative"]}\r
        return None\r
    if c["type"].startswith("capacitor"):\r
        for src, basis in ((c.get("human_value"), "you"), (c.get("value_printed"), "printed"), (c.get("marking"), "printed")):\r
            v = parse_capacitance(src, c["type"])\r
            if v:\r
                return {"value": v, "unit": "F", "basis": basis, "tolerance_pct": 20 if "electrolytic" in c["type"] else 10}\r
    return None\r
\r
\r
def _g(x: float) -> str:\r
    return f"{x:.4g}"\r
\r
\r
def fmt_ohms(v: float | None) -> str:\r
    if v is None:\r
        return "?"\r
    if v >= 1e6:\r
        return f"{_g(v / 1e6)} MΩ"\r
    if v >= 1e3:\r
        return f"{_g(v / 1e3)} kΩ"\r
    return f"{_g(v)} Ω"\r
\r
\r
def fmt_farads(v: float | None) -> str:\r
    if v is None:\r
        return "?"\r
    if v >= 1e-6:\r
        return f"{_g(v / 1e-6)} µF"\r
    if v >= 1e-9:\r
        return f"{_g(v / 1e-9)} nF"\r
    return f"{_g(v / 1e-12)} pF"\r
\r
\r
def fmt_value(c: dict) -> str | None:\r
    if not c.get("value"):\r
        return None\r
    return fmt_ohms(c["value"]["value"]) if c["type"] == "resistor" else fmt_farads(c["value"]["value"])\r
\r
\r
# ---------------------------------------------------------------- components --\r
\r
TYPES = ["resistor", "capacitor_electrolytic", "capacitor_ceramic", "capacitor_film", "ic", "transistor", "mosfet",\r
         "diode", "led", "ldr", "potentiometer", "relay", "crystal", "inductor", "connector", "battery", "switch",\r
         "button", "buzzer", "motor", "sensor_module", "display", "voltage_regulator", "dev_board", "transformer", "fuse",\r
         "optocoupler", "speaker", "microphone", "antenna", "servo", "stepper", "other"]\r
SYNONYMS = [(r"motor driver|h.?bridge|driver (module|board)|l298|l9110|tb6612|drv88\\d\\d|a4988|uln200\\d|mx1508|bts7960", "ic"),\r
            (r"servo", "servo"), (r"stepper|nema ?\\d+|28byj", "stepper"),\r
            (r"arduino|nodemcu|wemos|lolin|devkit|dev.?board|development board|microcontroller board|esp32|esp8266|esp-\\d|pro mini|d1 mini", "dev_board"),\r
            (r"transformer|flyback", "transformer"), (r"fuse|polyfuse|ptc", "fuse"),\r
            (r"opto|pc817|photocoupler", "optocoupler"), (r"microphone|\\bmic\\b|electret", "microphone"),\r
            (r"antenna|aerial", "antenna"), (r"speaker|loudspeaker", "speaker"),\r
            (r"electrolytic", "capacitor_electrolytic"), (r"ceramic|disc", "capacitor_ceramic"),\r
            (r"film|polyester|mylar", "capacitor_film"), (r"^cap", "capacitor_ceramic"),\r
            (r"photo.?resist|light.?dependent|ldr", "ldr"), (r"pot|trimmer", "potentiometer"),\r
            (r"regulator", "voltage_regulator"), (r"chip|integrated|^ic$", "ic"), (r"mosfet", "mosfet"),\r
            (r"transistor|bjt", "transistor"), (r"led", "led"), (r"diode", "diode"), (r"resistor", "resistor"),\r
            (r"relay", "relay"), (r"crystal|oscillator", "crystal"), (r"battery|cell", "battery"),\r
            (r"terminal|header|connector|jack|socket", "connector"), (r"buzzer|speaker|piezo", "buzzer"),\r
            (r"motor", "motor"), (r"switch", "switch"), (r"button", "button")]\r
\r
\r
def normalize_type(t: Any) -> str:\r
    s = str(t or "").lower().strip()\r
    if s in TYPES:\r
        return s\r
    for pat, v in SYNONYMS:\r
        if re.search(pat, s):\r
            return v\r
    return "other"\r
\r
\r
CONF = ("HIGH", "PROBABLE", "LOW")\r
\r
\r
def normalize_observation(raw: dict) -> dict:\r
    """Observer output -> evidence: components O1..On, board notes B1..Bn."""\r
    comps = []\r
    for i, c in enumerate(raw.get("components") or []):\r
        comp = {"id": f"O{i + 1}", "type": normalize_type(c.get("type")),\r
                "marking": (str(c["marking"]).strip() or None) if c.get("marking") else None,\r
                "bands": [str(x) for x in c["bands"]] if c.get("bands") else None,\r
                "value_printed": (str(c["value_printed"]).strip() or None) if c.get("value_printed") else None,\r
                "image": c.get("image") if isinstance(c.get("image"), int) else 1,\r
                "box": [float(v) for v in c["box"]] if isinstance(c.get("box"), list) and len(c["box"]) == 4 else None,\r
                "confidence": c.get("confidence") if c.get("confidence") in CONF else "PROBABLE",\r
                "evidence": str(c.get("evidence") or ""), "human_value": None, "status": "OBSERVED"}\r
        comp["value"] = value_of(comp)\r
        comps.append(comp)\r
    cr = raw.get("changing_region")\r
    ci = cr.get("component_index") if cr else None\r
    board = [{"id": f"B{i + 1}", "note": str(b.get("note") or ""), "image": b.get("image"),\r
              "confidence": b.get("confidence") if b.get("confidence") in CONF else "PROBABLE", "status": "OBSERVED"}\r
             for i, b in enumerate(raw.get("board") or [])]\r
    return {"components": comps, "board": board,\r
            "changing_region": {"component_id": comps[ci]["id"] if isinstance(ci, int) and 0 <= ci < len(comps) else None,\r
                                "type": normalize_type(cr.get("type")), "evidence": str(cr.get("evidence") or "")} if cr else None,\r
            "cannot_see": [str(s) for s in raw.get("cannot_see") or []]}\r
\r
\r
def set_human_value(comp: dict, text: str | None) -> dict | None:\r
    comp["human_value"] = str(text).strip() if text and str(text).strip() else None\r
    comp["value"] = value_of(comp)\r
    return comp["value"]\r
\r
\r
# ------------------------------------------------------------------ patterns --\r
\r
RX = {\r
    "t555": re.compile(r"(^|[^0-9])555([^0-9]|$)|NE555|LM555|SE555|NA555|SA555|TLC555|LMC555|ICM7555|TS555|7555", re.I),\r
    "mcu": re.compile(r"ATTINY|ATMEGA|AT89|PIC1\\d|PIC\\d|STM32|STM8|ESP32|ESP8266|ESP-|CH32|CH55|RP2040|RP2350|N76E|STC\\d|GD32|SAMD|NRF5|ATMEL|ARDUINO|NODEMCU|WEMOS|LOLIN|WROOM|WROVER|D1.?MINI", re.I),\r
    "arduino": re.compile(r"ARDUINO|ATMEGA328|ATMEGA32U4|ATMEGA2560|ATMEGA168|UNO|NANO|PRO.?MINI|LEONARDO|CH340", re.I),\r
    "esp": re.compile(r"ESP32|ESP8266|ESP-?\\d\\d?|NODEMCU|WEMOS|LOLIN|WROOM|WROVER|D1.?MINI", re.I),\r
    "opamp": re.compile(r"LM358|LM393|LM339|LM324|LM311|LM2903|TL07|TL08|NE5532|MCP60|LM741|UA741|OP07", re.I),\r
    "reg": re.compile(r"(^|[^0-9])78\\d\\d|(^|[^0-9])79\\d\\d|78L\\d\\d|LM317|LM337|AMS1117|LM1117|LD1117|HT73\\d\\d|HT75\\d\\d|MCP1700|XC6206", re.I),\r
    "buck": re.compile(r"LM2596|LM2576|MP1584|MP2307|MP2315|XL4015|XL4016|XL1509|TPS5430|TPS54\\d+|AP3211|SY8\\d{3}|LM2678", re.I),\r
    "boost": re.compile(r"MT3608|XL6009|SX1308|LM2577|XL6019|TPS6104\\d|FP6291|B628", re.I),\r
    "charger": re.compile(r"TP4056|TP4057|MCP7383\\d|IP5306|IP5328|LTC4054|CN3065|BQ2405\\d|DW01|FS8205", re.I),\r
    "smps": re.compile(r"TNY\\d+|LNK\\d+|TOP2\\d\\d|VIPER\\d+|OB22\\d\\d|OB25\\d\\d|FSD\\d+|UC384[2-5]|NCP1\\d{3}|LD7535|THX\\d+|PN8\\d{3}|SG6\\d{3}|AP8\\d{3}", re.I),\r
    "audio": re.compile(r"LM386|PAM8403|PAM8610|TDA20[0-9]\\d|TDA7\\d{3}|TPA3\\d{3}|TPA2\\d{3}|NS41\\d\\d|LM4871|XPT8871|HXJ8002|MAX98357", re.I),\r
    "usbserial": re.compile(r"CH340|CH341|CP210\\d|FT232|PL2303|CH9102", re.I),\r
    "wireless": re.compile(r"HC-?0[56]|NRF24|NRF52|CC2541|CC2530|SX127\\d|RFM9\\d|ESP-?01|LORA|BLE|HM-?10|JDY-?\\d+", re.I),\r
    "sensor": re.compile(r"DHT\\d\\d|HC-?SR0\\d|BME\\d{3}|BMP\\d{3}|MPU-?\\d{4}|ADXL\\d+|DS18B20|HC-?SR501|LM35|SHT\\d\\d|VL53L\\d|INA2\\d\\d|HX711|MQ-?\\d", re.I),\r
    "mdrv": re.compile(r"L298|L293|L9110|DRV88|DRV87|TB6612|A4988|ULN200|ULN280|MX1508|BTS7960|IBT-?2|PCA9685|HG7881|MP6550|AT8236|TMC2\\d{3}", re.I),\r
    "pir": re.compile(r"BISS0001", re.I),\r
    "bridge": re.compile(r"DB10\\d|KBP\\d|MB\\d+S|GBU\\d|KBL\\d|W0\\dM|DF0\\d", re.I),\r
}\r
\r
\r
def _ctx(comps: list[dict], video: dict | None) -> dict:\r
    caps = [c for c in comps if c["type"].startswith("capacitor")]\r
    ics = [c for c in comps if c["type"] in ("ic", "voltage_regulator")]\r
    periodic = [r for r in (video or {}).get("regions", []) if r["analysis"].get("periodic") and r["analysis"]["confidence"] != "LOW"]\r
    has_video = bool(video and video.get("frames"))\r
    return {"comps": comps, "of": lambda t: [c for c in comps if c["type"] == t], "caps": caps, "ics": ics,\r
            "marked": lambda rx: [c for c in comps if c.get("marking") and rx.search(c["marking"])],\r
            "unreadable_ic": [c for c in ics if not c.get("marking") or c["confidence"] == "LOW"],\r
            "has_video": has_video, "periodic": periodic,\r
            "alternate": [r for r in (video or {}).get("relations", []) if r["kind"] == "alternate"]}\r
\r
\r
def _ids(lst):\r
    return [c["id"] for c in lst]\r
\r
\r
def _v(rs):\r
    return [f"V{r['index'] + 1}" for r in rs]\r
\r
\r
def _clue(text, weight, test, required=False):\r
    return {"text": text, "weight": weight, "test": test, "required": required}\r
\r
\r
def _ic_marked(rx_key, fallback):\r
    def t(x):\r
        m = x["marked"](RX[rx_key])\r
        if m:\r
            return {"s": 1, "ev": _ids(m)}\r
        if x["unreadable_ic"]:\r
            return {"s": fallback, "ev": _ids(x["unreadable_ic"]), "note": "an IC whose marking can't be read"}\r
        return {"s": 0}\r
    return t\r
\r
\r
def _count(t, need, partial=0.5, minimum=1):\r
    def f(x):\r
        lst = x["of"](t) if t != "caps" else x["caps"]\r
        return {"s": 1 if len(lst) >= need else partial if len(lst) >= minimum else 0, "ev": _ids(lst)}\r
    return f\r
\r
\r
def _outputs(types):\r
    def f(x):\r
        o = [c for c in x["comps"] if c["type"] in types]\r
        return {"s": 1 if o else 0, "ev": _ids(o)}\r
    return f\r
\r
\r
def _no_ic(x):\r
    return {"s": 0 if [c for c in x["ics"] if c["type"] == "ic"] else 1, "ev": []}\r
\r
\r
def _steady_blink(x):\r
    if not x["has_video"]:\r
        return None\r
    return {"s": 1 if x["periodic"] else 0, "ev": _v(x["periodic"])}\r
\r
\r
def _take_turns(x):\r
    if not x["has_video"]:\r
        return None\r
    if x["alternate"]:\r
        return {"s": 1, "ev": [f"V{r['a'] + 1}" for r in x["alternate"]] + [f"V{r['b'] + 1}" for r in x["alternate"]]}\r
    return {"s": 0.3 if x["periodic"] else 0, "ev": _v(x["periodic"])}\r
\r
\r
def _bonus(t):\r
    def f(x):\r
        lst = x["of"](t)\r
        return {"s": 1, "ev": _ids(lst)} if lst else None\r
    return f\r
\r
\r
def _mcu(x):\r
    """A microcontroller chip by its marking, or a whole Arduino / ESP development board."""\r
    m = x["marked"](RX["mcu"]) + [c for c in x["of"]("dev_board") if not RX["mcu"].search(c.get("marking") or "")]\r
    if m:\r
        return {"s": 1, "ev": _ids(m)}\r
    if x["unreadable_ic"]:\r
        return {"s": 0.3, "ev": _ids(x["unreadable_ic"]), "note": "an IC whose marking can't be read"}\r
    return {"s": 0}\r
\r
\r
def _family(key):\r
    def f(x):\r
        m = x["marked"](RX[key])\r
        return {"s": 1 if m else 0, "ev": _ids(m)}\r
    return f\r
\r
\r
def _marked_or(key, types=(), partial=0.6):\r
    """A part whose marking belongs to a family, or (weaker) a part of the right type."""\r
    def f(x):\r
        m = x["marked"](RX[key])\r
        if m:\r
            return {"s": 1, "ev": _ids(m)}\r
        t = [c for c in x["comps"] if c["type"] in types]\r
        return {"s": partial if t else 0, "ev": _ids(t)}\r
    return f\r
\r
\r
def _moving(x):\r
    m = x["of"]("motor") + x["of"]("servo") + x["of"]("stepper")\r
    return {"s": 1 if m else 0, "ev": _ids(m)}\r
\r
\r
def _driver(x):\r
    m = x["marked"](RX["mdrv"])\r
    if m:\r
        return {"s": 1, "ev": _ids(m)}\r
    t = x["of"]("transistor") + x["of"]("mosfet") + x["of"]("relay")\r
    if t:\r
        return {"s": 0.6, "ev": _ids(t)}\r
    servos = x["of"]("servo")       # hobby servos carry their own driver\r
    return {"s": 1 if servos and len(servos) == len(x["of"]("servo") + x["of"]("motor") + x["of"]("stepper")) else 0, "ev": _ids(servos)}\r
\r
\r
def _motor_driver(x):\r
    m = x["marked"](RX["mdrv"])\r
    if m:\r
        return {"s": 1, "ev": _ids(m)}\r
    t = [c for c in x["comps"] if c["type"] in ("transistor", "mosfet")]\r
    return {"s": 0.6 if t and x["of"]("motor") else 0, "ev": _ids(t)}\r
\r
\r
def _regulator(x):\r
    m = x["marked"](RX["reg"]) + [c for c in x["of"]("voltage_regulator") if not RX["reg"].search(c.get("marking") or "")]\r
    return {"s": 1 if m else 0, "ev": _ids(m)}\r
\r
\r
def _bridge(x):\r
    m = x["marked"](RX["bridge"])\r
    if m:\r
        return {"s": 1, "ev": _ids(m)}\r
    d = x["of"]("diode")\r
    return {"s": 1 if len(d) >= 4 else 0, "ev": _ids(d)}\r
\r
\r
PATTERNS = [\r
    {"id": "astable555", "name": "555 timer blinker", "role": "function",\r
     "summary": "A 555 timer repeatedly charges a capacitor through two resistors and discharges it through one, switching its output on and off at a steady rate.",\r
     "clues": [_clue("an 8-pin IC marked 555", 5, _ic_marked("t555", 0.4), required=True),\r
               _clue("at least two resistors to set the timing", 1, _count("resistor", 2)),\r
               _clue("a timing capacitor", 1, _count("caps", 1)),\r
               _clue("an LED", 1, _count("led", 1)),\r
               _clue("a light that blinks at a steady rate", 3, _steady_blink)]},\r
    {"id": "multivibrator", "name": "Two-transistor flasher (astable multivibrator)", "role": "function",\r
     "summary": "Two transistors switch each other on and off through two capacitors, so two lights take turns.",\r
     "clues": [_clue("two transistors", 3, _count("transistor", 2, partial=0, minimum=99), required=True),\r
               _clue("two capacitors to set the timing", 2, _count("caps", 2, partial=0.4)),\r
               _clue("about four resistors", 1, _count("resistor", 4, partial=0.5, minimum=2)),\r
               _clue("two LEDs", 1, _count("led", 2, partial=0.4)),\r
               _clue("no IC doing the timing", 1, _no_ic),\r
               _clue("two lights that take turns", 3, _take_turns)]},\r
    {"id": "mcu_blinker", "name": "Microcontroller-driven output", "role": "function",\r
     "summary": "A programmed microcontroller switches the output; its behaviour lives in firmware, not in the parts' values.",\r
     "clues": [_clue("a microcontroller or Arduino / ESP board", 5, _mcu, required=True),\r
               _clue("no motors (a moving machine is a robot, not a blinker)", 1, lambda x: {"s": 0 if _moving(x)["s"] else 1, "ev": []}),\r
               _clue("an LED or other output", 1, _outputs(("led", "relay", "buzzer", "motor"))),\r
               _clue("a crystal", 1, _bonus("crystal")),\r
               _clue("visible activity in the video", 1, _steady_blink)]},\r
    {"id": "light_comparator", "name": "Light sensor with comparator", "role": "function",\r
     "summary": "A light-dependent resistor and a potentiometer feed a comparator, which switches the output when light crosses a threshold.",\r
     "clues": [_clue("a comparator or op-amp IC", 4, _ic_marked("opamp", 0.3), required=True),\r
               _clue("a light-dependent resistor", 3, _count("ldr", 1)),\r
               _clue("a potentiometer to set the threshold", 2, _count("potentiometer", 1)),\r
               _clue("an LED or relay output", 1, _outputs(("led", "relay", "buzzer"))),\r
               _clue("no steady blinking", 1, lambda x: None if not x["has_video"] else {"s": 0 if x["periodic"] else 1, "ev": []})]},\r
    {"id": "light_transistor", "name": "Light-controlled transistor switch", "role": "function",\r
     "summary": "A light-dependent resistor sets a transistor's base voltage, so the output turns on in the dark (or in light).",\r
     "clues": [_clue("a light-dependent resistor", 3, _count("ldr", 1), required=True),\r
               _clue("a transistor", 2, _count("transistor", 1)),\r
               _clue("no IC", 1, _no_ic),\r
               _clue("an LED or relay output", 1, _outputs(("led", "relay")))]},\r
    {"id": "relay_driver", "name": "Relay driver", "role": "function",\r
     "summary": "A transistor switches a relay coil; a diode across the coil absorbs the voltage spike when it turns off.",\r
     "clues": [_clue("a relay", 4, _count("relay", 1), required=True),\r
               _clue("a transistor", 2, _outputs(("transistor", "mosfet"))),\r
               _clue("a diode across the coil", 2, _count("diode", 1))]},\r
    {"id": "motor_driver", "name": "Motor driver", "role": "function",\r
     "summary": "A driver IC or transistor bridge switches current through a motor, often in both directions.",\r
     "clues": [_clue("a motor driver IC or power transistors", 4, _motor_driver, required=True),\r
               _clue("no controller (a driver board on its own)", 2, lambda x: {"s": 0 if _mcu(x)["s"] >= 1 else 1, "ev": []}),\r
               _clue("a motor", 2, _count("motor", 1)),\r
               _clue("protection diodes", 1, _bonus("diode"))]},\r
    {"id": "pir", "name": "PIR motion sensor", "role": "function",\r
     "summary": "A pyroelectric sensor behind a lens detects moving warm bodies; a BISS0001 chip turns that into an output pulse.",\r
     "clues": [_clue("a BISS0001 chip", 5, lambda x: {"s": 1 if x["marked"](RX["pir"]) else 0, "ev": _ids(x["marked"](RX["pir"]))}, required=True),\r
               _clue("two adjustment potentiometers", 1, _count("potentiometer", 2))]},\r
    {"id": "arduino_board", "name": "Arduino-compatible controller", "role": "supporting",\r
     "summary": "An AVR microcontroller (ATmega) on an Arduino or compatible board runs a sketch; its pins drive the outputs.",\r
     "clues": [_clue("an Arduino board or ATmega chip", 4, _family("arduino"), required=True),\r
               _clue("a 16 MHz crystal or resonator", 1, _bonus("crystal"))]},\r
    {"id": "esp_board", "name": "ESP32 / ESP8266 Wi-Fi controller", "role": "supporting",\r
     "summary": "An Espressif ESP32 or ESP8266 module runs the firmware and can talk over Wi-Fi (and Bluetooth on the ESP32); its pins are 3.3 V logic.",\r
     "clues": [_clue("an ESP32 or ESP8266 module or board", 4, _family("esp"), required=True)]},\r
    {"id": "robot_drive", "name": "Motorised robot or vehicle", "role": "function",\r
     "summary": "A controller reads its sensors and commands a motor driver, which switches battery power into the motors or servos; "\r
                "power, control, sensing and drive are separate layers that must agree on voltage, current and ground.",\r
     "clues": [_clue("motors, servos or steppers", 4, _moving, required=True),\r
               _clue("a motor driver (or transistors switching the motors)", 3, _driver),\r
               _clue("a microcontroller or Arduino / ESP board", 2, _mcu),\r
               _clue("a battery or power stage", 1, lambda x: {"s": 1 if x["of"]("battery") or x["of"]("voltage_regulator") or x["marked"](RX["buck"]) else 0,\r
                                                              "ev": _ids(x["of"]("battery"))}),\r
               _clue("sensors", 1, lambda x: {"s": 1, "ev": _ids(x["of"]("sensor_module") + x["marked"](RX["sensor"]))}\r
                     if x["of"]("sensor_module") or x["marked"](RX["sensor"]) else None)]},\r
    {"id": "mains_adapter", "name": "Switch-mode power supply (mains adapter)", "role": "function",\r
     "summary": "Mains AC is rectified and chopped at high frequency through a small transformer; an optocoupler feeds the output voltage back to the controller, which keeps it steady.",\r
     "clues": [_clue("a transformer", 3, _count("transformer", 1), required=True),\r
               _clue("a switching controller IC", 3, _marked_or("smps", ("ic",), 0.4)),\r
               _clue("an optocoupler for feedback", 2, _count("optocoupler", 1)),\r
               _clue("a bridge rectifier or four diodes", 1, _bridge),\r
               _clue("a fuse on the mains side", 1, _bonus("fuse"))]},\r
    {"id": "liion_charger", "name": "Li-ion battery charger", "role": "function",\r
     "summary": "A charger IC feeds a single lithium cell with constant current, then constant voltage up to 4.2 V; a protection chip cuts off over-discharge and short circuits.",\r
     "clues": [_clue("a Li-ion charger or protection IC", 5, _marked_or("charger", (), 0), required=True),\r
               _clue("a battery or battery connector", 1, _outputs(("battery", "connector"))),\r
               _clue("status LEDs", 1, _bonus("led"))]},\r
    {"id": "buck_converter", "name": "DC-DC buck converter (step-down)", "role": "function",\r
     "summary": "A switching regulator chops the input and smooths it through an inductor and capacitor, giving a lower voltage far more efficiently than a linear regulator.",\r
     "clues": [_clue("a buck regulator IC", 5, _marked_or("buck", (), 0), required=True),\r
               _clue("an inductor", 2, _count("inductor", 1)),\r
               _clue("a diode or second switch", 1, _bonus("diode")),\r
               _clue("input and output capacitors", 1, _count("caps", 2))]},\r
    {"id": "boost_converter", "name": "DC-DC boost converter (step-up)", "role": "function",\r
     "summary": "A switching regulator stores energy in an inductor and releases it through a diode, giving a higher voltage than its input.",\r
     "clues": [_clue("a boost regulator IC", 5, _marked_or("boost", (), 0), required=True),\r
               _clue("an inductor", 2, _count("inductor", 1)),\r
               _clue("a rectifier diode", 1, _bonus("diode")),\r
               _clue("a potentiometer to set the output", 1, _bonus("potentiometer"))]},\r
    {"id": "audio_amp", "name": "Audio amplifier", "role": "function",\r
     "summary": "An amplifier IC boosts a small audio signal to drive a speaker; capacitors couple the input and set the gain.",\r
     "clues": [_clue("an audio amplifier IC", 5, _marked_or("audio", (), 0), required=True),\r
               _clue("a speaker or speaker connector", 2, _outputs(("speaker", "buzzer", "connector"))),\r
               _clue("a volume potentiometer", 1, _bonus("potentiometer")),\r
               _clue("coupling capacitors", 1, _count("caps", 2))]},\r
    {"id": "sensor_module", "name": "Sensor module", "role": "function",\r
     "summary": "A sensor and its support parts on a small board, read by a microcontroller over a digital pin, I2C or an analog output.",\r
     "clues": [_clue("a sensor chip or sensor module", 5, _marked_or("sensor", ("sensor_module",), 0.6), required=True),\r
               _clue("a board on its own (no motors or controller board)", 2,\r
                     lambda x: {"s": 0 if _moving(x)["s"] or x["of"]("dev_board") else 1, "ev": []}),\r
               _clue("a header to connect it", 1, _bonus("connector")),\r
               _clue("a power LED", 1, _bonus("led"))]},\r
    {"id": "usb_serial", "name": "USB-to-serial interface", "role": "supporting",\r
     "summary": "A USB bridge chip lets a computer talk to the board's microcontroller over a serial port; it is how Arduino-style boards are programmed.",\r
     "clues": [_clue("a USB-serial chip (CH340, CP2102, FT232)", 4, _family("usbserial"), required=True)]},\r
    {"id": "wireless", "name": "Wireless module (Bluetooth, Wi-Fi, LoRa, 2.4 GHz)", "role": "supporting",\r
     "summary": "A radio module gives the device a wireless link; the antenna is usually a PCB trace or a small chip.",\r
     "clues": [_clue("a radio module marking", 4, _family("wireless"), required=True),\r
               _clue("an antenna", 1, _bonus("antenna"))]},\r
    {"id": "linear_regulator", "name": "Voltage regulator stage", "role": "supporting",\r
     "summary": "A regulator turns a higher supply voltage into a steady lower one, with capacitors on its input and output.",\r
     "clues": [_clue("a regulator IC", 4, _regulator, required=True),\r
               _clue("capacitors around it", 1, _count("caps", 2))]},\r
    {"id": "rectifier", "name": "Rectifier and filter", "role": "supporting",\r
     "summary": "Diodes turn AC into pulsing DC and a large capacitor smooths it.",\r
     "clues": [_clue("a bridge rectifier or four diodes", 3, _bridge, required=True),\r
               _clue("a large electrolytic capacitor", 1, _count("capacitor_electrolytic", 1))]},\r
]\r
\r
\r
def score_patterns(comps: list[dict], video: dict | None) -> dict:\r
    x = _ctx(comps, video)\r
    results = []\r
    for p in PATTERNS:\r
        got = checked = total = 0.0\r
        excluded = False\r
        matched, missing, unknown = [], [], []\r
        for c in p["clues"]:\r
            total += c["weight"]\r
            r = c["test"](x)\r
            if r is None:\r
                unknown.append(c["text"])\r
                continue\r
            checked += c["weight"]\r
            got += c["weight"] * r["s"]\r
            if r["s"] > 0:\r
                matched.append({"text": r.get("note") or c["text"], "strength": r["s"], "ev": list(dict.fromkeys(r.get("ev") or []))})\r
            else:\r
                missing.append(c["text"])\r
                excluded = excluded or c["required"]\r
        score = round(got / checked, 3) if checked else 0\r
        if not excluded and score > 0:\r
            results.append({"id": p["id"], "name": p["name"], "role": p["role"], "summary": p["summary"], "score": score,\r
                            "coverage": round(checked / total, 3), "matched": matched, "missing": missing, "unknown": unknown})\r
    results.sort(key=lambda r: (-r["score"], -r["coverage"]))\r
    fn = [r for r in results if r["role"] == "function"]\r
    top = fn[0] if fn else None\r
    confidence = "NONE"\r
    if top:\r
        gap = top["score"] - (fn[1]["score"] if len(fn) > 1 else 0)\r
        if top["score"] >= 0.8 and top["coverage"] >= 0.75 and gap >= 0.25:\r
            confidence = "HIGH"\r
        elif top["score"] >= 0.6:\r
            confidence = "PROBABLE"\r
        elif top["score"] >= 0.3:\r
            confidence = "POSSIBLE"\r
    return {"ranked": results, "top": top, "confidence": confidence,\r
            "supporting": [r for r in results if r["role"] == "supporting" and r["score"] >= 0.6]}\r
\r
\r
# -------------------------------------------------------------- cross-checks --\r
\r
\r
def _best_light(video: dict | None) -> dict | None:\r
    p = [r for r in (video or {}).get("regions", []) if r["analysis"].get("periodic")]\r
    p.sort(key=lambda r: (r["analysis"]["confidence"] != "HIGH", -r["area"]))\r
    return p[0] if p else None\r
\r
\r
def _suggest_fix(comp: dict, needed: float, is_resistor: bool) -> dict | None:\r
    if not comp.get("value") or not needed or needed <= 0:\r
        return None\r
    have = comp["value"]["value"]\r
    ratio = needed / have\r
    fmt = fmt_ohms if is_resistor else fmt_farads\r
    for k in (10, 0.1):\r
        if abs(ratio / k - 1) < 0.15:\r
            return {"component": comp["id"], "needed": needed, "plausibility": 1,\r
                    "text": f"{comp['id']} would explain the video if it were {fmt(needed)} instead of {fmt(have)}: "\r
                            + ("one colour band (the multiplier) misread by one step" if is_resistor else "a label read ten times off")}\r
    std = nearest_standard(needed, E12 if is_resistor else E6)\r
    if std and std["rel_err"] < 0.06 and abs(ratio - 1) > 0.25:\r
        return {"component": comp["id"], "needed": needed, "plausibility": 0.6,\r
                "text": f"{comp['id']} would explain the video if it were about {fmt(std['value'])} (a standard value) instead of {fmt(have)}"}\r
    return None\r
\r
\r
def cross_check_555(comps: list[dict], video: dict | None) -> dict:\r
    light = _best_light(video)\r
    if not light:\r
        return {"available": False, "reason": "the video shows no steady blinking to compare against"}\r
    fm, dm = light["analysis"]["frequency_hz"], light["analysis"].get("duty_cycle")\r
    R = [c for c in comps if c["type"] == "resistor" and c.get("value")]\r
    C = [c for c in comps if c["type"].startswith("capacitor")]\r
    if len(R) < 2:\r
        return {"available": False, "reason": "fewer than two resistor values are known",\r
                "needs": [c["id"] for c in comps if c["type"] == "resistor" and not c.get("value")]}\r
    if not C:\r
        return {"available": False, "reason": "no capacitor was seen"}\r
    cands = []\r
    for ra in R:\r
        for rb in R:\r
            if ra is rb:\r
                continue\r
            for c in C:\r
                k = ra["value"]["value"] + 2 * rb["value"]["value"]\r
                d_hi = (ra["value"]["value"] + rb["value"]["value"]) / k\r
                wiring, ed = None, 0.0\r
                if dm is not None:\r
                    wiring, d = ("high", d_hi) if abs(d_hi - dm) <= abs(1 - d_hi - dm) else ("low", 1 - d_hi)\r
                    ed = abs(d - dm)\r
                if c.get("value"):\r
                    fp = 1.44 / (k * c["value"]["value"])\r
                    ef = abs(fp - fm) / fm\r
                    tol = 0.25 if "electrolytic" in c["type"] else 0.12\r
                    cands.append({"ra": ra, "rb": rb, "c": c, "fp": fp, "ef": ef, "ed": ed, "tol": tol, "wiring": wiring,\r
                                  "solved": False, "rank": ef / tol + ed * 2})\r
                else:\r
                    cv = 1.44 / (k * fm)\r
                    std = nearest_standard(cv, E6)\r
                    plausible = 1e-10 < cv < 0.1\r
                    cands.append({"ra": ra, "rb": rb, "c": c, "c_solved": cv, "c_standard": std, "ed": ed, "wiring": wiring,\r
                                  "solved": True, "rank": (0 if plausible else 10) + std["rel_err"] * 2 + ed * 2})\r
    known = sorted((c for c in cands if not c["solved"]), key=lambda c: c["rank"])\r
    solved = sorted((c for c in cands if c["solved"]), key=lambda c: c["rank"])\r
    # A real, read value that fits beats a value worked out backwards. If nothing\r
    # read fits but an unread capacitor exists, that one is probably the timer.\r
    best = known[0] if known else None\r
    if not (best and best["ef"] <= best["tol"]) and solved and solved[0]["rank"] < 10:\r
        best = solved[0]\r
    best = best or solved[0]\r
    out = {"available": True, "pattern": "astable555", "considered": len(cands),\r
           "roles": {"RA": best["ra"]["id"], "RB": best["rb"]["id"], "C": best["c"]["id"]},\r
           "measured": {"frequency_hz": fm, "duty": dm, "region": f"V{light['index'] + 1}"},\r
           "formula": "f = 1.44 / ((RA + 2 x RB) x C)",\r
           "led_wiring": {"high": "the LED lights while the output is high (LED from pin 3 to ground)",\r
                          "low": "the LED lights while the output is low (LED from supply to pin 3)"}.get(best["wiring"])}\r
    if best["solved"]:\r
        ra, rb = best["ra"]["value"]["value"], best["rb"]["value"]["value"]\r
        lo, hi = 1.44 / ((ra * 1.05 + 2 * rb * 1.05) * fm), 1.44 / ((ra * 0.95 + 2 * rb * 0.95) * fm)\r
        return {**out, "verdict": "INFERRED", "inferred": {\r
            "component": best["c"]["id"], "value": best["c_solved"], "range": [lo, hi], "standard": best["c_standard"]["value"],\r
            "text": f"{best['c']['id']}'s label wasn't read, so its value was worked out from the blink rate: about "\r
                    f"{fmt_farads(best['c_solved'])}, most likely a standard {fmt_farads(best['c_standard']['value'])}"}}\r
    verdict = "CONSISTENT" if best["ef"] <= best["tol"] else "CONTRADICTED"\r
    res = {**out, "verdict": verdict, "predicted": {"frequency_hz": round(best["fp"], 4)},\r
           "error_pct": round(best["ef"] * 100, 1), "tolerance_pct": best["tol"] * 100}\r
    alts = [c for c in known if c is not best and c["ef"] <= c["tol"]\r
            and (c["ra"] is not best["ra"] or c["rb"] is not best["rb"] or c["c"] is not best["c"])]\r
    if verdict == "CONSISTENT" and alts:\r
        role_sets = list(dict.fromkeys(f"RA {c['ra']['id']}, RB {c['rb']['id']}, C {c['c']['id']}" for c in alts))[:3]\r
        res["alternatives"] = role_sets\r
        res["ambiguity"] = (f"the parts can also be assigned as {'; or '.join(role_sets)} and still fit the video, "\r
                            "so which resistor does which job is not settled by pixels alone")\r
    if verdict == "CONSISTENT" and dm is not None and best["ed"] > 0.1:\r
        res["note"] = "the blink rate matches, but the on-time doesn't fit any simple wiring; the LED may be driven differently"\r
    if verdict == "CONTRADICTED":\r
        k = best["ra"]["value"]["value"] + 2 * best["rb"]["value"]["value"]\r
        cval = best["c"]["value"]["value"]\r
        sug = [_suggest_fix(best["c"], 1.44 / (k * fm), False),\r
               _suggest_fix(best["rb"], (1.44 / (cval * fm) - best["ra"]["value"]["value"]) / 2, True),\r
               _suggest_fix(best["ra"], 1.44 / (cval * fm) - 2 * best["rb"]["value"]["value"], True)]\r
        res["suggestions"] = sorted((s for s in sug if s), key=lambda s: -s["plausibility"])\r
    return res\r
\r
\r
def cross_check_multivibrator(comps: list[dict], video: dict | None) -> dict:\r
    light = _best_light(video)\r
    if not light:\r
        return {"available": False, "reason": "the video shows no steady blinking to compare against"}\r
    fm = light["analysis"]["frequency_hz"]\r
    R = [c for c in comps if c["type"] == "resistor" and c.get("value")]\r
    C = [c for c in comps if c["type"].startswith("capacitor") and c.get("value")]\r
    if len(R) < 2 or len(C) < 2:\r
        return {"available": False, "reason": "need two known resistor values and two known capacitor values"}\r
    cands = []\r
    for i in range(len(R)):\r
        for j in range(i + 1, len(R)):\r
            for a in range(len(C)):\r
                for b in range(len(C)):\r
                    if a != b:\r
                        T = 0.693 * (R[i]["value"]["value"] * C[a]["value"]["value"] + R[j]["value"]["value"] * C[b]["value"]["value"])\r
                        cands.append({"r1": R[i], "r2": R[j], "c1": C[a], "c2": C[b], "fp": 1 / T, "ef": abs(1 / T - fm) / fm})\r
    best = min(cands, key=lambda c: c["ef"])\r
    return {"available": True, "pattern": "multivibrator", "considered": len(cands),\r
            "roles": {"R1": best["r1"]["id"], "R2": best["r2"]["id"], "C1": best["c1"]["id"], "C2": best["c2"]["id"]},\r
            "formula": "T = 0.693 x (R1 x C1 + R2 x C2)",\r
            "measured": {"frequency_hz": fm, "region": f"V{light['index'] + 1}"},\r
            "predicted": {"frequency_hz": round(best["fp"], 4)}, "error_pct": round(best["ef"] * 100, 1), "tolerance_pct": 25.0,\r
            "verdict": "CONSISTENT" if best["ef"] <= 0.25 else "CONTRADICTED"}\r
\r
\r
def cross_check(pattern_id: str, comps: list[dict], video: dict | None) -> dict:\r
    if not video or not video.get("frames"):\r
        return {"available": False, "reason": "no video, so there's no behaviour to check the parts against"}\r
    if pattern_id == "astable555":\r
        return cross_check_555(comps, video)\r
    if pattern_id == "multivibrator":\r
        return cross_check_multivibrator(comps, video)\r
    return {"available": False, "reason": "no behaviour formula for this pattern yet"}\r
\r
\r
# -------------------------------------------------------------- investigator --\r
\r
\r
def investigate(components: list[dict], patterns: dict | None, check: dict | None, video: dict | None,\r
                photo_count: int, cannot_see: list[str] | None = None) -> list[dict]:\r
    U: list[dict] = []\r
\r
    def add(text, ask=None, ev=()):\r
        U.append({"id": f"U{len(U) + 1}", "text": text, "ask": ask, "ev": list(ev)})\r
\r
    for c in components:\r
        if (c["type"] == "resistor" or c["type"].startswith("capacitor")) and not c.get("value"):\r
            add(f"{c['id']}'s value couldn't be read", f"A sharp close-up of {c['id']} in good light", [c["id"]])\r
        elif (c.get("value") or {}).get("ambiguous"):\r
            add(f"{c['id']}'s colour bands read differently from each end ({fmt_ohms(c['value']['value'])} or {fmt_ohms(c['value']['alternative'])})",\r
                f"A close-up of {c['id']} showing which end has the gold or silver band", [c["id"]])\r
        elif c["confidence"] == "LOW":\r
            add(f"{c['id']} is a low-confidence sighting", f"A closer photo of {c['id']}", [c["id"]])\r
    fn = [r for r in (patterns or {}).get("ranked", []) if r["role"] == "function"]\r
    if len(fn) > 1 and fn[0]["score"] - fn[1]["score"] < 0.2:\r
        a, b = fn[0], fn[1]\r
        add(f'"{a["name"]}" and "{b["name"]}" fit almost equally well',\r
            f"Evidence for or against: {b['missing'][0]}" if b["missing"] else f"A photo that shows {a['missing'][0] if a['missing'] else 'the IC markings clearly'}")\r
    if not video or not video.get("frames"):\r
        add("No video, so behaviour can't be measured", "A 10-second video of the device working, phone held still")\r
    elif video.get("camera_moved"):\r
        add("The camera moved during the video", "The same video with the phone resting on something")\r
    if check and check.get("ambiguity"):\r
        add(f"Roles not settled: {check['ambiguity']}",\r
            "A sharp close-up of the back of the board around the 555, to follow the copper from pins 6, 7 and 8" if photo_count >= 2\r
            else "A photo of the back of the board, to follow the copper from the 555's pins 6, 7 and 8")\r
    if check and check.get("verdict") == "CONTRADICTED":\r
        for s in check.get("suggestions") or []:\r
            add(s["text"], f"A close-up of {s['component']}'s label or bands", [s["component"]])\r
    if check and check.get("verdict") == "INFERRED":\r
        add(check["inferred"]["text"], f"A close-up of {check['inferred']['component']}'s label to confirm", [check["inferred"]["component"]])\r
    if photo_count < 2:\r
        add("Only one side of the board is visible, so connections come from the pattern, not from traced copper", "A photo of the back of the board")\r
    for s in cannot_see or []:\r
        if not re.search(r"back|underneath|other side|trace", s, re.I):\r
            add(f"Not visible: {s}")\r
    add("Pixels can't show voltages", "Part 3: the RECON probe measures what photos can't (a 555's timing capacitor should swing between one third and two thirds of the supply)")\r
    return U\r
\r
\r
# ------------------------------------------------------------ evidence brief --\r
\r
\r
def component_line(c: dict) -> str:\r
    bits = [c["type"].replace("_", " ")]\r
    if c.get("marking"):\r
        bits.append(f'marking "{c["marking"]}"')\r
    if c.get("value"):\r
        src = c["value"]["basis"] + (f": {' '.join(c['bands'])}" if c.get("bands") and c["value"]["basis"] == "colour bands" else "")\r
        bits.append(f"{fmt_value(c)} (from {src})")\r
    elif c["type"] == "resistor" or c["type"].startswith("capacitor"):\r
        bits.append("value not read")\r
    return f"{c['id']} {c['status']} {c['confidence']}: {', '.join(bits)}. Seen: {c['evidence']}"\r
\r
\r
def build_brief(st: dict) -> str:\r
    """Everything the reporter may use, each line with an id. Nothing else exists."""\r
    L = ["EVIDENCE (only these ids exist)"]\r
    L += [component_line(c) for c in st.get("components") or []]\r
    L += [f"{b['id']} OBSERVED {b['confidence']}: {b['note']}" for b in st.get("board") or []]\r
    for d in st.get("datasheets") or []:\r
        L.append(f"{d['id']} RESEARCHED {d['confidence']}: {d['component_id']} is {d['identity']}. {d['function']} "\r
                 f"Facts: {'; '.join(d['key_facts']) or 'none'}. Sources: {', '.join(d['sources'])}")\r
    cr = st.get("changing_region")\r
    if cr and cr.get("component_id"):\r
        L.append(f"The changing area in the video is {cr['component_id']} ({cr['evidence']}).")\r
    v = st.get("video")\r
    if v and v.get("frames"):\r
        for i, r in enumerate(v["regions"]):\r
            a = r["analysis"]\r
            L.append(f"V{i + 1} OBSERVED {a['confidence']}: a light blinks at {round(a['frequency_hz'], 3)} Hz (period {round(a['period_s'], 2)} s), "\r
                     f"on {round((a.get('duty_cycle') or 0) * 100)}% of the time, {a['cycles']} cycles in {round(v['duration_s'], 1)} s of video"\r
                     if a.get("periodic") else f"V{i + 1} OBSERVED: an area changes brightness without a steady rhythm")\r
        for r in v["relations"]:\r
            if r["kind"] != "unrelated":\r
                L.append(f"V{r['a'] + 1} and V{r['b'] + 1} {'take turns' if r['kind'] == 'alternate' else 'change together'}.")\r
        if not v["regions"]:\r
            L.append("V0 OBSERVED: nothing in the video visibly changes.")\r
    p = st.get("patterns") or {}\r
    for i, r in enumerate((p.get("ranked") or [])[:3]):\r
        found = "; ".join(m["text"] + (f" ({', '.join(m['ev'])})" if m["ev"] else "") for m in r["matched"]) or "none"\r
        L.append(f'P{i + 1} INFERRED{" " + p["confidence"] if i == 0 else ""}: pattern "{r["name"]}". {r["summary"]} '\r
                 f"Clues found: {found}. Missing: {'; '.join(r['missing']) or 'none'}. Not checked: {'; '.join(r['unknown']) or 'none'}.")\r
    x = st.get("check")\r
    if x and x.get("available"):\r
        roles = ", ".join(f"{k}={v}" for k, v in x["roles"].items())\r
        if x["verdict"] == "INFERRED":\r
            L.append(f"X1 INFERRED: {x['inferred']['text']}. Formula {x['formula']}, roles {roles}, measured {round(x['measured']['frequency_hz'], 3)} Hz.")\r
        else:\r
            extra = (f" On-time suggests {x['led_wiring']}." if x.get("led_wiring") else "") + \\\r
                    (f" Note: {x['ambiguity']}." if x.get("ambiguity") else "") + \\\r
                    (f" Possible explanations: {'; '.join(s['text'] for s in x['suggestions'])}." if x.get("suggestions") else "")\r
            L.append(f"X1 {x['verdict']}: formula {x['formula']} with {roles} predicts {round(x['predicted']['frequency_hz'], 3)} Hz; "\r
                     f"the video measured {round(x['measured']['frequency_hz'], 3)} Hz ({x['error_pct']}% apart; allowed {x['tolerance_pct']:g}% for part tolerances).{extra}")\r
    else:\r
        L.append(f"X1 UNKNOWN: no prediction checked ({(x or {}).get('reason', 'not run')}).")\r
    for u in st.get("unknowns") or []:\r
        L.append(f"{u['id']} UNKNOWN: {u['text']}." + (f" Next: {u['ask']}." if u.get("ask") else ""))\r
    return "\\n".join(L)\r
\r
\r
def evidence_ids(st: dict) -> list[str]:\r
    v = st.get("video") or {}\r
    regions = v.get("regions") or []\r
    return ([c["id"] for c in st.get("components") or []] + [b["id"] for b in st.get("board") or []]\r
            + [d["id"] for d in st.get("datasheets") or []]\r
            + [f"V{i + 1}" for i in range(len(regions))] + (["V0"] if v.get("frames") and not regions else [])\r
            + [f"P{i + 1}" for i in range(min(3, len((st.get("patterns") or {}).get("ranked") or [])))]\r
            + ["X1"] + [u["id"] for u in st.get("unknowns") or []])\r
\r
\r
# ------------------------------------------------------------------- skeptic --\r
\r
_STANDALONE = re.compile(r"(?<![A-Za-z0-9.])(\\d+(?:\\.\\d+)?)")\r
_ANY = re.compile(r"\\d+(?:\\.\\d+)?")\r
\r
\r
def skeptic_check(report: dict, valid_ids: list[str], evidence_text: str) -> dict:\r
    """Every sentence must cite evidence that exists, and every number in it\r
    must already appear in the evidence the reporter was given."""\r
    grounded = [float(m) for m in _ANY.findall(evidence_text)]\r
    valid = set(valid_ids)\r
    out_sections, claims, flagged = [], 0, 0\r
    for sec in report.get("sections") or []:\r
        sents = []\r
        for s in sec.get("sentences") or []:\r
            text, cites = str(s.get("text") or ""), [str(c) for c in s.get("cites") or []]\r
            flags = []\r
            if not cites:\r
                flags.append("cites no evidence")\r
            bad = [c for c in cites if c not in valid]\r
            if bad:\r
                flags.append(f"cites evidence that doesn't exist: {', '.join(bad)}")\r
            nums = [float(n) for n in _STANDALONE.findall(re.sub(r"\\[[^\\]]*\\]", "", text))]\r
            nums = [n for n in nums if not (n.is_integer() and n <= 10)]\r
            loose = [n for n in nums if not any((g == n) if g == 0 else abs(n - g) / abs(g) <= 0.03 for g in grounded)]\r
            if loose:\r
                flags.append(f"number not found in the evidence: {', '.join(f'{n:g}' for n in loose)}")\r
            claims += 1\r
            flagged += bool(flags)\r
            sents.append({"text": text, "cites": cites, "flags": flags})\r
        out_sections.append({"title": sec.get("title", ""), "sentences": sents})\r
    return {"sections": out_sections, "claims": claims, "flagged": flagged}\r
`,f=`"""Wiring for the matched circuit: nets, a build order and a Mermaid diagram (code, no model).\r
\r
The observer never sees copper, so these connections are the matched pattern's\r
standard wiring with the observed parts placed in their roles (from the check\r
when it ran). Every net is marked INFERRED; the UI and the report say so, and\r
suggest a continuity check before trusting a connection.\r
\r
A net is one electrical node: everything in it must be joined together. To\r
replicate the circuit you make each net once; the build list numbers them.\r
"""\r
from __future__ import annotations\r
\r
import re\r
\r
from . import core\r
\r
PALETTE = ["#1f6feb", "#8a3ffc", "#d97a00", "#0f8a5f", "#b8336a", "#0b7a8a", "#5b8c00", "#c2410c", "#4f46e5", "#a16207"]\r
COLORS = {"vbat": "#d1342f", "v5": "#e0569b", "in1": "#1f6feb", "in2": "#3b82f6", "in3": "#8a3ffc", "in4": "#a78bfa",\r
          "ena": "#0b7a8a", "enb": "#14b8a6", "ma1": "#d97a00", "ma2": "#f59e0b", "mb1": "#0f8a5f", "mb2": "#22c55e",\r
          "trig": "#b8336a", "echo": "#c2410c", "sig": "#b8336a", "servo1": "#4f46e5", "servo2": "#a16207",\r
          "vcc": "#d1342f", "gnd": "#1b1b1b", "dis": "#1f6feb", "thr": "#8a3ffc", "out": "#d97a00", "led": "#0f8a5f",\r
          "c1": "#1f6feb", "c2": "#0b7a8a", "b1": "#8a3ffc", "b2": "#b8336a", "l1": "#0f8a5f", "l2": "#5b8c00",\r
          "gpio": "#d97a00", "pwr": "#d1342f"}\r
\r
\r
def _val(c: dict | None) -> str:\r
    if not c:\r
        return ""\r
    return core.fmt_value(c) or c.get("marking") or ""\r
\r
\r
def _part(role: str, c: dict | None, kind: str, inferred_role: bool = False) -> dict:\r
    return {"role": role, "id": c["id"] if c else None, "kind": kind, "value": _val(c),\r
            "status": (c or {}).get("status", "MISSING" if not c else "OBSERVED"), "role_inferred": inferred_role,\r
            "label": f"{role} · {c['id']}" + (f" · {_val(c)}" if _val(c) else "") if c else f"{role} · not seen"}\r
\r
\r
def _pin(part: dict, pin: str) -> dict:\r
    return {"part": part["role"], "id": part["id"], "pin": pin}\r
\r
\r
def _supply_label(st: dict) -> str:\r
    from .sketches import supply_from\r
    v = supply_from([st.get("note") or ""] + [b.get("note", "") for b in st.get("board") or []])\r
    return f"+{v:g} V" if v else "+V"\r
\r
\r
def astable555(st: dict) -> dict:\r
    comps = st.get("components") or []\r
    by = {c["id"]: c for c in comps}\r
    x = st.get("check") or {}\r
    R = [c for c in comps if c["type"] == "resistor"]\r
    C = [c for c in comps if c["type"].startswith("capacitor")]\r
    roles = x.get("roles") if x.get("available") else None\r
    if roles:\r
        ra, rb, cc = by.get(roles["RA"]), by.get(roles["RB"]), by.get(roles["C"])\r
    else:\r
        ra, rb, cc = (R + [None, None])[0], (R + [None, None])[1], (C + [None])[0]\r
    rl = next((r for r in R if r is not ra and r is not rb), None)\r
    ic = next((c for c in comps if c.get("marking") and core.RX["t555"].search(c["marking"])), None) or \\\r
        next((c for c in comps if c["type"] == "ic"), None)\r
    led = next((c for c in comps if c["type"] == "led"), None)\r
    P = {k: _part(*a) for k, a in {\r
        "U": ("555", ic, "ic"), "RA": ("RA", ra, "resistor", not roles), "RB": ("RB", rb, "resistor", not roles),\r
        "C": ("C", cc, "capacitor", not roles), "RL": ("R LED", rl, "resistor"), "LED": ("LED", led, "led"),\r
        "BAT": ("Supply", None, "supply")}.items()}\r
    P["BAT"].update(label=f"Supply · {_supply_label(st)}", status="OBSERVED" if st.get("board") else "MISSING")\r
    low = "output is low" in (x.get("led_wiring") or "")\r
    nets = [\r
        {"key": "vcc", "name": f"{_supply_label(st)} supply", "pins": [_pin(P["BAT"], "+"), _pin(P["U"], "pin 8 (VCC)"),\r
                                                                      _pin(P["U"], "pin 4 (RESET)"), _pin(P["RA"], "end 1")]\r
         + ([_pin(P["RL"], "end 1")] if low else [])},\r
        {"key": "dis", "name": "Discharge node", "pins": [_pin(P["U"], "pin 7 (DIS)"), _pin(P["RA"], "end 2"), _pin(P["RB"], "end 1")]},\r
        {"key": "thr", "name": "Timing node", "pins": [_pin(P["U"], "pin 6 (THR)"), _pin(P["U"], "pin 2 (TRIG)"), _pin(P["RB"], "end 2"),\r
                                                       _pin(P["C"], "+ (long leg)")]},\r
    ]\r
    if low:\r
        nets += [{"key": "led", "name": "LED drive", "pins": [_pin(P["RL"], "end 2"), _pin(P["LED"], "anode (long leg)")]},\r
                 {"key": "out", "name": "Output", "pins": [_pin(P["U"], "pin 3 (OUT)"), _pin(P["LED"], "cathode (flat side)")]}]\r
    else:\r
        nets += [{"key": "out", "name": "Output", "pins": [_pin(P["U"], "pin 3 (OUT)"), _pin(P["RL"], "end 1")]},\r
                 {"key": "led", "name": "LED drive", "pins": [_pin(P["RL"], "end 2"), _pin(P["LED"], "anode (long leg)")]}]\r
    nets.append({"key": "gnd", "name": "Ground", "pins": [_pin(P["BAT"], "−"), _pin(P["U"], "pin 1 (GND)"), _pin(P["C"], "− (stripe side)")]\r
                 + ([] if low else [_pin(P["LED"], "cathode (flat side)")])})\r
    notes = ["Pin 1 of the 555 is next to the notch or dot; pins count anticlockwise seen from above.",\r
             "Pin 5 (CV) usually has a 10 nF capacitor to ground or is left open; none was observed."]\r
    if low:\r
        notes.append("The measured on-time suggests the LED is wired from the supply to pin 3 (it lights while the output is low).")\r
    return {"pattern": "astable555", "layout": "astable555", "parts": P, "nets": nets, "notes": notes, "low": low}\r
\r
\r
def multivibrator(st: dict) -> dict:\r
    comps = st.get("components") or []\r
    T = [c for c in comps if c["type"] == "transistor"]\r
    C = [c for c in comps if c["type"].startswith("capacitor")]\r
    L = [c for c in comps if c["type"] == "led"]\r
    R = sorted([c for c in comps if c["type"] == "resistor"], key=lambda c: (c.get("value") or {}).get("value") or 0)\r
    g = lambda lst, i: lst[i] if len(lst) > i else None\r
    P = {k: _part(*a) for k, a in {\r
        "Q1": ("Q1", g(T, 0), "npn"), "Q2": ("Q2", g(T, 1), "npn"), "C1": ("C1", g(C, 0), "capacitor"), "C2": ("C2", g(C, 1), "capacitor"),\r
        "RC1": ("R LED1", g(R, 0), "resistor", True), "RC2": ("R LED2", g(R, 1), "resistor", True),\r
        "RB1": ("R base1", g(R, 2), "resistor", True), "RB2": ("R base2", g(R, 3), "resistor", True),\r
        "L1": ("LED1", g(L, 0), "led"), "L2": ("LED2", g(L, 1), "led"), "BAT": ("Supply", None, "supply")}.items()}\r
    P["BAT"].update(label=f"Supply · {_supply_label(st)}")\r
    nets = [\r
        {"key": "vcc", "name": f"{_supply_label(st)} supply", "pins": [_pin(P["BAT"], "+"), _pin(P["RC1"], "end 1"), _pin(P["RC2"], "end 1"),\r
                                                                      _pin(P["RB1"], "end 1"), _pin(P["RB2"], "end 1")]},\r
        {"key": "l1", "name": "LED1 feed", "pins": [_pin(P["RC1"], "end 2"), _pin(P["L1"], "anode (long leg)")]},\r
        {"key": "c1", "name": "Q1 collector", "pins": [_pin(P["L1"], "cathode (flat side)"), _pin(P["Q1"], "collector"), _pin(P["C1"], "+ (long leg)")]},\r
        {"key": "b2", "name": "Q2 base", "pins": [_pin(P["C1"], "− (stripe side)"), _pin(P["Q2"], "base"), _pin(P["RB2"], "end 2")]},\r
        {"key": "l2", "name": "LED2 feed", "pins": [_pin(P["RC2"], "end 2"), _pin(P["L2"], "anode (long leg)")]},\r
        {"key": "c2", "name": "Q2 collector", "pins": [_pin(P["L2"], "cathode (flat side)"), _pin(P["Q2"], "collector"), _pin(P["C2"], "+ (long leg)")]},\r
        {"key": "b1", "name": "Q1 base", "pins": [_pin(P["C2"], "− (stripe side)"), _pin(P["Q1"], "base"), _pin(P["RB1"], "end 2")]},\r
        {"key": "gnd", "name": "Ground", "pins": [_pin(P["BAT"], "−"), _pin(P["Q1"], "emitter"), _pin(P["Q2"], "emitter")]},\r
    ]\r
    notes = ["Transistors are assumed NPN (e.g. BC547 or 2N3904); check their markings. Pin order differs between types: look up the datasheet.",\r
             "The two smaller resistors are taken as the LED resistors and the two larger as base resistors (by value); verify with continuity."]\r
    return {"pattern": "multivibrator", "layout": "multivibrator", "parts": P, "nets": nets, "notes": notes}\r
\r
\r
def mcu_blinker(st: dict) -> dict:\r
    comps = st.get("components") or []\r
    mcu = next((c for c in comps if c["type"] == "dev_board"), None) or \\\r
        next((c for c in comps if c.get("marking") and core.RX["mcu"].search(c["marking"])), None)\r
    R = [c for c in comps if c["type"] == "resistor"]\r
    out = next((c for c in comps if c["type"] in ("led", "relay", "buzzer", "motor")), None)\r
    esp = bool(mcu and core.RX["esp"].search((mcu.get("marking") or "") + " " + (mcu.get("evidence") or "")))\r
    P = {"U": _part("Controller", mcu, "mcu"), "R": _part("R", R[0] if R else None, "resistor"),\r
         "LED": _part("LED" if (out or {}).get("type", "led") == "led" else "Output", out, "led"),\r
         "BAT": _part("Power", None, "supply")}\r
    P["BAT"].update(label="Power · USB or VIN", status="MISSING")\r
    nets = [{"key": "pwr", "name": "Power", "pins": [_pin(P["BAT"], "USB 5 V or VIN"), _pin(P["U"], "5V / VIN" if not esp else "5V / VIN (3.3 V logic)")]},\r
            {"key": "gpio", "name": "Output pin", "pins": [_pin(P["U"], "GPIO (which pin is not visible)"), _pin(P["R"], "end 1")]},\r
            {"key": "led", "name": "LED drive", "pins": [_pin(P["R"], "end 2"), _pin(P["LED"], "anode (long leg)")]},\r
            {"key": "gnd", "name": "Ground", "pins": [_pin(P["U"], "GND"), _pin(P["LED"], "cathode (flat side)")]}]\r
    notes = ["The blink rate lives in the firmware, not in part values; to copy the behaviour you also need the sketch.",\r
             "Find the GPIO with the multimeter's continuity mode, from the resistor's free end to the board's header pins."]\r
    if esp:\r
        notes.append("ESP32 / ESP8266 pins are 3.3 V logic and not 5 V tolerant.")\r
    return {"pattern": "mcu_blinker", "layout": "mcu", "parts": P, "nets": nets, "notes": notes}\r
\r
\r
def robot(st: dict) -> dict:\r
    """The standard hook-up of a battery-powered robot: driver, controller, motors, sensor. One net per real wire."""\r
    comps = st.get("components") or []\r
    bat = next((c for c in comps if c["type"] == "battery"), None)\r
    drv = next((c for c in comps if core.RX["mdrv"].search(c.get("marking") or "")), None)\r
    mcu = next((c for c in comps if c["type"] == "dev_board"), None) or next((c for c in comps if core.RX["mcu"].search(c.get("marking") or "")), None)\r
    motors = [c for c in comps if c["type"] in ("motor", "stepper")][:2]\r
    servos = [c for c in comps if c["type"] == "servo"][:2]\r
    sensor = next((c for c in comps if c["type"] == "sensor_module" or core.RX["sensor"].search(c.get("marking") or "")), None)\r
    esp = bool(mcu and core.RX["esp"].search(f"{mcu.get('marking') or ''} {mcu.get('evidence') or ''}"))\r
    sr04 = bool(sensor and re.search(r"SR0\\d", sensor.get("marking") or "", re.I))\r
    P = {"BAT": _part("Battery", bat, "supply"), "U": _part("Controller", mcu, "mcu")}\r
    if drv or motors:\r
        P["DRV"] = _part("Driver", drv, "driver")\r
    for i, m in enumerate(motors):\r
        P[f"M{i + 1}"] = _part(f"Motor {'AB'[i]}", m, "motor")\r
    for i, sv in enumerate(servos):\r
        P[f"SV{i + 1}"] = _part(f"Servo {i + 1}", sv, "servo")\r
    if sensor:\r
        P["S"] = _part("Sensor", sensor, "sensor")\r
    gpio = (lambda n: f"GPIO {n}") if esp else (lambda n: f"D{n}")\r
    nets = [{"key": "vbat", "name": "Battery +", "pins": [_pin(P["BAT"], "+")] + ([_pin(P["DRV"], "VS (motor supply)")] if "DRV" in P else [])},\r
            {"key": "gnd", "name": "Ground (shared by every layer)", "pins": [_pin(P["BAT"], "−"), _pin(P["U"], "GND")]\r
             + ([_pin(P["DRV"], "GND")] if "DRV" in P else []) + ([_pin(P["S"], "GND")] if sensor else [])\r
             + [_pin(P[f"SV{i + 1}"], "GND (brown)") for i in range(len(servos))]},\r
            {"key": "v5", "name": "+5 V logic", "pins": ([_pin(P["DRV"], "+5V out")] if "DRV" in P else [_pin(P["BAT"], "regulated 5 V")])\r
             + [_pin(P["U"], "5V" if not esp else "5V / VIN")] + ([_pin(P["S"], "VCC")] if sensor else [])\r
             + [_pin(P[f"SV{i + 1}"], "V+ (red)") for i in range(len(servos))]}]\r
    if "DRV" in P and motors:\r
        pins_in = [5, 6, 7, 8] if not esp else [25, 26, 27, 14]\r
        for j in range(2 * len(motors)):\r
            nets.append({"key": f"in{j + 1}", "name": f"Direction IN{j + 1}", "pins": [_pin(P["U"], gpio(pins_in[j])), _pin(P["DRV"], f"IN{j + 1}")]})\r
        for i, m in enumerate(motors):\r
            k = "ab"[i]\r
            nets.append({"key": f"m{k}1", "name": f"Motor {k.upper()} +", "pins": [_pin(P["DRV"], f"OUT{2 * i + 1}"), _pin(P[f"M{i + 1}"], "+")]})\r
            nets.append({"key": f"m{k}2", "name": f"Motor {k.upper()} −", "pins": [_pin(P["DRV"], f"OUT{2 * i + 2}"), _pin(P[f"M{i + 1}"], "−")]})\r
    for i in range(len(servos)):\r
        nets.append({"key": f"servo{i + 1}", "name": f"Servo {i + 1} signal", "pins": [_pin(P["U"], gpio(9 + i) + " (PWM)"), _pin(P[f"SV{i + 1}"], "signal (orange)")]})\r
    if sensor and sr04:\r
        nets.append({"key": "trig", "name": "Sensor trigger", "pins": [_pin(P["U"], gpio(11 if not esp else 12)), _pin(P["S"], "TRIG")]})\r
        nets.append({"key": "echo", "name": "Sensor echo" + (" (5 V: divide to 3.3 V)" if esp else ""),\r
                     "pins": [_pin(P["S"], "ECHO"), _pin(P["U"], gpio(12 if not esp else 13))]})\r
    elif sensor:\r
        nets.append({"key": "sig", "name": "Sensor signal", "pins": [_pin(P["S"], "OUT / DATA"), _pin(P["U"], gpio(2) + " or I2C")]})\r
    notes = ["Pin numbers on the controller are examples: the real ones are set by the firmware. Any free digital pins work for IN1–IN4.",\r
             "Keep ENA and ENB jumpers on for full speed, or move them to PWM pins to control speed." if drv and re.search("L298", drv.get("marking") or "", re.I) else\r
             "Check the driver's datasheet for its enable or standby pin.",\r
             "Motor direction is set by which of each IN pair is high; swap a motor's two wires if it runs backwards."]\r
    if servos:\r
        notes.append("Servos draw up to ~0.7 A each when stalled: power them from the battery through a 5–6 V regulator, not from the controller's 5 V pin.")\r
    if esp and sr04:\r
        notes.append("The HC-SR04 echo is 5 V: put 1 kΩ in series and 2 kΩ to ground before the ESP pin.")\r
    return {"pattern": "robot_drive", "layout": "auto", "parts": P, "nets": nets, "notes": notes}\r
\r
\r
def traced(st: dict) -> dict | None:\r
    """Wiring the observer could actually see (jumper wires, copper on the back): union of traced links into nets."""\r
    links = st.get("traces") or []\r
    if not links:\r
        return None\r
    comps = {c["id"]: c for c in st.get("components") or []}\r
    parent = {}\r
\r
    def find(x):\r
        parent.setdefault(x, x)\r
        while parent[x] != x:\r
            parent[x] = parent[parent[x]]\r
            x = parent[x]\r
        return x\r
\r
    for t in links:\r
        a, b = (t["a"], t["a_pin"]), (t["b"], t["b_pin"])\r
        parent[find(a)] = find(b)\r
    groups = {}\r
    for node in list(parent):\r
        groups.setdefault(find(node), []).append(node)\r
    kind = {"resistor": "resistor", "led": "led", "diode": "diode", "inductor": "inductor", "crystal": "crystal",\r
            "transistor": "npn", "battery": "supply"}\r
    P = {}\r
    for cid in sorted({n[0] for nodes in groups.values() for n in nodes}, key=lambda x: int(x[1:]) if x[1:].isdigit() else 0):\r
        c = comps.get(cid) or {"id": cid, "type": "other"}\r
        k = "capacitor" if c["type"].startswith("capacitor") else kind.get(c["type"], "box")\r
        P[cid] = _part(cid, c, k)\r
        P[cid]["label"] = f"{cid} · {_val(c) or c['type'].replace('_', ' ')}"\r
    nets = []\r
    for i, nodes in enumerate(sorted(groups.values(), key=lambda g: -len(g))):\r
        names = " ".join(n[1].lower() for n in nodes)\r
        key = "gnd" if re.search(r"gnd|ground|−|-\\b", names) else "vcc" if re.search(r"vcc|\\+5|5v|3v3|vin|\\+", names) and i < 3 else f"t{i + 1}"\r
        if any(n["key"] == key for n in nets):\r
            key = f"t{i + 1}"\r
        nets.append({"key": key, "name": "Ground" if key == "gnd" else "Supply" if key == "vcc" else f"Net {i + 1}",\r
                     "pins": [_pin(P[n[0]], n[1]) for n in nodes]})\r
    weak = sum(1 for t in links if t.get("confidence") == "LOW")\r
    return {"pattern": "traced", "layout": "auto", "parts": P, "nets": nets,\r
            "basis": f"Traced by the observer from {len(links)} connection(s) it could see (wires, copper). "\r
                     "A vision model can misread a trace: verify each net with a continuity check.",\r
            "notes": [f"{weak} of the {len(links)} connections were low-confidence sightings."] if weak else []}\r
\r
\r
BUILDERS = {"astable555": astable555, "multivibrator": multivibrator, "mcu_blinker": mcu_blinker, "robot_drive": robot}\r
\r
\r
def wiring(st: dict) -> dict | None:\r
    """Nets, build steps and notes for the top matched pattern, or None when no known circuit fits."""\r
    top = ((st.get("patterns") or {}).get("top") or {}).get("id")\r
    if top in BUILDERS and st.get("components"):\r
        w = BUILDERS[top](st)\r
    elif st.get("traces"):\r
        w = traced(st)\r
    else:\r
        return None\r
    for i, n in enumerate(w["nets"]):\r
        n["id"] = f"N{i + 1}"\r
        n["color"] = COLORS.get(n["key"], PALETTE[i % len(PALETTE)])\r
        n["pins"] = [p for p in n["pins"] if p["part"]]\r
    w["nets"] = [n for n in w["nets"] if len(n["pins"]) >= 2 or n["key"] in ("vbat", "gnd")]\r
    w["layout"] = w.get("layout") or w["pattern"]\r
    w["basis"] = w.get("basis") or ("Standard wiring of the matched circuit, with parts placed in their roles"\r
                  + (" by the check (X1)" if (st.get("check") or {}).get("available") else "")\r
                  + ". Not traced from copper: verify each net with a continuity check before relying on it.")\r
    if st.get("traces") and w["pattern"] != "traced":\r
        w["notes"] = w["notes"] + [f"The observer also traced {len(st['traces'])} connection(s) it could see; switch to Traced to compare."]\r
    w["steps"] = [f"{n['id']} {n['name']}: join " + ", ".join(_pin_text(w, p) for p in n["pins"]) for n in w["nets"]]\r
    w["missing"] = [p["label"] for p in w["parts"].values() if not p["id"] and p["kind"] != "supply"]\r
    return w\r
\r
\r
def _pin_text(w: dict, p: dict) -> str:\r
    return f"{p['id'] or p['part']} {p['pin']}"\r
\r
\r
def mermaid(w: dict) -> str:\r
    """A Mermaid flowchart: each net is a coloured node, each part pin an edge to it (GitHub renders it)."""\r
    L = ["flowchart LR"]\r
    for key, part in w["parts"].items():\r
        if any(p["part"] == part["role"] for n in w["nets"] for p in n["pins"]):\r
            L.append(f'  {key}["{part["label"]}"]')\r
    for n in w["nets"]:\r
        L.append(f'  {n["id"]}(("{n["id"]} {n["name"]}"))')\r
        for p in n["pins"]:\r
            key = next(k for k, v in w["parts"].items() if v["role"] == p["part"])\r
            L.append(f'  {key} ---|"{p["pin"]}"| {n["id"]}')\r
    for n in w["nets"]:\r
        L.append(f'  style {n["id"]} fill:{n["color"]},color:#fff,stroke:{n["color"]}')\r
    return "\\n".join(L)\r
`,p=`"""Electrical simulation of the matched circuit (code, no model).\r
\r
From the wiring (diagrams.wiring: which observed part plays which role) and the\r
part values, compute what the circuit does and whether every part is inside its\r
ratings: waveforms, per-part current and power, LED current, supply current and\r
battery life, and warnings with a concrete fix (the nearest standard value).\r
\r
What-if: \`overrides\` replaces part values ({"O4": "220"}) without touching the\r
recorded evidence; results are labelled SIMULATED. Every assumption that is not\r
evidence (LED forward voltage from its colour, 1/4 W resistors, 555 output drop,\r
battery capacity) is listed with the result.\r
"""\r
from __future__ import annotations\r
\r
import copy\r
import math\r
import re\r
\r
from . import core, diagrams, system\r
from .sketches import _e12_at_least, supply_from\r
\r
LED_VF = {"red": 1.9, "orange": 2.0, "yellow": 2.0, "green": 2.1, "blue": 3.0, "white": 3.0}\r
LED_MAX_A = 0.020            # typical continuous rating of a 5 mm indicator LED\r
LED_TARGET_A = 0.012         # comfortable brightness, well inside the rating\r
RES_W = 0.25                 # assumed 1/4 W through-hole resistors unless known\r
BATTERY_MAH = {9: 500, 12: 1000, 5: 2000, 3.7: 2000}   # rough alkaline 9 V / pack / USB power bank / Li-ion cell\r
CMOS_555 = re.compile(r"TLC555|LMC555|ICM7555|(^|[^0-9])7555|TS555|ALD555", re.I)\r
GPIO = {"arduino": (5.0, 0.020, 0.040, "ATmega328P"), "esp32": (3.3, 0.020, 0.040, "ESP32"),\r
        "esp8266": (3.3, 0.012, 0.012, "ESP8266")}   # logic V, recommended A, absolute max A\r
\r
\r
def fmt_a(a: float) -> str:\r
    return f"{a * 1000:.1f} mA" if abs(a) < 1 else f"{a:.2f} A"\r
\r
\r
def fmt_w(w: float) -> str:\r
    return f"{w * 1000:.0f} mW" if w < 1 else f"{w:.2f} W"\r
\r
\r
def _led_vf(c: dict | None) -> tuple[float, str]:\r
    text = f"{(c or {}).get('evidence', '')} {(c or {}).get('marking') or ''}".lower()\r
    for colour, vf in LED_VF.items():\r
        if colour in text:\r
            return vf, colour\r
    return 2.0, "unknown colour"\r
\r
\r
def apply_overrides(st: dict, overrides: dict | None) -> tuple[dict, list[str]]:\r
    """A copy of the state with what-if values in place of the observed ones."""\r
    st = copy.deepcopy(st)\r
    changed = []\r
    for c in st.get("components") or []:\r
        text = (overrides or {}).get(c["id"])\r
        if not text:\r
            continue\r
        if c["type"] == "resistor":\r
            v = core.parse_resistance(text)\r
            unit = "ohm"\r
        elif c["type"].startswith("capacitor"):\r
            v = core.parse_capacitance(text, c["type"])\r
            unit = "F"\r
        else:\r
            continue\r
        if v:\r
            c["value"] = {"value": v, "unit": unit, "basis": "what-if", "tolerance_pct": 5 if unit == "ohm" else 20}\r
            c["display"] = core.fmt_value(c)\r
            changed.append(c["id"])\r
    return st, changed\r
\r
\r
def _val(part: dict, by_id: dict) -> float | None:\r
    c = by_id.get(part.get("id") or "")\r
    return ((c or {}).get("value") or {}).get("value")\r
\r
\r
def _square(t_on: float, t_off: float, hi: float, lo: float, periods: int = 3, n: int = 240):\r
    T = t_on + t_off\r
    pts = []\r
    for i in range(n + 1):\r
        t = periods * T * i / n\r
        pts.append([round(t, 6), hi if (t % T) < t_on else lo])\r
    return pts\r
\r
\r
def _warn(level: str, part: str | None, text: str, fix: dict | None = None) -> dict:\r
    return {"level": level, "part": part, "text": text, "fix": fix}\r
\r
\r
def _cap_rating(c: dict | None) -> float | None:\r
    m = re.search(r"(\\d+(?:\\.\\d+)?)\\s*V\\b", (c or {}).get("value_printed") or "", re.I)\r
    return float(m.group(1)) if m else None\r
\r
\r
def _battery(vs: float, i_avg: float) -> dict | None:\r
    cap = next((mah for v, mah in sorted(BATTERY_MAH.items(), key=lambda kv: abs(kv[0] - vs)) if abs(v - vs) < 1.5), None)\r
    if not cap or i_avg <= 0:\r
        return None\r
    return {"label": "Battery life (estimate)", "value": f"≈ {cap / (i_avg * 1000):.0f} h", "note": f"assumes a {cap} mAh source"}\r
\r
\r
# ---------------------------------------------------------------- 555 astable --\r
\r
\r
def _sim_555(st: dict, w: dict, vs: float) -> dict:\r
    by = {c["id"]: c for c in st.get("components") or []}\r
    P = w["parts"]\r
    ra, rb, cc, rl = _val(P["RA"], by), _val(P["RB"], by), _val(P["C"], by), _val(P["RL"], by)\r
    need = [r for r, v in (("RA", ra), ("RB", rb), ("C", cc)) if not v]\r
    if need:\r
        return {"available": False, "reason": f"needs a value for {', '.join(need)}; tell GENESIS what the label says or type a what-if value"}\r
    ic = by.get(P["U"].get("id") or "") or {}\r
    cmos = bool(CMOS_555.search(ic.get("marking") or ""))\r
    led = by.get(P["LED"].get("id") or "")\r
    vf, colour = _led_vf(led)\r
    t_hi, t_lo = math.log(2) * (ra + rb) * cc, math.log(2) * rb * cc\r
    T = t_hi + t_lo\r
    f, duty = 1 / T, t_hi / T\r
    v_hi = vs - (0.1 if cmos else 1.5)\r
    low = w.get("low")\r
    lit_frac = (1 - duty) if low else duty\r
    # capacitor: charges vs/3 -> 2vs/3 through RA+RB, discharges 2vs/3 -> vs/3 through RB\r
    tau_c, tau_d = (ra + rb) * cc, rb * cc\r
    cap_pts, out_pts = [], []\r
    n = 300\r
    for i in range(n + 1):\r
        t = 3 * T * i / n\r
        k = t % T\r
        if k < t_hi:\r
            v = vs - (vs - vs / 3) * math.exp(-k / tau_c)\r
            o = v_hi\r
        else:\r
            v = (2 * vs / 3) * math.exp(-(k - t_hi) / tau_d)\r
            o = 0.1\r
        cap_pts.append([round(t, 6), round(v, 3)])\r
        out_pts.append([round(t, 6), round(o, 3)])\r
    warnings, parts, assumptions = [], {}, [\r
        f"LED forward voltage {vf} V ({colour})", f"resistors rated {RES_W} W", f"{'CMOS' if cmos else 'bipolar NE555'} output high ≈ supply − {0.1 if cmos else 1.5} V"]\r
    i_led = None\r
    if rl and led:\r
        drive = (vs - vf - 0.1) if low else (v_hi - vf)\r
        i_led = max(0.0, drive / rl)\r
        parts[P["RL"]["id"]] = {"current_a": i_led, "power_w": i_led ** 2 * rl, "avg_power_w": i_led ** 2 * rl * lit_frac, "rating_w": RES_W}\r
        parts[led["id"]] = {"current_a": i_led, "voltage_v": vf, "rating_a": LED_MAX_A}\r
        target_r = _e12_at_least(max(drive, 0.1) / LED_TARGET_A)\r
        if i_led > LED_MAX_A:\r
            warnings.append(_warn("danger" if i_led > 1.5 * LED_MAX_A else "warn", led["id"],\r
                                  f"LED current {fmt_a(i_led)} is above the {fmt_a(LED_MAX_A)} a typical LED is rated for; it will run hot and fade.",\r
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r),\r
                                   "why": f"limits the LED to about {fmt_a(drive / target_r)}"}))\r
        elif i_led < 0.002:\r
            warnings.append(_warn("info", led["id"], f"LED current is only {fmt_a(i_led)}: it will be dim." +\r
                                  (" A blue or white LED needs about 3 V just to light." if vf >= 3 else ""),\r
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r),\r
                                   "why": f"about {fmt_a(drive / target_r)} through the LED"} if target_r < rl else None))\r
        if i_led ** 2 * rl > RES_W:\r
            warnings.append(_warn("danger", P["RL"]["id"], f"The LED resistor dissipates {fmt_w(i_led ** 2 * rl)} while lit, above a {RES_W} W rating.",\r
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r), "why": "less current, less heat"}))\r
        if cmos and not low and i_led > 0.010:\r
            warnings.append(_warn("warn", ic.get("id"), f"A CMOS 555 sources only about 10 mA; {fmt_a(i_led)} will pull its output down.",\r
                                  {"component": P["RL"]["id"], "value": _e12_at_least(max(v_hi - vf, 0.1) / 0.008),\r
                                   "display": core.fmt_ohms(_e12_at_least(max(v_hi - vf, 0.1) / 0.008)), "why": "keeps the output under 10 mA"}))\r
        elif i_led > 0.2:\r
            warnings.append(_warn("danger", ic.get("id"), f"{fmt_a(i_led)} is above the 555's 200 mA output limit.", None))\r
    elif led and not P["RL"].get("id"):\r
        warnings.append(_warn("warn", led["id"], "No LED resistor was seen. Without one the LED current is limited only by the 555 output; "\r
                                                "check the back of the board before powering it.", None))\r
    # RA sees the full supply when pin 7 discharges\r
    p_ra_peak = vs ** 2 / ra\r
    p_ra_avg = p_ra_peak * (1 - duty)\r
    parts[P["RA"]["id"]] = {"current_a": vs / ra, "power_w": p_ra_peak, "avg_power_w": p_ra_avg, "rating_w": RES_W}\r
    parts[P["RB"]["id"]] = {"current_a": vs / (ra + rb), "power_w": (vs / (ra + rb)) ** 2 * rb, "rating_w": RES_W}\r
    if p_ra_avg > RES_W / 2:\r
        ra_fix = _e12_at_least(vs ** 2 / (RES_W / 2))\r
        warnings.append(_warn("danger" if p_ra_avg > RES_W else "warn", P["RA"]["id"],\r
                              f"RA averages {fmt_w(p_ra_avg)} (pin 7 shorts it to ground every cycle), more than half its {RES_W} W rating.",\r
                              {"component": P["RA"]["id"], "value": ra_fix, "display": core.fmt_ohms(ra_fix),\r
                               "why": "cuts the discharge current; the blink rate changes a little"}))\r
    if ra < 1000:\r
        warnings.append(_warn("info", P["RA"]["id"], f"RA is {core.fmt_ohms(ra)}: pin 7 sinks {fmt_a(vs / ra)} at every discharge. Most designs keep RA at 1 kΩ or more.", None))\r
    rating = _cap_rating(by.get(P["C"].get("id") or ""))\r
    if rating:\r
        parts[P["C"]["id"]] = {"voltage_v": 2 * vs / 3, "rating_v": rating}\r
        if rating < vs:\r
            warnings.append(_warn("danger", P["C"]["id"], f"The capacitor is rated {rating:g} V on a {vs:g} V circuit.", None))\r
        elif rating < 1.25 * vs:\r
            warnings.append(_warn("info", P["C"]["id"], f"The capacitor's {rating:g} V rating leaves little margin on {vs:g} V; 1.5× or more is usual.", None))\r
    if f > 25:\r
        warnings.append(_warn("info", None, f"At {f:.1f} Hz the LED blinks faster than the eye can follow; it will look steadily lit.", None))\r
    i_q = 0.0001 if cmos else 0.003 + 0.0003 * vs\r
    i_avg = i_q + (i_led or 0) * lit_frac + (vs / ra) * (1 - duty) * 0.5\r
    readings = [{"label": "Blink rate", "value": f"{f:.3f} Hz", "note": f"period {T:.3f} s"},\r
                {"label": "LED on", "value": f"{lit_frac * 100:.0f} %", "note": f"{(t_lo if low else t_hi):.3f} s per cycle"},\r
                {"label": "LED current", "value": fmt_a(i_led) if i_led is not None else "—", "note": "while lit"},\r
                {"label": "Supply current", "value": fmt_a(i_avg), "note": "average, estimate"}]\r
    bat = _battery(vs, i_avg)\r
    if bat:\r
        readings.append(bat)\r
    measured = ((st.get("video") or {}).get("regions") or [{}])[0].get("analysis", {}).get("frequency_hz")\r
    if measured:\r
        readings.insert(1, {"label": "Video measured", "value": f"{measured:.3f} Hz",\r
                            "note": f"{abs(f - measured) / measured * 100:.1f} % from the simulation"})\r
    return {"available": True, "pattern": "astable555", "formula": "f = 1 / (0.693·(RA + 2·RB)·C)",\r
            "signals": [{"name": "Capacitor (pins 2, 6)", "unit": "V", "color": "#3b57d9", "points": cap_pts},\r
                        {"name": "Output (pin 3)", "unit": "V", "color": "#6b2a2e", "points": out_pts}],\r
            "readings": readings, "parts": parts, "warnings": warnings, "assumptions": assumptions,\r
            "frequency_hz": f, "duty": duty}\r
\r
\r
# ------------------------------------------------------- two-transistor flasher --\r
\r
\r
def _sim_multivibrator(st: dict, w: dict, vs: float) -> dict:\r
    by = {c["id"]: c for c in st.get("components") or []}\r
    P = w["parts"]\r
    rb1, rb2, c1, c2 = (_val(P[k], by) for k in ("RB1", "RB2", "C1", "C2"))\r
    rc1, rc2 = _val(P["RC1"], by), _val(P["RC2"], by)\r
    need = [k for k, v in (("R base1", rb1), ("R base2", rb2), ("C1", c1), ("C2", c2)) if not v]\r
    if need:\r
        return {"available": False, "reason": f"needs values for {', '.join(need)}"}\r
    t1, t2 = math.log(2) * rb2 * c1, math.log(2) * rb1 * c2      # LED1 lit while Q2 is held off, and the reverse\r
    T = t1 + t2\r
    warnings, parts, readings = [], {}, [{"label": "Blink rate", "value": f"{1 / T:.3f} Hz", "note": f"LED1 {t1:.2f} s, LED2 {t2:.2f} s"}]\r
    for rc, rb, led_key, q in ((rc1, rb1, "L1", "Q1"), (rc2, rb2, "L2", "Q2")):\r
        led = by.get(P[led_key].get("id") or "")\r
        vf, _ = _led_vf(led)\r
        if not rc:\r
            continue\r
        i_c = max(0.0, (vs - vf - 0.2) / rc)\r
        i_b = max(0.0, (vs - 0.7) / rb)\r
        rc_id = P["RC1" if q == "Q1" else "RC2"]["id"]\r
        parts[rc_id] = {"current_a": i_c, "power_w": i_c ** 2 * rc, "rating_w": RES_W}\r
        if led:\r
            parts[led["id"]] = {"current_a": i_c, "voltage_v": vf, "rating_a": LED_MAX_A}\r
        readings.append({"label": f"{led_key.replace('L', 'LED')} current", "value": fmt_a(i_c), "note": "while lit"})\r
        if i_c > LED_MAX_A:\r
            fix = _e12_at_least((vs - vf - 0.2) / LED_TARGET_A)\r
            warnings.append(_warn("warn", led["id"] if led else rc_id, f"{led_key.replace('L', 'LED')} current {fmt_a(i_c)} is above {fmt_a(LED_MAX_A)}.",\r
                                  {"component": rc_id, "value": fix, "display": core.fmt_ohms(fix), "why": "about 12 mA through the LED"}))\r
        if i_b * 100 < i_c:\r
            warnings.append(_warn("warn", P[q].get("id"), f"{q} gets {fmt_a(i_b)} of base current for {fmt_a(i_c)}: with a gain of 100 it may not switch fully on.",\r
                                  None))\r
    if vs > 6:\r
        warnings.append(_warn("info", None, f"At each switch a base is pulled to about −{vs:g} V. Small transistors' base-emitter junctions break down "\r
                                            "near −5 to −6 V, which shortens the timing; a diode in series with each base prevents it.", None))\r
    v1 = _square(t2, t1, vs, 0.2, n=240)   # Q1 collector is high while Q1 is off (LED2's phase)\r
    v2 = _square(t2, t1, 0.2, vs, n=240)\r
    return {"available": True, "pattern": "multivibrator", "formula": "T = 0.693·(R2·C1 + R1·C2)",\r
            "signals": [{"name": "Q1 collector", "unit": "V", "color": "#3b57d9", "points": v1},\r
                        {"name": "Q2 collector", "unit": "V", "color": "#6b2a2e", "points": v2}],\r
            "readings": readings, "parts": parts, "warnings": warnings,\r
            "assumptions": ["NPN transistors with a gain of at least 100", "LED forward voltage from its colour", f"resistors rated {RES_W} W"],\r
            "frequency_hz": 1 / T, "duty": t1 / T}\r
\r
\r
# ------------------------------------------------------ microcontroller output --\r
\r
\r
def _sim_mcu(st: dict, w: dict, vs: float | None) -> dict:\r
    by = {c["id"]: c for c in st.get("components") or []}\r
    P = w["parts"]\r
    mcu = by.get(P["U"].get("id") or "") or {}\r
    text = f"{mcu.get('marking') or ''} {mcu.get('evidence') or ''}"\r
    fam = "esp8266" if re.search(r"8266|nodemcu|wemos|d1 ?mini", text, re.I) else "esp32" if core.RX["esp"].search(text) else "arduino"\r
    v_logic, i_rec, i_max, chip = GPIO[fam]\r
    led = by.get(P["LED"].get("id") or "")\r
    vf, colour = _led_vf(led)\r
    r = _val(P["R"], by)\r
    warnings, parts, readings = [], {}, [{"label": "Pin high level", "value": f"{v_logic:g} V", "note": chip}]\r
    if led and r:\r
        i = max(0.0, (v_logic - vf) / r)\r
        parts[P["R"]["id"]] = {"current_a": i, "power_w": i * i * r, "rating_w": RES_W}\r
        parts[led["id"]] = {"current_a": i, "voltage_v": vf, "rating_a": LED_MAX_A}\r
        readings.append({"label": "LED / pin current", "value": fmt_a(i), "note": f"{chip} recommends ≤ {fmt_a(i_rec)} per pin"})\r
        if i > i_rec:\r
            fix = _e12_at_least(max(v_logic - vf, 0.1) / min(LED_TARGET_A, i_rec * 0.8))\r
            warnings.append(_warn("danger" if i > i_max else "warn", P["U"].get("id"), f"The pin sources {fmt_a(i)}, above the {fmt_a(i_rec)} {chip} recommends.",\r
                                  {"component": P["R"]["id"], "value": fix, "display": core.fmt_ohms(fix), "why": "keeps the pin inside its rating"}))\r
        if vf >= v_logic - 0.2:\r
            warnings.append(_warn("warn", led["id"], f"A {colour} LED needs about {vf} V; a {v_logic:g} V pin can barely light it. Use a red LED or a transistor.", None))\r
    elif led and not r:\r
        warnings.append(_warn("danger", led["id"], f"No resistor was seen: an LED straight on a {chip} pin can exceed its {fmt_a(i_max)} limit.", None))\r
    meas = ((st.get("video") or {}).get("regions") or [{}])[0].get("analysis", {})\r
    signals = []\r
    if meas.get("frequency_hz"):\r
        f, d = meas["frequency_hz"], meas.get("duty_cycle") or 0.5\r
        signals.append({"name": "Pin (from the video)", "unit": "V", "color": "#6b2a2e", "points": _square(d / f, (1 - d) / f, v_logic, 0)})\r
        readings.insert(0, {"label": "Blink rate (measured)", "value": f"{f:.3f} Hz", "note": "set by firmware"})\r
    return {"available": True, "pattern": "mcu_blinker", "formula": "I = (V_pin − V_LED) / R", "signals": signals,\r
            "supply": {"volts": v_logic, "source": f"{chip} pin logic level"},\r
            "readings": readings, "parts": parts, "warnings": warnings,\r
            "assumptions": [f"{chip} pin at {v_logic:g} V", f"LED forward voltage {vf} V ({colour})", "timing comes from firmware, not from part values"],\r
            "frequency_hz": meas.get("frequency_hz"), "duty": meas.get("duty_cycle")}\r
\r
\r
def _sim_robot(st: dict) -> dict:\r
    """Robots and motorised devices: the power budget and the motor start-up surge."""\r
    info = system.analyze(st)\r
    b = (info or {}).get("budget") or {}\r
    src = b.get("source")\r
    if not src:\r
        return {"available": False, "reason": "The battery type wasn't seen. Say it in the note (e.g. \\"2 × 18650\\", \\"4 × AA\\", \\"9 V battery\\", \\"USB\\") "\r
                                              "to simulate the start-up surge and runtime."}\r
    tr = system.start_transient(info)\r
    readings = [{"label": "Battery", "value": f"{src['volts']:g} V", "note": src["name"]},\r
                {"label": "Running current", "value": f"{b['run_a'] * 1000:.0f} mA", "note": "everything on, motors turning"},\r
                {"label": "Start-up peak", "value": f"{b['peak_a']:.2f} A", "note": "motors starting together"}]\r
    warnings = [{"level": w["level"], "part": w["part"], "text": w["text"],\r
                 "fix": {"text": w["fix"]["text"]} if w.get("fix") else None} for w in info["warnings"]]\r
    if tr:\r
        readings.append({"label": "Lowest voltage", "value": f"{tr['v_min']:.2f} V", "note": "during the surge"})\r
        drv = next((c for c in st.get("components") or [] if re.search(r"L298", c.get("marking") or "", re.I)), None)\r
        if drv and tr["v_min"] < 7.0 and src["volts"] >= 7.0:\r
            warnings.insert(0, {"level": "warn", "part": drv["id"],\r
                                "text": f"At start-up the battery dips to {tr['v_min']:.1f} V. The L298N's on-board 5 V regulator needs about 7 V in, "\r
                                        "so a controller powered from it can brown out and reset.",\r
                                "fix": {"text": "Power the controller from its own regulator (or VIN straight from the battery), and ramp motor PWM up"}})\r
        elif tr["v_min"] < 0.8 * src["volts"]:\r
            warnings.insert(0, {"level": "warn", "part": None, "text": f"The battery sags to {tr['v_min']:.1f} V when the motors start ({tr['v_min'] / src['volts'] * 100:.0f} %).",\r
                                "fix": {"text": "Use cells with a higher current rating, or soft-start the motors"}})\r
    if b.get("runtime_h"):\r
        readings.append({"label": "Runtime (estimate)", "value": f"≈ {b['runtime_h']} h", "note": f"{src['mah']} mAh, all running"})\r
    return {"available": True, "pattern": "robot_drive", "formula": "V = V_battery − I · R_internal",\r
            "signals": tr["signals"] if tr else [], "readings": readings, "parts": {}, "warnings": warnings,\r
            "assumptions": [f"battery internal resistance ≈ {src['r_int']} Ω"] + info["assumptions"],\r
            "supply": {"volts": src["volts"], "source": src["name"]}}\r
\r
\r
SIMS = {"astable555": _sim_555, "multivibrator": _sim_multivibrator, "mcu_blinker": _sim_mcu}\r
DEFAULT_SUPPLY = {"astable555": 9.0, "multivibrator": 9.0}\r
\r
\r
def simulate(st: dict, overrides: dict | None = None, supply: float | None = None) -> dict:\r
    top = ((st.get("patterns") or {}).get("top") or {})\r
    if top.get("id") == "robot_drive" or (top.get("id") not in SIMS and any(c["type"] in ("motor", "servo", "stepper") for c in st.get("components") or [])):\r
        out = _sim_robot(st)\r
        out["status"], out["what_if"] = "SIMULATED", []\r
        out["warnings"] = sorted(out.get("warnings") or [], key=lambda x: {"danger": 0, "warn": 1, "info": 2}.get(x["level"], 3))\r
        return out\r
    if top.get("id") not in SIMS:\r
        return {"available": False, "reason": f"No electrical model for {top.get('name', 'this device')} yet. The parts, check and report still apply; "\r
                                              "the Lab calculators work for any 555 or resistor."}\r
    st2, changed = apply_overrides(st, overrides)\r
    w = diagrams.wiring(st2)\r
    if not w:\r
        return {"available": False, "reason": "The wiring couldn't be worked out from the parts that were seen."}\r
    found = supply_from([st.get("note") or ""] + [b.get("note", "") for b in st.get("board") or []])\r
    vs = supply or found or DEFAULT_SUPPLY.get(top["id"])\r
    source = "you set it" if supply else "from the notes" if found else "assumed" if vs else None\r
    out = SIMS[top["id"]](st2, w, vs)\r
    out.setdefault("supply", {"volts": vs, "source": source})\r
    out["what_if"] = changed\r
    if out.get("available") and source == "assumed":\r
        out.setdefault("assumptions", []).insert(0, f"{vs:g} V supply (not seen; set it in Lab)")\r
    out["status"] = "SIMULATED"\r
    order = {"danger": 0, "warn": 1, "info": 2}\r
    out["warnings"] = sorted(out.get("warnings") or [], key=lambda x: order.get(x["level"], 3))\r
    return out\r
`,m=`"""Measurement sketches for an Arduino or ESP the user has on hand (templates, no model).\r
\r
Two jobs the photos and video can't do:\r
  frequency  time the signal that drives the LED electrically, with the same\r
             hysteresis method GENESIS uses on the video (works without a video)\r
  voltage    log a node's voltage for the Serial Plotter, e.g. a 555's timing\r
             capacitor, which should swing between 1/3 and 2/3 of the supply\r
\r
Every sketch comes with a voltage divider sized for the circuit's supply, so a\r
9 V circuit can't reach a 5 V Arduino pin or a 3.3 V ESP pin. Grounds must be shared.\r
"""\r
from __future__ import annotations\r
\r
import re\r
\r
E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]\r
BOARDS = {\r
    "arduino": {"name": "Arduino Uno / Nano", "vmax": 5.0, "target": 4.5, "pin": "A0", "adc": "analogRead(PIN) * (5.0 / 1023.0)",\r
                "pin_note": "A0", "fqbn": "Arduino AVR Boards"},\r
    "esp32": {"name": "ESP32", "vmax": 3.3, "target": 2.9, "pin": "34", "adc": "analogReadMilliVolts(PIN) / 1000.0",\r
              "pin_note": "GPIO34 (input only, ADC1)", "fqbn": "esp32 by Espressif"},\r
    "esp8266": {"name": "ESP8266 (NodeMCU / Wemos D1 mini)", "vmax": 3.2, "target": 2.9, "pin": "A0",\r
                "adc": "analogRead(PIN) * (3.2 / 1023.0)", "pin_note": "A0 (the board's own divider allows 0 to 3.2 V)",\r
                "fqbn": "esp8266 by ESP8266 Community"},\r
}\r
\r
\r
def supply_from(texts: list[str]) -> float | None:\r
    """A supply voltage mentioned in the user's note or the board notes, e.g. '9 V battery'."""\r
    for t in texts:\r
        m = re.search(r"(\\d+(?:\\.\\d+)?)\\s*-?\\s*V\\b(?!\\w)", t or "", re.I)\r
        if m and 1 <= float(m.group(1)) <= 48:\r
            return float(m.group(1))\r
    return None\r
\r
\r
def _e12_at_least(ohms: float) -> float:\r
    for dec in range(0, 7):\r
        for v in E12:\r
            if v * 10 ** dec >= ohms:\r
                return v * 10 ** dec\r
    return 10e6\r
\r
\r
def divider(supply: float, board: str) -> dict:\r
    """R1 from the signal to the pin, R2 = 10k from the pin to ground. R1 is rounded UP to E12 (safe side)."""\r
    b = BOARDS[board]\r
    top = supply * 1.1                      # 10 % headroom for a fresh battery\r
    if top <= b["target"]:\r
        return {"r1": 0, "r2": None, "ratio": 1.0, "pin_max": round(top, 2), "text": f"no divider needed below {b['target']} V; use a 1 kΩ series resistor"}\r
    r2 = 10_000.0\r
    r1 = _e12_at_least(r2 * (top / b["target"] - 1))\r
    ratio = r2 / (r1 + r2)\r
    return {"r1": r1, "r2": r2, "ratio": round(ratio, 4), "pin_max": round(top * ratio, 2),\r
            "text": f"{_fmt(r1)} from the signal to the pin, 10 kΩ from the pin to GND"}\r
\r
\r
def _fmt(r: float) -> str:\r
    return f"{r / 1000:g} kΩ" if r >= 1000 else f"{r:g} Ω"\r
\r
\r
def sketch(kind: str, board: str, supply: float | None = None, node: str = "", expect_hz: float | None = None,\r
           supply_source: str = "from your notes", timer555: bool = True) -> str:\r
    board = board if board in BOARDS else "arduino"\r
    b = BOARDS[board]\r
    known = supply is not None\r
    vs = supply or 9.0\r
    d = divider(vs, board)\r
    scale = 1 / d["ratio"]\r
    where = node or ("the pin that drives the LED" if not timer555 else\r
                     "the 555's pin 3 (or the pin that drives the LED)" if kind == "frequency" else "the 555's pins 2 and 6 (the timing capacitor)")\r
    head = f"""// GENESIS measurement sketch: {"blink-rate counter" if kind == "frequency" else "voltage logger"} for {b['name']}\r
// Generated from your investigation. Board package: {b['fqbn']}.\r
//\r
// SAFETY: the circuit's supply is {"%g V (%s)" % (vs, supply_source) if known else "UNKNOWN: assumed 9 V. Measure it first and regenerate"}.\r
// Never connect more than {b['vmax']:g} V to a {b['name']} pin.\r
// Wiring:\r
//   {where}  ->  R1 = {_fmt(d['r1']) if d['r1'] else '1 kΩ series resistor'}  ->  {b['pin_note']}\r
//   {b['pin_note']}  ->  R2 = {_fmt(d['r2']) if d['r2'] else '(none)'}  ->  GND\r
//   circuit GND  ->  {b['name']} GND   (shared ground is required)\r
// With this divider the pin sees at most about {d['pin_max']:g} V.\r
// Open the Serial Monitor (or Serial Plotter) at 115200 baud.\r
"""\r
    pin = b["pin"] if board != "esp32" else "34"\r
    common = f"""\r
const int PIN = {pin};\r
const float DIVIDER = {scale:.4f};   // volts at the circuit = volts at the pin x DIVIDER\r
\r
float readVolts() {{ return {b['adc']} * DIVIDER; }}\r
"""\r
    if kind == "voltage" and not timer555:\r
        return head + common + """\r
void setup() {\r
  Serial.begin(115200);\r
  delay(500);\r
}\r
\r
void loop() {\r
  Serial.print("node_V:");\r
  Serial.println(readVolts(), 3);\r
  delay(10);   // 100 samples per second\r
}\r
"""\r
    if kind == "voltage":\r
        third = f"{vs / 3:.2f}"\r
        two = f"{2 * vs / 3:.2f}"\r
        return head + common + f"""\r
void setup() {{\r
  Serial.begin(115200);\r
  delay(500);\r
}}\r
\r
void loop() {{\r
  // Serial Plotter shows three lines: the node, and where a 555's capacitor should turn around.\r
  Serial.print("node_V:");     Serial.print(readVolts(), 3);\r
  Serial.print(" third_V:");   Serial.print({third});\r
  Serial.print(" two_thirds_V:"); Serial.println({two});\r
  delay(10);   // 100 samples per second\r
}}\r
"""\r
    expect = f"\\n// GENESIS predicts about {expect_hz:.3f} Hz for comparison." if expect_hz else ""\r
    return head + expect + common + f"""\r
// Samples every millisecond and finds edges with hysteresis (10 % of the swing),\r
// the same way GENESIS times the LED in a video, then reports every 5 seconds.\r
const unsigned long WINDOW_MS = 5000;\r
float lo = 1e9, hi = -1e9;\r
bool high = false, primed = false;\r
unsigned long lastRise = 0, riseCount = 0, periodSum = 0, highSum = 0, riseAt = 0;\r
unsigned long windowStart = 0;\r
\r
void setup() {{\r
  Serial.begin(115200);\r
  delay(500);\r
  Serial.println("GENESIS blink-rate counter: learning the signal levels...");\r
  windowStart = millis();\r
}}\r
\r
void loop() {{\r
  static unsigned long nextSample = 0;\r
  unsigned long now = millis();\r
  if (now < nextSample) return;\r
  nextSample = now + 1;\r
  float v = readVolts();\r
  lo = min(lo, v); hi = max(hi, v);\r
  float span = hi - lo, mid = (hi + lo) / 2, hyst = 0.1 * span;\r
  if (span > 0.5) {{\r
    if (!high && v > mid + hyst) {{\r
      high = true;\r
      if (primed) {{ periodSum += now - lastRise; riseCount++; }}\r
      lastRise = now; riseAt = now; primed = true;\r
    }} else if (high && v < mid - hyst) {{\r
      high = false;\r
      highSum += now - riseAt;\r
    }}\r
  }}\r
  if (now - windowStart >= WINDOW_MS) {{\r
    if (riseCount == 0) {{\r
      Serial.print("no full cycle yet (swing "); Serial.print(span, 2); Serial.println(" V): check the wiring and the shared ground");\r
    }} else {{\r
      float period = periodSum / 1000.0 / riseCount;\r
      Serial.print("frequency_hz="); Serial.print(1.0 / period, 4);\r
      Serial.print(" period_s=");    Serial.print(period, 4);\r
      Serial.print(" duty=");        Serial.print((highSum / 1000.0) / (period * riseCount), 3);\r
      Serial.print(" cycles=");      Serial.print(riseCount);\r
      Serial.print(" swing_V=");     Serial.println(span, 2);\r
    }}\r
    periodSum = highSum = riseCount = 0;\r
    windowStart = now;\r
  }}\r
}}\r
"""\r
`,h=`"""A device as layers: power, control, sensing, drive, communication, interface (code, no model).

A robot or a whole appliance is not one circuit. Most of what goes wrong lives
between the layers: motors starting together drag the battery down and reset the
controller, a driver channel can't carry a stalled motor, a 9 V smoke-alarm
battery can't run motors at all, an L298N throws away 2 V. This module sorts the
observed parts into layers, sketches how power and signals flow between them,
estimates a power budget from typical figures, simulates the motor start-up
surge, and raises system-level warnings with fixes.

Every current here is a typical figure for that kind of part, not a measurement;
each one is listed as an assumption.
"""
from __future__ import annotations

import math
import re

from . import core

LAYERS = [
    ("power", "Power", "batteries, regulators, chargers and protection"),
    ("control", "Control", "the controller: microcontroller, dev board or timer IC"),
    ("sensing", "Sensing", "sensors and inputs that tell it about the world"),
    ("drive", "Drive & motors", "motor drivers, motors, servos and relays"),
    ("comms", "Communication", "wireless and USB links"),
    ("interface", "Interface", "LEDs, buttons, displays and sound"),
    ("support", "Support", "resistors, capacitors and other support parts"),
]
LAYER_NAME = {k: n for k, n, _ in LAYERS}

# typical currents: (running A, peak or stall A, assumption text)
MOTORS = [
    (r"\\bTT\\b|yellow.*gear|gear ?motor|dagu", 0.20, 1.5, "TT gear motor: ~0.2 A running, ~1.5 A stalled at 6 V"),
    (r"\\bN20\\b|micro gear", 0.10, 0.6, "N20 micro gear motor: ~0.1 A running, ~0.6 A stalled"),
    (r"\\b130\\b|hobby motor|toy motor", 0.30, 2.0, "130-size motor: ~0.3 A running, ~2 A stalled"),
    (r"brushless|bldc|esc", 2.0, 10.0, "brushless motor: several amps; check its ESC rating"),
    (r"fan", 0.15, 0.3, "small fan: ~0.15 A"),
    (r"", 0.30, 1.5, "unknown DC motor: assumed ~0.3 A running, ~1.5 A stalled"),
]
SERVOS = [(r"SG90|9 ?g|micro servo|MG90", 0.15, 0.7, "SG90 micro servo: ~0.15 A moving, ~0.7 A stalled"),
          (r"MG99[56]|MG995|DS3218|standard servo", 0.5, 2.5, "MG996R servo: ~0.5 A moving, ~2.5 A stalled"),
          (r"", 0.25, 1.0, "servo: assumed ~0.25 A moving, ~1 A stalled")]
STEPPERS = [(r"28BYJ", 0.25, 0.30, "28BYJ-48 stepper: ~0.25 A"), (r"NEMA|17HS|42", 1.2, 1.7, "NEMA 17 stepper: ~1.2–1.7 A per phase"),
            (r"", 0.5, 0.8, "stepper: assumed ~0.5 A")]
CONTROLLERS = [(r"ESP32", 0.08, 0.25, "ESP32: ~80 mA, ~250 mA Wi-Fi peaks"), (r"8266|NODEMCU|WEMOS|D1 ?MINI", 0.08, 0.17, "ESP8266: ~80 mA, ~170 mA peaks"),
               (r"UNO|MEGA|ATMEGA2560", 0.05, 0.06, "Arduino Uno: ~50 mA"), (r"NANO|PRO ?MINI|ATMEGA328|LEONARDO|32U4", 0.025, 0.03, "Arduino Nano: ~25 mA"),
               (r"RP2040|PICO", 0.03, 0.05, "Raspberry Pi Pico: ~30 mA"), (r"555", 0.006, 0.01, "555 timer: ~6 mA"), (r"", 0.05, 0.1, "controller: assumed ~50 mA")]
# per-channel continuous / peak current and voltage drop of common drivers
DRIVERS = [(r"L298", 2.0, 3.0, 2.0, "L298N"), (r"L293", 0.6, 1.2, 1.4, "L293D"), (r"TB6612", 1.2, 3.2, 0.5, "TB6612FNG"),
           (r"DRV8833", 1.5, 2.0, 0.4, "DRV8833"), (r"DRV8825", 1.5, 2.2, 0.3, "DRV8825"), (r"A4988", 1.0, 2.0, 0.4, "A4988"),
           (r"L9110|HG7881", 0.8, 1.5, 0.8, "L9110S"), (r"MX1508", 1.5, 2.5, 0.4, "MX1508"), (r"ULN200", 0.5, 0.5, 1.0, "ULN2003"),
           (r"BTS7960|IBT", 43.0, 43.0, 0.1, "BTS7960")]
BATTERIES = [  # pattern, volts, mAh, max A, name, internal resistance ohm
    (r"(2|two) ?x? ?18650|2s|7\\.4 ?v", 7.4, 2500, 5.0, "2 × 18650 Li-ion (7.4 V)", 0.15),
    (r"(3|three) ?x? ?18650|3s|11\\.1 ?v", 11.1, 2500, 5.0, "3 × 18650 Li-ion (11.1 V)", 0.2),
    (r"18650|li-?ion cell|3\\.7 ?v", 3.7, 2500, 5.0, "18650 Li-ion cell (3.7 V)", 0.08),
    (r"lipo", 7.4, 1000, 20.0, "2S LiPo (7.4 V)", 0.05),
    (r"(4|four) ?x? ?aa\\b|6 ?v", 6.0, 2000, 1.0, "4 × AA alkaline (6 V)", 0.6),
    (r"(6|six) ?x? ?aa\\b|9 ?v pack", 9.0, 2000, 1.0, "6 × AA alkaline (9 V)", 0.9),
    (r"pp3|9 ?v", 9.0, 500, 0.3, "9 V PP3 battery", 2.0),
    (r"usb|5 ?v", 5.0, 0, 1.0, "USB 5 V (≈1 A from a charger, 0.5 A from a computer port)", 0.3),
]


def _text(c: dict) -> str:
    return f"{c.get('marking') or ''} {c.get('evidence') or ''} {c.get('value_printed') or ''}"


def _pick(table, text):
    return next(row for row in table if re.search(row[0], text, re.I))


def layer_of(c: dict) -> str:
    t, m = c["type"], c.get("marking") or ""
    if t in ("battery", "fuse", "voltage_regulator", "transformer") or (t == "ic" and any(core.RX[k].search(m) for k in ("reg", "buck", "boost", "charger", "smps"))):
        return "power"
    if t == "inductor":
        return "power"
    if t in ("motor", "servo", "stepper", "relay") or (t == "ic" and core.RX["mdrv"].search(m)):
        return "drive"
    if t in ("dev_board", "crystal") or (t == "ic" and (core.RX["mcu"].search(m) or core.RX["t555"].search(m))):
        return "control"
    if t in ("sensor_module", "ldr", "microphone") or core.RX["sensor"].search(m):
        return "sensing"
    if t == "antenna" or core.RX["wireless"].search(m) or core.RX["usbserial"].search(m):
        return "comms"
    if t in ("led", "display", "buzzer", "speaker", "button", "switch", "potentiometer") or core.RX["audio"].search(m):
        return "interface"
    if t == "ic":
        return "control"
    return "support"


def analyze(st: dict) -> dict | None:
    comps = st.get("components") or []
    if not comps:
        return None
    layers = {k: [] for k, _, _ in LAYERS}
    for c in comps:
        layers[layer_of(c)].append({"id": c["id"], "type": c["type"], "label": c.get("display") or c.get("marking") or c["type"].replace("_", " "),
                                    "status": c.get("status", "OBSERVED")})
    present = [k for k, _, _ in LAYERS if layers[k] and k != "support"]
    flows = []
    if layers["power"] or any(c["type"] == "battery" for c in comps):
        flows += [{"from": "power", "to": k, "label": "power"} for k in present if k != "power"]
    if layers["control"]:
        if layers["drive"]:
            flows.append({"from": "control", "to": "drive", "label": "direction / PWM signals"})
        if layers["sensing"]:
            flows.append({"from": "sensing", "to": "control", "label": "readings"})
        if layers["comms"]:
            flows.append({"from": "comms", "to": "control", "label": "data"})
        if layers["interface"]:
            flows.append({"from": "control", "to": "interface", "label": "status / UI"})
    if layers["drive"] and layers["power"]:
        flows.append({"from": "power", "to": "drive", "label": "motor current (the big one)"})

    # ---- power budget
    # the battery's own marking wins, then the user's note, then board notes ("...next to the 18650 holder")
    texts = [" ".join(_text(c) for c in comps if c["type"] == "battery"), st.get("note") or "", " ".join(b.get("note", "") for b in st.get("board") or [])]
    bat = next((b for t in texts if t for b in BATTERIES if re.search(b[0], t, re.I)), None)
    source = {"name": bat[4], "volts": bat[1], "mah": bat[2], "max_a": bat[3], "r_int": bat[5]} if bat else None
    loads, assumptions = [], []
    for c in comps:
        text = _text(c)
        row = None
        if c["type"] == "motor":
            row = _pick(MOTORS, text)
        elif c["type"] == "servo":
            row = _pick(SERVOS, text)
        elif c["type"] == "stepper":
            row = _pick(STEPPERS, text)
        elif c["type"] == "dev_board" or (c["type"] == "ic" and (core.RX["mcu"].search(c.get("marking") or "") or core.RX["t555"].search(c.get("marking") or ""))):
            row = _pick(CONTROLLERS, text)
        elif c["type"] == "sensor_module" or core.RX["sensor"].search(c.get("marking") or ""):
            row = (None, 0.015, 0.02, "sensor module: ~15 mA")
        elif c["type"] == "led":
            row = (None, 0.012, 0.015, "LED: ~12 mA when lit")
        elif c["type"] == "display":
            row = (None, 0.03, 0.04, "small display: ~30 mA")
        elif c["type"] == "relay":
            row = (None, 0.07, 0.08, "relay coil: ~70 mA")
        elif c["type"] in ("buzzer", "speaker"):
            row = (None, 0.03, 0.3, "buzzer / small speaker: ~30 mA, more when loud")
        if row:
            loads.append({"id": c["id"], "type": c["type"], "run_a": row[1], "peak_a": row[2], "basis": row[3], "layer": layer_of(c)})
            if row[3] not in assumptions:
                assumptions.append(row[3])
    run = sum(l["run_a"] for l in loads)
    moving = [l for l in loads if l["type"] in ("motor", "servo", "stepper")]
    peak = sum(l["peak_a"] for l in moving) + sum(l["run_a"] for l in loads if l not in moving)
    budget = {"source": source, "loads": loads, "run_a": round(run, 3), "peak_a": round(peak, 3)}
    if source and source["mah"] and run:
        budget["runtime_h"] = round(source["mah"] / 1000 / run * 0.8, 1)       # 80 %: what is usable before the voltage sags
        assumptions.append(f"runtime uses 80 % of {source['mah']} mAh")

    # ---- warnings
    warnings = []
    drv_c = next((c for c in comps if core.RX["mdrv"].search(c.get("marking") or "")), None)
    drv = _pick(DRIVERS, drv_c.get("marking")) if drv_c and any(re.search(d[0], drv_c.get("marking") or "", re.I) for d in DRIVERS) else None
    if moving and source:
        if source["max_a"] < 0.5 and source["name"].startswith("9 V"):
            warnings.append({"level": "danger", "part": None, "text": f"A 9 V PP3 battery can deliver only ~{source['max_a']} A; {len(moving)} motor(s) need about {peak:.1f} A at start-up. "
                             "The voltage will collapse and the controller will reset.",
                             "fix": {"text": "Use 2 × 18650 Li-ion cells (7.4 V) or 6 × AA for the motors"}})
        elif peak > source["max_a"]:
            warnings.append({"level": "warn", "part": None, "text": f"Motors starting together can draw ~{peak:.1f} A, more than the {source['name']} delivers comfortably (~{source['max_a']} A).",
                             "fix": {"text": "Start motors one after the other (ramp the PWM), or use a battery rated for more current"}})
    if drv and moving:
        worst = max(l["peak_a"] for l in moving if l["type"] != "servo") if any(l["type"] != "servo" for l in moving) else 0
        if worst > drv[2]:
            warnings.append({"level": "warn", "part": drv_c["id"], "text": f"{drv[4]} channels handle ~{drv[1]} A ({drv[2]} A peak); a stalled motor here can pull ~{worst:.1f} A.",
                             "fix": {"text": "Use a driver rated for the stall current (e.g. a BTS7960 for big motors) or add current limiting"}})
        if source and drv[3] >= 1.0:
            v_motor = source["volts"] - drv[3]
            warnings.append({"level": "warn" if v_motor < 5 else "info", "part": drv_c["id"],
                             "text": f"The {drv[4]} loses about {drv[3]:g} V, so the motors get ~{v_motor:.1f} V from the {source['volts']:g} V battery."
                                     + (" TT motors are sluggish below ~5 V." if v_motor < 5 else ""),
                             "fix": {"text": "A MOSFET driver such as the TB6612FNG or DRV8833 loses only ~0.5 V"}})
    big_caps = [c for c in comps if c["type"] == "capacitor_electrolytic" and ((c.get("value") or {}).get("value") or 0) >= 100e-6]
    if moving and layers["control"] and not big_caps:
        warnings.append({"level": "info", "part": None, "text": "No large capacitor was seen near the motors. Motor switching spikes travel along the supply and can reset the controller.",
                         "fix": {"text": "Add 100–470 µF across the motor supply at the driver, and 100 nF across each motor's terminals"}})
    bare = moving and not drv and (any(c["type"] in ("transistor", "mosfet") for c in comps))
    if bare and not any(c["type"] == "diode" for c in comps):
        warnings.append({"level": "warn", "part": None, "text": "Motors switched by a transistor with no diode seen: the motor's turn-off spike can kill the transistor.",
                         "fix": {"text": "Put a flyback diode (1N4007 or a Schottky) across each motor, cathode to the positive side"}})
    ctrl = next((c for c in comps if c["type"] == "dev_board" or core.RX["mcu"].search(c.get("marking") or "")), None)
    if ctrl and core.RX["esp"].search(_text(ctrl)) and (drv or any(c["type"] == "relay" for c in comps) or any(core.RX["sensor"].search(c.get("marking") or "") and "SR04" in (c.get("marking") or "").upper() for c in comps)):
        warnings.append({"level": "info", "part": ctrl["id"], "text": "The ESP runs at 3.3 V and its pins are not 5 V tolerant. Most driver inputs accept 3.3 V, but a 5 V sensor output (such as the HC-SR04 echo) needs a divider.",
                         "fix": {"text": "Echo → 1 kΩ → GPIO, GPIO → 2 kΩ → GND (5 V becomes 3.3 V)"}})
    if moving and len(present) >= 3:
        warnings.append({"level": "info", "part": None, "text": "Every layer must share one ground: battery −, driver GND, controller GND and sensor GND joined together.", "fix": None})
    order = {"danger": 0, "warn": 1, "info": 2}
    warnings.sort(key=lambda w: order[w["level"]])

    return {"layers": [{"key": k, "name": n, "desc": d, "parts": layers[k]} for k, n, d in LAYERS if layers[k]],
            "present": present, "flows": flows, "budget": budget, "warnings": warnings, "assumptions": assumptions,
            "is_system": bool(moving) or len(present) >= 3}


def start_transient(sysinfo: dict) -> dict | None:
    """Battery current and voltage as the motors start: stall current that decays to running current
    (a time constant of ~0.15 s for small geared motors), through the battery's internal resistance."""
    b = (sysinfo or {}).get("budget") or {}
    src = b.get("source")
    moving = [l for l in b.get("loads", []) if l["type"] in ("motor", "servo", "stepper")]
    if not src or not moving:
        return None
    other = sum(l["run_a"] for l in b["loads"] if l not in moving)
    tau = 0.15
    cur, volt = [], []
    for i in range(201):
        t = i * 0.005 - 0.1
        i_m = 0.0 if t < 0 else sum(l["run_a"] + (l["peak_a"] - l["run_a"]) * math.exp(-t / tau) for l in moving)
        i_tot = other + i_m
        cur.append([round(t + 0.1, 4), round(i_tot, 3)])
        volt.append([round(t + 0.1, 4), round(max(0.0, src["volts"] - i_tot * src["r_int"]), 3)])
    v_min = min(v for _, v in volt)
    return {"signals": [{"name": "Battery current (A)", "unit": "A", "color": "#6b2a2e", "points": cur},
                        {"name": "Battery voltage (V)", "unit": "V", "color": "#3b57d9", "points": volt}],
            "v_min": v_min, "i_peak": max(i for _, i in cur)}
`,g=`modulepreload`,_=function(e,t){return new URL(e,t).href},v={},y=function(e){return e.pathname.endsWith(`.css`)},b=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=_(t,n);let r=s(t);if(r.href in v)return;v[r.href]=!0;let i=y(r);if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let o=document.createElement(`link`);if(o.rel=i?`stylesheet`:g,i||(o.as=`script`),o.crossOrigin=``,o.href=r.href,a&&o.setAttribute(`nonce`,a),document.head.appendChild(o),i)return new Promise((e,t)=>{o.addEventListener(`load`,e),o.addEventListener(`error`,()=>t(Error(`Unable to preload CSS for ${r}`)))})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},x=`./`,S=window.fetch.bind(window),C=Object.assign({"../../genesis_see/__init__.py":u,"../../genesis_see/core.py":d,"../../genesis_see/diagrams.py":f,"../../genesis_see/simulate.py":p,"../../genesis_see/sketches.py":m,"../../genesis_see/system.py":h}),w=`https://cdn.jsdelivr.net/pyodide/v0.27.2/full/`,T=null;function E(){return T||=(async()=>{window.dispatchEvent(new CustomEvent(`genesis-toast`,{detail:`Loading the Python simulator into your browser (first time only)…`}));let{loadPyodide:e}=await b(async()=>{let{loadPyodide:e}=await import(`${w}pyodide.mjs`);return{loadPyodide:e}},[],import.meta.url),t=await e({indexURL:w});await t.loadPackage(`numpy`),t.FS.mkdirTree(`/genesis/genesis_see`);for(let[e,n]of Object.entries(C))t.FS.writeFile(`/genesis/genesis_see/${e.split(`/`).pop()}`,n);return t.runPython(`import sys, json; sys.path.insert(0, '/genesis'); from genesis_see import simulate`),t})().catch(e=>{throw T=null,e})}async function D(e,t,n){let r=await E().catch(()=>E());return r.globals.set(`ARGS`,JSON.stringify({state:e,overrides:t,supply:n})),JSON.parse(r.runPython(`a = json.loads(ARGS); json.dumps(simulate.simulate(a['state'], a['overrides'], a['supply']), default=str)`))}var O=`This online demo replays the recorded sample boards. To investigate your own device, run GENESIS on your computer (see the README on GitHub) with a free Gemini key.`,k=null,A={},j=async()=>k||=await(await S(`${x}demo/index.json`)).json(),M=async e=>A[e]||=await(await S(`${x}demo/${e}.json`)).json(),N=(e,t=200)=>new Response(JSON.stringify(e),{status:t,headers:{"Content-Type":`application/json`}}),ee=null,te=class{constructor(e){this.onmessage=null,this.closed=!1,this.n=0,ee=this,M(e).then(e=>this.play(e.events))}emit(e){this.closed||this.onmessage?.({data:JSON.stringify({...e,id:this.n++,ts:Date.now()/1e3})})}async play(e){let t={call:450,result:650,say:500,state:120};for(let n of e){if(this.closed)return;await new Promise(e=>setTimeout(e,t[n.type]||60)),this.emit(n)}}close(){this.closed=!0,ee===this&&(ee=null)}},ne=e=>new te(e),re=[1,1.5,2.2,3.3,4.7,6.8],ie=[1,1.2,1.5,1.8,2.2,2.7,3.3,3.9,4.7,5.6,6.8,8.2],ae=[1,1.1,1.2,1.3,1.5,1.6,1.8,2,2.2,2.4,2.7,3,3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.2,6.8,7.5,8.2,9.1],oe={k:1e3,K:1e3,M:1e6},P={black:0,brown:1,red:2,orange:3,yellow:4,green:5,blue:6,violet:7,grey:8,gray:8,white:9},se={...Object.fromEntries(Object.entries(P).map(([e,t])=>[e,10**t])),gold:.1,silver:.01},ce={brown:1,red:2,green:.5,blue:.25,violet:.1,grey:.05,gray:.05,gold:5,silver:10},le={red:1.9,orange:2,yellow:2,green:2.1,blue:3,white:3},ue=e=>String(+e.toPrecision(4)),de=(e,t)=>+e.toFixed(t),fe=e=>e>=1e6?`${ue(e/1e6)} MΩ`:e>=1e3?`${ue(e/1e3)} kΩ`:`${ue(e)} Ω`,pe=e=>e>=1e-6?`${ue(e/1e-6)} µF`:e>=1e-9?`${ue(e/1e-9)} nF`:`${ue(e/1e-12)} pF`,me=e=>{throw Error(e)};function he(e){if(e==null)return null;let t=String(e).replace(/\s+/g,``).replace(/ohms?|Ω|ω/gi,``),n=t.match(/^(\d+)([RrkKM])(\d+)$/);if(n)return parseFloat(`${n[1]}.${n[3]}`)*(/[Rr]/.test(n[2])?1:oe[n[2]]);if(n=t.match(/^(\d+(?:\.\d+)?)([kKM]?)[Rr]?$/),!n)return null;let r=n[1];if(!n[2]&&/^\d{3,4}$/.test(r)&&!/[Rr]$/.test(t)){let e=+r.slice(0,-1),t=+r.slice(-1);if(r.length===3&&t<=6&&r[2]!==`0`||r.length===4&&t>0&&t<=6)return e*10**t}return parseFloat(r)*(n[2]?oe[n[2]]:1)}var ge=e=>e?e===`M`?1e-6:{p:1e-12,n:1e-9,u:1e-6,µ:1e-6,μ:1e-6,m:.001}[e.toLowerCase()]??null:1;function _e(e){if(e==null)return null;let t=String(e).replace(/\s+/g,``),n=t.match(/(\d+(?:\.\d+)?)([pnuµμmM]?)F/i);return n&&ge(n[2])!=null||(n=t.match(/^(\d+(?:\.\d+)?)([pnuµμ])$/i),n)?parseFloat(n[1])*ge(n[2]):(n=t.match(/^(\d)([pnuµμ])(\d)$/i),n?parseFloat(`${n[1]}.${n[3]}`)*ge(n[2]):(n=t.match(/^(\d{3})[JKMjkm]?$/),n?+n[1].slice(0,2)*10**n[1][2]*1e-12:null))}function ve(e,t){if(!e||e<=0)return null;let n=10**Math.floor(Math.log10(e)),r=null;for(let i of[n/10,n,n*10])for(let n of t){let t=n*i,a=Math.abs(t-e)/e;(!r||a<r[1])&&(r=[t,a])}return{value:+r[0].toPrecision(6),rel_err:de(r[1],4)}}function ye(e){for(let t=0;t<7;t++)for(let n of ie)if(n*10**t>=e)return+(n*10**t).toPrecision(6);return 1e7}function be(e){let t,n,r=20;if(e.length===3)[t,n]=[e.slice(0,2),e[2]];else if(e.length===4)[t,n,r]=[e.slice(0,2),e[2],ce[e[3]]];else if(e.length===5||e.length===6)[t,n,r]=[e.slice(0,3),e[3],ce[e[4]]];else return null;return t.some(e=>!(e in P))||!(n in se)||r==null?null:{ohms:+(t.reduce((e,t)=>e*10+P[t],0)*se[n]).toPrecision(6),tolerance_pct:r}}function xe(e){if(!e||e.length<3)return null;let t=e.map(e=>String(e).toLowerCase().trim()),n=[[be(t),!1],[be([...t].reverse()),!0]].filter(e=>e[0]);if(!n.length)return null;let r=([e,n])=>([`gold`,`silver`].includes(n?t[0]:t[t.length-1])?2:0)+ +(ve(e.ohms,ae).rel_err<.001);n.sort((e,t)=>r(t)-r(e));let[i,a]=n;return{value:i[0].ohms,tolerance_pct:i[0].tolerance_pct,reversed:i[1],ambiguous:!!a&&r(i)===r(a)&&i[0].ohms!==a[0].ohms,alternative:a?a[0].ohms:null}}var Se=(e,t)=>{let n=parseFloat(String(e).trim().replace(`,`,`.`));return isFinite(n)||me(`${t} must be a number`),n},F=(e,t)=>he(e)||me(`${t}: can't read '${e}' as a resistance (try 470, 4k7, 1M)`),Ce=(e,t)=>_e(e)||me(`${t}: can't read '${e}' as a capacitance (try 100uF, 104, 47n)`),we=e=>e==null||e===``,Te=[[/\bTT\b|yellow.*gear|gear ?motor|dagu/i,.2,1.5,`TT gear motor: ~0.2 A running, ~1.5 A stalled at 6 V`],[/\bN20\b|micro gear/i,.1,.6,`N20 micro gear motor: ~0.1 A running, ~0.6 A stalled`],[/\b130\b|hobby motor|toy motor/i,.3,2,`130-size motor: ~0.3 A running, ~2 A stalled`],[/brushless|bldc|esc/i,2,10,`brushless motor: several amps; check its ESC rating`],[/fan/i,.15,.3,`small fan: ~0.15 A`],[/(?:)/,.3,1.5,`unknown DC motor: assumed ~0.3 A running, ~1.5 A stalled`]],I=[[/SG90|9 ?g|micro servo|MG90/i,.15,.7,`SG90 micro servo: ~0.15 A moving, ~0.7 A stalled`],[/MG99[56]|MG995|DS3218|standard servo/i,.5,2.5,`MG996R servo: ~0.5 A moving, ~2.5 A stalled`],[/(?:)/,.25,1,`servo: assumed ~0.25 A moving, ~1 A stalled`]],Ee=[[/28BYJ/i,.25,.3,`28BYJ-48 stepper: ~0.25 A`],[/NEMA|17HS|42/i,1.2,1.7,`NEMA 17 stepper: ~1.2–1.7 A per phase`],[/(?:)/,.5,.8,`stepper: assumed ~0.5 A`]],L=[[/L298/i,2,3,2,`L298N`],[/L293/i,.6,1.2,1.4,`L293D`],[/TB6612/i,1.2,3.2,.5,`TB6612FNG`],[/DRV8833/i,1.5,2,.4,`DRV8833`],[/DRV8825/i,1.5,2.2,.3,`DRV8825`],[/A4988/i,1,2,.4,`A4988`],[/L9110|HG7881/i,.8,1.5,.8,`L9110S`],[/MX1508/i,1.5,2.5,.4,`MX1508`],[/ULN200/i,.5,.5,1,`ULN2003`],[/BTS7960|IBT/i,43,43,.1,`BTS7960`]],R=[[/(2|two) ?x? ?18650|2s|7\.4 ?v/i,7.4,2500,5,`2 × 18650 Li-ion (7.4 V)`],[/(3|three) ?x? ?18650|3s|11\.1 ?v/i,11.1,2500,5,`3 × 18650 Li-ion (11.1 V)`],[/18650|li-?ion cell|3\.7 ?v/i,3.7,2500,5,`18650 Li-ion cell (3.7 V)`],[/lipo/i,7.4,1e3,20,`2S LiPo (7.4 V)`],[/(4|four) ?x? ?aa\b|6 ?v/i,6,2e3,1,`4 × AA alkaline (6 V)`],[/(6|six) ?x? ?aa\b|9 ?v pack/i,9,2e3,1,`6 × AA alkaline (9 V)`],[/pp3|9 ?v/i,9,500,.3,`9 V PP3 battery`],[/usb|5 ?v/i,5,0,1,`USB 5 V (≈1 A from a charger, 0.5 A from a computer port)`]],De={bands:e=>{let t=xe(e.bands||[]);return t?{...t,display:fe(t.value)}:{error:`not a valid colour code`}},555:e=>{let t=+e.ra,n=+e.rb,r=+e.c,i=1.44/((t+2*n)*r);return{frequency_hz:i,period_s:1/i,high_fraction:(t+n)/(t+2*n),nearest_c:ve(r,re)}},parse:e=>{let t=e.kind!==`capacitor`,n=t?he(e.text):_e(e.text);return{value:n,display:n?t?fe(n):pe(n):null}},led:({supply_v:e,led:t=`red`,current_ma:n=12})=>{let r=Se(e,`supply`),i=Se(n,`current`)/1e3,a=le[String(t).toLowerCase()]||Se(t,`LED forward voltage`);r<=a&&me(`A ${r} V supply can't light an LED that needs ${a} V`);let o=(r-a)/i,s=ye(o),c=(r-a)/s,l=c**2*s;return{resistor:fe(s),exact:fe(o),current_ma:de(c*1e3,1),power_mw:de(l*1e3,1),rating:l<.06?`1/8 W`:l<.12?`1/4 W`:l<.25?`1/2 W`:`1 W`,formula:`R = (V_supply − V_LED) / I`,notes:[`LED forward voltage ${a} V`,`rounded up to the next standard value, so the LED stays under the target current`]}},divider:({vin:e,r1:t,r2:n=`10k`,vout:r})=>{let i=Se(e,`input voltage`),a=F(n,`R2 (to ground)`),o;if(we(r))o=F(t,`R1 (top)`);else{let e=Se(r,`target output`);e>0&&e<i||me(`the output must be between 0 V and the input`),o=ye(a*(i/e-1))}return{r1:fe(o),r2:fe(a),vout:de(i*a/(o+a),3),current_ua:de(i/(o+a)*1e6,1),ratio:de(a/(o+a),4),formula:`Vout = Vin × R2 / (R1 + R2)`,notes:[we(r)?`the divider's own load: keep the input pin's resistance much higher than R2`:`R1 is rounded up, so the output stays at or below the target (safe for 3.3 V and 5 V pins)`]}},ohms:({v:e,i_ma:t,r:n})=>{let r={v:we(e)?null:Se(e,`voltage`),i:we(t)?null:Se(t,`current`)/1e3,r:we(n)?null:F(n,`resistance`)};Object.values(r).filter(e=>e!=null).length<2&&me(`give any two of voltage, current and resistance`),r.v==null?r.v=r.i*r.r:r.i==null?r.i=r.v/r.r:r.r??=r.v/r.i;let i=r.v*r.i;return{voltage_v:de(r.v,4),current_ma:de(r.i*1e3,3),resistance:fe(r.r),power_mw:de(i*1e3,2),formula:`V = I × R, P = V × I`,notes:i>.25?[`above 250 mW a standard 1/4 W resistor runs hot`]:[]}},rc:({r:e,c:t})=>{let n=F(e,`R`)*Ce(t,`C`);return{tau_s:n,t63_s:n,t95_s:3*n,t99_s:5*n,cutoff_hz:1/(2*Math.PI*n),formula:`τ = R × C, f_c = 1 / (2π R C)`,notes:[`a capacitor charges to 63 % in one τ and is practically full after 5 τ`]}},mono555:({r:e,c:t})=>({pulse_s:1.1*F(e,`R`)*Ce(t,`C`),formula:`t = 1.1 × R × C`,notes:[`one pulse per trigger on pin 2; R from VCC to pins 6 and 7, C from pins 6/7 to ground`]}),battery:({capacity_mah:e,current_ma:t,usable_pct:n=80})=>{let r=Se(e,`capacity`),i=Se(t,`current`);i<=0&&me(`current must be above zero`);let a=r*Se(n,`usable %`)/100/i;return{hours:de(a,2),days:de(a/24,2),formula:`t = capacity × usable fraction / current`,notes:[`assumes ${n}% of the capacity is usable before the voltage drops too far`]}},motors:({battery:e=`2x18650`,driver:t=`L298N`,motor:n=`TT`,count:r=2})=>{let i=Math.trunc(Se(r,`motor count`)),a=R.find(t=>t[0].test(e))||me(`battery: try 2x18650, 4xAA, 9V, LiPo or USB`),o=(/servo|SG90|MG99/i.test(n)?I:/stepper|NEMA|28BYJ/i.test(n)?Ee:Te).find(e=>e[0].test(n)),s=L.find(e=>e[0].test(t)),c=o[1]*i,l=o[2]*i,u=a[1]-(s?s[3]:0),d=[],f={battery:a[4],motor:o[3],running_a:de(c,2),startup_a:de(l,2),battery_max_a:a[3],motor_volts:de(u,2)},p=`OK`;return l>a[3]&&(p=`battery too weak`,d.push(`start-up needs ~${l.toFixed(1)} A; a ${a[4]} gives ~${a[3]} A`)),s&&(f.driver=s[4],o[2]>s[2]&&(p=`driver too small`,d.push(`each ${s[4]} channel peaks at ${s[2]} A; one stalled motor pulls ~${o[2]} A`)),s[3]>=1&&d.push(`the ${s[4]} drops ~${s[3]} V: motors see ~${u.toFixed(1)} V`)),a[2]&&(f.runtime_h=de(a[2]/1e3*.8/Math.max(c,.01),1)),{...f,verdict:p,notes:d.length?d:[`battery and driver can carry these motors`],formula:`start-up current ≈ motors × stall current; V_motor = V_battery − driver drop`}}};async function Oe(e,t,n){let r=await j(),i;if(t===`/api/info`)return N({...r.info,gemini_key:!1,lan_url:null,static:!0});if(t===`/api/control`)return N(r.control);if(t===`/api/usage`)return N(r.usage);if(t===`/api/investigations`&&e===`GET`)return N(r.investigations);if(i=t.match(/^\/api\/lab\/(\w+)$/)){let e=De[i[1]];if(!e)return N({error:`unknown tool`},404);try{return N(e(Object.fromEntries(Object.entries(n||{}).filter(([,e])=>!we(e)))))}catch(e){return N({error:e.message},400)}}if(i=t.match(/^\/api\/investigations\/(\w+)(?:\/(\w+))?/)){let[,t,r]=i;if(e===`DELETE`)return N({error:`The sample runs can't be deleted in the online demo.`},409);if(r===`evidence`)return N((await M(t)).evidence);if(r===`ask`){let e=ee;return setTimeout(()=>{e?.emit({type:`busy`,busy:!0}),setTimeout(()=>{e?.emit({type:`say`,text:O}),e?.emit({type:`busy`,busy:!1})},700)},50),N({ok:!0})}if(r===`simulate`){let e=[...(await M(t)).events].reverse().find(e=>e.type===`state`)?.state;if(!Object.keys(n?.overrides||{}).length&&n?.supply==null)return N(e?.simulation||{available:!1});if(n.supply!=null&&!(n.supply>=.5&&n.supply<=60))return N({error:`supply must be between 0.5 and 60 V`},400);try{return N(await D(e,n.overrides||{},n.supply??null))}catch(e){return console.warn(e),N({error:`The in-browser simulator couldn't load (it needs an internet connection to cdn.jsdelivr.net).`},503)}}return r===`feedback`||r===`title`?N({ok:!0}):N({error:O},409)}return N({error:`not available in the online demo`},404)}async function ke(e){let t=await j(),n=e.get(`mode`)===`demo`&&t.runs[e.get(`sample`)];return n?{ok:!0,status:200,d:{id:n,mode:`demo`}}:{ok:!1,status:409,d:{error:e.get(`mode`)===`demo`?`This sample isn't in the online demo: try the 555 blinker, ESP32 board or Robot car.`:O}}}window.fetch=async(e,t={})=>{let n=new URL(typeof e==`string`?e:e.url,location.href);if(!n.pathname.includes(`/api/`))return S(e,t);let r=n.pathname.slice(n.pathname.indexOf(`/api/`)),i=null;try{i=t.body?JSON.parse(t.body):null}catch{}return Oe((t.method||`GET`).toUpperCase(),r,i)},document.addEventListener(`click`,async e=>{let t=e.target.closest(`a[href]`);if(!t)return;let n=t.getAttribute(`href`);if(n===`/`||n.startsWith(`/#`)){e.preventDefault();let r=x+n.slice(1);t.target===`_blank`?window.open(r,`_blank`):location.href=r;return}let r=n.match(/^\/api\/investigations\/(\w+)\/(report\.md|sketch)\??(.*)$/);if(!r)return;e.preventDefault();let i=await M(r[1]),a=new URLSearchParams(r[3]),o=r[2]===`report.md`?i.report_md:i.sketches[`${a.get(`kind`)}/${a.get(`board`)}`],s=r[2]===`report.md`?`genesis-${r[1]}.md`:`genesis-${a.get(`kind`)}-${a.get(`board`)}.ino`,c=Object.assign(document.createElement(`a`),{href:URL.createObjectURL(new Blob([o||``],{type:`text/plain`})),download:s});c.click(),setTimeout(()=>URL.revokeObjectURL(c.href),1e3)},!0);function Ae(e){if(e===void 0)throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);return e}function je(e,t){e.prototype=Object.create(t.prototype),e.prototype.constructor=e,e.__proto__=t}var Me={autoSleep:120,force3D:`auto`,nullTargetWarn:1,units:{lineHeight:``}},Ne={duration:.5,overwrite:!1,delay:0},Pe,Fe,Ie,Le=1e8,Re=1/Le,ze=Math.PI*2,Be=ze/4,Ve=0,He=Math.sqrt,Ue=Math.cos,We=Math.sin,z=function(e){return typeof e==`string`},Ge=function(e){return typeof e==`function`},Ke=function(e){return typeof e==`number`},qe=function(e){return e===void 0},Je=function(e){return typeof e==`object`},Ye=function(e){return e!==!1},Xe=function(){return typeof window<`u`},Ze=function(e){return Ge(e)||z(e)},Qe=typeof ArrayBuffer==`function`&&ArrayBuffer.isView||function(){},$e=Array.isArray,et=/random\([^)]+\)/g,tt=/,\s*/g,nt=/(?:-?\.?\d|\.)+/gi,rt=/[-+=.]*\d+[.e\-+]*\d*[e\-+]*\d*/g,it=/[-+=.]*\d+[.e-]*\d*[a-z%]*/g,at=/[-+=.]*\d+\.?\d*(?:e-|e\+)?\d*/gi,ot=/[+-]=-?[.\d]+/,st=/[^,'"\[\]\s]+/gi,ct=/^[+\-=e\s\d]*\d+[.\d]*([a-z]*|%)\s*$/i,lt,ut,dt,ft,pt={},mt={},ht,gt=function(e){return(mt=Jt(e,pt))&&mi},_t=function(e,t){return console.warn(`Invalid property`,e,`set to`,t,`Missing plugin? gsap.registerPlugin()`)},vt=function(e,t){return!t&&console.warn(e)},yt=function(e,t){return e&&(pt[e]=t)&&mt&&(mt[e]=t)||pt},bt=function(){return 0},xt={suppressEvents:!0,isStart:!0,kill:!1},St={suppressEvents:!0,kill:!1},Ct={suppressEvents:!0},wt={},Tt=[],Et={},Dt,Ot={},kt={},At=30,jt=[],Mt=``,Nt=function(e){var t=e[0],n,r;if(Je(t)||Ge(t)||(e=[e]),!(n=(t._gsap||{}).harness)){for(r=jt.length;r--&&!jt[r].targetTest(t););n=jt[r]}for(r=e.length;r--;)e[r]&&(e[r]._gsap||(e[r]._gsap=new wr(e[r],n)))||e.splice(r,1);return e},Pt=function(e){return e._gsap||Nt(Mn(e))[0]._gsap},Ft=function(e,t,n){return(n=e[t])&&Ge(n)?e[t]():qe(n)&&e.getAttribute&&e.getAttribute(t)||n},It=function(e,t){return(e=e.split(`,`)).forEach(t)||e},Lt=function(e){return Math.round(e*1e5)/1e5||0},Rt=function(e){return Math.round(e*1e7)/1e7||0},zt=function(e,t){var n=t.charAt(0),r=parseFloat(t.substr(2));return e=parseFloat(e),n===`+`?e+r:n===`-`?e-r:n===`*`?e*r:e/r},Bt=function(e,t){for(var n=t.length,r=0;e.indexOf(t[r])<0&&++r<n;);return r<n},Vt=function(){var e=Tt.length,t=Tt.slice(0),n,r;for(Et={},Tt.length=0,n=0;n<e;n++)r=t[n],r&&r._lazy&&(r.render(r._lazy[0],r._lazy[1],!0)._lazy=0)},Ht=function(e){return!!(e._initted||e._startAt||e.add)},Ut=function(e,t,n,r){Tt.length&&!Fe&&Vt(),e.render(t,n,r||!!(Fe&&t<0&&Ht(e))),Tt.length&&!Fe&&Vt()},Wt=function(e){var t=parseFloat(e);return(t||t===0)&&(e+``).match(st).length<2?t:z(e)?e.trim():e},Gt=function(e){return e},Kt=function(e,t){for(var n in t)n in e||(e[n]=t[n]);return e},qt=function(e){return function(t,n){for(var r in n)r in t||r===`duration`&&e||r===`ease`||(t[r]=n[r])}},Jt=function(e,t){for(var n in t)e[n]=t[n];return e},Yt=function e(t,n){for(var r in n)r!==`__proto__`&&r!==`constructor`&&r!==`prototype`&&(t[r]=Je(n[r])?e(t[r]||(t[r]={}),n[r]):n[r]);return t},Xt=function(e,t){var n={},r;for(r in e)r in t||(n[r]=e[r]);return n},Zt=function(e){var t=e.parent||lt,n=e.keyframes?qt($e(e.keyframes)):Kt;if(Ye(e.inherit))for(;t;)n(e,t.vars.defaults),t=t.parent||t._dp;return e},Qt=function(e,t){for(var n=e.length,r=n===t.length;r&&n--&&e[n]===t[n];);return n<0},$t=function(e,t,n,r,i){n===void 0&&(n=`_first`),r===void 0&&(r=`_last`);var a=e[r],o;if(i)for(o=t[i];a&&a[i]>o;)a=a._prev;return a?(t._next=a._next,a._next=t):(t._next=e[n],e[n]=t),t._next?t._next._prev=t:e[r]=t,t._prev=a,t.parent=t._dp=e,t},en=function(e,t,n,r){n===void 0&&(n=`_first`),r===void 0&&(r=`_last`);var i=t._prev,a=t._next;i?i._next=a:e[n]===t&&(e[n]=a),a?a._prev=i:e[r]===t&&(e[r]=i),t._next=t._prev=t.parent=null},tn=function(e,t){e.parent&&(!t||e.parent.autoRemoveChildren)&&e.parent.remove&&e.parent.remove(e),e._act=0},nn=function(e,t){if(e&&(!t||t._end>e._dur||t._start<0))for(var n=e;n;)n._dirty=1,n=n.parent;return e},rn=function(e){for(var t=e.parent;t&&t.parent;)t._dirty=1,t.totalDuration(),t=t.parent;return e},an=function(e,t,n,r){return e._startAt&&(Fe?e._startAt.revert(St):e.vars.immediateRender&&!e.vars.autoRevert||e._startAt.render(t,!0,r))},on=function e(t){return!t||t._ts&&e(t.parent)},sn=function(e){return e._repeat?cn(e._tTime,e=e.duration()+e._rDelay)*e:0},cn=function(e,t){var n=Math.floor(e=Rt(e/t));return e&&n===e?n-1:n},ln=function(e,t){return(e-t._start)*t._ts+(t._ts>=0?0:t._dirty?t.totalDuration():t._tDur)},un=function(e){return e._end=Rt(e._start+(e._tDur/Math.abs(e._ts||e._rts||Re)||0))},dn=function(e,t){var n=e._dp;return n&&n.smoothChildTiming&&e._ts&&(e._start=Rt(n._time-(e._ts>0?t/e._ts:((e._dirty?e.totalDuration():e._tDur)-t)/-e._ts)),un(e),n._dirty||nn(n,e)),e},fn=function(e,t){var n;if((t._time||!t._dur&&t._initted||t._start<e._time&&(t._dur||!t.add))&&(n=ln(e.rawTime(),t),(!t._dur||En(0,t.totalDuration(),n)-t._tTime>Re)&&t.render(n,!0)),nn(e,t)._dp&&e._initted&&e._time>=e._dur&&e._ts){if(e._dur<e.duration())for(n=e;n._dp;)n.rawTime()>=0&&n.totalTime(n._tTime),n=n._dp;e._zTime=-Re}},pn=function(e,t,n,r){return t.parent&&tn(t),t._start=Rt((Ke(n)?n:n||e!==lt?Cn(e,n,t):e._time)+t._delay),t._end=Rt(t._start+(t.totalDuration()/Math.abs(t.timeScale())||0)),$t(e,t,`_first`,`_last`,e._sort?`_start`:0),_n(t)||(e._recent=t),r||fn(e,t),e._ts<0&&dn(e,e._tTime),e},mn=function(e,t){return(pt.ScrollTrigger||_t(`scrollTrigger`,t))&&pt.ScrollTrigger.create(t,e)},hn=function(e,t,n,r,i){if(Nr(e,t,i),!e._initted)return 1;if(!n&&e._pt&&!Fe&&(e._dur&&e.vars.lazy!==!1||!e._dur&&e.vars.lazy)&&Dt!==ur.frame)return Tt.push(e),e._lazy=[i,r],1},gn=function e(t){var n=t.parent;return n&&n._ts&&n._initted&&!n._lock&&(n.rawTime()<0||e(n))},_n=function(e){var t=e.data;return t===`isFromStart`||t===`isStart`},vn=function(e,t,n,r){var i=e.ratio,a=t<0||!t&&(!e._start&&gn(e)&&(e._initted||!_n(e))||(e._ts<0||e._dp._ts<0)&&!_n(e))?0:1,o=e._rDelay,s=0,c,l,u;if(o&&e._repeat&&(s=En(0,e._tDur,t),l=cn(s,o),e._yoyo&&l&1&&(a=1-a),l!==cn(e._tTime,o)&&(i=1-a,e.vars.repeatRefresh&&e._initted&&e.invalidate())),a!==i||Fe||r||e._zTime===Re||!t&&e._zTime){if(!e._initted&&hn(e,t,r,n,s))return;for(u=e._zTime,e._zTime=t||(n?Re:0),n||=t&&!u,e.ratio=a,e._from&&(a=1-a),e._time=0,e._tTime=s,c=e._pt;c;)c.r(a,c.d),c=c._next;t<0&&an(e,t,n,!0),e._onUpdate&&!n&&Yn(e,`onUpdate`),s&&e._repeat&&!n&&e.parent&&Yn(e,`onRepeat`),(t>=e._tDur||t<0)&&e.ratio===a&&(a&&tn(e,1),!n&&!Fe&&(Yn(e,a?`onComplete`:`onReverseComplete`,!0),e._prom&&e._prom()))}else e._zTime||=t},yn=function(e,t,n){var r;if(n>t)for(r=e._first;r&&r._start<=n;){if(r.data===`isPause`&&r._start>t)return r;r=r._next}else for(r=e._last;r&&r._start>=n;){if(r.data===`isPause`&&r._start<t)return r;r=r._prev}},bn=function(e,t,n,r){var i=e._repeat,a=Rt(t)||0,o=e._tTime/e._tDur;return o&&!r&&(e._time*=a/e._dur),e._dur=a,e._tDur=i?i<0?1e10:Rt(a*(i+1)+e._rDelay*i):a,o>0&&!r&&dn(e,e._tTime=e._tDur*o),e.parent&&un(e),n||nn(e.parent,e),e},xn=function(e){return e instanceof Er?nn(e):bn(e,e._dur)},Sn={_start:0,endTime:bt,totalDuration:bt},Cn=function e(t,n,r){var i=t.labels,a=t._recent||Sn,o=t.duration()>=Le?a.endTime(!1):t._dur,s,c,l;return z(n)&&(isNaN(n)||n in i)?(c=n.charAt(0),l=n.substr(-1)===`%`,s=n.indexOf(`=`),c===`<`||c===`>`?(s>=0&&(n=n.replace(/=/,``)),(c===`<`?a._start:a.endTime(a._repeat>=0))+(parseFloat(n.substr(1))||0)*(l?(s<0?a:r).totalDuration()/100:1)):s<0?(n in i||(i[n]=o),i[n]):(c=parseFloat(n.charAt(s-1)+n.substr(s+1)),l&&r&&(c=c/100*($e(r)?r[0]:r).totalDuration()),s>1?e(t,n.substr(0,s-1),r)+c:o+c)):n==null?o:+n},wn=function(e,t,n){var r=Ke(t[1]),i=(r?2:1)+(e<2?0:1),a=t[i],o,s;if(r&&(a.duration=t[1]),a.parent=n,e){for(o=a,s=n;s&&!(`immediateRender`in o);)o=s.vars.defaults||{},s=Ye(s.vars.inherit)&&s.parent;a.immediateRender=Ye(o.immediateRender),e<2?a.runBackwards=1:a.startAt=t[i-1]}return new Br(t[0],a,t[i+1])},Tn=function(e,t){return e||e===0?t(e):t},En=function(e,t,n){return n<e?e:n>t?t:n},Dn=function(e,t){return!z(e)||!(t=ct.exec(e))?``:t[1]},On=function(e,t,n){return Tn(n,function(n){return En(e,t,n)})},kn=[].slice,An=function(e,t){return e&&Je(e)&&`length`in e&&(!t&&!e.length||e.length-1 in e&&Je(e[0]))&&!e.nodeType&&e!==ut},jn=function(e,t,n){return n===void 0&&(n=[]),e.forEach(function(e){var r;return z(e)&&!t||An(e,1)?(r=n).push.apply(r,Mn(e)):n.push(e)})||n},Mn=function(e,t,n){return Ie&&!t&&Ie.selector?Ie.selector(e):z(e)&&!n&&(dt||!dr())?kn.call((t||ft).querySelectorAll(e),0):$e(e)?jn(e,n):An(e)?kn.call(e,0):e?[e]:[]},Nn=function(e){return e=Mn(e)[0]||vt(`Invalid scope`)||{},function(t){var n=e.current||e.nativeElement||e;return Mn(t,n.querySelectorAll?n:n===e?vt(`Invalid scope`)||ft.createElement(`div`):e)}},Pn=function(e){return e.sort(function(){return .5-Math.random()})},Fn=function(e){if(Ge(e))return e;var t=Je(e)?e:{each:e},n=yr(t.ease),r=t.from||0,i=parseFloat(t.base)||0,a={},o=r>0&&r<1,s=isNaN(r)||o,c=t.axis,l=r,u=r;return z(r)?l=u={center:.5,edges:.5,end:1}[r]||0:!o&&s&&(l=r[0],u=r[1]),function(e,o,d){var f=(d||t).length,p=a[f],m,h,g,_,v,y,b,x,S;if(!p){if(S=t.grid===`auto`?0:(t.grid||[1,Le])[1],!S){for(b=-Le;b<(b=d[S++].getBoundingClientRect().left)&&S<f;);S<f&&S--}for(p=a[f]=[],m=s?Math.min(S,f)*l-.5:r%S,h=S===Le?0:s?f*u/S-.5:r/S|0,b=0,x=Le,y=0;y<f;y++)g=y%S-m,_=h-(y/S|0),p[y]=v=c?Math.abs(c===`y`?_:g):He(g*g+_*_),v>b&&(b=v),v<x&&(x=v);r===`random`&&Pn(p),p.max=b-x,p.min=x,p.v=f=(parseFloat(t.amount)||parseFloat(t.each)*(S>f?f-1:c?c===`y`?f/S:S:Math.max(S,f/S))||0)*(r===`edges`?-1:1),p.b=f<0?i-f:i,p.u=Dn(t.amount||t.each)||0,n=n&&f<0?vr(n):n}return f=(p[e]-p.min)/p.max||0,Rt(p.b+(n?n(f):f)*p.v)+p.u}},In=function(e){var t=10**((e+``).split(`.`)[1]||``).length;return function(n){var r=Rt(Math.round(parseFloat(n)/e)*e*t);return(r-r%1)/t+(Ke(n)?0:Dn(n))}},Ln=function(e,t){var n=$e(e),r,i;return!n&&Je(e)&&(r=n=e.radius||Le,e.values?(e=Mn(e.values),(i=!Ke(e[0]))&&(r*=r)):e=In(e.increment)),Tn(t,n?Ge(e)?function(t){return i=e(t),Math.abs(i-t)<=r?i:t}:function(t){for(var n=parseFloat(i?t.x:t),a=parseFloat(i?t.y:0),o=Le,s=0,c=e.length,l,u;c--;)i?(l=e[c].x-n,u=e[c].y-a,l=l*l+u*u):l=Math.abs(e[c]-n),l<o&&(o=l,s=c);return s=!r||o<=r?e[s]:t,i||s===t||Ke(t)?s:s+Dn(t)}:In(e))},Rn=function(e,t,n,r){return Tn($e(e)?!t:n===!0?!!(n=0):!r,function(){return $e(e)?e[~~(Math.random()*e.length)]:(n||=1e-5)&&(r=n<1?10**((n+``).length-2):1)&&Math.floor(Math.round((e-n/2+Math.random()*(t-e+n*.99))/n)*n*r)/r})},zn=function(){var e=[...arguments];return function(t){return e.reduce(function(e,t){return t(e)},t)}},Bn=function(e,t){return function(n){return e(parseFloat(n))+(t||Dn(n))}},Vn=function(e,t,n){return Kn(e,t,0,1,n)},Hn=function(e,t,n){return Tn(n,function(n){return e[~~t(n)]})},Un=function e(t,n,r){var i=n-t;return $e(t)?Hn(t,e(0,t.length),n):Tn(r,function(e){return(i+(e-t)%i)%i+t})},Wn=function e(t,n,r){var i=n-t,a=i*2;return $e(t)?Hn(t,e(0,t.length-1),n):Tn(r,function(e){return e=(a+(e-t)%a)%a||0,t+(e>i?a-e:e)})},Gn=function(e){return e.replace(et,function(e){var t=e.indexOf(`[`)+1,n=e.substring(t||7,t?e.indexOf(`]`):e.length-1).split(tt);return Rn(t?n:+n[0],t?0:+n[1],+n[2]||1e-5)})},Kn=function(e,t,n,r,i){var a=t-e,o=r-n;return Tn(i,function(t){return n+((t-e)/a*o||0)})},qn=function e(t,n,r,i){var a=isNaN(t+n)?0:function(e){return(1-e)*t+e*n};if(!a){var o=z(t),s={},c,l,u,d,f;if(r===!0&&(i=1)&&(r=null),o)t={p:t},n={p:n};else if($e(t)&&!$e(n)){for(u=[],d=t.length,f=d-2,l=1;l<d;l++)u.push(e(t[l-1],t[l]));d--,a=function(e){e*=d;var t=Math.min(f,~~e);return u[t](e-t)},r=n}else i||(t=Jt($e(t)?[]:{},t));if(!u){for(c in n)Or.call(s,t,c,`get`,n[c]);a=function(e){return Yr(e,s)||(o?t.p:t)}}}return Tn(r,a)},Jn=function(e,t,n){var r=e.labels,i=Le,a,o,s;for(a in r)o=r[a]-t,o<0==!!n&&o&&i>(o=Math.abs(o))&&(s=a,i=o);return s},Yn=function(e,t,n){var r=e.vars,i=r[t],a=Ie,o=e._ctx,s,c,l;if(i)return s=r[t+`Params`],c=r.callbackScope||e,n&&Tt.length&&Vt(),o&&(Ie=o),l=s?i.apply(c,s):i.call(c),Ie=a,l},Xn=function(e){return tn(e),e.scrollTrigger&&e.scrollTrigger.kill(!!Fe),e.progress()<1&&Yn(e,`onInterrupt`),e},Zn,Qn=[],$n=function(e){if(e){if(e=!e.name&&e.default||e,Xe()||e.headless){var t=e.name,n=Ge(e),r=t&&!n&&e.init?function(){this._props=[]}:e,i={init:bt,render:Yr,add:Or,kill:Zr,modifier:Xr,rawVars:0},a={targetTest:0,get:0,getSetter:Gr,aliases:{},register:0};if(dr(),e!==r){if(Ot[t])return;Kt(r,Kt(Xt(e,i),a)),Jt(r.prototype,Jt(i,Xt(e,a))),Ot[r.prop=t]=r,e.targetTest&&(jt.push(r),wt[t]=1),t=(t===`css`?`CSS`:t.charAt(0).toUpperCase()+t.substr(1))+`Plugin`}yt(t,r),e.register&&e.register(mi,r,ei)}else Qn.push(e)}},er=255,tr={aqua:[0,er,er],lime:[0,er,0],silver:[192,192,192],black:[0,0,0],maroon:[128,0,0],teal:[0,128,128],blue:[0,0,er],navy:[0,0,128],white:[er,er,er],olive:[128,128,0],yellow:[er,er,0],orange:[er,165,0],gray:[128,128,128],purple:[128,0,128],green:[0,128,0],red:[er,0,0],pink:[er,192,203],cyan:[0,er,er],transparent:[er,er,er,0]},nr=function(e,t,n){return e+=e<0?1:e>1?-1:0,(e*6<1?t+(n-t)*e*6:e<.5?n:e*3<2?t+(n-t)*(2/3-e)*6:t)*er+.5|0},rr=function(e,t,n){var r=e?Ke(e)?[e>>16,e>>8&er,e&er]:0:tr.black,i,a,o,s,c,l,u,d,f,p;if(!r){if(e.substr(-1)===`,`&&(e=e.substr(0,e.length-1)),tr[e])r=tr[e];else if(e.charAt(0)===`#`){if(e.length<6&&(i=e.charAt(1),a=e.charAt(2),o=e.charAt(3),e=`#`+i+i+a+a+o+o+(e.length===5?e.charAt(4)+e.charAt(4):``)),e.length===9)return r=parseInt(e.substr(1,6),16),[r>>16,r>>8&er,r&er,parseInt(e.substr(7),16)/255];e=parseInt(e.substr(1),16),r=[e>>16,e>>8&er,e&er]}else if(e.substr(0,3)===`hsl`){if(r=p=e.match(nt),!t)s=r[0]%360/360,c=r[1]/100,l=r[2]/100,a=l<=.5?l*(c+1):l+c-l*c,i=l*2-a,r.length>3&&(r[3]*=1),r[0]=nr(s+1/3,i,a),r[1]=nr(s,i,a),r[2]=nr(s-1/3,i,a);else if(~e.indexOf(`=`))return r=e.match(rt),n&&r.length<4&&(r[3]=1),r}else r=e.match(nt)||tr.transparent;r=r.map(Number)}return t&&!p&&(i=r[0]/er,a=r[1]/er,o=r[2]/er,u=Math.max(i,a,o),d=Math.min(i,a,o),l=(u+d)/2,u===d?s=c=0:(f=u-d,c=l>.5?f/(2-u-d):f/(u+d),s=u===i?(a-o)/f+(a<o?6:0):u===a?(o-i)/f+2:(i-a)/f+4,s*=60),r[0]=~~(s+.5),r[1]=~~(c*100+.5),r[2]=~~(l*100+.5)),n&&r.length<4&&(r[3]=1),r},ir=function(e){var t=[],n=[],r=-1;return e.split(or).forEach(function(e){var i=e.match(it)||[];t.push.apply(t,i),n.push(r+=i.length+1)}),t.c=n,t},ar=function(e,t,n){var r=``,i=(e+r).match(or),a=t?`hsla(`:`rgba(`,o=0,s,c,l,u;if(!i)return e;if(i=i.map(function(e){return(e=rr(e,t,1))&&a+(t?e[0]+`,`+e[1]+`%,`+e[2]+`%,`+e[3]:e.join(`,`))+`)`}),n&&(l=ir(e),s=n.c,s.join(r)!==l.c.join(r)))for(c=e.replace(or,`1`).split(it),u=c.length-1;o<u;o++)r+=c[o]+(~s.indexOf(o)?i.shift()||a+`0,0,0,0)`:(l.length?l:i.length?i:n).shift());if(!c)for(c=e.split(or),u=c.length-1;o<u;o++)r+=c[o]+i[o];return r+c[u]},or=function(){var e=`(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#(?:[0-9a-f]{3,4}){1,2}\\b`,t;for(t in tr)e+=`|`+t+`\\b`;return RegExp(e+`)`,`gi`)}(),sr=/hsl[a]?\(/,cr=function(e){var t=e.join(` `),n;if(or.lastIndex=0,or.test(t))return n=sr.test(t),e[1]=ar(e[1],n),e[0]=ar(e[0],n,ir(e[1])),!0},lr,ur=function(){var e=Date.now,t=500,n=33,r=e(),i=r,a=1e3/240,o=a,s=[],c,l,u,d,f,p,m=function u(m){var h=e()-i,g=m===!0,_,v,y,b;if((h>t||h<0)&&(r+=h-n),i+=h,y=i-r,_=y-o,(_>0||g)&&(b=++d.frame,f=y-d.time*1e3,d.time=y/=1e3,o+=_+(_>=a?4:a-_),v=1),g||(c=l(u)),v)for(p=0;p<s.length;p++)s[p](y,f,b,m)};return d={time:0,frame:0,tick:function(){m(!0)},deltaRatio:function(e){return f/(1e3/(e||60))},wake:function(){ht&&(!dt&&Xe()&&(ut=dt=window,ft=ut.document||{},pt.gsap=mi,(ut.gsapVersions||(ut.gsapVersions=[])).push(mi.version),gt(mt||ut.GreenSockGlobals||!ut.gsap&&ut||{}),Qn.forEach($n)),u=typeof requestAnimationFrame<`u`&&requestAnimationFrame,c&&d.sleep(),l=u||function(e){return setTimeout(e,o-d.time*1e3+1|0)},lr=1,m(2))},sleep:function(){(u?cancelAnimationFrame:clearTimeout)(c),lr=0,l=bt},lagSmoothing:function(e,r){t=e||1/0,n=Math.min(r||33,t)},fps:function(e){a=1e3/(e||240),o=d.time*1e3+a},add:function(e,t,n){var r=t?function(t,n,i,a){e(t,n,i,a),d.remove(r)}:e;return d.remove(e),s[n?`unshift`:`push`](r),dr(),r},remove:function(e,t){~(t=s.indexOf(e))&&s.splice(t,1)&&p>=t&&p--},_listeners:s},d}(),dr=function(){return!lr&&ur.wake()},fr={},pr=/^[\d.\-M][\d.\-,\s]/,mr=/["']/g,hr=function(e){for(var t={},n=e.substr(1,e.length-3).split(`:`),r=n[0],i=1,a=n.length,o,s,c;i<a;i++)s=n[i],o=i===a-1?s.length:s.lastIndexOf(`,`),c=s.substr(0,o),t[r]=isNaN(c)?c.replace(mr,``).trim():+c,r=s.substr(o+1).trim();return t},gr=function(e){var t=e.indexOf(`(`)+1,n=e.indexOf(`)`),r=e.indexOf(`(`,t);return e.substring(t,~r&&r<n?e.indexOf(`)`,n+1):n)},_r=function(e){var t=(e+``).split(`(`),n=fr[t[0]];return n&&t.length>1&&n.config?n.config.apply(null,~e.indexOf(`{`)?[hr(t[1])]:gr(e).split(`,`).map(Wt)):fr._CE&&pr.test(e)?fr._CE(``,e):n},vr=function(e){return function(t){return 1-e(1-t)}},yr=function(e,t){return e&&(Ge(e)?e:fr[e]||_r(e))||t},br=function(e,t,n,r){n===void 0&&(n=function(e){return 1-t(1-e)}),r===void 0&&(r=function(e){return e<.5?t(e*2)/2:1-t((1-e)*2)/2});var i={easeIn:t,easeOut:n,easeInOut:r},a;return It(e,function(e){for(var t in fr[e]=pt[e]=i,fr[a=e.toLowerCase()]=n,i)fr[a+(t===`easeIn`?`.in`:t===`easeOut`?`.out`:`.inOut`)]=fr[e+`.`+t]=i[t]}),i},xr=function(e){return function(t){return t<.5?(1-e(1-t*2))/2:.5+e((t-.5)*2)/2}},Sr=function e(t,n,r){var i=n>=1?n:1,a=(r||(t?.3:.45))/(n<1?n:1),o=a/ze*(Math.asin(1/i)||0),s=function(e){return e===1?1:i*2**(-10*e)*We((e-o)*a)+1},c=t===`out`?s:t===`in`?function(e){return 1-s(1-e)}:xr(s);return a=ze/a,c.config=function(n,r){return e(t,n,r)},c},Cr=function e(t,n){n===void 0&&(n=1.70158);var r=function(e){return e?--e*e*((n+1)*e+n)+1:0},i=t===`out`?r:t===`in`?function(e){return 1-r(1-e)}:xr(r);return i.config=function(n){return e(t,n)},i};It(`Linear,Quad,Cubic,Quart,Quint,Strong`,function(e,t){var n=t<5?t+1:t;br(e+`,Power`+(n-1),t?function(e){return e**+n}:function(e){return e},function(e){return 1-(1-e)**n},function(e){return e<.5?(e*2)**n/2:1-((1-e)*2)**n/2})}),fr.Linear.easeNone=fr.none=fr.Linear.easeIn,br(`Elastic`,Sr(`in`),Sr(`out`),Sr()),(function(e,t){var n=1/t,r=2*n,i=2.5*n,a=function(a){return a<n?e*a*a:a<r?e*(a-1.5/t)**2+.75:a<i?e*(a-=2.25/t)*a+.9375:e*(a-2.625/t)**2+.984375};br(`Bounce`,function(e){return 1-a(1-e)},a)})(7.5625,2.75),br(`Expo`,function(e){return 2**(10*(e-1))*e+e*e*e*e*e*e*(1-e)}),br(`Circ`,function(e){return-(He(1-e*e)-1)}),br(`Sine`,function(e){return e===1?1:-Ue(e*Be)+1}),br(`Back`,Cr(`in`),Cr(`out`),Cr()),fr.SteppedEase=fr.steps=pt.SteppedEase={config:function(e,t){e===void 0&&(e=1);var n=1/e,r=e+ +!t,i=+!!t,a=1-Re;return function(e){return((r*En(0,a,e)|0)+i)*n}}},Ne.ease=fr[`quad.out`],It(`onComplete,onUpdate,onStart,onRepeat,onReverseComplete,onInterrupt`,function(e){return Mt+=e+`,`+e+`Params,`});var wr=function(e,t){this.id=Ve++,e._gsap=this,this.target=e,this.harness=t,this.get=t?t.get:Ft,this.set=t?t.getSetter:Gr},Tr=function(){function e(e){this.vars=e,this._delay=+e.delay||0,(this._repeat=e.repeat===1/0?-2:e.repeat||0)&&(this._rDelay=e.repeatDelay||0,this._yoyo=!!e.yoyo||!!e.yoyoEase),this._ts=1,bn(this,+e.duration,1,1),this.data=e.data,Ie&&(this._ctx=Ie,Ie.data.push(this)),lr||ur.wake()}var t=e.prototype;return t.delay=function(e){return e||e===0?(this.parent&&this.parent.smoothChildTiming&&this.startTime(this._start+e-this._delay),this._delay=e,this):this._delay},t.duration=function(e){return arguments.length?this.totalDuration(this._repeat>0?e+(e+this._rDelay)*this._repeat:e):this.totalDuration()&&this._dur},t.totalDuration=function(e){return arguments.length?(this._dirty=0,bn(this,this._repeat<0?e:(e-this._repeat*this._rDelay)/(this._repeat+1))):this._tDur},t.totalTime=function(e,t){if(dr(),!arguments.length)return this._tTime;var n=this._dp;if(n&&n.smoothChildTiming&&this._ts){for(dn(this,e),!n._dp||n.parent||fn(n,this);n&&n.parent;)n.parent._time!==n._start+(n._ts>=0?n._tTime/n._ts:(n.totalDuration()-n._tTime)/-n._ts)&&n.totalTime(n._tTime,!0),n=n.parent;!this.parent&&this._dp.autoRemoveChildren&&(this._ts>0&&e<this._tDur||this._ts<0&&e>0||!this._tDur&&!e)&&pn(this._dp,this,this._start-this._delay)}return(this._tTime!==e||!this._dur&&!t||this._initted&&Math.abs(this._zTime)===Re||!this._initted&&this._dur&&e||!e&&!this._initted&&(this.add||this._ptLookup))&&(this._ts||(this._pTime=e),Ut(this,e,t)),this},t.time=function(e,t){return arguments.length?this.totalTime(Math.min(this.totalDuration(),e+sn(this))%(this._dur+this._rDelay)||(e?this._dur:0),t):this._time},t.totalProgress=function(e,t){return arguments.length?this.totalTime(this.totalDuration()*e,t):this.totalDuration()?Math.min(1,this._tTime/this._tDur):this.rawTime()>=0&&this._initted?1:0},t.progress=function(e,t){return arguments.length?this.totalTime(this.duration()*(this._yoyo&&!(this.iteration()&1)?1-e:e)+sn(this),t):this.duration()?Math.min(1,this._time/this._dur):+(this.rawTime()>0)},t.iteration=function(e,t){var n=this.duration()+this._rDelay;return arguments.length?this.totalTime(this._time+(e-1)*n,t):this._repeat?cn(this._tTime,n)+1:1},t.timeScale=function(e,t){if(!arguments.length)return this._rts===-Re?0:this._rts;if(this._rts===e)return this;var n=this.parent&&this._ts?ln(this.parent._time,this):this._tTime;return this._rts=+e||0,this._ts=this._ps||e===-Re?0:this._rts,this.totalTime(En(-Math.abs(this._delay),this.totalDuration(),n),t!==!1),un(this),rn(this)},t.paused=function(e){return arguments.length?(this._ps!==e&&(this._ps=e,e?(this._pTime=this._tTime||Math.max(-this._delay,this.rawTime()),this._ts=this._act=0):(dr(),this._ts=this._rts,this.totalTime(this.parent&&!this.parent.smoothChildTiming?this.rawTime():this._tTime||this._pTime,this.progress()===1&&Math.abs(this._zTime)!==Re&&(this._tTime-=Re)))),this):this._ps},t.startTime=function(e){if(arguments.length){this._start=Rt(e);var t=this.parent||this._dp;return t&&(t._sort||!this.parent)&&pn(t,this,this._start-this._delay),this}return this._start},t.endTime=function(e){return this._start+(Ye(e)?this.totalDuration():this.duration())/Math.abs(this._ts||1)},t.rawTime=function(e){var t=this.parent||this._dp;return t?e&&(!this._ts||this._repeat&&this._time&&this.totalProgress()<1)?this._tTime%(this._dur+this._rDelay):this._ts?ln(t.rawTime(e),this):this._tTime:this._tTime},t.revert=function(e){e===void 0&&(e=Ct);var t=Fe;return Fe=e,Ht(this)&&(this.timeline&&this.timeline.revert(e),this.totalTime(-.01,e.suppressEvents)),this.data!==`nested`&&e.kill!==!1&&this.kill(),Fe=t,this},t.globalTime=function(e){for(var t=this,n=arguments.length?e:t.rawTime();t;)n=t._start+n/(Math.abs(t._ts)||1),t=t._dp;return!this.parent&&this._sat?this._sat.globalTime(e):n},t.repeat=function(e){return arguments.length?(this._repeat=e===1/0?-2:e,xn(this)):this._repeat===-2?1/0:this._repeat},t.repeatDelay=function(e){if(arguments.length){var t=this._time;return this._rDelay=e,xn(this),t?this.time(t):this}return this._rDelay},t.yoyo=function(e){return arguments.length?(this._yoyo=e,this):this._yoyo},t.seek=function(e,t){return this.totalTime(Cn(this,e),Ye(t))},t.restart=function(e,t){return this.play().totalTime(e?-this._delay:0,Ye(t)),this._dur||(this._zTime=-Re),this},t.play=function(e,t){return e!=null&&this.seek(e,t),this.reversed(!1).paused(!1)},t.reverse=function(e,t){return e!=null&&this.seek(e||this.totalDuration(),t),this.reversed(!0).paused(!1)},t.pause=function(e,t){return e!=null&&this.seek(e,t),this.paused(!0)},t.resume=function(){return this.paused(!1)},t.reversed=function(e){return arguments.length?(!!e!==this.reversed()&&this.timeScale(-this._rts||(e?-Re:0)),this):this._rts<0},t.invalidate=function(){return this._initted=this._act=0,this._zTime=-Re,this},t.isActive=function(){var e=this.parent||this._dp,t=this._start,n;return!!(!e||this._ts&&this._initted&&e.isActive()&&(n=e.rawTime(!0))>=t&&n<this.endTime(!0)-Re)},t.eventCallback=function(e,t,n){var r=this.vars;return arguments.length>1?(t?(r[e]=t,n&&(r[e+`Params`]=n),e===`onUpdate`&&(this._onUpdate=t)):delete r[e],this):r[e]},t.then=function(e){var t=this,n=t._prom;return new Promise(function(r){var i=Ge(e)?e:Gt,a=function(){var e=t.then;t.then=null,n&&n(),Ge(i)&&(i=i(t))&&(i.then||i===t)&&(t.then=e),r(i),t.then=e};t._initted&&t.totalProgress()===1&&t._ts>=0||!t._tTime&&t._ts<0?a():t._prom=a})},t.kill=function(){Xn(this)},e}();Kt(Tr.prototype,{_time:0,_start:0,_end:0,_tTime:0,_tDur:0,_dirty:0,_repeat:0,_yoyo:!1,parent:null,_initted:!1,_rDelay:0,_ts:1,_dp:0,ratio:0,_zTime:-Re,_prom:0,_ps:!1,_rts:1});var Er=function(e){je(t,e);function t(t,n){var r;return t===void 0&&(t={}),r=e.call(this,t)||this,r.labels={},r.smoothChildTiming=!!t.smoothChildTiming,r.autoRemoveChildren=!!t.autoRemoveChildren,r._sort=Ye(t.sortChildren),lt&&pn(t.parent||lt,Ae(r),n),t.reversed&&r.reverse(),t.paused&&r.paused(!0),t.scrollTrigger&&mn(Ae(r),t.scrollTrigger),r}var n=t.prototype;return n.to=function(e,t,n){return wn(0,arguments,this),this},n.from=function(e,t,n){return wn(1,arguments,this),this},n.fromTo=function(e,t,n,r){return wn(2,arguments,this),this},n.set=function(e,t,n){return t.duration=0,t.parent=this,Zt(t).repeatDelay||(t.repeat=0),t.immediateRender=!!t.immediateRender,new Br(e,t,Cn(this,n),1),this},n.call=function(e,t,n){return pn(this,Br.delayedCall(0,e,t),n)},n.staggerTo=function(e,t,n,r,i,a,o){return n.duration=t,n.stagger=n.stagger||r,n.onComplete=a,n.onCompleteParams=o,n.parent=this,new Br(e,n,Cn(this,i)),this},n.staggerFrom=function(e,t,n,r,i,a,o){return n.runBackwards=1,Zt(n).immediateRender=Ye(n.immediateRender),this.staggerTo(e,t,n,r,i,a,o)},n.staggerFromTo=function(e,t,n,r,i,a,o,s){return r.startAt=n,Zt(r).immediateRender=Ye(r.immediateRender),this.staggerTo(e,t,r,i,a,o,s)},n.render=function(e,t,n){var r=this._time,i=this._dirty?this.totalDuration():this._tDur,a=this._dur,o=e<=0?0:Rt(e),s=this._zTime<0!=e<0&&(this._initted||!a),c,l,u,d,f,p,m,h,g,_,v,y;if(this!==lt&&o>i&&e>=0&&(o=i),o!==this._tTime||n||s){if(r!==this._time&&a&&(o+=this._time-r,e+=this._time-r),c=o,g=this._start,h=this._ts,p=!h,s&&(a||(r=this._zTime),(e||!t)&&(this._zTime=e)),this._repeat){if(v=this._yoyo,f=a+this._rDelay,this._repeat<-1&&e<0)return this.totalTime(f*100+e,t,n);if(c=Rt(o%f),o===i?(d=this._repeat,c=a):(_=Rt(o/f),d=~~_,d&&d===_&&(c=a,d--),c>a&&(c=a)),_=cn(this._tTime,f),!r&&this._tTime&&_!==d&&this._tTime-_*f-this._dur<=0&&(_=d),v&&d&1&&(c=a-c,y=1),d!==_&&!this._lock){var b=v&&_&1,x=b===(v&&d&1);if(d<_&&(b=!b),r=b?0:o%a?a:o,this._lock=1,this.render(r||(y?0:Rt(d*f)),t,!a)._lock=0,this._tTime=o,!t&&this.parent&&Yn(this,`onRepeat`),this.vars.repeatRefresh&&!y&&(this.invalidate()._lock=1,_=d),r&&r!==this._time||p!==!this._ts||this.vars.onRepeat&&!this.parent&&!this._act||(a=this._dur,i=this._tDur,x&&(this._lock=2,r=b?a:-1e-4,this.render(r,!0),this.vars.repeatRefresh&&!y&&this.invalidate()),this._lock=0,!this._ts&&!p))return this}}if(this._hasPause&&!this._forcing&&this._lock<2&&(m=yn(this,Rt(r),Rt(c)),m&&(o-=c-(c=m._start))),this._tTime=o,this._time=c,this._act=!!h,this._initted||(this._onUpdate=this.vars.onUpdate,this._initted=1,this._zTime=e,r=0),!r&&o&&a&&!t&&!_&&(Yn(this,`onStart`),this._tTime!==o))return this;if(c>=r&&e>=0)for(l=this._first;l;){if(u=l._next,(l._act||c>=l._start)&&l._ts&&m!==l){if(l.parent!==this)return this.render(e,t,n);if(l.render(l._ts>0?(c-l._start)*l._ts:(l._dirty?l.totalDuration():l._tDur)+(c-l._start)*l._ts,t,n),c!==this._time||!this._ts&&!p){m=0,u&&(o+=this._zTime=-Re);break}}l=u}else{l=this._last;for(var S=e<0?e:c;l;){if(u=l._prev,(l._act||S<=l._end)&&l._ts&&m!==l){if(l.parent!==this)return this.render(e,t,n);if(l.render(l._ts>0?(S-l._start)*l._ts:(l._dirty?l.totalDuration():l._tDur)+(S-l._start)*l._ts,t,n||Fe&&Ht(l)),c!==this._time||!this._ts&&!p){m=0,u&&(o+=this._zTime=S?-Re:Re);break}}l=u}}if(m&&!t&&(this.pause(),m.render(c>=r?0:-Re)._zTime=c>=r?1:-1,this._ts))return this._start=g,un(this),this.render(e,t,n);this._onUpdate&&!t&&Yn(this,`onUpdate`,!0),(o===i&&this._tTime>=this.totalDuration()||!o&&r)&&(g===this._start||Math.abs(h)!==Math.abs(this._ts))&&(this._lock||((e||!a)&&(o===i&&this._ts>0||!o&&this._ts<0)&&tn(this,1),!t&&!(e<0&&!r)&&(o||r||!i)&&(Yn(this,o===i&&e>=0?`onComplete`:`onReverseComplete`,!0),this._prom&&!(o<i&&this.timeScale()>0)&&this._prom())))}return this},n.add=function(e,t){var n=this;if(Ke(t)||(t=Cn(this,t,e)),!(e instanceof Tr)){if($e(e))return e.forEach(function(e){return n.add(e,t)}),this;if(z(e))return this.addLabel(e,t);if(Ge(e))e=Br.delayedCall(0,e);else return this}return this===e?this:pn(this,e,t)},n.getChildren=function(e,t,n,r){e===void 0&&(e=!0),t===void 0&&(t=!0),n===void 0&&(n=!0),r===void 0&&(r=-Le);for(var i=[],a=this._first;a;)a._start>=r&&(a instanceof Br?t&&i.push(a):(n&&i.push(a),e&&i.push.apply(i,a.getChildren(!0,t,n)))),a=a._next;return i},n.getById=function(e){for(var t=this.getChildren(1,1,1),n=t.length;n--;)if(t[n].vars.id===e)return t[n]},n.remove=function(e){return z(e)?this.removeLabel(e):Ge(e)?this.killTweensOf(e):(e.parent===this&&en(this,e),e===this._recent&&(this._recent=this._last),nn(this))},n.totalTime=function(t,n){return arguments.length?(this._forcing=1,!this._dp&&this._ts&&(this._start=Rt(ur.time-(this._ts>0?t/this._ts:(this.totalDuration()-t)/-this._ts))),e.prototype.totalTime.call(this,t,n),this._forcing=0,this):this._tTime},n.addLabel=function(e,t){return this.labels[e]=Cn(this,t),this},n.removeLabel=function(e){return delete this.labels[e],this},n.addPause=function(e,t,n){var r=Br.delayedCall(0,t||bt,n);return r.data=`isPause`,this._hasPause=1,pn(this,r,Cn(this,e))},n.removePause=function(e){var t=this._first;for(e=Cn(this,e);t;)t._start===e&&t.data===`isPause`&&tn(t),t=t._next},n.killTweensOf=function(e,t,n){for(var r=this.getTweensOf(e,n),i=r.length;i--;)jr!==r[i]&&r[i].kill(e,t);return this},n.getTweensOf=function(e,t){for(var n=[],r=Mn(e),i=this._first,a=Ke(t),o;i;)i instanceof Br?Bt(i._targets,r)&&(a?(!jr||i._initted&&i._ts)&&i.globalTime(0)<=t&&i.globalTime(i.totalDuration())>t:!t||i.isActive())&&n.push(i):(o=i.getTweensOf(r,t)).length&&n.push.apply(n,o),i=i._next;return n},n.tweenTo=function(e,t){t||={};var n=this,r=Cn(n,e),i=t,a=i.startAt,o=i.onStart,s=i.onStartParams,c=i.immediateRender,l,u=Br.to(n,Kt({ease:t.ease||`none`,lazy:!1,immediateRender:!1,time:r,overwrite:`auto`,duration:t.duration||Math.abs((r-(a&&`time`in a?a.time:n._time))/n.timeScale())||Re,onStart:function(){if(n.pause(),!l){var e=t.duration||Math.abs((r-(a&&`time`in a?a.time:n._time))/n.timeScale());u._dur!==e&&bn(u,e,0,1).render(u._time,!0,!0),l=1}o&&o.apply(u,s||[])}},t));return c?u.render(0):u},n.tweenFromTo=function(e,t,n){return this.tweenTo(t,Kt({startAt:{time:Cn(this,e)}},n))},n.recent=function(){return this._recent},n.nextLabel=function(e){return e===void 0&&(e=this._time),Jn(this,Cn(this,e))},n.previousLabel=function(e){return e===void 0&&(e=this._time),Jn(this,Cn(this,e),1)},n.currentLabel=function(e){return arguments.length?this.seek(e,!0):this.previousLabel(this._time+Re)},n.shiftChildren=function(e,t,n){n===void 0&&(n=0);var r=this._first,i=this.labels,a;for(e=Rt(e);r;)r._start>=n&&(r._start+=e,r._end+=e),r=r._next;if(t)for(a in i)i[a]>=n&&(i[a]+=e);return nn(this)},n.invalidate=function(t){var n=this._first;for(this._lock=0;n;)n.invalidate(t),n=n._next;return e.prototype.invalidate.call(this,t)},n.clear=function(e){e===void 0&&(e=!0);for(var t=this._first,n;t;)n=t._next,this.remove(t),t=n;return this._dp&&(this._time=this._tTime=this._pTime=0),e&&(this.labels={}),nn(this)},n.totalDuration=function(e){var t=0,n=this,r=n._last,i=Le,a,o,s;if(arguments.length)return n.timeScale((n._repeat<0?n.duration():n.totalDuration())/(n.reversed()?-e:e));if(n._dirty){for(s=n.parent;r;)a=r._prev,r._dirty&&r.totalDuration(),o=r._start,o>i&&n._sort&&r._ts&&!n._lock?(n._lock=1,pn(n,r,o-r._delay,1)._lock=0):i=o,o<0&&r._ts&&(t-=o,(!s&&!n._dp||s&&s.smoothChildTiming)&&(n._start+=Rt(o/n._ts),n._time-=o,n._tTime-=o),n.shiftChildren(-o,!1,-1/0),i=0),r._end>t&&r._ts&&(t=r._end),r=a;bn(n,n===lt&&n._time>t?n._time:t,1,1),n._dirty=0}return n._tDur},t.updateRoot=function(e){if(lt._ts&&(Ut(lt,ln(e,lt)),Dt=ur.frame),ur.frame>=At){At+=Me.autoSleep||120;var t=lt._first;if((!t||!t._ts)&&Me.autoSleep&&ur._listeners.length<2){for(;t&&!t._ts;)t=t._next;t||ur.sleep()}}},t}(Tr);Kt(Er.prototype,{_lock:0,_hasPause:0,_forcing:0});var Dr=function(e,t,n,r,i,a,o){var s=new ei(this._pt,e,t,0,1,Jr,null,i),c=0,l=0,u,d,f,p,m,h,g,_;for(s.b=n,s.e=r,n+=``,r+=``,(g=~r.indexOf(`random(`))&&(r=Gn(r)),a&&(_=[n,r],a(_,e,t),n=_[0],r=_[1]),d=n.match(at)||[];u=at.exec(r);)p=u[0],m=r.substring(c,u.index),f?f=(f+1)%5:m.substr(-5)===`rgba(`&&(f=1),p!==d[l++]&&(h=parseFloat(d[l-1])||0,s._pt={_next:s._pt,p:m||l===1?m:`,`,s:h,c:p.charAt(1)===`=`?zt(h,p)-h:parseFloat(p)-h,m:f&&f<4?Math.round:0},c=at.lastIndex);return s.c=c<r.length?r.substring(c,r.length):``,s.fp=o,(ot.test(r)||g)&&(s.e=0),this._pt=s,s},Or=function(e,t,n,r,i,a,o,s,c,l){Ge(r)&&(r=r(i||0,e,a));var u=e[t],d=n===`get`?Ge(u)?c?e[t.indexOf(`set`)||!Ge(e[`get`+t.substr(3)])?t:`get`+t.substr(3)](c):e[t]():u:n,f=Ge(u)?c?Ur:Hr:Vr,p;if(z(r)&&(~r.indexOf(`random(`)&&(r=Gn(r)),r.charAt(1)===`=`&&(p=zt(d,r)+(Dn(d)||0),(p||p===0)&&(r=p))),!l||d!==r||Mr)return!isNaN(d*r)&&r!==``?(p=new ei(this._pt,e,t,+d||0,r-(d||0),typeof u==`boolean`?qr:Kr,0,f),c&&(p.fp=c),o&&p.modifier(o,this,e),this._pt=p):(!u&&!(t in e)&&_t(t,r),Dr.call(this,e,t,d,r,f,s||Me.stringFilter,c))},kr=function(e,t,n,r,i){if(Ge(e)&&(e=Lr(e,i,t,n,r)),!Je(e)||e.style&&e.nodeType||$e(e)||Qe(e))return z(e)?Lr(e,i,t,n,r):e;var a={},o;for(o in e)a[o]=Lr(e[o],i,t,n,r);return a},Ar=function(e,t,n,r,i,a){var o,s,c,l;if(Ot[e]&&(o=new Ot[e]).init(i,o.rawVars?t[e]:kr(t[e],r,i,a,n),n,r,a)!==!1&&(n._pt=s=new ei(n._pt,i,e,0,1,o.render,o,0,o.priority),n!==Zn))for(c=n._ptLookup[n._targets.indexOf(i)],l=o._props.length;l--;)c[o._props[l]]=s;return o},jr,Mr,Nr=function e(t,n,r){var i=t.vars,a=i.ease,o=i.startAt,s=i.immediateRender,c=i.lazy,l=i.onUpdate,u=i.runBackwards,d=i.yoyoEase,f=i.keyframes,p=i.autoRevert,m=t._dur,h=t._startAt,g=t._targets,_=t.parent,v=_&&_.data===`nested`?_.vars.targets:g,y=t._overwrite===`auto`&&!Pe,b=t.timeline,x=i.easeReverse||d,S,C,w,T,E,D,O,k,A,j,M,N,ee;if(b&&(!f||!a)&&(a=`none`),t._ease=yr(a,Ne.ease),t._rEase=x&&(yr(x)||t._ease),t._from=!b&&!!i.runBackwards,t._from&&(t.ratio=1),!b||f&&!i.stagger){if(k=g[0]?Pt(g[0]).harness:0,N=k&&i[k.prop],S=Xt(i,wt),h&&(h._zTime<0&&h.progress(1),n<0&&u&&s&&!p?h.render(-1,!0):h.revert(u&&m?St:xt),h._lazy=0),o){if(tn(t._startAt=Br.set(g,Kt({data:`isStart`,overwrite:!1,parent:_,immediateRender:!0,lazy:!h&&Ye(c),startAt:null,delay:0,onUpdate:l&&function(){return Yn(t,`onUpdate`)},stagger:0},o))),t._startAt._dp=0,t._startAt._sat=t,n<0&&(Fe||!s&&!p)&&t._startAt.revert(St),s&&m&&n<=0&&r<=0){n&&(t._zTime=n);return}}else if(u&&m&&!h){if(n&&(s=!1),w=Kt({overwrite:!1,data:`isFromStart`,lazy:s&&!h&&Ye(c),immediateRender:s,stagger:0,parent:_},S),N&&(w[k.prop]=N),tn(t._startAt=Br.set(g,w)),t._startAt._dp=0,t._startAt._sat=t,n<0&&(Fe?t._startAt.revert(St):t._startAt.render(-1,!0)),t._zTime=n,!s)e(t._startAt,Re,Re);else if(!n)return}for(t._pt=t._ptCache=0,c=m&&Ye(c)||c&&!m,C=0;C<g.length;C++){if(E=g[C],O=E._gsap||Nt(g)[C]._gsap,t._ptLookup[C]=j={},Et[O.id]&&Tt.length&&Vt(),M=v===g?C:v.indexOf(E),k&&(A=new k).init(E,N||S,t,M,v)!==!1&&(t._pt=T=new ei(t._pt,E,A.name,0,1,A.render,A,0,A.priority),A._props.forEach(function(e){j[e]=T}),A.priority&&(D=1)),!k||N)for(w in S)Ot[w]&&(A=Ar(w,S,t,M,E,v))?A.priority&&(D=1):j[w]=T=Or.call(t,E,w,`get`,S[w],M,v,0,i.stringFilter);t._op&&t._op[C]&&t.kill(E,t._op[C]),y&&t._pt&&(jr=t,lt.killTweensOf(E,j,t.globalTime(n)),ee=!t.parent,jr=0),t._pt&&c&&(Et[O.id]=1)}D&&$r(t),t._onInit&&t._onInit(t)}t._onUpdate=l,t._initted=(!t._op||t._pt)&&!ee,f&&n<=0&&b.render(Le,!0,!0)},Pr=function(e,t,n,r,i,a,o,s){var c=(e._pt&&e._ptCache||(e._ptCache={}))[t],l,u,d,f;if(!c)for(c=e._ptCache[t]=[],d=e._ptLookup,f=e._targets.length;f--;){if(l=d[f][t],l&&l.d&&l.d._pt)for(l=l.d._pt;l&&l.p!==t&&l.fp!==t;)l=l._next;if(!l)return Mr=1,e.vars[t]=`+=0`,Nr(e,o),Mr=0,s?vt(t+` not eligible for reset. Try splitting into individual properties`):1;c.push(l)}for(f=c.length;f--;)u=c[f],l=u._pt||u,l.s=(r||r===0)&&!i?r:l.s+(r||0)+a*l.c,l.c=n-l.s,u.e&&(u.e=Lt(n)+Dn(u.e)),u.b&&(u.b=l.s+Dn(u.b))},Fr=function(e,t){var n=e[0]?Pt(e[0]).harness:0,r=n&&n.aliases,i,a,o,s;if(!r)return t;for(a in i=Jt({},t),r)if(a in i)for(s=r[a].split(`,`),o=s.length;o--;)i[s[o]]=i[a];return i},Ir=function(e,t,n,r){var i=t.ease||r||`power1.inOut`,a,o;if($e(t))o=n[e]||(n[e]=[]),t.forEach(function(e,n){return o.push({t:n/(t.length-1)*100,v:e,e:i})});else for(a in t)o=n[a]||(n[a]=[]),a===`ease`||o.push({t:parseFloat(e),v:t[a],e:i})},Lr=function(e,t,n,r,i){return Ge(e)?e.call(t,n,r,i):z(e)&&~e.indexOf(`random(`)?Gn(e):e},Rr=Mt+`repeat,repeatDelay,yoyo,repeatRefresh,yoyoEase,easeReverse,autoRevert`,zr={};It(Rr+`,id,stagger,delay,duration,paused,scrollTrigger`,function(e){return zr[e]=1});var Br=function(e){je(t,e);function t(t,n,r,i){var a;typeof n==`number`&&(r.duration=n,n=r,r=null),a=e.call(this,i?n:Zt(n))||this;var o=a.vars,s=o.duration,c=o.delay,l=o.immediateRender,u=o.stagger,d=o.overwrite,f=o.keyframes,p=o.defaults,m=o.scrollTrigger,h=n.parent||lt,g=($e(t)||Qe(t)?Ke(t[0]):`length`in n)?[t]:Mn(t),_,v,y,b,x,S,C,w;if(a._targets=g.length?Nt(g):vt(`GSAP target `+t+` not found. https://gsap.com`,!Me.nullTargetWarn)||[],a._ptLookup=[],a._overwrite=d,f||u||Ze(s)||Ze(c)){n=a.vars;var T=n.easeReverse||n.yoyoEase;if(_=a.timeline=new Er({data:`nested`,defaults:p||{},targets:h&&h.data===`nested`?h.vars.targets:g}),_.kill(),_.parent=_._dp=Ae(a),_._start=0,u||Ze(s)||Ze(c)){if(b=g.length,C=u&&Fn(u),Je(u))for(x in u)~Rr.indexOf(x)&&(w||={},w[x]=u[x]);for(v=0;v<b;v++)y=Xt(n,zr),y.stagger=0,T&&(y.easeReverse=T),w&&Jt(y,w),S=g[v],y.duration=+Lr(s,Ae(a),v,S,g),y.delay=(+Lr(c,Ae(a),v,S,g)||0)-a._delay,!u&&b===1&&y.delay&&(a._delay=c=y.delay,a._start+=c,y.delay=0),_.to(S,y,C?C(v,S,g):0),_._ease=fr.none;_.duration()?s=c=0:a.timeline=0}else if(f){Zt(Kt(_.vars.defaults,{ease:`none`})),_._ease=yr(f.ease||n.ease||`none`);var E=0,D,O,k;if($e(f))f.forEach(function(e){return _.to(g,e,`>`)}),_.duration();else{for(x in y={},f)x===`ease`||x===`easeEach`||Ir(x,f[x],y,f.easeEach);for(x in y)for(D=y[x].sort(function(e,t){return e.t-t.t}),E=0,v=0;v<D.length;v++)O=D[v],k={ease:O.e,duration:(O.t-(v?D[v-1].t:0))/100*s},k[x]=O.v,_.to(g,k,E),E+=k.duration;_.duration()<s&&_.to({},{duration:s-_.duration()})}}s||a.duration(s=_.duration())}else a.timeline=0;return d===!0&&!Pe&&(jr=Ae(a),lt.killTweensOf(g),jr=0),pn(h,Ae(a),r),n.reversed&&a.reverse(),n.paused&&a.paused(!0),(l||!s&&!f&&a._start===Rt(h._time)&&Ye(l)&&on(Ae(a))&&h.data!==`nested`)&&(a._tTime=-Re,a.render(Math.max(0,-c)||0)),m&&mn(Ae(a),m),a}var n=t.prototype;return n.render=function(e,t,n){var r=this._time,i=this._tDur,a=this._dur,o=e<0,s=e>i-Re&&!o?i:e<Re?0:e,c,l,u,d,f,p,m,h;if(!a)vn(this,e,t,n);else if(s!==this._tTime||!e||n||!this._initted&&this._tTime||this._startAt&&this._zTime<0!==o||this._lazy){if(c=s,h=this.timeline,this._repeat){if(d=a+this._rDelay,this._repeat<-1&&o)return this.totalTime(d*100+e,t,n);if(c=Rt(s%d),s===i?(u=this._repeat,c=a):(f=Rt(s/d),u=~~f,u&&u===f?(c=a,u--):c>a&&(c=a)),p=this._yoyo&&u&1,p&&(c=a-c),f=cn(this._tTime,d),c===r&&!n&&this._initted&&u===f)return this._tTime=s,this;u!==f&&this.vars.repeatRefresh&&!p&&!this._lock&&c!==d&&this._initted&&(this._lock=n=1,this.render(Rt(d*u),!0).invalidate()._lock=0)}if(!this._initted){if(hn(this,o?e:c,n,t,s))return this._tTime=0,this;if(r!==this._time&&!(n&&this.vars.repeatRefresh&&u!==f))return this;if(a!==this._dur)return this.render(e,t,n)}if(this._rEase){var g=c<r;if(g!==this._inv){var _=g?r:a-r;this._inv=g,this._from&&(this.ratio=1-this.ratio),this._invRatio=this.ratio,this._invTime=r,this._invRecip=_?(g?-1:1)/_:0,this._invScale=g?-this.ratio:1-this.ratio,this._invEase=g?this._rEase:this._ease}this.ratio=m=this._invRatio+this._invScale*this._invEase((c-this._invTime)*this._invRecip)}else this.ratio=m=this._ease(c/a);if(this._from&&(this.ratio=m=1-m),this._tTime=s,this._time=c,!this._act&&this._ts&&(this._act=1,this._lazy=0),!r&&s&&!t&&!f&&(Yn(this,`onStart`),this._tTime!==s))return this;for(l=this._pt;l;)l.r(m,l.d),l=l._next;h&&h.render(e<0?e:h._dur*h._ease(c/this._dur),t,n)||this._startAt&&(this._zTime=e),this._onUpdate&&!t&&(o&&an(this,e,t,n),Yn(this,`onUpdate`)),this._repeat&&u!==f&&this.vars.onRepeat&&!t&&this.parent&&Yn(this,`onRepeat`),(s===this._tDur||!s)&&this._tTime===s&&(o&&!this._onUpdate&&an(this,e,!0,!0),(e||!a)&&(s===this._tDur&&this._ts>0||!s&&this._ts<0)&&tn(this,1),!t&&(!o||r)&&(s||r||p)&&(Yn(this,s===i?`onComplete`:`onReverseComplete`,!0),this._prom&&!(s<i&&this.timeScale()>0)&&this._prom()))}return this},n.targets=function(){return this._targets},n.invalidate=function(t){return(!t||!this.vars.runBackwards)&&(this._startAt=0),this._pt=this._op=this._onUpdate=this._lazy=this.ratio=0,this._ptLookup=[],this.timeline&&this.timeline.invalidate(t),e.prototype.invalidate.call(this,t)},n.resetTo=function(e,t,n,r,i){lr||ur.wake(),this._ts||this.play();var a=Math.min(this._dur,(this._dp._time-this._start)*this._ts),o;return this._initted||Nr(this,a),o=this._ease(a/this._dur),Pr(this,e,t,n,r,o,a,i)?this.resetTo(e,t,n,r,1):(dn(this,0),this.parent||$t(this._dp,this,`_first`,`_last`,this._dp._sort?`_start`:0),this.render(0))},n.kill=function(e,t){if(t===void 0&&(t=`all`),!e&&(!t||t===`all`))return this._lazy=this._pt=0,this.parent?Xn(this):this.scrollTrigger&&this.scrollTrigger.kill(!!Fe),this;if(this.timeline){var n=this.timeline.totalDuration();return this.timeline.killTweensOf(e,t,jr&&jr.vars.overwrite!==!0)._first||Xn(this),this.parent&&n!==this.timeline.totalDuration()&&bn(this,this._dur*this.timeline._tDur/n,0,1),this}var r=this._targets,i=e?Mn(e):r,a=this._ptLookup,o=this._pt,s,c,l,u,d,f,p;if((!t||t===`all`)&&Qt(r,i))return t===`all`&&(this._pt=0),Xn(this);for(s=this._op=this._op||[],t!==`all`&&(z(t)&&(d={},It(t,function(e){return d[e]=1}),t=d),t=Fr(r,t)),p=r.length;p--;)if(~i.indexOf(r[p]))for(d in c=a[p],t===`all`?(s[p]=t,u=c,l={}):(l=s[p]=s[p]||{},u=t),u)f=c&&c[d],f&&((!(`kill`in f.d)||f.d.kill(d)===!0)&&en(this,f,`_pt`),delete c[d]),l!==`all`&&(l[d]=1);return this._initted&&!this._pt&&o&&Xn(this),this},t.to=function(e,n){return new t(e,n,arguments[2])},t.from=function(e,t){return wn(1,arguments)},t.delayedCall=function(e,n,r,i){return new t(n,0,{immediateRender:!1,lazy:!1,overwrite:!1,delay:e,onComplete:n,onReverseComplete:n,onCompleteParams:r,onReverseCompleteParams:r,callbackScope:i})},t.fromTo=function(e,t,n){return wn(2,arguments)},t.set=function(e,n){return n.duration=0,n.repeatDelay||(n.repeat=0),new t(e,n)},t.killTweensOf=function(e,t,n){return lt.killTweensOf(e,t,n)},t}(Tr);Kt(Br.prototype,{_targets:[],_lazy:0,_startAt:0,_op:0,_onInit:0}),It(`staggerTo,staggerFrom,staggerFromTo`,function(e){Br[e]=function(){var t=new Er,n=kn.call(arguments,0);return n.splice(e===`staggerFromTo`?5:4,0,0),t[e].apply(t,n)}});var Vr=function(e,t,n){return e[t]=n},Hr=function(e,t,n){return e[t](n)},Ur=function(e,t,n,r){return e[t](r.fp,n)},Wr=function(e,t,n){return e.setAttribute(t,n)},Gr=function(e,t){return Ge(e[t])?Hr:qe(e[t])&&e.setAttribute?Wr:Vr},Kr=function(e,t){return t.set(t.t,t.p,Math.round((t.s+t.c*e)*1e6)/1e6,t)},qr=function(e,t){return t.set(t.t,t.p,!!(t.s+t.c*e),t)},Jr=function(e,t){var n=t._pt,r=``;if(!e&&t.b)r=t.b;else if(e===1&&t.e)r=t.e;else{for(;n;)r=n.p+(n.m?n.m(n.s+n.c*e):Math.round((n.s+n.c*e)*1e4)/1e4)+r,n=n._next;r+=t.c}t.set(t.t,t.p,r,t)},Yr=function(e,t){for(var n=t._pt;n;)n.r(e,n.d),n=n._next},Xr=function(e,t,n,r){for(var i=this._pt,a;i;)a=i._next,i.p===r&&i.modifier(e,t,n),i=a},Zr=function(e){for(var t=this._pt,n,r;t;)r=t._next,t.p===e&&!t.op||t.op===e?en(this,t,`_pt`):t.dep||(n=1),t=r;return!n},Qr=function(e,t,n,r){r.mSet(e,t,r.m.call(r.tween,n,r.mt),r)},$r=function(e){for(var t=e._pt,n,r,i,a;t;){for(n=t._next,r=i;r&&r.pr>t.pr;)r=r._next;(t._prev=r?r._prev:a)?t._prev._next=t:i=t,(t._next=r)?r._prev=t:a=t,t=n}e._pt=i},ei=function(){function e(e,t,n,r,i,a,o,s,c){this.t=t,this.s=r,this.c=i,this.p=n,this.r=a||Kr,this.d=o||this,this.set=s||Vr,this.pr=c||0,this._next=e,e&&(e._prev=this)}var t=e.prototype;return t.modifier=function(e,t,n){this.mSet=this.mSet||this.set,this.set=Qr,this.m=e,this.mt=n,this.tween=t},e}();It(Mt+`parent,duration,ease,delay,overwrite,runBackwards,startAt,yoyo,immediateRender,repeat,repeatDelay,data,paused,reversed,lazy,callbackScope,stringFilter,id,yoyoEase,stagger,inherit,repeatRefresh,keyframes,autoRevert,scrollTrigger,easeReverse`,function(e){return wt[e]=1}),pt.TweenMax=pt.TweenLite=Br,pt.TimelineLite=pt.TimelineMax=Er,lt=new Er({sortChildren:!1,defaults:Ne,autoRemoveChildren:!0,id:`root`,smoothChildTiming:!0}),Me.stringFilter=cr;var ti=[],ni={},ri=[],ii=0,ai=0,oi=function(e){return(ni[e]||ri).map(function(e){return e()})},si=function(){var e=Date.now(),t=[];e-ii>2&&(oi(`matchMediaInit`),ti.forEach(function(e){var n=e.queries,r=e.conditions,i,a,o,s;for(a in n)i=ut.matchMedia(n[a]).matches,i&&(o=1),i!==r[a]&&(r[a]=i,s=1);s&&(e.revert(),o&&t.push(e))}),oi(`matchMediaRevert`),t.forEach(function(e){return e.onMatch(e,function(t){return e.add(null,t)})}),ii=e,oi(`matchMedia`))},ci=function(){function e(e,t){this.selector=t&&Nn(t),this.data=[],this._r=[],this.isReverted=!1,this.id=ai++,e&&this.add(e)}var t=e.prototype;return t.add=function(e,t,n){Ge(e)&&(n=t,t=e,e=Ge);var r=this,i=function(){var e=Ie,i=r.selector,a;return e&&e!==r&&e.data.push(r),n&&(r.selector=Nn(n)),Ie=r,a=t.apply(r,arguments),Ge(a)&&r._r.push(a),Ie=e,r.selector=i,r.isReverted=!1,a};return r.last=i,e===Ge?i(r,function(e){return r.add(null,e)}):e?r[e]=i:i},t.ignore=function(e){var t=Ie;Ie=null,e(this),Ie=t},t.getTweens=function(){var t=[];return this.data.forEach(function(n){return n instanceof e?t.push.apply(t,n.getTweens()):n instanceof Br&&!(n.parent&&n.parent.data===`nested`)&&t.push(n)}),t},t.clear=function(){this._r.length=this.data.length=0},t.kill=function(e,t){var n=this;if(e?(function(){for(var t=n.getTweens(),r=n.data.length,i;r--;)i=n.data[r],i.data===`isFlip`&&(i.revert(),i.getChildren(!0,!0,!1).forEach(function(e){return t.splice(t.indexOf(e),1)}));for(t.map(function(e){return{g:e._dur||e._delay||e._sat&&!e._sat.vars.immediateRender?e.globalTime(0):-1/0,t:e}}).sort(function(e,t){return t.g-e.g||-1/0}).forEach(function(t){return t.t.revert(e)}),r=n.data.length;r--;)i=n.data[r],i instanceof Er?i.data!==`nested`&&(i.scrollTrigger&&i.scrollTrigger.revert(),i.kill()):!(i instanceof Br)&&i.revert&&i.revert(e);n._r.forEach(function(t){return t(e,n)}),n.isReverted=!0})():this.data.forEach(function(e){return e.kill&&e.kill()}),this.clear(),t)for(var r=ti.length;r--;)ti[r].id===this.id&&ti.splice(r,1)},t.revert=function(e){this.kill(e||{})},e}(),li=function(){function e(e){this.contexts=[],this.scope=e,Ie&&Ie.data.push(this)}var t=e.prototype;return t.add=function(e,t,n){Je(e)||(e={matches:e});var r=new ci(0,n||this.scope),i=r.conditions={},a,o,s;for(o in Ie&&!r.selector&&(r.selector=Ie.selector),this.contexts.push(r),t=r.add(`onMatch`,t),r.queries=e,e)o===`all`?s=1:(a=ut.matchMedia(e[o]),a&&(ti.indexOf(r)<0&&ti.push(r),(i[o]=a.matches)&&(s=1),a.addListener?a.addListener(si):a.addEventListener(`change`,si)));return s&&t(r,function(e){return r.add(null,e)}),this},t.revert=function(e){this.kill(e||{})},t.kill=function(e){this.contexts.forEach(function(t){return t.kill(e,!0)})},e}(),ui={registerPlugin:function(){[...arguments].forEach(function(e){return $n(e)})},timeline:function(e){return new Er(e)},getTweensOf:function(e,t){return lt.getTweensOf(e,t)},getProperty:function(e,t,n,r){z(e)&&(e=Mn(e)[0]);var i=Pt(e||{}).get,a=n?Gt:Wt;return n===`native`&&(n=``),e&&(t?a((Ot[t]&&Ot[t].get||i)(e,t,n,r)):function(t,n,r){return a((Ot[t]&&Ot[t].get||i)(e,t,n,r))})},quickSetter:function(e,t,n){if(e=Mn(e),e.length>1){var r=e.map(function(e){return mi.quickSetter(e,t,n)}),i=r.length;return function(e){for(var t=i;t--;)r[t](e)}}e=e[0]||{};var a=Ot[t],o=Pt(e),s=o.harness&&(o.harness.aliases||{})[t]||t,c=a?function(t){var r=new a;Zn._pt=0,r.init(e,n?t+n:t,Zn,0,[e]),r.render(1,r),Zn._pt&&Yr(1,Zn)}:o.set(e,s);return a?c:function(t){return c(e,s,n?t+n:t,o,1)}},quickTo:function(e,t,n){var r,i=mi.to(e,Kt((r={},r[t]=`+=0.1`,r.paused=!0,r.stagger=0,r),n||{})),a=function(e,n,r){return i.resetTo(t,e,n,r)};return a.tween=i,a},isTweening:function(e){return lt.getTweensOf(e,!0).length>0},defaults:function(e){return e&&e.ease&&(e.ease=yr(e.ease,Ne.ease)),Yt(Ne,e||{})},config:function(e){return Yt(Me,e||{})},registerEffect:function(e){var t=e.name,n=e.effect,r=e.plugins,i=e.defaults,a=e.extendTimeline;(r||``).split(`,`).forEach(function(e){return e&&!Ot[e]&&!pt[e]&&vt(t+` effect requires `+e+` plugin.`)}),kt[t]=function(e,t,r){return n(Mn(e),Kt(t||{},i),r)},a&&(Er.prototype[t]=function(e,n,r){return this.add(kt[t](e,Je(n)?n:(r=n)&&{},this),r)})},registerEase:function(e,t){fr[e]=yr(t)},parseEase:function(e,t){return arguments.length?yr(e,t):fr},getById:function(e){return lt.getById(e)},exportRoot:function(e,t){e===void 0&&(e={});var n=new Er(e),r,i;for(n.smoothChildTiming=Ye(e.smoothChildTiming),lt.remove(n),n._dp=0,n._time=n._tTime=lt._time,r=lt._first;r;)i=r._next,(t||!(!r._dur&&r instanceof Br&&r.vars.onComplete===r._targets[0]))&&pn(n,r,r._start-r._delay),r=i;return pn(lt,n,0),n},context:function(e,t){return e?new ci(e,t):Ie},matchMedia:function(e){return new li(e)},matchMediaRefresh:function(){return ti.forEach(function(e){var t=e.conditions,n,r;for(r in t)t[r]&&(t[r]=!1,n=1);n&&e.revert()})||si()},addEventListener:function(e,t){var n=ni[e]||(ni[e]=[]);~n.indexOf(t)||n.push(t)},removeEventListener:function(e,t){var n=ni[e],r=n&&n.indexOf(t);r>=0&&n.splice(r,1)},utils:{wrap:Un,wrapYoyo:Wn,distribute:Fn,random:Rn,snap:Ln,normalize:Vn,getUnit:Dn,clamp:On,splitColor:rr,toArray:Mn,selector:Nn,mapRange:Kn,pipe:zn,unitize:Bn,interpolate:qn,shuffle:Pn},install:gt,effects:kt,ticker:ur,updateRoot:Er.updateRoot,plugins:Ot,globalTimeline:lt,core:{PropTween:ei,globals:yt,Tween:Br,Timeline:Er,Animation:Tr,getCache:Pt,_removeLinkedListItem:en,reverting:function(){return Fe},context:function(e){return e&&Ie&&(Ie.data.push(e),e._ctx=Ie),Ie},suppressOverwrites:function(e){return Pe=e}}};It(`to,from,fromTo,delayedCall,set,killTweensOf`,function(e){return ui[e]=Br[e]}),ur.add(Er.updateRoot),Zn=ui.to({},{duration:0});var di=function(e,t){for(var n=e._pt;n&&n.p!==t&&n.op!==t&&n.fp!==t;)n=n._next;return n},fi=function(e,t){var n=e._targets,r,i,a;for(r in t)for(i=n.length;i--;)a=e._ptLookup[i][r],(a&&=a.d)&&(a._pt&&(a=di(a,r)),a&&a.modifier&&a.modifier(t[r],e,n[i],r))},pi=function(e,t){return{name:e,headless:1,rawVars:1,init:function(e,n,r){r._onInit=function(e){var r,i;if(z(n)&&(r={},It(n,function(e){return r[e]=1}),n=r),t){for(i in r={},n)r[i]=t(n[i]);n=r}fi(e,n)}}}},mi=ui.registerPlugin({name:`attr`,init:function(e,t,n,r,i){var a,o,s;for(a in this.tween=n,t)s=e.getAttribute(a)||``,o=this.add(e,`setAttribute`,(s||0)+``,t[a],r,i,0,0,a),o.op=a,o.b=s,this._props.push(a)},render:function(e,t){for(var n=t._pt;n;)Fe?n.set(n.t,n.p,n.b,n):n.r(e,n.d),n=n._next}},{name:`endArray`,headless:1,init:function(e,t){for(var n=t.length;n--;)this.add(e,n,e[n]||0,t[n],0,0,0,0,0,1)}},pi(`roundProps`,In),pi(`modifiers`),pi(`snap`,Ln))||ui;Br.version=Er.version=mi.version=`3.15.0`,ht=1,Xe()&&dr(),fr.Power0,fr.Power1,fr.Power2,fr.Power3,fr.Power4,fr.Linear,fr.Quad,fr.Cubic,fr.Quart,fr.Quint,fr.Strong,fr.Elastic,fr.Back,fr.SteppedEase,fr.Bounce,fr.Sine,fr.Expo,fr.Circ;var hi,gi,_i,vi,yi,bi,xi,Si=function(){return typeof window<`u`},Ci={},wi=180/Math.PI,Ti=Math.PI/180,Ei=Math.atan2,Di=1e8,Oi=/([A-Z])/g,ki=/(left|right|width|margin|padding|x)/i,Ai=/[\s,\(]\S/,ji={autoAlpha:`opacity,visibility`,scale:`scaleX,scaleY`,alpha:`opacity`},Mi=function(e,t){return t.set(t.t,t.p,Math.round((t.s+t.c*e)*1e4)/1e4+t.u,t)},Ni=function(e,t){return t.set(t.t,t.p,e===1?t.e:Math.round((t.s+t.c*e)*1e4)/1e4+t.u,t)},Pi=function(e,t){return t.set(t.t,t.p,e?Math.round((t.s+t.c*e)*1e4)/1e4+t.u:t.b,t)},Fi=function(e,t){return t.set(t.t,t.p,e===1?t.e:e?Math.round((t.s+t.c*e)*1e4)/1e4+t.u:t.b,t)},Ii=function(e,t){var n=t.s+t.c*e;t.set(t.t,t.p,~~(n+(n<0?-.5:.5))+t.u,t)},Li=function(e,t){return t.set(t.t,t.p,e?t.e:t.b,t)},Ri=function(e,t){return t.set(t.t,t.p,e===1?t.e:t.b,t)},zi=function(e,t,n){return e.style[t]=n},Bi=function(e,t,n){return e.style.setProperty(t,n)},Vi=function(e,t,n){return e._gsap[t]=n},Hi=function(e,t,n){return e._gsap.scaleX=e._gsap.scaleY=n},Ui=function(e,t,n,r,i){var a=e._gsap;a.scaleX=a.scaleY=n,a.renderTransform(i,a)},Wi=function(e,t,n,r,i){var a=e._gsap;a[t]=n,a.renderTransform(i,a)},Gi=`transform`,Ki=Gi+`Origin`,qi=function e(t,n){var r=this,i=this.target,a=i.style,o=i._gsap;if(t in Ci&&a){if(this.tfm=this.tfm||{},t!==`transform`)t=ji[t]||t,~t.indexOf(`,`)?t.split(`,`).forEach(function(e){return r.tfm[e]=fa(i,e)}):this.tfm[t]=o.x?o[t]:fa(i,t),t===Ki&&(this.tfm.zOrigin=o.zOrigin);else return ji.transform.split(`,`).forEach(function(t){return e.call(r,t,n)});if(this.props.indexOf(Gi)>=0)return;o.svg&&(this.svgo=i.getAttribute(`data-svg-origin`),this.props.push(Ki,n,``)),t=Gi}(a||n)&&this.props.push(t,n,a[t])},Ji=function(e){e.translate&&(e.removeProperty(`translate`),e.removeProperty(`scale`),e.removeProperty(`rotate`))},Yi=function(){for(var e=this.props,t=this.target,n=t.style,r=t._gsap,i=0,a;i<e.length;i+=3)e[i+1]?e[i+1]===2?t[e[i]](e[i+2]):t[e[i]]=e[i+2]:e[i+2]?n[e[i]]=e[i+2]:n.removeProperty(e[i].substr(0,2)===`--`?e[i]:e[i].replace(Oi,`-$1`).toLowerCase());if(this.tfm){for(a in this.tfm)r[a]=this.tfm[a];r.svg&&(r.renderTransform(),t.setAttribute(`data-svg-origin`,this.svgo||``)),i=xi(),(!i||!i.isStart)&&!n[Gi]&&(Ji(n),r.zOrigin&&n[Ki]&&(n[Ki]+=` `+r.zOrigin+`px`,r.zOrigin=0,r.renderTransform()),r.uncache=1)}},Xi=function(e,t){var n={target:e,props:[],revert:Yi,save:qi};return e._gsap||mi.core.getCache(e),t&&e.style&&e.nodeType&&t.split(`,`).forEach(function(e){return n.save(e)}),n},Zi,Qi=function(e,t){var n=gi.createElementNS?gi.createElementNS((t||`http://www.w3.org/1999/xhtml`).replace(/^https/,`http`),e):gi.createElement(e);return n&&n.style?n:gi.createElement(e)},$i=function e(t,n,r){var i=getComputedStyle(t);return i[n]||i.getPropertyValue(n.replace(Oi,`-$1`).toLowerCase())||i.getPropertyValue(n)||!r&&e(t,ta(n)||n,1)||``},ea=`O,Moz,ms,Ms,Webkit`.split(`,`),ta=function(e,t,n){var r=(t||yi).style,i=5;if(e in r&&!n)return e;for(e=e.charAt(0).toUpperCase()+e.substr(1);i--&&!(ea[i]+e in r););return i<0?null:(i===3?`ms`:i>=0?ea[i]:``)+e},na=function(){Si()&&window.document&&(hi=window,gi=hi.document,_i=gi.documentElement,yi=Qi(`div`)||{style:{}},Qi(`div`),Gi=ta(Gi),Ki=Gi+`Origin`,yi.style.cssText=`border-width:0;line-height:0;position:absolute;padding:0`,Zi=!!ta(`perspective`),xi=mi.core.reverting,vi=1)},ra=function(e){var t=e.ownerSVGElement,n=Qi(`svg`,t&&t.getAttribute(`xmlns`)||`http://www.w3.org/2000/svg`),r=e.cloneNode(!0),i;r.style.display=`block`,n.appendChild(r),_i.appendChild(n);try{i=r.getBBox()}catch{}return n.removeChild(r),_i.removeChild(n),i},ia=function(e,t){for(var n=t.length;n--;)if(e.hasAttribute(t[n]))return e.getAttribute(t[n])},aa=function(e){var t,n;try{t=e.getBBox()}catch{t=ra(e),n=1}return t&&(t.width||t.height)||n||(t=ra(e)),t&&!t.width&&!t.x&&!t.y?{x:+ia(e,[`x`,`cx`,`x1`])||0,y:+ia(e,[`y`,`cy`,`y1`])||0,width:0,height:0}:t},oa=function(e){return!(!e.getCTM||e.parentNode&&!e.ownerSVGElement||!aa(e))},sa=function(e,t){if(t){var n=e.style,r;t in Ci&&t!==Ki&&(t=Gi),n.removeProperty?(r=t.substr(0,2),(r===`ms`||t.substr(0,6)===`webkit`)&&(t=`-`+t),n.removeProperty(r===`--`?t:t.replace(Oi,`-$1`).toLowerCase())):n.removeAttribute(t)}},ca=function(e,t,n,r,i,a){var o=new ei(e._pt,t,n,0,1,a?Ri:Li);return e._pt=o,o.b=r,o.e=i,e._props.push(n),o},la={deg:1,rad:1,turn:1},ua={grid:1,flex:1},da=function e(t,n,r,i){var a=parseFloat(r)||0,o=(r+``).trim().substr((a+``).length)||`px`,s=yi.style,c=ki.test(n),l=t.tagName.toLowerCase()===`svg`,u=(l?`client`:`offset`)+(c?`Width`:`Height`),d=100,f=i===`px`,p=i===`%`,m,h,g,_;if(i===o||!a||la[i]||la[o])return a;if(o!==`px`&&!f&&(a=e(t,n,r,`px`)),_=t.getCTM&&oa(t),(p||o===`%`)&&(Ci[n]||~n.indexOf(`adius`)))return m=_?t.getBBox()[c?`width`:`height`]:t[u],Lt(p?a/m*d:a/100*m);if(s[c?`width`:`height`]=d+(f?o:i),h=i!==`rem`&&~n.indexOf(`adius`)||i===`em`&&t.appendChild&&!l?t:t.parentNode,_&&(h=(t.ownerSVGElement||{}).parentNode),(!h||h===gi||!h.appendChild)&&(h=gi.body),g=h._gsap,g&&p&&g.width&&c&&g.time===ur.time&&!g.uncache)return Lt(a/g.width*d);if(p&&(n===`height`||n===`width`)){var v=t.style[n];t.style[n]=d+i,m=t[u],v?t.style[n]=v:sa(t,n)}else(p||o===`%`)&&!ua[$i(h,`display`)]&&(s.position=$i(t,`position`)),h===t&&(s.position=`static`),h.appendChild(yi),m=yi[u],h.removeChild(yi),s.position=`absolute`;return c&&p&&(g=Pt(h),g.time=ur.time,g.width=h[u]),Lt(f?m*a/d:m&&a?d/m*a:0)},fa=function(e,t,n,r){var i;return vi||na(),t in ji&&t!==`transform`&&(t=ji[t],~t.indexOf(`,`)&&(t=t.split(`,`)[0])),Ci[t]&&t!==`transform`?(i=wa(e,r),i=t===`transformOrigin`?i.svg?i.origin:Ta($i(e,Ki))+` `+i.zOrigin+`px`:i[t]):(i=e.style[t],(!i||i===`auto`||r||~(i+``).indexOf(`calc(`))&&(i=_a[t]&&_a[t](e,t,n)||$i(e,t)||Ft(e,t)||+(t===`opacity`))),n&&!~(i+``).trim().indexOf(` `)?da(e,t,i,n)+n:i},pa=function(e,t,n,r){if(!n||n===`none`){var i=ta(t,e,1),a=i&&$i(e,i,1);a&&a!==n?(t=i,n=a):t===`borderColor`&&(n=$i(e,`borderTopColor`))}var o=new ei(this._pt,e.style,t,0,1,Jr),s=0,c=0,l,u,d,f,p,m,h,g,_,v,y,b;if(o.b=n,o.e=r,n+=``,r+=``,r.substring(0,6)===`var(--`&&(r=$i(e,r.substring(4,r.indexOf(`)`)))),r===`auto`&&(m=e.style[t],e.style[t]=r,r=$i(e,t)||r,m?e.style[t]=m:sa(e,t)),l=[n,r],cr(l),n=l[0],r=l[1],d=n.match(it)||[],b=r.match(it)||[],b.length){for(;u=it.exec(r);)h=u[0],_=r.substring(s,u.index),p?p=(p+1)%5:(_.substr(-5)===`rgba(`||_.substr(-5)===`hsla(`)&&(p=1),h!==(m=d[c++]||``)&&(f=parseFloat(m)||0,y=m.substr((f+``).length),h.charAt(1)===`=`&&(h=zt(f,h)+y),g=parseFloat(h),v=h.substr((g+``).length),s=it.lastIndex-v.length,v||(v=v||Me.units[t]||y,s===r.length&&(r+=v,o.e+=v)),y!==v&&(f=da(e,t,m,v)||0),o._pt={_next:o._pt,p:_||c===1?_:`,`,s:f,c:g-f,m:p&&p<4||t===`zIndex`?Math.round:0});o.c=s<r.length?r.substring(s,r.length):``}else o.r=t===`display`&&r===`none`?Ri:Li;return ot.test(r)&&(o.e=0),this._pt=o,o},ma={top:`0%`,bottom:`100%`,left:`0%`,right:`100%`,center:`50%`},ha=function(e){var t=e.split(` `),n=t[0],r=t[1]||`50%`;return(n===`top`||n===`bottom`||r===`left`||r===`right`)&&(e=n,n=r,r=e),t[0]=ma[n]||n,t[1]=ma[r]||r,t.join(` `)},ga=function(e,t){if(t.tween&&t.tween._time===t.tween._dur){var n=t.t,r=n.style,i=t.u,a=n._gsap,o,s,c;if(i===`all`||i===!0)r.cssText=``,s=1;else for(i=i.split(`,`),c=i.length;--c>-1;)o=i[c],Ci[o]&&(s=1,o=o===`transformOrigin`?Ki:Gi),sa(n,o);s&&(sa(n,Gi),a&&(a.svg&&n.removeAttribute(`transform`),r.scale=r.rotate=r.translate=`none`,wa(n,1),a.uncache=1,Ji(r)))}},_a={clearProps:function(e,t,n,r,i){if(i.data!==`isFromStart`){var a=e._pt=new ei(e._pt,t,n,0,0,ga);return a.u=r,a.pr=-10,a.tween=i,e._props.push(n),1}}},va=[1,0,0,1,0,0],ya={},ba=function(e){return e===`matrix(1, 0, 0, 1, 0, 0)`||e===`none`||!e},xa=function(e){var t=$i(e,Gi);return ba(t)?va:t.substr(7).match(rt).map(Lt)},Sa=function(e,t){var n=e._gsap||Pt(e),r=e.style,i=xa(e),a,o,s,c;return n.svg&&e.getAttribute(`transform`)?(s=e.transform.baseVal.consolidate().matrix,i=[s.a,s.b,s.c,s.d,s.e,s.f],i.join(`,`)===`1,0,0,1,0,0`?va:i):(i===va&&!e.offsetParent&&e!==_i&&!n.svg&&(s=r.display,r.display=`block`,a=e.parentNode,(!a||!e.offsetParent&&!e.getBoundingClientRect().width)&&(c=1,o=e.nextElementSibling,_i.appendChild(e)),i=xa(e),s?r.display=s:sa(e,`display`),c&&(o?a.insertBefore(e,o):a?a.appendChild(e):_i.removeChild(e))),t&&i.length>6?[i[0],i[1],i[4],i[5],i[12],i[13]]:i)},Ca=function(e,t,n,r,i,a){var o=e._gsap,s=i||Sa(e,!0),c=o.xOrigin||0,l=o.yOrigin||0,u=o.xOffset||0,d=o.yOffset||0,f=s[0],p=s[1],m=s[2],h=s[3],g=s[4],_=s[5],v=t.split(` `),y=parseFloat(v[0])||0,b=parseFloat(v[1])||0,x,S,C,w;n?s!==va&&(S=f*h-p*m)&&(C=h/S*y+b*(-m/S)+(m*_-h*g)/S,w=y*(-p/S)+f/S*b-(f*_-p*g)/S,y=C,b=w):(x=aa(e),y=x.x+(~v[0].indexOf(`%`)?y/100*x.width:y),b=x.y+(~(v[1]||v[0]).indexOf(`%`)?b/100*x.height:b)),r||r!==!1&&o.smooth?(g=y-c,_=b-l,o.xOffset=u+(g*f+_*m)-g,o.yOffset=d+(g*p+_*h)-_):o.xOffset=o.yOffset=0,o.xOrigin=y,o.yOrigin=b,o.smooth=!!r,o.origin=t,o.originIsAbsolute=!!n,e.style[Ki]=`0px 0px`,a&&(ca(a,o,`xOrigin`,c,y),ca(a,o,`yOrigin`,l,b),ca(a,o,`xOffset`,u,o.xOffset),ca(a,o,`yOffset`,d,o.yOffset)),e.setAttribute(`data-svg-origin`,y+` `+b)},wa=function(e,t){var n=e._gsap||new wr(e);if(`x`in n&&!t&&!n.uncache)return n;var r=e.style,i=n.scaleX<0,a=`px`,o=`deg`,s=getComputedStyle(e),c=$i(e,Ki)||`0`,l=u=d=m=h=g=_=v=y=0,u,d,f=p=1,p,m,h,g,_,v,y,b,x,S,C,w,T,E,D,O,k,A,j,M,N,ee,te,ne,re,ie,ae,oe;return n.svg=!!(e.getCTM&&oa(e)),s.translate&&((s.translate!==`none`||s.scale!==`none`||s.rotate!==`none`)&&(r[Gi]=(s.translate===`none`?``:`translate3d(`+(s.translate+` 0 0`).split(` `).slice(0,3).join(`, `)+`) `)+(s.rotate===`none`?``:`rotate(`+s.rotate+`) `)+(s.scale===`none`?``:`scale(`+s.scale.split(` `).join(`,`)+`) `)+(s[Gi]===`none`?``:s[Gi])),r.scale=r.rotate=r.translate=`none`),S=Sa(e,n.svg),n.svg&&(n.uncache?(N=e.getBBox(),c=n.xOrigin-N.x+`px `+(n.yOrigin-N.y)+`px`,M=``):M=!t&&e.getAttribute(`data-svg-origin`),Ca(e,M||c,!!M||n.originIsAbsolute,n.smooth!==!1,S)),b=n.xOrigin||0,x=n.yOrigin||0,S!==va&&(E=S[0],D=S[1],O=S[2],k=S[3],l=A=S[4],u=j=S[5],S.length===6?(f=Math.sqrt(E*E+D*D),p=Math.sqrt(k*k+O*O),m=E||D?Ei(D,E)*wi:0,_=O||k?Ei(O,k)*wi+m:0,_&&(p*=Math.abs(Math.cos(_*Ti))),n.svg&&(l-=b-(b*E+x*O),u-=x-(b*D+x*k))):(oe=S[6],ie=S[7],te=S[8],ne=S[9],re=S[10],ae=S[11],l=S[12],u=S[13],d=S[14],C=Ei(oe,re),h=C*wi,C&&(w=Math.cos(-C),T=Math.sin(-C),M=A*w+te*T,N=j*w+ne*T,ee=oe*w+re*T,te=A*-T+te*w,ne=j*-T+ne*w,re=oe*-T+re*w,ae=ie*-T+ae*w,A=M,j=N,oe=ee),C=Ei(-O,re),g=C*wi,C&&(w=Math.cos(-C),T=Math.sin(-C),M=E*w-te*T,N=D*w-ne*T,ee=O*w-re*T,ae=k*T+ae*w,E=M,D=N,O=ee),C=Ei(D,E),m=C*wi,C&&(w=Math.cos(C),T=Math.sin(C),M=E*w+D*T,N=A*w+j*T,D=D*w-E*T,j=j*w-A*T,E=M,A=N),h&&Math.abs(h)+Math.abs(m)>359.9&&(h=m=0,g=180-g),f=Lt(Math.sqrt(E*E+D*D+O*O)),p=Lt(Math.sqrt(j*j+oe*oe)),C=Ei(A,j),_=Math.abs(C)>2e-4?C*wi:0,y=ae?1/(ae<0?-ae:ae):0),n.svg&&(M=e.getAttribute(`transform`),n.forceCSS=e.setAttribute(`transform`,``)||!ba($i(e,Gi)),M&&e.setAttribute(`transform`,M))),Math.abs(_)>90&&Math.abs(_)<270&&(i?(f*=-1,_+=m<=0?180:-180,m+=m<=0?180:-180):(p*=-1,_+=_<=0?180:-180)),t||=n.uncache,n.x=l-((n.xPercent=l&&(!t&&n.xPercent||(Math.round(e.offsetWidth/2)===Math.round(-l)?-50:0)))?e.offsetWidth*n.xPercent/100:0)+a,n.y=u-((n.yPercent=u&&(!t&&n.yPercent||(Math.round(e.offsetHeight/2)===Math.round(-u)?-50:0)))?e.offsetHeight*n.yPercent/100:0)+a,n.z=d+a,n.scaleX=Lt(f),n.scaleY=Lt(p),n.rotation=Lt(m)+o,n.rotationX=Lt(h)+o,n.rotationY=Lt(g)+o,n.skewX=_+o,n.skewY=v+o,n.transformPerspective=y+a,(n.zOrigin=parseFloat(c.split(` `)[2])||!t&&n.zOrigin||0)&&(r[Ki]=Ta(c)),n.xOffset=n.yOffset=0,n.force3D=Me.force3D,n.renderTransform=n.svg?Ma:Zi?ja:Da,n.uncache=0,n},Ta=function(e){return(e=e.split(` `))[0]+` `+e[1]},Ea=function(e,t,n){var r=Dn(t);return Lt(parseFloat(t)+parseFloat(da(e,`x`,n+`px`,r)))+r},Da=function(e,t){t.z=`0px`,t.rotationY=t.rotationX=`0deg`,t.force3D=0,ja(e,t)},Oa=`0deg`,ka=`0px`,Aa=`) `,ja=function(e,t){var n=t||this,r=n.xPercent,i=n.yPercent,a=n.x,o=n.y,s=n.z,c=n.rotation,l=n.rotationY,u=n.rotationX,d=n.skewX,f=n.skewY,p=n.scaleX,m=n.scaleY,h=n.transformPerspective,g=n.force3D,_=n.target,v=n.zOrigin,y=``,b=g===`auto`&&e&&e!==1||g===!0;if(v&&(u!==Oa||l!==Oa)){var x=parseFloat(l)*Ti,S=Math.sin(x),C=Math.cos(x),w;x=parseFloat(u)*Ti,w=Math.cos(x),a=Ea(_,a,S*w*-v),o=Ea(_,o,-Math.sin(x)*-v),s=Ea(_,s,C*w*-v+v)}h!==ka&&(y+=`perspective(`+h+Aa),(r||i)&&(y+=`translate(`+r+`%, `+i+`%) `),(b||a!==ka||o!==ka||s!==ka)&&(y+=s!==ka||b?`translate3d(`+a+`, `+o+`, `+s+`) `:`translate(`+a+`, `+o+Aa),c!==Oa&&(y+=`rotate(`+c+Aa),l!==Oa&&(y+=`rotateY(`+l+Aa),u!==Oa&&(y+=`rotateX(`+u+Aa),(d!==Oa||f!==Oa)&&(y+=`skew(`+d+`, `+f+Aa),(p!==1||m!==1)&&(y+=`scale(`+p+`, `+m+Aa),_.style[Gi]=y||`translate(0, 0)`},Ma=function(e,t){var n=t||this,r=n.xPercent,i=n.yPercent,a=n.x,o=n.y,s=n.rotation,c=n.skewX,l=n.skewY,u=n.scaleX,d=n.scaleY,f=n.target,p=n.xOrigin,m=n.yOrigin,h=n.xOffset,g=n.yOffset,_=n.forceCSS,v=parseFloat(a),y=parseFloat(o),b,x,S,C,w;s=parseFloat(s),c=parseFloat(c),l=parseFloat(l),l&&(l=parseFloat(l),c+=l,s+=l),s||c?(s*=Ti,c*=Ti,b=Math.cos(s)*u,x=Math.sin(s)*u,S=Math.sin(s-c)*-d,C=Math.cos(s-c)*d,c&&(l*=Ti,w=Math.tan(c-l),w=Math.sqrt(1+w*w),S*=w,C*=w,l&&(w=Math.tan(l),w=Math.sqrt(1+w*w),b*=w,x*=w)),b=Lt(b),x=Lt(x),S=Lt(S),C=Lt(C)):(b=u,C=d,x=S=0),(v&&!~(a+``).indexOf(`px`)||y&&!~(o+``).indexOf(`px`))&&(v=da(f,`x`,a,`px`),y=da(f,`y`,o,`px`)),(p||m||h||g)&&(v=Lt(v+p-(p*b+m*S)+h),y=Lt(y+m-(p*x+m*C)+g)),(r||i)&&(w=f.getBBox(),v=Lt(v+r/100*w.width),y=Lt(y+i/100*w.height)),w=`matrix(`+b+`,`+x+`,`+S+`,`+C+`,`+v+`,`+y+`)`,f.setAttribute(`transform`,w),_&&(f.style[Gi]=w)},Na=function(e,t,n,r,i){var a=360,o=z(i),s=parseFloat(i)*(o&&~i.indexOf(`rad`)?wi:1)-r,c=r+s+`deg`,l,u;return o&&(l=i.split(`_`)[1],l===`short`&&(s%=a,s!==s%(a/2)&&(s+=s<0?a:-a)),l===`cw`&&s<0?s=(s+a*Di)%a-~~(s/a)*a:l===`ccw`&&s>0&&(s=(s-a*Di)%a-~~(s/a)*a)),e._pt=u=new ei(e._pt,t,n,r,s,Ni),u.e=c,u.u=`deg`,e._props.push(n),u},Pa=function(e,t){for(var n in t)e[n]=t[n];return e},Fa=function(e,t,n){var r=Pa({},n._gsap),i=`perspective,force3D,transformOrigin,svgOrigin`,a=n.style,o,s,c,l,u,d,f,p;for(s in r.svg?(c=n.getAttribute(`transform`),n.setAttribute(`transform`,``),a[Gi]=t,o=wa(n,1),sa(n,Gi),n.setAttribute(`transform`,c)):(c=getComputedStyle(n)[Gi],a[Gi]=t,o=wa(n,1),a[Gi]=c),Ci)c=r[s],l=o[s],c!==l&&i.indexOf(s)<0&&(f=Dn(c),p=Dn(l),u=f===p?parseFloat(c):da(n,s,c,p),d=parseFloat(l),e._pt=new ei(e._pt,o,s,u,d-u,Mi),e._pt.u=p||0,e._props.push(s));Pa(o,r)};It(`padding,margin,Width,Radius`,function(e,t){var n=`Top`,r=`Right`,i=`Bottom`,a=`Left`,o=(t<3?[n,r,i,a]:[n+a,n+r,i+r,i+a]).map(function(n){return t<2?e+n:`border`+n+e});_a[t>1?`border`+e:e]=function(e,t,n,r,i){var a,s;if(arguments.length<4)return a=o.map(function(t){return fa(e,t,n)}),s=a.join(` `),s.split(a[0]).length===5?a[0]:s;a=(r+``).split(` `),s={},o.forEach(function(e,t){return s[e]=a[t]=a[t]||a[(t-1)/2|0]}),e.init(t,s,i)}});var Ia={name:`css`,register:na,targetTest:function(e){return e.style&&e.nodeType},init:function(e,t,n,r,i){var a=this._props,o=e.style,s=n.vars.startAt,c,l,u,d,f,p,m,h,g,_,v,y,b,x,S,C,w;for(m in vi||na(),this.styles=this.styles||Xi(e),C=this.styles.props,this.tween=n,t)if(m!==`autoRound`&&(l=t[m],!(Ot[m]&&Ar(m,t,n,r,e,i)))){if(f=typeof l,p=_a[m],f===`function`&&(l=l.call(n,r,e,i),f=typeof l),f===`string`&&~l.indexOf(`random(`)&&(l=Gn(l)),p)p(this,e,m,l,n)&&(S=1);else if(m.substr(0,2)===`--`)c=(getComputedStyle(e).getPropertyValue(m)+``).trim(),l+=``,or.lastIndex=0,or.test(c)||(h=Dn(c),g=Dn(l),g?h!==g&&(c=da(e,m,c,g)+g):h&&(l+=h)),this.add(o,`setProperty`,c,l,r,i,0,0,m),a.push(m),C.push(m,0,o[m]);else if(f!==`undefined`){if(s&&m in s?(c=typeof s[m]==`function`?s[m].call(n,r,e,i):s[m],z(c)&&~c.indexOf(`random(`)&&(c=Gn(c)),Dn(c+``)||c===`auto`||(c+=Me.units[m]||Dn(fa(e,m))||``),(c+``).charAt(1)===`=`&&(c=fa(e,m))):c=fa(e,m),d=parseFloat(c),_=f===`string`&&l.charAt(1)===`=`&&l.substr(0,2),_&&(l=l.substr(2)),u=parseFloat(l),m in ji&&(m===`autoAlpha`&&(d===1&&fa(e,`visibility`)===`hidden`&&u&&(d=0),C.push(`visibility`,0,o.visibility),ca(this,o,`visibility`,d?`inherit`:`hidden`,u?`inherit`:`hidden`,!u)),m!==`scale`&&m!==`transform`&&(m=ji[m],~m.indexOf(`,`)&&(m=m.split(`,`)[0]))),v=m in Ci,v){if(this.styles.save(m),w=l,f===`string`&&l.substring(0,6)===`var(--`){if(l=$i(e,l.substring(4,l.indexOf(`)`))),l.substring(0,5)===`calc(`){var T=e.style.perspective;e.style.perspective=l,l=$i(e,`perspective`),T?e.style.perspective=T:sa(e,`perspective`)}u=parseFloat(l)}if(y||(b=e._gsap,b.renderTransform&&!t.parseTransform||wa(e,t.parseTransform),x=t.smoothOrigin!==!1&&b.smooth,y=this._pt=new ei(this._pt,o,Gi,0,1,b.renderTransform,b,0,-1),y.dep=1),m===`scale`)this._pt=new ei(this._pt,b,`scaleY`,b.scaleY,(_?zt(b.scaleY,_+u):u)-b.scaleY||0,Mi),this._pt.u=0,a.push(`scaleY`,m),m+=`X`;else if(m===`transformOrigin`){C.push(Ki,0,o[Ki]),l=ha(l),b.svg?Ca(e,l,0,x,0,this):(g=parseFloat(l.split(` `)[2])||0,g!==b.zOrigin&&ca(this,b,`zOrigin`,b.zOrigin,g),ca(this,o,m,Ta(c),Ta(l)));continue}else if(m===`svgOrigin`){Ca(e,l,1,x,0,this);continue}else if(m in ya){Na(this,b,m,d,_?zt(d,_+l):l);continue}else if(m===`smoothOrigin`){ca(this,b,`smooth`,b.smooth,l);continue}else if(m===`force3D`){b[m]=l;continue}else if(m===`transform`){Fa(this,l,e);continue}}else m in o||(m=ta(m)||m);if(v||(u||u===0)&&(d||d===0)&&!Ai.test(l)&&m in o)h=(c+``).substr((d+``).length),u||=0,g=Dn(l)||(m in Me.units?Me.units[m]:h),h!==g&&(d=da(e,m,c,g)),this._pt=new ei(this._pt,v?b:o,m,d,(_?zt(d,_+u):u)-d,!v&&(g===`px`||m===`zIndex`)&&t.autoRound!==!1?Ii:Mi),this._pt.u=g||0,v&&w!==l?(this._pt.b=c,this._pt.e=w,this._pt.r=Fi):h!==g&&g!==`%`&&(this._pt.b=c,this._pt.r=Pi);else if(m in o)pa.call(this,e,m,c,_?_+l:l);else if(m in e)this.add(e,m,c||e[m],_?_+l:l,r,i);else if(m!==`parseTransform`){_t(m,l);continue}v||(m in o?C.push(m,0,o[m]):typeof e[m]==`function`?C.push(m,2,e[m]()):C.push(m,1,c||e[m])),a.push(m)}}S&&$r(this)},render:function(e,t){if(t.tween._time||!xi())for(var n=t._pt;n;)n.r(e,n.d),n=n._next;else t.styles.revert()},get:fa,aliases:ji,getSetter:function(e,t,n){var r=ji[t];return r&&r.indexOf(`,`)<0&&(t=r),t in Ci&&t!==Ki&&(e._gsap.x||fa(e,`x`))?n&&bi===n?t===`scale`?Hi:Vi:(bi=n||{})&&(t===`scale`?Ui:Wi):e.style&&!qe(e.style[t])?zi:~t.indexOf(`-`)?Bi:Gr(e,t)},core:{_removeProperty:sa,_getMatrix:Sa}};mi.utils.checkPrefix=ta,mi.core.getStyleSaver=Xi,(function(e,t,n,r){var i=It(e+`,`+t+`,`+n,function(e){Ci[e]=1});It(t,function(e){Me.units[e]=`deg`,ya[e]=1}),ji[i[13]]=e+`,`+t,It(r,function(e){var t=e.split(`:`);ji[t[1]]=i[t[0]]})})(`x,y,z,scale,scaleX,scaleY,xPercent,yPercent`,`rotation,rotationX,rotationY,skewX,skewY`,`transform,transformOrigin,svgOrigin,force3D,smoothOrigin,transformPerspective`,`0:translateX,1:translateY,2:translateZ,8:rotate,8:rotationZ,8:rotateZ,9:rotateX,10:rotateY`),It(`x,y,z,top,right,bottom,left,width,height,fontSize,padding,margin,perspective`,function(e){Me.units[e]=`px`}),mi.registerPlugin(Ia);var La=mi.registerPlugin(Ia)||mi;La.core.Tween;var Ra=o(((e,t)=>{t.exports=function(){return typeof Promise==`function`&&Promise.prototype&&Promise.prototype.then}})),za=o((e=>{var t,n=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];e.getSymbolSize=function(e){if(!e)throw Error(`"version" cannot be null or undefined`);if(e<1||e>40)throw Error(`"version" should be in range from 1 to 40`);return e*4+17},e.getSymbolTotalCodewords=function(e){return n[e]},e.getBCHDigit=function(e){let t=0;for(;e!==0;)t++,e>>>=1;return t},e.setToSJISFunction=function(e){if(typeof e!=`function`)throw Error(`"toSJISFunc" is not a valid function.`);t=e},e.isKanjiModeEnabled=function(){return t!==void 0},e.toSJIS=function(e){return t(e)}})),Ba=o((e=>{e.L={bit:1},e.M={bit:0},e.Q={bit:3},e.H={bit:2};function t(t){if(typeof t!=`string`)throw Error(`Param is not a string`);switch(t.toLowerCase()){case`l`:case`low`:return e.L;case`m`:case`medium`:return e.M;case`q`:case`quartile`:return e.Q;case`h`:case`high`:return e.H;default:throw Error(`Unknown EC Level: `+t)}}e.isValid=function(e){return e&&e.bit!==void 0&&e.bit>=0&&e.bit<4},e.from=function(n,r){if(e.isValid(n))return n;try{return t(n)}catch{return r}}})),Va=o(((e,t)=>{function n(){this.buffer=[],this.length=0}n.prototype={get:function(e){let t=Math.floor(e/8);return(this.buffer[t]>>>7-e%8&1)==1},put:function(e,t){for(let n=0;n<t;n++)this.putBit((e>>>t-n-1&1)==1)},getLengthInBits:function(){return this.length},putBit:function(e){let t=Math.floor(this.length/8);this.buffer.length<=t&&this.buffer.push(0),e&&(this.buffer[t]|=128>>>this.length%8),this.length++}},t.exports=n})),Ha=o(((e,t)=>{function n(e){if(!e||e<1)throw Error(`BitMatrix size must be defined and greater than 0`);this.size=e,this.data=new Uint8Array(e*e),this.reservedBit=new Uint8Array(e*e)}n.prototype.set=function(e,t,n,r){let i=e*this.size+t;this.data[i]=n,r&&(this.reservedBit[i]=!0)},n.prototype.get=function(e,t){return this.data[e*this.size+t]},n.prototype.xor=function(e,t,n){this.data[e*this.size+t]^=n},n.prototype.isReserved=function(e,t){return this.reservedBit[e*this.size+t]},t.exports=n})),Ua=o((e=>{var t=za().getSymbolSize;e.getRowColCoords=function(e){if(e===1)return[];let n=Math.floor(e/7)+2,r=t(e),i=r===145?26:Math.ceil((r-13)/(2*n-2))*2,a=[r-7];for(let e=1;e<n-1;e++)a[e]=a[e-1]-i;return a.push(6),a.reverse()},e.getPositions=function(t){let n=[],r=e.getRowColCoords(t),i=r.length;for(let e=0;e<i;e++)for(let t=0;t<i;t++)e===0&&t===0||e===0&&t===i-1||e===i-1&&t===0||n.push([r[e],r[t]]);return n}})),Wa=o((e=>{var t=za().getSymbolSize,n=7;e.getPositions=function(e){let r=t(e);return[[0,0],[r-n,0],[0,r-n]]}})),Ga=o((e=>{e.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};var t={N1:3,N2:3,N3:40,N4:10};e.isValid=function(e){return e!=null&&e!==``&&!isNaN(e)&&e>=0&&e<=7},e.from=function(t){return e.isValid(t)?parseInt(t,10):void 0},e.getPenaltyN1=function(e){let n=e.size,r=0,i=0,a=0,o=null,s=null;for(let c=0;c<n;c++){i=a=0,o=s=null;for(let l=0;l<n;l++){let n=e.get(c,l);n===o?i++:(i>=5&&(r+=t.N1+(i-5)),o=n,i=1),n=e.get(l,c),n===s?a++:(a>=5&&(r+=t.N1+(a-5)),s=n,a=1)}i>=5&&(r+=t.N1+(i-5)),a>=5&&(r+=t.N1+(a-5))}return r},e.getPenaltyN2=function(e){let n=e.size,r=0;for(let t=0;t<n-1;t++)for(let i=0;i<n-1;i++){let n=e.get(t,i)+e.get(t,i+1)+e.get(t+1,i)+e.get(t+1,i+1);(n===4||n===0)&&r++}return r*t.N2},e.getPenaltyN3=function(e){let n=e.size,r=0,i=0,a=0;for(let t=0;t<n;t++){i=a=0;for(let o=0;o<n;o++)i=i<<1&2047|e.get(t,o),o>=10&&(i===1488||i===93)&&r++,a=a<<1&2047|e.get(o,t),o>=10&&(a===1488||a===93)&&r++}return r*t.N3},e.getPenaltyN4=function(e){let n=0,r=e.data.length;for(let t=0;t<r;t++)n+=e.data[t];return Math.abs(Math.ceil(n*100/r/5)-10)*t.N4};function n(t,n,r){switch(t){case e.Patterns.PATTERN000:return(n+r)%2==0;case e.Patterns.PATTERN001:return n%2==0;case e.Patterns.PATTERN010:return r%3==0;case e.Patterns.PATTERN011:return(n+r)%3==0;case e.Patterns.PATTERN100:return(Math.floor(n/2)+Math.floor(r/3))%2==0;case e.Patterns.PATTERN101:return n*r%2+n*r%3==0;case e.Patterns.PATTERN110:return(n*r%2+n*r%3)%2==0;case e.Patterns.PATTERN111:return(n*r%3+(n+r)%2)%2==0;default:throw Error(`bad maskPattern:`+t)}}e.applyMask=function(e,t){let r=t.size;for(let i=0;i<r;i++)for(let a=0;a<r;a++)t.isReserved(a,i)||t.xor(a,i,n(e,a,i))},e.getBestMask=function(t,n){let r=Object.keys(e.Patterns).length,i=0,a=1/0;for(let o=0;o<r;o++){n(o),e.applyMask(o,t);let r=e.getPenaltyN1(t)+e.getPenaltyN2(t)+e.getPenaltyN3(t)+e.getPenaltyN4(t);e.applyMask(o,t),r<a&&(a=r,i=o)}return i}})),Ka=o((e=>{var t=Ba(),n=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],r=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];e.getBlocksCount=function(e,r){switch(r){case t.L:return n[(e-1)*4+0];case t.M:return n[(e-1)*4+1];case t.Q:return n[(e-1)*4+2];case t.H:return n[(e-1)*4+3];default:return}},e.getTotalCodewordsCount=function(e,n){switch(n){case t.L:return r[(e-1)*4+0];case t.M:return r[(e-1)*4+1];case t.Q:return r[(e-1)*4+2];case t.H:return r[(e-1)*4+3];default:return}}})),qa=o((e=>{var t=new Uint8Array(512),n=new Uint8Array(256);(function(){let e=1;for(let r=0;r<255;r++)t[r]=e,n[e]=r,e<<=1,e&256&&(e^=285);for(let e=255;e<512;e++)t[e]=t[e-255]})(),e.log=function(e){if(e<1)throw Error(`log(`+e+`)`);return n[e]},e.exp=function(e){return t[e]},e.mul=function(e,r){return e===0||r===0?0:t[n[e]+n[r]]}})),Ja=o((e=>{var t=qa();e.mul=function(e,n){let r=new Uint8Array(e.length+n.length-1);for(let i=0;i<e.length;i++)for(let a=0;a<n.length;a++)r[i+a]^=t.mul(e[i],n[a]);return r},e.mod=function(e,n){let r=new Uint8Array(e);for(;r.length-n.length>=0;){let e=r[0];for(let i=0;i<n.length;i++)r[i]^=t.mul(n[i],e);let i=0;for(;i<r.length&&r[i]===0;)i++;r=r.slice(i)}return r},e.generateECPolynomial=function(n){let r=new Uint8Array([1]);for(let i=0;i<n;i++)r=e.mul(r,new Uint8Array([1,t.exp(i)]));return r}})),Ya=o(((e,t)=>{var n=Ja();function r(e){this.genPoly=void 0,this.degree=e,this.degree&&this.initialize(this.degree)}r.prototype.initialize=function(e){this.degree=e,this.genPoly=n.generateECPolynomial(this.degree)},r.prototype.encode=function(e){if(!this.genPoly)throw Error(`Encoder not initialized`);let t=new Uint8Array(e.length+this.degree);t.set(e);let r=n.mod(t,this.genPoly),i=this.degree-r.length;if(i>0){let e=new Uint8Array(this.degree);return e.set(r,i),e}return r},t.exports=r})),Xa=o((e=>{e.isValid=function(e){return!isNaN(e)&&e>=1&&e<=40}})),Za=o((e=>{var t=`[0-9]+`,n=`[A-Z $%*+\\-./:]+`,r=`(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+`;r=r.replace(/u/g,`\\u`);var i=`(?:(?![A-Z0-9 $%*+\\-./:]|`+r+`)(?:.|[\r
]))+`;e.KANJI=new RegExp(r,`g`),e.BYTE_KANJI=RegExp(`[^A-Z0-9 $%*+\\-./:]+`,`g`),e.BYTE=new RegExp(i,`g`),e.NUMERIC=new RegExp(t,`g`),e.ALPHANUMERIC=new RegExp(n,`g`);var a=RegExp(`^`+r+`$`),o=RegExp(`^[0-9]+$`),s=RegExp(`^[A-Z0-9 $%*+\\-./:]+$`);e.testKanji=function(e){return a.test(e)},e.testNumeric=function(e){return o.test(e)},e.testAlphanumeric=function(e){return s.test(e)}})),Qa=o((e=>{var t=Xa(),n=Za();e.NUMERIC={id:`Numeric`,bit:1,ccBits:[10,12,14]},e.ALPHANUMERIC={id:`Alphanumeric`,bit:2,ccBits:[9,11,13]},e.BYTE={id:`Byte`,bit:4,ccBits:[8,16,16]},e.KANJI={id:`Kanji`,bit:8,ccBits:[8,10,12]},e.MIXED={bit:-1},e.getCharCountIndicator=function(e,n){if(!e.ccBits)throw Error(`Invalid mode: `+e);if(!t.isValid(n))throw Error(`Invalid version: `+n);return n>=1&&n<10?e.ccBits[0]:n<27?e.ccBits[1]:e.ccBits[2]},e.getBestModeForData=function(t){return n.testNumeric(t)?e.NUMERIC:n.testAlphanumeric(t)?e.ALPHANUMERIC:n.testKanji(t)?e.KANJI:e.BYTE},e.toString=function(e){if(e&&e.id)return e.id;throw Error(`Invalid mode`)},e.isValid=function(e){return e&&e.bit&&e.ccBits};function r(t){if(typeof t!=`string`)throw Error(`Param is not a string`);switch(t.toLowerCase()){case`numeric`:return e.NUMERIC;case`alphanumeric`:return e.ALPHANUMERIC;case`kanji`:return e.KANJI;case`byte`:return e.BYTE;default:throw Error(`Unknown mode: `+t)}}e.from=function(t,n){if(e.isValid(t))return t;try{return r(t)}catch{return n}}})),$a=o((e=>{var t=za(),n=Ka(),r=Ba(),i=Qa(),a=Xa(),o=7973,s=t.getBCHDigit(o);function c(t,n,r){for(let i=1;i<=40;i++)if(n<=e.getCapacity(i,r,t))return i}function l(e,t){return i.getCharCountIndicator(e,t)+4}function u(e,t){let n=0;return e.forEach(function(e){let r=l(e.mode,t);n+=r+e.getBitsLength()}),n}function d(t,n){for(let r=1;r<=40;r++)if(u(t,r)<=e.getCapacity(r,n,i.MIXED))return r}e.from=function(e,t){return a.isValid(e)?parseInt(e,10):t},e.getCapacity=function(e,r,o){if(!a.isValid(e))throw Error(`Invalid QR Code version`);o===void 0&&(o=i.BYTE);let s=(t.getSymbolTotalCodewords(e)-n.getTotalCodewordsCount(e,r))*8;if(o===i.MIXED)return s;let c=s-l(o,e);switch(o){case i.NUMERIC:return Math.floor(c/10*3);case i.ALPHANUMERIC:return Math.floor(c/11*2);case i.KANJI:return Math.floor(c/13);case i.BYTE:default:return Math.floor(c/8)}},e.getBestVersionForData=function(e,t){let n,i=r.from(t,r.M);if(Array.isArray(e)){if(e.length>1)return d(e,i);if(e.length===0)return 1;n=e[0]}else n=e;return c(n.mode,n.getLength(),i)},e.getEncodedBits=function(e){if(!a.isValid(e)||e<7)throw Error(`Invalid QR Code version`);let n=e<<12;for(;t.getBCHDigit(n)-s>=0;)n^=o<<t.getBCHDigit(n)-s;return e<<12|n}})),eo=o((e=>{var t=za(),n=1335,r=21522,i=t.getBCHDigit(n);e.getEncodedBits=function(e,a){let o=e.bit<<3|a,s=o<<10;for(;t.getBCHDigit(s)-i>=0;)s^=n<<t.getBCHDigit(s)-i;return(o<<10|s)^r}})),to=o(((e,t)=>{var n=Qa();function r(e){this.mode=n.NUMERIC,this.data=e.toString()}r.getBitsLength=function(e){return 10*Math.floor(e/3)+(e%3?e%3*3+1:0)},r.prototype.getLength=function(){return this.data.length},r.prototype.getBitsLength=function(){return r.getBitsLength(this.data.length)},r.prototype.write=function(e){let t,n,r;for(t=0;t+3<=this.data.length;t+=3)n=this.data.substr(t,3),r=parseInt(n,10),e.put(r,10);let i=this.data.length-t;i>0&&(n=this.data.substr(t),r=parseInt(n,10),e.put(r,i*3+1))},t.exports=r})),no=o(((e,t)=>{var n=Qa(),r=`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:`.split(``);function i(e){this.mode=n.ALPHANUMERIC,this.data=e}i.getBitsLength=function(e){return 11*Math.floor(e/2)+e%2*6},i.prototype.getLength=function(){return this.data.length},i.prototype.getBitsLength=function(){return i.getBitsLength(this.data.length)},i.prototype.write=function(e){let t=0;for(;t+2<=this.data.length;t+=2){let n=r.indexOf(this.data[t])*45;n+=r.indexOf(this.data[t+1]),e.put(n,11)}this.data.length%2&&e.put(r.indexOf(this.data[t]),6)},t.exports=i})),ro=o(((e,t)=>{var n=Qa();function r(e){this.mode=n.BYTE,this.data=typeof e==`string`?new TextEncoder().encode(e):new Uint8Array(e)}r.getBitsLength=function(e){return e*8},r.prototype.getLength=function(){return this.data.length},r.prototype.getBitsLength=function(){return r.getBitsLength(this.data.length)},r.prototype.write=function(e){for(let t=0,n=this.data.length;t<n;t++)e.put(this.data[t],8)},t.exports=r})),io=o(((e,t)=>{var n=Qa(),r=za();function i(e){this.mode=n.KANJI,this.data=e}i.getBitsLength=function(e){return e*13},i.prototype.getLength=function(){return this.data.length},i.prototype.getBitsLength=function(){return i.getBitsLength(this.data.length)},i.prototype.write=function(e){let t=0;for(;t<this.data.length;t++){let n=r.toSJIS(this.data[t]);if(n>=33088&&n<=40956)n-=33088;else if(n>=57408&&n<=60351)n-=49472;else throw Error(`Invalid SJIS character: `+this.data[t]+`
Make sure your charset is UTF-8`);n=(n>>>8&255)*192+(n&255),e.put(n,13)}},t.exports=i})),ao=o(((e,t)=>{var n={single_source_shortest_paths:function(e,t,r){var i={},a={};a[t]=0;var o=n.PriorityQueue.make();o.push(t,0);for(var s,c,l,u,d,f,p,m,h;!o.empty();)for(l in s=o.pop(),c=s.value,u=s.cost,d=e[c]||{},d)d.hasOwnProperty(l)&&(f=d[l],p=u+f,m=a[l],h=a[l]===void 0,(h||m>p)&&(a[l]=p,o.push(l,p),i[l]=c));if(r!==void 0&&a[r]===void 0){var g=[`Could not find a path from `,t,` to `,r,`.`].join(``);throw Error(g)}return i},extract_shortest_path_from_predecessor_list:function(e,t){for(var n=[],r=t;r;)n.push(r),e[r],r=e[r];return n.reverse(),n},find_path:function(e,t,r){var i=n.single_source_shortest_paths(e,t,r);return n.extract_shortest_path_from_predecessor_list(i,r)},PriorityQueue:{make:function(e){var t=n.PriorityQueue,r={},i;for(i in e||={},t)t.hasOwnProperty(i)&&(r[i]=t[i]);return r.queue=[],r.sorter=e.sorter||t.default_sorter,r},default_sorter:function(e,t){return e.cost-t.cost},push:function(e,t){var n={value:e,cost:t};this.queue.push(n),this.queue.sort(this.sorter)},pop:function(){return this.queue.shift()},empty:function(){return this.queue.length===0}}};t!==void 0&&(t.exports=n)})),oo=o((e=>{var t=Qa(),n=to(),r=no(),i=ro(),a=io(),o=Za(),s=za(),c=ao();function l(e){return unescape(encodeURIComponent(e)).length}function u(e,t,n){let r=[],i;for(;(i=e.exec(n))!==null;)r.push({data:i[0],index:i.index,mode:t,length:i[0].length});return r}function d(e){let n=u(o.NUMERIC,t.NUMERIC,e),r=u(o.ALPHANUMERIC,t.ALPHANUMERIC,e),i,a;return s.isKanjiModeEnabled()?(i=u(o.BYTE,t.BYTE,e),a=u(o.KANJI,t.KANJI,e)):(i=u(o.BYTE_KANJI,t.BYTE,e),a=[]),n.concat(r,i,a).sort(function(e,t){return e.index-t.index}).map(function(e){return{data:e.data,mode:e.mode,length:e.length}})}function f(e,o){switch(o){case t.NUMERIC:return n.getBitsLength(e);case t.ALPHANUMERIC:return r.getBitsLength(e);case t.KANJI:return a.getBitsLength(e);case t.BYTE:return i.getBitsLength(e)}}function p(e){return e.reduce(function(e,t){let n=e.length-1>=0?e[e.length-1]:null;return n&&n.mode===t.mode?(e[e.length-1].data+=t.data,e):(e.push(t),e)},[])}function m(e){let n=[];for(let r=0;r<e.length;r++){let i=e[r];switch(i.mode){case t.NUMERIC:n.push([i,{data:i.data,mode:t.ALPHANUMERIC,length:i.length},{data:i.data,mode:t.BYTE,length:i.length}]);break;case t.ALPHANUMERIC:n.push([i,{data:i.data,mode:t.BYTE,length:i.length}]);break;case t.KANJI:n.push([i,{data:i.data,mode:t.BYTE,length:l(i.data)}]);break;case t.BYTE:n.push([{data:i.data,mode:t.BYTE,length:l(i.data)}])}}return n}function h(e,n){let r={},i={start:{}},a=[`start`];for(let o=0;o<e.length;o++){let s=e[o],c=[];for(let e=0;e<s.length;e++){let l=s[e],u=``+o+e;c.push(u),r[u]={node:l,lastCount:0},i[u]={};for(let e=0;e<a.length;e++){let o=a[e];r[o]&&r[o].node.mode===l.mode?(i[o][u]=f(r[o].lastCount+l.length,l.mode)-f(r[o].lastCount,l.mode),r[o].lastCount+=l.length):(r[o]&&(r[o].lastCount=l.length),i[o][u]=f(l.length,l.mode)+4+t.getCharCountIndicator(l.mode,n))}}a=c}for(let e=0;e<a.length;e++)i[a[e]].end=0;return{map:i,table:r}}function g(e,o){let c,l=t.getBestModeForData(e);if(c=t.from(o,l),c!==t.BYTE&&c.bit<l.bit)throw Error(`"`+e+`" cannot be encoded with mode `+t.toString(c)+`.
 Suggested mode is: `+t.toString(l));switch(c===t.KANJI&&!s.isKanjiModeEnabled()&&(c=t.BYTE),c){case t.NUMERIC:return new n(e);case t.ALPHANUMERIC:return new r(e);case t.KANJI:return new a(e);case t.BYTE:return new i(e)}}e.fromArray=function(e){return e.reduce(function(e,t){return typeof t==`string`?e.push(g(t,null)):t.data&&e.push(g(t.data,t.mode)),e},[])},e.fromString=function(t,n){let r=h(m(d(t,s.isKanjiModeEnabled())),n),i=c.find_path(r.map,`start`,`end`),a=[];for(let e=1;e<i.length-1;e++)a.push(r.table[i[e]].node);return e.fromArray(p(a))},e.rawSplit=function(t){return e.fromArray(d(t,s.isKanjiModeEnabled()))}})),so=o((e=>{var t=za(),n=Ba(),r=Va(),i=Ha(),a=Ua(),o=Wa(),s=Ga(),c=Ka(),l=Ya(),u=$a(),d=eo(),f=Qa(),p=oo();function m(e,t){let n=e.size,r=o.getPositions(t);for(let t=0;t<r.length;t++){let i=r[t][0],a=r[t][1];for(let t=-1;t<=7;t++)if(!(i+t<=-1||n<=i+t))for(let r=-1;r<=7;r++)a+r<=-1||n<=a+r||(t>=0&&t<=6&&(r===0||r===6)||r>=0&&r<=6&&(t===0||t===6)||t>=2&&t<=4&&r>=2&&r<=4?e.set(i+t,a+r,!0,!0):e.set(i+t,a+r,!1,!0))}}function h(e){let t=e.size;for(let n=8;n<t-8;n++){let t=n%2==0;e.set(n,6,t,!0),e.set(6,n,t,!0)}}function g(e,t){let n=a.getPositions(t);for(let t=0;t<n.length;t++){let r=n[t][0],i=n[t][1];for(let t=-2;t<=2;t++)for(let n=-2;n<=2;n++)t===-2||t===2||n===-2||n===2||t===0&&n===0?e.set(r+t,i+n,!0,!0):e.set(r+t,i+n,!1,!0)}}function _(e,t){let n=e.size,r=u.getEncodedBits(t),i,a,o;for(let t=0;t<18;t++)i=Math.floor(t/3),a=t%3+n-8-3,o=(r>>t&1)==1,e.set(i,a,o,!0),e.set(a,i,o,!0)}function v(e,t,n){let r=e.size,i=d.getEncodedBits(t,n),a,o;for(a=0;a<15;a++)o=(i>>a&1)==1,a<6?e.set(a,8,o,!0):a<8?e.set(a+1,8,o,!0):e.set(r-15+a,8,o,!0),a<8?e.set(8,r-a-1,o,!0):a<9?e.set(8,15-a-1+1,o,!0):e.set(8,15-a-1,o,!0);e.set(r-8,8,1,!0)}function y(e,t){let n=e.size,r=-1,i=n-1,a=7,o=0;for(let s=n-1;s>0;s-=2)for(s===6&&s--;;){for(let n=0;n<2;n++)if(!e.isReserved(i,s-n)){let r=!1;o<t.length&&(r=(t[o]>>>a&1)==1),e.set(i,s-n,r),a--,a===-1&&(o++,a=7)}if(i+=r,i<0||n<=i){i-=r,r=-r;break}}}function b(e,n,i){let a=new r;i.forEach(function(t){a.put(t.mode.bit,4),a.put(t.getLength(),f.getCharCountIndicator(t.mode,e)),t.write(a)});let o=(t.getSymbolTotalCodewords(e)-c.getTotalCodewordsCount(e,n))*8;for(a.getLengthInBits()+4<=o&&a.put(0,4);a.getLengthInBits()%8!=0;)a.putBit(0);let s=(o-a.getLengthInBits())/8;for(let e=0;e<s;e++)a.put(e%2?17:236,8);return x(a,e,n)}function x(e,n,r){let i=t.getSymbolTotalCodewords(n),a=i-c.getTotalCodewordsCount(n,r),o=c.getBlocksCount(n,r),s=o-i%o,u=Math.floor(i/o),d=Math.floor(a/o),f=d+1,p=u-d,m=new l(p),h=0,g=Array(o),_=Array(o),v=0,y=new Uint8Array(e.buffer);for(let e=0;e<o;e++){let t=e<s?d:f;g[e]=y.slice(h,h+t),_[e]=m.encode(g[e]),h+=t,v=Math.max(v,t)}let b=new Uint8Array(i),x=0,S,C;for(S=0;S<v;S++)for(C=0;C<o;C++)S<g[C].length&&(b[x++]=g[C][S]);for(S=0;S<p;S++)for(C=0;C<o;C++)b[x++]=_[C][S];return b}function S(e,n,r,a){let o;if(Array.isArray(e))o=p.fromArray(e);else if(typeof e==`string`){let t=n;if(!t){let n=p.rawSplit(e);t=u.getBestVersionForData(n,r)}o=p.fromString(e,t||40)}else throw Error(`Invalid data`);let c=u.getBestVersionForData(o,r);if(!c)throw Error(`The amount of data is too big to be stored in a QR Code`);if(!n)n=c;else if(n<c)throw Error(`
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: `+c+`.
`);let l=b(n,r,o),d=new i(t.getSymbolSize(n));return m(d,n),h(d),g(d,n),v(d,r,0),n>=7&&_(d,n),y(d,l),isNaN(a)&&(a=s.getBestMask(d,v.bind(null,d,r))),s.applyMask(a,d),v(d,r,a),{modules:d,version:n,errorCorrectionLevel:r,maskPattern:a,segments:o}}e.create=function(e,r){if(e===void 0||e===``)throw Error(`No input text`);let i=n.M,a,o;return r!==void 0&&(i=n.from(r.errorCorrectionLevel,n.M),a=u.from(r.version),o=s.from(r.maskPattern),r.toSJISFunc&&t.setToSJISFunction(r.toSJISFunc)),S(e,a,i,o)}})),co=o((e=>{function t(e){if(typeof e==`number`&&(e=e.toString()),typeof e!=`string`)throw Error(`Color should be defined as hex string`);let t=e.slice().replace(`#`,``).split(``);if(t.length<3||t.length===5||t.length>8)throw Error(`Invalid hex color: `+e);(t.length===3||t.length===4)&&(t=Array.prototype.concat.apply([],t.map(function(e){return[e,e]}))),t.length===6&&t.push(`F`,`F`);let n=parseInt(t.join(``),16);return{r:n>>24&255,g:n>>16&255,b:n>>8&255,a:n&255,hex:`#`+t.slice(0,6).join(``)}}e.getOptions=function(e){e||={},e.color||(e.color={});let n=e.margin===void 0||e.margin===null||e.margin<0?4:e.margin,r=e.width&&e.width>=21?e.width:void 0,i=e.scale||4;return{width:r,scale:r?4:i,margin:n,color:{dark:t(e.color.dark||`#000000ff`),light:t(e.color.light||`#ffffffff`)},type:e.type,rendererOpts:e.rendererOpts||{}}},e.getScale=function(e,t){return t.width&&t.width>=e+t.margin*2?t.width/(e+t.margin*2):t.scale},e.getImageWidth=function(t,n){let r=e.getScale(t,n);return Math.floor((t+n.margin*2)*r)},e.qrToImageData=function(t,n,r){let i=n.modules.size,a=n.modules.data,o=e.getScale(i,r),s=Math.floor((i+r.margin*2)*o),c=r.margin*o,l=[r.color.light,r.color.dark];for(let e=0;e<s;e++)for(let n=0;n<s;n++){let u=(e*s+n)*4,d=r.color.light;if(e>=c&&n>=c&&e<s-c&&n<s-c){let t=Math.floor((e-c)/o),r=Math.floor((n-c)/o);d=l[+!!a[t*i+r]]}t[u++]=d.r,t[u++]=d.g,t[u++]=d.b,t[u]=d.a}}})),lo=o((e=>{var t=co();function n(e,t,n){e.clearRect(0,0,t.width,t.height),t.style||={},t.height=n,t.width=n,t.style.height=n+`px`,t.style.width=n+`px`}function r(){try{return document.createElement(`canvas`)}catch{throw Error(`You need to specify a canvas element`)}}e.render=function(e,i,a){let o=a,s=i;o===void 0&&(!i||!i.getContext)&&(o=i,i=void 0),i||(s=r()),o=t.getOptions(o);let c=t.getImageWidth(e.modules.size,o),l=s.getContext(`2d`),u=l.createImageData(c,c);return t.qrToImageData(u.data,e,o),n(l,s,c),l.putImageData(u,0,0),s},e.renderToDataURL=function(t,n,r){let i=r;i===void 0&&(!n||!n.getContext)&&(i=n,n=void 0),i||={};let a=e.render(t,n,i),o=i.type||`image/png`,s=i.rendererOpts||{};return a.toDataURL(o,s.quality)}})),uo=o((e=>{var t=co();function n(e,t){let n=e.a/255,r=t+`="`+e.hex+`"`;return n<1?r+` `+t+`-opacity="`+n.toFixed(2).slice(1)+`"`:r}function r(e,t,n){let r=e+t;return n!==void 0&&(r+=` `+n),r}function i(e,t,n){let i=``,a=0,o=!1,s=0;for(let c=0;c<e.length;c++){let l=Math.floor(c%t),u=Math.floor(c/t);!l&&!o&&(o=!0),e[c]?(s++,c>0&&l>0&&e[c-1]||(i+=o?r(`M`,l+n,.5+u+n):r(`m`,a,0),a=0,o=!1),l+1<t&&e[c+1]||(i+=r(`h`,s),s=0)):a++}return i}e.render=function(e,r,a){let o=t.getOptions(r),s=e.modules.size,c=e.modules.data,l=s+o.margin*2,u=o.color.light.a?`<path `+n(o.color.light,`fill`)+` d="M0 0h`+l+`v`+l+`H0z"/>`:``,d=`<path `+n(o.color.dark,`stroke`)+` d="`+i(c,s,o.margin)+`"/>`,f=`viewBox="0 0 `+l+` `+l+`"`,p=`<svg xmlns="http://www.w3.org/2000/svg" `+(o.width?`width="`+o.width+`" height="`+o.width+`" `:``)+f+` shape-rendering="crispEdges">`+u+d+`</svg>
`;return typeof a==`function`&&a(null,p),p}})),fo=c(o((e=>{var t=Ra(),n=so(),r=lo(),i=uo();function a(e,r,i,a,o){let s=[].slice.call(arguments,1),c=s.length,l=typeof s[c-1]==`function`;if(!l&&!t())throw Error(`Callback required as last argument`);if(l){if(c<2)throw Error(`Too few arguments provided`);c===2?(o=i,i=r,r=a=void 0):c===3&&(r.getContext&&o===void 0?(o=a,a=void 0):(o=a,a=i,i=r,r=void 0))}else{if(c<1)throw Error(`Too few arguments provided`);return c===1?(i=r,r=a=void 0):c===2&&!r.getContext&&(a=i,i=r,r=void 0),new Promise(function(t,o){try{t(e(n.create(i,a),r,a))}catch(e){o(e)}})}try{let t=n.create(i,a);o(null,e(t,r,a))}catch(e){o(e)}}e.create=n.create,e.toCanvas=a.bind(null,r.render),e.toDataURL=a.bind(null,r.renderToDataURL),e.toString=a.bind(null,function(e,t,n){return i.render(e,n)})}))(),1),po={xmlns:`http://www.w3.org/2000/svg`,width:24,height:24,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,"stroke-width":2,"stroke-linecap":`round`,"stroke-linejoin":`round`},mo=([e,t,n])=>{let r=document.createElementNS(`http://www.w3.org/2000/svg`,e);return Object.keys(t).forEach(e=>{r.setAttribute(e,String(t[e]))}),n?.length&&n.forEach(e=>{let t=mo(e);r.appendChild(t)}),r},ho=(e,t={})=>mo([`svg`,{...po,...t},e]),go=(...e)=>e.filter((e,t,n)=>!!e&&e.trim()!==``&&n.indexOf(e)===t).join(` `).trim(),_o=e=>{for(let t in e)if(t.startsWith(`aria-`)||t===`role`||t===`title`)return!0;return!1},vo=e=>{let t=``,n=!1;for(let r of e)r===`-`||r===`_`||r<=` `?n=t.length>0:(t.length===0?t+=r.toLowerCase():t+=n?r.toUpperCase():r,n=!1);return t},yo=e=>{let t=vo(e);return t.charAt(0).toUpperCase()+t.slice(1)},bo=e=>Array.from(e.attributes).reduce((e,t)=>(e[t.name]=t.value,e),{}),xo=e=>typeof e==`string`?e:!e||!e.class?``:e.class&&typeof e.class==`string`?e.class.split(` `):e.class&&Array.isArray(e.class)?e.class:``,So=(e,{nameAttr:t,icons:n,attrs:r})=>{let i=e.getAttribute(t);if(i==null)return;let a=n[yo(i)];if(!a)return console.warn(`${e.outerHTML} icon name was not found in the provided icons object.`);let o=bo(e),s=_o(o)?{}:{"aria-hidden":`true`},c={...po,"data-lucide":i,...s,...r,...o},l=xo(o),u=xo(r),d=go(`lucide`,`lucide-${i}`,...l,...u);d&&Object.assign(c,{class:d});let f=ho(a,c);return e.parentNode?.replaceChild(f,e)},Co=[[`path`,{d:`M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2`}]],wo=[[`path`,{d:`M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z`}],[`path`,{d:`m3.3 7 8.7 5 8.7-5`}],[`path`,{d:`M12 22V12`}]],To=[[`path`,{d:`M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z`}],[`circle`,{cx:`12`,cy:`13`,r:`3`}]],Eo=[[`path`,{d:`m6 9 6 6 6-6`}]],Do=[[`rect`,{width:`18`,height:`18`,x:`3`,y:`3`,rx:`2`}],[`path`,{d:`M11 9h4a2 2 0 0 0 2-2V3`}],[`circle`,{cx:`9`,cy:`9`,r:`2`}],[`path`,{d:`M7 21v-4a2 2 0 0 1 2-2h4`}],[`circle`,{cx:`15`,cy:`15`,r:`2`}]],Oo=[[`path`,{d:`M12 20v2`}],[`path`,{d:`M12 2v2`}],[`path`,{d:`M17 20v2`}],[`path`,{d:`M17 2v2`}],[`path`,{d:`M2 12h2`}],[`path`,{d:`M2 17h2`}],[`path`,{d:`M2 7h2`}],[`path`,{d:`M20 12h2`}],[`path`,{d:`M20 17h2`}],[`path`,{d:`M20 7h2`}],[`path`,{d:`M7 20v2`}],[`path`,{d:`M7 2v2`}],[`rect`,{x:`4`,y:`4`,width:`16`,height:`16`,rx:`2`}],[`rect`,{x:`8`,y:`8`,width:`8`,height:`8`,rx:`1`}]],ko=[[`path`,{d:`M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z`}]],Ao=[[`path`,{d:`M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8`}],[`path`,{d:`M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z`}]],jo=[[`rect`,{width:`18`,height:`18`,x:`3`,y:`3`,rx:`2`,ry:`2`}],[`circle`,{cx:`9`,cy:`9`,r:`2`}],[`path`,{d:`m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21`}]],Mo=[[`path`,{d:`M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z`}],[`path`,{d:`M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12`}],[`path`,{d:`M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17`}]],No=[[`rect`,{width:`18`,height:`18`,x:`3`,y:`3`,rx:`2`}],[`path`,{d:`M15 3v18`}]],Po=[[`path`,{d:`M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z`}]],Fo=[[`path`,{d:`M5 12h14`}],[`path`,{d:`M12 5v14`}]],Io=[[`path`,{d:`M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8`}],[`path`,{d:`M21 3v5h-5`}]],Lo=[[`path`,{d:`M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z`}],[`path`,{d:`m21.854 2.147-10.94 10.939`}]],Ro=[[`path`,{d:`M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915`}],[`circle`,{cx:`12`,cy:`12`,r:`3`}]],zo=[[`circle`,{cx:`18`,cy:`5`,r:`3`}],[`circle`,{cx:`6`,cy:`12`,r:`3`}],[`circle`,{cx:`18`,cy:`19`,r:`3`}],[`line`,{x1:`8.59`,x2:`15.42`,y1:`13.51`,y2:`17.49`}],[`line`,{x1:`15.41`,x2:`8.59`,y1:`6.51`,y2:`10.49`}]],Bo=[[`rect`,{width:`14`,height:`20`,x:`5`,y:`2`,rx:`2`,ry:`2`}],[`path`,{d:`M12 18h.01`}]],Vo=[[`path`,{d:`M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z`}],[`path`,{d:`M20 2v4`}],[`path`,{d:`M22 4h-4`}],[`circle`,{cx:`4`,cy:`20`,r:`2`}]],Ho=[[`path`,{d:`M10 11v6`}],[`path`,{d:`M14 11v6`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`}],[`path`,{d:`M3 6h18`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`}]],Uo=[[`path`,{d:`M9 14 4 9l5-5`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`}]],Wo=[[`path`,{d:`M12 3v12`}],[`path`,{d:`m17 8-5-5-5 5`}],[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`}]],Go=[[`path`,{d:`M18 6 6 18`}],[`path`,{d:`m6 6 12 12`}]],Ko=({icons:e={},nameAttr:t=`data-lucide`,attrs:n={},root:r=document,inTemplates:i}={})=>{if(!Object.values(e).length)throw Error(`Please provide an icons object.
If you want to use all the icons you can import it like:
 \`import { createIcons, icons } from 'lucide';
lucide.createIcons({icons});\``);if(r===void 0)throw Error("`createIcons()` only works in a browser environment.");if(Array.from(r.querySelectorAll(`[${t}]`)).forEach(r=>So(r,{nameAttr:t,icons:e,attrs:n})),i&&Array.from(r.querySelectorAll(`template`)).forEach(r=>Ko({icons:e,nameAttr:t,attrs:n,root:r.content,inTemplates:i})),t===`data-lucide`){let t=r.querySelectorAll(`[icon-name]`);t.length>0&&(console.warn(`[Lucide] Some icons were found with the now deprecated icon-name attribute. These will still be replaced for backwards compatibility, but will no longer be supported in v1.0 and you should switch to data-lucide`),Array.from(t).forEach(t=>So(t,{nameAttr:`icon-name`,icons:e,attrs:n})))}},qo={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},Jo={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Yo=1e3,Xo=1001,Zo=1002,Qo=1003,$o=1004,es=1005,ts=1006,ns=1007,rs=1008,is=1009,as=1010,os=1011,ss=1012,cs=1013,ls=1014,us=1015,ds=1016,fs=1017,ps=1018,ms=1020,hs=35902,gs=35899,_s=1021,vs=1022,ys=1023,bs=1026,xs=1027,Ss=1028,Cs=1029,ws=1030,Ts=1031,Es=1033,Ds=33776,Os=33777,ks=33778,As=33779,js=35840,Ms=35841,Ns=35842,Ps=35843,Fs=36196,Is=37492,Ls=37496,Rs=37488,zs=37489,Bs=37490,Vs=37491,Hs=37808,Us=37809,Ws=37810,Gs=37811,Ks=37812,qs=37813,Js=37814,Ys=37815,Xs=37816,Zs=37817,Qs=37818,$s=37819,ec=37820,tc=37821,nc=36492,rc=36494,ic=36495,ac=36283,oc=36284,sc=36285,cc=36286,lc=2300,uc=2301,dc=2302,fc=2303,pc=2400,mc=2401,hc=2402,gc=3200,_c=`srgb`,vc=`srgb-linear`,yc=`linear`,bc=`srgb`,xc=7680,Sc=35044,Cc=2e3;function wc(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function Tc(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function Ec(e){return document.createElementNS(`http://www.w3.org/1999/xhtml`,e)}function Dc(){let e=Ec(`canvas`);return e.style.display=`block`,e}var Oc={};function kc(...e){let t=`THREE.`+e.shift();console.log(t,...e)}function Ac(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function B(...e){e=Ac(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function V(...e){e=Ac(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.error(n.getError(t)):console.error(t,...e)}}function jc(...e){let t=e.join(` `);t in Oc||(Oc[t]=!0,B(...e))}function Mc(e,t,n){return new Promise(function(r,i){function a(){switch(e.clientWaitSync(t,e.SYNC_FLUSH_COMMANDS_BIT,0)){case e.WAIT_FAILED:i();break;case e.TIMEOUT_EXPIRED:setTimeout(a,n);break;default:r()}}setTimeout(a,n)})}var Nc={0:1,2:6,4:7,3:5,1:0,6:2,7:4,5:3},Pc=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n!==void 0&&n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let r=n[e];if(r!==void 0){let e=r.indexOf(t);e!==-1&&r.splice(e,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let t=n.slice(0);for(let n=0,r=t.length;n<r;n++)t[n].call(this,e);e.target=null}}},Fc=`00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.17.18.19.1a.1b.1c.1d.1e.1f.20.21.22.23.24.25.26.27.28.29.2a.2b.2c.2d.2e.2f.30.31.32.33.34.35.36.37.38.39.3a.3b.3c.3d.3e.3f.40.41.42.43.44.45.46.47.48.49.4a.4b.4c.4d.4e.4f.50.51.52.53.54.55.56.57.58.59.5a.5b.5c.5d.5e.5f.60.61.62.63.64.65.66.67.68.69.6a.6b.6c.6d.6e.6f.70.71.72.73.74.75.76.77.78.79.7a.7b.7c.7d.7e.7f.80.81.82.83.84.85.86.87.88.89.8a.8b.8c.8d.8e.8f.90.91.92.93.94.95.96.97.98.99.9a.9b.9c.9d.9e.9f.a0.a1.a2.a3.a4.a5.a6.a7.a8.a9.aa.ab.ac.ad.ae.af.b0.b1.b2.b3.b4.b5.b6.b7.b8.b9.ba.bb.bc.bd.be.bf.c0.c1.c2.c3.c4.c5.c6.c7.c8.c9.ca.cb.cc.cd.ce.cf.d0.d1.d2.d3.d4.d5.d6.d7.d8.d9.da.db.dc.dd.de.df.e0.e1.e2.e3.e4.e5.e6.e7.e8.e9.ea.eb.ec.ed.ee.ef.f0.f1.f2.f3.f4.f5.f6.f7.f8.f9.fa.fb.fc.fd.fe.ff`.split(`.`),Ic=1234567,Lc=Math.PI/180,Rc=180/Math.PI;function zc(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return(Fc[e&255]+Fc[e>>8&255]+Fc[e>>16&255]+Fc[e>>24&255]+`-`+Fc[t&255]+Fc[t>>8&255]+`-`+Fc[t>>16&15|64]+Fc[t>>24&255]+`-`+Fc[n&63|128]+Fc[n>>8&255]+`-`+Fc[n>>16&255]+Fc[n>>24&255]+Fc[r&255]+Fc[r>>8&255]+Fc[r>>16&255]+Fc[r>>24&255]).toLowerCase()}function H(e,t,n){return Math.max(t,Math.min(n,e))}function Bc(e,t){return(e%t+t)%t}function Vc(e,t,n,r,i){return r+(e-t)*(i-r)/(n-t)}function Hc(e,t,n){return e===t?0:(n-e)/(t-e)}function Uc(e,t,n){return(1-n)*e+n*t}function Wc(e,t,n,r){return Uc(e,t,1-Math.exp(-n*r))}function Gc(e,t=1){return t-Math.abs(Bc(e,t*2)-t)}function Kc(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*(3-2*e))}function qc(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*e*(e*(e*6-15)+10))}function Jc(e,t){return e+Math.floor(Math.random()*(t-e+1))}function Yc(e,t){return e+Math.random()*(t-e)}function Xc(e){return e*(.5-Math.random())}function Zc(e){e!==void 0&&(Ic=e);let t=Ic+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Qc(e){return e*Lc}function $c(e){return e*Rc}function el(e){return e>0&&Number.isInteger(e)&&2**Math.round(Math.log2(e))===e}function tl(e){return 2**Math.ceil(Math.log(e)/Math.LN2)}function nl(e){return 2**Math.floor(Math.log(e)/Math.LN2)}function rl(e,t,n,r,i){let a=Math.cos,o=Math.sin,s=a(n/2),c=o(n/2),l=a((t+r)/2),u=o((t+r)/2),d=a((t-r)/2),f=o((t-r)/2),p=a((r-t)/2),m=o((r-t)/2);switch(i){case`XYX`:e.set(s*u,c*d,c*f,s*l);break;case`YZY`:e.set(c*f,s*u,c*d,s*l);break;case`ZXZ`:e.set(c*d,c*f,s*u,s*l);break;case`XZX`:e.set(s*u,c*m,c*p,s*l);break;case`YXY`:e.set(c*p,s*u,c*m,s*l);break;case`ZYZ`:e.set(c*m,c*p,s*u,s*l);break;default:B(`MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: `+i)}}function il(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:case Uint8ClampedArray:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}function al(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}var ol={DEG2RAD:Lc,RAD2DEG:Rc,generateUUID:zc,clamp:H,euclideanModulo:Bc,mapLinear:Vc,inverseLerp:Hc,lerp:Uc,damp:Wc,pingpong:Gc,smoothstep:Kc,smootherstep:qc,randInt:Jc,randFloat:Yc,randFloatSpread:Xc,seededRandom:Zc,degToRad:Qc,radToDeg:$c,isPowerOfTwo:el,ceilPowerOfTwo:tl,floorPowerOfTwo:nl,setQuaternionFromProperEuler:rl,normalize:al,denormalize:il},U=class e{static{e.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw Error(`THREE.Vector2: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw Error(`THREE.Vector2: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=H(this.x,e.x,t.x),this.y=H(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=H(this.x,e,t),this.y=H(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(H(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(H(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),i=this.x-e.x,a=this.y-e.y;return this.x=i*n-a*r+e.x,this.y=i*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},sl=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:B(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(H(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},W=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(ll.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(ll.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=H(this.x,e.x,t.x),this.y=H(this.y,e.y,t.y),this.z=H(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=H(this.x,e,t),this.y=H(this.y,e,t),this.z=H(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(H(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return cl.copy(this).projectOnVector(e),this.sub(cl)}reflect(e){return this.sub(cl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(H(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},cl=new W,ll=new sl,G=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return jc(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(ul.makeScale(e,t)),this}rotate(e){return jc(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(ul.makeRotation(-e)),this}translate(e,t){return jc(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(ul.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},ul=new G,dl=new G().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),fl=new G().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function pl(){let e={enabled:!0,workingColorSpace:vc,spaces:{},convert:function(e,t,n){return this.enabled===!1||t===n||!t||!n||(this.spaces[t].transfer===`srgb`&&(e.r=hl(e.r),e.g=hl(e.g),e.b=hl(e.b)),this.spaces[t].primaries!==this.spaces[n].primaries&&(e.applyMatrix3(this.spaces[t].toXYZ),e.applyMatrix3(this.spaces[n].fromXYZ)),this.spaces[n].transfer===`srgb`&&(e.r=gl(e.r),e.g=gl(e.g),e.b=gl(e.b))),e},workingToColorSpace:function(e,t){return this.convert(e,this.workingColorSpace,t)},colorSpaceToWorking:function(e,t){return this.convert(e,t,this.workingColorSpace)},getPrimaries:function(e){return this.spaces[e].primaries},getTransfer:function(e){return e===``?yc:this.spaces[e].transfer},getToneMappingMode:function(e){return this.spaces[e].outputColorSpaceConfig.toneMappingMode||`standard`},getLuminanceCoefficients:function(e,t=this.workingColorSpace){return e.fromArray(this.spaces[t].luminanceCoefficients)},define:function(e){Object.assign(this.spaces,e)},_getMatrix:function(e,t,n){return e.copy(this.spaces[t].toXYZ).multiply(this.spaces[n].fromXYZ)},_getDrawingBufferColorSpace:function(e){return this.spaces[e].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(e=this.workingColorSpace){return this.spaces[e].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(t,n){return jc(`ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace().`),e.workingToColorSpace(t,n)},toWorkingColorSpace:function(t,n){return jc(`ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking().`),e.colorSpaceToWorking(t,n)}},t=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],r=[.3127,.329];return e.define({[vc]:{primaries:t,whitePoint:r,transfer:yc,toXYZ:dl,fromXYZ:fl,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:_c},outputColorSpaceConfig:{drawingBufferColorSpace:_c}},[_c]:{primaries:t,whitePoint:r,transfer:bc,toXYZ:dl,fromXYZ:fl,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:_c}}}),e}var ml=pl();function hl(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}function gl(e){return e<.0031308?e*12.92:1.055*e**.41666-.055}var _l,vl=class{static getDataURL(e,t=`image/png`){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>`u`)return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{_l===void 0&&(_l=Ec(`canvas`)),_l.width=e.width,_l.height=e.height;let t=_l.getContext(`2d`);e instanceof ImageData?t.putImageData(e,0,0):t.drawImage(e,0,0,e.width,e.height),n=_l}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let t=Ec(`canvas`);t.width=e.width,t.height=e.height;let n=t.getContext(`2d`);n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),i=r.data;for(let e=0;e<i.length;e++)i[e]=hl(i[e]/255)*255;return n.putImageData(r,0,0),t}if(e.data){let t=e.data.slice(0);for(let e=0;e<t.length;e++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[e]=Math.floor(hl(t[e]/255)*255):t[e]=hl(t[e]);return{data:t,width:e.width,height:e.height}}return B(`ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.`),e}},yl=0,bl=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:yl++}),this.uuid=zc(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<`u`&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<`u`&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t===null?e.set(0,0,0):e.set(t.width,t.height,t.depth||0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:``},r=this.data;if(r!==null){let e;if(Array.isArray(r)){e=[];for(let t=0,n=r.length;t<n;t++)r[t].isDataTexture?e.push(xl(r[t].image)):e.push(xl(r[t]))}else e=xl(r);n.url=e}return t||(e.images[this.uuid]=n),n}};function xl(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap?vl.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(B(`Texture: Unable to serialize Texture.`),{})}var Sl=0,Cl=new W,wl=class e extends Pc{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,r=Xo,i=Xo,a=ts,o=rs,s=ys,c=is,l=e.DEFAULT_ANISOTROPY,u=``){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Sl++}),this.uuid=zc(),this.name=``,this.source=new bl(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=r,this.wrapT=i,this.magFilter=a,this.minFilter=o,this.anisotropy=l,this.format=s,this.internalFormat=null,this.type=c,this.offset=new U(0,0),this.repeat=new U(1,1),this.center=new U(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new G,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Cl).x}get height(){return this.source.getSize(Cl).y}get depth(){return this.source.getSize(Cl).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){B(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];r===void 0?B(`Texture.setValues(): property '${t}' does not exist.`):r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:`Texture`,generator:`Texture.toJSON`},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:`dispose`})}transformUv(e){if(this.mapping!==300)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Yo:e.x-=Math.floor(e.x);break;case Xo:e.x=e.x<0?0:1;break;case Zo:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x-=Math.floor(e.x)}if(e.y<0||e.y>1)switch(this.wrapT){case Yo:e.y-=Math.floor(e.y);break;case Xo:e.y=e.y<0?0:1;break;case Zo:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y-=Math.floor(e.y)}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};wl.DEFAULT_IMAGE=null,wl.DEFAULT_MAPPING=300,wl.DEFAULT_ANISOTROPY=1;var Tl=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=H(this.x,e.x,t.x),this.y=H(this.y,e.y,t.y),this.z=H(this.z,e.z,t.z),this.w=H(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=H(this.x,e,t),this.y=H(this.y,e,t),this.z=H(this.z,e,t),this.w=H(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(H(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},El=class extends Pc{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:ts,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new Tl(0,0,e,t),this.scissorTest=!1,this.viewport=new Tl(0,0,e,t),this.textures=[];let r=new wl({width:e,height:t,depth:n.depth}),i=n.count;for(let e=0;e<i;e++)this.textures[e]=r.clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:ts,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let e=0;e<this.textures.length;e++)this.textures[e].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),e!==null&&e.renderTarget===null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let r=0,i=this.textures.length;r<i;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=n,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let n=Object.assign({},e.textures[t].image);this.textures[t].source=new bl(n)}if(this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveColorBuffer=e.resolveColorBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,this.storeMultisampledColorBuffer=e.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=e.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=e.storeMultisampledStencilBuffer,e.depthTexture!==null){if(e.depthTexture.renderTarget===e){let t=e.depthTexture.clone();t.renderTarget=null,this.depthTexture=t}else this.depthTexture=e.depthTexture}return this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:`dispose`})}},Dl=class extends El{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Ol=class extends wl{constructor(e=null,t=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=Qo,this.minFilter=Qo,this.wrapR=Xo,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},kl=class extends wl{constructor(e=null,t=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=Qo,this.minFilter=Qo,this.wrapR=Xo,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}},Al=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/jl.setFromMatrixColumn(e,0).length(),i=1/jl.setFromMatrixColumn(e,1).length(),a=1/jl.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Nl,e,Pl)}lookAt(e,t,n){let r=this.elements;return Ll.subVectors(e,t),Ll.lengthSq()===0&&(Ll.z=1),Ll.normalize(),Fl.crossVectors(n,Ll),Fl.lengthSq()===0&&(Math.abs(n.z)===1?Ll.x+=1e-4:Ll.z+=1e-4,Ll.normalize(),Fl.crossVectors(n,Ll)),Fl.normalize(),Il.crossVectors(Ll,Fl),r[0]=Fl.x,r[4]=Il.x,r[8]=Ll.x,r[1]=Fl.y,r[5]=Il.y,r[9]=Ll.y,r[2]=Fl.z,r[6]=Il.z,r[10]=Ll.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],k=r[2],A=r[6],j=r[10],M=r[14],N=r[3],ee=r[7],te=r[11],ne=r[15];return i[0]=a*x+o*T+s*k+c*N,i[4]=a*S+o*E+s*A+c*ee,i[8]=a*C+o*D+s*j+c*te,i[12]=a*w+o*O+s*M+c*ne,i[1]=l*x+u*T+d*k+f*N,i[5]=l*S+u*E+d*A+f*ee,i[9]=l*C+u*D+d*j+f*te,i[13]=l*w+u*O+d*M+f*ne,i[2]=p*x+m*T+h*k+g*N,i[6]=p*S+m*E+h*A+g*ee,i[10]=p*C+m*D+h*j+g*te,i[14]=p*w+m*O+h*M+g*ne,i[3]=_*x+v*T+y*k+b*N,i[7]=_*S+v*E+y*A+b*ee,i[11]=_*C+v*D+y*j+b*te,i[15]=_*w+v*O+y*M+b*ne,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,k=_*O-v*D+y*E+b*T-x*w+S*C;if(k===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/k;return e[0]=(o*O-s*D+c*E)*A,e[1]=(r*D-n*O-i*E)*A,e[2]=(m*S-h*x+g*b)*A,e[3]=(d*x-u*S-f*b)*A,e[4]=(s*T-a*O-c*w)*A,e[5]=(t*O-r*T+i*w)*A,e[6]=(h*y-p*S-g*v)*A,e[7]=(l*S-d*y+f*v)*A,e[8]=(a*D-o*T+c*C)*A,e[9]=(n*T-t*D-i*C)*A,e[10]=(p*x-m*y+g*_)*A,e[11]=(u*y-l*x-f*_)*A,e[12]=(o*w-a*E-s*C)*A,e[13]=(t*E-n*w+r*C)*A,e[14]=(m*v-p*b-h*_)*A,e[15]=(l*b-u*v+d*_)*A,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=jl.set(r[0],r[1],r[2]).length(),o=jl.set(r[4],r[5],r[6]).length(),s=jl.set(r[8],r[9],r[10]).length();i<0&&(a=-a),Ml.copy(this);let c=1/a,l=1/o,u=1/s;return Ml.elements[0]*=c,Ml.elements[1]*=c,Ml.elements[2]*=c,Ml.elements[4]*=l,Ml.elements[5]*=l,Ml.elements[6]*=l,Ml.elements[8]*=u,Ml.elements[9]*=u,Ml.elements[10]*=u,t.setFromRotationMatrix(Ml),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=Cc,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=Cc,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},jl=new W,Ml=new Al,Nl=new W(0,0,0),Pl=new W(1,1,1),Fl=new W,Il=new W,Ll=new W,Rl=new Al,zl=new sl,Bl=class e{constructor(t=0,n=0,r=0,i=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=r,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,i=r[0],a=r[4],o=r[8],s=r[1],c=r[5],l=r[9],u=r[2],d=r[6],f=r[10];switch(t){case`XYZ`:this._y=Math.asin(H(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-l,f),this._z=Math.atan2(-a,i)):(this._x=Math.atan2(d,c),this._z=0);break;case`YXZ`:this._x=Math.asin(-H(l,-1,1)),Math.abs(l)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(s,c)):(this._y=Math.atan2(-u,i),this._z=0);break;case`ZXY`:this._x=Math.asin(H(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(s,i));break;case`ZYX`:this._y=Math.asin(-H(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(s,i)):(this._x=0,this._z=Math.atan2(-a,c));break;case`YZX`:this._z=Math.asin(H(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(-l,c),this._y=Math.atan2(-u,i)):(this._x=0,this._y=Math.atan2(o,f));break;case`XZY`:this._z=Math.asin(-H(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,i)):(this._x=Math.atan2(-l,f),this._y=0);break;default:B(`Euler: .setFromRotationMatrix() encountered an unknown order: `+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Rl.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Rl,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return zl.setFromEuler(this),this.setFromQuaternion(zl,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Bl.DEFAULT_ORDER=`XYZ`;var Vl=class{constructor(){this.mask=1}set(e){this.mask=1<<e>>>0}enable(e){this.mask|=1<<e}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e}disable(e){this.mask&=~(1<<e)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return!!(this.mask&1<<e)}},Hl=0,Ul=new W,Wl=new sl,Gl=new Al,Kl=new W,ql=new W,Jl=new W,Yl=new sl,Xl=new W(1,0,0),Zl=new W(0,1,0),Ql=new W(0,0,1),$l={type:`added`},eu={type:`removed`},tu={type:`childadded`,child:null},nu={type:`childremoved`,child:null},ru=class e extends Pc{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Hl++}),this.uuid=zc(),this.name=``,this.type=`Object3D`,this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new W,n=new Bl,r=new sl,i=new W(1,1,1);function a(){r.setFromEuler(n,!1)}function o(){n.setFromQuaternion(r,void 0,!1)}n._onChange(a),r._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Al},normalMatrix:{value:new G}}),this.matrix=new Al,this.matrixWorld=new Al,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Vl,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Wl.setFromAxisAngle(e,t),this.quaternion.multiply(Wl),this}rotateOnWorldAxis(e,t){return Wl.setFromAxisAngle(e,t),this.quaternion.premultiply(Wl),this}rotateX(e){return this.rotateOnAxis(Xl,e)}rotateY(e){return this.rotateOnAxis(Zl,e)}rotateZ(e){return this.rotateOnAxis(Ql,e)}translateOnAxis(e,t){return Ul.copy(e).applyQuaternion(this.quaternion),this.position.add(Ul.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Xl,e)}translateY(e){return this.translateOnAxis(Zl,e)}translateZ(e){return this.translateOnAxis(Ql,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Gl.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Kl.copy(e):Kl.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),ql.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Gl.lookAt(ql,Kl,this.up):Gl.lookAt(Kl,ql,this.up),this.quaternion.setFromRotationMatrix(Gl),r&&(Gl.extractRotation(r.matrixWorld),Wl.setFromRotationMatrix(Gl),this.quaternion.premultiply(Wl.invert()))}add(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return e===this?(V(`Object3D.add: object can't be added as a child of itself.`,e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent($l),tu.child=e,this.dispatchEvent(tu),tu.child=null):V(`Object3D.add: object not an instance of THREE.Object3D.`,e),this)}remove(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.remove(arguments[e]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(eu),nu.child=e,this.dispatchEvent(nu),nu.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Gl.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Gl.multiply(e.parent.matrixWorld)),e.applyMatrix4(Gl),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent($l),tu.child=e,this.dispatchEvent(tu),tu.child=null,this}getObjectById(e){return this.getObjectByProperty(`id`,e)}getObjectByName(e){return this.getObjectByProperty(`name`,e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ql,e,Jl),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ql,Yl,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,r=e.z,i=this.matrix.elements;i[12]+=t-i[0]*t-i[4]*n-i[8]*r,i[13]+=n-i[1]*t-i[5]*n-i[9]*r,i[14]+=r-i[2]*t-i[6]*n-i[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let e=this.children;for(let t=0,r=e.length;t<r;t++)e[t].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e==`string`,n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:`Object`,generator:`Object3D.toJSON`});let r={};r.uuid=this.uuid,r.type=this.type,r.name=this.name,r.castShadow=this.castShadow,r.receiveShadow=this.receiveShadow,r.visible=this.visible,r.frustumCulled=this.frustumCulled,r.renderOrder=this.renderOrder,r.static=this.static,r.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type=`InstancedMesh`,r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type=`BatchedMesh`,r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox?e.boundingBox.toJSON():void 0,boundingSphere:e.boundingSphere?e.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(e=>({...e})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function i(t,n){return t[n.uuid]===void 0&&(t[n.uuid]=n.toJSON(e)),n.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=i(e.geometries,this.geometry);let t=this.geometry.parameters;if(t!==void 0&&t.shapes!==void 0){let n=t.shapes;if(Array.isArray(n))for(let t=0,r=n.length;t<r;t++){let r=n[t];i(e.shapes,r)}else i(e.shapes,n)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(i(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0){if(Array.isArray(this.material)){let t=[];for(let n=0,r=this.material.length;n<r;n++)t.push(i(e.materials,this.material[n]));r.material=t}else r.material=i(e.materials,this.material)}if(this.children.length>0){r.children=[];for(let t=0;t<this.children.length;t++)r.children.push(this.children[t].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let t=0;t<this.animations.length;t++){let n=this.animations[t];r.animations.push(i(e.animations,n))}}if(t){let t=a(e.geometries),r=a(e.materials),i=a(e.textures),o=a(e.images),s=a(e.shapes),c=a(e.skeletons),l=a(e.animations),u=a(e.nodes);t.length>0&&(n.geometries=t),r.length>0&&(n.materials=r),i.length>0&&(n.textures=i),o.length>0&&(n.images=o),s.length>0&&(n.shapes=s),c.length>0&&(n.skeletons=c),l.length>0&&(n.animations=l),u.length>0&&(n.nodes=u)}return n.object=r,n;function a(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot===null?null:e.pivot.clone(),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let t=0;t<e.children.length;t++){let n=e.children[t];this.add(n.clone())}return this}dispose(){this.dispatchEvent({type:`dispose`})}};ru.DEFAULT_UP=new W(0,1,0),ru.DEFAULT_MATRIX_AUTO_UPDATE=!0,ru.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var iu=class extends ru{constructor(){super(),this.isGroup=!0,this.type=`Group`}},au={type:`move`},ou=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new iu,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new iu,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new W,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new W),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new iu,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new W,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new W,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:`connected`,data:e}),this}disconnect(e){return this.dispatchEvent({type:`disconnected`,data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let r=null,i=null,a=null,o=this._targetRay,s=this._grip,c=this._hand;if(e&&t.session.visibilityState!==`visible-blurred`){if(c&&e.hand){a=!0;for(let r of e.hand.values()){let e=t.getJointPose(r,n),i=this._getHandJoint(c,r);e!==null&&(i.matrix.fromArray(e.transform.matrix),i.matrix.decompose(i.position,i.rotation,i.scale),i.matrixWorldNeedsUpdate=!0,i.jointRadius=e.radius),i.visible=e!==null}let r=c.joints[`index-finger-tip`],i=c.joints[`thumb-tip`],o=r.position.distanceTo(i.position);c.inputState.pinching&&o>.025?(c.inputState.pinching=!1,this.dispatchEvent({type:`pinchend`,handedness:e.handedness,target:this})):!c.inputState.pinching&&o<=.015&&(c.inputState.pinching=!0,this.dispatchEvent({type:`pinchstart`,handedness:e.handedness,target:this}))}else s!==null&&e.gripSpace&&(i=t.getPose(e.gripSpace,n),i!==null&&(s.matrix.fromArray(i.transform.matrix),s.matrix.decompose(s.position,s.rotation,s.scale),s.matrixWorldNeedsUpdate=!0,i.linearVelocity?(s.hasLinearVelocity=!0,s.linearVelocity.copy(i.linearVelocity)):s.hasLinearVelocity=!1,i.angularVelocity?(s.hasAngularVelocity=!0,s.angularVelocity.copy(i.angularVelocity)):s.hasAngularVelocity=!1,s.eventsEnabled&&s.dispatchEvent({type:`gripUpdated`,data:e,target:this})));o!==null&&(r=t.getPose(e.targetRaySpace,n),r===null&&i!==null&&(r=i),r!==null&&(o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,r.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(r.linearVelocity)):o.hasLinearVelocity=!1,r.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(r.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(au)))}return o!==null&&(o.visible=r!==null),s!==null&&(s.visible=i!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new iu;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},su={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},cu={h:0,s:0,l:0},lu={h:0,s:0,l:0};function uu(e,t,n){return n<0&&(n+=1),n>1&&--n,n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var K=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let t=e;t&&t.isColor?this.copy(t):typeof t==`number`?this.setHex(t):typeof t==`string`&&this.setStyle(t)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=_c){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,ml.colorSpaceToWorking(this,t),this}setRGB(e,t,n,r=ml.workingColorSpace){return this.r=e,this.g=t,this.b=n,ml.colorSpaceToWorking(this,r),this}setHSL(e,t,n,r=ml.workingColorSpace){if(e=Bc(e,1),t=H(t,0,1),n=H(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,i=2*n-r;this.r=uu(i,r,e+1/3),this.g=uu(i,r,e),this.b=uu(i,r,e-1/3)}return ml.colorSpaceToWorking(this,r),this}setStyle(e,t=_c){function n(t){t!==void 0&&parseFloat(t)<1&&B(`Color: Alpha component of `+e+` will be ignored.`)}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let i,a=r[1],o=r[2];switch(a){case`rgb`:case`rgba`:if(i=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(255,parseInt(i[1],10))/255,Math.min(255,parseInt(i[2],10))/255,Math.min(255,parseInt(i[3],10))/255,t);if(i=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(100,parseInt(i[1],10))/100,Math.min(100,parseInt(i[2],10))/100,Math.min(100,parseInt(i[3],10))/100,t);break;case`hsl`:case`hsla`:if(i=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setHSL(parseFloat(i[1])/360,parseFloat(i[2])/100,parseFloat(i[3])/100,t);break;default:B(`Color: Unknown color model `+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let n=r[1],i=n.length;if(i===3)return this.setRGB(parseInt(n.charAt(0),16)/15,parseInt(n.charAt(1),16)/15,parseInt(n.charAt(2),16)/15,t);if(i===6)return this.setHex(parseInt(n,16),t);B(`Color: Invalid hex color `+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=_c){let n=su[e.toLowerCase()];return n===void 0?B(`Color: Unknown color `+e):this.setHex(n,t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=hl(e.r),this.g=hl(e.g),this.b=hl(e.b),this}copyLinearToSRGB(e){return this.r=gl(e.r),this.g=gl(e.g),this.b=gl(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=_c){return ml.workingToColorSpace(du.copy(this),e),Math.round(H(du.r*255,0,255))*65536+Math.round(H(du.g*255,0,255))*256+Math.round(H(du.b*255,0,255))}getHexString(e=_c){return(`000000`+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=ml.workingColorSpace){ml.workingToColorSpace(du.copy(this),t);let n=du.r,r=du.g,i=du.b,a=Math.max(n,r,i),o=Math.min(n,r,i),s,c,l=(o+a)/2;if(o===a)s=0,c=0;else{let e=a-o;switch(c=l<=.5?e/(a+o):e/(2-a-o),a){case n:s=(r-i)/e+(r<i?6:0);break;case r:s=(i-n)/e+2;break;case i:s=(n-r)/e+4}s/=6}return e.h=s,e.s=c,e.l=l,e}getRGB(e,t=ml.workingColorSpace){return ml.workingToColorSpace(du.copy(this),t),e.r=du.r,e.g=du.g,e.b=du.b,e}getStyle(e=_c){ml.workingToColorSpace(du.copy(this),e);let t=du.r,n=du.g,r=du.b;return e===`srgb`?`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`:`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`}offsetHSL(e,t,n){return this.getHSL(cu),this.setHSL(cu.h+e,cu.s+t,cu.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(cu),e.getHSL(lu);let n=Uc(cu.h,lu.h,t),r=Uc(cu.s,lu.s,t),i=Uc(cu.l,lu.l,t);return this.setHSL(n,r,i),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,i=e.elements;return this.r=i[0]*t+i[3]*n+i[6]*r,this.g=i[1]*t+i[4]*n+i[7]*r,this.b=i[2]*t+i[5]*n+i[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},du=new K;K.NAMES=su;var fu=class extends ru{constructor(){super(),this.isScene=!0,this.type=`Scene`,this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Bl,this.environmentIntensity=1,this.environmentRotation=new Bl,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),t.object.backgroundBlurriness=this.backgroundBlurriness,t.object.backgroundIntensity=this.backgroundIntensity,t.object.backgroundRotation=this.backgroundRotation.toArray(),t.object.environmentIntensity=this.environmentIntensity,t.object.environmentRotation=this.environmentRotation.toArray(),t}},pu=new W,mu=new W,hu=new W,gu=new W,_u=new W,vu=new W,yu=new W,bu=new W,xu=new W,Su=new W,Cu=new Tl,wu=new Tl,Tu=new Tl,Eu=class e{constructor(e=new W,t=new W,n=new W){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,r){r.subVectors(n,t),pu.subVectors(e,t),r.cross(pu);let i=r.lengthSq();return i>0?r.multiplyScalar(1/Math.sqrt(i)):r.set(0,0,0)}static getBarycoord(e,t,n,r,i){pu.subVectors(r,t),mu.subVectors(n,t),hu.subVectors(e,t);let a=pu.dot(pu),o=pu.dot(mu),s=pu.dot(hu),c=mu.dot(mu),l=mu.dot(hu),u=a*c-o*o;if(u===0)return i.set(0,0,0),null;let d=1/u,f=(c*s-o*l)*d,p=(a*l-o*s)*d;return i.set(1-f-p,p,f)}static containsPoint(e,t,n,r){return this.getBarycoord(e,t,n,r,gu)!==null&&gu.x>=0&&gu.y>=0&&gu.x+gu.y<=1}static getInterpolation(e,t,n,r,i,a,o,s){return this.getBarycoord(e,t,n,r,gu)===null?(s.x=0,s.y=0,`z`in s&&(s.z=0),`w`in s&&(s.w=0),null):(s.setScalar(0),s.addScaledVector(i,gu.x),s.addScaledVector(a,gu.y),s.addScaledVector(o,gu.z),s)}static getInterpolatedAttribute(e,t,n,r,i,a){return Cu.setScalar(0),wu.setScalar(0),Tu.setScalar(0),Cu.fromBufferAttribute(e,t),wu.fromBufferAttribute(e,n),Tu.fromBufferAttribute(e,r),a.setScalar(0),a.addScaledVector(Cu,i.x),a.addScaledVector(wu,i.y),a.addScaledVector(Tu,i.z),a}static isFrontFacing(e,t,n,r){return pu.subVectors(n,t),mu.subVectors(e,t),pu.cross(mu).dot(r)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,r){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,n,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return pu.subVectors(this.c,this.b),mu.subVectors(this.a,this.b),pu.cross(mu).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return e.getNormal(this.a,this.b,this.c,t)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,n){return e.getBarycoord(t,this.a,this.b,this.c,n)}getInterpolation(t,n,r,i,a){return e.getInterpolation(t,this.a,this.b,this.c,n,r,i,a)}containsPoint(t){return e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,r=this.b,i=this.c,a,o;_u.subVectors(r,n),vu.subVectors(i,n),bu.subVectors(e,n);let s=_u.dot(bu),c=vu.dot(bu);if(s<=0&&c<=0)return t.copy(n);xu.subVectors(e,r);let l=_u.dot(xu),u=vu.dot(xu);if(l>=0&&u<=l)return t.copy(r);let d=s*u-l*c;if(d<=0&&s>=0&&l<=0)return a=s/(s-l),t.copy(n).addScaledVector(_u,a);Su.subVectors(e,i);let f=_u.dot(Su),p=vu.dot(Su);if(p>=0&&f<=p)return t.copy(i);let m=f*c-s*p;if(m<=0&&c>=0&&p<=0)return o=c/(c-p),t.copy(n).addScaledVector(vu,o);let h=l*p-f*u;if(h<=0&&u-l>=0&&f-p>=0)return yu.subVectors(i,r),o=(u-l)/(u-l+(f-p)),t.copy(r).addScaledVector(yu,o);let g=1/(h+m+d);return a=m*g,o=d*g,t.copy(n).addScaledVector(_u,a).addScaledVector(vu,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Du=class{constructor(e=new W(1/0,1/0,1/0),t=new W(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(ku.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(ku.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=ku.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute(`position`);if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let t=0,n=r.count;t<n;t++)e.isMesh===!0?e.getVertexPosition(t,ku):ku.fromBufferAttribute(r,t),ku.applyMatrix4(e.matrixWorld),this.expandByPoint(ku);else e.boundingBox===void 0?(n.boundingBox===null&&n.computeBoundingBox(),Au.copy(n.boundingBox)):(e.boundingBox===null&&e.computeBoundingBox(),Au.copy(e.boundingBox)),Au.applyMatrix4(e.matrixWorld),this.union(Au)}let r=e.children;for(let e=0,n=r.length;e<n;e++)this.expandByObject(r[e],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,ku),ku.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Lu),Ru.subVectors(this.max,Lu),ju.subVectors(e.a,Lu),Mu.subVectors(e.b,Lu),Nu.subVectors(e.c,Lu),Pu.subVectors(Mu,ju),Fu.subVectors(Nu,Mu),Iu.subVectors(ju,Nu);let t=[0,-Pu.z,Pu.y,0,-Fu.z,Fu.y,0,-Iu.z,Iu.y,Pu.z,0,-Pu.x,Fu.z,0,-Fu.x,Iu.z,0,-Iu.x,-Pu.y,Pu.x,0,-Fu.y,Fu.x,0,-Iu.y,Iu.x,0];return!Vu(t,ju,Mu,Nu,Ru)||(t=[1,0,0,0,1,0,0,0,1],!Vu(t,ju,Mu,Nu,Ru))?!1:(zu.crossVectors(Pu,Fu),t=[zu.x,zu.y,zu.z],Vu(t,ju,Mu,Nu,Ru))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,ku).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(ku).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()||(Ou[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Ou[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Ou[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Ou[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Ou[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Ou[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Ou[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Ou[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Ou)),this}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Ou=[new W,new W,new W,new W,new W,new W,new W,new W],ku=new W,Au=new Du,ju=new W,Mu=new W,Nu=new W,Pu=new W,Fu=new W,Iu=new W,Lu=new W,Ru=new W,zu=new W,Bu=new W;function Vu(e,t,n,r,i){for(let a=0,o=e.length-3;a<=o;a+=3){Bu.fromArray(e,a);let o=i.x*Math.abs(Bu.x)+i.y*Math.abs(Bu.y)+i.z*Math.abs(Bu.z),s=t.dot(Bu),c=n.dot(Bu),l=r.dot(Bu);if(Math.max(-Math.max(s,c,l),Math.min(s,c,l))>o)return!1}return!0}var Hu=new W,Uu=new U,Wu=0,Gu=class extends Pc{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw TypeError(`THREE.BufferAttribute: array should be a Typed Array.`);this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Wu++}),this.name=``,this.array=e,this.itemSize=t,this.count=e===void 0?0:e.length/t,this.normalized=n,this.usage=Sc,this.updateRanges=[],this.gpuType=us,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let r=0,i=this.itemSize;r<i;r++)this.array[e+r]=t.array[n+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Uu.fromBufferAttribute(this,t),Uu.applyMatrix3(e),this.setXY(t,Uu.x,Uu.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Hu.fromBufferAttribute(this,t),Hu.applyMatrix3(e),this.setXYZ(t,Hu.x,Hu.y,Hu.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Hu.fromBufferAttribute(this,t),Hu.applyMatrix4(e),this.setXYZ(t,Hu.x,Hu.y,Hu.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Hu.fromBufferAttribute(this,t),Hu.applyNormalMatrix(e),this.setXYZ(t,Hu.x,Hu.y,Hu.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Hu.fromBufferAttribute(this,t),Hu.transformDirection(e),this.setXYZ(t,Hu.x,Hu.y,Hu.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=il(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=al(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=il(t,this.array)),t}setX(e,t){return this.normalized&&(t=al(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=il(t,this.array)),t}setY(e,t){return this.normalized&&(t=al(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=il(t,this.array)),t}setZ(e,t){return this.normalized&&(t=al(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=il(t,this.array)),t}setW(e,t){return this.normalized&&(t=al(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=al(t,this.array),n=al(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,r){return e*=this.itemSize,this.normalized&&(t=al(t,this.array),n=al(n,this.array),r=al(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e*=this.itemSize,this.normalized&&(t=al(t,this.array),n=al(n,this.array),r=al(r,this.array),i=al(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this.array[e+3]=i,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:`dispose`})}},Ku=class extends Gu{constructor(e,t,n){super(new Uint16Array(e),t,n)}},qu=class extends Gu{constructor(e,t,n){super(new Uint32Array(e),t,n)}},Ju=class extends Gu{constructor(e,t,n){super(new Float32Array(e),t,n)}},Yu=new Du,Xu=new W,Zu=new W,Qu=class{constructor(e=new W,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t===void 0?Yu.setFromPoints(e).getCenter(n):n.copy(t);let r=0;for(let t=0,i=e.length;t<i;t++)r=Math.max(r,n.distanceToSquared(e[t]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius*=e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Xu.subVectors(e,this.center);let t=Xu.lengthSq();if(t>this.radius*this.radius){let e=Math.sqrt(t),n=(e-this.radius)*.5;this.center.addScaledVector(Xu,n/e),this.radius+=n}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Zu.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Xu.copy(e.center).add(Zu)),this.expandByPoint(Xu.copy(e.center).sub(Zu))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},$u=0,ed=new Al,td=new ru,nd=new W,rd=new Du,id=new Du,ad=new W,od=class e extends Pc{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:$u++}),this.uuid=zc(),this.name=``,this.type=`BufferGeometry`,this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return this.index=Array.isArray(e)?new(wc(e)?qu:Ku)(e,1):e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let t=new G().getNormalMatrix(e);n.applyNormalMatrix(t),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return ed.makeRotationFromQuaternion(e),this.applyMatrix4(ed),this}rotateX(e){return ed.makeRotationX(e),this.applyMatrix4(ed),this}rotateY(e){return ed.makeRotationY(e),this.applyMatrix4(ed),this}rotateZ(e){return ed.makeRotationZ(e),this.applyMatrix4(ed),this}translate(e,t,n){return ed.makeTranslation(e,t,n),this.applyMatrix4(ed),this}scale(e,t,n){return ed.makeScale(e,t,n),this.applyMatrix4(ed),this}lookAt(e){return td.lookAt(e),td.updateMatrix(),this.applyMatrix4(td.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(nd).negate(),this.translate(nd.x,nd.y,nd.z),this}setFromPoints(e){let t=this.getAttribute(`position`);if(t===void 0){let t=[];for(let n=0,r=e.length;n<r;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}this.setAttribute(`position`,new Ju(t,3))}else{let n=Math.min(e.length,t.count);for(let r=0;r<n;r++){let n=e[r];t.setXYZ(r,n.x,n.y,n.z||0)}e.length>t.count&&B(`BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.`),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Du);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute)V(`BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.`,this),this.boundingBox.set(new W(-1/0,-1/0,-1/0),new W(1/0,1/0,1/0));else{if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];rd.setFromBufferAttribute(n),this.morphTargetsRelative?(ad.addVectors(this.boundingBox.min,rd.min),this.boundingBox.expandByPoint(ad),ad.addVectors(this.boundingBox.max,rd.max),this.boundingBox.expandByPoint(ad)):(this.boundingBox.expandByPoint(rd.min),this.boundingBox.expandByPoint(rd.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&V(`BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.`,this)}}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Qu);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute)V(`BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.`,this),this.boundingSphere.set(new W,1/0);else if(e){let n=this.boundingSphere.center;if(rd.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];id.setFromBufferAttribute(n),this.morphTargetsRelative?(ad.addVectors(rd.min,id.min),rd.expandByPoint(ad),ad.addVectors(rd.max,id.max),rd.expandByPoint(ad)):(rd.expandByPoint(id.min),rd.expandByPoint(id.max))}rd.getCenter(n);let r=0;for(let t=0,i=e.count;t<i;t++)ad.fromBufferAttribute(e,t),r=Math.max(r,n.distanceToSquared(ad));if(t)for(let i=0,a=t.length;i<a;i++){let a=t[i],o=this.morphTargetsRelative;for(let t=0,i=a.count;t<i;t++)ad.fromBufferAttribute(a,t),o&&(nd.fromBufferAttribute(e,t),ad.add(nd)),r=Math.max(r,n.distanceToSquared(ad))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&V(`BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.`,this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){V(`BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)`);return}let n=t.position,r=t.normal,i=t.uv,a=this.getAttribute(`tangent`);(a===void 0||a.count!==n.count)&&(a=new Gu(new Float32Array(4*n.count),4),this.setAttribute(`tangent`,a));let o=[],s=[];for(let e=0;e<n.count;e++)o[e]=new W,s[e]=new W;let c=new W,l=new W,u=new W,d=new U,f=new U,p=new U,m=new W,h=new W;function g(e,t,r){c.fromBufferAttribute(n,e),l.fromBufferAttribute(n,t),u.fromBufferAttribute(n,r),d.fromBufferAttribute(i,e),f.fromBufferAttribute(i,t),p.fromBufferAttribute(i,r),l.sub(c),u.sub(c),f.sub(d),p.sub(d);let a=1/(f.x*p.y-p.x*f.y);isFinite(a)&&(m.copy(l).multiplyScalar(p.y).addScaledVector(u,-f.y).multiplyScalar(a),h.copy(u).multiplyScalar(f.x).addScaledVector(l,-p.x).multiplyScalar(a),o[e].add(m),o[t].add(m),o[r].add(m),s[e].add(h),s[t].add(h),s[r].add(h))}let _=this.groups;_.length===0&&(_=[{start:0,count:e.count}]);for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)g(e.getX(t+0),e.getX(t+1),e.getX(t+2))}let v=new W,y=new W,b=new W,x=new W;function S(e){b.fromBufferAttribute(r,e),x.copy(b);let t=o[e];v.copy(t),v.sub(b.multiplyScalar(b.dot(t))).normalize(),y.crossVectors(x,t);let n=y.dot(s[e])<0?-1:1;a.setXYZW(e,v.x,v.y,v.z,n)}for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)S(e.getX(t+0)),S(e.getX(t+1)),S(e.getX(t+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute(`position`);if(t!==void 0){let n=this.getAttribute(`normal`);if(n===void 0||n.count!==t.count)n=new Gu(new Float32Array(t.count*3),3),this.setAttribute(`normal`,n);else for(let e=0,t=n.count;e<t;e++)n.setXYZ(e,0,0,0);let r=new W,i=new W,a=new W,o=new W,s=new W,c=new W,l=new W,u=new W;if(e)for(let d=0,f=e.count;d<f;d+=3){let f=e.getX(d+0),p=e.getX(d+1),m=e.getX(d+2);r.fromBufferAttribute(t,f),i.fromBufferAttribute(t,p),a.fromBufferAttribute(t,m),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),o.fromBufferAttribute(n,f),s.fromBufferAttribute(n,p),c.fromBufferAttribute(n,m),o.add(l),s.add(l),c.add(l),n.setXYZ(f,o.x,o.y,o.z),n.setXYZ(p,s.x,s.y,s.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let e=0,o=t.count;e<o;e+=3)r.fromBufferAttribute(t,e+0),i.fromBufferAttribute(t,e+1),a.fromBufferAttribute(t,e+2),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),n.setXYZ(e+0,l.x,l.y,l.z),n.setXYZ(e+1,l.x,l.y,l.z),n.setXYZ(e+2,l.x,l.y,l.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)ad.fromBufferAttribute(e,t),ad.normalize(),e.setXYZ(t,ad.x,ad.y,ad.z)}toNonIndexed(){function t(e,t){let n=e.array,r=e.itemSize,i=e.normalized,a=new n.constructor(t.length*r),o=0,s=0;for(let i=0,c=t.length;i<c;i++){o=e.isInterleavedBufferAttribute?t[i]*e.data.stride+e.offset:t[i]*r;for(let e=0;e<r;e++)a[s++]=n[o++]}return new Gu(a,r,i)}if(this.index===null)return B(`BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.`),this;let n=new e,r=this.index.array,i=this.attributes;for(let e in i){let a=i[e],o=t(a,r);n.setAttribute(e,o)}let a=this.morphAttributes;for(let e in a){let i=[],o=a[e];for(let e=0,n=o.length;e<n;e++){let n=o[e],a=t(n,r);i.push(a)}n.morphAttributes[e]=i}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let e=0,t=o.length;e<t;e++){let t=o[e];n.addGroup(t.start,t.count,t.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:`BufferGeometry`,generator:`BufferGeometry.toJSON`}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?`BufferGeometry`:this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let t=this.parameters;for(let n in t)t[n]!==void 0&&(e[n]=t[n]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let t in n){let r=n[t];e.data.attributes[t]=r.toJSON(e.data)}let r={},i=!1;for(let t in this.morphAttributes){let n=this.morphAttributes[t],a=[];for(let t=0,r=n.length;t<r;t++){let r=n[t];a.push(r.toJSON(e.data))}a.length>0&&(r[t]=a,i=!0)}i&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let r=e.attributes;for(let e in r){let n=r[e];this.setAttribute(e,n.clone(t))}let i=e.morphAttributes;for(let e in i){let n=[],r=i[e];for(let e=0,i=r.length;e<i;e++)n.push(r[e].clone(t));this.morphAttributes[e]=n}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let e=0,t=a.length;e<t;e++){let t=a[e];this.addGroup(t.start,t.count,t.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let s=e.boundingSphere;return s!==null&&(this.boundingSphere=s.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:`dispose`})}},sd=new W,cd=new W,ld=new G,ud=class{constructor(e=new W(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=sd.subVectors(n,t).cross(cd.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(sd),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||ld.getNormalMatrix(e),r=this.coplanarPoint(sd).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},dd=0,fd=class extends Pc{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:dd++}),this.uuid=zc(),this.name=``,this.type=`Material`,this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new K(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=xc,this.stencilZFail=xc,this.stencilZPass=xc,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){B(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];r===void 0?B(`Material: '${t}' is not a property of THREE.${this.type}.`):r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:`Material`,generator:`Material.toJSON`}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(e=>e.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}if(t){let t=r(e.textures),i=r(e.images);t.length>0&&(n.textures=t),i.length>0&&(n.images=i)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new K().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(e=>new ud().fromJSON(e))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(this.vertexColors=typeof e.vertexColors==`number`?e.vertexColors>0:e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let t=e.normalScale;Array.isArray(t)===!1&&(t=[t,t]),this.normalScale=new U().fromArray(t)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new U().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let e=t.length;n=Array(e);for(let r=0;r!==e;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:`dispose`})}set needsUpdate(e){e===!0&&this.version++}},pd=new W,md=new W,hd=new W,gd=new W,_d=class{constructor(e=new W,t=new W(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,pd)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=pd.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(pd.copy(this.origin).addScaledVector(this.direction,t),pd.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){md.copy(e).add(t).multiplyScalar(.5),hd.copy(t).sub(e).normalize(),gd.copy(this.origin).sub(md);let i=e.distanceTo(t)*.5,a=-this.direction.dot(hd),o=gd.dot(this.direction),s=-gd.dot(hd),c=gd.lengthSq(),l=Math.abs(1-a*a),u,d,f,p;if(l>0){if(u=a*s-o,d=a*o-s,p=i*l,u>=0){if(d>=-p){if(d<=p){let e=1/l;u*=e,d*=e,f=u*(u+a*d+2*o)+d*(a*u+d+2*s)+c}else d=i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d=-i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d<=-p?(u=Math.max(0,-(-a*i+o)),d=u>0?-i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c):d<=p?(u=0,d=Math.min(Math.max(-i,-s),i),f=d*(d+2*s)+c):(u=Math.max(0,-(a*i+o)),d=u>0?i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c)}else d=a>0?-i:i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(md).addScaledVector(hd,d),f}intersectSphere(e,t){if(e.radius<0)return null;pd.subVectors(e.center,this.origin);let n=pd.dot(this.direction),r=pd.dot(pd)-n*n,i=e.radius*e.radius;if(r>i)return null;let a=Math.sqrt(i-r),o=n-a,s=n+a;return s<0?null:o<0?this.at(s,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,i,a,o,s,c=1/this.direction.x,l=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),l>=0?(i=(e.min.y-d.y)*l,a=(e.max.y-d.y)*l):(i=(e.max.y-d.y)*l,a=(e.min.y-d.y)*l),n>a||i>r||((i>n||isNaN(n))&&(n=i),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,s=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,s=(e.min.z-d.z)*u),n>s||o>r)||((o>n||n!==n)&&(n=o),(s<r||r!==r)&&(r=s),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,pd)!==null}intersectTriangle(e,t,n,r,i){let a=this.origin,o=this.direction,s=o.x,c=o.y,l=o.z,u=e.x-a.x,d=e.y-a.y,f=e.z-a.z,p=t.x-a.x,m=t.y-a.y,h=t.z-a.z,g=n.x-a.x,_=n.y-a.y,v=n.z-a.z,y=Math.abs(s),b=Math.abs(c),x=Math.abs(l),S,C,w,T,E,D,O,k,A,j,M,N;if(y>=b&&y>=x?(w=s,D=u,A=p,N=g,s>=0?(S=c,C=l,T=d,E=f,O=m,k=h,j=_,M=v):(S=l,C=c,T=f,E=d,O=h,k=m,j=v,M=_)):b>=x?(w=c,D=d,A=m,N=_,c>=0?(S=l,C=s,T=f,E=u,O=h,k=p,j=v,M=g):(S=s,C=l,T=u,E=f,O=p,k=h,j=g,M=v)):(w=l,D=f,A=h,N=v,l>=0?(S=s,C=c,T=u,E=d,O=p,k=m,j=g,M=_):(S=c,C=s,T=d,E=u,O=m,k=p,j=_,M=g)),w===0)return null;let ee=S/w,te=C/w,ne=1/w,re=T-ee*D,ie=E-te*D,ae=O-ee*A,oe=k-te*A,P=j-ee*N,se=M-te*N,ce=P*oe-se*ae,le=re*se-ie*P,ue=ae*ie-oe*re;if(r){if(ce<0||le<0||ue<0)return null}else if((ce<0||le<0||ue<0)&&(ce>0||le>0||ue>0))return null;let de=ce+le+ue;if(de===0)return null;let fe=ne*(ce*D+le*A+ue*N);return(de>0?fe<0:fe>0)?null:this.at(fe/de,i)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},vd=class extends fd{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type=`MeshBasicMaterial`,this.color=new K(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Bl,this.combine=0,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},yd=new Al,bd=new _d,xd=new Qu,Sd=new W,Cd=new W,wd=new W,Td=new W,Ed=new W,Dd=new W,Od=new W,kd=new W,Ad=class extends ru{constructor(e=new od,t=new vd){super(),this.isMesh=!0,this.type=`Mesh`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}getVertexPosition(e,t){let n=this.geometry,r=n.attributes.position,i=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(r,e);let o=this.morphTargetInfluences;if(i&&o){Dd.set(0,0,0);for(let n=0,r=i.length;n<r;n++){let r=o[n],s=i[n];r!==0&&(Ed.fromBufferAttribute(s,e),a?Dd.addScaledVector(Ed,r):Dd.addScaledVector(Ed.sub(t),r))}t.add(Dd)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.material,i=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),xd.copy(n.boundingSphere),xd.applyMatrix4(i),bd.copy(e.ray).recast(e.near),!(xd.containsPoint(bd.origin)===!1&&(bd.intersectSphere(xd,Sd)===null||bd.origin.distanceToSquared(Sd)>(e.far-e.near)**2))&&(yd.copy(i).invert(),bd.copy(e.ray).applyMatrix4(yd),(n.boundingBox===null||bd.intersectsBox(n.boundingBox)!==!1)&&this._computeIntersections(e,t,bd)))}_computeIntersections(e,t,n){let r,i=this.geometry,a=this.material,o=i.index,s=i.attributes.position,c=i.attributes.uv,l=i.attributes.uv1,u=i.attributes.normal,d=i.groups,f=i.drawRange;if(o!==null){if(Array.isArray(a))for(let i=0,s=d.length;i<s;i++){let s=d[i],p=a[s.materialIndex],m=Math.max(s.start,f.start),h=Math.min(o.count,Math.min(s.start+s.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=o.getX(i),d=o.getX(i+1),f=o.getX(i+2);r=Md(this,p,e,n,c,l,u,a,d,f),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=s.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),s=Math.min(o.count,f.start+f.count);for(let d=i,f=s;d<f;d+=3){let i=o.getX(d),s=o.getX(d+1),f=o.getX(d+2);r=Md(this,a,e,n,c,l,u,i,s,f),r&&(r.faceIndex=Math.floor(d/3),t.push(r))}}}else if(s!==void 0){if(Array.isArray(a))for(let i=0,o=d.length;i<o;i++){let o=d[i],p=a[o.materialIndex],m=Math.max(o.start,f.start),h=Math.min(s.count,Math.min(o.start+o.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=i,s=i+1,d=i+2;r=Md(this,p,e,n,c,l,u,a,s,d),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=o.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),o=Math.min(s.count,f.start+f.count);for(let s=i,d=o;s<d;s+=3){let i=s,o=s+1,d=s+2;r=Md(this,a,e,n,c,l,u,i,o,d),r&&(r.faceIndex=Math.floor(s/3),t.push(r))}}}}};function jd(e,t,n,r,i,a,o,s){let c;if(c=t.side===1?r.intersectTriangle(o,a,i,!0,s):r.intersectTriangle(i,a,o,t.side===0,s),c===null)return null;kd.copy(s),kd.applyMatrix4(e.matrixWorld);let l=n.ray.origin.distanceTo(kd);return l<n.near||l>n.far?null:{distance:l,point:kd.clone(),object:e}}function Md(e,t,n,r,i,a,o,s,c,l){e.getVertexPosition(s,Cd),e.getVertexPosition(c,wd),e.getVertexPosition(l,Td);let u=jd(e,t,n,r,Cd,wd,Td,Od);if(u){let e=new W;Eu.getBarycoord(Od,Cd,wd,Td,e),i&&(u.uv=Eu.getInterpolatedAttribute(i,s,c,l,e,new U)),a&&(u.uv1=Eu.getInterpolatedAttribute(a,s,c,l,e,new U)),o&&(u.normal=Eu.getInterpolatedAttribute(o,s,c,l,e,new W),u.normal.dot(r.direction)>0&&u.normal.multiplyScalar(-1));let t={a:s,b:c,c:l,normal:new W,materialIndex:0};Eu.getNormal(Cd,wd,Td,t.normal),u.face=t,u.barycoord=e}return u}var Nd=class extends wl{constructor(e=null,t=1,n=1,r,i,a,o,s,c=Qo,l=Qo,u,d){super(null,a,o,s,c,l,r,i,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Pd=class extends Gu{constructor(e,t,n,r=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},Fd=new Al,Id=new Al,Ld=[],Rd=new Du,zd=new Al,Bd=new Ad,Vd=new Qu,Hd=class extends Ad{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Pd(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let e=0;e<n;e++)this.setMatrixAt(e,zd)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Du),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Fd),Rd.copy(e.boundingBox).applyMatrix4(Fd),this.boundingBox.union(Rd)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Qu),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Fd),Vd.copy(e.boundingSphere).applyMatrix4(Fd),this.boundingSphere.union(Vd)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,r=this.morphTexture.source.data.data,i=e*(n.length+1)+1;for(let e=0;e<n.length;e++)n[e]=r[i+e]}raycast(e,t){let n=this.matrixWorld,r=this.count;if(Bd.geometry=this.geometry,Bd.material=this.material,Bd.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Vd.copy(this.boundingSphere),Vd.applyMatrix4(n),e.ray.intersectsSphere(Vd)!==!1))for(let i=0;i<r;i++){this.getMatrixAt(i,Fd),Id.multiplyMatrices(n,Fd),Bd.matrixWorld=Id,Bd.raycast(e,Ld);for(let e=0,n=Ld.length;e<n;e++){let n=Ld[e];n.instanceId=i,n.object=this,t.push(n)}Ld.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new Pd(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new Nd(new Float32Array(r*this.count),r,this.count,Ss,us));let i=this.morphTexture.source.data.data,a=0;for(let e=0;e<n.length;e++)a+=n[e];let o=this.geometry.morphTargetsRelative?1:1-a,s=r*e;return i[s]=o,i.set(n,s+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Ud=new Qu,Wd=new U(.5,.5),Gd=new W,Kd=class{constructor(e=new ud,t=new ud,n=new ud,r=new ud,i=new ud,a=new ud){this.planes=[e,t,n,r,i,a]}set(e,t,n,r,i,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(i),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Cc,n=!1){let r=this.planes,i=e.elements,a=i[0],o=i[1],s=i[2],c=i[3],l=i[4],u=i[5],d=i[6],f=i[7],p=i[8],m=i[9],h=i[10],g=i[11],_=i[12],v=i[13],y=i[14],b=i[15];if(r[0].setComponents(c-a,f-l,g-p,b-_).normalize(),r[1].setComponents(c+a,f+l,g+p,b+_).normalize(),r[2].setComponents(c+o,f+u,g+m,b+v).normalize(),r[3].setComponents(c-o,f-u,g-m,b-v).normalize(),n)r[4].setComponents(s,d,h,y).normalize(),r[5].setComponents(c-s,f-d,g-h,b-y).normalize();else if(r[4].setComponents(c-s,f-d,g-h,b-y).normalize(),t===2e3)r[5].setComponents(c+s,f+d,g+h,b+y).normalize();else if(t===2001)r[5].setComponents(s,d,h,y).normalize();else throw Error(`THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: `+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Ud.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Ud.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Ud)}intersectsSprite(e){return Ud.center.set(0,0,0),Ud.radius=.7071067811865476+Wd.distanceTo(e.center),Ud.applyMatrix4(e.matrixWorld),this.intersectsSphere(Ud)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let e=0;e<6;e++)if(t[e].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(Gd.x=r.normal.x>0?e.max.x:e.min.x,Gd.y=r.normal.y>0?e.max.y:e.min.y,Gd.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Gd)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},qd=class extends wl{constructor(e=[],t=301,n,r,i,a,o,s,c,l){super(e,t,n,r,i,a,o,s,c,l),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Jd=class extends wl{constructor(e,t,n,r,i,a,o,s,c){super(e,t,n,r,i,a,o,s,c),this.isCanvasTexture=!0,this.needsUpdate=!0}},Yd=class extends wl{constructor(e,t,n=ls,r,i,a,o=Qo,s=Qo,c,l=bs,u=1){if(l!==1026&&l!==1027)throw Error(`THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat`);super({width:e,height:t,depth:u},r,i,a,o,s,l,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new bl(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return t.compareFunction=this.compareFunction,t}},Xd=class extends Yd{constructor(e,t=ls,n=301,r,i,a=Qo,o=Qo,s,c=bs){let l={width:e,height:e,depth:1},u=[l,l,l,l,l,l];super(e,e,t,n,r,i,a,o,s,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Zd=class extends wl{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Qd=class e extends od{constructor(e=1,t=1,n=1,r=1,i=1,a=1){super(),this.type=`BoxGeometry`,this.parameters={width:e,height:t,depth:n,widthSegments:r,heightSegments:i,depthSegments:a};let o=this;r=Math.floor(r),i=Math.floor(i),a=Math.floor(a);let s=[],c=[],l=[],u=[],d=0,f=0;p(`z`,`y`,`x`,-1,-1,n,t,e,a,i,0),p(`z`,`y`,`x`,1,-1,n,t,-e,a,i,1),p(`x`,`z`,`y`,1,1,e,n,t,r,a,2),p(`x`,`z`,`y`,1,-1,e,n,-t,r,a,3),p(`x`,`y`,`z`,1,-1,e,t,n,r,i,4),p(`x`,`y`,`z`,-1,-1,e,t,-n,r,i,5),this.setIndex(s),this.setAttribute(`position`,new Ju(c,3)),this.setAttribute(`normal`,new Ju(l,3)),this.setAttribute(`uv`,new Ju(u,2));function p(e,t,n,r,i,a,p,m,h,g,_){let v=a/h,y=p/g,b=a/2,x=p/2,S=m/2,C=h+1,w=g+1,T=0,E=0,D=new W;for(let a=0;a<w;a++){let o=a*y-x;for(let s=0;s<C;s++)D[e]=(s*v-b)*r,D[t]=o*i,D[n]=S,c.push(D.x,D.y,D.z),D[e]=0,D[t]=0,D[n]=m>0?1:-1,l.push(D.x,D.y,D.z),u.push(s/h),u.push(1-a/g),T+=1}for(let e=0;e<g;e++)for(let t=0;t<h;t++){let n=d+t+C*e,r=d+t+C*(e+1),i=d+(t+1)+C*(e+1),a=d+(t+1)+C*e;s.push(n,r,a),s.push(r,i,a),E+=6}o.addGroup(f,E,_),f+=E,d+=T}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}},$d=class e extends od{constructor(e=1,t=1,n=4,r=8,i=1){super(),this.type=`CapsuleGeometry`,this.parameters={radius:e,height:t,capSegments:n,radialSegments:r,heightSegments:i},t=Math.max(0,t),n=Math.max(1,Math.floor(n)),r=Math.max(3,Math.floor(r)),i=Math.max(1,Math.floor(i));let a=[],o=[],s=[],c=[],l=t/2,u=Math.PI/2*e,d=t,f=2*u+d,p=n*2+i,m=r+1,h=new W,g=new W;for(let _=0;_<=p;_++){let v=0,y=0,b=0,x=0;if(_<=n){let t=_/n,r=t*Math.PI/2;y=-l-e*Math.cos(r),b=e*Math.sin(r),x=-e*Math.cos(r),v=t*u}else if(_<=n+i){let r=(_-n)/i;y=-l+r*t,b=e,x=0,v=u+r*d}else{let t=(_-n-i)/n,r=t*Math.PI/2;y=l+e*Math.sin(r),b=e*Math.cos(r),x=e*Math.sin(r),v=u+d+t*u}let S=Math.max(0,Math.min(1,v/f)),C=0;_===0?C=.5/r:_===p&&(C=-.5/r);for(let e=0;e<=r;e++){let t=e/r,n=t*Math.PI*2,i=Math.sin(n),a=Math.cos(n);g.x=-b*a,g.y=y,g.z=b*i,o.push(g.x,g.y,g.z),h.set(-b*a,x,b*i),h.normalize(),s.push(h.x,h.y,h.z),c.push(t+C,S)}if(_>0){let e=(_-1)*m;for(let t=0;t<r;t++){let n=e+t,r=e+t+1,i=_*m+t,o=_*m+t+1;a.push(n,r,i),a.push(r,o,i)}}}this.setIndex(a),this.setAttribute(`position`,new Ju(o,3)),this.setAttribute(`normal`,new Ju(s,3)),this.setAttribute(`uv`,new Ju(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}},ef=class e extends od{constructor(e=1,t=32,n=0,r=Math.PI*2){super(),this.type=`CircleGeometry`,this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:r},t=Math.max(3,t);let i=[],a=[],o=[],s=[],c=new W,l=new U;a.push(0,0,0),o.push(0,0,1),s.push(.5,.5);for(let i=0,u=3;i<=t;i++,u+=3){let d=n+i/t*r;c.x=e*Math.cos(d),c.y=e*Math.sin(d),a.push(c.x,c.y,c.z),o.push(0,0,1),l.x=(a[u]/e+1)/2,l.y=(a[u+1]/e+1)/2,s.push(l.x,l.y)}for(let e=1;e<=t;e++)i.push(e,e+1,0);this.setIndex(i),this.setAttribute(`position`,new Ju(a,3)),this.setAttribute(`normal`,new Ju(o,3)),this.setAttribute(`uv`,new Ju(s,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.segments,t.thetaStart,t.thetaLength)}},tf=class e extends od{constructor(e=1,t=1,n=1,r=32,i=1,a=!1,o=0,s=Math.PI*2){super(),this.type=`CylinderGeometry`,this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:r,heightSegments:i,openEnded:a,thetaStart:o,thetaLength:s};let c=this;r=Math.floor(r),i=Math.floor(i);let l=[],u=[],d=[],f=[],p=0,m=[],h=n/2,g=0;_(),a===!1&&(e>0&&v(!0),t>0&&v(!1)),this.setIndex(l),this.setAttribute(`position`,new Ju(u,3)),this.setAttribute(`normal`,new Ju(d,3)),this.setAttribute(`uv`,new Ju(f,2));function _(){let a=new W,_=new W,v=0,y=(t-e)/n;for(let c=0;c<=i;c++){let l=[],g=c/i,v=g*(t-e)+e;for(let e=0;e<=r;e++){let t=e/r,i=t*s+o,c=Math.sin(i),m=Math.cos(i);_.x=v*c,_.y=-g*n+h,_.z=v*m,u.push(_.x,_.y,_.z),a.set(c,y,m).normalize(),d.push(a.x,a.y,a.z),f.push(t,1-g),l.push(p++)}m.push(l)}for(let n=0;n<r;n++)for(let r=0;r<i;r++){let a=m[r][n],o=m[r+1][n],s=m[r+1][n+1],c=m[r][n+1];(e>0||r!==0)&&(l.push(a,o,c),v+=3),(t>0||r!==i-1)&&(l.push(o,s,c),v+=3)}c.addGroup(g,v,0),g+=v}function v(n){let i=p,a=new U,m=new W,_=0,v=n===!0?e:t,y=n===!0?1:-1;for(let e=1;e<=r;e++)u.push(0,h*y,0),d.push(0,y,0),f.push(.5,.5),p++;let b=p;for(let e=0;e<=r;e++){let t=e/r*s+o,n=Math.cos(t),i=Math.sin(t);m.x=v*i,m.y=h*y,m.z=v*n,u.push(m.x,m.y,m.z),d.push(0,y,0),a.x=n*.5+.5,a.y=i*.5*y+.5,f.push(a.x,a.y),p++}for(let e=0;e<r;e++){let t=i+e,r=b+e;n===!0?l.push(r,r+1,t):l.push(r+1,r,t),_+=3}c.addGroup(g,_,n===!0?1:2),g+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},nf=class{constructor(){this.type=`Curve`,this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){B(`Curve: .getPoint() not implemented.`)}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,r=this.getPoint(0),i=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),i+=n.distanceTo(r),t.push(i),r=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),r=0,i=n.length,a;a=t||e*n[i-1];let o=0,s=i-1,c;for(;o<=s;)if(r=Math.floor(o+(s-o)/2),c=n[r]-a,c<0)o=r+1;else if(c>0)s=r-1;else{s=r;break}if(r=s,n[r]===a)return r/(i-1);let l=n[r],u=n[r+1]-l,d=(a-l)/u;return(r+d)/(i-1)}getTangent(e,t){let n=1e-4,r=e-n,i=e+n;r<0&&(r=0),i>1&&(i=1);let a=this.getPoint(r),o=this.getPoint(i),s=t||(a.isVector2?new U:new W);return s.copy(o).sub(a).normalize(),s}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new W,r=[],i=[],a=[],o=new W,s=new Al;for(let t=0;t<=e;t++){let n=t/e;r[t]=this.getTangentAt(n,new W)}i[0]=new W,a[0]=new W;let c=Number.MAX_VALUE,l=Math.abs(r[0].x),u=Math.abs(r[0].y),d=Math.abs(r[0].z);l<=c&&(c=l,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),o.crossVectors(r[0],n).normalize(),i[0].crossVectors(r[0],o),a[0].crossVectors(r[0],i[0]);for(let t=1;t<=e;t++){if(i[t]=i[t-1].clone(),a[t]=a[t-1].clone(),o.crossVectors(r[t-1],r[t]),o.length()>2**-52){o.normalize();let e=Math.acos(H(r[t-1].dot(r[t]),-1,1));i[t].applyMatrix4(s.makeRotationAxis(o,e))}a[t].crossVectors(r[t],i[t])}if(t===!0){let t=Math.acos(H(i[0].dot(i[e]),-1,1));t/=e,r[0].dot(o.crossVectors(i[0],i[e]))>0&&(t=-t);for(let n=1;n<=e;n++)i[n].applyMatrix4(s.makeRotationAxis(r[n],t*n)),a[n].crossVectors(r[n],i[n])}return{tangents:r,normals:i,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:`Curve`,generator:`Curve.toJSON`}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},rf=class extends nf{constructor(e=0,t=0,n=1,r=1,i=0,a=Math.PI*2,o=!1,s=0){super(),this.isEllipseCurve=!0,this.type=`EllipseCurve`,this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=r,this.aStartAngle=i,this.aEndAngle=a,this.aClockwise=o,this.aRotation=s}getPoint(e,t=new U){let n=t,r=Math.PI*2,i=this.aEndAngle-this.aStartAngle,a=Math.abs(i)<2**-52;for(;i<0;)i+=r;for(;i>r;)i-=r;i<2**-52&&(i=a?0:r),this.aClockwise===!0&&!a&&(i===r?i=-r:i-=r);let o=this.aStartAngle+e*i,s=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){let e=Math.cos(this.aRotation),t=Math.sin(this.aRotation),n=s-this.aX,r=c-this.aY;s=n*e-r*t+this.aX,c=n*t+r*e+this.aY}return n.set(s,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},af=class extends rf{constructor(e,t,n,r,i,a){super(e,t,n,n,r,i,a),this.isArcCurve=!0,this.type=`ArcCurve`}};function of(){let e=0,t=0,n=0,r=0;function i(i,a,o,s){e=i,t=o,n=-3*i+3*a-2*o-s,r=2*i-2*a+o+s}return{initCatmullRom:function(e,t,n,r,a){i(t,n,a*(n-e),a*(r-t))},initNonuniformCatmullRom:function(e,t,n,r,a,o,s){let c=(t-e)/a-(n-e)/(a+o)+(n-t)/o,l=(n-t)/o-(r-t)/(o+s)+(r-n)/s;c*=o,l*=o,i(t,n,c,l)},calc:function(i){let a=i*i,o=a*i;return e+t*i+n*a+r*o}}}var sf=new W,cf=new W,lf=new of,uf=new of,df=new of,ff=class extends nf{constructor(e=[],t=!1,n=`centripetal`,r=.5){super(),this.isCatmullRomCurve3=!0,this.type=`CatmullRomCurve3`,this.points=e,this.closed=t,this.curveType=n,this.tension=r}getPoint(e,t=new W){let n=t,r=this.points,i=r.length,a=(i-+!this.closed)*e,o=Math.floor(a),s=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/i)+1)*i:s===0&&o===i-1&&(o=i-2,s=1);let c,l;this.closed||o>0?c=r[(o-1)%i]:(cf.subVectors(r[0],r[1]).add(r[0]),c=cf);let u=r[o%i],d=r[(o+1)%i];if(this.closed||o+2<i?l=r[(o+2)%i]:(sf.subVectors(r[i-1],r[i-2]).add(r[i-1]),l=sf),this.curveType===`centripetal`||this.curveType===`chordal`){let e=this.curveType===`chordal`?.5:.25,t=c.distanceToSquared(u)**+e,n=u.distanceToSquared(d)**+e,r=d.distanceToSquared(l)**+e;n<1e-4&&(n=1),t<1e-4&&(t=n),r<1e-4&&(r=n),lf.initNonuniformCatmullRom(c.x,u.x,d.x,l.x,t,n,r),uf.initNonuniformCatmullRom(c.y,u.y,d.y,l.y,t,n,r),df.initNonuniformCatmullRom(c.z,u.z,d.z,l.z,t,n,r)}else this.curveType===`catmullrom`&&(lf.initCatmullRom(c.x,u.x,d.x,l.x,this.tension),uf.initCatmullRom(c.y,u.y,d.y,l.y,this.tension),df.initCatmullRom(c.z,u.z,d.z,l.z,this.tension));return n.set(lf.calc(s),uf.calc(s),df.calc(s)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(n.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let n=this.points[t];e.points.push(n.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(new W().fromArray(n))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function pf(e,t,n,r,i){let a=(r-t)*.5,o=(i-n)*.5,s=e*e,c=e*s;return(2*n-2*r+a+o)*c+(-3*n+3*r-2*a-o)*s+a*e+n}function mf(e,t){let n=1-e;return n*n*t}function hf(e,t){return 2*(1-e)*e*t}function gf(e,t){return e*e*t}function _f(e,t,n,r){return mf(e,t)+hf(e,n)+gf(e,r)}function vf(e,t){let n=1-e;return n*n*n*t}function yf(e,t){let n=1-e;return 3*n*n*e*t}function bf(e,t){return 3*(1-e)*e*e*t}function xf(e,t){return e*e*e*t}function Sf(e,t,n,r,i){return vf(e,t)+yf(e,n)+bf(e,r)+xf(e,i)}var Cf=class extends nf{constructor(e=new U,t=new U,n=new U,r=new U){super(),this.isCubicBezierCurve=!0,this.type=`CubicBezierCurve`,this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new U){let n=t,r=this.v0,i=this.v1,a=this.v2,o=this.v3;return n.set(Sf(e,r.x,i.x,a.x,o.x),Sf(e,r.y,i.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},wf=class extends nf{constructor(e=new W,t=new W,n=new W,r=new W){super(),this.isCubicBezierCurve3=!0,this.type=`CubicBezierCurve3`,this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new W){let n=t,r=this.v0,i=this.v1,a=this.v2,o=this.v3;return n.set(Sf(e,r.x,i.x,a.x,o.x),Sf(e,r.y,i.y,a.y,o.y),Sf(e,r.z,i.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},Tf=class extends nf{constructor(e=new U,t=new U){super(),this.isLineCurve=!0,this.type=`LineCurve`,this.v1=e,this.v2=t}getPoint(e,t=new U){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new U){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Ef=class extends nf{constructor(e=new W,t=new W){super(),this.isLineCurve3=!0,this.type=`LineCurve3`,this.v1=e,this.v2=t}getPoint(e,t=new W){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new W){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Df=class extends nf{constructor(e=new U,t=new U,n=new U){super(),this.isQuadraticBezierCurve=!0,this.type=`QuadraticBezierCurve`,this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new U){let n=t,r=this.v0,i=this.v1,a=this.v2;return n.set(_f(e,r.x,i.x,a.x),_f(e,r.y,i.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Of=class extends nf{constructor(e=new W,t=new W,n=new W){super(),this.isQuadraticBezierCurve3=!0,this.type=`QuadraticBezierCurve3`,this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new W){let n=t,r=this.v0,i=this.v1,a=this.v2;return n.set(_f(e,r.x,i.x,a.x),_f(e,r.y,i.y,a.y),_f(e,r.z,i.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},kf=class extends nf{constructor(e=[]){super(),this.isSplineCurve=!0,this.type=`SplineCurve`,this.points=e}getPoint(e,t=new U){let n=t,r=this.points,i=(r.length-1)*e,a=Math.floor(i),o=i-a,s=r[a===0?a:a-1],c=r[a],l=r[a>r.length-2?r.length-1:a+1],u=r[a>r.length-3?r.length-1:a+2];return n.set(pf(o,s.x,c.x,l.x,u.x),pf(o,s.y,c.y,l.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(n.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let n=this.points[t];e.points.push(n.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(new U().fromArray(n))}return this}},Af=Object.freeze({__proto__:null,ArcCurve:af,CatmullRomCurve3:ff,CubicBezierCurve:Cf,CubicBezierCurve3:wf,EllipseCurve:rf,LineCurve:Tf,LineCurve3:Ef,QuadraticBezierCurve:Df,QuadraticBezierCurve3:Of,SplineCurve:kf}),jf=class extends nf{constructor(){super(),this.type=`CurvePath`,this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){let e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){let n=e.isVector2===!0?`LineCurve`:`LineCurve3`;this.curves.push(new Af[n](t,e))}return this}getPoint(e,t){let n=e*this.getLength(),r=this.getCurveLengths(),i=0;for(;i<r.length;){if(r[i]>=n){let e=r[i]-n,a=this.curves[i],o=a.getLength(),s=o===0?0:1-e/o;return a.getPointAt(s,t)}i++}return null}getLength(){let e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let e=[],t=0;for(let n=0,r=this.curves.length;n<r;n++)t+=this.curves[n].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){let t=[],n;for(let r=0,i=this.curves;r<i.length;r++){let a=i[r],o=a.isEllipseCurve?e*2:a.isLineCurve||a.isLineCurve3?1:a.isSplineCurve?e*a.points.length:e,s=a.getPoints(o);for(let e=0;e<s.length;e++){let r=s[e];n&&n.equals(r)||(t.push(r),n=r)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let n=e.curves[t];this.curves.push(n.clone())}return this.autoClose=e.autoClose,this}toJSON(){let e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,n=this.curves.length;t<n;t++){let n=this.curves[t];e.curves.push(n.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){let n=e.curves[t];this.curves.push(new Af[n.type]().fromJSON(n))}return this}},Mf=class extends jf{constructor(e){super(),this.type=`Path`,this.currentPoint=new U,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,n=e.length;t<n;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){let n=new Tf(this.currentPoint.clone(),new U(e,t));return this.curves.push(n),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,n,r){let i=new Df(this.currentPoint.clone(),new U(e,t),new U(n,r));return this.curves.push(i),this.currentPoint.set(n,r),this}bezierCurveTo(e,t,n,r,i,a){let o=new Cf(this.currentPoint.clone(),new U(e,t),new U(n,r),new U(i,a));return this.curves.push(o),this.currentPoint.set(i,a),this}splineThru(e){let t=new kf([this.currentPoint.clone()].concat(e));return this.curves.push(t),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,n,r,i,a){let o=this.currentPoint.x,s=this.currentPoint.y;return this.absarc(e+o,t+s,n,r,i,a),this}absarc(e,t,n,r,i,a){return this.absellipse(e,t,n,n,r,i,a),this}ellipse(e,t,n,r,i,a,o,s){let c=this.currentPoint.x,l=this.currentPoint.y;return this.absellipse(e+c,t+l,n,r,i,a,o,s),this}absellipse(e,t,n,r,i,a,o,s){let c=new rf(e,t,n,r,i,a,o,s);if(this.curves.length>0){let e=c.getPoint(0);e.equals(this.currentPoint)||this.lineTo(e.x,e.y)}this.curves.push(c);let l=c.getPoint(1);return this.currentPoint.copy(l),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){let e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}},Nf=class extends Mf{constructor(e){super(e),this.uuid=zc(),this.type=`Shape`,this.holes=[]}getPointsHoles(e){let t=[];for(let n=0,r=this.holes.length;n<r;n++)t[n]=this.holes[n].getPoints(e);return t}extractPoints(e){return{shape:this.getPoints(e),holes:this.getPointsHoles(e)}}copy(e){super.copy(e),this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let n=e.holes[t];this.holes.push(n.clone())}return this}toJSON(){let e=super.toJSON();e.uuid=this.uuid,e.holes=[];for(let t=0,n=this.holes.length;t<n;t++){let n=this.holes[t];e.holes.push(n.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.uuid=e.uuid,this.holes=[];for(let t=0,n=e.holes.length;t<n;t++){let n=e.holes[t];this.holes.push(new Mf().fromJSON(n))}return this}};function Pf(e,t,n=2){let r=t&&t.length,i=r?t[0]*n:e.length,a=Ff(e,0,i,n,!0),o=[];if(!a||a.next===a.prev)return o;let s,c,l;if(r&&(a=Hf(e,t,a,n)),e.length>80*n){s=e[0],c=e[1];let t=s,r=c;for(let a=n;a<i;a+=n){let n=e[a],i=e[a+1];n<s&&(s=n),i<c&&(c=i),n>t&&(t=n),i>r&&(r=i)}l=Math.max(t-s,r-c),l=l===0?0:32767/l}return Lf(a,o,n,s,c,l,0),o}function Ff(e,t,n,r,i){let a;if(i===fp(e,t,n,r)>0)for(let i=t;i<n;i+=r)a=lp(i/r|0,e[i],e[i+1],a);else for(let i=n-r;i>=t;i-=r)a=lp(i/r|0,e[i],e[i+1],a);return a&&tp(a,a.next)&&(up(a),a=a.next),a}function If(e,t){if(!e)return e;t||=e;let n=e,r;do if(r=!1,!n.steiner&&(tp(n,n.next)||ep(n.prev,n,n.next)===0)){if(up(n),n=t=n.prev,n===n.next)break;r=!0}else n=n.next;while(r||n!==t);return t}function Lf(e,t,n,r,i,a,o){if(!e)return;!o&&a&&qf(e,r,i,a);let s=e;for(;e.prev!==e.next;){let c=e.prev,l=e.next;if(a?zf(e,r,i,a):Rf(e))t.push(c.i,e.i,l.i),up(e),e=l.next,s=l.next;else if(e=l,e===s){o?o===1?(e=Bf(If(e),t),Lf(e,t,n,r,i,a,2)):o===2&&Vf(e,t,n,r,i,a):Lf(If(e),t,n,r,i,a,1);break}}}function Rf(e){let t=e.prev,n=e,r=e.next;if(ep(t,n,r)>=0)return!1;let i=t.x,a=n.x,o=r.x,s=t.y,c=n.y,l=r.y,u=Math.min(i,a,o),d=Math.min(s,c,l),f=Math.max(i,a,o),p=Math.max(s,c,l),m=r.next;for(;m!==t;){if(m.x>=u&&m.x<=f&&m.y>=d&&m.y<=p&&Qf(i,s,a,c,o,l,m.x,m.y)&&ep(m.prev,m,m.next)>=0)return!1;m=m.next}return!0}function zf(e,t,n,r){let i=e.prev,a=e,o=e.next;if(ep(i,a,o)>=0)return!1;let s=i.x,c=a.x,l=o.x,u=i.y,d=a.y,f=o.y,p=Math.min(s,c,l),m=Math.min(u,d,f),h=Math.max(s,c,l),g=Math.max(u,d,f),_=Yf(p,m,t,n,r),v=Yf(h,g,t,n,r),y=e.prevZ,b=e.nextZ;for(;y&&y.z>=_&&b&&b.z<=v;){if(y.x>=p&&y.x<=h&&y.y>=m&&y.y<=g&&y!==i&&y!==o&&Qf(s,u,c,d,l,f,y.x,y.y)&&ep(y.prev,y,y.next)>=0||(y=y.prevZ,b.x>=p&&b.x<=h&&b.y>=m&&b.y<=g&&b!==i&&b!==o&&Qf(s,u,c,d,l,f,b.x,b.y)&&ep(b.prev,b,b.next)>=0))return!1;b=b.nextZ}for(;y&&y.z>=_;){if(y.x>=p&&y.x<=h&&y.y>=m&&y.y<=g&&y!==i&&y!==o&&Qf(s,u,c,d,l,f,y.x,y.y)&&ep(y.prev,y,y.next)>=0)return!1;y=y.prevZ}for(;b&&b.z<=v;){if(b.x>=p&&b.x<=h&&b.y>=m&&b.y<=g&&b!==i&&b!==o&&Qf(s,u,c,d,l,f,b.x,b.y)&&ep(b.prev,b,b.next)>=0)return!1;b=b.nextZ}return!0}function Bf(e,t){let n=e;do{let r=n.prev,i=n.next.next;!tp(r,i)&&np(r,n,n.next,i)&&op(r,i)&&op(i,r)&&(t.push(r.i,n.i,i.i),up(n),up(n.next),n=e=i),n=n.next}while(n!==e);return If(n)}function Vf(e,t,n,r,i,a){let o=e;do{let e=o.next.next;for(;e!==o.prev;){if(o.i!==e.i&&$f(o,e)){let s=cp(o,e);o=If(o,o.next),s=If(s,s.next),Lf(o,t,n,r,i,a,0),Lf(s,t,n,r,i,a,0);return}e=e.next}o=o.next}while(o!==e)}function Hf(e,t,n,r){let i=[];for(let n=0,a=t.length;n<a;n++){let o=Ff(e,t[n]*r,n<a-1?t[n+1]*r:e.length,r,!1);o===o.next&&(o.steiner=!0),i.push(Xf(o))}i.sort(Uf);for(let e=0;e<i.length;e++)n=Wf(i[e],n);return n}function Uf(e,t){let n=e.x-t.x;return n===0&&(n=e.y-t.y,n===0&&(n=(e.next.y-e.y)/(e.next.x-e.x)-(t.next.y-t.y)/(t.next.x-t.x))),n}function Wf(e,t){let n=Gf(e,t);if(!n)return t;let r=cp(n,e);return If(r,r.next),If(n,n.next)}function Gf(e,t){let n=t,r=e.x,i=e.y,a=-1/0,o;if(tp(e,n))return n;do{if(tp(e,n.next))return n.next;if(i<=n.y&&i>=n.next.y&&n.next.y!==n.y){let e=n.x+(i-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(e<=r&&e>a&&(a=e,o=n.x<n.next.x?n:n.next,e===r))return o}n=n.next}while(n!==t);if(!o)return null;let s=o,c=o.x,l=o.y,u=1/0;n=o;do{if(r>=n.x&&n.x>=c&&r!==n.x&&Zf(i<l?r:a,i,c,l,i<l?a:r,i,n.x,n.y)){let t=Math.abs(i-n.y)/(r-n.x);op(n,e)&&(t<u||t===u&&(n.x>o.x||n.x===o.x&&Kf(o,n)))&&(o=n,u=t)}n=n.next}while(n!==s);return o}function Kf(e,t){return ep(e.prev,e,t.prev)<0&&ep(t.next,e,e.next)<0}function qf(e,t,n,r){let i=e;do i.z===0&&(i.z=Yf(i.x,i.y,t,n,r)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;while(i!==e);i.prevZ.nextZ=null,i.prevZ=null,Jf(i)}function Jf(e){let t,n=1;do{let r=e,i;e=null;let a=null;for(t=0;r;){t++;let o=r,s=0;for(let e=0;e<n&&(s++,o=o.nextZ,o);e++);let c=n;for(;s>0||c>0&&o;)s!==0&&(c===0||!o||r.z<=o.z)?(i=r,r=r.nextZ,s--):(i=o,o=o.nextZ,c--),a?a.nextZ=i:e=i,i.prevZ=a,a=i;r=o}a.nextZ=null,n*=2}while(t>1);return e}function Yf(e,t,n,r,i){return e=(e-n)*i|0,t=(t-r)*i|0,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e|t<<1}function Xf(e){let t=e,n=e;do(t.x<n.x||t.x===n.x&&t.y<n.y)&&(n=t),t=t.next;while(t!==e);return n}function Zf(e,t,n,r,i,a,o,s){return(i-o)*(t-s)>=(e-o)*(a-s)&&(e-o)*(r-s)>=(n-o)*(t-s)&&(n-o)*(a-s)>=(i-o)*(r-s)}function Qf(e,t,n,r,i,a,o,s){return(e!==o||t!==s)&&Zf(e,t,n,r,i,a,o,s)}function $f(e,t){return e.next.i!==t.i&&e.prev.i!==t.i&&!ap(e,t)&&(op(e,t)&&op(t,e)&&sp(e,t)&&(ep(e.prev,e,t.prev)||ep(e,t.prev,t))||tp(e,t)&&ep(e.prev,e,e.next)>0&&ep(t.prev,t,t.next)>0)}function ep(e,t,n){return(t.y-e.y)*(n.x-t.x)-(t.x-e.x)*(n.y-t.y)}function tp(e,t){return e.x===t.x&&e.y===t.y}function np(e,t,n,r){let i=ip(ep(e,t,n)),a=ip(ep(e,t,r)),o=ip(ep(n,r,e)),s=ip(ep(n,r,t));return!!(i!==a&&o!==s||i===0&&rp(e,n,t)||a===0&&rp(e,r,t)||o===0&&rp(n,e,r)||s===0&&rp(n,t,r))}function rp(e,t,n){return t.x<=Math.max(e.x,n.x)&&t.x>=Math.min(e.x,n.x)&&t.y<=Math.max(e.y,n.y)&&t.y>=Math.min(e.y,n.y)}function ip(e){return e>0?1:e<0?-1:0}function ap(e,t){let n=e;do{if(n.i!==e.i&&n.next.i!==e.i&&n.i!==t.i&&n.next.i!==t.i&&np(n,n.next,e,t))return!0;n=n.next}while(n!==e);return!1}function op(e,t){return ep(e.prev,e,e.next)<0?ep(e,t,e.next)>=0&&ep(e,e.prev,t)>=0:ep(e,t,e.prev)<0||ep(e,e.next,t)<0}function sp(e,t){let n=e,r=!1,i=(e.x+t.x)/2,a=(e.y+t.y)/2;do n.y>a!=n.next.y>a&&n.next.y!==n.y&&i<(n.next.x-n.x)*(a-n.y)/(n.next.y-n.y)+n.x&&(r=!r),n=n.next;while(n!==e);return r}function cp(e,t){let n=dp(e.i,e.x,e.y),r=dp(t.i,t.x,t.y),i=e.next,a=t.prev;return e.next=t,t.prev=e,n.next=i,i.prev=n,r.next=n,n.prev=r,a.next=r,r.prev=a,r}function lp(e,t,n,r){let i=dp(e,t,n);return r?(i.next=r.next,i.prev=r,r.next.prev=i,r.next=i):(i.prev=i,i.next=i),i}function up(e){e.next.prev=e.prev,e.prev.next=e.next,e.prevZ&&(e.prevZ.nextZ=e.nextZ),e.nextZ&&(e.nextZ.prevZ=e.prevZ)}function dp(e,t,n){return{i:e,x:t,y:n,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function fp(e,t,n,r){let i=0;for(let a=t,o=n-r;a<n;a+=r)i+=(e[o]-e[a])*(e[a+1]+e[o+1]),o=a;return i}var pp=class{static triangulate(e,t,n=2){return Pf(e,t,n)}},mp=class e{static area(e){let t=e.length,n=0;for(let r=t-1,i=0;i<t;r=i++)n+=e[r].x*e[i].y-e[i].x*e[r].y;return n*.5}static isClockWise(t){return e.area(t)<0}static triangulateShape(e,t){let n=[],r=[],i=[];hp(e),gp(n,e);let a=e.length;t.forEach(hp);for(let e=0;e<t.length;e++)r.push(a),a+=t[e].length,gp(n,t[e]);let o=pp.triangulate(n,r);for(let e=0;e<o.length;e+=3)i.push(o.slice(e,e+3));return i}};function hp(e){let t=e.length;t>2&&e[t-1].equals(e[0])&&e.pop()}function gp(e,t){for(let n=0;n<t.length;n++)e.push(t[n].x),e.push(t[n].y)}var _p=class e extends od{constructor(e=new Nf([new U(.5,.5),new U(-.5,.5),new U(-.5,-.5),new U(.5,-.5)]),t={}){super(),this.type=`ExtrudeGeometry`,this.parameters={shapes:e,options:t},e=Array.isArray(e)?e:[e];let n=this,r=[],i=[];for(let t=0,n=e.length;t<n;t++){let n=e[t];a(n)}this.setAttribute(`position`,new Ju(r,3)),this.setAttribute(`uv`,new Ju(i,2)),this.computeVertexNormals();function a(e){let a=[],o=t.curveSegments===void 0?12:t.curveSegments,s=t.steps===void 0?1:t.steps,c=t.depth===void 0?1:t.depth,l=t.bevelEnabled===void 0||t.bevelEnabled,u=t.bevelThickness===void 0?.2:t.bevelThickness,d=t.bevelSize===void 0?u-.1:t.bevelSize,f=t.bevelOffset===void 0?0:t.bevelOffset,p=t.bevelSegments===void 0?3:t.bevelSegments,m=t.extrudePath,h=t.UVGenerator===void 0?vp:t.UVGenerator,g,_=!1,v,y,b,x;if(m){g=m.getSpacedPoints(s),_=!0,l=!1;let e=m.isCatmullRomCurve3?m.closed:!1;v=m.computeFrenetFrames(s,e),y=new W,b=new W,x=new W}l||(p=0,u=0,d=0,f=0);let S=e.extractPoints(o),C=S.shape,w=S.holes;if(!mp.isClockWise(C)){C=C.reverse();for(let e=0,t=w.length;e<t;e++){let t=w[e];mp.isClockWise(t)&&(w[e]=t.reverse())}}function T(e){let t=e[0];for(let n=1;n<=e.length;n++){let r=n%e.length,i=e[r],a=i.x-t.x,o=i.y-t.y,s=a*a+o*o,c=Math.max(Math.abs(i.x),Math.abs(i.y),Math.abs(t.x),Math.abs(t.y));s<=10000000000000001e-36*c*c?(e.splice(r,1),n--):t=i}}T(C),w.forEach(T);let E=w.length,D=C;for(let e=0;e<E;e++){let t=w[e];C=C.concat(t)}function O(e,t,n){return t||V(`ExtrudeGeometry: vec does not exist`),e.clone().addScaledVector(t,n)}let k=C.length;function A(e,t,n){let r,i,a,o=e.x-t.x,s=e.y-t.y,c=n.x-e.x,l=n.y-e.y,u=o*o+s*s,d=o*l-s*c;if(Math.abs(d)>2**-52){let d=Math.sqrt(u),f=Math.sqrt(c*c+l*l),p=t.x-s/d,m=t.y+o/d,h=n.x-l/f,g=n.y+c/f,_=((h-p)*l-(g-m)*c)/(o*l-s*c);r=p+o*_-e.x,i=m+s*_-e.y;let v=r*r+i*i;if(v<=2)return new U(r,i);a=Math.sqrt(v/2)}else{let e=!1;o>2**-52?c>2**-52&&(e=!0):o<-(2**-52)?c<-(2**-52)&&(e=!0):Math.sign(s)===Math.sign(l)&&(e=!0),e?(r=-s,i=o,a=Math.sqrt(u)):(r=o,i=s,a=Math.sqrt(u/2))}return new U(r/a,i/a)}let j=[];for(let e=0,t=D.length,n=t-1,r=e+1;e<t;e++,n++,r++)n===t&&(n=0),r===t&&(r=0),j[e]=A(D[e],D[n],D[r]);let M=[],N,ee=j.concat();for(let e=0,t=E;e<t;e++){let t=w[e];N=[];for(let e=0,n=t.length,r=n-1,i=e+1;e<n;e++,r++,i++)r===n&&(r=0),i===n&&(i=0),N[e]=A(t[e],t[r],t[i]);M.push(N),ee=ee.concat(N)}let te;if(p===0)te=mp.triangulateShape(D,w);else{let e=[],t=[];for(let n=0;n<p;n++){let r=n/p,i=u*Math.cos(r*Math.PI/2),a=d*Math.sin(r*Math.PI/2)+f;for(let t=0,n=D.length;t<n;t++){let n=O(D[t],j[t],a);P(n.x,n.y,-i),r===0&&e.push(n)}for(let e=0,n=E;e<n;e++){let n=w[e];N=M[e];let o=[];for(let e=0,t=n.length;e<t;e++){let t=O(n[e],N[e],a);P(t.x,t.y,-i),r===0&&o.push(t)}r===0&&t.push(o)}}te=mp.triangulateShape(e,t)}let ne=te.length,re=d+f;for(let e=0;e<k;e++){let t=l?O(C[e],ee[e],re):C[e];_?(b.copy(v.normals[0]).multiplyScalar(t.x),y.copy(v.binormals[0]).multiplyScalar(t.y),x.copy(g[0]).add(b).add(y),P(x.x,x.y,x.z)):P(t.x,t.y,0)}for(let e=1;e<=s;e++)for(let t=0;t<k;t++){let n=l?O(C[t],ee[t],re):C[t];_?(b.copy(v.normals[e]).multiplyScalar(n.x),y.copy(v.binormals[e]).multiplyScalar(n.y),x.copy(g[e]).add(b).add(y),P(x.x,x.y,x.z)):P(n.x,n.y,c/s*e)}for(let e=p-1;e>=0;e--){let t=e/p,n=u*Math.cos(t*Math.PI/2),r=d*Math.sin(t*Math.PI/2)+f;for(let e=0,t=D.length;e<t;e++){let t=O(D[e],j[e],r);P(t.x,t.y,c+n)}for(let e=0,t=w.length;e<t;e++){let t=w[e];N=M[e];for(let e=0,i=t.length;e<i;e++){let i=O(t[e],N[e],r);_?P(i.x,i.y+g[s-1].y,g[s-1].x+n):P(i.x,i.y,c+n)}}}ie(),ae();function ie(){let e=r.length/3;if(l){let e=0,t=k*e;for(let e=0;e<ne;e++){let n=te[e];se(n[2]+t,n[1]+t,n[0]+t)}e=s+p*2,t=k*e;for(let e=0;e<ne;e++){let n=te[e];se(n[0]+t,n[1]+t,n[2]+t)}}else{for(let e=0;e<ne;e++){let t=te[e];se(t[2],t[1],t[0])}for(let e=0;e<ne;e++){let t=te[e];se(t[0]+k*s,t[1]+k*s,t[2]+k*s)}}n.addGroup(e,r.length/3-e,0)}function ae(){let e=r.length/3,t=0;oe(D,t),t+=D.length;for(let e=0,n=w.length;e<n;e++){let n=w[e];oe(n,t),t+=n.length}n.addGroup(e,r.length/3-e,1)}function oe(e,t){let n=e.length;for(;--n>=0;){let r=n,i=n-1;i<0&&(i=e.length-1);for(let e=0,n=s+p*2;e<n;e++){let n=k*e,a=k*(e+1);ce(t+r+n,t+i+n,t+i+a,t+r+a)}}}function P(e,t,n){a.push(e),a.push(t),a.push(n)}function se(e,t,i){le(e),le(t),le(i);let a=r.length/3,o=h.generateTopUV(n,r,a-3,a-2,a-1);ue(o[0]),ue(o[1]),ue(o[2])}function ce(e,t,i,a){le(e),le(t),le(a),le(t),le(i),le(a);let o=r.length/3,s=h.generateSideWallUV(n,r,o-6,o-3,o-2,o-1);ue(s[0]),ue(s[1]),ue(s[3]),ue(s[1]),ue(s[2]),ue(s[3])}function le(e){r.push(a[e*3+0]),r.push(a[e*3+1]),r.push(a[e*3+2])}function ue(e){i.push(e.x),i.push(e.y)}}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON(),t=this.parameters.shapes,n=this.parameters.options;return yp(t,n,e)}static fromJSON(t,n){let r=[];for(let e=0,i=t.shapes.length;e<i;e++){let i=n[t.shapes[e]];r.push(i)}let i=t.options.extrudePath;return i!==void 0&&(t.options.extrudePath=new Af[i.type]().fromJSON(i)),new e(r,t.options)}},vp={generateTopUV:function(e,t,n,r,i){let a=t[n*3],o=t[n*3+1],s=t[r*3],c=t[r*3+1],l=t[i*3],u=t[i*3+1];return[new U(a,o),new U(s,c),new U(l,u)]},generateSideWallUV:function(e,t,n,r,i,a){let o=t[n*3],s=t[n*3+1],c=t[n*3+2],l=t[r*3],u=t[r*3+1],d=t[r*3+2],f=t[i*3],p=t[i*3+1],m=t[i*3+2],h=t[a*3],g=t[a*3+1],_=t[a*3+2];return Math.abs(s-u)<Math.abs(o-l)?[new U(o,1-c),new U(l,1-d),new U(f,1-m),new U(h,1-_)]:[new U(s,1-c),new U(u,1-d),new U(p,1-m),new U(g,1-_)]}};function yp(e,t,n){if(n.shapes=[],Array.isArray(e))for(let t=0,r=e.length;t<r;t++){let r=e[t];n.shapes.push(r.uuid)}else n.shapes.push(e.uuid);return n.options=Object.assign({},t),t.extrudePath!==void 0&&(n.options.extrudePath=t.extrudePath.toJSON()),n}var bp=class e extends od{constructor(e=1,t=1,n=1,r=1){super(),this.type=`PlaneGeometry`,this.parameters={width:e,height:t,widthSegments:n,heightSegments:r};let i=e/2,a=t/2,o=Math.floor(n),s=Math.floor(r),c=o+1,l=s+1,u=e/o,d=t/s,f=[],p=[],m=[],h=[];for(let e=0;e<l;e++){let t=e*d-a;for(let n=0;n<c;n++){let r=n*u-i;p.push(r,-t,0),m.push(0,0,1),h.push(n/o),h.push(1-e/s)}}for(let e=0;e<s;e++)for(let t=0;t<o;t++){let n=t+c*e,r=t+c*(e+1),i=t+1+c*(e+1),a=t+1+c*e;f.push(n,r,a),f.push(r,i,a)}this.setIndex(f),this.setAttribute(`position`,new Ju(p,3)),this.setAttribute(`normal`,new Ju(m,3)),this.setAttribute(`uv`,new Ju(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.widthSegments,t.heightSegments)}},xp=class e extends od{constructor(e=1,t=32,n=16,r=0,i=Math.PI*2,a=0,o=Math.PI){super(),this.type=`SphereGeometry`,this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:r,phiLength:i,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let s=Math.min(a+o,Math.PI),c=0,l=[],u=new W,d=new W,f=[],p=[],m=[],h=[];for(let f=0;f<=n;f++){let g=[],_=f/n,v=a+_*o,y=e*Math.cos(v),b=Math.sqrt(e*e-y*y),x=0;f===0&&a===0?x=.5/t:f===n&&s===Math.PI&&(x=-.5/t);for(let e=0;e<=t;e++){let n=e/t,a=r+n*i;u.x=-b*Math.cos(a),u.y=y,u.z=b*Math.sin(a),p.push(u.x,u.y,u.z),d.copy(u).normalize(),m.push(d.x,d.y,d.z),h.push(n+x,1-_),g.push(c++)}l.push(g)}for(let e=0;e<n;e++)for(let r=0;r<t;r++){let t=l[e][r+1],i=l[e][r],o=l[e+1][r],c=l[e+1][r+1];(e!==0||a>0)&&f.push(t,i,c),(e!==n-1||s<Math.PI)&&f.push(i,o,c)}this.setIndex(f),this.setAttribute(`position`,new Ju(p,3)),this.setAttribute(`normal`,new Ju(m,3)),this.setAttribute(`uv`,new Ju(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}},Sp=class extends fd{constructor(e){super(),this.isShadowMaterial=!0,this.type=`ShadowMaterial`,this.color=new K(0),this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.fog=e.fog,this}};function Cp(e){let t={};for(let n in e){t[n]={};for(let r in e[n]){let i=e[n][r];if(Tp(i))i.isRenderTargetTexture?(B(`UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms().`),t[n][r]=null):t[n][r]=i.clone();else if(Array.isArray(i)){if(Tp(i[0])){let e=[];for(let t=0,n=i.length;t<n;t++)e[t]=i[t].clone();t[n][r]=e}else t[n][r]=i.slice()}else t[n][r]=i}}return t}function wp(e){let t={};for(let n=0;n<e.length;n++){let r=Cp(e[n]);for(let e in r)t[e]=r[e]}return t}function Tp(e){return e&&(e.isColor||e.isMatrix3||e.isMatrix4||e.isVector2||e.isVector3||e.isVector4||e.isTexture||e.isQuaternion)}function Ep(e){let t=[];for(let n=0;n<e.length;n++)t.push(e[n].clone());return t}function Dp(e){let t=e.getRenderTarget();return t===null?e.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:ml.workingColorSpace}var Op={clone:Cp,merge:wp},kp=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Ap=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,jp=class extends fd{constructor(e){super(),this.isShaderMaterial=!0,this.type=`ShaderMaterial`,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=kp,this.fragmentShader=Ap,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Cp(e.uniforms),this.uniformsGroups=Ep(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let n in this.uniforms){let r=this.uniforms[n].value;r&&r.isTexture?t.uniforms[n]={type:`t`,value:r.toJSON(e).uuid}:r&&r.isColor?t.uniforms[n]={type:`c`,value:r.getHex()}:r&&r.isVector2?t.uniforms[n]={type:`v2`,value:r.toArray()}:r&&r.isVector3?t.uniforms[n]={type:`v3`,value:r.toArray()}:r&&r.isVector4?t.uniforms[n]={type:`v4`,value:r.toArray()}:r&&r.isMatrix3?t.uniforms[n]={type:`m3`,value:r.toArray()}:r&&r.isMatrix4?t.uniforms[n]={type:`m4`,value:r.toArray()}:t.uniforms[n]={value:r}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let e in this.extensions)this.extensions[e]===!0&&(n[e]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let r=e.uniforms[n];switch(this.uniforms[n]={},r.type){case`t`:this.uniforms[n].value=t[r.value]||null;break;case`c`:this.uniforms[n].value=new K().setHex(r.value);break;case`v2`:this.uniforms[n].value=new U().fromArray(r.value);break;case`v3`:this.uniforms[n].value=new W().fromArray(r.value);break;case`v4`:this.uniforms[n].value=new Tl().fromArray(r.value);break;case`m3`:this.uniforms[n].value=new G().fromArray(r.value);break;case`m4`:this.uniforms[n].value=new Al().fromArray(r.value);break;default:this.uniforms[n].value=r.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let t in e.extensions)this.extensions[t]=e.extensions[t];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},Mp=class extends jp{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type=`RawShaderMaterial`}},Np=class extends fd{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type=`MeshStandardMaterial`,this.defines={STANDARD:``},this.color=new K(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new K(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new U(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Bl,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:``},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Pp=class extends Np{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:``,PHYSICAL:``},this.type=`MeshPhysicalMaterial`,this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new U(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return H(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new K(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new K(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new K(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(e){this._retroreflectivity>0!=e>0&&this.version++,this._retroreflectivity=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:``,PHYSICAL:``},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.retroreflectivity=e.retroreflectivity,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},Fp=class extends fd{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type=`MeshLambertMaterial`,this.color=new K(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new K(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new U(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Bl,this.combine=0,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Ip=class extends fd{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type=`MeshDepthMaterial`,this.depthPacking=gc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Lp=class extends fd{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type=`MeshDistanceMaterial`,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Rp(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT==`number`?new t(e):Array.prototype.slice.call(e)}function zp(e){return e!==void 0&&e.inTangents!==void 0&&e.outTangents!==void 0}var Bp=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r===void 0?new t.constructor(n):r,this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],i=t[n-1];validate_interval:{seek:{let a;linear_scan:{forward_scan:if(!(e<r)){for(let a=n+2;;){if(r===void 0){if(e<i)break forward_scan;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(i=r,r=t[++n],e<r)break seek}a=t.length;break linear_scan}if(!(e>=i)){let o=t[1];e<o&&(n=2,i=o);for(let a=n-2;;){if(i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(r=i,i=t[--n-1],e>=i)break seek}a=n,n=0;break linear_scan}break validate_interval}for(;n<a;){let r=n+a>>>1;e<t[r]?a=r:n=r+1}if(r=t[n],i=t[n-1],i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,i,r)}return this.interpolate_(n,i,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r;for(let e=0;e!==r;++e)t[e]=n[i+e];return t}interpolate_(){throw Error(`THREE.Interpolant: Call to abstract method.`)}intervalChanged_(){}},Vp=class extends Bp{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:pc,endingEnd:pc}}intervalChanged_(e,t,n){let r=this.parameterPositions,i=e-2,a=e+1,o=r[i],s=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case mc:i=e,o=2*t-n;break;case hc:i=r.length-2,o=t+r[i]-r[i+1];break;default:i=e,o=n}if(s===void 0)switch(this.getSettings_().endingEnd){case mc:a=e,s=2*n-t;break;case hc:a=1,s=n+r[1]-r[0];break;default:a=e-1,s=t}let c=(n-t)*.5,l=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(s-n),this._offsetPrev=i*l,this._offsetNext=a*l}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,p=(n-t)/(r-t),m=p*p,h=m*p,g=-d*h+2*d*m-d*p,_=(1+d)*h+(-1.5-2*d)*m+(-.5+d)*p+1,v=(-1-f)*h+(1.5+f)*m+.5*p,y=f*h-f*m;for(let e=0;e!==o;++e)i[e]=g*a[l+e]+_*a[c+e]+v*a[s+e]+y*a[u+e];return i}},Hp=class extends Bp{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=(n-t)/(r-t),u=1-l;for(let e=0;e!==o;++e)i[e]=a[c+e]*u+a[s+e]*l;return i}},Up=class extends Bp{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},Wp=class extends Bp{interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this.inTangents,u=this.outTangents;if(!l||!u){let e=(n-t)/(r-t),l=1-e;for(let t=0;t!==o;++t)i[t]=a[c+t]*l+a[s+t]*e;return i}let d=o*2,f=e-1;for(let p=0;p!==o;++p){let o=a[c+p],m=a[s+p],h=f*d+p*2,g=u[h],_=u[h+1],v=e*d+p*2,y=l[v],b=l[v+1],x=qp(n,t,g,y,r);i[p]=Gp(x,o,_,b,m)}return i}};function Gp(e,t,n,r,i){let a=1-e;return a*a*a*t+3*a*a*e*n+3*a*e*e*r+e*e*e*i}function Kp(e,t,n,r,i){let a=1-e;return 3*a*a*(n-t)+6*a*e*(r-n)+3*e*e*(i-r)}function qp(e,t,n,r,i){let a=(e-t)/(i-t);for(let o=0;o<8;o++){let o=Gp(a,t,n,r,i)-e;if(Math.abs(o)<1e-10)break;let s=Kp(a,t,n,r,i);if(Math.abs(s)<1e-10)break;a=Math.max(0,Math.min(1,a-o/s))}return a}var Jp=class{constructor(e,t,n,r){if(e===void 0)throw Error(`THREE.KeyframeTrack: track name is undefined`);if(t===void 0||t.length===0)throw Error(`THREE.KeyframeTrack: no keyframes in track named `+e);this.name=e,this.times=Rp(t,this.TimeBufferType),this.values=Rp(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Rp(e.times,Array),values:Rp(e.values,Array)};let t=e.getInterpolation();t!==e.DefaultInterpolation&&(n.interpolation=t),zp(e.settings)&&(n.settings={inTangents:Rp(e.settings.inTangents,Array),outTangents:Rp(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Up(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Hp(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Vp(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new Wp(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case lc:t=this.InterpolantFactoryMethodDiscrete;break;case uc:t=this.InterpolantFactoryMethodLinear;break;case dc:t=this.InterpolantFactoryMethodSmooth;break;case fc:t=this.InterpolantFactoryMethodBezier}if(t===void 0){let t=`unsupported interpolation for `+this.ValueTypeName+` keyframe track named `+this.name;if(this.createInterpolant===void 0){if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error(t)}return B(`KeyframeTrack:`,t),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return lc;case this.InterpolantFactoryMethodLinear:return uc;case this.InterpolantFactoryMethodSmooth:return dc;case this.InterpolantFactoryMethodBezier:return fc}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e;zp(this.settings)&&(Yp(this.settings.inTangents,e),Yp(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,r=n.length,i=0,a=r-1;for(;i!==r&&n[i]<e;)++i;for(;a!==-1&&n[a]>t;)--a;if(++a,i!==0||a!==r){i>=a&&(a=Math.max(a,1),i=a-1);let e=this.getValueSize();this.times=n.slice(i,a),this.values=this.values.slice(i*e,a*e)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(V(`KeyframeTrack: Invalid value size in track.`,this),e=!1);let n=this.times,r=this.values,i=n.length;i===0&&(V(`KeyframeTrack: Track is empty.`,this),e=!1);let a=null;for(let t=0;t!==i;t++){let r=n[t];if(typeof r==`number`&&isNaN(r)){V(`KeyframeTrack: Time is not a valid number.`,this,t,r),e=!1;break}if(a!==null&&a>r){V(`KeyframeTrack: Out of order keys.`,this,t,r,a),e=!1;break}a=r}if(r!==void 0&&Tc(r))for(let t=0,n=r.length;t!==n;++t){let n=r[t];if(isNaN(n)){V(`KeyframeTrack: Value is not a valid number.`,this,t,n),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===dc,i=e.length-1,a=1;for(let o=1;o<i;++o){let i=!1,s=e[o];if(s!==e[o+1]&&(o!==1||s!==e[0])){if(r)i=!0;else{let e=o*n,r=e-n,a=e+n;for(let o=0;o!==n;++o){let n=t[e+o];if(n!==t[r+o]||n!==t[a+o]){i=!0;break}}}}if(i){if(o!==a){e[a]=e[o];let r=o*n,i=a*n;for(let e=0;e!==n;++e)t[i+e]=t[r+e]}++a}}if(i>0){e[a]=e[i];for(let e=i*n,r=a*n,o=0;o!==n;++o)t[r+o]=t[e+o];++a}return a===e.length?(this.times=e,this.values=t):(this.times=e.slice(0,a),this.values=t.slice(0,a*n)),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,zp(this.settings)&&(r.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),r}};function Yp(e,t){for(let n=0,r=e.length;n!==r;n+=2)e[n]*=t}Jp.prototype.ValueTypeName=``,Jp.prototype.TimeBufferType=Float32Array,Jp.prototype.ValueBufferType=Float32Array,Jp.prototype.DefaultInterpolation=uc;var Xp=class extends Jp{constructor(e,t,n){super(e,t,n)}};Xp.prototype.ValueTypeName=`bool`,Xp.prototype.ValueBufferType=Array,Xp.prototype.DefaultInterpolation=lc,Xp.prototype.InterpolantFactoryMethodLinear=void 0,Xp.prototype.InterpolantFactoryMethodSmooth=void 0;var Zp=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};Zp.prototype.ValueTypeName=`color`;var Qp=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};Qp.prototype.ValueTypeName=`number`;var $p=class extends Bp{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=(n-t)/(r-t),c=e*o;for(let e=c+o;c!==e;c+=4)sl.slerpFlat(i,0,a,c-o,a,c,s);return i}},em=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}InterpolantFactoryMethodLinear(e){return new $p(this.times,this.values,this.getValueSize(),e)}};em.prototype.ValueTypeName=`quaternion`,em.prototype.InterpolantFactoryMethodSmooth=void 0;var tm=class extends Jp{constructor(e,t,n){super(e,t,n)}};tm.prototype.ValueTypeName=`string`,tm.prototype.ValueBufferType=Array,tm.prototype.DefaultInterpolation=lc,tm.prototype.InterpolantFactoryMethodLinear=void 0,tm.prototype.InterpolantFactoryMethodSmooth=void 0;var nm=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};nm.prototype.ValueTypeName=`vector`;var rm=class extends ru{constructor(e,t=1){super(),this.isLight=!0,this.type=`Light`,this.color=new K(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},im=class extends rm{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type=`HemisphereLight`,this.position.copy(ru.DEFAULT_UP),this.updateMatrix(),this.groundColor=new K(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},am=new Al,om=new W,sm=new W,cm=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new U(512,512),this.mapType=is,this.map=null,this.mapPass=null,this.matrix=new Al,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Kd,this._frameExtents=new U(1,1),this._viewportCount=1,this._viewports=[new Tl(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;om.setFromMatrixPosition(e.matrixWorld),t.position.copy(om),sm.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(sm),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,r){am.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(am,e.coordinateSystem,e.reversedDepth);let i=this._frameExtents,a=r?r.z/i.x:1,o=r?r.w/i.y:1,s=r?r.x/i.x:0,c=r?r.y/i.y:0;e.coordinateSystem===2001||e.reversedDepth?t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(am)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},lm=new W,um=new sl,dm=new W,fm=class extends ru{constructor(){super(),this.isCamera=!0,this.type=`Camera`,this.matrixWorldInverse=new Al,this.projectionMatrix=new Al,this.projectionMatrixInverse=new Al,this.coordinateSystem=Cc,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(lm,um,dm),dm.x===1&&dm.y===1&&dm.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lm,um,dm.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(lm,um,dm),dm.x===1&&dm.y===1&&dm.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lm,um,dm.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},pm=new W,mm=new U,hm=new U,gm=class extends fm{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type=`PerspectiveCamera`,this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Rc*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(Lc*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Rc*2*Math.atan(Math.tan(Lc*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){pm.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(pm.x,pm.y).multiplyScalar(-e/pm.z),pm.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(pm.x,pm.y).multiplyScalar(-e/pm.z)}getViewSize(e,t){return this.getViewBounds(e,mm,hm),t.subVectors(hm,mm)}setViewOffset(e,t,n,r,i,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(Lc*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,i=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let e=a.fullWidth,o=a.fullHeight;i+=a.offsetX*r/e,t-=a.offsetY*n/o,r*=a.width/e,n*=a.height/o}let o=this.filmOffset;o!==0&&(i+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(i,i+r,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},_m=class extends cm{constructor(){super(new gm(90,1,.5,500)),this.isPointLightShadow=!0}},vm=class extends rm{constructor(e,t,n=0,r=2){super(e,t),this.isPointLight=!0,this.type=`PointLight`,this.distance=n,this.decay=r,this.shadow=new _m}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},ym=class extends fm{constructor(e=-1,t=1,n=1,r=-1,i=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type=`OrthographicCamera`,this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=r,this.near=i,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,r,i,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,i=n-e,a=n+e,o=r+t,s=r-t;if(this.view!==null&&this.view.enabled){let e=(this.right-this.left)/this.view.fullWidth/this.zoom,t=(this.top-this.bottom)/this.view.fullHeight/this.zoom;i+=e*this.view.offsetX,a=i+e*this.view.width,o-=t*this.view.offsetY,s=o-t*this.view.height}this.projectionMatrix.makeOrthographic(i,a,o,s,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},bm=class extends cm{constructor(){super(new ym(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},xm=class extends rm{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type=`DirectionalLight`,this.position.copy(ru.DEFAULT_UP),this.updateMatrix(),this.target=new ru,this.shadow=new bm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},Sm=-90,Cm=1,wm=class extends ru{constructor(e,t,n){super(),this.type=`CubeCamera`,this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new gm(Sm,Cm,e,t);r.layers=this.layers,this.add(r);let i=new gm(Sm,Cm,e,t);i.layers=this.layers,this.add(i);let a=new gm(Sm,Cm,e,t);a.layers=this.layers,this.add(a);let o=new gm(Sm,Cm,e,t);o.layers=this.layers,this.add(o);let s=new gm(Sm,Cm,e,t);s.layers=this.layers,this.add(s);let c=new gm(Sm,Cm,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,r,i,a,o,s]=t;for(let e of t)this.remove(e);if(e===2e3)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),i.up.set(0,0,-1),i.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),s.up.set(0,1,0),s.lookAt(0,0,-1);else if(e===2001)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),i.up.set(0,0,1),i.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),s.up.set(0,-1,0),s.lookAt(0,0,-1);else throw Error(`THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: `+e);for(let e of t)this.add(e),e.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[i,a,o,s,c,l]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.xr.enabled;e.xr.enabled=!1;let m=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let h=!1;h=e.isWebGLRenderer===!0?e.state.buffers.depth.getReversed():e.reversedDepthBuffer,e.setRenderTarget(n,0,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,i),e.setRenderTarget(n,1,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,s),e.setRenderTarget(n,4,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.generateMipmaps=m,e.setRenderTarget(n,5,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(u,d,f),e.xr.enabled=p,n.texture.needsPMREMUpdate=!0}},Tm=class extends gm{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},Em=`\\[\\]\\.:\\/`,Dm=RegExp(`[\\[\\]\\.:\\/]`,`g`),Om=`[^\\[\\]\\.:\\/]`,km=`[^`+Em.replace(`\\.`,``)+`]`,Am=`((?:WC+[\\/:])*)`.replace(`WC`,Om),jm=`(WCOD+)?`.replace(`WCOD`,km),Mm=`(?:\\.(WC+)(?:\\[(.+)\\])?)?`.replace(`WC`,Om),Nm=`\\.(WC+)(?:\\[(.+)\\])?`.replace(`WC`,Om),Pm=RegExp(`^`+Am+jm+Mm+Nm+`$`),Fm=[`material`,`materials`,`bones`,`map`],Im=class{constructor(e,t,n){let r=n||Lm.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,i=n.length;r!==i;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},Lm=class e{constructor(t,n,r){this.path=n,this.parsedPath=r||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,r){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,r):new e(t,n,r)}static sanitizeNodeName(e){return e.replace(/\s/g,`_`).replace(Dm,``)}static parseTrackName(e){let t=Pm.exec(e);if(t===null)throw Error(`THREE.PropertyBinding: Cannot parse trackName: `+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(`.`);if(r!==void 0&&r!==-1){let e=n.nodeName.substring(r+1);Fm.indexOf(e)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=e)}if(n.propertyName===null||n.propertyName.length===0)throw Error(`THREE.PropertyBinding: can not parse propertyName from trackName: `+e);return n}static findNode(e,t){if(t===void 0||t===``||t===`.`||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(e){for(let r=0;r<e.length;r++){let i=e[r];if(i.name===t||i.uuid===t)return i;let a=n(i.children);if(a)return a}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let t=this.node,n=this.parsedPath,r=n.objectName,i=n.propertyName,a=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){B(`PropertyBinding: No target node found for track: `+this.path+`.`);return}if(r){let e=n.objectIndex;switch(r){case`materials`:if(!t.material){V(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.materials){V(`PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.`,this);return}t=t.material.materials;break;case`bones`:if(!t.skeleton){V(`PropertyBinding: Can not bind to bones as node does not have a skeleton.`,this);return}t=t.skeleton.bones;for(let n=0;n<t.length;n++)if(t[n].name===e){e=n;break}break;case`map`:if(`map`in t){t=t.map;break}if(!t.material){V(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.map){V(`PropertyBinding: Can not bind to material.map as node.material does not have a map.`,this);return}t=t.material.map;break;default:if(t[r]===void 0){V(`PropertyBinding: Can not bind to objectName of node undefined.`,this);return}t=t[r]}if(e!==void 0){if(t[e]===void 0){V(`PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.`,this,t);return}t=t[e]}}let o=t[i];if(o===void 0){let e=n.nodeName;V(`PropertyBinding: Trying to update property for track: `+e+`.`+i+` but it wasn't found.`,t);return}let s=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?s=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(s=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(a!==void 0){if(i===`morphTargetInfluences`){if(!t.geometry){V(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.`,this);return}if(!t.geometry.morphAttributes){V(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.`,this);return}t.morphTargetDictionary[a]!==void 0&&(a=t.morphTargetDictionary[a])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=a}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][s]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Lm.Composite=Im,Lm.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},Lm.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},Lm.prototype.GetterByBindingType=[Lm.prototype._getValue_direct,Lm.prototype._getValue_array,Lm.prototype._getValue_arrayElement,Lm.prototype._getValue_toArray],Lm.prototype.SetterByBindingTypeAndVersioning=[[Lm.prototype._setValue_direct,Lm.prototype._setValue_direct_setNeedsUpdate,Lm.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Lm.prototype._setValue_array,Lm.prototype._setValue_array_setNeedsUpdate,Lm.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Lm.prototype._setValue_arrayElement,Lm.prototype._setValue_arrayElement_setNeedsUpdate,Lm.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Lm.prototype._setValue_fromArray,Lm.prototype._setValue_fromArray_setNeedsUpdate,Lm.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Rm=new Al,zm=class{constructor(e,t,n=0,r=1/0){this.ray=new _d(e,t),this.near=n,this.far=r,this.camera=null,this.layers=new Vl,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,t.projectionMatrix.elements[14]).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):V(`Raycaster: Unsupported camera type: `+t.type)}setFromXRController(e){return Rm.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Rm),this}intersectObject(e,t=!0,n=[]){return Vm(e,this,n,t),n.sort(Bm),n}intersectObjects(e,t=!0,n=[]){for(let r=0,i=e.length;r<i;r++)Vm(e[r],this,n,t);return n.sort(Bm),n}};function Bm(e,t){return e.distance-t.distance}function Vm(e,t,n,r){let i=!0;if(e.layers.test(t.layers)&&e.raycast(t,n)===!1&&(i=!1),i===!0&&r===!0){let r=e.children;for(let e=0,i=r.length;e<i;e++)Vm(r[e],t,n,!0)}}var Hm=class{constructor(e=1,t=0,n=0){this.radius=e,this.phi=t,this.theta=n}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){let e=1e-6;return this.phi=H(this.phi,e,Math.PI-e),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(H(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}};(class e{static{e.prototype.isMatrix2=!0}constructor(e,t,n,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,r){let i=this.elements;return i[0]=e,i[2]=t,i[1]=n,i[3]=r,this}});var Um=class extends Pc{constructor(e,t=null){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(e){this.domElement!==null&&this.disconnect(),this.domElement=e}disconnect(){}dispose(){}update(){}};function Wm(e,t,n,r){let i=Gm(r);switch(n){case _s:return e*t;case Ss:return e*t/i.components*i.byteLength;case Cs:return e*t/i.components*i.byteLength;case ws:return e*t*2/i.components*i.byteLength;case Ts:return e*t*2/i.components*i.byteLength;case vs:return e*t*3/i.components*i.byteLength;case ys:return e*t*4/i.components*i.byteLength;case Es:return e*t*4/i.components*i.byteLength;case Ds:case Os:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case ks:case As:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Ms:case Ps:return Math.max(e,16)*Math.max(t,8)/4;case js:case Ns:return Math.max(e,8)*Math.max(t,8)/2;case Fs:case Is:case Rs:case zs:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case Ls:case Bs:case Vs:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Hs:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Us:return Math.floor((e+4)/5)*Math.floor((t+3)/4)*16;case Ws:return Math.floor((e+4)/5)*Math.floor((t+4)/5)*16;case Gs:return Math.floor((e+5)/6)*Math.floor((t+4)/5)*16;case Ks:return Math.floor((e+5)/6)*Math.floor((t+5)/6)*16;case qs:return Math.floor((e+7)/8)*Math.floor((t+4)/5)*16;case Js:return Math.floor((e+7)/8)*Math.floor((t+5)/6)*16;case Ys:return Math.floor((e+7)/8)*Math.floor((t+7)/8)*16;case Xs:return Math.floor((e+9)/10)*Math.floor((t+4)/5)*16;case Zs:return Math.floor((e+9)/10)*Math.floor((t+5)/6)*16;case Qs:return Math.floor((e+9)/10)*Math.floor((t+7)/8)*16;case $s:return Math.floor((e+9)/10)*Math.floor((t+9)/10)*16;case ec:return Math.floor((e+11)/12)*Math.floor((t+9)/10)*16;case tc:return Math.floor((e+11)/12)*Math.floor((t+11)/12)*16;case nc:case rc:case ic:return Math.ceil(e/4)*Math.ceil(t/4)*16;case ac:case oc:return Math.ceil(e/4)*Math.ceil(t/4)*8;case sc:case cc:return Math.ceil(e/4)*Math.ceil(t/4)*16}throw Error(`Unable to determine texture byte length for ${n} format.`)}function Gm(e){switch(e){case is:case as:return{byteLength:1,components:1};case ss:case os:case ds:return{byteLength:2,components:1};case fs:case ps:return{byteLength:2,components:4};case ls:case cs:case us:return{byteLength:4,components:1};case hs:case gs:return{byteLength:4,components:3}}throw Error(`THREE.TextureUtils: Unknown texture type ${e}.`)}typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`register`,{detail:{revision:`186`}})),typeof window<`u`&&(window.__THREE__?B(`WARNING: Multiple instances of Three.js being imported.`):window.__THREE__=`186`);function Km(){let e=null,t=!1,n=null,r=null;function i(t,a){r=e.requestAnimationFrame(i),n(t,a)}return{start:function(){t!==!0&&n!==null&&e!==null&&(r=e.requestAnimationFrame(i),t=!0)},stop:function(){e!==null&&e.cancelAnimationFrame(r),t=!1},setAnimationLoop:function(e){n=e},setContext:function(t){e=t}}}function qm(e){let t=new WeakMap;function n(t,n){let r=t.array,i=t.usage,a=r.byteLength,o=e.createBuffer();e.bindBuffer(n,o),e.bufferData(n,r,i),t.onUploadCallback();let s;if(r instanceof Float32Array)s=e.FLOAT;else if(typeof Float16Array<`u`&&r instanceof Float16Array)s=e.HALF_FLOAT;else if(r instanceof Uint16Array)s=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(r instanceof Int16Array)s=e.SHORT;else if(r instanceof Uint32Array)s=e.UNSIGNED_INT;else if(r instanceof Int32Array)s=e.INT;else if(r instanceof Int8Array)s=e.BYTE;else if(r instanceof Uint8Array)s=e.UNSIGNED_BYTE;else if(r instanceof Uint8ClampedArray)s=e.UNSIGNED_BYTE;else throw Error(`THREE.WebGLAttributes: Unsupported buffer data format: `+r);return{buffer:o,type:s,bytesPerElement:r.BYTES_PER_ELEMENT,version:t.version,size:a}}function r(t,n,r){let i=n.array,a=n.updateRanges;if(e.bindBuffer(r,t),a.length===0)e.bufferSubData(r,0,i);else{a.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<a.length;e++){let n=a[t],r=a[e];r.start<=n.start+n.count+1?n.count=Math.max(n.count,r.start+r.count-n.start):(++t,a[t]=r)}a.length=t+1;for(let t=0,n=a.length;t<n;t++){let n=a[t];e.bufferSubData(r,n.start*i.BYTES_PER_ELEMENT,i,n.start,n.count)}n.clearUpdateRanges()}n.onUploadCallback()}function i(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)}function a(n){n.isInterleavedBufferAttribute&&(n=n.data);let r=t.get(n);r&&(e.deleteBuffer(r.buffer),t.delete(n))}function o(e,i){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let n=t.get(e);(!n||n.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let a=t.get(e);if(a===void 0)t.set(e,n(e,i));else if(a.version<e.version){if(a.size!==e.array.byteLength)throw Error(`THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.`);r(a.buffer,e,i),a.version=e.version}}return{get:i,remove:a,update:o}}var q={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,lightprobes_pars_fragment:`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},J={common:{diffuse:{value:new K(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new G},alphaMap:{value:null},alphaMapTransform:{value:new G},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new G}},envmap:{envMap:{value:null},envMapRotation:{value:new G},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new G}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new G}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new G},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new G},normalScale:{value:new U(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new G},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new G}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new G}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new G}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new K(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new W},probesMax:{value:new W},probesResolution:{value:new W}},points:{diffuse:{value:new K(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new G},alphaTest:{value:0},uvTransform:{value:new G}},sprite:{diffuse:{value:new K(16777215)},opacity:{value:1},center:{value:new U(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new G},alphaMap:{value:null},alphaMapTransform:{value:new G},alphaTest:{value:0}}},Jm={basic:{uniforms:wp([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.fog]),vertexShader:q.meshbasic_vert,fragmentShader:q.meshbasic_frag},lambert:{uniforms:wp([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.fog,J.lights,{emissive:{value:new K(0)},envMapIntensity:{value:1}}]),vertexShader:q.meshlambert_vert,fragmentShader:q.meshlambert_frag},phong:{uniforms:wp([J.common,J.specularmap,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.fog,J.lights,{emissive:{value:new K(0)},specular:{value:new K(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:q.meshphong_vert,fragmentShader:q.meshphong_frag},standard:{uniforms:wp([J.common,J.envmap,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.roughnessmap,J.metalnessmap,J.fog,J.lights,{emissive:{value:new K(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:q.meshphysical_vert,fragmentShader:q.meshphysical_frag},toon:{uniforms:wp([J.common,J.aomap,J.lightmap,J.emissivemap,J.bumpmap,J.normalmap,J.displacementmap,J.gradientmap,J.fog,J.lights,{emissive:{value:new K(0)}}]),vertexShader:q.meshtoon_vert,fragmentShader:q.meshtoon_frag},matcap:{uniforms:wp([J.common,J.bumpmap,J.normalmap,J.displacementmap,J.fog,{matcap:{value:null}}]),vertexShader:q.meshmatcap_vert,fragmentShader:q.meshmatcap_frag},points:{uniforms:wp([J.points,J.fog]),vertexShader:q.points_vert,fragmentShader:q.points_frag},dashed:{uniforms:wp([J.common,J.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:q.linedashed_vert,fragmentShader:q.linedashed_frag},depth:{uniforms:wp([J.common,J.displacementmap]),vertexShader:q.depth_vert,fragmentShader:q.depth_frag},normal:{uniforms:wp([J.common,J.bumpmap,J.normalmap,J.displacementmap,{opacity:{value:1}}]),vertexShader:q.meshnormal_vert,fragmentShader:q.meshnormal_frag},sprite:{uniforms:wp([J.sprite,J.fog]),vertexShader:q.sprite_vert,fragmentShader:q.sprite_frag},background:{uniforms:{uvTransform:{value:new G},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:q.background_vert,fragmentShader:q.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new G}},vertexShader:q.backgroundCube_vert,fragmentShader:q.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:q.cube_vert,fragmentShader:q.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:q.equirect_vert,fragmentShader:q.equirect_frag},distance:{uniforms:wp([J.common,J.displacementmap,{referencePosition:{value:new W},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:q.distance_vert,fragmentShader:q.distance_frag},shadow:{uniforms:wp([J.lights,J.fog,{color:{value:new K(0)},opacity:{value:1}}]),vertexShader:q.shadow_vert,fragmentShader:q.shadow_frag}};Jm.physical={uniforms:wp([Jm.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new G},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new G},clearcoatNormalScale:{value:new U(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new G},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new G},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new G},sheen:{value:0},sheenColor:{value:new K(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new G},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new G},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new G},transmissionSamplerSize:{value:new U},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new G},attenuationDistance:{value:0},attenuationColor:{value:new K(0)},specularColor:{value:new K(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new G},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new G},anisotropyVector:{value:new U},anisotropyMap:{value:null},anisotropyMapTransform:{value:new G}}]),vertexShader:q.meshphysical_vert,fragmentShader:q.meshphysical_frag};var Ym={r:0,b:0,g:0},Xm=new Al,Zm=new G;Zm.set(-1,0,0,0,1,0,0,0,1);function Qm(e,t,n,r,i,a){let o=new K(0),s=i===!0?0:1,c,l,u=null,d=0,f=null;function p(e){let n=e.isScene===!0?e.background:null;if(n&&n.isTexture){let r=e.backgroundBlurriness>0;n=t.get(n,r)}return n}function m(t){let r=!1,i=p(t);i===null?g(o,s):i&&i.isColor&&(g(i,1),r=!0);let c=e.xr.getEnvironmentBlendMode();c===`additive`?n.buffers.color.setClear(0,0,0,1,a):c===`alpha-blend`&&n.buffers.color.setClear(0,0,0,0,a),(e.autoClear||r)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function h(t,n){let i=p(n);i&&(i.isCubeTexture||i.mapping===306)?(l===void 0&&(l=new Ad(new Qd(1,1,1),new jp({name:`BackgroundCubeMaterial`,uniforms:Cp(Jm.backgroundCube.uniforms),vertexShader:Jm.backgroundCube.vertexShader,fragmentShader:Jm.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute(`normal`),l.geometry.deleteAttribute(`uv`),l.onBeforeRender=function(e,t,n){this.matrixWorld.copyPosition(n.matrixWorld)},Object.defineProperty(l.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(l)),l.material.uniforms.envMap.value=i,l.material.uniforms.backgroundBlurriness.value=n.backgroundBlurriness,l.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,l.material.uniforms.backgroundRotation.value.setFromMatrix4(Xm.makeRotationFromEuler(n.backgroundRotation)).transpose(),i.isCubeTexture&&i.isRenderTargetTexture===!1&&l.material.uniforms.backgroundRotation.value.premultiply(Zm),l.material.toneMapped=ml.getTransfer(i.colorSpace)!==bc,(u!==i||d!==i.version||f!==e.toneMapping)&&(l.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),l.layers.enableAll(),t.unshift(l,l.geometry,l.material,0,0,null)):i&&i.isTexture&&(c===void 0&&(c=new Ad(new bp(2,2),new jp({name:`BackgroundMaterial`,uniforms:Cp(Jm.background.uniforms),vertexShader:Jm.background.vertexShader,fragmentShader:Jm.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute(`normal`),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=i,c.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,c.material.toneMapped=ml.getTransfer(i.colorSpace)!==bc,i.matrixAutoUpdate===!0&&i.updateMatrix(),c.material.uniforms.uvTransform.value.copy(i.matrix),(u!==i||d!==i.version||f!==e.toneMapping)&&(c.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),c.layers.enableAll(),t.unshift(c,c.geometry,c.material,0,0,null))}function g(t,r){t.getRGB(Ym,Dp(e)),n.buffers.color.setClear(Ym.r,Ym.g,Ym.b,r,a)}function _(){l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return o},setClearColor:function(e,t=1){o.set(e),s=t,g(o,s)},getClearAlpha:function(){return s},setClearAlpha:function(e){s=e,g(o,s)},render:m,addToRenderList:h,dispose:_}}function $m(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),r={},i=f(null),a=i,o=!1;function s(n,r,i,s,c){let u=!1,f=d(n,s,i,r);a!==f&&(a=f,l(a.object)),u=p(n,s,i,c),u&&m(n,s,i,c),c!==null&&t.update(c,e.ELEMENT_ARRAY_BUFFER),(u||o)&&(o=!1,b(n,r,i,s),c!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(c).buffer))}function c(){return e.createVertexArray()}function l(t){return e.bindVertexArray(t)}function u(t){return e.deleteVertexArray(t)}function d(e,t,n,i){let a=i.wireframe===!0,o=r[t.id];o===void 0&&(o={},r[t.id]=o);let s=e.isInstancedMesh===!0?e.id:0,l=o[s];l===void 0&&(l={},o[s]=l);let u=l[n.id];u===void 0&&(u={},l[n.id]=u);let d=u[a];return d===void 0&&(d=f(c()),u[a]=d),d}function f(e){let t=[],r=[],i=[];for(let e=0;e<n;e++)t[e]=0,r[e]=0,i[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:r,attributeDivisors:i,object:e,attributes:{},index:null}}function p(e,t,n,r){let i=a.attributes,o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=i[t],r=o[t];if(r===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(r=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(r=e.instanceColor)),n===void 0||n.attribute!==r||r&&n.data!==r.data)return!0;s++}return a.attributesNum!==s||a.index!==r}function m(e,t,n,r){let i={},o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=o[t];n===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(n=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(n=e.instanceColor));let r={};r.attribute=n,n&&n.data&&(r.data=n.data),i[t]=r,s++}a.attributes=i,a.attributesNum=s,a.index=r}function h(){let e=a.newAttributes;for(let t=0,n=e.length;t<n;t++)e[t]=0}function g(e){_(e,0)}function _(t,n){let r=a.newAttributes,i=a.enabledAttributes,o=a.attributeDivisors;r[t]=1,i[t]===0&&(e.enableVertexAttribArray(t),i[t]=1),o[t]!==n&&(e.vertexAttribDivisor(t,n),o[t]=n)}function v(){let t=a.newAttributes,n=a.enabledAttributes;for(let r=0,i=n.length;r<i;r++)n[r]!==t[r]&&(e.disableVertexAttribArray(r),n[r]=0)}function y(t,n,r,i,a,o,s){s===!0?e.vertexAttribIPointer(t,n,r,a,o):e.vertexAttribPointer(t,n,r,i,a,o)}function b(n,r,i,a){h();let o=a.attributes,s=i.getAttributes(),c=r.defaultAttributeValues;for(let r in s){let i=s[r];if(i.location>=0){let s=o[r];if(s===void 0&&(r===`instanceMatrix`&&n.instanceMatrix&&(s=n.instanceMatrix),r===`instanceColor`&&n.instanceColor&&(s=n.instanceColor)),s!==void 0){let r=s.normalized,o=s.itemSize,c=t.get(s);if(c===void 0)continue;let l=c.buffer,u=c.type,d=c.bytesPerElement,f=u===e.INT||u===e.UNSIGNED_INT||s.gpuType===1013;if(s.isInterleavedBufferAttribute){let t=s.data,c=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<i.locationSize;e++)_(i.location+e,t.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,c*d,(p+o/i.locationSize*e)*d,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<i.locationSize;e++)_(i.location+e,s.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,o*d,o/i.locationSize*e*d,f)}}else if(c!==void 0){let t=c[r];if(t!==void 0)switch(t.length){case 2:e.vertexAttrib2fv(i.location,t);break;case 3:e.vertexAttrib3fv(i.location,t);break;case 4:e.vertexAttrib4fv(i.location,t);break;default:e.vertexAttrib1fv(i.location,t)}}}}v()}function x(){T();for(let e in r){let t=r[e];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e]}}function S(e){if(r[e.id]===void 0)return;let t=r[e.id];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e.id]}function C(e){for(let t in r){let n=r[t];for(let t in n){let r=n[t];if(r[e.id]===void 0)continue;let i=r[e.id];for(let e in i)u(i[e].object),delete i[e];delete r[e.id]}}}function w(e){for(let t in r){let n=r[t],i=e.isInstancedMesh===!0?e.id:0,a=n[i];if(a!==void 0){for(let e in a){let t=a[e];for(let e in t)u(t[e].object),delete t[e];delete a[e]}delete n[i],Object.keys(n).length===0&&delete r[t]}}}function T(){E(),o=!0,a!==i&&(a=i,l(a.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:s,reset:T,resetDefaultState:E,dispose:x,releaseStatesOfGeometry:S,releaseStatesOfObject:w,releaseStatesOfProgram:C,initAttributes:h,enableAttribute:g,disableUnusedAttributes:v}}function eh(e,t,n){let r;function i(e){r=e}function a(t,i){e.drawArrays(r,t,i),n.update(i,r,1)}function o(t,i,a){a!==0&&(e.drawArraysInstanced(r,t,i,a),n.update(i,r,a))}function s(e,i,a){if(a===0)return;t.get(`WEBGL_multi_draw`).multiDrawArraysWEBGL(r,e,0,i,0,a);let o=0;for(let e=0;e<a;e++)o+=i[e];n.update(o,r,1)}this.setMode=i,this.render=a,this.renderInstances=o,this.renderMultiDraw=s}function th(e,t,n,r){let i;function a(){if(i!==void 0)return i;if(t.has(`EXT_texture_filter_anisotropic`)===!0){let n=t.get(`EXT_texture_filter_anisotropic`);i=e.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(t){return t===1023||r.convert(t)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT)}function s(n){let i=n===1016&&(t.has(`EXT_color_buffer_half_float`)||t.has(`EXT_color_buffer_float`));return!(n!==1009&&n!==1015&&!i&&r.convert(n)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE))}function c(t){if(t===`highp`){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return`highp`;t=`mediump`}return t===`mediump`&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?`mediump`:`lowp`}let l=n.precision===void 0?`highp`:n.precision,u=c(l);u!==l&&(B(`WebGLRenderer:`,l,`not supported, using`,u,`instead.`),l=u);let d=n.logarithmicDepthBuffer===!0,f=n.reversedDepthBuffer===!0&&t.has(`EXT_clip_control`);n.reversedDepthBuffer===!0&&f===!1&&B(`WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.`);let p=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),m=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),h=e.getParameter(e.MAX_TEXTURE_SIZE),g=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),_=e.getParameter(e.MAX_VERTEX_ATTRIBS),v=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),y=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),x=e.getParameter(e.MAX_SAMPLES),S=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:a,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:s,precision:l,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:m,maxTextureSize:h,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:v,maxVaryings:y,maxFragmentUniforms:b,maxSamples:x,samples:S}}function nh(e){let t=this,n=null,r=0,i=!1,a=!1,o=new ud,s=new G,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let n=e.length!==0||t||r!==0||i;return i=t,r=e.length,n},this.beginShadows=function(){a=!0,u(null)},this.endShadows=function(){a=!1},this.setGlobalState=function(e,t){n=u(e,t,0)},this.setState=function(t,o,s){let d=t.clippingPlanes,f=t.clipIntersection,p=t.clipShadows,m=e.get(t);if(!i||d===null||d.length===0||a&&!p)a?u(null):l();else{let e=a?0:r,t=e*4,i=m.clippingState||null;c.value=i,i=u(d,o,t,s);for(let e=0;e!==t;++e)i[e]=n[e];m.clippingState=i,this.numIntersection=f?this.numPlanes:0,this.numPlanes+=e}};function l(){c.value!==n&&(c.value=n,c.needsUpdate=r>0),t.numPlanes=r,t.numIntersection=0}function u(e,n,r,i){let a=e===null?0:e.length,l=null;if(a!==0){if(l=c.value,i!==!0||l===null){let t=r+a*4,i=n.matrixWorldInverse;s.getNormalMatrix(i),(l===null||l.length<t)&&(l=new Float32Array(t));for(let t=0,n=r;t!==a;++t,n+=4)o.copy(e[t]).applyMatrix4(i,s),o.normal.toArray(l,n),l[n+3]=o.constant}c.value=l,c.needsUpdate=!0}return t.numPlanes=a,t.numIntersection=0,l}}var rh=4,ih=6,ah=20,oh=256,sh=new ym,ch=new K,lh=null,uh=0,dh=0,fh=!1,ph=new W,mh=new W,hh=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,i={}){let{size:a=256,position:o=ph}=i;lh=this._renderer.getRenderTarget(),uh=this._renderer.getActiveCubeFace(),dh=this._renderer.getActiveMipmapLevel(),fh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,r,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Sh(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=xh(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=2**this._lodMax}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(lh,uh,dh),this._renderer.xr.enabled=fh,e.scissorTest=!1,vh(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===301||e.mapping===302?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),lh=this._renderer.getRenderTarget(),uh=this._renderer.getActiveCubeFace(),dh=this._renderer.getActiveMipmapLevel(),fh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:ts,minFilter:ts,generateMipmaps:!1,type:ds,format:ys,colorSpace:vc,depthBuffer:!1},r=_h(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=_h(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=gh(r)),this._blurMaterial=bh(r,e,t),this._ggxMaterial=yh(r,e,t)}return r}_compileMaterial(e){let t=new Ad(new od,e);this._renderer.compile(t,sh)}_sceneToCubeUV(e,t,n,r,i){let a=new gm(90,1,t,n),o=[1,-1,1,1,1,1],s=[1,1,1,-1,-1,-1],c=this._renderer,l=c.autoClear,u=c.toneMapping;c.getClearColor(ch),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Ad(new Qd,new vd({name:`PMREM.Background`,side:1,depthWrite:!1,depthTest:!1})));let d=this._backgroundBox,f=d.material,p=!1,m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,p=!0):(f.color.copy(ch),p=!0);for(let t=0;t<6;t++){let n=t%3;n===0?(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x+s[t],i.y,i.z)):n===1?(a.up.set(0,0,o[t]),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y+s[t],i.z)):(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y,i.z+s[t]));let l=this._cubeSize;vh(r,n*l,t>2?l:0,l,l),c.setRenderTarget(r),p&&c.render(d,a),c.render(e,a)}c.toneMapping=u,c.autoClear=l,e.background=m}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===301||e.mapping===302;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Sh()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=xh());let i=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=i;let o=i.uniforms;o.envMap.value=e;let s=this._cubeSize;vh(t,0,0,3*s,2*s),n.setRenderTarget(t),n.render(a,sh)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let t=1;t<r;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,i=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let s=a.uniforms,c=n/(this._lodMeshes.length-1),l=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-l*l)*(c*1.25),{_lodMax:d}=this,f=this._sizeLods[n],p=3*f*(n>d-rh?n-d+rh:0),m=4*(this._cubeSize-f);s.envMap.value=e.texture,s.roughness.value=u,s.mipInt.value=d-t,vh(i,p,m,3*f,2*f),r.setRenderTarget(i),r.render(o,sh),s.envMap.value=i.texture,s.roughness.value=0,s.mipInt.value=d-n,vh(e,p,m,3*f,2*f),r.setRenderTarget(e),r.render(o,sh)}_blur(e,t,n,r){let i=this._pingPongRenderTarget,a=Math.min(r,Math.PI)/Math.SQRT2;this._blurPass(e,i,t,n,a),this._blurPass(i,e,n,n,a)}_blurPass(e,t,n,r,i){let a=this._renderer,o=this._blurMaterial,s=this._lodMeshes[r];s.material=o;let c=o.uniforms;c.envMap.value=e.texture,c.sigma.value=i,c.mipInt.value=this._lodMax-n;let l=this._sizeLods[r];vh(t,3*l*(r>this._lodMax-rh?r-this._lodMax+rh:0),4*(this._cubeSize-l),3*l,2*l),a.setRenderTarget(t),a.render(s,sh)}};function gh(e){let t=[],n=[],r=e,i=e-rh+1+ih;for(let e=0;e<i;e++){let e=2**r;t.push(e);let i=1/(e-2),a=-i,o=1+i,s=[a,a,o,a,o,o,a,a,o,o,a,o],c=new Float32Array(108),l=new Float32Array(108);for(let e=0;e<6;e++){let t=e%3*2/3-1,n=e>2?0:-1,r=[t,n,0,t+2/3,n,0,t+2/3,n+1,0,t,n,0,t+2/3,n+1,0,t,n+1,0];c.set(r,18*e);for(let t=0;t<6;t++){let n=s[t*2]*2-1,r=s[t*2+1]*2-1;e===0?mh.set(1,r,n):e===1?mh.set(-n,1,-r):e===2?mh.set(-n,r,1):e===3?mh.set(-1,r,-n):e===4?mh.set(-n,-1,r):mh.set(n,r,-1),mh.toArray(l,(e*6+t)*3)}}let u=new od;u.setAttribute(`position`,new Gu(c,3)),u.setAttribute(`outputDirection`,new Gu(l,3)),n.push(new Ad(u,null)),r>rh&&r--}return{lodMeshes:n,sizeLods:t}}function _h(e,t,n){let r=new Dl(e,t,n);return r.texture.mapping=306,r.texture.name=`PMREM.cubeUv`,r.scissorTest=!0,r}function vh(e,t,n,r,i){e.viewport.set(t,n,r,i),e.scissor.set(t,n,r,i)}function yh(e,t,n){return new jp({name:`PMREMGGXConvolution`,defines:{GGX_SAMPLES:oh,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Ch(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function bh(e,t,n){return new jp({name:`SphericalGaussianBlur`,defines:{SAMPLES:ah,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:Ch(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function xh(){return new jp({name:`EquirectangularToCubeUV`,uniforms:{envMap:{value:null}},vertexShader:Ch(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Sh(){return new jp({name:`CubemapToCubeUV`,uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ch(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Ch(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var wh=class extends Dl{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new qd(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new Qd(5,5,5),i=new jp({name:`CubemapFromEquirect`,uniforms:Cp(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:1,blending:0});i.uniforms.tEquirect.value=t;let a=new Ad(r,i),o=t.minFilter;return t.minFilter===1008&&(t.minFilter=ts),new wm(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let i=e.getRenderTarget();for(let i=0;i<6;i++)e.setRenderTarget(this,i),e.clear(t,n,r);e.setRenderTarget(i)}};function Th(e){let t=new WeakMap,n=new WeakMap,r=null;function i(e,t=!1){return e==null?null:t?o(e):a(e)}function a(n){if(n&&n.isTexture){let r=n.mapping;if(r===303||r===304){if(t.has(n)){let e=t.get(n).texture;return s(e,n.mapping)}{let r=n.image;if(r&&r.height>0){let i=new wh(r.height);return i.fromEquirectangularTexture(e,n),t.set(n,i),n.addEventListener(`dispose`,l),s(i.texture,n.mapping)}return null}}}return n}function o(t){if(t&&t.isTexture){let i=t.mapping,a=i===303||i===304,o=i===301||i===302;if(a||o){let i=n.get(t),s=i===void 0?0:i.texture.pmremVersion;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return r===null&&(r=new hh(e)),i=a?r.fromEquirectangular(t,i):r.fromCubemap(t,i),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),i.texture;if(i!==void 0)return i.texture;{let s=t.image;return a&&s&&s.height>0||o&&s&&c(s)?(r===null&&(r=new hh(e)),i=a?r.fromEquirectangular(t):r.fromCubemap(t),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),t.addEventListener(`dispose`,u),i.texture):null}}}return t}function s(e,t){return t===303?e.mapping=301:t===304&&(e.mapping=302),e}function c(e){let t=0;for(let n=0;n<6;n++)e[n]!==void 0&&t++;return t===6}function l(e){let n=e.target;n.removeEventListener(`dispose`,l);let r=t.get(n);r!==void 0&&(t.delete(n),r.dispose())}function u(e){let t=e.target;t.removeEventListener(`dispose`,u);let r=n.get(t);r!==void 0&&(n.delete(t),r.dispose())}function d(){t=new WeakMap,n=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:d}}function Eh(e){let t={};function n(n){if(t[n]!==void 0)return t[n];let r=e.getExtension(n);return t[n]=r,r}return{has:function(e){return n(e)!==null},init:function(){n(`EXT_color_buffer_float`),n(`WEBGL_clip_cull_distance`),n(`OES_texture_float_linear`),n(`EXT_color_buffer_half_float`),n(`WEBGL_multisampled_render_to_texture`),n(`WEBGL_render_shared_exponent`)},get:function(e){let t=n(e);return t===null&&jc(`WebGLRenderer: `+e+` extension not supported.`),t}}}function Dh(e,t,n,r){let i={},a=new WeakMap;function o(e){let s=e.target;s.index!==null&&t.remove(s.index);for(let e in s.attributes)t.remove(s.attributes[e]);s.removeEventListener(`dispose`,o),delete i[s.id];let c=a.get(s);c&&(t.remove(c),a.delete(s)),r.releaseStatesOfGeometry(s),s.isInstancedBufferGeometry===!0&&delete s._maxInstanceCount,n.memory.geometries--}function s(e,t){return i[t.id]===!0||(t.addEventListener(`dispose`,o),i[t.id]=!0,n.memory.geometries++),t}function c(n){let r=n.attributes;for(let n in r)t.update(r[n],e.ARRAY_BUFFER)}function l(e){let n=[],r=e.index,i=e.attributes.position,o=0;if(i===void 0)return;if(r!==null){let e=r.array;o=r.version;for(let t=0,r=e.length;t<r;t+=3){let r=e[t+0],i=e[t+1],a=e[t+2];n.push(r,i,i,a,a,r)}}else{let e=i.array;o=i.version;for(let t=0,r=e.length/3-1;t<r;t+=3){let e=t+0,r=t+1,i=t+2;n.push(e,r,r,i,i,e)}}let s=new(i.count>=65535?qu:Ku)(n,1);s.version=o;let c=a.get(e);c&&t.remove(c),a.set(e,s)}function u(e){let t=a.get(e);if(t){let n=e.index;n!==null&&t.version<n.version&&l(e)}else l(e);return a.get(e)}return{get:s,update:c,getWireframeAttribute:u}}function Oh(e,t,n){let r;function i(e){r=e}let a,o;function s(e){a=e.type,o=e.bytesPerElement}function c(t,i){e.drawElements(r,i,a,t*o),n.update(i,r,1)}function l(t,i,s){s!==0&&(e.drawElementsInstanced(r,i,a,t*o,s),n.update(i,r,s))}function u(e,i,o){if(o===0)return;t.get(`WEBGL_multi_draw`).multiDrawElementsWEBGL(r,i,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=i[e];n.update(s,r,1)}this.setMode=i,this.setIndex=s,this.render=c,this.renderInstances=l,this.renderMultiDraw=u}function kh(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function r(t,r,i){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=t/3*i;break;case e.LINES:n.lines+=t/2*i;break;case e.LINE_STRIP:n.lines+=i*(t-1);break;case e.LINE_LOOP:n.lines+=i*t;break;case e.POINTS:n.points+=i*t;break;default:V(`WebGLInfo: Unknown draw mode:`,r)}}function i(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:i,update:r}}function Ah(e,t,n){let r=new WeakMap,i=new Tl;function a(a,o,s){let c=a.morphTargetInfluences,l=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=l===void 0?0:l.length,d=r.get(o);if(d===void 0||d.count!==u){d!==void 0&&d.texture.dispose();let e=o.morphAttributes.position!==void 0,n=o.morphAttributes.normal!==void 0,a=o.morphAttributes.color!==void 0,s=o.morphAttributes.position||[],c=o.morphAttributes.normal||[],l=o.morphAttributes.color||[],f=0;e===!0&&(f=1),n===!0&&(f=2),a===!0&&(f=3);let p=o.attributes.position.count*f,m=1;p>t.maxTextureSize&&(m=Math.ceil(p/t.maxTextureSize),p=t.maxTextureSize);let h=new Float32Array(p*m*4*u),g=new Ol(h,p,m,u);g.type=us,g.needsUpdate=!0;let _=f*4;for(let t=0;t<u;t++){let r=s[t],o=c[t],u=l[t],d=p*m*4*t;for(let t=0;t<r.count;t++){let s=t*_;e===!0&&(i.fromBufferAttribute(r,t),h[d+s+0]=i.x,h[d+s+1]=i.y,h[d+s+2]=i.z,h[d+s+3]=0),n===!0&&(i.fromBufferAttribute(o,t),h[d+s+4]=i.x,h[d+s+5]=i.y,h[d+s+6]=i.z,h[d+s+7]=0),a===!0&&(i.fromBufferAttribute(u,t),h[d+s+8]=i.x,h[d+s+9]=i.y,h[d+s+10]=i.z,h[d+s+11]=u.itemSize===4?i.w:1)}}d={count:u,texture:g,size:new U(p,m)},r.set(o,d);function v(){g.dispose(),r.delete(o),o.removeEventListener(`dispose`,v)}o.addEventListener(`dispose`,v)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)s.getUniforms().setValue(e,`morphTexture`,a.morphTexture,n);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let n=o.morphTargetsRelative?1:1-t;s.getUniforms().setValue(e,`morphTargetBaseInfluence`,n),s.getUniforms().setValue(e,`morphTargetInfluences`,c)}s.getUniforms().setValue(e,`morphTargetsTexture`,d.texture,n),s.getUniforms().setValue(e,`morphTargetsTextureSize`,d.size)}return{update:a}}function jh(e,t,n,r,i){let a=new WeakMap;function o(r){let o=i.render.frame,s=r.geometry,l=t.get(r,s);if(a.get(l)!==o&&(t.update(l),a.set(l,o)),r.isInstancedMesh&&(r.hasEventListener(`dispose`,c)===!1&&r.addEventListener(`dispose`,c),a.get(r)!==o&&(n.update(r.instanceMatrix,e.ARRAY_BUFFER),r.instanceColor!==null&&n.update(r.instanceColor,e.ARRAY_BUFFER),a.set(r,o))),r.isSkinnedMesh){let e=r.skeleton;a.get(e)!==o&&(e.update(),a.set(e,o))}return l}function s(){a=new WeakMap}function c(e){let t=e.target;t.removeEventListener(`dispose`,c),r.releaseStatesOfObject(t),n.remove(t.instanceMatrix),t.instanceColor!==null&&n.remove(t.instanceColor)}return{update:o,dispose:s}}var Mh={1:`LINEAR_TONE_MAPPING`,2:`REINHARD_TONE_MAPPING`,3:`CINEON_TONE_MAPPING`,4:`ACES_FILMIC_TONE_MAPPING`,6:`AGX_TONE_MAPPING`,7:`NEUTRAL_TONE_MAPPING`,5:`CUSTOM_TONE_MAPPING`};function Nh(e,t,n,r,i,a){let o=new Dl(t,n,{type:e,depthBuffer:i,stencilBuffer:a,samples:r?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),s=null,c=null,l=new od;l.setAttribute(`position`,new Ju([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute(`uv`,new Ju([0,2,0,0,2,0],2));let u=new Mp({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),d=new Ad(l,u),f=new ym(-1,1,1,-1,0,1),p=null,m=null,h=!1,g,_=null,v=[],y=!1;this.setSize=function(e,t){o.setSize(e,t),s!==null&&s.setSize(e,t),c!==null&&c.setSize(e,t);for(let n=0;n<v.length;n++){let r=v[n];r.setSize&&r.setSize(e,t)}},this.setEffects=function(e){v=e,y=v.length>0&&v[0].isRenderPass===!0;let t=o.width,n=o.height;v.length>0&&s===null&&(s=new Dl(t,n,{type:ds,depthBuffer:!1,stencilBuffer:!1}),c=new Dl(t,n,{type:ds,depthBuffer:!1,stencilBuffer:!1}));for(let e=0;e<v.length;e++){let r=v[e];r.setSize&&r.setSize(t,n)}},this.begin=function(e,t){if(h||e.toneMapping===0&&v.length===0)return!1;if(_=t,t!==null){let e=t.width,n=t.height;(o.width!==e||o.height!==n)&&this.setSize(e,n)}return y===!1&&e.setRenderTarget(o),g=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return y},this.end=function(e,t){e.toneMapping=g,h=!0;let n=o,r=s;for(let i=0;i<v.length;i++){let a=v[i];a.enabled!==!1&&(a.render(e,r,n,t),a.needsSwap!==!1&&(n=r,r=r===s?c:s))}if(p!==e.outputColorSpace||m!==e.toneMapping){p=e.outputColorSpace,m=e.toneMapping,u.defines={},ml.getTransfer(p)===`srgb`&&(u.defines.SRGB_TRANSFER=``);let t=Mh[m];t&&(u.defines[t]=``),u.needsUpdate=!0}u.uniforms.tDiffuse.value=n.texture,e.setRenderTarget(_),e.render(d,f),_=null,h=!1},this.isCompositing=function(){return h},this.dispose=function(){o.dispose(),s!==null&&s.dispose(),c!==null&&c.dispose(),l.dispose(),u.dispose()}}var Ph=new wl,Fh=new Yd(1,1),Ih=new Ol,Lh=new kl,Rh=new qd,zh=[],Bh=[],Vh=new Float32Array(16),Hh=new Float32Array(9),Uh=new Float32Array(4);function Wh(e,t,n){let r=e[0];if(r<=0||r>0)return e;let i=t*n,a=zh[i];if(a===void 0&&(a=new Float32Array(i),zh[i]=a),t!==0){r.toArray(a,0);for(let r=1,i=0;r!==t;++r)i+=n,e[r].toArray(a,i)}return a}function Gh(e,t){if(e.length!==t.length)return!1;for(let n=0,r=e.length;n<r;n++)if(e[n]!==t[n])return!1;return!0}function Kh(e,t){for(let n=0,r=t.length;n<r;n++)e[n]=t[n]}function qh(e,t){let n=Bh[t];n===void 0&&(n=new Int32Array(t),Bh[t]=n);for(let r=0;r!==t;++r)n[r]=e.allocateTextureUnit();return n}function Jh(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function Yh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gh(n,t))return;e.uniform2fv(this.addr,t),Kh(n,t)}}function Xh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if(Gh(n,t))return;e.uniform3fv(this.addr,t),Kh(n,t)}}function Zh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gh(n,t))return;e.uniform4fv(this.addr,t),Kh(n,t)}}function Qh(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gh(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),Kh(n,t)}else{if(Gh(n,r))return;Uh.set(r),e.uniformMatrix2fv(this.addr,!1,Uh),Kh(n,r)}}function $h(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gh(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),Kh(n,t)}else{if(Gh(n,r))return;Hh.set(r),e.uniformMatrix3fv(this.addr,!1,Hh),Kh(n,r)}}function eg(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Gh(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),Kh(n,t)}else{if(Gh(n,r))return;Vh.set(r),e.uniformMatrix4fv(this.addr,!1,Vh),Kh(n,r)}}function tg(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function ng(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gh(n,t))return;e.uniform2iv(this.addr,t),Kh(n,t)}}function rg(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Gh(n,t))return;e.uniform3iv(this.addr,t),Kh(n,t)}}function ig(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gh(n,t))return;e.uniform4iv(this.addr,t),Kh(n,t)}}function ag(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function og(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Gh(n,t))return;e.uniform2uiv(this.addr,t),Kh(n,t)}}function sg(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Gh(n,t))return;e.uniform3uiv(this.addr,t),Kh(n,t)}}function cg(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Gh(n,t))return;e.uniform4uiv(this.addr,t),Kh(n,t)}}function lg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i);let a;this.type===e.SAMPLER_2D_SHADOW?(Fh.compareFunction=n.isReversedDepthBuffer()?518:515,a=Fh):a=Ph,n.setTexture2D(t||a,i)}function ug(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture3D(t||Lh,i)}function dg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTextureCube(t||Rh,i)}function fg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture2DArray(t||Ih,i)}function pg(e){switch(e){case 5126:return Jh;case 35664:return Yh;case 35665:return Xh;case 35666:return Zh;case 35674:return Qh;case 35675:return $h;case 35676:return eg;case 5124:case 35670:return tg;case 35667:case 35671:return ng;case 35668:case 35672:return rg;case 35669:case 35673:return ig;case 5125:return ag;case 36294:return og;case 36295:return sg;case 36296:return cg;case 35678:case 36198:case 36298:case 36306:case 35682:return lg;case 35679:case 36299:case 36307:return ug;case 35680:case 36300:case 36308:case 36293:return dg;case 36289:case 36303:case 36311:case 36292:return fg}}function mg(e,t){e.uniform1fv(this.addr,t)}function hg(e,t){let n=Wh(t,this.size,2);e.uniform2fv(this.addr,n)}function gg(e,t){let n=Wh(t,this.size,3);e.uniform3fv(this.addr,n)}function _g(e,t){let n=Wh(t,this.size,4);e.uniform4fv(this.addr,n)}function vg(e,t){let n=Wh(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function yg(e,t){let n=Wh(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function bg(e,t){let n=Wh(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function xg(e,t){e.uniform1iv(this.addr,t)}function Sg(e,t){e.uniform2iv(this.addr,t)}function Cg(e,t){e.uniform3iv(this.addr,t)}function wg(e,t){e.uniform4iv(this.addr,t)}function Tg(e,t){e.uniform1uiv(this.addr,t)}function Eg(e,t){e.uniform2uiv(this.addr,t)}function Dg(e,t){e.uniform3uiv(this.addr,t)}function Og(e,t){e.uniform4uiv(this.addr,t)}function kg(e,t,n){let r=this.cache,i=t.length,a=qh(n,i);Gh(r,a)||(e.uniform1iv(this.addr,a),Kh(r,a));let o;o=this.type===e.SAMPLER_2D_SHADOW?Fh:Ph;for(let e=0;e!==i;++e)n.setTexture2D(t[e]||o,a[e])}function Ag(e,t,n){let r=this.cache,i=t.length,a=qh(n,i);Gh(r,a)||(e.uniform1iv(this.addr,a),Kh(r,a));for(let e=0;e!==i;++e)n.setTexture3D(t[e]||Lh,a[e])}function jg(e,t,n){let r=this.cache,i=t.length,a=qh(n,i);Gh(r,a)||(e.uniform1iv(this.addr,a),Kh(r,a));for(let e=0;e!==i;++e)n.setTextureCube(t[e]||Rh,a[e])}function Mg(e,t,n){let r=this.cache,i=t.length,a=qh(n,i);Gh(r,a)||(e.uniform1iv(this.addr,a),Kh(r,a));for(let e=0;e!==i;++e)n.setTexture2DArray(t[e]||Ih,a[e])}function Ng(e){switch(e){case 5126:return mg;case 35664:return hg;case 35665:return gg;case 35666:return _g;case 35674:return vg;case 35675:return yg;case 35676:return bg;case 5124:case 35670:return xg;case 35667:case 35671:return Sg;case 35668:case 35672:return Cg;case 35669:case 35673:return wg;case 5125:return Tg;case 36294:return Eg;case 36295:return Dg;case 36296:return Og;case 35678:case 36198:case 36298:case 36306:case 35682:return kg;case 35679:case 36299:case 36307:return Ag;case 35680:case 36300:case 36308:case 36293:return jg;case 36289:case 36303:case 36311:case 36292:return Mg}}var Pg=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=pg(t.type)}},Fg=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Ng(t.type)}},Ig=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let i=0,a=r.length;i!==a;++i){let a=r[i];a.setValue(e,t[a.id],n)}}},Lg=/(\w+)(\])?(\[|\.)?/g;function Rg(e,t){e.seq.push(t),e.map[t.id]=t}function zg(e,t,n){let r=e.name,i=r.length;for(Lg.lastIndex=0;;){let a=Lg.exec(r),o=Lg.lastIndex,s=a[1],c=a[2]===`]`,l=a[3];if(c&&(s|=0),l===void 0||l===`[`&&o+2===i){Rg(n,l===void 0?new Pg(s,e,t):new Fg(s,e,t));break}{let e=n.map[s];e===void 0&&(e=new Ig(s),Rg(n,e)),n=e}}}var Bg=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){let n=e.getActiveUniform(t,r);zg(n,e.getUniformLocation(t,n.name),this)}let r=[],i=[];for(let t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(t):i.push(t);r.length>0&&(this.seq=r.concat(i))}setValue(e,t,n,r){let i=this.map[t];i!==void 0&&i.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let i=0,a=t.length;i!==a;++i){let a=t[i],o=n[a.id];o.needsUpdate!==!1&&a.setValue(e,o.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,i=e.length;r!==i;++r){let i=e[r];i.id in t&&n.push(i)}return n}};function Vg(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),r}var Hg=37297,Ug=0;function Wg(e,t){let n=e.split(`
`),r=[],i=Math.max(t-6,0),a=Math.min(t+6,n.length);for(let e=i;e<a;e++){let i=e+1;r.push(`${i===t?`>`:` `} ${i}: ${n[e]}`)}return r.join(`
`)}var Gg=new G;function Kg(e){ml._getMatrix(Gg,ml.workingColorSpace,e);let t=`mat3( ${Gg.elements.map(e=>e.toFixed(4))} )`;switch(ml.getTransfer(e)){case yc:return[t,`LinearTransferOETF`];case bc:return[t,`sRGBTransferOETF`];default:return B(`WebGLProgram: Unsupported color space: `,e),[t,`LinearTransferOETF`]}}function qg(e,t,n){let r=e.getShaderParameter(t,e.COMPILE_STATUS),i=(e.getShaderInfoLog(t)||``).trim();if(r&&i===``)return``;let a=/ERROR: 0:(\d+)/.exec(i);if(a){let r=parseInt(a[1]);return n.toUpperCase()+`

`+i+`

`+Wg(e.getShaderSource(t),r)}return i}function Jg(e,t){let n=Kg(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,`}`].join(`
`)}var Yg={1:`Linear`,2:`Reinhard`,3:`Cineon`,4:`ACESFilmic`,6:`AgX`,7:`Neutral`,5:`Custom`};function Xg(e,t){let n=Yg[t];return n===void 0?(B(`WebGLProgram: Unsupported toneMapping:`,t),`vec3 `+e+`( vec3 color ) { return LinearToneMapping( color ); }`):`vec3 `+e+`( vec3 color ) { return `+n+`ToneMapping( color ); }`}var Zg=new W;function Qg(){return ml.getLuminanceCoefficients(Zg),[`float luminance( const in vec3 rgb ) {`,`	const vec3 weights = vec3( ${Zg.x.toFixed(4)}, ${Zg.y.toFixed(4)}, ${Zg.z.toFixed(4)} );`,`	return dot( weights, rgb );`,`}`].join(`
`)}function $g(e){return[e.extensionClipCullDistance?`#extension GL_ANGLE_clip_cull_distance : require`:``,e.extensionMultiDraw?`#extension GL_ANGLE_multi_draw : require`:``].filter(n_).join(`
`)}function e_(e){let t=[];for(let n in e){let r=e[n];r!==!1&&t.push(`#define `+n+` `+r)}return t.join(`
`)}function t_(e,t){let n={},r=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let i=0;i<r;i++){let r=e.getActiveAttrib(t,i),a=r.name,o=1;r.type===e.FLOAT_MAT2&&(o=2),r.type===e.FLOAT_MAT3&&(o=3),r.type===e.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:e.getAttribLocation(t,a),locationSize:o}}return n}function n_(e){return e!==``}function r_(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function i_(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var a_=/^[ \t]*#include +<([\w\d./]+)>/gm;function o_(e){return e.replace(a_,c_)}var s_=new Map;function c_(e,t){let n=q[t];if(n===void 0){let e=s_.get(t);if(e!==void 0)n=q[e],B(`WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.`,t,e);else throw Error(`THREE.WebGLProgram: Can not resolve #include <`+t+`>`)}return o_(n)}var l_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function u_(e){return e.replace(l_,d_)}function d_(e,t,n,r){let i=``;for(let e=parseInt(t);e<parseInt(n);e++)i+=r.replace(/\[\s*i\s*\]/g,`[ `+e+` ]`).replace(/UNROLLED_LOOP_INDEX/g,e);return i}function f_(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision===`highp`?t+=`
#define HIGH_PRECISION`:e.precision===`mediump`?t+=`
#define MEDIUM_PRECISION`:e.precision===`lowp`&&(t+=`
#define LOW_PRECISION`),t}var p_={1:`SHADOWMAP_TYPE_PCF`,3:`SHADOWMAP_TYPE_VSM`};function m_(e){return p_[e.shadowMapType]||`SHADOWMAP_TYPE_BASIC`}var h_={301:`ENVMAP_TYPE_CUBE`,302:`ENVMAP_TYPE_CUBE`,306:`ENVMAP_TYPE_CUBE_UV`};function g_(e){return e.envMap===!1?`ENVMAP_TYPE_CUBE`:h_[e.envMapMode]||`ENVMAP_TYPE_CUBE`}var __={302:`ENVMAP_MODE_REFRACTION`};function v_(e){return e.envMap===!1?`ENVMAP_MODE_REFLECTION`:__[e.envMapMode]||`ENVMAP_MODE_REFLECTION`}var y_={0:`ENVMAP_BLENDING_MULTIPLY`,1:`ENVMAP_BLENDING_MIX`,2:`ENVMAP_BLENDING_ADD`};function b_(e){return e.envMap===!1?`ENVMAP_BLENDING_NONE`:y_[e.combine]||`ENVMAP_BLENDING_NONE`}function x_(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,r=1/t;return{texelWidth:1/(3*Math.max(2**n,112)),texelHeight:r,maxMip:n}}function S_(e,t,n,r){let i=e.getContext(),a=n.defines,o=n.vertexShader,s=n.fragmentShader,c=m_(n),l=g_(n),u=v_(n),d=b_(n),f=x_(n),p=$g(n),m=e_(a),h=i.createProgram(),g,_,v=n.glslVersion?`#version `+n.glslVersion+`
`:``;n.isRawShaderMaterial?(g=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(n_).join(`
`),g.length>0&&(g+=`
`),_=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(n_).join(`
`),_.length>0&&(_+=`
`)):(g=[f_(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.extensionClipCullDistance?`#define USE_CLIP_DISTANCE`:``,n.batching?`#define USE_BATCHING`:``,n.batchingColor?`#define USE_BATCHING_COLOR`:``,n.instancing?`#define USE_INSTANCING`:``,n.instancingColor?`#define USE_INSTANCING_COLOR`:``,n.instancingMorph?`#define USE_INSTANCING_MORPH`:``,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.map?`#define USE_MAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+u:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.displacementMap?`#define USE_DISPLACEMENTMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.mapUv?`#define MAP_UV `+n.mapUv:``,n.alphaMapUv?`#define ALPHAMAP_UV `+n.alphaMapUv:``,n.lightMapUv?`#define LIGHTMAP_UV `+n.lightMapUv:``,n.aoMapUv?`#define AOMAP_UV `+n.aoMapUv:``,n.emissiveMapUv?`#define EMISSIVEMAP_UV `+n.emissiveMapUv:``,n.bumpMapUv?`#define BUMPMAP_UV `+n.bumpMapUv:``,n.normalMapUv?`#define NORMALMAP_UV `+n.normalMapUv:``,n.displacementMapUv?`#define DISPLACEMENTMAP_UV `+n.displacementMapUv:``,n.metalnessMapUv?`#define METALNESSMAP_UV `+n.metalnessMapUv:``,n.roughnessMapUv?`#define ROUGHNESSMAP_UV `+n.roughnessMapUv:``,n.anisotropyMapUv?`#define ANISOTROPYMAP_UV `+n.anisotropyMapUv:``,n.clearcoatMapUv?`#define CLEARCOATMAP_UV `+n.clearcoatMapUv:``,n.clearcoatNormalMapUv?`#define CLEARCOAT_NORMALMAP_UV `+n.clearcoatNormalMapUv:``,n.clearcoatRoughnessMapUv?`#define CLEARCOAT_ROUGHNESSMAP_UV `+n.clearcoatRoughnessMapUv:``,n.iridescenceMapUv?`#define IRIDESCENCEMAP_UV `+n.iridescenceMapUv:``,n.iridescenceThicknessMapUv?`#define IRIDESCENCE_THICKNESSMAP_UV `+n.iridescenceThicknessMapUv:``,n.sheenColorMapUv?`#define SHEEN_COLORMAP_UV `+n.sheenColorMapUv:``,n.sheenRoughnessMapUv?`#define SHEEN_ROUGHNESSMAP_UV `+n.sheenRoughnessMapUv:``,n.specularMapUv?`#define SPECULARMAP_UV `+n.specularMapUv:``,n.specularColorMapUv?`#define SPECULAR_COLORMAP_UV `+n.specularColorMapUv:``,n.specularIntensityMapUv?`#define SPECULAR_INTENSITYMAP_UV `+n.specularIntensityMapUv:``,n.transmissionMapUv?`#define TRANSMISSIONMAP_UV `+n.transmissionMapUv:``,n.thicknessMapUv?`#define THICKNESSMAP_UV `+n.thicknessMapUv:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexNormals?`#define HAS_NORMAL`:``,n.vertexColors?`#define USE_COLOR`:``,n.vertexAlphas?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.flatShading?`#define FLAT_SHADED`:``,n.skinning?`#define USE_SKINNING`:``,n.morphTargets?`#define USE_MORPHTARGETS`:``,n.morphNormals&&n.flatShading===!1?`#define USE_MORPHNORMALS`:``,n.morphColors?`#define USE_MORPHCOLORS`:``,n.morphTargetsCount>0?`#define MORPHTARGETS_TEXTURE_STRIDE `+n.morphTextureStride:``,n.morphTargetsCount>0?`#define MORPHTARGETS_COUNT `+n.morphTargetsCount:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.sizeAttenuation?`#define USE_SIZEATTENUATION`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 modelMatrix;`,`uniform mat4 modelViewMatrix;`,`uniform mat4 projectionMatrix;`,`uniform mat4 viewMatrix;`,`uniform mat3 normalMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,`#ifdef USE_INSTANCING`,`	attribute mat4 instanceMatrix;`,`#endif`,`#ifdef USE_INSTANCING_COLOR`,`	attribute vec3 instanceColor;`,`#endif`,`#ifdef USE_INSTANCING_MORPH`,`	uniform sampler2D morphTexture;`,`#endif`,`attribute vec3 position;`,`attribute vec3 normal;`,`attribute vec2 uv;`,`#ifdef USE_UV1`,`	attribute vec2 uv1;`,`#endif`,`#ifdef USE_UV2`,`	attribute vec2 uv2;`,`#endif`,`#ifdef USE_UV3`,`	attribute vec2 uv3;`,`#endif`,`#ifdef USE_TANGENT`,`	attribute vec4 tangent;`,`#endif`,`#if defined( USE_COLOR_ALPHA )`,`	attribute vec4 color;`,`#elif defined( USE_COLOR )`,`	attribute vec3 color;`,`#endif`,`#ifdef USE_SKINNING`,`	attribute vec4 skinIndex;`,`	attribute vec4 skinWeight;`,`#endif`,`
`].filter(n_).join(`
`),_=[f_(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.alphaToCoverage?`#define ALPHA_TO_COVERAGE`:``,n.map?`#define USE_MAP`:``,n.matcap?`#define USE_MATCAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+l:``,n.envMap?`#define `+u:``,n.envMap?`#define `+d:``,f?`#define CUBEUV_TEXEL_WIDTH `+f.texelWidth:``,f?`#define CUBEUV_TEXEL_HEIGHT `+f.texelHeight:``,f?`#define CUBEUV_MAX_MIP `+f.maxMip+`.0`:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.packedNormalMap?`#define USE_PACKED_NORMALMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoat?`#define USE_CLEARCOAT`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.dispersion?`#define USE_DISPERSION`:``,n.retroreflection?`#define USE_RETROREFLECTION`:``,n.iridescence?`#define USE_IRIDESCENCE`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaTest?`#define USE_ALPHATEST`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.sheen?`#define USE_SHEEN`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors||n.instancingColor?`#define USE_COLOR`:``,n.vertexAlphas||n.batchingColor?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.gradientMap?`#define USE_GRADIENTMAP`:``,n.flatShading?`#define FLAT_SHADED`:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.premultipliedAlpha?`#define PREMULTIPLIED_ALPHA`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.numLightProbeGrids>0?`#define USE_LIGHT_PROBES_GRID`:``,n.decodeVideoTexture?`#define DECODE_VIDEO_TEXTURE`:``,n.decodeVideoTextureEmissive?`#define DECODE_VIDEO_TEXTURE_EMISSIVE`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 viewMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,n.toneMapping===0?``:`#define TONE_MAPPING`,n.toneMapping===0?``:q.tonemapping_pars_fragment,n.toneMapping===0?``:Xg(`toneMapping`,n.toneMapping),n.dithering?`#define DITHERING`:``,n.opaque?`#define OPAQUE`:``,q.colorspace_pars_fragment,Jg(`linearToOutputTexel`,n.outputColorSpace),Qg(),n.useDepthPacking?`#define DEPTH_PACKING `+n.depthPacking:``,`
`].filter(n_).join(`
`)),o=o_(o),o=r_(o,n),o=i_(o,n),s=o_(s),s=r_(s,n),s=i_(s,n),o=u_(o),s=u_(s),n.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,g=[p,`#define attribute in`,`#define varying out`,`#define texture2D texture`].join(`
`)+`
`+g,_=[`#define varying in`,n.glslVersion===`300 es`?``:`layout(location = 0) out highp vec4 pc_fragColor;`,n.glslVersion===`300 es`?``:`#define gl_FragColor pc_fragColor`,`#define gl_FragDepthEXT gl_FragDepth`,`#define texture2D texture`,`#define textureCube texture`,`#define texture2DProj textureProj`,`#define texture2DLodEXT textureLod`,`#define texture2DProjLodEXT textureProjLod`,`#define textureCubeLodEXT textureLod`,`#define texture2DGradEXT textureGrad`,`#define texture2DProjGradEXT textureProjGrad`,`#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+_);let y=v+g+o,b=v+_+s,x=Vg(i,i.VERTEX_SHADER,y),S=Vg(i,i.FRAGMENT_SHADER,b);i.attachShader(h,x),i.attachShader(h,S),n.index0AttributeName===void 0?n.hasPositionAttribute===!0&&i.bindAttribLocation(h,0,`position`):i.bindAttribLocation(h,0,n.index0AttributeName),i.linkProgram(h);function C(t){if(e.debug.checkShaderErrors){let n=i.getProgramInfoLog(h)||``,r=i.getShaderInfoLog(x)||``,a=i.getShaderInfoLog(S)||``,o=n.trim(),s=r.trim(),c=a.trim(),l=!0,u=!0;if(i.getProgramParameter(h,i.LINK_STATUS)===!1){if(l=!1,typeof e.debug.onShaderError==`function`)e.debug.onShaderError(i,h,x,S);else{let e=qg(i,x,`vertex`),n=qg(i,S,`fragment`);V(`WebGLProgram: Shader Error `+i.getError()+` - VALIDATE_STATUS `+i.getProgramParameter(h,i.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+o+`
`+e+`
`+n)}}else o===``?(s===``||c===``)&&(u=!1):B(`WebGLProgram: Program Info Log:`,o);u&&(t.diagnostics={runnable:l,programLog:o,vertexShader:{log:s,prefix:g},fragmentShader:{log:c,prefix:_}})}i.deleteShader(x),i.deleteShader(S),w=new Bg(i,h),T=t_(i,h)}let w;this.getUniforms=function(){return w===void 0&&C(this),w};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let E=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return E===!1&&(E=i.getProgramParameter(h,Hg)),E},this.destroy=function(){r.releaseStatesOfProgram(this),i.deleteProgram(h),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Ug++,this.cacheKey=t,this.usedTimes=1,this.program=h,this.vertexShader=x,this.fragmentShader=S,this}var C_=0,w_=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let r=this._getShaderCacheForMaterial(e);return r.has(t)===!1&&(r.add(t),t.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let e of t)e.usedTimes--,e.usedTimes===0&&this.shaderCache.delete(e.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new T_(e),t.set(e,n)),n}},T_=class{constructor(e){this.id=C_++,this.code=e,this.usedTimes=0}};function E_(e){return e===1030||e===37490||e===36285}function D_(e,t,n,r,i,a){let o=new Vl,s=new w_,c=new Set,l=[],u=new Map,d=r.logarithmicDepthBuffer,f=r.precision,p={MeshDepthMaterial:`depth`,MeshDistanceMaterial:`distance`,MeshNormalMaterial:`normal`,MeshBasicMaterial:`basic`,MeshLambertMaterial:`lambert`,MeshPhongMaterial:`phong`,MeshToonMaterial:`toon`,MeshStandardMaterial:`physical`,MeshPhysicalMaterial:`physical`,MeshMatcapMaterial:`matcap`,LineBasicMaterial:`basic`,LineDashedMaterial:`dashed`,PointsMaterial:`points`,ShadowMaterial:`shadow`,SpriteMaterial:`sprite`};function m(e){return c.add(e),e===0?`uv`:`uv${e}`}function h(i,o,l,u,h,g){let _=u.fog,v=h.geometry,y=i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial?u.environment:null,b=i.isMeshStandardMaterial||i.isMeshLambertMaterial&&!i.envMap||i.isMeshPhongMaterial&&!i.envMap,x=t.get(i.envMap||y,b),S=x&&x.mapping===306?x.image.height:null,C=p[i.type];i.precision!==null&&(f=r.getMaxPrecision(i.precision),f!==i.precision&&B(`WebGLProgram.getParameters:`,i.precision,`not supported, using`,f,`instead.`));let w=v.morphAttributes.position||v.morphAttributes.normal||v.morphAttributes.color,T=w===void 0?0:w.length,E=0;v.morphAttributes.position!==void 0&&(E=1),v.morphAttributes.normal!==void 0&&(E=2),v.morphAttributes.color!==void 0&&(E=3);let D,O,k,A;if(C){let e=Jm[C];D=e.vertexShader,O=e.fragmentShader}else{D=i.vertexShader,O=i.fragmentShader;let e=s.getVertexShaderStage(i),t=s.getFragmentShaderStage(i);s.update(i,e,t),k=e.id,A=t.id}let j=e.getRenderTarget(),M=e.state.buffers.depth.getReversed(),N=h.isInstancedMesh===!0,ee=h.isBatchedMesh===!0,te=!!i.map,ne=!!i.matcap,re=!!x,ie=!!i.aoMap,ae=!!i.lightMap,oe=!!i.bumpMap&&i.wireframe===!1,P=!!i.normalMap,se=!!i.displacementMap,ce=!!i.emissiveMap,le=!!i.metalnessMap,ue=!!i.roughnessMap,de=i.anisotropy>0,fe=i.clearcoat>0,pe=i.dispersion>0,me=i.retroreflectivity>0,he=i.iridescence>0,ge=i.sheen>0,_e=i.transmission>0,ve=de&&!!i.anisotropyMap,ye=fe&&!!i.clearcoatMap,be=fe&&!!i.clearcoatNormalMap,xe=fe&&!!i.clearcoatRoughnessMap,Se=he&&!!i.iridescenceMap,F=he&&!!i.iridescenceThicknessMap,Ce=ge&&!!i.sheenColorMap,we=ge&&!!i.sheenRoughnessMap,Te=!!i.specularMap,I=!!i.specularColorMap,Ee=!!i.specularIntensityMap,L=_e&&!!i.transmissionMap,R=_e&&!!i.thicknessMap,De=!!i.gradientMap,Oe=!!i.alphaMap,ke=i.alphaTest>0,Ae=!!i.alphaHash,je=!!i.extensions,Me=0;i.toneMapped&&(j===null||j.isXRRenderTarget===!0)&&(Me=e.toneMapping);let Ne={shaderID:C,shaderType:i.type,shaderName:i.name,vertexShader:D,fragmentShader:O,defines:i.defines,customVertexShaderID:k,customFragmentShaderID:A,isRawShaderMaterial:i.isRawShaderMaterial===!0,glslVersion:i.glslVersion,precision:f,batching:ee,batchingColor:ee&&h._colorsTexture!==null,instancing:N,instancingColor:N&&h.instanceColor!==null,instancingMorph:N&&h.morphTexture!==null,outputColorSpace:j===null?e.outputColorSpace:j.isXRRenderTarget===!0?j.texture.colorSpace:ml.workingColorSpace,alphaToCoverage:!!i.alphaToCoverage,map:te,matcap:ne,envMap:re,envMapMode:re&&x.mapping,envMapCubeUVHeight:S,aoMap:ie,lightMap:ae,bumpMap:oe,normalMap:P,displacementMap:se,emissiveMap:ce,normalMapObjectSpace:P&&i.normalMapType===1,normalMapTangentSpace:P&&i.normalMapType===0,packedNormalMap:P&&i.normalMapType===0&&E_(i.normalMap.format),metalnessMap:le,roughnessMap:ue,anisotropy:de,anisotropyMap:ve,clearcoat:fe,clearcoatMap:ye,clearcoatNormalMap:be,clearcoatRoughnessMap:xe,dispersion:pe,retroreflection:me,iridescence:he,iridescenceMap:Se,iridescenceThicknessMap:F,sheen:ge,sheenColorMap:Ce,sheenRoughnessMap:we,specularMap:Te,specularColorMap:I,specularIntensityMap:Ee,transmission:_e,transmissionMap:L,thicknessMap:R,gradientMap:De,opaque:i.transparent===!1&&i.blending===1&&i.alphaToCoverage===!1,alphaMap:Oe,alphaTest:ke,alphaHash:Ae,combine:i.combine,mapUv:te&&m(i.map.channel),aoMapUv:ie&&m(i.aoMap.channel),lightMapUv:ae&&m(i.lightMap.channel),bumpMapUv:oe&&m(i.bumpMap.channel),normalMapUv:P&&m(i.normalMap.channel),displacementMapUv:se&&m(i.displacementMap.channel),emissiveMapUv:ce&&m(i.emissiveMap.channel),metalnessMapUv:le&&m(i.metalnessMap.channel),roughnessMapUv:ue&&m(i.roughnessMap.channel),anisotropyMapUv:ve&&m(i.anisotropyMap.channel),clearcoatMapUv:ye&&m(i.clearcoatMap.channel),clearcoatNormalMapUv:be&&m(i.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:xe&&m(i.clearcoatRoughnessMap.channel),iridescenceMapUv:Se&&m(i.iridescenceMap.channel),iridescenceThicknessMapUv:F&&m(i.iridescenceThicknessMap.channel),sheenColorMapUv:Ce&&m(i.sheenColorMap.channel),sheenRoughnessMapUv:we&&m(i.sheenRoughnessMap.channel),specularMapUv:Te&&m(i.specularMap.channel),specularColorMapUv:I&&m(i.specularColorMap.channel),specularIntensityMapUv:Ee&&m(i.specularIntensityMap.channel),transmissionMapUv:L&&m(i.transmissionMap.channel),thicknessMapUv:R&&m(i.thicknessMap.channel),alphaMapUv:Oe&&m(i.alphaMap.channel),vertexTangents:!!v.attributes.tangent&&(P||de),vertexNormals:!!v.attributes.normal,vertexColors:i.vertexColors,vertexAlphas:i.vertexColors===!0&&!!v.attributes.color&&v.attributes.color.itemSize===4,pointsUvs:h.isPoints===!0&&!!v.attributes.uv&&(te||Oe),fog:!!_,useFog:i.fog===!0,fogExp2:!!_&&_.isFogExp2,flatShading:i.wireframe===!1&&(i.flatShading===!0||v.attributes.normal===void 0&&P===!1&&(i.isMeshLambertMaterial||i.isMeshPhongMaterial||i.isMeshStandardMaterial||i.isMeshPhysicalMaterial)),sizeAttenuation:i.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:M,skinning:h.isSkinnedMesh===!0,hasPositionAttribute:v.attributes.position!==void 0,morphTargets:v.morphAttributes.position!==void 0,morphNormals:v.morphAttributes.normal!==void 0,morphColors:v.morphAttributes.color!==void 0,morphTargetsCount:T,morphTextureStride:E,numSunLights:o.sun.length,numDirLights:o.directional.length,numPointLights:o.point.length,numSpotLights:o.spot.length,numSpotLightMaps:o.spotLightMap.length,numRectAreaLights:o.rectArea.length,numHemiLights:o.hemi.length,numSunLightShadows:o.sunShadowMap.length,numDirLightShadows:o.directionalShadowMap.length,numPointLightShadows:o.pointShadowMap.length,numSpotLightShadows:o.spotShadowMap.length,numSpotLightShadowsWithMaps:o.numSpotLightShadowsWithMaps,numLightProbes:o.numLightProbes,numLightProbeGrids:g.length,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:i.dithering,shadowMapEnabled:e.shadowMap.enabled&&l.length>0,shadowMapType:e.shadowMap.type,toneMapping:Me,decodeVideoTexture:te&&i.map.isVideoTexture===!0&&ml.getTransfer(i.map.colorSpace)===`srgb`,decodeVideoTextureEmissive:ce&&i.emissiveMap.isVideoTexture===!0&&ml.getTransfer(i.emissiveMap.colorSpace)===`srgb`,premultipliedAlpha:i.premultipliedAlpha,doubleSided:i.side===2,flipSided:i.side===1,useDepthPacking:i.depthPacking>=0,depthPacking:i.depthPacking||0,index0AttributeName:i.index0AttributeName,extensionClipCullDistance:je&&i.extensions.clipCullDistance===!0&&n.has(`WEBGL_clip_cull_distance`),extensionMultiDraw:(je&&i.extensions.multiDraw===!0||ee)&&n.has(`WEBGL_multi_draw`),rendererExtensionParallelShaderCompile:n.has(`KHR_parallel_shader_compile`),customProgramCacheKey:i.customProgramCacheKey()};return Ne.vertexUv1s=c.has(1),Ne.vertexUv2s=c.has(2),Ne.vertexUv3s=c.has(3),c.clear(),Ne}function g(t){let n=[];if(t.shaderID?n.push(t.shaderID):(n.push(t.customVertexShaderID),n.push(t.customFragmentShaderID)),t.defines!==void 0)for(let e in t.defines)n.push(e),n.push(t.defines[e]);return t.isRawShaderMaterial===!1&&(_(n,t),v(n,t),n.push(e.outputColorSpace)),n.push(t.customProgramCacheKey),n.join()}function _(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numSunLights),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numSunLightShadows),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function v(e,t){o.disableAll(),t.instancing&&o.enable(0),t.instancingColor&&o.enable(1),t.instancingMorph&&o.enable(2),t.matcap&&o.enable(3),t.envMap&&o.enable(4),t.normalMapObjectSpace&&o.enable(5),t.normalMapTangentSpace&&o.enable(6),t.clearcoat&&o.enable(7),t.iridescence&&o.enable(8),t.alphaTest&&o.enable(9),t.vertexColors&&o.enable(10),t.vertexAlphas&&o.enable(11),t.vertexUv1s&&o.enable(12),t.vertexUv2s&&o.enable(13),t.vertexUv3s&&o.enable(14),t.vertexTangents&&o.enable(15),t.anisotropy&&o.enable(16),t.alphaHash&&o.enable(17),t.batching&&o.enable(18),t.dispersion&&o.enable(19),t.retroreflection&&o.enable(24),t.batchingColor&&o.enable(20),t.gradientMap&&o.enable(21),t.packedNormalMap&&o.enable(22),t.vertexNormals&&o.enable(23),e.push(o.mask),o.disableAll(),t.fog&&o.enable(0),t.useFog&&o.enable(1),t.flatShading&&o.enable(2),t.logarithmicDepthBuffer&&o.enable(3),t.reversedDepthBuffer&&o.enable(4),t.skinning&&o.enable(5),t.morphTargets&&o.enable(6),t.morphNormals&&o.enable(7),t.morphColors&&o.enable(8),t.premultipliedAlpha&&o.enable(9),t.shadowMapEnabled&&o.enable(10),t.doubleSided&&o.enable(11),t.flipSided&&o.enable(12),t.useDepthPacking&&o.enable(13),t.dithering&&o.enable(14),t.transmission&&o.enable(15),t.sheen&&o.enable(16),t.opaque&&o.enable(17),t.pointsUvs&&o.enable(18),t.decodeVideoTexture&&o.enable(19),t.decodeVideoTextureEmissive&&o.enable(20),t.alphaToCoverage&&o.enable(21),t.numLightProbeGrids>0&&o.enable(22),t.hasPositionAttribute&&o.enable(23),e.push(o.mask)}function y(e){let t=p[e.type],n;if(t){let e=Jm[t];n=Op.clone(e.uniforms)}else n=e.uniforms;return n}function b(t,n){let r=u.get(n);return r===void 0?(r=new S_(e,n,t,i),l.push(r),u.set(n,r)):++r.usedTimes,r}function x(e){if(--e.usedTimes===0){let t=l.indexOf(e);l[t]=l[l.length-1],l.pop(),u.delete(e.cacheKey),e.destroy()}}function S(e){s.remove(e)}function C(){s.dispose()}return{getParameters:h,getProgramCacheKey:g,getUniforms:y,acquireProgram:b,releaseProgram:x,releaseShaderCache:S,programs:l,dispose:C}}function O_(){let e=new WeakMap;function t(t){return e.has(t)}function n(t){let n=e.get(t);return n===void 0&&(n={},e.set(t,n)),n}function r(t){e.delete(t)}function i(t,n,r){e.get(t)[n]=r}function a(){e=new WeakMap}return{has:t,get:n,remove:r,update:i,dispose:a}}function k_(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.material.id===t.material.id?e.materialVariant===t.materialVariant?e.z===t.z?e.id-t.id:e.z-t.z:e.materialVariant-t.materialVariant:e.material.id-t.material.id:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function A_(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.z===t.z?e.id-t.id:t.z-e.z:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function j_(){let e=[],t=0,n=[],r=[],i=[];function a(){t=0,n.length=0,r.length=0,i.length=0}function o(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function s(n,r,i,a,s,c){let l=e[t];return l===void 0?(l={id:n.id,object:n,geometry:r,material:i,materialVariant:o(n),groupOrder:a,renderOrder:n.renderOrder,z:s,group:c},e[t]=l):(l.id=n.id,l.object=n,l.geometry=r,l.material=i,l.materialVariant=o(n),l.groupOrder=a,l.renderOrder=n.renderOrder,l.z=s,l.group=c),t++,l}function c(e,t,a,o,c,l,u){u.reversedDepth===!0&&(c=-c);let d=s(e,t,a,o,c,l);a.transmission>0?r.push(d):a.transparent===!0?i.push(d):n.push(d)}function l(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.unshift(u):a.transparent===!0?i.unshift(u):n.unshift(u)}function u(e,t){n.length>1&&n.sort(e||k_),r.length>1&&r.sort(t||A_),i.length>1&&i.sort(t||A_)}function d(){for(let n=t,r=e.length;n<r;n++){let t=e[n];if(t.id===null)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}}return{opaque:n,transmissive:r,transparent:i,init:a,push:c,unshift:l,finish:d,sort:u}}function M_(){let e=new WeakMap;function t(t,n){let r=e.get(t),i;return r===void 0?(i=new j_,e.set(t,[i])):n>=r.length?(i=new j_,r.push(i)):i=r[n],i}function n(){e=new WeakMap}return{get:t,dispose:n}}function N_(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={direction:new W,color:new K};break;case`SpotLight`:n={position:new W,direction:new W,color:new K,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case`PointLight`:n={position:new W,color:new K,distance:0,decay:0};break;case`HemisphereLight`:n={direction:new W,skyColor:new K,groundColor:new K};break;case`RectAreaLight`:n={color:new K,position:new W,halfWidth:new W,halfHeight:new W}}return e[t.id]=n,n}}}function P_(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new U};break;case`SpotLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new U};break;case`PointLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new U,shadowCameraNear:1,shadowCameraFar:1e3}}return e[t.id]=n,n}}}var F_=0;function I_(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+ +!!t.map-!!e.map}function L_(e){let t=new N_,n=P_(),r={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)r.probe.push(new W);let i=new W,a=new Al,o=new Al;function s(i){let a=0,o=0,s=0;for(let e=0;e<9;e++)r.probe[e].set(0,0,0);let c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,x=0;i.sort(I_);for(let e=0,S=i.length;e<S;e++){let S=i[e],C=S.color,w=S.intensity,T=S.distance,E=null;if(S.shadow&&S.shadow.map&&(E=S.shadow.map.texture.format===1030?S.shadow.map.texture:S.shadow.map.depthTexture||S.shadow.map.texture),S.isAmbientLight)a+=C.r*w,o+=C.g*w,s+=C.b*w;else if(S.isLightProbe){for(let e=0;e<9;e++)r.probe[e].addScaledVector(S.sh.coefficients[e],w);x++}else if(S.isSunLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize.copy(e.mapSize).multiply(e.getFrameExtents()),r.sunShadow[l]=t,r.sunShadowMap[l]=E;let i=e.getViewportCount();for(let t=0;t<i;t++)r.sunShadowMatrix[u+t]=e.getMatrix(t),r.sunShadowCascade[u+t]=e._cascadeData[t];u+=i,l++}r.sun[c]=e,c++}else if(S.isDirectionalLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,r.directionalShadow[d]=t,r.directionalShadowMap[d]=E,r.directionalShadowMatrix[d]=S.shadow.matrix,g++}r.directional[d]=e,d++}else if(S.isSpotLight){let e=t.get(S);e.position.setFromMatrixPosition(S.matrixWorld),e.color.copy(C).multiplyScalar(w),e.distance=T,e.coneCos=Math.cos(S.angle),e.penumbraCos=Math.cos(S.angle*(1-S.penumbra)),e.decay=S.decay,r.spot[p]=e;let i=S.shadow;if(S.map&&(r.spotLightMap[y]=S.map,y++,i.updateMatrices(S),S.castShadow&&b++),r.spotLightMatrix[p]=i.matrix,S.castShadow){let e=n.get(S);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,r.spotShadow[p]=e,r.spotShadowMap[p]=E,v++}p++}else if(S.isRectAreaLight){let e=t.get(S);e.color.copy(C).multiplyScalar(w),e.halfWidth.set(S.width*.5,0,0),e.halfHeight.set(0,S.height*.5,0),r.rectArea[m]=e,m++}else if(S.isPointLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),e.distance=S.distance,e.decay=S.decay,S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,r.pointShadow[f]=t,r.pointShadowMap[f]=E,r.pointShadowMatrix[f]=S.shadow.matrix,_++}r.point[f]=e,f++}else if(S.isHemisphereLight){let e=t.get(S);e.skyColor.copy(S.color).multiplyScalar(w),e.groundColor.copy(S.groundColor).multiplyScalar(w),r.hemi[h]=e,h++}}m>0&&(e.has(`OES_texture_float_linear`)===!0?(r.rectAreaLTC1=J.LTC_FLOAT_1,r.rectAreaLTC2=J.LTC_FLOAT_2):(r.rectAreaLTC1=J.LTC_HALF_1,r.rectAreaLTC2=J.LTC_HALF_2)),r.ambient[0]=a,r.ambient[1]=o,r.ambient[2]=s;let S=r.hash;(S.sunLength!==c||S.directionalLength!==d||S.pointLength!==f||S.spotLength!==p||S.rectAreaLength!==m||S.hemiLength!==h||S.numSunShadows!==l||S.numDirectionalShadows!==g||S.numPointShadows!==_||S.numSpotShadows!==v||S.numSpotMaps!==y||S.numLightProbes!==x)&&(r.sun.length=c,r.directional.length=d,r.spot.length=p,r.rectArea.length=m,r.point.length=f,r.hemi.length=h,r.sunShadow.length=l,r.sunShadowMap.length=l,r.sunShadowMatrix.length=u,r.sunShadowCascade.length=u,r.directionalShadow.length=g,r.directionalShadowMap.length=g,r.directionalShadowMatrix.length=g,r.pointShadow.length=_,r.pointShadowMap.length=_,r.pointShadowMatrix.length=_,r.spotShadow.length=v,r.spotShadowMap.length=v,r.spotLightMatrix.length=v+y-b,r.spotLightMap.length=y,r.numSpotLightShadowsWithMaps=b,r.numLightProbes=x,S.sunLength=c,S.directionalLength=d,S.pointLength=f,S.spotLength=p,S.rectAreaLength=m,S.hemiLength=h,S.numSunShadows=l,S.numDirectionalShadows=g,S.numPointShadows=_,S.numSpotShadows=v,S.numSpotMaps=y,S.numLightProbes=x,r.version=F_++)}function c(e,t){let n=0,s=0,c=0,l=0,u=0,d=0,f=t.matrixWorldInverse;for(let t=0,p=e.length;t<p;t++){let p=e[t];if(p.isSunLight){let e=r.sun[n];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),n++}else if(p.isDirectionalLight){let e=r.directional[s];e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),s++}else if(p.isSpotLight){let e=r.spot[l];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),l++}else if(p.isRectAreaLight){let e=r.rectArea[u];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),o.identity(),a.copy(p.matrixWorld),a.premultiply(f),o.extractRotation(a),e.halfWidth.set(p.width*.5,0,0),e.halfHeight.set(0,p.height*.5,0),e.halfWidth.applyMatrix4(o),e.halfHeight.applyMatrix4(o),u++}else if(p.isPointLight){let e=r.point[c];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),c++}else if(p.isHemisphereLight){let e=r.hemi[d];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),d++}}}return{setup:s,setupView:c,state:r}}function R_(e){let t=new L_(e),n=[],r=[],i=[];function a(e){d.camera=e,n.length=0,r.length=0,i.length=0}function o(e){n.push(e)}function s(e){r.push(e)}function c(e){i.push(e)}function l(){t.setup(n)}function u(e){t.setupView(n,e)}let d={lightsArray:n,shadowsArray:r,lightProbeGridArray:i,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:a,state:d,setupLights:l,setupLightsView:u,pushLight:o,pushShadow:s,pushLightProbeGrid:c}}function z_(e){let t=new WeakMap;function n(n,r=0){let i=t.get(n),a;return i===void 0?(a=new R_(e),t.set(n,[a])):r>=i.length?(a=new R_(e),i.push(a)):a=i[r],a}function r(){t=new WeakMap}return{get:n,dispose:r}}var B_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,V_=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,H_=[new W(1,0,0),new W(-1,0,0),new W(0,1,0),new W(0,-1,0),new W(0,0,1),new W(0,0,-1)],U_=[new W(0,-1,0),new W(0,-1,0),new W(0,0,1),new W(0,0,-1),new W(0,-1,0),new W(0,-1,0)],W_=new Al,G_=new W,K_=new W;function q_(e,t,n){let r=new Kd,i=new U,a=new U,o=new Tl,s=new Ip,c=new Lp,l={},u=n.maxTextureSize,d={0:1,1:0,2:2},f=new jp({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new U},radius:{value:4}},vertexShader:B_,fragmentShader:V_}),p=f.clone();p.defines.HORIZONTAL_PASS=1;let m=new od;m.setAttribute(`position`,new Gu(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let h=new Ad(m,f),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let _=this.type;this.render=function(t,n,s){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||t.length===0)return;this.type===2&&(B(`WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`),this.type=1);let c=e.getRenderTarget(),l=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),f=e.state;f.setBlending(0),f.buffers.depth.getReversed()===!0?f.buffers.color.setClear(0,0,0,0):f.buffers.color.setClear(1,1,1,1),f.buffers.depth.setTest(!0),f.setScissorTest(!1);let p=_!==this.type;p&&n.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let c=0,l=t.length;c<l;c++){let l=t[c],d=l.shadow;if(d===void 0){B(`WebGLShadowMap:`,l,`has no shadow.`);continue}if(d.autoUpdate===!1&&d.needsUpdate===!1)continue;i.copy(d.mapSize);let m=d.getFrameExtents();i.multiply(m),a.copy(d.mapSize),(i.x>u||i.y>u)&&(i.x>u&&(a.x=Math.floor(u/m.x),i.x=a.x*m.x,d.mapSize.x=a.x),i.y>u&&(a.y=Math.floor(u/m.y),i.y=a.y*m.y,d.mapSize.y=a.y));let h=e.state.buffers.depth.getReversed();if(d.camera._reversedDepth=h,d.map===null||p===!0){if(d.map!==null&&(d.map.depthTexture!==null&&(d.map.depthTexture.dispose(),d.map.depthTexture=null),d.map.dispose()),this.type===3){if(l.isPointLight){B(`WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.`);continue}d.map=new Dl(i.x,i.y,{format:ws,type:ds,minFilter:ts,magFilter:ts,generateMipmaps:!1}),d.map.texture.name=l.name+`.shadowMap`,d.map.depthTexture=new Yd(i.x,i.y,us),d.map.depthTexture.name=l.name+`.shadowMapDepth`,d.map.depthTexture.format=bs,d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=Qo,d.map.depthTexture.magFilter=Qo}else l.isPointLight?(d.map=new wh(i.x),d.map.depthTexture=new Xd(i.x,ls)):(d.map=new Dl(i.x,i.y),d.map.depthTexture=new Yd(i.x,i.y,ls)),d.map.depthTexture.name=l.name+`.shadowMap`,d.map.depthTexture.format=bs,this.type===1?(d.map.depthTexture.compareFunction=h?518:515,d.map.depthTexture.minFilter=ts,d.map.depthTexture.magFilter=ts):(d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=Qo,d.map.depthTexture.magFilter=Qo);d.camera.updateProjectionMatrix()}d.map.isWebGLCubeRenderTarget!==!0&&(d.map.width!==i.x||d.map.height!==i.y)&&d.map.setSize(i.x,i.y);let g=d.map.isWebGLCubeRenderTarget?6:d.getViewportCount();l.isPointLight!==!0&&d.updateMatrices(l,s);for(let t=0;t<g;t++){let i=d.getCamera(t);if(l.isPointLight){let e=d.camera,n=d.matrix,r=l.distance||e.far;r!==e.far&&(e.far=r,e.updateProjectionMatrix()),G_.setFromMatrixPosition(l.matrixWorld),e.position.copy(G_),K_.copy(e.position),K_.add(H_[t]),e.up.copy(U_[t]),e.lookAt(K_),e.updateMatrixWorld(),n.makeTranslation(-G_.x,-G_.y,-G_.z),W_.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),d._frustum.setFromProjectionMatrix(W_,e.coordinateSystem,e.reversedDepth)}if(d.map.isWebGLCubeRenderTarget)e.setRenderTarget(d.map,t),e.clear();else{t===0&&(e.setRenderTarget(d.map),e.clear());let n=d.getViewport(t);o.set(a.x*n.x,a.y*n.y,a.x*n.z,a.y*n.w),f.viewport(o)}r=d.getFrustum(t),b(n,s,i,l,this.type)}d.isPointLightShadow!==!0&&this.type===3&&v(d,s),d.needsUpdate=!1}_=this.type,g.needsUpdate=!1,e.setRenderTarget(c,l,d)};function v(n,r){let a=t.update(h);f.defines.VSM_SAMPLES!==n.blurSamples&&(f.defines.VSM_SAMPLES=n.blurSamples,p.defines.VSM_SAMPLES=n.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),n.mapPass===null?n.mapPass=new Dl(i.x,i.y,{format:ws,type:ds}):(n.mapPass.width!==n.map.width||n.mapPass.height!==n.map.height)&&n.mapPass.setSize(n.map.width,n.map.height),f.uniforms.shadow_pass.value=n.map.depthTexture,f.uniforms.resolution.value.set(n.map.width,n.map.height),f.uniforms.radius.value=n.radius,e.setRenderTarget(n.mapPass),e.clear(),e.renderBufferDirect(r,null,a,f,h,null),p.uniforms.shadow_pass.value=n.mapPass.texture,p.uniforms.resolution.value.set(n.map.width,n.map.height),p.uniforms.radius.value=n.radius,e.setRenderTarget(n.map),e.clear(),e.renderBufferDirect(r,null,a,p,h,null)}function y(t,n,r,i){let a=null,o=r.isPointLight===!0?t.customDistanceMaterial:t.customDepthMaterial;if(o!==void 0)a=o;else if(a=r.isPointLight===!0?c:s,e.localClippingEnabled&&n.clipShadows===!0&&Array.isArray(n.clippingPlanes)&&n.clippingPlanes.length!==0||n.displacementMap&&n.displacementScale!==0||n.alphaMap&&n.alphaTest>0||n.map&&n.alphaTest>0||n.alphaToCoverage===!0){let e=a.uuid,t=n.uuid,r=l[e];r===void 0&&(r={},l[e]=r);let i=r[t];i===void 0&&(i=a.clone(),r[t]=i,n.addEventListener(`dispose`,x)),a=i}if(a.visible=n.visible,a.wireframe=n.wireframe,i===3?a.side=n.shadowSide===null?n.side:n.shadowSide:a.side=n.shadowSide===null?d[n.side]:n.shadowSide,a.alphaMap=n.alphaMap,a.alphaTest=n.alphaToCoverage===!0?.5:n.alphaTest,a.map=n.map,a.clipShadows=n.clipShadows,a.clippingPlanes=n.clippingPlanes,a.clipIntersection=n.clipIntersection,a.displacementMap=n.displacementMap,a.displacementScale=n.displacementScale,a.displacementBias=n.displacementBias,a.wireframeLinewidth=n.wireframeLinewidth,a.linewidth=n.linewidth,r.isPointLight===!0&&a.isMeshDistanceMaterial===!0){let t=e.properties.get(a);t.light=r}return a}function b(n,i,a,o,s){if(n.visible===!1)return;if(n.layers.test(i.layers)&&(n.isMesh||n.isLine||n.isPoints)&&(n.castShadow||n.receiveShadow&&s===3)&&(!n.frustumCulled||n.intersectsFrustum(r))){n.modelViewMatrix.multiplyMatrices(a.matrixWorldInverse,n.matrixWorld);let r=t.update(n),c=n.material;if(Array.isArray(c)){let t=r.groups;for(let l=0,u=t.length;l<u;l++){let u=t[l],d=c[u.materialIndex];if(d&&d.visible){let t=y(n,d,o,s);n.onBeforeShadow(e,n,i,a,r,t,u),e.renderBufferDirect(a,null,r,t,n,u),n.onAfterShadow(e,n,i,a,r,t,u)}}}else if(c.visible){let t=y(n,c,o,s);n.onBeforeShadow(e,n,i,a,r,t,null),e.renderBufferDirect(a,null,r,t,n,null),n.onAfterShadow(e,n,i,a,r,t,null)}}let c=n.children;for(let e=0,t=c.length;e<t;e++)b(c[e],i,a,o,s)}function x(e){e.target.removeEventListener(`dispose`,x);for(let t in l){let n=l[t],r=e.target.uuid;r in n&&(n[r].dispose(),delete n[r])}}}function J_(e,t){function n(){let t=!1,n=new Tl,r=null,i=new Tl(0,0,0,0);return{setMask:function(n){r!==n&&!t&&(e.colorMask(n,n,n,n),r=n)},setLocked:function(e){t=e},setClear:function(t,r,a,o,s){s===!0&&(t*=o,r*=o,a*=o),n.set(t,r,a,o),i.equals(n)===!1&&(e.clearColor(t,r,a,o),i.copy(n))},reset:function(){t=!1,r=null,i.set(-1,0,0,0)}}}function r(){let n=!1,r=!1,i=null,a=null,o=null;return{setReversed:function(e){if(r!==e){let n=t.get(`EXT_clip_control`);e?n.clipControlEXT(n.LOWER_LEFT_EXT,n.ZERO_TO_ONE_EXT):n.clipControlEXT(n.LOWER_LEFT_EXT,n.NEGATIVE_ONE_TO_ONE_EXT),r=e;let i=o;o=null,this.setClear(i)}},getReversed:function(){return r},setTest:function(t){t?le(e.DEPTH_TEST):ue(e.DEPTH_TEST)},setMask:function(t){i!==t&&!n&&(e.depthMask(t),i=t)},setFunc:function(t){if(r&&(t=Nc[t]),a!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}a=t}},setLocked:function(e){n=e},setClear:function(t){o!==t&&(o=t,r&&(t=1-t),e.clearDepth(t))},reset:function(){n=!1,i=null,a=null,o=null,r=!1}}}function i(){let t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null;return{setTest:function(n){t||(n?le(e.STENCIL_TEST):ue(e.STENCIL_TEST))},setMask:function(r){n!==r&&!t&&(e.stencilMask(r),n=r)},setFunc:function(t,n,o){(r!==t||i!==n||a!==o)&&(e.stencilFunc(t,n,o),r=t,i=n,a=o)},setOp:function(t,n,r){(o!==t||s!==n||c!==r)&&(e.stencilOp(t,n,r),o=t,s=n,c=r)},setLocked:function(e){t=e},setClear:function(t){l!==t&&(e.clearStencil(t),l=t)},reset:function(){t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null}}}let a=new n,o=new r,s=new i,c=new WeakMap,l=new WeakMap,u={},d={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new K(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,M=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),N=!1,ee=0,te=e.getParameter(e.VERSION);te.indexOf(`WebGL`)===-1?te.indexOf(`OpenGL ES`)!==-1&&(ee=parseFloat(/^OpenGL ES (\d)/.exec(te)[1]),N=ee>=2):(ee=parseFloat(/^WebGL (\d)/.exec(te)[1]),N=ee>=1);let ne=null,re={},ie=e.getParameter(e.SCISSOR_BOX),ae=e.getParameter(e.VIEWPORT),oe=new Tl().fromArray(ie),P=new Tl().fromArray(ae);function se(t,n,r,i){let a=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<r;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(n,0,e.RGBA,1,1,i,0,e.RGBA,e.UNSIGNED_BYTE,a):e.texImage2D(n+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,a);return o}let ce={};ce[e.TEXTURE_2D]=se(e.TEXTURE_2D,e.TEXTURE_2D,1),ce[e.TEXTURE_CUBE_MAP]=se(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),ce[e.TEXTURE_2D_ARRAY]=se(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),ce[e.TEXTURE_3D]=se(e.TEXTURE_3D,e.TEXTURE_3D,1,1),a.setClear(0,0,0,1),o.setClear(1),s.setClear(0),le(e.DEPTH_TEST),o.setFunc(3),ve(!1),ye(1),le(e.CULL_FACE),ge(0);function le(t){u[t]!==!0&&(e.enable(t),u[t]=!0)}function ue(t){u[t]!==!1&&(e.disable(t),u[t]=!1)}function de(t,n){return f[t]!==n&&(e.bindFramebuffer(t,n),f[t]=n,t===e.DRAW_FRAMEBUFFER&&(f[e.FRAMEBUFFER]=n),t===e.FRAMEBUFFER&&(f[e.DRAW_FRAMEBUFFER]=n),!0)}function fe(t,n){let r=m,i=!1;if(t){r=p.get(n),r===void 0&&(r=[],p.set(n,r));let a=t.textures;if(r.length!==a.length||r[0]!==e.COLOR_ATTACHMENT0){for(let t=0,n=a.length;t<n;t++)r[t]=e.COLOR_ATTACHMENT0+t;r.length=a.length,i=!0}}else r[0]!==e.BACK&&(r[0]=e.BACK,i=!0);i&&e.drawBuffers(r)}function pe(t){return h!==t&&(e.useProgram(t),h=t,!0)}let me={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};me[103]=e.MIN,me[104]=e.MAX;let he={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function ge(t,n,r,i,a,o,s,c,l,u){if(t===0)g===!0&&(ue(e.BLEND),g=!1);else if(g===!1&&(le(e.BLEND),g=!0),t!==5){if(t!==_||u!==E){if((v!==100||x!==100)&&(e.blendEquation(e.FUNC_ADD),v=100,x=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:V(`WebGLState: Invalid blending: `,t)}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:V(`WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true`);break;case 4:V(`WebGLState: MultiplyBlending requires material.premultipliedAlpha = true`);break;default:V(`WebGLState: Invalid blending: `,t)}y=null,b=null,S=null,C=null,w.set(0,0,0),T=0,_=t,E=u}}else a||=n,o||=r,s||=i,(n!==v||a!==x)&&(e.blendEquationSeparate(me[n],me[a]),v=n,x=a),(r!==y||i!==b||o!==S||s!==C)&&(e.blendFuncSeparate(he[r],he[i],he[o],he[s]),y=r,b=i,S=o,C=s),(c.equals(w)===!1||l!==T)&&(e.blendColor(c.r,c.g,c.b,l),w.copy(c),T=l),_=t,E=!1}function _e(t,n){t.side===2?ue(e.CULL_FACE):le(e.CULL_FACE);let r=t.side===1;n&&(r=!r),ve(r),t.blending===1&&t.transparent===!1?ge(0):ge(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),o.setFunc(t.depthFunc),o.setTest(t.depthTest),o.setMask(t.depthWrite),a.setMask(t.colorWrite);let i=t.stencilWrite;s.setTest(i),i&&(s.setMask(t.stencilWriteMask),s.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),s.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),xe(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),t.alphaToCoverage===!0?le(e.SAMPLE_ALPHA_TO_COVERAGE):ue(e.SAMPLE_ALPHA_TO_COVERAGE)}function ve(t){D!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),D=t)}function ye(t){t===0?ue(e.CULL_FACE):(le(e.CULL_FACE),t!==O&&(t===1?e.cullFace(e.BACK):t===2?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))),O=t}function be(t){t!==k&&(N&&e.lineWidth(t),k=t)}function xe(t,n,r){t?(le(e.POLYGON_OFFSET_FILL),(A!==n||j!==r)&&(A=n,j=r,o.getReversed()&&(n=-n),e.polygonOffset(n,r))):ue(e.POLYGON_OFFSET_FILL)}function Se(t){t?le(e.SCISSOR_TEST):ue(e.SCISSOR_TEST)}function F(t){t===void 0&&(t=e.TEXTURE0+M-1),ne!==t&&(e.activeTexture(t),ne=t)}function Ce(t,n,r){r===void 0&&(r=ne===null?e.TEXTURE0+M-1:ne);let i=re[r];i===void 0&&(i={type:void 0,texture:void 0},re[r]=i),(i.type!==t||i.texture!==n)&&(ne!==r&&(e.activeTexture(r),ne=r),e.bindTexture(t,n||ce[t]),i.type=t,i.texture=n)}function we(){let t=re[ne];t!==void 0&&t.type!==void 0&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)}function Te(){try{e.compressedTexImage2D(...arguments)}catch(e){V(`WebGLState:`,e)}}function I(){try{e.compressedTexImage3D(...arguments)}catch(e){V(`WebGLState:`,e)}}function Ee(){try{e.texSubImage2D(...arguments)}catch(e){V(`WebGLState:`,e)}}function L(){try{e.texSubImage3D(...arguments)}catch(e){V(`WebGLState:`,e)}}function R(){try{e.compressedTexSubImage2D(...arguments)}catch(e){V(`WebGLState:`,e)}}function De(){try{e.compressedTexSubImage3D(...arguments)}catch(e){V(`WebGLState:`,e)}}function Oe(){try{e.texStorage2D(...arguments)}catch(e){V(`WebGLState:`,e)}}function ke(){try{e.texStorage3D(...arguments)}catch(e){V(`WebGLState:`,e)}}function Ae(){try{e.texImage2D(...arguments)}catch(e){V(`WebGLState:`,e)}}function je(){try{e.texImage3D(...arguments)}catch(e){V(`WebGLState:`,e)}}function Me(t){return d[t]===void 0?e.getParameter(t):d[t]}function Ne(t,n){d[t]!==n&&(e.pixelStorei(t,n),d[t]=n)}function Pe(t){oe.equals(t)===!1&&(e.scissor(t.x,t.y,t.z,t.w),oe.copy(t))}function Fe(t){P.equals(t)===!1&&(e.viewport(t.x,t.y,t.z,t.w),P.copy(t))}function Ie(t,n){let r=l.get(n);r===void 0&&(r=new WeakMap,l.set(n,r));let i=r.get(t);i===void 0&&(i=e.getUniformBlockIndex(n,t.name),r.set(t,i))}function Le(t,n){let r=l.get(n).get(t);c.get(n)!==r&&(e.uniformBlockBinding(n,r,t.__bindingPointIndex),c.set(n,r))}function Re(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),o.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),u={},d={},ne=null,re={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new K(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,oe.set(0,0,e.canvas.width,e.canvas.height),P.set(0,0,e.canvas.width,e.canvas.height),a.reset(),o.reset(),s.reset()}return{buffers:{color:a,depth:o,stencil:s},enable:le,disable:ue,bindFramebuffer:de,drawBuffers:fe,useProgram:pe,setBlending:ge,setMaterial:_e,setFlipSided:ve,setCullFace:ye,setLineWidth:be,setPolygonOffset:xe,setScissorTest:Se,activeTexture:F,bindTexture:Ce,unbindTexture:we,compressedTexImage2D:Te,compressedTexImage3D:I,texImage2D:Ae,texImage3D:je,pixelStorei:Ne,getParameter:Me,updateUBOMapping:Ie,uniformBlockBinding:Le,texStorage2D:Oe,texStorage3D:ke,texSubImage2D:Ee,texSubImage3D:L,compressedTexSubImage2D:R,compressedTexSubImage3D:De,scissor:Pe,viewport:Fe,reset:Re}}function Y_(e,t,n,r,i,a,o){let s=t.has(`WEBGL_multisampled_render_to_texture`)?t.get(`WEBGL_multisampled_render_to_texture`):null,c=typeof navigator>`u`?!1:/OculusBrowser/g.test(navigator.userAgent),l=new U,u=new WeakMap,d=new Set,f,p=new WeakMap,m=!1;try{m=typeof OffscreenCanvas<`u`&&new OffscreenCanvas(1,1).getContext(`2d`)!==null}catch{}function h(e,t){return m?new OffscreenCanvas(e,t):Ec(`canvas`)}function g(e,t,n){let r=1,i=Te(e);if((i.width>n||i.height>n)&&(r=n/Math.max(i.width,i.height)),r<1){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof VideoFrame<`u`&&e instanceof VideoFrame){let n=Math.floor(r*i.width),a=Math.floor(r*i.height);f===void 0&&(f=h(n,a));let o=t?h(n,a):f;return o.width=n,o.height=a,o.getContext(`2d`).drawImage(e,0,0,n,a),B(`WebGLRenderer: Texture has been resized from (`+i.width+`x`+i.height+`) to (`+n+`x`+a+`).`),o}return`data`in e&&B(`WebGLRenderer: Image in DataTexture is too big (`+i.width+`x`+i.height+`).`),e}return e}function _(e){return e.generateMipmaps}function v(t){e.generateMipmap(t)}function y(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function b(n,r,i,a,o,s=!1){if(n!==null){if(e[n]!==void 0)return e[n];B(`WebGLRenderer: Attempt to use non-existing WebGL internal format '`+n+`'`)}let c;a&&(c=t.get(`EXT_texture_norm16`),c||B(`WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension`));let l=r;if(r===e.RED&&(i===e.FLOAT&&(l=e.R32F),i===e.HALF_FLOAT&&(l=e.R16F),i===e.UNSIGNED_BYTE&&(l=e.R8),i===e.UNSIGNED_SHORT&&c&&(l=c.R16_EXT),i===e.SHORT&&c&&(l=c.R16_SNORM_EXT)),r===e.RED_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.R8UI),i===e.UNSIGNED_SHORT&&(l=e.R16UI),i===e.UNSIGNED_INT&&(l=e.R32UI),i===e.BYTE&&(l=e.R8I),i===e.SHORT&&(l=e.R16I),i===e.INT&&(l=e.R32I)),r===e.RG&&(i===e.FLOAT&&(l=e.RG32F),i===e.HALF_FLOAT&&(l=e.RG16F),i===e.UNSIGNED_BYTE&&(l=e.RG8),i===e.UNSIGNED_SHORT&&c&&(l=c.RG16_EXT),i===e.SHORT&&c&&(l=c.RG16_SNORM_EXT)),r===e.RG_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RG8UI),i===e.UNSIGNED_SHORT&&(l=e.RG16UI),i===e.UNSIGNED_INT&&(l=e.RG32UI),i===e.BYTE&&(l=e.RG8I),i===e.SHORT&&(l=e.RG16I),i===e.INT&&(l=e.RG32I)),r===e.RGB_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGB8UI),i===e.UNSIGNED_SHORT&&(l=e.RGB16UI),i===e.UNSIGNED_INT&&(l=e.RGB32UI),i===e.BYTE&&(l=e.RGB8I),i===e.SHORT&&(l=e.RGB16I),i===e.INT&&(l=e.RGB32I)),r===e.RGBA_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGBA8UI),i===e.UNSIGNED_SHORT&&(l=e.RGBA16UI),i===e.UNSIGNED_INT&&(l=e.RGBA32UI),i===e.BYTE&&(l=e.RGBA8I),i===e.SHORT&&(l=e.RGBA16I),i===e.INT&&(l=e.RGBA32I)),r===e.RGB&&(i===e.UNSIGNED_SHORT&&c&&(l=c.RGB16_EXT),i===e.SHORT&&c&&(l=c.RGB16_SNORM_EXT),i===e.UNSIGNED_INT_5_9_9_9_REV&&(l=e.RGB9_E5),i===e.UNSIGNED_INT_10F_11F_11F_REV&&(l=e.R11F_G11F_B10F)),r===e.RGBA){let t=s?yc:ml.getTransfer(o);i===e.FLOAT&&(l=e.RGBA32F),i===e.HALF_FLOAT&&(l=e.RGBA16F),i===e.UNSIGNED_BYTE&&(l=t===`srgb`?e.SRGB8_ALPHA8:e.RGBA8),i===e.UNSIGNED_SHORT&&c&&(l=c.RGBA16_EXT),i===e.SHORT&&c&&(l=c.RGBA16_SNORM_EXT),i===e.UNSIGNED_SHORT_4_4_4_4&&(l=e.RGBA4),i===e.UNSIGNED_SHORT_5_5_5_1&&(l=e.RGB5_A1)}return(l===e.R16F||l===e.R32F||l===e.RG16F||l===e.RG32F||l===e.RGBA16F||l===e.RGBA32F)&&t.get(`EXT_color_buffer_float`),l}function x(t,n){let r;return t?n===null||n===1014||n===1020?r=e.DEPTH24_STENCIL8:n===1015?r=e.DEPTH32F_STENCIL8:n===1012&&(r=e.DEPTH24_STENCIL8,B(`DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.`)):n===null||n===1014||n===1020?r=e.DEPTH_COMPONENT24:n===1015?r=e.DEPTH_COMPONENT32F:n===1012&&(r=e.DEPTH_COMPONENT16),r}function S(e,t){return _(e)===!0||e.isFramebufferTexture&&e.minFilter!==1003&&e.minFilter!==1006?Math.log2(Math.max(t.width,t.height))+1:e.mipmaps!==void 0&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function C(e){let t=e.target;t.removeEventListener(`dispose`,C),T(t),t.isVideoTexture&&u.delete(t),t.isHTMLTexture&&d.delete(t)}function w(e){let t=e.target;t.removeEventListener(`dispose`,w),D(t)}function T(e){let t=r.get(e);if(t.__webglInit===void 0)return;let n=e.source,i=p.get(n);if(i){let r=i[t.__cacheKey];r.usedTimes--,r.usedTimes===0&&E(e),Object.keys(i).length===0&&p.delete(n)}r.remove(e)}function E(t){let n=r.get(t);e.deleteTexture(n.__webglTexture);let i=t.source,a=p.get(i);delete a[n.__cacheKey],o.memory.textures--}function D(t){let n=r.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),r.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(n.__webglFramebuffer[t]))for(let r=0;r<n.__webglFramebuffer[t].length;r++)e.deleteFramebuffer(n.__webglFramebuffer[t][r]);else e.deleteFramebuffer(n.__webglFramebuffer[t]);n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer[t])}else{if(Array.isArray(n.__webglFramebuffer))for(let t=0;t<n.__webglFramebuffer.length;t++)e.deleteFramebuffer(n.__webglFramebuffer[t]);else e.deleteFramebuffer(n.__webglFramebuffer);if(n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer),n.__webglMultisampledFramebuffer&&e.deleteFramebuffer(n.__webglMultisampledFramebuffer),n.__webglColorRenderbuffer)for(let t=0;t<n.__webglColorRenderbuffer.length;t++)n.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(n.__webglColorRenderbuffer[t]);n.__webglDepthRenderbuffer&&e.deleteRenderbuffer(n.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,n=i.length;t<n;t++){let n=r.get(i[t]);n.__webglTexture&&(e.deleteTexture(n.__webglTexture),o.memory.textures--),r.remove(i[t])}r.remove(t)}let O=0;function k(){O=0}function A(){return O}function j(e){O=e}function M(){let e=O;return e>=i.maxTextures&&B(`WebGLTextures: Trying to use `+(e+1)+` texture units while this GPU supports only `+i.maxTextures),O+=1,e}function N(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function ee(t,i){let a=r.get(t);if(t.isVideoTexture&&Ce(t),t.isRenderTargetTexture===!1&&t.isExternalTexture!==!0&&t.version>0&&a.__version!==t.version){let e=t.image;if(e===null)B(`WebGLRenderer: Texture marked for update but no image data found.`);else if(e.complete===!1)B(`WebGLRenderer: Texture marked for update but image is incomplete`);else{ue(a,t,i);return}}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,a.__webglTexture,e.TEXTURE0+i)}function te(t,i){let a=r.get(t);t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version?ue(a,t,i):(t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null),n.bindTexture(e.TEXTURE_2D_ARRAY,a.__webglTexture,e.TEXTURE0+i))}function ne(t,i){let a=r.get(t);t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version?ue(a,t,i):n.bindTexture(e.TEXTURE_3D,a.__webglTexture,e.TEXTURE0+i)}function re(t,i){let a=r.get(t);t.isCubeDepthTexture!==!0&&t.version>0&&a.__version!==t.version?de(a,t,i):n.bindTexture(e.TEXTURE_CUBE_MAP,a.__webglTexture,e.TEXTURE0+i)}let ie={[Yo]:e.REPEAT,[Xo]:e.CLAMP_TO_EDGE,[Zo]:e.MIRRORED_REPEAT},ae={[Qo]:e.NEAREST,[$o]:e.NEAREST_MIPMAP_NEAREST,[es]:e.NEAREST_MIPMAP_LINEAR,[ts]:e.LINEAR,[ns]:e.LINEAR_MIPMAP_NEAREST,[rs]:e.LINEAR_MIPMAP_LINEAR},oe={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function P(n,a){if(a.type===1015&&t.has(`OES_texture_float_linear`)===!1&&(a.magFilter===1006||a.magFilter===1007||a.magFilter===1005||a.magFilter===1008||a.minFilter===1006||a.minFilter===1007||a.minFilter===1005||a.minFilter===1008)&&B(`WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.`),e.texParameteri(n,e.TEXTURE_WRAP_S,ie[a.wrapS]),e.texParameteri(n,e.TEXTURE_WRAP_T,ie[a.wrapT]),(n===e.TEXTURE_3D||n===e.TEXTURE_2D_ARRAY)&&e.texParameteri(n,e.TEXTURE_WRAP_R,ie[a.wrapR]),e.texParameteri(n,e.TEXTURE_MAG_FILTER,ae[a.magFilter]),e.texParameteri(n,e.TEXTURE_MIN_FILTER,ae[a.minFilter]),a.compareFunction&&(e.texParameteri(n,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(n,e.TEXTURE_COMPARE_FUNC,oe[a.compareFunction])),t.has(`EXT_texture_filter_anisotropic`)===!0){if(a.magFilter===1003||a.minFilter!==1005&&a.minFilter!==1008||a.type===1015&&t.has(`OES_texture_float_linear`)===!1)return;if(a.anisotropy>1||r.get(a).__currentAnisotropy){let o=t.get(`EXT_texture_filter_anisotropic`);e.texParameterf(n,o.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(a.anisotropy,i.getMaxAnisotropy())),r.get(a).__currentAnisotropy=a.anisotropy}}}function se(t,n){let r=!1;t.__webglInit===void 0&&(t.__webglInit=!0,n.addEventListener(`dispose`,C));let i=n.source,a=p.get(i);a===void 0&&(a={},p.set(i,a));let s=N(n);if(s!==t.__cacheKey){a[s]===void 0&&(a[s]={texture:e.createTexture(),usedTimes:0},o.memory.textures++,r=!0),a[s].usedTimes++;let i=a[t.__cacheKey];i!==void 0&&(a[t.__cacheKey].usedTimes--,i.usedTimes===0&&E(n)),t.__cacheKey=s,t.__webglTexture=a[s].texture}return r}function ce(e,t,n){return Math.floor(Math.floor(e/n)/t)}function le(t,r,i,a){let o=t.updateRanges;if(o.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,r.width,r.height,i,a,r.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],n=o[e],i=t.start+t.count,a=ce(n.start,r.width,4),c=ce(t.start,r.width,4);n.start<=i+1&&a===c&&ce(n.start+n.count-1,r.width,4)===a?t.count=Math.max(t.count,n.start+n.count-t.start):(++s,o[s]=n)}o.length=s+1;let c=n.getParameter(e.UNPACK_ROW_LENGTH),l=n.getParameter(e.UNPACK_SKIP_PIXELS),u=n.getParameter(e.UNPACK_SKIP_ROWS);n.pixelStorei(e.UNPACK_ROW_LENGTH,r.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],c=Math.floor(s.start/4),l=Math.ceil(s.count/4),u=c%r.width,d=Math.floor(c/r.width),f=l;n.pixelStorei(e.UNPACK_SKIP_PIXELS,u),n.pixelStorei(e.UNPACK_SKIP_ROWS,d),n.texSubImage2D(e.TEXTURE_2D,0,u,d,f,1,i,a,r.data)}t.clearUpdateRanges(),n.pixelStorei(e.UNPACK_ROW_LENGTH,c),n.pixelStorei(e.UNPACK_SKIP_PIXELS,l),n.pixelStorei(e.UNPACK_SKIP_ROWS,u)}}function ue(t,o,s){let c=e.TEXTURE_2D;(o.isDataArrayTexture||o.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),o.isData3DTexture&&(c=e.TEXTURE_3D);let l=se(t,o),u=o.source;n.bindTexture(c,t.__webglTexture,e.TEXTURE0+s);let f=r.get(u);if(u.version!==f.__version||l===!0){if(n.activeTexture(e.TEXTURE0+s),!(typeof ImageBitmap<`u`&&o.image instanceof ImageBitmap)){let t=ml.getPrimaries(ml.workingColorSpace),r=o.colorSpace===``?null:ml.getPrimaries(o.colorSpace),i=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,i)}n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment);let t=g(o.image,!1,i.maxTextureSize);t=we(o,t);let r=a.convert(o.format,o.colorSpace),p=a.convert(o.type),m=b(o.internalFormat,r,p,o.normalized,o.colorSpace,o.isVideoTexture);P(c,o);let h,y=o.mipmaps,C=o.isVideoTexture!==!0,w=f.__version===void 0||l===!0,T=u.dataReady,E=S(o,t);if(o.isDepthTexture)m=x(o.format===xs,o.type),w&&(C?n.texStorage2D(e.TEXTURE_2D,1,m,t.width,t.height):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,null));else if(o.isDataTexture){if(y.length>0){C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data);o.generateMipmaps=!1}else C?(w&&n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height),T&&le(o,t,r,p)):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,t.data)}else if(o.isCompressedTexture){if(o.isCompressedArrayTexture){C&&w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,y[0].width,y[0].height,t.depth);for(let i=0,a=y.length;i<a;i++)if(h=y[i],o.format!==1023){if(r!==null){if(C){if(T){if(o.layerUpdates.size>0){let t=Wm(h.width,h.height,o.format,o.type);for(let a of o.layerUpdates){let o=h.data.subarray(a*t/h.data.BYTES_PER_ELEMENT,(a+1)*t/h.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,a,h.width,h.height,1,r,o)}}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,h.data)}}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,h.data,0,0)}else B(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`)}else C?T&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,p,h.data):n.texImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,r,p,h.data);o.layerUpdates.size>0&&o.clearLayerUpdates()}else{C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],o.format===1023?C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data):r===null?B(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`):C?T&&n.compressedTexSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,h.data):n.compressedTexImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,h.data)}}else if(o.isDataArrayTexture){if(C){if(w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,t.width,t.height,t.depth),T){if(o.layerUpdates.size>0){let i=Wm(t.width,t.height,o.format,o.type);for(let a of o.layerUpdates){let o=t.data.subarray(a*i/t.data.BYTES_PER_ELEMENT,(a+1)*i/t.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,a,t.width,t.height,1,r,p,o)}o.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)}}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,m,t.width,t.height,t.depth,0,r,p,t.data)}else if(o.isData3DTexture)C?(w&&n.texStorage3D(e.TEXTURE_3D,E,m,t.width,t.height,t.depth),T&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)):n.texImage3D(e.TEXTURE_3D,0,m,t.width,t.height,t.depth,0,r,p,t.data);else if(o.isFramebufferTexture){if(w){if(C)n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height);else{let i=t.width,a=t.height;for(let t=0;t<E;t++)n.texImage2D(e.TEXTURE_2D,t,m,i,a,0,r,p,null),i>>=1,a>>=1}}}else if(o.isHTMLTexture){if(`texElementImage2D`in e){let n=e.canvas;if(n.hasAttribute(`layoutsubtree`)||n.setAttribute(`layoutsubtree`,`true`),t.parentNode!==n){n.appendChild(t),d.add(o),n.onpaint=e=>{let t=e.changedElements;for(let e of d)t.includes(e.image)&&(e.needsUpdate=!0)},n.requestPaint();return}if(e.texElementImage2D.length===3)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,t);else{let n=e.RGBA,r=e.RGBA,i=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,n,r,i,t)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(y.length>0){if(C&&w){let t=Te(y[0]);n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height)}for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,r,p,h):n.texImage2D(e.TEXTURE_2D,t,m,r,p,h);o.generateMipmaps=!1}else if(C){if(w){let r=Te(t);n.texStorage2D(e.TEXTURE_2D,E,m,r.width,r.height)}T&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,r,p,t)}else n.texImage2D(e.TEXTURE_2D,0,m,r,p,t);_(o)&&v(c),f.__version=u.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function de(t,o,s){if(o.image.length!==6)return;let c=se(t,o),l=o.source;n.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+s);let u=r.get(l);if(l.version!==u.__version||c===!0){n.activeTexture(e.TEXTURE0+s);let t=ml.getPrimaries(ml.workingColorSpace),r=o.colorSpace===``?null:ml.getPrimaries(o.colorSpace),d=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,d);let f=o.isCompressedTexture||o.image[0].isCompressedTexture,p=o.image[0]&&o.image[0].isDataTexture,m=[];for(let e=0;e<6;e++)!f&&!p?m[e]=g(o.image[e],!0,i.maxCubemapSize):m[e]=p?o.image[e].image:o.image[e],m[e]=we(o,m[e]);let h=m[0],y=a.convert(o.format,o.colorSpace),x=a.convert(o.type),C=b(o.internalFormat,y,x,o.normalized,o.colorSpace),w=o.isVideoTexture!==!0,T=u.__version===void 0||c===!0,E=l.dataReady,D=S(o,h);P(e.TEXTURE_CUBE_MAP,o);let O;if(f){w&&T&&n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,h.width,h.height);for(let t=0;t<6;t++){O=m[t].mipmaps;for(let r=0;r<O.length;r++){let i=O[r];o.format===1023?w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,y,x,i.data):y===null?B(`WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()`):w?E&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,i.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,i.data)}}}else{if(O=o.mipmaps,w&&T){O.length>0&&D++;let t=Te(m[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,t.width,t.height)}for(let t=0;t<6;t++)if(p){w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,m[t].width,m[t].height,y,x,m[t].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,m[t].width,m[t].height,0,y,x,m[t].data);for(let r=0;r<O.length;r++){let i=O[r].image[t].image;w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,i.width,i.height,0,y,x,i.data)}}else{w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,y,x,m[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,y,x,m[t]);for(let r=0;r<O.length;r++){let i=O[r];w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,y,x,i.image[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,y,x,i.image[t])}}}_(o)&&v(e.TEXTURE_CUBE_MAP),u.__version=l.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function fe(t,i,o,c,l,u){let d=a.convert(o.format,o.colorSpace),f=a.convert(o.type),p=b(o.internalFormat,d,f,o.normalized,o.colorSpace),m=r.get(i),h=r.get(o);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>u),r=Math.max(1,i.height>>u);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?n.texImage3D(l,u,p,t,r,i.depth,0,d,f,null):n.texImage2D(l,u,p,t,r,0,d,f,null)}n.bindFramebuffer(e.FRAMEBUFFER,t),F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,c,l,h.__webglTexture,0,Se(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,c,l,h.__webglTexture,u),n.bindFramebuffer(e.FRAMEBUFFER,null)}function pe(t,n,r){if(e.bindRenderbuffer(e.RENDERBUFFER,t),n.depthBuffer){let i=n.depthTexture,a=i&&i.isDepthTexture?i.type:null,o=x(n.stencilBuffer,a),c=n.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;F(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,Se(n),o,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,Se(n),o,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,o,n.width,n.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,c,e.RENDERBUFFER,t)}else{let t=n.textures;for(let i=0;i<t.length;i++){let o=t[i],c=a.convert(o.format,o.colorSpace),l=a.convert(o.type),u=b(o.internalFormat,c,l,o.normalized,o.colorSpace);F(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,Se(n),u,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,Se(n),u,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,u,n.width,n.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function me(t,i,o){let c=i.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error(`THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.`);let l=r.get(i.depthTexture);if(l.__renderTarget=i,(!l.__webglTexture||i.depthTexture.image.width!==i.width||i.depthTexture.image.height!==i.height)&&(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),c){if(l.__webglInit===void 0&&(l.__webglInit=!0,i.depthTexture.addEventListener(`dispose`,C)),l.__webglTexture===void 0){l.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),P(e.TEXTURE_CUBE_MAP,i.depthTexture);let t=a.convert(i.depthTexture.format),r=a.convert(i.depthTexture.type),o;i.depthTexture.format===1026?o=e.DEPTH_COMPONENT24:i.depthTexture.format===1027&&(o=e.DEPTH24_STENCIL8);for(let n=0;n<6;n++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0,o,i.width,i.height,0,t,r,null)}}else ee(i.depthTexture,0);let u=l.__webglTexture,d=Se(i),f=c?e.TEXTURE_CUBE_MAP_POSITIVE_X+o:e.TEXTURE_2D,p=i.depthTexture.format===1027?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(i.depthTexture.format===1026)F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else if(i.depthTexture.format===1027)F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else throw Error(`THREE.WebGLTextures: Unknown depthTexture format.`)}function he(t){let i=r.get(t),a=t.isWebGLCubeRenderTarget===!0;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let t=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener(`dispose`,t)};e.addEventListener(`dispose`,t),i.__depthDisposeCallback=t}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer){if(a)for(let e=0;e<6;e++)me(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?me(i.__webglFramebuffer[0],t,0):me(i.__webglFramebuffer,t,0)}}else if(a){i.__webglDepthbuffer=[];for(let r=0;r<6;r++)if(n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[r]),i.__webglDepthbuffer[r]===void 0)i.__webglDepthbuffer[r]=e.createRenderbuffer(),pe(i.__webglDepthbuffer[r],t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer[r];e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,a)}}else{let r=t.texture.mipmaps;if(r&&r.length>0?n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),i.__webglDepthbuffer===void 0)i.__webglDepthbuffer=e.createRenderbuffer(),pe(i.__webglDepthbuffer,t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,r=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,r),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,r)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function ge(t,n,i){let a=r.get(t);n!==void 0&&fe(a.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),i!==void 0&&he(t)}function _e(t){let i=t.texture,s=r.get(t),c=r.get(i);t.addEventListener(`dispose`,w);let l=t.textures,u=t.isWebGLCubeRenderTarget===!0,d=l.length>1;if(d||(c.__webglTexture===void 0&&(c.__webglTexture=e.createTexture()),c.__version=i.version,o.memory.textures++),u){s.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer[t]=[];for(let n=0;n<i.mipmaps.length;n++)s.__webglFramebuffer[t][n]=e.createFramebuffer()}else s.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)s.__webglFramebuffer[t]=e.createFramebuffer()}else s.__webglFramebuffer=e.createFramebuffer();if(d)for(let t=0,n=l.length;t<n;t++){let n=r.get(l[t]);n.__webglTexture===void 0&&(n.__webglTexture=e.createTexture(),o.memory.textures++)}if(t.samples>0&&F(t)===!1){s.__webglMultisampledFramebuffer=e.createFramebuffer(),s.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,s.__webglMultisampledFramebuffer);for(let n=0;n<l.length;n++){let r=l[n];s.__webglColorRenderbuffer[n]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,s.__webglColorRenderbuffer[n]);let i=a.convert(r.format,r.colorSpace),o=a.convert(r.type),c=b(r.internalFormat,i,o,r.normalized,r.colorSpace,t.isXRRenderTarget===!0),u=Se(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,u,c,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+n,e.RENDERBUFFER,s.__webglColorRenderbuffer[n])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(s.__webglDepthRenderbuffer=e.createRenderbuffer(),pe(s.__webglDepthRenderbuffer,t,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(u){n.bindTexture(e.TEXTURE_CUBE_MAP,c.__webglTexture),P(e.TEXTURE_CUBE_MAP,i);for(let n=0;n<6;n++)if(i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)fe(s.__webglFramebuffer[n][r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,r);else fe(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0);_(i)&&v(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(d){for(let i=0,a=l.length;i<a;i++){let a=l[i],o=r.get(a),c=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(c=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(c,o.__webglTexture),P(c,a),fe(s.__webglFramebuffer,t,a,e.COLOR_ATTACHMENT0+i,c,0),_(a)&&v(c)}n.unbindTexture()}else{let r=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(r=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(r,c.__webglTexture),P(r,i),i.mipmaps&&i.mipmaps.length>0)for(let n=0;n<i.mipmaps.length;n++)fe(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,r,n);else fe(s.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,r,0);_(i)&&v(r),n.unbindTexture()}t.depthBuffer&&he(t)}function ve(e){let t=e.textures;for(let i=0,a=t.length;i<a;i++){let a=t[i];if(_(a)){let t=y(e),i=r.get(a).__webglTexture;n.bindTexture(t,i),v(t),n.unbindTexture()}}}let ye=[],be=[];function xe(t){if(t.samples>0){if(F(t)===!1){let i=t.textures,a=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,u=r.get(t),d=i.length>1;if(d)for(let t=0;t<i.length;t++)n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,u.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer);for(let n=0;n<i.length;n++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),d){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,u.__webglColorRenderbuffer[n]);let t=r.get(i[n]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,a,o,0,0,a,o,s,e.NEAREST),c===!0&&(ye.length=0,be.length=0,ye.push(e.COLOR_ATTACHMENT0+n),t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&(ye.push(l),be.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,be)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,ye))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),d)for(let t=0;t<i.length;t++){n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,u.__webglColorRenderbuffer[t]);let a=r.get(i[t]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,a,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&c){let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[n])}}}function Se(e){return Math.min(i.maxSamples,e.samples)}function F(e){let n=r.get(e);return e.samples>0&&t.has(`WEBGL_multisampled_render_to_texture`)===!0&&n.__useRenderToTexture!==!1}function Ce(e){let t=o.render.frame;u.get(e)!==t&&(u.set(e,t),e.update())}function we(e,t){let n=e.colorSpace,r=e.format,i=e.type;return e.isCompressedTexture===!0||e.isVideoTexture===!0||n!==`srgb-linear`&&n!==``&&(ml.getTransfer(n)===`srgb`?(r!==1023||i!==1009)&&B(`WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.`):V(`WebGLTextures: Unsupported texture color space:`,n)),t}function Te(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement?(l.width=e.naturalWidth||e.width,l.height=e.naturalHeight||e.height):typeof VideoFrame<`u`&&e instanceof VideoFrame?(l.width=e.displayWidth,l.height=e.displayHeight):(l.width=e.width,l.height=e.height),l}this.allocateTextureUnit=M,this.resetTextureUnits=k,this.getTextureUnits=A,this.setTextureUnits=j,this.setTexture2D=ee,this.setTexture2DArray=te,this.setTexture3D=ne,this.setTextureCube=re,this.rebindTextures=ge,this.setupRenderTarget=_e,this.updateRenderTargetMipmap=ve,this.updateMultisampleRenderTarget=xe,this.setupDepthRenderbuffer=he,this.setupFrameBufferTexture=fe,this.useMultisampledRTT=F,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function X_(e,t){function n(n,r=``){let i,a=ml.getTransfer(r);if(n===1009)return e.UNSIGNED_BYTE;if(n===1017)return e.UNSIGNED_SHORT_4_4_4_4;if(n===1018)return e.UNSIGNED_SHORT_5_5_5_1;if(n===35902)return e.UNSIGNED_INT_5_9_9_9_REV;if(n===35899)return e.UNSIGNED_INT_10F_11F_11F_REV;if(n===1010)return e.BYTE;if(n===1011)return e.SHORT;if(n===1012)return e.UNSIGNED_SHORT;if(n===1013)return e.INT;if(n===1014)return e.UNSIGNED_INT;if(n===1015)return e.FLOAT;if(n===1016)return e.HALF_FLOAT;if(n===1021)return e.ALPHA;if(n===1022)return e.RGB;if(n===1023)return e.RGBA;if(n===1026)return e.DEPTH_COMPONENT;if(n===1027)return e.DEPTH_STENCIL;if(n===1028)return e.RED;if(n===1029)return e.RED_INTEGER;if(n===1030)return e.RG;if(n===1031)return e.RG_INTEGER;if(n===1033)return e.RGBA_INTEGER;if(n===33776||n===33777||n===33778||n===33779){if(a===`srgb`){if(i=t.get(`WEBGL_compressed_texture_s3tc_srgb`),i!==null){if(n===33776)return i.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null}else if(i=t.get(`WEBGL_compressed_texture_s3tc`),i!==null){if(n===33776)return i.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null}if(n===35840||n===35841||n===35842||n===35843){if(i=t.get(`WEBGL_compressed_texture_pvrtc`),i!==null){if(n===35840)return i.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===35841)return i.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===35842)return i.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===35843)return i.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null}if(n===36196||n===37492||n===37496||n===37488||n===37489||n===37490||n===37491){if(i=t.get(`WEBGL_compressed_texture_etc`),i!==null){if(n===36196||n===37492)return a===`srgb`?i.COMPRESSED_SRGB8_ETC2:i.COMPRESSED_RGB8_ETC2;if(n===37496)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:i.COMPRESSED_RGBA8_ETC2_EAC;if(n===37488)return i.COMPRESSED_R11_EAC;if(n===37489)return i.COMPRESSED_SIGNED_R11_EAC;if(n===37490)return i.COMPRESSED_RG11_EAC;if(n===37491)return i.COMPRESSED_SIGNED_RG11_EAC}else return null}if(n===37808||n===37809||n===37810||n===37811||n===37812||n===37813||n===37814||n===37815||n===37816||n===37817||n===37818||n===37819||n===37820||n===37821){if(i=t.get(`WEBGL_compressed_texture_astc`),i!==null){if(n===37808)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:i.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===37809)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:i.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===37810)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:i.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===37811)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:i.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===37812)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:i.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===37813)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:i.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===37814)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:i.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===37815)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:i.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===37816)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:i.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===37817)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:i.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===37818)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:i.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===37819)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:i.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===37820)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:i.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===37821)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:i.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null}if(n===36492||n===36494||n===36495){if(i=t.get(`EXT_texture_compression_bptc`),i!==null){if(n===36492)return a===`srgb`?i.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:i.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===36494)return i.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===36495)return i.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null}if(n===36283||n===36284||n===36285||n===36286){if(i=t.get(`EXT_texture_compression_rgtc`),i!==null){if(n===36283)return i.COMPRESSED_RED_RGTC1_EXT;if(n===36284)return i.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===36285)return i.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===36286)return i.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null}return n===1020?e.UNSIGNED_INT_24_8:e[n]===void 0?null:e[n]}return{convert:n}}var Z_=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Q_=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,$_=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Zd(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new jp({vertexShader:Z_,fragmentShader:Q_,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Ad(new bp(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},ev=class extends Pc{constructor(e,t){super();let n=this,r=null,i=1,a=null,o=`local-floor`,s=1,c=null,l=null,u=null,d=null,f=null,p=null,m=typeof XRWebGLBinding<`u`,h=new $_,g={},_=t.getContextAttributes(),v=null,y=null,b=[],x=[],S=new U,C=null,w=null,T=new gm;T.viewport=new Tl;let E=new gm;E.viewport=new Tl;let D=[T,E],O=new Tm,k=null,A=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=b[e];return t===void 0&&(t=new ou,b[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=b[e];return t===void 0&&(t=new ou,b[e]=t),t.getGripSpace()},this.getHand=function(e){let t=b[e];return t===void 0&&(t=new ou,b[e]=t),t.getHandSpace()};function j(e){let t=x.indexOf(e.inputSource);if(t===-1)return;let n=b[t];n!==void 0&&(n.update(e.inputSource,e.frame,c||a),n.dispatchEvent({type:e.type,data:e.inputSource}))}function M(){r.removeEventListener(`select`,j),r.removeEventListener(`selectstart`,j),r.removeEventListener(`selectend`,j),r.removeEventListener(`squeeze`,j),r.removeEventListener(`squeezestart`,j),r.removeEventListener(`squeezeend`,j),r.removeEventListener(`end`,M),r.removeEventListener(`inputsourceschange`,N);for(let e=0;e<b.length;e++){let t=x[e];t!==null&&(x[e]=null,b[e].disconnect(t))}k=null,A=null,h.reset();for(let e in g)delete g[e];if(e.setRenderTarget(v),f=null,d=null,u=null,r=null,y=null,P.stop(),n.isPresenting=!1,e.setPixelRatio(C),e.setSize(S.width,S.height,!1),w!==null){let e=w.camera;e.fov=w.fov,e.zoom=w.zoom,e.updateProjectionMatrix(),w=null}n.dispatchEvent({type:`sessionend`})}this.setFramebufferScaleFactor=function(e){i=e,n.isPresenting===!0&&B(`WebXRManager: Cannot change framebuffer scale while presenting.`)},this.setReferenceSpaceType=function(e){o=e,n.isPresenting===!0&&B(`WebXRManager: Cannot change reference space type while presenting.`)},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(e){c=e},this.getBaseLayer=function(){return d===null?f:d},this.getBinding=function(){return u===null&&m&&(u=new XRWebGLBinding(r,t)),u},this.getFrame=function(){return p},this.getSession=function(){return r},this.setSession=async function(l){if(r=l,r!==null){if(v=e.getRenderTarget(),r.addEventListener(`select`,j),r.addEventListener(`selectstart`,j),r.addEventListener(`selectend`,j),r.addEventListener(`squeeze`,j),r.addEventListener(`squeezestart`,j),r.addEventListener(`squeezeend`,j),r.addEventListener(`end`,M),r.addEventListener(`inputsourceschange`,N),_.xrCompatible!==!0&&await t.makeXRCompatible(),C=e.getPixelRatio(),e.getSize(S),m&&`createProjectionLayer`in XRWebGLBinding.prototype){let n=null,a=null,o=null;_.depth&&(o=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,n=_.stencil?xs:bs,a=_.stencil?ms:ls);let s={colorFormat:t.RGBA8,depthFormat:o,scaleFactor:i};u=this.getBinding(),d=u.createProjectionLayer(s),r.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new Dl(d.textureWidth,d.textureHeight,{format:ys,type:is,depthTexture:new Yd(d.textureWidth,d.textureHeight,a,void 0,void 0,void 0,void 0,void 0,void 0,n),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}else{let n={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:i};f=new XRWebGLLayer(r,t,n),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new Dl(f.framebufferWidth,f.framebufferHeight,{format:ys,type:is,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(s),c=null,a=await r.requestReferenceSpace(o),P.setContext(r),P.start(),n.isPresenting=!0,n.dispatchEvent({type:`sessionstart`})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return h.getDepthTexture()};function N(e){for(let t=0;t<e.removed.length;t++){let n=e.removed[t],r=x.indexOf(n);r>=0&&(x[r]=null,b[r].disconnect(n))}for(let t=0;t<e.added.length;t++){let n=e.added[t],r=x.indexOf(n);if(r===-1){for(let e=0;e<b.length;e++)if(e>=x.length){x.push(n),r=e;break}else if(x[e]===null){x[e]=n,r=e;break}if(r===-1)break}let i=b[r];i&&i.connect(n)}}let ee=new W,te=new W;function ne(e,t,n){ee.setFromMatrixPosition(t.matrixWorld),te.setFromMatrixPosition(n.matrixWorld);let r=ee.distanceTo(te),i=t.projectionMatrix.elements,a=n.projectionMatrix.elements,o=i[14]/(i[10]-1),s=i[14]/(i[10]+1),c=(i[9]+1)/i[5],l=(i[9]-1)/i[5],u=(i[8]-1)/i[0],d=(a[8]+1)/a[0],f=o*u,p=o*d,m=r/(-u+d),h=m*-u;if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(h),e.translateZ(m),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),i[10]===-1)e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+m,n=s+m,i=f-h,a=p+(r-h),u=c*s/n*t,d=l*s/n*t;e.projectionMatrix.makePerspective(i,a,u,d,t,n),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function re(e,t){t===null?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}this.updateCamera=function(e){if(r===null)return;let t=e.near,n=e.far;h.texture!==null&&(h.depthNear>0&&(t=h.depthNear),h.depthFar>0&&(n=h.depthFar)),O.near=E.near=T.near=t,O.far=E.far=T.far=n,(k!==O.near||A!==O.far)&&(r.updateRenderState({depthNear:O.near,depthFar:O.far}),k=O.near,A=O.far),O.layers.mask=e.layers.mask|6,T.layers.mask=O.layers.mask&-5,E.layers.mask=O.layers.mask&-3;let i=e.parent,a=O.cameras;re(O,i);for(let e=0;e<a.length;e++)re(a[e],i);a.length===2?ne(O,T,E):O.projectionMatrix.copy(T.projectionMatrix),w===null&&e.isPerspectiveCamera&&(w={camera:e,fov:e.fov,zoom:e.zoom}),ie(e,O,i)};function ie(e,t,n){n===null?e.matrix.copy(t.matrixWorld):(e.matrix.copy(n.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=Rc*2*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.getCamera=function(){return O},this.getFoveation=function(){if(d!==null||f!==null)return s},this.setFoveation=function(e){s=e,d!==null&&(d.fixedFoveation=e),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=e)},this.hasDepthSensing=function(){return h.texture!==null},this.getDepthSensingMesh=function(){return h.getMesh(O)},this.getCameraTexture=function(e){return g[e]};let ae=null;function oe(t,i){if(l=i.getViewerPose(c||a),p=i,l!==null){let t=l.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let i=!1;t.length!==O.cameras.length&&(O.cameras.length=0,i=!0);for(let n=0;n<t.length;n++){let r=t[n],a=null;if(f!==null)a=f.getViewport(r);else{let t=u.getViewSubImage(d,r);a=t.viewport,n===0&&(e.setRenderTargetTextures(y,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(y))}let o=D[n];o===void 0&&(o=new gm,o.layers.enable(n),o.viewport=new Tl,D[n]=o),o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.projectionMatrix.fromArray(r.projectionMatrix),o.projectionMatrixInverse.copy(o.projectionMatrix).invert(),o.viewport.set(a.x,a.y,a.width,a.height),n===0&&(O.matrix.copy(o.matrix),O.matrix.decompose(O.position,O.quaternion,O.scale)),i===!0&&O.cameras.push(o)}let a=r.enabledFeatures;if(a&&a.includes(`depth-sensing`)&&r.depthUsage==`gpu-optimized`&&m){u=n.getBinding();let e=u.getDepthInformation(t[0]);e&&e.isValid&&e.texture&&h.init(e,r.renderState)}if(a&&a.includes(`camera-access`)&&m){e.state.unbindTexture(),u=n.getBinding();for(let e=0;e<t.length;e++){let n=t[e].camera;if(n){let e=g[n];e||(e=new Zd,g[n]=e);let t=u.getCameraImage(n);e.sourceTexture=t}}}}for(let e=0;e<b.length;e++){let t=x[e],n=b[e];t!==null&&n!==void 0&&n.update(t,i,c||a)}ae&&ae(t,i),i.detectedPlanes&&n.dispatchEvent({type:`planesdetected`,data:i}),p=null}let P=new Km;P.setAnimationLoop(oe),this.setAnimationLoop=function(e){ae=e},this.dispose=function(){}}},tv=new Al,nv=new G;nv.set(-1,0,0,0,1,0,0,0,1);function rv(e,t){function n(e,t){e.matrixAutoUpdate===!0&&e.updateMatrix(),t.value.copy(e.matrix)}function r(t,n){n.color.getRGB(t.fogColor.value,Dp(e)),n.isFog?(t.fogNear.value=n.near,t.fogFar.value=n.far):n.isFogExp2&&(t.fogDensity.value=n.density)}function i(e,t,n,r,i){t.isNodeMaterial?t.uniformsNeedUpdate=!1:t.isMeshBasicMaterial?a(e,t):t.isMeshLambertMaterial?(a(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(a(e,t),d(e,t)):t.isMeshPhongMaterial?(a(e,t),u(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(a(e,t),f(e,t),t.isMeshPhysicalMaterial&&p(e,t,i)):t.isMeshMatcapMaterial?(a(e,t),m(e,t)):t.isMeshDepthMaterial?a(e,t):t.isMeshDistanceMaterial?(a(e,t),h(e,t)):t.isMeshNormalMaterial?a(e,t):t.isLineBasicMaterial?(o(e,t),t.isLineDashedMaterial&&s(e,t)):t.isPointsMaterial?c(e,t,n,r):t.isSpriteMaterial?l(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}function a(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,n(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,n(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,n(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,r.side===1&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,n(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),r.side===1&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,n(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,n(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,n(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,o=i.envMapRotation;a&&(e.envMap.value=a,e.envMapRotation.value.setFromMatrix4(tv.makeRotationFromEuler(o)).transpose(),a.isCubeTexture&&a.isRenderTargetTexture===!1&&e.envMapRotation.value.premultiply(nv),e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,n(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,n(r.aoMap,e.aoMapTransform))}function o(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform))}function s(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function c(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=i*.5,t.map&&(e.map.value=t.map,n(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function l(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function u(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function d(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function f(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,n(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,n(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function p(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,n(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,n(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,n(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,n(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,n(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),t.side===1&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.retroreflectivity>0&&(e.retroreflectivity.value=t.retroreflectivity),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,n(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,n(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,n(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,n(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,n(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,n(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,n(t.specularIntensityMap,e.specularIntensityMapTransform))}function m(e,t){t.matcap&&(e.matcap.value=t.matcap)}function h(e,n){let r=t.get(n).light;e.referencePosition.value.setFromMatrixPosition(r.matrixWorld),e.nearDistance.value=r.shadow.camera.near,e.farDistance.value=r.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:i}}function iv(e,t,n,r){let i={},a={},o=[],s=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function c(e,t){let n=t.program;r.uniformBlockBinding(e,n)}function l(e,n){let o=i[e.id];o===void 0&&(g(e),o=u(e),i[e.id]=o,e.addEventListener(`dispose`,v));let s=n.program;r.updateUBOMapping(e,s);let c=t.render.frame;a[e.id]!==c&&(f(e),a[e.id]=c)}function u(t){let n=d();t.__bindingPointIndex=n;let r=e.createBuffer(),i=t.__size,a=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,r),e.bufferData(e.UNIFORM_BUFFER,i,a),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,n,r),r}function d(){for(let e=0;e<s;e++)if(o.indexOf(e)===-1)return o.push(e),e;return V(`WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached.`),0}function f(t){let n=i[t.id],r=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,n);for(let e=0,t=r.length;e<t;e++){let t=r[e];if(Array.isArray(t))for(let n=0,r=t.length;n<r;n++)p(t[n],e,n,a);else p(t,e,0,a)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function p(t,n,r,i){if(h(t,n,r,i)===!0){let n=t.__offset,r=t.value;if(Array.isArray(r)){let e=0;for(let n=0;n<r.length;n++){let i=r[n],a=_(i);m(i,t.__data,e),typeof i!=`number`&&typeof i!=`boolean`&&!i.isMatrix3&&!ArrayBuffer.isView(i)&&(e+=a.storage/Float32Array.BYTES_PER_ELEMENT)}}else m(r,t.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,n,t.__data)}}function m(e,t,n){typeof e==`number`||typeof e==`boolean`?t[0]=e:e.isMatrix3?(t[0]=e.elements[0],t[1]=e.elements[1],t[2]=e.elements[2],t[3]=0,t[4]=e.elements[3],t[5]=e.elements[4],t[6]=e.elements[5],t[7]=0,t[8]=e.elements[6],t[9]=e.elements[7],t[10]=e.elements[8],t[11]=0):ArrayBuffer.isView(e)?t.set(new e.constructor(e.buffer,e.byteOffset,t.length)):e.toArray(t,n)}function h(e,t,n,r){let i=e.value,a=t+`_`+n;if(r[a]===void 0)return r[a]=typeof i==`number`||typeof i==`boolean`?i:ArrayBuffer.isView(i)?i.slice():i.clone(),!0;{let e=r[a];if(typeof i==`number`||typeof i==`boolean`){if(e!==i)return r[a]=i,!0}else if(ArrayBuffer.isView(i))return!0;else if(e.equals(i)===!1)return e.copy(i),!0}return!1}function g(e){let t=e.uniforms,n=0;for(let e=0,r=t.length;e<r;e++){let r=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=r.length;e<t;e++){let t=r[e],i=Array.isArray(t.value)?t.value:[t.value];for(let e=0,r=i.length;e<r;e++){let r=i[e],a=_(r),o=n%16,s=o%a.boundary,c=o+s;n+=s,c!==0&&16-c<a.storage&&(n+=16-c),t.__data=new Float32Array(a.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=n,n+=a.storage}}}let r=n%16;return r>0&&(n+=16-r),e.__size=n,e.__cache={},this}function _(e){let t={boundary:0,storage:0};return typeof e==`number`||typeof e==`boolean`?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?B(`WebGLRenderer: Texture samplers can not be part of an uniforms group.`):ArrayBuffer.isView(e)?(t.boundary=16,t.storage=e.byteLength):B(`WebGLRenderer: Unsupported uniform value type.`,e),t}function v(t){let n=t.target;n.removeEventListener(`dispose`,v);let r=o.indexOf(n.__bindingPointIndex);o.splice(r,1),e.deleteBuffer(i[n.id]),delete i[n.id],delete a[n.id]}function y(){for(let t in i)e.deleteBuffer(i[t]);o=[],i={},a={}}return{bind:c,update:l,dispose:y}}var av=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ov=null;function sv(){return ov===null&&(ov=new Nd(av,16,16,ws,ds),ov.name=`DFG_LUT`,ov.minFilter=ts,ov.magFilter=ts,ov.wrapS=Xo,ov.wrapT=Xo,ov.generateMipmaps=!1,ov.needsUpdate=!0),ov}var cv=class{constructor(e={}){let{canvas:t=Dc(),context:n=null,depth:r=!0,stencil:i=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:s=!0,preserveDrawingBuffer:c=!1,powerPreference:l=`default`,failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=is}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<`u`&&n instanceof WebGLRenderingContext)throw Error(`THREE.WebGLRenderer: WebGL 1 is not supported since r163.`);p=n.getContextAttributes().alpha}else p=a;let m=f,h=new Set([Es,Ts,Cs]),g=new Set([is,ls,ss,ms,fs,ps]),_=new Uint32Array(4),v=new Int32Array(4),y=new W,b=null,x=null,S=[],C=[],w=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let T=this,E=!1,D=null,O=null,k=null,A=null;this._outputColorSpace=_c;let j=0,M=0,N=null,ee=-1,te=null,ne=new Tl,re=new Tl,ie=null,ae=new K(0),oe=0,P=t.width,se=t.height,ce=1,le=null,ue=null,de=new Tl(0,0,P,se),fe=new Tl(0,0,P,se),pe=!1,me=new Kd,he=!1,ge=!1,_e=new Al,ve=new W,ye=new Tl,be={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},xe=!1;function Se(){return N===null?ce:1}let F=n;function Ce(e,n){return t.getContext(e,n)}let we,Te,I,Ee,L,R,De,Oe,ke,Ae,je,Me,Ne,Pe,Fe,Ie,Le,Re,ze,Be,Ve,He,Ue;try{let e={alpha:!0,depth:r,stencil:i,antialias:o,premultipliedAlpha:s,preserveDrawingBuffer:c,powerPreference:l,failIfMajorPerformanceCaveat:u};if(`setAttribute`in t&&t.setAttribute(`data-engine`,`three.js r186`),t.addEventListener(`webglcontextlost`,Ge,!1),t.addEventListener(`webglcontextrestored`,Ke,!1),t.addEventListener(`webglcontextcreationerror`,qe,!1),F===null){let t=`webgl2`;if(F=Ce(t,e),F===null)throw Ce(t)?Error(`THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.`):Error(`THREE.WebGLRenderer: Error creating WebGL context.`)}We()}catch(e){throw t.removeEventListener(`webglcontextlost`,Ge,!1),t.removeEventListener(`webglcontextrestored`,Ke,!1),t.removeEventListener(`webglcontextcreationerror`,qe,!1),V(`WebGLRenderer: `+e.message),e}function We(){we=new Eh(F),we.init(),Ve=new X_(F,we),Te=new th(F,we,e,Ve),I=new J_(F,we),Te.reversedDepthBuffer&&d&&I.buffers.depth.setReversed(!0),O=F.createFramebuffer(),k=F.createFramebuffer(),A=F.createFramebuffer(),Ee=new kh(F),L=new O_,R=new Y_(F,we,I,L,Te,Ve,Ee),De=new Th(T),Oe=new qm(F),He=new $m(F,Oe),ke=new Dh(F,Oe,Ee,He),Ae=new jh(F,ke,Oe,He,Ee),Re=new Ah(F,Te,R),Fe=new nh(L),je=new D_(T,De,we,Te,He,Fe),Me=new rv(T,L),Ne=new M_,Pe=new z_(we),Le=new Qm(T,De,I,Ae,p,s),Ie=new q_(T,Ae,Te),Ue=new iv(F,Ee,Te,I),ze=new eh(F,we,Ee),Be=new Oh(F,we,Ee),Ee.programs=je.programs,T.capabilities=Te,T.extensions=we,T.properties=L,T.renderLists=Ne,T.shadowMap=Ie,T.state=I,T.info=Ee}m!==1009&&(w=new Nh(m,t.width,t.height,o,r,i));let z=new ev(T,F);this.xr=z,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){let e=we.get(`WEBGL_lose_context`);e&&e.loseContext()},this.forceContextRestore=function(){let e=we.get(`WEBGL_lose_context`);e&&e.restoreContext()},this.getPixelRatio=function(){return ce},this.setPixelRatio=function(e){e!==void 0&&(ce=e,this.setSize(P,se,!1))},this.getSize=function(e){return e.set(P,se)},this.setSize=function(e,n,r=!0){z.isPresenting?B(`WebGLRenderer: Can't change size while VR device is presenting.`):(P=e,se=n,t.width=Math.floor(e*ce),t.height=Math.floor(n*ce),r===!0&&(t.style.width=e+`px`,t.style.height=n+`px`),w!==null&&w.setSize(t.width,t.height),this.setViewport(0,0,e,n))},this.getDrawingBufferSize=function(e){return e.set(P*ce,se*ce).floor()},this.setDrawingBufferSize=function(e,n,r){P=e,se=n,ce=r,t.width=Math.floor(e*r),t.height=Math.floor(n*r),this.setViewport(0,0,e,n)},this.setEffects=function(e){if(m===1009)V(`WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.`);else{if(e){for(let t=0;t<e.length;t++)if(e[t].isOutputPass===!0){B(`WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.`);break}}w.setEffects(e||[])}},this.getCurrentViewport=function(e){return e.copy(ne)},this.getViewport=function(e){return e.copy(de)},this.setViewport=function(e,t,n,r){e.isVector4?de.set(e.x,e.y,e.z,e.w):de.set(e,t,n,r),I.viewport(ne.copy(de).multiplyScalar(ce).round())},this.getScissor=function(e){return e.copy(fe)},this.setScissor=function(e,t,n,r){e.isVector4?fe.set(e.x,e.y,e.z,e.w):fe.set(e,t,n,r),I.scissor(re.copy(fe).multiplyScalar(ce).round())},this.getScissorTest=function(){return pe},this.setScissorTest=function(e){I.setScissorTest(pe=e)},this.setOpaqueSort=function(e){le=e},this.setTransparentSort=function(e){ue=e},this.getClearColor=function(e){return e.copy(Le.getClearColor())},this.setClearColor=function(){Le.setClearColor(...arguments)},this.getClearAlpha=function(){return Le.getClearAlpha()},this.setClearAlpha=function(){Le.setClearAlpha(...arguments)},this.clear=function(e=!0,t=!0,n=!0){let r=0;if(e){let e=!1;if(N!==null){let t=N.texture.format;e=h.has(t)}if(e){let e=N.texture.type,t=g.has(e),n=Le.getClearColor(),r=Le.getClearAlpha(),i=n.r,a=n.g,o=n.b;t?(_[0]=i,_[1]=a,_[2]=o,_[3]=r,F.clearBufferuiv(F.COLOR,0,_)):(v[0]=i,v[1]=a,v[2]=o,v[3]=r,F.clearBufferiv(F.COLOR,0,v))}else r|=F.COLOR_BUFFER_BIT}t&&(r|=F.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),n&&(r|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),r!==0&&F.clear(r)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(e){e.setRenderer(this),D=e},this.dispose=function(){t.removeEventListener(`webglcontextlost`,Ge,!1),t.removeEventListener(`webglcontextrestored`,Ke,!1),t.removeEventListener(`webglcontextcreationerror`,qe,!1),Le.dispose(),Ne.dispose(),Pe.dispose(),L.dispose(),De.dispose(),Ae.dispose(),He.dispose(),Ue.dispose(),je.dispose(),z.dispose(),z.removeEventListener(`sessionstart`,et),z.removeEventListener(`sessionend`,tt),nt.stop()};function Ge(e){e.preventDefault(),kc(`WebGLRenderer: Context Lost.`),E=!0}function Ke(){kc(`WebGLRenderer: Context Restored.`),E=!1;let e=Ee.autoReset,t=Ie.enabled,n=Ie.autoUpdate,r=Ie.needsUpdate,i=Ie.type;We(),Ee.autoReset=e,Ie.enabled=t,Ie.autoUpdate=n,Ie.needsUpdate=r,Ie.type=i}function qe(e){V(`WebGLRenderer: A WebGL context could not be created. Reason: `,e.statusMessage)}function Je(e){let t=e.target;t.removeEventListener(`dispose`,Je),Ye(t)}function Ye(e){Xe(e),L.remove(e)}function Xe(e){let t=L.get(e).programs;t!==void 0&&(t.forEach(function(e){je.releaseProgram(e)}),e.isShaderMaterial&&je.releaseShaderCache(e))}this.renderBufferDirect=function(e,t,n,r,i,a){t===null&&(t=be);let o=i.isMesh&&i.matrixWorld.determinantAffine()<0,s=ft(e,t,n,r,i);I.setMaterial(r,o);let c=n.index,l=1;if(r.wireframe===!0){if(c=ke.getWireframeAttribute(n),c===void 0)return;l=2}let u=n.drawRange,d=n.attributes.position,f=u.start*l,p=(u.start+u.count)*l;a!==null&&(f=Math.max(f,a.start*l),p=Math.min(p,(a.start+a.count)*l)),c===null?d!=null&&(f=Math.max(f,0),p=Math.min(p,d.count)):(f=Math.max(f,0),p=Math.min(p,c.count));let m=p-f;if(m<0||m===1/0)return;He.setup(i,r,s,n,c);let h,g=ze;if(c!==null&&(h=Oe.get(c),g=Be,g.setIndex(h)),i.isMesh)r.wireframe===!0?(I.setLineWidth(r.wireframeLinewidth*Se()),g.setMode(F.LINES)):g.setMode(F.TRIANGLES);else if(i.isLine){let e=r.linewidth;e===void 0&&(e=1),I.setLineWidth(e*Se()),i.isLineSegments?g.setMode(F.LINES):i.isLineLoop?g.setMode(F.LINE_LOOP):g.setMode(F.LINE_STRIP)}else i.isPoints?g.setMode(F.POINTS):i.isSprite&&g.setMode(F.TRIANGLES);if(i.isBatchedMesh){if(we.get(`WEBGL_multi_draw`))g.renderMultiDraw(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount);else{let e=i._multiDrawStarts,t=i._multiDrawCounts,n=i._multiDrawCount,a=c?Oe.get(c).bytesPerElement:1,o=L.get(r).currentProgram.getUniforms();for(let r=0;r<n;r++)o.setValue(F,`_gl_DrawID`,r),g.render(e[r]/a,t[r])}}else if(i.isInstancedMesh)g.renderInstances(f,m,i.count);else if(n.isInstancedBufferGeometry){let e=n._maxInstanceCount===void 0?1/0:n._maxInstanceCount,t=Math.min(n.instanceCount,e);g.renderInstances(f,m,t)}else g.render(f,m)};function Ze(e,t,n,r){D!==null&&e.isNodeMaterial&&D.setObject(r,e),he===!0&&Fe.setState(e,n,!1),e.transparent===!0&&e.side===2&&e.forceSinglePass===!1?(e.side=1,e.needsUpdate=!0,ct(e,t,r),e.side=0,e.needsUpdate=!0,ct(e,t,r),e.side=2):ct(e,t,r)}this.compile=function(e,t,n=null){n===null&&(n=e),D!==null&&D.renderStart(e,t,n),x=Pe.get(n),x.init(t),C.push(x),n.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),e!==n&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),x.setupLights(),D!==null&&D.updateLights(x.state.lightsArray),ge=this.localClippingEnabled,he=Fe.init(this.clippingPlanes,ge),he===!0&&Fe.setGlobalState(this.clippingPlanes,t),D!==null&&Ie.render(x.state.shadowsArray,n,t);let r=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let i=e.material;if(i){if(Array.isArray(i))for(let a=0;a<i.length;a++){let o=i[a];Ze(o,n,t,e),r.add(o)}else Ze(i,n,t,e),r.add(i)}}),x=C.pop(),D!==null&&D.renderEnd(),r},this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){r.forEach(function(e){let t=L.get(e).currentProgram;(t===void 0||t.isReady())&&r.delete(e)}),r.size===0?t(e):setTimeout(n,10)}we.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})};let Qe=null;function $e(e){Qe&&Qe(e)}function et(){nt.stop()}function tt(){nt.start()}let nt=new Km;nt.setAnimationLoop($e),typeof self<`u`&&nt.setContext(self),this.setAnimationLoop=function(e){Qe=e,z.setAnimationLoop(e),e===null?nt.stop():nt.start()},z.addEventListener(`sessionstart`,et),z.addEventListener(`sessionend`,tt),this.render=function(e,t){if(t!==void 0&&t.isCamera!==!0){V(`WebGLRenderer.render: camera is not an instance of THREE.Camera.`);return}if(E===!0)return;D!==null&&D.renderStart(e,t);let n=z.enabled===!0&&z.isPresenting===!0,r=w!==null&&(N===null||n)&&w.begin(T,N);if(e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),z.enabled===!0&&z.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(z.cameraAutoUpdate===!0&&z.updateCamera(t),t=z.getCamera()),e.isScene===!0&&e.onBeforeRender(T,e,t,N),x=Pe.get(e,C.length),x.init(t),x.state.textureUnits=R.getTextureUnits(),C.push(x),_e.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),me.setFromProjectionMatrix(_e,Cc,t.reversedDepth),ge=this.localClippingEnabled,he=Fe.init(this.clippingPlanes,ge),b=Ne.get(e,S.length),b.init(),S.push(b),z.enabled===!0&&z.isPresenting===!0){let e=T.xr.getDepthSensingMesh();e!==null&&rt(e,t,-1/0,T.sortObjects)}rt(e,t,0,T.sortObjects),b.finish(),D!==null&&D.updateLights(x.state.lightsArray),T.sortObjects===!0&&b.sort(le,ue),xe=z.enabled===!1||z.isPresenting===!1||z.hasDepthSensing()===!1,xe&&Le.addToRenderList(b,e),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),he===!0&&Fe.beginShadows();let i=x.state.shadowsArray;if(Ie.render(i,e,t),he===!0&&Fe.endShadows(),(r&&w.hasRenderPass())===!1){let n=b.opaque,r=b.transmissive;if(x.setupLights(),t.isArrayCamera){let i=t.cameras;if(r.length>0)for(let t=0,a=i.length;t<a;t++){let a=i[t];at(n,r,e,a)}xe&&Le.render(e);for(let t=0,n=i.length;t<n;t++){let n=i[t];it(b,e,n,n.viewport)}}else r.length>0&&at(n,r,e,t),xe&&Le.render(e),it(b,e,t)}N!==null&&M===0&&(R.updateMultisampleRenderTarget(N),R.updateRenderTargetMipmap(N)),r&&w.end(T),e.isScene===!0&&e.onAfterRender(T,e,t),He.resetDefaultState(),ee=-1,te=null,C.pop(),C.length>0?(x=C[C.length-1],R.setTextureUnits(x.state.textureUnits),he===!0&&Fe.setGlobalState(T.clippingPlanes,x.state.camera)):x=null,S.pop(),b=S.length>0?S[S.length-1]:null,D!==null&&D.renderEnd()};function rt(e,t,n,r){if(e.visible===!1)return;if(e.layers.test(t.layers)){if(e.isGroup)n=e.renderOrder;else if(e.isLOD)e.autoUpdate===!0&&e.update(t);else if(e.isLightProbeGrid)x.pushLightProbeGrid(e);else if(e.isLight)x.pushLight(e),e.castShadow&&x.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||e.intersectsFrustum(me)){r&&ye.setFromMatrixPosition(e.matrixWorld).applyMatrix4(_e);let i=Ae.update(e),a=e.material;a.visible&&b.push(e,i,a,n,ye.z,null,t)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||e.intersectsFrustum(me))){let i=Ae.update(e),a=e.material;if(r&&(e.boundingSphere===void 0?(i.boundingSphere===null&&i.computeBoundingSphere(),ye.copy(i.boundingSphere.center)):(e.boundingSphere===null&&e.computeBoundingSphere(),ye.copy(e.boundingSphere.center)),ye.applyMatrix4(e.matrixWorld).applyMatrix4(_e)),Array.isArray(a)){let r=i.groups;for(let o=0,s=r.length;o<s;o++){let s=r[o],c=a[s.materialIndex];c&&c.visible&&b.push(e,i,c,n,ye.z,s,t)}}else a.visible&&b.push(e,i,a,n,ye.z,null,t)}}let i=e.children;for(let e=0,a=i.length;e<a;e++)rt(i[e],t,n,r)}function it(e,t,n,r){let{opaque:i,transmissive:a,transparent:o}=e;x.setupLightsView(n),he===!0&&Fe.setGlobalState(T.clippingPlanes,n),r&&I.viewport(ne.copy(r)),i.length>0&&ot(i,t,n),a.length>0&&ot(a,t,n),o.length>0&&ot(o,t,n),I.buffers.depth.setTest(!0),I.buffers.depth.setMask(!0),I.buffers.color.setMask(!0),I.setPolygonOffset(!1)}function at(e,t,n,r){if((n.isScene===!0?n.overrideMaterial:null)!==null)return;if(x.state.transmissionRenderTarget[r.id]===void 0){let e=we.has(`EXT_color_buffer_half_float`)||we.has(`EXT_color_buffer_float`);x.state.transmissionRenderTarget[r.id]=new Dl(1,1,{generateMipmaps:!0,type:e?ds:is,minFilter:rs,samples:Math.max(4,Te.samples),stencilBuffer:i,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:ml.workingColorSpace})}let a=x.state.transmissionRenderTarget[r.id],o=r.viewport||ne;a.setSize(o.z*T.transmissionResolutionScale,o.w*T.transmissionResolutionScale);let s=T.getRenderTarget(),c=T.getActiveCubeFace(),l=T.getActiveMipmapLevel();T.setRenderTarget(a),T.getClearColor(ae),oe=T.getClearAlpha(),oe<1&&T.setClearColor(16777215,.5),T.clear(),xe&&Le.render(n);let u=T.toneMapping;T.toneMapping=0;let d=r.viewport;if(r.viewport!==void 0&&(r.viewport=void 0),x.setupLightsView(r),he===!0&&Fe.setGlobalState(T.clippingPlanes,r),ot(e,n,r),R.updateMultisampleRenderTarget(a),R.updateRenderTargetMipmap(a),we.has(`WEBGL_multisampled_render_to_texture`)===!1){let e=!1;for(let i=0,a=t.length;i<a;i++){let{object:a,geometry:o,material:s,group:c}=t[i];if(s.side===2&&a.layers.test(r.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,st(a,n,r,o,s,c),s.side=t,s.needsUpdate=!0,e=!0}}e===!0&&(R.updateMultisampleRenderTarget(a),R.updateRenderTargetMipmap(a))}T.setRenderTarget(s,c,l),T.setClearColor(ae,oe),d!==void 0&&(r.viewport=d),T.toneMapping=u}function ot(e,t,n){let r=t.isScene===!0?t.overrideMaterial:null;for(let i=0,a=e.length;i<a;i++){let a=e[i],{object:o,geometry:s,group:c}=a,l=a.material;l.allowOverride===!0&&r!==null&&(l=r),o.layers.test(n.layers)&&st(o,t,n,s,l,c)}}function st(e,t,n,r,i,a){D!==null&&i.isNodeMaterial&&D.setObject(e,i),e.onBeforeRender(T,t,n,r,i,a),e.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),i.onBeforeRender(T,t,n,r,e,a),i.transparent===!0&&i.side===2&&i.forceSinglePass===!1?(i.side=1,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=0,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=2):T.renderBufferDirect(n,t,r,i,e,a),e.onAfterRender(T,t,n,r,i,a)}function ct(e,t,n){t.isScene!==!0&&(t=be);let r=L.get(e),i=x.state.lights,a=x.state.shadowsArray,o=i.state.version,s=je.getParameters(e,i.state,a,t,n,x.state.lightProbeGridArray),c=je.getProgramCacheKey(s),l=r.programs;r.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,r.fog=t.fog;let u=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;r.envMap=De.get(e.envMap||r.environment,u),r.envMapRotation=r.environment!==null&&e.envMap===null?t.environmentRotation:e.envMapRotation,l===void 0&&(e.addEventListener(`dispose`,Je),l=new Map,r.programs=l);let d=l.get(c);if(d!==void 0){if(r.currentProgram===d&&r.lightsStateVersion===o)return ut(e,s),d}else s.uniforms=je.getUniforms(e),D!==null&&e.isNodeMaterial&&D.build(e,n,s),e.onBeforeCompile(s,T),d=je.acquireProgram(s,c),l.set(c,d),r.uniforms=s.uniforms;let f=r.uniforms;return(!e.isShaderMaterial&&!e.isRawShaderMaterial||e.clipping===!0)&&(f.clippingPlanes=Fe.uniform),ut(e,s),r.needsLights=mt(e),r.lightsStateVersion=o,r.needsLights&&(f.ambientLightColor.value=i.state.ambient,f.lightProbe.value=i.state.probe,f.sunLights.value=i.state.sun,f.sunLightShadows.value=i.state.sunShadow,f.directionalLights.value=i.state.directional,f.directionalLightShadows.value=i.state.directionalShadow,f.spotLights.value=i.state.spot,f.spotLightShadows.value=i.state.spotShadow,f.rectAreaLights.value=i.state.rectArea,f.ltc_1.value=i.state.rectAreaLTC1,f.ltc_2.value=i.state.rectAreaLTC2,f.pointLights.value=i.state.point,f.pointLightShadows.value=i.state.pointShadow,f.hemisphereLights.value=i.state.hemi,f.sunShadowMatrix.value=i.state.sunShadowMatrix,f.sunShadowCascade.value=i.state.sunShadowCascade,f.directionalShadowMatrix.value=i.state.directionalShadowMatrix,f.spotLightMatrix.value=i.state.spotLightMatrix,f.spotLightMap.value=i.state.spotLightMap,f.pointShadowMatrix.value=i.state.pointShadowMatrix),r.lightProbeGrid=x.state.lightProbeGridArray.length>0,r.currentProgram=d,r.uniformsList=null,d}function lt(e){if(e.uniformsList===null){let t=e.currentProgram.getUniforms();e.uniformsList=Bg.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function ut(e,t){let n=L.get(e);n.outputColorSpace=t.outputColorSpace,n.batching=t.batching,n.batchingColor=t.batchingColor,n.instancing=t.instancing,n.instancingColor=t.instancingColor,n.instancingMorph=t.instancingMorph,n.skinning=t.skinning,n.morphTargets=t.morphTargets,n.morphNormals=t.morphNormals,n.morphColors=t.morphColors,n.morphTargetsCount=t.morphTargetsCount,n.numClippingPlanes=t.numClippingPlanes,n.numIntersection=t.numClipIntersection,n.vertexAlphas=t.vertexAlphas,n.vertexTangents=t.vertexTangents,n.toneMapping=t.toneMapping}function dt(e,t){if(e.length===0)return null;if(e.length===1)return e[0].texture===null?null:e[0];y.setFromMatrixPosition(t.matrixWorld);for(let t=0,n=e.length;t<n;t++){let n=e[t];if(n.texture!==null&&n.boundingBox.containsPoint(y))return n}return null}function ft(e,t,n,r,i){t.isScene!==!0&&(t=be),R.resetTextureUnits();let a=t.fog,o=r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial?t.environment:null,s=N===null?T.outputColorSpace:N.isXRRenderTarget===!0?N.texture.colorSpace:ml.workingColorSpace,c=r.isMeshStandardMaterial||r.isMeshLambertMaterial&&!r.envMap||r.isMeshPhongMaterial&&!r.envMap,l=De.get(r.envMap||o,c),u=r.vertexColors===!0&&!!n.attributes.color&&n.attributes.color.itemSize===4,d=!!n.attributes.tangent&&(!!r.normalMap||r.anisotropy>0),f=!!n.morphAttributes.position,p=!!n.morphAttributes.normal,m=!!n.morphAttributes.color,h=0;r.toneMapped&&(N===null||N.isXRRenderTarget===!0)&&(h=T.toneMapping);let g=n.morphAttributes.position||n.morphAttributes.normal||n.morphAttributes.color,_=g===void 0?0:g.length,v=L.get(r),y=x.state.lights;if(he===!0&&(ge===!0||e!==te)){let t=e===te&&r.id===ee;Fe.setState(r,e,t)}let b=!1;r.version===v.__version?v.needsLights&&v.lightsStateVersion!==y.state.version?b=!0:v.outputColorSpace===s?i.isBatchedMesh&&v.batching===!1||!i.isBatchedMesh&&v.batching===!0||i.isBatchedMesh&&v.batchingColor===!0&&i._colorsTexture===null||i.isBatchedMesh&&v.batchingColor===!1&&i._colorsTexture!==null||i.isInstancedMesh&&v.instancing===!1||!i.isInstancedMesh&&v.instancing===!0||i.isSkinnedMesh&&v.skinning===!1||!i.isSkinnedMesh&&v.skinning===!0||i.isInstancedMesh&&v.instancingColor===!0&&i.instanceColor===null||i.isInstancedMesh&&v.instancingColor===!1&&i.instanceColor!==null||i.isInstancedMesh&&v.instancingMorph===!0&&i.morphTexture===null||i.isInstancedMesh&&v.instancingMorph===!1&&i.morphTexture!==null?b=!0:v.envMap===l?r.fog===!0&&v.fog!==a||v.numClippingPlanes!==void 0&&(v.numClippingPlanes!==Fe.numPlanes||v.numIntersection!==Fe.numIntersection)?b=!0:v.vertexAlphas===u&&v.vertexTangents===d&&v.morphTargets===f&&v.morphNormals===p&&v.morphColors===m&&v.toneMapping===h&&v.morphTargetsCount===_?!!v.lightProbeGrid!=x.state.lightProbeGridArray.length>0&&(b=!0):b=!0:b=!0:b=!0:(b=!0,v.__version=r.version);let S=v.currentProgram;b===!0&&(S=ct(r,t,i),D&&r.isNodeMaterial&&D.onUpdateProgram(r,S,v));let C=!1,w=!1,E=!1,O=S.getUniforms(),k=v.uniforms;if(I.useProgram(S.program)&&(C=!0,w=!0,E=!0),r.id!==ee&&(ee=r.id,w=!0),v.needsLights){let e=dt(x.state.lightProbeGridArray,i);v.lightProbeGrid!==e&&(v.lightProbeGrid=e,w=!0)}if(C||te!==e){I.buffers.depth.getReversed()&&e.reversedDepth!==!0&&(e._reversedDepth=!0,e.updateProjectionMatrix()),O.setValue(F,`projectionMatrix`,e.projectionMatrix),O.setValue(F,`viewMatrix`,e.matrixWorldInverse);let t=O.map.cameraPosition;t!==void 0&&t.setValue(F,ve.setFromMatrixPosition(e.matrixWorld)),Te.logarithmicDepthBuffer&&O.setValue(F,`logDepthBufFC`,2/(Math.log(e.far+1)/Math.LN2)),(r.isMeshPhongMaterial||r.isMeshToonMaterial||r.isMeshLambertMaterial||r.isMeshBasicMaterial||r.isMeshStandardMaterial||r.isShaderMaterial)&&O.setValue(F,`isOrthographic`,e.isOrthographicCamera===!0),te!==e&&(te=e,w=!0,E=!0)}if(v.needsLights&&(y.state.sunShadowMap.length>0&&O.setValue(F,`sunShadowMap`,y.state.sunShadowMap,R),y.state.directionalShadowMap.length>0&&O.setValue(F,`directionalShadowMap`,y.state.directionalShadowMap,R),y.state.spotShadowMap.length>0&&O.setValue(F,`spotShadowMap`,y.state.spotShadowMap,R),y.state.pointShadowMap.length>0&&O.setValue(F,`pointShadowMap`,y.state.pointShadowMap,R)),i.isSkinnedMesh){O.setOptional(F,i,`bindMatrix`),O.setOptional(F,i,`bindMatrixInverse`);let e=i.skeleton;e&&(e.boneTexture===null&&e.computeBoneTexture(),O.setValue(F,`boneTexture`,e.boneTexture,R))}i.isBatchedMesh&&(O.setOptional(F,i,`batchingTexture`),O.setValue(F,`batchingTexture`,i._matricesTexture,R),O.setOptional(F,i,`batchingIdTexture`),O.setValue(F,`batchingIdTexture`,i._indirectTexture,R),O.setOptional(F,i,`batchingColorTexture`),i._colorsTexture!==null&&O.setValue(F,`batchingColorTexture`,i._colorsTexture,R));let A=n.morphAttributes;if((A.position!==void 0||A.normal!==void 0||A.color!==void 0)&&Re.update(i,n,S),(w||v.receiveShadow!==i.receiveShadow)&&(v.receiveShadow=i.receiveShadow,O.setValue(F,`receiveShadow`,i.receiveShadow)),(r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial)&&r.envMap===null&&t.environment!==null&&(k.envMapIntensity.value=t.environmentIntensity),k.dfgLUT!==void 0&&(k.dfgLUT.value=sv()),w){if(O.setValue(F,`toneMappingExposure`,T.toneMappingExposure),v.needsLights&&pt(k,E),a&&r.fog===!0&&Me.refreshFogUniforms(k,a),Me.refreshMaterialUniforms(k,r,ce,se,x.state.transmissionRenderTarget[e.id]),v.needsLights&&v.lightProbeGrid){let e=v.lightProbeGrid;k.probesSH.value=e.texture,k.probesMin.value.copy(e.boundingBox.min),k.probesMax.value.copy(e.boundingBox.max),k.probesResolution.value.copy(e.resolution)}Bg.upload(F,lt(v),k,R)}if(r.isShaderMaterial&&r.uniformsNeedUpdate===!0&&(Bg.upload(F,lt(v),k,R),r.uniformsNeedUpdate=!1),r.isSpriteMaterial&&O.setValue(F,`center`,i.center),O.setValue(F,`modelViewMatrix`,i.modelViewMatrix),O.setValue(F,`normalMatrix`,i.normalMatrix),O.setValue(F,`modelMatrix`,i.matrixWorld),r.uniformsGroups!==void 0){let e=r.uniformsGroups;for(let t=0,n=e.length;t<n;t++){let n=e[t];Ue.update(n,S),Ue.bind(n,S)}}return S}function pt(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.sunLights.needsUpdate=t,e.sunLightShadows.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function mt(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&e.lights===!0}this.getActiveCubeFace=function(){return j},this.getActiveMipmapLevel=function(){return M},this.getRenderTarget=function(){return N},this.setRenderTargetTextures=function(e,t,n){let r=L.get(e);r.__autoAllocateDepthBuffer=e.resolveDepthBuffer===!1,r.__autoAllocateDepthBuffer===!1&&(r.__useRenderToTexture=!1),L.get(e.texture).__webglTexture=t,L.get(e.depthTexture).__webglTexture=r.__autoAllocateDepthBuffer?void 0:n,r.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let n=L.get(e);n.__webglFramebuffer=t,n.__useDefaultFramebuffer=t===void 0},this.setRenderTarget=function(e,t=0,n=0){N=e,j=t,M=n;let r=null,i=!1,a=!1;if(e){let o=L.get(e);if(o.__useDefaultFramebuffer!==void 0){I.bindFramebuffer(F.FRAMEBUFFER,o.__webglFramebuffer),ne.copy(e.viewport),re.copy(e.scissor),ie=e.scissorTest,I.viewport(ne),I.scissor(re),I.setScissorTest(ie),ee=-1;return}if(o.__webglFramebuffer===void 0)R.setupRenderTarget(e);else if(o.__hasExternalTextures)R.rebindTextures(e,L.get(e.texture).__webglTexture,L.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(o.__boundDepthTexture!==t){if(t!==null&&L.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error(`THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.`);R.setupDepthRenderbuffer(e)}}let s=e.texture;(s.isData3DTexture||s.isDataArrayTexture||s.isCompressedArrayTexture)&&(a=!0);let c=L.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(r=Array.isArray(c[t])?c[t][n]:c[t],i=!0):r=e.samples>0&&R.useMultisampledRTT(e)===!1?L.get(e).__webglMultisampledFramebuffer:Array.isArray(c)?c[n]:c,ne.copy(e.viewport),re.copy(e.scissor),ie=e.scissorTest}else ne.copy(de).multiplyScalar(ce).floor(),re.copy(fe).multiplyScalar(ce).floor(),ie=pe;if(n!==0&&(r=O),I.bindFramebuffer(F.FRAMEBUFFER,r)&&I.drawBuffers(e,r),I.viewport(ne),I.scissor(re),I.setScissorTest(ie),i){let r=L.get(e.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+t,r.__webglTexture,n)}else if(a){let r=t;for(let t=0;t<e.textures.length;t++){let i=L.get(e.textures[t]);F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0+t,i.__webglTexture,n,r)}}else if(e!==null&&n!==0){let t=L.get(e.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,t.__webglTexture,n)}ee=-1};function ht(e){let t=L.get(e);return(t.__readFormat!==e.format||t.__readType!==e.type)&&(t.__readFormat=e.format,t.__readType=e.type,t.__formatReadable=Te.textureFormatReadable(e.format),t.__typeReadable=Te.textureTypeReadable(e.type)),t}this.readRenderTargetPixels=function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget)){V(`WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);return}let c=L.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){I.bindFramebuffer(F.FRAMEBUFFER,c);try{let o=e.textures[s],c=o.format,l=o.type;e.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+s);let u=ht(o);if(u.__formatReadable===!1){V(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.`);return}if(u.__typeReadable===!1){V(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.`);return}t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i&&F.readPixels(t,n,r,i,Ve.convert(c),Ve.convert(l),a)}finally{let e=N===null?null:L.get(N).__webglFramebuffer;I.bindFramebuffer(F.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget))throw Error(`THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);let c=L.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){if(t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i){I.bindFramebuffer(F.FRAMEBUFFER,c);let o=e.textures[s],l=o.format,u=o.type;e.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+s);let d=ht(o);if(d.__formatReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.`);if(d.__typeReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.`);let f=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,f),F.bufferData(F.PIXEL_PACK_BUFFER,a.byteLength,F.STREAM_READ),F.readPixels(t,n,r,i,Ve.convert(l),Ve.convert(u),0),F.bindBuffer(F.PIXEL_PACK_BUFFER,null);let p=N===null?null:L.get(N).__webglFramebuffer;I.bindFramebuffer(F.FRAMEBUFFER,p);let m=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await Mc(F,m,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,f),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,a),F.bindBuffer(F.PIXEL_PACK_BUFFER,null),F.deleteBuffer(f),F.deleteSync(m),a}throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.`)}},this.copyFramebufferToTexture=function(e,t=null,n=0){let r=2**-n,i=Math.floor(e.image.width*r),a=Math.floor(e.image.height*r),o=t===null?0:t.x,s=t===null?0:t.y;R.setTexture2D(e,0),F.copyTexSubImage2D(F.TEXTURE_2D,n,0,0,o,s,i,a),I.unbindTexture()},this.copyTextureToTexture=function(e,t,n=null,r=null,i=0,a=0){let o,s,c,l,u,d,f,p,m,h=e.isCompressedTexture?e.mipmaps[a]:e.image;if(n!==null)o=n.max.x-n.min.x,s=n.max.y-n.min.y,c=n.isBox3?n.max.z-n.min.z:1,l=n.min.x,u=n.min.y,d=n.isBox3?n.min.z:0;else{let t=2**-i;o=Math.floor(h.width*t),s=Math.floor(h.height*t),c=e.isDataArrayTexture?h.depth:e.isData3DTexture?Math.floor(h.depth*t):1,l=0,u=0,d=0}r===null?(f=0,p=0,m=0):(f=r.x,p=r.y,m=r.z);let g=Ve.convert(t.format),_=Ve.convert(t.type),v;t.isData3DTexture?(R.setTexture3D(t,0),v=F.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(R.setTexture2DArray(t,0),v=F.TEXTURE_2D_ARRAY):(R.setTexture2D(t,0),v=F.TEXTURE_2D),I.activeTexture(F.TEXTURE0),I.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,t.flipY),I.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),I.pixelStorei(F.UNPACK_ALIGNMENT,t.unpackAlignment);let y=I.getParameter(F.UNPACK_ROW_LENGTH),b=I.getParameter(F.UNPACK_IMAGE_HEIGHT),x=I.getParameter(F.UNPACK_SKIP_PIXELS),S=I.getParameter(F.UNPACK_SKIP_ROWS),C=I.getParameter(F.UNPACK_SKIP_IMAGES);I.pixelStorei(F.UNPACK_ROW_LENGTH,h.width),I.pixelStorei(F.UNPACK_IMAGE_HEIGHT,h.height),I.pixelStorei(F.UNPACK_SKIP_PIXELS,l),I.pixelStorei(F.UNPACK_SKIP_ROWS,u),I.pixelStorei(F.UNPACK_SKIP_IMAGES,d);let w=e.isDataArrayTexture||e.isData3DTexture,T=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let n=L.get(e),r=L.get(t),h=L.get(n.__renderTarget),g=L.get(r.__renderTarget);I.bindFramebuffer(F.READ_FRAMEBUFFER,h.__webglFramebuffer),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<c;n++)w&&(F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,L.get(e).__webglTexture,i,d+n),F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,L.get(t).__webglTexture,a,m+n)),F.blitFramebuffer(l,u,o,s,f,p,o,s,F.DEPTH_BUFFER_BIT,F.NEAREST);I.bindFramebuffer(F.READ_FRAMEBUFFER,null),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else if(i!==0||e.isRenderTargetTexture||L.has(e)){let n=L.get(e),r=L.get(t);I.bindFramebuffer(F.READ_FRAMEBUFFER,k),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,A);for(let e=0;e<c;e++)w?F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,n.__webglTexture,i,d+e):F.framebufferTexture2D(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,n.__webglTexture,i),T?F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,r.__webglTexture,a,m+e):F.framebufferTexture2D(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,r.__webglTexture,a),i===0?T?F.copyTexSubImage3D(v,a,f,p,m+e,l,u,o,s):F.copyTexSubImage2D(v,a,f,p,l,u,o,s):F.blitFramebuffer(l,u,o,s,f,p,o,s,F.COLOR_BUFFER_BIT,F.NEAREST);I.bindFramebuffer(F.READ_FRAMEBUFFER,null),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else T?e.isDataTexture||e.isData3DTexture?F.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h.data):t.isCompressedArrayTexture?F.compressedTexSubImage3D(v,a,f,p,m,o,s,c,g,h.data):F.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h):e.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,a,f,p,o,s,g,_,h.data):e.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,a,f,p,h.width,h.height,g,h.data):F.texSubImage2D(F.TEXTURE_2D,a,f,p,o,s,g,_,h);I.pixelStorei(F.UNPACK_ROW_LENGTH,y),I.pixelStorei(F.UNPACK_IMAGE_HEIGHT,b),I.pixelStorei(F.UNPACK_SKIP_PIXELS,x),I.pixelStorei(F.UNPACK_SKIP_ROWS,S),I.pixelStorei(F.UNPACK_SKIP_IMAGES,C),a===0&&t.generateMipmaps&&F.generateMipmap(v),I.unbindTexture()},this.initRenderTarget=function(e){L.get(e).__webglFramebuffer===void 0&&R.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?R.setTextureCube(e,0):e.isData3DTexture?R.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?R.setTexture2DArray(e,0):R.setTexture2D(e,0),I.unbindTexture()},this.resetState=function(){j=0,M=0,N=null,I.reset(),He.reset()},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}get coordinateSystem(){return Cc}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=ml._getDrawingBufferColorSpace(e),t.unpackColorSpace=ml._getUnpackColorSpace()}},lv={type:`change`},uv={type:`start`},dv={type:`end`},fv=new _d,pv=new ud,mv=Math.cos(70*ol.DEG2RAD),hv=new W,gv=2*Math.PI,_v={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},vv=1e-6,yv=class extends Um{constructor(e,t=null){super(e,t),this.state=_v.NONE,this.target=new W,this.cursor=new W,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`},this.mouseButtons={LEFT:qo.ROTATE,MIDDLE:qo.DOLLY,RIGHT:qo.PAN},this.touches={ONE:Jo.ROTATE,TWO:Jo.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle=`auto`,this._domElementKeyEvents=null,this._lastPosition=new W,this._lastQuaternion=new sl,this._lastTargetPosition=new W,this._quat=new sl().setFromUnitVectors(e.up,new W(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Hm,this._sphericalDelta=new Hm,this._scale=1,this._panOffset=new W,this._rotateStart=new U,this._rotateEnd=new U,this._rotateDelta=new U,this._panStart=new U,this._panEnd=new U,this._panDelta=new U,this._dollyStart=new U,this._dollyEnd=new U,this._dollyDelta=new U,this._dollyDirection=new W,this._mouse=new U,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=xv.bind(this),this._onPointerDown=bv.bind(this),this._onPointerUp=Sv.bind(this),this._onContextMenu=kv.bind(this),this._onMouseWheel=Tv.bind(this),this._onKeyDown=Ev.bind(this),this._onTouchStart=Dv.bind(this),this._onTouchMove=Ov.bind(this),this._onMouseDown=Cv.bind(this),this._onMouseMove=wv.bind(this),this._interceptControlDown=Av.bind(this),this._interceptControlUp=jv.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(e){this._cursorStyle=e,e===`grab`?this.domElement.style.cursor=`grab`:this.domElement.style.cursor=`auto`}get cursorStyle(){return this._cursorStyle}connect(e){super.connect(e),this.domElement.addEventListener(`pointerdown`,this._onPointerDown),this.domElement.addEventListener(`pointercancel`,this._onPointerUp),this.domElement.addEventListener(`contextmenu`,this._onContextMenu),this.domElement.addEventListener(`wheel`,this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener(`keydown`,this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction=`none`}disconnect(){this.state=_v.NONE,this.domElement.removeEventListener(`pointerdown`,this._onPointerDown),this.domElement.ownerDocument.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.removeEventListener(`pointerup`,this._onPointerUp),this.domElement.removeEventListener(`pointercancel`,this._onPointerUp),this.domElement.removeEventListener(`wheel`,this._onMouseWheel),this.domElement.removeEventListener(`contextmenu`,this._onContextMenu),this.stopListenToKeyEvents();let e=this.domElement.getRootNode();e.removeEventListener(`keydown`,this._interceptControlDown,{capture:!0}),e.removeEventListener(`keyup`,this._interceptControlUp,{capture:!0}),this._controlActive=!1,this._pointers.length=0,this._pointerPositions={},this.domElement.style.touchAction=``,this.domElement.style.cursor=`auto`}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(lv),this.update(),this.state=_v.NONE}pan(e,t){this._pan(e,t),this.update()}dollyIn(e){this._dollyIn(e),this.update()}dollyOut(e){this._dollyOut(e),this.update()}rotateLeft(e){this._rotateLeft(e),this.update()}rotateUp(e){this._rotateUp(e),this.update()}update(e=null){let t=this.object.position;hv.copy(t).sub(this.target),hv.applyQuaternion(this._quat),this._spherical.setFromVector3(hv),this.autoRotate&&this.state===_v.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,r=this.maxAzimuthAngle;isFinite(n)&&isFinite(r)&&(n<-Math.PI?n+=gv:n>Math.PI&&(n-=gv),r<-Math.PI?r+=gv:r>Math.PI&&(r-=gv),n<=r?this._spherical.theta=Math.max(n,Math.min(r,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+r)/2?Math.max(n,this._spherical.theta):Math.min(r,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let i=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let e=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),i=e!=this._spherical.radius}if(hv.setFromSpherical(this._spherical),hv.applyQuaternion(this._quatInverse),t.copy(this.target).add(hv),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let e=null;if(this.object.isPerspectiveCamera){let t=hv.length();e=this._clampDistance(t*this._scale);let n=t-e;this.object.position.addScaledVector(this._dollyDirection,n),this.object.updateMatrixWorld(),i=!!n}else if(this.object.isOrthographicCamera){let t=new W(this._mouse.x,this._mouse.y,0);t.unproject(this.object);let n=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),i=n!==this.object.zoom;let r=new W(this._mouse.x,this._mouse.y,0);r.unproject(this.object),this.object.position.sub(r).add(t),this.object.updateMatrixWorld(),e=hv.length()}else console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.`),this.zoomToCursor=!1;e!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(e).add(this.object.position):(fv.origin.copy(this.object.position),fv.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(fv.direction))<mv?this.object.lookAt(this.target):(pv.setFromNormalAndCoplanarPoint(this.object.up,this.target),fv.intersectPlane(pv,this.target))))}else if(this.object.isOrthographicCamera){let e=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),e!==this.object.zoom&&(this.object.updateProjectionMatrix(),i=!0)}return this._scale=1,this._performCursorZoom=!1,i||this._lastPosition.distanceToSquared(this.object.position)>vv||8*(1-this._lastQuaternion.dot(this.object.quaternion))>vv||this._lastTargetPosition.distanceToSquared(this.target)>vv?(this.dispatchEvent(lv),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e===null?gv/60/60*this.autoRotateSpeed:gv/60*this.autoRotateSpeed*e}_getZoomScale(e){let t=Math.abs(e*.01);return .95**(this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){hv.setFromMatrixColumn(t,0),hv.multiplyScalar(-e),this._panOffset.add(hv)}_panUp(e,t){this.screenSpacePanning===!0?hv.setFromMatrixColumn(t,1):(hv.setFromMatrixColumn(t,0),hv.crossVectors(this.object.up,hv)),hv.multiplyScalar(e),this._panOffset.add(hv)}_pan(e,t){let n=this.domElement;if(this.object.isPerspectiveCamera){let r=this.object.position;hv.copy(r).sub(this.target);let i=hv.length();i*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*i/n.clientHeight,this.object.matrix),this._panUp(2*t*i/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let n=this.domElement.getBoundingClientRect(),r=e-n.left,i=t-n.top,a=n.width,o=n.height;this._mouse.x=r/a*2-1,this._mouse.y=-(i/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(gv*this._rotateDelta.x/t.clientHeight),this._rotateUp(gv*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(gv*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(-gv*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(gv*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(-gv*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),t=!0}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateStart.set(n,r)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panStart.set(n,r)}}_handleTouchStartDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyStart.set(0,i)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateEnd.set(n,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(gv*this._rotateDelta.x/t.clientHeight),this._rotateUp(gv*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panEnd.set(n,r)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyEnd.set(0,i),this._dollyDelta.set(0,(this._dollyEnd.y/this._dollyStart.y)**+this.zoomSpeed),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let a=(e.pageX+t.x)*.5,o=(e.pageY+t.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new U,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){let t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){let t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}};function bv(e){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(e.pointerId),this.domElement.ownerDocument.addEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.addEventListener(`pointerup`,this._onPointerUp)),!this._isTrackingPointer(e)&&(this._addPointer(e),e.pointerType===`touch`?this._onTouchStart(e):this._onMouseDown(e),this._cursorStyle===`grab`&&(this.domElement.style.cursor=`grabbing`)))}function xv(e){this.enabled!==!1&&(e.pointerType===`touch`?this._onTouchMove(e):this._onMouseMove(e))}function Sv(e){switch(this._removePointer(e),this._pointers.length){case 0:this.domElement.releasePointerCapture(e.pointerId),this.domElement.ownerDocument.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.removeEventListener(`pointerup`,this._onPointerUp),this.dispatchEvent(dv),this.state=_v.NONE,this._cursorStyle===`grab`&&(this.domElement.style.cursor=`grab`);break;case 1:let t=this._pointers[0],n=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:n.x,pageY:n.y})}}function Cv(e){let t;switch(e.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case qo.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(e),this.state=_v.DOLLY;break;case qo.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=_v.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=_v.ROTATE}break;case qo.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=_v.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=_v.PAN}break;default:this.state=_v.NONE}this.state!==_v.NONE&&this.dispatchEvent(uv)}function wv(e){switch(this.state){case _v.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(e);break;case _v.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(e);break;case _v.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(e)}}function Tv(e){this.enabled!==!1&&this.enableZoom!==!1&&this.state===_v.NONE&&(e.preventDefault(),this.dispatchEvent(uv),this._handleMouseWheel(this._customWheelEvent(e)),this.dispatchEvent(dv))}function Ev(e){this.enabled!==!1&&this._handleKeyDown(e)}function Dv(e){switch(this._trackPointer(e),this._pointers.length){case 1:switch(this.touches.ONE){case Jo.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(e),this.state=_v.TOUCH_ROTATE;break;case Jo.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(e),this.state=_v.TOUCH_PAN;break;default:this.state=_v.NONE}break;case 2:switch(this.touches.TWO){case Jo.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(e),this.state=_v.TOUCH_DOLLY_PAN;break;case Jo.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(e),this.state=_v.TOUCH_DOLLY_ROTATE;break;default:this.state=_v.NONE}break;default:this.state=_v.NONE}this.state!==_v.NONE&&this.dispatchEvent(uv)}function Ov(e){switch(this._trackPointer(e),this.state){case _v.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(e),this.update();break;case _v.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(e),this.update();break;case _v.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(e),this.update();break;case _v.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(e),this.update();break;default:this.state=_v.NONE}}function kv(e){this.enabled!==!1&&e.preventDefault()}function Av(e){e.key===`Control`&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}function jv(e){e.key===`Control`&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}var Mv=class extends fu{constructor(){super(),this.name=`RoomEnvironment`,this.position.y=-3.5;let e=new Qd;e.deleteAttribute(`uv`);let t=new Np({side:1}),n=new Np,r=new vm(16777215,900,28,2);r.position.set(.418,16.199,.3),this.add(r);let i=new Ad(e,t);i.position.set(-.757,13.219,.717),i.scale.set(31.713,28.305,28.591),this.add(i);let a=new Hd(e,n,6),o=new ru;o.position.set(-10.906,2.009,1.846),o.rotation.set(0,-.195,0),o.scale.set(2.328,7.905,4.651),o.updateMatrix(),a.setMatrixAt(0,o.matrix),o.position.set(-5.607,-.754,-.758),o.rotation.set(0,.994,0),o.scale.set(1.97,1.534,3.955),o.updateMatrix(),a.setMatrixAt(1,o.matrix),o.position.set(6.167,.857,7.803),o.rotation.set(0,.561,0),o.scale.set(3.927,6.285,3.687),o.updateMatrix(),a.setMatrixAt(2,o.matrix),o.position.set(-2.017,.018,6.124),o.rotation.set(0,.333,0),o.scale.set(2.002,4.566,2.064),o.updateMatrix(),a.setMatrixAt(3,o.matrix),o.position.set(2.291,-.756,-2.621),o.rotation.set(0,-.286,0),o.scale.set(1.546,1.552,1.496),o.updateMatrix(),a.setMatrixAt(4,o.matrix),o.position.set(-2.193,-.369,-5.547),o.rotation.set(0,.516,0),o.scale.set(3.875,3.487,2.986),o.updateMatrix(),a.setMatrixAt(5,o.matrix),this.add(a);let s=new Ad(e,Nv(50));s.position.set(-16.116,14.37,8.208),s.scale.set(.1,2.428,2.739),this.add(s);let c=new Ad(e,Nv(50));c.position.set(-16.109,18.021,-8.207),c.scale.set(.1,2.425,2.751),this.add(c);let l=new Ad(e,Nv(17));l.position.set(14.904,12.198,-1.832),l.scale.set(.15,4.265,6.331),this.add(l);let u=new Ad(e,Nv(43));u.position.set(-.462,8.89,14.52),u.scale.set(4.38,5.441,.088),this.add(u);let d=new Ad(e,Nv(20));d.position.set(3.235,11.486,-12.541),d.scale.set(2.5,2,.1),this.add(d);let f=new Ad(e,Nv(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){let e=new Set;this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))});for(let t of e)t.dispose()}};function Nv(e){return new Fp({color:0,emissive:16777215,emissiveIntensity:e})}var Pv=6.67,Fv=.16,Iv=.19,Lv=1381653,Rv=15025435,zv=12155660,Bv={black:`#1a1a1a`,brown:`#6b3a1e`,red:`#c62a1d`,orange:`#e8761c`,yellow:`#f0c419`,green:`#2f8a3c`,blue:`#2456b8`,violet:`#7d3fa0`,purple:`#7d3fa0`,grey:`#8a8a8a`,gray:`#8a8a8a`,white:`#f2f2f2`,gold:`#c9a03a`,silver:`#c0c0c0`},Vv={t0:performance.now(),now(){return(performance.now()-this.t0)/1e3}},Hv={};function Y(e,t=.55){let n=`p${e}${t}`;return Hv[n]||=new Np({color:e,roughness:t,metalness:0})}function Uv(e=13619926,t=.28){let n=`m${e}${t}`;return Hv[n]||=new Np({color:e,roughness:t,metalness:1})}function X(e,t,n=0,r=0,i=0){let a=new Ad(e,t);return a.position.set(n,r,i),a.castShadow=!0,a.receiveShadow=!0,a}function Wv(e,t,n,r,i=0,a=.022){let o=Math.abs(r-i);e.add(X(new tf(a,a,o,8),Uv(12567496),t,(r+i)/2,n))}function Gv(e,t,n,{bg:r=`#141414`,fg:i=`#d9d9d9`,size:a=.42}={}){let o=document.createElement(`canvas`);o.width=512,o.height=Math.max(64,Math.round(512*n/t));let s=o.getContext(`2d`);s.fillStyle=r,s.fillRect(0,0,o.width,o.height),s.fillStyle=i,s.font=`600 ${Math.round(o.height*a)}px "JetBrains Mono", Consolas, monospace`,s.textAlign=`center`,s.textBaseline=`middle`,s.fillText(e,o.width/2,o.height/2);let c=new Jd(o);return c.colorSpace=_c,c.anisotropy=4,c}function Kv(e){let t=new iu,n=(e.marking||``).toLowerCase(),r=/mega|pic16|pic18|328|28/.test(n)?28:/74|4\d\d\d|324|339|uln|l293/.test(n)?16:8,i=r/2*.26+.12,a=.66;t.add(X(new Qd(i,.3,a),Y(1842206,.7),0,.22999999999999998,0));let o=new Ad(new bp(i*.92,a*.7),new Np({map:Gv(e.marking||`IC`,i,a*.7,{bg:`#1c1c1e`,fg:`#cfcfd2`}),roughness:.75}));o.rotation.x=-Math.PI/2,o.position.y=.382,t.add(o);let s=new Ad(new ef(.08,20,-Math.PI/2,Math.PI),Y(723724,.9));s.rotation.x=-Math.PI/2,s.position.set(-i/2+.001,.383,0),t.add(s);for(let e=0;e<r/2;e++){let n=-i/2+.13+e*.26;for(let e of[-1,1])t.add(X(new Qd(.07,.03,.12),Uv(),n,.22000000000000003,e*.38)),t.add(X(new Qd(.05,.2,.025),Uv(),n,.1,e*.43000000000000005))}return{g:t,w:i+.25,d:1.06,h:.38}}function qv(e,{body:t=14206108,r:n=.12,len:r=.5,bands:i=[]}={}){let a=new iu,o=n+.1,s=new $d(n,r,8,20);s.rotateZ(Math.PI/2),a.add(X(s,Y(t,.6),0,o,0));let c=i.length>=5?[-.25,-.15,-.05,.05,.23]:i.length===3?[-.2,-.09,.02]:[-.22,-.11,0,.21];i.slice(0,6).forEach((e,t)=>{let r=new tf(n+.008,n+.008,.05,24);r.rotateZ(Math.PI/2);let i=Bv[String(e).toLowerCase()]||`#777`,s=/gold|silver/.test(e)?Uv(new K(i).getHex(),.35):Y(new K(i).getHex(),.5);a.add(X(r,s,c[t]??0,o,0))});let l=r/2+n,u=l+.2;for(let e of[-1,1]){let t=new tf(.022,.022,u-l+.05,8);t.rotateZ(Math.PI/2),a.add(X(t,Uv(12567496),e*(l+u)/2,o,0)),Wv(a,e*u,0,o,0)}return{g:a,w:u*2+.2,d:n*2+.3,h:o+n}}function Jv(e){let t=new iu,n=.38,r=.95;t.add(X(new tf(n,n,r,40),Y(2306639,.42),0,.5349999999999999,0));let i=new tf(.384,.384,r*.96,40,1,!0,.3,.9);t.add(X(i,Y(12107462,.45),0,.5349999999999999,0)),t.add(X(new tf(n*.86,n*.86,.02,40),Uv(13225168,.35),0,1.015,0));for(let e of[0,Math.PI/2]){let r=X(new Qd(n*1.4,.012,.03),Y(5593180),0,1.027,0);r.rotation.y=e,t.add(r)}if(e.display){let n=new Ad(new bp(.42,.2),new Np({map:Gv(e.display.replace(/\s/g,``),.42,.2,{bg:`#23324f`,fg:`#e7e9ee`,size:.5}),roughness:.5}));n.position.set(0,.5825,.386),t.add(n)}return{g:t,w:1.01,d:1.01,h:1.01}}function Yv(){let e=new iu,t=new xp(.26,28,16);return t.scale(1,1,.38),e.add(X(t,Y(13072430,.5),0,.42,0)),Wv(e,-.1,0,.3,0),Wv(e,.1,0,.3,0),{g:e,w:.7,d:.4,h:.68}}function Xv(){let e=new iu;return e.add(X(new Qd(.62,.48,.26),Y(14070330,.4),0,.3,0)),{g:e,w:.8,d:.45,h:.54}}function Zv(e,t){let n=new iu,r=.16;n.add(X(new tf(.19,.19,.05,32),Y(11544090,.3),0,.12,0));let i=new Pp({color:14169116,emissive:16722448,emissiveIntensity:.2,roughness:.18,clearcoat:1,transparent:!0,opacity:.96});n.add(X(new tf(r,r,.24,32),i,0,.26,0));let a=new xp(r,32,16,0,Math.PI*2,0,Math.PI/2);n.add(X(a,i,0,.38,0)),Wv(n,-.06,0,.1,0),Wv(n,.06,0,.1,0);let o=new vm(16730658,0,3.2,1.6);return o.position.set(0,.45,0),n.add(o),t.leds.push({id:e.id,lens:i,light:o}),{g:n,w:.55,d:.55,h:.54}}function Qv(){let e=new iu,t=new tf(.19,.19,.42,32,1,!1,0,Math.PI);e.add(X(t,Y(1842206,.7),0,.42,0)),e.add(X(new Qd(.38,.42,.01),Y(1842206,.7),0,.42,0));for(let t of[-.12,0,.12])Wv(e,t,.05,.21,0);return{g:e,w:.55,d:.45,h:.63}}function $v(){let e=new iu;e.add(X(new Qd(.42,.5,.17),Y(1842206,.7),0,.45,0)),e.add(X(new Qd(.42,.34,.04),Uv(13225168,.3),0,.86,-.065));for(let t of[-.13,0,.13])Wv(e,t,0,.2,0,.03);return{g:e,w:.65,d:.45,h:1.03}}function ey(e,t,n,r,i){let a=new iu;return a.add(X(new Qd(t,n,r),Y(e,.55),0,.04+n/2,0)),i?.(a,n+.04),{g:a,w:t+.2,d:r+.2,h:n+.04}}function ty(e){let t=new iu,n=/esp|nodemcu|wemos|lolin|wroom/i.test(`${e.marking||``} ${e.evidence||``}`),r=n?1.25:2.1,i=n?2.6:1.6;t.add(X(new Qd(r,.06,i),Y(n?1776671:1011580,.6),0,.32,0));let a=n?[[-r/2+.08,`z`],[r/2-.08,`z`]]:[[-i/2+.08,`x`],[i/2-.08,`x`]];for(let[e,o]of a){let a=n?19:14,s=(o===`z`?i:r)-.3;for(let n=0;n<a;n++){let r=-s/2+n*s/(a-1),[i,c]=o===`z`?[e,r]:[r,e];t.add(X(new Qd(.06,.12,.06),Y(1447446,.7),i,.23,c)),t.add(X(new Qd(.025,.3,.025),Uv(13938760,.3),i,.17,c))}}for(let e of[-r/2+.2,r/2-.2])Wv(t,e,0,.29000000000000004,0,.03);if(n){t.add(X(new Qd(r*.72,.1,i*.38),Uv(12830410,.32),0,.4,-i*.22));let n=new Ad(new bp(r*.6,.22),new Np({map:Gv(e.marking?.split(/[-\s]/)[0]||`ESP32`,r*.6,.22,{bg:`#c3c6ca`,fg:`#2a2a2a`}),roughness:.5}));n.rotation.x=-Math.PI/2,n.position.set(0,.451,-i*.22),t.add(n),t.add(X(new Qd(.3,.1,.2),Uv(11580344,.3),0,.4,i/2-.08))}else t.add(X(new Qd(1,.1,.3),Y(1842206,.7),.2,.4,.1)),t.add(X(new Qd(.45,.4,.5),Uv(12830410,.3),-r/2+.25,.55,-.35)),t.add(X(new tf(.15,.15,.4,24),Y(1118481,.4),-r/2+.3,.55,.45));return{g:t,w:r+.15,d:i+.15,h:.52}}function ny(){let e=new iu;e.add(X(new Qd(1.1,.42,.45),Y(15909424,.5),0,.25,0));let t=new tf(.2,.2,.55,28);t.rotateZ(Math.PI/2),e.add(X(t,Uv(13225168,.35),-.8,.25,0));let n=new tf(.5,.5,.22,36);n.rotateX(Math.PI/2),e.add(X(n,Y(1776411,.85),.25,.52,.36));let r=new tf(.2,.2,.24,24);r.rotateX(Math.PI/2),e.add(X(r,Y(15909424,.5),.25,.52,.37));for(let t of[-.08,.08])Wv(e,-1.07,t,.25,.02,.02);return{g:e,w:1.7,d:.95,h:1}}function ry(){let e=new iu;return e.add(X(new Qd(.85,.75,.42),Y(2381496,.55),0,.42,0)),e.add(X(new Qd(1.15,.06,.42),Y(2381496,.55),0,.62,0)),e.add(X(new tf(.1,.1,.16,20),Y(15658734,.5),.22,.88,0)),e.add(X(new Qd(.55,.05,.12),Y(15658734,.5),.35,.97,0)),{g:e,w:1.3,d:.6,h:1}}function iy(e){let t=new iu,n=/18650|li-?ion/i.test(`${e.marking||``} ${e.evidence||``}`),r=n?2:1,i=n?.24:.3;t.add(X(new Qd(1.9,.28,r*.58+.12),Y(1776411,.7),0,.14,0));for(let e=0;e<r;e++){let a=new tf(i,i,1.6,30);a.rotateZ(Math.PI/2),t.add(X(a,Y(n?2781142:9071898,.35),0,.42,(e-(r-1)/2)*.58))}return t.add(X(new Qd(.06,.12,.06),Y(13710383,.5),.9,.34,-.1)),{g:t,w:2,d:r*.58+.25,h:.7}}function ay(){let e=new iu;e.add(X(new Qd(1.6,.06,.75),Y(2054794,.6),0,.35,0));for(let t of[-.45,.45]){let n=new tf(.28,.28,.42,30);e.add(X(n,Uv(13159634,.3),t,.6,.02)),e.add(X(new tf(.2,.2,.02,24),Y(2763306,.9),t,.82,.02))}for(let t of[-.15,-.05,.05,.15])Wv(e,t,-.3,.33,0,.025);return{g:e,w:1.75,d:.95,h:.85}}function oy(e){let t=new iu;t.add(X(new Qd(1.6,.06,1.6),Y(11740702,.55),0,.3,0)),t.add(X(new Qd(.9,.5,.25),Y(1447446,.6),0,.6,-.45));for(let e=0;e<6;e++)t.add(X(new Qd(.04,.5,.18),Y(1447446,.6),-.4+e*.16,.6,-.27));for(let[e,n]of[[-.6,.55],[.6,.55],[-.6,-.1],[.6,-.1],[0,.6]])t.add(X(new Qd(.3,.22,.24),Y(2381496,.5),e,.44,n));let n=new Ad(new bp(.7,.2),new Np({map:Gv(e.marking||`DRIVER`,.7,.2,{bg:`#b3261e`,fg:`#ffffff`}),roughness:.6}));n.rotation.x=-Math.PI/2,n.position.set(0,.335,.2),t.add(n);for(let[e,n]of[[-.7,-.7],[.7,-.7],[-.7,.7],[.7,.7]])Wv(t,e,n,.3,0,.04);return{g:t,w:1.75,d:1.75,h:.85}}var sy={relay:2903966,display:2763306,sensor_module:2054794,motor:12106946,battery:2763306,other:7039851};function cy(e,t){let n=e.type;if(n===`ic`&&/L298|L293|L9110|TB6612|DRV88|A4988|MX1508|BTS7960|ULN200|HG7881/i.test(e.marking||``))return oy(e);if(n===`ic`)return Kv(e);if(n===`dev_board`)return ty(e);if(n===`motor`)return ny();if(n===`servo`)return ry();if(n===`stepper`)return ey(2763306,.9,.8,.9,(e,t)=>e.add(X(new tf(.08,.08,.3,16),Uv(),0,t+.15,0)));if(n===`battery`)return iy(e);if(n===`sensor_module`&&/SR0\d/i.test(e.marking||``))return ay();if(n===`resistor`)return qv(e,{bands:e.bands||[]});if(n===`diode`)return qv(e,{body:1776411,r:.08,len:.3,bands:[`silver`,`black`,`black`,`black`].slice(0,1)});if(n===`inductor`)return qv(e,{body:5930314,r:.14,len:.45,bands:e.bands||[]});if(n===`capacitor_electrolytic`)return Jv(e);if(n===`capacitor_ceramic`)return Yv();if(n===`capacitor_film`)return Xv();if(n===`led`)return Zv(e,t);if(n===`transistor`)return Qv();if(n===`mosfet`||n===`voltage_regulator`)return $v();if(n===`potentiometer`)return ey(2381496,.5,.4,.5,(e,t)=>{e.add(X(new tf(.15,.15,.08,24),Y(15658734,.5),0,t+.04,0))});if(n===`crystal`){let{g:e,w:t,d:n,h:r}=ey(13685720,.46,.34,.18);return e.children[0].material=Uv(13685720,.25),{g:e,w:t,d:n,h:r}}if(n===`connector`)return ey(15262676,.3,.32,.9,(e,t)=>{for(let n of[-.3,0,.3])e.add(X(new Qd(.05,.25,.05),Uv(13938760,.3),0,t+.1,n))});if(n===`switch`||n===`button`)return ey(1842206,.5,.18,.5,(e,t)=>{e.add(X(new tf(.13,.13,.14,24),Y(15025435,.5),0,t+.07,0))});if(n===`buzzer`){let e=new iu;return e.add(X(new tf(.42,.42,.34,40),Y(1842206,.6),0,.2,0)),e.add(X(new tf(.06,.06,.01,20),Y(328965,1),0,.375,0)),{g:e,w:1,d:1,h:.37}}if(n===`ldr`){let e=new iu;return e.add(X(new tf(.16,.16,.06,28),Y(14263361,.4),0,.3,0)),Wv(e,-.07,0,.27,0),Wv(e,.07,0,.27,0),{g:e,w:.45,d:.45,h:.33}}return ey(sy[n]??sy.other,.8,.4,.6)}function ly(e,t){return t.some(t=>Math.abs(e.x-t.x)<(e.w+t.w)/2+.12&&Math.abs(e.z-t.z)<(e.d+t.d)/2+.12)}function uy(e){return e.x=Math.max(-5+e.w/2+.35,Math.min(5-e.w/2-.35,e.x)),e.z=Math.max(-6.67/2+e.d/2+.35,Math.min(Pv/2-e.d/2-.35,e.z)),e}function dy(e){let t=[];for(let n of e){let e=null;if(Array.isArray(n.c.box)&&n.c.box.length===4){let[r,i,a,o]=n.c.box;e=uy({x:((i+o)/2e3-.5)*10*.96,z:((r+a)/2e3-.5)*Pv*.96,w:n.w,d:n.d}),ly(e,t)&&(e=null)}if(!e)outer:for(let r=-2.435;r<Pv/2-.5;r+=.45)for(let i=-4.1;i<4.5;i+=.45){let a=uy({x:i,z:r,w:n.w,d:n.d});if(!ly(a,t)){e=a;break outer}}e||={x:0,z:0,w:n.w,d:n.d},t.push(e),n.pos=e}}function fy(e=[]){let t=document.createElement(`canvas`);t.width=2048,t.height=Math.round(2048*Pv/10);let n=t.getContext(`2d`),r=e=>(e/10+.5)*t.width,i=e=>(e/Pv+.5)*t.height,a=t.width/10;n.fillStyle=`#1f4a33`,n.fillRect(0,0,t.width,t.height);let o=n.getImageData(0,0,t.width,t.height);for(let e=0;e<o.data.length;e+=4){let t=(Math.random()-.5)*7;o.data[e]+=t,o.data[e+1]+=t,o.data[e+2]+=t}n.putImageData(o,0,0);let s=.254*a;for(let e=s*1.5;e<t.height-s;e+=s)for(let r=s*1.5;r<t.width-s;r+=s)n.fillStyle=`#9c7a3c`,n.beginPath(),n.arc(r,e,s*.26,0,7),n.fill(),n.fillStyle=`#16251c`,n.beginPath(),n.arc(r,e,s*.1,0,7),n.fill();n.strokeStyle=`rgba(240,238,230,0.85)`,n.lineWidth=4,n.strokeRect(.18*a,.18*a,t.width-.36*a,t.height-.36*a);for(let[e,t]of[[.4,.4],[9.6,.4],[.4,6.27],[9.6,6.27]])n.fillStyle=`#b08a45`,n.beginPath(),n.arc(e*a,t*a,.2*a,0,7),n.fill(),n.fillStyle=`#0e1511`,n.beginPath(),n.arc(e*a,t*a,.12*a,0,7),n.fill();n.fillStyle=`rgba(240,238,230,0.9)`,n.font=`600 ${.17*a}px "JetBrains Mono", Consolas, monospace`,n.textBaseline=`top`;for(let t of e){let{x:e,z:o,w:s,d:c}=t.pos;n.lineWidth=3,n.strokeRect(r(e-s/2+.06),i(o-c/2+.06),(s-.12)*a,(c-.12)*a),n.fillText(t.c.id,r(e-s/2+.08),i(o+c/2-.02))}n.textAlign=`right`,n.textBaseline=`bottom`,n.font=`500 ${.15*a}px "JetBrains Mono", Consolas, monospace`,n.fillText(`GENESIS RECONSTRUCTION · PARTS FROM PHOTO · COPPER NOT OBSERVED`,t.width-.35*a,t.height-.3*a);let c=new Jd(t);return c.colorSpace=_c,c.anisotropy=8,c.repeat.set(1/10,1/Pv),c.offset.set(.5,.5),c}function py(){let e=Pv/2,t=new Nf;t.moveTo(-4.72,-3.335),t.lineTo(4.72,-3.335),t.quadraticCurveTo(5,-3.335,5,-3.0549999999999997),t.lineTo(5,3.0549999999999997),t.quadraticCurveTo(5,e,4.72,e),t.lineTo(-4.72,e),t.quadraticCurveTo(-5,e,-5,3.0549999999999997),t.lineTo(-5,-3.0549999999999997),t.quadraticCurveTo(-5,-3.335,-4.72,-3.335);let n=new _p(t,{depth:Fv,bevelEnabled:!0,bevelThickness:.03,bevelSize:.03,bevelSegments:2,curveSegments:10});n.rotateX(-Math.PI/2),n.translate(0,.03,0);let r=new Ad(n,[new Pp({map:fy(),roughness:.42,clearcoat:.7,clearcoatRoughness:.32}),new Np({color:9144917,roughness:.7})]);return r.receiveShadow=!0,r.castShadow=!0,r}function my(e,t,n,r=.035){let i=new iu,a=new vd({color:n});for(let[n,o,s,c]of[[e,r,0,-t/2],[e,r,0,t/2],[r,t,-e/2,0],[r,t,e/2,0]]){let e=new Ad(new Qd(n,.012,o),a);e.position.set(s,.008,c),i.add(e)}return i}function hy(){let e=new cv({antialias:!0,alpha:!0,powerPreference:`high-performance`});e.setPixelRatio(Math.min(window.devicePixelRatio,2)),e.toneMapping=4,e.toneMappingExposure=1.05,e.shadowMap.enabled=!0,e.shadowMap.type=1,e.setClearColor(0,0);let t=new fu;t.environment=new hh(e).fromScene(new Mv,.04).texture,t.environmentIntensity=.55;let n=new gm(30,1,.1,100);n.position.set(5.2,8.2,10.4);let r=new yv(n,e.domElement);r.target.set(0,.3,0),r.enableDamping=!0,r.dampingFactor=.07,r.enablePan=!1,r.minDistance=5,r.maxDistance=22,r.maxPolarAngle=1.32,r.autoRotateSpeed=.55,t.add(new im(16777215,12169888,.55));let i=new xm(16774890,2.3);i.position.set(4,10,6),i.castShadow=!0,i.shadow.mapSize.set(1024,1024),Object.assign(i.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:1,far:30}),i.shadow.bias=-4e-4,i.shadow.radius=4,t.add(i);let a=new xm(14674175,.6);a.position.set(-6,4,-6),t.add(a);let o=new Ad(new bp(80,80),new Sp({opacity:.16}));o.rotation.x=-Math.PI/2,o.position.y=-.005,o.receiveShadow=!0,t.add(o);let s=new iu;t.add(s);let c=py();s.add(c);let l=new iu;l.position.y=Iv,s.add(l);let u=document.createElement(`div`);u.className=`tags is-quiet`;let d={renderer:e,scene:t,camera:n,controls:r,leds:[],items:[],selected:null,container:null,signal:e=>+(e*.686%1<.524),driven:null,onSelect:()=>{},onHover:()=>{}},f=new iu;f.add(new Ad(new Qd(.02,.7,6.97),new vd({color:Rv,transparent:!0,opacity:.9})));let p=new Ad(new bp(.9,6.97),new vd({color:Rv,transparent:!0,opacity:.1,depthWrite:!1}));p.rotation.x=-Math.PI/2,p.position.set(-.45,-.33,0),f.add(p),f.position.set(-5,.54,0),f.visible=!1,s.add(f);let m=null;d.setScanning=e=>{e!==f.visible&&(f.visible=e,m?.kill(),e&&(f.position.x=-5,m=La.to(f.position,{x:5,duration:1.7,ease:`sine.inOut`,repeat:-1,yoyo:!0})))};let h=``;d.setComponents=(e=[],{animate:t=!0,changing:n=null}={})=>{d.driven=n;let r=e.map(e=>`${e.id}:${e.type}:${e.display||``}:${(e.bands||[]).join(`,`)}:${e.marking||``}`).join(`|`);if(r===h){g(e);return}h=r;for(let e of d.items)e.tag.remove();l.clear(),d.leds=[];let i=e.map(e=>({c:e,...cy(e,d)}));dy(i);for(let e of i){e.g.position.set(e.pos.x,0,e.pos.z),e.g.userData.id=e.c.id,e.g.traverse(t=>{t.userData.id=e.c.id}),e.status=my(e.pos.w+.08,e.pos.d+.08,Lv),e.status.visible=!1,e.g.add(e.status),l.add(e.g);let t=document.createElement(`div`);t.className=`tag3d`;let n=e.c.display||e.c.marking||e.c.type.replace(/_/g,` `);t.innerHTML=`<b>${e.c.id}<small>${Z(n)}</small></b>`,t.addEventListener(`click`,()=>d.select(e.c.id,!0)),t.addEventListener(`mouseenter`,()=>d.onHover(e.c.id)),t.addEventListener(`mouseleave`,()=>d.onHover(null)),u.appendChild(t),e.tag=t}d.items=i,c.material[0].map.dispose(),c.material[0].map=fy(i),c.material[0].needsUpdate=!0,g(e),t&&i.forEach((e,t)=>{La.from(e.g.position,{y:2.6,duration:.95,ease:`power3.out`,delay:.1+t*.09}),La.from(e.g.rotation,{y:(t%2?1:-1)*.6,duration:1.1,ease:`power3.out`,delay:.1+t*.09}),La.fromTo(e.tag,{opacity:0},{opacity:1,duration:.4,delay:.6+t*.09})})};function g(e){let t=Object.fromEntries(e.map(e=>[e.id,e]));for(let e of d.items){let n=t[e.c.id]?.status;e.tag.classList.toggle(`is-inferred`,n===`INFERRED`),e.tag.classList.toggle(`is-contradicted`,n===`CONTRADICTED`);let r=d.selected===e.c.id,i=n===`CONTRADICTED`?Rv:n===`INFERRED`?zv:Lv;e.status.visible=r||n===`INFERRED`||n===`CONTRADICTED`,e.status.children.forEach(e=>e.material.color.setHex(i)),e.tag.classList.toggle(`is-selected`,r)}}d.refreshStatus=e=>g(e);let _=[],v=d.setComponents;d.setComponents=(e,t)=>{_=e||[],v(e,t)},d.select=(e,t=!1)=>{d.selected=d.selected===e&&t?null:e,g(_);let n=d.items.find(e=>e.c.id===d.selected),i=n?new W(n.pos.x,.39,n.pos.z):new W(0,.3,0);La.to(r.target,{x:i.x,y:i.y,z:i.z,duration:.9,ease:`power3.inOut`}),t&&d.onSelect(d.selected)};let y=new zm,b=new U,x=null,S=null,C=t=>{let r=e.domElement.getBoundingClientRect();return b.set((t.clientX-r.left)/r.width*2-1,-((t.clientY-r.top)/r.height)*2+1),y.setFromCamera(b,n),y.intersectObjects(l.children,!0)[0]?.object.userData.id??null};e.domElement.addEventListener(`pointerdown`,e=>{x=[e.clientX,e.clientY]}),e.domElement.addEventListener(`pointerup`,e=>{if(x&&Math.hypot(e.clientX-x[0],e.clientY-x[1])<5){let t=C(e);(t||d.selected)&&d.select(t??d.selected,!0)}x=null}),e.domElement.addEventListener(`pointermove`,t=>{let n=C(t);n!==S&&(S=n,e.domElement.style.cursor=n?`pointer`:`grab`,d.onHover(n))});let w=new ResizeObserver(()=>T());function T(){let t=d.container;if(!t)return;let r=t.clientWidth,i=t.clientHeight;r&&i&&(e.setSize(r,i,!1),n.aspect=r/i,n.fov=r/i<1?42:30,n.updateProjectionMatrix())}d.prefs={labels:!0,rotate:!0};let E=!1;d.mount=(t,{hero:n=!1}={})=>{d.container&&w.unobserve(d.container),d.container=t,E=n,t.prepend(e.domElement),t.appendChild(u),w.observe(t),T(),r.autoRotate=n&&d.prefs.rotate,u.classList.toggle(`is-quiet`,n),u.style.display=d.prefs.labels?``:`none`},d.setPrefs=e=>{Object.assign(d.prefs,e),r.autoRotate=E&&d.prefs.rotate,u.style.display=d.prefs.labels?``:`none`},d.intro=()=>{La.from(s.rotation,{y:-.9,duration:2.2,ease:`power3.out`}),La.from(s.position,{y:-1.2,duration:1.8,ease:`power3.out`}),La.from(n.position,{x:9,y:12,z:14,duration:2.4,ease:`power2.out`})};let D={x:0,y:0};window.addEventListener(`pointermove`,e=>{D.x=(e.clientX/window.innerWidth-.5)*.12,D.y=(e.clientY/window.innerHeight-.5)*.06});let O=new W,k=performance.now(),A=0,j=e.getPixelRatio();function M(){requestAnimationFrame(M);let i=d.container;if(!i||!i.offsetParent)return;let a=performance.now(),o=a-k;k=a,A=o>40&&o<1e3?A+1:Math.max(0,A-1),A>30&&j>.75&&(j=Math.max(.75,j-.5),e.setPixelRatio(j),T(),A=0),r.update(),r.autoRotate?(s.rotation.x+=(D.y-s.rotation.x)*.04,s.rotation.z+=(-D.x*.4-s.rotation.z)*.04):(s.rotation.x*=.9,s.rotation.z*=.9);let c=Math.max(0,Math.min(1,d.signal(Vv.now())));for(let e of d.leds){let t=!d.driven||d.driven===e.id?c:.6;e.lens.emissiveIntensity=.15+t*2.6,e.light.intensity=t*5}let l=i.clientWidth,u=i.clientHeight;for(let e of d.items){e.g.getWorldPosition(O),O.y+=e.h+.12,O.project(n);let t=O.z>1;e.tag.style.transform=`translate(${(O.x*.5+.5)*l}px, ${(-O.y*.5+.5)*u}px) translate(-50%, -100%)`,e.tag.style.visibility=t?`hidden`:`visible`}e.render(t,n)}return M(),d}function Z(e){return String(e??``).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`})[e])}var gy=e=>getComputedStyle(document.documentElement).getPropertyValue(e).trim();function _y(e,t){let n=e.getContext(`2d`),r=null,i=0;function a(e){return(e?.regions||[]).filter(e=>e.trace?.length>3)}function o(e){let t=a(r)[0];if(!t)return null;let n=t.trace.length,i=r.dt||1/30,o=Math.floor(e%(n*i)/i),s=t.analysis?.min??Math.min(...t.trace),c=t.analysis?.max??Math.max(...t.trace);return c>s?(t.trace[Math.min(n-1,o)]-s)/(c-s):0}function s(){if(requestAnimationFrame(s),!e.offsetParent)return;let t=Math.min(window.devicePixelRatio,2),c=e.clientWidth,l=e.clientHeight;(e.width!==Math.round(c*t)||e.height!==Math.round(l*t))&&(e.width=Math.round(c*t),e.height=Math.round(l*t)),n.setTransform(t,0,0,t,0,0),n.clearRect(0,0,c,l);let u=c-12-12,d=l-12-20,f=a(r),p=f.length?f[0].trace.length*(r.dt||1/30):10,m=gy(`--ink`)||`#151515`,h=gy(`--ink-3`)||`#85817a`,g=gy(`--grid-line`)||`rgba(21,21,21,0.08)`,_=[m,`#e5451b`,`#b97b0c`];n.strokeStyle=g,n.lineWidth=1,n.fillStyle=h,n.font=`10px 'JetBrains Mono', monospace`,n.textBaseline=`top`;let v=p>20?5:p>8?2:1;for(let e=0;e<=p+1e-6;e+=v){let t=12+e/p*u;n.beginPath(),n.moveTo(t+.5,12),n.lineTo(t+.5,12+d),n.stroke(),n.fillText(`${e}s`,t+3,12+d+4)}for(let e=0;e<=4;e++){let t=12+e/4*d;n.beginPath(),n.moveTo(12,t+.5),n.lineTo(12+u,t+.5),n.stroke()}if(!f.length){n.strokeStyle=h,n.setLineDash([4,5]);let e=Vv.now();n.beginPath();for(let t=0;t<=u;t+=3){let r=12+d*.75+Math.sin(t*.11+e*3)*1.2;t?n.lineTo(12+t,r):n.moveTo(12+t,r)}n.stroke(),n.setLineDash([]);return}f.forEach((e,t)=>{let r=e.analysis?.min??Math.min(...e.trace),a=(e.analysis?.max??Math.max(...e.trace))-r||1,o=e=>12+d-(e-r)/a*d*.86-d*.07,s=t=>12+t/(e.trace.length-1)*u;if(t===0&&e.analysis?.threshold!=null){n.strokeStyle=`rgba(229,69,27,0.55)`,n.setLineDash([3,4]),n.beginPath(),n.moveTo(12,o(e.analysis.threshold)),n.lineTo(12+u,o(e.analysis.threshold)),n.stroke(),n.setLineDash([]),n.fillStyle=`#b8340f`,n.fillText(`threshold`,12+u-62,o(e.analysis.threshold)+3),n.fillStyle=h;for(let t of e.analysis.rising_idx||[])n.fillRect(s(t)-.5,12+d-6,1,6)}t===0&&(n.fillStyle=g,n.beginPath(),n.moveTo(s(0),12+d),e.trace.forEach((e,t)=>n.lineTo(s(t),o(e))),n.lineTo(s(e.trace.length-1),12+d),n.closePath(),n.fill()),n.strokeStyle=_[t%_.length],n.lineWidth=t===0?1.6+i*1.5:1.2,n.beginPath(),e.trace.forEach((e,t)=>t?n.lineTo(s(t),o(e)):n.moveTo(s(t),o(e))),n.stroke(),n.fillStyle=_[t%_.length],n.fillText(`V${e.index+1}`,16,14+t*12)});let y=12+Vv.now()%p/p*u;n.strokeStyle=`#e5451b`,n.lineWidth=1.5,n.beginPath(),n.moveTo(y,12),n.lineTo(y,12+d),n.stroke();let b=o(Vv.now())??0;n.fillStyle=`#e5451b`,n.beginPath(),n.arc(y,12+d-b*d*.86-d*.07,3.5,0,7),n.fill(),i*=.94}return s(),{set(e){r=e&&a(e).length?e:null,t?.(r?o:null)},pulse(){i=1}}}var vy=e=>getComputedStyle(document.documentElement).getPropertyValue(e).trim();function yy(e,t){let n=e.getContext(`2d`),r=[],i=1;function a(e){return[.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10,20,50].find(t=>e/t<=6)||100}function o(){let t=Math.min(window.devicePixelRatio,2),o=e.clientWidth,s=e.clientHeight;if(!o||!s)return;(e.width!==Math.round(o*t)||e.height!==Math.round(s*t))&&(e.width=Math.round(o*t),e.height=Math.round(s*t)),n.setTransform(t,0,0,t,0,0),n.clearRect(0,0,o,s);let c=o-38-8,l=s-8-22,u=vy(`--ink-3`)||`#8b8172`,d=vy(`--line`)||`#e3d8c8`;if(n.font=`10px 'JetBrains Mono', monospace`,!r.length){n.fillStyle=u,n.textAlign=`center`,n.fillText(`No simulation yet`,38+c/2,8+l/2);return}let f=r.flatMap(e=>e.points),p=Math.max(...f.map(e=>e[0]))||1,m=Math.min(0,...f.map(e=>e[1])),h=Math.max(...f.map(e=>e[1]));h-m<1e-6&&(h=m+1);let g=(h-m)*.08;m-=g,h+=g;let _=e=>38+e/p*c,v=e=>8+l-(e-m)/(h-m)*l;n.strokeStyle=d,n.lineWidth=1,n.fillStyle=u;let y=a(h-m);n.textAlign=`right`,n.textBaseline=`middle`;for(let e=Math.ceil(m/y)*y;e<=h;e+=y)n.beginPath(),n.moveTo(38,v(e)+.5),n.lineTo(38+c,v(e)+.5),n.stroke(),n.fillText(`${+e.toFixed(2)}V`,34,v(e));let b=a(p);n.textAlign=`center`,n.textBaseline=`top`;for(let e=0;e<=p+1e-9;e+=b)n.fillText(e<1&&b<1?`${+(e*1e3).toFixed(0)}ms`:`${+e.toFixed(2)}s`,_(e),8+l+5);r.forEach(e=>{let t=Math.max(2,Math.floor(e.points.length*i));n.strokeStyle=e.color||vy(`--maroon`),n.lineWidth=2,n.lineJoin=`round`,n.beginPath(),e.points.slice(0,t).forEach(([e,t],r)=>r?n.lineTo(_(e),v(t)):n.moveTo(_(e),v(t))),n.stroke()})}return new ResizeObserver(o).observe(e),{set(e){r=(e||[]).map(e=>({...e,color:e.color===`#6b2a2e`?vy(`--maroon`):e.color===`#3b57d9`?vy(`--blue`):e.color})),t.innerHTML=r.map(e=>`<span><i style="background:${e.color}"></i>${e.name}</span>`).join(``),i=1,o()},progress(e){i=e,o()},redraw:o}}var by=[`black`,`brown`,`red`,`orange`,`yellow`,`green`,`blue`,`violet`,`grey`,`white`],xy=[{label:`1st digit`,colors:by.slice(1)},{label:`2nd digit`,colors:by},{label:`Multiplier`,colors:[...by.slice(0,8),`gold`,`silver`]},{label:`Tolerance`,colors:[`brown`,`red`,`green`,`blue`,`violet`,`gold`,`silver`]}];async function Sy(e,t){return(await fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(t)})).json()}function Cy(){let e=[`yellow`,`violet`,`red`,`gold`],t=document.getElementById(`band-pickers`),n=document.getElementById(`bands-out`),r=document.getElementById(`bands-note`);xy.forEach((n,r)=>{let a=document.createElement(`div`);a.className=`band-row`,a.innerHTML=`<span>${n.label}</span><div class="swatches"></div>`;let o=a.querySelector(`.swatches`);for(let t of n.colors){let a=document.createElement(`button`);a.type=`button`,a.title=t,a.setAttribute(`aria-label`,`${n.label}: ${t}`),a.style.background=Bv[t],a.addEventListener(`click`,()=>{e[r]=t,i()}),o.appendChild(a)}t.appendChild(a)});async function i(){t.querySelectorAll(`.band-row`).forEach((t,n)=>t.querySelectorAll(`button`).forEach(t=>t.classList.toggle(`is-on`,t.title===e[n]))),document.querySelectorAll(`.resistor .band`).forEach((t,n)=>t.setAttribute(`fill`,Bv[e[n]]));try{let t=await Sy(`/api/lab/bands`,{bands:e});if(t.error){n.textContent=`—`,r.textContent=t.error;return}La.fromTo(n,{opacity:0,y:6},{opacity:1,y:0,duration:.35}),n.textContent=`${t.display} ±${t.tolerance_pct}%`,r.textContent=t.ambiguous?`Ambiguous: read from the other end it would be ${t.alternative} Ω.`:`Read ${t.reversed?`from the right-hand end`:`left to right`}; the other direction isn't a plausible code.`}catch{r.textContent=`The bench server isn't reachable.`}}i();let a=document.getElementById(`c-ra`),o=document.getElementById(`c-rb`),s=document.getElementById(`c-c`),c=document.getElementById(`calc-led`),l=document.querySelector(`#calc-wave path`),u=null,d=null,f=e=>e>=1e3?`${(e/1e3).toPrecision(3)} kHz`:`${e.toPrecision(3)} Hz`,p=e=>e<.001?`${(e*1e6).toPrecision(3)} µs`:e<1?`${(e*1e3).toPrecision(3)} ms`:`${e.toPrecision(3)} s`;async function m(){try{let[e,t,n]=await Promise.all([Sy(`/api/lab/parse`,{text:a.value,kind:`resistor`}),Sy(`/api/lab/parse`,{text:o.value,kind:`resistor`}),Sy(`/api/lab/parse`,{text:s.value,kind:`capacitor`})]);if([a,o,s].forEach((r,i)=>r.style.borderColor=[e,t,n][i].value?``:`var(--signal)`),!e.value||!t.value||!n.value)return;let r=await Sy(`/api/lab/555`,{ra:e.value,rb:t.value,c:n.value});document.getElementById(`c-f`).textContent=f(r.frequency_hz),document.getElementById(`c-p`).textContent=p(r.period_s),document.getElementById(`c-d`).textContent=`${Math.round(r.high_fraction*100)}%`;let i=r.high_fraction,d=`M0 52`;for(let e=0;e<4;e++){let t=e/4*400,n=t+i/4*400,r=(e+1)/4*400;d+=` L${t} 52 L${t} 8 L${n} 8 L${n} 52 L${r} 52`}l.setAttribute(`d`,d),u?.kill();let m=Math.max(r.period_s,.06);u=La.timeline({repeat:-1}).call(()=>c.classList.add(`is-on`)).to({},{duration:m*i}).call(()=>c.classList.remove(`is-on`)).to({},{duration:m*(1-i)})}catch{}}for(let e of[a,o,s])e.addEventListener(`input`,()=>{clearTimeout(d),d=setTimeout(m,220)});m()}var wy=760,Ty=430;function Ey(e,t){if(!t)return e.innerHTML=`<div class="schem-empty"><b>No schematic</b><span>A wiring diagram is drawn once a known circuit is matched (555 timer, two-transistor flasher, or a microcontroller / Arduino / ESP output).</span></div>`,{highlight(){},svg:()=>``};let n=Object.fromEntries(t.nets.map(e=>[e.key,e])),r=t.parts,i=[],a=e=>n[e]?.color||`#888`,o=(e,t)=>i.push(`<polyline class="w" data-net="${e}" points="${t.map(e=>e.join(`,`)).join(` `)}" stroke="${a(e)}"/>`),s=(e,t,n)=>i.push(`<circle class="j" data-net="${e}" cx="${t}" cy="${n}" r="4.5" fill="${a(e)}"/>`),c=(e,t,r)=>{n[e]&&i.push(`<g class="badge" data-net="${e}" transform="translate(${t},${r})"><rect x="-15" y="-10" width="30" height="20" rx="3" fill="${a(e)}"/><text y="4" text-anchor="middle">${n[e].id}</text></g>`)},l=e=>{let t=Object.values(r).find(t=>t.role===e)||{};return`part st-${t.status||`OBSERVED`}${t.id||t.kind===`supply`?``:` is-missing`}${t.role_inferred?` role-inferred`:``}`},u=(e,t,n,a=`start`)=>{let o=Object.values(r).find(e=>e.role===n);if(!o)return;let[s,...c]=o.label.split(` · `);i.push(`<text class="lbl" x="${e}" y="${t}" text-anchor="${a}"><tspan class="lbl-role">${Z(s)}</tspan>${c.length?`<tspan x="${e}" dy="14">${Z(c.join(` · `))}</tspan>`:``}</text>`)},d=(e,t,n,r)=>i.push(n?`<rect class="${l(r)}" x="${e-9}" y="${t}" width="18" height="46"/>`:`<rect class="${l(r)}" x="${e}" y="${t-9}" width="50" height="18"/>`),f=(e,t,n)=>i.push(`<g class="${l(n)}"><line x1="${e-16}" y1="${t}" x2="${e+16}" y2="${t}"/><path d="M${e-16} ${t+12} Q${e} ${t+6} ${e+16} ${t+12}"/><text class="pol" x="${e+20}" y="${t-3}">+</text></g>`),p=(e,t,n,r)=>i.push(`<g class="${l(n)}"><line x1="${e}" y1="${t-14}" x2="${e}" y2="${t+14}"/><line x1="${e+10}" y1="${t-14}" x2="${e+10}" y2="${t+14}"/><text class="pol" x="${r?e-12:e+14}" y="${t-16}">+</text></g>`),m=(e,t,n)=>i.push(`<g class="${l(n)}"><path d="M${e-13} ${t} L${e+13} ${t} L${e} ${t+24} Z"/><line x1="${e-13}" y1="${t+24}" x2="${e+13}" y2="${t+24}"/><path class="arrows" d="M${e+16} ${t+6} l10 -8 M${e+22} ${t-4} l4 2 l-1 -5 M${e+18} ${t+14} l10 -8 M${e+24} ${t+4} l4 2 l-1 -5"/></g>`),h=(e,t,n)=>i.push(`<g class="${l(n)}"><line x1="${e-18}" y1="${t}" x2="${e+18}" y2="${t}"/><line class="thick" x1="${e-9}" y1="${t+12}" x2="${e+9}" y2="${t+12}"/><text class="pol" x="${e+22}" y="${t-2}">+</text></g>`),g=(e,t,n,r)=>{i.push(`<g class="${l(r)}"><circle cx="${e}" cy="${t}" r="24" class="body"/>
      <line x1="${e+n*8}" y1="${t-13}" x2="${e+n*8}" y2="${t+13}" class="thick"/>
      <line x1="${e+n*8}" y1="${t-6}" x2="${e}" y2="${t-24}"/><line x1="${e+n*8}" y1="${t+6}" x2="${e}" y2="${t+24}"/>
      <line x1="${e+n*8}" y1="${t}" x2="${e+n*24}" y2="${t}"/>
      <path d="M${e+n*1} ${t+15} l-1 9 l${-n*7} -5 Z" class="fill"/></g>`)};if(t.layout===`astable555`){let e=t.low;o(`vcc`,[[70,40],[430,40]]),o(`gnd`,[[70,390],[640,390]]),o(`vcc`,[[70,40],[70,190]]),h(70,200,`Supply`),o(`gnd`,[[70,212],[70,390]]),u(104,196,`Supply`),o(`vcc`,[[220,40],[220,62]]),d(220,62,!0,`RA`),o(`dis`,[[220,108],[220,130],[330,130]]),u(236,82,`RA`),o(`dis`,[[220,130],[220,148]]),d(220,148,!0,`RB`),o(`thr`,[[220,194],[220,215],[330,215]]),u(236,168,`RB`),o(`thr`,[[270,215],[270,255],[330,255]]),s(`thr`,270,215),o(`thr`,[[220,215],[220,262]]),f(220,262,`C`),o(`gnd`,[[220,274],[220,390]]),u(150,300,`C`,`end`),o(`vcc`,[[370,100],[370,40]]),o(`vcc`,[[430,100],[430,40]]),o(`gnd`,[[400,300],[400,390]]),s(`vcc`,220,40),s(`vcc`,370,40),s(`dis`,220,130),s(`thr`,220,215),s(`gnd`,220,390),s(`gnd`,400,390),i.push(`<g class="${l(`555`)}"><rect class="body" x="330" y="100" width="140" height="200"/></g>`);for(let[e,t,n,r]of[[338,134,`7 DIS`,`start`],[338,219,`6 THR`,`start`],[338,259,`2 TRIG`,`start`],[370,118,`8 VCC`,`middle`],[430,118,`4 RST`,`middle`],[400,290,`1 GND`,`middle`],[462,204,`3 OUT`,`end`],[462,264,`5 CV`,`end`]])i.push(`<text class="pin" x="${e}" y="${t}" text-anchor="${r}">${n}</text>`);u(400,170,`555`,`middle`),i.push(`<line class="nc" x1="470" y1="260" x2="500" y2="260"/><text class="pin muted" x="506" y="264">not observed</text>`),e?(o(`vcc`,[[430,40],[640,40],[640,70]]),d(640,70,!0,`R LED`),u(656,90,`R LED`),o(`led`,[[640,116],[640,140]]),m(640,140,`LED`),u(670,152,`LED`),o(`out`,[[640,164],[640,200],[470,200]]),c(`out`,560,186),c(`led`,622,128)):(o(`out`,[[470,200],[530,200]]),d(530,200,!1,`R LED`),u(530,178,`R LED`),o(`led`,[[580,200],[640,200],[640,250]]),m(640,250,`LED`),u(670,262,`LED`),o(`gnd`,[[640,274],[640,390]]),c(`out`,500,186),c(`led`,610,186)),c(`vcc`,150,40),c(`dis`,290,116),c(`thr`,300,201),c(`gnd`,520,390)}else if(t.layout===`multivibrator`){o(`vcc`,[[70,40],[460,40]]),o(`gnd`,[[70,390],[460,390]]),o(`vcc`,[[70,40],[70,190]]),h(70,200,`Supply`),o(`gnd`,[[70,212],[70,390]]),u(104,196,`Supply`);for(let[e,t,n,r,i,a]of[[180,`R LED1`,`LED1`,`l1`,`c1`,`Q1`],[460,`R LED2`,`LED2`,`l2`,`c2`,`Q2`]])o(`vcc`,[[e,40],[e,60]]),d(e,60,!0,t),u(e===180?140:500,80,t,e===180?`end`:`start`),o(r,[[e,106],[e,125]]),m(e,125,n),u(e===180?140:500,140,n,e===180?`end`:`start`),o(i,[[e,149],[e,256]]),g(e,280,e===180?1:-1,a),u(e===180?150:490,320,a,e===180?`end`:`start`),o(`gnd`,[[e,304],[e,390]]),s(`gnd`,e,390);for(let[e,t,n]of[[280,`R base1`,`b1`],[360,`R base2`,`b2`]])o(`vcc`,[[e,40],[e,60]]),d(e,60,!0,t),s(`vcc`,e,40),u(e===280?266:374,86,t,e===280?`end`:`start`),o(n,[[e,106],[e,280],[e===280?204:436,280]]);s(`vcc`,180,40),o(`c1`,[[180,190],[305,190]]),s(`c1`,180,190),p(305,190,`C1`,!0),o(`b2`,[[315,190],[360,190]]),s(`b2`,360,190),o(`c2`,[[460,225],[335,225]]),s(`c2`,460,225),p(325,225,`C2`,!1),o(`b1`,[[325,225],[280,225]]),s(`b1`,280,225),u(310,166,`C1`,`middle`),u(330,254,`C2`,`middle`),c(`vcc`,130,40),c(`gnd`,320,390),c(`l1`,152,116),c(`l2`,488,116),c(`c1`,240,176),c(`c2`,400,211),c(`b1`,250,266),c(`b2`,400,266)}else{i.push(`<g class="${l(`Power`)}"><rect class="body" x="20" y="128" width="44" height="26"/><text class="pin" x="42" y="146" text-anchor="middle">USB</text></g>`),o(`pwr`,[[64,141],[110,141]]),i.push(`<g class="${l(`Controller`)}"><rect class="body" x="110" y="100" width="190" height="230"/></g>`),u(205,210,`Controller`,`middle`);for(let[e,t,n,r]of[[118,145,`5V / VIN`,`start`],[292,174,`GPIO ?`,`end`],[292,274,`GND`,`end`]])i.push(`<text class="pin" x="${e}" y="${t}" text-anchor="${r}">${n}</text>`);o(`gpio`,[[300,170],[390,170]]),d(390,170,!1,`R`),u(390,134,`R`),o(`led`,[[440,170],[520,170],[520,214]]),m(520,214,`LED`),u(550,226,`LED`),o(`gnd`,[[300,270],[520,270],[520,238]]),c(`pwr`,87,126),c(`gpio`,345,156),c(`led`,480,156),c(`gnd`,410,284)}e.innerHTML=`<svg class="schem" viewBox="0 0 ${wy} ${Ty}" role="img" aria-label="Schematic of the matched circuit" xmlns="http://www.w3.org/2000/svg">${i.join(``)}</svg>`;let _=e.querySelector(`svg`);return{highlight(e){_.classList.toggle(`focus`,!!e),_.querySelectorAll(`[data-net]`).forEach(t=>t.classList.toggle(`on`,t.dataset.net===e))},svg(){return _.outerHTML.replace(/<svg([^>]*)>/,`<svg$1><style>.w{fill:none;stroke-width:3;stroke-linejoin:round}.part rect,.part line,.part path,.part circle{fill:none;stroke:#151515;stroke-width:2}.part .fill{fill:#151515}.part .thick{stroke-width:4}.lbl{font:12px sans-serif;fill:#151515}.lbl-role{font-weight:700}.pin{font:10px monospace;fill:#44423d}.badge text{font:bold 11px monospace;fill:#fff}.pol{font:bold 13px sans-serif;fill:#151515}.nc{stroke:#999;stroke-dasharray:3 3}</style><rect width="100%" height="100%" fill="#fff"/>`)}}}var Dy={resistor:[`r_v`,e=>/2|out|b\b/i.test(e)?`B`:`A`],capacitor:[`c_v`,e=>/−|-|stripe|2\b/.test(e)?`B`:`A`],inductor:[`l_v`,e=>/2|b\b/i.test(e)?`B`:`A`],led:[`d_led_v`,e=>/cathode|−|-|flat/i.test(e)?`-`:`+`],diode:[`d_v`,e=>/cathode|−|-|band|k\b/i.test(e)?`-`:`+`],crystal:[`xtal`,e=>/2|b\b/i.test(e)?`B`:`A`],supply:[`v`,e=>/−|-|gnd/i.test(e)?`-`:`+`]},Oy=e=>/coll/i.test(e)?`C`:/base/i.test(e)?`B`:`E`,ky=/\bout\d*\b|\(out\)|\btx\b|gpio|\bd\d+\b|pwm|echo|vout|5v out/i,Ay=e=>{let t=e.match(/^pin (\d+) \(([^)]+)\)/i);return t?`${t[1]} ${t[2]}`:e.replace(/\s*\(which pin is not visible\)/i,` ?`).replace(/\s*\(.*?\)\s*/g,` `).replace(/\s+/g,` `).trim().slice(0,24)||`pin`};function jy(e){let t={},n=new Map;e.nets.forEach((e,t)=>n.set(e.key,10+t));let r=t=>Object.keys(e.parts).find(n=>e.parts[n].role===t),i={};for(let t of e.nets)for(let e of t.pins){let a=r(e.part);a&&(i[a]||=[]).push({pin:e.pin,net:n.get(t.key)})}for(let[n,r]of Object.entries(e.parts)){let e=i[n];if(!e?.length)continue;let a=r.id||r.role,o=r.id&&r.role===r.id&&r.label.split(` · `)[1]||r.role,s=r.kind===`supply`&&r.label.split(` · `)[1]||``,c={ref:a,value:[r.id?o:``,o===r.value?``:r.value||s].filter(Boolean).join(` `)||`${r.role} (not seen)`},l=r.kind===`npn`?`npn`:r.kind;if(Dy[l]){let[r,i]=Dy[l],a={},o={};for(let{pin:t,net:n}of e){let e=i(t);a[e]=[n],o[e]=`input`}t[`${n}`]={type:r,port_directions:o,connections:a,attributes:c}}else if(l===`npn`){let r={},i={};for(let{pin:t,net:n}of e){let e=Oy(t);r[e]=[n],i[e]=e===`B`?`input`:`output`}t[n]={type:`q_npn`,port_directions:i,connections:r,attributes:c}}else{let i={},a={},s=new Map;for(let{pin:t,net:n}of e){let e=Ay(t),r=(s.get(e)||0)+1;s.set(e,r),r>1&&(e=`${e} ${r}`),i[e]=[n],a[e]=ky.test(t)?`output`:`input`}t[n]={type:`${o} ${r.id&&o!==r.id?r.id:``}`.trim(),port_directions:a,connections:i,attributes:c}}}for(let r of e.nets)/gnd|ground/i.test(r.key+r.name)?t[`gnd_${r.key}`]={type:`gnd`,port_directions:{A:`input`},connections:{A:[n.get(r.key)]},attributes:{name:`GND`}}:/^(vcc|vbat|pwr|v5)$/.test(r.key)&&(t[`vcc_${r.key}`]={type:`vcc`,port_directions:{A:`output`},connections:{A:[n.get(r.key)]},attributes:{name:r.name.replace(/ supply$/,``)}});return{modules:{genesis:{ports:{},cells:t}}}}var My=null,Ny=null;async function Py(){if(!My){let[e,t]=await Promise.all([b(()=>import(`./built-B4VPavbR.js`).then(e=>c(e.default,1)),[],import.meta.url),b(()=>import(`./analog-BqElR4AI.js`),[],import.meta.url)]);My=e.default||e,Ny=t.default}return{lib:My,skin:Ny}}async function Fy(e,t){let{lib:n,skin:r}=await Py(),i=jy(t);e.innerHTML=await n.render(r,i);let a=e.querySelector(`svg`);a.classList.add(`schem`,`schem-auto`);let o=parseFloat(a.getAttribute(`width`))||800,s=parseFloat(a.getAttribute(`height`))||600;return a.getAttribute(`viewBox`)||a.setAttribute(`viewBox`,`-10 -10 ${o+20} ${s+20}`),a.setAttribute(`preserveAspectRatio`,`xMidYMid meet`),a.removeAttribute(`width`),a.removeAttribute(`height`),t.nets.forEach((e,t)=>{let n=`net_${10+t}`;a.querySelectorAll(`.${n}`).forEach(t=>{t.dataset.net=e.key,t.style.stroke=e.color,t.tagName===`circle`&&(t.style.fill=e.color),t.classList.add(`w`)})}),Iy(a),{highlight(e){a.classList.toggle(`focus`,!!e),a.querySelectorAll(`[data-net]`).forEach(t=>t.classList.toggle(`on`,t.dataset.net===e))},svg(){let e=a.cloneNode(!0);return e.setAttribute(`xmlns`,`http://www.w3.org/2000/svg`),e.outerHTML.replace(/<svg([^>]*)>/,`<svg$1><rect width="100%" height="100%" fill="#fff"/>`)}}}function Iy(e){let t=e.getAttribute(`viewBox`).split(/[ ,]+/).map(Number),n=[...t],r=null,i=()=>e.setAttribute(`viewBox`,n.join(` `)),a=t=>{let r=e.getBoundingClientRect(),i=Math.max(n[2]/r.width,n[3]/r.height);return[n[0]+(t.clientX-r.left-(r.width-n[2]/i)/2)*i,n[1]+(t.clientY-r.top-(r.height-n[3]/i)/2)*i,i]};e.addEventListener(`wheel`,e=>{e.preventDefault();let[r,o]=a(e),s=e.deltaY>0?1.15:1/1.15,c=Math.min(t[2]*1.5,Math.max(t[2]/8,n[2]*s))/n[2];n=[r-(r-n[0])*c,o-(o-n[1])*c,n[2]*c,n[3]*c],i()},{passive:!1}),e.addEventListener(`pointerdown`,t=>{t.button!==0||t.target.closest(`.badge`)||(r={x:t.clientX,y:t.clientY,vb:[...n]},e.setPointerCapture(t.pointerId),e.classList.add(`panning`))}),e.addEventListener(`pointermove`,e=>{if(!r)return;let[,,t]=a(e);n=[r.vb[0]-(e.clientX-r.x)*t,r.vb[1]-(e.clientY-r.y)*t,n[2],n[3]],i()});let o=()=>{r=null,e.classList.remove(`panning`)};e.addEventListener(`pointerup`,o),e.addEventListener(`pointercancel`,o),e.addEventListener(`dblclick`,()=>{n=[...t],i()})}var Ly={House:Ao,Box:wo,Activity:Co,Sparkles:Vo,Folder:ko,CircuitBoard:Do,Settings:Ro,Cpu:Oo,Undo2:Uo,Play:Po,Plus:Fo,Share2:zo,Camera:To,Layers:Mo,RotateCw:Io,PanelRight:No,X:Go,ChevronDown:Eo,Send:Lo,Upload:Wo,Smartphone:Bo,Image:jo,Trash2:Ho},Ry=()=>Ko({icons:Ly,attrs:{"aria-hidden":`true`}});La.ticker.lagSmoothing(0);var Q=(e,t=document)=>t.querySelector(e),zy=(e,t=document)=>[...t.querySelectorAll(e)],By=matchMedia(`(prefers-reduced-motion: reduce)`).matches,Vy={research:`auto`,flash:`off`,backup:`on`,reader:`a student engineer`,theme:`paper`,labels:`on`,rotate:`on`,disabled:[],enabled:[]},Hy=(()=>{try{return{...Vy,...JSON.parse(localStorage.getItem(`genesis-prefs`)||`{}`)}}catch{return{...Vy}}})(),Uy=()=>{try{localStorage.setItem(`genesis-prefs`,JSON.stringify(Hy))}catch{}};document.documentElement.dataset.theme=Hy.theme;var Wy=[{id:`O1`,type:`ic`,marking:`NE555P`,box:[400,380,520,560]},{id:`O2`,type:`resistor`,bands:[`brown`,`black`,`red`,`gold`],display:`1 kΩ`,box:[220,150,280,300]},{id:`O3`,type:`resistor`,bands:[`brown`,`black`,`orange`,`gold`],display:`10 kΩ`,box:[220,620,280,770]},{id:`O4`,type:`resistor`,bands:[`yellow`,`violet`,`brown`,`gold`],display:`470 Ω`,box:[690,620,750,770]},{id:`O5`,type:`capacitor_electrolytic`,display:`100 µF`,box:[590,150,730,290]},{id:`O6`,type:`led`,box:[410,830,490,890]}],Gy=[`watch_video`,`observe_parts`,`match_patterns`,`check_prediction`,`list_unknowns`,`write_report`],Ky={watch_video:`Measuring the video frame by frame…`,observe_parts:`Reading the parts in the images…`,identify_parts:`Looking up part markings…`,match_patterns:`Matching known circuits…`,check_prediction:`Checking against the video…`,list_unknowns:`Listing what can't be settled…`,write_report:`Writing the cited report…`,confirm_value:`Recording your value and re-checking…`},qy={multimeter:`Multimeter`,oscilloscope:`Oscilloscope`,soldering_iron:`Soldering iron`,spare_resistors:`Spare resistors`,spare_capacitors:`Spare capacitors`,breadboard:`Breadboard`,bench_supply:`Bench power supply`,arduino:`Arduino (Uno, Nano…)`,esp:`ESP32 or ESP8266`,logic_probe:`Logic probe`,magnifier:`Magnifier or macro lens`},Jy={arduino:`Arduino`,esp32:`ESP32`,esp8266:`ESP8266`},Yy={resistor:`Resistors`,capacitor:`Capacitors`,ic:`ICs`,led:`LEDs`,semi:`Semis`,module:`Modules`,other:`Other`},Xy=e=>e===`resistor`?`resistor`:e.startsWith(`capacitor`)?`capacitor`:[`ic`,`voltage_regulator`].includes(e)?`ic`:e===`led`?`led`:[`transistor`,`mosfet`,`diode`,`optocoupler`].includes(e)?`semi`:[`dev_board`,`sensor_module`,`display`,`relay`].includes(e)?`module`:`other`,Zy=[1,1.2,1.5,1.8,2.2,2.7,3.3,3.9,4.7,5.6,6.8,8.2],$={view:`workspace`,sid:null,mode:`live`,es:null,snap:null,inputs:null,steps:{},busy:!1,pending:null,selected:null,stage:`model`,imageIdx:0,asked:!1,focusNet:null,sourcing:null,saved:!1,feedback:null,history:{},renamed:!1,files:{photos:[],video:null},meta:new Map,materials:new Set,reuse:null,overrides:{},undo:[],supply:null,sim:null,warnIdx:0,filter:`all`,lab:`sim`,assistTab:`chat`,ctx:null,lastSay:``},Qy=hy();Qy.setPrefs({labels:Hy.labels===`on`,rotate:Hy.rotate===`on`});var $y=_y(Q(`#scope`),e=>{Qy.signal=e||(e=>+(e*.686%1<.524))}),eb=yy(Q(`#sim-canvas`),Q(`#sim-legend`)),tb=e=>e==null?`—`:`${(+e).toFixed(3)} Hz`,nb=e=>e>=1e6?`${+(e/1e6).toPrecision(3)} MΩ`:e>=1e3?`${+(e/1e3).toPrecision(3)} kΩ`:`${+(+e).toPrecision(3)} Ω`;function rb(e,t=!1){if(e==null)return`—`;let[n,r]=[[1e-6,`µF`],[1e-9,`nF`],[1e-12,`pF`]].find(([t])=>e>=t)||[1e-12,`pF`],i=+(e/n).toPrecision(3);return t?`${i}${r.replace(`µ`,`u`)}`:`${i} ${r}`}var ib=e=>e==null?`—`:e<1?`${(e*1e3).toFixed(1)} mA`:`${e.toFixed(2)} A`,ab=e=>e==null?`—`:e<1?`${(e*1e3).toFixed(0)} mW`:`${e.toFixed(2)} W`,ob=e=>String(e||``).replace(/^capacitor_/,`capacitor · `).replace(/_/g,` `),sb={ic:`IC`,led:`LED`,ldr:`LDR`,mosfet:`MOSFET`,dev_board:`Dev board`,voltage_regulator:`Regulator`,sensor_module:`Sensor module`},cb=e=>sb[e]||(e.startsWith(`capacitor`)?`Capacitor`:ob(e).replace(/^./,e=>e.toUpperCase())),lb=e=>Z(e).replace(/\[((?:[A-Z]{1,2}\d+)(?:\s*,\s*[A-Z]{1,2}\d+)*)\]/g,(e,t)=>t.split(/\s*,\s*/).map(e=>`<button class="cite" data-ref="${e}">${e}</button>`).join(``)),ub=(e,t=[])=>(e||[]).map(e=>`<button class="cite ${t.includes(e)?`is-bad`:``}" data-ref="${Z(e)}">${Z(e)}</button>`).join(``),db=(e,t)=>`<div class="empty"><b>${e}</b><span>${t}</span></div>`,fb=e=>{let t=Date.now()/1e3-e;return t<60?`just now`:t<3600?`${Math.round(t/60)} min ago`:t<86400?`${Math.round(t/3600)} h ago`:`${Math.round(t/86400)} d ago`},pb=()=>$.snap?.components||[],mb=e=>pb().find(t=>t.id===e);function hb(e,t=3200){let n=Q(`#toast`);n.textContent=e,n.hidden=!1,La.fromTo(n,{y:16,opacity:0},{y:0,opacity:1,duration:.3}),clearTimeout(hb.t),hb.t=setTimeout(()=>La.to(n,{opacity:0,duration:.3,onComplete:()=>n.hidden=!0}),t)}function gb(e){if(!e?.image_url||!Array.isArray(e.box))return``;let[t,n,r,i]=e.box,a=(r-t)*.35+20,o=(i-n)*.35+20;t=Math.max(0,t-a),r=Math.min(1e3,r+a),n=Math.max(0,n-o),i=Math.min(1e3,i+o);let s=Math.max(1,i-n),c=Math.max(1,r-t),l=(e,t)=>t>=1e3?0:e/(1e3-t)*100;return`background-image:url('${e.image_url}');background-size:${1e3/s*100}% ${1e3/c*100}%;background-position:${l(n,s)}% ${l(t,c)}%`}var _b=(e,t)=>fetch(e,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify(t)});function vb(e){$.view=e,zy(`.nav-item[data-view], .bottom-nav [data-view]`).forEach(t=>t.classList.toggle(`is-active`,t.dataset.view===e)),zy(`.view`).forEach(t=>t.hidden=t.dataset.view!==e);let t=Q(`.view[data-view="${e}"]`);By||La.fromTo(t,{opacity:0,y:8},{opacity:1,y:0,duration:.35,ease:`power2.out`,clearProps:`transform`}),e===`workspace`&&yb(),e===`build`&&wx(),e===`components`&&Tx(),e===`lab`&&(Dx(),jx()),e===`system`&&vx(),e===`projects`&&Kx(),Q(`#ws-right`).classList.remove(`is-open`)}document.addEventListener(`click`,e=>{let t=e.target.closest(`[data-view]`);t&&!t.closest(`.view`)&&(e.preventDefault(),vb(t.dataset.view)),e.target.closest(`[data-assist]`)&&Px(!0),e.target.closest(`[data-new]`)&&Pb()});function yb(){$.sid?(Qy.mount(Q(`#stage-run`)),qb($.snap,!1)):(Qy.mount(Q(`#stage-hero`),{hero:!0}),Qy.setComponents(Wy,{animate:!1}))}function bb(e){Hy.theme=e,Uy(),document.documentElement.dataset.theme=e,zy(`[data-theme-set]`).forEach(t=>t.classList.toggle(`is-on`,t.dataset.themeSet===e)),eb.redraw(),$.stage===`schematic`&&mx(!0)}zy(`[data-theme-set]`).forEach(e=>e.addEventListener(`click`,()=>bb(e.dataset.themeSet))),bb(Hy.theme),Q(`#title`).addEventListener(`change`,async e=>{$.sid&&($.renamed=!0,await _b(`/api/investigations/${$.sid}/title`,{title:e.target.value}),hb(`Renamed.`))}),Q(`#title`).addEventListener(`keydown`,e=>{e.key===`Enter`&&e.target.blur()}),Q(`#run-btn`).addEventListener(`click`,()=>$.sid?tx(!0):jb()),Q(`#new-btn`).addEventListener(`click`,Pb),Q(`#undo-btn`).addEventListener(`click`,ex);function xb(){Q(`#run-label`).textContent=$.sid?`Simulate`:`Run`,Q(`#new-btn`).hidden=!$.sid,Q(`#share-btn`).hidden=!$.sid,$.sid&&(Q(`#share-btn`).href=`${location.origin}/#report/${$.sid}`),Q(`#undo-btn`).hidden=!$.undo.length;let e=$.snap?.device;Q(`#device-chip`).hidden=!e?.kind,e?.kind&&(Q(`#device-chip`).textContent=e.kind)}function Sb(){Q(`#materials`).innerHTML=Object.entries(qy).map(([e,t])=>`<button type="button" class="chip" data-mat="${e}" aria-pressed="${$.materials.has(e)}">${Z(t)}</button>`).join(``)}Sb(),Q(`#materials`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-mat]`);t&&($.materials.has(t.dataset.mat)?$.materials.delete(t.dataset.mat):$.materials.add(t.dataset.mat),t.setAttribute(`aria-pressed`,$.materials.has(t.dataset.mat)))});function Cb(e){let t=0;for(let n of e){if(n.type.startsWith(`image/`)){if($.files.photos.length+($.reuse?.photos.length||0)>=2){t++;continue}$.files.photos.push(n)}else n.type.startsWith(`video/`)||/\.(mp4|mov|m4v|webm|avi)$/i.test(n.name)?$.files.video=n:t++;$.meta.has(n)||wb(n)}t&&hb(`Skipped ${t} file${t>1?`s`:``}: up to 2 photos and 1 video.`),Tb()}async function wb(e){let t=URL.createObjectURL(e),n={url:t,warn:[]};if($.meta.set(e,n),e.type.startsWith(`image/`)){let e=new jo;e.src=t;try{await e.decode()}catch{n.warn.push(`can't be opened`),Tb();return}n.dims=`${e.naturalWidth}×${e.naturalHeight}`,Math.max(e.naturalWidth,e.naturalHeight)<1e3&&n.warn.push(`small: fine markings may be unreadable`);let r=Math.round(480*e.naturalHeight/e.naturalWidth),i=document.createElement(`canvas`);i.width=480,i.height=r;let a=i.getContext(`2d`,{willReadFrequently:!0});a.drawImage(e,0,0,480,r);let o=a.getImageData(0,0,480,r).data,s=new Float32Array(480*r),c=0;for(let e=0;e<480*r;e++)s[e]=.299*o[e*4]+.587*o[e*4+1]+.114*o[e*4+2],c+=s[e];let l=0,u=0,d=0;for(let e=1;e<r-1;e++)for(let t=1;t<479;t++){let n=e*480+t,r=4*s[n]-s[n-1]-s[n+1]-s[n-480]-s[n+480];u+=r,d+=r*r,l++}d/l-(u/l)**2<25&&n.warn.push(`may be blurry`);let f=c/(480*r);f<55?n.warn.push(`dark`):f>215&&n.warn.push(`overexposed`)}else{let e=document.createElement(`video`);if(e.preload=`metadata`,e.muted=!0,e.src=t,await new Promise(t=>{e.onloadedmetadata=t,e.onerror=t,setTimeout(t,4e3)}),e.duration&&isFinite(e.duration)){n.dims=`${e.duration.toFixed(1)} s`,e.duration<2?n.warn.push(`under 2 s: too short`):e.duration<5&&n.warn.push(`short: few blink cycles`),e.duration>30&&n.warn.push(`only the first 30 s are measured`),e.currentTime=Math.min(1,e.duration/2),await new Promise(t=>{e.onseeked=t,setTimeout(t,1500)});try{let t=document.createElement(`canvas`);t.width=160,t.height=90,t.getContext(`2d`).drawImage(e,0,0,160,90),n.thumb=t.toDataURL(`image/jpeg`,.7)}catch{}}else n.warn.push(`can't preview here; MP4 (H.264) is safest`)}Tb()}function Tb(){let e=$.reuse?$.reuse.photos.length:0,t=$.reuse?[...$.reuse.photos.map((e,t)=>`<li class="file"><img class="thumb" src="${Z(e)}" alt=""><span><b>${t?`Back photo`:`Front photo`}</b><small>kept from the earlier run</small></span><span></span></li>`),...$.reuse.video&&!$.files.video?[`<li class="file"><span class="thumb"></span><span><b>Video</b><small>kept from the earlier run</small></span><span></span></li>`]:[]]:[],n=[...$.files.photos.map((t,n)=>({f:t,role:n+e?`Back photo`:`Front photo`,kind:`photo`,i:n})),...$.files.video?[{f:$.files.video,role:`Video`,kind:`video`}]:[]];Q(`#file-list`).innerHTML=t.join(``)+n.map(e=>{let t=$.meta.get(e.f)||{},n=e.kind===`photo`?t.url:t.thumb;return`<li class="file">${n?`<img class="thumb" src="${n}" alt="">`:`<span class="thumb"></span>`}
      <span><b>${e.role}</b><small>${Z(e.f.name)}${t.dims?` · ${t.dims}`:``}</small>${t.warn?.length?`<small class="warn">${Z(t.warn.join(`; `))}</small>`:``}</span>
      <span class="file-actions">${e.kind===`photo`&&$.files.photos.length===2?`<button type="button" class="mini" data-swap title="Swap front and back">⇅</button>`:``}
      <button type="button" class="mini" data-remove="${e.kind}:${e.i??0}" title="Remove">×</button></span></li>`}).join(``),Ob()}Q(`#file-list`).addEventListener(`click`,e=>{e.target.closest(`[data-swap]`)&&$.files.photos.reverse();let t=e.target.closest(`[data-remove]`)?.dataset.remove;if(t){let[e,n]=t.split(`:`);e===`photo`?$.files.photos.splice(+n,1):$.files.video=null}Tb()});var Eb=Q(`#drop`);Q(`#files`).addEventListener(`change`,e=>{Cb([...e.target.files]),e.target.value=``}),[`dragenter`,`dragover`].forEach(e=>Eb.addEventListener(e,e=>{e.preventDefault(),Eb.classList.add(`is-drag`)})),[`dragleave`,`drop`].forEach(e=>Eb.addEventListener(e,()=>Eb.classList.remove(`is-drag`))),Eb.addEventListener(`drop`,e=>{e.preventDefault(),Cb([...e.dataTransfer.files])});function Db(){let[e,t]=[...$.reuse?$.reuse.photos.map(e=>({kept:e})):[],...$.files.photos],n=$.files.video||($.reuse?.video?{kept:1}:null),r=e=>e&&!e.kept&&$.meta.get(e)?.warn?.length?$.meta.get(e).warn.join(`; `):``;return{items:[e?{st:r(e)?`warn`:`ok`,label:`Front photo`,text:r(e)||`given`}:{st:`miss`,label:`Front photo`,text:n?`missing: parts read from small video frames`:`missing`},t?{st:r(t)?`warn`:`ok`,label:`Back photo`,text:r(t)||`given`}:{st:`miss`,label:`Back photo`,text:`missing: wiring inferred, not traced`},n?{st:r(n)?`warn`:`ok`,label:`Video`,text:r(n)||`given`}:{st:`miss`,label:`Video`,text:`missing: behaviour can't be measured or checked`}],verdict:!e&&!n?`Add at least a photo or a video to start.`:n?e?t?`Ready: front, back and video.`:`Ready. A back photo would let GENESIS trace the wiring.`:`Can time the device; parts will be less certain without a photo.`:`Can identify the parts and the circuit, but can't check it against the device.`,ok:!!(e||n)}}function Ob(){let e=Db(),t={ok:`✓`,warn:`!`,miss:`–`};Q(`#ready`).innerHTML=e.items.map(e=>`<li class="${e.st}"><span class="mark">${t[e.st]}</span><b>${e.label}</b><span>${Z(e.text)}</span></li>`).join(``),Q(`#ready-verdict`).textContent=e.verdict}Ob();function kb(e){e.append(`note`,Q(`#note`).value),e.append(`reader`,Hy.reader);for(let t of $.materials)e.append(`materials`,t);return e.append(`materials_other`,Q(`#materials-other`).value),e.append(`research`,Hy.research),e.append(`backup`,Hy.backup),Hy.flash===`on`&&e.append(`flash`,`on`),Hy.disabled.forEach(t=>e.append(`disable`,t)),Hy.enabled.forEach(t=>e.append(`enable`,t)),e}async function Ab(e,t){Q(`#form-msg`).textContent=``;let n=zy(`#intake button, #run-btn`);n.forEach(e=>e.disabled=!0);let r=e.get(`mode`)===`live`,i=Q(`#start-status`),a=Date.now(),o=r?`upload`:`start`,s=(e=null)=>{Q(`#start-time`).textContent=Vb(Date.now()-a),o===`upload`?(Q(`#start-text`).textContent=e==null?`Uploading…`:`Uploading your evidence · ${Math.round(e*100)}%`,Q(`#start-fill`).style.width=`${Math.round((e||0)*100)}%`,Q(`#start-hint`).textContent=`Photos and video are sent to GENESIS running on this computer.`):(Q(`#start-text`).textContent=r?`Starting the agents`+(Hy.research===`off`?`…`:` and web-search tools…`):t,Q(`#start-fill`).style.width=`100%`,Q(`#start-hint`).textContent=r?`Checking the photos and video, then building the agent team. The first run can take a minute while free search tools download; later runs start in seconds.`:`Drawing the sample board and starting the scripted agents.`)};i.hidden=!1,s();let c=setInterval(()=>s(),1e3);Q(`#run-label`).textContent=r?`Uploading…`:`Loading…`;try{let t=await ke(e);if(!t.ok)throw Error(t.d.error||`HTTP ${t.status}`);$.reuse=null,Q(`#reuse`).hidden=!0,$.files={photos:[],video:null},Tb(),$.uploadMs=Date.now()-a,Nb(t.d.id,t.d.mode)}catch(e){Q(`#form-msg`).textContent=e.message===`Failed to fetch`?`The server isn't running: start it with start.ps1`:e.message}finally{clearInterval(c),i.hidden=!0,n.forEach(e=>e.disabled=!1),Q(`#run-label`).textContent=$.sid?`Simulate`:`Run`}}function jb(){if(!Db().ok){Q(`#form-msg`).textContent=`Add at least a photo or a video, or try a sample.`,La.fromTo(`#drop`,{x:-6},{x:0,duration:.5,ease:`elastic.out(1, 0.3)`});return}let e=kb(new FormData);e.append(`mode`,`live`),$.reuse&&e.append(`from`,$.reuse.sid),$.files.photos.forEach(t=>e.append(`photos`,t)),$.files.video&&e.append(`video`,$.files.video),Ab(e,`Starting the agents…`)}Q(`#go-live`).addEventListener(`click`,jb),zy(`[data-sample]`).forEach(e=>e.addEventListener(`click`,()=>{let t=kb(new FormData);t.append(`mode`,`demo`),t.append(`sample`,e.dataset.sample),Ab(t,`Loading the sample…`)}));function Mb(e){let t=$.snap||{};$.reuse={sid:e,photos:(t.photo_urls||[]).filter(Boolean),video:t.video_url||null,title:Q(`#title`).value},$.files={photos:[],video:null},Q(`#note`).value=t.note||``;let n=Object.entries(qy);$.materials=new Set((t.materials||[]).map(e=>n.find(([,t])=>t===e)?.[0]).filter(Boolean)),Sb(),Pb(!1),Q(`#reuse`).hidden=!1,Q(`#reuse-title`).textContent=$.reuse.title,Tb()}Q(`#reuse-cancel`).addEventListener(`click`,()=>{$.reuse=null,Q(`#reuse`).hidden=!0,Tb()});function Nb(e,t){$.es?.close();let n=$.history[e]||{};Object.assign($,{sid:e,mode:t,snap:null,inputs:null,steps:{},busy:!n.saved,pending:null,selected:null,imageIdx:0,asked:!1,focusNet:null,sourcing:null,saved:!!n.saved,feedback:n.rating?{rating:n.rating}:null,overrides:{},undo:[],supply:null,sim:null,warnIdx:0,filter:`all`,ctx:null,lastSay:``,renamed:!!(n.title&&n.title!==n.circuit&&n.title!==`Investigation`),stepStart:{},stepEnd:{},runStart:null,runEnd:null,error:null,clockOffset:null}),Q(`#title`).value=n.title&&n.title!==`Investigation`?n.title:`Untitled board`,Q(`#intake`).hidden=!0,Q(`#ws`).hidden=!1,Q(`#chat`).innerHTML=``,Q(`#activity`).innerHTML=``,Q(`#report`).innerHTML=``,Q(`#supply`).value=``,ox(`model`),vb(`workspace`),qb(null),t===`demo`&&Lx(`Sample: the real pipeline runs on a generated board; only the model replies are scripted (free).`),xb(),Rb();let r=ne(e);$.es=r,r.onmessage=e=>Lb(JSON.parse(e.data))}function Pb(e=!0){$.es?.close(),Object.assign($,{sid:null,snap:null,busy:!1,pending:null,overrides:{},undo:[]}),e&&($.reuse=null,Q(`#reuse`).hidden=!0),Q(`#title`).value=`Untitled board`,Q(`#ws`).hidden=!0,Q(`#intake`).hidden=!1,Q(`#progress`).hidden=!0,Q(`#usage`).textContent=``,Q(`#ctx-chip`).hidden=!0,Px(!1),vb(`workspace`),xb()}var Fb=e=>e.ts?e.ts*1e3:Date.now(),Ib=()=>Date.now()-($.clockOffset??0);function Lb(e){switch(e.ts&&($.clockOffset=Math.min($.clockOffset??1/0,Date.now()-e.ts*1e3)),e.type){case`log`:for(let t of e.lines||[])Rx(Z(t));break;case`inputs`:$.inputs=e.inputs,Yb();break;case`usage`:Gb(e.usage);break;case`busy`:$.busy=e.busy,e.busy?($.error=null,(!$.runStart||$.runEnd)&&($.runStart=Fb(e),$.runEnd=null)):(Qy.setScanning(!1),$.runEnd=Fb(e)),Rb();break;case`call`:{let t=Object.entries(e.args||{}).map(([e,t])=>`${e}=${Z(JSON.stringify(t))}`).join(`, `);Rx(`→ <b>${Z(e.name)}</b>(${t})`),$.steps[e.name]=`run`,$.stepStart[e.name]=Fb(e),e.name===`observe_parts`&&Qy.setScanning(!0),Rb();break}case`result`:{Rx(Z(e.text.length>300?e.text.slice(0,300)+`…`:e.text));let t=e.name===`watch_video`&&/^No video/.test(e.text)||e.name===`check_prediction`&&/not possible/.test(e.text);$.steps[e.name]=t?`skip`:`done`,$.stepEnd[e.name]=Fb(e),e.name===`observe_parts`&&Qy.setScanning(!1),Rb();break}case`say`:Ix(`ai`,lb(e.text)),$.lastSay=e.text,Yb(),$.asked&&Px(!0,`chat`);break;case`user`:Ix(`user`,Z(e.text));break;case`state`:$.snap=e.state,qb(e.state),Rb();break;case`approval`:$.pending=e.request,Ux(e.request),Rb();break;case`decided`:Rx(`You chose: ${Z(e.decision)}.`);break;case`error`:$.error=e.text,Rx(Z(e.text),!0),hb(`The agent stopped with an error: see Assistant › Activity.`),Wb()}}function Rb(){let e=Gy.filter(e=>$.steps[e]===`done`).length,t=Object.entries($.steps).find(([,e])=>e===`run`)?.[0],n=Q(`#progress`);n.hidden=!$.sid,Q(`#progress-text`).textContent=$.pending?`Waiting for your approval`:$.busy?Ky[t]||`Starting…`:$.snap?.skeptic?`Done · ask anything`:$.saved?`Saved investigation`:`Idle`,Q(`#progress-fill`).style.width=`${$.snap?.skeptic&&!$.busy?100:Math.round(e/Gy.length*100)}%`,Q(`#ask-input`).disabled=$.busy||!!$.pending||$.saved||!$.sid,Q(`#ask-input`).placeholder=$.sid?$.saved?`Saved run: re-run it to ask more`:`Ask Genesis anything…`:`Start an investigation to ask Genesis…`,Vx(),Wb()}var zb=[{id:`upload`,label:`Upload`},{id:`watch_video`,label:`Measure video`},{id:`observe_parts`,label:`Read parts`},{id:`identify_parts`,label:`Look up`,optional:!0},{id:`match_patterns`,label:`Match circuit`},{id:`check_prediction`,label:`Check`},{id:`list_unknowns`,label:`Unknowns`},{id:`write_report`,label:`Report`},{id:`simulate`,label:`Simulate`}],Bb=e=>e<6e4?`${(Math.max(0,e)/1e3).toFixed(+(e<1e4))} s`:Vb(e),Vb=e=>{let t=Math.max(0,Math.round(e/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,`0`)}`};function Hb(e){let t=$.snap||{},n=t.inputs||$.inputs;switch(e){case`upload`:return n?`${n.evidence} of 3 given${$.uploadMs&&!$.saved?` · ${Vb($.uploadMs)}`:``}`:``;case`watch_video`:{if(!t.video_checked)return``;if(!t.video_path)return`no video`;let e=t.video?.regions?.find(e=>e.analysis?.periodic);return e?`${e.analysis.frequency_hz.toFixed(2)} Hz`:t.video?`no steady blink`:`unreadable`}case`observe_parts`:return t.observed?`${pb().length} parts`:``;case`identify_parts`:return t.identified?`${(t.datasheets||[]).length} found`:``;case`match_patterns`:return t.patterns?t.patterns.top?t.patterns.top.name.replace(/\s*\(.*\)$/,``):`no match`:``;case`check_prediction`:return t.check?t.check.available?t.check.verdict.toLowerCase():`not possible`:``;case`list_unknowns`:return t.unknowns?`${t.unknowns.length} open`:``;case`write_report`:return t.skeptic?`${t.skeptic.flagged}/${t.skeptic.claims} flagged`:``;case`simulate`:{let e=$.sim;if(!e)return``;if(!e.available)return`no model`;let t=(e.warnings||[]).filter(e=>e.level!==`info`).length;return t?`${t} warning${t>1?`s`:``}`:`all OK`}}return``}function Ub(e){let t=$.snap||{};if(e===`upload`)return $.sid?`done`:``;if(e===`simulate`)return $.sim?$.sim.available?`done`:`skip`:$.snap?.skeptic?`skip`:``;let n=$.steps[e];return n===`run`&&$.busy?`run`:n===`skip`||e===`watch_video`&&t.video_checked&&!t.video_path||e===`check_prediction`&&t.check&&!t.check.available?`skip`:n===`done`||n===`run`?`done`:``}function Wb(){if(!$.sid)return;let e=zb.filter(e=>!e.optional||$.steps[e.id]),t=e.find(e=>Ub(e.id)===`run`),n=t?e.indexOf(t)+1:0;Q(`#rs-steps`).innerHTML=e.map((e,t)=>{let n=Ub(e.id),r=Hb(e.id),i=n===`run`&&$.stepStart[e.id]?` · ${Vb(Ib()-$.stepStart[e.id])}`:``,a=n===`done`&&$.stepStart[e.id]&&$.stepEnd[e.id]?` · ${Bb($.stepEnd[e.id]-$.stepStart[e.id])}`:``;return`<li class="rs-step is-${n||`todo`}" title="${Z(e.label)}${r?`: ${Z(r)}`:``}"><span class="rs-dot">${n===`done`?`✓`:n===`skip`?`–`:t+1}</span>
      <b>${Z(e.label)}</b><small>${n===`run`?`working${i}`:Z(r||(n===`skip`?`skipped`:``))+a}</small></li>`}).join(``);let r=Q(`#rs-spin`),i=Q(`#runstrip`),a,o=``,s=``;$.error&&!$.busy?(a=`Stopped with an error`,o=`see Assistant › Activity`,s=`is-err`):$.pending?(a=`Waiting for your approval`,o=`${$.pending.args?.component_id} = ${$.pending.args?.value}`,s=`is-wait`):$.busy&&t?a=`Step ${n} of ${e.length} · ${Ky[t.id]||t.label}`:$.busy?(a=$.steps.write_report===`done`?`Genesis is answering…`:`Genesis is planning the next step…`,o=`the coordinator decides what evidence to gather next`):$.snap?.skeptic?(a=`Investigation complete`,o=$.saved?`saved run`:`ask Genesis anything, or try a what-if`,s=`is-done`):$.saved?(a=`Saved investigation`,s=`is-idle`):a=`Starting…`,Q(`#rs-title`).textContent=a,Q(`#rs-sub`).textContent=o,r.className=`rs-spin ${s}`,i.classList.toggle(`is-done`,s===`is-done`);let c=$.busy||$.pending?Ib():$.runEnd;Q(`#rs-time`).textContent=$.runStart&&c?$.busy||$.pending?Vb(c-$.runStart):`took ${Bb(c-$.runStart)}`:``;let l=Q(`#stage-status`);l.hidden=!($.busy||$.pending),Q(`#stage-status-text`).textContent=a,l.querySelector(`.rs-spin`).className=`rs-spin ${s}`}setInterval(()=>{$.sid&&($.busy||$.pending)&&Wb()},1e3);function Gb(e){let t=t=>e?.[t]||0,n=t(`gemini_lite`)+t(`gemini_flash`);Q(`#usage`).textContent=$.mode===`demo`?t(`scripted`)?`${t(`scripted`)} scripted calls · free`:``:n||t(`groq`)||t(`ollama`)?`${n} Gemini${t(`groq`)?` · ${t(`groq`)} Groq`:``}${t(`ollama`)?` · ${t(`ollama`)} Ollama`:``} calls`:``}function Kb(e){let t=$.overrides[e.id];if(!t)return e;let n=e.type===`resistor`?/[Ωa-z]/i.test(t)?``:` Ω`:/[a-zµ]/i.test(t)?``:` F`;return{...e,display:`${t}${n}`}}function qb(e,t=!0){if(xb(),!e)Qy.setComponents([],{animate:!1}),$y.set(null),$.sim=null,Yb(),Xb(),Qb(),nx(),ix(),ax();else{Qy.setComponents(pb().map(Kb),{animate:t,changing:e.changing_region?.component_id||null}),Jb(),$y.set(e.video),!Object.keys($.overrides).length&&$.supply==null&&($.sim=e.simulation||null),!$.renamed&&e.patterns?.top&&(Q(`#title`).value=e.patterns.top.name),Q(`#stage-note`).textContent=$.stage===`model`?e.observed?`${pb().length} parts placed where the observer saw them · wiring not drawn in 3D`:e.video_checked?`Reading the parts…`:`Measuring the video…`:Q(`#stage-note`).textContent,Yb(),Xb(),Qb(),nx(),ix(),ax(),zx(),$.stage===`photos`&&yx(),$.stage===`schematic`&&mx(),$.view===`build`&&wx(),$.view===`components`&&Tx(),$.view===`system`&&vx(),$.stage===`layers`&&gx(Q(`#layers-stage`),!0);for(let[t,n]of Object.entries({watch_video:e.video_checked,observe_parts:e.observed,match_patterns:e.patterns,check_prediction:e.check,list_unknowns:e.unknowns,write_report:e.report}))n&&$.steps[t]!==`run`&&($.steps[t]=`done`)}}function Jb(){for(let e of Qy.items||[])e.tag?.classList.toggle(`is-whatif`,!!$.overrides[e.c.id])}function Yb(){let e=$.snap||{},t=e.patterns,n=e.check,r=Q(`#result-card`),i=``;if(t?.top)i+=`<p class="kicker">Most likely · ${Z(t.confidence.toLowerCase())} fit</p><h2>${Z(t.top.name)}</h2><p class="sum" title="${Z(t.top.summary)}">${Z(t.top.summary)}</p>`;else if(t)i+=`<p class="kicker">Result</p><h2>No known circuit fits</h2><p>The parts are listed, but none of the known circuits has enough clues.</p>`;else{let e=Object.entries($.steps).find(([,e])=>e===`run`)?.[0];i+=`<p class="kicker">${$.busy?`Working`:`Waiting`}</p><h2>${Z(Ky[e]||($.busy?`Starting…`:`Not started`))}</h2>`}n&&(n.available?n.verdict===`INFERRED`?i+=`<span class="verdict v-INFERRED">INFERRED</span><p>${Z(n.inferred.text)}. Confirm it in the assistant.</p>`:i+=`<span class="verdict v-${n.verdict}">${n.verdict}</span><p>Parts predict <b>${tb(n.predicted.frequency_hz)}</b>, video measured <b>${tb(n.measured.frequency_hz)}</b> (${n.error_pct}% apart, ±${n.tolerance_pct}% allowed).</p>`:i+=`<span class="verdict v-SKIPPED">NOT CHECKED</span><p>${Z(n.reason)}.</p>`),t?.supporting?.length&&(i+=`<p class="also">Also on the board: ${t.supporting.map(e=>`<b>${Z(e.name)}</b>`).join(`, `)}</p>`);let a=e.system;a?.is_system&&(i+=`<p class="also"><b>Layers:</b> ${a.layers.filter(e=>e.key!==`support`).map(e=>`${Z(e.name)} (${e.parts.length})`).join(` → `)} <button class="link" data-view-go="system">System view</button></p>`),$.lastSay&&(i+=`<p class="also"><b>Genesis:</b> ${lb($.lastSay.length>140?$.lastSay.slice(0,140)+`…`:$.lastSay)}</p>`),e.skeptic&&(i+=`<div class="result-actions"><button class="pill pill-sm" data-open-report>Read report</button><button class="pill pill-sm" data-view-go="build">Build it</button>
    ${$.saved?`<button class="pill pill-sm" data-rerun>Re-run</button>`:``}</div>`),r.innerHTML=i}Q(`#result-card`).addEventListener(`click`,e=>{e.target.closest(`[data-open-report]`)&&Px(!0,`report`);let t=e.target.closest(`[data-view-go]`);t&&vb(t.dataset.viewGo),e.target.closest(`[data-rerun]`)&&($.mode===`demo`?Pb():Mb($.sid))});function Xb(){let e=pb(),t=[...new Set(e.map(e=>Xy(e.type)))];Q(`#comp-count`).textContent=e.length?`${e.length} parts`:``,$.filter!==`all`&&!t.includes($.filter)&&($.filter=`all`),Q(`#comp-filter`).innerHTML=e.length?[[`all`,`All`],...t.map(e=>[e,Yy[e]])].map(([e,t])=>`<button class="chip ${$.filter===e?`is-on`:``}" data-filter="${e}">${t}</button>`).join(``):``;let n=e.filter(e=>$.filter===`all`||Xy(e.type)===$.filter);Q(`#comp-tiles`).innerHTML=n.length?n.map(e=>{let t=Kb(e);return`<button class="tile st-${e.status||`OBSERVED`} ${$.selected===e.id?`is-on`:``}" data-pick="${e.id}">
      <span class="sw" style="${gb(e)}"></span><span><b>${Z(cb(e.type))}</b><small>${e.id}${t.display||e.marking?` · ${Z(t.display||e.marking)}`:``}</small></span></button>`}).join(``):`<p class="muted">${$.snap?.observed?`No parts were reported.`:`Parts appear once the observer has looked.`}</p>`}Q(`#comp-filter`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-filter]`);t&&($.filter=t.dataset.filter,Xb())}),Q(`#comp-tiles`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-pick]`);t&&Zb(t.dataset.pick)});function Zb(e,t=!1){$.selected=$.selected===e&&t?null:e,t||Qy.select($.selected);let n=mb($.selected);$.ctx=n?{id:n.id,label:`${n.id} · ${Kb(n).display||n.marking||ob(n.type)}`}:null,Q(`#ctx-chip`).hidden=!$.ctx,$.ctx&&(Q(`#ctx-chip`).innerHTML=`Context: ${Z($.ctx.label)} <span data-clear-ctx style="cursor:pointer">×</span>`),Xb(),Qb(),Vx(),$.selected&&Q(`#props-card`).scrollIntoView({block:`nearest`,behavior:By?`auto`:`smooth`}),zy(`.pbox`).forEach(e=>e.classList.toggle(`is-selected`,e.dataset.id===$.selected))}Qy.onSelect=e=>Zb(e,!0),Q(`#ctx-chip`).addEventListener(`click`,e=>{e.target.closest(`[data-clear-ctx]`)&&Zb(null)});function Qb(){let e=mb($.selected);if(Q(`#props-state`).hidden=!e,!e){Q(`#props-title`).textContent=`Properties`,Q(`#props-body`).innerHTML=`<p class="muted">Select a part on the board or in Components.</p>`;return}let t=Kb(e),n=$.sim?.parts?.[e.id]||{},r=e.type===`resistor`||e.type.startsWith(`capacitor`),i=$.overrides[e.id];Q(`#props-title`).textContent=`${cb(e.type)} (${e.id})`;let a=[];r?a.push(`<div class="prow"><span>${e.type===`resistor`?`Resistance`:`Capacitance`}</span><input id="prop-value" class="${i?`is-whatif`:``}" value="${Z(i||(e.value?e.type===`resistor`?nb(e.value.value):rb(e.value.value):``))}" placeholder="e.g. ${e.type===`resistor`?`470`:`47uF`}" /></div>`):(e.marking||t.display)&&a.push(`<div class="prow"><span>Marking</span><b>${Z(e.marking||t.display)}</b></div>`),e.value&&a.push(`<div class="prow"><span>Read from</span><b>${Z(e.value.basis)}${e.bands&&e.value.basis===`colour bands`?`: ${Z(e.bands.join(` `))}`:``}</b></div>`),e.value?.tolerance_pct&&a.push(`<div class="prow"><span>Tolerance</span><b>±${e.value.tolerance_pct}%</b></div>`),n.current_a!=null&&a.push(`<div class="prow"><span>Current</span><b>${ib(n.current_a)}${n.rating_a?` / ${ib(n.rating_a)}`:``}</b></div>`),n.power_w!=null&&a.push(`<div class="prow"><span>Power</span><b>${ab(n.avg_power_w??n.power_w)} / ${ab(n.rating_w)}</b></div>`),n.voltage_v!=null&&a.push(`<div class="prow"><span>Voltage</span><b>${n.voltage_v.toFixed(1)} V${n.rating_v?` / ${n.rating_v} V`:``}</b></div>`),a.push(`<div class="prow"><span>Status</span><b><span class="st st-${e.status||`OBSERVED`}">${e.status||`OBSERVED`}</span> ${Z(e.confidence||``)}</b></div>`);let o=($.snap?.datasheets||[]).filter(t=>t.component_id===e.id);Q(`#props-body`).innerHTML=`${gb(e)?`<div class="crop" style="${gb(e)}"></div>`:``}<div class="props">${a.join(``)}</div>
    <p class="prop-ev">${Z(e.evidence||``)}</p>
    ${o.map(e=>`<p class="prop-ev"><b>${Z(e.identity)}</b> · ${Z(e.function)} ${(e.sources||[]).slice(0,2).map(e=>`<a href="${Z(e)}" target="_blank" rel="noopener">source</a>`).join(` `)}</p>`).join(``)}
    <div class="prop-actions">
      ${i?`<button class="pill pill-sm" data-record>Record ${Z(i)}</button><button class="pill pill-sm" data-reset="${e.id}">Reset</button>`:``}
      <button class="pill pill-sm" data-ask-about>Ask about it</button></div>
    ${i?`<p class="hint" style="margin-top:6px">What-if: simulated only. "Record" asks you to approve it as the real value.</p>`:``}`}Q(`#props-body`).addEventListener(`change`,e=>{e.target.id===`prop-value`&&$.selected&&$b($.selected,e.target.value.trim())}),Q(`#props-body`).addEventListener(`keydown`,e=>{e.target.id===`prop-value`&&e.key===`Enter`&&e.target.blur()}),Q(`#props-body`).addEventListener(`click`,e=>{let t=mb($.selected);e.target.closest(`[data-reset]`)&&$b($.selected,``),e.target.closest(`[data-record]`)&&t&&Hx(`${t.id} is ${$.overrides[t.id]}`),e.target.closest(`[data-ask-about]`)&&Q(`#ask-input`).focus()});function $b(e,t){let n=mb(e),r=n?.value?n.type===`resistor`?nb(n.value.value):rb(n.value.value):``;$.undo.push({...$.overrides}),!t||t===r?delete $.overrides[e]:$.overrides[e]=t,tx()}function ex(){$.undo.length&&($.overrides=$.undo.pop(),tx(),hb(`Undone.`))}async function tx(e=!1){if(!$.sid)return;e&&(vb(`workspace`),rx(`sim`));let t=Q(`#supply`).value?+Q(`#supply`).value:null;$.supply=t;try{let e=await _b(`/api/investigations/${$.sid}/simulate`,{overrides:$.overrides,supply:t}),n=await e.json();if(!e.ok)throw Error(n.error);$.sim=n}catch(e){hb(e.message||`Simulation failed.`);return}$.warnIdx=0,Qy.setComponents(pb().map(Kb),{animate:!1,changing:$.snap?.changing_region?.component_id||null}),Jb(),Xb(),Qb(),nx(),ix(!0),Vx(),xb(),Wb(),$.sim?.warnings?.some(e=>e.level!==`info`)&&Q(`#warn-card`).scrollIntoView({block:`nearest`,behavior:By?`auto`:`smooth`})}Q(`#sim-run`).addEventListener(`click`,()=>tx()),Q(`#supply`).addEventListener(`change`,()=>tx());function nx(){let e=Q(`#warn-card`),t=$.sim,n=$.snap?.check,r=[...t?.warnings||[]];if(n?.verdict===`CONTRADICTED`)for(let e of n.suggestions||[])r.push({level:`warn`,part:e.component,text:e.text,fix:null,check:!0});if(!$.snap?.patterns){e.hidden=!0;return}if(!r.length){e.hidden=!t?.available,e.className=`warn-card is-ok`,e.innerHTML=`<h3>All parts within their ratings</h3><p>${Object.keys($.overrides).length?`With your what-if values. `:``}Simulated at ${t?.supply?.volts??`?`} V (${Z(t?.supply?.source||``)}).</p>`;return}$.warnIdx%=r.length;let i=r[$.warnIdx];e.hidden=!1,e.className=`warn-card ${i.level===`info`?`is-info`:``}`,e.innerHTML=`<h3>${i.check?`Check against the video`:i.level===`info`?`Simulation note`:`Simulation warning`}
      ${r.length>1?`<button class="more" data-next-warn>${$.warnIdx+1} of ${r.length} ›</button>`:``}</h3>
    <p>${i.part?`<b>${Z(i.part)}</b> · `:``}${Z(i.text)}</p>
    ${i.fix?.component?`<button class="fix" data-fix>Fix this: ${Z(i.fix.component)} → ${Z(i.fix.display)}</button>`:i.fix?.text?`<p style="margin:0;font-weight:600;color:#f6e3c9">Fix: ${Z(i.fix.text)}</p>`:``}`,e._w=i,By||La.fromTo(e,{scale:.98},{scale:1,duration:.3})}Q(`#warn-card`).addEventListener(`click`,e=>{e.target.closest(`[data-next-warn]`)&&($.warnIdx++,nx());let t=Q(`#warn-card`)._w;e.target.closest(`[data-fix]`)&&t?.fix&&($b(t.fix.component,t.fix.display.replace(/\s/g,``).replace(`Ω`,``)),hb(`Simulating ${t.fix.component} = ${t.fix.display} (${t.fix.why}).`),Zb(t.fix.component))});function rx(e){$.lab=e,zy(`#lab-tabs button`).forEach(t=>t.classList.toggle(`is-on`,t.dataset.lab===e)),zy(`.lab-body`).forEach(t=>t.hidden=t.dataset.labp!==e),ix()}Q(`#lab-tabs`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-lab]`);t&&rx(t.dataset.lab)});function ix(e=!1){let t=$.sim;if(Q(`#sim-badge`).hidden=!t?.available,Q(`#sim-badge`).textContent=Object.keys($.overrides).length?`SIMULATED · WHAT-IF`:`SIMULATED`,t?.supply?.volts&&!Q(`#supply`).value&&(Q(`#supply`).placeholder=t.supply.volts),eb.set(t?.available?t.signals:[]),e&&t?.available&&!By){let e={p:0};La.to(e,{p:1,duration:.9,ease:`power2.out`,onUpdate:()=>eb.progress(e.p)})}Q(`#sim-readings`).innerHTML=t?.available?t.readings.map(e=>`<div><dt>${Z(e.label)}</dt><dd>${Z(e.value)}${e.note?`<small>${Z(e.note)}</small>`:``}</dd></div>`).join(``)+`<p class="hint" title="${Z((t.assumptions||[]).join(`; `))}">Assumes: ${Z((t.assumptions||[]).slice(0,2).join(`; `))}${(t.assumptions||[]).length>2?`…`:``}</p>`:`<p class="hint">${Z(t?.reason||($.snap?.patterns?`No simulation yet.`:`Simulation runs once a circuit is matched.`))}</p>`;let n=$.snap||{},r=n.video,i=r?.regions?.find(e=>e.analysis?.periodic),a=n.check;Q(`#lab-meas`).innerHTML=n.video_checked?n.video_path?`<div class="meas-grid">${i?[[`Frequency`,tb(i.analysis.frequency_hz)],[`On time`,`${Math.round((i.analysis.duty_cycle||0)*100)} %`],[`Cycles`,i.analysis.cycles],[`Confidence`,i.analysis.confidence],[`Frame rate`,`${r.fps} fps`],[`Length`,`${r.duration_s} s`]].map(([e,t])=>`<div class="stat"><span>${e}</span><b>${Z(String(t))}</b></div>`).join(``):`<div class="stat"><span>Result</span><b>${r?.camera_moved?`camera moved`:`no steady rhythm`}</b></div>`}</div>
      ${a?.available&&a.predicted?`<p style="margin:12px 0 0"><span class="verdict v-${a.verdict}">${a.verdict}</span> parts predict ${tb(a.predicted.frequency_hz)}; ${a.error_pct}% from the measurement.</p>`:``}`:db(`No video given`,`Behaviour can't be measured. Add a video, or time it with the Arduino/ESP sketch in Lab.`):db(`Waiting for the video`,`Measurements appear after the video is analysed.`),Q(`#scope-read`).textContent=n.video_checked?n.video_path?i?`V${i.index+1} · ${tb(i.analysis.frequency_hz)} · on ${Math.round((i.analysis.duty_cycle||0)*100)}% · ${i.analysis.cycles} cycles · ${i.analysis.confidence}`:`nothing blinks steadily`:`no video given`:`waiting for the video`}function ax(){let e=Q(`#next-card`),t=$.snap?.unknowns,n=$.snap?.inputs||$.inputs;t?.length?(e.hidden=!1,e.innerHTML=`<div class="card-head"><h3>Next steps</h3><span class="muted">${n?`evidence ${n.evidence} of 3`:``}</span></div>
    <ol class="next-list">${t.slice(0,4).map(e=>`<li><div>${Z(e.text)}. ${ub([e.id])}${e.ask?`<div class="do">${Z(e.ask)}</div>`:``}
      ${e.with?`<span class="with">Uses what you have</span>`:``}
      ${e.sketch?`<div><a class="link" href="/api/investigations/${$.sid}/sketch?kind=${e.sketch.kind}&board=${e.sketch.board}" download>${Jy[e.sketch.board]} ${e.sketch.kind===`voltage`?`voltage logger`:`blink counter`} (.ino)</a></div>`:``}</div></li>`).join(``)}</ol>
    ${n?.gaps?.length&&!$.saved?`<button class="link" style="margin-top:10px" data-add-evidence>${$.mode===`demo`?`Try another sample`:`Add the missing evidence and run again`}</button>`:``}`):e.hidden=!0}Q(`#next-card`).addEventListener(`click`,e=>{e.target.closest(`[data-add-evidence]`)&&($.mode===`demo`?Pb():Mb($.sid))});function ox(e){$.stage=e,zy(`#stage-tabs button`).forEach(t=>t.classList.toggle(`is-on`,t.dataset.stage===e)),Q(`#photos`).hidden=e!==`photos`,Q(`#schem`).hidden=e!==`schematic`,Q(`#schem-tools`).hidden=e!==`schematic`,Q(`#layers-stage`).hidden=e!==`layers`;let t=Q(`#stage-run canvas`);t&&(t.style.visibility=e===`model`?`visible`:`hidden`);let n=Q(`#stage-run .tags`);n&&(n.hidden=e!==`model`),Q(`#stage-note`).textContent={model:`Parts placed where the observer saw them · wiring not drawn in 3D`,schematic:`Inferred wiring: verify each net with a continuity check · scroll to zoom, drag to pan, double-click to fit`,photos:`Boxes show where the observer saw each part`,layers:`The device as layers: power, control, sensing, drive, communication, interface`}[e],e===`layers`&&gx(Q(`#layers-stage`),!0),e===`photos`&&yx(),e===`schematic`&&mx(!0)}Q(`#stage-tabs`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-stage]`);t&&ox(t.dataset.stage)});var sx={highlight(){},svg:()=>``},cx={highlight(){},svg:()=>``},lx=``,ux=new Set([`astable555`,`multivibrator`,`mcu`]);function dx(){let e=$.snap||{};return $.wiringSource===`traced`&&e.traced?e.traced:e.wiring||e.traced||null}async function fx(e,t){if(!t)return Ey(e,null);if($.schemStyle===`classic`&&ux.has(t.layout))return Ey(e,t);try{return await Fy(e,t)}catch(n){return console.warn(`automatic layout failed, using the classic drawing`,n),Ey(e,t)}}function px(){let e=$.snap||{},t=dx(),n=[];return e.wiring&&e.traced&&n.push(`<div class="seg"><button data-src="standard" class="${$.wiringSource===`traced`?``:`is-on`}">Standard</button><button data-src="traced" class="${$.wiringSource===`traced`?`is-on`:``}">Traced</button></div>`),t&&ux.has(t.layout)&&n.push(`<div class="seg"><button data-style="auto" class="${$.schemStyle===`classic`?``:`is-on`}">Auto layout</button><button data-style="classic" class="${$.schemStyle===`classic`?`is-on`:``}">Classic</button></div>`),n.join(``)}async function mx(e=!1){let t=dx(),n=JSON.stringify([t,$.schemStyle,$.wiringSource]);Q(`#schem-tools`).innerHTML=px(),(e||n!==lx)&&(lx=n,sx=await fx(Q(`#schem`),t),sx.highlight($.focusNet),zy(`#schem .badge`).forEach(e=>e.addEventListener(`click`,()=>Cx(e.dataset.net))),By||La.from(`#schem .w`,{opacity:0,duration:.6,stagger:.004,clearProps:`opacity`}))}document.addEventListener(`click`,e=>{let t=e.target.closest(`[data-src]`),n=e.target.closest(`[data-style]`);(t||n)&&(t&&($.wiringSource=t.dataset.src),n&&($.schemStyle=n.dataset.style),$.focusNet=null,$.stage===`schematic`&&mx(!0),$.view===`build`&&wx())});var hx={power:`#d1342f`,control:`#24324a`,sensing:`#0f8a5f`,drive:`#d97a00`,comms:`#4f46e5`,interface:`#b8336a`,support:`#8b8172`};function gx(e,t=!1){let n=$.snap?.system;if(!n){e.innerHTML=db(`No layers yet`,`Layers appear once the parts are read.`);return}let r=n.layers.filter(e=>!t||e.key!==`support`);e.innerHTML=`<div class="layers">${r.map((e,i)=>{let a=n.flows.filter(t=>t.from===e.key).map(e=>`<span>${Z(_x[e.to]||e.to)} · ${Z(e.label)}</span>`);return`<div class="lband" style="--lc:${hx[e.key]}"><div class="lh"><b>${Z(e.name)}</b><small>${Z(e.desc)}</small></div>
      <div class="lparts">${e.parts.map(t=>`<span class="lchip st-${t.status}" data-pick-go="${t.id}" style="--lc:${hx[e.key]}"><b>${t.id}</b>${Z(t.label)}</span>`).join(``)}</div></div>
      ${!t&&a.length&&i<r.length-1?`<div class="lflow">${a.join(``)}</div>`:``}`}).join(``)}</div>`}var _x={power:`Power`,control:`Control`,sensing:`Sensing`,drive:`Drive & motors`,comms:`Communication`,interface:`Interface`,support:`Support`};document.addEventListener(`click`,e=>{let t=e.target.closest(`.lchip[data-pick-go]`);t&&(vb(`workspace`),Zb(t.dataset.pickGo))});function vx(){let e=$.snap?.system;if(gx(Q(`#sys-layers`)),!e){Q(`#sys-budget`).innerHTML=``,Q(`#sys-warnings`).innerHTML=``;return}let t=e.budget,n=t.source,r=Math.max(t.peak_a,n?.max_a||0,.05),i=(e,t,n=``,i=null)=>`<div class="bbar"><span>${e}</span><span class="track"><i class="${n}" style="width:${Math.min(100,t/r*100)}%"></i>${i?`<span class="cap" style="left:${Math.min(100,i/r*100)}%" title="what the battery can give"></span>`:``}</span><b>${t<1?(t*1e3).toFixed(0)+` mA`:t.toFixed(2)+` A`}</b></div>`;Q(`#sys-budget`).innerHTML=`<div class="card-head"><h3>Power budget</h3><span class="muted">${n?Z(n.name):`battery not seen`}</span></div>
    ${t.loads.length?`<div class="budget-bars">${i(`Running`,t.run_a,``,n?.max_a)}${i(`Start-up peak`,t.peak_a,n&&t.peak_a>n.max_a?`over`:`peak`,n?.max_a)}${n?i(`Battery can give`,n.max_a):``}</div>
      <table class="ptable"><thead><tr><th>Part</th><th>Running</th><th>Peak</th></tr></thead><tbody>${t.loads.map(e=>`<tr data-pick-go="${e.id}"><td><b class="mono">${e.id}</b> ${Z(e.type.replace(`_`,` `))}</td><td class="mono">${(e.run_a*1e3).toFixed(0)} mA</td><td class="mono">${(e.peak_a*1e3).toFixed(0)} mA</td></tr>`).join(``)}</tbody></table>
      ${t.runtime_h?`<p class="muted" style="margin:10px 0 0">Runtime with everything running: <b>≈ ${t.runtime_h} h</b></p>`:``}
      <p class="hint" style="margin-top:8px">Typical figures, not measurements: ${Z(e.assumptions.slice(0,3).join(`; `))}${e.assumptions.length>3?`…`:``}</p>`:`<p class="muted">No loads with known typical currents were seen.</p>`}
    ${n?``:`<p class="hint">Say the battery in the note ("2 × 18650", "4 × AA", "9 V", "USB") to check it against the loads.</p>`}`,Q(`#sys-warnings`).innerHTML=`<div class="card-head"><h3>Between the layers</h3><span class="muted">${e.warnings.length} note${e.warnings.length===1?``:`s`}</span></div>`+(e.warnings.length?e.warnings.map(e=>`<div class="swarn ${e.level}">${e.part?`<b class="mono">${e.part}</b> · `:``}${Z(e.text)}${e.fix?.text?`<span class="fixline">${Z(e.fix.text)}</span>`:``}</div>`).join(``):`<p class="muted">No problems found between the layers.</p>`)}Q(`#sys-budget`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-pick-go]`);t&&(vb(`workspace`),Zb(t.dataset.pickGo))});function yx(){let e=$.snap,t=e?.images?.length?e.images:[...(e?.photo_urls||[]).map((e,t)=>({url:e,label:`photo ${t+1}`})),...e?.keyframes||[]];if(!t.length){Q(`#photo-main`).innerHTML=db(`No images yet`,`Video key frames appear after measuring.`),Q(`#photo-strip`).innerHTML=``;return}$.imageIdx=Math.min($.imageIdx,t.length-1);let n=t[$.imageIdx],r=pb().filter(e=>e.image===$.imageIdx+1&&Array.isArray(e.box));Q(`#photo-main`).innerHTML=`<div class="photo-frame"><img src="${n.url}" alt="${Z(n.label)}">${r.map(e=>{let[t,n,r,i]=e.box;return`<div class="pbox is-${(e.status||``).toLowerCase()} ${$.selected===e.id?`is-selected`:``}" data-id="${e.id}" style="top:${t/10}%;left:${n/10}%;width:${(i-n)/10}%;height:${(r-t)/10}%"><span>${e.id}</span></div>`}).join(``)}</div>`,Q(`#photo-strip`).innerHTML=t.map((e,t)=>`<button class="${t===$.imageIdx?`is-on`:``}" data-img="${t}"><img src="${e.url}" alt="${Z(e.label)}"></button>`).join(``)}Q(`#photo-strip`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-img]`);t&&($.imageIdx=+t.dataset.img,yx())}),Q(`#photo-main`).addEventListener(`click`,e=>{let t=e.target.closest(`.pbox`);t&&Zb(t.dataset.id)}),Q(`#rotate-btn`).addEventListener(`click`,e=>{Hy.rotate=Hy.rotate===`on`?`off`:`on`,Uy(),Qy.setPrefs({rotate:Hy.rotate===`on`}),Qy.controls.autoRotate=Hy.rotate===`on`,e.currentTarget.classList.toggle(`is-on`,Hy.rotate===`on`)}),Q(`#capture-btn`).addEventListener(`click`,()=>{if($.stage===`schematic`){let e=new Blob([sx.svg()],{type:`image/svg+xml`});Object.assign(document.createElement(`a`),{href:URL.createObjectURL(e),download:`genesis-schematic-${($.sid||`board`).slice(0,8)}.svg`}).click()}else Qy.renderer.render(Qy.scene,Qy.camera),Object.assign(document.createElement(`a`),{href:Qy.renderer.domElement.toDataURL(`image/png`),download:`genesis-board-${($.sid||`board`).slice(0,8)}.png`}).click()}),Q(`#panels-btn`).addEventListener(`click`,()=>Q(`#ws-right`).classList.add(`is-open`)),Q(`#close-panels`).addEventListener(`click`,()=>Q(`#ws-right`).classList.remove(`is-open`));var bx=()=>`genesis-build-${$.sid}`,xx=()=>{try{return JSON.parse(localStorage.getItem(bx())||`{}`)}catch{return{}}},Sx=e=>{try{localStorage.setItem(bx(),JSON.stringify(e))}catch{}};function Cx(e){$.focusNet=$.focusNet===e?null:e,sx.highlight($.focusNet),cx.highlight($.focusNet),zy(`.netc`).forEach(e=>e.classList.toggle(`is-on`,e.dataset.net===$.focusNet))}function wx(){let e=dx(),t=Q(`#build-list`);if(Q(`#schem-tools-big`).innerHTML=px(),fx(Q(`#schem-big`),e).then(e=>{cx=e,cx.highlight($.focusNet),zy(`#schem-big .badge`).forEach(e=>e.addEventListener(`click`,()=>Cx(e.dataset.net)))}),!e){t.innerHTML=db($.sid?`Nothing to build yet`:`No investigation open`,$.snap?.patterns?`Wiring is drawn for 555 timers, two-transistor flashers, microcontroller outputs and robots, or from connections the observer could see.`:`Open or start an investigation first.`);return}let n=xx(),r=e.nets.reduce((e,t)=>e+t.pins.length,0),i=e.nets.reduce((e,t)=>e+t.pins.filter((e,r)=>n[`${t.id}:${r}`]).length,0);t.innerHTML=`<p class="basis">${Z(e.basis)}</p>
    <div class="build-bar"><button class="pill pill-sm" data-step="-1">‹ Prev</button><button class="btn-run" data-step="1">Next connection ›</button>
      <button class="pill pill-sm" data-step="0">Show all</button><span class="progress-label">${i} / ${r} joins</span></div>
    <ol class="nets">${e.nets.map(e=>`<li class="netc ${$.focusNet===e.key?`is-on`:``} ${e.pins.every((t,r)=>n[`${e.id}:${r}`])?`is-done`:``}" data-net="${e.key}" style="--nc:${e.color}">
      <header><b>${e.id}</b><span>${Z(e.name)}</span><small>${e.pins.length} points</small></header>
      <ul>${e.pins.map((t,r)=>`<li><label><input type="checkbox" data-pin="${e.id}:${r}" ${n[`${e.id}:${r}`]?`checked`:``}><span class="pid">${Z(t.id||t.part)}</span><span>${Z(t.pin)}</span></label></li>`).join(``)}</ul></li>`).join(``)}</ol>
    <div class="card-head" style="margin-top:16px"><h3>Notes</h3></div>${e.notes.map(e=>`<p class="muted" style="margin:0 0 6px">${Z(e)}</p>`).join(``)}
    ${e.missing?.length?`<p style="color:var(--danger);font-size:13px">Not seen, needed to replicate: ${Z(e.missing.join(`, `))}</p>`:``}
    <div class="build-bar" style="margin-top:10px"><button class="pill pill-sm" data-dl-svg>Schematic .svg</button><a class="pill pill-sm" href="/api/investigations/${$.sid}/report.md" download>Build sheet .md</a></div>`}Q(`#build-list`).addEventListener(`change`,e=>{let t=e.target.dataset.pin;if(!t)return;let n=xx();n[t]=e.target.checked,Sx(n),wx()}),Q(`#build-list`).addEventListener(`click`,e=>{let t=$.snap?.wiring,n=e.target.closest(`[data-step]`);if(n&&t){if(+n.dataset.step==0){$.focusNet=null,sx.highlight(null),cx.highlight(null),zy(`.netc`).forEach(e=>e.classList.remove(`is-on`));return}let e=t.nets.map(e=>e.key),r=e.indexOf($.focusNet);$.focusNet=null,Cx(e[(r+ +n.dataset.step+e.length)%e.length]??e[0]),Q(`.netc[data-net="${$.focusNet}"]`)?.scrollIntoView({block:`nearest`,behavior:`smooth`});return}if(e.target.closest(`[data-dl-svg]`)){Object.assign(document.createElement(`a`),{href:URL.createObjectURL(new Blob([cx.svg()],{type:`image/svg+xml`})),download:`genesis-schematic-${$.sid.slice(0,8)}.svg`}).click();return}let r=e.target.closest(`.netc`);r&&!e.target.closest(`label`)&&Cx(r.dataset.net)});function Tx(){let e=$.snap;e?.components?.length?(Q(`#parts-full`).innerHTML=`<div class="card-head"><h3>Seen on the board</h3><span class="muted">${e.components.length} parts</span></div>
    <table class="ptable"><thead><tr><th></th><th>Id</th><th>Part</th><th>Value</th><th>Status</th></tr></thead><tbody>${e.components.map(e=>`<tr data-pick-go="${e.id}">
      <td><div class="pcrop" style="${gb(e)}"></div></td><td class="mono">${e.id}</td><td>${Z(ob(e.type))}<br><small class="muted">${Z(e.evidence||``)}</small></td>
      <td class="mono">${Z(Kb(e).display||e.marking||`—`)}${e.value?`<br><small class="muted">${Z(e.value.basis)}</small>`:``}</td>
      <td><span class="st st-${e.status||`OBSERVED`}">${e.status||`OBSERVED`}</span><br><small class="muted">${Z(e.confidence||``)}</small></td></tr>`).join(``)}</tbody></table>
    ${e.board?.length?`<div class="card-head" style="margin-top:14px"><h3>Board notes</h3></div>${e.board.map(e=>`<p class="muted" style="margin:0 0 4px"><b>${e.id}</b> ${Z(e.note)}</p>`).join(``)}`:``}
    ${e.cannot_see?.length?`<div class="card-head" style="margin-top:14px"><h3>Couldn't see</h3></div>${e.cannot_see.map(e=>`<p class="muted" style="margin:0 0 4px">${Z(e)}</p>`).join(``)}`:``}`,Q(`#bom`).innerHTML=`<div class="card-head"><h3>Buy the parts</h3><button class="btn-run" id="find-parts">Find parts (JLCPCB, free)</button></div>
    <p class="hint" style="margin-bottom:10px">Live catalogue search through the free pcbparts service. Check the package before ordering.</p>
    <table class="ptable"><thead><tr><th>Id</th><th>Part</th><th>Match</th></tr></thead><tbody>${e.components.map(e=>`<tr><td class="mono">${e.id}</td><td>${Z(ob(e.type).split(` · `)[0])} ${Z(e.display||e.marking||``)}</td><td data-buy="${e.id}" class="muted">—</td></tr>`).join(``)}</tbody></table>`,$.sourcing&&Ex($.sourcing)):(Q(`#parts-full`).innerHTML=db(`No parts yet`,`Open or start an investigation.`),Q(`#bom`).innerHTML=``)}Q(`#parts-full`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-pick-go]`);t&&(vb(`workspace`),Zb(t.dataset.pickGo))}),Q(`#bom`).addEventListener(`click`,async e=>{let t=e.target.closest(`#find-parts`);if(t){t.disabled=!0,t.textContent=`Searching…`;try{let e=await _b(`/api/investigations/${$.sid}/source`,{disabled:Hy.disabled}),t=await e.json();if(!e.ok||!t.ok)throw Error(t.error||`search failed`);$.sourcing=t,Ex(t)}catch(e){hb(e.message),t.disabled=!1,t.textContent=`Find parts (JLCPCB, free)`}}});function Ex(e){for(let t of e.items){let e=Q(`[data-buy="${t.id}"]`),n=t.matches[0];e&&(e.innerHTML=n?`<a href="${Z(n.url)}" target="_blank" rel="noopener">${Z(n.lcsc)}</a> ${Z(n.model||``)}<br><small>${Z(n.package||``)}${n.mount?` · SMD substitute`:``} · ${n.stock?.toLocaleString?.()??n.stock} in stock${n.price==null?``:` · $${(+n.price).toFixed(3)}`}</small>`:`<small>${Z(t.note||`no match`)}</small>`)}let t=Q(`#find-parts`);t&&(t.disabled=!0,t.textContent=`Found`)}function Dx(){let e=Q(`#lab-sketches`);e.innerHTML=`<div class="card-head"><h3>Measure with your board</h3></div>
    ${$.sid?`<p class="muted" style="margin-top:0">Sketches for this investigation, with a voltage divider sized for its supply.</p>
      <div class="chips" style="margin-top:8px">${[[`arduino`,`Arduino Uno / Nano`],[`esp32`,`ESP32`],[`esp8266`,`ESP8266`]].flatMap(([e,t])=>[[`frequency`,`blink counter`],[`voltage`,`voltage logger`]].map(([n,r])=>`<a class="chip" href="/api/investigations/${$.sid}/sketch?kind=${n}&board=${e}" download>${t} · ${r}</a>`)).join(``)}</div>`:`<p class="muted" style="margin-top:0">Open an investigation to generate sketches sized for its supply voltage.</p>`}`}var Ox=[{key:`led`,title:`LED resistor`,inputs:[[`supply_v`,`Supply (V)`,`5`],[`led`,`LED`,`red`,[`red`,`orange`,`yellow`,`green`,`blue`,`white`]],[`current_ma`,`Current (mA)`,`12`]],show:e=>[`<span class="big">${e.resistor}</span>`,`${e.current_ma} mA · ${e.power_mw} mW · use a ${e.rating} resistor`,`exact ${e.exact}`]},{key:`divider`,title:`Voltage divider`,inputs:[[`vin`,`Vin (V)`,`5`],[`r2`,`R2 to GND`,`2k`],[`vout`,`Target Vout (V)`,`3.3`],[`r1`,`or R1 (top)`,``]],show:e=>[`<span class="big">${e.vout} V</span>`,`R1 ${e.r1} · R2 ${e.r2} · ${e.current_ua} µA`,e.notes?.[0]||``]},{key:`ohms`,title:`Ohm's law and power`,inputs:[[`v`,`Voltage (V)`,`9`],[`i_ma`,`Current (mA)`,``],[`r`,`Resistance`,`470`]],show:e=>[`<span class="big">${e.current_ma} mA</span>`,`${e.voltage_v} V · ${e.resistance} · ${e.power_mw} mW`,e.notes?.[0]||``]},{key:`rc`,title:`RC timing and filter`,inputs:[[`r`,`R`,`10k`],[`c`,`C`,`100uF`]],show:e=>[`<span class="big">τ = ${kx(e.tau_s)}</span>`,`95 % in ${kx(e.t95_s)} · cutoff ${e.cutoff_hz<1?e.cutoff_hz.toFixed(3):e.cutoff_hz.toFixed(1)} Hz`,e.notes?.[0]||``]},{key:`mono555`,title:`555 one-shot pulse`,inputs:[[`r`,`R`,`100k`],[`c`,`C`,`10uF`]],show:e=>[`<span class="big">${kx(e.pulse_s)}</span>`,e.formula,e.notes?.[0]||``]},{key:`battery`,title:`Battery runtime`,inputs:[[`capacity_mah`,`Capacity (mAh)`,`2500`],[`current_ma`,`Average current (mA)`,`150`],[`usable_pct`,`Usable %`,`80`]],show:e=>[`<span class="big">${e.hours} h</span>`,`${e.days} days`,e.notes?.[0]||``]},{key:`motors`,title:`Motors, driver and battery`,inputs:[[`battery`,`Battery`,`2x18650`,[`2x18650`,`3x18650`,`18650`,`4xAA`,`6xAA`,`9V`,`LiPo`,`USB`]],[`driver`,`Driver`,`L298N`,[`L298N`,`TB6612`,`DRV8833`,`L9110`,`MX1508`,`L293D`,`ULN2003`,`BTS7960`]],[`motor`,`Motor`,`TT`,[`TT`,`N20`,`130`,`SG90 servo`,`MG996R servo`,`28BYJ stepper`,`NEMA17 stepper`]],[`count`,`How many`,`2`]],show:e=>[`<span class="big ${e.verdict===`OK`?`verdict-ok`:`verdict-bad`}">${e.verdict}</span>`,`start-up ${e.startup_a} A of ${e.battery_max_a} A · running ${e.running_a} A · motors get ${e.motor_volts} V${e.runtime_h?` · ≈ ${e.runtime_h} h`:``}`,e.notes.join(`; `)]}],kx=e=>e<.001?`${(e*1e6).toPrecision(3)} µs`:e<1?`${(e*1e3).toPrecision(3)} ms`:`${e.toPrecision(3)} s`,Ax=!1;function jx(){Q(`#calc-fill`).hidden=!$.sid,!Ax&&(Ax=!0,Q(`#calc-grid`).innerHTML=Ox.map(e=>`<article class="card calc" data-calc="${e.key}"><div class="card-head"><h3>${e.title}</h3></div>
    <div class="inputs">${e.inputs.map(([e,t,n,r])=>`<label class="lbl">${t}${r?`<select class="field" data-in="${e}">${r.map(e=>`<option ${e===n?`selected`:``}>${e}</option>`).join(``)}</select>`:`<input class="field" data-in="${e}" value="${n}" />`}</label>`).join(``)}</div>
    <div class="out"></div></article>`).join(``),zy(`#calc-grid .calc`).forEach(Nx))}var Mx={};async function Nx(e){let t=Ox.find(t=>t.key===e.dataset.calc),n={};zy(`[data-in]`,e).forEach(e=>n[e.dataset.in]=e.value.trim()),t.key===`divider`&&n.r1&&delete n.vout,t.key===`motors`&&(n.motor=n.motor.replace(/ (servo|stepper)$/,` $1`));try{let r=await(await _b(`/api/lab/${t.key}`,n)).json();Q(`.out`,e).innerHTML=r.error?`<span class="err">${Z(r.error)}</span>`:t.show(r).filter(Boolean).map((e,t)=>t?`<span class="line">${e.startsWith(`<`)?e:Z(e)}</span>`:e).join(``)}catch{Q(`.out`,e).innerHTML=`<span class="err">The bench server isn't reachable.</span>`}}Q(`#calc-grid`).addEventListener(`input`,e=>{let t=e.target.closest(`.calc`);t&&(clearTimeout(Mx[t.dataset.calc]),Mx[t.dataset.calc]=setTimeout(()=>Nx(t),250))}),Q(`#calc-fill`).addEventListener(`click`,()=>{let e=$.snap||{},t=$.sim,n=e.system,r=(e,t,n)=>{let r=Q(`[data-calc="${e}"] [data-in="${t}"]`);r&&n!=null&&n!==``&&(r.value=n)},i=t?.supply?.volts,a=(pb().find(e=>e.type===`led`)?.evidence||``).match(/red|orange|yellow|green|blue|white/i)?.[0]?.toLowerCase();r(`led`,`supply_v`,i),r(`led`,`led`,a),r(`ohms`,`v`,i),r(`divider`,`vin`,i);let o=pb().find(t=>t.id===e.check?.roles?.RA),s=pb().find(t=>t.id===e.check?.roles?.C);o?.display&&r(`rc`,`r`,o.display.replace(/\s|Ω/g,``)),s?.display&&r(`rc`,`c`,s.display.replace(/\s/g,``).replace(`µ`,`u`));let c=n?.budget?.source;c&&(r(`battery`,`capacity_mah`,c.mah||``),r(`motors`,`battery`,{"2 × 18650 Li-ion (7.4 V)":`2x18650`,"3 × 18650 Li-ion (11.1 V)":`3x18650`,"4 × AA alkaline (6 V)":`4xAA`,"6 × AA alkaline (9 V)":`6xAA`,"9 V PP3 battery":`9V`}[c.name]||``)),n?.budget?.run_a&&r(`battery`,`current_ma`,Math.round(n.budget.run_a*1e3));let l=pb().find(e=>/L298|TB6612|DRV8833|L9110|MX1508|L293|ULN2003|BTS7960/i.test(e.marking||``));l&&r(`motors`,`driver`,(l.marking.match(/L298N?|TB6612|DRV8833|L9110|MX1508|L293D?|ULN2003|BTS7960/i)||[``])[0].replace(/^L298$/i,`L298N`).toUpperCase().replace(`L293`,`L293D`).replace(`L293DD`,`L293D`));let u=pb().filter(e=>e.type===`motor`);u.length&&(r(`motors`,`count`,u.length),/TT|yellow/i.test(u[0].evidence||``)&&r(`motors`,`motor`,`TT`)),zy(`#calc-grid .calc`).forEach(Nx),hb(`Filled from this investigation.`)});function Px(e=Q(`#assist-panel`).hidden,t){let n=Q(`#assist-panel`);if(t&&Fx(t),e!==!n.hidden&&(n.hidden=!e,Q(`#assist-toggle`).textContent=e?`Collapse`:`Expand`,e&&!By&&La.fromTo(n,{y:20,opacity:0},{y:0,opacity:1,duration:.35,ease:`power3.out`}),e&&$.assistTab===`chat`)){let e=Q(`[data-ap="chat"]`);e.scrollTop=e.scrollHeight}}Q(`#assist-toggle`).addEventListener(`click`,()=>Px()),Q(`#assist-close`).addEventListener(`click`,()=>Px(!1));function Fx(e){$.assistTab=e,zy(`#assist-tabs button`).forEach(t=>t.classList.toggle(`is-on`,t.dataset.at===e)),zy(`.assist-body`).forEach(t=>t.hidden=t.dataset.ap!==e)}Q(`#assist-tabs`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-at]`);t&&Fx(t.dataset.at)});function Ix(e,t){let n=document.createElement(`div`);n.className=`msg msg-${e}`,n.innerHTML=t,Q(`#chat`).appendChild(n);let r=Q(`[data-ap="chat"]`);r.scrollTop=r.scrollHeight}var Lx=e=>Ix(`sys`,Z(e));function Rx(e,t=!1){let n=document.createElement(`div`);n.className=`act ${t?`is-err`:``}`,n.innerHTML=e,Q(`#activity`).appendChild(n)}function zx(){let e=$.snap?.skeptic,t=Q(`#report`);if(!e){t.innerHTML=db(`No report yet`,`Written last; every sentence must cite evidence.`);return}let n=$.feedback||{};t.innerHTML=`<div class="report-head"><span>Skeptic flagged <b>${e.flagged}</b> of ${e.claims} sentences</span>
      <span><a class="link" style="color:#fff" href="/#report/${$.sid}" target="_blank">Share / PDF</a> · <a class="link" style="color:#fff" href="/api/investigations/${$.sid}/report.md" download>.md</a></span></div>`+e.sections.map(e=>`<section class="r-sec"><h4>${Z(e.title)}</h4>${e.sentences.map(e=>{let t=e.flags.flatMap(e=>(e.match(/doesn't exist: (.+)$/)||[,``])[1].split(/,\s*/)).filter(Boolean);return`<p class="r-sent ${e.flags.length?`is-flagged`:``}"><span class="txt">${Z(e.text)}</span> ${ub(e.cites,t)}${e.flags.map(e=>`<span class="flag">${Z(e)}</span>`).join(``)}</p>`}).join(``)}</section>`).join(``)+`<div class="feedback"><b>Was this right?</b><div class="chips">${[`right`,`partly`,`wrong`].map(e=>`<button class="chip ${n.rating===e?`is-on`:``}" data-rate="${e}">${{right:`Yes`,partly:`Partly`,wrong:`No`}[e]}</button>`).join(``)}</div>
      <textarea id="fb-note" maxlength="1000" placeholder="What was wrong or missing? (optional)">${Z(n.note||``)}</textarea></div>`}Q(`#report`).addEventListener(`click`,async e=>{let t=e.target.closest(`[data-rate]`);t&&(await _b(`/api/investigations/${$.sid}/feedback`,{rating:t.dataset.rate,note:Q(`#fb-note`)?.value||``})).ok&&($.feedback={rating:t.dataset.rate,note:Q(`#fb-note`)?.value||``},zx(),hb(`Feedback saved.`))}),document.addEventListener(`click`,e=>{let t=e.target.closest(`.cite`);if(!t||!$.sid)return;let n=t.dataset.ref;/^O\d+$/.test(n)?(vb(`workspace`),Zb(n)):/^V\d+$/.test(n)?(vb(`workspace`),rx(`wave`)):/^X\d+$/.test(n)&&(vb(`workspace`),rx(`meas`))});function Bx(e,t=!0){let n=Math.floor(Math.log10(e)),r=e/10**n,i=Zy.findIndex(e=>e>=r-1e-9);if(i===-1)return t?10**(n+1):Zy[Zy.length-1]*10**n;let a=t?Zy[i]>r+1e-9?i:i+1:i-1;return a>=Zy.length?Zy[0]*10**(n+1):a<0?Zy[Zy.length-1]*10**(n-1):Zy[a]*10**n}function Vx(){let e=Q(`#suggest`),t=[];if(!$.sid||$.busy||$.pending){e.innerHTML=``;return}let n=mb($.selected),r=$.snap?.check;n?.type===`resistor`&&n.value&&t.push({label:`What if ${nb(Bx(n.value.value*2))}?`,whatif:[n.id,nb(Bx(n.value.value*2)).replace(/\s|Ω/g,``)]}),n?.type?.startsWith(`capacitor`)&&n.value&&t.push({label:`What if ${rb(n.value.value/2)}?`,whatif:[n.id,rb(n.value.value/2,!0)]}),r?.verdict===`INFERRED`&&t.push({label:`${r.inferred.component} says ${rb(r.inferred.standard,!0)}`,ask:`${r.inferred.component} says ${rb(r.inferred.standard,!0)}`}),$.snap?.unknowns&&!$.snap?.report&&$.steps.write_report===`done`&&t.push({label:`Rewrite the report`,ask:`Rewrite the report`}),!n&&$.mode!==`demo`&&$.snap?.report&&t.push({label:`What should I measure first?`,ask:`What should I measure first?`}),!n&&$.mode===`demo`&&r?.verdict===`CONSISTENT`&&t.push({label:`O5 is 47uF`,ask:`O5 is 47uF`}),e.innerHTML=t.slice(0,2).map((e,t)=>`<button type="button" data-sg="${t}">${Z(e.label)}</button>`).join(``),e._s=t}Q(`#suggest`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-sg]`);if(!t)return;let n=Q(`#suggest`)._s[+t.dataset.sg];n.whatif?($b(...n.whatif),hb(`Simulating ${n.whatif[0]} = ${n.label.replace(/^What if |\?$/g,``)} (what-if).`)):Hx(n.ask)});async function Hx(e){if(!$.sid)return;let t=e.match(/^what if (O\d+)\s*(?:were|was|is|=)?\s*([\d.]+\s*[a-zµΩ]*)\??$/i);if(t){$b(t[1].toUpperCase(),t[2].replace(/\s|Ω/g,``)),hb(`Simulated ${t[1].toUpperCase()} = ${t[2]} (what-if).`);return}if($.saved){hb(`This investigation was saved before a restart: re-run it to ask more.`);return}let n=mb($.ctx?.id),r=n&&!RegExp(`\\b${n.id}\\b`).test(e)?`About ${n.id} (${ob(n.type)} ${Kb(n).display||n.marking||``}): ${e}`:e;$.asked=!0;let i=await _b(`/api/investigations/${$.sid}/ask`,{text:r});i.ok?($.busy=!0,Rb(),Px(!0,`chat`)):hb((await i.json()).error||`Couldn't send that.`)}Q(`#ask`).addEventListener(`submit`,e=>{e.preventDefault();let t=Q(`#ask-input`).value.trim();t&&(Q(`#ask-input`).value=``,Hx(t))});function Ux(e){let t=e.args||{};Q(`#ap-id`).textContent=t.component_id,Q(`#ap-value`).textContent=t.value,Q(`#ap-reason`).textContent=t.reason?`Reason: ${t.reason}`:``,Q(`#ap-edit`).hidden=!0,Q(`#ap-approve`).textContent=`Approve`,Q(`#ap-edit-label`).textContent=`New value for ${t.component_id}`,Q(`#approval`).hidden=!1,La.fromTo(`#approval .modal-card`,{y:24,opacity:0},{y:0,opacity:1,duration:.4,ease:`expo.out`})}async function Wx(e){let t=$.pending?.args?.component_id,n=await _b(`/api/investigations/${$.sid}/decision`,e);n.ok?($.pending=null,e.type!==`reject`&&t&&$.overrides[t]&&(delete $.overrides[t],$.undo=[]),Q(`#approval`).hidden=!0,Rb()):hb((await n.json()).error||`That didn't go through.`)}Q(`#ap-approve`).addEventListener(`click`,()=>{if(Q(`#ap-edit`).hidden)Wx({type:`approve`});else{let e=Q(`#ap-input`).value.trim();if(!e)return;Wx({type:`edit`,value:e})}}),Q(`#ap-editbtn`).addEventListener(`click`,()=>{Q(`#ap-edit`).hidden=!1,Q(`#ap-input`).value=Q(`#ap-value`).textContent,Q(`#ap-input`).select(),Q(`#ap-approve`).textContent=`Record edited value`}),Q(`#ap-reject`).addEventListener(`click`,()=>Wx({type:`reject`,message:`rejected by the user`}));var Gx={right:`✓ right`,partly:`~ partly`,wrong:`✗ wrong`};async function Kx(){try{let e=await(await fetch(`/api/investigations`)).json();$.history=Object.fromEntries(e.map(e=>[e.id,e])),Q(`#projects`).innerHTML=e.length?e.map(e=>`<button class="proj" data-open="${e.id}">
        <b>${Z(e.title===`Investigation`?`Untitled board`:e.title)}</b>
        <small>${Z(e.device||e.circuit||``)}</small>
        <small>${e.verdict?Z(e.verdict.toLowerCase())+` · `:``}${e.parts} parts · ${e.mode===`demo`?`sample`:`live`}${e.rating?` · <span class="rate-${e.rating}">${Gx[e.rating]}</span>`:``}${e.busy?` · running`:``}</small>
        <small>${fb(e.created)}</small>
        <span class="del" data-del="${e.id}" role="button" aria-label="Delete">×</span></button>`).join(``):db(`No investigations yet`,`Start one from the Workspace, or try a sample.`)}catch{}}Q(`#projects`).addEventListener(`click`,async e=>{let t=e.target.closest(`[data-del]`);if(t){if(e.stopPropagation(),!confirm(`Delete this investigation and its uploaded photos and video? This can't be undone.`))return;let n=await fetch(`/api/investigations/${t.dataset.del}`,{method:`DELETE`});n.ok||hb((await n.json()).error||`Couldn't delete it.`),$.sid===t.dataset.del&&Pb(),Kx();return}let n=e.target.closest(`[data-open]`);n&&Nb(n.dataset.open,$.history[n.dataset.open]?.mode||`live`)}),setInterval(()=>{$.view===`projects`&&!document.hidden&&Kx()},6e3);var qx=null;async function Jx(){try{qx=await(await fetch(`/api/control`)).json()}catch{qx=null}Xx(),Zx()}var Yx=e=>!Hy.disabled.includes(e.name)&&(e.default_on||Hy.enabled.includes(e.name));function Xx(){if(zy(`#control .seg[data-pref]`).forEach(e=>zy(`button`,e).forEach(t=>t.classList.toggle(`is-on`,Hy[e.dataset.pref]===t.dataset.v))),!qx)return;Q(`#ctl-agents-count`).textContent=`${qx.agents.filter(e=>e.ready).length} / ${qx.agents.length} ready`,Q(`#ctl-agents`).innerHTML=qx.agents.map(e=>`<li><span class="lamp ${e.ready?`ok`:`warn`}"></span><span><b>${Z(e.name)}</b><small>${Z(e.job)}${e.detail?` · ${Z(e.detail)}`:``}</small></span><span class="kind">${Z(e.model)}</span></li>`).join(``);let e=e=>e.usable_now||e.name===`pcbparts`?0:e.role===`dev`||e.role===`none`?2:1;Q(`#ctl-servers`).innerHTML=[...qx.servers].sort((t,n)=>e(t)-e(n)).map(e=>{let t=Yx(e),n=!e.usable_now&&e.name!==`pcbparts`;return`<li class="${n?`is-later`:``}"><span class="lamp ${e.ready&&t?`ok`:e.ready?``:`warn`}"></span>
      <span><b>${Z(e.name)}</b><small>${Z(e.purpose)} · ${Z(e.free)}</small><small>${n?Z(e.role_text||`not used yet`):e.ready?t?`ready`:`off`:Z(e.reason)}</small></span>
      <button type="button" class="switch" role="switch" aria-checked="${t}" data-server="${Z(e.name)}" ${n?`disabled`:``}></button></li>`}).join(``)}async function Zx(){try{let e=await(await fetch(`/api/usage`)).json(),t=e.today||{};Q(`#ctl-usage`).innerHTML=[[`Gemini 3.1 Flash-Lite`,t.gemini_lite||0,``],[`Gemini 3.8 Flash`,t.gemini_flash||0,` / ${e.flash_free_per_day}`],[`Groq backup`,t.groq||0,``],[`Ollama`,t.ollama||0,``]].map(([e,t,n])=>`<li><span class="lamp ${t?`ok`:``}"></span><span><b>${e}</b></span><span class="kind">${t}${n} calls</span></li>`).join(``)}catch{}}function Qx(e){let t=Q(`#control`);e?(t.hidden=!1,Jx(),La.fromTo(t,{xPercent:100},{xPercent:0,duration:.4,ease:`expo.out`})):La.to(t,{xPercent:100,duration:.25,onComplete:()=>t.hidden=!0})}Q(`#control-btn`).addEventListener(`click`,()=>Qx(!0)),Q(`#control-close`).addEventListener(`click`,()=>Qx(!1)),document.addEventListener(`keydown`,e=>{e.key===`Escape`&&(Q(`#control`).hidden||Qx(!1),Px(!1))}),Q(`#control`).addEventListener(`click`,e=>{let t=e.target.closest(`.seg[data-pref] button`);if(t){Hy[t.closest(`.seg`).dataset.pref]=t.dataset.v,Uy(),Qy.setPrefs({labels:Hy.labels===`on`,rotate:Hy.rotate===`on`}),Xx();return}let n=e.target.closest(`[data-server]`);if(n&&!n.disabled&&qx){let e=qx.servers.find(e=>e.name===n.dataset.server),t=!Yx(e);Hy.disabled=Hy.disabled.filter(t=>t!==e.name),Hy.enabled=Hy.enabled.filter(t=>t!==e.name),t?e.default_on||Hy.enabled.push(e.name):Hy.disabled.push(e.name),Uy(),Xx()}}),Q(`#phone-btn`).addEventListener(`click`,async()=>{let e=Q(`#phone-body`),t=null;try{t=(await(await fetch(`/api/info`)).json()).lan_url}catch{}if(t){e.innerHTML=`<div class="qr" id="qr"></div><p class="phone-url">${Z(t)}</p>
      <ol class="hint"><li>Phone on the same Wi-Fi.</li><li>Scan with the camera app.</li><li>Tap the drop zone to shoot photos and the video, then Run.</li><li>The run appears in Projects here too.</li></ol>`;let n=document.createElement(`canvas`);await fo.toCanvas(n,t,{width:200,margin:1}),Q(`#qr`).appendChild(n)}else e.innerHTML=`<p>Phone capture needs the bench on your Wi-Fi. Restart it with <code>.\\start.ps1 -Lan</code>, then open this again for a QR code.</p>
      <p class="hint">Anyone on that network could use your Gemini key, so only do this on a network you trust.</p>`;Q(`#phone`).hidden=!1}),Q(`#phone-close`).addEventListener(`click`,()=>Q(`#phone`).hidden=!0);async function $x(e){document.body.classList.add(`print-mode`),document.documentElement.dataset.theme=`paper`;let t=Q(`#print-view`);t.hidden=!1,t.innerHTML=`<p class="hint">Loading the report…</p>`;let n,r;try{let[t,i]=await Promise.all([fetch(`/api/investigations/${e}/evidence`),fetch(`/api/investigations`)]);if(!t.ok)throw Error();n=await t.json(),r=(await i.json()).find(t=>t.id===e)||{}}catch{t.innerHTML=db(`Report not found`,`It may have been deleted, or the server isn't running.`);return}let i=n.patterns||{},a=n.check||{},o=n.inputs||{},s=n.wiring,c=n.skeptic,l=n.simulation,u=a.available?a.verdict===`INFERRED`?`<span class="verdict v-INFERRED">INFERRED</span> ${Z(a.inferred.text)}`:`<span class="verdict v-${a.verdict}">${a.verdict}</span> The parts predict ${tb(a.predicted.frequency_hz)}; the video measured ${tb(a.measured.frequency_hz)} (${a.error_pct}% apart, ±${a.tolerance_pct}% allowed).`:`<span class="verdict v-SKIPPED">NOT CHECKED</span> ${Z(a.reason||``)}`,d=`<div class="pv-bar"><button class="btn-run" id="pv-print">Print / Save as PDF</button><button class="pill" id="pv-copy">Copy link</button>
      <a class="pill" href="/api/investigations/${e}/report.md" download>.md</a><a class="pill" href="/">Open GENESIS</a></div>
    <article class="pv"><header class="pv-head"><div><p class="kicker">GENESIS report</p><h1>${Z(r.title&&r.title!==`Investigation`?r.title:i.top?.name||`Investigation`)}</h1>
      ${n.device?.kind?`<p class="muted" style="margin:4px 0 0">${Z(n.device.kind)}</p>`:``}</div>
      <div class="meta">${e.slice(0,8)}<br>${r.created?new Date(r.created*1e3).toLocaleString():``}<br>${r.mode===`demo`?`sample · scripted models`:`live · Gemini`}</div></header>
    ${i.top?`<p><b>${Z(i.top.name)}</b> (${Z(i.confidence.toLowerCase())} fit). ${Z(i.top.summary)}</p>`:``}
    <h2>Check against the device</h2><p>${u}</p>`;l?.available&&(d+=`<h2>Simulation (${l.supply?.volts} V, ${Z(l.supply?.source||``)})</h2><table><tbody>${l.readings.map(e=>`<tr><td>${Z(e.label)}</td><td class="mono">${Z(e.value)}</td><td class="muted">${Z(e.note||``)}</td></tr>`).join(``)}</tbody></table>
    ${l.warnings.length?`<ul>${l.warnings.map(e=>`<li><b>${Z(e.level)}</b>: ${Z(e.text)}${e.fix?` Fix: ${Z(e.fix.component)} → ${Z(e.fix.display)}.`:``}</li>`).join(``)}</ul>`:`<p>All parts within their ratings.</p>`}`),o.items&&(d+=`<h2>Evidence given</h2><table><tbody>${o.items.map(e=>`<tr><td>${e.given?`✓`:`–`}</td><td><b>${Z(e.label)}</b></td><td>${Z(e.impact||e.detail)}</td></tr>`).join(``)}</tbody></table>`),n.components?.length&&(d+=`<h2>Parts</h2><table><thead><tr><th></th><th>Id</th><th>Part</th><th>Value</th><th>Status</th></tr></thead><tbody>${n.components.map(e=>`<tr><td><div class="pcrop" style="${gb(e)}"></div></td><td class="mono">${e.id}</td><td>${Z(ob(e.type))}</td><td class="mono">${Z(e.display||e.marking||``)}</td><td>${Z(e.status||``)} ${Z(e.confidence||``)}</td></tr>`).join(``)}</tbody></table>`),s&&(d+=`<h2>Wiring to replicate</h2><p class="hint">${Z(s.basis)}</p><div class="schem-print" id="pv-schem"></div>
    <table><thead><tr><th>Net</th><th>Join these</th><th>Done</th></tr></thead><tbody>${s.nets.map(e=>`<tr><td><span class="swatch" style="background:${e.color}"></span><b>${e.id}</b> ${Z(e.name)}</td><td>${e.pins.map(e=>`${Z(e.id||e.part)} ${Z(e.pin)}`).join(`<br>`)}</td><td>☐</td></tr>`).join(``)}</tbody></table>`),n.unknowns?.length&&(d+=`<h2>Still unknown, and what to do next</h2><ol>${n.unknowns.map(e=>`<li>${Z(e.text)}.${e.ask?` <i>Next: ${Z(e.ask)}.</i>`:``}</li>`).join(``)}</ol>`),c&&(d+=`<h2>Report · skeptic flagged ${c.flagged} of ${c.claims}</h2>`+c.sections.map(e=>`<h3 style="font-size:13px;margin:14px 0 4px">${Z(e.title)}</h3>${e.sentences.map(e=>`<p class="${e.flags.length?`flagged`:``}">${Z(e.text)} <span class="mono" style="font-size:11px">[${e.cites.map(Z).join(`, `)}]</span></p>`).join(``)}`).join(``)),d+=`<p class="foot">Generated by GENESIS. Models see and explain; code measures, simulates and decides; values count only once a person approves them.</p></article>`,t.innerHTML=d,s&&Fy(Q(`#pv-schem`),s).catch(()=>Ey(Q(`#pv-schem`),s)),Q(`#pv-print`).addEventListener(`click`,()=>window.print()),Q(`#pv-copy`).addEventListener(`click`,async()=>{try{await navigator.clipboard.writeText(location.href),hb(`Link copied.`)}catch{hb(location.href)}})}fetch(`/api/info`).then(e=>e.json()).catch(()=>null),Ry();var eS=location.hash.match(/^#report\/([0-9a-f]{6,32})$/);eS?$x(eS[1]):(Cy(),Kx(),yb(),Qy.setComponents(Wy,{animate:!By}),By||Qy.intro(),Q(`#rotate-btn`).classList.toggle(`is-on`,Hy.rotate===`on`),xb(),Rb(),zx(),tS(),location.hash===`#demo`&&Q(`[data-sample="full"]`).click()),window.addEventListener(`hashchange`,()=>{(/^#report\//.test(location.hash)||document.body.classList.contains(`print-mode`))&&location.reload()});function tS(){let e=document.createElement(`div`);e.className=`static-note`,e.innerHTML=`<b>Online demo.</b> Pick a sample below (555 blinker, ESP32 board or Robot car): it replays a real recorded run of the GENESIS pipeline, and what-ifs are simulated live by the real Python code running in your browser.
    To investigate your own device from photos and video, run GENESIS on your computer with a free Gemini key:
    <a href="https://github.com/B-Aladin/genesis#run-it-on-your-computer" target="_blank" rel="noopener">how to run it</a>.`,Q(`#intake`).prepend(e)}window.addEventListener(`genesis-toast`,e=>hb(e.detail));export{l as n,o as t};