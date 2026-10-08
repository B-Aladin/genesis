import "./style.css";
import "./control.css";
import "./mvp.css";
import QRCode from "qrcode";
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { createBench, escapeHtml as esc } from "./bench3d.js";
import { createScope } from "./scope.js";
import { initLab } from "./lab.js";
import { renderSchematic } from "./schematic.js";

// ---- preferences (Control panel), kept in this browser only
const PREF_DEFAULTS = { research: "auto", flash: "off", backup: "on", reader: "a student engineer", theme: "paper",
                        labels: "on", rotate: "on", layout: "split", disabled: [], enabled: [] };
const prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem("genesis-prefs") || "{}") }; } catch { return { ...PREF_DEFAULTS }; } })();
const savePrefs = () => { try { localStorage.setItem("genesis-prefs", JSON.stringify(prefs)); } catch {} };
document.documentElement.dataset.theme = prefs.theme;
document.documentElement.dataset.layout = prefs.layout;

gsap.registerPlugin(SplitText);
gsap.ticker.lagSmoothing(0);   // keep animations on real time even when the GPU is slow
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The sample board, as the observer reports it (same layout as genesis_see/demo.py).
const HERO_PARTS = [
  { id: "O1", type: "ic", marking: "NE555P", box: [400, 380, 520, 560] },
  { id: "O2", type: "resistor", bands: ["brown", "black", "red", "gold"], display: "1 kΩ", box: [220, 150, 280, 300] },
  { id: "O3", type: "resistor", bands: ["brown", "black", "orange", "gold"], display: "10 kΩ", box: [220, 620, 280, 770] },
  { id: "O4", type: "resistor", bands: ["yellow", "violet", "brown", "gold"], display: "470 Ω", box: [690, 620, 750, 770] },
  { id: "O5", type: "capacitor_electrolytic", display: "100 µF", box: [590, 150, 730, 290] },
  { id: "O6", type: "led", box: [410, 830, 490, 890] },
];
const STEPS = [
  { id: "watch_video", name: "Video" },
  { id: "observe_parts", name: "Parts" },
  { id: "identify_parts", name: "Lookup", optional: true },
  { id: "match_patterns", name: "Match" },
  { id: "check_prediction", name: "Check" },
  { id: "list_unknowns", name: "Unknowns" },
  { id: "write_report", name: "Report" },
  { id: "confirm_value", name: "Approval", optional: true },
];
const RUNNING = {
  watch_video: "Measuring the video frame by frame…", observe_parts: "Reading the parts in the images…",
  identify_parts: "Looking up part markings…", match_patterns: "Matching known circuits…",
  check_prediction: "Checking the circuit against the video…", list_unknowns: "Listing what can't be settled…",
  write_report: "Writing the cited report…", confirm_value: "Recording your value and re-checking…",
};
const MATERIALS_FALLBACK = {
  multimeter: "Multimeter", oscilloscope: "Oscilloscope", soldering_iron: "Soldering iron", spare_resistors: "Spare resistors",
  spare_capacitors: "Spare capacitors", breadboard: "Breadboard", bench_supply: "Bench power supply",
  arduino: "Arduino (Uno, Nano…)", esp: "ESP32 or ESP8266", logic_probe: "Logic probe", magnifier: "Magnifier or macro lens",
};
const BOARD_LABEL = { arduino: "Arduino", esp32: "ESP32", esp8266: "ESP8266" };

const app = {
  view: "intake", sid: null, mode: "live", es: null, snap: null, inputs: null, steps: {}, busy: false, pending: null,
  selected: null, imageIdx: 0, stage: "model", asked: false,
  files: { photos: [], video: null }, meta: new Map(), materials: new Set(),
};

const bench = createBench();
bench.setPrefs({ labels: prefs.labels === "on", rotate: prefs.rotate === "on" });
const scope = createScope($("#scope"), levelAt => {
  bench.signal = levelAt || (t => ((t * 0.686) % 1 < 0.524 ? 1 : 0));
});

// ------------------------------------------------------------------ helpers
const fmtHz = f => (f == null ? "—" : `${(+f).toFixed(3)} Hz`);
function fmtF(v, compact = false) {
  if (v == null) return "—";
  const [k, u] = [[1e-6, "µF"], [1e-9, "nF"], [1e-12, "pF"]].find(([k]) => v >= k) || [1e-12, "pF"];
  const n = +(v / k).toPrecision(3);
  return compact ? `${n}${u.replace("µ", "u")}` : `${n} ${u}`;
}
const typeName = t => String(t || "").replace(/^capacitor_/, "capacitor, ").replace(/_/g, " ");
const citeText = text => esc(text).replace(/\[((?:[A-Z]\d+)(?:\s*,\s*[A-Z]\d+)*)\]/g, (_, ids) =>
  ids.split(/\s*,\s*/).map(id => `<button class="cite" data-ref="${id}">${id}</button>`).join(""));
const chips = (ids, bad = []) => (ids || []).map(id => `<button class="cite ${bad.includes(id) ? "is-bad" : ""}" data-ref="${esc(id)}">${esc(id)}</button>`).join("");
const empty = (title, line) => `<div class="empty"><b>${title}</b><span>${line}</span></div>`;
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

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
    from.hidden = true; to.hidden = false;
    window.scrollTo(0, 0);
    if (!reduced) gsap.fromTo(to, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", clearProps: "transform" });
  }
  app.view = view;
  if (view === "intake") {
    bench.mount($("#stage-hero"), { hero: true });
    bench.setComponents(HERO_PARTS, { animate: false });
    scope.set(null);
    loadRecent();
  } else if (view === "run") {
    bench.mount($("#stage-run"));
    renderSnap(app.snap, false);
  }
}
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); go(g.dataset.go); }
});

fetch("/api/info").then(r => r.json()).then(i => {
  $("#sys-lamp").className = `lamp ${i.gemini_key ? "ok" : "warn"}`;
  $("#sys-text").textContent = i.gemini_key ? `Gemini ready${i.fallbacks.length ? " · backup model on" : ""}` : "No Gemini key · samples only";
}).catch(() => { $("#sys-text").textContent = "server offline"; });

// ================================================================== INTAKE

