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
  assert.equal(pc.handle("abre o YouTube"), "Abrindo YouTube, mestre.");
  assert.equal(pc.handle("abre a calculadora"), "Abrindo a calculadora, mestre.");
  assert.equal(pc.handle(`pesquisa a & b "c" no google`), `Procurando a & b "c" no Google, mestre.`);
  assert.equal(pc.handle("aumenta o volume"), "Aumentando o volume.");
  assert.equal(pc.handle("que horas são?"), null, "not a command: the brain answers");
  assert.deepEqual(calls[0], ["explorer.exe", "https://www.youtube.com/"]);
  assert.deepEqual(calls[1], ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Start-Process 'calc.exe'"]);
  assert.deepEqual(calls[2], ["explorer.exe", "https://www.google.com/search?q=a%20%26%20b%20%22c%22"]);
  assert.match(calls[3][4], /SendKeys\(\[char\]175\)/);
});

test("shut down always asks first; only 'sim' within 30 s confirms, with a minute to cancel", () => {
  const { pc, calls, wait } = fakePc();
  assert.equal(pc.handle("desliga o PC"), "Tem certeza que quer desligar o computador, mestre? Diga sim para confirmar.");
  assert.equal(calls.length, 0, "nothing runs before the confirmation");
  assert.equal(pc.handle("não"), "Tudo bem, mestre. Não vou desligar.");
  assert.equal(pc.handle("sim"), null, "a later 'sim' confirms nothing");
  assert.match(pc.handle("desliga o computador daqui a 30 minutos") ?? "", /daqui a 30 minutos, mestre\? Diga sim/);
  wait(31_000);
  assert.equal(pc.handle("sim"), null, "the question expired");
  pc.handle("reinicia o computador");
  assert.equal(pc.handle("sim, pode"), "Reiniciando o computador em um minuto, mestre. Se mudar de ideia, diga: cancela o desligamento.");
  assert.deepEqual(calls.at(-1), ["shutdown.exe", "/r", "/t", "60"]);
  assert.equal(pc.handle("cancela o desligamento"), "Desligamento cancelado, mestre.");
  assert.deepEqual(calls.at(-1), ["shutdown.exe", "/a"]);
  pc.handle("desliga o PC");
  assert.equal(pc.handle("abre o youtube"), "Abrindo YouTube, mestre.", "another command drops the pending shut down");
  assert.ok(!calls.some((c) => c[1] === "/s"), "the PC was never shut down");
});

test("outside Windows the commands are recognised but not run", () => {
  const { pc, calls } = fakePc("linux");
  assert.match(pc.handle("abre o YouTube") ?? "", /só consigo mexer no computador quando ele é Windows/);
  assert.equal(calls.length, 0);
});

test("questions and stories never act on the PC (they go to the brain)", () => {
  for (const q of [
    "o que acontece se eu desligar o computador durante a atualização?",
    "desligar o computador faz mal?",
    "desligar o computador faz mal",
    "você sabe reiniciar o computador pelo teclado",
    "minha mãe desliga o computador todo dia",
    "desliga a máquina de lavar",
    "meu celular não desliga, o que eu faço?",
    "por que meu computador não reinicia",
    "liga pra minha mãe",
    "vai na padaria comprar pão pra mim",
    "o som está mais alto que o normal, por quê?",
    "qual é a próxima",
    "a TV está sem som",
  ]) {
    assert.equal(parseCommand(q), null, q);
  }
  assert.deepEqual(parseCommand("abre o YouTube por favor"), { type: "site", key: "youtube" });
  assert.deepEqual(parseCommand("abre o meu email"), { type: "site", key: "email" });
  assert.deepEqual(parseCommand("pode desligar o computador"), { type: "shutdown", restart: false, delay: 0 });
  assert.deepEqual(parseCommand("pesquisa receita de pão de queijo no Google"), { type: "search", query: "receita de pão de queijo", where: "google" });
});

