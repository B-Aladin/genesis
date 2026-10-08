// Schematic of the matched circuit, drawn from the server's wiring (nets + parts).
// Every wire carries its net: data-net="<key>", coloured by net, with an N-badge,
// so one connection at a time can be highlighted while someone rebuilds the board.
import { escapeHtml as esc } from "./bench3d.js";

const W = 760, H = 430;

export function renderSchematic(el, wiring) {
  if (!wiring) {
    el.innerHTML = `<div class="schem-empty"><b>No schematic</b><span>A wiring diagram is drawn once a known circuit is matched (555 timer, two-transistor flasher, or a microcontroller / Arduino / ESP output).</span></div>`;
    return { highlight() {}, svg: () => "" };
  }
  const net = Object.fromEntries(wiring.nets.map(n => [n.key, n]));
  const P = wiring.parts;
  const out = [];
  const col = k => net[k]?.color || "#888";

  // ---- primitives
  const wire = (k, pts) => out.push(`<polyline class="w" data-net="${k}" points="${pts.map(p => p.join(",")).join(" ")}" stroke="${col(k)}"/>`);
  const dot = (k, x, y) => out.push(`<circle class="j" data-net="${k}" cx="${x}" cy="${y}" r="4.5" fill="${col(k)}"/>`);
  const badge = (k, x, y) => {
    if (!net[k]) return;
    out.push(`<g class="badge" data-net="${k}" transform="translate(${x},${y})"><rect x="-15" y="-10" width="30" height="20" rx="3" fill="${col(k)}"/><text y="4" text-anchor="middle">${net[k].id}</text></g>`);
  };
  const st = role => {
    const p = Object.values(P).find(p => p.role === role) || {};
    return `part st-${p.status || "OBSERVED"}${p.id || p.kind === "supply" ? "" : " is-missing"}${p.role_inferred ? " role-inferred" : ""}`;
  };
  const lab = (x, y, role, anchor = "start") => {
    const p = Object.values(P).find(p => p.role === role);
    if (!p) return;
    const [a, ...rest] = p.label.split(" · ");
    out.push(`<text class="lbl" x="${x}" y="${y}" text-anchor="${anchor}"><tspan class="lbl-role">${esc(a)}</tspan>${rest.length ? `<tspan x="${x}" dy="14">${esc(rest.join(" · "))}</tspan>` : ""}</text>`);
  };
  const resistor = (x, y, vertical, role) => out.push(vertical
    ? `<rect class="${st(role)}" x="${x - 9}" y="${y}" width="18" height="46"/>`
    : `<rect class="${st(role)}" x="${x}" y="${y - 9}" width="50" height="18"/>`);
  const capV = (x, y, role) => out.push(`<g class="${st(role)}"><line x1="${x - 16}" y1="${y}" x2="${x + 16}" y2="${y}"/><path d="M${x - 16} ${y + 12} Q${x} ${y + 6} ${x + 16} ${y + 12}"/><text class="pol" x="${x + 20}" y="${y - 3}">+</text></g>`);
  const capH = (x, y, role, plusLeft) => out.push(`<g class="${st(role)}"><line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y + 14}"/><line x1="${x + 10}" y1="${y - 14}" x2="${x + 10}" y2="${y + 14}"/><text class="pol" x="${plusLeft ? x - 12 : x + 14}" y="${y - 16}">+</text></g>`);
  const ledV = (x, y, role) => out.push(`<g class="${st(role)}"><path d="M${x - 13} ${y} L${x + 13} ${y} L${x} ${y + 24} Z"/><line x1="${x - 13}" y1="${y + 24}" x2="${x + 13}" y2="${y + 24}"/><path class="arrows" d="M${x + 16} ${y + 6} l10 -8 M${x + 22} ${y - 4} l4 2 l-1 -5 M${x + 18} ${y + 14} l10 -8 M${x + 24} ${y + 4} l4 2 l-1 -5"/></g>`);
  const battery = (x, y, role) => out.push(`<g class="${st(role)}"><line x1="${x - 18}" y1="${y}" x2="${x + 18}" y2="${y}"/><line class="thick" x1="${x - 9}" y1="${y + 12}" x2="${x + 9}" y2="${y + 12}"/><text class="pol" x="${x + 22}" y="${y - 2}">+</text></g>`);
  const npn = (cx, cy, dir, role) => {
    out.push(`<g class="${st(role)}"><circle cx="${cx}" cy="${cy}" r="24" class="body"/>
      <line x1="${cx + dir * 8}" y1="${cy - 13}" x2="${cx + dir * 8}" y2="${cy + 13}" class="thick"/>
      <line x1="${cx + dir * 8}" y1="${cy - 6}" x2="${cx}" y2="${cy - 24}"/><line x1="${cx + dir * 8}" y1="${cy + 6}" x2="${cx}" y2="${cy + 24}"/>
      <line x1="${cx + dir * 8}" y1="${cy}" x2="${cx + dir * 24}" y2="${cy}"/>
      <path d="M${cx + dir * 1} ${cy + 15} l-1 9 l${-dir * 7} -5 Z" class="fill"/></g>`);
  };

  if (wiring.layout === "astable555") {
    const low = wiring.low;
    wire("vcc", [[70, 40], [430, 40]]); wire("gnd", [[70, 390], [640, 390]]);
    wire("vcc", [[70, 40], [70, 190]]); battery(70, 200, "Supply"); wire("gnd", [[70, 212], [70, 390]]); lab(104, 196, "Supply");
    wire("vcc", [[220, 40], [220, 62]]); resistor(220, 62, true, "RA"); wire("dis", [[220, 108], [220, 130], [330, 130]]); lab(236, 82, "RA");
    wire("dis", [[220, 130], [220, 148]]); resistor(220, 148, true, "RB"); wire("thr", [[220, 194], [220, 215], [330, 215]]); lab(236, 168, "RB");
    wire("thr", [[270, 215], [270, 255], [330, 255]]); dot("thr", 270, 215);
    wire("thr", [[220, 215], [220, 262]]); capV(220, 262, "C"); wire("gnd", [[220, 274], [220, 390]]); lab(150, 300, "C", "end");
    wire("vcc", [[370, 100], [370, 40]]); wire("vcc", [[430, 100], [430, 40]]); wire("gnd", [[400, 300], [400, 390]]);
    dot("vcc", 220, 40); dot("vcc", 370, 40); dot("dis", 220, 130); dot("thr", 220, 215); dot("gnd", 220, 390); dot("gnd", 400, 390);
    out.push(`<g class="${st("555")}"><rect class="body" x="330" y="100" width="140" height="200"/></g>`);
    for (const [x, y, t, a] of [[338, 134, "7 DIS", "start"], [338, 219, "6 THR", "start"], [338, 259, "2 TRIG", "start"], [370, 118, "8 VCC", "middle"],
      [430, 118, "4 RST", "middle"], [400, 290, "1 GND", "middle"], [462, 204, "3 OUT", "end"], [462, 264, "5 CV", "end"]]) {
      out.push(`<text class="pin" x="${x}" y="${y}" text-anchor="${a}">${t}</text>`);
    }
    lab(400, 170, "555", "middle");
    out.push(`<line class="nc" x1="470" y1="260" x2="500" y2="260"/><text class="pin muted" x="506" y="264">not observed</text>`);
    if (!low) {
      wire("out", [[470, 200], [530, 200]]); resistor(530, 200, false, "R LED"); lab(530, 178, "R LED");
      wire("led", [[580, 200], [640, 200], [640, 250]]); ledV(640, 250, "LED"); lab(670, 262, "LED");
      wire("gnd", [[640, 274], [640, 390]]);
      badge("out", 500, 186); badge("led", 610, 186);
    } else {
      wire("vcc", [[430, 40], [640, 40], [640, 70]]); resistor(640, 70, true, "R LED"); lab(656, 90, "R LED");
      wire("led", [[640, 116], [640, 140]]); ledV(640, 140, "LED"); lab(670, 152, "LED");
      wire("out", [[640, 164], [640, 200], [470, 200]]);
      badge("out", 560, 186); badge("led", 622, 128);
    }
    badge("vcc", 150, 40); badge("dis", 290, 116); badge("thr", 300, 201); badge("gnd", 520, 390);
  } else if (wiring.layout === "multivibrator") {
    wire("vcc", [[70, 40], [460, 40]]); wire("gnd", [[70, 390], [460, 390]]);
    wire("vcc", [[70, 40], [70, 190]]); battery(70, 200, "Supply"); wire("gnd", [[70, 212], [70, 390]]); lab(104, 196, "Supply");
    for (const [x, rc, led, k1, k2, role] of [[180, "R LED1", "LED1", "l1", "c1", "Q1"], [460, "R LED2", "LED2", "l2", "c2", "Q2"]]) {
      wire("vcc", [[x, 40], [x, 60]]); resistor(x, 60, true, rc); lab(x === 180 ? 140 : 500, 80, rc, x === 180 ? "end" : "start");
      wire(k1, [[x, 106], [x, 125]]); ledV(x, 125, led); lab(x === 180 ? 140 : 500, 140, led, x === 180 ? "end" : "start");
      wire(k2, [[x, 149], [x, 256]]);
      npn(x, 280, x === 180 ? 1 : -1, role); lab(x === 180 ? 150 : 490, 320, role, x === 180 ? "end" : "start");
      wire("gnd", [[x, 304], [x, 390]]); dot("gnd", x, 390);
    }
    for (const [x, rb, k] of [[280, "R base1", "b1"], [360, "R base2", "b2"]]) {
      wire("vcc", [[x, 40], [x, 60]]); resistor(x, 60, true, rb); dot("vcc", x, 40);
      lab(x === 280 ? 266 : 374, 86, rb, x === 280 ? "end" : "start");
      wire(k, [[x, 106], [x, 280], [x === 280 ? 204 : 436, 280]]);
    }
    dot("vcc", 180, 40);
    wire("c1", [[180, 190], [305, 190]]); dot("c1", 180, 190); capH(305, 190, "C1", true); wire("b2", [[315, 190], [360, 190]]); dot("b2", 360, 190);
    wire("c2", [[460, 225], [335, 225]]); dot("c2", 460, 225); capH(325, 225, "C2", false); wire("b1", [[325, 225], [280, 225]]); dot("b1", 280, 225);
    lab(310, 166, "C1", "middle"); lab(330, 254, "C2", "middle");
    badge("vcc", 130, 40); badge("gnd", 320, 390); badge("l1", 152, 116); badge("l2", 488, 116); badge("c1", 240, 176);
    badge("c2", 400, 211); badge("b1", 250, 266); badge("b2", 400, 266);
  } else {
    out.push(`<g class="${st("Power")}"><rect class="body" x="20" y="128" width="44" height="26"/><text class="pin" x="42" y="146" text-anchor="middle">USB</text></g>`);
    wire("pwr", [[64, 141], [110, 141]]);
    out.push(`<g class="${st("Controller")}"><rect class="body" x="110" y="100" width="190" height="230"/></g>`);
    lab(205, 210, "Controller", "middle");
    for (const [x, y, t, a] of [[118, 145, "5V / VIN", "start"], [292, 174, "GPIO ?", "end"], [292, 274, "GND", "end"]]) out.push(`<text class="pin" x="${x}" y="${y}" text-anchor="${a}">${t}</text>`);
    wire("gpio", [[300, 170], [390, 170]]); resistor(390, 170, false, "R"); lab(390, 134, "R");
    wire("led", [[440, 170], [520, 170], [520, 214]]); ledV(520, 214, "LED"); lab(550, 226, "LED");
    wire("gnd", [[300, 270], [520, 270], [520, 238]]);
    badge("pwr", 87, 126); badge("gpio", 345, 156); badge("led", 480, 156); badge("gnd", 410, 284);
  }

  el.innerHTML = `<svg class="schem" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic of the matched circuit" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
  const svg = el.querySelector("svg");
  return {
    highlight(key) {
      svg.classList.toggle("focus", !!key);
      svg.querySelectorAll("[data-net]").forEach(e => e.classList.toggle("on", e.dataset.net === key));
    },
    svg() {
      const css = `.w{fill:none;stroke-width:3;stroke-linejoin:round}.part rect,.part line,.part path,.part circle{fill:none;stroke:#151515;stroke-width:2}.part .fill{fill:#151515}.part .thick{stroke-width:4}.lbl{font:12px sans-serif;fill:#151515}.lbl-role{font-weight:700}.pin{font:10px monospace;fill:#44423d}.badge text{font:bold 11px monospace;fill:#fff}.pol{font:bold 13px sans-serif;fill:#151515}.nc{stroke:#999;stroke-dasharray:3 3}`;
      return svg.outerHTML.replace(/<svg([^>]*)>/, `<svg$1><style>${css}</style><rect width="100%" height="100%" fill="#fff"/>`);
    },
  };
}
