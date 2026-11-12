import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createCare, isHot, isLate, REST_LINE, WATER_LINE } from "../../contrib/alfred/care.mjs";
import { streamReply } from "../../contrib/alfred/brain.mjs";
import { loadConfig } from "../../contrib/alfred/lib.mjs";

test("late night is 23:00–04:59; hot is 32 °C or more (now or the day's maximum)", () => {
  assert.equal(isLate(new Date(2026, 9, 10, 22, 59)), false);
  assert.equal(isLate(new Date(2026, 9, 10, 23, 0)), true);
  assert.equal(isLate(new Date(2026, 9, 11, 4, 59)), true);
  assert.equal(isLate(new Date(2026, 9, 11, 5, 0)), false);
  assert.equal(isHot({ day: { max: 32 } }), true);
  assert.equal(isHot({ current: { temp: 33 }, day: { max: 30 } }), true);
  assert.equal(isHot({ current: { temp: 25 }, day: { max: 31 } }), false);
  assert.equal(isHot(null), false);
});

test("care reminds rarely: rest every two hours at night, water once a day", () => {
  let at = new Date(2026, 9, 10, 15, 0);
  const care = createCare({ now: () => at });
  assert.equal(care.note(), "", "daytime, no heat: nothing");
  assert.equal(care.note({ weather: { day: { max: 35 } } }), WATER_LINE);
  assert.equal(care.note({ weather: { day: { max: 35 } } }), "", "water only once a day");
  at = new Date(2026, 9, 10, 23, 10);
  assert.equal(care.note(), REST_LINE);
  at = new Date(2026, 9, 11, 0, 30);
  assert.equal(care.note(), "", "not again within two hours");
  at = new Date(2026, 9, 11, 1, 15);
  assert.equal(care.note(), REST_LINE);
  at = new Date(2026, 9, 11, 13, 0);
  assert.equal(care.note({ weather: { current: { temp: 34 } } }), WATER_LINE, "a new day, water again");
});

test("streamReply adds the caring line after a real answer, only when a care is passed", async () => {
  const brain = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"Pois não, mestre."}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => brain.listen(0, "127.0.0.1", r));
  const { port } = brain.address() as { port: number };
  process.env.ALFRED_QUIET = "1";
  try {
    const config = loadConfig({ ALFRED_LOCAL_URL: `http://127.0.0.1:${port}/v1`, ALFRED_MEMORY: "off", ALFRED_WEB: "off", ALFRED_PC: "off" });
    const say = async (care?: ReturnType<typeof createCare>) => {
      let out = "";
      for await (const p of streamReply(config, "local", [{ role: "user", content: "oi" }], { care })) if (typeof p === "string") out += p;
      return out;
    };
    const night = createCare({ now: () => new Date(2026, 9, 10, 23, 30) });
    assert.equal(await say(night), `Pois não, mestre. ${REST_LINE}`);
    assert.equal(await say(night), "Pois não, mestre.", "once, then quiet");
    assert.equal(await say(), "Pois não, mestre.", "no care given (tests, diagnostics): nothing added");
  } finally {
    brain.closeAllConnections();
    brain.close();
  }
});
