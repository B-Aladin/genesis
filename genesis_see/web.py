"""GENESIS web bench: the agent team behind a browser UI.

    python -m genesis_see.web            # then open http://localhost:8000

Each investigation is one agent thread. The browser uploads photos and a video,
then follows the run over Server-Sent Events: every tool call, tool result and
reply, a fresh evidence snapshot after each step, and approval requests for
confirm_value (answered with POST /decision). Demo mode runs the same pipeline
on a sample board with scripted stand-ins for Gemini (zero requests).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import threading
import time
import uuid
import warnings
from pathlib import Path
from typing import Any

import uvicorn
from langchain.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import core, demo, diagrams, inputs, product, simulate, sketches
from .agent import Models, SeeItContext, available_fallbacks, build_agent, lab_client, start_state
from .integrations import loader

warnings.filterwarnings("ignore", message=".*has an incomplete definition.*")

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
WORK = ROOT / ".genesis_work" / "web"
KEEP = ["photos", "video_path", "note", "materials", "inputs", "images", "keyframes", "video", "components", "board", "changing_region", "cannot_see",
        "patterns", "check", "unknowns", "report", "skeptic", "datasheets", "video_checked", "observed", "identified", "device"]
LAN_URL: str | None = None   # set when started with --lan
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".webm"}


class Session:
    def __init__(self, sid: str, agent, ctx: SeeItContext, mode: str):
        self.id, self.agent, self.ctx, self.mode = sid, agent, ctx, mode
        self.cfg = {"configurable": {"thread_id": sid}, "recursion_limit": 40,
                    "callbacks": [product.UsageCounter(self._count)]}
        self.dir = Path(ctx.work_dir)
        self.events: list[dict] = []
        self.changed = asyncio.Event()
        self.server_loop = asyncio.get_running_loop()
        self.server_thread = threading.get_ident()
        self.busy = False
        self.pending: dict | None = None
        self.created = time.time()
        self.inputs: dict | None = None
        self.last: dict | None = None
        self.sourcing: dict | None = None
        self.feedback: dict | None = None
        self.usage: dict[str, int] = {}
        self.meta: dict = {}

    def _count(self, kind: str) -> None:
        self.usage[kind] = self.usage.get(kind, 0) + 1
        product.add_daily(WORK, kind)

    def record(self) -> dict:
        return {"id": self.id, "mode": self.mode, "created": self.created, "inputs": self.inputs, "last": self.last,
                "feedback": self.feedback, "usage": self.usage, "meta": self.meta, "events": self.events}

    def save(self) -> None:
        try:
            product.save_session(self.dir, self.record())
        except OSError as e:
            print(f"couldn't save {self.id}: {e}", file=sys.stderr)

    @classmethod
    def from_record(cls, rec: dict) -> "Session":
        """A saved investigation: viewable, exportable and re-runnable, but its agent thread is gone."""
        s = cls(rec["id"], None, SeeItContext(work_dir=str(WORK / rec["id"])), rec.get("mode", "live"))
        s.created = rec.get("created", s.created)
        s.inputs, s.last, s.feedback = rec.get("inputs"), rec.get("last"), rec.get("feedback")
        s.usage, s.meta, s.events = rec.get("usage") or {}, rec.get("meta") or {}, rec.get("events") or []
        return s

    def emit(self, kind: str, **data) -> None:
        """Safe from any thread: the agents run on their own loop, the event stream on the server's."""
        if threading.get_ident() != self.server_thread:
            self.server_loop.call_soon_threadsafe(lambda: self.emit(kind, **data))
            return
        self.events.append({"seq": len(self.events), "type": kind, **data})
        self.changed.set()
        self.changed = asyncio.Event()

    def url(self, path: str | None) -> str | None:
        if not path:
            return None
        try:
            rel = Path(path).resolve().relative_to(self.dir.resolve())
        except ValueError:
            return None
        return f"/files/{self.id}/{rel.as_posix()}"

    async def snapshot(self) -> dict:
        if self.agent is None:
            return self.last or {}
        st = (await self.agent.aget_state(self.cfg)).values
        out = {k: st.get(k) for k in KEEP}
        out["photo_urls"] = [self.url(p) for p in st.get("photos") or []]
        out["video_url"] = self.url(st.get("video_path"))
        for im in out.get("images") or []:
            im["url"] = self.url(im.get("path"))
        for kf in out.get("keyframes") or []:
            kf["url"] = self.url(kf.get("path"))
        for c in out.get("components") or []:
            c["image_url"] = self.url(c.get("image_path"))
            c["display"] = core.fmt_value(c)
        try:
            out["wiring"] = diagrams.wiring(out)
        except Exception as e:  # a drawing problem must never break the run view
            out["wiring"] = None
            print(f"wiring failed: {e}", file=sys.stderr)
        try:
            out["simulation"] = simulate.simulate(out) if out.get("patterns") else None
        except Exception as e:
            out["simulation"] = None
            print(f"simulation failed: {e}", file=sys.stderr)
        if out.get("inputs"):
            out["inputs"] = _public_inputs(out["inputs"])
        self.last = json.loads(json.dumps(out, default=str))
        return self.last

    async def drive(self, payload) -> None:
        """Stream one turn, pausing (and returning) when the agent asks for approval."""
        self.busy = True
        self.emit("busy", busy=True)
        try:
            pending = None
            async for chunk in self.agent.astream(payload, config=self.cfg, context=self.ctx, stream_mode="updates"):
                for node, update in chunk.items():
                    if node == "__interrupt__":
                        pending = update[0].value
                    elif isinstance(update, dict):
                        for m in update.get("messages", []):
                            self._message(m)
                        if any(k in update for k in KEEP):
                            self.emit("state", state=await self.snapshot())
            self.emit("state", state=await self.snapshot())
            if pending:
                req = pending["action_requests"][0]
                self.pending = req
                self.emit("approval", request={"name": req["name"], "args": req["args"],
                                               "description": req.get("description", "")})
        except Exception as e:  # surface it in the UI instead of a silent failure
            self.emit("error", text=f"{type(e).__name__}: {str(e)[:600]}")
        finally:
            self.busy = False
            self.emit("usage", usage=dict(self.usage))
            self.emit("busy", busy=False)
            self.server_loop.call_soon_threadsafe(self.save)

    def _message(self, m) -> None:
        if isinstance(m, AIMessage):
            for tc in m.tool_calls:
                self.emit("call", name=tc["name"], args=tc["args"])
            if m.text.strip():
                self.emit("say", text=m.text.strip())
        elif isinstance(m, ToolMessage):
            self.emit("result", name=m.name, text=str(m.content))
        elif isinstance(m, HumanMessage):
            self.emit("user", text=m.text if isinstance(m.content, str) else "(images)")


