"""Check every integration and say exactly what to fix.

    python -m genesis_see.integrations.doctor                  # keys, commands, models, servers, skills
    python -m genesis_see.integrations.doctor --connect        # also start the runtime servers and measure them
    python -m genesis_see.integrations.doctor --write-gemini-cli   # put the dev servers in .gemini/settings.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

from . import loader
from .catalog import MODELS, ROLES, RUNTIME_ROLES, SERVERS
from .skills import RUNTIME_SKILLS, find_skills


def ollama_running(url: str = "http://localhost:11434/api/tags") -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1):
            return True
    except Exception:
        return False


def model_lines(env=None) -> list[str]:
    env = os.environ if env is None else env
    out = []
    for m in MODELS:
        if m.name == "ollama":
            ok = ollama_running()
            how = "running" if ok else "not running (optional: install Ollama, then `ollama pull gemma4:e2b`)"
        else:
            ok = all(env.get(k) for k in m.env_required)
            how = "key found" if ok else f"set {', '.join(m.env_required)} in .env"
        out.append(f"  [{'OK' if ok else '--'}] {m.name:18s} {m.role:8s} {how}. Free: {m.free}")
    return out


def gemini_cli_config(env=None) -> dict:
    """mcpServers block for Gemini CLI, with the dev servers that are ready."""
    servers = {}
    for s in SERVERS:
        if s.role != "dev" or not loader.check(s, env=env).ready:
            continue
        if s.transport == "http":
            servers[s.name] = {"httpUrl": s.url}
        else:
            servers[s.name] = {"command": s.command, "args": list(s.args)}
    return {"mcpServers": servers}


def write_gemini_cli(path: Path = Path(".gemini/settings.json")) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    current.setdefault("mcpServers", {}).update(gemini_cli_config()["mcpServers"])
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return path


def report(env=None) -> list[str]:
    env = os.environ if env is None else env
    L = [f"Python {sys.version.split()[0]}  |  npx: {'yes' if shutil.which('npx') else 'NO (install Node.js LTS)'}"
         f"  |  uvx: {'yes' if shutil.which('uvx') else 'NO (pip install uv)'}"
         f"  |  ngspice: {'yes' if shutil.which('ngspice') or shutil.which('ngspice_con') else 'no (only for the simulator role)'}",
         "", "Models:"] + model_lines(env)
    for role, what in ROLES.items():
        rows = [s for s in SERVERS if s.role == role]
        if not rows:
            continue
        L += ["", f"{role}: {what}"]
        for s in rows:
            st = loader.check(s, env=env)
            mark = "OK" if st.ready else ("XX" if role == "none" else "--")
            L.append(f"  [{mark}] {s.name:20s} {s.purpose}. {st.reason}. [{s.verified}]")
    found = find_skills()
    L += ["", f"Skills installed in this project: {len(found)}"]
    for role, names in RUNTIME_SKILLS.items():
        have = [n for n in names if n in found]
        L.append(f"  runtime {role}: {', '.join(have) or 'none installed'} (allowed: {', '.join(names)})")
    if not found:
        L.append("  install the curated packs: python -m genesis_see.integrations.skills install --run")
    return L


async def connect_report(env=None) -> list[str]:
    loaded = await loader.load(set(RUNTIME_ROLES), env=env, on_event=lambda s: print("  " + s, flush=True))
    L = ["", "Started for real:"]
    for name, n in loaded.servers.items():
        L.append(f"  {name:20s} {n:3d} tools kept")
    for name, why in loaded.failed.items():
        L.append(f"  {name:20s} FAILED: {why}")
    for role, tools in loaded.by_role.items():
        L.append(f"  role {role:11s} {len(tools):3d} tools, ~{loaded.tokens(role):,} tokens of definitions per call")
    return L + [f"  WARNING: {w}" for w in loaded.warnings()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m genesis_see.integrations.doctor")
    ap.add_argument("--connect", action="store_true", help="start the runtime servers and measure them")
    ap.add_argument("--write-gemini-cli", action="store_true", help="add the ready dev servers to .gemini/settings.json")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors="replace")
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    print("\n".join(report()))
    if a.connect:
        print("\n".join(asyncio.run(connect_report())))
    if a.write_gemini_cli:
        print(f"\nWrote {write_gemini_cli()} (dev servers for Gemini CLI; no keys written to the file).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
