# Setting up every free integration GENESIS can use

Three layers, all free:

1. **Models**: Gemini (required), plus Groq and Ollama as free backups when Gemini's quota runs out.
2. **MCP servers** from the MCP directories, each given to **one** GENESIS agent role.
3. **Skills** from skills.sh: for your coding agent while you build, and a few that GENESIS agents read at runtime.

## Why not "connect everything"?

Measured on real servers: the 14 MCP servers I tested expose **200 tools** and add
about **32,700 tokens** of tool definitions to **every** model call. That's more than
Groq's free limit of 8,000 tokens per minute, so a single call wouldn't fit, and on
any model it makes tool choice worse.

GENESIS therefore gives each agent only what its job needs, keeping only the useful
tools from each server. The researcher's whole toolset costs about **1,500 tokens** per
call. skills.sh lists over a million skills, many of them empty templates, so the same
rule applies there: a vetted set, nothing installed blindly.

## 1. Prerequisites (once)

```powershell
winget install OpenJS.NodeJS.LTS          # gives npx: runs Node MCP servers and the skills CLI
# close and reopen PowerShell, then in the GENESIS folder:
.venv\Scripts\Activate.ps1
pip install -e ".[test,free-models,mcp-tools]"   # adds Groq/Ollama connectors and uv (uvx)
```

Optional:
- **ngspice:** only for the simulator role, later. Install it from the ngspice website and put it on PATH.
- **Ollama:** a free, offline fallback model. Install it, then run `ollama pull gemma4:e2b`.

## 2. Keys (.env)

| Key | Required? | Where | Free tier (checked October 2026) |
|---|---|---|---|
| `GOOGLE_API_KEY` | yes | Google AI Studio | Flash-Lite has its own quota; 3.8 Flash allows 20 requests/day |
| `GROQ_API_KEY` | recommended | console.groq.com | no card; e.g. gpt-oss-120b: 30/min, 1,000/day, 8,000 tokens/min |
| `TAVILY_API_KEY` | optional | tavily.com | 1,000 credits a month, no card |
| `CONTEXT7_API_KEY` | optional | context7.com/dashboard | works without one; a key raises limits |

```
GOOGLE_API_KEY=...
GROQ_API_KEY=...
TAVILY_API_KEY=...
```

Not on the list, on purpose:
- **Brave Search** ended its free tier in February 2026; it now uses monthly credits with a card on file.
- **Google Custom Search** is closed to new customers.

## 3. Check everything

```powershell
python -m genesis_see.integrations.doctor            # keys, commands, models, servers, skills
python -m genesis_see.integrations.doctor --connect  # also starts the servers and measures them
```

Every line says `[OK]`, or exactly what's missing and how to fix it. The first
`--connect` downloads the servers, so it's slow; later runs are quick. Start-up
banners from the servers (DuckDuckGo, Wikipedia) are harmless.

## 4. What goes where

| Agent role | Servers (on by default) | Off unless you ask | Used in |
|---|---|---|---|
| researcher | duckduckgo, fetch, wikipedia (3 of its 22 tools), tavily if keyed | arxiv | **now**: identifying part markings, with sources |
| simulator | spicelib (pinned to `mcp<2`, see notes) | spicebridge | Part 2 |
| sourcer | pcbparts (JLCPCB, no key) | playwright (it can click and submit forms) | Part 2 |
| schematic | kicad_schematic (7 read/export tools of 42, no editing) | | Part 2/3 |
| hardware | | genesis_recon (Phase 1 node) | Part 3 |
| dev (your coding agent) | context7, deepwiki, git, filesystem, memory, sequential_thinking | time | while you build |
| none | | **mpremote**: excluded | never |

`mpremote-mcp` works, but its `exec` and `enter_bootloader` tools would let an AI run
any code on the ESP32, which the RECON firmware's safety design forbids. No GENESIS
agent ever gets it.

Turn things on or off per run:

```powershell
python -m genesis_see.run --photo front.jpg --video blink.mp4 --enable arxiv --disable duckduckgo
python -m genesis_see.run --photo front.jpg --video blink.mp4 --no-research
```

## 5. Skills (skills.sh)

Print the commands first, review them, then install:

```powershell
python -m genesis_see.integrations.skills install                # prints the npx commands
python -m genesis_see.integrations.skills install --run          # installs them (for Gemini CLI by default)
python -m genesis_see.integrations.skills install --run --agent claude-code   # or cursor, codex, ...
python -m genesis_see.integrations.skills list                   # what's installed, and who may read it
```

Every repo and skill name below was verified to exist:

| Repo | Skills | Why |
|---|---|---|
| langchain-ai/langchain-skills (official) | langchain-fundamentals, langchain-middleware, langgraph-human-in-the-loop, langgraph-persistence, langchain-rag, langchain-dependencies, langgraph-cli, eval-engineering | GENESIS's own stack |
| google-gemini/gemini-skills (official) | gemini-api-dev | Gemini API |
| flutter/skills (official) | five architecture, layout, HTTP and testing skills | the mission-control app |
| tavily-ai/skills (official) | tavily-search, tavily-best-practices | good web research |
| upstash/context7 (official) | find-docs | current docs |
| anthropics/skills (official) | mcp-builder, skill-creator, webapp-testing | MCP servers and your own skills |
| obra/superpowers | systematic-debugging, test-driven-development, verification-before-completion, writing-plans | discipline |
| laurigates/mcu-tinkering-lab | embedded-best-practices, esp32-debugging, wiring-doc, safe-build-operations | ESP32 work |
| h1d/agent-skills-esp32 | esp32-serial-logging | serial logs |
| ezrover/esp32-ai-agent-skill | esp32 | pin database and safety checks |

Skills land in `.agents\skills\`, and `skills-lock.json` records each skill's source
and hash. At runtime GENESIS agents read only an allow-list: the researcher gets
`tavily-best-practices` and `tavily-search`, and the future hardware agent gets
`esp32`, `embedded-best-practices` and `esp32-debugging`. Agents see names and
descriptions first and load full text only when needed.

Before installing anything else, open the skill's page on skills.sh and read its
security audits. Skills run with your agent's permissions.

## 6. Your coding agent's MCP servers

```powershell
python -m genesis_see.integrations.doctor --write-gemini-cli
```

This adds the ready dev servers to `.gemini\settings.json`. No keys are written into
the file.

## Troubleshooting

| Symptom | Fix |
|---|---|
| A server shows `needs the 'uvx' command` | `pip install uv` in the activated venv |
| `needs the 'npx' command` | install Node.js LTS, reopen PowerShell |
| Servers fail with certificate errors on a school or company network | set `UV_SYSTEM_CERTS=1` (Python servers) and `NODE_EXTRA_CA_CERTS=<path to your network's CA file>` (Node servers); GENESIS passes both through |
| `no answer within 120 s` | the first start downloads the server; run the doctor again |
| spicelib fails with `No module named 'mcp.server.fastmcp'` | it breaks on MCP SDK 2.x; the catalog already pins `mcp<2` for it |
| `[quota] ... answered by groq:...` | Gemini's free quota ran out and the free backup answered; the photo reader stays on Gemini |
