// The 3D inspection bed: a board rebuilt from the parts the observer reported.
// Positions come from the observer's photo boxes where they don't collide; values,
// markings and colour bands are the observed ones. Copper is NOT drawn: it wasn't observed.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { gsap } from "gsap";

export const W = 10, D = 6.67, T = 0.16;
const TOP = T + 0.03;
const INK = 0x151515, SIGNAL = 0xe5451b, AMBER = 0xb97b0c;

export const BAND_HEX = {
  black: "#1a1a1a", brown: "#6b3a1e", red: "#c62a1d", orange: "#e8761c", yellow: "#f0c419", green: "#2f8a3c",
  blue: "#2456b8", violet: "#7d3fa0", purple: "#7d3fa0", grey: "#8a8a8a", gray: "#8a8a8a", white: "#f2f2f2",
  gold: "#c9a03a", silver: "#c0c0c0",
};

export const clock = { t0: performance.now(), now() { return (performance.now() - this.t0) / 1000; } };

const mats = {};
function plastic(color, rough = 0.55) {
  const k = `p${color}${rough}`;
  return mats[k] ||= new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}
function metal(color = 0xcfd2d6, rough = 0.28) {
  const k = `m${color}${rough}`;
  return mats[k] ||= new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 1 });
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function lead(g, x, z, y0, y1 = 0, r = 0.022) {
  const h = Math.abs(y0 - y1);
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 8), metal(0xbfc3c8), x, (y0 + y1) / 2, z));
}
function textTexture(text, w, h, { bg = "#141414", fg = "#d9d9d9", size = 0.42 } = {}) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = Math.max(64, Math.round(512 * h / w));
  const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = fg;
  x.font = `600 ${Math.round(c.height * size)}px "JetBrains Mono", Consolas, monospace`;
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ part builders

function ic(c) {
  const g = new THREE.Group();
  const m = (c.marking || "").toLowerCase();
  const pins = /mega|pic16|pic18|328|28/.test(m) ? 28 : /74|4\d\d\d|324|339|uln|l293/.test(m) ? 16 : 8;
  const len = (pins / 2) * 0.26 + 0.12, wid = 0.66, hgt = 0.3, y0 = 0.08;
  g.add(mesh(new THREE.BoxGeometry(len, hgt, wid), plastic(0x1c1c1e, 0.7), 0, y0 + hgt / 2, 0));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.92, wid * 0.7),
    new THREE.MeshStandardMaterial({ map: textTexture(c.marking || "IC", len, wid * 0.7, { bg: "#1c1c1e", fg: "#cfcfd2" }), roughness: 0.75 }));
  top.rotation.x = -Math.PI / 2; top.position.y = y0 + hgt + 0.002;
  g.add(top);
  const notch = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20, -Math.PI / 2, Math.PI), plastic(0x0b0b0c, 0.9));
  notch.rotation.x = -Math.PI / 2; notch.position.set(-len / 2 + 0.001, y0 + hgt + 0.003, 0);
  g.add(notch);
  for (let i = 0; i < pins / 2; i++) {
    const x = -len / 2 + 0.13 + i * 0.26;
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.07, 0.03, 0.12), metal(), x, y0 + 0.14, s * (wid / 2 + 0.05)));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.2, 0.025), metal(), x, 0.1, s * (wid / 2 + 0.1)));
    }
  }
  return { g, w: len + 0.25, d: wid + 0.4, h: y0 + hgt };
}

function axial(c, { body = 0xd8c49c, r = 0.12, len = 0.5, bands = [] } = {}) {
  const g = new THREE.Group();
  const y = r + 0.1;
  const geo = new THREE.CapsuleGeometry(r, len, 8, 20);
  geo.rotateZ(Math.PI / 2);
  g.add(mesh(geo, plastic(body, 0.6), 0, y, 0));
  const xs = bands.length >= 5 ? [-0.25, -0.15, -0.05, 0.05, 0.23] : bands.length === 3 ? [-0.2, -0.09, 0.02] : [-0.22, -0.11, 0, 0.21];
  bands.slice(0, 6).forEach((b, i) => {
    const bg = new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.05, 24);
    bg.rotateZ(Math.PI / 2);
    const col = BAND_HEX[String(b).toLowerCase()] || "#777";
    const mat = /gold|silver/.test(b) ? metal(new THREE.Color(col).getHex(), 0.35) : plastic(new THREE.Color(col).getHex(), 0.5);
    g.add(mesh(bg, mat, xs[i] ?? 0, y, 0));
  });
  const end = len / 2 + r, reach = end + 0.2;
  for (const s of [-1, 1]) {
    const hg = new THREE.CylinderGeometry(0.022, 0.022, reach - end + 0.05, 8);
    hg.rotateZ(Math.PI / 2);
    g.add(mesh(hg, metal(0xbfc3c8), s * (end + reach) / 2, y, 0));
    lead(g, s * reach, 0, y, 0);
  }
  return { g, w: reach * 2 + 0.2, d: r * 2 + 0.3, h: y + r };
}

