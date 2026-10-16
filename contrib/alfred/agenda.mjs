// Alfred — reminders, alarms, timers and lists, answered by Alfred himself (no brain, no
// internet): "me lembra de tomar o remédio às 15h", "me acorda às 6", "timer de 5 minutos",
// "coloca arroz e feijão na lista de compras", "o que tem na lista?", "cancela o alarme".
// Kept in lembretes.json next to Alfred, only on this PC. The server checks every few seconds
// what is due (also what came due while the PC was asleep) and the page says it aloud.

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spokenTime } from "./weblite.mjs";

const MAX_ITEMS = 50;
const MAX_LISTS = 10;
const MAX_LIST_ITEMS = 100;
const PENDING_MS = 2 * 60_000; // "Para quando, mestre?" waits this long for the answer
const LATE_MS = 2 * 60_000; // later than this, the PC was asleep or off when it came due
const DAY_MS = 24 * 3600_000;

// ---------- Reading the request (pure, unit-tested) ----------

/**
 * Lowercase without accents, character for character ("à" → "a", "ç" → "c"), so a match found
 * in this text has the same position in the original lowercase text.
 */
const flat = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[À-ÿ]/g, (c) => c.normalize("NFD")[0])
    .replace(/[?!,;]/g, " ");

const UNIT = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
};
const TEEN = {
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};
const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };
const NUM = `(?:\\d{1,3}|(?:vinte|trinta|quarenta|cinquenta)(?:\\s+e\\s+(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?|dezesseis|dezessete|dezoito|dezenove|dez|onze|doze|treze|catorze|quatorze|quinze|uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove)`;

/** "15" → 15, "vinte e cinco" → 25, "duas" → 2. */
export function toNumber(word) {
  const w = String(word ?? "").trim();
  if (/^\d+$/.test(w)) return Number(w);
  return w
    .split(/\s+e\s+/)
    .reduce((sum, part) => sum + (TENS[part] ?? TEEN[part] ?? UNIT[part] ?? NaN), 0);
}

const UNIT_MS = (u) => (/^s/.test(u) ? 1000 : /^m/.test(u) ? 60_000 : 3600_000);
// "10 minutos", "meia hora", "uma hora e meia", "2 horas e 15 minutos", "30 segundos"
const DURATION = new RegExp(
  `(?:\\b(meia)\\s+hora\\b|\\b(${NUM})\\s*(segundos?|seg|minutos?|min|horas?|h)\\b(?:\\s+e\\s+(?:(meia)\\b|(${NUM})\\s*(?:minutos?|min)\\b))?)`
);
const RELATIVE = new RegExp(
  `\\b(?:daqui a|daqui|em|dentro de|apos|depois de)\\s+${DURATION.source}`
);
const CLOCK = new RegExp(
  `\\b(?:as|pelas|para as|pras|ate as|a partir das)\\s+(${NUM})(?:\\s*(?::|h)\\s*(\\d{2})\\b|\\s*(?:horas?|h)\\b)?(?:\\s+e\\s+(?:(meia)\\b|(${NUM})(?:\\s*minutos?)?\\b))?|\\b(ao meio[ -]dia|a meia[ -]noite)(?:\\s+e\\s+(meia)\\b)?|\\b(a uma)(?:\\s+hora)?\\b(?:\\s+e\\s+(?:(meia)\\b|(${NUM})\\b))?|\\b(\\d{1,2})(?::|h)(\\d{2})\\b|\\b(\\d{1,2})\\s*h\\b`
);
const PERIOD = /\b(?:da|de)\s+(manha|tarde|noite|madrugada)\b/;
const DAY = /\b(depois de amanha|amanha|hoje)\b/;
const WEEKDAYS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const WEEKDAY =
  /\b(?:na |no |nesta |neste |proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[ -]feira)?\b/;
const REPEAT = /\b(todo dia|todos os dias|diariamente|toda manha|toda noite)\b/;

/** The length of time in a match of DURATION, in milliseconds (NaN when it makes no sense). */
function durationMs(m, from = 1) {
  const [half, n, unit, plusHalf, plusMin] = m.slice(from, from + 5);
  if (half) return 30 * 60_000;
  const base = toNumber(n) * UNIT_MS(unit);
  const extra = plusHalf
    ? UNIT_MS(unit) >= 3600_000
      ? 30 * 60_000
      : 30_000
    : plusMin
      ? toNumber(plusMin) * 60_000
      : 0;
  return base + extra;
}

