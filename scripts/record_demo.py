"""Record the sample investigations from a running bench (python -m genesis_see.web) into web/public/demo,
so the static build (npm run build:static) can replay them on GitHub Pages without a server.

    python scripts/record_demo.py            # bench on http://127.0.0.1:8000
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import time
from pathlib import Path

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parents[1] / "web" / "demo-public" / "demo"
SAMPLES = ["full", "esp", "robot"]
BOARDS = ["arduino", "esp32", "esp8266"]


def events(c: httpx.Client, sid: str) -> list[dict]:
    """Wait for the run to finish, then read the whole event backlog (it ends at the first keep-alive ping)."""
    for _ in range(240):
        h = next((x for x in c.get("/api/investigations").json() if x["id"] == sid), None)
        if h and not h["busy"] and h["parts"]:
            break
        time.sleep(0.5)
    time.sleep(2)
    out = []
    with c.stream("GET", f"/api/investigations/{sid}/events") as r:
        for line in r.iter_lines():
            if line.startswith("data:"):
                out.append(json.loads(line[5:]))
            elif line.startswith(": keep-alive"):
                break
    return out


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "files").mkdir(parents=True)
    c = httpx.Client(base_url=BASE, timeout=60)
    runs, ids = {}, []
    for sample in SAMPLES:
        sid = c.post("/api/investigations", data={"mode": "demo", "sample": sample}).json()["id"]
        ev = events(c, sid)
        print(sample, sid, len(ev), "events")
        runs[sample] = sid
        ids.append(sid)
        rec = {"id": sid, "sample": sample, "events": ev,
               "evidence": c.get(f"/api/investigations/{sid}/evidence").json(),
               "report_md": c.get(f"/api/investigations/{sid}/report.md").text,
               "sketches": {f"{k}/{b}": c.get(f"/api/investigations/{sid}/sketch", params={"kind": k, "board": b}).text
                            for k in ("frequency", "voltage") for b in BOARDS}}
        text = json.dumps(rec)
        for url in sorted(set(re.findall(r"/files/[A-Za-z0-9_.\-/]+", text))):
            dest = OUT / url.lstrip("/")
            dest.parent.mkdir(parents=True, exist_ok=True)
            r = c.get(url)
            if r.status_code == 200:
                dest.write_bytes(r.content)
        # served next to the page, so paths become relative
        text = text.replace('"/files/', '"files/').replace("url('/files/", "url('files/")
        (OUT / f"{sid}.json").write_text(text, encoding="utf-8")
    hist = [h for h in c.get("/api/investigations").json() if h["id"] in ids]
    for h in hist:
        h["busy"] = False
    shared = {"runs": runs, "info": c.get("/api/info").json(), "control": c.get("/api/control").json(),
              "usage": c.get("/api/usage").json(), "investigations": hist}
    shared["info"]["lan"] = None
    (OUT / "index.json").write_text(json.dumps(shared), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
