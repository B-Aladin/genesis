"""The Researcher subagent (Part 1.2) and the quota fallback, with scripted models: zero real requests."""
import copy

import pytest
from langchain.tools import tool

from genesis_see.agent import Models, SeeItContext, build_agent, start_state
from fakes import OBSERVATION, FnModel, call, make_photo, make_video, observer, reporter, scripted

searches = []


@tool
def duckduckgo_search(query: str) -> str:
    """Search the web (test double)."""
    searches.append(query)
    return "NE555P datasheet: precision timer, supply 4.5 V to 16 V. https://www.ti.com/lit/ds/symlink/ne555.pdf"


def researcher_script(parts):
    steps = iter([call("duckduckgo_search", query="NE555P datasheet"), call("PartFacts", parts=parts, not_found=[])])
    return lambda messages, tools: next(steps)


def team(plan, research_parts, log):
    return Models(coordinator=FnModel(label="lite", fn=scripted(plan), log=log), coordinator_flash=FnModel(label="f", fn=scripted([]), log=log),
                  observer=FnModel(label="observer", fn=observer(OBSERVATION, []), log=log),
                  reporter=FnModel(label="reporter", fn=reporter, log=log), reporter_flash=FnModel(label="rf", fn=reporter, log=log),
                  researcher=FnModel(label="researcher", fn=researcher_script(research_parts), log=log))


STEPS = ["watch_video", "observe_parts", "identify_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"]
NE555 = {"component_id": "O1", "identity": "NE555P: precision timer IC", "function": "Generates timing pulses.",
         "key_facts": ["supply 4.5 V to 16 V"], "sources": ["https://www.ti.com/lit/ds/symlink/ne555.pdf"], "confidence": "HIGH"}


async def test_researcher_adds_cited_datasheet_evidence(tmp_path):
    log = []
    agent = build_agent(team(STEPS + [("text", "done")], [NE555], log), role_tools={"researcher": [duckduckgo_search]})
    cfg = {"configurable": {"thread_id": "r1"}, "recursion_limit": 40}
    r = await agent.ainvoke(start_state([make_photo(tmp_path / "p.png")], make_video(tmp_path / "v.mp4")), config=cfg,
                            context=SeeItContext(work_dir=str(tmp_path / "w")))
    assert searches and r["datasheets"][0]["id"] == "D1" and r["datasheets"][0]["sources"]
    assert "D1 RESEARCHED HIGH: O1 is NE555P" in r["brief"]
    coord = [e for e in log if e["label"] == "lite"]
    assert coord[2]["tools"] == ["identify_parts", "match_patterns"]       # optional step offered beside the next one
    assert "identify_parts" not in coord[3]["tools"]                     # and only once
    research_tools = [e["tools"] for e in log if e["label"] == "researcher"][0]
    assert "duckduckgo_search" in research_tools                          # web tools went to the researcher...
    assert all("duckduckgo_search" not in e["tools"] for e in coord)      # ...not to the coordinator
    assert r["check"]["verdict"] == "CONSISTENT"


async def test_unsourced_facts_are_dropped(tmp_path):
    log = []
    bad = {**NE555, "sources": []}
    agent = build_agent(team(STEPS[:3] + [("text", "stop")], [bad], log), role_tools={"researcher": [duckduckgo_search]})
    r = await agent.ainvoke(start_state([make_photo(tmp_path / "p.png")], None), config={"configurable": {"thread_id": "r2"}},
                            context=SeeItContext(work_dir=str(tmp_path / "w")))
    assert r["datasheets"] == [] and "no source was given: O1" in r["messages"][-2].content


async def test_no_researcher_without_web_tools(tmp_path):
    log = []
    agent = build_agent(team(["watch_video", "observe_parts", ("text", "stop")], [NE555], log))
    await agent.ainvoke(start_state([make_photo(tmp_path / "p.png")], None), config={"configurable": {"thread_id": "r3"}},
                        context=SeeItContext(work_dir=str(tmp_path / "w")))
    assert all("identify_parts" not in e["tools"] for e in log if e["label"] == "lite")


async def test_researcher_reads_its_allowed_skills(tmp_path):
    d = tmp_path / ".agents" / "skills" / "tavily-best-practices"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: tavily-best-practices\ndescription: How to search well\n---\nBe specific.")
    log = []
    agent = build_agent(team(STEPS[:3] + [("text", "stop")], [NE555], log), role_tools={"researcher": [duckduckgo_search]},
                        skills_root=str(tmp_path))
    await agent.ainvoke(start_state([make_photo(tmp_path / "p.png")], None), config={"configurable": {"thread_id": "r4"}},
                        context=SeeItContext(work_dir=str(tmp_path / "w")))
    tools = [e["tools"] for e in log if e["label"] == "researcher"][0]
    assert {"list_skills", "read_skill"} <= set(tools)


def test_quota_fallback(tmp_path):
    log, notes = [], []

    def exhausted(messages, tools):
        raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded for gemini-3.1-flash-lite")
    m = team([], [NE555], log)
    m.coordinator = FnModel(label="gemini", fn=exhausted, log=log)
    m.fallbacks = (FnModel(label="groq", fn=scripted([("text", "answered by the backup")]), log=log),)
    agent = build_agent(m, notify=notes.append)
    r = agent.invoke(start_state([make_photo(tmp_path / "p.png")], None), config={"configurable": {"thread_id": "q1"}},
                     context=SeeItContext(work_dir=str(tmp_path / "w")))
    assert r["messages"][-1].text == "answered by the backup"
    assert notes and "answered by groq" in notes[0]


def test_other_errors_are_not_hidden(tmp_path):
    def broken(messages, tools):
        raise RuntimeError("invalid argument: bad schema")
    m = team([], [NE555], [])
    m.coordinator = FnModel(label="gemini", fn=broken, log=[])
    m.fallbacks = (FnModel(label="groq", fn=scripted([("text", "should not be used")]), log=[]),)
    with pytest.raises(RuntimeError, match="bad schema"):
        build_agent(m).invoke(start_state([make_photo(tmp_path / "p.png")], None), config={"configurable": {"thread_id": "q2"}},
                              context=SeeItContext(work_dir=str(tmp_path / "w")))