function electrolytic(c) {
  const g = new THREE.Group();
  const r = 0.38, h = 0.95, y0 = 0.06;
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 40), plastic(0x23324f, 0.42), 0, y0 + h / 2, 0));
  const stripe = new THREE.CylinderGeometry(r + 0.004, r + 0.004, h * 0.96, 40, 1, true, 0.3, 0.9);
  g.add(mesh(stripe, plastic(0xb8bec6, 0.45), 0, y0 + h / 2, 0));
  g.add(mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.02, 40), metal(0xc9ccd0, 0.35), 0, y0 + h + 0.005, 0));
  for (const a of [0, Math.PI / 2]) {
    const s = mesh(new THREE.BoxGeometry(r * 1.4, 0.012, 0.03), plastic(0x55585c), 0, y0 + h + 0.017, 0);
    s.rotation.y = a; g.add(s);
  }
  if (c.display) {
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2),
      new THREE.MeshStandardMaterial({ map: textTexture(c.display.replace(/\s/g, ""), 0.42, 0.2, { bg: "#23324f", fg: "#e7e9ee", size: 0.5 }), roughness: 0.5 }));
    lab.position.set(0, y0 + h * 0.55, r + 0.006);
    g.add(lab);
  }
  return { g, w: r * 2 + 0.25, d: r * 2 + 0.25, h: y0 + h };
}

function ceramic() {
  const g = new THREE.Group();
  const s = new THREE.SphereGeometry(0.26, 28, 16);
  s.scale(1, 1, 0.38);
  g.add(mesh(s, plastic(0xc7782e, 0.5), 0, 0.42, 0));
  lead(g, -0.1, 0, 0.3, 0); lead(g, 0.1, 0, 0.3, 0);
  return { g, w: 0.7, d: 0.4, h: 0.68 };
}

function film() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.48, 0.26), plastic(0xd6b23a, 0.4), 0, 0.3, 0));
  return { g, w: 0.8, d: 0.45, h: 0.54 };
}

function led(c, bench) {
  const g = new THREE.Group();
  const r = 0.16;
  g.add(mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.05, 32), plastic(0xb0261a, 0.3), 0, 0.12, 0));
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xd8341c, emissive: 0xff2a10, emissiveIntensity: 0.2, roughness: 0.18, clearcoat: 1, transparent: true, opacity: 0.96 });
  g.add(mesh(new THREE.CylinderGeometry(r, r, 0.24, 32), lens, 0, 0.26, 0));
  const dome = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.add(mesh(dome, lens, 0, 0.38, 0));
  lead(g, -0.06, 0, 0.1, 0); lead(g, 0.06, 0, 0.1, 0);
  const light = new THREE.PointLight(0xff4a22, 0, 3.2, 1.6);
  light.position.set(0, 0.45, 0);
  g.add(light);
  bench.leds.push({ id: c.id, lens, light });
  return { g, w: 0.55, d: 0.55, h: 0.54 };
}

function to92() {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.19, 0.19, 0.42, 32, 1, false, 0, Math.PI);
  g.add(mesh(geo, plastic(0x1c1c1e, 0.7), 0, 0.42, 0));
  g.add(mesh(new THREE.BoxGeometry(0.38, 0.42, 0.01), plastic(0x1c1c1e, 0.7), 0, 0.42, 0));
  for (const x of [-0.12, 0, 0.12]) lead(g, x, 0.05, 0.21, 0);
  return { g, w: 0.55, d: 0.45, h: 0.63 };
}

