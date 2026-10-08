"""Catalog, loader, skills and doctor. No network: fake MCP clients, plus our own genesis-lab server for real."""
import asyncio
import json
from pathlib import Path

import pytest

from genesis_see.integrations import catalog, doctor, loader, skills
from genesis_see.integrations.catalog import SERVERS, MCPServer

BY_NAME = {s.name: s for s in SERVERS}


# ------------------------------------------------------------------ catalog --
def test_catalog_is_consistent():
    assert len(BY_NAME) == len(SERVERS), "duplicate names"
    for s in SERVERS:
        assert s.role in catalog.ROLES
        assert (s.transport == "stdio" and s.command) or (s.transport == "http" and s.url)
        assert s.verified in ("tested", "documented")
    # nothing that writes or touches hardware is on by default for a GENESIS agent
    for s in SERVERS:
        if s.role in catalog.RUNTIME_ROLES and s.safety != "read":
            assert not s.default_on, s.name
    assert BY_NAME["mpremote"].role == "none"  # exec/bootloader bypass the RECON firmware's safety


# -------------------------------------------------------------------- check --
which_all = lambda cmd: f"/usr/bin/{cmd}"
which_none = lambda cmd: None


def test_check_explains_every_reason():
    env = {}
    assert loader.check(BY_NAME["duckduckgo"], env=env, which=which_all).ready
    st = loader.check(BY_NAME["tavily"], env=env, which=which_all)
    assert not st.ready and "TAVILY_API_KEY" in st.reason and "1,000 credits" in st.reason
    assert loader.check(BY_NAME["tavily"], env={"TAVILY_API_KEY": "k"}, which=which_all).ready
    st = loader.check(BY_NAME["duckduckgo"], env=env, which=which_none)
    assert not st.ready and "pip install uv" in st.reason
    assert "Node.js" in loader.check(BY_NAME["memory"], env=env, which=which_none).reason
    assert "off by default" in loader.check(BY_NAME["arxiv"], env=env, which=which_all).reason
    assert loader.check(BY_NAME["arxiv"], enabled={"arxiv"}, env=env, which=which_all).ready
    assert "turned off" in loader.check(BY_NAME["fetch"], disabled={"fetch"}, env=env, which=which_all).reason
    st = loader.check(BY_NAME["mpremote"], enabled={"mpremote"}, env=env, which=which_all)
    assert not st.ready and st.reason.startswith("excluded")      # even when asked for


