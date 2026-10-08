// The measured brightness trace from the video, drawn like a chart recorder.
// The playhead uses the same clock as the 3D LED, so the board blinks with the data.
import { clock } from "./bench3d.js";

const COLORS = ["#151515", "#e5451b", "#b97b0c"];

export function createScope(canvas, onLevel) {
  const ctx = canvas.getContext("2d");
  let video = null, flash = 0;

  function regionsOf(v) {
    return (v?.regions || []).filter(r => r.trace?.length > 3);
  }

  function levelAt(t) {
    const r = regionsOf(video)[0];
    if (!r) return null;
    const n = r.trace.length, dt = video.dt || 1 / 30;
    const i = Math.floor((t % (n * dt)) / dt);
    const lo = r.analysis?.min ?? Math.min(...r.trace), hi = r.analysis?.max ?? Math.max(...r.trace);
    return hi > lo ? (r.trace[Math.min(n - 1, i)] - lo) / (hi - lo) : 0;
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!canvas.offsetParent) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 12, padR = 12, padT = 12, padB = 20;
    const pw = w - padL - padR, ph = h - padT - padB;
    const regions = regionsOf(video);
    const dur = regions.length ? regions[0].trace.length * (video.dt || 1 / 30) : 10;

    // grid: one line per second
    ctx.strokeStyle = "rgba(21,21,21,0.08)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#85817a"; ctx.font = "10px 'JetBrains Mono', monospace"; ctx.textBaseline = "top";
    const step = dur > 20 ? 5 : dur > 8 ? 2 : 1;
    for (let s = 0; s <= dur + 1e-6; s += step) {
      const x = padL + (s / dur) * pw;
      ctx.beginPath(); ctx.moveTo(x + 0.5, padT); ctx.lineTo(x + 0.5, padT + ph); ctx.stroke();
      ctx.fillText(`${s}s`, x + 3, padT + ph + 4);
    }
    for (let k = 0; k <= 4; k++) {
      const y = padT + (k / 4) * ph;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + pw, y + 0.5); ctx.stroke();
    }

    if (!regions.length) {
      ctx.strokeStyle = "rgba(21,21,21,0.35)"; ctx.setLineDash([4, 5]);
      const t = clock.now();
      ctx.beginPath();
      for (let x = 0; x <= pw; x += 3) {
        const y = padT + ph * 0.75 + Math.sin(x * 0.11 + t * 3) * 1.2;
        x ? ctx.lineTo(padL + x, y) : ctx.moveTo(padL + x, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      return;
    }

    regions.forEach((r, ri) => {
      const lo = r.analysis?.min ?? Math.min(...r.trace), hi = r.analysis?.max ?? Math.max(...r.trace);
      const span = hi - lo || 1;
      const Y = v => padT + ph - ((v - lo) / span) * ph * 0.86 - ph * 0.07;
      const X = i => padL + (i / (r.trace.length - 1)) * pw;
      if (ri === 0 && r.analysis?.threshold != null) {
        ctx.strokeStyle = "rgba(229,69,27,0.55)"; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(padL, Y(r.analysis.threshold)); ctx.lineTo(padL + pw, Y(r.analysis.threshold)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#b8340f"; ctx.fillText("threshold", padL + pw - 62, Y(r.analysis.threshold) + 3);
        ctx.fillStyle = "rgba(21,21,21,0.5)";
        for (const i of r.analysis.rising_idx || []) ctx.fillRect(X(i) - 0.5, padT + ph - 6, 1, 6);
      }
      if (ri === 0) {
        ctx.fillStyle = "rgba(21,21,21,0.05)";
        ctx.beginPath(); ctx.moveTo(X(0), padT + ph);
        r.trace.forEach((v, i) => ctx.lineTo(X(i), Y(v)));
        ctx.lineTo(X(r.trace.length - 1), padT + ph); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = COLORS[ri % COLORS.length]; ctx.lineWidth = ri === 0 ? 1.6 + flash * 1.5 : 1.2;
      ctx.beginPath();
      r.trace.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
      ctx.fillStyle = COLORS[ri % COLORS.length];
      ctx.fillText(`V${r.index + 1}`, padL + 4, padT + 2 + ri * 12);
    });

    const t = clock.now() % dur;
    const x = padL + (t / dur) * pw;
    ctx.strokeStyle = "#e5451b"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
    const lv = levelAt(clock.now()) ?? 0;
    ctx.fillStyle = "#e5451b";
    ctx.beginPath(); ctx.arc(x, padT + ph - lv * ph * 0.86 - ph * 0.07, 3.5, 0, 7); ctx.fill();
    flash *= 0.94;
  }
  draw();

  return {
    set(v) {
      video = v && regionsOf(v).length ? v : null;
      onLevel?.(video ? levelAt : null);
    },
    pulse() { flash = 1; },
  };
}