function to220() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.5, 0.17), plastic(0x1c1c1e, 0.7), 0, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.34, 0.04), metal(0xc9ccd0, 0.3), 0, 0.86, -0.065));
  for (const x of [-0.13, 0, 0.13]) lead(g, x, 0, 0.2, 0, 0.03);
  return { g, w: 0.65, d: 0.45, h: 1.03 };
}

function boxy(color, w, h, d, extra) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, d), plastic(color, 0.55), 0, 0.04 + h / 2, 0));
  extra?.(g, h + 0.04);
  return { g, w: w + 0.2, d: d + 0.2, h: h + 0.04 };
}

function devBoard(c) {
  // Arduino (teal PCB, DIP chip, USB-B) or ESP (black PCB, shielded module, micro-USB)
  const g = new THREE.Group();
  const esp = /esp|nodemcu|wemos|lolin|wroom/i.test(`${c.marking || ""} ${c.evidence || ""}`);
  const w = esp ? 1.25 : 2.1, d = esp ? 2.6 : 1.6, h = 0.06, y0 = 0.32;
  g.add(mesh(new THREE.BoxGeometry(w, h, d), plastic(esp ? 0x1b1c1f : 0x0f6f7c, 0.6), 0, y0, 0));
  const pinRows = esp ? [[-w / 2 + 0.08, "z"], [w / 2 - 0.08, "z"]] : [[-d / 2 + 0.08, "x"], [d / 2 - 0.08, "x"]];
  for (const [off, axis] of pinRows) {                                  // header pins down into the board
    const n = esp ? 19 : 14, span = (axis === "z" ? d : w) - 0.3;
    for (let i = 0; i < n; i++) {
      const t = -span / 2 + (i * span) / (n - 1);
      const [x, z] = axis === "z" ? [off, t] : [t, off];
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), plastic(0x161616, 0.7), x, y0 - 0.09, z));
      g.add(mesh(new THREE.BoxGeometry(0.025, 0.3, 0.025), metal(0xd4b048, 0.3), x, y0 - 0.15, z));
    }
  }
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) lead(g, x, 0, y0 - 0.03, 0, 0.03);
  if (esp) {
    g.add(mesh(new THREE.BoxGeometry(w * 0.72, 0.1, d * 0.38), metal(0xc3c6ca, 0.32), 0, y0 + 0.08, -d * 0.22));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 0.22),
      new THREE.MeshStandardMaterial({ map: textTexture(c.marking?.split(/[-\s]/)[0] || "ESP32", w * 0.6, 0.22, { bg: "#c3c6ca", fg: "#2a2a2a" }), roughness: 0.5 }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(0, y0 + 0.131, -d * 0.22);
    g.add(lab);
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), metal(0xb0b3b8, 0.3), 0, y0 + 0.08, d / 2 - 0.08));
  } else {
    g.add(mesh(new THREE.BoxGeometry(1.0, 0.1, 0.3), plastic(0x1c1c1e, 0.7), 0.2, y0 + 0.08, 0.1));
    g.add(mesh(new THREE.BoxGeometry(0.45, 0.4, 0.5), metal(0xc3c6ca, 0.3), -w / 2 + 0.25, y0 + 0.23, -0.35));
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 24), plastic(0x111111, 0.4), -w / 2 + 0.3, y0 + 0.23, 0.45));
  }
  return { g, w: w + 0.15, d: d + 0.15, h: y0 + 0.2 };
}