/**
 * When the text says something should happen: `{ at, spans, repeat, relative }` or null.
 * `morning`: a time without "da tarde/da noite" means the morning (alarms: "me acorda às 6").
 * `spans` are the [start, end] positions of the words that told the time.
 */
export function findWhen(text, now = new Date(), { morning = false } = {}) {
  const t = flat(text);
  const spans = [];
  const rel = t.match(RELATIVE);
  if (rel) {
    const ms = durationMs(rel);
    if (!(ms > 0) || ms > 7 * DAY_MS) return null;
    spans.push([rel.index, rel.index + rel[0].length]);
    return { at: new Date(now.getTime() + ms), spans, repeat: null, relative: true };
  }
  const c = t.match(CLOCK);
  const dayWord = t.match(DAY);
  const weekday = t.match(WEEKDAY);
  const period = t.match(PERIOD);
  const repeat = t.match(REPEAT);
  if (!c) return null;
  spans.push([c.index, c.index + c[0].length]);
  let h;
  let m = 0;
  if (c[1] !== undefined) {
    h = toNumber(c[1]);
    m = c[2] !== undefined ? Number(c[2]) : c[3] ? 30 : c[4] !== undefined ? toNumber(c[4]) : 0;
  } else if (c[5]) {
    h = /meio/.test(c[5]) ? 12 : 0;
    m = c[6] ? 30 : 0;
  } else if (c[7]) {
    h = 1;
    m = c[8] ? 30 : c[9] !== undefined ? toNumber(c[9]) : 0;
  } else if (c[10] !== undefined) {
    h = Number(c[10]);
    m = Number(c[11]);
  } else {
    h = Number(c[12]);
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  const p = period?.[1];
  if ((p === "tarde" || p === "noite") && h < 12) h += 12;
  if ((p === "manha" || p === "madrugada") && h === 12) h = 0;
  for (const found of [period, dayWord, weekday, repeat])
    if (found) spans.push([found.index, found.index + found[0].length]);

  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (dayWord) {
    at.setDate(at.getDate() + (dayWord[1] === "hoje" ? 0 : dayWord[1] === "amanha" ? 1 : 2));
    // "hoje às 3" said in the afternoon means 15h
    if (dayWord[1] === "hoje" && at <= now && !p && h < 12 && !morning) at.setHours(h + 12);
  } else if (weekday) {
    let ahead = (WEEKDAYS.indexOf(weekday[1]) - now.getDay() + 7) % 7;
    if (ahead === 0 && at <= now) ahead = 7;
    at.setDate(at.getDate() + ahead);
  } else if (at <= now) {
    const later = new Date(at);
    later.setHours(h + 12);
    if (!p && !morning && h < 12 && later > now) at.setHours(h + 12);
    else at.setDate(at.getDate() + 1);
  }
  if (at <= now) return null; // "hoje às 8" when it is already 21h
  return { at, spans, repeat: repeat ? "daily" : null, relative: false };
}

const WAKE = /^\s*(?:(?:ei|ok|ola|oi)\s+)?alfredo?\b[\s,.]*/;
const POLITE = /^\s*(?:por favor|pode|voce pode|da pra|consegue)\s+/;
const QUESTION_ABOUT =
  /^\s*(?:voce (?:lembra|sabe|acha)|lembra que|sera que|como (?:eu )?(?:faco|uso))\b/;

const TIMER_WORD = /\b(?:timer|temporizador|cronometro)\b/;
const TIMER_SET = new RegExp(
  `^\\s*(?:(?:marca|marque|conta|conte|liga|ligue|coloca|coloque|poe|bota)\\s+)?(?:um\\s+)?(?:timer|temporizador|cronometro)\\b|^\\s*(?:marca|marque|conta|conte)\\s+${DURATION.source}`
);
// "me acorda…" and "coloca o despertador…" always; "despertador às 6" only with a time
const ALARM_SET =
  /\b(?:me acord[ae]|me desperta|acorda-me|desperta-me)\b|^\s*(?:coloca|coloque|poe|ponha|bota|liga|ligue|marca|marque|programa|programe|cria|crie)\s+(?:um\s+|o\s+)?(?:despertador|alarme)\b/;
const ALARM_NOUN = /^\s*(?:um\s+)?(?:despertador|alarme)\b/;
const REMIND_SET =
  /\b(?:me lembr[ae]|lembre-me|lembra-me|me avis[ae]|avise-me|(?:cria|crie|coloca|coloque|poe|ponha|marca|marque|faz|faca|anota|anote)\s+um\s+lembrete)\b/;
const KIND_WORD =
  /\b(lembretes?|alarmes?|despertador(?:es)?|timers?|temporizador(?:es)?|cronometros?)\b/;
const CANCEL =
  /^\s*(?:cancel\w*|apag\w*|desliga\w*|desativ\w*|tira|tire|remov\w*|esquec\w*|para|pare|chega de)\b/;
const QUERY =
  /\b(?:quais (?:sao )?(?:os )?(?:meus )?|que |tem (?:algum |alguma )?|tenho (?:algum |alguma )?|lista (?:os |meus )?|me (?:fala|diz|diga) (?:os |meus )?|ha (?:algum )?)(lembretes?|alarmes?|despertador(?:es)?|timers?|compromissos?)\b|\bo que (?:eu )?tenho (?:marcado|agendado|para (?:hoje|amanha))\b|\bpara que horas? (?:esta|ta) (?:o )?(?:despertador|alarme)\b/;
const REMAINING = /\bquanto (?:tempo )?falta\b/;

const kindOf = (word) =>
  /^lembr/.test(word)
    ? "reminder"
    : /^(alarm|despert)/.test(word)
      ? "alarm"
      : /^(timer|tempor|cronom)/.test(word)
        ? "timer"
        : null;

// ---------- Lists ----------
const LIST_AT = /\blista(?:\s+(?:de|do|da)\s+([a-z]+(?:\s+(?!e\b)[a-z]+)?))?\b/;
const LIST_CLEAR =
  /^\s*(?:limpa|limpe|limpar|apaga|apague|apagar|esvazia|esvazie|zera|zere)\s+(?:toda\s+)?(?:a\s+)?(?:minha\s+)?lista\b/;
const LIST_ADD =
  /\b(?:coloca|coloque|colocar|poe|ponha|por|bota|bote|adiciona|adicione|adicionar|acrescenta|acrescente|inclui|inclua|anota|anote|anotar|bota ai|poe ai)\s+(.+?)\s+(?:na|a|em|pra|para a)\s+(?:minha\s+)?lista\b/;
const LIST_REMOVE =
  /\b(?:tira|tire|tirar|remove|remova|remover|apaga|apague|risca|risque|exclui|exclua)\s+(.+?)\s+da\s+(?:minha\s+)?lista\b/;
const LIST_READ =
  /\b(?:o que (?:tem|ha|ficou|esta) na\s+|(?:le|leia|ler|fala|fale|diz|diga|me fala|me diz|me diga|me le|me leia|qual (?:e )?)\s+(?:a\s+)?)(?:minha\s+)?lista\b|^\s*(?:a\s+)?(?:minha\s+)?lista(?:\s+(?:de|do|da)\s+[a-z]+)?\s*$/;
const LIST_ALIASES = { mercado: "compras", supermercado: "compras", feira: "compras" };
const ARTICLE = /^(?:o|a|os|as|um|uma|uns|umas|mais|tambem)\s+/i;

/** The list a sentence talks about: "compras" unless it names another one ("lista de tarefas"). */
export function listName(text) {
  const m = flat(text).match(LIST_AT);
  const name = (m?.[1] ?? "").trim();
  return LIST_ALIASES[name] ?? (name || "compras");
}

/** "arroz, feijão e o leite" → ["arroz", "feijão", "leite"]. */
export function splitItems(text) {
  return String(text ?? "")
    .split(/\s*,\s*|\s+e\s+/)
    .map((s) => s.trim().replace(ARTICLE, "").replace(ARTICLE, "").trim().slice(0, 60))
    .filter((s) => s.length > 0);
}

const itemKey = (s) => flat(s).replace(ARTICLE, "").trim().replace(/s$/, "");

/** "arroz", "arroz e feijão", "arroz, feijão e leite". */
export function joinWords(words) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} e ${words[words.length - 1]}`;
}

// ---------- Saying when ----------

/** "às 8 horas", "ao meio-dia", "à meia-noite e meia", "à 1 hora". */
function atTime(date) {
  const words = spokenTime(date).replace(/ em ponto$/, "");
  if (/^meio-dia/.test(words)) return `ao ${words}`;
  if (/^(meia-noite|1 hora)/.test(words)) return `à ${words}`;
  return `às ${words}`;
}

const WEEKDAY_NAMES = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "hoje às 15 horas", "amanhã às 8 horas e 30 minutos", "no sábado às 9 horas", "no dia 3 de maio…". */
export function describeWhen(at, now = new Date()) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / DAY_MS);
  const time = atTime(at);
  if (days === 0) return `hoje ${time}`;
  if (days === 1) return `amanhã ${time}`;
  if (days > 1 && days < 7)
    return `${at.getDay() === 0 || at.getDay() === 6 ? "no" : "na"} ${WEEKDAY_NAMES[at.getDay()]} ${time}`;
  return `no dia ${at.getDate()} de ${MONTHS[at.getMonth()]} ${time}`;
}

/** "hoje às 8 horas", "ontem às 21 horas", "dia 3 de maio às 9 horas" — for what already passed. */
function pastWhen(at, now) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / DAY_MS);
  const time = atTime(at);
  return days === 0
    ? `hoje ${time}`
    : days === 1
      ? `ontem ${time}`
      : `dia ${at.getDate()} de ${MONTHS[at.getMonth()]} ${time}`;
}

/** "30 segundos", "5 minutos", "uma hora e meia", "2 horas e 15 minutos". */
export function spokenDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return s === 1 ? "1 segundo" : `${s} segundos`;
  const total = Math.round(s / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? "uma hora" : `${h} horas`;
  const minutes = m === 1 ? "1 minuto" : `${m} minutos`;
  if (!h) return minutes;
  if (!m) return hours;
  return m === 30 ? `${hours} e meia` : `${hours} e ${minutes}`;
}

/** What is left of a timer: "3 minutos e 20 segundos", "40 segundos". */
function remaining(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return spokenDuration(s * 1000);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) return spokenDuration(ms);
  return rest
    ? `${m === 1 ? "1 minuto" : `${m} minutos`} e ${rest === 1 ? "1 segundo" : `${rest} segundos`}`
    : spokenDuration(m * 60_000);
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The task of a reminder, from the words left once the trigger and the time are taken out. */
export function reminderTask(lower, spans) {
  let text = String(lower);
  for (const [a, b] of spans) text = text.slice(0, a) + " ".repeat(b - a) + text.slice(b);
  text = text
    .replace(/[?!,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:ei|ok|olá|ola|oi)\s+)?alfredo?\b\s*/i, "");
  const LEAD =
    /^(?:por favor|você pode|voce pode|pode|de novo|e|que|de|da|do|para|pra|pro|a|o|eu|me|mestre|alfred|alfredo)\s+/i;
  for (let i = 0; i < 6 && LEAD.test(text); i++) text = text.replace(LEAD, "");
  text = text
    .replace(/\s+(?:por favor|tá|ta|ok|tá bom|viu)$/i, "")
    .replace(/\s+(?:de|para|pra|que|e|a)$/i, "");
  text = text
    .replace(/\bminhas\b/gi, "suas")
    .replace(/\bminha\b/gi, "sua")
    .replace(/\bmeus\b/gi, "seus")
    .replace(/\bmeu\b/gi, "seu")
    .slice(0, 160)
    .trim();
  // the recognizer capitalizes the first word of a sentence (the task starts with a verb)
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ---------- The agenda ----------

/**
 * Opens (or creates) the agenda file. `handle(said)` answers a request (or returns null when it
 * is not one); `due(now)` returns what has to be said now and moves the agenda on.
 */
export function openAgenda(file, { now: clock = () => new Date() } = {}) {
  let data = { items: [], lists: {} };
  let seen = ""; // the file's time and size when we last read or wrote it
  const stamp = () => {
    try {
      const st = statSync(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return "";
    }
  };
  // The terminal Alfred and the page's server may both be open: each reads what the other wrote.
  const load = () => {
    if (!file || !existsSync(file) || stamp() === seen) return;
    seen = stamp();
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      data = {
        items: Array.isArray(parsed.items)
          ? parsed.items.filter((i) => i && Number.isFinite(i.at))
          : [],
        lists: parsed.lists && typeof parsed.lists === "object" ? parsed.lists : {},
      };
    } catch {}
  };
  load();
  const save = () => {
    if (!file) return;
    const body = JSON.stringify(data, null, 2);
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, body);
      try {
        renameSync(tmp, file);
      } catch {
        writeFileSync(file, body); // Windows can refuse the rename while the file is in use
      }
    } catch (err) {
      console.error(
        `[alfred] Não consegui salvar os lembretes em ${file}: ${err?.code || err?.message}`
      );
    }
    seen = stamp();
  };
  let pending = null; // { kind, task, at } while Alfred waits for "para quando?"
  const newId = () => data.items.reduce((n, i) => Math.max(n, Number(i.id) || 0), 0) + 1;

  const upcoming = (kind) =>
    data.items.filter((i) => !kind || i.kind === kind).sort((a, b) => a.at - b.at);

  function add(kind, at, { text = "", repeat = null, label = "" } = {}) {
    const same = data.items.find(
      (i) => i.kind === kind && i.at === at.getTime() && i.text === text
    );
    if (same) return same; // "me acorda às 6" said twice is one alarm
    if (data.items.length >= MAX_ITEMS)
      return "A agenda está cheia, mestre: cancele algum lembrete antes.";
    const item = { id: newId(), kind, at: at.getTime(), text, repeat, label };
    data.items.push(item);
    save();
    return item;
  }

  function describeItem(i, now) {
    const when = describeWhen(new Date(i.at), now);
    if (i.kind === "timer") return `${i.label}, que termina em ${remaining(i.at - now.getTime())}`;
    if (i.kind === "alarm")
      return i.repeat
        ? `despertador todos os dias ${atTime(new Date(i.at))}`
        : `despertador ${when}`;
    return `${when}, ${i.text}${i.repeat ? " (todos os dias)" : ""}`;
  }

  function setReminder(kind, task, when, now) {
    if (kind === "alarm") {
      const item = add("alarm", when.at, { repeat: when.repeat });
      if (typeof item === "string") return item;
      return when.repeat
        ? `Combinado, mestre: o despertador vai tocar todos os dias ${atTime(when.at)}.`
        : `Combinado, mestre: despertador para ${describeWhen(when.at, now)}.`;
    }
    const item = add("reminder", when.at, { text: task, repeat: when.repeat });
    if (typeof item === "string") return item;
    const at = when.relative
      ? `daqui a ${spokenDuration(when.at - now)}`
      : describeWhen(when.at, now);
    return `Combinado, mestre. ${capital(at)}${when.repeat ? " e todos os dias" : ""}, eu o lembro: ${task}.`;
  }

  function lists(raw, t) {
    const name = listName(raw);
    const label = `lista de ${name}`;
    if (LIST_CLEAR.test(t)) {
      const n = (data.lists[name] ?? []).length;
      delete data.lists[name];
      save();
      return n
        ? `Pronto, mestre: apaguei a ${label} (${n} ${n === 1 ? "item" : "itens"}).`
        : `A ${label} já estava vazia, mestre.`;
    }
    const lower = String(raw);
    const added = t.match(LIST_ADD);
    if (added) {
      const start = added.index + added[0].indexOf(added[1]);
      const items = splitItems(lower.slice(start, start + added[1].length));
      if (!items.length) return null;
      if (!data.lists[name] && Object.keys(data.lists).length >= MAX_LISTS)
        return "Já há listas demais, mestre: apague alguma antes.";
      const list = (data.lists[name] ??= []);
      const fresh = items.filter((i) => !list.some((l) => itemKey(l) === itemKey(i)));
      list.push(...fresh.slice(0, MAX_LIST_ITEMS - list.length));
      save();
      if (!fresh.length)
        return `${capital(joinWords(items))} já ${items.length === 1 ? "estava" : "estavam"} na ${label}, mestre.`;
      return `Anotado, mestre: ${joinWords(fresh)} na ${label}.`;
    }
    const removed = t.match(LIST_REMOVE);
    if (removed) {
      const start = removed.index + removed[0].indexOf(removed[1]);
      const items = splitItems(lower.slice(start, start + removed[1].length));
      const list = data.lists[name] ?? [];
      const gone = list.filter((l) => items.some((i) => itemKey(l) === itemKey(i)));
      if (!gone.length) return `Não encontrei ${joinWords(items)} na ${label}, mestre.`;
      data.lists[name] = list.filter((l) => !gone.includes(l));
      if (!data.lists[name].length) delete data.lists[name];
      save();
      return `Pronto, mestre: tirei ${joinWords(gone)} da ${label}.`;
    }
    if (LIST_READ.test(t)) {
      const list = data.lists[name] ?? [];
      if (!list.length) {
        const others = Object.keys(data.lists);
        return others.length && !LIST_AT.exec(t)?.[1]
          ? `A ${label} está vazia, mestre. O senhor tem a ${joinWords(others.map((o) => `lista de ${o}`))}.`
          : `A ${label} está vazia, mestre.`;
      }
      return `Na ${label}, mestre: ${joinWords(list)}.`;
    }
    return null;
  }

  return {
    /** Answers a request about reminders, alarms, timers or lists; null when it is not one. */
    handle(said) {
      load();
      const now = clock();
      const raw = String(said ?? "");
      let t = flat(raw);
      // keep positions: blank out the wake word and "por favor" instead of removing them
      for (const re of [WAKE, POLITE]) {
        const m = t.match(re);
        if (m) t = " ".repeat(m[0].length) + t.slice(m[0].length);
      }
      if (!t.trim()) return null;

      // the answer to "Para quando, mestre?"
      if (pending && now - pending.since < PENDING_MS) {
        const ask = pending;
        pending = null;
        if (ask.kind === "timer") {
          const d = t.match(DURATION);
          const ms = d ? durationMs(d) : NaN;
          if (ms > 0 && ms <= DAY_MS) return startTimer(ms, now);
        } else {
          const when = findWhen(`${ask.raw} ${raw}`, now, { morning: ask.kind === "alarm" });
          if (when) return setReminder(ask.kind, ask.task, when, now);
        }
        if (/^\s*(?:deixa|esquece|nada|nao|cancela)\b/.test(t)) return "Tudo bem, mestre.";
      }
      pending = null;

      if (/\blista\b/.test(t)) {
        const answer = lists(raw, t);
        if (answer) return answer;
      }
      if (QUESTION_ABOUT.test(t)) return null;

      const kindWord = t.match(KIND_WORD)?.[1];
      // "cancela o alarme", "para o timer", "apaga todos os lembretes"
      if (kindWord && CANCEL.test(t)) {
        const kind = kindOf(kindWord);
        const items = upcoming(kind);
        const label = { reminder: "lembrete", alarm: "despertador", timer: "timer" }[kind];
        if (!items.length) return `Não há nenhum ${label} marcado, mestre.`;
        let gone;
        if (/\b(todos|todas|tudo)\b/.test(t)) gone = items;
        else {
          const words = t
            .replace(KIND_WORD, " ")
            .split(/\s+/)
            .filter((w) => w.length > 3 && !CANCEL.test(w));
          const byWords = items.filter((i) => words.some((w) => flat(i.text).includes(w)));
          gone = [byWords[0] ?? items[0]];
        }
        data.items = data.items.filter((i) => !gone.includes(i));
        save();
        if (gone.length > 1)
          return `Pronto, mestre: cancelei ${gone.length} ${label === "timer" ? "timers" : `${label}s`}.`;
        const g = gone[0];
        return g.kind === "reminder"
          ? `Pronto, mestre: cancelei o lembrete de ${describeWhen(new Date(g.at), now)}: ${g.text}.`
          : g.kind === "timer"
            ? `Pronto, mestre: ${g.label} foi cancelado.`
            : `Pronto, mestre: cancelei o despertador de ${describeWhen(new Date(g.at), now)}.`;
      }
      // "quanto falta no timer?"
      if (REMAINING.test(t) && (!kindWord || kindOf(kindWord) === "timer")) {
        const timers = upcoming("timer");
        if (timers.length)
          return `Faltam ${remaining(timers[0].at - now.getTime())} no ${timers[0].label.replace(/^o /, "")}, mestre.`;
        if (kindWord) return "Não há nenhum timer ligado, mestre.";
      }
      // "quais são meus lembretes?", "tem algum alarme?"
      const query = t.match(QUERY);
      if (query) {
        const kind = query[1] && !/^compromisso/.test(query[1]) ? kindOf(query[1]) : null;
        const items = upcoming(kind);
        const label =
          { reminder: "lembrete", alarm: "despertador", timer: "timer" }[kind] ?? "lembrete";
        if (!items.length)
          return kind
            ? `Não há nenhum ${label} marcado, mestre.`
            : "O senhor não tem nada marcado, mestre.";
        const said_ = items.slice(0, 5).map((i) => describeItem(i, now));
        const more = items.length > 5 ? ` E mais ${items.length - 5}.` : "";
        if (items.length === 1) return `O senhor tem um só: ${said_[0]}.`;
        return `O senhor tem ${items.length}: ${said_.join("; ")}.${more}`;
      }

      // "timer de 5 minutos", "marca 10 minutos"
      if (TIMER_SET.test(t) || (TIMER_WORD.test(t) && t.match(DURATION))) {
        const d = t.match(DURATION);
        const ms = d ? durationMs(d) : NaN;
        if (!(ms > 0)) {
          pending = { kind: "timer", since: now };
          return "De quanto tempo, mestre?";
        }
        if (ms > DAY_MS) return "Um timer vai até 24 horas, mestre. Para mais, peça um lembrete.";
        return startTimer(ms, now);
      }
      // "me acorda às 6", "coloca o despertador para as 7 e meia"
      const alarmWhen = ALARM_NOUN.test(t) ? findWhen(raw, now, { morning: true }) : null;
      if (ALARM_SET.test(t) || alarmWhen) {
        const when = alarmWhen ?? findWhen(raw, now, { morning: true });
        if (!when) {
          pending = { kind: "alarm", raw, since: now };
          return "Para que horas, mestre?";
        }
        return setReminder("alarm", "", when, now);
      }
      // "me lembra de tomar o remédio às 15h", "me avisa daqui a 20 minutos para tirar o bolo"
      const remind = t.match(REMIND_SET);
      if (remind) {
        const when = findWhen(raw, now);
        const spans = [[remind.index, remind.index + remind[0].length], ...(when?.spans ?? [])];
        const day = t.match(DAY) ?? t.match(WEEKDAY);
        if (day) spans.push([day.index, day.index + day[0].length]);
        const task = reminderTask(raw, spans);
        if (!when) {
          // "me lembra que…" with no day or time is something to remember (memory.mjs), not a
          // reminder; "me avisa" alone is not one either
          if (
            !task ||
            (!day && /^\s*(?:me lembr[ae]\s+que\b|me avis[ae]\b(?!\s+(?:de|para|pra)\b))/.test(t))
          )
            return null;
          pending = { kind: "reminder", task, raw, since: now };
          return day ? "A que horas, mestre?" : "Para quando, mestre?";
        }
        if (!task) return "De que devo lembrá-lo, mestre?";
        return setReminder("reminder", task, when, now);
      }
      return null;
    },

    /** What is due at `now` (also what came due while the PC slept): `[{ kind, text }]`. */
    due(now = clock()) {
      load();
      const fired = [];
      const keep = [];
      for (const i of data.items) {
        if (i.at > now.getTime()) {
          keep.push(i);
          continue;
        }
        const late = now.getTime() - i.at > LATE_MS;
        const at = new Date(i.at);
        let text;
        if (i.kind === "timer") text = `Mestre, ${i.label} terminou.`;
        else if (i.kind === "alarm") {
          text = late
            ? `Mestre, passou da hora do despertador, que era ${atTime(at)}. O computador estava desligado.`
            : `Mestre, ${/^(meia-noite|meio-dia|1 hora)/.test(spokenTime(at)) ? "é" : "são"} ${spokenTime(at).replace(/ em ponto$/, "")}. Hora de levantar.`;
        } else {
          text = late
            ? `Mestre, o computador estava desligado na hora de um lembrete (${pastWhen(at, now)}): ${i.text}.`
            : `Mestre, um lembrete: ${i.text}.`;
        }
        fired.push({ kind: i.kind, text });
        if (i.repeat === "daily") {
          let next = i.at;
          while (next <= now.getTime()) next += DAY_MS;
          keep.push({ ...i, at: next });
        }
      }
      if (fired.length) {
        data.items = keep;
        save();
      }
      return fired;
    },

    /** Everything marked, soonest first (for tests and the diagnostics). */
    get items() {
      return upcoming().map((i) => ({ ...i }));
    },
    list(name = "compras") {
      return [...(data.lists[name] ?? [])];
    },
  };

  function startTimer(ms, now) {
    const label = `o timer de ${spokenDuration(ms)}`;
    const item = add("timer", new Date(now.getTime() + ms), { label });
    if (typeof item === "string") return item;
    return `Pois não, mestre. Timer de ${spokenDuration(ms)}, começando agora.`;
  }
}
