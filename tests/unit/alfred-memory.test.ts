import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryControl, extractFacts, openMemory, parseMemoryCommand } from "../../contrib/alfred/memory.mjs";

const dir = mkdtempSync(join(tmpdir(), "alfred-mem-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("extractFacts picks up name, birthdays, family, likes, home, work, favourites and 'lembre que'", () => {
  assert.deepEqual(extractFacts("Alfred, meu nome é bruno silva"), [{ kind: "name", value: "Bruno Silva" }]);
  assert.deepEqual(extractFacts("meu aniversário é dia 10 de março"), [{ kind: "birthday", who: "", day: 10, month: 2 }]);
  assert.deepEqual(extractFacts("o aniversário da minha mãe é dia primeiro de maio"), [{ kind: "birthday", who: "sua mãe", day: 1, month: 4 }]);
  assert.deepEqual(extractFacts("meu pai faz aniversário dia 3 de junho"), [{ kind: "birthday", who: "seu pai", day: 3, month: 5 }]);
  assert.deepEqual(extractFacts("minha esposa se chama ana"), [{ kind: "fact", text: "Sua esposa se chama Ana" }]);
  assert.deepEqual(extractFacts("eu gosto muito de pizza de calabresa"), [{ kind: "fact", text: "Gosta de pizza de calabresa" }]);
  assert.deepEqual(extractFacts("eu não gosto de chuva"), [{ kind: "fact", text: "Não gosta de chuva" }]);
  assert.deepEqual(extractFacts("eu moro em Cabixi"), [{ kind: "fact", text: "Mora em Cabixi" }]);
  assert.deepEqual(extractFacts("eu trabalho com vendas"), [{ kind: "fact", text: "Trabalha com vendas" }]);
  assert.deepEqual(extractFacts("meu time favorito é o Flamengo"), [{ kind: "fact", text: "Seu time favorito é Flamengo" }]);
  assert.deepEqual(extractFacts("lembre que tenho dentista na terça"), [{ kind: "fact", text: "O senhor pediu para lembrar: tenho dentista na terça" }]);
  for (const q of ["eu sou o melhor", "quanto está o dólar", "abre o youtube", ""]) assert.deepEqual(extractFacts(q), [], q);
});

test("parseMemoryCommand: recall, forget one thing, forget everything", () => {
  assert.deepEqual(parseMemoryCommand("Alfred, o que você sabe sobre mim?"), { type: "recall" });
  assert.deepEqual(parseMemoryCommand("esquece que eu gosto de pizza"), { type: "forget", query: "eu gosto de pizza" });
  assert.deepEqual(parseMemoryCommand("esquece tudo"), { type: "forgetAll" });
  assert.deepEqual(parseMemoryCommand("apaga sua memória"), { type: "forgetAll" });
  assert.equal(parseMemoryCommand("que horas são"), null);
});

test("the memory learns, updates instead of duplicating, survives a restart, and forgets", () => {
  const file = join(dir, "a.json");
  const m = openMemory(file);
  assert.equal(m.learn("meu nome é Bruno"), 1);
  assert.equal(m.learn("eu gosto de pizza"), 1);
  assert.equal(m.learn("eu gosto de pizza"), 0, "no duplicates");
  m.learn("o aniversário da minha mãe é dia 3 de maio");
  m.learn("o aniversário da minha mãe é dia 4 de maio");
  const again = openMemory(file);
  assert.equal(again.name, "Bruno");
  assert.deepEqual(again.facts, ["Gosta de pizza", "O aniversário da sua mãe é dia 4 de maio"], "the newer date replaced the old one");
  assert.deepEqual(again.birthdaysOn(new Date(2027, 4, 4)), [{ who: "sua mãe" }]);
  assert.deepEqual(again.birthdaysOn(new Date(2027, 4, 3)), []);
  assert.match(again.block(), /^\[Memória: o nome do senhor é Bruno \(use o nome de vez em quando, sem exagero\); Gosta de pizza; O aniversário da sua mãe é dia 4 de maio\.\]$/);
  assert.equal(again.forget("eu gosto de pizza"), 1);
  assert.equal(again.forget("o meu nome"), 1);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).facts.length, 1);
  assert.equal(openMemory(join(dir, "nada.json")).block(), "", "empty memory sends nothing");
  assert.ok(!existsSync(join(dir, "nada.json")), "nothing is written until there is something to keep");
});

