"""GENESIS "See it": a LangChain agent team on Gemini.

    coordinator  (Gemini 3.1 Flash-Lite; 3.8 Flash for explaining, when allowed)
     ├─ watch_video        code measures the video, frame by frame (no model)
     ├─ observe_parts  ──► observer subagent: Gemini 3.1 Flash-Lite, vision, structured output
     ├─ match_patterns     code scores known circuits
     ├─ check_prediction   code predicts behaviour from the parts, compares with the video
     ├─ list_unknowns      code lists what pixels can't settle
     ├─ confirm_value      HUMAN APPROVAL: turns an inferred or read value into a recorded one
     ├─ write_report   ──► reporter subagent: structured, every sentence cited; then the skeptic (code)
     └─ genesis-lab MCP    read-only calculators for what-if questions

Course patterns used: create_agent (all), structured output (1.1), tools (1.2),
memory (1.3), multimodal input (1.4), MCP client and server (2.1), runtime context
and custom state with Command updates (2.2), subagents as tools (2.3, 2.4),
retry interceptor (2.4), summarisation (3.2), human-in-the-loop (3.3),
dynamic models, prompts and tools (3.4), and a 3.5-style gate driven by state.
"""
from __future__ import annotations

import copy
import sys
from dataclasses import dataclass
from typing import Any, Literal

from langchain.agents import AgentState, create_agent
from langchain.agents.middleware import AgentMiddleware, HumanInTheLoopMiddleware, SummarizationMiddleware, dynamic_prompt
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, ToolMessage
from langchain.tools import ToolRuntime, tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from pydantic import BaseModel, Field

from . import core, inputs, media

LITE = "google_genai:gemini-3.1-flash-lite"   # course model "L": fast vision, its own free-tier quota
FLASH = "google_genai:gemini-3.8-flash"       # course model "F": stronger explanations, 20 requests/day free

# ------------------------------------------------------------ structured output --


class SeenPart(BaseModel):
    type: str = Field(description="one of: " + ", ".join(core.TYPES))
    marking: str | None = Field(None, description="exact characters printed on the part, or null; never complete a partly readable marking")
    bands: list[str] | None = Field(None, description="resistor colour bands in the order seen, e.g. ['brown','black','orange','gold']; null if unclear")
    value_printed: str | None = Field(None, description="a value printed on the part, e.g. '100uF 16V' or '104', or null")
    image: int = Field(1, description="number of the image where the part is clearest")
    box: list[int] | None = Field(None, description="[ymin, xmin, ymax, xmax] on a 0-1000 scale of that image")
    confidence: Literal["HIGH", "PROBABLE", "LOW"] = "PROBABLE"
    evidence: str = Field("", description="one short sentence: what you see")


class ChangingRegion(BaseModel):
    component_index: int | None = Field(None, description="index in components of the part inside the magenta box, or null")
    type: str | None = None
    evidence: str = ""


class BoardNote(BaseModel):
    note: str
    image: int | None = None
    confidence: Literal["HIGH", "PROBABLE", "LOW"] = "PROBABLE"


class Observation(BaseModel):
    """Everything visible in the images, and nothing else."""
    components: list[SeenPart]
    changing_region: ChangingRegion | None = None
    board: list[BoardNote] = Field(default_factory=list)
    cannot_see: list[str] = Field(default_factory=list)


class CitedSentence(BaseModel):
    text: str = Field(description="one sentence that uses only numbers found in the evidence")
    cites: list[str] = Field(description="ids of the evidence lines this sentence rests on, e.g. ['O2', 'X1']")


class ReportSection(BaseModel):
    title: Literal["What it is", "How it works", "How sure we are", "What we still don't know", "What to capture next"]
    sentences: list[CitedSentence]


class Report(BaseModel):
    """A short reconstruction report in which every sentence cites evidence."""
    sections: list[ReportSection]


