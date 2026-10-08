"""MVP plumbing: saved investigations, usage metering, feedback. No Gemini, no network."""
import json

from genesis_see import demo, product
from genesis_see.agent import build_agent


def test_saved_session_keeps_only_the_last_snapshot(tmp_path):
    folder = tmp_path / "abc123"
    folder.mkdir()
    events = [{"seq": 0, "type": "busy", "busy": True}, {"seq": 1, "type": "state", "state": {"n": 1}},
              {"seq": 2, "type": "say", "text": "hi"}, {"seq": 3, "type": "state", "state": {"n": 2}}]
    product.save_session(folder, {"id": "abc123", "mode": "demo", "events": events, "last": {"n": 2}})
    [rec] = product.load_sessions(tmp_path)
    assert [e["type"] for e in rec["events"]] == ["busy", "say", "state"]
    assert [e["seq"] for e in rec["events"]] == [0, 1, 2]          # renumbered for replay
    assert rec["events"][-1]["state"] == {"n": 2}


def test_provider_classification():
    assert product.classify({"id": ["genesis_see", "demo", "ScriptedModel"]}, {}) == "scripted"
    assert product.classify({}, {"ls_model_name": "gemini-3.1-flash-lite"}) == "gemini_lite"
    assert product.classify({}, {"ls_model_name": "gemini-3.8-flash"}) == "gemini_flash"
    assert product.classify({"id": ["langchain_groq", "ChatGroq"]}, {}) == "groq"


def test_usage_counter_sees_every_model_call_including_subagents(tmp_path):
    counts = []
    agent = build_agent(demo.models())
    photo, video = demo.sample_media(tmp_path / "s")
    from genesis_see.agent import SeeItContext, start_state
    cfg = {"configurable": {"thread_id": "u1"}, "recursion_limit": 40, "callbacks": [product.UsageCounter(counts.append)]}
    agent.invoke(start_state([photo], video), config=cfg, context=SeeItContext(work_dir=str(tmp_path / "w")))
    assert set(counts) == {"scripted"}
    assert len(counts) >= 8          # six coordinator turns, a final reply, the observer and the reporter


def test_daily_usage_and_feedback_files(tmp_path):
    product.add_daily(tmp_path, "gemini_lite", 3)
    product.add_daily(tmp_path, "scripted", 5)                     # scripted calls are free and not counted
    assert product.usage_today(tmp_path)["today"] == {"gemini_lite": 3}
    product.record_feedback(tmp_path, {"id": "x", "rating": "wrong", "note": "it was a PIR sensor"})
    line = json.loads((tmp_path / "feedback.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert line["rating"] == "wrong" and "at" in line
