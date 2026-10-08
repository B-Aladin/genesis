"""What GENESIS can plug in, which agent gets it, and why. Checked October 2026.

verified="tested":      started for real and its tools listed through MultiServerMCPClient.
verified="documented":  a hosted service the test machine could not reach; taken from its own docs.

Why not connect everything? Measured: 14 servers expose 200 tools and add about
32,700 tokens of tool definitions to EVERY model call. That would not even fit in
Groq's free 8,000 tokens per minute, and it makes any model pick tools worse. So each
server belongs to one agent role and only its useful tools are kept (`tools`).
"""
from __future__ import annotations

from dataclasses import dataclass

# Roles: agents that exist in GENESIS now, roles reserved for later parts, and
# "dev" for your coding agent (Gemini CLI etc.), never GENESIS itself.
ROLES = {
    "researcher": "Part 1.2: looks up part markings and datasheets, with sources",
    "simulator": "Part 2: runs SPICE on reconstructed circuits",
    "sourcer": "Part 2: finds parts and prices",
    "schematic": "Part 2/3: reads and exports KiCad schematics",
    "hardware": "Part 3: the RECON node",
    "dev": "your coding agent while you build GENESIS (not GENESIS itself)",
    "none": "excluded from every agent",
}
RUNTIME_ROLES = {"researcher", "simulator", "sourcer", "schematic", "hardware"}


@dataclass(frozen=True)
class MCPServer:
    name: str
    purpose: str
    role: str
    transport: str                      # "stdio" or "http"
    command: str | None = None          # "uvx", "npx" or "python"
    args: tuple[str, ...] = ()
    url: str | None = None
    env_required: tuple[str, ...] = ()  # keys that must be set
    env_optional: tuple[str, ...] = ()  # passed through when set
    tools: tuple[str, ...] | None = None  # keep only these tools (original names); None keeps all
    safety: str = "read"                # read | write | hardware
    free: str = "free, no key"
    verified: str = "tested"
    default_on: bool = True
    note: str = ""

    @property
    def needs(self) -> tuple[str, ...]:
        return (self.command,) if self.transport == "stdio" and self.command else ()


SERVERS: list[MCPServer] = [
    # ---------------------------------------------------------- researcher --
    MCPServer("duckduckgo", "web search and page reading, no key", "researcher", "stdio", "uvx", ("duckduckgo-mcp-server",),
              tools=("search", "fetch_content"), note="built-in rate limits: 30 searches and 20 fetches a minute"),
    MCPServer("tavily", "web search built for agents", "researcher", "stdio", "npx", ("-y", "tavily-mcp@latest"),
              env_required=("TAVILY_API_KEY",), tools=("tavily_search", "tavily_extract"),
              free="1,000 credits a month, no card (basic search = 1 credit)"),
    MCPServer("fetch", "read any web page as text (datasheet pages)", "researcher", "stdio", "uvx", ("mcp-server-fetch",)),
    MCPServer("wikipedia", "background on parts and circuits", "researcher", "stdio", "uvx", ("wikipedia-mcp",),
              tools=("search_wikipedia", "get_summary", "extract_key_facts"), note="22 tools upstream, half of them aliases"),
    MCPServer("arxiv", "research papers", "researcher", "stdio", "uvx", ("arxiv-mcp-server",),
              tools=("search_papers", "get_abstract"), default_on=False, note="rarely needed to identify a part"),
    # ----------------------------------------------------------- simulator --
    MCPServer("spicelib", "SPICE simulation, for comparing simulations with measurements", "simulator", "stdio", "uvx",
              ("--with", "mcp<2", "spicelib-mcp"),
              note="needs ngspice installed; pinned to mcp<2 because it breaks on the MCP SDK 2.x rename"),
    MCPServer("spicebridge", "SPICE with Monte Carlo, worst case and KiCad export", "simulator", "stdio", "uvx", ("spicebridge",),
              tools=("create_circuit", "run_transient", "run_dc_op", "get_results", "validate_netlist", "run_monte_carlo", "export_kicad"),
              default_on=False, note="overlaps spicelib; 28 tools upstream"),
    # ------------------------------------------------------------- sourcer --
    MCPServer("pcbparts", "JLCPCB parts search and live stock (Mouser, DigiKey optional)", "sourcer", "http",
              url="https://pcbparts.dev/mcp", free="free; JLCPCB needs no key", verified="documented"),
    MCPServer("playwright", "drive a browser, e.g. a local shop's website", "sourcer", "stdio", "npx",
              ("-y", "@playwright/mcp@latest", "--headless"), safety="write", default_on=False,
              note="25 tools; it can click and submit forms, so it is off unless you turn it on"),
    # ----------------------------------------------------------- schematic --
    MCPServer("kicad_schematic", "read KiCad schematics, ERC, netlist and BOM export", "schematic", "stdio", "uvx",
              ("--from", "mcp-server-kicad", "mcp-server-kicad-schematic"),
              tools=("get_schematic_summary", "list_schematic_components", "get_net_connections", "list_unconnected_pins",
                     "run_erc", "export_netlist", "export_bom"),
              note="42 tools upstream; only read and export tools are kept, no editing"),
    # ------------------------------------------------------------ hardware --
    MCPServer("genesis_recon", "the RECON node from Phase 1 (whitelisted pins, leases)", "hardware", "stdio", "python",
              ("-m", "genesis_gateway.mcp_server", "--transport", "stdio"), safety="hardware", default_on=False,
              note="install the Phase 1 gateway first; turned on in Part 3"),
    MCPServer("mpremote", "raw MicroPython access to a board", "none", "stdio", "uvx", ("mpremote-mcp",), safety="hardware",
              default_on=False, note="EXCLUDED from every agent: its exec and enter_bootloader tools bypass the RECON firmware's safety rules"),
    # ----------------------------------------------- dev (your coding agent) --
    MCPServer("context7", "up-to-date library docs", "dev", "http", url="https://mcp.context7.com/mcp",
              env_optional=("CONTEXT7_API_KEY",), free="free; a free key raises rate limits", verified="documented"),
    MCPServer("deepwiki", "ask questions about any public GitHub repo", "dev", "http", url="https://mcp.deepwiki.com/mcp",
              free="free, no sign-in, public repos", verified="documented"),
    MCPServer("git", "read and commit to your repo", "dev", "stdio", "uvx", ("mcp-server-git",), safety="write"),
    MCPServer("filesystem", "read and write project files", "dev", "stdio", "npx", ("-y", "@modelcontextprotocol/server-filesystem", "."), safety="write"),
    MCPServer("memory", "a knowledge graph that persists between sessions", "dev", "stdio", "npx", ("-y", "@modelcontextprotocol/server-memory"), safety="write"),
    MCPServer("sequential_thinking", "step-by-step reasoning scratchpad", "dev", "stdio", "npx", ("-y", "@modelcontextprotocol/server-sequential-thinking")),
    MCPServer("time", "current time and time zones", "dev", "stdio", "uvx", ("mcp-server-time",), default_on=False),
]


