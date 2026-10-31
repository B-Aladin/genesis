"""A device as layers: power, control, sensing, drive, communication, interface (code, no model).

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
    (r"\bTT\b|yellow.*gear|gear ?motor|dagu", 0.20, 1.5, "TT gear motor: ~0.2 A running, ~1.5 A stalled at 6 V"),
    (r"\bN20\b|micro gear", 0.10, 0.6, "N20 micro gear motor: ~0.1 A running, ~0.6 A stalled"),
    (r"\b130\b|hobby motor|toy motor", 0.30, 2.0, "130-size motor: ~0.3 A running, ~2 A stalled"),
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
    (r"(2|two) ?x? ?18650|2s|7\.4 ?v", 7.4, 2500, 5.0, "2 × 18650 Li-ion (7.4 V)", 0.15),
    (r"(3|three) ?x? ?18650|3s|11\.1 ?v", 11.1, 2500, 5.0, "3 × 18650 Li-ion (11.1 V)", 0.2),
    (r"18650|li-?ion cell|3\.7 ?v", 3.7, 2500, 5.0, "18650 Li-ion cell (3.7 V)", 0.08),
    (r"lipo", 7.4, 1000, 20.0, "2S LiPo (7.4 V)", 0.05),
    (r"(4|four) ?x? ?aa\b|6 ?v", 6.0, 2000, 1.0, "4 × AA alkaline (6 V)", 0.6),
    (r"(6|six) ?x? ?aa\b|9 ?v pack", 9.0, 2000, 1.0, "6 × AA alkaline (9 V)", 0.9),
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
