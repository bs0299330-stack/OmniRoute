// Alfred — the centre of the panel as abstract neural pathways, in black and white: a vortex of
// light streaks flowing around a bright core, over a backdrop of contour lines (like a relief
// map). On top sit the lit "subject" points: the news of the day (white) and what was talked
// about (gold). Each new subject lights a new point, tied to the one before, so the picture grows
// with the conversation; touching a point makes Alfred talk about it.
//
//   const net = createNeural(canvas);         // same handle as createOrb (hud.mjs), plus:
//   net.setNews(["Manchete 1", …]);           // the news points
//   const id = net.addTopic("Dólar hoje", "quanto está o dólar hoje?");
//   const hit = net.pick(x, y);               // → { id, kind, label, prompt } or null
//   net.setActive(id); net.clearTopics();
//
// Idle: the streaks drift slowly into the core. Listening: they are drawn in faster. Thinking: the
// vortex spins fast. Speaking: the flow turns around and the streaks pour out of the core with the
// loudness of the voice. The pure helpers at the top are unit-tested.

import { STATE_LABELS } from "./hud.mjs";

const GOLD = [245, 196, 0];
const WHITE = [255, 255, 255];

// Where the subject points sit, from the centre: x in half-widths, y in half-heights. The lower
// left stays clear for the "Notícias do dia" panel.
export const NEWS_SLOTS = [
  [-0.64, -0.58],
  [0.6, -0.64],
  [0.82, 0.02],
  [-0.14, -0.84],
];
export const TOPIC_SLOTS = [
  [-0.74, -0.2],
  [0.68, 0.52],
  [0.2, 0.8],
  [-0.3, 0.66],
  [0.44, -0.3],
  [-0.34, 0.26],
];

const LEAD = new Set(
  "alfred alfredo por favor ei oi olá ola me qual quais que quem como onde quando quanto quanta quantos quantas porque o a os as um uma é e são sao foi está esta estão estao fala fale falar diz diga dizer explica explique explicar conta conte contar mostra mostre sobre de do da dos das você voce sabe pode poderia consegue quero queria gostaria saber funciona funcionam significa mais pra para mim tem há ha eu se".split(
    " "
  )
);
const TRAIL = new Set(
  "de do da dos das e a o as os em no na para pra com que é são sao está esta foi um uma por".split(
    " "
  )
);

/** Cuts a text to about `max` characters at a word, with "…". */
export function shortLabel(text, max = 24) {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * The subject of what was said, in a few words, for a point's label:
 * "Alfred, qual é a capital da Austrália?" → "Capital da Austrália".
 */
export function topicLabel(text) {
  const words = String(text ?? "")
    .replace(/[?!.,;:"“”()]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let start = 0;
  while (start < words.length && LEAD.has(words[start].toLowerCase())) start++;
  const picked = words.slice(start, start + 4);
  if (!picked.length) return ""; // "o que é?": no subject, no point
  while (picked.length > 1 && TRAIL.has(picked[picked.length - 1].toLowerCase())) picked.pop();
  const label = shortLabel(picked.join(" "), 24);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** What Alfred is asked when a news point is touched. */
export const NEWS_PROMPT = "Comente em poucas frases esta notícia de hoje:";
export const newsPrompt = (title) => `${NEWS_PROMPT} "${String(title).trim()}"`;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The vortex: a disc of streaks seen from the side (flattened) and leaning to the left.
const LEAN = -0.32;
const FLAT = 0.62;
const ARMS = 2;
const TWIST = 3.3;

/** A place on the vortex: `r` 0 (core) … 1 (edge) at `angle` → [x, y], with the disc flattened and leaning. */
export function vortexPoint(r, angle) {
  const x = Math.cos(angle) * r;
  const y = Math.sin(angle) * r * FLAT;
  return [x * Math.cos(LEAN) - y * Math.sin(LEAN), x * Math.sin(LEAN) + y * Math.cos(LEAN)];
}

/** The angle of spiral arm `arm` at radius `r`: the arms wind around as they leave the core. */
export function armAngle(arm, r) {
  return (arm / ARMS) * Math.PI * 2 + TWIST * Math.log(r + 0.12);
}

/**
 * The contour line of `level` over a grid of heights (`values[row * cols + col]`), by marching
 * squares: a list of little segments [x1, y1, x2, y2] in grid units.
 */
export function contourSegments(values, cols, rows, level) {
  const out = [];
  const at = (c, r) => values[r * cols + c];
  const cross = (v1, v2) => (level - v1) / (v2 - v1 || 1e-9);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = at(c, r); // top left
      const b = at(c + 1, r); // top right
      const d = at(c, r + 1); // bottom left
      const e = at(c + 1, r + 1); // bottom right
      const kind =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) | (e > level ? 2 : 0) | (d > level ? 1 : 0);
      if (kind === 0 || kind === 15) continue;
      const top = [c + cross(a, b), r];
      const right = [c + 1, r + cross(b, e)];
      const bottom = [c + cross(d, e), r + 1];
      const left = [c, r + cross(a, d)];
      const lines = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[top, right]],
        5: [
          [top, left],
          [bottom, right],
        ],
        6: [[top, bottom]],
        7: [[top, left]],
        8: [[top, left]],
        9: [[top, bottom]],
        10: [
          [top, right],
          [left, bottom],
        ],
        11: [[top, right]],
        12: [[left, right]],
        13: [[bottom, right]],
        14: [[left, bottom]],
      }[kind];
      for (const [p, q] of lines) out.push([p[0], p[1], q[0], q[1]]);
    }
  }
  return out;
}