// ---- materials
function renderMaterials(list) {
  $("#materials").innerHTML = Object.entries(list).map(([k, v]) =>
    `<button type="button" class="chip-btn" data-mat="${k}" aria-pressed="${app.materials.has(k)}">${esc(v)}</button>`).join("");
}
fetch("/api/materials").then(r => r.json()).then(renderMaterials).catch(() => renderMaterials(MATERIALS_FALLBACK));
renderMaterials(MATERIALS_FALLBACK);
$("#materials").addEventListener("click", e => {
  const b = e.target.closest("[data-mat]");
  if (!b) return;
  const k = b.dataset.mat;
  app.materials.has(k) ? app.materials.delete(k) : app.materials.add(k);
  b.setAttribute("aria-pressed", app.materials.has(k));
  gsap.fromTo(b, { scale: 0.94 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
});

// ---- files: one drop zone, sorted into front photo, back photo and video
function addFiles(list) {
  let rejected = 0;
  for (const f of list) {
    if (f.type.startsWith("image/")) {
      if (app.files.photos.length + (app.reuse?.photos.length || 0) >= 2) { rejected++; continue; }
      app.files.photos.push(f);
    } else if (f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi)$/i.test(f.name)) {
      app.files.video = f;
    } else rejected++;
    if (!app.meta.has(f)) inspect(f);
  }
  if (rejected) toast(rejected === 1 ? "Skipped 1 file: up to 2 photos and 1 video." : `Skipped ${rejected} files: up to 2 photos and 1 video.`);
  renderFiles();
}
async function inspect(f) {
  const url = URL.createObjectURL(f);
  const m = { url, warn: [] };
  app.meta.set(f, m);
  if (f.type.startsWith("image/")) {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { m.warn.push("can't be opened as an image"); renderFiles(); return; }
    m.dims = `${img.naturalWidth}×${img.naturalHeight}`;
    if (Math.max(img.naturalWidth, img.naturalHeight) < 1000) m.warn.push("small: fine markings may be unreadable");
    // quick sharpness and exposure estimate on a 480 px copy (the server re-checks at full size)
    const w = 480, h = Math.round((480 * img.naturalHeight) / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
    let n = 0, s1 = 0, s2 = 0;
    for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s1 += l; s2 += l * l; n++;
    }
    const lap = s2 / n - (s1 / n) ** 2, mean = sum / (w * h);
    if (lap < 25) m.warn.push("may be blurry");
    if (mean < 55) m.warn.push("dark"); else if (mean > 215) m.warn.push("overexposed");
  } else {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.src = url;
    await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 4000); });
    if (v.duration && isFinite(v.duration)) {
      m.dur = v.duration;
      m.dims = `${v.duration.toFixed(1)} s`;
      if (v.duration < 2) m.warn.push("under 2 s: too short to time a blink");
      else if (v.duration < 5) m.warn.push("short: few blink cycles");
      if (v.duration > 30) m.warn.push("only the first 30 s are measured");
      v.currentTime = Math.min(1, v.duration / 2);
      await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
      try { const c = document.createElement("canvas"); c.width = 160; c.height = 90; c.getContext("2d").drawImage(v, 0, 0, 160, 90); m.thumb = c.toDataURL("image/jpeg", 0.7); } catch {}
    } else m.warn.push("can't preview here; MP4 (H.264) is safest");
  }
  renderFiles();
}
function renderFiles() {
  const kept = app.reuse ? app.reuse.photos.length : 0;
  const rows = [
    ...app.files.photos.map((f, i) => ({ f, role: i + kept === 0 ? "Front photo" : "Back photo", kind: "photo", i })),
    ...(app.files.video ? [{ f: app.files.video, role: "Video", kind: "video" }] : []),
  ];
  const keptRows = app.reuse ? [
    ...app.reuse.photos.map((u, i) => `<li class="file"><img class="thumb" src="${esc(u)}" alt=""><span><b>${i === 0 ? "Front photo" : "Back photo"}</b><small>kept from the earlier run</small></span><span></span></li>`),
    ...(app.reuse.video && !app.files.video ? [`<li class="file"><span class="thumb"></span><span><b>Video</b><small>kept from the earlier run (add a new one to replace it)</small></span><span></span></li>`] : []),
  ] : [];
  $("#file-list").innerHTML = keptRows.join("") + rows.map(r => {
    const m = app.meta.get(r.f) || {};
    const thumb = r.kind === "photo" ? m.url : m.thumb;
    return `<li class="file">
      ${thumb ? `<img class="thumb" src="${thumb}" alt="">` : `<span class="thumb"></span>`}
      <span><b>${r.role}</b><small>${esc(r.f.name)}${m.dims ? ` · ${m.dims}` : ""}</small>${m.warn?.length ? `<small class="warn">${esc(m.warn.join("; "))}</small>` : ""}</span>
      <span class="file-actions">
        ${r.kind === "photo" && app.files.photos.length === 2 ? `<button type="button" class="icon-btn" data-swap title="Swap front and back" aria-label="Swap front and back">⇅</button>` : ""}
        <button type="button" class="icon-btn" data-remove="${r.kind}:${r.i ?? 0}" title="Remove" aria-label="Remove ${r.role}">×</button>
      </span></li>`;
  }).join("");
  renderReadiness();
}
$("#file-list").addEventListener("click", e => {
  if (e.target.closest("[data-swap]")) app.files.photos.reverse();
  const rm = e.target.closest("[data-remove]")?.dataset.remove;
  if (rm) {
    const [kind, i] = rm.split(":");
    if (kind === "photo") app.files.photos.splice(+i, 1); else app.files.video = null;
  }
  renderFiles();
});
const drop = $("#drop");
$("#files").addEventListener("change", e => { addFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("is-drag"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("is-drag")));
drop.addEventListener("drop", e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

// ---- readiness: what's given, what's missing, and what each gap costs
function readiness() {
  const keptPhotos = app.reuse ? app.reuse.photos.map(u => ({ kept: u })) : [];
  const [front, back] = [...keptPhotos, ...app.files.photos], video = app.files.video || (app.reuse?.video ? { kept: app.reuse.video } : null);
  const w = f => (f && !f.kept && app.meta.get(f)?.warn?.length ? app.meta.get(f).warn.join("; ") : "");
  const items = [
    front ? { st: w(front) ? "warn" : "ok", label: "Front photo", text: w(front) || "given" }
          : { st: "miss", label: "Front photo", text: video ? "missing: parts will be read from small video frames" : "missing" },
    back ? { st: w(back) ? "warn" : "ok", label: "Back photo", text: w(back) || "given" }
         : { st: "miss", label: "Back photo", text: "missing: wiring will be inferred from the circuit, not traced" },
    video ? { st: w(video) ? "warn" : "ok", label: "Video", text: w(video) || "given" }
          : { st: "miss", label: "Video", text: "missing: behaviour can't be measured or checked" },
  ];
  let verdict;
  if (!front && !video) verdict = "Add at least a photo or a video to start.";
  else if (!video) verdict = "Can identify the parts and the likely circuit, but can't check it against the device.";
  else if (!front) verdict = "Can time the blinking; parts will be less certain without a photo.";
  else if (!back) verdict = "Ready. A back photo would let GENESIS trace the wiring.";
  else verdict = "Ready: front, back and video.";
  return { items, verdict, ok: !!(front || video) };
}
function renderReadiness() {
  const r = readiness();
  const mark = { ok: "✓", warn: "!", miss: "–" };
  $("#ready").innerHTML = r.items.map(i => `<li class="${i.st}"><span class="mark">${mark[i.st]}</span><b>${i.label}</b><span>${esc(i.text)}</span></li>`).join("");
  $("#ready-verdict").textContent = r.verdict;
}
renderReadiness();

// ---- start
async function start(fd, label) {
  $("#form-msg").textContent = "";
  const btns = $$("#intake button");
  btns.forEach(b => (b.disabled = true));
  const span = $("#go-live span"), before = span.textContent;
  span.textContent = label;
  try {
    const r = await fetch("/api/investigations", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    app.reuse = null; $("#reuse").hidden = true;
    app.files = { photos: [], video: null };
    renderFiles();
    openRun(d.id, d.mode);
  } catch (e) {
    $("#form-msg").textContent = e.message === "Failed to fetch" ? "The server isn't running: python -m genesis_see.web" : e.message;
  } finally {
    span.textContent = before;
    btns.forEach(b => (b.disabled = false));
  }
}
function commonFields(fd) {
  const f = $("#intake");
  fd.append("note", f.note.value);
  fd.append("reader", prefs.reader);
  for (const k of app.materials) fd.append("materials", k);
  fd.append("materials_other", $("#materials-other").value);
  fd.append("research", prefs.research);
  fd.append("backup", prefs.backup);
  if (prefs.flash === "on") fd.append("flash", "on");
  prefs.disabled.forEach(n => fd.append("disable", n));
  prefs.enabled.forEach(n => fd.append("enable", n));
  return fd;
}
$("#intake").addEventListener("submit", e => {
  e.preventDefault();
  if (!readiness().ok) {
    $("#form-msg").textContent = "Add at least a photo or a video, or try the sample board.";
    gsap.fromTo("#drop", { x: -6 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
    return;
  }
  const fd = commonFields(new FormData());
  fd.append("mode", "live");
  if (app.reuse) fd.append("from", app.reuse.sid);
  app.files.photos.forEach(f => fd.append("photos", f));
  if (app.files.video) fd.append("video", app.files.video);
  start(fd, prefs.research === "off" ? "Starting the agents…" : "Starting the agents and web tools…");
});
$$("[data-sample]").forEach(b => b.addEventListener("click", () => {
  const fd = commonFields(new FormData());
  fd.append("mode", "demo");
  fd.append("sample", b.dataset.sample);
  start(fd, "Loading the sample…");
}));

// ---- history: saved investigations survive restarts; runs started on a phone show up here too
const RATE = { right: "✓ right", partly: "~ partly", wrong: "✗ wrong" };
async function loadRecent() {
  try {
    const list = await (await fetch("/api/investigations")).json();
    app.history = Object.fromEntries(list.map(r => [r.id, r]));
    $("#recent").hidden = !list.length;
    $("#history-count").textContent = list.length ? `${list.length}` : "";
    $("#recent-list").innerHTML = list.map(r => `<li><button class="open" data-open="${r.id}">
      <b>${esc(r.title)}${r.verdict ? ` · ${esc(r.verdict.toLowerCase())}` : ""}${r.busy ? " · running" : ""}</b>
      <span>${r.mode === "demo" ? "sample" : "live"} · ${r.parts} parts${r.rating ? ` · <span class="rate ${r.rating}">${RATE[r.rating]}</span>` : ""}</span><span>${ago(r.created)}</span></button>
      <button class="del" data-del="${r.id}" title="Delete this investigation" aria-label="Delete ${esc(r.title)}">×</button></li>`).join("");
  } catch { /* offline */ }
}
$("#recent-list").addEventListener("click", async e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Delete this investigation and its uploaded photos and video? This can't be undone.")) return;
    const r = await fetch(`/api/investigations/${del.dataset.del}`, { method: "DELETE" });
    if (!r.ok) toast((await r.json()).error || "Couldn't delete it.");
    if (app.sid === del.dataset.del) { app.sid = null; $("#nav-run").hidden = true; }
    loadRecent();
    return;
  }
  const b = e.target.closest("[data-open]");
  if (b) openRun(b.dataset.open, app.history[b.dataset.open]?.mode || "live");
});
setInterval(() => { if (app.view === "intake" && !document.hidden) loadRecent(); }, 6000);

// ---- re-run with the earlier evidence kept
function setReuse(sid) {
  const s = app.snap || {}, h = app.history?.[sid] || {};
  app.reuse = { sid, photos: (s.photo_urls || []).filter(Boolean), video: s.video_url || null, title: h.title || `run ${sid.slice(0, 8)}` };
  app.files = { photos: [], video: null };
  $("#intake").note.value = s.note || "";
  const labels = Object.entries(MATERIALS_FALLBACK);
  app.materials = new Set((s.materials || []).map(m => labels.find(([, v]) => v === m)?.[0]).filter(Boolean));
  $("#materials-other").value = (s.materials || []).filter(m => !labels.some(([, v]) => v === m)).join(", ");
  renderMaterials(MATERIALS_FALLBACK);
  $("#reuse").hidden = false;
  $("#reuse-title").textContent = app.reuse.title;
  renderFiles();
  go("intake");
  setTimeout(() => { $("#drop").scrollIntoView({ behavior: "smooth", block: "center" }); gsap.fromTo("#drop", { backgroundColor: "#fff3d6" }, { backgroundColor: "rgba(0,0,0,0)", duration: 1.6, clearProps: "backgroundColor" }); }, 300);
}
$("#reuse-cancel").addEventListener("click", () => { app.reuse = null; $("#reuse").hidden = true; renderFiles(); });

// ================================================================== RUN

function buildStepper() {
  $("#stepper").innerHTML = STEPS.map(s => `<li data-step="${s.id}" ${s.optional ? "hidden" : ""}><span class="d"></span><span class="t">${s.name}</span></li>`).join("");
}
function setStep(id, state) {
  const li = $(`#stepper [data-step="${id}"]`);
  if (!li) return;
  app.steps[id] = state;
  li.hidden = false;
  li.className = `is-${state}`;
}

// ---- chat & activity
function chat(kind, html, who) {
  const box = $("#chat");
  const el = document.createElement("div");
  el.className = kind;
  if (who) el.dataset.who = who;
  el.innerHTML = html;
  box.appendChild(el);
  if (!reduced) gsap.from(el, { opacity: 0, y: 6, duration: 0.3 });
  const p = $("#panel-chat");
  p.scrollTop = p.scrollHeight;
  if (kind.startsWith("msg-ai") && $(".panel.is-active").dataset.panel !== "chat") {
    const n = $('[data-count="chat"]');
    n.textContent = (+n.textContent || 0) + 1;
    $('[data-tab="chat"]').classList.add("has-new");
  }
}

// ---- tabs
function setTab(name) {
  $$(".tabs button").forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on);
    if (on) b.classList.remove("has-new");
  });
  if (name === "chat") $('[data-count="chat"]').textContent = "";
  $$(".panel").forEach(p => p.classList.toggle("is-active", p.dataset.panel === name));
  const p = $(`.panel[data-panel="${name}"]`);
  if (name === "chat") p.scrollTop = p.scrollHeight;
  else if (!reduced && p.children.length) gsap.fromTo([...p.children], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.03 });
  animateBars(p);
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
function animateBars(root) {
  if (!root) return;
  $$(".bar i", root).forEach(i => gsap.fromTo(i, { width: 0 }, { width: i.dataset.w, duration: 0.9, ease: "power3.out" }));
}

