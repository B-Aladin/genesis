"""Measurement sketches for an Arduino or ESP the user has on hand (templates, no model).

Two jobs the photos and video can't do:
  frequency  time the signal that drives the LED electrically, with the same
             hysteresis method GENESIS uses on the video (works without a video)
  voltage    log a node's voltage for the Serial Plotter, e.g. a 555's timing
             capacitor, which should swing between 1/3 and 2/3 of the supply

Every sketch comes with a voltage divider sized for the circuit's supply, so a
9 V circuit can't reach a 5 V Arduino pin or a 3.3 V ESP pin. Grounds must be shared.
"""
from __future__ import annotations

import re

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
BOARDS = {
    "arduino": {"name": "Arduino Uno / Nano", "vmax": 5.0, "target": 4.5, "pin": "A0", "adc": "analogRead(PIN) * (5.0 / 1023.0)",
                "pin_note": "A0", "fqbn": "Arduino AVR Boards"},
    "esp32": {"name": "ESP32", "vmax": 3.3, "target": 2.9, "pin": "34", "adc": "analogReadMilliVolts(PIN) / 1000.0",
              "pin_note": "GPIO34 (input only, ADC1)", "fqbn": "esp32 by Espressif"},
    "esp8266": {"name": "ESP8266 (NodeMCU / Wemos D1 mini)", "vmax": 3.2, "target": 2.9, "pin": "A0",
                "adc": "analogRead(PIN) * (3.2 / 1023.0)", "pin_note": "A0 (the board's own divider allows 0 to 3.2 V)",
                "fqbn": "esp8266 by ESP8266 Community"},
}


def supply_from(texts: list[str]) -> float | None:
    """A supply voltage mentioned in the user's note or the board notes, e.g. '9 V battery'."""
    for t in texts:
        m = re.search(r"(\d+(?:\.\d+)?)\s*-?\s*V\b(?!\w)", t or "", re.I)
        if m and 1 <= float(m.group(1)) <= 48:
            return float(m.group(1))
    return None


def _e12_at_least(ohms: float) -> float:
    for dec in range(0, 7):
        for v in E12:
            if v * 10 ** dec >= ohms:
                return v * 10 ** dec
    return 10e6


def divider(supply: float, board: str) -> dict:
    """R1 from the signal to the pin, R2 = 10k from the pin to ground. R1 is rounded UP to E12 (safe side)."""
    b = BOARDS[board]
    top = supply * 1.1                      # 10 % headroom for a fresh battery
    if top <= b["target"]:
        return {"r1": 0, "r2": None, "ratio": 1.0, "pin_max": round(top, 2), "text": f"no divider needed below {b['target']} V; use a 1 kΩ series resistor"}
    r2 = 10_000.0
    r1 = _e12_at_least(r2 * (top / b["target"] - 1))
    ratio = r2 / (r1 + r2)
    return {"r1": r1, "r2": r2, "ratio": round(ratio, 4), "pin_max": round(top * ratio, 2),
            "text": f"{_fmt(r1)} from the signal to the pin, 10 kΩ from the pin to GND"}


def _fmt(r: float) -> str:
    return f"{r / 1000:g} kΩ" if r >= 1000 else f"{r:g} Ω"


