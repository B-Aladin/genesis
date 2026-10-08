"""Find the parts to replicate a board: JLCPCB / LCSC search through the free pcbparts MCP server.

Runs only when the user asks (the "Find parts" button), one search per part, in
parallel, with a time limit. Results are suggestions from a live catalogue: the
closest in-stock match for each observed part, never a claim about what is on
the user's board.
"""
from __future__ import annotations

import asyncio
import json
import re

from . import core
from .integrations import loader

SERVER = next(s for s in loader.SERVERS if s.name == "pcbparts")


def query_for(c: dict) -> str | None:
    t, mark = c["type"], (c.get("marking") or "").strip()
    v = (c.get("value") or {}).get("value")
    if t == "ic":
        return f"{mark} DIP-8" if re.search(r"555", mark) else (mark or None)
    if t == "resistor" and v:
        txt = core.fmt_ohms(v).replace(" ", "").replace("Ω", "").replace("k", "k")
        return f"{txt} resistor through hole"
    if t.startswith("capacitor") and v:
        volts = re.search(r"(\d+)\s*V", c.get("value_printed") or "")
        kind = {"capacitor_electrolytic": "electrolytic capacitor", "capacitor_ceramic": "ceramic capacitor through hole",
                "capacitor_film": "film capacitor"}.get(t, "capacitor")
        return f"{core.fmt_farads(v).replace(' ', '').replace('µ', 'u')} {volts.group(1) + 'V ' if volts else ''}{kind}"
    if t == "led":
        colour = re.search(r"\b(red|green|blue|yellow|white|orange)\b", c.get("evidence") or "", re.I)
        return f"{colour.group(1).lower() if colour else 'red'} LED 5mm through hole"
    if t == "dev_board":
        if re.search(r"8266", mark, re.I):
            return "ESP8266 ESP-12F module"
        if re.search(r"ESP", mark, re.I):
            return "ESP32-WROOM-32E module"
        return "ATMEGA328P-PU"
    if t == "transistor":
        return f"{mark} TO-92" if mark else "NPN transistor TO-92"
    if t == "voltage_regulator" and mark:
        return mark
    return mark or None


async def _search(tool, q: str, timeout: float) -> dict:
    raw = await asyncio.wait_for(tool.ainvoke({"query": q, "limit": 3}), timeout)
    text = raw if isinstance(raw, str) else " ".join(b.get("text", "") for b in raw if isinstance(b, dict)) if isinstance(raw, list) else str(raw)
    return json.loads(text[text.index("{"):]) if "{" in text else {}


async def find_parts(components: list[dict], timeout: float = 30) -> dict:
    from langchain_mcp_adapters.client import MultiServerMCPClient
    client = MultiServerMCPClient({SERVER.name: loader.connection(SERVER)})
    try:
        tools = {t.name: t for t in await asyncio.wait_for(client.get_tools(), timeout)}
    except Exception as e:
        return {"ok": False, "error": f"pcbparts is unreachable: {loader.root_error(e)}", "items": []}
    search = tools.get("jlc_search")
    if search is None:
        return {"ok": False, "error": "pcbparts no longer offers jlc_search", "items": []}

    async def one(c: dict) -> dict:
        q = query_for(c)
        item = {"id": c["id"], "type": c["type"], "query": q, "matches": []}
        if not q:
            item["note"] = "nothing specific enough to search for"
            return item
        try:
            data = await _search(search, q, timeout)
            if not data.get("results") and "through hole" in q:
                plain = q.replace(" through hole", "").replace(" 5mm", "")
                data = await _search(search, plain, timeout)
                if data.get("results"):
                    item["note"] = "no through-hole match in stock; these are surface-mount equivalents"
                    item["query"] = plain
            for r in (data.get("results") or [])[:3]:
                item["matches"].append({"lcsc": r.get("lcsc"), "model": r.get("model"), "maker": r.get("manufacturer"),
                                        "package": r.get("package"), "stock": r.get("stock"), "price": r.get("price"),
                                        "url": f"https://www.lcsc.com/product-detail/{r.get('lcsc')}.html" if r.get("lcsc") else None})
            if not item["matches"]:
                item["note"] = "no in-stock match"
            for m in item["matches"]:
                m["mount"] = "SMD" if item.get("note", "").startswith("no through-hole") else ""
        except Exception as e:
            item["note"] = f"search failed: {loader.root_error(e)}"
        return item

    items = await asyncio.gather(*(one(c) for c in components))
    if any(c["type"] == "dev_board" for c in components):
        note = "For a development board, the match is the module or chip on it; whole boards are sold by hobby shops."
    else:
        note = ""
    return {"ok": True, "source": "JLCPCB / LCSC catalogue via the pcbparts MCP server (free, no key)", "note": note, "items": items}