// ---- summary: the answer, how sure, what's missing, what to do next
function renderSummary() {
  const s = app.snap || {}, a = s.inputs || app.inputs, P = $("#panel-summary");
  const p = s.patterns, x = s.check;
  const running = Object.entries(app.steps).find(([, v]) => v === "run")?.[0];
  let h = `<div class="answer">`;
  if (p?.top) {
    h += `<span class="conf">Most likely · ${esc(p.confidence.toLowerCase())} fit ${chips(["P1"])}</span><h3>${esc(p.top.name)}</h3><p>${esc(p.top.summary)}</p>`;
  } else if (p) {
    h += `<span class="conf">Result</span><h3>No known circuit fits</h3><p>None of the known patterns has enough clues in the evidence.</p>`;
  } else {
    h += `<span class="conf">${app.busy ? "Working" : "Waiting"}</span><h3>${esc(RUNNING[running] || (app.busy ? "Starting…" : "Not started"))}</h3>`;
  }
  if (x) {
    if (!x.available) {
      h += `<span class="verdict v-SKIPPED">NOT CHECKED</span><p>${esc(x.reason[0].toUpperCase() + x.reason.slice(1))}.</p>`;
    } else if (x.verdict === "INFERRED") {
      const inf = x.inferred;
      h += `<span class="verdict v-INFERRED">INFERRED</span><p class="note">${esc(inf.text)}. It counts only once you confirm it: tell GENESIS what the label says.</p>`;
    } else {
      const meas = x.measured.frequency_hz, pred = x.predicted.frequency_hz, tol = x.tolerance_pct / 100;
      const lo = Math.min(meas * (1 - tol * 2.2), pred * 0.85), hi = Math.max(meas * (1 + tol * 2.2), pred * 1.15);
      const pc = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      const side = v => (pc(v) > 78 ? "is-right" : pc(v) < 22 ? "is-left" : "");
      h += `<span class="verdict v-${x.verdict}">${x.verdict}</span>
        <div class="readouts"><div><span>Parts predict ${chips(["X1"])}</span><b>${fmtHz(pred)}</b></div><div><span>Video measured ${chips([x.measured.region])}</span><b>${fmtHz(meas)}</b></div></div>
        <div class="gauge" aria-label="Prediction against the tolerance band"><span class="track"></span>
          <span class="band" style="left:${pc(meas * (1 - tol))}%;right:${100 - pc(meas * (1 + tol))}%"></span>
          <span class="mk ${side(meas)}" style="left:${pc(meas)}%"><span>measured</span></span>
          <span class="mk pred ${side(pred)}" style="left:${pc(pred)}%"><span>predicted · ${x.error_pct}% off (±${x.tolerance_pct}% allowed)</span></span></div>`;
      if (x.ambiguity) h += `<p class="note">${esc(x.ambiguity)}</p>`;
      for (const t of x.suggestions || []) h += `<p class="note is-red">${esc(t.text)} ${chips([t.component])}</p>`;
    }
  }
  h += `</div>`;
  if (p?.supporting?.length) {
    h += `<section class="sec"><h4 class="sec-title"><span>Also on the board</span></h4>` +
      p.supporting.map(r => `<div class="note-line"><b>${esc(r.name)}</b> <span>${esc(r.summary)}</span></div>`).join("") + `</section>`;
  }
  if (app.saved) {
    h += `<div class="saved-note sec"><span>Saved run: the conversation ended when the server restarted.</span>
      <button class="link" data-rerun>${app.mode === "demo" ? "Try a sample again" : "Re-run with this evidence"} →</button></div>`;
  }

  const U = s.unknowns;
  if (U?.length) {
    h += `<section class="sec"><h4 class="sec-title"><span>Next steps</span><span>${U.length}</span></h4><ol class="next">` +
      U.map(u => `<li><div><p>${esc(u.text)}. ${chips([u.id, ...(u.ev || [])])}</p>${u.ask ? `<div class="do">${esc(u.ask)}</div>` : ""}${u.with ? `<span class="with">with what you have</span>` : ""}
        ${u.sketch ? `<div class="sk"><a class="link" href="/api/investigations/${app.sid}/sketch?kind=${u.sketch.kind}&board=${u.sketch.board}" download>${BOARD_LABEL[u.sketch.board] || "Board"} ${u.sketch.kind === "voltage" ? "voltage logger" : "blink-rate counter"} sketch (.ino)</a></div>` : ""}</div></li>`).join("") +
      `</ol></section>`;
  }

  if (a?.items) {
    const mark = { ok: "✓", warn: "!", miss: "–" };
    const rows = a.items.slice(0, 3).map(i => {
      const st = !i.given ? "miss" : i.impact ? "warn" : "ok";
      return `<li class="${st}"><span class="mark">${mark[st]}</span><span><b>${i.label}</b> <small>${esc(i.impact || i.detail)}</small></span></li>`;
    });
    const extra = a.items.slice(3).filter(i => i.given).map(i => `<li class="ok"><span class="mark">✓</span><span><b>${i.label}</b> <small>${esc(i.detail)}</small></span></li>`);
    h += `<section class="sec"><h4 class="sec-title"><span>Evidence you gave</span><span>${a.evidence} of 3</span></h4><ul class="given">${rows.join("")}${extra.join("")}</ul>
      <p class="mono" style="font-size:12px;margin:8px 0 0">${esc(a.verdict)}</p>
      ${a.gaps?.length ? `<button class="link" style="margin-top:8px" data-add-evidence>${app.mode === "demo" ? "Try a different sample" : "Add the missing evidence and run again"} →</button>` : ""}</section>`;
  }

  const ranked = (p?.ranked || []).filter(r => r.role === "function").slice(0, 4);
  if (ranked.length > 1) {
    h += `<section class="sec"><h4 class="sec-title"><span>Candidates</span><span>score</span></h4><ul class="fits">` +
      ranked.map(r => `<li><span>${esc(r.name)}</span><b>${Math.round(r.score * 100)}%</b><span class="bar"><i data-w="${Math.round(r.score * 100)}%"></i></span></li>`).join("") + `</ul></section>`;
  }
  if (s.skeptic) {
    const fb = app.feedback || {};
    h += `<section class="sec feedback" id="feedback"><h4 class="sec-title"><span>Was this right?</span><span>${fb.rating ? "thanks, saved" : "helps improve GENESIS"}</span></h4>
      <div class="row">${["right", "partly", "wrong"].map(k => `<button class="btn btn-small btn-ghost" data-rate="${k}" aria-pressed="${fb.rating === k}">${{ right: "Yes", partly: "Partly", wrong: "No" }[k]}</button>`).join("")}</div>
      <textarea id="fb-note" maxlength="1000" placeholder="What was wrong or missing? (optional)">${esc(fb.note || "")}</textarea>
      <button class="link" data-rate-save style="justify-self:start">Save feedback</button></section>`;
  }
  P.innerHTML = h;
  animateBars(P);
}
async function sendFeedback(rating) {
  const note = $("#fb-note")?.value || "";
  const r = await fetch(`/api/investigations/${app.sid}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, note }) });
  if (!r.ok) { toast("Couldn't save the feedback."); return; }
  app.feedback = { rating, note };
  renderSummary();
  toast("Feedback saved with this investigation.");
}
$("#panel-summary").addEventListener("click", e => {
  const rate = e.target.closest("[data-rate]");
  if (rate) { sendFeedback(rate.dataset.rate); return; }
  if (e.target.closest("[data-rate-save]")) { if (app.feedback?.rating) sendFeedback(app.feedback.rating); else toast("Pick Yes, Partly or No first."); return; }
  if (e.target.closest("[data-rerun]")) { app.mode === "demo" ? go("intake") : setReuse(app.sid); return; }
  if (!e.target.closest("[data-add-evidence]")) return;
  if (app.mode !== "demo") { setReuse(app.sid); return; }
  go("intake");
  setTimeout(() => { $("#drop").scrollIntoView({ behavior: "smooth", block: "center" }); gsap.fromTo("#drop", { backgroundColor: "#fff3d6" }, { backgroundColor: "#f5f3ee", duration: 1.6 }); }, 300);
});

// ---- parts
function cropStyle(c) {
  if (!c.image_url || !Array.isArray(c.box)) return "";
  let [y0, x0, y1, x1] = c.box;
  const py = (y1 - y0) * 0.35 + 20, px = (x1 - x0) * 0.35 + 20;
  y0 = Math.max(0, y0 - py); y1 = Math.min(1000, y1 + py); x0 = Math.max(0, x0 - px); x1 = Math.min(1000, x1 + px);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const pos = (a, b) => (b >= 1000 ? 0 : (a / (1000 - b)) * 100);
  return `background-image:url('${c.image_url}');background-size:${(1000 / bw) * 100}% ${(1000 / bh) * 100}%;background-position:${pos(x0, bw)}% ${pos(y0, bh)}%`;
}
function renderParts() {
  const s = app.snap, P = $("#panel-parts"), comps = s?.components || [];
  $('[data-count="parts"]').textContent = comps.length || "";
  if (!comps.length) { P.innerHTML = empty("No parts yet", s?.observed ? "The observer reported no parts." : "Parts are read after the video is measured."); return; }
  let h = `<section class="sec"><h4 class="sec-title"><span>Seen on the board</span><span>${comps.length}</span></h4>` + comps.map(c => {
    const val = c.display || c.marking || "";
    const basis = c.value ? `from ${c.value.basis}${c.bands && c.value.basis === "colour bands" ? ": " + c.bands.join(" ") : ""}`
      : (c.type === "resistor" || c.type.startsWith("capacitor") ? "value not read" : "");
    return `<div class="part ${app.selected === c.id ? "is-selected" : ""}" data-id="${c.id}"><div class="crop" style="${cropStyle(c)}"></div><div>
      <div class="part-head"><span class="part-id">${c.id}</span><span class="part-type">${esc(typeName(c.type))}</span><span class="part-val">${esc(val)}</span></div>
      <div class="part-meta"><span class="st-badge st-${c.status || "OBSERVED"}">${c.status || "OBSERVED"}</span><span>${esc(c.confidence || "")}</span>${basis ? `<span>${esc(basis)}</span>` : ""}${c.value?.ambiguous ? `<span>or ${esc(String(c.value.alternative))} Ω reversed</span>` : ""}</div>
      <div class="part-ev">${esc(c.evidence || "")}</div></div></div>`;
  }).join("") + `</section>`;
  const cr = s.changing_region;
  if (cr?.component_id) h += `<section class="sec"><h4 class="sec-title"><span>Changing in the video</span></h4><div class="note-line"><span class="part-id">${esc(cr.component_id)}</span><span>${esc(cr.evidence || "")}</span></div></section>`;
  if (s.board?.length) h += `<section class="sec"><h4 class="sec-title"><span>Board notes</span></h4>` + s.board.map(b => `<div class="note-line"><span class="part-id">${b.id}</span><span>${esc(b.note)}</span></div>`).join("") + `</section>`;
  if (s.datasheets?.length) h += `<section class="sec"><h4 class="sec-title"><span>Looked up</span><span>with sources</span></h4>` + s.datasheets.map(d =>
    `<div class="note-line"><span class="part-id">${d.id}</span><span><b>${esc(d.component_id)}: ${esc(d.identity)}</b><br>${esc(d.function)}${(d.key_facts || []).map(f => `<br>· ${esc(f)}`).join("")}${(d.sources || []).map(u => `<a class="src" href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join("")}</span></div>`).join("") + `</section>`;
  if (s.cannot_see?.length) h += `<section class="sec"><h4 class="sec-title"><span>Couldn't see</span></h4>` + s.cannot_see.map(t => `<div class="note-line">${esc(t)}</div>`).join("") + `</section>`;
  P.innerHTML = h;
}

// ---- report
function renderReport() {
  const s = app.snap, P = $("#panel-report"), sk = s?.skeptic;
  if (!sk) {
    P.innerHTML = s?.unknowns && !s?.report && app.steps.write_report === "done"
      ? empty("Report out of date", "A value changed after the report was written. Ask GENESIS to rewrite it.")
      : empty("No report yet", "Written last; every sentence must cite evidence.");
    return;
  }
  P.innerHTML = `<div class="report-head"><span>Skeptic: <b>${sk.flagged}</b> of ${sk.claims} sentences flagged</span><a class="link" style="color:var(--paper)" href="/api/investigations/${app.sid}/report.md" download>.md</a></div>` +
    sk.sections.map(sec => `<section class="r-sec"><h4>${esc(sec.title)}</h4>${sec.sentences.map(t => {
      const bad = t.flags.flatMap(f => (f.match(/doesn't exist: (.+)$/) || [, ""])[1].split(/,\s*/)).filter(Boolean);
      return `<p class="r-sent ${t.flags.length ? "is-flagged" : ""}"><span class="txt">${esc(t.text)}</span> ${chips(t.cites, bad)}${t.flags.map(f => `<span class="flag">${esc(f)}</span>`).join("")}</p>`;
    }).join("")}</section>`).join("");
}

// ---- evidence images
function renderPhotos() {
  const s = app.snap;
  const imgs = s?.images?.length ? s.images : [
    ...(s?.photo_urls || []).map((url, i) => ({ url, label: `photo ${i + 1} (uploaded)` })),
    ...(s?.keyframes || []),
  ];
  const strip = $("#photo-strip"), main = $("#photo-main");
  if (!imgs.length) { main.innerHTML = `<div class="photo-empty"><b>No images yet</b><span>Video key frames appear after measuring.</span></div>`; strip.innerHTML = ""; return; }
  app.imageIdx = Math.min(app.imageIdx, imgs.length - 1);
  const cur = imgs[app.imageIdx];
  const comps = (s?.components || []).filter(c => c.image === app.imageIdx + 1 && Array.isArray(c.box));
  main.innerHTML = `<div class="photo-frame"><img src="${cur.url}" alt="${esc(cur.label)}">${comps.map(c => {
    const [y0, x0, y1, x1] = c.box;
    return `<div class="pbox is-${(c.status || "").toLowerCase()} ${app.selected === c.id ? "is-selected" : ""}" data-id="${c.id}" style="top:${y0 / 10}%;left:${x0 / 10}%;width:${(x1 - x0) / 10}%;height:${(y1 - y0) / 10}%"><span>${c.id}</span></div>`;
  }).join("")}</div>`;
  strip.innerHTML = imgs.map((im, i) => `<button class="${i === app.imageIdx ? "is-active" : ""}" data-img="${i}"><img src="${im.url}" alt=""><span>${esc(im.label)}</span></button>`).join("");
}
$("#photo-strip").addEventListener("click", e => { const b = e.target.closest("[data-img]"); if (b) { app.imageIdx = +b.dataset.img; renderPhotos(); } });
function setStage(name) {
  app.stage = name;
  $$(".stage-tabs button").forEach(x => x.classList.toggle("is-active", x.dataset.stage === name));
  $("#photos").hidden = name !== "photos";
  $("#schem").hidden = name !== "schematic";
  $("#stage-note").textContent = { model: "Wiring not drawn in 3D: not observed", schematic: "Inferred wiring: verify each net with a continuity check",
                                   photos: "Boxes are where the observer saw each part" }[name];
  const cv = $("#stage-run canvas");
  if (cv) cv.style.visibility = name === "model" ? "visible" : "hidden";
  const tags = $("#stage-run .tags");
  if (tags) tags.hidden = name !== "model";
  if (name === "photos") renderPhotos();
  if (name === "schematic") { drawSchematic(true); if (!reduced) gsap.from("#schem .w", { strokeDasharray: "4 900", duration: 0.9, stagger: 0.01, ease: "power2.out", clearProps: "strokeDasharray" }); }
}
$(".stage-tabs").addEventListener("click", e => { const b = e.target.closest("[data-stage]"); if (b) setStage(b.dataset.stage); });

// ---- schematic and build list (connections highlighted one net at a time for replication)
let schem = { highlight() {}, svg: () => "" }, schemKey = "";
function drawSchematic(force = false) {
  const w = app.snap?.wiring || null;
  const key = JSON.stringify(w);
  if (!force && key === schemKey) return;
  schemKey = key;
  schem = renderSchematic($("#schem"), w);
  schem.highlight(app.focusNet || null);
  $$("#schem .badge").forEach(b => b.addEventListener("click", () => focusNet(b.dataset.net, true)));
}
const buildKey = () => `genesis-build-${app.sid}`;
function buildState() { try { return JSON.parse(localStorage.getItem(buildKey()) || "{}"); } catch { return {}; } }
function saveBuild(s) { try { localStorage.setItem(buildKey(), JSON.stringify(s)); } catch {} }
function focusNet(key, show = false) {
  app.focusNet = app.focusNet === key && !show ? null : key;
  schem.highlight(app.focusNet);
  $$(".netc").forEach(c => c.classList.toggle("is-on", c.dataset.net === app.focusNet));
  if (show && app.stage !== "schematic") setStage("schematic");
  if (show && $(".panel.is-active").dataset.panel !== "build") setTab("build");
  $(`.netc[data-net="${app.focusNet}"]`)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
function renderBuild() {
  const P = $("#panel-build"), w = app.snap?.wiring;
  if (!w) {
    P.innerHTML = empty("Nothing to build yet", app.snap?.patterns ? "No known circuit matched, so no wiring can be drawn. The parts list is in Parts." : "The wiring appears once a circuit is matched.");
    return;
  }
  const done = buildState();
  const total = w.nets.reduce((a, n) => a + n.pins.length, 0);
  const ticked = w.nets.reduce((a, n) => a + n.pins.filter((p, i) => done[`${n.id}:${i}`]).length, 0);
  const mb = (app.snap?.materials || []).join(" ").toLowerCase();
  const boards = [mb.includes("arduino") && "arduino", mb.includes("esp") && (mb.includes("8266") && !mb.includes("esp32") ? "esp8266" : "esp32")].filter(Boolean);
  let h = `<p class="build-basis">${esc(w.basis)}</p>
    <div class="build-bar">
      <button class="btn btn-small btn-ghost" data-step="-1">◀ Prev</button>
      <button class="btn btn-small btn-primary" data-step="1">Next connection ▶</button>
      <button class="btn btn-small btn-ghost" data-step="0">Show all</button>
      <span class="progress">${ticked} / ${total} joins done</span>
    </div>
    <section class="sec"><h4 class="sec-title"><span>Connections · each net once</span><span>${w.nets.length} nets</span></h4><ol class="nets">` +
    w.nets.map(n => {
      const all = n.pins.every((p, i) => done[`${n.id}:${i}`]);
      return `<li class="netc ${app.focusNet === n.key ? "is-on" : ""} ${all ? "is-done" : ""}" data-net="${n.key}" style="--nc:${n.color}">
        <header><b>${n.id}</b><span>${esc(n.name)}</span><small>${n.pins.length} points</small></header>
        <ul>${n.pins.map((p, i) => `<li><label><input type="checkbox" data-pin="${n.id}:${i}" ${done[`${n.id}:${i}`] ? "checked" : ""}>
          <span class="pid">${esc(p.id || p.part)}</span><span>${esc(p.pin)}</span>${p.id ? "" : `<small class="mono" style="color:var(--ink-3)">(${esc(p.part)})</small>`}</label></li>`).join("")}</ul></li>`;
    }).join("") + `</ol></section>`;
  h += `<section class="sec"><h4 class="sec-title"><span>Parts to replicate it</span><button class="link" id="find-parts">Find parts (JLCPCB, free)</button></h4>
    <table class="bom"><thead><tr><th>Role</th><th>Part</th><th>Value</th><th>Buy</th></tr></thead><tbody>` +
    Object.values(w.parts).map(p => `<tr><td>${esc(p.role)}</td><td class="m">${esc(p.id || "—")}${p.role_inferred ? " <small style='color:var(--amber)'>role inferred</small>" : ""}</td><td class="m">${esc(p.value || "")}</td>
      <td class="m" data-buy="${esc(p.id || "")}">${p.kind === "supply" ? "your supply" : ""}</td></tr>`).join("") + `</tbody></table>
    <p class="hint" id="buy-note"></p></section>`;
  if (boards.length) {
    h += `<section class="sec"><h4 class="sec-title"><span>Measure it with your board</span></h4><div class="sketches">` +
      boards.flatMap(b => [["frequency", "blink-rate counter"], ["voltage", "voltage logger"]].map(([k, t]) =>
        `<a class="btn btn-small btn-ghost" href="/api/investigations/${app.sid}/sketch?kind=${k}&board=${b}" download>${BOARD_LABEL[b]} ${t} .ino</a>`)).join("") +
      `</div><p class="hint">Each sketch includes a voltage divider sized for this circuit's supply, so the pins stay within ${boards.includes("arduino") ? "5 V" : "3.3 V"}.</p></section>`;
  }
  h += `<section class="sec"><h4 class="sec-title"><span>Notes</span></h4>${w.notes.map(t => `<div class="note-line">${esc(t)}</div>`).join("")}
    ${w.missing?.length ? `<div class="note-line" style="color:var(--signal-ink)">Not seen on the board, needed to replicate: ${esc(w.missing.join(", "))}</div>` : ""}
    <div class="build-bar" style="margin-top:12px"><button class="btn btn-small btn-ghost" id="dl-svg">Schematic .svg</button><a class="btn btn-small btn-ghost" href="/api/investigations/${app.sid}/report.md" download>Build sheet .md (with Mermaid)</a></div></section>`;
  P.innerHTML = h;
  if (app.sourcing) showSourcing(app.sourcing);
}
$("#panel-build").addEventListener("change", e => {
  const k = e.target.dataset.pin;
  if (!k) return;
  const s = buildState();
  s[k] = e.target.checked; saveBuild(s);
  renderBuild();
});
$("#panel-build").addEventListener("mouseover", e => { const c = e.target.closest(".netc"); if (c && app.stage === "schematic") schem.highlight(c.dataset.net); });
$("#panel-build").addEventListener("mouseleave", () => schem.highlight(app.focusNet || null));
$("#panel-build").addEventListener("click", async e => {
  const step = e.target.closest("[data-step]");
  const w = app.snap?.wiring;
  if (step && w) {
    const d = +step.dataset.step;
    if (d === 0) { app.focusNet = null; schem.highlight(null); $$(".netc").forEach(c => c.classList.remove("is-on")); return; }
    const keys = w.nets.map(n => n.key);
    const i = keys.indexOf(app.focusNet);
    focusNet(keys[(i + d + keys.length) % keys.length] ?? keys[0], true);
    return;
  }
  if (e.target.closest("#dl-svg")) {
    if (!$("#schem svg")) drawSchematic(true);
    const blob = new Blob([schem.svg()], { type: "image/svg+xml" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `genesis-schematic-${app.sid.slice(0, 8)}.svg` });
    a.click();
    return;
  }
  if (e.target.closest("#find-parts")) {
    const b = e.target.closest("#find-parts");
    b.textContent = "Searching JLCPCB…"; b.disabled = true;
    try {
      const r = await fetch(`/api/investigations/${app.sid}/source`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled: prefs.disabled }) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "search failed");
      app.sourcing = d;
      showSourcing(d);
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = "Find parts (JLCPCB, free)"; }
    return;
  }
  const c = e.target.closest(".netc");
  if (c && !e.target.closest("label")) focusNet(c.dataset.net, true);
});
function showSourcing(d) {
  for (const it of d.items) {
    const cell = $(`[data-buy="${it.id}"]`);
    if (!cell) continue;
    const m = it.matches[0];
    cell.innerHTML = m ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.lcsc)}</a> ${esc(m.model || "")}<br><small>${esc(m.package || "")}${m.mount ? " · SMD substitute" : ""} · ${m.stock?.toLocaleString?.() ?? m.stock} in stock${m.price != null ? ` · $${(+m.price).toFixed(3)}` : ""}</small>`
      : `<small>${esc(it.note || "no match")}</small>`;
  }
  const b = $("#find-parts");
  if (b) { b.textContent = "Found via pcbparts"; b.disabled = true; }
  $("#buy-note").textContent = `Suggestions from the ${d.source}; check the package before ordering. ${d.note || ""}`;
}

// ---- selection & citations
function select(id, from) {
  app.selected = id;
  if (from !== "bench") bench.select(id);
  $$(".part").forEach(p => p.classList.toggle("is-selected", p.dataset.id === id));
  $$(".pbox").forEach(p => p.classList.toggle("is-selected", p.dataset.id === id));
  const row = $(`.part[data-id="${id}"]`);
  if (row && from !== "list") row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
bench.onSelect = id => { if (id && $(".panel.is-active").dataset.panel !== "parts") setTab("parts"); select(id, "bench"); };
$("#panel-parts").addEventListener("click", e => { const p = e.target.closest(".part"); if (p) select(app.selected === p.dataset.id ? null : p.dataset.id, "list"); });
$("#photo-main").addEventListener("click", e => { const p = e.target.closest(".pbox"); if (p) { setTab("parts"); select(p.dataset.id); } });
document.addEventListener("click", e => {
  const c = e.target.closest(".cite");
  if (!c || app.view !== "run") return;
  const ref = c.dataset.ref, k = ref[0];
  if (k === "O") { setTab("parts"); select(ref); }
  else if (k === "B" || k === "D") setTab("parts");
  else if (k === "V") scope.pulse();
  else setTab("summary");
});

// ---- suggestions for the ask box
function renderSuggest() {
  const s = app.snap, box = $("#suggest");
  if (!s || app.busy || app.pending) { box.innerHTML = ""; return; }
  const out = [];
  const x = s.check;
  if (x?.verdict === "INFERRED") out.push(`${x.inferred.component} says ${fmtF(x.inferred.standard, true)}`);
  if (s.unknowns && !s.report && app.steps.write_report === "done") out.push("Rewrite the report");
  const caps = (s.components || []).filter(c => c.type.startsWith("capacitor") && c.display);
  const res = (s.components || []).filter(c => c.type === "resistor");
  if (app.mode === "demo") {
    if (caps[0] && x?.verdict === "CONSISTENT") out.push(`${caps[0].id} is 47uF`);
  } else if (s.report) {
    if (res[1]) out.push(`What if ${res[1].id} were 22k?`);
    if (res[0]) out.push(`Why is ${res[0].id} there?`);
    out.push("What should I measure first?");
  }
  box.innerHTML = out.slice(0, 3).map(t => `<button type="button">${esc(t)}</button>`).join("");
}
$("#suggest").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  $("#ask input").value = b.textContent;
  $("#ask").requestSubmit();
});

// ---- snapshot → UI
function renderSnap(s, animate = true) {
  if (!s) {
    bench.setComponents([], { animate: false });
    scope.set(null);
    renderSummary(); renderParts(); renderReport();
    return;
  }
  bench.setComponents(s.components || [], { animate, changing: s.changing_region?.component_id || null });
  scope.set(s.video);
  const v = s.video, r = v?.regions?.find(x => x.analysis?.periodic);
  $("#scope-read").textContent = !s.video_checked ? "waiting for the video"
    : !s.video_path ? "no video given: behaviour can't be measured"
    : !v ? "the video couldn't be read"
    : v.camera_moved ? "the camera moved; measurements may be unreliable"
    : r ? `V${r.index + 1} · ${fmtHz(r.analysis.frequency_hz)} · on ${Math.round((r.analysis.duty_cycle || 0) * 100)}% · ${r.analysis.cycles} cycles · ${r.analysis.confidence}`
    : v.regions?.length ? `${v.regions.length} changing area(s), no steady rhythm` : "nothing visibly changes";
  const n = s.components?.length || 0;
  $("#stage-caption").textContent = s.observed ? `${n} part${n === 1 ? "" : "s"} placed from the observer's boxes` : s.video_checked ? "Reading the parts…" : "Measuring the video…";
  renderSummary(); renderParts(); renderReport(); renderSuggest();
  const wk = JSON.stringify(s.wiring);
  if (wk !== app.wiringKey) { app.wiringKey = wk; renderBuild(); }
  if (app.stage === "photos") renderPhotos();
  if (app.stage === "schematic") drawSchematic();
  const done = { watch_video: s.video_checked, observe_parts: s.observed, identify_parts: s.identified, match_patterns: s.patterns,
                 check_prediction: s.check, list_unknowns: s.unknowns, write_report: s.report };
  for (const [k, val] of Object.entries(done)) if (val && !["done", "run", "skip"].includes(app.steps[k])) setStep(k, "done");
}
function setStatus() {
  const el = $("#run-status");
  const [cls, text] = app.pending ? ["is-wait", "Waiting for you"] : app.busy ? ["is-busy", "Working"]
    : app.snap?.skeptic ? ["is-done", "Done · ask anything"] : ["", "Idle"];
  el.className = `status ${cls}`;
  $("span", el).textContent = text;
  $("#ask input").disabled = $("#ask button").disabled = app.busy || !!app.pending || app.saved;
  $("#ask input").placeholder = app.saved ? "Saved run: re-run it from the Summary to ask more" : "Ask GENESIS, or tell it a value: “O5 is 47uF”";
  renderSuggest();
}
function renderUsage(u) {
  const el = $("#run-usage");
  const n = k => u?.[k] || 0;
  const gem = n("gemini_lite") + n("gemini_flash");
  el.innerHTML = app.mode === "demo" ? (n("scripted") ? `<b>${n("scripted")}</b> scripted calls · free` : "")
    : [gem && `<b>${gem}</b> Gemini`, n("gemini_flash") && `(${n("gemini_flash")} Flash)`, n("groq") && `<b>${n("groq")}</b> Groq`, n("ollama") && `<b>${n("ollama")}</b> Ollama`]
      .filter(Boolean).join(" ") + (gem || n("groq") || n("ollama") ? " calls" : "");
}

