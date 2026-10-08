// genesis-lab calculators, answered by the same Python code the agent calls.
import { gsap } from "gsap";
import { BAND_HEX } from "./bench3d.js";

const DIGITS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];
const ROWS = [
  { label: "1st digit", colors: DIGITS.slice(1) },
  { label: "2nd digit", colors: DIGITS },
  { label: "Multiplier", colors: [...DIGITS.slice(0, 8), "gold", "silver"] },
  { label: "Tolerance", colors: ["brown", "red", "green", "blue", "violet", "gold", "silver"] },
];

async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export function initLab() {
  const bands = ["yellow", "violet", "red", "gold"];
  const pickers = document.getElementById("band-pickers");
  const out = document.getElementById("bands-out"), note = document.getElementById("bands-note");
  ROWS.forEach((row, i) => {
    const el = document.createElement("div");
    el.className = "band-row";
    el.innerHTML = `<span>${row.label}</span><div class="swatches"></div>`;
    const sw = el.querySelector(".swatches");
    for (const c of row.colors) {
      const b = document.createElement("button");
      b.type = "button"; b.title = c; b.setAttribute("aria-label", `${row.label}: ${c}`);
      b.style.background = BAND_HEX[c];
      b.addEventListener("click", () => { bands[i] = c; render(); });
      sw.appendChild(b);
    }
    pickers.appendChild(el);
  });

  async function render() {
    pickers.querySelectorAll(".band-row").forEach((row, i) =>
      row.querySelectorAll("button").forEach(b => b.classList.toggle("is-on", b.title === bands[i])));
    document.querySelectorAll(".resistor .band").forEach((r, i) => r.setAttribute("fill", BAND_HEX[bands[i]]));
    try {
      const d = await post("/api/lab/bands", { bands });
      if (d.error) { out.textContent = "—"; note.textContent = d.error; return; }
      gsap.fromTo(out, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 });
      out.textContent = `${d.display} ±${d.tolerance_pct}%`;
      note.textContent = d.ambiguous
        ? `Ambiguous: read from the other end it would be ${d.alternative} Ω.`
        : `Read ${d.reversed ? "from the right-hand end" : "left to right"}; the other direction isn't a plausible code.`;
    } catch { note.textContent = "The bench server isn't reachable."; }
  }
  render();

  // ---- 555
  const ra = document.getElementById("c-ra"), rb = document.getElementById("c-rb"), cc = document.getElementById("c-c");
  const led = document.getElementById("calc-led"), wave = document.querySelector("#calc-wave path");
  let blink = null, timer = null;
  const fmtHz = f => (f >= 1000 ? `${(f / 1000).toPrecision(3)} kHz` : f >= 1 ? `${f.toPrecision(3)} Hz` : `${f.toPrecision(3)} Hz`);
  const fmtS = s => (s < 1e-3 ? `${(s * 1e6).toPrecision(3)} µs` : s < 1 ? `${(s * 1000).toPrecision(3)} ms` : `${s.toPrecision(3)} s`);

  async function calc() {
    try {
      const [a, b, c] = await Promise.all([
        post("/api/lab/parse", { text: ra.value, kind: "resistor" }),
        post("/api/lab/parse", { text: rb.value, kind: "resistor" }),
        post("/api/lab/parse", { text: cc.value, kind: "capacitor" }),
      ]);
      [ra, rb, cc].forEach((el, i) => el.style.borderColor = [a, b, c][i].value ? "" : "var(--signal)");
      if (!a.value || !b.value || !c.value) return;
      const r = await post("/api/lab/555", { ra: a.value, rb: b.value, c: c.value });
      document.getElementById("c-f").textContent = fmtHz(r.frequency_hz);
      document.getElementById("c-p").textContent = fmtS(r.period_s);
      document.getElementById("c-d").textContent = `${Math.round(r.high_fraction * 100)}%`;
      const cycles = 4, hi = r.high_fraction;
      let d = "M0 52";
      for (let k = 0; k < cycles; k++) {
        const x0 = (k / cycles) * 400, x1 = x0 + (hi / cycles) * 400, x2 = ((k + 1) / cycles) * 400;
        d += ` L${x0} 52 L${x0} 8 L${x1} 8 L${x1} 52 L${x2} 52`;
      }
      wave.setAttribute("d", d);
      blink?.kill();
      const period = Math.max(r.period_s, 0.06);   // faster than the eye: show it as a steady glow
      blink = gsap.timeline({ repeat: -1 })
        .call(() => led.classList.add("is-on")).to({}, { duration: period * hi })
        .call(() => led.classList.remove("is-on")).to({}, { duration: period * (1 - hi) });
    } catch { /* server offline: leave the last result */ }
  }
  for (const el of [ra, rb, cc]) el.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(calc, 220); });
  calc();
}