// ---- robot and device parts
function gearMotor() {
  // TT gear motor: yellow gearbox, silver motor can, a wheel on the side
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.42, 0.45), plastic(0xf2c230, 0.5), 0, 0.25, 0));
  const can = new THREE.CylinderGeometry(0.2, 0.2, 0.55, 28); can.rotateZ(Math.PI / 2);
  g.add(mesh(can, metal(0xc9ccd0, 0.35), -0.8, 0.25, 0));
  const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.22, 36); wheel.rotateX(Math.PI / 2);
  g.add(mesh(wheel, plastic(0x1b1b1b, 0.85), 0.25, 0.52, 0.36));
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.24, 24); hub.rotateX(Math.PI / 2);
  g.add(mesh(hub, plastic(0xf2c230, 0.5), 0.25, 0.52, 0.37));
  for (const z of [-0.08, 0.08]) lead(g, -1.07, z, 0.25, 0.02, 0.02);
  return { g, w: 1.7, d: 0.95, h: 1.0 };
}
function servoPart() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.85, 0.75, 0.42), plastic(0x2456b8, 0.55), 0, 0.42, 0));
  g.add(mesh(new THREE.BoxGeometry(1.15, 0.06, 0.42), plastic(0x2456b8, 0.55), 0, 0.62, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 20), plastic(0xeeeeee, 0.5), 0.22, 0.88, 0));
  g.add(mesh(new THREE.BoxGeometry(0.55, 0.05, 0.12), plastic(0xeeeeee, 0.5), 0.35, 0.97, 0));
  return { g, w: 1.3, d: 0.6, h: 1.0 };
}
function batteryHolder(c) {
  const g = new THREE.Group();
  const two = /18650|li-?ion/i.test(`${c.marking || ""} ${c.evidence || ""}`);
  const n = two ? 2 : 1, r = two ? 0.24 : 0.3;
  g.add(mesh(new THREE.BoxGeometry(1.9, 0.28, n * 0.58 + 0.12), plastic(0x1b1b1b, 0.7), 0, 0.14, 0));
  for (let i = 0; i < n; i++) {
    const cell = new THREE.CylinderGeometry(r, r, 1.6, 30); cell.rotateZ(Math.PI / 2);
    g.add(mesh(cell, plastic(two ? 0x2a6fd6 : 0x8a6d1a, 0.35), 0, 0.42, (i - (n - 1) / 2) * 0.58));
  }
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), plastic(0xd1342f, 0.5), 0.9, 0.34, -0.1));
  return { g, w: 2.0, d: n * 0.58 + 0.25, h: 0.7 };
}
function ultrasonic() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.06, 0.75), plastic(0x1f5a8a, 0.6), 0, 0.35, 0));
  for (const x of [-0.45, 0.45]) {
    const t = new THREE.CylinderGeometry(0.28, 0.28, 0.42, 30);
    g.add(mesh(t, metal(0xc8ccd2, 0.3), x, 0.6, 0.02));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24), plastic(0x2a2a2a, 0.9), x, 0.82, 0.02));
  }
  for (const x of [-0.15, -0.05, 0.05, 0.15]) lead(g, x, -0.3, 0.33, 0, 0.025);
  return { g, w: 1.75, d: 0.95, h: 0.85 };
}
function driverModule(c) {
  // L298N-style module: red board, black heatsink with fins, blue screw terminals
  const g = new THREE.Group();
  const wdt = 1.6, dep = 1.6;
  g.add(mesh(new THREE.BoxGeometry(wdt, 0.06, dep), plastic(0xb3261e, 0.55), 0, 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.25), plastic(0x161616, 0.6), 0, 0.6, -0.45));
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.04, 0.5, 0.18), plastic(0x161616, 0.6), -0.4 + i * 0.16, 0.6, -0.27));
  for (const [x, z] of [[-0.6, 0.55], [0.6, 0.55], [-0.6, -0.1], [0.6, -0.1], [0, 0.6]]) g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.24), plastic(0x2456b8, 0.5), x, 0.44, z));
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), new THREE.MeshStandardMaterial({ map: textTexture(c.marking || "DRIVER", 0.7, 0.2, { bg: "#b3261e", fg: "#ffffff" }), roughness: 0.6 }));
  lab.rotation.x = -Math.PI / 2; lab.position.set(0, 0.335, 0.2); g.add(lab);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) lead(g, x, z, 0.3, 0, 0.04);
  return { g, w: wdt + 0.15, d: dep + 0.15, h: 0.85 };
}

const TYPE_COLOR = { relay: 0x2c4f9e, display: 0x2a2a2a, sensor_module: 0x1f5a8a, motor: 0xb8bcc2, battery: 0x2a2a2a, other: 0x6b6b6b };

