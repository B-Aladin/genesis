"""Connect only what is enabled and available, and hand each agent role its own tools."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from dataclasses import dataclass, field
from typing import Any, Callable

from .catalog import RUNTIME_ROLES, SERVERS, MCPServer

# Network settings a server may need behind a proxy or school network. The MCP client
# starts servers with a minimal environment, so anything not passed here is dropped.
PASSTHROUGH = ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
               "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "UV_SYSTEM_CERTS")
ROLE_TOKEN_BUDGET = 6000  # tool definitions per role, in tokens; stays under Groq's free 8,000/min


@dataclass
class Status:
    server: MCPServer
    ready: bool
    reason: str


def check(server: MCPServer, enabled: set[str] | None = None, disabled: set[str] | None = None,
          env: dict | None = None, which: Callable[[str], str | None] = shutil.which) -> Status:
    """Is this server usable right now, and if not, exactly why."""
    env = os.environ if env is None else env
    if server.role == "none":
        return Status(server, False, f"excluded: {server.note}")
    if disabled and server.name in disabled:
        return Status(server, False, "turned off by you")
    if not server.default_on and not (enabled and server.name in enabled):
        return Status(server, False, "off by default" + (f" ({server.note})" if server.note else ""))
    missing = [k for k in server.env_required if not env.get(k)]
    if missing:
        return Status(server, False, f"needs {', '.join(missing)} in .env ({server.free})")
    for cmd in server.needs:
        if not which(cmd):
            hint = {"npx": "install Node.js LTS", "uvx": "pip install uv", "python": "Python on PATH"}.get(cmd, "")
            return Status(server, False, f"needs the '{cmd}' command ({hint})")
    return Status(server, True, "ready")


def connection(server: MCPServer, env: dict | None = None, which: Callable[[str], str | None] = shutil.which) -> dict:
    """The MultiServerMCPClient connection for one server."""
    env = os.environ if env is None else env
    if server.transport == "http":
        headers = {}
        if "CONTEXT7_API_KEY" in server.env_optional and env.get("CONTEXT7_API_KEY"):
            headers["CONTEXT7_API_KEY"] = env["CONTEXT7_API_KEY"]
        conn: dict[str, Any] = {"transport": "streamable_http", "url": server.url}
        if headers:
            conn["headers"] = headers
        return conn
    passed = {k: env[k] for k in (*server.env_required, *server.env_optional, *PASSTHROUGH) if env.get(k)}
    # Full path: on Windows `npx` is really npx.cmd, which a bare name can miss.
    return {"transport": "stdio", "command": which(server.command) or server.command, "args": list(server.args), "env": passed}


class RetryPolicy:
    """Lesson 2.4's interceptor with the safety rule: read-only servers may be retried,
    anything that writes or touches hardware runs at most once."""

    RETRYABLE_CODES = {-32603}

    def __init__(self, server: MCPServer, max_retries: int = 3):
        self.attempts = max_retries if server.safety == "read" else 1

    async def __call__(self, request, handler):
        from mcp.shared.exceptions import McpError
        from mcp.types import CallToolResult, TextContent
        last = None
        for attempt in range(self.attempts):
            try:
                return await handler(request)
            except McpError as exc:
                last = exc
                if exc.error.code not in self.RETRYABLE_CODES:
                    break
            except Exception as exc:
                last = exc
            if attempt < self.attempts - 1:
                await asyncio.sleep(2 ** attempt)
        how = f"after {self.attempts} attempts" if self.attempts > 1 else "and was not retried"
        return CallToolResult(content=[TextContent(type="text", text=f"Tool call failed {how}: {last}")], isError=False)


def schema_tokens(tools: list) -> int:
    """Roughly what these tool definitions add to every model call."""
    def one(t):
        params = t.args_schema if isinstance(t.args_schema, dict) else (t.args_schema.model_json_schema() if t.args_schema else {})
        return len(json.dumps({"name": t.name, "description": t.description, "parameters": params}))
    return sum(one(t) for t in tools) // 4


@dataclass
class Loaded:
    by_role: dict[str, list] = field(default_factory=dict)
    servers: dict[str, int] = field(default_factory=dict)       # name -> tools kept
    skipped: dict[str, str] = field(default_factory=dict)       # name -> why
    failed: dict[str, str] = field(default_factory=dict)        # name -> error

    def tokens(self, role: str) -> int:
        return schema_tokens(self.by_role.get(role, []))

    def warnings(self) -> list[str]:
        return [f"role '{r}' carries ~{self.tokens(r):,} tokens of tool definitions per call (budget {ROLE_TOKEN_BUDGET:,}); "
                "turn something off" for r in self.by_role if self.tokens(r) > ROLE_TOKEN_BUDGET]


def root_error(e: BaseException) -> str:
    """The real cause inside nested ExceptionGroups (what anyio wraps server failures in)."""
    while getattr(e, "exceptions", None):
        e = e.exceptions[0]
    return f"{type(e).__name__}: {str(e)[:200]}"


def _keep(server: MCPServer, tool) -> bool:
    if server.tools is None:
        return True
    original = tool.name[len(server.name) + 1:] if tool.name.startswith(server.name + "_") else tool.name
    return original in server.tools


async def load(roles: set[str], enabled: set[str] | None = None, disabled: set[str] | None = None,
               catalog: list[MCPServer] = SERVERS, env: dict | None = None, timeout: float = 120,
               client_factory: Callable[..., Any] | None = None, on_event: Callable[[str], None] = lambda s: None) -> Loaded:
    """Start the ready servers for these roles, one client each, and sort their tools by role."""
    if client_factory is None:
        from langchain_mcp_adapters.client import MultiServerMCPClient
        client_factory = MultiServerMCPClient
    out = Loaded()
    for server in catalog:
        if server.role not in roles:
            continue
        st = check(server, enabled, disabled, env)
        if not st.ready:
            out.skipped[server.name] = st.reason
            continue
        on_event(f"starting {server.name} ...")
        try:
            client = client_factory({server.name: connection(server, env)}, tool_name_prefix=True,
                                    tool_interceptors=[RetryPolicy(server)])
            tools = [t for t in await asyncio.wait_for(client.get_tools(), timeout) if _keep(server, t)]
        except (asyncio.TimeoutError, TimeoutError):
            out.failed[server.name] = (f"no answer within {timeout:.0f} s (the first start downloads the server; "
                                       "run the doctor again)")
            continue
        except Exception as e:  # one broken server must not take the others down
            why = root_error(e)
            if server.transport == "http":
                why += f" (can't reach {server.url}: check your internet connection or proxy)"
            out.failed[server.name] = why
            continue
        out.servers[server.name] = len(tools)
        out.by_role.setdefault(server.role, []).extend(tools)
    return out


def runtime_roles() -> set[str]:
    return set(RUNTIME_ROLES)
