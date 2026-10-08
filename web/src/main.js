import "./style.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { createBench, escapeHtml as esc } from "./bench3d.js";
import { createScope } from "./scope.js";
import { initLab } from "./lab.js";

gsap.registerPlugin(ScrollTrigger, SplitText);
gsap.ticker.lagSmoothing(0);   // keep animations on real time even when the GPU is slow
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The sample board, as the observer reports it (same layout as genesis_see/demo.py).
const HERO_PARTS = [
  { id: "O1", type: "ic", marking: "NE555P", box: [400, 380, 520, 560], status: "OBSERVED" },
  { id: "O2", type: "resistor", bands: ["brown", "black", "red", "gold"], display: "1 kΩ", box: [220, 150, 280, 300], status: "OBSERVED" },
  { id: "O3", type: "resistor", bands: ["brown", "black", "orange", "gold"], display: "10 kΩ", box: [220, 620, 280, 770], status: "OBSERVED" },
  { id: "O4", type: "resistor", bands: ["yellow", "violet", "brown", "gold"], display: "470 Ω", box: [690, 620, 750, 770], status: "OBSERVED" },
  { id: "O5", type: "capacitor_electrolytic", display: "100 µF", box: [590, 150, 730, 290], status: "OBSERVED" },
  { id: "O6", type: "led", box: [410, 830, 490, 890], status: "OBSERVED" },
];
const STEPS = [
  { id: "watch_video", name: "Watch the video", by: "code · OpenCV" },
  { id: "observe_parts", name: "Observe the parts", by: "model · vision" },
  { id: "identify_parts", name: "Look up markings", by: "model · web search", optional: true },
  { id: "match_patterns", name: "Match a circuit", by: "code" },
  { id: "check_prediction", name: "Check the prediction", by: "code" },
  { id: "list_unknowns", name: "List the unknowns", by: "code" },
  { id: "write_report", name: "Write the report", by: "model + skeptic" },
  { id: "confirm_value", name: "Your approval", by: "you", optional: true },
];
const STEP_TAB = { observe_parts: "parts", identify_parts: "parts", match_patterns: "fit", check_prediction: "check", list_unknowns: "open", write_report: "report", confirm_value: "check" };

// ------------------------------------------------------------------ app state
const app = { view: "intake", sid: null, mode: "live", es: null, snap: null, steps: {}, busy: false, pending: null, tabPinnedAt: 0, imageIdx: 0, stage: "model" };

const bench = createBench();
const scope = createScope($("#scope"), levelAt => {
  bench.signal = levelAt || (t => ((t * 0.686) % 1 < 0.524 ? 1 : 0));
});

// ------------------------------------------------------------------ formatting
const fmtHz = f => (f == null ? "—" : `${(+f).toFixed(3)} Hz`);
function fmtF(v) {
  if (v == null) return "—";
  const u = [[1e-6, "µF"], [1e-9, "nF"], [1e-12, "pF"]].find(([k]) => v >= k) || [1e-12, "pF"];
  return `${+(v / u[0]).toPrecision(3)} ${u[1]}`;
}
const typeName = t => String(t || "").replace(/^capacitor_/, "capacitor, ").replace(/_/g, " ");
function cite(text) {
  return esc(text).replace(/\[((?:[A-Z]\d+)(?:\s*,\s*[A-Z]\d+)*)\]/g, (_, ids) =>
    ids.split(/\s*,\s*/).map(id => `<button class="cite" data-ref="${id}">${id}</button>`).join(""));
}
const chips = (ids, bad = []) => (ids || []).map(id => `<button class="cite ${bad.includes(id) ? "is-bad" : ""}" data-ref="${esc(id)}">${esc(id)}</button>`).join("");

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  gsap.fromTo(t, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 });
  clearTimeout(toast.t);
  toast.t = setTimeout(() => gsap.to(t, { opacity: 0, duration: 0.3, onComplete: () => (t.hidden = true) }), ms);
}