/** The backdrop: flowing contour lines, a few of them thick, drawn once. Returns a data URL. */
function contourBackdrop(width, height) {
  const cell = 12;
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c * cell) / Math.max(width, height)) * 7;
      const y = ((r * cell) / Math.max(width, height)) * 7;
      values[r * cols + c] =
        Math.sin(x * 1.7 + 1.3 * Math.sin(y * 1.1)) +
        Math.cos(y * 2.1 + 1.1 * Math.cos(x * 0.9)) +
        0.6 * Math.sin((x + y) * 1.3);
    }
  }
  const img = document.createElement("canvas");
  img.width = width;
  img.height = height;
  const g = img.getContext("2d");
  g.fillStyle = "#020203";
  g.fillRect(0, 0, width, height);
  g.lineCap = "round";
  for (const [level, thick] of [
    [-1.3, false],
    [-0.8, false],
    [-0.3, true],
    [0.2, false],
    [0.7, false],
    [1.2, true],
    [1.7, false],
  ]) {
    g.strokeStyle = thick ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.065)";
    g.lineWidth = thick ? 2.2 : 1;
    g.beginPath();
    for (const [x1, y1, x2, y2] of contourSegments(values, cols, rows, level)) {
      g.moveTo(x1 * cell, y1 * cell);
      g.lineTo(x2 * cell, y2 * cell);
    }
    g.stroke();
  }
  return img.toDataURL("image/png");
}