// ---- lifecycle
function openRun(id, mode) {
  app.es?.close();
  const h = app.history?.[id] || {};
  Object.assign(app, { sid: id, mode, snap: null, inputs: null, steps: {}, busy: !h.saved, pending: null, selected: null, imageIdx: 0, asked: false,
                       focusNet: null, wiringKey: null, sourcing: null, saved: !!h.saved, feedback: h.rating ? { rating: h.rating } : null });
  renderUsage(null);
  $("#run-share").href = `${location.origin}/#report/${id}`;
  schemKey = "";
  setStage("model");
  renderBuild();
  $("#nav-run").hidden = false;
  $("#run-id").textContent = id.slice(0, 8);
  $("#run-mode").textContent = mode === "demo" ? "Sample · scripted models" : "Live · Gemini";
  $("#run-mode").classList.toggle("is-demo", mode === "demo");
  $("#run-md").href = `/api/investigations/${id}/report.md`;
  $("#run-json").href = `/api/investigations/${id}/evidence`;
  $("#chat").innerHTML = "";
  $('[data-count="chat"]').textContent = "";
  buildStepper();
  go("run");
  setTab("summary");
  renderSnap(null);
  if (!reduced) gsap.from([".col-main", ".col-side"], { opacity: 0, y: 16, duration: 0.6, stagger: 0.08, ease: "power3.out" });
  if (mode === "demo") chat("act", "Sample mode: the real pipeline runs on a generated board; only the model replies are scripted (no Gemini requests).");
  setStatus();
  const es = new EventSource(`/api/investigations/${id}/events`);
  app.es = es;
  es.onmessage = m => handle(JSON.parse(m.data));
}

