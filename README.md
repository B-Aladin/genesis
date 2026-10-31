# GENESIS Part 1: "See it", as a LangChain agent team on Gemini

Photos and a short video of an undocumented device go in. Out comes an
evidence-backed reconstruction: the parts, what the video measurably shows,
the known circuit it matches, a check of that explanation against the
device's real behaviour, what is still unknown, and a report in which every
sentence cites evidence.

```
coordinator agent: Gemini 3.1 Flash-Lite (3.8 Flash explains, if you allow it)
 ├─ watch_video        code measures the video frame by frame (OpenCV, no model)
 ├─ observe_parts  ──► Observer subagent: Gemini 3.1 Flash-Lite, vision, structured output
 ├─ identify_parts ──► Researcher subagent: web search, datasheet pages, Wikipedia (MCP), cited
 ├─ match_patterns     code scores known circuits by their clues
 ├─ check_prediction   code predicts behaviour from the parts and compares with the video
 ├─ list_unknowns      code lists what the pixels can't settle
 ├─ confirm_value      needs YOUR approval: approve, edit or reject
 ├─ write_report   ──► Reporter subagent: structured, every sentence cited; then a skeptic (code)
 └─ genesis-lab        MCP server of electronics calculators, for what-if questions
```

The models see and explain; code measures and decides. A value the AI works
out (a taped capacitor label, say) only becomes a recorded value when you
approve it.

## Where each lesson is used

| Lesson | Used for | Where |
|---|---|---|
| 1.1 Models, structured output | Observer and Reporter return Pydantic objects, not free text | `agent.py`: `Observation`, `Report` |
| 1.2 Tools | Six investigation steps and `confirm_value` are tools | `agent.py`: `build_agent` |
| 1.2 Web search | The Researcher looks markings up (DuckDuckGo or Tavily, fetch, Wikipedia); no source, no fact | `identify_parts`, `integrations/` |
| 1.3 Memory | Follow-up questions continue the same investigation | `InMemorySaver`, `thread_id` in `run.py` |
| 1.4 Multimodal | Photos and video key frames sent as image blocks | `observe_parts` |
| 1.5 / 3.5 Studio | The graph runs in LangGraph Studio | `studio.py`, `langgraph.json` |
| 2.1 MCP client and server | `genesis-lab` FastMCP server, plus vetted external servers given to the agent role that needs them | `lab_server.py`, `integrations/loader.py` |
| 2.2 Context and state | `SeeItContext` (free tier, reader); `SeeItState` holds the evidence; tools write it with `Command(update=...)` | `agent.py` |
| 2.3 / 2.4 Subagents as tools | Observer, Researcher and Reporter run in their own context, called by tools | `observe_parts`, `identify_parts`, `write_report` |
| 2.4 Retry interceptor | Retries read-only MCP tools only; a pin-driving tool would never be retried | `ReadOnlyRetryInterceptor` |
| 3.2 Managing messages | Long follow-up chats are summarised | `SummarizationMiddleware` |
| 3.3 Human-in-the-loop | `confirm_value` pauses for approve / edit / reject | `HumanInTheLoopMiddleware` |
| 3.4 Dynamic models | Flash-Lite for the investigation; 3.8 Flash only to explain; free Groq or Ollama answer when Gemini's quota runs out | `ChooseModel`, `QuotaFallback` |
| 3.4 Dynamic prompts | The system prompt carries the investigation's current state | `stage_prompt` |
| 3.4 / 3.5 Dynamic tools, gate | Each step unlocks only when the previous evidence exists | `EvidenceGate`, `allowed_steps` |
| Async (2.1, 2.4, 3.5 `.py`) | MCP tools need `astream`; middleware has sync and async paths | `run.py`, `ChooseModel`, `EvidenceGate` |

Next phase: datasheet RAG (bonus) over the PDFs the Researcher finds, SQL
(bonus) for memory across investigations, and a front-end (Agent Chat UI or
Flutter).

## Free integrations (MCP servers, skills, backup models)

See **SETUP_INTEGRATIONS.md**. In short:

```powershell
pip install -e ".[test,free-models,mcp-tools]"
python -m genesis_see.integrations.doctor --connect     # what's ready, what's missing, what it costs
python -m genesis_see.integrations.skills install --run # vetted skills.sh packs for your coding agent
```