class PartFact(BaseModel):
    component_id: str = Field(description="the O-id of the part, e.g. 'O1'")
    identity: str = Field(description="what the marking identifies, e.g. 'NE555P: precision timer IC'")
    function: str = Field(description="one sentence: what this part does in a circuit")
    key_facts: list[str] = Field(default_factory=list, description="short facts taken from the sources, e.g. 'supply 4.5 V to 16 V'")
    sources: list[str] = Field(default_factory=list, description="URLs the facts came from; a fact with no URL must not be reported")
    confidence: Literal["HIGH", "PROBABLE", "LOW"] = "PROBABLE"


class PartFacts(BaseModel):
    """What each marked part is, with the sources the facts came from."""
    parts: list[PartFact] = Field(default_factory=list)
    not_found: list[str] = Field(default_factory=list, description="O-ids that could not be identified from any source")


# ------------------------------------------------------------- context and state --


@dataclass
class SeeItContext:
    """Per-run settings (lesson 2.2 runtime context)."""
    free_tier: bool = True               # True: every call stays on Flash-Lite
    reader: str = "a student engineer"   # who the explanations are written for
    work_dir: str = ".genesis_work"      # where key frames and the evidence file go


class SeeItState(AgentState):
    """The investigation's evidence (lesson 2.2 custom state). Tools write it with Command."""
    photos: list[str]
    video_path: str | None
    note: str
    images: list[dict]
    keyframes: list[dict]
    video: dict | None
    video_checked: bool
    components: list[dict]
    board: list[dict]
    changing_region: dict | None
    cannot_see: list[str]
    observed: bool
    patterns: dict | None
    check: dict | None
    unknowns: list[dict] | None
    report: dict | None
    skeptic: dict | None
    brief: str
    identified: bool
    datasheets: list[dict] | None
    materials: list[str]                 # tools and parts the user has on hand
    inputs: dict | None                  # inputs.assess(): what was given, its quality, what's missing


# --------------------------------------------------------------------- prompts --

OBSERVER_PROMPT = """You are the Observer in GENESIS, an evidence-based reverse-engineering system.
Report only what is VISIBLE in the images. Do not explain what the circuit does.
List every electronic component once, from the image where it is clearest.
Copy markings character by character and never complete a partly readable marking.
For through-hole resistors give the colour bands in the order you see them.
If an image has a magenta box, it marks the area that changes over time in a video:
say which component is inside it."""

REPORTER_PROMPT = """You are the Reporter in GENESIS. Write a short reconstruction report using ONLY the evidence given.
Every sentence cites the ids of the evidence lines it rests on. Use only ids that appear in the evidence.
Use only numbers that appear in the evidence. Never add parts, values, history or brands that are not in it.
Where evidence is INFERRED, say "probably". Say plainly what is UNKNOWN. At most 230 words in total."""

RESEARCHER_PROMPT = """You are the Researcher in GENESIS. For each part marking you are given, find out what the part is
with your search and page-reading tools. Report only facts you found in a source, and give the URLs you used;
prefer the manufacturer's datasheet. A marking may be partial or misread: if sources disagree or nothing
matches, list the part in not_found instead of guessing. Use at most 6 tool calls in total. If list_skills
is available, check it once for search advice."""

STEPS = ["watch_video", "observe_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"]


def allowed_steps(st: dict, researcher: bool = False) -> set[str]:
    """The evidence gate (lesson 3.5 pattern, state-driven): each step unlocks the next.
    identify_parts is an optional step offered once the parts are observed, if a researcher exists."""
    if not st.get("video_checked"):
        return {"watch_video"}
    if not st.get("observed"):
        return {"observe_parts"}
    if st.get("patterns") is None:
        return {"match_patterns"} | ({"identify_parts"} if researcher and not st.get("identified") else set())
    if st.get("check") is None:
        return {"check_prediction"}
    if st.get("unknowns") is None:
        return {"list_unknowns"}
    return {"write_report", "confirm_value"}