function handle(e) {
  switch (e.type) {
    case "log": for (const l of e.lines || []) chat("act", esc(l)); break;
    case "inputs": app.inputs = e.inputs; renderSummary(); break;
    case "usage": renderUsage(e.usage); break;
    case "busy":
      app.busy = e.busy;
      if (!e.busy) bench.setScanning(false);
      setStatus(); renderSummary();
      break;
    case "call": {
      const args = Object.entries(e.args || {}).map(([k, v]) => `${k}=${esc(JSON.stringify(v))}`).join(", ");
      chat("act", `→ <b>${esc(e.name)}</b>(${args})`);
      setStep(e.name, "run");
      if (e.name === "observe_parts") bench.setScanning(true);
      renderSummary();
      break;
    }
    case "result": {
      chat("act", esc(e.text.length > 260 ? e.text.slice(0, 260) + "…" : e.text));
      const skip = (e.name === "watch_video" && /^No video/.test(e.text)) || (e.name === "check_prediction" && /not possible/.test(e.text));
      setStep(e.name, skip ? "skip" : "done");
      if (e.name === "observe_parts") bench.setScanning(false);
      break;
    }
    case "say":
      chat("msg msg-ai", citeText(e.text), "GENESIS");
      if (app.asked) setTab("chat");
      break;
    case "user": chat("msg msg-user", esc(e.text), "You"); break;
    case "state": app.snap = e.state; renderSnap(e.state); setStatus(); break;
    case "approval":
      app.pending = e.request;
      setStep("confirm_value", "wait");
      showApproval(e.request);
      setStatus();
      break;
    case "decided": chat("act", `You chose: ${esc(e.decision)}.`); break;
    case "error":
      chat("act is-err", esc(e.text));
      toast("The agent stopped with an error. See Chat for details.");
      break;
  }
}

