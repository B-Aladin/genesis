"""Run a GENESIS investigation on real photos and a video, on Gemini.

    python -m genesis_see.run --photo front.jpg --photo back.jpg --video blink.mp4 --note "9 V battery"

Needs GOOGLE_API_KEY (in .env or the environment). Uses Gemini 3.1 Flash-Lite
for everything unless you pass --flash (then 3.8 Flash writes the report and
answers follow-ups; it has only 20 free requests a day).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
import warnings
from pathlib import Path

from langchain.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command

from .agent import Models, SeeItContext, available_fallbacks, build_agent, lab_client, start_state
from . import inputs
from .integrations import loader

warnings.filterwarnings("ignore", message=".*has an incomplete definition.*")


def show(m) -> None:
    if isinstance(m, AIMessage):
        for tc in m.tool_calls:
            args = ", ".join(f"{k}={v!r}" for k, v in tc["args"].items())
            print(f"  -> {tc['name']}({args})")
        if m.text.strip():
            print(f"\nGENESIS: {m.text.strip()}\n")
    elif isinstance(m, ToolMessage):
        text = str(m.content)
        print(f"     {m.name}: {text[:400]}{'...' if len(text) > 400 else ''}")


def ask_human(interrupt: dict) -> dict:
    """The human side of lesson 3.3: approve, edit or reject the agent's request."""
    req = interrupt["action_requests"][0]
    a = req["args"]
    print(f"\n[approval needed] GENESIS wants to record {a.get('component_id')} = {a.get('value')}"
          f"\n  reason: {a.get('reason', '')}")
    while True:
        a = input("  approve [a], edit the value [e], or reject [r]? ").strip().lower()
        if a == "a":
            return {"type": "approve"}
        if a == "r":
            return {"type": "reject", "message": input("  why? ").strip() or "rejected by the user"}
        if a == "e":
            args = dict(req["args"])
            args["value"] = input(f"  value for {args.get('component_id')} (e.g. 100uF, 4k7): ").strip()
            return {"type": "edit", "edited_action": {"name": req["name"], "args": args}}


async def drive(agent, payload, cfg, ctx) -> None:
    """Stream one turn; whenever the agent pauses for approval, ask and resume on the same thread."""
    while True:
        pending = None
        async for chunk in agent.astream(payload, config=cfg, context=ctx, stream_mode="updates"):
            for node, update in chunk.items():
                if node == "__interrupt__":
                    pending = update[0].value
                elif isinstance(update, dict):
                    for m in update.get("messages", []):
                        show(m)
        if pending is None:
            return
        payload = Command(resume={"decisions": [ask_human(pending)]})


def print_report(st: dict) -> None:
    sk = st.get("skeptic")
    if not sk:
        print("\n(no report was written)")
        return
    print("\n" + "=" * 72 + "\nREPORT")
    for sec in sk["sections"]:
        print(f"\n{sec['title']}")
        for s in sec["sentences"]:
            print(f"  {s['text']} [{', '.join(s['cites'])}]")
            for f in s["flags"]:
                print(f"    ! skeptic: {f}")
    print(f"\nSkeptic: {sk['flagged']} of {sk['claims']} sentences flagged.")


def evidence_file(st: dict, path: Path) -> None:
    keep = ["photos", "video_path", "note", "materials", "inputs", "images", "video", "components", "board", "changing_region", "cannot_see",
            "patterns", "check", "unknowns", "report", "skeptic", "brief"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({k: st.get(k) for k in keep}, indent=2, default=str), encoding="utf-8")
    print(f"\nEvidence saved to {path} (use it as a test fixture: it costs no Gemini requests to replay).")


async def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--photo", action="append", default=[], help="a photo of the board (front, then back); up to 2")
    ap.add_argument("--video", help="5-20 s video of the device working, phone held still")
    ap.add_argument("--note", default="", help="what you already know (treated as a hint, not evidence)")
    ap.add_argument("--flash", action="store_true", help="let gemini-3.8-flash write the report and answer follow-ups")
    ap.add_argument("--reader", default="a student engineer")
    ap.add_argument("--have", default="", help="tools and parts you have, comma separated, e.g. \"multimeter, oscilloscope\"")
    ap.add_argument("--work-dir", default=".genesis_work")
    ap.add_argument("--no-research", action="store_true", help="skip the researcher (no web lookups)")
    ap.add_argument("--enable", action="append", default=[], help="turn on an integration that is off by default, e.g. arxiv")
    ap.add_argument("--disable", action="append", default=[], help="turn off an integration, e.g. duckduckgo")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    if not a.photo and not a.video:
        ap.error("give at least one --photo or a --video")
    for f in a.photo + ([a.video] if a.video else []):
        if not Path(f).exists():
            ap.error(f"file not found: {f}")

    tools = await lab_client().get_tools()          # genesis-lab MCP calculators (lesson 2.1)
    roles = set() if a.no_research else {"researcher"}
    loaded = await loader.load(roles, enabled=set(a.enable), disabled=set(a.disable), on_event=lambda m: print(f"  {m}"))
    for name, n in loaded.servers.items():
        print(f"  [on]   {name}: {n} tools")
    for name, why in {**loaded.skipped, **loaded.failed}.items():
        print(f"  [off]  {name}: {why}")
    for w in loaded.warnings():
        print(f"  WARNING: {w}")
    fallbacks = available_fallbacks()
    print(f"  quota fallback: {', '.join(fallbacks) if fallbacks else 'none (add GROQ_API_KEY or run Ollama for a free backup)'}\n")
    agent = build_agent(Models(fallbacks=fallbacks), extra_tools=tools, role_tools=loaded.by_role)
    ctx = SeeItContext(free_tier=not a.flash, reader=a.reader, work_dir=a.work_dir)
    cfg = {"configurable": {"thread_id": str(uuid.uuid4())}, "recursion_limit": 40}
    print(f"GENESIS investigation, thread {cfg['configurable']['thread_id'][:8]} "
          f"({'Gemini 3.1 Flash-Lite only' if ctx.free_tier else 'Flash-Lite, plus 3.8 Flash for explanations'})\n")
    start = start_state(a.photo[:2], a.video, a.note, inputs.normalize_materials([], a.have))
    for i in start["inputs"]["items"]:
        print(f"  {'[x]' if i['given'] else '[ ]'} {i['label']}: {i['detail']}")
    print(f"  {start['inputs']['verdict']}\n")
    await drive(agent, start, cfg, ctx)
    st = (await agent.aget_state(cfg)).values
    print_report(st)
    evidence_file(st, Path(a.work_dir) / "evidence.json")
    while True:                                     # same thread: the agent remembers (lesson 1.3)
        try:
            q = input("\nAsk GENESIS about the device, tell it a value you read, or press Enter to finish: ").strip()
        except EOFError:
            break
        if not q:
            break
        await drive(agent, {"messages": [HumanMessage(content=q)]}, cfg, ctx)
        st = (await agent.aget_state(cfg)).values
        if st.get("report") is None and st.get("skeptic") is None and st.get("unknowns") is not None:
            print("(the report is out of date after your change; ask GENESIS to rewrite it)")
    evidence_file((await agent.aget_state(cfg)).values, Path(a.work_dir) / "evidence.json")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