function build(c, bench) {
  const t = c.type;
  if (t === "ic" && /L298|L293|L9110|TB6612|DRV88|A4988|MX1508|BTS7960|ULN200|HG7881/i.test(c.marking || "")) return driverModule(c);
  if (t === "ic") return ic(c);
  if (t === "dev_board") return devBoard(c);
  if (t === "motor") return gearMotor();
  if (t === "servo") return servoPart();
  if (t === "stepper") return boxy(0x2a2a2a, 0.9, 0.8, 0.9, (g, y) => g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16), metal(), 0, y + 0.15, 0)));
  if (t === "battery") return batteryHolder(c);
  if (t === "sensor_module" && /SR0\d/i.test(c.marking || "")) return ultrasonic();
  if (t === "resistor") return axial(c, { bands: c.bands || [] });
  if (t === "diode") return axial(c, { body: 0x1b1b1b, r: 0.08, len: 0.3, bands: ["silver", "black", "black", "black"].slice(0, 1) });
  if (t === "inductor") return axial(c, { body: 0x5a7d4a, r: 0.14, len: 0.45, bands: c.bands || [] });
  if (t === "capacitor_electrolytic") return electrolytic(c);
  if (t === "capacitor_ceramic") return ceramic();
  if (t === "capacitor_film") return film();
  if (t === "led") return led(c, bench);
  if (t === "transistor") return to92();
  if (t === "mosfet" || t === "voltage_regulator") return to220();
  if (t === "potentiometer") return boxy(0x2456b8, 0.5, 0.4, 0.5, (g, y) => {
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 24), plastic(0xeeeeee, 0.5), 0, y + 0.04, 0));
  });
  if (t === "crystal") {
    const { g, w, d, h } = boxy(0xd0d3d8, 0.46, 0.34, 0.18);
    g.children[0].material = metal(0xd0d3d8, 0.25);
    return { g, w, d, h };
  }
  if (t === "connector") return boxy(0xe8e3d4, 0.3, 0.32, 0.9, (g, y) => {
    for (const z of [-0.3, 0, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05), metal(0xd4b048, 0.3), 0, y + 0.1, z));
  });
  if (t === "switch" || t === "button") return boxy(0x1c1c1e, 0.5, 0.18, 0.5, (g, y) => {
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 24), plastic(0xe5451b, 0.5), 0, y + 0.07, 0));
  });
  if (t === "buzzer") {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 40), plastic(0x1c1c1e, 0.6), 0, 0.2, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 20), plastic(0x050505, 1), 0, 0.375, 0));
    return { g, w: 1, d: 1, h: 0.37 };
  }
  if (t === "ldr") {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 28), plastic(0xd9a441, 0.4), 0, 0.3, 0));
    lead(g, -0.07, 0, 0.27, 0); lead(g, 0.07, 0, 0.27, 0);
    return { g, w: 0.45, d: 0.45, h: 0.33 };
  }
  return boxy(TYPE_COLOR[t] ?? TYPE_COLOR.other, 0.8, 0.4, 0.6);
}

// ------------------------------------------------------------------ placement

function overlaps(p, list) {
  return list.some(q => Math.abs(p.x - q.x) < (p.w + q.w) / 2 + 0.12 && Math.abs(p.z - q.z) < (p.d + q.d) / 2 + 0.12);
}
function clampToBoard(p) {
  p.x = Math.max(-W / 2 + p.w / 2 + 0.35, Math.min(W / 2 - p.w / 2 - 0.35, p.x));
  p.z = Math.max(-D / 2 + p.d / 2 + 0.35, Math.min(D / 2 - p.d / 2 - 0.35, p.z));
  return p;
}
function place(items) {
  const done = [];
  for (const it of items) {
    let p = null;
    if (Array.isArray(it.c.box) && it.c.box.length === 4) {
      const [y0, x0, y1, x1] = it.c.box;
      p = clampToBoard({ x: ((x0 + x1) / 2000 - 0.5) * W * 0.96, z: ((y0 + y1) / 2000 - 0.5) * D * 0.96, w: it.w, d: it.d });
      if (overlaps(p, done)) p = null;
    }
    if (!p) {
      outer: for (let z = -D / 2 + 0.9; z < D / 2 - 0.5; z += 0.45) {
        for (let x = -W / 2 + 0.9; x < W / 2 - 0.5; x += 0.45) {
          const q = clampToBoard({ x, z, w: it.w, d: it.d });
          if (!overlaps(q, done)) { p = q; break outer; }
        }
      }
    }
    p ||= { x: 0, z: 0, w: it.w, d: it.d };
    done.push(p);
    it.pos = p;
  }
}

// ------------------------------------------------------------------ board

