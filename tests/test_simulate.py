"""Electrical simulation and device-level recognition (code only)."""
from genesis_see import core, demo, simulate
from test_bench_features import _snap


def test_555_matches_the_formula_and_the_video():
    st = _snap()
    st["note"] = "9 V battery"
    r = simulate.simulate(st)
    assert r["available"] and r["status"] == "SIMULATED" and r["supply"] == {"volts": 9.0, "source": "from the notes"}
    assert abs(r["frequency_hz"] - demo.F0) / demo.F0 < 0.01
    assert not [w for w in r["warnings"] if w["level"] != "info"]            # the sample board is healthy
    cap = r["signals"][0]["points"]
    assert 2.9 < min(v for _, v in cap[60:]) < 3.1 and 5.9 < max(v for _, v in cap) < 6.1   # swings 1/3 to 2/3 of 9 V


def test_what_if_overcurrent_gets_a_standard_value_fix():
    st = _snap()
    st["note"] = "9 V"
    r = simulate.simulate(st, {"O4": "100"})
    assert r["what_if"] == ["O4"]
    led = [w for w in r["warnings"] if w["part"] == "O6"][0]
    assert led["level"] == "danger" and led["fix"]["component"] == "O4" and led["fix"]["display"] == "470 Ω"
    assert simulate.simulate(st)["frequency_hz"] == r["frequency_hz"]      # the evidence itself is untouched


def test_esp_pin_current_and_no_model_case():
    r = simulate.simulate(_snap(demo.ESP_OBSERVATION, video_hz=1.0))
    assert r["available"] and any("6.4 mA" == x["value"] for x in r["readings"])
    st = _snap()
    st["patterns"] = {"top": {"id": "audio_amp", "name": "Audio amplifier"}}
    assert simulate.simulate(st)["available"] is False


def test_whole_devices_are_recognised():
    def top(parts):
        comps = [{"id": f"O{i + 1}", "confidence": "HIGH", **p} for i, p in enumerate(parts)]
        return core.score_patterns(comps, None)["top"]["id"]
    assert top([{"type": "ic", "marking": "TP4056"}, {"type": "battery"}]) == "liion_charger"
    assert top([{"type": "ic", "marking": "LM2596S"}, {"type": "inductor"}, {"type": "diode"}]) == "buck_converter"
    assert top([{"type": "ic", "marking": "MT3608"}, {"type": "inductor"}]) == "boost_converter"
    assert top([{"type": "transformer"}, {"type": "optocoupler", "marking": "PC817"}, {"type": "ic", "marking": "OB2263"}]) == "mains_adapter"
    assert top([{"type": "ic", "marking": "PAM8403"}, {"type": "speaker"}]) == "audio_amp"
    assert top([{"type": "sensor_module", "marking": "DHT11"}]) == "sensor_module"
    assert core.normalize_type("PC817 optocoupler") == "optocoupler"