test("memory control: answers recall/forget/remember itself; 'esquece tudo' needs a 'sim'", () => {
  let clock = 0;
  const m = openMemory(join(dir, "b.json"));
  const c = createMemoryControl(m, { now: () => clock });
  assert.equal(c.handle("o que você sabe sobre mim?"), "Ainda não sei nada sobre o senhor. Conte-me o que quiser, que eu guardo.");
  assert.equal(c.handle("meu nome é Bruno e eu gosto de pizza"), null, "learned silently, the brain still answers");
  assert.equal(c.handle("Alfred, lembre que o carro é na oficina do Zé"), "Anotado, senhor.");
  assert.equal(
    c.handle("o que você sabe sobre mim?"),
    "O seu nome é Bruno. Sei que: Gosta de pizza; O senhor pediu para lembrar: o carro é na oficina do Zé."
  );
  assert.match(c.handle("esquece tudo") ?? "", /Tem certeza/);
  assert.equal(c.handle("não"), null);
  assert.equal(m.name, "Bruno", "a 'não' keeps everything");
  c.handle("esquece tudo");
  clock += 31_000;
  assert.equal(c.handle("sim"), null, "the question expired");
  c.handle("esquece tudo");
  assert.match(c.handle("sim") ?? "", /Esqueci tudo/);
  assert.equal(m.name, "");
  assert.deepEqual(m.facts, []);
});

test("Alfred uses the memory: [Memória] goes to the brain, and the briefing greets by name with birthdays", async () => {
  const { createServer } = await import("node:http");
  const { loadConfig } = await import("../../contrib/alfred/lib.mjs");
  const { streamReply } = await import("../../contrib/alfred/brain.mjs");
  const { buildBriefing } = await import("../../contrib/alfred/weblite.mjs");
  let sent: { messages: { content: string }[] } | null = null;
  const brain = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      sent = JSON.parse(raw);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"Pois não."}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => brain.listen(0, "127.0.0.1", () => resolve()));
  const { port } = brain.address() as { port: number };
  process.env.ALFRED_QUIET = "1";
  try {
    const config = loadConfig({ ALFRED_LOCAL_URL: `http://127.0.0.1:${port}/v1`, ALFRED_MEMORY: join(dir, "c.json"), ALFRED_WEB: "off" });
    const say = async (text: string) => {
      let out = "";
      for await (const p of streamReply(config, "local", [{ role: "user", content: text }])) if (typeof p === "string") out += p;
      return out;
    };
    assert.equal(await say("meu nome é Bruno"), "Pois não.");
    assert.match(sent!.messages.at(-1)!.content, /\[Memória: o nome do senhor é Bruno/);
    assert.match(sent!.messages[0].content, /bloco \[Memória: …\]/, "the persona explains the block");
    assert.equal(await say("o que você sabe sobre mim?"), "O seu nome é Bruno.");
    const off = loadConfig({ ALFRED_LOCAL_URL: `http://127.0.0.1:${port}/v1`, ALFRED_MEMORY: "off", ALFRED_WEB: "off" });
    for await (const _ of streamReply(off, "local", [{ role: "user", content: "meu nome é Zé" }]));
    assert.doesNotMatch(sent!.messages.at(-1)!.content, /Memória/);
  } finally {
    brain.closeAllConnections();
    brain.close();
  }
  const text = buildBriefing(new Date(2026, 4, 3, 7, 0), { name: "Bruno Silva", birthdays: [{ who: "sua mãe" }, { who: "" }] });
  assert.equal(
    text,
    "Bom dia, senhor Bruno. Hoje é domingo, 3 de maio, e são 7 horas em ponto. Não se esqueça: hoje é aniversário da sua mãe. E hoje é o seu aniversário! Meus parabéns, senhor. Tenha um excelente dia, senhor."
  );
});
