import test from "node:test";
import assert from "node:assert/strict";

import { ClapDetector } from "../../contrib/alfred/public/clap.mjs";

const RATE = 48000;
const BLOCK = 128;

// Deterministic noise so the tests never flake.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s / 4294967296) * 2 - 1;
  };
}

type Sound = { at: number; kind: "clap" | "voice" | "click"; amp?: number; length?: number };

/** Renders seconds of room noise with claps (sharp, ~15 ms decay), voice (sustained) or clicks. */
function render(seconds: number, sounds: Sound[], seed = 7): Float32Array {
  const rand = noise(seed);
  const out = new Float32Array(Math.floor(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.004;
  for (const s of sounds) {
    const start = Math.floor(s.at * RATE);
    if (s.kind === "clap" || s.kind === "click") {
      const amp = s.amp ?? (s.kind === "clap" ? 0.7 : 0.12);
      const tau = s.kind === "clap" ? 0.012 : 0.004;
      for (let i = 0; i < 0.15 * RATE && start + i < out.length; i++) {
        out[start + i] += rand() * amp * Math.exp(-i / RATE / tau);
      }
    } else {
      const amp = s.amp ?? 0.5;
      const len = (s.length ?? 0.6) * RATE;
      for (let i = 0; i < len && start + i < out.length; i++) {
        const envelope = Math.min(1, i / (0.01 * RATE)) * (0.7 + 0.3 * Math.sin(i / 400));
        out[start + i] += Math.sin(i / 9) * amp * envelope + rand() * amp * 0.2;
      }
    }
  }
  return out;
}

function events(signal: Float32Array, options = {}, muted = false) {
  const detector = new ClapDetector(RATE, options);
  detector.muted = muted;
  const found: { type: string; at: number }[] = [];
  for (let i = 0; i < signal.length; i += BLOCK) {
    const event = detector.push(signal.subarray(i, i + BLOCK));
    if (event) found.push(event);
  }
  return found;
}
const doubles = (list: { type: string }[]) => list.filter((e) => e.type === "double").length;

test("two claps 0.35 s apart wake Alfred", () => {
  const found = events(render(3, [{ at: 1.0, kind: "clap" }, { at: 1.35, kind: "clap" }]));
  assert.equal(doubles(found), 1);
  assert.ok(Math.abs(found.find((e) => e.type === "double")!.at - 1.35) < 0.02);
});

test("a single clap, or two claps too far apart, do nothing", () => {
  assert.equal(doubles(events(render(3, [{ at: 1.0, kind: "clap" }]))), 0);
  assert.equal(doubles(events(render(4, [{ at: 1.0, kind: "clap" }, { at: 2.2, kind: "clap" }]))), 0);
});

test("three claps in a row are not a double clap", () => {
  const found = events(render(3, [
    { at: 1.0, kind: "clap" },
    { at: 1.3, kind: "clap" },
    { at: 1.55, kind: "clap" },
  ]));
  assert.equal(doubles(found), 0);
});

test("speech and music (sustained sound) never count as claps", () => {
  const found = events(render(4, [
    { at: 0.5, kind: "voice", length: 0.5 },
    { at: 1.2, kind: "voice", length: 0.4 },
    { at: 2.0, kind: "voice", amp: 0.9, length: 1.2 },
  ]));
  assert.equal(doubles(found), 0);
});

test("fast typing (a run of clicks) does not trigger", () => {
  const typing: Sound[] = [];
  for (let t = 0.5; t < 3; t += 0.18) typing.push({ at: t, kind: "click", amp: 0.3 });
  assert.equal(doubles(events(render(3.5, typing), { sensitivity: "alta" })), 0);
});

test("sensitivity: soft claps need 'alta'; while muted nothing fires", () => {
  const soft = render(3, [{ at: 1.0, kind: "clap", amp: 0.15 }, { at: 1.4, kind: "clap", amp: 0.15 }]);
  assert.equal(doubles(events(soft, { sensitivity: "baixa" })), 0);
  assert.equal(doubles(events(soft, { sensitivity: "alta" })), 1);
  const loud = render(3, [{ at: 1.0, kind: "clap" }, { at: 1.35, kind: "clap" }]);
  assert.equal(doubles(events(loud, {}, true)), 0);
});

test("after a double clap, a new one works again after a pause", () => {
  const found = events(render(6, [
    { at: 1.0, kind: "clap" },
    { at: 1.35, kind: "clap" },
    { at: 4.0, kind: "clap" },
    { at: 4.4, kind: "clap" },
  ]));
  assert.equal(doubles(found), 2);
});
