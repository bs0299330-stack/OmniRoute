import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeWhen,
  findWhen,
  listName,
  openAgenda,
  reminderTask,
  splitItems,
  spokenDuration,
  toNumber,
} from "../../contrib/alfred/agenda.mjs";

// Thursday, 15 October 2026, 14:10
const NOW = new Date(2026, 9, 15, 14, 10);
const when = (text: string, now = NOW, opts = {}) => findWhen(text, now, opts)?.at?.getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

test("numbers in words: 'vinte e cinco', 'duas', 'dez'", () => {
  assert.equal(toNumber("15"), 15);
  assert.equal(toNumber("vinte e cinco"), 25);
  assert.equal(toNumber("duas"), 2);
  assert.equal(toNumber("dez"), 10);
});

test("findWhen: relative times, clock times, periods, days and the 'which 7?' guess", () => {
  assert.equal(when("daqui a 10 minutos"), NOW.getTime() + 10 * 60_000);
  assert.equal(when("daqui a meia hora"), NOW.getTime() + 30 * 60_000);
  assert.equal(when("em uma hora e meia"), NOW.getTime() + 90 * 60_000);
  assert.equal(when("daqui a 2 horas e 15 minutos"), NOW.getTime() + 135 * 60_000);
  assert.equal(when("às 15h"), at(15, 15));
  assert.equal(when("às 15:30"), at(15, 15, 30));
  assert.equal(when("15h30"), at(15, 15, 30));
  assert.equal(when("às 7"), at(15, 19), "7 already passed today: 19h");
  assert.equal(
    when("às 7", NOW, { morning: true }),
    at(16, 7),
    "an alarm at 7 is tomorrow morning"
  );
  assert.equal(when("às 3 da tarde"), at(15, 15));
  assert.equal(when("às 9 da noite"), at(15, 21));
  assert.equal(when("às 7 e meia"), at(15, 19, 30));
  assert.equal(when("às sete e quinze da manhã"), at(16, 7, 15));
  assert.equal(when("ao meio-dia"), at(16, 12));
  assert.equal(when("à meia-noite"), at(16, 0));
  assert.equal(when("amanhã às 8"), at(16, 8));
  assert.equal(when("depois de amanhã às 10 horas"), at(17, 10));
  assert.equal(when("hoje às 3"), at(15, 15), "'hoje às 3' in the afternoon is 15h");
  assert.equal(when("sexta às 9"), at(16, 9));
  assert.equal(when("na segunda-feira às 8"), at(19, 8));
  assert.equal(when("quinta às 9"), at(22, 9), "Thursday 9h already passed: next week");
  assert.equal(findWhen("todo dia às 6", NOW, { morning: true })?.repeat, "daily");
  assert.equal(findWhen("tomar o remédio", NOW), null);
  assert.equal(findWhen("às 25 horas", NOW), null);
});

test("saying when: today, tomorrow, the weekday, a date; durations", () => {
  assert.equal(describeWhen(new Date(at(15, 15)), NOW), "hoje às 15 horas");
  assert.equal(describeWhen(new Date(at(16, 8, 30)), NOW), "amanhã às 8 horas e 30 minutos");
  assert.equal(describeWhen(new Date(at(17, 12)), NOW), "no sábado ao meio-dia");
  assert.equal(describeWhen(new Date(at(19, 0)), NOW), "na segunda-feira à meia-noite");
  assert.equal(describeWhen(new Date(2026, 10, 3, 9), NOW), "no dia 3 de novembro às 9 horas");
  assert.equal(spokenDuration(30_000), "30 segundos");
  assert.equal(spokenDuration(5 * 60_000), "5 minutos");
  assert.equal(spokenDuration(90 * 60_000), "uma hora e meia");
  assert.equal(spokenDuration(135 * 60_000), "2 horas e 15 minutos");
});

test("the reminder's task: what is left once the trigger and the time are taken out", () => {
  const said = "Me lembra de ligar pra minha mãe às 3 da tarde";
  const t = findWhen(said, NOW)!;
  assert.equal(reminderTask(said, [[0, 9], ...t.spans]), "ligar pra sua mãe");
  assert.deepEqual(splitItems("arroz, feijão e o leite"), ["arroz", "feijão", "leite"]);
  assert.equal(listName("põe pão na lista do mercado"), "compras");
  assert.equal(listName("anota isso na lista de tarefas"), "tarefas");
  assert.equal(listName("o que tem na lista?"), "compras");
});

