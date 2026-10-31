// Static build for GitHub Pages (npm run build:static): there is no Python server, so this module
// answers the API in the browser. The three sample investigations were recorded from the real bench
// (scripts/record_demo.py) and are replayed event by event; the Lab calculators are ported from calc.py.
// Live investigations of your own photos need the local bench (see README).

export const STATIC = import.meta.env.MODE === "static";
const BASE = import.meta.env.BASE_URL;
const realFetch = window.fetch.bind(window);
// The real simulation code (simulate.py and what it imports) runs in the browser on Pyodide, so what-ifs,
// "Fix this" and supply changes are computed live, not replayed.
const PY_SOURCES = import.meta.glob(["../../genesis_see/__init__.py", "../../genesis_see/core.py", "../../genesis_see/simulate.py",
  "../../genesis_see/system.py", "../../genesis_see/diagrams.py", "../../genesis_see/sketches.py"], { query: "?raw", import: "default", eager: true });
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
let py = null;
function python() {
  return (py ||= (async () => {
    window.dispatchEvent(new CustomEvent("genesis-toast", { detail: "Loading the Python simulator into your browser (first time only)…" }));
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`);
    const p = await loadPyodide({ indexURL: PYODIDE });
    await p.loadPackage("numpy");
    p.FS.mkdirTree("/genesis/genesis_see");
    for (const [path, src] of Object.entries(PY_SOURCES)) p.FS.writeFile(`/genesis/genesis_see/${path.split("/").pop()}`, src);
    p.runPython("import sys, json; sys.path.insert(0, '/genesis'); from genesis_see import simulate");
    return p;
  })().catch(e => { py = null; throw e; }));
}
async function simulateInBrowser(state, overrides, supply) {
  const p = await python().catch(() => python());     // one retry: the CDN download occasionally drops on the first try
  p.globals.set("ARGS", JSON.stringify({ state, overrides, supply }));
  return JSON.parse(p.runPython("a = json.loads(ARGS); json.dumps(simulate.simulate(a['state'], a['overrides'], a['supply']), default=str)"));
}

const LOCAL = "This online demo replays the recorded sample boards. To investigate your own device, run GENESIS on your computer (see the README on GitHub) with a free Gemini key.";

let index = null;
const runs = {};
const getIndex = async () => (index ||= await (await realFetch(`${BASE}demo/index.json`)).json());
const getRun = async id => (runs[id] ||= await (await realFetch(`${BASE}demo/${id}.json`)).json());
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

// ---------------------------------------------------------------- event replay
let current = null;   // the open replay, so a question can be answered on the same stream
class Replay {
  constructor(id) {
    this.onmessage = null; this.closed = false; this.n = 0;
    current = this;
    getRun(id).then(run => this.play(run.events));
  }
  emit(e) {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify({ ...e, id: this.n++, ts: Date.now() / 1000 }) });
  }
  async play(events) {
    // the scripted run takes under a second; space it out so each step can be seen
    const wait = { call: 450, result: 650, say: 500, state: 120 };
    for (const e of events) {
      if (this.closed) return;
      await new Promise(r => setTimeout(r, wait[e.type] || 60));
      this.emit(e);
    }
  }
  close() { this.closed = true; if (current === this) current = null; }
}
export const openEvents = id => new Replay(id);

// ---------------------------------------------------------------- calculators (port of calc.py and core.py)
const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const SI = { k: 1e3, K: 1e3, M: 1e6 };
const DIGIT = { black: 0, brown: 1, red: 2, orange: 3, yellow: 4, green: 5, blue: 6, violet: 7, grey: 8, gray: 8, white: 9 };
const MULT = { ...Object.fromEntries(Object.entries(DIGIT).map(([k, v]) => [k, 10 ** v])), gold: 0.1, silver: 0.01 };
const TOL = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gray: 0.05, gold: 5, silver: 10 };
const LED_VF = { red: 1.9, orange: 2.0, yellow: 2.0, green: 2.1, blue: 3.0, white: 3.0 };
const g4 = x => String(+x.toPrecision(4));
const round = (x, n) => +x.toFixed(n);
const fmtOhms = v => (v >= 1e6 ? `${g4(v / 1e6)} MΩ` : v >= 1e3 ? `${g4(v / 1e3)} kΩ` : `${g4(v)} Ω`);
const fmtFarads = v => (v >= 1e-6 ? `${g4(v / 1e-6)} µF` : v >= 1e-9 ? `${g4(v / 1e-9)} nF` : `${g4(v / 1e-12)} pF`);
const fail = m => { throw new Error(m); };

function parseR(text) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, "").replace(/ohms?|Ω|ω/gi, "");
  let m = s.match(/^(\d+)([RrkKM])(\d+)$/);
  if (m) return parseFloat(`${m[1]}.${m[3]}`) * (/[Rr]/.test(m[2]) ? 1 : SI[m[2]]);
  m = s.match(/^(\d+(?:\.\d+)?)([kKM]?)[Rr]?$/);
  if (!m) return null;
  const d = m[1];
  if (!m[2] && /^\d{3,4}$/.test(d) && !/[Rr]$/.test(s)) {
    const base = +d.slice(0, -1), exp = +d.slice(-1);
    if (d.length === 3 && exp <= 6 && d[2] !== "0") return base * 10 ** exp;
    if (d.length === 4 && exp > 0 && exp <= 6) return base * 10 ** exp;
  }
  return parseFloat(d) * (m[2] ? SI[m[2]] : 1);
}
const capPrefix = p => (!p ? 1 : p === "M" ? 1e-6 : { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3 }[p.toLowerCase()] ?? null);
function parseC(text) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, "");
  let m = s.match(/(\d+(?:\.\d+)?)([pnuµμmM]?)F/i);
  if (m && capPrefix(m[2]) != null) return parseFloat(m[1]) * capPrefix(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)([pnuµμ])$/i);
  if (m) return parseFloat(m[1]) * capPrefix(m[2]);
  m = s.match(/^(\d)([pnuµμ])(\d)$/i);
  if (m) return parseFloat(`${m[1]}.${m[3]}`) * capPrefix(m[2]);
  m = s.match(/^(\d{3})[JKMjkm]?$/);
  if (m) return +m[1].slice(0, 2) * 10 ** +m[1][2] * 1e-12;
  return null;
}
function nearest(v, series) {
  if (!v || v <= 0) return null;
  const dec = 10 ** Math.floor(Math.log10(v));
  let best = null;
  for (const d of [dec / 10, dec, dec * 10]) for (const s of series) { const c = s * d, err = Math.abs(c - v) / v; if (!best || err < best[1]) best = [c, err]; }
  return { value: +best[0].toPrecision(6), rel_err: round(best[1], 4) };
}
function e12AtLeast(ohms) {
  for (let dec = 0; dec < 7; dec++) for (const v of E12) if (v * 10 ** dec >= ohms) return +(v * 10 ** dec).toPrecision(6);
  return 10e6;
}
function bandsOnce(b) {
  let digits, mult, tol = 20;
  if (b.length === 3) [digits, mult] = [b.slice(0, 2), b[2]];
  else if (b.length === 4) [digits, mult, tol] = [b.slice(0, 2), b[2], TOL[b[3]]];
  else if (b.length === 5 || b.length === 6) [digits, mult, tol] = [b.slice(0, 3), b[3], TOL[b[4]]];
  else return null;
  if (digits.some(d => !(d in DIGIT)) || !(mult in MULT) || tol == null) return null;
  const base = digits.reduce((a, d) => a * 10 + DIGIT[d], 0);
  return { ohms: +(base * MULT[mult]).toPrecision(6), tolerance_pct: tol };
}
function decodeBands(bands) {
  if (!bands || bands.length < 3) return null;
  const b = bands.map(c => String(c).toLowerCase().trim());
  const tries = [[bandsOnce(b), false], [bandsOnce([...b].reverse()), true]].filter(t => t[0]);
  if (!tries.length) return null;
  const score = ([r, rev]) => (["gold", "silver"].includes(rev ? b[0] : b[b.length - 1]) ? 2 : 0) + (nearest(r.ohms, E24).rel_err < 0.001 ? 1 : 0);
  tries.sort((x, y) => score(y) - score(x));
  const [best, other] = tries;
  return { value: best[0].ohms, tolerance_pct: best[0].tolerance_pct, reversed: best[1],
    ambiguous: !!other && score(best) === score(other) && best[0].ohms !== other[0].ohms, alternative: other ? other[0].ohms : null };
}
const num = (x, name) => { const v = parseFloat(String(x).trim().replace(",", ".")); if (!isFinite(v)) fail(`${name} must be a number`); return v; };
const ohms = (x, name) => parseR(x) || fail(`${name}: can't read '${x}' as a resistance (try 470, 4k7, 1M)`);
const farads = (x, name) => parseC(x) || fail(`${name}: can't read '${x}' as a capacitance (try 100uF, 104, 47n)`);
const empty = v => v == null || v === "";

const MOTORS = [[/\bTT\b|yellow.*gear|gear ?motor|dagu/i, 0.2, 1.5, "TT gear motor: ~0.2 A running, ~1.5 A stalled at 6 V"],
  [/\bN20\b|micro gear/i, 0.1, 0.6, "N20 micro gear motor: ~0.1 A running, ~0.6 A stalled"], [/\b130\b|hobby motor|toy motor/i, 0.3, 2.0, "130-size motor: ~0.3 A running, ~2 A stalled"],
  [/brushless|bldc|esc/i, 2.0, 10.0, "brushless motor: several amps; check its ESC rating"], [/fan/i, 0.15, 0.3, "small fan: ~0.15 A"], [/(?:)/, 0.3, 1.5, "unknown DC motor: assumed ~0.3 A running, ~1.5 A stalled"]];
const SERVOS = [[/SG90|9 ?g|micro servo|MG90/i, 0.15, 0.7, "SG90 micro servo: ~0.15 A moving, ~0.7 A stalled"],
  [/MG99[56]|MG995|DS3218|standard servo/i, 0.5, 2.5, "MG996R servo: ~0.5 A moving, ~2.5 A stalled"], [/(?:)/, 0.25, 1.0, "servo: assumed ~0.25 A moving, ~1 A stalled"]];
const STEPPERS = [[/28BYJ/i, 0.25, 0.3, "28BYJ-48 stepper: ~0.25 A"], [/NEMA|17HS|42/i, 1.2, 1.7, "NEMA 17 stepper: ~1.2–1.7 A per phase"], [/(?:)/, 0.5, 0.8, "stepper: assumed ~0.5 A"]];
const DRIVERS = [[/L298/i, 2.0, 3.0, 2.0, "L298N"], [/L293/i, 0.6, 1.2, 1.4, "L293D"], [/TB6612/i, 1.2, 3.2, 0.5, "TB6612FNG"], [/DRV8833/i, 1.5, 2.0, 0.4, "DRV8833"],
  [/DRV8825/i, 1.5, 2.2, 0.3, "DRV8825"], [/A4988/i, 1.0, 2.0, 0.4, "A4988"], [/L9110|HG7881/i, 0.8, 1.5, 0.8, "L9110S"], [/MX1508/i, 1.5, 2.5, 0.4, "MX1508"],
  [/ULN200/i, 0.5, 0.5, 1.0, "ULN2003"], [/BTS7960|IBT/i, 43.0, 43.0, 0.1, "BTS7960"]];
const BATTERIES = [[/(2|two) ?x? ?18650|2s|7\.4 ?v/i, 7.4, 2500, 5.0, "2 × 18650 Li-ion (7.4 V)"], [/(3|three) ?x? ?18650|3s|11\.1 ?v/i, 11.1, 2500, 5.0, "3 × 18650 Li-ion (11.1 V)"],
  [/18650|li-?ion cell|3\.7 ?v/i, 3.7, 2500, 5.0, "18650 Li-ion cell (3.7 V)"], [/lipo/i, 7.4, 1000, 20.0, "2S LiPo (7.4 V)"], [/(4|four) ?x? ?aa\b|6 ?v/i, 6.0, 2000, 1.0, "4 × AA alkaline (6 V)"],
  [/(6|six) ?x? ?aa\b|9 ?v pack/i, 9.0, 2000, 1.0, "6 × AA alkaline (9 V)"], [/pp3|9 ?v/i, 9.0, 500, 0.3, "9 V PP3 battery"], [/usb|5 ?v/i, 5.0, 0, 1.0, "USB 5 V (≈1 A from a charger, 0.5 A from a computer port)"]];

const TOOLS = {
  bands: b => { const d = decodeBands(b.bands || []); return d ? { ...d, display: fmtOhms(d.value) } : { error: "not a valid colour code" }; },
  555: b => { const ra = +b.ra, rb = +b.rb, c = +b.c, f = 1.44 / ((ra + 2 * rb) * c); return { frequency_hz: f, period_s: 1 / f, high_fraction: (ra + rb) / (ra + 2 * rb), nearest_c: nearest(c, E6) }; },
  parse: b => { const r = b.kind !== "capacitor", v = r ? parseR(b.text) : parseC(b.text); return { value: v, display: v ? (r ? fmtOhms(v) : fmtFarads(v)) : null }; },
  led: ({ supply_v, led = "red", current_ma = 12 }) => {
    const vs = num(supply_v, "supply"), i = num(current_ma, "current") / 1000, vf = LED_VF[String(led).toLowerCase()] || num(led, "LED forward voltage");
    if (vs <= vf) fail(`A ${vs} V supply can't light an LED that needs ${vf} V`);
    const r = (vs - vf) / i, r12 = e12AtLeast(r), ir = (vs - vf) / r12, p = ir ** 2 * r12;
    return { resistor: fmtOhms(r12), exact: fmtOhms(r), current_ma: round(ir * 1000, 1), power_mw: round(p * 1000, 1), rating: p < 0.06 ? "1/8 W" : p < 0.12 ? "1/4 W" : p < 0.25 ? "1/2 W" : "1 W",
      formula: "R = (V_supply − V_LED) / I", notes: [`LED forward voltage ${vf} V`, "rounded up to the next standard value, so the LED stays under the target current"] };
  },
  divider: ({ vin, r1, r2 = "10k", vout }) => {
    const vi = num(vin, "input voltage"), b = ohms(r2, "R2 (to ground)");
    let a;
    if (!empty(vout)) { const t = num(vout, "target output"); if (!(t > 0 && t < vi)) fail("the output must be between 0 V and the input"); a = e12AtLeast(b * (vi / t - 1)); }
    else a = ohms(r1, "R1 (top)");
    return { r1: fmtOhms(a), r2: fmtOhms(b), vout: round(vi * b / (a + b), 3), current_ua: round(vi / (a + b) * 1e6, 1), ratio: round(b / (a + b), 4), formula: "Vout = Vin × R2 / (R1 + R2)",
      notes: [!empty(vout) ? "R1 is rounded up, so the output stays at or below the target (safe for 3.3 V and 5 V pins)" : "the divider's own load: keep the input pin's resistance much higher than R2"] };
  },
  ohms: ({ v, i_ma, r }) => {
    const x = { v: empty(v) ? null : num(v, "voltage"), i: empty(i_ma) ? null : num(i_ma, "current") / 1000, r: empty(r) ? null : ohms(r, "resistance") };
    if (Object.values(x).filter(q => q != null).length < 2) fail("give any two of voltage, current and resistance");
    if (x.v == null) x.v = x.i * x.r; else if (x.i == null) x.i = x.v / x.r; else if (x.r == null) x.r = x.v / x.i;
    const p = x.v * x.i;
    return { voltage_v: round(x.v, 4), current_ma: round(x.i * 1000, 3), resistance: fmtOhms(x.r), power_mw: round(p * 1000, 2), formula: "V = I × R, P = V × I",
      notes: p > 0.25 ? ["above 250 mW a standard 1/4 W resistor runs hot"] : [] };
  },
  rc: ({ r, c }) => { const t = ohms(r, "R") * farads(c, "C"); return { tau_s: t, t63_s: t, t95_s: 3 * t, t99_s: 5 * t, cutoff_hz: 1 / (2 * Math.PI * t), formula: "τ = R × C, f_c = 1 / (2π R C)",
    notes: ["a capacitor charges to 63 % in one τ and is practically full after 5 τ"] }; },
  mono555: ({ r, c }) => ({ pulse_s: 1.1 * ohms(r, "R") * farads(c, "C"), formula: "t = 1.1 × R × C", notes: ["one pulse per trigger on pin 2; R from VCC to pins 6 and 7, C from pins 6/7 to ground"] }),
  battery: ({ capacity_mah, current_ma, usable_pct = 80 }) => {
    const cap = num(capacity_mah, "capacity"), i = num(current_ma, "current");
    if (i <= 0) fail("current must be above zero");
    const h = cap * num(usable_pct, "usable %") / 100 / i;
    return { hours: round(h, 2), days: round(h / 24, 2), formula: "t = capacity × usable fraction / current", notes: [`assumes ${usable_pct}% of the capacity is usable before the voltage drops too far`] };
  },
  motors: ({ battery = "2x18650", driver = "L298N", motor = "TT", count = 2 }) => {
    const n = Math.trunc(num(count, "motor count"));
    const bat = BATTERIES.find(b => b[0].test(battery)) || fail("battery: try 2x18650, 4xAA, 9V, LiPo or USB");
    const row = (/servo|SG90|MG99/i.test(motor) ? SERVOS : /stepper|NEMA|28BYJ/i.test(motor) ? STEPPERS : MOTORS).find(r => r[0].test(motor));
    const drv = DRIVERS.find(d => d[0].test(driver));
    const run = row[1] * n, stall = row[2] * n, vm = bat[1] - (drv ? drv[3] : 0), notes = [];
    const out = { battery: bat[4], motor: row[3], running_a: round(run, 2), startup_a: round(stall, 2), battery_max_a: bat[3], motor_volts: round(vm, 2) };
    let verdict = "OK";
    if (stall > bat[3]) { verdict = "battery too weak"; notes.push(`start-up needs ~${stall.toFixed(1)} A; a ${bat[4]} gives ~${bat[3]} A`); }
    if (drv) {
      out.driver = drv[4];
      if (row[2] > drv[2]) { verdict = "driver too small"; notes.push(`each ${drv[4]} channel peaks at ${drv[2]} A; one stalled motor pulls ~${row[2]} A`); }
      if (drv[3] >= 1) notes.push(`the ${drv[4]} drops ~${drv[3]} V: motors see ~${vm.toFixed(1)} V`);
    }
    if (bat[2]) out.runtime_h = round(bat[2] / 1000 * 0.8 / Math.max(run, 0.01), 1);
    return { ...out, verdict, notes: notes.length ? notes : ["battery and driver can carry these motors"], formula: "start-up current ≈ motors × stall current; V_motor = V_battery − driver drop" };
  },
};

// ---------------------------------------------------------------- the API, answered here
async function api(method, path, body) {
  const ix = await getIndex();
  let m;
  if (path === "/api/info") return json({ ...ix.info, gemini_key: false, lan_url: null, static: true });
  if (path === "/api/control") return json(ix.control);
  if (path === "/api/usage") return json(ix.usage);
  if (path === "/api/investigations" && method === "GET") return json(ix.investigations);
  if ((m = path.match(/^\/api\/lab\/(\w+)$/))) {
    const f = TOOLS[m[1]];
    if (!f) return json({ error: "unknown tool" }, 404);
    try { return json(f(Object.fromEntries(Object.entries(body || {}).filter(([, v]) => !empty(v))))); }
    catch (e) { return json({ error: e.message }, 400); }
  }
  if ((m = path.match(/^\/api\/investigations\/(\w+)(?:\/(\w+))?/))) {
    const [, id, what] = m;
    if (method === "DELETE") return json({ error: "The sample runs can't be deleted in the online demo." }, 409);
    if (what === "evidence") return json((await getRun(id)).evidence);
    if (what === "ask") {
      const r = current;
      setTimeout(() => { r?.emit({ type: "busy", busy: true }); setTimeout(() => { r?.emit({ type: "say", text: LOCAL }); r?.emit({ type: "busy", busy: false }); }, 700); }, 50);
      return json({ ok: true });
    }
    if (what === "simulate") {
      const st = [...(await getRun(id)).events].reverse().find(e => e.type === "state")?.state;
      if (!Object.keys(body?.overrides || {}).length && body?.supply == null) return json(st?.simulation || { available: false });
      if (body.supply != null && !(body.supply >= 0.5 && body.supply <= 60)) return json({ error: "supply must be between 0.5 and 60 V" }, 400);
      try { return json(await simulateInBrowser(st, body.overrides || {}, body.supply ?? null)); }
      catch (e) { console.warn(e); return json({ error: "The in-browser simulator couldn't load (it needs an internet connection to cdn.jsdelivr.net)." }, 503); }
    }
    if (what === "feedback" || what === "title") return json({ ok: true });
    return json({ error: LOCAL }, 409);
  }
  return json({ error: "not available in the online demo" }, 404);
}

/** postForm replacement: starting a run. Samples replay their recording; your own files need the local bench. */
export async function startRun(fd) {
  const ix = await getIndex();
  const id = fd.get("mode") === "demo" && ix.runs[fd.get("sample")];
  if (id) return { ok: true, status: 200, d: { id, mode: "demo" } };
  return { ok: false, status: 409, d: { error: fd.get("mode") === "demo" ? "This sample isn't in the online demo: try the 555 blinker, ESP32 board or Robot car." : LOCAL } };
}

if (STATIC) {
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.includes("/api/")) return realFetch(input, init);
    const path = url.pathname.slice(url.pathname.indexOf("/api/"));
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch {}
    return api((init.method || "GET").toUpperCase(), path, body);
  };
  // downloads (report .md, sketches) and links to "/" point at the server; serve them from the recording
  document.addEventListener("click", async e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (href === "/" || href.startsWith("/#")) { e.preventDefault(); const u = BASE + href.slice(1); a.target === "_blank" ? window.open(u, "_blank") : (location.href = u); return; }
    const m = href.match(/^\/api\/investigations\/(\w+)\/(report\.md|sketch)\??(.*)$/);
    if (!m) return;
    e.preventDefault();
    const run = await getRun(m[1]), q = new URLSearchParams(m[3]);
    const text = m[2] === "report.md" ? run.report_md : run.sketches[`${q.get("kind")}/${q.get("board")}`];
    const name = m[2] === "report.md" ? `genesis-${m[1]}.md` : `genesis-${q.get("kind")}-${q.get("board")}.ino`;
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text || ""], { type: "text/plain" })), download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, true);
}
