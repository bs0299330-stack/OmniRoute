import test from "node:test";
import assert from "node:assert/strict";

import { createPcControl, parseCommand, parseDelay } from "../../contrib/alfred/pc.mjs";

test("parseCommand: sites, programs, searches, volume and shut down — everything else goes to the brain", () => {
  assert.deepEqual(parseCommand("Alfred, abre o YouTube"), { type: "site", key: "youtube" });
  assert.deepEqual(parseCommand("entra no Gmail"), { type: "site", key: "gmail" });
  assert.deepEqual(parseCommand("abre a calculadora"), { type: "program", key: "calculadora" });
  assert.deepEqual(parseCommand("abre o bloco de notas"), { type: "program", key: "bloco de notas" });
  assert.deepEqual(parseCommand("pesquisa receita de bolo no Google"), { type: "search", query: "receita de bolo", where: "google" });
  assert.deepEqual(parseCommand("toca jazz no YouTube"), { type: "search", query: "jazz", where: "youtube" });
  assert.deepEqual(parseCommand("abre receita de lasanha"), { type: "search", query: "receita de lasanha", where: "google" });
  assert.deepEqual(parseCommand("aumenta o volume"), { type: "key", key: "up", times: 5 });
  assert.deepEqual(parseCommand("abaixa o som"), { type: "key", key: "down", times: 5 });
  assert.deepEqual(parseCommand("desliga o som"), { type: "key", key: "mute", times: 1 });
  assert.deepEqual(parseCommand("pausa a música"), { type: "key", key: "playpause", times: 1 });
  assert.deepEqual(parseCommand("próxima música"), { type: "key", key: "next", times: 1 });
  assert.deepEqual(parseCommand("desliga o PC"), { type: "shutdown", restart: false, delay: 0 });
  assert.deepEqual(parseCommand("reinicia o computador"), { type: "shutdown", restart: true, delay: 0 });
  assert.deepEqual(parseCommand("cancela o desligamento"), { type: "cancel" });
  for (const q of ["quanto está o dólar", "liga a luz", "qual a capital da França", "pode parar", "me desliga dessa conversa", ""]) {
    assert.equal(parseCommand(q), null, q);
  }
  assert.equal(parseDelay("desliga o computador daqui a 30 minutos"), 1800);
  assert.equal(parseDelay("desliga daqui a uma hora"), 3600);
  assert.equal(parseDelay("desliga em meia hora"), 1800);
  assert.equal(parseDelay("desliga daqui a 100 horas"), 24 * 3600, "capped at a day");
});

function fakePc(platform = "win32") {
  const calls: string[][] = [];
  let clock = 1_000_000;
  const pc = createPcControl({
    platform,
    now: () => clock,
    spawnImpl: ((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { on() {}, unref() {} };
    }) as never,
  });
  return { pc, calls, wait: (ms: number) => (clock += ms) };
}

test("commands run fixed programs without a shell; user words only reach an encoded https URL", () => {
  const { pc, calls } = fakePc();
  assert.equal(pc.handle("abre o YouTube"), "Abrindo YouTube, senhor.");
  assert.equal(pc.handle("abre a calculadora"), "Abrindo a calculadora, senhor.");
  assert.equal(pc.handle(`pesquisa a & b "c" no google`), `Procurando a & b "c" no Google, senhor.`);
  assert.equal(pc.handle("aumenta o volume"), "Aumentando o volume.");
  assert.equal(pc.handle("que horas são?"), null, "not a command: the brain answers");
  assert.deepEqual(calls[0], ["explorer.exe", "https://www.youtube.com/"]);
  assert.deepEqual(calls[1], ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Start-Process 'calc.exe'"]);
  assert.deepEqual(calls[2], ["explorer.exe", "https://www.google.com/search?q=a%20%26%20b%20%22c%22"]);
  assert.match(calls[3][4], /SendKeys\(\[char\]175\)/);
});

test("shut down always asks first; only 'sim' within 30 s confirms, with a minute to cancel", () => {
  const { pc, calls, wait } = fakePc();
  assert.equal(pc.handle("desliga o PC"), "Tem certeza que quer desligar o computador, senhor? Diga sim para confirmar.");
  assert.equal(calls.length, 0, "nothing runs before the confirmation");
  assert.equal(pc.handle("não"), "Tudo bem, senhor. Não vou desligar.");
  assert.equal(pc.handle("sim"), null, "a later 'sim' confirms nothing");
  assert.match(pc.handle("desliga o computador daqui a 30 minutos") ?? "", /daqui a 30 minutos, senhor\? Diga sim/);
  wait(31_000);
  assert.equal(pc.handle("sim"), null, "the question expired");
  pc.handle("reinicia o computador");
  assert.equal(pc.handle("sim, pode"), "Reiniciando o computador em um minuto, senhor. Se mudar de ideia, diga: cancela o desligamento.");
  assert.deepEqual(calls.at(-1), ["shutdown.exe", "/r", "/t", "60"]);
  assert.equal(pc.handle("cancela o desligamento"), "Desligamento cancelado, senhor.");
  assert.deepEqual(calls.at(-1), ["shutdown.exe", "/a"]);
  pc.handle("desliga o PC");
  assert.equal(pc.handle("abre o youtube"), "Abrindo YouTube, senhor.", "another command drops the pending shut down");
  assert.ok(!calls.some((c) => c[1] === "/s"), "the PC was never shut down");
});

test("outside Windows the commands are recognised but not run", () => {
  const { pc, calls } = fakePc("linux");
  assert.match(pc.handle("abre o YouTube") ?? "", /só consigo mexer no computador quando ele é Windows/);
  assert.equal(calls.length, 0);
});