class Bench:
    """Shared agent builds: real (Gemini) agents are built once per research setting, demo once."""

    def __init__(self):
        self.sessions: dict[str, Session] = {}
        self._agents: dict[str, Any] = {}
        self._lab: list | None = None
        self.log: list[str] = []
        self._lock: asyncio.Lock | None = None

    @property
    def lock(self) -> asyncio.Lock:
        if self._lock is None:              # created on the agents' loop, where every build runs
            self._lock = asyncio.Lock()
        return self._lock

    async def lab_tools(self) -> list:
        if self._lab is None:
            try:
                self._lab = await lab_client().get_tools()
            except Exception as e:
                self.log.append(f"genesis-lab calculators unavailable: {loader.root_error(e)}")
                self._lab = []
        return self._lab

    async def agent(self, mode: str, research: bool, board: str = "555", enabled: frozenset = frozenset(),
                    disabled: frozenset = frozenset(), backup: bool = True):
        key = f"{mode}:{research}:{board if mode == 'demo' else ''}:{sorted(enabled)}:{sorted(disabled)}:{backup}"
        async with self.lock:
            if key not in self._agents:
                tools = await self.lab_tools()
                if mode == "demo":
                    self._agents[key] = build_agent(demo.models(board), extra_tools=tools, notify=self.log.append)
                else:
                    loaded = await loader.load({"researcher"} if research else set(), enabled=set(enabled), disabled=set(disabled),
                                               on_event=self.log.append)
                    for name, n in loaded.servers.items():
                        self.log.append(f"[on] {name}: {n} tools")
                    for name, why in {**loaded.skipped, **loaded.failed}.items():
                        self.log.append(f"[off] {name}: {why}")
                    self._agents[key] = build_agent(Models(fallbacks=available_fallbacks() if backup else ()), extra_tools=tools,
                                                    role_tools=loaded.by_role, notify=self.log.append)
            return self._agents[key]