def status_lines(st: dict) -> list[str]:
    L = []
    v = st.get("video")
    if st.get("video_checked"):
        L.append(f"Video: {video_summary(v) if v else 'none given'}")
    if st.get("observed"):
        L.append(f"Parts: {len(st.get('components') or [])} seen ({', '.join(c['id'] for c in st.get('components') or [])})")
    if st.get("identified"):
        D = st.get("datasheets") or []
        L.append("Datasheets: " + (", ".join(f"{d['id']} ({d['component_id']})" for d in D) if D else "none found with sources"))
    p = st.get("patterns")
    if p is not None:
        L.append(f"Pattern: {p['top']['name']} ({p['confidence'].lower()} fit)" if p.get("top") else "Pattern: none fits")
    x = st.get("check")
    if x is not None:
        L.append(f"Check: {check_summary(x)}")
    if st.get("unknowns") is not None:
        L.append(f"Unknowns: {', '.join(u['id'] for u in st['unknowns'])}")
    if st.get("report"):
        sk = st.get("skeptic") or {}
        L.append(f"Report: written, {sk.get('flagged', 0)} of {sk.get('claims', 0)} sentences flagged by the skeptic")
    return L or ["Nothing done yet."]


def coordinator_prompt(st: dict, ctx: SeeItContext, researcher: bool = False) -> str:
    nxt = allowed_steps(st, researcher)
    if "write_report" in nxt:
        nxt_text = ("write_report if there is no report yet; otherwise answer the user, using confirm_value only for a value "
                    "the user gives or one you want them to approve")
    elif "identify_parts" in nxt:
        nxt_text = "call identify_parts to look the part markings up in real sources, then match_patterns"
    else:
        nxt_text = f"call {sorted(nxt)[0]}"
    return f"""You are GENESIS, coordinating an evidence-based investigation of a physical device from photos and a video, for {ctx.reader}.
How you work:
- Specialists and code produce the evidence. You decide the next step and call one tool at a time.
- Never state a part, value or number that no tool returned. Cite evidence ids (O1, B1, V1, P1, X1, U1) when you explain.
- When the user tells you a value they read on a part, record it with confirm_value; the user approves it before it counts.
- For what-if questions (swapping a part, changing a value) use the genesis-lab calculators, and call their results SIMULATED.

Investigation so far:
- """ + "\n- ".join(status_lines(st)) + input_lines(st) + f"""
Next: {nxt_text}.
After the report is written, reply in three short sentences: what the device most likely is, whether the parts' prediction matched the video, and the single most useful thing to capture next."""


def input_lines(st: dict) -> str:
    """What the user gave and has on hand, so the coordinator adjusts to missing evidence."""
    a = st.get("inputs") or {}
    L = [f"Missing or weak input: {g['text']}" for g in a.get("gaps") or []]
    M = st.get("materials") or []
    L.append(f"The user has on hand: {', '.join(M)}. Suggest next steps they can do with these." if M
             else "The user listed no tools; suggest photos and videos as next steps.")
    return "\n- " + "\n- ".join(L) + ("\nBe plain about what the missing inputs prevent; never fill a gap with a guess." if a.get("gaps") else "")


def observer_request(images: list[dict], note: str | None, cautions: list[str] | None = None) -> str:
    lines = [f"Image {i + 1}: {im['label']}" + ("; the magenta box marks the area that changes over time" if im.get("region_boxes") else "")
             for i, im in enumerate(images)]
    hint = f'\nThe user says (a hint, not evidence): "{note.strip()[:500]}"' if note and note.strip() else ""
    warn = ("\nImage quality, measured by code:\n- " + "\n- ".join(cautions)) if cautions else ""
    return "Images:\n" + "\n".join(lines) + hint + warn + "\nList what you see."


# --------------------------------------------------------------- tool summaries --


def video_summary(v: dict | None) -> str:
    if not v:
        return "no video"
    if v.get("camera_moved"):
        return "the camera moved; measurements may be unreliable"
    p = [r for r in v["regions"] if r["analysis"].get("periodic")]
    if not v["regions"]:
        return "nothing visibly changes"
    if not p:
        return f"{len(v['regions'])} changing area(s), no steady rhythm"
    a = p[0]["analysis"]
    s = f"V{p[0]['index'] + 1}: a light blinks at {a['frequency_hz']:.3f} Hz, on {round((a.get('duty_cycle') or 0) * 100)}% of the time ({a['cycles']} cycles, {a['confidence']})"
    return s + ("; two lights take turns" if any(r["kind"] == "alternate" for r in v["relations"]) else "")


