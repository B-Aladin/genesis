"""Bench calculators (pure maths), shared by the web Lab and the genesis-lab MCP tools.

Each returns a dict with the result, the formula, and plain-language notes.
Inputs accept the same forms as the rest of GENESIS: 4k7, 104, 100uF, 2.2M.
"""
from __future__ import annotations

import math
import re

from . import core
from .simulate import LED_VF
from .sketches import _e12_at_least
from .system import BATTERIES, DRIVERS, MOTORS, SERVOS, STEPPERS


def _num(x, name: str) -> float:
    try:
        v = float(str(x).strip().replace(",", "."))
    except ValueError:
        raise ValueError(f"{name} must be a number")
    return v


def _ohms(x, name: str) -> float:
    v = core.parse_resistance(str(x))
    if not v:
        raise ValueError(f"{name}: can't read '{x}' as a resistance (try 470, 4k7, 1M)")
    return v


def _farads(x, name: str) -> float:
    v = core.parse_capacitance(str(x))
    if not v:
        raise ValueError(f"{name}: can't read '{x}' as a capacitance (try 100uF, 104, 47n)")
    return v


def led_resistor(supply_v, led: str = "red", current_ma=12) -> dict:
    vs, i = _num(supply_v, "supply"), _num(current_ma, "current") / 1000
    vf = LED_VF.get(str(led).lower()) or _num(led, "LED forward voltage")
    if vs <= vf:
        raise ValueError(f"A {vs:g} V supply can't light an LED that needs {vf:g} V")
    r = (vs - vf) / i
    r12 = _e12_at_least(r)
    i_real = (vs - vf) / r12
    p = i_real ** 2 * r12
    watt = "1/8 W" if p < 0.06 else "1/4 W" if p < 0.12 else "1/2 W" if p < 0.25 else "1 W"
    return {"resistor": core.fmt_ohms(r12), "exact": core.fmt_ohms(r), "current_ma": round(i_real * 1000, 1), "power_mw": round(p * 1000, 1),
            "rating": watt, "formula": "R = (V_supply − V_LED) / I", "notes": [f"LED forward voltage {vf:g} V", "rounded up to the next standard value, so the LED stays under the target current"]}


def divider(vin, r1=None, r2="10k", vout=None) -> dict:
    vi = _num(vin, "input voltage")
    b = _ohms(r2, "R2 (to ground)")
    if vout not in (None, ""):
        target = _num(vout, "target output")
        if not 0 < target < vi:
            raise ValueError("the output must be between 0 V and the input")
        a = _e12_at_least(b * (vi / target - 1))
    else:
        a = _ohms(r1, "R1 (top)")
    out = vi * b / (a + b)
    i = vi / (a + b)
    return {"r1": core.fmt_ohms(a), "r2": core.fmt_ohms(b), "vout": round(out, 3), "current_ua": round(i * 1e6, 1), "ratio": round(b / (a + b), 4),
            "formula": "Vout = Vin × R2 / (R1 + R2)",
            "notes": ["R1 is rounded up, so the output stays at or below the target (safe for 3.3 V and 5 V pins)" if vout not in (None, "") else
                      "the divider's own load: keep the input pin's resistance much higher than R2"]}


def ohms_law(v=None, i_ma=None, r=None) -> dict:
    vals = {"v": None if v in (None, "") else _num(v, "voltage"), "i": None if i_ma in (None, "") else _num(i_ma, "current") / 1000,
            "r": None if r in (None, "") else _ohms(r, "resistance")}
    if sum(x is not None for x in vals.values()) < 2:
        raise ValueError("give any two of voltage, current and resistance")
    if vals["v"] is None:
        vals["v"] = vals["i"] * vals["r"]
    elif vals["i"] is None:
        vals["i"] = vals["v"] / vals["r"]
    elif vals["r"] is None:
        vals["r"] = vals["v"] / vals["i"]
    p = vals["v"] * vals["i"]
    return {"voltage_v": round(vals["v"], 4), "current_ma": round(vals["i"] * 1000, 3), "resistance": core.fmt_ohms(vals["r"]),
            "power_mw": round(p * 1000, 2), "formula": "V = I × R, P = V × I",
            "notes": ["above 250 mW a standard 1/4 W resistor runs hot"] if p > 0.25 else []}


