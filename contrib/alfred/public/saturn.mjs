// Alfred — the planet at the centre of the panel: a Saturn-style planet whose rings come alive
// with his voice. Browser-only, except the two pure ring helpers (unit-tested).
//
//   const planet = createSaturn(canvas);      // same handle as createOrb (hud.mjs)
//   planet.setState("idle" | "listening" | "thinking" | "speaking");
//   planet.pulse();                // a word was spoken (browser voice)
//   planet.attachAnalyser(node);   // live audio level (AI voice)
//
// Idle: the planet turns slowly and the ring dust drifts. Listening: the rings breathe in light
// blue. Thinking: the dust speeds up and a bright streak runs around the rings. Speaking: waves
// travel outwards through the rings with the loudness of the voice, and the planet glows.

import { STATE_LABELS } from "./hud.mjs";

const GOLD = [245, 196, 0];
const ACCENT = [154, 215, 255];
const RING = [226, 205, 160];

// The rings, in planet radii, and how many strokes paint them.
export const RING_INNER = 1.28;
export const RING_OUTER = 2.3;
const RING_STROKES = 46;
const ROLL = 0.26; // the whole planet leans: the right tip of the rings points down
const SQUASH = 0.3; // rings seen at an angle: height ÷ width

// Cloud bands from the north pole (-1) to the south pole (1).
const BANDS = [
  [-1, -0.8, "#8f7a52"],
  [-0.8, -0.62, "#c7ab72"],
  [-0.62, -0.48, "#b0925c"],
  [-0.48, -0.3, "#dcc390"],
  [-0.3, -0.2, "#c4a56b"],
  [-0.2, 0.02, "#ecd9a8"],
  [0.02, 0.12, "#d2b67c"],
  [0.12, 0.3, "#e6cf9a"],
  [0.3, 0.42, "#bf9f66"],
  [0.42, 0.6, "#d6bb84"],
  [0.6, 0.78, "#ab8d58"],
  [0.78, 1, "#8c774f"],
];

/**
 * How bright the rings are at `t` (0 = inner edge … 1 = outer edge), like Saturn's: the faint C
 * ring, the bright B ring, the dark Cassini division, then the A ring with the thin Encke gap.
 */
export function ringProfile(t) {
  if (!(t >= 0 && t <= 1)) return 0;
  if (t < 0.2) return 0.16 + t * 0.6;
  if (t < 0.6) return 0.8 + 0.2 * Math.sin(t * 55);
  if (t < 0.67) return 0.05;
  if (t > 0.9 && t < 0.925) return 0.1;
  return 0.55 - (t - 0.67) * 0.5;
}

/**
 * The voice in the rings: a wave that travels outwards, as strong as the voice is loud
 * (`level` 0…1). 1 = unchanged; never below 0.15, so the rings do not vanish.
 */
export function ringWave(t, seconds, level) {
  return Math.max(0.15, 1 + level * 0.9 * Math.sin(t * 16 - seconds * 7));
}

