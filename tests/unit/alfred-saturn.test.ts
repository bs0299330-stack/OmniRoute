import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RING_INNER,
  RING_OUTER,
  ringProfile,
  ringWave,
} from "../../contrib/alfred/public/saturn.mjs";

test("Saturn's rings: faint C ring, bright B ring, dark Cassini division, A ring with the Encke gap", () => {
  assert.ok(RING_INNER > 1 && RING_OUTER > RING_INNER, "the rings start outside the planet");
  assert.ok(ringProfile(0.1) < ringProfile(0.4), "C ring fainter than B ring");
  assert.ok(ringProfile(0.4) >= 0.6);
  assert.equal(ringProfile(0.63), 0.05, "Cassini division");
  assert.ok(
    ringProfile(0.8) > ringProfile(0.63) && ringProfile(0.8) < ringProfile(0.4),
    "A ring between the two"
  );
  assert.equal(ringProfile(0.91), 0.1, "Encke gap");
  assert.equal(ringProfile(-0.1), 0);
  assert.equal(ringProfile(1.1), 0);
  assert.equal(ringProfile(Number.NaN), 0);
});

test("the voice travels through the rings: nothing when silent, a moving wave when he speaks", () => {
  assert.equal(ringWave(0.3, 12, 0), 1, "silent: the rings are unchanged");
  const loud = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ringWave(t, 1, 1));
  assert.ok(Math.max(...loud) > 1.3 && Math.min(...loud) < 0.7, "bright and dark bands");
  assert.ok(Math.min(...loud) >= 0.15, "never vanishes");
  assert.notEqual(ringWave(0.3, 1, 1), ringWave(0.3, 1.2, 1), "it moves with time");
});

test("the page draws Saturn by default and keeps the particle globe as an option", () => {
  const html = readFileSync("contrib/alfred/public/index.html", "utf8");
  assert.match(html, /store\.get\("visual", "saturno"\)/);
  assert.match(html, /<option value="globo">Globo de partículas<\/option>/);
  assert.match(readFileSync("contrib/alfred/server.mjs", "utf8"), /"\/saturn\.mjs"/);
});