def rc_time(r, c) -> dict:
    R, C = _ohms(r, "R"), _farads(c, "C")
    tau = R * C
    return {"tau_s": tau, "t63_s": tau, "t95_s": 3 * tau, "t99_s": 5 * tau, "cutoff_hz": 1 / (2 * math.pi * tau),
            "formula": "τ = R × C, f_c = 1 / (2π R C)", "notes": ["a capacitor charges to 63 % in one τ and is practically full after 5 τ"]}


def monostable_555(r, c) -> dict:
    R, C = _ohms(r, "R"), _farads(c, "C")
    t = 1.1 * R * C
    return {"pulse_s": t, "formula": "t = 1.1 × R × C", "notes": ["one pulse per trigger on pin 2; R from VCC to pins 6 and 7, C from pins 6/7 to ground"]}


def battery_runtime(capacity_mah, current_ma, usable_pct=80) -> dict:
    cap, i = _num(capacity_mah, "capacity"), _num(current_ma, "current")
    if i <= 0:
        raise ValueError("current must be above zero")
    h = cap * _num(usable_pct, "usable %") / 100 / i
    return {"hours": round(h, 2), "days": round(h / 24, 2), "formula": "t = capacity × usable fraction / current",
            "notes": [f"assumes {usable_pct}% of the capacity is usable before the voltage drops too far"]}


def motor_check(battery: str = "2x18650", driver: str = "L298N", motor: str = "TT", count=2) -> dict:
    """Can this battery and driver run these motors? Stall currents, driver ratings and voltage loss."""
    n = int(_num(count, "motor count"))
    bat = next((b for b in BATTERIES if re.search(b[0], battery, re.I)), None)
    if not bat:
        raise ValueError("battery: try 2x18650, 4xAA, 9V, LiPo or USB")
    row = next(r for r in (SERVOS if re.search("servo|SG90|MG99", motor, re.I) else STEPPERS if re.search("stepper|NEMA|28BYJ", motor, re.I) else MOTORS)
               if re.search(r[0], motor, re.I))
    drv = next((d for d in DRIVERS if re.search(d[0], driver, re.I)), None)
    run, stall = row[1] * n, row[2] * n
    v_motor = bat[1] - (drv[3] if drv else 0)
    out, notes = {"battery": bat[4], "motor": row[3], "running_a": round(run, 2), "startup_a": round(stall, 2),
                  "battery_max_a": bat[3], "motor_volts": round(v_motor, 2)}, []
    verdict = "OK"
    if stall > bat[3]:
        verdict = "battery too weak"
        notes.append(f"start-up needs ~{stall:.1f} A; a {bat[4]} gives ~{bat[3]} A")
    if drv:
        out["driver"] = drv[4]
        if row[2] > drv[2]:
            verdict = "driver too small"
            notes.append(f"each {drv[4]} channel peaks at {drv[2]} A; one stalled motor pulls ~{row[2]} A")
        if drv[3] >= 1:
            notes.append(f"the {drv[4]} drops ~{drv[3]:g} V: motors see ~{v_motor:.1f} V")
    if bat[2]:
        out["runtime_h"] = round(bat[2] / 1000 * 0.8 / max(run, 0.01), 1)
    out["verdict"], out["notes"] = verdict, notes or ["battery and driver can carry these motors"]
    out["formula"] = "start-up current ≈ motors × stall current; V_motor = V_battery − driver drop"
    return out


TOOLS = {"led": led_resistor, "divider": divider, "ohms": ohms_law, "rc": rc_time, "mono555": monostable_555,
         "battery": battery_runtime, "motors": motor_check}