function boardTexture(items = []) {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = Math.round(2048 * D / W);
  const x = c.getContext("2d");
  const px = v => (v / W + 0.5) * c.width, pz = v => (v / D + 0.5) * c.height, s = c.width / W;
  x.fillStyle = "#1f4a33"; x.fillRect(0, 0, c.width, c.height);
  const img = x.getImageData(0, 0, c.width, c.height);            // a little mask texture
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const pitch = 0.254 * s;                                          // perfboard pads on a 0.1" grid
  for (let gy = pitch * 1.5; gy < c.height - pitch; gy += pitch) {
    for (let gx = pitch * 1.5; gx < c.width - pitch; gx += pitch) {
      x.fillStyle = "#9c7a3c"; x.beginPath(); x.arc(gx, gy, pitch * 0.26, 0, 7); x.fill();
      x.fillStyle = "#16251c"; x.beginPath(); x.arc(gx, gy, pitch * 0.1, 0, 7); x.fill();
    }
  }
  x.strokeStyle = "rgba(240,238,230,0.85)"; x.lineWidth = 4;
  x.strokeRect(0.18 * s, 0.18 * s, c.width - 0.36 * s, c.height - 0.36 * s);
  for (const [cx, cy] of [[0.4, 0.4], [W - 0.4, 0.4], [0.4, D - 0.4], [W - 0.4, D - 0.4]]) {
    x.fillStyle = "#b08a45"; x.beginPath(); x.arc(cx * s, cy * s, 0.2 * s, 0, 7); x.fill();
    x.fillStyle = "#0e1511"; x.beginPath(); x.arc(cx * s, cy * s, 0.12 * s, 0, 7); x.fill();
  }
  x.fillStyle = "rgba(240,238,230,0.9)";
  x.font = `600 ${0.17 * s}px "JetBrains Mono", Consolas, monospace`;
  x.textBaseline = "top";
  for (const it of items) {
    const { x: ix, z, w, d } = it.pos;
    x.lineWidth = 3;
    x.strokeRect(px(ix - w / 2 + 0.06), pz(z - d / 2 + 0.06), (w - 0.12) * s, (d - 0.12) * s);
    x.fillText(it.c.id, px(ix - w / 2 + 0.08), pz(z + d / 2 - 0.02));
  }
  x.textAlign = "right"; x.textBaseline = "bottom";
  x.font = `500 ${0.15 * s}px "JetBrains Mono", Consolas, monospace`;
  x.fillText("GENESIS RECONSTRUCTION · PARTS FROM PHOTO · COPPER NOT OBSERVED", c.width - 0.35 * s, c.height - 0.3 * s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / W, 1 / D);
  t.offset.set(0.5, 0.5);
  return t;
}

function makeBoard() {
  const r = 0.28, w = W / 2, d = D / 2;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -d); s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r);
  s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d); s.lineTo(-w + r, d);
  s.quadraticCurveTo(-w, d, -w, d - r); s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d);
  const geo = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.03, 0);
  const top = new THREE.MeshPhysicalMaterial({ map: boardTexture(), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.32 });
  const side = new THREE.MeshStandardMaterial({ color: 0x8b8a55, roughness: 0.7 });
  const m = new THREE.Mesh(geo, [top, side]);
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

function frame(w, d, color, thick = 0.035) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  for (const [sx, sz, x, z] of [[w, thick, 0, -d / 2], [w, thick, 0, d / 2], [thick, d, -w / 2, 0], [thick, d, w / 2, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.012, sz), mat);
    b.position.set(x, 0.008, z);
    g.add(b);
  }
  return g;
}

// ------------------------------------------------------------------ bench

