"""GENESIS setup. Run it once from the folder where you unzipped GENESIS:

    py setup_genesis.py          (Windows)
    python3 setup_genesis.py     (macOS / Linux)

It finds Python 3.12 or 3.13, creates .venv, installs GENESIS with its free
extras, creates .env if it is missing, checks Node.js, and runs the doctor.
It never deletes anything, so running it again is safe.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

WINDOWS = os.name == "nt"
ENV_TEMPLATE = """# GENESIS keys. Paste each key right after the = sign. No quotes, no spaces.
# Required:
GOOGLE_API_KEY=
# Optional and free (leave empty for now if you don't have them):
GROQ_API_KEY=
TAVILY_API_KEY=
"""


def say(text: str = "") -> None:
    print(text, flush=True)


def find_project(folder: Path) -> Path | None:
    """The folder holding GENESIS's pyproject.toml: here, or one level down (Windows 'Extract All' adds a folder)."""
    for c in [folder, *sorted(p for p in folder.iterdir() if p.is_dir())]:
        pp = c / "pyproject.toml"
        if pp.is_file() and 'name = "genesis-see"' in pp.read_text(encoding="utf-8", errors="ignore"):
            return c
    return None


def python_version(cmd: list[str]) -> tuple[tuple[int, int], str] | None:
    try:
        out = subprocess.run(cmd + ["-c", "import sys; print(sys.version_info[0], sys.version_info[1], sys.executable)"],
                             capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    parts = out.stdout.strip().split(" ", 2)
    if out.returncode != 0 or len(parts) < 3:
        return None
    return (int(parts[0]), int(parts[1])), parts[2]


def choose_python() -> str | None:
    """GENESIS needs Python 3.12 or 3.13 (the course's versions)."""
    if (3, 12) <= sys.version_info[:2] <= (3, 13):
        return sys.executable
    tries = [["py", "-3.13"], ["py", "-3.12"]] if WINDOWS else [["python3.13"], ["python3.12"]]
    for cmd in tries:
        if shutil.which(cmd[0]):
            found = python_version(cmd)
            if found and (3, 12) <= found[0] <= (3, 13):
                return found[1]
    return None


def venv_dir(root: Path) -> Path:
    return root / ".venv" / ("Scripts" if WINDOWS else "bin")


def run(cmd: list, **kw) -> int:
    say("    > " + " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], **kw).returncode


def env_has(path: Path, key: str) -> bool:
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        k, _, v = line.partition("=")
        if k.strip() == key and v.strip().strip('"').strip("'"):
            return True
    return False


def main() -> int:
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    say("GENESIS setup")
    say("=============")
    here = Path(__file__).resolve().parent
    root = find_project(here) or find_project(Path.cwd())
    if root is None:
        say("Could not find GENESIS (pyproject.toml) next to this file or in a folder just below it.")
        say("Put setup_genesis.py in the folder where you unzipped GENESIS, then run it again.")
        return 1
    say(f"[1/6] GENESIS folder: {root}")
    if " " in str(root) or "(" in str(root):
        say("      Note: this path has spaces or brackets. It works, but a plain path such as C:\\genesis")
        say("      avoids trouble with some tools later. Optional.")

    py = choose_python()
    if py is None:
        say(f"[2/6] This is Python {sys.version_info[0]}.{sys.version_info[1]}, and no Python 3.12 or 3.13 was found.")
        say("      Install one, close this window, open a new one, and run setup again:")
        say("      winget install Python.Python.3.12" if WINDOWS else "      (install python3.12 with your package manager)")
        return 1
    say(f"[2/6] Python: {py}")

    vpy = venv_dir(root) / ("python.exe" if WINDOWS else "python")
    if vpy.exists():
        say("[3/6] .venv already exists, reusing it")
    else:
        say("[3/6] Creating .venv ...")
        if run([py, "-m", "venv", root / ".venv"]) != 0:
            say("      Creating the virtual environment failed (see the message above).")
            return 1

    say("[4/6] Installing GENESIS and its free extras. The first time takes a few minutes ...")
    if run([vpy, "-m", "pip", "install", "-e", ".[test,free-models,mcp-tools]"], cwd=root) != 0:
        say("      The install failed. Copy everything above this line and send it to me.")
        return 1

    env_file = root / ".env"
    if not env_file.exists():
        env_file.write_text(ENV_TEMPLATE, encoding="utf-8")
        say("[5/6] Created .env. Open it, paste your Google key after GOOGLE_API_KEY=, and save:")
        say("      notepad .env" if WINDOWS else "      nano .env")
    elif env_has(env_file, "GOOGLE_API_KEY"):
        say("[5/6] .env found, GOOGLE_API_KEY is set")
    else:
        say("[5/6] .env found, but GOOGLE_API_KEY is empty. Open it and paste your key:")
        say("      notepad .env" if WINDOWS else "      nano .env")

    node = shutil.which("node")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip() if node else ""
    if node and shutil.which("npx"):
        say(f"[6/6] Node.js {version} with npx: found")
    else:
        say("[6/6] Node.js: NOT found. Install it, close this window, open a new one:")
        say("      winget install OpenJS.NodeJS.LTS")

    say()
    say("Running the doctor. It starts every server once; the first time it downloads them, so give it a few minutes.")
    say("Start-up messages from the servers (DuckDuckGo, Wikipedia) are normal.")
    say()
    env = dict(os.environ)
    env["PATH"] = str(venv_dir(root)) + os.pathsep + env.get("PATH", "")   # so uvx from .venv is found
    run([vpy, "-m", "genesis_see.integrations.doctor", "--connect"], cwd=root, env=env)

    say()
    say("Setup finished. Each time you open a new Command Prompt to use GENESIS, type:")
    say(f'    cd /d "{root}"' if WINDOWS else f'    cd "{root}"')
    say("    .venv\\Scripts\\activate" if WINDOWS else "    source .venv/bin/activate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
