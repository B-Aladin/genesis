"""Electrical simulation of the matched circuit (code, no model).

From the wiring (diagrams.wiring: which observed part plays which role) and the
part values, compute what the circuit does and whether every part is inside its
ratings: waveforms, per-part current and power, LED current, supply current and
battery life, and warnings with a concrete fix (the nearest standard value).

What-if: `overrides` replaces part values ({"O4": "220"}) without touching the
recorded evidence; results are labelled SIMULATED. Every assumption that is not
evidence (LED forward voltage from its colour, 1/4 W resistors, 555 output drop,
battery capacity) is listed with the result.
"""
from __future__ import annotations

import copy
import math
import re

from . import core, diagrams
from .sketches import _e12_at_least, supply_from

LED_VF = {"red": 1.9, "orange": 2.0, "yellow": 2.0, "green": 2.1, "blue": 3.0, "white": 3.0}
LED_MAX_A = 0.020            # typical continuous rating of a 5 mm indicator LED
LED_TARGET_A = 0.012         # comfortable brightness, well inside the rating
RES_W = 0.25                 # assumed 1/4 W through-hole resistors unless known
BATTERY_MAH = {9: 500, 12: 1000, 5: 2000, 3.7: 2000}   # rough alkaline 9 V / pack / USB power bank / Li-ion cell
CMOS_555 = re.compile(r"TLC555|LMC555|ICM7555|(^|[^0-9])7555|TS555|ALD555", re.I)
GPIO = {"arduino": (5.0, 0.020, 0.040, "ATmega328P"), "esp32": (3.3, 0.020, 0.040, "ESP32"),
        "esp8266": (3.3, 0.012, 0.012, "ESP8266")}   # logic V, recommended A, absolute max A


def fmt_a(a: float) -> str:
    return f"{a * 1000:.1f} mA" if abs(a) < 1 else f"{a:.2f} A"


def fmt_w(w: float) -> str:
    return f"{w * 1000:.0f} mW" if w < 1 else f"{w:.2f} W"


def _led_vf(c: dict | None) -> tuple[float, str]:
    text = f"{(c or {}).get('evidence', '')} {(c or {}).get('marking') or ''}".lower()
    for colour, vf in LED_VF.items():
        if colour in text:
            return vf, colour
    return 2.0, "unknown colour"


def apply_overrides(st: dict, overrides: dict | None) -> tuple[dict, list[str]]:
    """A copy of the state with what-if values in place of the observed ones."""
    st = copy.deepcopy(st)
    changed = []
    for c in st.get("components") or []:
        text = (overrides or {}).get(c["id"])
        if not text:
            continue
        if c["type"] == "resistor":
            v = core.parse_resistance(text)
            unit = "ohm"
        elif c["type"].startswith("capacitor"):
            v = core.parse_capacitance(text, c["type"])
            unit = "F"
        else:
            continue
        if v:
            c["value"] = {"value": v, "unit": unit, "basis": "what-if", "tolerance_pct": 5 if unit == "ohm" else 20}
            c["display"] = core.fmt_value(c)
            changed.append(c["id"])
    return st, changed


def _val(part: dict, by_id: dict) -> float | None:
    c = by_id.get(part.get("id") or "")
    return ((c or {}).get("value") or {}).get("value")


def _square(t_on: float, t_off: float, hi: float, lo: float, periods: int = 3, n: int = 240):
    T = t_on + t_off
    pts = []
    for i in range(n + 1):
        t = periods * T * i / n
        pts.append([round(t, 6), hi if (t % T) < t_on else lo])
    return pts


def _warn(level: str, part: str | None, text: str, fix: dict | None = None) -> dict:
    return {"level": level, "part": part, "text": text, "fix": fix}


def _cap_rating(c: dict | None) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*V\b", (c or {}).get("value_printed") or "", re.I)
    return float(m.group(1)) if m else None


def _battery(vs: float, i_avg: float) -> dict | None:
    cap = next((mah for v, mah in sorted(BATTERY_MAH.items(), key=lambda kv: abs(kv[0] - vs)) if abs(v - vs) < 1.5), None)
    if not cap or i_avg <= 0:
        return None
    return {"label": "Battery life (estimate)", "value": f"≈ {cap / (i_avg * 1000):.0f} h", "note": f"assumes a {cap} mAh source"}


