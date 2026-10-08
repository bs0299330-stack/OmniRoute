// Alfred HUD — the animated reactor (canvas) and the clock. Browser-only.
//
//   const orb = createOrb(canvas);
//   orb.setState("idle" | "listening" | "thinking" | "speaking");
//   orb.pulse();                 // a word was spoken (browser voice)
//   orb.attachAnalyser(node);    // live audio level (AI voice)

const STATE_SPEED = { idle: 0.25, listening: 0.45, thinking: 2.4, speaking: 0.7 };
const CYAN = [70, 214, 255];
const AMBER = [255, 182, 72];

export const STATE_LABELS = {
  idle: "Em espera",
  listening: "Ouvindo",
  thinking: "Processando",
  speaking: "Falando",
};

export function createOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let state = "idle";
  let angle = 0;
  let level = 0; // 0..1, smoothed
  let target = 0;
  let analyser = null;
  let samples = null;
  let size = 0;
  let last = performance.now();
  let tint = CYAN.slice();
  const bars = new Float32Array(72);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = canvas.getBoundingClientRect().width || 300;
    size = css;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

  function readLevel() {
    if (analyser && state === "speaking") {
      samples ??= new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      target = Math.min(1, Math.sqrt(sum / samples.length) * 4);
    }
    if (state === "thinking") target = 0.25 + 0.15 * Math.sin(angle * 3);
    if (state === "listening") target = 0.35 + 0.25 * Math.sin(performance.now() / 220);
    if (state === "idle") target = 0.08;
    level += (target - level) * 0.18;
    if (state === "speaking" && !analyser) {
      target *= 0.9; // word pulses decay; keep some life when the voice gives no events
      if (target < 0.25 && Math.random() < 0.12) target = 0.4 + Math.random() * 0.5;
    }
  }

  function arc(r, start, end, width, alpha) {
    ctx.beginPath();
    ctx.arc(0, 0, r, start, end);
    ctx.lineWidth = width;
    ctx.strokeStyle = rgba(tint, alpha);
    ctx.stroke();
  }

  function frame(now) {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    const speed = reduceMotion ? 0.05 : STATE_SPEED[state];
    angle += dt * speed;
    readLevel();
    const want = state === "listening" ? AMBER : CYAN;
    for (let i = 0; i < 3; i++) tint[i] += (want[i] - tint[i]) * 0.08;

    const R = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);

    // glow
    const glow = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.95);
    glow.addColorStop(0, rgba(tint, 0.28 + level * 0.35));
    glow.addColorStop(0.35, rgba(tint, 0.07 + level * 0.08));
    glow.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-R, -R, size, size);

    // outer tick ring
    ctx.save();
    ctx.rotate(angle * 0.35);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const long = i % 10 === 0;
      const r1 = R * 0.93;
      const r2 = R * (long ? 0.86 : 0.895);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.lineWidth = long ? 1.6 : 0.8;
      ctx.strokeStyle = rgba(tint, long ? 0.75 : 0.35);
      ctx.stroke();
    }
    ctx.restore();

    // segmented ring (counter-rotating)
    ctx.save();
    ctx.rotate(-angle * 0.8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      arc(R * 0.78, a + 0.08, a + Math.PI / 3 - 0.08, 3, 0.55);
    }
    ctx.restore();

    // sweeping arcs
    ctx.save();
    ctx.rotate(angle * 1.6);
    arc(R * 0.68, 0, Math.PI * 1.35, 1.2, 0.6);
    arc(R * 0.64, Math.PI, Math.PI * 1.6, 5, 0.35);
    ctx.restore();

    // voice bars around the core
    const inner = R * 0.38;
    for (let i = 0; i < bars.length; i++) {
      const noise = 0.55 + 0.45 * Math.sin(now / 90 + i * 1.7) * Math.sin(now / 160 + i * 0.6);
      const want = state === "speaking" || state === "listening" ? level * noise : level * 0.25;
      bars[i] += (want - bars[i]) * 0.25;
      const a = (i / bars.length) * Math.PI * 2 + angle * 0.2;
      const len = R * (0.02 + bars[i] * 0.2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (inner + 4), Math.sin(a) * (inner + 4));
      ctx.lineTo(Math.cos(a) * (inner + 4 + len), Math.sin(a) * (inner + 4 + len));
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(tint, 0.35 + bars[i] * 0.6);
      ctx.stroke();
    }

    // core
    const coreR = R * (0.2 + level * 0.06);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    core.addColorStop(0, "rgba(235, 252, 255, 0.95)");
    core.addColorStop(0.45, rgba(tint, 0.75));
    core.addColorStop(1, rgba(tint, 0.05));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fill();
    arc(inner, 0, Math.PI * 2, 1, 0.5);
    // triangular core frame
    ctx.save();
    ctx.rotate(-angle * 0.5);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      const r = R * 0.29;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgba(tint, 0.6);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setState(next) {
      state = STATE_LABELS[next] ? next : "idle";
    },
    get state() {
      return state;
    },
    pulse() {
      target = Math.min(1, 0.55 + Math.random() * 0.4);
    },
    attachAnalyser(node) {
      analyser = node;
      samples = null;
    },
  };
}

/** Keeps `#clock` (HH:MM:SS) and `#date` up to date. */
export function startClock(clockEl, dateEl) {
  const tick = () => {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString("pt-BR");
    if (dateEl) {
      dateEl.textContent = now
        .toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })
        .replace(/\./g, "")
        .toUpperCase();
    }
  };
  tick();
  return setInterval(tick, 1000);
}