test("reminders, alarms and timers: set, ask, cancel — and the 'para quando?' follow-up", () => {
  let now = NOW;
  const a = openAgenda(null, { now: () => now });
  assert.equal(
    a.handle("Me lembra de tomar o remédio às 15h"),
    "Combinado, mestre. Hoje às 15 horas, eu o lembro: tomar o remédio."
  );
  assert.equal(
    a.handle("Alfred, me avisa daqui a 20 minutos para tirar o bolo do forno"),
    "Combinado, mestre. Daqui a 20 minutos, eu o lembro: tirar o bolo do forno."
  );
  assert.equal(a.handle("me lembra de pagar a conta de luz"), "Para quando, mestre?");
  assert.equal(
    a.handle("amanhã às 9"),
    "Combinado, mestre. Amanhã às 9 horas, eu o lembro: pagar a conta de luz."
  );
  assert.equal(a.handle("amanhã me lembra de ligar pro João"), "A que horas, mestre?");
  assert.equal(
    a.handle("às 10"),
    "Combinado, mestre. Amanhã às 10 horas, eu o lembro: ligar pro João.",
    "the day said first is kept"
  );
  assert.equal(
    a.handle("me acorda às 6"),
    "Combinado, mestre: despertador para amanhã às 6 horas."
  );
  assert.equal(
    a.handle("despertador às 6"),
    "Combinado, mestre: despertador para amanhã às 6 horas."
  );
  assert.equal(
    a.items.filter((i: { kind: string }) => i.kind === "alarm").length,
    1,
    "the same alarm twice is one"
  );
  assert.equal(
    a.handle("me acorda todos os dias às 5 e meia"),
    "Combinado, mestre: o despertador vai tocar todos os dias às 5 horas e 30 minutos."
  );
  assert.equal(
    a.handle("timer de 5 minutos"),
    "Pois não, mestre. Timer de 5 minutos, começando agora."
  );
  assert.equal(a.handle("coloca um timer"), "De quanto tempo, mestre?");
  assert.equal(a.handle("dez minutos"), "Pois não, mestre. Timer de 10 minutos, começando agora.");
  now = new Date(NOW.getTime() + 100_000);
  assert.equal(
    a.handle("quanto falta no timer?"),
    "Faltam 3 minutos e 20 segundos no timer de 5 minutos, mestre."
  );
  assert.match(
    a.handle("quais são meus lembretes?")!,
    /^O senhor tem 4: hoje às 14 horas e 30 minutos, tirar o bolo do forno; hoje às 15 horas, tomar o remédio; amanhã às 9 horas/
  );
  assert.equal(
    a.handle("cancela o lembrete do bolo"),
    "Pronto, mestre: cancelei o lembrete de hoje às 14 horas e 30 minutos: tirar o bolo do forno."
  );
  assert.equal(a.handle("apaga todos os timers"), "Pronto, mestre: cancelei 2 timers.");
  assert.equal(a.handle("quanto falta no timer?"), "Não há nenhum timer ligado, mestre.");
  // not for the agenda: memory, questions, stories
  for (const other of [
    "me lembra que eu gosto de café",
    "lembre que meu aniversário é dia 3 de maio",
    "você lembra do que eu falei?",
    "o alarme da casa disparou ontem",
    "que horas são?",
  ]) {
    assert.equal(a.handle(other), null, other);
  }
});

test("due: what came due is said once; a daily alarm moves to the next day; a late one says why", () => {
  let now = NOW;
  const a = openAgenda(null, { now: () => now });
  a.handle("me lembra de tomar o remédio às 15h");
  a.handle("timer de 5 minutos");
  a.handle("me acorda todos os dias às 6");
  a.handle("amanhã às 8 me lembra de ligar pro João");
  assert.deepEqual(a.due(new Date(NOW.getTime() + 60_000)), []);
  assert.deepEqual(a.due(new Date(NOW.getTime() + 5 * 60_000)), [
    { kind: "timer", text: "Mestre, o timer de 5 minutos terminou." },
  ]);
  assert.deepEqual(a.due(new Date(at(15, 15, 0) + 5_000)), [
    { kind: "reminder", text: "Mestre, um lembrete: tomar o remédio." },
  ]);
  assert.deepEqual(a.due(new Date(at(15, 15, 0) + 10_000)), [], "said once");
  // the PC slept from the evening until 9h: the alarm and the reminder were missed
  const late = a.due(new Date(at(16, 9)));
  assert.deepEqual(late, [
    {
      kind: "alarm",
      text: "Mestre, passou da hora do despertador, que era às 6 horas. O computador estava desligado.",
    },
    {
      kind: "reminder",
      text: "Mestre, o computador estava desligado na hora de um lembrete (hoje às 8 horas): ligar pro João.",
    },
  ]);
  assert.equal(
    new Date(a.items[0].at).getTime(),
    at(17, 6),
    "the daily alarm is set for the next morning"
  );
  now = new Date(at(17, 6, 0));
  assert.deepEqual(a.due(now), [{ kind: "alarm", text: "Mestre, são 6 horas. Hora de levantar." }]);
});

test("lists: add, skip what is there, remove, read, clear; kept in lembretes.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "alfred-agenda-"));
  const file = join(dir, "lembretes.json");
  try {
    const a = openAgenda(file, { now: () => NOW });
    assert.equal(
      a.handle("coloca arroz, feijão e o leite na lista de compras"),
      "Anotado, mestre: arroz, feijão e leite na lista de compras."
    );
    assert.equal(a.handle("põe arroz na lista"), "Arroz já estava na lista de compras, mestre.");
    assert.equal(
      a.handle("tira o leite da lista"),
      "Pronto, mestre: tirei leite da lista de compras."
    );
    assert.equal(
      a.handle("tira o café da lista"),
      "Não encontrei café na lista de compras, mestre."
    );
    assert.equal(
      a.handle("o que tem na lista de compras?"),
      "Na lista de compras, mestre: arroz e feijão."
    );
    assert.equal(
      a.handle("anota pagar o IPTU na lista de tarefas"),
      "Anotado, mestre: pagar o IPTU na lista de tarefas."
    );
    a.handle("me lembra de regar as plantas amanhã às 7 da manhã");
    // another Alfred (the terminal) opening the same file sees everything
    const b = openAgenda(file, { now: () => NOW });
    assert.deepEqual(b.list("compras"), ["arroz", "feijão"]);
    assert.equal(b.items.length, 1);
    assert.equal(
      b.handle("limpa a lista de compras"),
      "Pronto, mestre: apaguei a lista de compras (2 itens)."
    );
    assert.equal(
      a.handle("o que tem na lista?"),
      "A lista de compras está vazia, mestre. O senhor tem a lista de tarefas.",
      "a re-reads what b wrote"
    );
    assert.equal(a.handle("lista de compras"), "A lista de compras está vazia, mestre.");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).lists), ["tarefas"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
