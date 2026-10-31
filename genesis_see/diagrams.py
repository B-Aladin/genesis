"""Wiring for the matched circuit: nets, a build order and a Mermaid diagram (code, no model).

The observer never sees copper, so these connections are the matched pattern's
standard wiring with the observed parts placed in their roles (from the check
when it ran). Every net is marked INFERRED; the UI and the report say so, and
suggest a continuity check before trusting a connection.

A net is one electrical node: everything in it must be joined together. To
replicate the circuit you make each net once; the build list numbers them.
"""
from __future__ import annotations

import re

from . import core

PALETTE = ["#1f6feb", "#8a3ffc", "#d97a00", "#0f8a5f", "#b8336a", "#0b7a8a", "#5b8c00", "#c2410c", "#4f46e5", "#a16207"]
COLORS = {"vbat": "#d1342f", "v5": "#e0569b", "in1": "#1f6feb", "in2": "#3b82f6", "in3": "#8a3ffc", "in4": "#a78bfa",
          "ena": "#0b7a8a", "enb": "#14b8a6", "ma1": "#d97a00", "ma2": "#f59e0b", "mb1": "#0f8a5f", "mb2": "#22c55e",
          "trig": "#b8336a", "echo": "#c2410c", "sig": "#b8336a", "servo1": "#4f46e5", "servo2": "#a16207",
          "vcc": "#d1342f", "gnd": "#1b1b1b", "dis": "#1f6feb", "thr": "#8a3ffc", "out": "#d97a00", "led": "#0f8a5f",
          "c1": "#1f6feb", "c2": "#0b7a8a", "b1": "#8a3ffc", "b2": "#b8336a", "l1": "#0f8a5f", "l2": "#5b8c00",
          "gpio": "#d97a00", "pwr": "#d1342f"}


def _val(c: dict | None) -> str:
    if not c:
        return ""
    return core.fmt_value(c) or c.get("marking") or ""


def _part(role: str, c: dict | None, kind: str, inferred_role: bool = False) -> dict:
    return {"role": role, "id": c["id"] if c else None, "kind": kind, "value": _val(c),
            "status": (c or {}).get("status", "MISSING" if not c else "OBSERVED"), "role_inferred": inferred_role,
            "label": f"{role} · {c['id']}" + (f" · {_val(c)}" if _val(c) else "") if c else f"{role} · not seen"}


def _pin(part: dict, pin: str) -> dict:
    return {"part": part["role"], "id": part["id"], "pin": pin}


def _supply_label(st: dict) -> str:
    from .sketches import supply_from
    v = supply_from([st.get("note") or ""] + [b.get("note", "") for b in st.get("board") or []])
    return f"+{v:g} V" if v else "+V"