## Set up (Windows PowerShell)

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[test]"
Set-Content .env "GOOGLE_API_KEY=your-key-here"
```

## Run an investigation

```powershell
python -m genesis_see.run --photo front.jpg --photo back.jpg --video blink.mp4 --note "9 V battery, LED blinks"
```

You'll see each step as it happens, then the report with the skeptic's
flags. When GENESIS asks to record a value you approve, edit or reject it.
Afterwards you can keep asking: "why is O3 there?", "the capacitor says
47uF", "what if RB were 22k?". Everything is saved to
`.genesis_work/evidence.json`.

**Quota:** one investigation is about 9 Gemini requests (7 coordinator turns,
1 observer, 1 reporter); each follow-up adds 1 to 4. All on Flash-Lite unless
you pass `--flash`. `gemini-3.8-flash` allows 20 free requests a day, so keep
it for the live demo, or turn on billing for competition week.

**Recording tips:** photos from straight above, in good light, every marking
readable. Video 5 to 20 s in MP4 (on iPhone: Settings > Camera > Formats >
Most Compatible), with the phone resting on something.

## Web bench (browser UI)

**The full tour, every option and feature: [correct.md](correct.md).**

GENESIS now works on any electronic device (blinkers, Arduino/ESP projects, robots, chargers, power supplies, converters, amplifiers, sensors), simulates the matched circuit with rating checks and one-click fixes, and lets you try what-if values live. Whole devices are split into layers (power, control, sensing, drive) with a power budget; any netlist gets an automatic schematic (netlistsvg + ELK); the Lab has seven calculators shared with the agents; a step tracker shows where the run is.

A browser front-end for the same agent team: drop photos and a video, see what
evidence is missing and what that costs, list the tools you have on hand, watch
each step run, inspect the parts on a 3D board rebuilt from what the observer
saw, follow the measured signal, approve values, read the cited report, and
rebuild the circuit from a colour-coded schematic and build checklist. A
Control panel shows every agent and free API (MCP server) and lets you switch
them; Arduino / ESP boards are recognised, and measurement sketches for them
are generated with safe voltage dividers.

```powershell
.\start.ps1          # one command: sets up on first run, builds the UI, starts, opens the browser
.\start.ps1 -Lan     # also lets a phone on the same Wi-Fi capture the photos and video (QR code)
```

Or by hand: `cd web; npm install; npm run build; cd ..` then `python -m genesis_see.web`
(`--lan` for phone capture) and open http://localhost:8000.

Investigations are saved (History survives restarts), can be re-run with added
evidence, shared as a printable report page (`/#report/<id>`, Print / Save as PDF),
rated ("Was this right?" goes to `.genesis_work/web/feedback.jsonl`), and every
model call is counted per run and per day.

**Try the sample board** runs the real pipeline (OpenCV measurement, pattern
match, cross-check, approvals, skeptic) on a generated board, with scripted
stand-ins for the model replies, so it costs zero Gemini requests. Open
`http://localhost:8000/#demo` to start it straight away. In the run, type
`O5 is 47uF` to see the approval and re-check.

For UI work, `npm run dev` in `web/` serves on :5173 with hot reload and
forwards API calls to the Python server on :8000.

| Piece | Where |
|---|---|
| HTTP + Server-Sent Events server (Starlette) | `genesis_see/web.py` |
| Input check, image quality, toolkit-aware next steps | `genesis_see/inputs.py` |
| Wiring nets (standard and traced), build steps, Mermaid | `genesis_see/diagrams.py` |
| Device layers, power budget, between-layer warnings | `genesis_see/system.py` |
| Lab calculators (also the genesis-lab MCP tools) | `genesis_see/calc.py` |
| Arduino / ESP measurement sketches | `genesis_see/sketches.py` |
| Parts search on JLCPCB via pcbparts MCP | `genesis_see/sourcing.py` |
| Sample boards (555, ESP32, robot car) and scripted models | `genesis_see/demo.py` |
| 3D board from observed parts (three.js) | `web/src/bench3d.js` |
| Automatic schematic (netlistsvg, MIT) | `web/src/netlist.js` |
| Classic schematic with per-net highlighting | `web/src/schematic.js` |
| Scope, views, panels, Control, motion (GSAP) | `web/src/scope.js`, `web/src/main.js` |
| genesis-lab calculators | `web/src/lab.js` |

## LangGraph Studio

```powershell
langgraph dev
```

Start a run with input such as
`{"messages": [{"role": "user", "content": "Investigate this device."}], "photos": ["C:/path/front.jpg"], "video_path": "C:/path/blink.mp4"}`.
Studio leaves out the MCP calculators because it imports the graph synchronously.

## Tests

```powershell
pytest -q
```

83 tests, **zero Gemini requests**. Scripted stand-ins for Gemini drive the
real coordinator, subagents, tools, middleware, approvals and memory. The
genesis-lab server runs over real stdio, and OpenCV reads real H.264 files
(made with ffmpeg, which must be on PATH for these tests). They prove the agent
system works; how well Gemini reads *your* board is what the first real run
shows.