def sketch(kind: str, board: str, supply: float | None = None, node: str = "", expect_hz: float | None = None,
           supply_source: str = "from your notes", timer555: bool = True) -> str:
    board = board if board in BOARDS else "arduino"
    b = BOARDS[board]
    known = supply is not None
    vs = supply or 9.0
    d = divider(vs, board)
    scale = 1 / d["ratio"]
    where = node or ("the pin that drives the LED" if not timer555 else
                     "the 555's pin 3 (or the pin that drives the LED)" if kind == "frequency" else "the 555's pins 2 and 6 (the timing capacitor)")
    head = f"""// GENESIS measurement sketch: {"blink-rate counter" if kind == "frequency" else "voltage logger"} for {b['name']}
// Generated from your investigation. Board package: {b['fqbn']}.
//
// SAFETY: the circuit's supply is {"%g V (%s)" % (vs, supply_source) if known else "UNKNOWN: assumed 9 V. Measure it first and regenerate"}.
// Never connect more than {b['vmax']:g} V to a {b['name']} pin.
// Wiring:
//   {where}  ->  R1 = {_fmt(d['r1']) if d['r1'] else '1 kΩ series resistor'}  ->  {b['pin_note']}
//   {b['pin_note']}  ->  R2 = {_fmt(d['r2']) if d['r2'] else '(none)'}  ->  GND
//   circuit GND  ->  {b['name']} GND   (shared ground is required)
// With this divider the pin sees at most about {d['pin_max']:g} V.
// Open the Serial Monitor (or Serial Plotter) at 115200 baud.
"""
    pin = b["pin"] if board != "esp32" else "34"
    common = f"""
const int PIN = {pin};
const float DIVIDER = {scale:.4f};   // volts at the circuit = volts at the pin x DIVIDER

float readVolts() {{ return {b['adc']} * DIVIDER; }}
"""
    if kind == "voltage" and not timer555:
        return head + common + """
void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  Serial.print("node_V:");
  Serial.println(readVolts(), 3);
  delay(10);   // 100 samples per second
}
"""
    if kind == "voltage":
        third = f"{vs / 3:.2f}"
        two = f"{2 * vs / 3:.2f}"
        return head + common + f"""
void setup() {{
  Serial.begin(115200);
  delay(500);
}}

void loop() {{
  // Serial Plotter shows three lines: the node, and where a 555's capacitor should turn around.
  Serial.print("node_V:");     Serial.print(readVolts(), 3);
  Serial.print(" third_V:");   Serial.print({third});
  Serial.print(" two_thirds_V:"); Serial.println({two});
  delay(10);   // 100 samples per second
}}
"""
    expect = f"\n// GENESIS predicts about {expect_hz:.3f} Hz for comparison." if expect_hz else ""
    return head + expect + common + f"""
// Samples every millisecond and finds edges with hysteresis (10 % of the swing),
// the same way GENESIS times the LED in a video, then reports every 5 seconds.
const unsigned long WINDOW_MS = 5000;
float lo = 1e9, hi = -1e9;
bool high = false, primed = false;
unsigned long lastRise = 0, riseCount = 0, periodSum = 0, highSum = 0, riseAt = 0;
unsigned long windowStart = 0;

void setup() {{
  Serial.begin(115200);
  delay(500);
  Serial.println("GENESIS blink-rate counter: learning the signal levels...");
  windowStart = millis();
}}

void loop() {{
  static unsigned long nextSample = 0;
  unsigned long now = millis();
  if (now < nextSample) return;
  nextSample = now + 1;
  float v = readVolts();
  lo = min(lo, v); hi = max(hi, v);
  float span = hi - lo, mid = (hi + lo) / 2, hyst = 0.1 * span;
  if (span > 0.5) {{
    if (!high && v > mid + hyst) {{
      high = true;
      if (primed) {{ periodSum += now - lastRise; riseCount++; }}
      lastRise = now; riseAt = now; primed = true;
    }} else if (high && v < mid - hyst) {{
      high = false;
      highSum += now - riseAt;
    }}
  }}
  if (now - windowStart >= WINDOW_MS) {{
    if (riseCount == 0) {{
      Serial.print("no full cycle yet (swing "); Serial.print(span, 2); Serial.println(" V): check the wiring and the shared ground");
    }} else {{
      float period = periodSum / 1000.0 / riseCount;
      Serial.print("frequency_hz="); Serial.print(1.0 / period, 4);
      Serial.print(" period_s=");    Serial.print(period, 4);
      Serial.print(" duty=");        Serial.print((highSum / 1000.0) / (period * riseCount), 3);
      Serial.print(" cycles=");      Serial.print(riseCount);
      Serial.print(" swing_V=");     Serial.println(span, 2);
    }}
    periodSum = highSum = riseCount = 0;
    windowStart = now;
  }}
}}
"""