# ---------------------------------------------------------------- 555 astable --


def _sim_555(st: dict, w: dict, vs: float) -> dict:
    by = {c["id"]: c for c in st.get("components") or []}
    P = w["parts"]
    ra, rb, cc, rl = _val(P["RA"], by), _val(P["RB"], by), _val(P["C"], by), _val(P["RL"], by)
    need = [r for r, v in (("RA", ra), ("RB", rb), ("C", cc)) if not v]
    if need:
        return {"available": False, "reason": f"needs a value for {', '.join(need)}; tell GENESIS what the label says or type a what-if value"}
    ic = by.get(P["U"].get("id") or "") or {}
    cmos = bool(CMOS_555.search(ic.get("marking") or ""))
    led = by.get(P["LED"].get("id") or "")
    vf, colour = _led_vf(led)
    t_hi, t_lo = math.log(2) * (ra + rb) * cc, math.log(2) * rb * cc
    T = t_hi + t_lo
    f, duty = 1 / T, t_hi / T
    v_hi = vs - (0.1 if cmos else 1.5)
    low = w.get("low")
    lit_frac = (1 - duty) if low else duty
    # capacitor: charges vs/3 -> 2vs/3 through RA+RB, discharges 2vs/3 -> vs/3 through RB
    tau_c, tau_d = (ra + rb) * cc, rb * cc
    cap_pts, out_pts = [], []
    n = 300
    for i in range(n + 1):
        t = 3 * T * i / n
        k = t % T
        if k < t_hi:
            v = vs - (vs - vs / 3) * math.exp(-k / tau_c)
            o = v_hi
        else:
            v = (2 * vs / 3) * math.exp(-(k - t_hi) / tau_d)
            o = 0.1
        cap_pts.append([round(t, 6), round(v, 3)])
        out_pts.append([round(t, 6), round(o, 3)])
    warnings, parts, assumptions = [], {}, [
        f"LED forward voltage {vf} V ({colour})", f"resistors rated {RES_W} W", f"{'CMOS' if cmos else 'bipolar NE555'} output high ≈ supply − {0.1 if cmos else 1.5} V"]
    i_led = None
    if rl and led:
        drive = (vs - vf - 0.1) if low else (v_hi - vf)
        i_led = max(0.0, drive / rl)
        parts[P["RL"]["id"]] = {"current_a": i_led, "power_w": i_led ** 2 * rl, "avg_power_w": i_led ** 2 * rl * lit_frac, "rating_w": RES_W}
        parts[led["id"]] = {"current_a": i_led, "voltage_v": vf, "rating_a": LED_MAX_A}
        target_r = _e12_at_least(max(drive, 0.1) / LED_TARGET_A)
        if i_led > LED_MAX_A:
            warnings.append(_warn("danger" if i_led > 1.5 * LED_MAX_A else "warn", led["id"],
                                  f"LED current {fmt_a(i_led)} is above the {fmt_a(LED_MAX_A)} a typical LED is rated for; it will run hot and fade.",
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r),
                                   "why": f"limits the LED to about {fmt_a(drive / target_r)}"}))
        elif i_led < 0.002:
            warnings.append(_warn("info", led["id"], f"LED current is only {fmt_a(i_led)}: it will be dim." +
                                  (" A blue or white LED needs about 3 V just to light." if vf >= 3 else ""),
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r),
                                   "why": f"about {fmt_a(drive / target_r)} through the LED"} if target_r < rl else None))
        if i_led ** 2 * rl > RES_W:
            warnings.append(_warn("danger", P["RL"]["id"], f"The LED resistor dissipates {fmt_w(i_led ** 2 * rl)} while lit, above a {RES_W} W rating.",
                                  {"component": P["RL"]["id"], "value": target_r, "display": core.fmt_ohms(target_r), "why": "less current, less heat"}))
        if cmos and not low and i_led > 0.010:
            warnings.append(_warn("warn", ic.get("id"), f"A CMOS 555 sources only about 10 mA; {fmt_a(i_led)} will pull its output down.",
                                  {"component": P["RL"]["id"], "value": _e12_at_least(max(v_hi - vf, 0.1) / 0.008),
                                   "display": core.fmt_ohms(_e12_at_least(max(v_hi - vf, 0.1) / 0.008)), "why": "keeps the output under 10 mA"}))
        elif i_led > 0.2:
            warnings.append(_warn("danger", ic.get("id"), f"{fmt_a(i_led)} is above the 555's 200 mA output limit.", None))
    elif led and not P["RL"].get("id"):
        warnings.append(_warn("warn", led["id"], "No LED resistor was seen. Without one the LED current is limited only by the 555 output; "
                                                "check the back of the board before powering it.", None))
    # RA sees the full supply when pin 7 discharges
    p_ra_peak = vs ** 2 / ra
    p_ra_avg = p_ra_peak * (1 - duty)
    parts[P["RA"]["id"]] = {"current_a": vs / ra, "power_w": p_ra_peak, "avg_power_w": p_ra_avg, "rating_w": RES_W}
    parts[P["RB"]["id"]] = {"current_a": vs / (ra + rb), "power_w": (vs / (ra + rb)) ** 2 * rb, "rating_w": RES_W}
    if p_ra_avg > RES_W / 2:
        ra_fix = _e12_at_least(vs ** 2 / (RES_W / 2))
        warnings.append(_warn("danger" if p_ra_avg > RES_W else "warn", P["RA"]["id"],
                              f"RA averages {fmt_w(p_ra_avg)} (pin 7 shorts it to ground every cycle), more than half its {RES_W} W rating.",
                              {"component": P["RA"]["id"], "value": ra_fix, "display": core.fmt_ohms(ra_fix),
                               "why": "cuts the discharge current; the blink rate changes a little"}))
    if ra < 1000:
        warnings.append(_warn("info", P["RA"]["id"], f"RA is {core.fmt_ohms(ra)}: pin 7 sinks {fmt_a(vs / ra)} at every discharge. Most designs keep RA at 1 kΩ or more.", None))
    rating = _cap_rating(by.get(P["C"].get("id") or ""))
    if rating:
        parts[P["C"]["id"]] = {"voltage_v": 2 * vs / 3, "rating_v": rating}
        if rating < vs:
            warnings.append(_warn("danger", P["C"]["id"], f"The capacitor is rated {rating:g} V on a {vs:g} V circuit.", None))
        elif rating < 1.25 * vs:
            warnings.append(_warn("info", P["C"]["id"], f"The capacitor's {rating:g} V rating leaves little margin on {vs:g} V; 1.5× or more is usual.", None))
    if f > 25:
        warnings.append(_warn("info", None, f"At {f:.1f} Hz the LED blinks faster than the eye can follow; it will look steadily lit.", None))
    i_q = 0.0001 if cmos else 0.003 + 0.0003 * vs
    i_avg = i_q + (i_led or 0) * lit_frac + (vs / ra) * (1 - duty) * 0.5
    readings = [{"label": "Blink rate", "value": f"{f:.3f} Hz", "note": f"period {T:.3f} s"},
                {"label": "LED on", "value": f"{lit_frac * 100:.0f} %", "note": f"{(t_lo if low else t_hi):.3f} s per cycle"},
                {"label": "LED current", "value": fmt_a(i_led) if i_led is not None else "—", "note": "while lit"},
                {"label": "Supply current", "value": fmt_a(i_avg), "note": "average, estimate"}]
    bat = _battery(vs, i_avg)
    if bat:
        readings.append(bat)
    measured = ((st.get("video") or {}).get("regions") or [{}])[0].get("analysis", {}).get("frequency_hz")
    if measured:
        readings.insert(1, {"label": "Video measured", "value": f"{measured:.3f} Hz",
                            "note": f"{abs(f - measured) / measured * 100:.1f} % from the simulation"})
    return {"available": True, "pattern": "astable555", "formula": "f = 1 / (0.693·(RA + 2·RB)·C)",
            "signals": [{"name": "Capacitor (pins 2, 6)", "unit": "V", "color": "#3b57d9", "points": cap_pts},
                        {"name": "Output (pin 3)", "unit": "V", "color": "#6b2a2e", "points": out_pts}],
            "readings": readings, "parts": parts, "warnings": warnings, "assumptions": assumptions,
            "frequency_hz": f, "duty": duty}


