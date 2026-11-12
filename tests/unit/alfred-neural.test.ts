import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NEWS_PROMPT,
  NEWS_SLOTS,
  TOPIC_SLOTS,
  armAngle,
  contourSegments,
  newsPrompt,
  shortLabel,
  topicLabel,
  vortexPoint,
} from "../../contrib/alfred/public/neural.mjs";

test("topicLabel: the subject of what was said, in a few words", () => {
  assert.equal(topicLabel("Alfred, qual é a capital da Austrália?"), "Capital da Austrália");
  assert.equal(topicLabel("me explica como funciona a energia solar"), "Energia solar");
  assert.equal(topicLabel("quanto está o dólar hoje"), "Dólar hoje");
  assert.equal(topicLabel("que horas são?"), "Horas");
  assert.equal(topicLabel("vai chover amanhã em Cabixi"), "Vai chover amanhã");
  assert.equal(topicLabel("timer de 5 minutos"), "Timer de 5 minutos");
  assert.equal(topicLabel("o que é?"), "", "only filler words: no subject, no point");
  assert.equal(topicLabel(""), "");
  assert.ok(
    topicLabel("fale sobre a extraordinariamente complicada situação internacional").length <= 25
  );
});

test("shortLabel cuts at a word; a news point asks Alfred to comment that story", () => {
  assert.equal(shortLabel("Curto"), "Curto");
  assert.equal(shortLabel("PGR envia ao Supremo parecer favorável", 22), "PGR envia ao Supremo…");
  assert.equal(newsPrompt(" Dólar cai "), `${NEWS_PROMPT} "Dólar cai"`);
});

test("the vortex: a flattened, leaning disc whose arms wind around the core", () => {
  assert.deepEqual(vortexPoint(0, 1.3), [0, 0], "the core is at the centre");
  for (const angle of [0, 1, 2, 3, 4, 5]) {
    const [x, y] = vortexPoint(1, angle);
    assert.ok(
      Math.hypot(x, y) <= 1.0001 && Math.hypot(x, y) >= 0.6,
      `the edge is an oval (${angle})`
    );
  }
  assert.notEqual(armAngle(0, 0.2), armAngle(0, 0.8), "an arm turns as it leaves the core");
  assert.ok(
    Math.abs(armAngle(1, 0.5) - armAngle(0, 0.5) - Math.PI) < 1e-9,
    "two arms, opposite each other"
  );
});

test("contour lines by marching squares, and subject points that keep off each other and the news", () => {
  // a 3×3 hill: the line at 0.5 is a closed loop of 4 segments around the middle
  const hill = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  assert.equal(contourSegments(hill, 3, 3, 0.5).length, 4);
  assert.deepEqual(contourSegments(hill, 3, 3, 2), [], "no line above the top");
  assert.deepEqual(
    contourSegments([0, 1, 0, 1], 2, 2, 0.5),
    [[0.5, 0, 0.5, 1]],
    "a slope: one straight line"
  );
  const slots = [...NEWS_SLOTS, ...TOPIC_SLOTS];
  for (const [i, a] of slots.entries()) {
    for (const b of slots.slice(i + 1))
      assert.ok(Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.85) > 0.3, `${a} / ${b}`);
    assert.ok(!(a[0] < -0.4 && a[1] > 0.1), `${a} would cover the news`);
  }
});

test("the page: neural pathways by default, subjects become points, a touched point is asked", () => {
  const html = readFileSync("contrib/alfred/public/index.html", "utf8");
  assert.match(html, /store\.get\("visual", "neural"\)/);
  assert.match(html, /<option value="neural">Vias neurais<\/option>/);
  assert.match(html, /orb\.addTopic\?\.\(topicLabel\(text\), text\)/);
  assert.match(html, /orb\.pick\?\.\(e\.offsetX, e\.offsetY\)/);
  assert.match(html, /orb\.setNews\?\./);
  assert.match(readFileSync("contrib/alfred/server.mjs", "utf8"), /"\/neural\.mjs"/);
});