def test_connection_passes_only_what_is_needed():
    env = {"TAVILY_API_KEY": "k", "SECRET_THING": "x", "HTTPS_PROXY": "http://proxy:3128", "GOOGLE_API_KEY": "g"}
    c = loader.connection(BY_NAME["tavily"], env=env, which=which_all)
    assert c["command"] == "/usr/bin/npx" and c["args"] == ["-y", "tavily-mcp@latest"]
    assert c["env"] == {"TAVILY_API_KEY": "k", "HTTPS_PROXY": "http://proxy:3128"}  # no Google key, no secrets
    h = loader.connection(BY_NAME["context7"], env={"CONTEXT7_API_KEY": "c7"})
    assert h == {"transport": "streamable_http", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY": "c7"}}


# --------------------------------------------------------------------- load --
class FakeTool:
    def __init__(self, name, desc="d" * 400):
        self.name, self.description, self.args_schema = name, desc, {"type": "object", "properties": {}}


def fake_factory(tools_by_server, fail=()):
    class Client:
        def __init__(self, conns, tool_name_prefix=False, tool_interceptors=()):
            self.server = next(iter(conns))
            assert tool_name_prefix and tool_interceptors
        async def get_tools(self):
            if self.server in fail:
                raise ConnectionError("could not start")
            return [FakeTool(f"{self.server}_{n}") for n in tools_by_server[self.server]]
    return Client


async def test_load_filters_tools_and_survives_failures():
    cat = [MCPServer("wikipedia", "w", "researcher", "stdio", "uvx", ("x",), tools=("search_wikipedia", "get_summary")),
           MCPServer("fetch", "f", "researcher", "stdio", "uvx", ("y",)),
           MCPServer("broken", "b", "researcher", "stdio", "uvx", ("z",)),
           MCPServer("spicelib", "s", "simulator", "stdio", "uvx", ("s",))]
    tools = {"wikipedia": ["search_wikipedia", "wikipedia_search_wikipedia", "get_summary", "get_links"], "fetch": ["fetch"], "spicelib": ["run_dc_op"]}
    out = await loader.load({"researcher"}, catalog=cat, env={}, client_factory=fake_factory(tools, fail={"broken"}))
    assert [t.name for t in out.by_role["researcher"]] == ["wikipedia_search_wikipedia", "wikipedia_get_summary", "fetch_fetch"]
    assert out.servers == {"wikipedia": 2, "fetch": 1}
    assert "ConnectionError" in out.failed["broken"]
    assert "simulator" not in out.by_role  # role not requested, never started


async def test_token_budget_warning():
    cat = [MCPServer("big", "b", "researcher", "stdio", "uvx", ("x",))]
    out = await loader.load({"researcher"}, catalog=cat, env={}, client_factory=fake_factory({"big": [f"t{i}" for i in range(80)]}))
    assert out.tokens("researcher") > loader.ROLE_TOKEN_BUDGET and "turn something off" in out.warnings()[0]


async def test_retry_policy_by_safety():
    calls = []

    async def flaky(req):
        calls.append(1)
        raise ConnectionError("down")
    real = asyncio.sleep
    asyncio.sleep = lambda s: real(0)
    try:
        await loader.RetryPolicy(BY_NAME["fetch"])(None, flaky)
        read_calls = len(calls); calls.clear()
        r = await loader.RetryPolicy(BY_NAME["playwright"])(None, flaky)   # can click and submit
    finally:
        asyncio.sleep = real
    assert read_calls == 3 and len(calls) == 1 and "not retried" in r.content[0].text


async def test_load_for_real_with_our_own_server():
    """A real stdio MCP server (genesis-lab) through the real MultiServerMCPClient, with an allow-list."""
    import sys
    cat = [MCPServer("lab", "calculators", "researcher", "stdio", sys.executable, ("-m", "genesis_see.lab_server"),
                     tools=("predict_555_frequency", "nearest_standard_value"))]
    out = await loader.load({"researcher"}, catalog=cat, env={})
    assert sorted(t.name for t in out.by_role["researcher"]) == ["lab_nearest_standard_value", "lab_predict_555_frequency"]
    result = await [t for t in out.by_role["researcher"] if t.name.endswith("555_frequency")][0].ainvoke(
        {"ra_ohms": 1000, "rb_ohms": 10000, "c_farads": 1e-4})
    assert "0.68571" in str(result)


# ------------------------------------------------------------------- skills --
def make_skill(root, name, header, body="# Body\nSteps.", extra=None):
    d = Path(root) / ".agents" / "skills" / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\n{header}\n---\n\n{body}", encoding="utf-8")
    for f in extra or []:
        (d / f).write_text("x")
    return d


def test_frontmatter_forms():
    assert skills.parse_frontmatter("---\nname: a\ndescription: 'Quoted text'\n---\n") == {"name": "a", "description": "Quoted text"}
    folded = skills.parse_frontmatter("---\nname: b\ndescription: >\n  first line\n  second line\nlicense: MIT\n---\nbody")
    assert folded == {"name": "b", "description": "first line second line", "license": "MIT"}
    assert skills.parse_frontmatter("no header") == {}


def test_runtime_skill_tools(tmp_path):
    make_skill(tmp_path, "tavily-best-practices", "name: tavily-best-practices\ndescription: How to search well",
               body="Use specific queries. " * 2000, extra=["examples.md"])
    make_skill(tmp_path, "grill-me", "name: grill-me\ndescription: Not for GENESIS")
    tools = {t.name: t for t in skills.skill_tools("researcher", tmp_path)}
    assert set(tools) == {"list_skills", "read_skill"}
    listing = tools["list_skills"].invoke({})
    assert "tavily-best-practices" in listing and "grill-me" not in listing   # only the role's allow-list
    text = tools["read_skill"].invoke({"name": "tavily-best-practices"})
    assert "[... truncated]" in text and "examples.md" in text
    assert "No skill" in tools["read_skill"].invoke({"name": "grill-me"})
    assert skills.skill_tools("researcher", tmp_path / "empty") == []          # nothing installed: no tools at all


def test_install_commands_name_exact_skills():
    cmds = skills.install_commands("gemini-cli")
    lc = next(c for c in cmds if "langchain-ai/langchain-skills" in c)
    assert lc[:4] == ["npx", "-y", "skills", "add"] and "langgraph-human-in-the-loop" in lc
    assert lc[-3:] == ["-a", "gemini-cli", "-y"]
    assert len(cmds) == len(catalog.SKILL_PACKS)


# ------------------------------------------------------------------- doctor --
def test_doctor_report_and_gemini_cli_config(monkeypatch, tmp_path):
    monkeypatch.setattr(doctor, "ollama_running", lambda url="": False)
    monkeypatch.setattr(loader.shutil, "which", which_all)
    monkeypatch.chdir(tmp_path)
    text = "\n".join(doctor.report(env={"GOOGLE_API_KEY": "g"}))
    assert "[OK] gemini-flash-lite" in text and "[--] groq" in text and "GROQ_API_KEY" in text
    assert "[XX] mpremote" in text and "[--] tavily" in text
    cfg = doctor.gemini_cli_config(env={})
    assert cfg["mcpServers"]["context7"] == {"httpUrl": "https://mcp.context7.com/mcp"}
    assert cfg["mcpServers"]["git"] == {"command": "uvx", "args": ["mcp-server-git"]}
    assert "time" not in cfg["mcpServers"]                       # off by default
    path = doctor.write_gemini_cli(Path(".gemini/settings.json"))
    assert json.loads(path.read_text())["mcpServers"]["deepwiki"]["httpUrl"].startswith("https://mcp.deepwiki.com")


def test_root_error_unwraps_groups():
    try:
        raise ExceptionGroup("outer", [ExceptionGroup("inner", [ConnectionRefusedError("refused")])])
    except ExceptionGroup as e:
        assert loader.root_error(e) == "ConnectionRefusedError: refused"


async def test_unreachable_http_server_says_why():
    cat = [MCPServer("remote", "r", "sourcer", "http", url="http://127.0.0.1:9/mcp", verified="documented")]
    out = await loader.load({"sourcer"}, catalog=cat, env={}, timeout=20)
    assert "can't reach http://127.0.0.1:9/mcp" in out.failed["remote"]