// ---- approval
function showApproval(req) {
  const a = req.args || {};
  $("#ap-id").textContent = a.component_id;
  $("#ap-value").textContent = a.value;
  $("#ap-reason").textContent = a.reason ? `Reason: ${a.reason}` : "";
  $("#ap-edit").hidden = true;
  $("#ap-approve").textContent = "Approve";
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

// ---- ask
$("#ask").addEventListener("submit", async e => {
  e.preventDefault();
  const input = e.target.text, text = input.value.trim();
  if (!text || !app.sid) return;
  input.value = "";
  app.asked = true;
  setTab("chat");
  const r = await fetch(`/api/investigations/${app.sid}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) { toast((await r.json()).error || "Couldn't send that."); input.value = text; return; }
  app.busy = true; setStatus();
});

// ================================================================== CONTROL
let control = null;
async function loadControl() {
  try { control = await (await fetch("/api/control")).json(); } catch { control = null; }
  renderControl();
}
function serverOn(s) {
  if (prefs.disabled.includes(s.name)) return false;
  return s.default_on || prefs.enabled.includes(s.name);
}
function renderControl() {
  $$(".seg[data-pref]").forEach(seg => $$("button", seg).forEach(b => b.classList.toggle("is-on", prefs[seg.dataset.pref] === b.dataset.v)));
  if (!control) { $("#ctl-summary").textContent = "Agents and tools: server offline"; return; }
  const live = control.servers.filter(s => s.usable_now);
  const ready = live.filter(s => s.ready && serverOn(s));
  const agentsReady = control.agents.filter(a => a.ready).length;
  $("#ctl-summary").textContent = `${agentsReady} of ${control.agents.length} agents ready · research ${prefs.research}` +
    (prefs.research !== "off" ? ` (${ready.map(s => s.name).join(", ") || "no search server ready"})` : "") +
    ` · backup ${prefs.backup === "on" && control.fallbacks.length ? "on" : "off"}`;
  $("#ctl-agents-count").textContent = `${agentsReady} / ${control.agents.length} ready`;
  $("#ctl-agents").innerHTML = control.agents.map(a => `<li><span class="lamp ${a.ready ? "ok" : "warn"}"></span>
    <span><b>${esc(a.name)}</b><small>${esc(a.job)}${a.detail ? ` · ${esc(a.detail)}` : ""}</small></span><span class="kind">${esc(a.kind)} · ${esc(a.model)}</span></li>`).join("");
  const order = s => (s.usable_now ? 0 : s.role === "dev" || s.role === "none" ? 2 : 1);
  $("#ctl-servers").innerHTML = [...control.servers].sort((a, b) => order(a) - order(b)).map(s => {
    const on = serverOn(s), later = !s.usable_now;
    return `<li class="${later ? "is-later" : ""}"><span class="lamp ${s.ready && on ? "ok" : s.ready ? "" : "warn"}"></span>
      <span><b>${esc(s.name)}</b> <span class="tag">${esc(s.role)}</span><small>${esc(s.purpose)} · ${esc(s.free)}</small>
      <small>${later ? (s.name === "pcbparts" ? "used on demand by Build → Find parts" : esc(s.role_text || "not used by GENESIS yet")) : s.ready ? (on ? "ready" : "turned off") : esc(s.reason)}</small></span>
      <button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(s.name)}" data-server="${esc(s.name)}" ${later && s.name !== "pcbparts" ? "disabled" : ""}></button></li>`;
  }).join("");
}
function openControl(open) {
  const d = $("#control");
  $("#control-btn").setAttribute("aria-expanded", open);
  if (open) {
    d.hidden = false;
    loadControl();
    gsap.fromTo(d, { xPercent: 100 }, { xPercent: 0, duration: 0.45, ease: "expo.out" });
  } else {
    gsap.to(d, { xPercent: 100, duration: 0.3, ease: "power2.in", onComplete: () => (d.hidden = true) });
  }
}
$("#control-btn").addEventListener("click", () => openControl($("#control").hidden));
$("#control-close").addEventListener("click", () => openControl(false));
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#control").hidden) openControl(false); });
document.addEventListener("click", e => { if (e.target.closest("[data-open-control]")) openControl(true); });
$("#control").addEventListener("click", e => {
  const b = e.target.closest(".seg[data-pref] button");
  if (b) {
    const key = b.closest(".seg").dataset.pref;
    prefs[key] = b.dataset.v; savePrefs(); applyPrefs(); renderControl();
    return;
  }
  const sw = e.target.closest("[data-server]");
  if (sw && !sw.disabled) {
    const s = control.servers.find(x => x.name === sw.dataset.server);
    const on = !serverOn(s);
    prefs.disabled = prefs.disabled.filter(n => n !== s.name);
    prefs.enabled = prefs.enabled.filter(n => n !== s.name);
    if (!on) prefs.disabled.push(s.name); else if (!s.default_on) prefs.enabled.push(s.name);
    savePrefs(); renderControl();
  }
});
function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.layout = prefs.layout;
  bench.setPrefs({ labels: prefs.labels === "on", rotate: prefs.rotate === "on" });
  if (app.stage === "schematic") drawSchematic(true);
}
$("#theme-btn").addEventListener("click", () => {
  prefs.theme = prefs.theme === "night" ? "paper" : "night";
  savePrefs(); applyPrefs(); renderControl();
  gsap.fromTo("body", { opacity: 0.85 }, { opacity: 1, duration: 0.4 });
});
loadControl();