# ------------------------------------------------------- two-transistor flasher --


def _sim_multivibrator(st: dict, w: dict, vs: float) -> dict:
    by = {c["id"]: c for c in st.get("components") or []}
    P = w["parts"]
    rb1, rb2, c1, c2 = (_val(P[k], by) for k in ("RB1", "RB2", "C1", "C2"))
    rc1, rc2 = _val(P["RC1"], by), _val(P["RC2"], by)
    need = [k for k, v in (("R base1", rb1), ("R base2", rb2), ("C1", c1), ("C2", c2)) if not v]
    if need:
        return {"available": False, "reason": f"needs values for {', '.join(need)}"}
    t1, t2 = math.log(2) * rb2 * c1, math.log(2) * rb1 * c2      # LED1 lit while Q2 is held off, and the reverse
    T = t1 + t2
    warnings, parts, readings = [], {}, [{"label": "Blink rate", "value": f"{1 / T:.3f} Hz", "note": f"LED1 {t1:.2f} s, LED2 {t2:.2f} s"}]
    for rc, rb, led_key, q in ((rc1, rb1, "L1", "Q1"), (rc2, rb2, "L2", "Q2")):
        led = by.get(P[led_key].get("id") or "")
        vf, _ = _led_vf(led)
        if not rc:
            continue
        i_c = max(0.0, (vs - vf - 0.2) / rc)
        i_b = max(0.0, (vs - 0.7) / rb)
        rc_id = P["RC1" if q == "Q1" else "RC2"]["id"]
        parts[rc_id] = {"current_a": i_c, "power_w": i_c ** 2 * rc, "rating_w": RES_W}
        if led:
            parts[led["id"]] = {"current_a": i_c, "voltage_v": vf, "rating_a": LED_MAX_A}
        readings.append({"label": f"{led_key.replace('L', 'LED')} current", "value": fmt_a(i_c), "note": "while lit"})
        if i_c > LED_MAX_A:
            fix = _e12_at_least((vs - vf - 0.2) / LED_TARGET_A)
            warnings.append(_warn("warn", led["id"] if led else rc_id, f"{led_key.replace('L', 'LED')} current {fmt_a(i_c)} is above {fmt_a(LED_MAX_A)}.",
                                  {"component": rc_id, "value": fix, "display": core.fmt_ohms(fix), "why": "about 12 mA through the LED"}))
        if i_b * 100 < i_c:
            warnings.append(_warn("warn", P[q].get("id"), f"{q} gets {fmt_a(i_b)} of base current for {fmt_a(i_c)}: with a gain of 100 it may not switch fully on.",
                                  None))
    if vs > 6:
        warnings.append(_warn("info", None, f"At each switch a base is pulled to about −{vs:g} V. Small transistors' base-emitter junctions break down "
                                            "near −5 to −6 V, which shortens the timing; a diode in series with each base prevents it.", None))
    v1 = _square(t2, t1, vs, 0.2, n=240)   # Q1 collector is high while Q1 is off (LED2's phase)
    v2 = _square(t2, t1, 0.2, vs, n=240)
    return {"available": True, "pattern": "multivibrator", "formula": "T = 0.693·(R2·C1 + R1·C2)",
            "signals": [{"name": "Q1 collector", "unit": "V", "color": "#3b57d9", "points": v1},
                        {"name": "Q2 collector", "unit": "V", "color": "#6b2a2e", "points": v2}],
            "readings": readings, "parts": parts, "warnings": warnings,
            "assumptions": ["NPN transistors with a gain of at least 100", "LED forward voltage from its colour", f"resistors rated {RES_W} W"],
            "frequency_hz": 1 / T, "duty": t1 / T}


