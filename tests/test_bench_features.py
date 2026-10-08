"""Web bench features that run as code: input checks, toolkit-aware next steps,
Arduino / ESP sketches, wiring for replication, dev-board recognition. No Gemini, no network."""
import cv2
import numpy as np

from genesis_see import core, demo, diagrams, inputs, sketches


def _snap(observation=demo.OBSERVATION, video_hz=demo.F0, materials=()):
    obs = core.normalize_observation(observation)
    comps = obs["components"]
    video = {"frames": 300, "duration_s": 12, "camera_moved": False, "relations": [],
             "regions": [{"index": 0, "area": 40, "box": [0, 0, 4, 4], "analysis": {"periodic": True, "frequency_hz": video_hz, "duty_cycle": demo.DUTY,
                                                   "confidence": "HIGH", "cycles": 8}}]}
    p = core.score_patterns(comps, video)
    x = core.cross_check(p["top"]["id"], comps, video)
    from genesis_see.agent import apply_statuses
    comps = apply_statuses(comps, x)
    return {"components": comps, "patterns": p, "check": x, "video": video, "board": obs["board"],
            "note": "", "materials": list(materials)}


def test_missing_inputs_are_named_with_their_cost(tmp_path):
    photo = tmp_path / "p.png"
    cv2.imwrite(str(photo), np.full((400, 600, 3), 90, np.uint8))     # small and featureless: blurry
    a = inputs.assess([str(photo)], None, "", [])
    keys = {g["key"] for g in a["gaps"]}
    assert {"front", "back", "video"} <= keys
    assert "can't check it against the device" in a["verdict"]
    assert any("blurry" in c for c in inputs.observer_cautions(a["photos"]))


def test_next_steps_use_what_the_user_has():
    U = [{"id": "U1", "text": "Roles not settled: RA and RB could swap", "ask": "A photo of the back", "ev": []},
         {"id": "U2", "text": "No video, so behaviour can't be measured", "ask": "A 10-second video", "ev": []},
         {"id": "U3", "text": "Pixels can't show voltages", "ask": "Part 3", "ev": []}]
    comps = [{"id": "O1", "type": "ic", "marking": "NE555P"}]
    out = inputs.tailor(U, ["Multimeter", "Arduino (Uno, Nano…)"], comps, None)
    assert "continuity" in out[0]["ask"] and "pin 8 to pin 7" in out[0]["ask"]
    assert out[1]["sketch"] == {"kind": "frequency", "board": "arduino"}
    assert out[2]["sketch"]["kind"] == "voltage" and out[2]["id"] == "U3"
    plain = inputs.tailor(U, [], comps, None)
    assert all("with" not in u for u in plain)


def test_micro_board_choice():
    assert inputs.micro_board(["ESP32 or ESP8266"]) == "esp32"
    assert inputs.micro_board(["NodeMCU"]) == "esp8266"
    assert inputs.micro_board(["Arduino (Uno, Nano…)"]) == "arduino"
    assert inputs.micro_board(["Multimeter"]) is None


def test_sketch_dividers_keep_pins_safe():
    for board, vmax in (("arduino", 5.0), ("esp32", 3.3), ("esp8266", 3.2)):
        for supply in (3.3, 5, 9, 12, 24):
            d = sketches.divider(supply, board)
            assert d["pin_max"] <= vmax, (board, supply, d)
    code = sketches.sketch("frequency", "esp32", 9.0, expect_hz=0.686)
    assert "analogReadMilliVolts" in code and "shared ground" in code and "0.686" in code
    assert sketches.supply_from(["9 V battery clip at the left edge"]) == 9.0


def test_wiring_nets_for_the_555_use_the_checked_roles():
    w = diagrams.wiring(_snap())
    nets = {n["key"]: n for n in w["nets"]}
    joined = lambda k: {(p["id"], p["pin"]) for p in nets[k]["pins"]}
    roles = _snap()["check"]["roles"]
    assert ("O1", "pin 7 (DIS)") in joined("dis") and (roles["RA"], "end 2") in joined("dis")
    assert ("O1", "pin 6 (THR)") in joined("thr") and ("O1", "pin 2 (TRIG)") in joined("thr")
    assert (roles["C"], "+ (long leg)") in joined("thr")
    assert [n["id"] for n in w["nets"]] == [f"N{i + 1}" for i in range(len(w["nets"]))]
    assert "flowchart LR" in diagrams.mermaid(w)


def test_esp_dev_board_is_recognised_and_wired():
    st = _snap(demo.ESP_OBSERVATION, video_hz=1.0)
    assert st["components"][0]["type"] == "dev_board"
    assert st["patterns"]["top"]["id"] == "mcu_blinker"
    assert any(r["id"] == "esp_board" for r in st["patterns"]["supporting"])
    w = diagrams.wiring(st)
    assert any("3.3 V" in t for t in w["notes"])
    assert {n["key"] for n in w["nets"]} == {"pwr", "gpio", "led", "gnd"}
