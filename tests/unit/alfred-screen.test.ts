import test from "node:test";
import assert from "node:assert/strict";

import { clockParts, indicatorFor, newsView, startNews } from "../../contrib/alfred/public/screen.mjs";

test("clock: hour and minute, seconds apart, weekday with a capital letter, date in full", () => {
  assert.deepEqual(clockParts(new Date(2026, 9, 11, 20, 43, 23)), {
    hm: "20:43",
    sec: "23",
    day: "Domingo",
    date: "11 de outubro de 2026",
  });
  const monday = clockParts(new Date(2026, 9, 12, 7, 5, 9));
  assert.equal(monday.hm, "07:05");
  assert.equal(monday.sec, "09");
  assert.equal(monday.day, "Segunda-feira");
});

test("indicator: 'Voz ativa' while listening for a call, then Ouvindo / Pensando / Falando", () => {
  assert.deepEqual(indicatorFor("idle"), { state: "idle", label: "Voz ativa" });
  assert.deepEqual(indicatorFor("idle", { mic: false }), { state: "off", label: "Microfone desligado" });
  assert.deepEqual(indicatorFor("listening"), { state: "listening", label: "Ouvindo" });
  assert.deepEqual(indicatorFor("thinking"), { state: "thinking", label: "Pensando" });
  assert.deepEqual(indicatorFor("speaking"), { state: "speaking", label: "Falando" });
  assert.deepEqual(indicatorFor("speaking", { music: true }), { state: "speaking", label: "Tocando música" });
});

test("news view: the main story with its category (or the source), then up to three titles", () => {
  const items = [
    { title: " Câmara aprova projeto ", category: "Política", summary: "Resumo." },
    { title: "Dois", category: "Esportes" },
    { title: "" },
    { title: "Três" },
    { title: "Quatro" },
    { title: "Cinco" },
  ];
  assert.deepEqual(newsView({ source: "Agência Brasil", items }), {
    tag: "Política.",
    title: "Câmara aprova projeto",
    summary: "Resumo.",
    more: [
      { n: "02", title: "Dois" },
      { n: "03", title: "Três" },
      { n: "04", title: "Quatro" },
    ],
  });
  assert.equal(newsView({ source: "g1", items: [{ title: "Só", category: "" }] })?.tag, "g1.");
  assert.equal(newsView({ source: null, items: [] }), null);
  assert.equal(newsView(null), null);
  assert.equal(newsView({ items: [{ title: 42 }] }), null, "anything that is not text is dropped");
});

test("startNews shows the news, keeps them when a refresh fails, and refreshes on its clock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const shown: string[] = [];
  const answers = [
    { source: "g1", items: [{ title: "Primeira" }] },
    new Error("offline"),
    { source: "g1", items: [{ title: "Segunda" }] },
  ];
  let calls = 0;
  const stop = startNews({
    load: async () => {
      const a = answers[calls++];
      if (a instanceof Error) throw a;
      return a;
    },
    show: (view) => shown.push(view.title),
    everyMs: 1000,
  });
  const flush = () => new Promise((r) => setImmediate(r));
  await flush();
  assert.deepEqual(shown, ["Primeira"]);
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(shown, ["Primeira"], "a failed refresh leaves the screen as it was");
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(shown, ["Primeira", "Segunda"]);
  stop();
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 3, "stopped: no more loads");
});
