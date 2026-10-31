import { STATIC, openEvents, startRun } from "./static.js";   // first: on GitHub Pages it answers the API in the browser
import "./app.css";
import { gsap } from "gsap";
import QRCode from "qrcode";
import { createIcons, House, Box, Activity, Sparkles, Folder, CircuitBoard, Settings, Cpu, Undo2, Play, Plus, Share2, Camera, Layers,
  RotateCw, PanelRight, X, ChevronDown, Send, Upload, Smartphone, Image, Trash2 } from "lucide";
import { createBench, escapeHtml as esc } from "./bench3d.js";
import { createScope } from "./scope.js";
import { createChart } from "./chart.js";
import { initLab } from "./lab.js";
import { renderSchematic } from "./schematic.js";
import { renderNetlist } from "./netlist.js";

const ICONS = { House, Box, Activity, Sparkles, Folder, CircuitBoard, Settings, Cpu, Undo2, Play, Plus, Share2, Camera, Layers, RotateCw, PanelRight, X,
  ChevronDown, Send, Upload, Smartphone, Image, Trash2 };
const icons = () => createIcons({ icons: ICONS, attrs: { "aria-hidden": "true" } });
gsap.ticker.lagSmoothing(0);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- preferences
const PREF_DEFAULTS = { research: "auto", flash: "off", backup: "on", reader: "a student engineer", theme: "paper", labels: "on", rotate: "on",
                        disabled: [], enabled: [] };
const prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem("genesis-prefs") || "{}") }; } catch { return { ...PREF_DEFAULTS }; } })();
const savePrefs = () => { try { localStorage.setItem("genesis-prefs", JSON.stringify(prefs)); } catch {} };
document.documentElement.dataset.theme = prefs.theme;

const HERO_PARTS = [
  { id: "O1", type: "ic", marking: "NE555P", box: [400, 380, 520, 560] },
  { id: "O2", type: "resistor", bands: ["brown", "black", "red", "gold"], display: "1 kΩ", box: [220, 150, 280, 300] },
  { id: "O3", type: "resistor", bands: ["brown", "black", "orange", "gold"], display: "10 kΩ", box: [220, 620, 280, 770] },
  { id: "O4", type: "resistor", bands: ["yellow", "violet", "brown", "gold"], display: "470 Ω", box: [690, 620, 750, 770] },
  { id: "O5", type: "capacitor_electrolytic", display: "100 µF", box: [590, 150, 730, 290] },
  { id: "O6", type: "led", box: [410, 830, 490, 890] },
];
const STEPS = ["watch_video", "observe_parts", "match_patterns", "check_prediction", "list_unknowns", "write_report"];
const RUNNING = {
  watch_video: "Measuring the video frame by frame…", observe_parts: "Reading the parts in the images…", identify_parts: "Looking up part markings…",
  match_patterns: "Matching known circuits…", check_prediction: "Checking against the video…", list_unknowns: "Listing what can't be settled…",
  write_report: "Writing the cited report…", confirm_value: "Recording your value and re-checking…",
};
const MATERIALS = { multimeter: "Multimeter", oscilloscope: "Oscilloscope", soldering_iron: "Soldering iron", spare_resistors: "Spare resistors",
  spare_capacitors: "Spare capacitors", breadboard: "Breadboard", bench_supply: "Bench power supply", arduino: "Arduino (Uno, Nano…)",
  esp: "ESP32 or ESP8266", logic_probe: "Logic probe", magnifier: "Magnifier or macro lens" };
const BOARD_LABEL = { arduino: "Arduino", esp32: "ESP32", esp8266: "ESP8266" };
const GROUPS = { resistor: "Resistors", capacitor: "Capacitors", ic: "ICs", led: "LEDs", semi: "Semis", module: "Modules", other: "Other" };
const groupOf = t => t === "resistor" ? "resistor" : t.startsWith("capacitor") ? "capacitor" : ["ic", "voltage_regulator"].includes(t) ? "ic"
  : t === "led" ? "led" : ["transistor", "mosfet", "diode", "optocoupler"].includes(t) ? "semi"
  : ["dev_board", "sensor_module", "display", "relay"].includes(t) ? "module" : "other";
const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

const app = {
  view: "workspace", sid: null, mode: "live", es: null, snap: null, inputs: null, steps: {}, busy: false, pending: null, selected: null,
  stage: "model", imageIdx: 0, asked: false, focusNet: null, sourcing: null, saved: false, feedback: null, history: {}, renamed: false,
  files: { photos: [], video: null }, meta: new Map(), materials: new Set(), reuse: null,
  overrides: {}, undo: [], supply: null, sim: null, warnIdx: 0, filter: "all", lab: "sim", assistTab: "chat", ctx: null, lastSay: "",
};

const bench = createBench();
bench.setPrefs({ labels: prefs.labels === "on", rotate: prefs.rotate === "on" });
const scope = createScope($("#scope"), levelAt => { bench.signal = levelAt || (t => ((t * 0.686) % 1 < 0.524 ? 1 : 0)); });
const chart = createChart($("#sim-canvas"), $("#sim-legend"));

// ---------------------------------------------------------------- helpers
const fmtHz = f => (f == null ? "—" : `${(+f).toFixed(3)} Hz`);
const fmtOhm = v => v >= 1e6 ? `${+(v / 1e6).toPrecision(3)} MΩ` : v >= 1e3 ? `${+(v / 1e3).toPrecision(3)} kΩ` : `${+(+v).toPrecision(3)} Ω`;
function fmtF(v, compact = false) {
  if (v == null) return "—";
  const [k, u] = [[1e-6, "µF"], [1e-9, "nF"], [1e-12, "pF"]].find(([k]) => v >= k) || [1e-12, "pF"];
  const n = +(v / k).toPrecision(3);
  return compact ? `${n}${u.replace("µ", "u")}` : `${n} ${u}`;
}
const fmtA = a => a == null ? "—" : a < 1 ? `${(a * 1000).toFixed(1)} mA` : `${a.toFixed(2)} A`;
const fmtW = w => w == null ? "—" : w < 1 ? `${(w * 1000).toFixed(0)} mW` : `${w.toFixed(2)} W`;
const typeName = t => String(t || "").replace(/^capacitor_/, "capacitor · ").replace(/_/g, " ");
const NICE = { ic: "IC", led: "LED", ldr: "LDR", mosfet: "MOSFET", dev_board: "Dev board", voltage_regulator: "Regulator", sensor_module: "Sensor module" };
const shortName = t => NICE[t] || (t.startsWith("capacitor") ? "Capacitor" : typeName(t).replace(/^./, x => x.toUpperCase()));
const citeText = text => esc(text).replace(/\[((?:[A-Z]{1,2}\d+)(?:\s*,\s*[A-Z]{1,2}\d+)*)\]/g, (_, ids) =>
  ids.split(/\s*,\s*/).map(id => `<button class="cite" data-ref="${id}">${id}</button>`).join(""));