def astable555(st: dict) -> dict:
    comps = st.get("components") or []
    by = {c["id"]: c for c in comps}
    x = st.get("check") or {}
    R = [c for c in comps if c["type"] == "resistor"]
    C = [c for c in comps if c["type"].startswith("capacitor")]
    roles = x.get("roles") if x.get("available") else None
    if roles:
        ra, rb, cc = by.get(roles["RA"]), by.get(roles["RB"]), by.get(roles["C"])
    else:
        ra, rb, cc = (R + [None, None])[0], (R + [None, None])[1], (C + [None])[0]
    rl = next((r for r in R if r is not ra and r is not rb), None)
    ic = next((c for c in comps if c.get("marking") and core.RX["t555"].search(c["marking"])), None) or \
        next((c for c in comps if c["type"] == "ic"), None)
    led = next((c for c in comps if c["type"] == "led"), None)
    P = {k: _part(*a) for k, a in {
        "U": ("555", ic, "ic"), "RA": ("RA", ra, "resistor", not roles), "RB": ("RB", rb, "resistor", not roles),
        "C": ("C", cc, "capacitor", not roles), "RL": ("R LED", rl, "resistor"), "LED": ("LED", led, "led"),
        "BAT": ("Supply", None, "supply")}.items()}
    P["BAT"].update(label=f"Supply · {_supply_label(st)}", status="OBSERVED" if st.get("board") else "MISSING")
    low = "output is low" in (x.get("led_wiring") or "")
    nets = [
        {"key": "vcc", "name": f"{_supply_label(st)} supply", "pins": [_pin(P["BAT"], "+"), _pin(P["U"], "pin 8 (VCC)"),
                                                                      _pin(P["U"], "pin 4 (RESET)"), _pin(P["RA"], "end 1")]
         + ([_pin(P["RL"], "end 1")] if low else [])},
        {"key": "dis", "name": "Discharge node", "pins": [_pin(P["U"], "pin 7 (DIS)"), _pin(P["RA"], "end 2"), _pin(P["RB"], "end 1")]},
        {"key": "thr", "name": "Timing node", "pins": [_pin(P["U"], "pin 6 (THR)"), _pin(P["U"], "pin 2 (TRIG)"), _pin(P["RB"], "end 2"),
                                                       _pin(P["C"], "+ (long leg)")]},
    ]
    if low:
        nets += [{"key": "led", "name": "LED drive", "pins": [_pin(P["RL"], "end 2"), _pin(P["LED"], "anode (long leg)")]},
                 {"key": "out", "name": "Output", "pins": [_pin(P["U"], "pin 3 (OUT)"), _pin(P["LED"], "cathode (flat side)")]}]
    else:
        nets += [{"key": "out", "name": "Output", "pins": [_pin(P["U"], "pin 3 (OUT)"), _pin(P["RL"], "end 1")]},
                 {"key": "led", "name": "LED drive", "pins": [_pin(P["RL"], "end 2"), _pin(P["LED"], "anode (long leg)")]}]
    nets.append({"key": "gnd", "name": "Ground", "pins": [_pin(P["BAT"], "−"), _pin(P["U"], "pin 1 (GND)"), _pin(P["C"], "− (stripe side)")]
                 + ([] if low else [_pin(P["LED"], "cathode (flat side)")])})
    notes = ["Pin 1 of the 555 is next to the notch or dot; pins count anticlockwise seen from above.",
             "Pin 5 (CV) usually has a 10 nF capacitor to ground or is left open; none was observed."]
    if low:
        notes.append("The measured on-time suggests the LED is wired from the supply to pin 3 (it lights while the output is low).")
    return {"pattern": "astable555", "layout": "astable555", "parts": P, "nets": nets, "notes": notes, "low": low}


def multivibrator(st: dict) -> dict:
    comps = st.get("components") or []
    T = [c for c in comps if c["type"] == "transistor"]
    C = [c for c in comps if c["type"].startswith("capacitor")]
    L = [c for c in comps if c["type"] == "led"]
    R = sorted([c for c in comps if c["type"] == "resistor"], key=lambda c: (c.get("value") or {}).get("value") or 0)
    g = lambda lst, i: lst[i] if len(lst) > i else None
    P = {k: _part(*a) for k, a in {
        "Q1": ("Q1", g(T, 0), "npn"), "Q2": ("Q2", g(T, 1), "npn"), "C1": ("C1", g(C, 0), "capacitor"), "C2": ("C2", g(C, 1), "capacitor"),
        "RC1": ("R LED1", g(R, 0), "resistor", True), "RC2": ("R LED2", g(R, 1), "resistor", True),
        "RB1": ("R base1", g(R, 2), "resistor", True), "RB2": ("R base2", g(R, 3), "resistor", True),
        "L1": ("LED1", g(L, 0), "led"), "L2": ("LED2", g(L, 1), "led"), "BAT": ("Supply", None, "supply")}.items()}
    P["BAT"].update(label=f"Supply · {_supply_label(st)}")
    nets = [
        {"key": "vcc", "name": f"{_supply_label(st)} supply", "pins": [_pin(P["BAT"], "+"), _pin(P["RC1"], "end 1"), _pin(P["RC2"], "end 1"),
                                                                      _pin(P["RB1"], "end 1"), _pin(P["RB2"], "end 1")]},
        {"key": "l1", "name": "LED1 feed", "pins": [_pin(P["RC1"], "end 2"), _pin(P["L1"], "anode (long leg)")]},
        {"key": "c1", "name": "Q1 collector", "pins": [_pin(P["L1"], "cathode (flat side)"), _pin(P["Q1"], "collector"), _pin(P["C1"], "+ (long leg)")]},
        {"key": "b2", "name": "Q2 base", "pins": [_pin(P["C1"], "− (stripe side)"), _pin(P["Q2"], "base"), _pin(P["RB2"], "end 2")]},
        {"key": "l2", "name": "LED2 feed", "pins": [_pin(P["RC2"], "end 2"), _pin(P["L2"], "anode (long leg)")]},
        {"key": "c2", "name": "Q2 collector", "pins": [_pin(P["L2"], "cathode (flat side)"), _pin(P["Q2"], "collector"), _pin(P["C2"], "+ (long leg)")]},
        {"key": "b1", "name": "Q1 base", "pins": [_pin(P["C2"], "− (stripe side)"), _pin(P["Q1"], "base"), _pin(P["RB1"], "end 2")]},
        {"key": "gnd", "name": "Ground", "pins": [_pin(P["BAT"], "−"), _pin(P["Q1"], "emitter"), _pin(P["Q2"], "emitter")]},
    ]
    notes = ["Transistors are assumed NPN (e.g. BC547 or 2N3904); check their markings. Pin order differs between types: look up the datasheet.",
             "The two smaller resistors are taken as the LED resistors and the two larger as base resistors (by value); verify with continuity."]
    return {"pattern": "multivibrator", "layout": "multivibrator", "parts": P, "nets": nets, "notes": notes}


