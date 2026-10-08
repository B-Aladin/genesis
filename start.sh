#!/usr/bin/env bash
# GENESIS in one command (macOS / Linux):   ./start.sh        or   ./start.sh --lan   (phone capture)
# Creates the Python environment and builds the UI the first time, then starts the bench and opens the browser.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

if [ ! -x .venv/bin/python ]; then
  echo "First run: creating the Python environment..."
  python3.12 -m venv .venv
  .venv/bin/python -m pip install -e ".[test,free-models,mcp-tools]"
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Add your GOOGLE_API_KEY to run on your own boards (the sample boards work without it)."
fi
if [ ! -f web/dist/index.html ]; then
  echo "First run: building the interface..."
  (cd web && npm install && npm run build)
fi

( sleep 3; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || true ) &
exec .venv/bin/python -m genesis_see.web --port "$PORT" "$@"