const chips = (ids, bad = []) => (ids || []).map(id => `<button class="cite ${bad.includes(id) ? "is-bad" : ""}" data-ref="${esc(id)}">${esc(id)}</button>`).join("");
const empty = (title, line) => `<div class="empty"><b>${title}</b><span>${line}</span></div>`;
const ago = t => { const s = Date.now() / 1000 - t; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const comps = () => app.snap?.components || [];
const compById = id => comps().find(c => c.id === id);
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  gsap.fromTo(t, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 });
  clearTimeout(toast.t);
  toast.t = setTimeout(() => gsap.to(t, { opacity: 0, duration: 0.3, onComplete: () => (t.hidden = true) }), ms);
}
function cropStyle(c) {
  if (!c?.image_url || !Array.isArray(c.box)) return "";
  let [y0, x0, y1, x1] = c.box;
  const py = (y1 - y0) * 0.35 + 20, px = (x1 - x0) * 0.35 + 20;
  y0 = Math.max(0, y0 - py); y1 = Math.min(1000, y1 + py); x0 = Math.max(0, x0 - px); x1 = Math.min(1000, x1 + px);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const pos = (a, b) => (b >= 1000 ? 0 : (a / (1000 - b)) * 100);
  return `background-image:url('${c.image_url}');background-size:${(1000 / bw) * 100}% ${(1000 / bh) * 100}%;background-position:${pos(x0, bw)}% ${pos(y0, bh)}%`;
}
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ================================================================ NAVIGATION
function setView(view) {
  app.view = view;
  $$(".nav-item[data-view], .bottom-nav [data-view]").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
  $$(".view").forEach(v => (v.hidden = v.dataset.view !== view));
  const v = $(`.view[data-view="${view}"]`);
  if (!reduced) gsap.fromTo(v, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", clearProps: "transform" });
  if (view === "workspace") mountBench();
  if (view === "build") renderBuild();
  if (view === "components") renderComponentsPage();
  if (view === "lab") { renderLabSketches(); renderCalcs(); }
  if (view === "system") renderSystemPage();
  if (view === "projects") loadHistory();
  $("#ws-right").classList.remove("is-open");
}
document.addEventListener("click", e => {
  const v = e.target.closest("[data-view]");
  if (v && !v.closest(".view")) { e.preventDefault(); setView(v.dataset.view); }
  if (e.target.closest("[data-assist]")) toggleAssist(true);
  if (e.target.closest("[data-new]")) closeRun();
});
function mountBench() {
  if (app.sid) { bench.mount($("#stage-run")); renderSnap(app.snap, false); }
  else { bench.mount($("#stage-hero"), { hero: true }); bench.setComponents(HERO_PARTS, { animate: false }); }
}

// ================================================================ TOP BAR
function setTheme(t) {
  prefs.theme = t; savePrefs();
  document.documentElement.dataset.theme = t;
  $$("[data-theme-set]").forEach(b => b.classList.toggle("is-on", b.dataset.themeSet === t));
  chart.redraw();
  if (app.stage === "schematic") drawStageSchematic(true);
}
$$("[data-theme-set]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
setTheme(prefs.theme);
$("#title").addEventListener("change", async e => {
  if (!app.sid) return;
  app.renamed = true;
  await post(`/api/investigations/${app.sid}/title`, { title: e.target.value });
  toast("Renamed.");
});
$("#title").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
$("#run-btn").addEventListener("click", () => (app.sid ? runSim(true) : startLive()));
$("#new-btn").addEventListener("click", closeRun);
$("#undo-btn").addEventListener("click", undoWhatIf);
function updateTop() {
  $("#run-label").textContent = app.sid ? "Simulate" : "Run";
  $("#new-btn").hidden = !app.sid;
  $("#share-btn").hidden = !app.sid;
  if (app.sid) $("#share-btn").href = `${location.origin}/#report/${app.sid}`;
  $("#undo-btn").hidden = !app.undo.length;
  const d = app.snap?.device;
  $("#device-chip").hidden = !d?.kind;
  if (d?.kind) $("#device-chip").textContent = d.kind;
}

// ================================================================ INTAKE
function renderMaterials() {
  $("#materials").innerHTML = Object.entries(MATERIALS).map(([k, v]) =>
    `<button type="button" class="chip" data-mat="${k}" aria-pressed="${app.materials.has(k)}">${esc(v)}</button>`).join("");
}
renderMaterials();
$("#materials").addEventListener("click", e => {
  const b = e.target.closest("[data-mat]");
  if (!b) return;
  app.materials.has(b.dataset.mat) ? app.materials.delete(b.dataset.mat) : app.materials.add(b.dataset.mat);
  b.setAttribute("aria-pressed", app.materials.has(b.dataset.mat));
});
function addFiles(list) {
  let rejected = 0;
  for (const f of list) {
    if (f.type.startsWith("image/")) {
      if (app.files.photos.length + (app.reuse?.photos.length || 0) >= 2) { rejected++; continue; }
      app.files.photos.push(f);
    } else if (f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi)$/i.test(f.name)) app.files.video = f;
    else rejected++;
    if (!app.meta.has(f)) inspect(f);
  }
  if (rejected) toast(`Skipped ${rejected} file${rejected > 1 ? "s" : ""}: up to 2 photos and 1 video.`);
  renderFiles();
}
async function inspect(f) {
  const url = URL.createObjectURL(f), m = { url, warn: [] };
  app.meta.set(f, m);
  if (f.type.startsWith("image/")) {
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch { m.warn.push("can't be opened"); renderFiles(); return; }
    m.dims = `${img.naturalWidth}×${img.naturalHeight}`;
    if (Math.max(img.naturalWidth, img.naturalHeight) < 1000) m.warn.push("small: fine markings may be unreadable");
    const w = 480, h = Math.round((480 * img.naturalHeight) / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
    let n = 0, s1 = 0, s2 = 0;
    for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; s1 += l; s2 += l * l; n++; }
    if (s2 / n - (s1 / n) ** 2 < 25) m.warn.push("may be blurry");
    const mean = sum / (w * h);
    if (mean < 55) m.warn.push("dark"); else if (mean > 215) m.warn.push("overexposed");
  } else {
    const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.src = url;
    await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 4000); });
    if (v.duration && isFinite(v.duration)) {
      m.dims = `${v.duration.toFixed(1)} s`;
      if (v.duration < 2) m.warn.push("under 2 s: too short"); else if (v.duration < 5) m.warn.push("short: few blink cycles");
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
  const keptRows = app.reuse ? [
    ...app.reuse.photos.map((u, i) => `<li class="file"><img class="thumb" src="${esc(u)}" alt=""><span><b>${i ? "Back photo" : "Front photo"}</b><small>kept from the earlier run</small></span><span></span></li>`),
    ...(app.reuse.video && !app.files.video ? [`<li class="file"><span class="thumb"></span><span><b>Video</b><small>kept from the earlier run</small></span><span></span></li>`] : []),
  ] : [];
  const rows = [...app.files.photos.map((f, i) => ({ f, role: i + kept ? "Back photo" : "Front photo", kind: "photo", i })),
                ...(app.files.video ? [{ f: app.files.video, role: "Video", kind: "video" }] : [])];
  $("#file-list").innerHTML = keptRows.join("") + rows.map(r => {
    const m = app.meta.get(r.f) || {}, thumb = r.kind === "photo" ? m.url : m.thumb;
    return `<li class="file">${thumb ? `<img class="thumb" src="${thumb}" alt="">` : `<span class="thumb"></span>`}
      <span><b>${r.role}</b><small>${esc(r.f.name)}${m.dims ? ` · ${m.dims}` : ""}</small>${m.warn?.length ? `<small class="warn">${esc(m.warn.join("; "))}</small>` : ""}</span>
      <span class="file-actions">${r.kind === "photo" && app.files.photos.length === 2 ? `<button type="button" class="mini" data-swap title="Swap front and back">⇅</button>` : ""}
      <button type="button" class="mini" data-remove="${r.kind}:${r.i ?? 0}" title="Remove">×</button></span></li>`;
  }).join("");
  renderReadiness();
}
$("#file-list").addEventListener("click", e => {
  if (e.target.closest("[data-swap]")) app.files.photos.reverse();
  const rm = e.target.closest("[data-remove]")?.dataset.remove;
  if (rm) { const [k, i] = rm.split(":"); k === "photo" ? app.files.photos.splice(+i, 1) : (app.files.video = null); }
  renderFiles();
});
const drop = $("#drop");
$("#files").addEventListener("change", e => { addFiles([...e.target.files]); e.target.value = ""; });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("is-drag"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("is-drag")));
drop.addEventListener("drop", e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
function readiness() {
  const kept = app.reuse ? app.reuse.photos.map(u => ({ kept: u })) : [];
  const [front, back] = [...kept, ...app.files.photos], video = app.files.video || (app.reuse?.video ? { kept: 1 } : null);
  const w = f => (f && !f.kept && app.meta.get(f)?.warn?.length ? app.meta.get(f).warn.join("; ") : "");
  const items = [
    front ? { st: w(front) ? "warn" : "ok", label: "Front photo", text: w(front) || "given" } : { st: "miss", label: "Front photo", text: video ? "missing: parts read from small video frames" : "missing" },
    back ? { st: w(back) ? "warn" : "ok", label: "Back photo", text: w(back) || "given" } : { st: "miss", label: "Back photo", text: "missing: wiring inferred, not traced" },
    video ? { st: w(video) ? "warn" : "ok", label: "Video", text: w(video) || "given" } : { st: "miss", label: "Video", text: "missing: behaviour can't be measured or checked" },
  ];
  const verdict = !front && !video ? "Add at least a photo or a video to start." : !video ? "Can identify the parts and the circuit, but can't check it against the device."
    : !front ? "Can time the device; parts will be less certain without a photo." : !back ? "Ready. A back photo would let GENESIS trace the wiring." : "Ready: front, back and video.";
  return { items, verdict, ok: !!(front || video) };
}
function renderReadiness() {
  const r = readiness(), mark = { ok: "✓", warn: "!", miss: "–" };
  $("#ready").innerHTML = r.items.map(i => `<li class="${i.st}"><span class="mark">${mark[i.st]}</span><b>${i.label}</b><span>${esc(i.text)}</span></li>`).join("");
  $("#ready-verdict").textContent = r.verdict;
}
renderReadiness();
function commonFields(fd) {
  fd.append("note", $("#note").value);
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
// POST with upload progress (fetch can't report it)
function postForm(url, fd, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total, e.total); };
    x.upload.onload = () => onProgress(1);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, d }); };
    x.onerror = () => reject(new Error("Failed to fetch"));
    x.send(fd);
  });
}
async function start(fd, label) {
  $("#form-msg").textContent = "";
  const btns = $$("#intake button, #run-btn");
  btns.forEach(b => (b.disabled = true));
  const live = fd.get("mode") === "live", box = $("#start-status"), t0 = Date.now();
  let phase = live ? "upload" : "start";
  const paint = (pct = null) => {
    $("#start-time").textContent = mmss(Date.now() - t0);
    if (phase === "upload") {
      $("#start-text").textContent = pct == null ? "Uploading…" : `Uploading your evidence · ${Math.round(pct * 100)}%`;
      $("#start-fill").style.width = `${Math.round((pct || 0) * 100)}%`;
      $("#start-hint").textContent = "Photos and video are sent to GENESIS running on this computer.";
    } else {
      $("#start-text").textContent = live ? "Starting the agents" + (prefs.research === "off" ? "…" : " and web-search tools…") : label;
      $("#start-fill").style.width = "100%";
      $("#start-hint").textContent = live
        ? "Checking the photos and video, then building the agent team. The first run can take a minute while free search tools download; later runs start in seconds."
        : "Drawing the sample board and starting the scripted agents.";
    }
  };
  box.hidden = false; paint();
  const tick = setInterval(() => paint(), 1000);
  $("#run-label").textContent = live ? "Uploading…" : "Loading…";
  try {
    const r = STATIC ? await startRun(fd) : await postForm("/api/investigations", fd, (p, total) => {
      if (phase === "upload" && p >= 1) phase = "start";
      paint(p);
      if (phase === "upload") $("#run-label").textContent = `Uploading ${Math.round(p * 100)}%`;
      else $("#run-label").textContent = "Starting…";
      if (total) $("#start-hint").textContent = phase === "upload" ? `${(total / 1048576).toFixed(1)} MB to send` : $("#start-hint").textContent;
    });
    if (!r.ok) throw new Error(r.d.error || `HTTP ${r.status}`);
    app.reuse = null; $("#reuse").hidden = true; app.files = { photos: [], video: null }; renderFiles();
    app.uploadMs = Date.now() - t0;
    openRun(r.d.id, r.d.mode);
  } catch (e) {
    $("#form-msg").textContent = e.message === "Failed to fetch" ? "The server isn't running: start it with start.ps1" : e.message;
  } finally {
    clearInterval(tick);
    box.hidden = true;
    btns.forEach(b => (b.disabled = false));
    $("#run-label").textContent = app.sid ? "Simulate" : "Run";
  }
}
function startLive() {
  if (!readiness().ok) {
    $("#form-msg").textContent = "Add at least a photo or a video, or try a sample.";
    gsap.fromTo("#drop", { x: -6 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
    return;
  }
  const fd = commonFields(new FormData());
  fd.append("mode", "live");
  if (app.reuse) fd.append("from", app.reuse.sid);
  app.files.photos.forEach(f => fd.append("photos", f));
  if (app.files.video) fd.append("video", app.files.video);
  start(fd, "Starting the agents…");
}
$("#go-live").addEventListener("click", startLive);
$$("[data-sample]").forEach(b => b.addEventListener("click", () => {
  const fd = commonFields(new FormData());
  fd.append("mode", "demo"); fd.append("sample", b.dataset.sample);
  start(fd, "Loading the sample…");
}));
function setReuse(sid) {
  const s = app.snap || {};
  app.reuse = { sid, photos: (s.photo_urls || []).filter(Boolean), video: s.video_url || null, title: $("#title").value };
  app.files = { photos: [], video: null };
  $("#note").value = s.note || "";
  const labels = Object.entries(MATERIALS);
  app.materials = new Set((s.materials || []).map(m => labels.find(([, v]) => v === m)?.[0]).filter(Boolean));
  renderMaterials();
  closeRun(false);
  $("#reuse").hidden = false;
  $("#reuse-title").textContent = app.reuse.title;
  renderFiles();
}
$("#reuse-cancel").addEventListener("click", () => { app.reuse = null; $("#reuse").hidden = true; renderFiles(); });

// ================================================================ RUN LIFECYCLE
function openRun(id, mode) {
  app.es?.close();
  const h = app.history[id] || {};
  Object.assign(app, { sid: id, mode, snap: null, inputs: null, steps: {}, busy: !h.saved, pending: null, selected: null, imageIdx: 0, asked: false,
    focusNet: null, sourcing: null, saved: !!h.saved, feedback: h.rating ? { rating: h.rating } : null, overrides: {}, undo: [], supply: null,
    sim: null, warnIdx: 0, filter: "all", ctx: null, lastSay: "", renamed: !!(h.title && h.title !== h.circuit && h.title !== "Investigation"),
    stepStart: {}, stepEnd: {}, runStart: null, runEnd: null, error: null, clockOffset: null });
  $("#title").value = h.title && h.title !== "Investigation" ? h.title : "Untitled board";
  $("#intake").hidden = true; $("#ws").hidden = false;
  $("#chat").innerHTML = ""; $("#activity").innerHTML = ""; $("#report").innerHTML = "";
  $("#supply").value = "";
  setStage("model");
  setView("workspace");
  renderSnap(null);
  if (mode === "demo") chatSys("Sample: the real pipeline runs on a generated board; only the model replies are scripted (free).");
  updateTop(); setStatus();
  const es = STATIC ? openEvents(id) : new EventSource(`/api/investigations/${id}/events`);
  app.es = es;
  es.onmessage = m => handle(JSON.parse(m.data));
}
function closeRun(clearReuse = true) {
  app.es?.close();
  Object.assign(app, { sid: null, snap: null, busy: false, pending: null, overrides: {}, undo: [] });
  if (clearReuse) { app.reuse = null; $("#reuse").hidden = true; }
  $("#title").value = "Untitled board";
  $("#ws").hidden = true; $("#intake").hidden = false;
  $("#progress").hidden = true; $("#usage").textContent = ""; $("#ctx-chip").hidden = true;
  toggleAssist(false);
  setView("workspace");
  updateTop();
}
// server time of an event in ms; the offset is learnt from events that arrive live (smallest delay seen)
const evMs = e => e.ts ? e.ts * 1000 : Date.now();
const serverNow = () => Date.now() - (app.clockOffset ?? 0);
function handle(e) {
  if (e.ts) app.clockOffset = Math.min(app.clockOffset ?? Infinity, Date.now() - e.ts * 1000);
  switch (e.type) {
    case "log": for (const l of e.lines || []) activity(esc(l)); break;
    case "inputs": app.inputs = e.inputs; renderResult(); break;
    case "usage": renderUsage(e.usage); break;
    case "busy":
      app.busy = e.busy;
      if (e.busy) { app.error = null; if (!app.runStart || app.runEnd) { app.runStart = evMs(e); app.runEnd = null; } }
      else { bench.setScanning(false); app.runEnd = evMs(e); }
      setStatus();
      break;
    case "call": {
      const args = Object.entries(e.args || {}).map(([k, v]) => `${k}=${esc(JSON.stringify(v))}`).join(", ");
      activity(`→ <b>${esc(e.name)}</b>(${args})`);
      app.steps[e.name] = "run";
      app.stepStart[e.name] = evMs(e);
      if (e.name === "observe_parts") bench.setScanning(true);
      setStatus();
      break;
    }
    case "result": {
      activity(esc(e.text.length > 300 ? e.text.slice(0, 300) + "…" : e.text));
      const skipped = (e.name === "watch_video" && /^No video/.test(e.text)) || (e.name === "check_prediction" && /not possible/.test(e.text));
      app.steps[e.name] = skipped ? "skip" : "done";
      app.stepEnd[e.name] = evMs(e);
      if (e.name === "observe_parts") bench.setScanning(false);
      setStatus();
      break;
    }
    case "say":
      chat("ai", citeText(e.text));
      app.lastSay = e.text; renderResult();
      if (app.asked) toggleAssist(true, "chat");
      break;
    case "user": chat("user", esc(e.text)); break;
    case "state": app.snap = e.state; renderSnap(e.state); setStatus(); break;
    case "approval": app.pending = e.request; showApproval(e.request); setStatus(); break;
    case "decided": activity(`You chose: ${esc(e.decision)}.`); break;
    case "error": app.error = e.text; activity(esc(e.text), true); toast("The agent stopped with an error: see Assistant › Activity."); renderSteps(); break;
  }
}
function setStatus() {
  const done = STEPS.filter(s => app.steps[s] === "done").length;
  const running = Object.entries(app.steps).find(([, v]) => v === "run")?.[0];
  const p = $("#progress");
  p.hidden = !app.sid;
  $("#progress-text").textContent = app.pending ? "Waiting for your approval" : app.busy ? (RUNNING[running] || "Starting…")
    : app.snap?.skeptic ? "Done · ask anything" : app.saved ? "Saved investigation" : "Idle";
  $("#progress-fill").style.width = `${app.snap?.skeptic && !app.busy ? 100 : Math.round((done / STEPS.length) * 100)}%`;
  $("#ask-input").disabled = app.busy || !!app.pending || app.saved || !app.sid;
  $("#ask-input").placeholder = !app.sid ? "Start an investigation to ask Genesis…" : app.saved ? "Saved run: re-run it to ask more" : "Ask Genesis anything…";
  renderSuggest();
  renderSteps();
}
// ---- step tracker: every step, which one is running, what each finished one found, and how long it takes
const TRACK = [
  { id: "upload", label: "Upload" },
  { id: "watch_video", label: "Measure video" },
  { id: "observe_parts", label: "Read parts" },
  { id: "identify_parts", label: "Look up", optional: true },
  { id: "match_patterns", label: "Match circuit" },
  { id: "check_prediction", label: "Check" },
  { id: "list_unknowns", label: "Unknowns" },
  { id: "write_report", label: "Report" },
  { id: "simulate", label: "Simulate" },
];
const secs = ms => ms < 60000 ? `${(Math.max(0, ms) / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : mmss(ms);
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function stepFound(id) {
  const s = app.snap || {}, a = s.inputs || app.inputs;
  switch (id) {
    case "upload": return a ? `${a.evidence} of 3 given${app.uploadMs && !app.saved ? ` · ${mmss(app.uploadMs)}` : ""}` : "";
    case "watch_video": {
      if (!s.video_checked) return "";
      if (!s.video_path) return "no video";
      const r = s.video?.regions?.find(x => x.analysis?.periodic);
      return r ? `${r.analysis.frequency_hz.toFixed(2)} Hz` : s.video ? "no steady blink" : "unreadable";
    }
    case "observe_parts": return s.observed ? `${comps().length} parts` : "";
    case "identify_parts": return s.identified ? `${(s.datasheets || []).length} found` : "";
    case "match_patterns": return s.patterns ? (s.patterns.top ? s.patterns.top.name.replace(/\s*\(.*\)$/, "") : "no match") : "";
    case "check_prediction": return s.check ? (s.check.available ? s.check.verdict.toLowerCase() : "not possible") : "";
    case "list_unknowns": return s.unknowns ? `${s.unknowns.length} open` : "";
    case "write_report": return s.skeptic ? `${s.skeptic.flagged}/${s.skeptic.claims} flagged` : "";
    case "simulate": {
      const sim = app.sim;
      if (!sim) return "";
      if (!sim.available) return "no model";
      const n = (sim.warnings || []).filter(w => w.level !== "info").length;
      return n ? `${n} warning${n > 1 ? "s" : ""}` : "all OK";
    }
  }
  return "";
}
function stepState(id) {
  const s = app.snap || {};
  if (id === "upload") return app.sid ? "done" : "";
  if (id === "simulate") return app.sim ? (app.sim.available ? "done" : "skip") : app.snap?.skeptic ? "skip" : "";
  const st = app.steps[id];
  if (st === "run" && app.busy) return "run";
  if (st === "skip" || (id === "watch_video" && s.video_checked && !s.video_path) || (id === "check_prediction" && s.check && !s.check.available)) return "skip";
  if (st === "done" || st === "run") return "done";
  return "";
}
function renderSteps() {
  if (!app.sid) return;
  const steps = TRACK.filter(t => !t.optional || app.steps[t.id]);
  const running = steps.find(t => stepState(t.id) === "run");
  const idx = running ? steps.indexOf(running) + 1 : 0;
  $("#rs-steps").innerHTML = steps.map((t, i) => {
    const st = stepState(t.id), found = stepFound(t.id);
    const live = st === "run" && app.stepStart[t.id] ? ` · ${mmss(serverNow() - app.stepStart[t.id])}` : "";
    const took = st === "done" && app.stepStart[t.id] && app.stepEnd[t.id] ? ` · ${secs(app.stepEnd[t.id] - app.stepStart[t.id])}` : "";
    return `<li class="rs-step is-${st || "todo"}" title="${esc(t.label)}${found ? `: ${esc(found)}` : ""}"><span class="rs-dot">${st === "done" ? "✓" : st === "skip" ? "–" : i + 1}</span>
      <b>${esc(t.label)}</b><small>${st === "run" ? `working${live}` : esc(found || (st === "skip" ? "skipped" : "")) + took}</small></li>`;
  }).join("");
  const spin = $("#rs-spin"), strip = $("#runstrip");
  let title, sub = "", cls = "";
  if (app.error && !app.busy) { title = "Stopped with an error"; sub = "see Assistant › Activity"; cls = "is-err"; }
  else if (app.pending) { title = "Waiting for your approval"; sub = `${app.pending.args?.component_id} = ${app.pending.args?.value}`; cls = "is-wait"; }
  else if (app.busy && running) { title = `Step ${idx} of ${steps.length} · ${RUNNING[running.id] || running.label}`; }
  else if (app.busy) { title = app.steps.write_report === "done" ? "Genesis is answering…" : "Genesis is planning the next step…"; sub = "the coordinator decides what evidence to gather next"; }
  else if (app.snap?.skeptic) { title = "Investigation complete"; sub = app.saved ? "saved run" : "ask Genesis anything, or try a what-if"; cls = "is-done"; }
  else if (app.saved) { title = "Saved investigation"; cls = "is-idle"; }
  else { title = "Starting…"; }
  $("#rs-title").textContent = title;
  $("#rs-sub").textContent = sub;
  spin.className = `rs-spin ${cls}`;
  strip.classList.toggle("is-done", cls === "is-done");
  const end = app.busy || app.pending ? serverNow() : app.runEnd;
  $("#rs-time").textContent = app.runStart && end ? (app.busy || app.pending ? mmss(end - app.runStart) : `took ${secs(end - app.runStart)}`) : "";
  const pill = $("#stage-status");
  pill.hidden = !(app.busy || app.pending);
  $("#stage-status-text").textContent = title;
  pill.querySelector(".rs-spin").className = `rs-spin ${cls}`;
}
setInterval(() => { if (app.sid && (app.busy || app.pending)) renderSteps(); }, 1000);

function renderUsage(u) {
  const n = k => u?.[k] || 0, gem = n("gemini_lite") + n("gemini_flash");
  $("#usage").textContent = app.mode === "demo" ? (n("scripted") ? `${n("scripted")} scripted calls · free` : "")
    : gem || n("groq") || n("ollama") ? `${gem} Gemini${n("groq") ? ` · ${n("groq")} Groq` : ""}${n("ollama") ? ` · ${n("ollama")} Ollama` : ""} calls` : "";
}

// ================================================================ SNAPSHOT → UI
function displayed(c) {
  const o = app.overrides[c.id];
  if (!o) return c;
  const unit = c.type === "resistor" ? (/[Ωa-z]/i.test(o) ? "" : " Ω") : (/[a-zµ]/i.test(o) ? "" : " F");
  return { ...c, display: `${o}${unit}` };
}
function renderSnap(s, animate = true) {
  updateTop();
  if (!s) {
    bench.setComponents([], { animate: false }); scope.set(null);
    app.sim = null; renderResult(); renderComponents(); renderProps(); renderWarning(); renderLab(); renderNext();
    return;
  }
  bench.setComponents(comps().map(displayed), { animate, changing: s.changing_region?.component_id || null });
  markWhatIf();
  scope.set(s.video);
  if (!Object.keys(app.overrides).length && app.supply == null) app.sim = s.simulation || null;
  if (!app.renamed && s.patterns?.top) $("#title").value = s.patterns.top.name;
  $("#stage-note").textContent = app.stage === "model" ? (s.observed ? `${comps().length} parts placed where the observer saw them · wiring not drawn in 3D` : s.video_checked ? "Reading the parts…" : "Measuring the video…") : $("#stage-note").textContent;
  renderResult(); renderComponents(); renderProps(); renderWarning(); renderLab(); renderNext(); renderReport();
  if (app.stage === "photos") renderPhotos();
  if (app.stage === "schematic") drawStageSchematic();
  if (app.view === "build") renderBuild();
  if (app.view === "components") renderComponentsPage();
  if (app.view === "system") renderSystemPage();
  if (app.stage === "layers") renderLayers($("#layers-stage"), true);
  for (const [k, v] of Object.entries({ watch_video: s.video_checked, observe_parts: s.observed, match_patterns: s.patterns, check_prediction: s.check,
    list_unknowns: s.unknowns, write_report: s.report })) if (v && app.steps[k] !== "run") app.steps[k] = "done";
}
function markWhatIf() {
  for (const it of bench.items || []) it.tag?.classList.toggle("is-whatif", !!app.overrides[it.c.id]);
}

// ---- result card
function renderResult() {
  const s = app.snap || {}, p = s.patterns, x = s.check, el = $("#result-card");
  let h = "";
  if (p?.top) {
    h += `<p class="kicker">Most likely · ${esc(p.confidence.toLowerCase())} fit</p><h2>${esc(p.top.name)}</h2><p class="sum" title="${esc(p.top.summary)}">${esc(p.top.summary)}</p>`;
  } else if (p) {
    h += `<p class="kicker">Result</p><h2>No known circuit fits</h2><p>The parts are listed, but none of the known circuits has enough clues.</p>`;
  } else {
    const running = Object.entries(app.steps).find(([, v]) => v === "run")?.[0];
    h += `<p class="kicker">${app.busy ? "Working" : "Waiting"}</p><h2>${esc(RUNNING[running] || (app.busy ? "Starting…" : "Not started"))}</h2>`;
  }
  if (x) {
    if (!x.available) h += `<span class="verdict v-SKIPPED">NOT CHECKED</span><p>${esc(x.reason)}.</p>`;
    else if (x.verdict === "INFERRED") h += `<span class="verdict v-INFERRED">INFERRED</span><p>${esc(x.inferred.text)}. Confirm it in the assistant.</p>`;
    else h += `<span class="verdict v-${x.verdict}">${x.verdict}</span><p>Parts predict <b>${fmtHz(x.predicted.frequency_hz)}</b>, video measured <b>${fmtHz(x.measured.frequency_hz)}</b> (${x.error_pct}% apart, ±${x.tolerance_pct}% allowed).</p>`;
  }
  if (p?.supporting?.length) h += `<p class="also">Also on the board: ${p.supporting.map(r => `<b>${esc(r.name)}</b>`).join(", ")}</p>`;
  const sysi = s.system;
  if (sysi?.is_system) h += `<p class="also"><b>Layers:</b> ${sysi.layers.filter(l => l.key !== "support").map(l => `${esc(l.name)} (${l.parts.length})`).join(" → ")} <button class="link" data-view-go="system">System view</button></p>`;
  if (app.lastSay) h += `<p class="also"><b>Genesis:</b> ${citeText(app.lastSay.length > 140 ? app.lastSay.slice(0, 140) + "…" : app.lastSay)}</p>`;
  if (s.skeptic) h += `<div class="result-actions"><button class="pill pill-sm" data-open-report>Read report</button><button class="pill pill-sm" data-view-go="build">Build it</button>
    ${app.saved ? `<button class="pill pill-sm" data-rerun>Re-run</button>` : ""}</div>`;
  el.innerHTML = h;
}
$("#result-card").addEventListener("click", e => {
  if (e.target.closest("[data-open-report]")) toggleAssist(true, "report");
  const g = e.target.closest("[data-view-go]"); if (g) setView(g.dataset.viewGo);
  if (e.target.closest("[data-rerun]")) app.mode === "demo" ? closeRun() : setReuse(app.sid);
});

// ---- components card
function renderComponents() {
  const list = comps(), present = [...new Set(list.map(c => groupOf(c.type)))];
  $("#comp-count").textContent = list.length ? `${list.length} parts` : "";
  if (app.filter !== "all" && !present.includes(app.filter)) app.filter = "all";
  $("#comp-filter").innerHTML = list.length ? [["all", "All"], ...present.map(g => [g, GROUPS[g]])].map(([k, v]) =>
    `<button class="chip ${app.filter === k ? "is-on" : ""}" data-filter="${k}">${v}</button>`).join("") : "";
  const shown = list.filter(c => app.filter === "all" || groupOf(c.type) === app.filter);
  $("#comp-tiles").innerHTML = shown.length ? shown.map(c => {
    const d = displayed(c);
    return `<button class="tile st-${c.status || "OBSERVED"} ${app.selected === c.id ? "is-on" : ""}" data-pick="${c.id}">
      <span class="sw" style="${cropStyle(c)}"></span><span><b>${esc(shortName(c.type))}</b><small>${c.id}${d.display || c.marking ? ` · ${esc(d.display || c.marking)}` : ""}</small></span></button>`;
  }).join("") : `<p class="muted">${app.snap?.observed ? "No parts were reported." : "Parts appear once the observer has looked."}</p>`;
}
$("#comp-filter").addEventListener("click", e => { const b = e.target.closest("[data-filter]"); if (b) { app.filter = b.dataset.filter; renderComponents(); } });
$("#comp-tiles").addEventListener("click", e => { const b = e.target.closest("[data-pick]"); if (b) select(b.dataset.pick); });

// ---- selection and properties
function select(id, fromBench = false) {
  app.selected = app.selected === id && fromBench ? null : id;
  if (!fromBench) bench.select(app.selected);
  const c = compById(app.selected);
  app.ctx = c ? { id: c.id, label: `${c.id} · ${displayed(c).display || c.marking || typeName(c.type)}` } : null;
  $("#ctx-chip").hidden = !app.ctx;
  if (app.ctx) $("#ctx-chip").innerHTML = `Context: ${esc(app.ctx.label)} <span data-clear-ctx style="cursor:pointer">×</span>`;
  renderComponents(); renderProps(); renderSuggest();
  if (app.selected) $("#props-card").scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  $$(".pbox").forEach(p => p.classList.toggle("is-selected", p.dataset.id === app.selected));
}
bench.onSelect = id => select(id, true);
$("#ctx-chip").addEventListener("click", e => { if (e.target.closest("[data-clear-ctx]")) select(null); });
function renderProps() {
  const c = compById(app.selected);
  $("#props-state").hidden = !c;
  if (!c) { $("#props-title").textContent = "Properties"; $("#props-body").innerHTML = `<p class="muted">Select a part on the board or in Components.</p>`; return; }
  const d = displayed(c), stress = app.sim?.parts?.[c.id] || {}, editable = c.type === "resistor" || c.type.startsWith("capacitor");
  const wi = app.overrides[c.id];
  $("#props-title").textContent = `${shortName(c.type)} (${c.id})`;
  const rows = [];
  if (editable) rows.push(`<div class="prow"><span>${c.type === "resistor" ? "Resistance" : "Capacitance"}</span><input id="prop-value" class="${wi ? "is-whatif" : ""}" value="${esc(wi || (c.value ? (c.type === "resistor" ? fmtOhm(c.value.value) : fmtF(c.value.value)) : ""))}" placeholder="e.g. ${c.type === "resistor" ? "470" : "47uF"}" /></div>`);
  else if (c.marking || d.display) rows.push(`<div class="prow"><span>Marking</span><b>${esc(c.marking || d.display)}</b></div>`);
  if (c.value) rows.push(`<div class="prow"><span>Read from</span><b>${esc(c.value.basis)}${c.bands && c.value.basis === "colour bands" ? `: ${esc(c.bands.join(" "))}` : ""}</b></div>`);
  if (c.value?.tolerance_pct) rows.push(`<div class="prow"><span>Tolerance</span><b>±${c.value.tolerance_pct}%</b></div>`);
  if (stress.current_a != null) rows.push(`<div class="prow"><span>Current</span><b>${fmtA(stress.current_a)}${stress.rating_a ? ` / ${fmtA(stress.rating_a)}` : ""}</b></div>`);
  if (stress.power_w != null) rows.push(`<div class="prow"><span>Power</span><b>${fmtW(stress.avg_power_w ?? stress.power_w)} / ${fmtW(stress.rating_w)}</b></div>`);
  if (stress.voltage_v != null) rows.push(`<div class="prow"><span>Voltage</span><b>${stress.voltage_v.toFixed(1)} V${stress.rating_v ? ` / ${stress.rating_v} V` : ""}</b></div>`);
  rows.push(`<div class="prow"><span>Status</span><b><span class="st st-${c.status || "OBSERVED"}">${c.status || "OBSERVED"}</span> ${esc(c.confidence || "")}</b></div>`);
  const facts = (app.snap?.datasheets || []).filter(x => x.component_id === c.id);
  $("#props-body").innerHTML = `${cropStyle(c) ? `<div class="crop" style="${cropStyle(c)}"></div>` : ""}<div class="props">${rows.join("")}</div>
    <p class="prop-ev">${esc(c.evidence || "")}</p>
    ${facts.map(x => `<p class="prop-ev"><b>${esc(x.identity)}</b> · ${esc(x.function)} ${(x.sources || []).slice(0, 2).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">source</a>`).join(" ")}</p>`).join("")}
    <div class="prop-actions">
      ${wi ? `<button class="pill pill-sm" data-record>Record ${esc(wi)}</button><button class="pill pill-sm" data-reset="${c.id}">Reset</button>` : ""}
      <button class="pill pill-sm" data-ask-about>Ask about it</button></div>
    ${wi ? `<p class="hint" style="margin-top:6px">What-if: simulated only. "Record" asks you to approve it as the real value.</p>` : ""}`;
}
$("#props-body").addEventListener("change", e => { if (e.target.id === "prop-value" && app.selected) setWhatIf(app.selected, e.target.value.trim()); });
$("#props-body").addEventListener("keydown", e => { if (e.target.id === "prop-value" && e.key === "Enter") e.target.blur(); });
$("#props-body").addEventListener("click", e => {
  const c = compById(app.selected);
  if (e.target.closest("[data-reset]")) setWhatIf(app.selected, "");
  if (e.target.closest("[data-record]") && c) ask(`${c.id} is ${app.overrides[c.id]}`);
  if (e.target.closest("[data-ask-about]")) { $("#ask-input").focus(); }
});

// ================================================================ WHAT-IF & SIMULATION
function setWhatIf(id, text) {
  const c = compById(id);
  const current = c?.value ? (c.type === "resistor" ? fmtOhm(c.value.value) : fmtF(c.value.value)) : "";
  app.undo.push({ ...app.overrides });
  if (!text || text === current) delete app.overrides[id]; else app.overrides[id] = text;
  runSim();
}
function undoWhatIf() {
  if (!app.undo.length) return;
  app.overrides = app.undo.pop();
  runSim();
  toast("Undone.");
}
async function runSim(show = false) {
  if (!app.sid) return;
  if (show) { setView("workspace"); setLab("sim"); }
  const supply = $("#supply").value ? +$("#supply").value : null;
  app.supply = supply;
  try {
    const r = await post(`/api/investigations/${app.sid}/simulate`, { overrides: app.overrides, supply });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    app.sim = d;
  } catch (e) { toast(e.message || "Simulation failed."); return; }
  app.warnIdx = 0;
  bench.setComponents(comps().map(displayed), { animate: false, changing: app.snap?.changing_region?.component_id || null });
  markWhatIf();
  renderComponents(); renderProps(); renderWarning(); renderLab(true); renderSuggest(); updateTop(); renderSteps();
  if (app.sim?.warnings?.some(w => w.level !== "info")) $("#warn-card").scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
}
$("#sim-run").addEventListener("click", () => runSim());
$("#supply").addEventListener("change", () => runSim());

// ---- warning card
function renderWarning() {
  const el = $("#warn-card"), sim = app.sim, x = app.snap?.check;
  const list = [...(sim?.warnings || [])];
  if (x?.verdict === "CONTRADICTED") for (const t of x.suggestions || []) list.push({ level: "warn", part: t.component, text: t.text, fix: null, check: true });
  if (!app.snap?.patterns) { el.hidden = true; return; }
  if (!list.length) {
    el.hidden = !sim?.available;
    el.className = "warn-card is-ok";
    el.innerHTML = `<h3>All parts within their ratings</h3><p>${Object.keys(app.overrides).length ? "With your what-if values. " : ""}Simulated at ${sim?.supply?.volts ?? "?"} V (${esc(sim?.supply?.source || "")}).</p>`;
    return;
  }
  app.warnIdx %= list.length;
  const w = list[app.warnIdx];
  el.hidden = false;
  el.className = `warn-card ${w.level === "info" ? "is-info" : ""}`;
  el.innerHTML = `<h3>${w.check ? "Check against the video" : w.level === "info" ? "Simulation note" : "Simulation warning"}
      ${list.length > 1 ? `<button class="more" data-next-warn>${app.warnIdx + 1} of ${list.length} ›</button>` : ""}</h3>
    <p>${w.part ? `<b>${esc(w.part)}</b> · ` : ""}${esc(w.text)}</p>
    ${w.fix?.component ? `<button class="fix" data-fix>Fix this: ${esc(w.fix.component)} → ${esc(w.fix.display)}</button>` : w.fix?.text ? `<p style="margin:0;font-weight:600;color:#f6e3c9">Fix: ${esc(w.fix.text)}</p>` : ""}`;
  el._w = w;
  if (!reduced) gsap.fromTo(el, { scale: 0.98 }, { scale: 1, duration: 0.3 });
}
$("#warn-card").addEventListener("click", e => {
  if (e.target.closest("[data-next-warn]")) { app.warnIdx++; renderWarning(); }
  const w = $("#warn-card")._w;
  if (e.target.closest("[data-fix]") && w?.fix) {
    setWhatIf(w.fix.component, w.fix.display.replace(/\s/g, "").replace("Ω", ""));
    toast(`Simulating ${w.fix.component} = ${w.fix.display} (${w.fix.why}).`);
    select(w.fix.component);
  }
});

// ---- lab card
function setLab(tab) {
  app.lab = tab;
  $$("#lab-tabs button").forEach(b => b.classList.toggle("is-on", b.dataset.lab === tab));
  $$(".lab-body").forEach(b => (b.hidden = b.dataset.labp !== tab));
  renderLab();
}
$("#lab-tabs").addEventListener("click", e => { const b = e.target.closest("[data-lab]"); if (b) setLab(b.dataset.lab); });
function renderLab(animate = false) {
  const sim = app.sim;
  $("#sim-badge").hidden = !sim?.available;
  $("#sim-badge").textContent = Object.keys(app.overrides).length ? "SIMULATED · WHAT-IF" : "SIMULATED";
  if (sim?.supply?.volts && !$("#supply").value) $("#supply").placeholder = sim.supply.volts;
  chart.set(sim?.available ? sim.signals : []);
  if (animate && sim?.available && !reduced) { const o = { p: 0 }; gsap.to(o, { p: 1, duration: 0.9, ease: "power2.out", onUpdate: () => chart.progress(o.p) }); }
  $("#sim-readings").innerHTML = sim?.available
    ? sim.readings.map(r => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}${r.note ? `<small>${esc(r.note)}</small>` : ""}</dd></div>`).join("")
      + `<p class="hint" title="${esc((sim.assumptions || []).join("; "))}">Assumes: ${esc((sim.assumptions || []).slice(0, 2).join("; "))}${(sim.assumptions || []).length > 2 ? "…" : ""}</p>`
    : `<p class="hint">${esc(sim?.reason || (app.snap?.patterns ? "No simulation yet." : "Simulation runs once a circuit is matched."))}</p>`;
  // measurements
  const s = app.snap || {}, v = s.video, r = v?.regions?.find(x => x.analysis?.periodic), x = s.check;
  $("#lab-meas").innerHTML = !s.video_checked ? empty("Waiting for the video", "Measurements appear after the video is analysed.")
    : !s.video_path ? empty("No video given", "Behaviour can't be measured. Add a video, or time it with the Arduino/ESP sketch in Lab.")
    : `<div class="meas-grid">${r ? [["Frequency", fmtHz(r.analysis.frequency_hz)], ["On time", `${Math.round((r.analysis.duty_cycle || 0) * 100)} %`], ["Cycles", r.analysis.cycles],
        ["Confidence", r.analysis.confidence], ["Frame rate", `${v.fps} fps`], ["Length", `${v.duration_s} s`]].map(([a, b]) => `<div class="stat"><span>${a}</span><b>${esc(String(b))}</b></div>`).join("")
        : `<div class="stat"><span>Result</span><b>${v?.camera_moved ? "camera moved" : "no steady rhythm"}</b></div>`}</div>
      ${x?.available && x.predicted ? `<p style="margin:12px 0 0"><span class="verdict v-${x.verdict}">${x.verdict}</span> parts predict ${fmtHz(x.predicted.frequency_hz)}; ${x.error_pct}% from the measurement.</p>` : ""}`;
  $("#scope-read").textContent = !s.video_checked ? "waiting for the video" : !s.video_path ? "no video given" : r
    ? `V${r.index + 1} · ${fmtHz(r.analysis.frequency_hz)} · on ${Math.round((r.analysis.duty_cycle || 0) * 100)}% · ${r.analysis.cycles} cycles · ${r.analysis.confidence}` : "nothing blinks steadily";
}

// ---- next steps card
function renderNext() {
  const el = $("#next-card"), U = app.snap?.unknowns, a = app.snap?.inputs || app.inputs;
  if (!U?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="card-head"><h3>Next steps</h3><span class="muted">${a ? `evidence ${a.evidence} of 3` : ""}</span></div>
    <ol class="next-list">${U.slice(0, 4).map(u => `<li><div>${esc(u.text)}. ${chips([u.id])}${u.ask ? `<div class="do">${esc(u.ask)}</div>` : ""}
      ${u.with ? `<span class="with">Uses what you have</span>` : ""}
      ${u.sketch ? `<div><a class="link" href="/api/investigations/${app.sid}/sketch?kind=${u.sketch.kind}&board=${u.sketch.board}" download>${BOARD_LABEL[u.sketch.board]} ${u.sketch.kind === "voltage" ? "voltage logger" : "blink counter"} (.ino)</a></div>` : ""}</div></li>`).join("")}</ol>
    ${a?.gaps?.length && !app.saved ? `<button class="link" style="margin-top:10px" data-add-evidence>${app.mode === "demo" ? "Try another sample" : "Add the missing evidence and run again"}</button>` : ""}`;
}
$("#next-card").addEventListener("click", e => { if (e.target.closest("[data-add-evidence]")) app.mode === "demo" ? closeRun() : setReuse(app.sid); });

// ================================================================ STAGE (3D / schematic / photos)
function setStage(name) {
  app.stage = name;
  $$("#stage-tabs button").forEach(b => b.classList.toggle("is-on", b.dataset.stage === name));
  $("#photos").hidden = name !== "photos";
  $("#schem").hidden = name !== "schematic";
  $("#schem-tools").hidden = name !== "schematic";
  $("#layers-stage").hidden = name !== "layers";
  const cv = $("#stage-run canvas"); if (cv) cv.style.visibility = name === "model" ? "visible" : "hidden";
  const tags = $("#stage-run .tags"); if (tags) tags.hidden = name !== "model";
  $("#stage-note").textContent = { model: "Parts placed where the observer saw them · wiring not drawn in 3D", schematic: "Inferred wiring: verify each net with a continuity check · scroll to zoom, drag to pan, double-click to fit",
    photos: "Boxes show where the observer saw each part", layers: "The device as layers: power, control, sensing, drive, communication, interface" }[name];
  if (name === "layers") renderLayers($("#layers-stage"), true);
  if (name === "photos") renderPhotos();
  if (name === "schematic") drawStageSchematic(true);
}
$("#stage-tabs").addEventListener("click", e => { const b = e.target.closest("[data-stage]"); if (b) setStage(b.dataset.stage); });
let stageSchem = { highlight() {}, svg: () => "" }, bigSchem = { highlight() {}, svg: () => "" }, schemKey = "";
// Schematics: automatic layout for any netlist (netlistsvg + ELK); hand-drawn "classic" layouts where they exist.
const CLASSIC = new Set(["astable555", "multivibrator", "mcu"]);
function activeWiring() {
  const s = app.snap || {};
  if (app.wiringSource === "traced" && s.traced) return s.traced;
  return s.wiring || s.traced || null;
}
async function schematicInto(el, w) {
  if (!w) return renderSchematic(el, null);
  if (app.schemStyle === "classic" && CLASSIC.has(w.layout)) return renderSchematic(el, w);
  try { return await renderNetlist(el, w); }
  catch (e) { console.warn("automatic layout failed, using the classic drawing", e); return renderSchematic(el, w); }
}
function schemToolsHtml() {
  const s = app.snap || {}, w = activeWiring();
  const out = [];
  if (s.wiring && s.traced) out.push(`<div class="seg"><button data-src="standard" class="${app.wiringSource !== "traced" ? "is-on" : ""}">Standard</button><button data-src="traced" class="${app.wiringSource === "traced" ? "is-on" : ""}">Traced</button></div>`);
  if (w && CLASSIC.has(w.layout)) out.push(`<div class="seg"><button data-style="auto" class="${app.schemStyle !== "classic" ? "is-on" : ""}">Auto layout</button><button data-style="classic" class="${app.schemStyle === "classic" ? "is-on" : ""}">Classic</button></div>`);
  return out.join("");
}
async function drawStageSchematic(force = false) {
  const w = activeWiring(), key = JSON.stringify([w, app.schemStyle, app.wiringSource]);
  $("#schem-tools").innerHTML = schemToolsHtml();
  if (!force && key === schemKey) return;
  schemKey = key;
  stageSchem = await schematicInto($("#schem"), w);
  stageSchem.highlight(app.focusNet);
  $$("#schem .badge").forEach(b => b.addEventListener("click", () => focusNet(b.dataset.net)));
  if (!reduced) gsap.from("#schem .w", { opacity: 0, duration: 0.6, stagger: 0.004, clearProps: "opacity" });
}
document.addEventListener("click", e => {
  const src = e.target.closest("[data-src]"), sty = e.target.closest("[data-style]");
  if (!src && !sty) return;
  if (src) app.wiringSource = src.dataset.src;
  if (sty) app.schemStyle = sty.dataset.style;
  app.focusNet = null;
  if (app.stage === "schematic") drawStageSchematic(true);
  if (app.view === "build") renderBuild();
});

// ---- the device as layers
const LAYER_COLOR = { power: "#d1342f", control: "#24324a", sensing: "#0f8a5f", drive: "#d97a00", comms: "#4f46e5", interface: "#b8336a", support: "#8b8172" };
function renderLayers(el, compact = false) {
  const sys = app.snap?.system;
  if (!sys) { el.innerHTML = empty("No layers yet", "Layers appear once the parts are read."); return; }
  const order = sys.layers.filter(l => !compact || l.key !== "support");
  el.innerHTML = `<div class="layers">${order.map((l, i) => {
    const flows = sys.flows.filter(f => f.from === l.key).map(f => `<span>${esc(LAYER_NAME_JS[f.to] || f.to)} · ${esc(f.label)}</span>`);
    return `<div class="lband" style="--lc:${LAYER_COLOR[l.key]}"><div class="lh"><b>${esc(l.name)}</b><small>${esc(l.desc)}</small></div>
      <div class="lparts">${l.parts.map(p => `<span class="lchip st-${p.status}" data-pick-go="${p.id}" style="--lc:${LAYER_COLOR[l.key]}"><b>${p.id}</b>${esc(p.label)}</span>`).join("")}</div></div>
      ${!compact && flows.length && i < order.length - 1 ? `<div class="lflow">${flows.join("")}</div>` : ""}`;
  }).join("")}</div>`;
}
const LAYER_NAME_JS = { power: "Power", control: "Control", sensing: "Sensing", drive: "Drive & motors", comms: "Communication", interface: "Interface", support: "Support" };
document.addEventListener("click", e => {
  const c = e.target.closest(".lchip[data-pick-go]");
  if (c) { setView("workspace"); select(c.dataset.pickGo); }
});
function renderSystemPage() {
  const sys = app.snap?.system;
  renderLayers($("#sys-layers"));
  if (!sys) { $("#sys-budget").innerHTML = ""; $("#sys-warnings").innerHTML = ""; return; }
  const b = sys.budget, src = b.source;
  const maxA = Math.max(b.peak_a, src?.max_a || 0, 0.05);
  const bar = (label, val, cls = "", cap = null) => `<div class="bbar"><span>${label}</span><span class="track"><i class="${cls}" style="width:${Math.min(100, val / maxA * 100)}%"></i>${cap ? `<span class="cap" style="left:${Math.min(100, cap / maxA * 100)}%" title="what the battery can give"></span>` : ""}</span><b>${val < 1 ? (val * 1000).toFixed(0) + " mA" : val.toFixed(2) + " A"}</b></div>`;
  $("#sys-budget").innerHTML = `<div class="card-head"><h3>Power budget</h3><span class="muted">${src ? esc(src.name) : "battery not seen"}</span></div>
    ${b.loads.length ? `<div class="budget-bars">${bar("Running", b.run_a, "", src?.max_a)}${bar("Start-up peak", b.peak_a, src && b.peak_a > src.max_a ? "over" : "peak", src?.max_a)}${src ? bar("Battery can give", src.max_a) : ""}</div>
      <table class="ptable"><thead><tr><th>Part</th><th>Running</th><th>Peak</th></tr></thead><tbody>${b.loads.map(l => `<tr data-pick-go="${l.id}"><td><b class="mono">${l.id}</b> ${esc(l.type.replace("_", " "))}</td><td class="mono">${(l.run_a * 1000).toFixed(0)} mA</td><td class="mono">${(l.peak_a * 1000).toFixed(0)} mA</td></tr>`).join("")}</tbody></table>
      ${b.runtime_h ? `<p class="muted" style="margin:10px 0 0">Runtime with everything running: <b>≈ ${b.runtime_h} h</b></p>` : ""}
      <p class="hint" style="margin-top:8px">Typical figures, not measurements: ${esc(sys.assumptions.slice(0, 3).join("; "))}${sys.assumptions.length > 3 ? "…" : ""}</p>`
      : `<p class="muted">No loads with known typical currents were seen.</p>`}
    ${!src ? `<p class="hint">Say the battery in the note ("2 × 18650", "4 × AA", "9 V", "USB") to check it against the loads.</p>` : ""}`;
  $("#sys-warnings").innerHTML = `<div class="card-head"><h3>Between the layers</h3><span class="muted">${sys.warnings.length} note${sys.warnings.length === 1 ? "" : "s"}</span></div>` +
    (sys.warnings.length ? sys.warnings.map(w => `<div class="swarn ${w.level}">${w.part ? `<b class="mono">${w.part}</b> · ` : ""}${esc(w.text)}${w.fix?.text ? `<span class="fixline">${esc(w.fix.text)}</span>` : ""}</div>`).join("")
      : `<p class="muted">No problems found between the layers.</p>`);
}
$("#sys-budget").addEventListener("click", e => { const r = e.target.closest("[data-pick-go]"); if (r) { setView("workspace"); select(r.dataset.pickGo); } });
function renderPhotos() {
  const s = app.snap;
  const imgs = s?.images?.length ? s.images : [...(s?.photo_urls || []).map((url, i) => ({ url, label: `photo ${i + 1}` })), ...(s?.keyframes || [])];
  if (!imgs.length) { $("#photo-main").innerHTML = empty("No images yet", "Video key frames appear after measuring."); $("#photo-strip").innerHTML = ""; return; }
  app.imageIdx = Math.min(app.imageIdx, imgs.length - 1);
  const cur = imgs[app.imageIdx];
  const boxes = comps().filter(c => c.image === app.imageIdx + 1 && Array.isArray(c.box));
  $("#photo-main").innerHTML = `<div class="photo-frame"><img src="${cur.url}" alt="${esc(cur.label)}">${boxes.map(c => {
    const [y0, x0, y1, x1] = c.box;
    return `<div class="pbox is-${(c.status || "").toLowerCase()} ${app.selected === c.id ? "is-selected" : ""}" data-id="${c.id}" style="top:${y0 / 10}%;left:${x0 / 10}%;width:${(x1 - x0) / 10}%;height:${(y1 - y0) / 10}%"><span>${c.id}</span></div>`;
  }).join("")}</div>`;
  $("#photo-strip").innerHTML = imgs.map((im, i) => `<button class="${i === app.imageIdx ? "is-on" : ""}" data-img="${i}"><img src="${im.url}" alt="${esc(im.label)}"></button>`).join("");
}
$("#photo-strip").addEventListener("click", e => { const b = e.target.closest("[data-img]"); if (b) { app.imageIdx = +b.dataset.img; renderPhotos(); } });
$("#photo-main").addEventListener("click", e => { const p = e.target.closest(".pbox"); if (p) select(p.dataset.id); });
$("#rotate-btn").addEventListener("click", e => {
  prefs.rotate = prefs.rotate === "on" ? "off" : "on"; savePrefs();
  bench.setPrefs({ rotate: prefs.rotate === "on" });
  bench.controls.autoRotate = prefs.rotate === "on";
  e.currentTarget.classList.toggle("is-on", prefs.rotate === "on");
});
$("#capture-btn").addEventListener("click", () => {
  if (app.stage === "schematic") {
    const blob = new Blob([stageSchem.svg()], { type: "image/svg+xml" });
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `genesis-schematic-${(app.sid || "board").slice(0, 8)}.svg` }).click();
    return;
  }
  bench.renderer.render(bench.scene, bench.camera);
  Object.assign(document.createElement("a"), { href: bench.renderer.domElement.toDataURL("image/png"), download: `genesis-board-${(app.sid || "board").slice(0, 8)}.png` }).click();
});
$("#panels-btn").addEventListener("click", () => $("#ws-right").classList.add("is-open"));
$("#close-panels").addEventListener("click", () => $("#ws-right").classList.remove("is-open"));