def check_summary(x: dict) -> str:
    if not x.get("available"):
        return f"not possible: {x.get('reason')}"
    if x["verdict"] == "INFERRED":
        return f"INFERRED: {x['inferred']['text']}"
    s = (f"{x['verdict']}: the parts predict {x['predicted']['frequency_hz']:.3f} Hz, the video shows "
         f"{x['measured']['frequency_hz']:.3f} Hz ({x['error_pct']}% apart, {x['tolerance_pct']:g}% allowed)")
    if x.get("ambiguity"):
        s += f"; roles not settled: {x['ambiguity']}"
    if x.get("suggestions"):
        s += "; likely explanations: " + "; ".join(t["text"] for t in x["suggestions"])
    return s


def apply_statuses(comps: list[dict], x: dict | None) -> list[dict]:
    comps = copy.deepcopy(comps)
    for c in comps:
        c["status"] = "OBSERVED"
    if x and x.get("verdict") == "INFERRED":
        for c in comps:
            if c["id"] == x["inferred"]["component"]:
                c["status"] = "INFERRED"
    if x and x.get("verdict") == "CONTRADICTED":
        suspects = {s["component"] for s in x.get("suggestions") or []}
        for c in comps:
            if c["id"] in suspects:
                c["status"] = "CONTRADICTED"
    return comps


def _reply(runtime: ToolRuntime, text: str) -> ToolMessage:
    return ToolMessage(text, tool_call_id=runtime.tool_call_id)


def _ctx(runtime: ToolRuntime) -> SeeItContext:
    return runtime.context or SeeItContext()


# ------------------------------------------------------------ MCP retry policy --


class ReadOnlyRetryInterceptor:
    """Lesson 2.4's retry interceptor, with one rule added: only tools on the
    read-only list are ever retried. Anything that could change the physical
    world (Part 3's RECON tools) runs at most once."""

    RETRYABLE_CODES = {-32603}

    def __init__(self, read_only: set[str] | None = None, max_retries: int = 3):
        self.read_only = read_only or {"decode_resistor_bands", "parse_component_value", "predict_555_frequency",
                                       "predict_flasher_frequency", "nearest_standard_value"}
        self.max_retries = max_retries

    async def __call__(self, request, handler):
        import asyncio
        from mcp.shared.exceptions import McpError
        from mcp.types import CallToolResult, TextContent

        attempts = self.max_retries if request.name in self.read_only else 1
        last = None
        for attempt in range(attempts):
            try:
                return await handler(request)
            except McpError as exc:
                last = exc
                if exc.error.code not in self.RETRYABLE_CODES:
                    return CallToolResult(content=[TextContent(type="text", text=f"Tool call failed (not retried): {exc}")], isError=False)
            except Exception as exc:  # network and process errors
                last = exc
            if attempt < attempts - 1:
                await asyncio.sleep(2 ** attempt)
        note = "after %d attempts" % attempts if attempts > 1 else "and was not retried because it is not read-only"
        return CallToolResult(content=[TextContent(type="text", text=f"Tool call failed {note}: {last}")], isError=False)


def lab_client():
    """The genesis-lab MCP server over stdio (lesson 2.1), with the retry policy (2.4)."""
    from langchain_mcp_adapters.client import MultiServerMCPClient
    return MultiServerMCPClient({"genesis_lab": {"transport": "stdio", "command": sys.executable,
                                                 "args": ["-m", "genesis_see.lab_server"]}},
                                tool_interceptors=[ReadOnlyRetryInterceptor()])


# ---------------------------------------------------------------------- agents --


@dataclass
class Models:
    """Which model plays which role. Strings are course model ids; tests pass fakes."""
    coordinator: Any = LITE
    coordinator_flash: Any = FLASH
    observer: Any = LITE
    reporter: Any = LITE
    reporter_flash: Any = FLASH
    researcher: Any = LITE
    fallbacks: tuple = ()     # tried in order when Gemini's quota runs out, e.g. ("groq:openai/gpt-oss-120b",)