bench = Bench()

_agent_loop: asyncio.AbstractEventLoop | None = None


def agent_loop() -> asyncio.AbstractEventLoop:
    """The agents' own event loop, in a background thread. On Windows it is a Proactor loop, the
    only kind that can start subprocesses (the stdio MCP servers); the web server itself runs on a
    Selector loop, because a Proactor loop stops accepting connections for good after one aborted
    connection (WinError 64)."""
    global _agent_loop
    if _agent_loop is None:
        _agent_loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        threading.Thread(target=_agent_loop.run_forever, name="genesis-agents", daemon=True).start()
    return _agent_loop


def run_agents(coro) -> None:
    """Run an investigation turn on the agents' loop, so OpenCV and other synchronous steps never
    stall the web server, its uploads or the live event stream."""
    asyncio.run_coroutine_threadsafe(coro, agent_loop())


_fallbacks: tuple[float, tuple] = (0.0, ())


def fallbacks_cached() -> tuple:
    """available_fallbacks() probes Ollama on localhost, which takes about 2 s on Windows when it isn't
    running; cache the answer for 30 s and call this off the event loop (asyncio.to_thread)."""
    global _fallbacks
    if time.time() - _fallbacks[0] > 30:
        _fallbacks = (time.time(), available_fallbacks())
    return _fallbacks[1]


async def on_agents(coro):
    """Await a coroutine that must run on the agents' loop (anything that starts MCP servers)."""
    return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(coro, agent_loop()))


# ----------------------------------------------------------------------- routes --


async def create(request: Request) -> Response:
    form = await request.form()
    mode = "demo" if form.get("mode") == "demo" else "live"
    sid = uuid.uuid4().hex[:12]
    folder = WORK / sid
    (folder / "uploads").mkdir(parents=True, exist_ok=True)
    photos, video = [], None
    if mode == "demo":
        sample = str(form.get("sample") or "full")      # full | photo | video | esp: shows how GENESIS adapts
        p, v = await asyncio.to_thread(demo.sample_media, WORK / "_sample", "esp" if sample == "esp" else "555")
        if sample != "video":
            photos = [str(folder / "uploads" / Path(p).name)]
            Path(photos[0]).write_bytes(Path(p).read_bytes())
        if sample != "photo":
            video = str(folder / "uploads" / Path(v).name)
            Path(video).write_bytes(Path(v).read_bytes())
    else:
        prev = bench.sessions.get(str(form.get("from") or ""))
        kept_photos, kept_video = [], None
        if prev and prev.last:                       # re-run: keep the earlier evidence, add the new
            kept_photos = [x for x in prev.last.get("photos") or [] if Path(x).is_file()]
            v0 = prev.last.get("video_path")
            kept_video = v0 if v0 and Path(v0).is_file() else None
        for i, old in enumerate(kept_photos[:2]):
            dest = folder / "uploads" / f"photo-{i + 1}{Path(old).suffix.lower()}"
            shutil.copyfile(old, dest)
            photos.append(str(dest))
        for i, up in enumerate(form.getlist("photos")[:2 - len(photos)], start=len(photos)):
            ext = Path(up.filename or "").suffix.lower()
            if ext not in PHOTO_EXT:
                return JSONResponse({"error": f"{up.filename}: use a JPEG or PNG photo"}, 400)
            dest = folder / "uploads" / f"photo-{i + 1}{ext}"
            dest.write_bytes(await up.read())
            photos.append(str(dest))
        up = form.get("video")
        if up is not None and getattr(up, "filename", ""):
            ext = Path(up.filename).suffix.lower()
            if ext not in VIDEO_EXT:
                return JSONResponse({"error": f"{up.filename}: record the video as MP4 (H.264)"}, 400)
            dest = folder / "uploads" / f"video{ext}"
            dest.write_bytes(await up.read())
            video = str(dest)
        elif kept_video:
            dest = folder / "uploads" / f"video{Path(kept_video).suffix.lower()}"
            shutil.copyfile(kept_video, dest)
            video = str(dest)
        if not photos and not video:
            return JSONResponse({"error": "Add at least one photo or a video."}, 400)
    note = str(form.get("note") or "")[:500]
    rmode = str(form.get("research") or "auto")          # off | auto | on
    enabled = frozenset(str(x) for x in form.getlist("enable"))
    disabled = frozenset(str(x) for x in form.getlist("disable"))
    ready = [srv.name for srv in loader.SERVERS if srv.role == "researcher" and loader.check(srv, set(enabled), set(disabled)).ready]
    # auto: bring the Researcher in only when a search server is actually usable; it then runs only if parts carry markings
    research = mode == "live" and (rmode == "on" or (rmode == "auto" and bool(ready)))
    backup = form.get("backup") != "off"
    ctx = SeeItContext(free_tier=form.get("flash") != "on", reader=str(form.get("reader") or "a student engineer")[:80],
                       work_dir=str(folder))
    try:
        agent = await on_agents(bench.agent(mode, research, board="esp" if mode == "demo" and form.get("sample") == "esp" else "555",
                                            enabled=enabled, disabled=disabled, backup=backup))
    except Exception as e:
        return JSONResponse({"error": f"Couldn't start the agent: {loader.root_error(e)}"}, 500)
    materials = inputs.normalize_materials(form.getlist("materials"), str(form.get("materials_other") or ""))
    s = Session(sid, agent, ctx, mode)
    s.meta = {"note": note, "materials": materials, "sample": str(form.get("sample") or ""), "from": str(form.get("from") or ""),
              "reader": ctx.reader}
    bench.sessions[sid] = s
    first = await asyncio.to_thread(start_state, photos, video, note, materials)   # reads every photo and the video
    s.inputs = first["inputs"]
    s.emit("log", lines=list(bench.log[-12:]))
    s.emit("inputs", inputs=_public_inputs(first["inputs"]))
    run_agents(s.drive(first))
    return JSONResponse({"id": sid, "mode": mode})