// ================================================================ BUILD
const buildKey = () => `genesis-build-${app.sid}`;
const buildState = () => { try { return JSON.parse(localStorage.getItem(buildKey()) || "{}"); } catch { return {}; } };
const saveBuild = s => { try { localStorage.setItem(buildKey(), JSON.stringify(s)); } catch {} };
function focusNet(key) {
  app.focusNet = app.focusNet === key ? null : key;
  stageSchem.highlight(app.focusNet); bigSchem.highlight(app.focusNet);
  $$(".netc").forEach(c => c.classList.toggle("is-on", c.dataset.net === app.focusNet));
}
function renderBuild() {
  const w = activeWiring(), L = $("#build-list");
  $("#schem-tools-big").innerHTML = schemToolsHtml();
  schematicInto($("#schem-big"), w).then(r => { bigSchem = r; bigSchem.highlight(app.focusNet); $$("#schem-big .badge").forEach(b => b.addEventListener("click", () => focusNet(b.dataset.net))); });
  if (!w) { L.innerHTML = empty(app.sid ? "Nothing to build yet" : "No investigation open", app.snap?.patterns ? "Wiring is drawn for 555 timers, two-transistor flashers, microcontroller outputs and robots, or from connections the observer could see." : "Open or start an investigation first."); return; }
  const done = buildState(), total = w.nets.reduce((a, n) => a + n.pins.length, 0);
  const ticked = w.nets.reduce((a, n) => a + n.pins.filter((p, i) => done[`${n.id}:${i}`]).length, 0);
  L.innerHTML = `<p class="basis">${esc(w.basis)}</p>
    <div class="build-bar"><button class="pill pill-sm" data-step="-1">‹ Prev</button><button class="btn-run" data-step="1">Next connection ›</button>
      <button class="pill pill-sm" data-step="0">Show all</button><span class="progress-label">${ticked} / ${total} joins</span></div>
    <ol class="nets">${w.nets.map(n => `<li class="netc ${app.focusNet === n.key ? "is-on" : ""} ${n.pins.every((p, i) => done[`${n.id}:${i}`]) ? "is-done" : ""}" data-net="${n.key}" style="--nc:${n.color}">
      <header><b>${n.id}</b><span>${esc(n.name)}</span><small>${n.pins.length} points</small></header>
      <ul>${n.pins.map((p, i) => `<li><label><input type="checkbox" data-pin="${n.id}:${i}" ${done[`${n.id}:${i}`] ? "checked" : ""}><span class="pid">${esc(p.id || p.part)}</span><span>${esc(p.pin)}</span></label></li>`).join("")}</ul></li>`).join("")}</ol>
    <div class="card-head" style="margin-top:16px"><h3>Notes</h3></div>${w.notes.map(t => `<p class="muted" style="margin:0 0 6px">${esc(t)}</p>`).join("")}
    ${w.missing?.length ? `<p style="color:var(--danger);font-size:13px">Not seen, needed to replicate: ${esc(w.missing.join(", "))}</p>` : ""}
    <div class="build-bar" style="margin-top:10px"><button class="pill pill-sm" data-dl-svg>Schematic .svg</button><a class="pill pill-sm" href="/api/investigations/${app.sid}/report.md" download>Build sheet .md</a></div>`;
}
$("#build-list").addEventListener("change", e => { const k = e.target.dataset.pin; if (!k) return; const s = buildState(); s[k] = e.target.checked; saveBuild(s); renderBuild(); });
$("#build-list").addEventListener("click", e => {
  const w = app.snap?.wiring, st = e.target.closest("[data-step]");
  if (st && w) {
    if (+st.dataset.step === 0) { app.focusNet = null; stageSchem.highlight(null); bigSchem.highlight(null); $$(".netc").forEach(c => c.classList.remove("is-on")); return; }
    const keys = w.nets.map(n => n.key), i = keys.indexOf(app.focusNet);
    app.focusNet = null; focusNet(keys[(i + +st.dataset.step + keys.length) % keys.length] ?? keys[0]);
    $(`.netc[data-net="${app.focusNet}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if (e.target.closest("[data-dl-svg]")) {
    Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bigSchem.svg()], { type: "image/svg+xml" })), download: `genesis-schematic-${app.sid.slice(0, 8)}.svg` }).click();
    return;
  }
  const c = e.target.closest(".netc");
  if (c && !e.target.closest("label")) focusNet(c.dataset.net);
});

// ================================================================ COMPONENTS PAGE
function renderComponentsPage() {
  const s = app.snap;
  if (!s?.components?.length) { $("#parts-full").innerHTML = empty("No parts yet", "Open or start an investigation."); $("#bom").innerHTML = ""; return; }
  $("#parts-full").innerHTML = `<div class="card-head"><h3>Seen on the board</h3><span class="muted">${s.components.length} parts</span></div>
    <table class="ptable"><thead><tr><th></th><th>Id</th><th>Part</th><th>Value</th><th>Status</th></tr></thead><tbody>${s.components.map(c => `<tr data-pick-go="${c.id}">
      <td><div class="pcrop" style="${cropStyle(c)}"></div></td><td class="mono">${c.id}</td><td>${esc(typeName(c.type))}<br><small class="muted">${esc(c.evidence || "")}</small></td>
      <td class="mono">${esc(displayed(c).display || c.marking || "—")}${c.value ? `<br><small class="muted">${esc(c.value.basis)}</small>` : ""}</td>
      <td><span class="st st-${c.status || "OBSERVED"}">${c.status || "OBSERVED"}</span><br><small class="muted">${esc(c.confidence || "")}</small></td></tr>`).join("")}</tbody></table>
    ${s.board?.length ? `<div class="card-head" style="margin-top:14px"><h3>Board notes</h3></div>${s.board.map(b => `<p class="muted" style="margin:0 0 4px"><b>${b.id}</b> ${esc(b.note)}</p>`).join("")}` : ""}
    ${s.cannot_see?.length ? `<div class="card-head" style="margin-top:14px"><h3>Couldn't see</h3></div>${s.cannot_see.map(t => `<p class="muted" style="margin:0 0 4px">${esc(t)}</p>`).join("")}` : ""}`;
  $("#bom").innerHTML = `<div class="card-head"><h3>Buy the parts</h3><button class="btn-run" id="find-parts">Find parts (JLCPCB, free)</button></div>
    <p class="hint" style="margin-bottom:10px">Live catalogue search through the free pcbparts service. Check the package before ordering.</p>
    <table class="ptable"><thead><tr><th>Id</th><th>Part</th><th>Match</th></tr></thead><tbody>${s.components.map(c => `<tr><td class="mono">${c.id}</td><td>${esc(typeName(c.type).split(" · ")[0])} ${esc(c.display || c.marking || "")}</td><td data-buy="${c.id}" class="muted">—</td></tr>`).join("")}</tbody></table>`;
  if (app.sourcing) showSourcing(app.sourcing);
}
$("#parts-full").addEventListener("click", e => { const r = e.target.closest("[data-pick-go]"); if (r) { setView("workspace"); select(r.dataset.pickGo); } });
$("#bom").addEventListener("click", async e => {
  const b = e.target.closest("#find-parts");
  if (!b) return;
  b.disabled = true; b.textContent = "Searching…";
  try {
    const r = await post(`/api/investigations/${app.sid}/source`, { disabled: prefs.disabled });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "search failed");
    app.sourcing = d; showSourcing(d);
  } catch (err) { toast(err.message); b.disabled = false; b.textContent = "Find parts (JLCPCB, free)"; }
});
function showSourcing(d) {
  for (const it of d.items) {
    const cell = $(`[data-buy="${it.id}"]`), m = it.matches[0];
    if (cell) cell.innerHTML = m ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.lcsc)}</a> ${esc(m.model || "")}<br><small>${esc(m.package || "")}${m.mount ? " · SMD substitute" : ""} · ${m.stock?.toLocaleString?.() ?? m.stock} in stock${m.price != null ? ` · $${(+m.price).toFixed(3)}` : ""}</small>` : `<small>${esc(it.note || "no match")}</small>`;
  }
  const b = $("#find-parts"); if (b) { b.disabled = true; b.textContent = "Found"; }
}

// ================================================================ LAB PAGE
function renderLabSketches() {
  const el = $("#lab-sketches");
  const boards = [["arduino", "Arduino Uno / Nano"], ["esp32", "ESP32"], ["esp8266", "ESP8266"]];
  el.innerHTML = `<div class="card-head"><h3>Measure with your board</h3></div>
    ${app.sid ? `<p class="muted" style="margin-top:0">Sketches for this investigation, with a voltage divider sized for its supply.</p>
      <div class="chips" style="margin-top:8px">${boards.flatMap(([k, n]) => [["frequency", "blink counter"], ["voltage", "voltage logger"]].map(([kind, t]) =>
        `<a class="chip" href="/api/investigations/${app.sid}/sketch?kind=${kind}&board=${k}" download>${n} · ${t}</a>`)).join("")}</div>`
      : `<p class="muted" style="margin-top:0">Open an investigation to generate sketches sized for its supply voltage.</p>`}`;
}

// ---- calculators (same maths as the agent's genesis-lab tools)
const CALCS = [
  { key: "led", title: "LED resistor", inputs: [["supply_v", "Supply (V)", "5"], ["led", "LED", "red", ["red", "orange", "yellow", "green", "blue", "white"]], ["current_ma", "Current (mA)", "12"]],
    show: d => [`<span class="big">${d.resistor}</span>`, `${d.current_ma} mA · ${d.power_mw} mW · use a ${d.rating} resistor`, `exact ${d.exact}`] },
  { key: "divider", title: "Voltage divider", inputs: [["vin", "Vin (V)", "5"], ["r2", "R2 to GND", "2k"], ["vout", "Target Vout (V)", "3.3"], ["r1", "or R1 (top)", ""]],
    show: d => [`<span class="big">${d.vout} V</span>`, `R1 ${d.r1} · R2 ${d.r2} · ${d.current_ua} µA`, d.notes?.[0] || ""] },
  { key: "ohms", title: "Ohm's law and power", inputs: [["v", "Voltage (V)", "9"], ["i_ma", "Current (mA)", ""], ["r", "Resistance", "470"]],
    show: d => [`<span class="big">${d.current_ma} mA</span>`, `${d.voltage_v} V · ${d.resistance} · ${d.power_mw} mW`, d.notes?.[0] || ""] },
  { key: "rc", title: "RC timing and filter", inputs: [["r", "R", "10k"], ["c", "C", "100uF"]],
    show: d => [`<span class="big">τ = ${fmtS(d.tau_s)}</span>`, `95 % in ${fmtS(d.t95_s)} · cutoff ${d.cutoff_hz < 1 ? d.cutoff_hz.toFixed(3) : d.cutoff_hz.toFixed(1)} Hz`, d.notes?.[0] || ""] },
  { key: "mono555", title: "555 one-shot pulse", inputs: [["r", "R", "100k"], ["c", "C", "10uF"]],
    show: d => [`<span class="big">${fmtS(d.pulse_s)}</span>`, d.formula, d.notes?.[0] || ""] },
  { key: "battery", title: "Battery runtime", inputs: [["capacity_mah", "Capacity (mAh)", "2500"], ["current_ma", "Average current (mA)", "150"], ["usable_pct", "Usable %", "80"]],
    show: d => [`<span class="big">${d.hours} h</span>`, `${d.days} days`, d.notes?.[0] || ""] },
  { key: "motors", title: "Motors, driver and battery", inputs: [["battery", "Battery", "2x18650", ["2x18650", "3x18650", "18650", "4xAA", "6xAA", "9V", "LiPo", "USB"]],
      ["driver", "Driver", "L298N", ["L298N", "TB6612", "DRV8833", "L9110", "MX1508", "L293D", "ULN2003", "BTS7960"]],
      ["motor", "Motor", "TT", ["TT", "N20", "130", "SG90 servo", "MG996R servo", "28BYJ stepper", "NEMA17 stepper"]], ["count", "How many", "2"]],
    show: d => [`<span class="big ${d.verdict === "OK" ? "verdict-ok" : "verdict-bad"}">${d.verdict}</span>`, `start-up ${d.startup_a} A of ${d.battery_max_a} A · running ${d.running_a} A · motors get ${d.motor_volts} V${d.runtime_h ? ` · ≈ ${d.runtime_h} h` : ""}`, d.notes.join("; ")] },
];
const fmtS = s => s < 1e-3 ? `${(s * 1e6).toPrecision(3)} µs` : s < 1 ? `${(s * 1000).toPrecision(3)} ms` : `${s.toPrecision(3)} s`;
let calcsBuilt = false;
function renderCalcs() {
  $("#calc-fill").hidden = !app.sid;
  if (calcsBuilt) return;
  calcsBuilt = true;
  $("#calc-grid").innerHTML = CALCS.map(c => `<article class="card calc" data-calc="${c.key}"><div class="card-head"><h3>${c.title}</h3></div>
    <div class="inputs">${c.inputs.map(([k, label, v, opts]) => `<label class="lbl">${label}${opts ? `<select class="field" data-in="${k}">${opts.map(o => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select>` : `<input class="field" data-in="${k}" value="${v}" />`}</label>`).join("")}</div>
    <div class="out"></div></article>`).join("");
  $$("#calc-grid .calc").forEach(runCalc);
}
const calcTimers = {};
async function runCalc(card) {
  const c = CALCS.find(x => x.key === card.dataset.calc), body = {};
  $$("[data-in]", card).forEach(i => (body[i.dataset.in] = i.value.trim()));
  if (c.key === "divider" && body.r1) delete body.vout;
  if (c.key === "motors") { body.motor = body.motor.replace(/ (servo|stepper)$/, " $1"); }
  try {
    const r = await post(`/api/lab/${c.key}`, body), d = await r.json();
    $(".out", card).innerHTML = d.error ? `<span class="err">${esc(d.error)}</span>` : c.show(d).filter(Boolean).map((t, i) => i ? `<span class="line">${t.startsWith("<") ? t : esc(t)}</span>` : t).join("");
  } catch { $(".out", card).innerHTML = `<span class="err">The bench server isn't reachable.</span>`; }
}
$("#calc-grid").addEventListener("input", e => {
  const card = e.target.closest(".calc"); if (!card) return;
  clearTimeout(calcTimers[card.dataset.calc]);
  calcTimers[card.dataset.calc] = setTimeout(() => runCalc(card), 250);
});
$("#calc-fill").addEventListener("click", () => {
  const s = app.snap || {}, sim = app.sim, sys = s.system, set = (calc, k, v) => { const el = $(`[data-calc="${calc}"] [data-in="${k}"]`); if (el && v != null && v !== "") el.value = v; };
  const vs = sim?.supply?.volts;
  const led = comps().find(c => c.type === "led");
  const colour = (led?.evidence || "").match(/red|orange|yellow|green|blue|white/i)?.[0]?.toLowerCase();
  set("led", "supply_v", vs); set("led", "led", colour); set("ohms", "v", vs); set("divider", "vin", vs);
  const ra = comps().find(c => c.id === s.check?.roles?.RA), cc = comps().find(c => c.id === s.check?.roles?.C);
  if (ra?.display) set("rc", "r", ra.display.replace(/\s|Ω/g, "")); if (cc?.display) set("rc", "c", cc.display.replace(/\s/g, "").replace("µ", "u"));
  const src = sys?.budget?.source;
  if (src) { set("battery", "capacity_mah", src.mah || ""); set("motors", "battery", { "2 × 18650 Li-ion (7.4 V)": "2x18650", "3 × 18650 Li-ion (11.1 V)": "3x18650", "4 × AA alkaline (6 V)": "4xAA", "6 × AA alkaline (9 V)": "6xAA", "9 V PP3 battery": "9V" }[src.name] || ""); }
  if (sys?.budget?.run_a) set("battery", "current_ma", Math.round(sys.budget.run_a * 1000));
  const drv = comps().find(c => /L298|TB6612|DRV8833|L9110|MX1508|L293|ULN2003|BTS7960/i.test(c.marking || ""));
  if (drv) set("motors", "driver", (drv.marking.match(/L298N?|TB6612|DRV8833|L9110|MX1508|L293D?|ULN2003|BTS7960/i) || [""])[0].replace(/^L298$/i, "L298N").toUpperCase().replace("L293", "L293D").replace("L293DD", "L293D"));
  const motors = comps().filter(c => c.type === "motor");
  if (motors.length) { set("motors", "count", motors.length); if (/TT|yellow/i.test(motors[0].evidence || "")) set("motors", "motor", "TT"); }
  $$("#calc-grid .calc").forEach(runCalc);
  toast("Filled from this investigation.");
});

// ================================================================ ASSISTANT
function toggleAssist(open = $("#assist-panel").hidden, tab) {
  const p = $("#assist-panel");
  if (tab) setAssistTab(tab);
  if (open === !p.hidden) return;
  p.hidden = !open;
  $("#assist-toggle").textContent = open ? "Collapse" : "Expand";
  if (open && !reduced) gsap.fromTo(p, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" });
  if (open && app.assistTab === "chat") { const b = $('[data-ap="chat"]'); b.scrollTop = b.scrollHeight; }
}
$("#assist-toggle").addEventListener("click", () => toggleAssist());
$("#assist-close").addEventListener("click", () => toggleAssist(false));
function setAssistTab(t) {
  app.assistTab = t;
  $$("#assist-tabs button").forEach(b => b.classList.toggle("is-on", b.dataset.at === t));
  $$(".assist-body").forEach(b => (b.hidden = b.dataset.ap !== t));
}
$("#assist-tabs").addEventListener("click", e => { const b = e.target.closest("[data-at]"); if (b) setAssistTab(b.dataset.at); });
function chat(who, html) {
  const el = document.createElement("div");
  el.className = `msg msg-${who}`; el.innerHTML = html;
  $("#chat").appendChild(el);
  const b = $('[data-ap="chat"]'); b.scrollTop = b.scrollHeight;
}
const chatSys = text => chat("sys", esc(text));
function activity(html, err = false) {
  const el = document.createElement("div");
  el.className = `act ${err ? "is-err" : ""}`; el.innerHTML = html;
  $("#activity").appendChild(el);
}
function renderReport() {
  const sk = app.snap?.skeptic, R = $("#report");
  if (!sk) { R.innerHTML = empty("No report yet", "Written last; every sentence must cite evidence."); return; }
  const fb = app.feedback || {};
  R.innerHTML = `<div class="report-head"><span>Skeptic flagged <b>${sk.flagged}</b> of ${sk.claims} sentences</span>
      <span><a class="link" style="color:#fff" href="/#report/${app.sid}" target="_blank">Share / PDF</a> · <a class="link" style="color:#fff" href="/api/investigations/${app.sid}/report.md" download>.md</a></span></div>` +
    sk.sections.map(sec => `<section class="r-sec"><h4>${esc(sec.title)}</h4>${sec.sentences.map(t => {
      const bad = t.flags.flatMap(f => (f.match(/doesn't exist: (.+)$/) || [, ""])[1].split(/,\s*/)).filter(Boolean);
      return `<p class="r-sent ${t.flags.length ? "is-flagged" : ""}"><span class="txt">${esc(t.text)}</span> ${chips(t.cites, bad)}${t.flags.map(f => `<span class="flag">${esc(f)}</span>`).join("")}</p>`;
    }).join("")}</section>`).join("") +
    `<div class="feedback"><b>Was this right?</b><div class="chips">${["right", "partly", "wrong"].map(k => `<button class="chip ${fb.rating === k ? "is-on" : ""}" data-rate="${k}">${{ right: "Yes", partly: "Partly", wrong: "No" }[k]}</button>`).join("")}</div>
      <textarea id="fb-note" maxlength="1000" placeholder="What was wrong or missing? (optional)">${esc(fb.note || "")}</textarea></div>`;
}
$("#report").addEventListener("click", async e => {
  const b = e.target.closest("[data-rate]");
  if (!b) return;
  const r = await post(`/api/investigations/${app.sid}/feedback`, { rating: b.dataset.rate, note: $("#fb-note")?.value || "" });
  if (r.ok) { app.feedback = { rating: b.dataset.rate, note: $("#fb-note")?.value || "" }; renderReport(); toast("Feedback saved."); }
});
document.addEventListener("click", e => {
  const c = e.target.closest(".cite");
  if (!c || !app.sid) return;
  const ref = c.dataset.ref;
  if (/^O\d+$/.test(ref)) { setView("workspace"); select(ref); }
  else if (/^V\d+$/.test(ref)) { setView("workspace"); setLab("wave"); }
  else if (/^X\d+$/.test(ref)) { setView("workspace"); setLab("meas"); }
});
// ---- suggestions: what-ifs run locally and instantly; questions go to the agent
function nextE12(v, up = true) {
  const dec = Math.floor(Math.log10(v)), m = v / 10 ** dec;
  const i = E12.findIndex(x => x >= m - 1e-9);
  if (i === -1) return up ? 10 ** (dec + 1) : E12[E12.length - 1] * 10 ** dec;   // above 8.2: next decade
  const j = up ? (E12[i] > m + 1e-9 ? i : i + 1) : i - 1;
  return j >= E12.length ? E12[0] * 10 ** (dec + 1) : j < 0 ? E12[E12.length - 1] * 10 ** (dec - 1) : E12[j] * 10 ** dec;
}
function renderSuggest() {
  const box = $("#suggest"), out = [];
  if (!app.sid || app.busy || app.pending) { box.innerHTML = ""; return; }
  const c = compById(app.selected), x = app.snap?.check;
  if (c?.type === "resistor" && c.value) out.push({ label: `What if ${fmtOhm(nextE12(c.value.value * 2))}?`, whatif: [c.id, fmtOhm(nextE12(c.value.value * 2)).replace(/\s|Ω/g, "")] });
  if (c?.type?.startsWith("capacitor") && c.value) out.push({ label: `What if ${fmtF(c.value.value / 2)}?`, whatif: [c.id, fmtF(c.value.value / 2, true)] });
  if (x?.verdict === "INFERRED") out.push({ label: `${x.inferred.component} says ${fmtF(x.inferred.standard, true)}`, ask: `${x.inferred.component} says ${fmtF(x.inferred.standard, true)}` });
  if (app.snap?.unknowns && !app.snap?.report && app.steps.write_report === "done") out.push({ label: "Rewrite the report", ask: "Rewrite the report" });
  if (!c && app.mode !== "demo" && app.snap?.report) out.push({ label: "What should I measure first?", ask: "What should I measure first?" });
  if (!c && app.mode === "demo" && x?.verdict === "CONSISTENT") out.push({ label: "O5 is 47uF", ask: "O5 is 47uF" });
  box.innerHTML = out.slice(0, 2).map((s, i) => `<button type="button" data-sg="${i}">${esc(s.label)}</button>`).join("");
  box._s = out;
}
$("#suggest").addEventListener("click", e => {
  const b = e.target.closest("[data-sg]"); if (!b) return;
  const s = $("#suggest")._s[+b.dataset.sg];
  if (s.whatif) { setWhatIf(...s.whatif); toast(`Simulating ${s.whatif[0]} = ${s.label.replace(/^What if |\?$/g, "")} (what-if).`); }
  else ask(s.ask);
});
async function ask(text) {
  if (!app.sid) return;
  const wi = text.match(/^what if (O\d+)\s*(?:were|was|is|=)?\s*([\d.]+\s*[a-zµΩ]*)\??$/i);
  if (wi) { setWhatIf(wi[1].toUpperCase(), wi[2].replace(/\s|Ω/g, "")); toast(`Simulated ${wi[1].toUpperCase()} = ${wi[2]} (what-if).`); return; }
  if (app.saved) { toast("This investigation was saved before a restart: re-run it to ask more."); return; }
  const c = compById(app.ctx?.id);
  const full = c && !new RegExp(`\\b${c.id}\\b`).test(text) ? `About ${c.id} (${typeName(c.type)} ${displayed(c).display || c.marking || ""}): ${text}` : text;
  app.asked = true;
  const r = await post(`/api/investigations/${app.sid}/ask`, { text: full });
  if (!r.ok) { toast((await r.json()).error || "Couldn't send that."); return; }
  app.busy = true; setStatus();
  toggleAssist(true, "chat");
}
$("#ask").addEventListener("submit", e => {
  e.preventDefault();
  const t = $("#ask-input").value.trim();
  if (!t) return;
  $("#ask-input").value = "";
  ask(t);
});

// ---- approval
function showApproval(req) {
  const a = req.args || {};
  $("#ap-id").textContent = a.component_id; $("#ap-value").textContent = a.value;
  $("#ap-reason").textContent = a.reason ? `Reason: ${a.reason}` : "";
  $("#ap-edit").hidden = true; $("#ap-approve").textContent = "Approve";
  $("#ap-edit-label").textContent = `New value for ${a.component_id}`;
  $("#approval").hidden = false;
  gsap.fromTo("#approval .modal-card", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "expo.out" });
}
async function decide(body) {
  const id = app.pending?.args?.component_id;
  const r = await post(`/api/investigations/${app.sid}/decision`, body);
  if (!r.ok) { toast((await r.json()).error || "That didn't go through."); return; }
  app.pending = null;
  if (body.type !== "reject" && id && app.overrides[id]) { delete app.overrides[id]; app.undo = []; }   // it is evidence now, not a what-if
  $("#approval").hidden = true;
  setStatus();
}
$("#ap-approve").addEventListener("click", () => {
  if (!$("#ap-edit").hidden) { const v = $("#ap-input").value.trim(); if (!v) return; decide({ type: "edit", value: v }); }
  else decide({ type: "approve" });
});
$("#ap-editbtn").addEventListener("click", () => { $("#ap-edit").hidden = false; $("#ap-input").value = $("#ap-value").textContent; $("#ap-input").select(); $("#ap-approve").textContent = "Record edited value"; });
$("#ap-reject").addEventListener("click", () => decide({ type: "reject", message: "rejected by the user" }));

// ================================================================ PROJECTS
const RATE = { right: "✓ right", partly: "~ partly", wrong: "✗ wrong" };
async function loadHistory() {
  try {
    const list = await (await fetch("/api/investigations")).json();
    app.history = Object.fromEntries(list.map(r => [r.id, r]));
    $("#projects").innerHTML = list.length ? list.map(r => `<button class="proj" data-open="${r.id}">
        <b>${esc(r.title === "Investigation" ? "Untitled board" : r.title)}</b>
        <small>${esc(r.device || r.circuit || "")}</small>
        <small>${r.verdict ? esc(r.verdict.toLowerCase()) + " · " : ""}${r.parts} parts · ${r.mode === "demo" ? "sample" : "live"}${r.rating ? ` · <span class="rate-${r.rating}">${RATE[r.rating]}</span>` : ""}${r.busy ? " · running" : ""}</small>
        <small>${ago(r.created)}</small>
        <span class="del" data-del="${r.id}" role="button" aria-label="Delete">×</span></button>`).join("")
      : empty("No investigations yet", "Start one from the Workspace, or try a sample.");
  } catch {}
}
$("#projects").addEventListener("click", async e => {
  const d = e.target.closest("[data-del]");
  if (d) {
    e.stopPropagation();
    if (!confirm("Delete this investigation and its uploaded photos and video? This can't be undone.")) return;
    const r = await fetch(`/api/investigations/${d.dataset.del}`, { method: "DELETE" });
    if (!r.ok) toast((await r.json()).error || "Couldn't delete it.");
    if (app.sid === d.dataset.del) closeRun();
    loadHistory();
    return;
  }
  const o = e.target.closest("[data-open]");
  if (o) openRun(o.dataset.open, app.history[o.dataset.open]?.mode || "live");
});
setInterval(() => { if (app.view === "projects" && !document.hidden) loadHistory(); }, 6000);

// ================================================================ CONTROL
let control = null;
async function loadControl() { try { control = await (await fetch("/api/control")).json(); } catch { control = null; } renderControl(); loadUsage(); }
const serverOn = s => !prefs.disabled.includes(s.name) && (s.default_on || prefs.enabled.includes(s.name));
function renderControl() {
  $$("#control .seg[data-pref]").forEach(seg => $$("button", seg).forEach(b => b.classList.toggle("is-on", prefs[seg.dataset.pref] === b.dataset.v)));
  if (!control) return;
  $("#ctl-agents-count").textContent = `${control.agents.filter(a => a.ready).length} / ${control.agents.length} ready`;
  $("#ctl-agents").innerHTML = control.agents.map(a => `<li><span class="lamp ${a.ready ? "ok" : "warn"}"></span><span><b>${esc(a.name)}</b><small>${esc(a.job)}${a.detail ? ` · ${esc(a.detail)}` : ""}</small></span><span class="kind">${esc(a.model)}</span></li>`).join("");
  const order = s => (s.usable_now || s.name === "pcbparts" ? 0 : s.role === "dev" || s.role === "none" ? 2 : 1);
  $("#ctl-servers").innerHTML = [...control.servers].sort((a, b) => order(a) - order(b)).map(s => {
    const on = serverOn(s), later = !s.usable_now && s.name !== "pcbparts";
    return `<li class="${later ? "is-later" : ""}"><span class="lamp ${s.ready && on ? "ok" : s.ready ? "" : "warn"}"></span>
      <span><b>${esc(s.name)}</b><small>${esc(s.purpose)} · ${esc(s.free)}</small><small>${later ? esc(s.role_text || "not used yet") : s.ready ? (on ? "ready" : "off") : esc(s.reason)}</small></span>
      <button type="button" class="switch" role="switch" aria-checked="${on}" data-server="${esc(s.name)}" ${later ? "disabled" : ""}></button></li>`;
  }).join("");
}
async function loadUsage() {
  try {
    const u = await (await fetch("/api/usage")).json(), t = u.today || {};
    $("#ctl-usage").innerHTML = [["Gemini 3.1 Flash-Lite", t.gemini_lite || 0, ""], ["Gemini 3.8 Flash", t.gemini_flash || 0, ` / ${u.flash_free_per_day}`], ["Groq backup", t.groq || 0, ""], ["Ollama", t.ollama || 0, ""]]
      .map(([n, v, x]) => `<li><span class="lamp ${v ? "ok" : ""}"></span><span><b>${n}</b></span><span class="kind">${v}${x} calls</span></li>`).join("");
  } catch {}
}
function openControl(open) {
  const d = $("#control");
  if (open) { d.hidden = false; loadControl(); gsap.fromTo(d, { xPercent: 100 }, { xPercent: 0, duration: 0.4, ease: "expo.out" }); }
  else gsap.to(d, { xPercent: 100, duration: 0.25, onComplete: () => (d.hidden = true) });
}
$("#control-btn").addEventListener("click", () => openControl(true));
$("#control-close").addEventListener("click", () => openControl(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#control").hidden) openControl(false); toggleAssist(false); } });
$("#control").addEventListener("click", e => {
  const b = e.target.closest(".seg[data-pref] button");
  if (b) {
    prefs[b.closest(".seg").dataset.pref] = b.dataset.v; savePrefs();
    bench.setPrefs({ labels: prefs.labels === "on", rotate: prefs.rotate === "on" });
    renderControl(); return;
  }
  const sw = e.target.closest("[data-server]");
  if (sw && !sw.disabled && control) {
    const s = control.servers.find(x => x.name === sw.dataset.server), on = !serverOn(s);
    prefs.disabled = prefs.disabled.filter(n => n !== s.name); prefs.enabled = prefs.enabled.filter(n => n !== s.name);
    if (!on) prefs.disabled.push(s.name); else if (!s.default_on) prefs.enabled.push(s.name);
    savePrefs(); renderControl();
  }
});

// ================================================================ PHONE CAPTURE
$("#phone-btn").addEventListener("click", async () => {
  const body = $("#phone-body");
  let lan = null;
  try { lan = (await (await fetch("/api/info")).json()).lan_url; } catch {}
  if (lan) {
    body.innerHTML = `<div class="qr" id="qr"></div><p class="phone-url">${esc(lan)}</p>
      <ol class="hint"><li>Phone on the same Wi-Fi.</li><li>Scan with the camera app.</li><li>Tap the drop zone to shoot photos and the video, then Run.</li><li>The run appears in Projects here too.</li></ol>`;
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, lan, { width: 200, margin: 1 });
    $("#qr").appendChild(canvas);
  } else {
    body.innerHTML = `<p>Phone capture needs the bench on your Wi-Fi. Restart it with <code>.\\start.ps1 -Lan</code>, then open this again for a QR code.</p>
      <p class="hint">Anyone on that network could use your Gemini key, so only do this on a network you trust.</p>`;
  }
  $("#phone").hidden = false;
});
$("#phone-close").addEventListener("click", () => ($("#phone").hidden = true));

// ================================================================ SHAREABLE REPORT (/#report/<id>)
async function renderPrint(id) {
  document.body.classList.add("print-mode");
  document.documentElement.dataset.theme = "paper";
  const el = $("#print-view");
  el.hidden = false; el.innerHTML = `<p class="hint">Loading the report…</p>`;
  let s, h;
  try {
    const [r1, r2] = await Promise.all([fetch(`/api/investigations/${id}/evidence`), fetch("/api/investigations")]);
    if (!r1.ok) throw new Error();
    s = await r1.json(); h = (await r2.json()).find(x => x.id === id) || {};
  } catch { el.innerHTML = empty("Report not found", "It may have been deleted, or the server isn't running."); return; }
  const p = s.patterns || {}, x = s.check || {}, a = s.inputs || {}, w = s.wiring, sk = s.skeptic, sim = s.simulation;
  const verdict = !x.available ? `<span class="verdict v-SKIPPED">NOT CHECKED</span> ${esc(x.reason || "")}`
    : x.verdict === "INFERRED" ? `<span class="verdict v-INFERRED">INFERRED</span> ${esc(x.inferred.text)}`
    : `<span class="verdict v-${x.verdict}">${x.verdict}</span> The parts predict ${fmtHz(x.predicted.frequency_hz)}; the video measured ${fmtHz(x.measured.frequency_hz)} (${x.error_pct}% apart, ±${x.tolerance_pct}% allowed).`;
  let html = `<div class="pv-bar"><button class="btn-run" id="pv-print">Print / Save as PDF</button><button class="pill" id="pv-copy">Copy link</button>
      <a class="pill" href="/api/investigations/${id}/report.md" download>.md</a><a class="pill" href="/">Open GENESIS</a></div>
    <article class="pv"><header class="pv-head"><div><p class="kicker">GENESIS report</p><h1>${esc(h.title && h.title !== "Investigation" ? h.title : p.top?.name || "Investigation")}</h1>
      ${s.device?.kind ? `<p class="muted" style="margin:4px 0 0">${esc(s.device.kind)}</p>` : ""}</div>
      <div class="meta">${id.slice(0, 8)}<br>${h.created ? new Date(h.created * 1000).toLocaleString() : ""}<br>${h.mode === "demo" ? "sample · scripted models" : "live · Gemini"}</div></header>
    ${p.top ? `<p><b>${esc(p.top.name)}</b> (${esc(p.confidence.toLowerCase())} fit). ${esc(p.top.summary)}</p>` : ""}
    <h2>Check against the device</h2><p>${verdict}</p>`;
  if (sim?.available) html += `<h2>Simulation (${sim.supply?.volts} V, ${esc(sim.supply?.source || "")})</h2><table><tbody>${sim.readings.map(r => `<tr><td>${esc(r.label)}</td><td class="mono">${esc(r.value)}</td><td class="muted">${esc(r.note || "")}</td></tr>`).join("")}</tbody></table>
    ${sim.warnings.length ? `<ul>${sim.warnings.map(w2 => `<li><b>${esc(w2.level)}</b>: ${esc(w2.text)}${w2.fix ? ` Fix: ${esc(w2.fix.component)} → ${esc(w2.fix.display)}.` : ""}</li>`).join("")}</ul>` : "<p>All parts within their ratings.</p>"}`;
  if (a.items) html += `<h2>Evidence given</h2><table><tbody>${a.items.map(i => `<tr><td>${i.given ? "✓" : "–"}</td><td><b>${esc(i.label)}</b></td><td>${esc(i.impact || i.detail)}</td></tr>`).join("")}</tbody></table>`;
  if (s.components?.length) html += `<h2>Parts</h2><table><thead><tr><th></th><th>Id</th><th>Part</th><th>Value</th><th>Status</th></tr></thead><tbody>${s.components.map(c =>
    `<tr><td><div class="pcrop" style="${cropStyle(c)}"></div></td><td class="mono">${c.id}</td><td>${esc(typeName(c.type))}</td><td class="mono">${esc(c.display || c.marking || "")}</td><td>${esc(c.status || "")} ${esc(c.confidence || "")}</td></tr>`).join("")}</tbody></table>`;
  if (w) html += `<h2>Wiring to replicate</h2><p class="hint">${esc(w.basis)}</p><div class="schem-print" id="pv-schem"></div>
    <table><thead><tr><th>Net</th><th>Join these</th><th>Done</th></tr></thead><tbody>${w.nets.map(n => `<tr><td><span class="swatch" style="background:${n.color}"></span><b>${n.id}</b> ${esc(n.name)}</td><td>${n.pins.map(q => `${esc(q.id || q.part)} ${esc(q.pin)}`).join("<br>")}</td><td>☐</td></tr>`).join("")}</tbody></table>`;
  if (s.unknowns?.length) html += `<h2>Still unknown, and what to do next</h2><ol>${s.unknowns.map(u => `<li>${esc(u.text)}.${u.ask ? ` <i>Next: ${esc(u.ask)}.</i>` : ""}</li>`).join("")}</ol>`;
  if (sk) html += `<h2>Report · skeptic flagged ${sk.flagged} of ${sk.claims}</h2>` + sk.sections.map(sec => `<h3 style="font-size:13px;margin:14px 0 4px">${esc(sec.title)}</h3>${sec.sentences.map(t =>
    `<p class="${t.flags.length ? "flagged" : ""}">${esc(t.text)} <span class="mono" style="font-size:11px">[${t.cites.map(esc).join(", ")}]</span></p>`).join("")}`).join("");
  html += `<p class="foot">Generated by GENESIS. Models see and explain; code measures, simulates and decides; values count only once a person approves them.</p></article>`;
  el.innerHTML = html;
  if (w) renderNetlist($("#pv-schem"), w).catch(() => renderSchematic($("#pv-schem"), w));
  $("#pv-print").addEventListener("click", () => window.print());
  $("#pv-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); toast("Link copied."); } catch { toast(location.href); } });
}

// ================================================================ START
fetch("/api/info").then(r => r.json()).catch(() => null);
icons();
const reportRoute = location.hash.match(/^#report\/([0-9a-f]{6,32})$/);
if (reportRoute) renderPrint(reportRoute[1]);
else {
  initLab();
  loadHistory();
  mountBench();
  bench.setComponents(HERO_PARTS, { animate: !reduced });
  if (!reduced) bench.intro();
  $("#rotate-btn").classList.toggle("is-on", prefs.rotate === "on");
  updateTop(); setStatus(); renderReport();
  if (STATIC) staticNotice();
  if (location.hash === "#demo") $('[data-sample="full"]').click();
}
window.addEventListener("hashchange", () => { if (/^#report\//.test(location.hash) || document.body.classList.contains("print-mode")) location.reload(); });

// GitHub Pages: say plainly what the online demo can and can't do
function staticNotice() {
  const n = document.createElement("div");
  n.className = "static-note";
  n.innerHTML = `<b>Online demo.</b> Pick a sample below (555 blinker, ESP32 board or Robot car): it replays a real recorded run of the GENESIS pipeline.
    To investigate your own device from photos and video, run GENESIS on your computer with a free Gemini key:
    <a href="https://github.com/B-Aladin/genesis#run-it-on-your-computer" target="_blank" rel="noopener">how to run it</a>.`;
  $("#intake").prepend(n);
}