test("delays: words, compounds, '1h', 'e meia' and a clock time; an unclear time is asked", () => {
  assert.equal(parseDelay("desliga daqui a quarenta e cinco minutos"), 2700);
  assert.equal(parseDelay("desliga daqui a sete minutos"), 420);
  assert.equal(parseDelay("desliga daqui a 1h"), 3600);
  assert.equal(parseDelay("desliga em uma hora e meia"), 5400);
  assert.equal(parseDelay("desliga o pc às 22 horas", new Date(2026, 9, 12, 21, 30)), 1800);
  assert.equal(parseDelay("desliga o pc às 7h", new Date(2026, 9, 12, 21, 0)), 10 * 3600, "tomorrow morning");
  assert.equal(parseDelay("desliga daqui a pouco"), null);
  const { pc, calls } = fakePc();
  assert.match(pc.handle("desliga o computador daqui a pouco") ?? "", /Não entendi para quando/);
  assert.match(pc.handle("desliga o computador em uma hora e meia") ?? "", /daqui a uma hora e meia, mestre\?/);
  assert.equal(calls.length, 0);
});

test("only a real yes confirms: 'pode deixar', 'claro que não' or a question never shut the PC down", () => {
  for (const reply of ["pode deixar", "pode me explicar melhor?", "isso é sério?", "claro que não, era só um comentário"]) {
    const { pc, calls } = fakePc();
    pc.handle("desliga o PC");
    pc.handle(reply);
    assert.ok(!calls.some((c) => c[0] === "shutdown.exe"), reply);
  }
  const { pc, calls } = fakePc();
  pc.handle("desliga o PC");
  assert.equal(pc.handle("pode deixar"), "Tudo bem, mestre. Não vou desligar.");
  pc.handle("desliga o PC");
  assert.equal(pc.handle("que horas são"), null, "another subject: dropped, and the brain answers");
  assert.equal(calls.length, 0);
  pc.handle("desliga o PC");
  assert.match(pc.handle("sim, mestre") ?? "", /^Desligando o computador em um minuto/);
});

test("from Jarvis: maps and routes, a print of the screen, how the PC is doing, any site", async () => {
  assert.deepEqual(parseCommand("Alfred, mostra no mapa a praça de Cabixi"), { type: "map", place: "a praça de cabixi" });
  assert.deepEqual(parseCommand("como chegar em Vilhena?"), { type: "route", place: "vilhena" });
  assert.deepEqual(parseCommand("tira um print"), { type: "screenshot" });
  assert.deepEqual(parseCommand("como está o computador?"), { type: "sysinfo" });
  assert.deepEqual(parseCommand("abre o site mercado livre ponto com ponto br"), { type: "address", host: "mercadolivre.com.br" });
  assert.deepEqual(parseCommand("abre o GitHub"), { type: "site", key: "github" });
  assert.equal(parseCommand("tira uma foto"), null);
  const calls: string[][] = [];
  const pc = createPcControl({
    platform: "win32",
    spawnImpl: ((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { on() {}, unref() {} };
    }) as never,
    systemInfo: async () => ({ cpu: 30, usedMem: 4 * 1024 ** 3, totalMem: 8 * 1024 ** 3, battery: { percent: 15, plugged: false } }),
  });
  assert.equal(pc.handle("como chegar em Vilhena"), "Abrindo o caminho até vilhena, mestre.");
  assert.deepEqual(calls.at(-1), ["explorer.exe", "https://www.google.com/maps/dir/?api=1&destination=vilhena"]);
  pc.handle("abre o site exemplo.com.br");
  assert.deepEqual(calls.at(-1), ["explorer.exe", "https://exemplo.com.br/"]);
  assert.match(pc.handle("tira um print") as string, /Prints do Alfred/);
  assert.equal(calls.at(-1)![0], "powershell.exe");
  assert.match(
    await pc.handle("como está o computador"),
    /processador está em 30 por cento.*memória em 50 por cento.*bateria está em 15 por cento, fora da tomada\. Sugiro ligar o carregador/
  );
});