export function createBench() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(5.2, 8.2, 10.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.3, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 5; controls.maxDistance = 22;
  controls.maxPolarAngle = 1.32;
  controls.autoRotateSpeed = 0.55;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a0, 0.55));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.3);
  key.position.set(4, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  key.shadow.bias = -0.0004; key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.6);
  rim.position.set(-6, 4, -6);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.receiveShadow = true;
  scene.add(ground);

  const rig = new THREE.Group();              // board + parts, so the intro can move them together
  scene.add(rig);
  const board = makeBoard();
  rig.add(board);
  const parts = new THREE.Group();
  parts.position.y = TOP;
  rig.add(parts);

  const tagsEl = document.createElement("div");
  tagsEl.className = "tags is-quiet";

  const bench = {
    renderer, scene, camera, controls, leds: [], items: [], selected: null, container: null,
    signal: t => ((t * 0.686) % 1 < 0.524 ? 1 : 0),   // replaced by the measured trace once there is one
    driven: null,                                       // id of the LED the video says is changing
    onSelect: () => {}, onHover: () => {},
  };

  // ---- scanning bar (observer is looking)
  const scan = new THREE.Group();
  scan.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, D + 0.3), new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.9 })));
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.9, D + 0.3), new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.1, depthWrite: false }));
  sheet.rotation.x = -Math.PI / 2; sheet.position.set(-0.45, -0.33, 0);
  scan.add(sheet);
  scan.position.set(-W / 2, TOP + 0.35, 0);
  scan.visible = false;
  rig.add(scan);
  let scanTween = null;
  bench.setScanning = on => {
    if (on === scan.visible) return;
    scan.visible = on;
    scanTween?.kill();
    if (on) {
      scan.position.x = -W / 2;
      scanTween = gsap.to(scan.position, { x: W / 2, duration: 1.7, ease: "sine.inOut", repeat: -1, yoyo: true });
    }
  };

  // ---- components
  let lastKey = "";
  bench.setComponents = (comps = [], { animate = true, changing = null } = {}) => {
    bench.driven = changing;
    const keyOf = comps.map(c => `${c.id}:${c.type}:${c.display || ""}:${(c.bands || []).join(",")}:${c.marking || ""}`).join("|");
    if (keyOf === lastKey) { applyStatus(comps); return; }
    lastKey = keyOf;
    for (const it of bench.items) { it.tag.remove(); }
    parts.clear();
    bench.leds = [];
    const items = comps.map(c => ({ c, ...build(c, bench) }));
    place(items);
    for (const it of items) {
      it.g.position.set(it.pos.x, 0, it.pos.z);
      it.g.userData.id = it.c.id;
      it.g.traverse(o => { o.userData.id = it.c.id; });
      it.status = frame(it.pos.w + 0.08, it.pos.d + 0.08, INK);
      it.status.visible = false;
      it.g.add(it.status);
      parts.add(it.g);
      const tag = document.createElement("div");
      tag.className = "tag3d";
      const sub = it.c.display || it.c.marking || it.c.type.replace(/_/g, " ");
      tag.innerHTML = `<b>${it.c.id}<small>${escapeHtml(sub)}</small></b>`;
      tag.addEventListener("click", () => bench.select(it.c.id, true));
      tag.addEventListener("mouseenter", () => bench.onHover(it.c.id));
      tag.addEventListener("mouseleave", () => bench.onHover(null));
      tagsEl.appendChild(tag);
      it.tag = tag;
    }
    bench.items = items;
    board.material[0].map.dispose();
    board.material[0].map = boardTexture(items);
    board.material[0].needsUpdate = true;
    applyStatus(comps);
    if (animate) {
      items.forEach((it, i) => {
        gsap.from(it.g.position, { y: 2.6, duration: 0.95, ease: "power3.out", delay: 0.1 + i * 0.09 });
        gsap.from(it.g.rotation, { y: (i % 2 ? 1 : -1) * 0.6, duration: 1.1, ease: "power3.out", delay: 0.1 + i * 0.09 });
        gsap.fromTo(it.tag, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.6 + i * 0.09 });
      });
    }
  };
  function applyStatus(comps) {
    const by = Object.fromEntries(comps.map(c => [c.id, c]));
    for (const it of bench.items) {
      const st = by[it.c.id]?.status;
      it.tag.classList.toggle("is-inferred", st === "INFERRED");
      it.tag.classList.toggle("is-contradicted", st === "CONTRADICTED");
      const sel = bench.selected === it.c.id;
      const col = st === "CONTRADICTED" ? SIGNAL : st === "INFERRED" ? AMBER : INK;
      it.status.visible = sel || st === "INFERRED" || st === "CONTRADICTED";
      it.status.children.forEach(b => b.material.color.setHex(col));
      it.tag.classList.toggle("is-selected", sel);
    }
  }
  bench.refreshStatus = comps => applyStatus(comps);
  let lastComps = [];
  const origSet = bench.setComponents;
  bench.setComponents = (comps, opts) => { lastComps = comps || []; origSet(comps, opts); };

  bench.select = (id, fromBench = false) => {
    bench.selected = bench.selected === id && fromBench ? null : id;
    applyStatus(lastComps);
    const it = bench.items.find(i => i.c.id === bench.selected);
    const to = it ? new THREE.Vector3(it.pos.x, TOP + 0.2, it.pos.z) : new THREE.Vector3(0, 0.3, 0);
    gsap.to(controls.target, { x: to.x, y: to.y, z: to.z, duration: 0.9, ease: "power3.inOut" });
    if (fromBench) bench.onSelect(bench.selected);
  };

  // ---- picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null, hovered = null;
  const pick = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(parts.children, true)[0];
    return hit?.object.userData.id ?? null;
  };
  renderer.domElement.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
      const id = pick(e);
      if (id || bench.selected) bench.select(id ?? bench.selected, true);
    }
    downAt = null;
  });
  renderer.domElement.addEventListener("pointermove", e => {
    const id = pick(e);
    if (id !== hovered) {
      hovered = id;
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
      bench.onHover(id);
    }
  });

  // ---- mounting & sizing
  const ro = new ResizeObserver(() => resize());
  function resize() {
    const el = bench.container;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 42 : 30;
    camera.updateProjectionMatrix();
  }
  bench.prefs = { labels: true, rotate: true };
  let heroMode = false;
  bench.mount = (el, { hero = false } = {}) => {
    if (bench.container) ro.unobserve(bench.container);
    bench.container = el;
    heroMode = hero;
    el.prepend(renderer.domElement);
    el.appendChild(tagsEl);
    ro.observe(el);
    resize();
    controls.autoRotate = hero && bench.prefs.rotate;
    tagsEl.classList.toggle("is-quiet", hero);
    tagsEl.style.display = bench.prefs.labels ? "" : "none";
  };
  bench.setPrefs = p => {
    Object.assign(bench.prefs, p);
    controls.autoRotate = heroMode && bench.prefs.rotate;
    tagsEl.style.display = bench.prefs.labels ? "" : "none";
  };
  bench.intro = () => {
    gsap.from(rig.rotation, { y: -0.9, duration: 2.2, ease: "power3.out" });
    gsap.from(rig.position, { y: -1.2, duration: 1.8, ease: "power3.out" });
    gsap.from(camera.position, { x: 9, y: 12, z: 14, duration: 2.4, ease: "power2.out" });
  };

  // ---- pointer parallax in hero mode
  const tilt = { x: 0, y: 0 };
  window.addEventListener("pointermove", e => {
    tilt.x = (e.clientX / window.innerWidth - 0.5) * 0.12;
    tilt.y = (e.clientY / window.innerHeight - 0.5) * 0.06;
  });

  const v = new THREE.Vector3();
  let last = performance.now(), slow = 0, dpr = renderer.getPixelRatio();
  function frameLoop() {
    requestAnimationFrame(frameLoop);
    const el = bench.container;
    if (!el || !el.offsetParent) return;
    const now = performance.now(), ms = now - last;
    last = now;
    slow = ms > 40 && ms < 1000 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 30 && dpr > 0.75) {                       // weak GPU: trade sharpness for frame rate
      dpr = Math.max(0.75, dpr - 0.5);
      renderer.setPixelRatio(dpr);
      resize();
      slow = 0;
    }
    controls.update();
    if (controls.autoRotate) {
      rig.rotation.x += (tilt.y - rig.rotation.x) * 0.04;
      rig.rotation.z += (-tilt.x * 0.4 - rig.rotation.z) * 0.04;
    } else {
      rig.rotation.x *= 0.9; rig.rotation.z *= 0.9;
    }
    const level = Math.max(0, Math.min(1, bench.signal(clock.now())));
    for (const l of bench.leds) {
      const on = !bench.driven || bench.driven === l.id ? level : 0.6;
      l.lens.emissiveIntensity = 0.15 + on * 2.6;
      l.light.intensity = on * 5;
    }
    const w = el.clientWidth, h = el.clientHeight;
    for (const it of bench.items) {
      it.g.getWorldPosition(v);
      v.y += it.h + 0.12;
      v.project(camera);
      const behind = v.z > 1;
      it.tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      it.tag.style.visibility = behind ? "hidden" : "visible";
    }
    renderer.render(scene, camera);
  }
  frameLoop();
  return bench;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
