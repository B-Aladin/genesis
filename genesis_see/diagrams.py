"""Wiring for the matched circuit: nets, a build order and a Mermaid diagram (code, no model).

The observer never sees copper, so these connections are the matched pattern's
standard wiring with the observed parts placed in their roles (from the check
when it ran). Every net is marked INFERRED; the UI and the report say so, and
suggest a continuity check before trusting a connection.

A net is one electrical node: everything in it must be joined together. To
replicate the circuit you make each net once; the build list numbers them.
"""
from __future__ import annotations

from . import core

COLORS = {"vcc": "#d1342f", "gnd": "#1b1b1b", "dis": "#1f6feb", "thr": "#8a3ffc", "out": "#d97a00", "led": "#0f8a5f",
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


BUILDERS = {"astable555": astable555, "multivibrator": multivibrator, "mcu_blinker": mcu_blinker}


def wiring(st: dict) -> dict | None:
    """Nets, build steps and notes for the top matched pattern, or None when no known circuit fits."""
    top = ((st.get("patterns") or {}).get("top") or {}).get("id")
    if top not in BUILDERS or not st.get("components"):
        return None
    w = BUILDERS[top](st)
    for i, n in enumerate(w["nets"]):
        n["id"] = f"N{i + 1}"
        n["color"] = COLORS.get(n["key"], "#555")
        n["pins"] = [p for p in n["pins"] if p["part"]]
    w["basis"] = ("Standard wiring of the matched circuit, with parts placed in their roles"
                  + (" by the check (X1)" if (st.get("check") or {}).get("available") else "")
                  + ". Not traced from copper: verify each net with a continuity check before relying on it.")
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