// ------------------------------------------------------------------ views
function go(view) {
  if (view === "run" && !app.sid) return;
  const from = $(`.view[data-view="${app.view}"]`), to = $(`.view[data-view="${view}"]`);
  $$(".nav-link").forEach(b => b.classList.toggle("is-active", b.dataset.go === view));
  if (from !== to) {
    from.hidden = true;
    to.hidden = false;
    window.scrollTo(0, 0);
    if (!reduced) gsap.fromTo(to, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", clearProps: "transform" });
  }
  app.view = view;
  if (view === "intake") {
    bench.mount($("#stage-hero"), { hero: true });
    bench.setComponents(HERO_PARTS, { animate: false });
    scope.set(null);
    ScrollTrigger.refresh();
  } else if (view === "run") {
    bench.mount($("#stage-run"));
    renderSnap(app.snap, false);
  }
}
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); go(g.dataset.go); }
});

// ------------------------------------------------------------------ setup check
fetch("/api/info").then(r => r.json()).then(i => {
  $("#sys-lamp").className = `lamp ${i.gemini_key ? "ok" : "warn"}`;
  $("#sys-text").textContent = i.gemini_key
    ? `Gemini key found${i.fallbacks.length ? ` · backup: ${i.fallbacks.map(f => f.split(":")[0]).join(", ")}` : ""}`
    : "No GOOGLE_API_KEY · sample board only";
}).catch(() => {
  $("#sys-lamp").className = "lamp";
  $("#sys-text").textContent = "bench server offline";
});