def mcu_blinker(st: dict) -> dict:
    comps = st.get("components") or []
    mcu = next((c for c in comps if c["type"] == "dev_board"), None) or \
        next((c for c in comps if c.get("marking") and core.RX["mcu"].search(c["marking"])), None)
    R = [c for c in comps if c["type"] == "resistor"]
    out = next((c for c in comps if c["type"] in ("led", "relay", "buzzer", "motor")), None)
    esp = bool(mcu and core.RX["esp"].search((mcu.get("marking") or "") + " " + (mcu.get("evidence") or "")))
    P = {"U": _part("Controller", mcu, "mcu"), "R": _part("R", R[0] if R else None, "resistor"),
         "LED": _part("LED" if (out or {}).get("type", "led") == "led" else "Output", out, "led"),
         "BAT": _part("Power", None, "supply")}
    P["BAT"].update(label="Power · USB or VIN", status="MISSING")
    nets = [{"key": "pwr", "name": "Power", "pins": [_pin(P["BAT"], "USB 5 V or VIN"), _pin(P["U"], "5V / VIN" if not esp else "5V / VIN (3.3 V logic)")]},
            {"key": "gpio", "name": "Output pin", "pins": [_pin(P["U"], "GPIO (which pin is not visible)"), _pin(P["R"], "end 1")]},
            {"key": "led", "name": "LED drive", "pins": [_pin(P["R"], "end 2"), _pin(P["LED"], "anode (long leg)")]},
            {"key": "gnd", "name": "Ground", "pins": [_pin(P["U"], "GND"), _pin(P["LED"], "cathode (flat side)")]}]
    notes = ["The blink rate lives in the firmware, not in part values; to copy the behaviour you also need the sketch.",
             "Find the GPIO with the multimeter's continuity mode, from the resistor's free end to the board's header pins."]
    if esp:
        notes.append("ESP32 / ESP8266 pins are 3.3 V logic and not 5 V tolerant.")
    return {"pattern": "mcu_blinker", "layout": "mcu", "parts": P, "nets": nets, "notes": notes}


