// Automatic schematics for any circuit GENESIS has a netlist for.
// Layout and symbols come from netlistsvg (github.com/nturley/netlistsvg, MIT), which places
// parts with the ELK layered layout engine. GENESIS supplies the netlist: parts in their roles
// and the nets that join their pins (diagrams.py, or wiring the observer traced).

const TWO = {      // symbol, and which of our pin names go to which symbol pin
  resistor: ["r_v", p => (/2|out|b\b/i.test(p) ? "B" : "A")],
  capacitor: ["c_v", p => (/−|-|stripe|2\b/.test(p) ? "B" : "A")],
  inductor: ["l_v", p => (/2|b\b/i.test(p) ? "B" : "A")],
  led: ["d_led_v", p => (/cathode|−|-|flat/i.test(p) ? "-" : "+")],
  diode: ["d_v", p => (/cathode|−|-|band|k\b/i.test(p) ? "-" : "+")],
  crystal: ["xtal", p => (/2|b\b/i.test(p) ? "B" : "A")],
  supply: ["v", p => (/−|-|gnd/i.test(p) ? "-" : "+")],
};
const NPN = p => (/coll/i.test(p) ? "C" : /base/i.test(p) ? "B" : "E");

const OUTISH = /\bout\d*\b|\(out\)|\btx\b|gpio|\bd\d+\b|pwm|echo|vout|5v out/i;   // drawn on the right of a box
const portName = p => {
  const pin = p.match(/^pin (\d+) \(([^)]+)\)/i);           // "pin 8 (VCC)" -> "8 VCC"
  if (pin) return `${pin[1]} ${pin[2]}`;
  return p.replace(/\s*\(which pin is not visible\)/i, " ?").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 24) || "pin";
};

/** wiring (from the server) → Yosys-style JSON netlist for netlistsvg */
export function toNetlist(w) {
  const cells = {};
  const bit = new Map();
  w.nets.forEach((n, i) => bit.set(n.key, 10 + i));
  const partKey = role => Object.keys(w.parts).find(k => w.parts[k].role === role);
  // collect each part's pins
  const pins = {};
  for (const n of w.nets) for (const p of n.pins) {
    const k = partKey(p.part);
    if (!k) continue;
    (pins[k] ||= []).push({ pin: p.pin, net: bit.get(n.key) });
  }
  for (const [k, part] of Object.entries(w.parts)) {
    const list = pins[k];
    if (!list?.length) continue;
    const ref = part.id || part.role;
    // traced parts carry their id as the role; name them by what they are instead ("HC-SR04 06", not "06 06")
    const title = part.id && part.role === part.id ? (part.label.split(" · ")[1] || part.role) : part.role;
    const supplyV = part.kind === "supply" ? (part.label.split(" · ")[1] || "") : "";
    const attrs = { ref, value: [part.id ? title : "", title === part.value ? "" : part.value || supplyV].filter(Boolean).join(" ") || `${part.role} (not seen)` };
    const kind = part.kind === "npn" ? "npn" : part.kind;
    if (TWO[kind]) {
      const [type, map] = TWO[kind];
      const conn = {}, dirs = {};
      for (const { pin, net } of list) { const sp = map(pin); conn[sp] = [net]; dirs[sp] = "input"; }
      cells[`${k}`] = { type, port_directions: dirs, connections: conn, attributes: attrs };
    } else if (kind === "npn") {
      const conn = {}, dirs = {};
      for (const { pin, net } of list) { const sp = NPN(pin); conn[sp] = [net]; dirs[sp] = sp === "B" ? "input" : "output"; }
      cells[k] = { type: "q_npn", port_directions: dirs, connections: conn, attributes: attrs };
    } else {
      // ICs, controllers, drivers, modules, motors: a box with its named pins
      const conn = {}, dirs = {}, seen = new Map();
      for (const { pin, net } of list) {
        let name = portName(pin);
        const n = (seen.get(name) || 0) + 1; seen.set(name, n);
        if (n > 1) name = `${name} ${n}`;
        conn[name] = [net];
        dirs[name] = OUTISH.test(pin) ? "output" : "input";
      }
      cells[k] = { type: `${title} ${part.id && title !== part.id ? part.id : ""}`.trim(), port_directions: dirs, connections: conn, attributes: attrs };
    }
  }
  // ground and supply symbols make the drawing read like a schematic
  for (const n of w.nets) {
    if (/gnd|ground/i.test(n.key + n.name)) cells[`gnd_${n.key}`] = { type: "gnd", port_directions: { A: "input" }, connections: { A: [bit.get(n.key)] }, attributes: { name: "GND" } };
    else if (/^(vcc|vbat|pwr|v5)$/.test(n.key)) cells[`vcc_${n.key}`] = { type: "vcc", port_directions: { A: "output" }, connections: { A: [bit.get(n.key)] }, attributes: { name: n.name.replace(/ supply$/, "") } };
  }
  return { modules: { genesis: { ports: {}, cells } } };
}

