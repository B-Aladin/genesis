"""The deterministic core, ported 1:1 from the tested JavaScript prototype."""
import copy

import pytest

from genesis_see import core
from fakes import OBSERVATION


def near(a, b, rel=0.01):
    assert abs(a - b) <= abs(b) * rel, f"{a} not within {rel:%} of {b}"


def video_for(freq=0.7, duty=0.52, alternate=False, flat=False):
    rate, n = 15, 150
    mk = lambda ph: [60 if flat else (220 if ((i / rate) * freq + ph) % 1 < duty else 40) for i in range(n)]
    traces = [mk(0), mk(0.5)] if alternate else [mk(0)]
    regions = [] if flat else [{"index": i, "box": [10 + 20 * i, 10, 14 + 20 * i, 14], "area": 16, "trace": t,
                                "analysis": core.analyze_waveform(t, 1 / rate, 10)} for i, t in enumerate(traces)]
    return {"frames": n, "dt": 1 / rate, "regions": regions,
            "relations": [{"a": 0, "b": 1, "correlation": -0.95, "kind": "alternate"}] if alternate else []}


def comps(raw=OBSERVATION):
    return core.normalize_observation(copy.deepcopy(raw))["components"]


def test_waveform():
    s = [200 if ((i / 15) * 0.7) % 1 < 0.45 else 40 for i in range(150)]
    a = core.analyze_waveform(s, 1 / 15, 10)
    near(a["frequency_hz"], 0.7, 0.03)
    assert abs(a["duty_cycle"] - 0.45) < 0.05 and a["confidence"] == "HIGH"
    assert core.analyze_waveform([80 + i % 2 for i in range(100)], 1 / 15, 10)["periodic"] is False


@pytest.mark.parametrize("bands,ohms", [(["brown", "black", "orange", "gold"], 1e4), (["gold", "orange", "black", "brown"], 1e4),
                                         (["yellow", "violet", "red", "gold"], 4700), (["brown", "black", "black", "red", "brown"], 1e4)])
def test_bands(bands, ohms):
    assert core.decode_bands(bands)["value"] == ohms


@pytest.mark.parametrize("s,v", [("10k", 1e4), ("4k7", 4700), ("4R7", 4.7), ("220", 220), ("103", 1e4), ("1M", 1e6), ("2.2kΩ", 2200), ("4702", 47000)])
def test_resistance(s, v):
    near(core.parse_resistance(s), v, 1e-9)


@pytest.mark.parametrize("s,v", [("100uF 16V", 1e-4), ("100µF", 1e-4), ("100μF", 1e-4), ("0.1uF", 1e-7), ("10n", 1e-8),
                                  ("4u7", 4.7e-6), ("100MFD", 1e-4), ("47pF", 4.7e-11)])
def test_capacitance(s, v):
    near(core.parse_capacitance(s), v, 1e-9)


def test_capacitance_codes_depend_on_type():
    near(core.parse_capacitance("104", "capacitor_ceramic"), 1e-7, 1e-9)
    near(core.parse_capacitance("1000", "capacitor_electrolytic"), 1e-3, 1e-9)


def test_observation_normalised():
    c = comps()
    assert [x["id"] for x in c] == ["O1", "O2", "O3", "O4", "O5", "O6"]
    assert c[1]["value"]["value"] == 1000 and c[1]["value"]["basis"] == "colour bands"


def test_patterns():
    p = core.score_patterns(comps(), video_for())
    assert p["top"]["id"] == "astable555" and p["confidence"] == "HIGH"
    p = core.score_patterns(comps(), None)
    assert "a light that blinks at a steady rate" in p["top"]["unknown"]
    raw = copy.deepcopy(OBSERVATION); raw["components"][0]["marking"] = None; raw["components"][0]["confidence"] = "LOW"
    p = core.score_patterns(comps(raw), video_for())
    assert p["top"]["id"] == "astable555" and p["confidence"] != "HIGH"