// ---- usage today (Control)
async function loadUsage() {
  try {
    const u = await (await fetch("/api/usage")).json();
    const t = u.today || {};
    const rows = [["Gemini 3.1 Flash-Lite", t.gemini_lite || 0, ""], ["Gemini 3.8 Flash", t.gemini_flash || 0, ` of ${u.flash_free_per_day} free`],
                  ["Groq backup", t.groq || 0, ""], ["Ollama (local)", t.ollama || 0, ""]];
    $("#ctl-usage").innerHTML = rows.map(([n, v, x]) => `<li><span class="lamp ${v ? "ok" : ""}"></span><span><b>${n}</b></span><span class="kind">${v} calls${x}</span></li>`).join("");
  } catch { $("#ctl-usage").innerHTML = ""; }
}
$("#control-btn").addEventListener("click", loadUsage);

// ================================================================== PHONE CAPTURE
$("#phone-btn").addEventListener("click", async () => {
  const body = $("#phone-body");
  let lan = null;
  try { lan = (await (await fetch("/api/info")).json()).lan_url; } catch {}
  if (lan) {
    body.innerHTML = `<div class="qr" id="qr"></div><p class="phone-url">${esc(lan)}</p>
      <ol class="phone-steps"><li>Phone on the same Wi-Fi as this computer.</li><li>Scan the code with the camera app.</li>
      <li>Tap the drop zone to take the photos and the video, then run it.</li><li>The run appears in History here as well.</li></ol>`;
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, lan, { width: 200, margin: 1, color: { dark: "#151515", light: "#ffffff" } });
    $("#qr").appendChild(canvas);
  } else {
    body.innerHTML = `<p>Phone capture needs the bench to be reachable on your Wi-Fi. Restart it with:</p>
      <p><code>python -m genesis_see.web --lan</code></p>
      <p class="hint">Then open this panel again for a QR code. Anyone on that network could open the bench and use your Gemini key, so only do this on a network you trust. You can also simply copy the photos and video to this computer.</p>`;
  }
  $("#phone").hidden = false;
  gsap.fromTo(".phone-card", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" });
});
$("#phone-close").addEventListener("click", () => ($("#phone").hidden = true));

