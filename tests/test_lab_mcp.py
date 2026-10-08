"""The genesis-lab MCP server over real stdio (lesson 2.1), the retry policy (2.4),
and the agent calling MCP tools asynchronously."""
import pytest
from langchain.messages import HumanMessage

from genesis_see.agent import Models, ReadOnlyRetryInterceptor, SeeItContext, build_agent, lab_client, start_state
from fakes import FnModel, make_photo, make_video, observer, reporter, scripted, OBSERVATION

STEPS = ["watch_video", "observe_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"]


async def test_lab_tools_over_stdio():
    tools = {t.name: t for t in await lab_client().get_tools()}
    assert set(tools) == {"decode_resistor_bands", "parse_component_value", "predict_555_frequency",
                          "predict_flasher_frequency", "nearest_standard_value"}
    out = await tools["predict_555_frequency"].ainvoke({"ra_ohms": 1000, "rb_ohms": 10000, "c_farads": 1e-4})
    assert "0.68571" in str(out) and "SIMULATED" in str(out)


async def test_retry_policy():
    calls = []

    class Req:
        def __init__(self, name): self.name = name

    async def flaky(req):
        calls.append(req.name)
        raise ConnectionError("pipe closed")

    i = ReadOnlyRetryInterceptor(max_retries=3)
    import asyncio
    real_sleep, asyncio.sleep = asyncio.sleep, (lambda s: real_sleep(0))
    try:
        r1 = await i(Req("predict_555_frequency"), flaky)
        r2 = await i(Req("set_output"), flaky)          # a Part 3 pin tool: never retried
    finally:
        asyncio.sleep = real_sleep
    assert calls.count("predict_555_frequency") == 3 and calls.count("set_output") == 1
    assert "not retried" in r2.content[0].text and "3 attempts" in r1.content[0].text


async def test_agent_answers_a_what_if_with_mcp(tmp_path):
    tools = await lab_client().get_tools()
    log = []
    plan = STEPS + [("text", "done"),
                    ("predict_555_frequency", {"ra_ohms": 1000, "rb_ohms": 22000, "c_farads": 1e-4}),
                    ("text", "With RB = 22 kOhm it would blink at 0.32 Hz (SIMULATED).")]
    models = Models(coordinator=FnModel(label="lite", fn=scripted(plan), log=log), coordinator_flash=FnModel(label="f", fn=scripted([]), log=log),
                    observer=FnModel(label="o", fn=observer(OBSERVATION, []), log=log),
                    reporter=FnModel(label="r", fn=reporter, log=log), reporter_flash=FnModel(label="rf", fn=reporter, log=log))
    agent = build_agent(models, extra_tools=tools)
    cfg = {"configurable": {"thread_id": "mcp"}, "recursion_limit": 40}
    ctx = SeeItContext(work_dir=str(tmp_path / "w"))
    await agent.ainvoke(start_state([make_photo(tmp_path / "p.png")], make_video(tmp_path / "v.mp4")), config=cfg, context=ctx)
    r = await agent.ainvoke({"messages": [HumanMessage("What if RB were 22k?")]}, config=cfg, context=ctx)
    assert "0.32" in str(r["messages"][-2].content)   # the MCP tool's real answer
    first = [e for e in log if e["label"] == "lite"][0]["tools"]
    assert "watch_video" in first and "predict_555_frequency" in first and "observe_parts" not in first
