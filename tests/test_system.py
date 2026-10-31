"""Whole devices: layers, power budget, robot simulation, robot and traced wiring, Lab calculators (code only)."""
import copy

import pytest

from genesis_see import calc, demo, diagrams, simulate, system
from test_bench_features import _snap


def _robot(**battery):
    obs = copy.deepcopy(demo.ROBOT_OBSERVATION)
    obs["components"][4].update(battery)
    st = _snap(obs, video_hz=demo.ROBOT_HZ)
    st["system"] = system.analyze(st)
    return st


def test_robot_is_recognised_and_split_into_layers():
    st = _robot()
    assert st["patterns"]["top"]["id"] == "robot_drive"
    s = st["system"]
    assert s["is_system"] and s["present"] == ["power", "control", "sensing", "drive", "interface"]
    drive = {p["label"] for layer in s["layers"] if layer["key"] == "drive" for p in layer["parts"]}
    assert "L298N" in drive and len([layer for layer in s["layers"] if layer["key"] == "drive"][0]["parts"]) == 3
    assert {"from": "power", "to": "drive", "label": "motor current (the big one)"} in s["flows"]


def test_power_budget_and_between_layer_warnings():
    b = _robot()["system"]["budget"]
    assert b["source"]["volts"] == 7.4 and b["source"]["max_a"] == 5.0
    assert 0.4 < b["run_a"] < 0.6 and 2.5 < b["peak_a"] < 3.5           # two TT motors stalling at start-up dominate
    assert 3.5 < b["runtime_h"] < 5
    texts = " ".join(w["text"] for w in _robot()["system"]["warnings"])
    assert "L298N" in texts and "capacitor" in texts and "ground" in texts


def test_a_9v_battery_cannot_start_the_motors():
    st = _robot(marking="9V PP3", evidence="a single 9 V PP3 battery")
    s = st["system"]
    assert s["budget"]["source"]["volts"] == 9.0
    assert any(w.get("level") in ("danger", "warn") and "9" in w["text"] for w in s["warnings"])


def test_robot_simulation_shows_the_start_up_dip():
    r = simulate.simulate(_robot())
    assert r["available"] and r["status"] == "SIMULATED"
    read = {x["label"]: x["value"] for x in r["readings"]}
    assert read["Battery"] == "7.4 V" and read["Running current"] == "477 mA" and read["Start-up peak"] == "3.08 A"
    assert r["warnings"][0]["part"] == "O2" and "regulator" in r["warnings"][0]["text"]
    volts = [s for s in r["signals"] if "voltage" in s["name"].lower()][0]["points"]
    assert min(v for _, v in volts) < 7.4


def test_robot_wiring_and_traced_wiring():
    st = _robot()
    w = diagrams.wiring(st)
    keys = [n["key"] for n in w["nets"]]
    assert {"vbat", "gnd", "v5", "in1", "in4", "ma1", "mb2", "trig", "echo"} <= set(keys)
    assert all(n["color"] for n in w["nets"])
    st["traces"] = [{"a": "O5", "a_pin": "+", "b": "O2", "b_pin": "12V"}, {"a": "O5", "a_pin": "-", "b": "O2", "b_pin": "GND"},
                    {"a": "O2", "a_pin": "GND", "b": "O1", "b_pin": "GND"}, {"a": "O2", "a_pin": "OUT1", "b": "O3", "b_pin": "red", "confidence": "LOW"}]
    t = diagrams.traced(st)
    assert t["pattern"] == "traced" and len(t["nets"]) == 3
    gnd = [n for n in t["nets"] if n["key"] == "gnd"][0]
    assert {p["part"] for p in gnd["pins"]} >= {t["parts"]["O1"]["role"], t["parts"]["O5"]["role"]}
    assert "1 of the 4" in t["notes"][0]


def test_lab_calculators():
    assert calc.led_resistor(9, "red", 12)["resistor"] == "680 Ω"
    d = calc.divider(5, r2="2k", vout=3.3)
    assert d["r1"] == "1.2 kΩ" and d["vout"] <= 3.3
    assert calc.ohms_law(v=5, r="1k")["current_ma"] == 5.0
    assert calc.rc_time("10k", "100uF")["tau_s"] == pytest.approx(1.0)
    assert calc.monostable_555("100k", "10uF")["pulse_s"] == pytest.approx(1.1)
    assert calc.battery_runtime(2500, 477, 80)["hours"] == pytest.approx(4.19, abs=0.01)
    assert calc.motor_check("9V", "L298N", "TT", 2)["verdict"] == "battery too weak"
    assert calc.motor_check("2x18650", "TB6612", "TT", 2)["verdict"] == "OK"
    with pytest.raises(ValueError):
        calc.battery_runtime("lots", 100)
    assert set(calc.TOOLS) == {"led", "divider", "ohms", "rc", "mono555", "battery", "motors"}