let lib = null, skin = null;
async function load() {
  if (!lib) {
    const [m, s] = await Promise.all([import("netlistsvg"), import("netlistsvg/lib/analog.svg?raw")]);
    lib = m.default || m;
    skin = s.default;
  }
  return { lib, skin };
}

/** Draw the schematic into `el`; returns {highlight(netKey), svg()} like the hand-drawn version. */
export async function renderNetlist(el, w) {
  const { lib, skin } = await load();
  const netlist = toNetlist(w);
  const svgText = await lib.render(skin, netlist);
  el.innerHTML = svgText;
  const svg = el.querySelector("svg");
  svg.classList.add("schem", "schem-auto");
  // netlistsvg sets a fixed size and no viewBox; give it one so the drawing scales to fit
  const vw = parseFloat(svg.getAttribute("width")) || 800, vh = parseFloat(svg.getAttribute("height")) || 600;
  if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `-10 -10 ${vw + 20} ${vh + 20}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.removeAttribute("width"); svg.removeAttribute("height");
  // colour each net, tag its wires with our net key, and add an N-badge at its first wire
  w.nets.forEach((n, i) => {
    const cls = `net_${10 + i}`;
    svg.querySelectorAll(`.${cls}`).forEach(e => {
      e.dataset.net = n.key;
      e.style.stroke = n.color;
      if (e.tagName === "circle") e.style.fill = n.color;
      e.classList.add("w");
    });
  });
  panZoom(svg);
  return {
    highlight(key) {
      svg.classList.toggle("focus", !!key);
      svg.querySelectorAll("[data-net]").forEach(e => e.classList.toggle("on", e.dataset.net === key));
    },
    svg() {
      const clone = svg.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      return clone.outerHTML.replace(/<svg([^>]*)>/, `<svg$1><rect width="100%" height="100%" fill="#fff"/>`);
    },
  };
}

// wheel to zoom, drag to pan, double-click to fit again
function panZoom(svg) {
  const vb0 = svg.getAttribute("viewBox").split(/[ ,]+/).map(Number);
  let vb = [...vb0], drag = null;
  const set = () => svg.setAttribute("viewBox", vb.join(" "));
  const toSvg = e => { const r = svg.getBoundingClientRect(), k = Math.max(vb[2] / r.width, vb[3] / r.height);
    return [vb[0] + (e.clientX - r.left - (r.width - vb[2] / k) / 2) * k, vb[1] + (e.clientY - r.top - (r.height - vb[3] / k) / 2) * k, k]; };
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const [x, y] = toSvg(e), f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const w = Math.min(vb0[2] * 1.5, Math.max(vb0[2] / 8, vb[2] * f)), s = w / vb[2];
    vb = [x - (x - vb[0]) * s, y - (y - vb[1]) * s, vb[2] * s, vb[3] * s]; set();
  }, { passive: false });
  svg.addEventListener("pointerdown", e => { if (e.button !== 0 || e.target.closest(".badge")) return; drag = { x: e.clientX, y: e.clientY, vb: [...vb] }; svg.setPointerCapture(e.pointerId); svg.classList.add("panning"); });
  svg.addEventListener("pointermove", e => { if (!drag) return; const [, , k] = toSvg(e);
    vb = [drag.vb[0] - (e.clientX - drag.x) * k, drag.vb[1] - (e.clientY - drag.y) * k, vb[2], vb[3]]; set(); });
  const end = () => { drag = null; svg.classList.remove("panning"); };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", () => { vb = [...vb0]; set(); });
}