// ------------------------------------------------------------------ intake
for (const slot of $$(".slot")) {
  const input = $("input", slot), prev = $(".slot-preview", slot), hint = $(".slot-hint", slot);
  const original = hint.textContent;
  input.addEventListener("change", () => {
    const f = input.files[0];
    slot.classList.toggle("is-filled", !!f);
    if (prev.src) URL.revokeObjectURL(prev.src);
    if (!f) { prev.hidden = true; hint.textContent = original; return; }
    prev.src = URL.createObjectURL(f);
    prev.hidden = false;
    if (prev.tagName === "VIDEO") prev.play().catch(() => {});
    hint.textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`;
    gsap.fromTo(prev, { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: 0.6, ease: "expo.out" });
  });
  slot.addEventListener("dragenter", () => slot.classList.add("is-drag"));
  slot.addEventListener("dragleave", () => slot.classList.remove("is-drag"));
  slot.addEventListener("drop", () => slot.classList.remove("is-drag"));
}

async function start(fd, button) {
  const label = $("span", button), before = label.textContent;
  $("#form-msg").textContent = "";
  $$(".actions button", $("#intake")).forEach(b => (b.disabled = true));
  label.textContent = fd.get("mode") === "demo" ? "Loading the sample…" : "Starting the agents…";
  try {
    const r = await fetch("/api/investigations", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    openRun(d.id, d.mode);
  } catch (e) {
    $("#form-msg").textContent = e.message === "Failed to fetch" ? "The bench server isn't running: python -m genesis_see.web" : e.message;
  } finally {
    label.textContent = before;
    $$(".actions button", $("#intake")).forEach(b => (b.disabled = false));
  }
}
$("#intake").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, fd = new FormData();
  for (const n of ["photo1", "photo2"]) if (f[n].files[0]) fd.append("photos", f[n].files[0]);
  if (f.video.files[0]) fd.append("video", f.video.files[0]);
  if (!fd.has("photos") && !fd.has("video")) {
    $("#form-msg").textContent = "Add at least one photo or a video — or try the sample board.";
    gsap.fromTo(".slots", { x: -6 }, { x: 0, duration: 0.4, ease: "elastic.out(1, 0.3)" });
    return;
  }
  fd.append("mode", "live");
  fd.append("note", f.note.value);
  fd.append("reader", f.reader.value);
  if (f.research.checked) fd.append("research", "on");
  if (f.flash.checked) fd.append("flash", "on");
  start(fd, $("#go-live"));
});
$("#go-demo").addEventListener("click", () => {
  const fd = new FormData();
  fd.append("mode", "demo");
  fd.append("reader", $("#intake").reader.value);
  start(fd, $("#go-demo"));
});

// ------------------------------------------------------------------ run: pipeline
function buildPipeline() {
  const ol = $("#pipeline");
  ol.innerHTML = `<span class="pipe-progress"></span>` + STEPS.map((s, i) =>
    `<li class="pipe" data-step="${s.id}" ${s.optional ? "hidden" : ""}>
       <span class="dot">${String(i + 1).padStart(2, "0")}</span>
       <span><b>${s.name}</b><small>${s.by}</small></span>
       <span class="st"></span>
     </li>`).join("");
}
function setStep(id, state) {
  if (!STEPS.some(s => s.id === id)) return;
  app.steps[id] = state;
  const li = $(`.pipe[data-step="${id}"]`);
  li.hidden = false;
  li.className = `pipe is-${state}`;
  $(".st", li).textContent = { run: "running", done: "done", wait: "waiting" }[state] || "";
  if (state === "run") gsap.fromTo($(".dot", li), { scale: 0.7 }, { scale: 1, duration: 0.5, ease: "back.out(3)" });
  const visible = $$(".pipe").filter(l => !l.hidden);
  const lastDone = visible.reduce((k, l, i) => (l.classList.contains("is-done") || l.classList.contains("is-run") ? i : k), -1);
  const target = visible[lastDone];
  const h = target ? target.offsetTop + target.offsetHeight / 2 - 12 : 0;
  gsap.to(".pipe-progress", { height: Math.max(0, h), duration: 0.6, ease: "power2.out" });
}
function stepsFromSnap(s) {
  if (!s) return;
  const done = { watch_video: s.video_checked, observe_parts: s.observed, identify_parts: s.identified, match_patterns: s.patterns,
                 check_prediction: s.check, list_unknowns: s.unknowns, write_report: s.report };
  for (const [k, v] of Object.entries(done)) if (v && app.steps[k] !== "done" && app.steps[k] !== "run") setStep(k, "done");
}

// ------------------------------------------------------------------ run: transcript
function tx(kind, html, who) {
  const box = $("#transcript");
  const el = document.createElement("div");
  el.className = `tx tx-${kind}`;
  if (who) el.dataset.who = who;
  el.innerHTML = html;
  box.appendChild(el);
  $("#tx-count").textContent = box.children.length;
  if (!reduced) gsap.from(el, { opacity: 0, x: -8, duration: 0.35, ease: "power2.out" });
  box.scrollTop = box.scrollHeight;
}

// ------------------------------------------------------------------ run: tabs
function setTab(name, auto = false) {
  if (auto && Date.now() - app.tabPinnedAt < 7000) {
    $(`.tabs [data-tab="${name}"]`).classList.add("has-new");
    return;
  }
  $$(".tabs button").forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on);
    if (on) b.classList.remove("has-new");
  });
  $$(".panel").forEach(p => p.classList.toggle("is-active", p.dataset.panel === name));
  const p = $(`.panel[data-panel="${name}"]`);
  if (!reduced && p.children.length) gsap.fromTo([...p.children], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: "power2.out" });
  animateBars(p);
}
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]");
  if (b) { app.tabPinnedAt = Date.now(); setTab(b.dataset.tab); }
});
function animateBars(root) {
  if (!root) return;
  $$(".bar i", root).forEach(i => gsap.fromTo(i, { width: 0 }, { width: i.dataset.w, duration: 0.9, ease: "power3.out" }));
}

const empty = (title, line) => `<div class="empty"><b>${title}</b><span>${line}</span></div>`;

function cropStyle(c) {
  if (!c.image_url || !Array.isArray(c.box)) return "";
  let [y0, x0, y1, x1] = c.box;
  const py = (y1 - y0) * 0.35 + 20, px = (x1 - x0) * 0.35 + 20;
  y0 = Math.max(0, y0 - py); y1 = Math.min(1000, y1 + py); x0 = Math.max(0, x0 - px); x1 = Math.min(1000, x1 + px);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const pos = (a, b) => (b >= 1000 ? 0 : (a / (1000 - b)) * 100);
  return `background-image:url('${c.image_url}');background-size:${(1000 / bw) * 100}% ${(1000 / bh) * 100}%;background-position:${pos(x0, bw)}% ${pos(y0, bh)}%`;
}

function renderParts(s) {
  const P = $("#panel-parts");
  const comps = s?.components || [];
  $('[data-count="parts"]').textContent = comps.length ? comps.length : "";
  if (!comps.length) {
    P.innerHTML = empty("No parts yet", s?.observed ? "The observer reported no parts." : "The observer runs after the video is measured.");
    return;
  }
  const cr = s.changing_region;
  let h = `<div class="sec-title"><span>Components</span><span>${comps.length} seen</span></div>`;
  h += comps.map(c => {
    const val = c.display || c.marking || "";
    const basis = c.value ? `from ${c.value.basis}${c.bands && c.value.basis === "colour bands" ? ": " + c.bands.join(" ") : ""}` : (c.type === "resistor" || c.type.startsWith("capacitor") ? "value not read" : "");
    return `<div class="part ${app.selected === c.id ? "is-selected" : ""}" data-id="${c.id}">
      <div class="crop" style="${cropStyle(c)}"></div>
      <div>
        <div class="part-head"><span class="part-id">${c.id}</span><span class="part-type">${esc(typeName(c.type))}</span><span class="part-val">${esc(val)}</span></div>
        <div class="part-meta"><span class="st-badge st-${c.status || "OBSERVED"}">${c.status || "OBSERVED"}</span><span>${esc(c.confidence || "")}</span>${basis ? `<span>${esc(basis)}</span>` : ""}${c.value?.ambiguous ? `<span>or ${esc(String(c.value.alternative))} Ω reversed</span>` : ""}</div>
        <div class="part-ev">${esc(c.evidence || "")}</div>
      </div></div>`;
  }).join("");
  if (cr?.component_id) h += `<div class="sec-title"><span>Changing in the video</span></div><div class="note-line"><span class="part-id">${esc(cr.component_id)}</span><span>${esc(cr.evidence || "")}</span></div>`;
  if (s.board?.length) h += `<div class="sec-title"><span>Board notes</span></div>` + s.board.map(b => `<div class="note-line"><span class="part-id">${b.id}</span><span>${esc(b.note)}</span></div>`).join("");
  if (s.datasheets?.length) h += `<div class="sec-title"><span>Looked up</span><span>sources required</span></div>` + s.datasheets.map(d =>
    `<div class="note-line"><span class="part-id">${d.id}</span><span><b>${esc(d.component_id)}: ${esc(d.identity)}</b><br>${esc(d.function)}${(d.key_facts || []).map(f => `<br>· ${esc(f)}`).join("")}${(d.sources || []).map(u => `<a class="src" href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("")}</span></div>`).join("");
  if (s.cannot_see?.length) h += `<div class="sec-title"><span>The observer couldn't see</span></div>` + s.cannot_see.map(t => `<div class="note-line">${esc(t)}</div>`).join("");
  P.innerHTML = h;
}

function renderFit(s) {
  const P = $("#panel-fit"), p = s?.patterns;
  if (!p) { P.innerHTML = empty("No circuit matched yet", "Known circuits are scored once the parts are observed."); return; }
  if (!p.ranked?.length) { P.innerHTML = empty("No known circuit fits", "None of the patterns has enough clues in the evidence."); return; }
  P.innerHTML = `<div class="sec-title"><span>Ranked by clues found</span><span>confidence: ${esc(p.confidence)}</span></div>` +
    p.ranked.slice(0, 6).map((r, i) => `<div class="fit ${p.top && r.id === p.top.id ? "is-top" : ""}">
      <div class="fit-head"><span class="fit-name">${i < 3 ? `<button class="cite" data-ref="P${i + 1}">P${i + 1}</button> ` : ""}${esc(r.name)}</span><span class="fit-score">${Math.round(r.score * 100)}%</span></div>
      <div class="bar"><i data-w="${Math.round(r.score * 100)}%"></i></div>
      <p class="fit-sum">${esc(r.summary)} <span class="mono" style="color:var(--ink-3);font-size:11px">· ${r.role} · ${Math.round(r.coverage * 100)}% of clues checkable</span></p>
      <ul class="clues">${r.matched.map(m => `<li class="ok"><span>${esc(m.text)} ${chips(m.ev)}</span></li>`).join("")}${r.missing.map(m => `<li class="no"><span>${esc(m)}</span></li>`).join("")}${r.unknown.map(m => `<li class="q"><span>${esc(m)}</span></li>`).join("")}</ul>
    </div>`).join("");
}

function renderCheck(s) {
  const P = $("#panel-check"), x = s?.check;
  if (!x) { P.innerHTML = empty("Not checked yet", "The winning circuit's formula is compared with the video after matching."); return; }
  if (!x.available) {
    P.innerHTML = empty("No check possible", esc(x.reason || "")) + (x.needs?.length ? `<p class="callout">Needs values for ${chips(x.needs)}</p>` : "");
    return;
  }
  let h = `<span class="verdict v-${x.verdict}">${x.verdict}</span>`;
  const meas = x.measured?.frequency_hz;
  if (x.verdict === "INFERRED") {
    const inf = x.inferred;
    h += `<div class="readouts"><div><span>Worked out</span><b>${fmtF(inf.value)}</b><small> ${chips([inf.component])}</small></div><div><span>Nearest standard</span><b>${fmtF(inf.standard)}</b></div></div>
      <p class="callout">${esc(inf.text)}. Range ${fmtF(inf.range[0])} – ${fmtF(inf.range[1])}. It only becomes a recorded value when you approve it — tell GENESIS what the label says.</p>`;
  } else {
    const pred = x.predicted.frequency_hz, tol = x.tolerance_pct / 100;
    const lo = Math.min(meas * (1 - tol * 2.2), pred * 0.85), hi = Math.max(meas * (1 + tol * 2.2), pred * 1.15);
    const side = v => (pc(v) > 78 ? "is-right" : pc(v) < 22 ? "is-left" : "");
    const pc = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    h += `<div class="readouts"><div><span>Parts predict</span><b>${fmtHz(pred)}</b></div><div><span>Video measured ${chips([x.measured.region])}</span><b>${fmtHz(meas)}</b></div></div>
      <div class="gauge" aria-label="Prediction against tolerance band">
        <span class="track"></span>
        <span class="band" style="left:${pc(meas * (1 - tol))}%;right:${100 - pc(meas * (1 + tol))}%"></span>
        <span class="mk ${side(meas)}" style="left:${pc(meas)}%"><span>measured</span></span>
        <span class="mk pred ${side(pred)}" style="left:${pc(pred)}%"><span>predicted · ${x.error_pct}% off</span></span>
      </div>
      <p class="mono" style="font-size:12px;color:var(--ink-3);margin:0 0 16px">Allowed: ±${x.tolerance_pct}% for part tolerances. ${x.considered} role assignments considered.</p>`;
  }
  h += `<dl class="kv"><dt>Formula</dt><dd class="mono">${esc(x.formula)}</dd><dt>Roles</dt><dd>${Object.entries(x.roles).map(([k, v]) => `${k} ${chips([v])}`).join(" &nbsp; ")}</dd>
        ${meas ? `<dt>Duty</dt><dd class="mono">${x.measured.duty != null ? Math.round(x.measured.duty * 100) + "% on" : "—"}</dd>` : ""}
        ${x.led_wiring ? `<dt>LED</dt><dd>${esc(x.led_wiring)}</dd>` : ""}</dl>`;
  if (x.ambiguity) h += `<p class="callout">${esc(x.ambiguity)}</p>`;
  if (x.note) h += `<p class="callout">${esc(x.note)}</p>`;
  if (x.suggestions?.length) h += `<div class="sec-title"><span>Likely explanations</span></div>` + x.suggestions.map(t => `<p class="callout is-red">${esc(t.text)} ${chips([t.component])}</p>`).join("");
  P.innerHTML = h;
}

function renderOpen(s) {
  const P = $("#panel-open"), U = s?.unknowns;
  $('[data-count="open"]').textContent = U?.length ? U.length : "";
  if (!U) { P.innerHTML = empty("Not listed yet", "What the pixels can't settle is listed after the check."); return; }
  P.innerHTML = `<div class="sec-title"><span>What the evidence can't settle</span><span>${U.length}</span></div>` +
    U.map(u => `<div class="unk"><span class="part-id">${u.id}</span><div><p>${esc(u.text)} ${chips(u.ev)}</p>${u.ask ? `<div class="next">${esc(u.ask)}</div>` : ""}</div></div>`).join("");
}

function renderReport(s) {
  const P = $("#panel-report"), sk = s?.skeptic;
  if (!sk) {
    P.innerHTML = s?.unknowns && !s?.report && app.steps.write_report === "done"
      ? empty("Report out of date", "A value changed after the report was written. Ask GENESIS to rewrite it.")
      : empty("No report yet", "The reporter writes last; every sentence must cite evidence.");
    return;
  }
  P.innerHTML = `<div class="report-head"><span>Skeptic: <b>${sk.flagged}</b> of ${sk.claims} sentences flagged</span><span>every claim cites evidence</span></div>` +
    sk.sections.map(sec => `<section class="r-sec"><h4>${esc(sec.title)}</h4>${sec.sentences.map(t => {
      const bad = t.flags.flatMap(f => (f.match(/doesn't exist: (.+)$/) || [, ""])[1].split(/,\s*/)).filter(Boolean);
      return `<p class="r-sent ${t.flags.length ? "is-flagged" : ""}">${esc(t.text)} ${chips(t.cites, bad)}${t.flags.map(f => `<span class="flag">${esc(f)}</span>`).join("")}</p>`;
    }).join("")}</section>`).join("");
}

// ------------------------------------------------------------------ run: evidence images
function renderPhotos(s) {
  const imgs = s?.images?.length ? s.images : [
    ...(s?.photo_urls || []).map((url, i) => ({ url, label: `photo ${i + 1} (uploaded)` })),
    ...(s?.keyframes || []),
  ];
  const strip = $("#photo-strip"), main = $("#photo-main");
  if (!imgs.length) { main.innerHTML = `<div class="empty"><b>No images yet</b></div>`; strip.innerHTML = ""; return; }
  app.imageIdx = Math.min(app.imageIdx, imgs.length - 1);
  const cur = imgs[app.imageIdx];
  const comps = (s?.components || []).filter(c => c.image === app.imageIdx + 1 && Array.isArray(c.box));
  main.innerHTML = `<div class="photo-frame"><img src="${cur.url}" alt="${esc(cur.label)}">${comps.map(c => {
    const [y0, x0, y1, x1] = c.box;
    const st = (c.status || "").toLowerCase();
    return `<div class="pbox is-${st} ${app.selected === c.id ? "is-selected" : ""}" data-id="${c.id}" style="top:${y0 / 10}%;left:${x0 / 10}%;width:${(x1 - x0) / 10}%;height:${(y1 - y0) / 10}%"><span>${c.id}</span></div>`;
  }).join("")}</div>`;
  strip.innerHTML = imgs.map((im, i) => `<button class="${i === app.imageIdx ? "is-active" : ""}" data-img="${i}"><img src="${im.url}" alt=""><span>${esc(im.label)}</span></button>`).join("");
}
$("#photo-strip").addEventListener("click", e => {
  const b = e.target.closest("[data-img]");
  if (b) { app.imageIdx = +b.dataset.img; renderPhotos(app.snap); }
});
$(".stage-tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-stage]");
  if (!b) return;
  app.stage = b.dataset.stage;
  $$(".stage-tabs button").forEach(x => x.classList.toggle("is-active", x === b));
  $("#photos").hidden = app.stage !== "photos";
  $("#stage-run canvas").style.visibility = app.stage === "photos" ? "hidden" : "visible";
  $("#stage-run .tags").hidden = app.stage === "photos";
  if (app.stage === "photos") { renderPhotos(app.snap); gsap.from("#photos", { opacity: 0, duration: 0.3 }); }
});

// ------------------------------------------------------------------ selection & citations
function select(id, from) {
  app.selected = id;
  if (from !== "bench") bench.select(id);
  $$(".part").forEach(p => p.classList.toggle("is-selected", p.dataset.id === id));
  $$(".pbox").forEach(p => p.classList.toggle("is-selected", p.dataset.id === id));
  const row = $(`.part[data-id="${id}"]`);
  if (row && from !== "list") row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
bench.onSelect = id => { if (id && $(".panel.is-active").dataset.panel !== "parts") setTab("parts"); select(id, "bench"); };
$("#panel-parts").addEventListener("click", e => {
  const p = e.target.closest(".part");
  if (p) select(app.selected === p.dataset.id ? null : p.dataset.id, "list");
});
$("#photo-main").addEventListener("click", e => {
  const p = e.target.closest(".pbox");
  if (p) { setTab("parts"); select(p.dataset.id); }
});
document.addEventListener("click", e => {
  const c = e.target.closest(".cite");
  if (!c || app.view !== "run") return;
  const ref = c.dataset.ref, k = ref[0];
  app.tabPinnedAt = Date.now();
  if (k === "O") { setTab("parts"); select(ref); }
  else if (k === "B" || k === "D") setTab("parts");
  else if (k === "V") { scope.pulse(); $(".scope").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  else if (k === "P") setTab("fit");
  else if (k === "X") setTab("check");
  else if (k === "U") setTab("open");
});

// ------------------------------------------------------------------ snapshot → UI
function renderSnap(s, animate = true) {
  if (!s) {
    bench.setComponents([], { animate: false });
    scope.set(null);
    for (const f of [renderParts, renderFit, renderCheck, renderOpen, renderReport]) f(null);
    return;
  }
  bench.setComponents(s.components || [], { animate, changing: s.changing_region?.component_id || null });
  scope.set(s.video);
  const v = s.video, r = v?.regions?.find(x => x.analysis?.periodic);
  $("#scope-read").textContent = !s.video_checked ? "no video measured yet"
    : !v ? "no video was given"
    : v.camera_moved ? "the camera moved; measurements may be unreliable"
    : r ? `V${r.index + 1} · ${fmtHz(r.analysis.frequency_hz)} · on ${Math.round((r.analysis.duty_cycle || 0) * 100)}% · ${r.analysis.cycles} cycles · ${r.analysis.confidence} · ${v.fps} fps`
    : v.regions?.length ? `${v.regions.length} changing area(s), no steady rhythm` : "nothing visibly changes";
  const n = s.components?.length || 0;
  $("#stage-caption").textContent = s.observed ? `${n} part${n === 1 ? "" : "s"} placed from the observer's boxes` : s.video_checked ? "The observer is next" : "Measuring the video";
  renderParts(s); renderFit(s); renderCheck(s); renderOpen(s); renderReport(s);
  if (app.stage === "photos") renderPhotos(s);
  animateBars($(".panel.is-active"));
  stepsFromSnap(s);
}

function setStatus() {
  const el = $("#run-status");
  const [cls, text] = app.pending ? ["is-wait", "Waiting for you"] : app.busy ? ["is-busy", "Working"]
    : app.snap?.skeptic ? ["is-done", "Ready for questions"] : ["", "Idle"];
  el.className = `status ${cls}`;
  $("span", el).textContent = text;
  $("#ask input").disabled = $("#ask button").disabled = app.busy || !!app.pending;
}

// ------------------------------------------------------------------ run lifecycle
function openRun(id, mode) {
  app.es?.close();
  Object.assign(app, { sid: id, mode, snap: null, steps: {}, busy: true, pending: null, selected: null, imageIdx: 0, tabPinnedAt: 0 });
  $("#nav-run").disabled = false;
  $("#run-id").textContent = id.slice(0, 8);
  $("#run-mode").textContent = mode === "demo" ? "Demo · scripted models" : "Live · Gemini";
  $("#run-mode").classList.toggle("is-demo", mode === "demo");
  $("#run-export").href = `/api/investigations/${id}/evidence`;
  $("#transcript").innerHTML = "";
  buildPipeline();
  setTab("parts");
  go("run");
  if (!reduced) gsap.from([".col-left", ".col-center", ".col-right"], { opacity: 0, y: 18, duration: 0.7, stagger: 0.08, ease: "power3.out" });
  if (mode === "demo") tx("sys", "Demo mode: the real pipeline runs on a sample board; only the model replies are scripted (zero Gemini requests).");
  setStatus();

  const es = new EventSource(`/api/investigations/${id}/events`);
  app.es = es;
  es.onmessage = m => handle(JSON.parse(m.data));
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) tx("err", "Lost the connection to the bench server."); };
}

function handle(e) {
  switch (e.type) {
    case "log":
      for (const l of e.lines || []) tx("sys", esc(l));
      break;
    case "busy":
      app.busy = e.busy;
      if (!e.busy) bench.setScanning(false);
      setStatus();
      break;
    case "call": {
      const args = Object.entries(e.args || {}).map(([k, v]) => `${k}=${esc(JSON.stringify(v))}`).join(", ");
      tx("call", `→ <b>${esc(e.name)}</b>(${args})`);
      setStep(e.name, "run");
      if (e.name === "observe_parts") bench.setScanning(true);
      break;
    }
    case "result":
      tx("result", esc(e.text.length > 420 ? e.text.slice(0, 420) + "…" : e.text));
      if (STEPS.some(s => s.id === e.name)) setStep(e.name, "done");
      if (e.name === "observe_parts") bench.setScanning(false);
      if (STEP_TAB[e.name]) setTab(STEP_TAB[e.name], true);
      break;
    case "say":
      tx("say", cite(e.text), "GENESIS");
      break;
    case "user":
      tx("user", esc(e.text), "You");
      break;
    case "state":
      app.snap = e.state;
      renderSnap(e.state);
      setStatus();
      break;
    case "approval":
      app.pending = e.request;
      setStep("confirm_value", "wait");
      showApproval(e.request);
      setStatus();
      break;
    case "decided":
      tx("sys", `You chose: ${esc(e.decision)}.`);
      break;
    case "error":
      tx("err", esc(e.text));
      toast("The agent stopped with an error — see the transcript.");
      break;
  }
}

// ------------------------------------------------------------------ approval
function showApproval(req) {
  const a = req.args || {};
  $("#ap-id").textContent = a.component_id;
  $("#ap-value").textContent = a.value;
  $("#ap-reason").textContent = a.reason ? `Reason: ${a.reason}` : "";
  $("#ap-edit").hidden = true;
  $("#ap-edit-label").textContent = `New value for ${a.component_id}`;
  $("#approval").hidden = false;
  gsap.fromTo("#approval", { opacity: 0 }, { opacity: 1, duration: 0.25 });
  gsap.fromTo(".approval-card", { y: 30, rotate: -1.5 }, { y: 0, rotate: 0, duration: 0.6, ease: "expo.out" });
  $("#ap-approve").focus();
}
async function decide(body) {
  const r = await fetch(`/api/investigations/${app.sid}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { toast((await r.json()).error || "That didn't go through."); return; }
  app.pending = null;
  setStep("confirm_value", body.type === "reject" ? "done" : "run");
  gsap.to("#approval", { opacity: 0, duration: 0.2, onComplete: () => ($("#approval").hidden = true) });
  setStatus();
}
$("#ap-approve").addEventListener("click", () => {
  if (!$("#ap-edit").hidden) {
    const v = $("#ap-input").value.trim();
    if (!v) { $("#ap-input").focus(); return; }
    decide({ type: "edit", value: v });
  } else decide({ type: "approve" });
});
$("#ap-editbtn").addEventListener("click", () => {
  $("#ap-edit").hidden = false;
  $("#ap-input").value = $("#ap-value").textContent;
  $("#ap-input").select();
  $("#ap-approve").textContent = "Record edited value";
});
$("#ap-reject").addEventListener("click", () => decide({ type: "reject", message: "rejected by the user" }));
new MutationObserver(() => { if ($("#approval").hidden) $("#ap-approve").textContent = "Approve"; }).observe($("#approval"), { attributes: true });

// ------------------------------------------------------------------ ask
$("#ask").addEventListener("submit", async e => {
  e.preventDefault();
  const input = e.target.text, text = input.value.trim();
  if (!text || !app.sid) return;
  input.value = "";
  const r = await fetch(`/api/investigations/${app.sid}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) { toast((await r.json()).error || "Couldn't send that."); input.value = text; return; }
  app.busy = true; setStatus();
});

