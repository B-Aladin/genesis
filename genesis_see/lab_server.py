"""genesis-lab: read-only electronics calculators as an MCP server (lesson 2.1).

The coordinator loads these through MultiServerMCPClient; any other MCP client
(Gemini CLI, Claude Desktop, Cursor) can use them too. Every tool here is pure
maths, so every tool is safe to retry.

Run on its own:  python -m genesis_see.lab_server
"""
from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from . import calc, core

mcp = FastMCP("genesis-lab", log_level="WARNING")
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


@mcp.tool(annotations=READ_ONLY)
def decode_resistor_bands(bands: list[str]) -> dict[str, Any]:
    """Turn resistor colour bands (in the order seen, either end first) into a value in ohms.
    Reports which reading direction was used and whether the other direction is also plausible."""
    d = core.decode_bands(bands)
    if not d:
        raise ValueError("Those colours don't form a valid 3, 4, 5 or 6-band resistor code.")
    return {**d, "display": core.fmt_ohms(d["value"])}


@mcp.tool(annotations=READ_ONLY)
def parse_component_value(text: str, kind: str) -> dict[str, Any]:
    """Read a printed value such as '4k7', '103', '100uF 16V' or '104'. kind is 'resistor' or 'capacitor'."""
    if kind == "resistor":
        v = core.parse_resistance(text)
        return {"value": v, "unit": "ohm", "display": core.fmt_ohms(v) if v else None}
    v = core.parse_capacitance(text)
    return {"value": v, "unit": "F", "display": core.fmt_farads(v) if v else None}


@mcp.tool(annotations=READ_ONLY)
def predict_555_frequency(ra_ohms: float, rb_ohms: float, c_farads: float) -> dict[str, Any]:
    """Blink rate of a 555 astable: f = 1.44 / ((RA + 2 RB) C). Also returns the period and
    the fraction of time the output is high. Use it for what-if questions about part swaps."""
    if min(ra_ohms, rb_ohms, c_farads) <= 0:
        raise ValueError("All values must be positive.")
    f = 1.44 / ((ra_ohms + 2 * rb_ohms) * c_farads)
    return {"frequency_hz": round(f, 5), "period_s": round(1 / f, 5),
            "output_high_fraction": round((ra_ohms + rb_ohms) / (ra_ohms + 2 * rb_ohms), 4),
            "formula": "f = 1.44 / ((RA + 2 x RB) x C)", "status": "SIMULATED"}


@mcp.tool(annotations=READ_ONLY)
def predict_flasher_frequency(r1_ohms: float, c1_farads: float, r2_ohms: float, c2_farads: float) -> dict[str, Any]:
    """Blink rate of a two-transistor astable multivibrator: T = 0.693 (R1 C1 + R2 C2)."""
    T = 0.693 * (r1_ohms * c1_farads + r2_ohms * c2_farads)
    if T <= 0:
        raise ValueError("All values must be positive.")
    return {"frequency_hz": round(1 / T, 5), "period_s": round(T, 5), "formula": "T = 0.693 x (R1 x C1 + R2 x C2)", "status": "SIMULATED"}


@mcp.tool(annotations=READ_ONLY)
def nearest_standard_value(value: float, series: str = "E12") -> dict[str, Any]:
    """The nearest standard part value (E6, E12 or E24 series) to a computed value."""
    s = {"E6": core.E6, "E12": core.E12, "E24": core.E24}.get(series.upper())
    if s is None:
        raise ValueError("series must be E6, E12 or E24")
    return core.nearest_standard(value, s) or {}


@mcp.tool(annotations=READ_ONLY)
def led_resistor(supply_v: float, led_colour: str = "red", current_ma: float = 12) -> dict[str, Any]:
    """Series resistor for an LED: R = (V_supply - V_LED) / I, rounded up to a standard value, with its power."""
    return calc.led_resistor(supply_v, led_colour, current_ma)


@mcp.tool(annotations=READ_ONLY)
def voltage_divider(vin: float, r1: str = "", r2: str = "10k", vout_target: float | None = None) -> dict[str, Any]:
    """Voltage divider output for R1 (top) and R2 (to ground), or the R1 that brings vin down to vout_target
    (e.g. a 5 V sensor output to a 3.3 V ESP pin)."""
    return calc.divider(vin, r1 or None, r2, vout_target)


@mcp.tool(annotations=READ_ONLY)
def battery_runtime(capacity_mah: float, current_ma: float, usable_pct: float = 80) -> dict[str, Any]:
    """How long a battery lasts at a given average current."""
    return calc.battery_runtime(capacity_mah, current_ma, usable_pct)


@mcp.tool(annotations=READ_ONLY)
def motor_driver_check(battery: str = "2x18650", driver: str = "L298N", motor: str = "TT", count: int = 2) -> dict[str, Any]:
    """Can this battery and motor driver run these motors? Start-up (stall) current against the battery and
    the driver's per-channel rating, and the voltage the motors actually get. All figures are typical values."""
    return calc.motor_check(battery, driver, motor, count)


@mcp.tool(annotations=READ_ONLY)
def rc_time_constant(r: str, c: str) -> dict[str, Any]:
    """RC time constant, charge times (63 %, 95 %, 99 %) and the low-pass cutoff frequency."""
    return calc.rc_time(r, c)


if __name__ == "__main__":
    mcp.run(transport="stdio")
