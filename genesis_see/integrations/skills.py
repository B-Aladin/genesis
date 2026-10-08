"""Agent Skills (skills.sh) for GENESIS.

1. Development time: install the curated packs into your coding agent:
       python -m genesis_see.integrations.skills install            (dry run: prints the commands)
       python -m genesis_see.integrations.skills install --run      (runs them)
2. Runtime: GENESIS agents may read a few installed skills. Only each skill's name and
   description are shown up front; the full text is loaded on demand (progressive
   disclosure), so an unused skill costs almost nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from langchain.tools import tool

from .catalog import RUNTIME_SKILLS, SKILL_PACKS

SKILL_DIRS = (".agents/skills", ".gemini/skills", "skills")
MAX_SKILL_CHARS = 12000


@dataclass
class Skill:
    name: str
    description: str
    path: Path

    @property
    def text(self) -> str:
        return (self.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")


def parse_frontmatter(text: str) -> dict[str, str]:
    """Read the YAML header of a SKILL.md: simple `key: value` pairs, folded and quoted values."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    out: dict[str, str] = {}
    key = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line[:1] not in (" ", "\t") and ":" in line:
            key, _, value = line.partition(":")
            key, value = key.strip(), value.strip()
            out[key] = "" if value in (">", "|", ">-", "|-") else value.strip("'\"")
        elif key and line.strip():  # continuation of a folded value
            out[key] = (out[key] + " " + line.strip()).strip()
    return out


def find_skills(root: str | Path = ".", dirs: tuple[str, ...] = SKILL_DIRS) -> dict[str, Skill]:
    found: dict[str, Skill] = {}
    for d in dirs:
        base = Path(root) / d
        if not base.is_dir():
            continue
        for md in sorted(base.glob("*/SKILL.md")):
            meta = parse_frontmatter(md.read_text(encoding="utf-8", errors="replace"))
            name = meta.get("name") or md.parent.name
            found.setdefault(name, Skill(name, meta.get("description", ""), md.parent))
    return found


def lock_entries(root: str | Path = ".") -> dict[str, dict]:
    p = Path(root) / "skills-lock.json"
    return json.loads(p.read_text(encoding="utf-8")).get("skills", {}) if p.exists() else {}


def skill_tools(role: str, root: str | Path = ".", allowed: tuple[str, ...] | None = None) -> list:
    """list_skills / read_skill tools for one agent role, limited to that role's allowed skills."""
    allowed = RUNTIME_SKILLS.get(role, ()) if allowed is None else allowed
    library = {n: s for n, s in find_skills(root).items() if n in allowed}
    if not library:
        return []

    @tool
    def list_skills() -> str:
        """List the skills you may read: each has procedural know-how for a kind of task. Read one with read_skill
        only when its description matches what you are doing."""
        return "\n".join(f"- {s.name}: {s.description}" for s in library.values())

    @tool
    def read_skill(name: str) -> str:
        """Read the full instructions of one skill listed by list_skills."""
        s = library.get(name)
        if s is None:
            return f"No skill '{name}'. Available: {', '.join(library)}."
        text = s.text
        extra = sorted(p.name for p in s.path.iterdir() if p.name != "SKILL.md")
        if len(text) > MAX_SKILL_CHARS:
            text = text[:MAX_SKILL_CHARS] + "\n[... truncated]"
        return text + (f"\n\nOther files in this skill (not loaded): {', '.join(extra)}" if extra else "")

    return [list_skills, read_skill]


# ------------------------------------------------------------------ install --


def install_commands(agent: str = "gemini-cli", packs=SKILL_PACKS) -> list[list[str]]:
    """One `npx skills add` per repo, naming exactly the skills we want (verified to exist)."""
    return [["npx", "-y", "skills", "add", p.repo, "-s", *p.skills, "-a", agent, "-y"] for p in packs]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m genesis_see.integrations.skills")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("install", help="install the curated skill packs for your coding agent")
    i.add_argument("--agent", default="gemini-cli", help="claude-code, cursor, codex, gemini-cli, ... ('*' for all)")
    i.add_argument("--run", action="store_true", help="actually run the commands (default: print them)")
    sub.add_parser("list", help="show installed skills and which GENESIS roles may read them")
    a = ap.parse_args(argv)
    if a.cmd == "list":
        found, lock = find_skills(), lock_entries()
        if not found:
            print("No skills installed in this project yet. Run: python -m genesis_see.integrations.skills install --run")
        for name, s in found.items():
            roles = [r for r, names in RUNTIME_SKILLS.items() if name in names]
            src = lock.get(name, {}).get("source", "?")
            print(f"{name:42s} from {src:34s} runtime: {', '.join(roles) or '-'}")
        return 0
    cmds = install_commands(a.agent)
    if not a.run:
        print("# Review each skill on skills.sh first (its page shows security audits); skills run with your agent's permissions.")
        for c in cmds:
            print(" ".join(c))
        print("\n# Re-run with --run to install them.")
        return 0
    if not shutil.which("npx"):
        print("npx not found: install Node.js LTS first (winget install OpenJS.NodeJS.LTS).")
        return 1
    env = {**os.environ, "DISABLE_TELEMETRY": os.environ.get("DISABLE_TELEMETRY", "1")}
    failed = 0
    for c in cmds:
        print("$", " ".join(c), flush=True)
        failed += subprocess.run([shutil.which("npx"), *c[1:]], env=env).returncode != 0
    print(f"\n{len(cmds) - failed} of {len(cmds)} packs installed. Check with: python -m genesis_see.integrations.skills list")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