@dataclass(frozen=True)
class ModelProvider:
    name: str
    model: str            # init_chat_model id
    env_required: tuple[str, ...]
    role: str             # primary | fallback | offline
    free: str
    package: str


MODELS: list[ModelProvider] = [
    ModelProvider("gemini-flash-lite", "google_genai:gemini-3.1-flash-lite", ("GOOGLE_API_KEY",), "primary",
                  "free tier with its own quota (course model L)", "langchain-google-genai"),
    ModelProvider("gemini-flash", "google_genai:gemini-3.8-flash", ("GOOGLE_API_KEY",), "primary",
                  "20 free requests a day (course model F)", "langchain-google-genai"),
    ModelProvider("groq", "groq:openai/gpt-oss-120b", ("GROQ_API_KEY",), "fallback",
                  "free, no card: 30 requests/min, 1,000/day, 8,000 tokens/min, 200,000/day (per organisation)", "langchain-groq"),
    ModelProvider("ollama", "ollama:gemma4:e2b", (), "offline",
                  "free and offline; Gemma 4 E2B runs on a Raspberry Pi 5 with 8 GB", "langchain-ollama"),
]


@dataclass(frozen=True)
class SkillPack:
    repo: str
    skills: tuple[str, ...]
    why: str
    official: bool = False


# Development-time skills for your coding agent. All verified to exist with `npx skills add <repo> -l`.
SKILL_PACKS: list[SkillPack] = [
    SkillPack("langchain-ai/langchain-skills", ("langchain-fundamentals", "langchain-middleware", "langgraph-human-in-the-loop",
              "langgraph-persistence", "langchain-rag", "langchain-dependencies", "langgraph-cli", "eval-engineering"),
              "the exact stack GENESIS is built on", official=True),
    SkillPack("google-gemini/gemini-skills", ("gemini-api-dev",), "Gemini API usage", official=True),
    SkillPack("flutter/skills", ("flutter-apply-architecture-best-practices", "flutter-build-responsive-layout", "flutter-use-http-package",
              "flutter-add-widget-test", "flutter-fix-layout-issues"), "the Flutter mission-control app", official=True),
    SkillPack("tavily-ai/skills", ("tavily-search", "tavily-best-practices"), "web research done well", official=True),
    SkillPack("upstash/context7", ("find-docs",), "current library docs", official=True),
    SkillPack("anthropics/skills", ("mcp-builder", "skill-creator", "webapp-testing"), "writing MCP servers and your own skills", official=True),
    SkillPack("obra/superpowers", ("systematic-debugging", "test-driven-development", "verification-before-completion", "writing-plans"),
              "debugging and test discipline"),
    SkillPack("laurigates/mcu-tinkering-lab", ("embedded-best-practices", "esp32-debugging", "wiring-doc", "safe-build-operations"),
              "ESP32 firmware work"),
    SkillPack("h1d/agent-skills-esp32", ("esp32-serial-logging",), "reading ESP32 serial logs"),
    SkillPack("ezrover/esp32-ai-agent-skill", ("esp32",), "ESP32 pin database and safety checks"),
]

# Skills GENESIS agents may read at runtime (only if installed). Kept small on purpose:
# most skills are written for coding agents, not for a running investigation.
RUNTIME_SKILLS: dict[str, tuple[str, ...]] = {
    "researcher": ("tavily-best-practices", "tavily-search"),
    "hardware": ("esp32", "embedded-best-practices", "esp32-debugging"),
}
