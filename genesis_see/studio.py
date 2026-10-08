"""LangGraph Studio entry (lessons 1.5 and 3.5): `langgraph dev` serves `agent`.

The server supplies persistence, so there's no checkpointer. The genesis-lab MCP
calculators are left out here because Studio imports this file synchronously;
the CLI (python -m genesis_see.run) includes them. In Studio, start a run with
input like: {"messages": [{"role": "user", "content": "Investigate this device."}],
"photos": ["C:/path/front.jpg"], "video_path": "C:/path/blink.mp4"}
"""
from genesis_see.agent import build_agent

agent = build_agent(checkpointer=None)
