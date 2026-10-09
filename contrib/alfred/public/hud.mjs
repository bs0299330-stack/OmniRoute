// Alfred HUD — the particle globe, the Gotham skyline, the menu drawer and the clock. Browser-only.
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

    // a faint halo, only when he listens or speaks
    const tone = mix(GRAPHITE, YELLOW, warmth * 0.8);
    const glow = ctx.createRadialGradient(0, 0, globeR * 0.2, 0, 0, R);
    glow.addColorStop(0, rgba(tone, 0.03 + level * 0.1));
    glow.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-R, -R, size, size);

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

/** Keeps `#clock` (HH:MM) and, when given, `#date` up to date. */
export function startClock(clockEl, dateEl) {
  const tick = () => {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

/** Small seeded PRNG (mulberry32): the same city every time. */
function seeded(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws a dark city silhouette (two layers of buildings, a few spires and antennas, scattered lit
 * windows, most of them yellow) into `canvas`, redrawn on resize.
 */
export function drawSkyline(canvas, seed = 1939) {
  const ctx = canvas.getContext("2d");
  const layers = [
    { color: "#111115", min: 0.38, max: 0.92, lit: 0.012 },
    { color: "#09090b", min: 0.18, max: 0.62, lit: 0.026 },
  ];
  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const rand = seeded(seed);
    const haze = ctx.createLinearGradient(0, 0, 0, h);
    haze.addColorStop(0, "rgba(130, 130, 140, 0)");
    haze.addColorStop(1, "rgba(130, 130, 140, 0.07)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);
    for (const layer of layers) {
      let x = -8;
      while (x < w + 8) {
        const bw = 26 + rand() * 64;
        const bh = h * (layer.min + rand() * (layer.max - layer.min));
        const top = h - bh;
        ctx.fillStyle = layer.color;
        ctx.fillRect(x, top, bw, bh);
        const roof = rand();
        if (roof < 0.16) {
          ctx.beginPath(); // gothic spire
          ctx.moveTo(x + bw * 0.28, top);
          ctx.lineTo(x + bw / 2, top - bh * 0.22);
          ctx.lineTo(x + bw * 0.72, top);
          ctx.fill();
        } else if (roof < 0.3) {
          ctx.fillRect(x + bw / 2 - 0.75, top - bh * 0.16, 1.5, bh * 0.16); // antenna
        } else if (roof < 0.46) {
          ctx.fillRect(x + bw * 0.18, top - bh * 0.07, bw * 0.64, bh * 0.07); // stepped top
        }
        for (let wy = top + 7; wy < h - 4; wy += 8) {
          for (let wx = x + 5; wx < x + bw - 5; wx += 7) {
            if (rand() < layer.lit) {
              ctx.fillStyle =
                rand() < 0.75 ? `rgba(245, 196, 0, ${0.22 + rand() * 0.35})` : "rgba(210, 212, 220, 0.16)";
              ctx.fillRect(wx, wy, 2, 3);
            }
          }
        }
        x += bw + rand() * 3;
      }
    }
  }
  render();
  new ResizeObserver(render).observe(canvas);
}

/** The menu drawer: the ≡ button opens it; the scrim, the close button and Esc close it. */
export function setupDrawer({ button, drawer, scrim, restoreFocus = true }) {
  const open = (on) => {
    drawer.hidden = !on;
    scrim.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
    if (on) drawer.querySelector("[data-close]")?.focus();
    else if (restoreFocus) button.focus();
    else document.activeElement?.blur?.(); // a hidden menu button stays hidden
  };
  button.addEventListener("click", () => open(drawer.hidden));
  scrim.addEventListener("click", () => open(false));
  drawer.querySelector("[data-close]")?.addEventListener("click", () => open(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) open(false);
  });
  return { open };
}

/**
 * "Tema do Alfred": an original ~10 s gothic orchestral intro, synthesized live (no audio file).
 * D minor: a low string ostinato and timpani roll, a dark choir pad, a brass motif
 * (D–F–E–D, A–Bb–A, then up to D) and a final tutti hit with a cathedral bell. The melody is
 * original, not taken from any film score.
 * Returns `{ done: Promise, stop() }`; `output` lets the caller tap it (e.g. an AnalyserNode).
 */
export function playGothamTheme(ctx, output = ctx.destination) {
  const t0 = ctx.currentTime + 0.05;
  const END = 10.2;
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const nodes = [];
  const keep = (n) => (nodes.push(n), n);

  const master = keep(ctx.createGain());
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.8, t0 + 0.6);
  master.gain.setValueAtTime(0.8, t0 + END - 1.4);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + END);
  // a little hall: feedback delay as a cheap reverb
  const wet = keep(ctx.createGain());
  wet.gain.value = 0.28;
  const delay = keep(ctx.createDelay(1));
  delay.delayTime.value = 0.19;
  const fb = keep(ctx.createGain());
  fb.gain.value = 0.45;
  const damp = keep(ctx.createBiquadFilter());
  damp.type = "lowpass";
  damp.frequency.value = 2200;
  master.connect(output);
  master.connect(delay);
  delay.connect(damp).connect(fb).connect(delay);
  damp.connect(wet).connect(output);

  // one "instrument" voice: oscillators → low-pass → envelope
  function voice({ midi, at, len, type = "sawtooth", gain = 0.1, cutoff = 1200, attack = 0.04, release = 0.3, detune = [0], vibrato = 0 }) {
    const start = t0 + at;
    const stop = start + len + release;
    const env = keep(ctx.createGain());
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + attack);
    env.gain.setValueAtTime(gain, start + len);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    const lp = keep(ctx.createBiquadFilter());
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff * 0.5, start);
    lp.frequency.exponentialRampToValueAtTime(cutoff, start + attack * 2 + 0.05);
    lp.connect(env).connect(master);
    for (const cents of detune) {
      const o = keep(ctx.createOscillator());
      o.type = type;
      o.frequency.value = hz(midi);
      o.detune.value = cents;
      if (vibrato) {
        const lfo = keep(ctx.createOscillator());
        const depth = keep(ctx.createGain());
        lfo.frequency.value = 5;
        depth.gain.value = vibrato;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(start);
        lfo.stop(stop);
      }
      o.connect(lp);
      o.start(start);
      o.stop(stop);
    }
  }

  const timpani = (at, size = 1) => {
    const o = keep(ctx.createOscillator());
    const g = keep(ctx.createGain());
    o.frequency.setValueAtTime(hz(38) * 1.05, t0 + at); // D2
    o.frequency.exponentialRampToValueAtTime(hz(38) * 0.95, t0 + at + 0.6);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.55 * size, t0 + at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.9 * size);
    o.connect(g).connect(master);
    o.start(t0 + at);
    o.stop(t0 + at + size + 0.1);
  };

  // low strings ostinato (D2 D2 D2 F2 / D2 D2 Bb1 A1), steady eighths
  const ostinato = [38, 38, 38, 41, 38, 38, 34, 33];
  for (let i = 0; i < 28; i++) {
    voice({ midi: ostinato[i % 8], at: 0.4 + i * 0.25, len: 0.16, gain: 0.07, cutoff: 700, attack: 0.02, release: 0.12, detune: [-6, 6] });
  }
  // timpani: pulse, then a roll into the climax
  [0.4, 1.4, 2.4, 3.4, 4.4, 5.4].forEach((at) => timpani(at));
  for (let r = 0; r < 14; r++) timpani(6.4 + r * 0.07, 0.35 + r * 0.03);

  // dark choir pad: D minor, "ah" (triangles with vibrato), swelling
  for (const midi of [50, 53, 57, 62]) {
    voice({ midi, at: 0.6, len: 6.4, type: "triangle", gain: 0.035, cutoff: 1800, attack: 2.2, release: 1.2, detune: [-8, 8], vibrato: 2.5 });
  }

  // brass motif (original): D–F–E–D | A–Bb–A | F–E–D… then rising to D
  const brass = [
    [62, 1.9, 0.45], [65, 2.4, 0.3], [64, 2.75, 0.3], [62, 3.1, 0.8],
    [69, 4.1, 0.45], [70, 4.6, 0.3], [69, 4.95, 0.9],
    [65, 6.0, 0.3], [64, 6.35, 0.3], [62, 6.7, 0.3], [69, 7.05, 0.35], [74, 7.45, 1.4],
  ];
  for (const [midi, at, len] of brass) {
    voice({ midi, at, len, gain: 0.09, cutoff: 1600, attack: 0.06, release: 0.35, detune: [-7, 0, 7] });
    voice({ midi: midi - 12, at, len, gain: 0.06, cutoff: 900, attack: 0.07, release: 0.35, detune: [-5, 5] });
  }

  // final tutti hit (D minor) + cathedral bell
  for (const midi of [26, 38, 50, 57, 62, 65, 69, 74]) {
    voice({ midi, at: 7.45, len: 1.2, gain: 0.05, cutoff: 2000, attack: 0.02, release: 1.4, detune: [-6, 6] });
  }
  timpani(7.45, 1.6);
  for (const [ratio, g] of [[1, 0.12], [2.76, 0.05], [5.4, 0.025]]) {
    const o = keep(ctx.createOscillator());
    const env = keep(ctx.createGain());
    o.type = "sine";
    o.frequency.value = hz(62) * ratio;
    env.gain.setValueAtTime(0.0001, t0 + 7.45);
    env.gain.exponentialRampToValueAtTime(g, t0 + 7.46);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + END);
    o.connect(env).connect(master);
    o.start(t0 + 7.45);
    o.stop(t0 + END);
  }

  let timer;
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
    timer = setTimeout(resolve, (END + 0.2) * 1000);
  });
  return {
    done,
    stop() {
      clearTimeout(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {}
        }
      }, 400);
      finish();
    },
  };
}