// ================================================================== SHAREABLE / PRINTABLE REPORT
async function renderPrint(id) {
  document.body.classList.add("print-mode");
  document.documentElement.dataset.theme = "paper";
  const el = $("#print-view");
  el.hidden = false;
  el.innerHTML = `<p class="hint">Loading the report…</p>`;
  let s, h;
  try {
    const [r1, r2] = await Promise.all([fetch(`/api/investigations/${id}/evidence`), fetch("/api/investigations")]);
    if (!r1.ok) throw new Error();
    s = await r1.json();
    h = (await r2.json()).find(x => x.id === id) || {};
  } catch { el.innerHTML = empty("Report not found", "It may have been deleted, or the server isn't running."); return; }
  const p = s.patterns || {}, x = s.check || {}, a = s.inputs || {}, w = s.wiring, sk = s.skeptic;
  const verdict = !x.available ? `<span class="verdict v-SKIPPED">NOT CHECKED</span> ${esc(x.reason || "")}`
    : x.verdict === "INFERRED" ? `<span class="verdict v-INFERRED">INFERRED</span> ${esc(x.inferred.text)}`
    : `<span class="verdict v-${x.verdict}">${x.verdict}</span> The parts predict ${fmtHz(x.predicted.frequency_hz)}; the video measured ${fmtHz(x.measured.frequency_hz)} (${x.error_pct}% apart, ±${x.tolerance_pct}% allowed).`;
  let html = `<div class="pv-bar"><button class="btn btn-small btn-primary" id="pv-print">Print / Save as PDF</button>
      <button class="btn btn-small btn-ghost" id="pv-copy">Copy link</button><a class="btn btn-small btn-ghost" href="/api/investigations/${id}/report.md" download>.md</a>
      <a class="btn btn-small btn-ghost" href="/">Open GENESIS</a></div>
    <article class="pv"><header class="pv-head"><div><p class="label">GENESIS reconstruction report</p><h1>${esc(p.top?.name || "Investigation")}</h1></div>
      <div class="meta">${id.slice(0, 8)}<br>${h.created ? new Date(h.created * 1000).toLocaleString() : ""}<br>${h.mode === "demo" ? "sample · scripted models" : "live · Gemini"}</div></header>
    ${p.top ? `<p>${esc(p.top.summary)} <span class="mono">(${esc(p.confidence.toLowerCase())} fit)</span></p>` : ""}
    <h2>Check against the device</h2><p>${verdict}</p>`;
  if (a.items) html += `<h2>Evidence given</h2><table><tbody>${a.items.map(i => `<tr><td>${i.given ? "✓" : "–"}</td><td><b>${esc(i.label)}</b></td><td>${esc(i.impact || i.detail)}</td></tr>`).join("")}</tbody></table><p class="mono" style="font-size:12px">${esc(a.verdict || "")}</p>`;
  if (s.components?.length) html += `<h2>Parts</h2><table><thead><tr><th></th><th>Id</th><th>Part</th><th>Value / marking</th><th>Status</th></tr></thead><tbody>${s.components.map(c =>
    `<tr><td><div class="crop" style="${cropStyle(c)}"></div></td><td class="mono">${c.id}</td><td>${esc(typeName(c.type))}</td><td class="mono">${esc(c.display || c.marking || "")}</td><td>${esc(c.status || "")} ${esc(c.confidence || "")}</td></tr>`).join("")}</tbody></table>`;
  if (w) {
    html += `<h2>Wiring to replicate</h2><p class="hint">${esc(w.basis)}</p><div class="schem-print" id="pv-schem"></div>
      <table><thead><tr><th>Net</th><th>Join these</th><th>Done</th></tr></thead><tbody>${w.nets.map(n =>
      `<tr><td><span class="swatch" style="background:${n.color}"></span><b>${n.id}</b> ${esc(n.name)}</td><td>${n.pins.map(q => `${esc(q.id || q.part)} ${esc(q.pin)}`).join("<br>")}</td><td>☐</td></tr>`).join("")}</tbody></table>
      <ul>${w.notes.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
  }
  if (s.unknowns?.length) html += `<h2>Still unknown, and what to do next</h2><ol>${s.unknowns.map(u => `<li>${esc(u.text)}.${u.ask ? ` <i>Next: ${esc(u.ask)}.</i>` : ""}</li>`).join("")}</ol>`;
  if (sk) html += `<h2>Report <span class="mono" style="font-size:11px;text-transform:none">· skeptic flagged ${sk.flagged} of ${sk.claims}</span></h2>` + sk.sections.map(sec =>
    `<h3 style="font-size:13px;margin:14px 0 4px">${esc(sec.title)}</h3>${sec.sentences.map(t => `<p class="${t.flags.length ? "flagged" : ""}">${esc(t.text)} <span class="mono" style="font-size:11px">[${t.cites.map(esc).join(", ")}]</span>${t.flags.length ? ` <span class="mono" style="font-size:11px;color:var(--signal-ink);text-decoration:none">skeptic: ${esc(t.flags.join("; "))}</span>` : ""}</p>`).join("")}`).join("");
  html += `<p class="foot">Generated by GENESIS. Models see and explain; code measures and decides; values count only once a person approves them. Wiring is inferred from the matched circuit: verify with a continuity check.</p></article>`;
  el.innerHTML = html;
  if (w) renderSchematic($("#pv-schem"), w);
  $("#pv-print").addEventListener("click", () => window.print());
  $("#pv-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); toast("Link copied."); } catch { toast(location.href); } });
  document.title = `GENESIS report · ${p.top?.name || id.slice(0, 8)}`;
}

// ================================================================== start
function intro() {
  bench.mount($("#stage-hero"), { hero: true });
  bench.setComponents(HERO_PARTS, { animate: !reduced });
  loadRecent();
  if (reduced) return;
  bench.intro();
  document.fonts.ready.then(() => {
    const split = SplitText.create("#hero-title", { type: "lines,words", mask: "lines" });
    gsap.from(split.words, { yPercent: 115, duration: 1, ease: "expo.out", stagger: 0.04, delay: 0.05 });
    gsap.from([".lede", ".intake > *"], { opacity: 0, y: 14, duration: 0.7, ease: "power3.out", stagger: 0.05, delay: 0.3 });
  });
}
const reportRoute = location.hash.match(/^#report\/([0-9a-f]{6,32})$/);
if (reportRoute) {
  renderPrint(reportRoute[1]);
} else {
  initLab();
  intro();
  if (location.hash === "#demo") $('[data-sample="full"]').click();
  else if (location.hash === "#lab") go("lab");
}
window.addEventListener("hashchange", () => { if (/^#report\//.test(location.hash) || document.body.classList.contains("print-mode")) location.reload(); });