// ------------------------------------------------------------------ intro motion
function intro() {
  bench.mount($("#stage-hero"), { hero: true });
  bench.setComponents(HERO_PARTS, { animate: !reduced });
  if (reduced) return;
  bench.intro();
  document.fonts.ready.then(() => {
    const split = SplitText.create("#hero-title", { type: "lines,words", mask: "lines" });
    gsap.from(split.words, { yPercent: 115, duration: 1.1, ease: "expo.out", stagger: 0.035, delay: 0.1 });
    gsap.from([".hero .eyebrow", ".lede", ".intake > *"], { opacity: 0, y: 16, duration: 0.8, ease: "power3.out", stagger: 0.06, delay: 0.45 });
    gsap.from(".stage-hero .corner", { scale: 0, duration: 0.6, ease: "back.out(2)", stagger: 0.05, delay: 0.6 });
    const m = SplitText.create("#method-title", { type: "lines,words", mask: "lines" });
    gsap.from(m.words, { yPercent: 115, duration: 1, ease: "expo.out", stagger: 0.02, scrollTrigger: { trigger: "#method-title", start: "top 85%" } });
    gsap.from(".step-card", { opacity: 0, y: 30, duration: 0.8, ease: "power3.out", stagger: 0.07, scrollTrigger: { trigger: ".steps", start: "top 88%" } });
    gsap.from(".titleblock div", { opacity: 0, y: 12, stagger: 0.06, duration: 0.6, scrollTrigger: { trigger: ".titleblock", start: "top 95%" } });
  });
}

initLab();
intro();
if (location.hash === "#demo") $("#go-demo").click();
else if (location.hash === "#lab") go("lab");
