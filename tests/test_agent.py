"""The real agent team (coordinator, subagents, tools, middleware, approvals, memory)
driven by scripted test doubles instead of Gemini: zero Gemini requests."""
import copy

import pytest
from langchain.messages import HumanMessage
from langgraph.types import Command

from genesis_see.agent import Models, SeeItContext, build_agent, start_state
from fakes import F0, OBSERVATION, FnModel, make_photo, make_video, observer, reporter, scripted

STEPS = ["watch_video", "observe_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"]


def team(plan, observation=OBSERVATION, flash_plan=None):
    log, seen = [], []
    models = Models(coordinator=FnModel(label="lite", fn=scripted(plan), log=log),
                    coordinator_flash=FnModel(label="flash", fn=scripted(flash_plan or []), log=log),
                    observer=FnModel(label="observer-lite", fn=observer(observation, seen), log=log),
                    reporter=FnModel(label="reporter-lite", fn=reporter, log=log),
                    reporter_flash=FnModel(label="reporter-flash", fn=reporter, log=log))
    return build_agent(models), log, seen


@pytest.fixture
def media_files(tmp_path):
    return make_photo(tmp_path / "front.png"), make_video(tmp_path / "blink.mp4")


def run(agent, state, tmp_path, thread="t1", free_tier=True):
    cfg = {"configurable": {"thread_id": thread}, "recursion_limit": 40}
    return agent.invoke(state, config=cfg, context=SeeItContext(free_tier=free_tier, work_dir=str(tmp_path / "work"))), cfg


def test_full_investigation(media_files, tmp_path):
    photo, video = media_files
    agent, log, seen = team(STEPS + [("text", "A 555 blinker; the parts match the video; photograph the back next.")])
    r, _ = run(agent, start_state([photo], video), tmp_path)
    # code measured the video
    assert abs(r["video"]["regions"][0]["analysis"]["frequency_hz"] - F0) / F0 < 0.03
    # the observer subagent got 1 photo + 2 key frames as image blocks, and was told about the magenta box
    blocks = seen[0]
    assert sum(b["type"] == "image" for b in blocks) == 3
    assert "magenta box" in blocks[0]["text"]
    # deterministic verdicts
    assert r["patterns"]["top"]["id"] == "astable555"
    assert r["check"]["verdict"] == "CONSISTENT"
    assert (r["check"]["roles"]["RA"], r["check"]["roles"]["RB"]) == ("O2", "O3")
    # the skeptic caught the reporter's invented sentence
    assert r["skeptic"]["flagged"] == 1
    assert r["messages"][-1].text.startswith("A 555 blinker")
    # the evidence gate offered exactly one step at a time
    coord = [e for e in log if e["label"] == "lite"]
    assert [e["tools"] for e in coord[:6]] == [[s] for s in STEPS[:5]] + [["confirm_value", "write_report"]]
    # the dynamic prompt carried the state forward
    assert "Parts: 6 seen" in coord[3]["system"] and "Next: call check_prediction" in coord[3]["system"]
    # free tier: every model call stayed on Flash-Lite
    assert {e["label"] for e in log} == {"lite", "observer-lite", "reporter-lite"}


