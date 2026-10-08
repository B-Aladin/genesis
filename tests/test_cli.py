"""The real CLI (streaming, approval prompt, follow-up loop, evidence file), with scripted models."""
import copy
import json

from genesis_see import agent as A
from genesis_see import run
from fakes import OBSERVATION, FnModel, make_photo, make_video, observer, reporter, scripted

STEPS = ["watch_video", "observe_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"]


async def test_cli_taped_label_story(tmp_path, monkeypatch, capfd):
    obs = copy.deepcopy(OBSERVATION)
    obs["components"][4]["value_printed"] = None
    del obs["components"][3]
    obs["changing_region"]["component_index"] = 4
    plan = STEPS + [("text", "Probably a 555 blinker; C1 is probably 100 uF."),
                    ("confirm_value", {"component_id": "O4", "value": "100uF", "reason": "worked out from the blink rate"}),
                    "write_report", ("text", "Recorded. The parts now match the video.")]
    log = []
    models = A.Models(coordinator=FnModel(label="lite", fn=scripted(plan), log=log), coordinator_flash=FnModel(label="f", fn=scripted([]), log=log),
                      observer=FnModel(label="o", fn=observer(obs, []), log=log),
                      reporter=FnModel(label="r", fn=reporter, log=log), reporter_flash=FnModel(label="rf", fn=reporter, log=log))
    real_build = A.build_agent
    monkeypatch.setattr(run, "build_agent", lambda *a, extra_tools=None, **kw: real_build(models, extra_tools=extra_tools))
    answers = iter(["Please record the capacitor value you worked out.", "a", ""])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))
    work = tmp_path / "work"
    code = await run.main(["--photo", make_photo(tmp_path / "p.png"), "--video", make_video(tmp_path / "v.mp4"), "--work-dir", str(work), "--no-research"])
    out = capfd.readouterr().out
    assert code == 0
    assert "-> watch_video()" in out and "Measured by code" in out
    assert "X1 INFERRED" in out                                   # worked out, not yet recorded
    assert "[approval needed]" in out and "confirm_value" in out   # the human was asked
    assert "Recorded O4 = 100 µF" in out and "CONSISTENT" in out   # approved, re-checked
    assert "REPORT" in out and "skeptic: number not found in the evidence: 1998" in out
    ev = json.loads((work / "evidence.json").read_text(encoding="utf-8"))
    assert ev["check"]["verdict"] == "CONSISTENT" and ev["skeptic"]["claims"] == 4