def test_other_patterns():
    mv = {"components": [{"type": "transistor"}] * 2 + [{"type": "capacitor_electrolytic", "value_printed": "10uF"}] * 2
          + [{"type": "resistor", "bands": ["yellow", "violet", "orange", "gold"]}] * 4 + [{"type": "led"}] * 2}
    assert core.score_patterns(comps(mv), video_for(1.5, 0.5, alternate=True))["top"]["id"] == "multivibrator"
    lc = {"components": [{"type": "ic", "marking": "LM393", "confidence": "HIGH"}, {"type": "ldr"}, {"type": "potentiometer"}, {"type": "led"}]}
    assert core.score_patterns(comps(lc), video_for(flat=True))["top"]["id"] == "light_comparator"


def test_555_consistent_and_admits_ambiguity():
    x = core.cross_check("astable555", comps(), video_for(0.7, 0.52))
    assert x["verdict"] == "CONSISTENT" and x["roles"]["RB"] == "O3" and "also be assigned" in x["ambiguity"]


def test_555_taped_label_inferred():
    raw = copy.deepcopy(OBSERVATION); raw["components"][4]["value_printed"] = None
    c = [x for x in comps(raw) if x["id"] != "O4"]
    x = core.cross_check("astable555", c, video_for(F := 1.44 / (21000 * 100e-6), 0.52))
    assert x["verdict"] == "INFERRED" and x["inferred"]["component"] == "O5"
    near(x["inferred"]["standard"], 100e-6, 1e-9)


def test_555_misread_caught():
    raw = copy.deepcopy(OBSERVATION); raw["components"][4]["value_printed"] = "10uF"
    x = core.cross_check("astable555", [c for c in comps(raw) if c["id"] != "O4"], video_for(0.686, 0.52))
    assert x["verdict"] == "CONTRADICTED"
    assert any(s["component"] == "O5" and "ten times" in s["text"] for s in x["suggestions"])


def test_multivibrator_check():
    raw = {"components": [{"type": "resistor", "bands": ["yellow", "violet", "orange", "gold"]}] * 2
           + [{"type": "resistor", "bands": ["yellow", "violet", "brown", "gold"]}] * 2
           + [{"type": "capacitor_electrolytic", "value_printed": "10uF"}] * 2}
    x = core.cross_check("multivibrator", comps(raw), video_for(1 / (0.693 * 2 * 47000 * 10e-6), 0.5, alternate=True))
    assert x["verdict"] == "CONSISTENT" and sorted([x["roles"]["R1"], x["roles"]["R2"]]) == ["O1", "O2"]


def test_investigator():
    raw = copy.deepcopy(OBSERVATION); raw["components"][1]["bands"] = None
    c = comps(raw)
    U = " | ".join(u["text"] for u in core.investigate(c, core.score_patterns(c, None), None, None, 1, ["the copper traces on the back"]))
    assert "O2's value couldn't be read" in U and "No video" in U and "one side" in U and "voltages" in U


def test_skeptic():
    report = {"sections": [{"title": "What it is", "sentences": [
        {"text": "This is a 555 timer blinker.", "cites": ["O1", "P1"]},
        {"text": "It blinks at 0.71 Hz.", "cites": ["V1"]},
        {"text": "It was designed in 1987.", "cites": []},
        {"text": "The capacitor is 470 µF.", "cites": ["O9"]}]}]}
    r = core.skeptic_check(report, ["O1", "P1", "V1"], "O1 ic marking NE555P\nV1 blinks at 0.71 Hz")
    flags = [s["flags"] for s in r["sections"][0]["sentences"]]
    assert flags[0] == [] and flags[1] == []                      # 555 grounded through NE555P
    assert any("cites no evidence" in f for f in flags[2]) and any("1987" in f for f in flags[2])
    assert any("O9" in f for f in flags[3]) and any("470" in f for f in flags[3])
    assert r["flagged"] == 2
