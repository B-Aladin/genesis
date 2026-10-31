// Simulated waveforms: several signals on one time axis, drawn on a canvas.
// Colours follow the theme; `draw(signals, progress)` lets GSAP animate the traces in.
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function createChart(canvas, legendEl) {
  const ctx = canvas.getContext("2d");
  let signals = [], progress = 1;

  function nice(span) {
    const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    return steps.find(s => span / s <= 6) || 100;
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = 38, R = 8, T = 8, B = 22, pw = w - L - R, ph = h - T - B;
    const ink = css("--ink-3") || "#8b8172", grid = css("--line") || "#e3d8c8";
    ctx.font = "10px 'JetBrains Mono', monospace";
    if (!signals.length) {
      ctx.fillStyle = ink; ctx.textAlign = "center";
      ctx.fillText("No simulation yet", L + pw / 2, T + ph / 2);
      return;
    }
    const all = signals.flatMap(s => s.points);
    const tMax = Math.max(...all.map(p => p[0])) || 1;
    let vMin = Math.min(0, ...all.map(p => p[1])), vMax = Math.max(...all.map(p => p[1]));
    if (vMax - vMin < 1e-6) vMax = vMin + 1;
    const pad = (vMax - vMin) * 0.08;
    vMin -= pad; vMax += pad;
    const X = t => L + (t / tMax) * pw, Y = v => T + ph - ((v - vMin) / (vMax - vMin)) * ph;
    // grid and axes
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = ink;
    const vs = nice(vMax - vMin);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let v = Math.ceil(vMin / vs) * vs; v <= vMax; v += vs) {
      ctx.beginPath(); ctx.moveTo(L, Y(v) + 0.5); ctx.lineTo(L + pw, Y(v) + 0.5); ctx.stroke();
      ctx.fillText(`${+v.toFixed(2)}V`, L - 4, Y(v));
    }
    const ts = nice(tMax);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let t = 0; t <= tMax + 1e-9; t += ts) {
      ctx.fillText(t < 1 && ts < 1 ? `${+(t * 1000).toFixed(0)}ms` : `${+t.toFixed(2)}s`, X(t), T + ph + 5);
    }
    // traces
    signals.forEach(s => {
      const n = Math.max(2, Math.floor(s.points.length * progress));
      ctx.strokeStyle = s.color || css("--maroon"); ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath();
      s.points.slice(0, n).forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
      ctx.stroke();
    });
  }

  new ResizeObserver(draw).observe(canvas);
  return {
    set(next) {
      signals = (next || []).map(s => ({ ...s, color: s.color === "#6b2a2e" ? css("--maroon") : s.color === "#3b57d9" ? css("--blue") : s.color }));
      legendEl.innerHTML = signals.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
      progress = 1; draw();
    },
    progress(p) { progress = p; draw(); },
    redraw: draw,
  };
}