const rgba = (c, a) =>
  `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function createNeural(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const rand = seeded(11);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-6)) * Math.cos(2 * Math.PI * rand());
  // The streaks: most ride a spiral arm (fuzzier towards the edge), some wander between the arms.
  const streaks = Array.from({ length: 1250 }, () => ({
    r: 0.03 + 0.97 * rand() ** 1.25,
    arm: (rand() * ARMS) | 0,
    jitter: gauss(),
    free: rand() < 0.1 ? rand() * Math.PI * 2 : null,
    length: 0.05 + rand() * 0.17,
    thick: rand() < 0.26,
    bright: 0.35 + rand() * 0.65,
    speed: 0.6 + rand() * 0.8,
  }));
  let subjects = []; // the lit points: { id, kind, label, prompt, x, y, born, glow, px, py }
  let trail = []; // links between one subject of the conversation and the next: { a, b, t }
  let nextId = 1;
  let nextSlot = 0;
  let activeId = 0;
  let hoverId = 0;
  let state = "idle";
  let level = 0;
  let target = 0;
  let outward = 0; // 0 the streaks flow into the core … 1 they pour out (speaking)
  let analyser = null;
  let samples = null;
  let width = 0;
  let height = 0;
  let turn = 0;
  let last = performance.now();

  // In this look the whole panel goes black and white, with the contour lines behind everything.
  document.body.classList.add("mono");
  let backdropTimer = 0;
  const paintBackdrop = () => {
    try {
      document.body.style.backgroundImage = `url(${contourBackdrop(Math.max(320, window.innerWidth), Math.max(320, window.innerHeight))})`;
      document.body.style.backgroundSize = "100vw 100vh";
      document.body.style.backgroundAttachment = "fixed";
    } catch {} // no backdrop is fine
  };
  paintBackdrop();
  window.addEventListener("resize", () => {
    clearTimeout(backdropTimer);
    backdropTimer = setTimeout(paintBackdrop, 250);
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    width = box.width || 300;
    height = box.height || 260;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const place = (x, y) => [width / 2 + x * width * 0.47, height / 2 + y * height * 0.45];

  function addSubject(kind, label, prompt, [x, y], quiet) {
    const s = {
      id: nextId++,
      kind,
      label,
      prompt,
      x,
      y,
      born: quiet ? -1e9 : performance.now(),
      glow: quiet ? 0 : 1,
      px: 0,
      py: 0,
    };
    subjects.push(s);
    return s;
  }

  function readLevel(now) {
    if (state === "speaking" && analyser) {
      samples ??= new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      target = Math.min(1, Math.sqrt(sum / samples.length) * 4.5);
    } else if (state === "speaking") {
      target *= 0.9; // word pulses decay; keep the vortex alive when the voice gives no events
      if (target < 0.3 && Math.random() < 0.14) target = 0.45 + Math.random() * 0.5;
    } else if (state === "listening") {
      target = 0.22 + 0.14 * Math.sin(now / 260);
    } else if (state === "thinking") {
      target = 0.2;
    } else {
      target = 0.04;
    }
    level += (target - level) * 0.2;
  }

  /** A point on the curved path between two places, and the bend's control point. */
  function along(ax, ay, bx, by, curve, t) {
    const cx = (ax + bx) / 2 - (by - ay) * curve;
    const cy = (ay + by) / 2 + (bx - ax) * curve;
    const u = 1 - t;
    return [
      u * u * ax + 2 * u * t * cx + t * t * bx,
      u * u * ay + 2 * u * t * cy + t * t * by,
      cx,
      cy,
    ];
  }

  function frame(now) {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    readLevel(now);
    const calm = reduceMotion ? 0.12 : 1;
    const voice = state === "speaking" ? level : 0;
    outward += ((state === "speaking" ? 1 : 0) - outward) * 0.05;
    turn +=
      dt *
      calm *
      (state === "thinking"
        ? 0.55
        : state === "speaking"
          ? 0.12 + level * 0.3
          : state === "listening"
            ? 0.12
            : 0.05);
    const pace =
      calm *
      (state === "thinking"
        ? 2.6
        : state === "speaking"
          ? 1 + level * 4
          : state === "listening"
            ? 1.7
            : 0.5);
    const unit = Math.min(width / 640, height / 540);
    const scale = Math.min(width * 0.48, height * 0.68);
    const cx = width / 2;
    const cy = height / 2;
    const seconds = now / 1000;
    ctx.clearRect(0, 0, width, height);

    // the streaks, drawn in a few batches (by brightness and thickness)
    const batches = Array.from({ length: 8 }, () => []);
    const direction = outward * 2 - 1; // -1 into the core … 1 out of it
    for (const s of streaks) {
      s.r += direction * dt * pace * s.speed * (0.03 + 0.1 * s.r);
      if (s.r < 0.025) s.r = 1;
      else if (s.r > 1) s.r = 0.03;
      const angleAt = (r) =>
        (s.free ?? armAngle(s.arm, r) + s.jitter * (0.13 + 0.36 * r)) +
        (s.free === null ? 0 : TWIST * Math.log(r + 0.12)) -
        turn;
      const tail = Math.min(1.04, s.r * (1 + s.length) + 0.012);
      const [x1, y1] = vortexPoint(s.r, angleAt(s.r));
      const [x2, y2] = vortexPoint(tail, angleAt(tail));
      let alpha =
        s.bright *
        (s.free === null ? 1 : 0.5) *
        (0.2 + 0.8 * (1 - s.r) ** 1.2) *
        Math.min(1, (1 - s.r) / 0.16) *
        (0.8 + level * 0.7);
      if (y1 > 0.02) alpha *= Math.max(0, Math.min(1, (x1 + 0.56) / 0.2)); // the lower left belongs to the news panel
      if (alpha < 0.02) continue;
      batches[Math.min(3, (alpha * 4) | 0) + (s.thick ? 4 : 0)].push(x1, y1, x2, y2);
    }
    ctx.lineCap = "round";
    batches.forEach((lines, i) => {
      if (!lines.length) return;
      ctx.strokeStyle = rgba(WHITE, [0.16, 0.36, 0.6, 0.92][i % 4]);
      ctx.lineWidth = (i >= 4 ? 2.1 : 0.9) * Math.max(0.8, unit);
      ctx.beginPath();
      for (let k = 0; k < lines.length; k += 4) {
        ctx.moveTo(cx + lines[k] * scale, cy + lines[k + 1] * scale);
        ctx.lineTo(cx + lines[k + 2] * scale, cy + lines[k + 3] * scale);
      }
      ctx.stroke();
    });

    // the core: Alfred himself
    const coreR = (26 + level * 34) * unit;
    const heart = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 2.4); // (drawn after the move to the centre)
    heart.addColorStop(0, rgba(WHITE, 0.95));
    heart.addColorStop(0.18, rgba(WHITE, 0.55 + voice * 0.3));
    heart.addColorStop(0.5, rgba(WHITE, 0.1 + level * 0.14));
    heart.addColorStop(1, rgba(WHITE, 0));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(LEAN);
    ctx.scale(1, FLAT + 0.14);
    ctx.fillStyle = heart;
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // the subject points: each is tied to the core by a path, the conversation's are chained in gold
    for (const s of subjects) {
      [s.px, s.py] = place(s.x, s.y);
      s.glow = Math.max(0, s.glow - dt * 0.8);
    }
    for (const s of subjects) {
      const color = s.kind === "news" ? WHITE : GOLD;
      const busy = s.id === activeId && state !== "idle";
      const bend = s.x < 0 ? -0.22 : 0.22;
      const [, , bx, by] = along(cx, cy, s.px, s.py, bend, 0.5);
      ctx.strokeStyle = rgba(color, 0.13 + s.glow * 0.3 + (busy ? 0.2 : 0));
      ctx.lineWidth = Math.max(0.8, unit);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(bx, by, s.px, s.py);
      ctx.stroke();
      if (busy && !reduceMotion) {
        // impulses between the core and the subject he is thinking or talking about
        for (let k = 0; k < 3; k++) {
          let t = (seconds * 0.9 + k / 3) % 1;
          if (state !== "speaking") t = 1 - t;
          const [ix, iy] = along(cx, cy, s.px, s.py, bend, t);
          ctx.fillStyle = rgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(ix, iy, 2.2 * Math.max(0.85, unit), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    for (const link of trail) {
      link.t = Math.min(1, link.t + dt * 1.2);
      const [ex, ey, bx, by] = along(link.a.px, link.a.py, link.b.px, link.b.py, 0.16, link.t);
      ctx.strokeStyle = rgba(GOLD, 0.4);
      ctx.lineWidth = 1.2 * Math.max(0.8, unit);
      ctx.setLineDash([4 * unit + 2, 5 * unit + 2]);
      ctx.beginPath();
      ctx.moveTo(link.a.px, link.a.py);
      if (link.t >= 1) ctx.quadraticCurveTo(bx, by, link.b.px, link.b.py);
      else ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const fontSize = Math.max(11, Math.min(15, 13 * unit));
    ctx.font = `500 ${fontSize}px "Space Grotesk", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const s of subjects) {
      const grow = Math.max(0, Math.min(1, (now - s.born) / 600)); // (a frame can start before `born`)
      const color = s.kind === "news" ? WHITE : GOLD;
      const busy = s.id === activeId && state !== "idle";
      const hot = Math.max(
        s.glow,
        s.id === hoverId ? 0.8 : 0,
        busy ? 0.6 + 0.4 * Math.sin(seconds * 6) : 0
      );
      const r = (5.5 + hot * 2.5) * Math.max(0.9, unit) * grow;
      ctx.fillStyle = "rgba(2, 2, 3, 0.85)"; // a dark bed, so the point reads over the streaks
      ctx.beginPath();
      ctx.arc(s.px, s.py, r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(color, 0.1 + hot * 0.22);
      ctx.beginPath();
      ctx.arc(s.px, s.py, r * 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(mix(color, WHITE, hot * 0.6), 0.97);
      ctx.beginPath();
      ctx.arc(s.px, s.py, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.65 + hot * 0.35);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(s.px, s.py, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      if (grow < 0.5) continue;
      // the name under the point, kept inside the canvas
      const half = ctx.measureText(s.label).width / 2;
      const tx = Math.max(half + 4, Math.min(width - half - 4, s.px));
      const ty = s.py + r * 1.5 + 5;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(2, 2, 3, 0.92)";
      ctx.strokeText(s.label, tx, ty);
      ctx.fillStyle = rgba(
        mix([222, 222, 228], WHITE, hot),
        (0.86 + hot * 0.14) * Math.min(1, (grow - 0.5) * 2)
      );
      ctx.fillText(s.label, tx, ty);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function pick(x, y) {
    let best = null;
    let bestD = Math.max(24, 26 * Math.min(width / 640, height / 540));
    for (const s of subjects) {
      // the point or its name, which sits just below it
      const d = Math.min(Math.hypot(s.px - x, s.py - y), Math.hypot(s.px - x, s.py + 18 - y));
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }
  canvas.addEventListener("pointermove", (e) => {
    const hit = pick(e.offsetX, e.offsetY);
    hoverId = hit?.id ?? 0;
    canvas.title = hit ? `Ouvir sobre: ${hit.label}` : "";
  });
  canvas.addEventListener("pointerleave", () => (hoverId = 0));

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
    detachAnalyser(node) {
      if (analyser !== node) return;
      analyser = null;
      samples = null;
    },
    /** The news of the day as points (up to four titles). */
    setNews(titles) {
      const list = (Array.isArray(titles) ? titles : [])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean)
        .slice(0, NEWS_SLOTS.length);
      const before = subjects.filter((s) => s.kind === "news");
      if (before.length === list.length && before.every((s, i) => s.title === list[i])) return;
      subjects = subjects.filter((s) => s.kind !== "news");
      list.forEach((title, i) => {
        addSubject(
          "news",
          shortLabel(title, 22),
          newsPrompt(title),
          NEWS_SLOTS[i],
          before.length > 0
        ).title = title;
      });
    },
    /** A subject of the conversation: lights a new point (or the same one again). Returns its id. */
    addTopic(label, prompt, { quiet = false } = {}) {
      const name = String(label ?? "").trim();
      if (name.length < 2) return 0;
      const topics = subjects.filter((s) => s.kind === "topic");
      const same = topics.find((s) => s.label.toLowerCase() === name.toLowerCase());
      if (same) {
        same.glow = 1;
        same.prompt = prompt;
        return same.id;
      }
      const slot = TOPIC_SLOTS[nextSlot % TOPIC_SLOTS.length];
      nextSlot++;
      const taken = topics.find((s) => s.x === slot[0] && s.y === slot[1]);
      if (taken) {
        subjects = subjects.filter((s) => s !== taken); // the oldest gives its place
        trail = trail.filter((l) => l.a !== taken && l.b !== taken);
      }
      const previous = subjects.filter((s) => s.kind === "topic").at(-1);
      const s = addSubject("topic", name, prompt, slot, quiet);
      if (previous) trail.push({ a: previous, b: s, t: quiet ? 1 : 0 });
      return s.id;
    },
    setActive(id) {
      activeId = id || 0;
      const s = subjects.find((o) => o.id === activeId);
      if (s) s.glow = 1;
    },
    clearTopics() {
      subjects = subjects.filter((s) => s.kind !== "topic");
      trail = [];
      nextSlot = 0;
    },
    /** The subject point at this place of the canvas (CSS pixels), or null. */
    pick(x, y) {
      const s = pick(x, y);
      if (!s) return null;
      s.glow = 1;
      return { id: s.id, kind: s.kind, label: s.label, prompt: s.prompt };
    },
  };
}
