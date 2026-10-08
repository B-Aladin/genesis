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
import sys
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

from . import core, demo
from .agent import Models, SeeItContext, available_fallbacks, build_agent, lab_client, start_state
from .integrations import loader

warnings.filterwarnings("ignore", message=".*has an incomplete definition.*")

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
WORK = ROOT / ".genesis_work" / "web"
KEEP = ["photos", "video_path", "note", "images", "keyframes", "video", "components", "board", "changing_region", "cannot_see",
        "patterns", "check", "unknowns", "report", "skeptic", "datasheets", "video_checked", "observed", "identified"]
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".webm"}


class Session:
    def __init__(self, sid: str, agent, ctx: SeeItContext, mode: str):
        self.id, self.agent, self.ctx, self.mode = sid, agent, ctx, mode
        self.cfg = {"configurable": {"thread_id": sid}, "recursion_limit": 40}
        self.dir = Path(ctx.work_dir)
        self.events: list[dict] = []
        self.changed = asyncio.Event()
        self.busy = False
        self.pending: dict | None = None

    def emit(self, kind: str, **data) -> None:
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
        return json.loads(json.dumps(out, default=str))

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
            self.emit("busy", busy=False)

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
        self.lock = asyncio.Lock()

    async def lab_tools(self) -> list:
        if self._lab is None:
            try:
                self._lab = await lab_client().get_tools()
            except Exception as e:
                self.log.append(f"genesis-lab calculators unavailable: {loader.root_error(e)}")
                self._lab = []
        return self._lab

    async def agent(self, mode: str, research: bool):
        key = f"{mode}:{research}"
        async with self.lock:
            if key not in self._agents:
                tools = await self.lab_tools()
                if mode == "demo":
                    self._agents[key] = build_agent(demo.models(), extra_tools=tools, notify=self.log.append)
                else:
                    loaded = await loader.load({"researcher"} if research else set(), on_event=self.log.append)
                    for name, n in loaded.servers.items():
                        self.log.append(f"[on] {name}: {n} tools")
                    for name, why in {**loaded.skipped, **loaded.failed}.items():
                        self.log.append(f"[off] {name}: {why}")
                    self._agents[key] = build_agent(Models(fallbacks=available_fallbacks()), extra_tools=tools,
                                                    role_tools=loaded.by_role, notify=self.log.append)
            return self._agents[key]


bench = Bench()


# ----------------------------------------------------------------------- routes --


async def create(request: Request) -> Response:
    form = await request.form()
    mode = "demo" if form.get("mode") == "demo" else "live"
    sid = uuid.uuid4().hex[:12]
    folder = WORK / sid
    (folder / "uploads").mkdir(parents=True, exist_ok=True)
    photos, video = [], None
    if mode == "demo":
        p, v = demo.sample_media(WORK / "_sample")
        photos, video = [str(folder / "uploads" / Path(p).name)], str(folder / "uploads" / Path(v).name)
        Path(photos[0]).write_bytes(Path(p).read_bytes())
        Path(video).write_bytes(Path(v).read_bytes())
    else:
        for i, up in enumerate(form.getlist("photos")[:2]):
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
        if not photos and not video:
            return JSONResponse({"error": "Add at least one photo or a video."}, 400)
    note = str(form.get("note") or "")[:500]
    research = form.get("research") == "on" and mode == "live"
    ctx = SeeItContext(free_tier=form.get("flash") != "on", reader=str(form.get("reader") or "a student engineer")[:80],
                       work_dir=str(folder))
    try:
        agent = await bench.agent(mode, research)
    except Exception as e:
        return JSONResponse({"error": f"Couldn't start the agent: {loader.root_error(e)}"}, 500)
    s = Session(sid, agent, ctx, mode)
    bench.sessions[sid] = s
    s.emit("log", lines=list(bench.log[-12:]))
    asyncio.create_task(s.drive(start_state(photos, video, note)))
    return JSONResponse({"id": sid, "mode": mode})


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
    asyncio.create_task(s.drive(Command(resume={"decisions": [d]})))
    return JSONResponse({"ok": True})


async def ask(request: Request) -> Response:
    s = _session(request)
    if s is None:
        return JSONResponse({"error": "no such investigation"}, 404)
    if s.busy or s.pending:
        return JSONResponse({"error": "GENESIS is still working; wait for it to finish"}, 409)
    text = str((await request.json()).get("text") or "").strip()[:1000]
    if not text:
        return JSONResponse({"error": "empty question"}, 400)
    s.emit("user", text=text)
    asyncio.create_task(s.drive({"messages": [HumanMessage(content=text)]}))
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
    return JSONResponse({"gemini_key": bool(os.environ.get("GOOGLE_API_KEY")), "fallbacks": list(available_fallbacks()),
                         "built": DIST.is_dir()})


async def index(request: Request) -> Response:
    page = DIST / "index.html"
    if page.is_file():
        return FileResponse(page)
    return Response("The UI isn't built yet. Run:  cd web && npm install && npm run build", media_type="text/plain")


def app() -> Starlette:
    routes = [
        Route("/api/info", info),
        Route("/api/investigations", create, methods=["POST"]),
        Route("/api/investigations/{sid}/events", events),
        Route("/api/investigations/{sid}/decision", decision, methods=["POST"]),
        Route("/api/investigations/{sid}/ask", ask, methods=["POST"]),
        Route("/api/investigations/{sid}/evidence", evidence),
        Route("/api/lab/{tool}", lab, methods=["POST"]),
        Route("/files/{sid}/{path:path}", files),
        Route("/", index),
    ]
    if (DIST / "assets").is_dir():
        routes.append(Mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets"))
    return Starlette(routes=routes)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="GENESIS web bench")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args(argv)
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
    uvicorn.run(app(), host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