def available_fallbacks(env: dict | None = None) -> tuple[str, ...]:
    """Free fallback models that can actually run here: Groq if its key is set, Ollama if it is running."""
    import importlib.util
    import os
    env = os.environ if env is None else env
    out = []
    if env.get("GROQ_API_KEY") and importlib.util.find_spec("langchain_groq"):
        out.append("groq:openai/gpt-oss-120b")
    if importlib.util.find_spec("langchain_ollama"):
        from .integrations.doctor import ollama_running
        if ollama_running():
            out.append("ollama:gemma4:e2b")
    return tuple(out)


def is_rate_limit(e: BaseException) -> bool:
    s = f"{type(e).__name__} {e}".lower()
    return any(k in s for k in ("resource_exhausted", "429", "rate limit", "ratelimit", "quota", "too many requests"))


def _label(m) -> str:
    return str(getattr(m, "model", None) or getattr(m, "model_name", None) or getattr(m, "label", None) or type(m).__name__)


def make_quota_fallback(fallback_models: list, notify=lambda text: print(text, file=sys.stderr)):
    """Lesson 3.4 dynamic models, used for resilience: when the chosen model reports a rate limit,
    the same request is retried on the next free provider. Other errors are never hidden."""

    class QuotaFallback(AgentMiddleware):
        used: list = []

        def __init__(self):
            super().__init__()
            self.used = []

        def wrap_model_call(self, request, handler):
            try:
                return handler(request)
            except Exception as e:
                if not fallback_models or not is_rate_limit(e):
                    raise
                last = e
                for fb in fallback_models:
                    try:
                        result = handler(request.override(model=fb))
                        self.used.append(_label(fb))
                        notify(f"[quota] {_label(request.model)} hit its limit; answered by {_label(fb)}")
                        return result
                    except Exception as e2:
                        last = e2
                raise last

        async def awrap_model_call(self, request, handler):
            try:
                return await handler(request)
            except Exception as e:
                if not fallback_models or not is_rate_limit(e):
                    raise
                last = e
                for fb in fallback_models:
                    try:
                        result = await handler(request.override(model=fb))
                        self.used.append(_label(fb))
                        notify(f"[quota] {_label(request.model)} hit its limit; answered by {_label(fb)}")
                        return result
                    except Exception as e2:
                        last = e2
                raise last

    return QuotaFallback()


def _resolve(m):
    return init_chat_model(m) if isinstance(m, str) else m