def robot(st: dict) -> dict:
    """The standard hook-up of a battery-powered robot: driver, controller, motors, sensor. One net per real wire."""
    comps = st.get("components") or []
    bat = next((c for c in comps if c["type"] == "battery"), None)
    drv = next((c for c in comps if core.RX["mdrv"].search(c.get("marking") or "")), None)
    mcu = next((c for c in comps if c["type"] == "dev_board"), None) or next((c for c in comps if core.RX["mcu"].search(c.get("marking") or "")), None)
    motors = [c for c in comps if c["type"] in ("motor", "stepper")][:2]
    servos = [c for c in comps if c["type"] == "servo"][:2]
    sensor = next((c for c in comps if c["type"] == "sensor_module" or core.RX["sensor"].search(c.get("marking") or "")), None)
    esp = bool(mcu and core.RX["esp"].search(f"{mcu.get('marking') or ''} {mcu.get('evidence') or ''}"))
    sr04 = bool(sensor and re.search(r"SR0\d", sensor.get("marking") or "", re.I))
    P = {"BAT": _part("Battery", bat, "supply"), "U": _part("Controller", mcu, "mcu")}
    if drv or motors:
        P["DRV"] = _part("Driver", drv, "driver")
    for i, m in enumerate(motors):
        P[f"M{i + 1}"] = _part(f"Motor {'AB'[i]}", m, "motor")
    for i, sv in enumerate(servos):
        P[f"SV{i + 1}"] = _part(f"Servo {i + 1}", sv, "servo")
    if sensor:
        P["S"] = _part("Sensor", sensor, "sensor")
    gpio = (lambda n: f"GPIO {n}") if esp else (lambda n: f"D{n}")
    nets = [{"key": "vbat", "name": "Battery +", "pins": [_pin(P["BAT"], "+")] + ([_pin(P["DRV"], "VS (motor supply)")] if "DRV" in P else [])},
            {"key": "gnd", "name": "Ground (shared by every layer)", "pins": [_pin(P["BAT"], "−"), _pin(P["U"], "GND")]
             + ([_pin(P["DRV"], "GND")] if "DRV" in P else []) + ([_pin(P["S"], "GND")] if sensor else [])
             + [_pin(P[f"SV{i + 1}"], "GND (brown)") for i in range(len(servos))]},
            {"key": "v5", "name": "+5 V logic", "pins": ([_pin(P["DRV"], "+5V out")] if "DRV" in P else [_pin(P["BAT"], "regulated 5 V")])
             + [_pin(P["U"], "5V" if not esp else "5V / VIN")] + ([_pin(P["S"], "VCC")] if sensor else [])
             + [_pin(P[f"SV{i + 1}"], "V+ (red)") for i in range(len(servos))]}]
    if "DRV" in P and motors:
        pins_in = [5, 6, 7, 8] if not esp else [25, 26, 27, 14]
        for j in range(2 * len(motors)):
            nets.append({"key": f"in{j + 1}", "name": f"Direction IN{j + 1}", "pins": [_pin(P["U"], gpio(pins_in[j])), _pin(P["DRV"], f"IN{j + 1}")]})
        for i, m in enumerate(motors):
            k = "ab"[i]
            nets.append({"key": f"m{k}1", "name": f"Motor {k.upper()} +", "pins": [_pin(P["DRV"], f"OUT{2 * i + 1}"), _pin(P[f"M{i + 1}"], "+")]})
            nets.append({"key": f"m{k}2", "name": f"Motor {k.upper()} −", "pins": [_pin(P["DRV"], f"OUT{2 * i + 2}"), _pin(P[f"M{i + 1}"], "−")]})
    for i in range(len(servos)):
        nets.append({"key": f"servo{i + 1}", "name": f"Servo {i + 1} signal", "pins": [_pin(P["U"], gpio(9 + i) + " (PWM)"), _pin(P[f"SV{i + 1}"], "signal (orange)")]})
    if sensor and sr04:
        nets.append({"key": "trig", "name": "Sensor trigger", "pins": [_pin(P["U"], gpio(11 if not esp else 12)), _pin(P["S"], "TRIG")]})
        nets.append({"key": "echo", "name": "Sensor echo" + (" (5 V: divide to 3.3 V)" if esp else ""),
                     "pins": [_pin(P["S"], "ECHO"), _pin(P["U"], gpio(12 if not esp else 13))]})
    elif sensor:
        nets.append({"key": "sig", "name": "Sensor signal", "pins": [_pin(P["S"], "OUT / DATA"), _pin(P["U"], gpio(2) + " or I2C")]})
    notes = ["Pin numbers on the controller are examples: the real ones are set by the firmware. Any free digital pins work for IN1–IN4.",
             "Keep ENA and ENB jumpers on for full speed, or move them to PWM pins to control speed." if drv and re.search("L298", drv.get("marking") or "", re.I) else
             "Check the driver's datasheet for its enable or standby pin.",
             "Motor direction is set by which of each IN pair is high; swap a motor's two wires if it runs backwards."]
    if servos:
        notes.append("Servos draw up to ~0.7 A each when stalled: power them from the battery through a 5–6 V regulator, not from the controller's 5 V pin.")
    if esp and sr04:
        notes.append("The HC-SR04 echo is 5 V: put 1 kΩ in series and 2 kΩ to ground before the ESP pin.")
    return {"pattern": "robot_drive", "layout": "auto", "parts": P, "nets": nets, "notes": notes}