# ------------------------------------------------------ microcontroller output --


def _sim_mcu(st: dict, w: dict, vs: float | None) -> dict:
    by = {c["id"]: c for c in st.get("components") or []}
    P = w["parts"]
    mcu = by.get(P["U"].get("id") or "") or {}
    text = f"{mcu.get('marking') or ''} {mcu.get('evidence') or ''}"
    fam = "esp8266" if re.search(r"8266|nodemcu|wemos|d1 ?mini", text, re.I) else "esp32" if core.RX["esp"].search(text) else "arduino"
    v_logic, i_rec, i_max, chip = GPIO[fam]
    led = by.get(P["LED"].get("id") or "")
    vf, colour = _led_vf(led)
    r = _val(P["R"], by)
    warnings, parts, readings = [], {}, [{"label": "Pin high level", "value": f"{v_logic:g} V", "note": chip}]
    if led and r:
        i = max(0.0, (v_logic - vf) / r)
        parts[P["R"]["id"]] = {"current_a": i, "power_w": i * i * r, "rating_w": RES_W}
        parts[led["id"]] = {"current_a": i, "voltage_v": vf, "rating_a": LED_MAX_A}
        readings.append({"label": "LED / pin current", "value": fmt_a(i), "note": f"{chip} recommends ≤ {fmt_a(i_rec)} per pin"})
        if i > i_rec:
            fix = _e12_at_least(max(v_logic - vf, 0.1) / min(LED_TARGET_A, i_rec * 0.8))
            warnings.append(_warn("danger" if i > i_max else "warn", P["U"].get("id"), f"The pin sources {fmt_a(i)}, above the {fmt_a(i_rec)} {chip} recommends.",
                                  {"component": P["R"]["id"], "value": fix, "display": core.fmt_ohms(fix), "why": "keeps the pin inside its rating"}))
        if vf >= v_logic - 0.2:
            warnings.append(_warn("warn", led["id"], f"A {colour} LED needs about {vf} V; a {v_logic:g} V pin can barely light it. Use a red LED or a transistor.", None))
    elif led and not r:
        warnings.append(_warn("danger", led["id"], f"No resistor was seen: an LED straight on a {chip} pin can exceed its {fmt_a(i_max)} limit.", None))
    meas = ((st.get("video") or {}).get("regions") or [{}])[0].get("analysis", {})
    signals = []
    if meas.get("frequency_hz"):
        f, d = meas["frequency_hz"], meas.get("duty_cycle") or 0.5
        signals.append({"name": "Pin (from the video)", "unit": "V", "color": "#6b2a2e", "points": _square(d / f, (1 - d) / f, v_logic, 0)})
        readings.insert(0, {"label": "Blink rate (measured)", "value": f"{f:.3f} Hz", "note": "set by firmware"})
    return {"available": True, "pattern": "mcu_blinker", "formula": "I = (V_pin − V_LED) / R", "signals": signals,
            "supply": {"volts": v_logic, "source": f"{chip} pin logic level"},
            "readings": readings, "parts": parts, "warnings": warnings,
            "assumptions": [f"{chip} pin at {v_logic:g} V", f"LED forward voltage {vf} V ({colour})", "timing comes from firmware, not from part values"],
            "frequency_hz": meas.get("frequency_hz"), "duty": meas.get("duty_cycle")}


