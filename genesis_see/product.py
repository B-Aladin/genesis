"""Product plumbing for the web bench: saved investigations, a usage meter, feedback, LAN access.

- Every investigation is saved to its folder (session.json) when a turn ends, so
  the history survives a server restart. Saved runs can be viewed, exported,
  shared and re-run; only live ones can continue the conversation.
- Model calls are counted per run and per day by a LangChain callback, split by
  provider, so free-tier limits are visible before they bite.
- "Was this right?" answers go to feedback.jsonl, the cheapest accuracy signal
  an MVP can collect.
"""
from __future__ import annotations

import datetime as dt
import json
import socket
import threading
from pathlib import Path
from typing import Any, Callable

from langchain_core.callbacks import BaseCallbackHandler

_lock = threading.Lock()


# ---------------------------------------------------------------- usage meter --


def classify(serialized: dict | None, metadata: dict | None) -> str:
    """Which provider a chat-model call went to."""
    text = json.dumps(serialized or {}, default=str).lower() + " " + json.dumps(metadata or {}, default=str).lower()
    if "scriptedmodel" in text or "genesis-demo-script" in text:
        return "scripted"
    if "groq" in text:
        return "groq"
    if "ollama" in text:
        return "ollama"
    if "flash-lite" in text:
        return "gemini_lite"
    if "gemini" in text or "google" in text:
        return "gemini_flash"
    return "other"


class UsageCounter(BaseCallbackHandler):
    """Counts chat-model calls (coordinator and subagents) for one investigation."""

    def __init__(self, on_count: Callable[[str], None]):
        self.on_count = on_count

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, tags=None, metadata=None, **kw) -> Any:
        self.on_count(classify(serialized, metadata))

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, tags=None, metadata=None, **kw) -> Any:
        self.on_count(classify(serialized, metadata))


def add_daily(work: Path, kind: str, n: int = 1) -> None:
    if kind == "scripted":
        return
    f = work / "usage.json"
    with _lock:
        data = _read(f, {})
        day = data.setdefault(dt.date.today().isoformat(), {})
        day[kind] = day.get(kind, 0) + n
        for k in sorted(data)[:-30]:            # keep a month
            data.pop(k)
        f.write_text(json.dumps(data, indent=1), encoding="utf-8")


def usage_today(work: Path) -> dict:
    data = _read(work / "usage.json", {})
    today = data.get(dt.date.today().isoformat(), {})
    return {"today": today, "days": {k: data[k] for k in sorted(data)[-7:]},
            "flash_free_per_day": 20}    # gemini-3.8-flash free tier, from the project's README


# ------------------------------------------------------------------ persistence --


def save_session(folder: Path, record: dict) -> None:
    """Write session.json; intermediate evidence snapshots are dropped, the last one is kept."""
    events = record.get("events") or []
    last_state = max((i for i, e in enumerate(events) if e.get("type") == "state"), default=-1)
    record = {**record, "events": [e for i, e in enumerate(events) if e.get("type") != "state" or i == last_state]}
    tmp = folder / "session.json.tmp"
    tmp.write_text(json.dumps(record, default=str), encoding="utf-8")
    tmp.replace(folder / "session.json")


def load_sessions(work: Path) -> list[dict]:
    out = []
    for f in sorted(work.glob("*/session.json")):
        rec = _read(f, None)
        if rec and rec.get("id"):
            for i, e in enumerate(rec.get("events") or []):
                e["seq"] = i                        # renumber after dropping snapshots
            out.append(rec)
    return out


# --------------------------------------------------------------------- feedback --


def record_feedback(work: Path, entry: dict) -> None:
    with _lock:
        with (work / "feedback.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({**entry, "at": dt.datetime.now().isoformat(timespec="seconds")}) + "\n")


# --------------------------------------------------------------------------- LAN --


def lan_address() -> str | None:
    """This computer's address on the local network (no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))          # TEST-NET address: picks the outgoing interface, sends nothing
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def _read(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default