def _public_inputs(a: dict) -> dict:
    """The input assessment without local file paths."""
    a = json.loads(json.dumps(a, default=str))
    for q in a.get("photos") or []:
        q.pop("path", None)
    if a.get("video"):
        a["video"].pop("path", None)
    return a


async def control(request: Request) -> Response:
    """Everything the user can switch: agents, free integrations (MCP servers), backup models."""
    import os
    from .agent import FLASH, LITE
    from .integrations.catalog import ROLES
    fallbacks = list(await asyncio.to_thread(fallbacks_cached))
    servers = []
    for srv in loader.SERVERS:
        st = loader.check(srv)
        live = srv.role == "researcher"
        servers.append({"name": srv.name, "purpose": srv.purpose, "role": srv.role, "role_text": ROLES.get(srv.role, ""),
                        "free": srv.free, "ready": st.ready, "reason": st.reason, "default_on": srv.default_on, "safety": srv.safety,
                        "usable_now": live, "needs": list(srv.env_required) + list(srv.needs), "note": srv.note})
    gem = bool(os.environ.get("GOOGLE_API_KEY"))
    research_ready = [x["name"] for x in servers if x["usable_now"] and x["ready"]]
    agents = [
        {"name": "Coordinator", "kind": "model", "model": LITE.split(":")[1], "job": "Plans the investigation one evidence step at a time", "ready": gem},
        {"name": "Observer", "kind": "model", "model": LITE.split(":")[1] + " (vision)", "job": "Lists every visible part, marking and colour band", "ready": gem},
        {"name": "Researcher", "kind": "model", "model": LITE.split(":")[1] + " + web tools",
         "job": "Looks part markings up in real sources; no source, no fact", "ready": gem and bool(research_ready),
         "detail": ", ".join(research_ready) or "no search server ready"},
        {"name": "Reporter", "kind": "model", "model": LITE.split(":")[1], "job": "Writes the report; every sentence cites evidence", "ready": gem},
        {"name": "Explainer", "kind": "model", "model": FLASH.split(":")[1], "job": "Optional: stronger follow-up answers (20 free requests a day)", "ready": gem},
        {"name": "Video meter", "kind": "code", "model": "OpenCV", "job": "Times the blinking frame by frame", "ready": True},
        {"name": "Pattern matcher & checker", "kind": "code", "model": "Python", "job": "Scores known circuits and tests the formula against the video", "ready": True},
        {"name": "Skeptic", "kind": "code", "model": "Python", "job": "Flags any sentence that cites nothing or invents a number", "ready": True},
        {"name": "genesis-lab", "kind": "mcp", "model": "MCP server", "job": "Calculators for what-if questions", "ready": True},
        {"name": "Backup models", "kind": "model", "model": ", ".join(f.split(":", 1)[1] for f in fallbacks) or "none",
         "job": "Answer when Gemini's free quota runs out (Groq key or local Ollama)", "ready": bool(fallbacks)},
    ]
    return JSONResponse({"agents": agents, "servers": servers, "gemini": gem, "fallbacks": fallbacks,
                         "groq_key": bool(os.environ.get("GROQ_API_KEY")), "ollama": any(f.startswith("ollama:") for f in fallbacks)})