const rgba = (c, a) =>
  `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function createSaturn(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let state = "idle";
  let level = 0; // 0..1 smoothed loudness
  let target = 0;
  let cool = 0; // 0 → 1 while listening (the rings turn light blue)
  let busy = 0; // 0 → 1 while thinking (the streak fades in)
  let analyser = null;
  let samples = null;
  let size = 0;
  let spin = 0; // the planet's turn
  let orbit = 0; // the ring dust's turn
  let last = performance.now();

  // Dust in the rings (inner dust orbits faster) and soft storms on the planet.
  const dust = Array.from({ length: 150 }, () => {
    let t = Math.random();
    if (t > 0.6 && t < 0.67) t -= 0.1; // nothing in the Cassini division
    const r = RING_INNER + t * (RING_OUTER - RING_INNER);
    return {
      t,
      r,
      angle: Math.random() * Math.PI * 2,
      speed: 1 / r ** 1.5,
      size: 0.6 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
    };
  });
  const storms = Array.from({ length: 9 }, (_, i) => ({
    lat: -0.7 + (i / 8) * 1.4 + (Math.random() - 0.5) * 0.1,
    phase: Math.random() * Math.PI * 2,
    speed: 0.8 + Math.random() * 0.5,
    width: 0.16 + Math.random() * 0.2,
    light: i % 3 !== 0,
  }));

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

  function readLevel(now) {
    if (state === "speaking" && analyser) {
      samples ??= new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      target = Math.min(1, Math.sqrt(sum / samples.length) * 4.5);
    } else if (state === "speaking") {
      target *= 0.9; // word pulses decay; keep the rings alive when the voice gives no events
      if (target < 0.3 && Math.random() < 0.14) target = 0.45 + Math.random() * 0.5;
    } else if (state === "listening") {
      target = 0.22 + 0.14 * Math.sin(now / 260);
    } else if (state === "thinking") {
      target = 0.18;
    } else {
      target = 0.04;
    }
    level += (target - level) * 0.2;
  }

  /** One half of the rings: "back" (behind the planet) or "front" (over it). */
  function drawRings(pr, half, seconds) {
    const [from, to] = half === "back" ? [Math.PI, Math.PI * 2] : [0, Math.PI];
    const voice = state === "speaking" ? level : 0;
    const tone = mix(mix(RING, ACCENT, cool * 0.55), GOLD, voice * 0.45);
    const lit = (half === "back" ? 0.62 : 0.85) + level * 0.5;
    ctx.lineWidth = ((RING_OUTER - RING_INNER) * pr) / RING_STROKES + 0.7;
    for (let i = 0; i < RING_STROKES; i++) {
      const t = (i + 0.5) / RING_STROKES;
      const r = pr * (RING_INNER + t * (RING_OUTER - RING_INNER));
      ctx.strokeStyle = rgba(tone, ringProfile(t) * ringWave(t, seconds, voice) * lit * 0.62);
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * SQUASH, 0, from, to);
      ctx.stroke();
    }
    // the dust; while thinking, a bright streak runs around the rings
    const streak = (orbit * 1.7) % (Math.PI * 2);
    ctx.globalCompositeOperation = "lighter";
    for (const d of dust) {
      const a = (d.angle + orbit * d.speed) % (Math.PI * 2);
      if (Math.sin(a) >= 0 !== (half === "front")) continue;
      let gap = Math.abs(a - streak);
      if (gap > Math.PI) gap = Math.PI * 2 - gap;
      const run = busy * Math.max(0, 1 - gap / 0.9);
      const twinkle = 0.5 + 0.5 * Math.sin(seconds * 2 + d.phase);
      const alpha = 0.16 + 0.3 * twinkle + voice * 0.5 + run * 0.8;
      ctx.fillStyle = rgba(
        mix(tone, GOLD, Math.min(1, 0.3 + run + voice)),
        alpha * (half === "back" ? 0.7 : 1)
      );
      const dot = d.size * (size / 460) * (1 + run * 1.4 + voice * 0.8);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d.r * pr, Math.sin(a) * d.r * pr * SQUASH, dot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawPlanet(pr) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.clip();
    // cloud bands, curved as on a ball seen a little from above
    for (const [top, bottom, color] of BANDS) {
      const bulge = (lat) => pr * 0.2 * (1 - lat * lat) + pr * 0.02;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-pr * 1.1, top * pr);
      ctx.quadraticCurveTo(0, top * pr + bulge(top) * 2, pr * 1.1, top * pr);
      ctx.lineTo(pr * 1.1, bottom * pr + 1);
      ctx.quadraticCurveTo(0, bottom * pr + bulge(bottom) * 2 + 1, -pr * 1.1, bottom * pr + 1);
      ctx.closePath();
      ctx.fill();
    }
    // soft storms carried around by the planet's turn
    for (const s of storms) {
      const a = s.phase + spin * s.speed;
      const facing = Math.cos(a);
      if (facing <= 0.05) continue;
      const wide = Math.sqrt(1 - s.lat * s.lat);
      const x = Math.sin(a) * pr * wide;
      const y = s.lat * pr + pr * 0.2 * (1 - s.lat * s.lat) * (1 - (x / pr) ** 2);
      ctx.fillStyle = s.light
        ? `rgba(255, 244, 214, ${(0.2 * facing).toFixed(3)})`
        : `rgba(90, 66, 32, ${(0.2 * facing).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, pr * s.width * facing, pr * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // the shadow the rings cast on the planet
    ctx.strokeStyle = "rgba(20, 14, 6, 0.38)";
    ctx.lineWidth = pr * 0.1;
    ctx.beginPath();
    ctx.ellipse(0, -pr * 0.16, pr * 1.45, pr * 1.45 * SQUASH, 0, 0, Math.PI);
    ctx.stroke();
    // light from the upper left, night on the lower right
    const shade = ctx.createRadialGradient(
      -pr * 0.45,
      -pr * 0.5,
      pr * 0.1,
      -pr * 0.1,
      -pr * 0.1,
      pr * 1.25
    );
    shade.addColorStop(0, "rgba(255, 250, 235, 0.22)");
    shade.addColorStop(0.45, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(3, 3, 8, 0.88)");
    ctx.fillStyle = shade;
    ctx.fillRect(-pr, -pr, pr * 2, pr * 2);
    ctx.restore();
    // a thin bright rim of atmosphere
    ctx.strokeStyle = rgba(mix([255, 240, 205], ACCENT, cool * 0.6), 0.14 + level * 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.stroke();
  }

  function frame(now) {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    readLevel(now);
    const calm = reduceMotion ? 0.15 : 1;
    spin += dt * calm * (state === "thinking" ? 0.5 : state === "speaking" ? 0.22 : 0.1);
    orbit += dt * calm * (state === "thinking" ? 1.9 : state === "speaking" ? 0.7 : 0.25);
    cool += ((state === "listening" ? 1 : 0) - cool) * 0.06;
    busy += ((state === "thinking" ? 1 : 0) - busy) * 0.08;

    const R = size / 2;
    const voice = state === "speaking" ? level : 0;
    const pr = R * 0.36 * (1 + voice * 0.03);
    const seconds = reduceMotion ? 0 : now / 1000;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);

    // the glow around the planet: stronger when he listens or speaks
    const glow = ctx.createRadialGradient(0, 0, pr * 0.7, 0, 0, R);
    const tone = mix(GOLD, ACCENT, cool);
    glow.addColorStop(0, rgba(tone, 0.07 + level * 0.3));
    glow.addColorStop(0.45, rgba(tone, 0.02 + level * 0.08));
    glow.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-R, -R, size, size);

    ctx.rotate(ROLL);
    drawRings(pr, "back", seconds);
    drawPlanet(pr);
    drawRings(pr, "front", seconds);
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
    /** That audio ended: back to the word pulses of the browser voice (if it is still the one). */
    detachAnalyser(node) {
      if (analyser !== node) return;
      analyser = null;
      samples = null;
    },
  };
}
