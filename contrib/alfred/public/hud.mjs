// Alfred HUD — the particle globe (canvas) and the clock. Browser-only.
//
//   const orb = createOrb(canvas);
//   orb.setState("idle" | "listening" | "thinking" | "speaking");
//   orb.pulse();                 // a word was spoken (browser voice)
//   orb.attachAnalyser(node);    // live audio level (AI voice)
//
// The globe is ~700 points on a Fibonacci sphere, rotated in 3D and projected with perspective.
// Each point is a damped spring on its radius: speech kicks points outward and they settle back,
// so the surface churns with the voice; listening "breathes" in yellow; thinking swirls the
// latitude bands at different speeds.

const GRAPHITE = [214, 217, 223];
const YELLOW = [245, 196, 0];
const COUNT = 700;

export const STATE_LABELS = {
  idle: "Em espera",
  listening: "Ouvindo",
  thinking: "Processando",
  speaking: "Falando",
};

function fibonacciSphere(n) {
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      radius: 1, // current radial scale
      velocity: 0,
      phase: Math.random() * Math.PI * 2,
      gold: Math.random() < 0.06,
    });
  }
  return points;
}

export function createOrb(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const points = fibonacciSphere(COUNT);
  let state = "idle";
  let yaw = 0;
  let swirl = 0;
  let level = 0; // 0..1 smoothed loudness
  let target = 0;
  let warmth = 0; // 0 graphite → 1 yellow (listening)
  let analyser = null;
  let samples = null;
  let size = 0;
  let last = performance.now();

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
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function readLevel(now) {
    if (state === "speaking" && analyser) {
      samples ??= new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      target = Math.min(1, Math.sqrt(sum / samples.length) * 4.5);
    } else if (state === "speaking") {
      target *= 0.9; // word pulses decay; keep the surface alive when the voice gives no events
      if (target < 0.3 && Math.random() < 0.14) target = 0.45 + Math.random() * 0.5;
    } else if (state === "listening") {
      target = 0.22 + 0.14 * Math.sin(now / 260);
    } else if (state === "thinking") {
      target = 0.18;
    } else {
      target = 0.05;
    }
    level += (target - level) * 0.2;
  }

  function frame(now) {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    readLevel(now);
    const calm = reduceMotion ? 0.15 : 1;
    yaw += dt * calm * (state === "thinking" ? 1.1 : state === "speaking" ? 0.45 : 0.18);
    swirl += dt * calm * (state === "thinking" ? 2.2 : 0);
    warmth += ((state === "listening" ? 1 : 0) - warmth) * 0.06;

    const R = size / 2;
    const globeR = R * 0.7;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);

    // backdrop glow
    const tone = mix(GRAPHITE, YELLOW, warmth * 0.8);
    const glow = ctx.createRadialGradient(0, 0, globeR * 0.1, 0, 0, R);
    glow.addColorStop(0, rgba(tone, 0.1 + level * 0.12));
    glow.addColorStop(0.55, rgba(tone, 0.03));
    glow.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-R, -R, size, size);

    // orbit ring with a yellow satellite
    ctx.save();
    ctx.scale(1, 0.28);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2);
    ctx.setLineDash([2, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(GRAPHITE, 0.22);
    ctx.stroke();
    ctx.setLineDash([]);
    const sat = yaw * 1.4;
    ctx.beginPath();
    ctx.arc(Math.cos(sat) * R * 0.9, Math.sin(sat) * R * 0.9, 4, 0, Math.PI * 2);
    ctx.fillStyle = rgba(YELLOW, 0.9);
    ctx.fill();
    ctx.restore();

    // particles
    const tilt = 0.38;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const kick = state === "speaking" ? level : state === "listening" ? level * 0.5 : level * 0.2;
    const projected = [];
    for (const p of points) {
      // spring towards the surface, kicked outward by the voice
      const wobble = Math.sin(now / 240 + p.phase) * 0.5 + 0.5;
      if (!reduceMotion && Math.random() < kick * 0.08) p.velocity += kick * (0.6 + Math.random() * 1.4) * dt * 60 * 0.02;
      const rest = 1 + kick * 0.08 * wobble;
      p.velocity += (rest - p.radius) * 0.12 - p.velocity * 0.14;
      p.radius += p.velocity;

      // thinking: latitude bands turn at different speeds
      const a = yaw + swirl * p.y * 0.6;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      let x = p.x * cosA - p.z * sinA;
      let z = p.x * sinA + p.z * cosA;
      let y = p.y * cosT - z * sinT;
      z = p.y * sinT + z * cosT;
      x *= p.radius;
      y *= p.radius;
      z *= p.radius;
      const persp = 2.6 / (2.6 + z);
      projected.push({ sx: x * globeR * persp, sy: y * globeR * persp, z, persp, p });
    }
    projected.sort((a, b) => b.z - a.z); // far first

    ctx.globalCompositeOperation = "lighter";
    for (const { sx, sy, z, persp, p } of projected) {
      const depth = (1 - z) / 2; // 0 back → 1 front
      const lift = Math.max(0, p.radius - 1); // detached particles glow
      const goldness = p.gold ? 0.35 + kick * 0.6 + warmth * 0.55 + lift * 2 : warmth * 0.35 + lift * 1.5;
      const color = mix(GRAPHITE, YELLOW, Math.min(1, goldness));
      const alpha = Math.min(1, 0.12 + depth * 0.6 + lift * 3 + (p.gold ? 0.15 : 0));
      const dot = (p.gold ? 1.9 : 1.25) * persp * (1 + lift * 4);
      ctx.fillStyle = rgba(color, alpha);
      if (p.gold || lift > 0.04) {
        ctx.beginPath();
        ctx.arc(sx, sy, dot, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(sx - dot / 2, sy - dot / 2, dot, dot);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // core highlight
    const core = ctx.createRadialGradient(-globeR * 0.25, -globeR * 0.3, 0, 0, 0, globeR);
    core.addColorStop(0, rgba(mix(GRAPHITE, YELLOW, warmth), 0.07 + level * 0.08));
    core.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, globeR, 0, Math.PI * 2);
    ctx.fill();

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
      target = Math.min(1, 0.55 + Math.random() * 0.45);
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
