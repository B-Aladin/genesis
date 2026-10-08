# mcp.client.stdio binds sys.stderr as a default argument at import time. Import it
# here, at collection, so a per-test output capture (test_cli's capfd) can't leave
# later MCP tests holding a closed stream. Test-environment only; terminals are fine.
import mcp.client.stdio  # noqa: F401