def traced(st: dict) -> dict | None:
    """Wiring the observer could actually see (jumper wires, copper on the back): union of traced links into nets."""
    links = st.get("traces") or []
    if not links:
        return None
    comps = {c["id"]: c for c in st.get("components") or []}
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for t in links:
        a, b = (t["a"], t["a_pin"]), (t["b"], t["b_pin"])
        parent[find(a)] = find(b)
    groups = {}
    for node in list(parent):
        groups.setdefault(find(node), []).append(node)
    kind = {"resistor": "resistor", "led": "led", "diode": "diode", "inductor": "inductor", "crystal": "crystal",
            "transistor": "npn", "battery": "supply"}
    P = {}
    for cid in sorted({n[0] for nodes in groups.values() for n in nodes}, key=lambda x: int(x[1:]) if x[1:].isdigit() else 0):
        c = comps.get(cid) or {"id": cid, "type": "other"}
        k = "capacitor" if c["type"].startswith("capacitor") else kind.get(c["type"], "box")
        P[cid] = _part(cid, c, k)
        P[cid]["label"] = f"{cid} · {_val(c) or c['type'].replace('_', ' ')}"
    nets = []
    for i, nodes in enumerate(sorted(groups.values(), key=lambda g: -len(g))):
        names = " ".join(n[1].lower() for n in nodes)
        key = "gnd" if re.search(r"gnd|ground|−|-\b", names) else "vcc" if re.search(r"vcc|\+5|5v|3v3|vin|\+", names) and i < 3 else f"t{i + 1}"
        if any(n["key"] == key for n in nets):
            key = f"t{i + 1}"
        nets.append({"key": key, "name": "Ground" if key == "gnd" else "Supply" if key == "vcc" else f"Net {i + 1}",
                     "pins": [_pin(P[n[0]], n[1]) for n in nodes]})
    weak = sum(1 for t in links if t.get("confidence") == "LOW")
    return {"pattern": "traced", "layout": "auto", "parts": P, "nets": nets,
            "basis": f"Traced by the observer from {len(links)} connection(s) it could see (wires, copper). "
                     "A vision model can misread a trace: verify each net with a continuity check.",
            "notes": [f"{weak} of the {len(links)} connections were low-confidence sightings."] if weak else []}


BUILDERS = {"astable555": astable555, "multivibrator": multivibrator, "mcu_blinker": mcu_blinker, "robot_drive": robot}


def wiring(st: dict) -> dict | None:
    """Nets, build steps and notes for the top matched pattern, or None when no known circuit fits."""
    top = ((st.get("patterns") or {}).get("top") or {}).get("id")
    if top in BUILDERS and st.get("components"):
        w = BUILDERS[top](st)
    elif st.get("traces"):
        w = traced(st)
    else:
        return None
    for i, n in enumerate(w["nets"]):
        n["id"] = f"N{i + 1}"
        n["color"] = COLORS.get(n["key"], PALETTE[i % len(PALETTE)])
        n["pins"] = [p for p in n["pins"] if p["part"]]
    w["nets"] = [n for n in w["nets"] if len(n["pins"]) >= 2 or n["key"] in ("vbat", "gnd")]
    w["layout"] = w.get("layout") or w["pattern"]
    w["basis"] = w.get("basis") or ("Standard wiring of the matched circuit, with parts placed in their roles"
                  + (" by the check (X1)" if (st.get("check") or {}).get("available") else "")
                  + ". Not traced from copper: verify each net with a continuity check before relying on it.")
    if st.get("traces") and w["pattern"] != "traced":
        w["notes"] = w["notes"] + [f"The observer also traced {len(st['traces'])} connection(s) it could see; switch to Traced to compare."]
    w["steps"] = [f"{n['id']} {n['name']}: join " + ", ".join(_pin_text(w, p) for p in n["pins"]) for n in w["nets"]]
    w["missing"] = [p["label"] for p in w["parts"].values() if not p["id"] and p["kind"] != "supply"]
    return w


def _pin_text(w: dict, p: dict) -> str:
    return f"{p['id'] or p['part']} {p['pin']}"


def mermaid(w: dict) -> str:
    """A Mermaid flowchart: each net is a coloured node, each part pin an edge to it (GitHub renders it)."""
    L = ["flowchart LR"]
    for key, part in w["parts"].items():
        if any(p["part"] == part["role"] for n in w["nets"] for p in n["pins"]):
            L.append(f'  {key}["{part["label"]}"]')
    for n in w["nets"]:
        L.append(f'  {n["id"]}(("{n["id"]} {n["name"]}"))')
        for p in n["pins"]:
            key = next(k for k, v in w["parts"].items() if v["role"] == p["part"])
            L.append(f'  {key} ---|"{p["pin"]}"| {n["id"]}')
    for n in w["nets"]:
        L.append(f'  style {n["id"]} fill:{n["color"]},color:#fff,stroke:{n["color"]}')
    return "\n".join(L)