SIMS = {"astable555": _sim_555, "multivibrator": _sim_multivibrator, "mcu_blinker": _sim_mcu}
DEFAULT_SUPPLY = {"astable555": 9.0, "multivibrator": 9.0}


def simulate(st: dict, overrides: dict | None = None, supply: float | None = None) -> dict:
    top = ((st.get("patterns") or {}).get("top") or {})
    if top.get("id") not in SIMS:
        return {"available": False, "reason": f"No electrical model for {top.get('name', 'this device')} yet. The parts, check and report still apply; "
                                              "the Lab calculators work for any 555 or resistor."}
    st2, changed = apply_overrides(st, overrides)
    w = diagrams.wiring(st2)
    if not w:
        return {"available": False, "reason": "The wiring couldn't be worked out from the parts that were seen."}
    found = supply_from([st.get("note") or ""] + [b.get("note", "") for b in st.get("board") or []])
    vs = supply or found or DEFAULT_SUPPLY.get(top["id"])
    source = "you set it" if supply else "from the notes" if found else "assumed" if vs else None
    out = SIMS[top["id"]](st2, w, vs)
    out.setdefault("supply", {"volts": vs, "source": source})
    out["what_if"] = changed
    if out.get("available") and source == "assumed":
        out.setdefault("assumptions", []).insert(0, f"{vs:g} V supply (not seen; set it in Lab)")
    out["status"] = "SIMULATED"
    order = {"danger": 0, "warn": 1, "info": 2}
    out["warnings"] = sorted(out.get("warnings") or [], key=lambda x: order.get(x["level"], 3))
    return out