def test_inferred_value_needs_human_approval(media_files, tmp_path):
    """The taped-label demo: the AI infers C, but only a human can make it a recorded value."""
    photo, video = media_files
    obs = copy.deepcopy(OBSERVATION)
    obs["components"][4]["value_printed"] = None
    obs["components"][4]["evidence"] = "electrolytic can, label covered with tape"
    del obs["components"][3]
    obs["changing_region"]["component_index"] = 4
    plan = STEPS + [("text", "C1 is probably 100 uF."),
                    ("confirm_value", {"component_id": "O4", "value": "100uF", "reason": "inferred from the blink rate"}),
                    "write_report", ("text", "Recorded and re-checked.")]
    agent, log, _ = team(plan, obs)
    r, cfg = run(agent, start_state([photo], video), tmp_path)
    assert r["check"]["verdict"] == "INFERRED"
    assert next(c for c in r["components"] if c["id"] == "O4")["status"] == "INFERRED"
    # second turn on the same thread (memory): the agent proposes the value; a human must approve
    r = agent.invoke({"messages": [HumanMessage("Please record the capacitor value you worked out.")]}, config=cfg,
                     context=SeeItContext(work_dir=str(tmp_path / "work")))
    req = r["__interrupt__"][0].value["action_requests"][0]
    assert req["name"] == "confirm_value" and req["args"]["value"] == "100uF"
    assert next(c for c in agent.get_state(cfg).values["components"] if c["id"] == "O4")["human_value"] is None
    r = agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config=cfg, context=SeeItContext(work_dir=str(tmp_path / "work")))
    o4 = next(c for c in r["components"] if c["id"] == "O4")
    assert o4["value"]["basis"] == "you" and r["check"]["verdict"] == "CONSISTENT"
    assert r["skeptic"] is not None and r["messages"][-1].text == "Recorded and re-checked."


def test_human_edit_is_rechecked(media_files, tmp_path):
    photo, video = media_files
    plan = STEPS + [("text", "done"), ("confirm_value", {"component_id": "O5", "value": "100uF", "reason": "user read the label"}),
                    ("text", "The label you read doesn't match the video.")]
    agent, _, _ = team(plan)
    r, cfg = run(agent, start_state([photo], video), tmp_path)
    ctx = SeeItContext(work_dir=str(tmp_path / "work"))
    agent.invoke({"messages": [HumanMessage("The capacitor label says 100uF.")]}, config=cfg, context=ctx)
    r = agent.invoke(Command(resume={"decisions": [{"type": "edit", "edited_action": {"name": "confirm_value",
                     "args": {"component_id": "O5", "value": "10uF", "reason": "user corrected"}}}]}), config=cfg, context=ctx)
    assert r["check"]["verdict"] == "CONTRADICTED"
    assert any(s["component"] == "O5" for s in r["check"]["suggestions"])
    assert r["report"] is None  # out of date until rewritten


def test_flash_explains_when_allowed(media_files, tmp_path):
    photo, video = media_files
    agent, log, _ = team(STEPS, flash_plan=[("text", "Explained by Flash.")])
    r, _ = run(agent, start_state([photo], video), tmp_path, free_tier=False)
    labels = [e["label"] for e in log]
    assert "reporter-flash" in labels and "reporter-lite" not in labels
    assert labels[-1] == "flash" and r["messages"][-1].text == "Explained by Flash."
    assert "observer-lite" in labels  # vision always on Flash-Lite


def test_no_video(tmp_path):
    agent, _, _ = team(STEPS + [("text", "No video, so no behaviour check.")])
    r, _ = run(agent, start_state([make_photo(tmp_path / "p.png")], None), tmp_path)
    assert r["check"]["available"] is False
    assert any("No video" in u["text"] for u in r["unknowns"])


def test_observer_failure_is_reported_not_guessed(media_files, tmp_path):
    photo, video = media_files

    def broken(messages, tools):
        raise RuntimeError("429 RESOURCE_EXHAUSTED")
    log = []
    models = Models(coordinator=FnModel(label="lite", fn=scripted(["watch_video", "observe_parts", ("text", "The observer hit the quota.")]), log=log),
                    coordinator_flash=FnModel(label="flash", fn=scripted([]), log=log),
                    observer=FnModel(label="observer", fn=broken, log=log),
                    reporter=FnModel(label="r", fn=reporter, log=log), reporter_flash=FnModel(label="rf", fn=reporter, log=log))
    r, _ = run(build_agent(models), start_state([photo], video), tmp_path)
    assert not r.get("observed")
    assert "RESOURCE_EXHAUSTED" in r["messages"][-2].content and "do not guess" in r["messages"][-2].content