async def recent(request: Request) -> Response:
    out = []
    for s in sorted(bench.sessions.values(), key=lambda s: -s.created)[:30]:
        st = s.last or {}
        top = ((st.get("patterns") or {}).get("top") or {}).get("name")
        verdict = (st.get("check") or {}).get("verdict")
        out.append({"id": s.id, "mode": s.mode, "created": s.created, "busy": s.busy,
                    "title": s.meta.get("title") or top or "Investigation", "circuit": top,
                    "device": ((st.get("device") or {}).get("kind")),
                    "verdict": verdict, "parts": len(st.get("components") or []), "evidence": (s.inputs or {}).get("evidence"),
                    "saved": s.agent is None, "rating": (s.feedback or {}).get("rating"),
                    "gemini": sum(v for k, v in s.usage.items() if k.startswith("gemini"))})
    return JSONResponse(out)


async def sketch(request: Request) -> Response:
    """An Arduino / ESP measurement sketch sized for this circuit's supply voltage."""
    s = _session(request)
    if s is None:
        return Response("no such investigation", status_code=404)
    st = await s.snapshot()
    kind = "voltage" if request.query_params.get("kind") == "voltage" else "frequency"
    board = request.query_params.get("board", "arduino")
    supply = sketches.supply_from([st.get("note") or ""] + [b.get("note", "") for b in st.get("board") or []])
    source = "from your notes"
    comps = st.get("components") or []
    timer555 = any("555" in (c.get("marking") or "") for c in comps)
    if supply is None and not timer555:
        mcu = next((c for c in comps if c["type"] == "dev_board" or core.RX["mcu"].search(c.get("marking") or "")), None)
        if mcu:   # a controller's output pin swings at its logic level
            supply = 3.3 if core.RX["esp"].search(mcu.get("marking") or "") else 5.0
            source = f"the logic level of {mcu['id']}"
    x = st.get("check") or {}
    expect = (x.get("predicted") or {}).get("frequency_hz") or (x.get("measured") or {}).get("frequency_hz")
    code = sketches.sketch(kind, board, supply, expect_hz=expect, supply_source=source, timer555=timer555)
    return Response(code, media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="genesis_{kind}_{board}.ino"'})


async def source(request: Request) -> Response:
    """Find replacement parts on JLCPCB / LCSC (pcbparts MCP), on demand."""
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    if "pcbparts" in set((await request.json()).get("disabled") or []):
        return JSONResponse({"error": "pcbparts is turned off in Control"}, 409)
    if s.sourcing is None:
        from . import sourcing
        st = await s.snapshot()
        s.sourcing = await on_agents(sourcing.find_parts(st.get("components") or []))
    return JSONResponse(s.sourcing)


async def report_md(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return Response("no such investigation", status_code=404)
    md = report_markdown(await s.snapshot(), s)
    return Response(md, media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="genesis-report-{s.id[:8]}.md"'})


def report_markdown(st: dict, s: "Session") -> str:
    """The investigation as a Markdown document: inputs, verdict, parts, check, open questions, cited report."""
    import datetime as dt
    L = [f"# GENESIS investigation {s.id[:8]}", "",
         f"{dt.datetime.fromtimestamp(s.created):%Y-%m-%d %H:%M} · {'demo (scripted models)' if s.mode == 'demo' else 'live (Gemini)'}", ""]
    a = st.get("inputs") or {}
    if a:
        L += ["## Evidence given", ""] + [f"- [{'x' if i['given'] else ' '}] **{i['label']}**: {i['detail']}" for i in a.get("items", [])]
        L += ["", f"_{a.get('verdict', '')}_", ""]
    p = st.get("patterns") or {}
    if p.get("top"):
        L += ["## Most likely circuit", "", f"**{p['top']['name']}** ({p['confidence'].lower()} fit). {p['top']['summary']}", ""]
    x = st.get("check") or {}
    if x:
        L += ["## Check against the video", ""]
        if not x.get("available"):
            L.append(f"Not possible: {x.get('reason')}.")
        elif x["verdict"] == "INFERRED":
            L.append(f"**INFERRED**: {x['inferred']['text']}.")
        else:
            L.append(f"**{x['verdict']}**: the parts predict {x['predicted']['frequency_hz']:.3f} Hz, the video shows "
                     f"{x['measured']['frequency_hz']:.3f} Hz ({x['error_pct']}% apart, {x['tolerance_pct']:g}% allowed).")
            for t in x.get("suggestions") or []:
                L.append(f"- {t['text']}")
        L.append("")
    comps = st.get("components") or []
    if comps:
        L += ["## Parts", "", "| Id | Part | Marking / value | Status | Seen |", "|---|---|---|---|---|"]
        L += [f"| {c['id']} | {c['type'].replace('_', ' ')} | {c.get('display') or c.get('marking') or ''} | {c.get('status', '')} {c.get('confidence', '')} | {c.get('evidence', '')} |"
              for c in comps]
        L.append("")
    U = st.get("unknowns") or []
    if U:
        L += ["## Still unknown, and what to do next", ""]
        L += [f"- **{u['id']}** {u['text']}." + (f" Next: {u['ask']}." if u.get("ask") else "") for u in U]
        L.append("")
    sk = st.get("skeptic")
    if sk:
        L += ["## Report", "", f"_Skeptic: {sk['flagged']} of {sk['claims']} sentences flagged._", ""]
        for sec in sk["sections"]:
            L += [f"### {sec['title']}", ""]
            for t in sec["sentences"]:
                line = f"{t['text']} [{', '.join(t['cites'])}]"
                L.append(f"- ~~{line}~~ — skeptic: {'; '.join(t['flags'])}" if t["flags"] else f"- {line}")
            L.append("")
    w = st.get("wiring")
    if w:
        L += ["## Build it (wiring to replicate)", "", f"> {w['basis']}", "", "### Parts", "",
              "| Role | Part | Value | Status |", "|---|---|---|---|"]
        L += [f"| {p['role']} | {p['id'] or '—'} | {p['value'] or ''} | {p['status']}{' · role inferred' if p.get('role_inferred') else ''} |"
              for p in w["parts"].values()]
        L += ["", "### Connections", "", "Make each net once: everything listed in a net is joined together.", "",
              "| Net | Join these | Done |", "|---|---|---|"]
        L += [f"| **{n['id']} {n['name']}** | " + "<br>".join(f"{p['id'] or p['part']} {p['pin']}" for p in n["pins"]) + " | ☐ |"
              for n in w["nets"]]
        L += ["", "```mermaid", diagrams.mermaid(w), "```", ""]
        L += [f"- {t}" for t in w["notes"]]
        if w.get("missing"):
            L.append(f"- Not seen on the board, needed to replicate: {', '.join(w['missing'])}")
        L.append("")
    if st.get("materials"):
        L += ["## On hand", "", ", ".join(st["materials"]), ""]
    return "\n".join(L)


SAVED_MSG = "This investigation was saved before the server restarted, so its conversation can't continue. Re-run it to ask more."


async def delete(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    if s.busy:
        return JSONResponse({"error": "it's still running"}, 409)
    bench.sessions.pop(s.id, None)
    folder = (WORK / s.id).resolve()
    if WORK.resolve() in folder.parents:
        shutil.rmtree(folder, ignore_errors=True)
    return JSONResponse({"ok": True})


async def feedback(request: Request) -> Response:
    """'Was this right?' from the user: kept with the run and appended to feedback.jsonl."""
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    body = await request.json()
    rating = body.get("rating")
    if rating not in ("right", "partly", "wrong"):
        return JSONResponse({"error": "rating must be right, partly or wrong"}, 400)
    st = s.last or {}
    s.feedback = {"rating": rating, "note": str(body.get("note") or "")[:1000]}
    product.record_feedback(WORK, {"id": s.id, "mode": s.mode, **s.feedback,
                                   "circuit": ((st.get("patterns") or {}).get("top") or {}).get("id"),
                                   "verdict": (st.get("check") or {}).get("verdict"),
                                   "evidence": (s.inputs or {}).get("evidence"), "materials": st.get("materials")})
    s.save()
    return JSONResponse({"ok": True})


async def simulate_run(request: Request) -> Response:
    """What-if simulation: part values and supply from the body, evidence untouched (code, instant)."""
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    body = await request.json()
    overrides = {str(k): str(v)[:20] for k, v in (body.get("overrides") or {}).items()}
    try:
        supply = float(body["supply"]) if body.get("supply") not in (None, "") else None
    except (TypeError, ValueError):
        return JSONResponse({"error": "supply must be a number of volts"}, 400)
    if supply is not None and not 0.5 <= supply <= 60:
        return JSONResponse({"error": "supply must be between 0.5 and 60 V"}, 400)
    st = await s.snapshot()
    return JSONResponse(json.loads(json.dumps(simulate.simulate(st, overrides, supply), default=str)))


async def rename(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    title = str((await request.json()).get("title") or "").strip()[:80]
    s.meta["title"] = title or None
    s.save()
    return JSONResponse({"ok": True, "title": title})


async def usage(request: Request) -> Response:
    return JSONResponse(product.usage_today(WORK))


def _session(request: Request) -> Session | None:
    return bench.sessions.get(request.path_params["sid"])


async def events(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    last = request.headers.get("last-event-id") or request.query_params.get("after") or "-1"
    cursor = int(last) + 1 if last.lstrip("-").isdigit() else 0

    async def stream():
        nonlocal cursor
        yield "retry: 1500\n\n"
        while True:
            while cursor < len(s.events):
                yield f"id: {cursor}\ndata: {json.dumps(s.events[cursor], default=str)}\n\n"
                cursor += 1
            try:                    # StreamingResponse cancels this generator when the client leaves
                await asyncio.wait_for(s.changed.wait(), 15)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def decision(request: Request) -> Response:
    s = _session(request)
    if s is not None and s.agent is None:
        return JSONResponse({"error": SAVED_MSG}, 409)
    if s is None or s.pending is None:
        return JSONResponse({"error": "nothing is waiting for approval"}, 409)
    body = await request.json()
    kind = body.get("type")
    if kind == "approve":
        d = {"type": "approve"}
    elif kind == "reject":
        d = {"type": "reject", "message": str(body.get("message") or "rejected by the user")[:300]}
    elif kind == "edit":
        args = dict(s.pending["args"])
        args["value"] = str(body.get("value") or "").strip()[:40]
        d = {"type": "edit", "edited_action": {"name": s.pending["name"], "args": args}}
    else:
        return JSONResponse({"error": "type must be approve, edit or reject"}, 400)
    s.pending = None
    s.emit("decided", decision=kind)
    run_agents(s.drive(Command(resume={"decisions": [d]})))
    return JSONResponse({"ok": True})


async def ask(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    if s.agent is None:
        return JSONResponse({"error": SAVED_MSG}, 409)
    if s.busy or s.pending:
        return JSONResponse({"error": "GENESIS is still working; wait for it to finish"}, 409)
    text = str((await request.json()).get("text") or "").strip()[:1000]
    if not text:
        return JSONResponse({"error": "empty question"}, 400)
    s.emit("user", text=text)
    run_agents(s.drive({"messages": [HumanMessage(content=text)]}))
    return JSONResponse({"ok": True})


async def evidence(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    return JSONResponse(await s.snapshot(), headers={"Content-Disposition": f'attachment; filename="genesis-{s.id}.json"'})


async def files(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return Response(status_code=404)
    path = (s.dir / request.path_params["path"]).resolve()
    if not path.is_file() or s.dir.resolve() not in path.parents:
        return Response(status_code=404)
    return FileResponse(path)


async def lab(request: Request) -> Response:
    """The genesis-lab calculators, called directly (pure maths, no model)."""
    body = await request.json()
    name = request.path_params["tool"]
    try:
        if name == "bands":
            d = core.decode_bands([str(b).lower() for b in body.get("bands") or []])
            return JSONResponse({**d, "display": core.fmt_ohms(d["value"])} if d else {"error": "not a valid colour code"})
        if name == "555":
            ra, rb, c = float(body["ra"]), float(body["rb"]), float(body["c"])
            f = 1.44 / ((ra + 2 * rb) * c)
            return JSONResponse({"frequency_hz": f, "period_s": 1 / f, "high_fraction": (ra + rb) / (ra + 2 * rb),
                                 "nearest_c": core.nearest_standard(c, core.E6)})
        if name == "parse":
            kind = body.get("kind", "resistor")
            v = core.parse_resistance(body.get("text")) if kind == "resistor" else core.parse_capacitance(body.get("text"))
            return JSONResponse({"value": v, "display": (core.fmt_ohms(v) if kind == "resistor" else core.fmt_farads(v)) if v else None})
    except (KeyError, ValueError, ZeroDivisionError) as e:
        return JSONResponse({"error": str(e)}, 400)
    return JSONResponse({"error": "unknown tool"}, 404)


async def info(request: Request) -> Response:
    import os
    return JSONResponse({"gemini_key": bool(os.environ.get("GOOGLE_API_KEY")), "fallbacks": list(await asyncio.to_thread(fallbacks_cached)),
                         "built": DIST.is_dir(), "lan_url": LAN_URL, "usage": product.usage_today(WORK)["today"]})


async def index(request: Request) -> Response:
    page = DIST / "index.html"
    if page.is_file():
        return FileResponse(page)
    return Response("The UI isn't built yet. Run:  cd web && npm install && npm run build", media_type="text/plain")


def app() -> Starlette:
    routes = [
        Route("/api/info", info),
        Route("/api/investigations", create, methods=["POST"]),
        Route("/api/investigations", recent, methods=["GET"]),
        Route("/api/investigations/{sid}/report.md", report_md),
        Route("/api/investigations/{sid}/sketch", sketch),
        Route("/api/investigations/{sid}/source", source, methods=["POST"]),
        Route("/api/materials", lambda r: JSONResponse(inputs.MATERIALS)),
        Route("/api/control", control),
        Route("/api/investigations/{sid}/events", events),
        Route("/api/investigations/{sid}/decision", decision, methods=["POST"]),
        Route("/api/investigations/{sid}/ask", ask, methods=["POST"]),
        Route("/api/investigations/{sid}/evidence", evidence),
        Route("/api/investigations/{sid}", delete, methods=["DELETE"]),
        Route("/api/investigations/{sid}/feedback", feedback, methods=["POST"]),
        Route("/api/usage", usage),
        Route("/api/investigations/{sid}/simulate", simulate_run, methods=["POST"]),
        Route("/api/investigations/{sid}/title", rename, methods=["POST"]),
        Route("/api/lab/{tool}", lab, methods=["POST"]),
        Route("/files/{sid}/{path:path}", files),
        Route("/", index),
    ]
    if (DIST / "assets").is_dir():
        routes.append(Mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets"))

    async def warm_up():
        """Start the genesis-lab MCP server, draw the sample boards and build the demo agents
        in the background, so the first click doesn't wait for them."""
        try:
            await asyncio.to_thread(fallbacks_cached)
            await asyncio.to_thread(demo.sample_media, WORK / "_sample", "555")
            await asyncio.to_thread(demo.sample_media, WORK / "_sample", "esp")
            for board in ("555", "esp"):
                await on_agents(bench.agent("demo", False, board=board))
        except Exception as e:
            print(f"warm-up skipped: {e}", file=sys.stderr)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(_app):
        WORK.mkdir(parents=True, exist_ok=True)
        for rec in product.load_sessions(WORK):
            if rec["id"] not in bench.sessions:
                bench.sessions[rec["id"]] = Session.from_record(rec)
        task = asyncio.create_task(warm_up())
        yield
        task.cancel()

    return Starlette(routes=routes, lifespan=lifespan)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="GENESIS web bench")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--lan", action="store_true",
                    help="also serve on your local network, so a phone on the same Wi-Fi can upload photos and video")
    a = ap.parse_args(argv)
    global LAN_URL
    if a.lan:
        a.host = "0.0.0.0"
        ip = product.lan_address()
        LAN_URL = f"http://{ip}:{a.port}" if ip else None
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    print(f"GENESIS web bench on http://localhost:{a.port}")
    if a.lan:
        print(f"On your network: {LAN_URL or '(no network address found)'}\n"
              "Anyone on this network can open it and run investigations on your Gemini key. Use it on networks you trust.")
    server = uvicorn.Server(uvicorn.Config(app(), host=a.host, port=a.port, log_level="warning"))
    # A Selector loop for the web server (see agent_loop): uvicorn would otherwise pick a Proactor
    # loop on Windows, which stops accepting connections after a single aborted one.
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(server.serve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