def build_agent(models: Models | None = None, extra_tools: list | None = None, checkpointer: Any = "memory",
                role_tools: dict[str, list] | None = None, skills_root: str = ".", notify=None):
    """Build the coordinator with its subagents.
    extra_tools: the genesis-lab MCP calculators (coordinator).
    role_tools: tools per agent role from integrations.loader (e.g. {"researcher": [...]}).
    checkpointer: "memory" (CLI), None (LangGraph Studio supplies its own), or a saver."""
    M = models or Models()
    coord_lite, coord_flash = _resolve(M.coordinator), _resolve(M.coordinator_flash)
    fallback_models = [_resolve(m) for m in M.fallbacks]
    fb = (lambda: make_quota_fallback(fallback_models, notify)) if notify else (lambda: make_quota_fallback(fallback_models))
    observer = create_agent(model=_resolve(M.observer), tools=[], system_prompt=OBSERVER_PROMPT, response_format=Observation)
    reporters = {True: create_agent(model=_resolve(M.reporter), tools=[], system_prompt=REPORTER_PROMPT, response_format=Report, middleware=[fb()]),
                 False: create_agent(model=_resolve(M.reporter_flash), tools=[], system_prompt=REPORTER_PROMPT, response_format=Report, middleware=[fb()])}
    from .integrations.skills import skill_tools
    web_tools = list((role_tools or {}).get("researcher", []))
    researcher = (create_agent(model=_resolve(M.researcher), tools=web_tools + skill_tools("researcher", skills_root),
                               system_prompt=RESEARCHER_PROMPT, response_format=PartFacts, middleware=[fb()])
                  if web_tools else None)
    extra_tools = list(extra_tools or [])
    lab_names = {t.name for t in extra_tools}

    @tool
    def watch_video(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 1. Measure the user's video with code, frame by frame (no model): finds what blinks or changes and times it."""
        st = runtime.state
        path = st.get("video_path")
        update: dict[str, Any] = {"video_checked": True, "video": None, "keyframes": []}
        if not path:
            return Command(update={**update, "messages": [_reply(runtime, "No video was given, so behaviour can't be measured. Next: observe_parts.")]})
        try:
            video, keyframes = media.read_video(path, _ctx(runtime).work_dir)
        except media.MediaError as e:
            return Command(update={**update, "messages": [_reply(runtime, f"The video couldn't be used: {e}")]})
        return Command(update={"video_checked": True, "video": video, "keyframes": keyframes,
                               "messages": [_reply(runtime, f"Measured by code: {video_summary(video)}. Notes: {'; '.join(video['notes']) or 'none'}.")]})

    @tool
    def observe_parts(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 2. Send the photos and video key frames to the Observer subagent (Gemini 3.1 Flash-Lite, vision).
        It lists every visible part, marking and colour band; code then decodes the values."""
        st = runtime.state
        images = [{"path": p, "label": f"photo {i + 1} (uploaded)"} for i, p in enumerate(st.get("photos") or [])]
        images = (images + list(st.get("keyframes") or []))[:4]
        if not images:
            return Command(update={"messages": [_reply(runtime, "There are no photos or video frames to look at. Ask the user for a photo of the board.")]})
        cautions = inputs.observer_cautions((st.get("inputs") or {}).get("photos") or [])
        blocks: list[dict] = [{"type": "text", "text": observer_request(images, st.get("note"), cautions)}]
        try:
            for im in images:
                blocks.append({"type": "image", "base64": media.photo_b64(im["path"]), "mime_type": "image/jpeg"})
            result = observer.invoke({"messages": [HumanMessage(content=blocks)]})
        except media.MediaError as e:
            return Command(update={"messages": [_reply(runtime, f"An image couldn't be read: {e}")]})
        except Exception as e:  # e.g. 429 RESOURCE_EXHAUSTED on the free tier
            return Command(update={"messages": [_reply(runtime, f"The observer subagent failed ({type(e).__name__}: {str(e)[:300]}). Tell the user; do not guess the parts.")]})
        obs = core.normalize_observation(result["structured_response"].model_dump())
        for c in obs["components"]:
            im = images[c["image"] - 1] if 1 <= c["image"] <= len(images) else images[0]
            c["image_label"], c["image_path"] = im["label"], im["path"]
        parts = "; ".join(f"{c['id']} {c['type'].replace('_', ' ')}" + (f" '{c['marking']}'" if c["marking"] else "")
                          + (f" {core.fmt_value(c)} (from {c['value']['basis']})" if c.get("value") else "") for c in obs["components"])
        return Command(update={"components": obs["components"], "board": obs["board"], "changing_region": obs["changing_region"],
                               "cannot_see": obs["cannot_see"], "observed": True, "images": images,
                               "messages": [_reply(runtime, f"Observer saw {len(obs['components'])} parts: {parts or 'none'}.")]})

    @tool
    def match_patterns(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 3. Score every known circuit pattern against the observed parts and the measured video (code)."""
        st = runtime.state
        p = core.score_patterns(st.get("components") or [], st.get("video"))
        lines = [f"P{i + 1} {r['name']}: {len(r['matched'])} clues found, {len(r['missing'])} missing, {len(r['unknown'])} not checked"
                 for i, r in enumerate(p["ranked"][:3])]
        return Command(update={"patterns": p, "messages": [_reply(runtime, f"Best fit: {p['top']['name'] if p['top'] else 'none'} "
                                                                           f"({p['confidence'].lower()}). " + "; ".join(lines))]})

    @tool
    def check_prediction(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 4. Predict the device's behaviour from the parts with the winning pattern's formula and compare it with the video (code)."""
        st = runtime.state
        top = (st.get("patterns") or {}).get("top")
        comps = st.get("components") or []
        x = core.cross_check(top["id"], comps, st.get("video")) if top else {"available": False, "reason": "no known circuit fits yet"}
        return Command(update={"check": x, "components": apply_statuses(comps, x),
                               "messages": [_reply(runtime, f"X1 {check_summary(x)}.")]})

    @tool
    def list_unknowns(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 5. List what the photos and video can't settle, and the most useful thing to capture next (code)."""
        st = runtime.state
        U = core.investigate(st.get("components") or [], st.get("patterns"), st.get("check"), st.get("video"),
                             len(st.get("photos") or []), st.get("cannot_see"))
        U = inputs.tailor(U, st.get("materials"), st.get("components"), st.get("inputs"))
        return Command(update={"unknowns": U, "messages": [_reply(runtime, " ".join(
            f"{u['id']}: {u['text']}." + (f" Next: {u['ask']}." if u.get("ask") else "") for u in U))]})

    @tool
    def confirm_value(component_id: str, value: str, reason: str, runtime: ToolRuntime[SeeItContext]) -> Command:
        """Record a part's value, e.g. one the user read off a label, or one worked out from the video that you want the
        user to approve. Requires human approval. Re-runs the pattern match, the check and the unknowns."""
        st = runtime.state
        comps = copy.deepcopy(st.get("components") or [])
        comp = next((c for c in comps if c["id"] == component_id), None)
        if comp is None:
            return Command(update={"messages": [_reply(runtime, f"There is no part {component_id}.")]})
        if not core.set_human_value(comp, value):
            return Command(update={"messages": [_reply(runtime, f"'{value}' isn't a value code can read. Try 10k, 4k7, 100uF or 104.")]})
        p = core.score_patterns(comps, st.get("video"))
        x = core.cross_check(p["top"]["id"], comps, st.get("video")) if p["top"] else {"available": False, "reason": "no known circuit fits yet"}
        comps = apply_statuses(comps, x)
        U = core.investigate(comps, p, x, st.get("video"), len(st.get("photos") or []), st.get("cannot_see"))
        U = inputs.tailor(U, st.get("materials"), comps, st.get("inputs"))
        return Command(update={"components": comps, "patterns": p, "check": x, "unknowns": U, "report": None, "skeptic": None,
                               "messages": [_reply(runtime, f"Recorded {component_id} = {core.fmt_value(comp)} (approved by the user; reason given: {reason}). "
                                                            f"Re-checked: {check_summary(x)}. The report is now out of date: call write_report.")]})

    @tool
    def write_report(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Step 6. The Reporter subagent writes a structured report where every sentence cites evidence; then the skeptic (code)
        flags any sentence that cites nothing, cites evidence that doesn't exist, or uses a number not in the evidence."""
        st, ctx = runtime.state, _ctx(runtime)
        brief, ids = core.build_brief(st), core.evidence_ids(st)
        try:
            res = reporters[ctx.free_tier].invoke({"messages": [HumanMessage(content=f"Write the report for {ctx.reader}.\n\n{brief}")]})
        except Exception as e:
            return Command(update={"messages": [_reply(runtime, f"The reporter subagent failed ({type(e).__name__}: {str(e)[:300]}).")]})
        rep = res["structured_response"].model_dump()
        sk = core.skeptic_check(rep, ids, brief)
        flagged = [f"'{s['text']}' ({'; '.join(s['flags'])})" for sec in sk["sections"] for s in sec["sentences"] if s["flags"]]
        return Command(update={"report": rep, "skeptic": sk, "brief": brief,
                               "messages": [_reply(runtime, f"Report written: {sk['claims']} sentences, {sk['flagged']} flagged by the skeptic."
                                                            + (" Flagged: " + " | ".join(flagged) if flagged else ""))]})

    @tool
    async def identify_parts(runtime: ToolRuntime[SeeItContext]) -> Command:
        """Optional step after observe_parts. The Researcher subagent looks every part marking (e.g. NE555P) up in
        real sources (web search, datasheet pages, Wikipedia) and returns facts with their URLs. No source, no fact."""
        st = runtime.state
        marked = [c for c in st.get("components") or [] if c.get("marking")]
        if not marked:
            return Command(update={"identified": True, "datasheets": [],
                                   "messages": [_reply(runtime, "No part has a readable marking, so there is nothing to look up.")]})
        ask = "Identify these parts from their markings, with sources:\n" + "\n".join(
            f"{c['id']}: {c['type'].replace('_', ' ')} marked '{c['marking']}'" for c in marked)
        try:
            res = await researcher.ainvoke({"messages": [HumanMessage(content=ask)]}, config={"recursion_limit": 30})
        except Exception as e:
            return Command(update={"identified": True, "datasheets": [], "messages": [_reply(runtime,
                           f"The researcher subagent failed ({type(e).__name__}: {str(e)[:300]}). Continue without datasheets.")]})
        valid = {c["id"] for c in marked}
        found, unsourced = [], []
        for f in res["structured_response"].parts:
            if f.component_id not in valid:
                continue
            if not f.sources:
                unsourced.append(f.component_id)  # no source, no fact
                continue
            found.append({"id": f"D{len(found) + 1}", **f.model_dump()})
        text = "; ".join(f"{d['id']}: {d['component_id']} is {d['identity']} ({len(d['sources'])} source(s))" for d in found) or "nothing identified with sources"
        if unsourced:
            text += f". Dropped because no source was given: {', '.join(unsourced)}"
        return Command(update={"identified": True, "datasheets": found, "messages": [_reply(runtime, f"Researcher: {text}.")]})

    step_tools = [watch_video, observe_parts, match_patterns, check_prediction, list_unknowns, confirm_value, write_report]
    if researcher is not None:
        step_tools.append(identify_parts)

    class ChooseModel(AgentMiddleware):
        """Lesson 3.4 dynamic model: Flash-Lite for the investigation; 3.8 Flash to explain once the
        report exists, unless on the free tier. Sync and async, like the 3.5 Studio script."""

        def _pick(self, request):
            ctx = request.runtime.context or SeeItContext()
            use_flash = (not ctx.free_tier) and bool(request.state.get("report"))
            return request.override(model=coord_flash if use_flash else coord_lite)

        def wrap_model_call(self, request, handler):
            return handler(self._pick(request))

        async def awrap_model_call(self, request, handler):
            return await handler(self._pick(request))

    class EvidenceGate(AgentMiddleware):
        """Lessons 3.4/3.5 dynamic tools: offer only the next step the evidence allows, plus the calculators."""

        def _narrow(self, request):
            allowed = allowed_steps(request.state, researcher is not None) | lab_names
            return request.override(tools=[t for t in request.tools if t.name in allowed])

        def wrap_model_call(self, request, handler):
            return handler(self._narrow(request))

        async def awrap_model_call(self, request, handler):
            return await handler(self._narrow(request))

    @dynamic_prompt
    def stage_prompt(request) -> str:
        """Lesson 3.4 dynamic prompt: the system prompt carries the investigation's current state."""
        return coordinator_prompt(request.state, request.runtime.context or SeeItContext(), researcher is not None)

    middleware = [
        SummarizationMiddleware(model=coord_lite, trigger=("tokens", 12000), keep=("messages", 20)),  # 3.2
        ChooseModel(), fb(), EvidenceGate(), stage_prompt,                                            # 3.4
        HumanInTheLoopMiddleware(interrupt_on={"confirm_value": True},                                # 3.3
                                 description_prefix="GENESIS wants to record a part value. Approve, edit the value, or reject"),
    ]
    return create_agent(model=coord_lite, tools=step_tools + extra_tools, state_schema=SeeItState, context_schema=SeeItContext,
                        checkpointer=InMemorySaver() if checkpointer == "memory" else checkpointer, middleware=middleware)


def start_state(photos: list[str], video: str | None, note: str = "", materials: list[str] | None = None) -> dict:
    """The first message and the evidence. Inputs are checked by code first, so the agent knows what's missing."""
    a = inputs.assess(list(photos), video, note, materials)
    task = ("Investigate this device: work out what it is and how it works, check your explanation against the video, and write the report."
            if video else "Investigate this device from the photos: work out what it is and how it probably works, and write the report. "
                          "There is no video, so its behaviour can't be checked; say so plainly.")
    return {"messages": [HumanMessage(content=task + (f" The user adds: {note}" if note else ""))],
            "photos": list(photos), "video_path": video, "note": note, "materials": list(materials or []), "inputs": a}
