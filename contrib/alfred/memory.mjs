// Alfred — remembers the user. Facts are picked up from the user's own words ("meu nome é…",
// "meu aniversário é dia…", "eu gosto de…", "lembre que…") and kept only on this PC, in
// memoria.json next to Alfred. Alfred uses them in the conversation, calls the user by name,
// mentions birthdays in the morning briefing and says what he knows when asked. "Esquece…" forgets.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH_RE = "(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)";
const DAY_RE = "(\\d{1,2}|primeiro|1º)";
const NAME_RE = "([A-Za-zÀ-ÖØ-öø-ÿ]{2,}(?:\\s+(?:d[aeo]s?\\s+)?[A-Za-zÀ-ÖØ-öø-ÿ]{2,})?)";
const MAX_FACTS = 60;
const FORGET_FILLER = new Set(["que", "meu", "minha", "sobre", "eu", "disse", "falei", "isso", "das", "dos", "com", "uma", "voce", "nome"]);

const plain = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const title = (s) => s.replace(/\S+/g, (w) => (/^(da|de|do|das|dos)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
const monthIndex = (m) => MONTHS.findIndex((x) => plain(x) === plain(m));
const dayNumber = (d) => (/^(primeiro|1º)$/i.test(d) ? 1 : Number(d));
// "minha mãe" (the user's words) → "sua mãe" (how Alfred says it)
const yours = (w) => (plain(w) === "minha" ? "sua" : plain(w) === "meu" ? "seu" : w);
const NOT_A_NAME = /^(meu|minha|seu|sua|o|a|um|uma|esse|este|isso|muito|bem|dif[ií]cil|complicado|estranho|bonito|feio|grande|pequeno|comum)$/i;
const VAGUE = /^(disso|disto|daquilo|isso|isto|aquilo|dele|dela|deles|delas|voc[eê]|tudo|nada)$/i;
/** "lembre que …", "anote que …": an order to remember (not "lembra que…?", a question). */
export const REMEMBER_THIS = /^(?:lembre(?:-se)?|anote|anota|guarde|grave)\s+(?:a[ií]\s+)?(?:que|de que)\s+(.{3,200})$/i;
const isQuestion = (t) =>
  /\?/.test(t) ||
  /^(?:o que|que|qual|quais|quem|como|quando|onde|por ?que|ser[aá]|voc[eê]\s+(?:acha|sabe|lembra|conhece)|tu\s+(?:acha|sabe|lembra)|lembra\s+que)\b/i.test(t);
const clean = (s) => s.replace(/\s+/g, " ").replace(/[\s.,;!?]+$/, "").trim();

// ---------- Picking facts out of a sentence (pure, unit-tested) ----------

/**
 * Facts in one user message: `{ kind: "name", value }`, `{ kind: "birthday", who, day, month }`
 * (who "" = the user) or `{ kind: "fact", text }`. Explicit "lembre que …" is kept as said.
 */
export function extractFacts(text) {
  const t = String(text ?? "").replace(/^(?:(?:ei|ok|olá|ola|oi)[\s,]+)?alfredo?[\s,.!]+/i, "").trim();
  const facts = [];
  const add = (f) => facts.push(f);
  // A question tells nothing ("você acha que eu gosto de futebol?", "lembra que eu te falei…?").
  if (isQuestion(t)) return facts;

  const told = t.match(REMEMBER_THIS);
  if (told) add({ kind: "fact", text: `O senhor pediu para lembrar: ${clean(told[1])}` });

  const name = t.match(new RegExp(`\\b(?:meu nome (?:é|e)|me chamo|pode me chamar de)\\s+${NAME_RE}`, "i"));
  if (name && !NOT_A_NAME.test(name[1].split(/\s+/)[0])) add({ kind: "name", value: title(name[1]) });

  const mine = t.match(new RegExp(`\\bmeu anivers[aá]rio (?:é|e|cai|vai ser)\\s+(?:(?:no )?dia\\s+)?${DAY_RE}\\s+de\\s+${MONTH_RE}`, "i"));
  if (mine) add({ kind: "birthday", who: "", day: dayNumber(mine[1]), month: monthIndex(mine[2]) });
  const theirs =
    t.match(new RegExp(`\\banivers[aá]rio d[aoe]\\s+(minha|meu)\\s+([\\wÀ-ÿ]+(?:\\s+[A-ZÀ-Ý][\\wÀ-ÿ]+)?)\\s+(?:é|e|cai|vai ser)\\s+(?:(?:no )?dia\\s+)?${DAY_RE}\\s+de\\s+${MONTH_RE}`, "i")) ??
    t.match(new RegExp(`\\b(minha|meu)\\s+([\\wÀ-ÿ]+(?:\\s+[A-ZÀ-Ý][\\wÀ-ÿ]+)?)\\s+faz anivers[aá]rio\\s+(?:(?:no )?dia\\s+)?${DAY_RE}\\s+de\\s+${MONTH_RE}`, "i"));
  if (theirs) add({ kind: "birthday", who: `${yours(theirs[1])} ${theirs[2].toLowerCase()}`, day: dayNumber(theirs[3]), month: monthIndex(theirs[4]) });

  const called = t.match(/\b(minha|meu)\s+(esposa|mulher|marido|namorada|namorado|noiva|noivo|filha|filho|m[aã]e|pai|irm[aã]|irm[aã]o|av[oó]|cachorro|cachorra|gata|gato)\s+(?:se chama|chama)\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,})/i);
  if (called) add({ kind: "fact", text: `${title(yours(called[1]))} ${called[2].toLowerCase()} se chama ${title(called[3])}` });

  const likes = t.match(/\beu\s+(n[aã]o\s+)?(?:gosto|adoro|amo)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+|dos\s+|das\s+)?(.{3,60}?)(?:[.!?,]|\s+e\s+(?:voc[eê]|tu)|$)/i);
  if (likes && !VAGUE.test(clean(likes[2]))) add({ kind: "fact", text: `${likes[1] ? "Não gosta" : "Gosta"} de ${clean(likes[2])}` });

  const lives = t.match(/\beu\s+moro\s+(?:em|no|na|perto d[aeo])\s+(.{2,40}?)(?:[.!?,]|$)/i);
  if (lives) add({ kind: "fact", text: `Mora em ${clean(lives[1])}` });

  const works = t.match(/\beu\s+trabalho\s+(com|como|na|no|em)\s+(.{2,50}?)(?:[.!?,]|$)/i);
  if (works) add({ kind: "fact", text: `Trabalha ${works[1].toLowerCase()} ${clean(works[2])}` });

  const favorite = t.match(/\bmeu\s+(time|filme|livro|prato|jogo|cantor|cantora|banda|cor|esporte)\s+(?:favorit[oa]|preferid[oa])\s+(?:é|e)\s+(?:o\s+|a\s+)?(.{2,40}?)(?:[.!?,]|$)/i);
  if (favorite && !/^(qual|quem|que|o que)\b/i.test(favorite[2])) add({ kind: "fact", text: `Seu ${favorite[1].toLowerCase()} favorito é ${clean(favorite[2])}` });

  return facts;
}

/** Things the user asks of the memory itself: recall, forget one thing, forget everything. */
export function parseMemoryCommand(text) {
  const t = plain(text).replace(/^(?:(?:ei|ok|ola|oi)\s+)?alfredo?[\s,.!]+/, "").replace(/[?.!]+$/, "");
  if (/o que (voce|tu) (sabe|lembra|guardou|sabe ai) (sobre|de) mim|do que (voce|tu) (se )?lembra de mim|o que voce sabe de mim/.test(t)) {
    return { type: "recall" };
  }
  if (/^esque(?:ce|ca|cer)(?:-se)?\s+(?:de\s+)?tudo|^apaga (?:a sua |sua |a )?memoria/.test(t)) return { type: "forgetAll" };
  const one = t.match(/^(?:esquece|esqueca|esqueça|apaga)(?:-se)?\s+(?:que|de que|o que eu disse sobre|sobre)?\s*(.{2,80})$/);
  if (one) return { type: "forget", query: one[1] };
  return null;
}

// ---------- The memory itself ----------

/** "sua mãe" → "da sua mãe", "seu pai" → "do seu pai" (as in "o aniversário da sua mãe"). */
export const ofWhom = (who) => (/^sua\b/i.test(who) ? `da ${who}` : /^seu\b/i.test(who) ? `do ${who}` : `de ${who}`);

const describe = (f) =>
  f.kind === "name"
    ? `O nome do senhor é ${f.value}`
    : f.kind === "birthday"
      ? `${f.who ? `O aniversário ${ofWhom(f.who)}` : "O aniversário do senhor"} é dia ${f.day} de ${MONTHS[f.month]}`
      : f.text;

/** Opens (or creates) the memory file. Writes are atomic; a broken file starts empty. */
export function openMemory(file) {
  let data = { name: "", facts: [] };
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      data = { name: String(parsed.name ?? ""), facts: Array.isArray(parsed.facts) ? parsed.facts : [] };
    } catch {}
  }
  // Writes are atomic (a .tmp file renamed over the old one). If the file cannot be written
  // (an antivirus or OneDrive holding it, a read-only folder), Alfred keeps going with what he
  // knows in memory and says so in the black window; the answer is never lost because of it.
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
      console.error(`[alfred] Não consegui salvar a memória em ${file}: ${err?.code || err?.message}`);
    }
  };
  const same = (a, b) =>
    a.kind === b.kind &&
    (a.kind === "birthday" ? plain(a.who) === plain(b.who) : a.kind === "fact" ? plain(a.text) === plain(b.text) : true);

  return {
    get name() {
      return data.name;
    },
    get facts() {
      return data.facts.map(describe);
    },
    /** Stores what the sentence reveals; returns how many facts were new or updated. */
    learn(text) {
      let changed = 0;
      for (const f of extractFacts(text)) {
        if (f.kind === "name") {
          if (data.name !== f.value) {
            data.name = f.value;
            changed++;
          }
          continue;
        }
        if (f.kind === "birthday" && (f.month < 0 || f.day < 1 || f.day > 31)) continue;
        const i = data.facts.findIndex((g) => same(g, f));
        if (i >= 0 && describe(data.facts[i]) === describe(f)) continue; // already known, same words
        if (i >= 0) data.facts.splice(i, 1);
        data.facts.push({ ...f, since: new Date().toISOString().slice(0, 10) });
        changed++;
      }
      data.facts = data.facts.slice(-MAX_FACTS);
      if (changed) save();
      return changed;
    },
    /** Forgets facts whose words match `query`; returns how many were removed. */
    forget(query) {
      const q = plain(query);
      // whole words, compared by their start, so "moro"/"Mora" and "trabalho"/"Trabalha" match
      // but "Ana" does not erase "banana"
      const stem = (w) => w.slice(0, Math.max(3, Math.min(4, w.length - 1)));
      const words = q
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !FORGET_FILLER.has(w))
        .map(stem);
      const before = data.facts.length;
      if (words.length) {
        data.facts = data.facts.filter((f) => {
          const fact = plain(describe(f)).split(/[^a-z0-9]+/);
          return !words.every((w) => fact.some((x) => x.startsWith(w)));
        });
      }
      let removed = before - data.facts.length;
      // the user's own name: "esquece o meu nome" (not "o nome da minha esposa")
      if (/\b(?:meu|o) nome\b/.test(q) && !/\bnome d[aeo]s?\b/.test(q) && data.name) {
        data.name = "";
        removed++;
      }
      if (removed) save();
      return removed;
    },
    forgetAll() {
      data = { name: "", facts: [] };
      save();
    },
    /** Birthdays on `date`: [{ who }] (who "" = the user). */
    birthdaysOn(date) {
      return data.facts
        .filter((f) => f.kind === "birthday" && f.day === date.getDate() && f.month === date.getMonth())
        .map((f) => ({ who: f.who }));
    },
    /** The [Memória: …] block for the brain, or "" when there is nothing to tell. */
    block() {
      const parts = [];
      if (data.name) parts.push(`o nome do mestre é ${data.name} (chame-o de "mestre ${data.name.split(" ")[0]}" de vez em quando, sem exagero)`);
      for (const f of data.facts.slice(-20)) parts.push(describe(f));
      return parts.length ? `[Memória: ${parts.join("; ")}.]` : "";
    },
  };
}

/**
 * Answers the user's memory commands and learns from every message. `handle(text)` returns
 * Alfred's reply for a command ("o que você sabe sobre mim?", "esquece…"), or null.
 */
export function createMemoryControl(memory, { now = () => Date.now() } = {}) {
  let confirmUntil = 0;
  return {
    handle(text) {
      const waiting = confirmUntil > now();
      confirmUntil = 0;
      if (waiting && /^(sim|pode|pode sim|confirmo|isso|claro|tenho certeza)\b/.test(plain(text))) {
        memory.forgetAll();
        return "Pronto, mestre. Esqueci tudo o que sabia sobre o senhor.";
      }
      const cmd = parseMemoryCommand(text);
      if (cmd?.type === "recall") {
        const facts = memory.facts;
        const name = memory.name ? `O seu nome é ${memory.name}. ` : "";
        if (!facts.length && !name) return "Ainda não sei nada sobre o senhor. Conte-me o que quiser, que eu guardo.";
        return `${name}${facts.length ? `Sei que: ${facts.join("; ")}.` : ""}`.trim();
      }
      if (cmd?.type === "forgetAll") {
        confirmUntil = now() + 30_000;
        return "Tem certeza que quer que eu esqueça tudo sobre o senhor? Diga sim para confirmar.";
      }
      if (cmd?.type === "forget") {
        return memory.forget(cmd.query) ? "Pronto, mestre. Esqueci." : "Não encontrei isso na minha memória, mestre.";
      }
      const learned = memory.learn(text);
      // "lembre que …" is a request: confirm it; anything else just continues the conversation
      const order = String(text ?? "").replace(/^(?:(?:ei|ok|olá|ola|oi)[\s,]+)?alfredo?[\s,.!]+/i, "").trim();
      if (learned && REMEMBER_THIS.test(order)) {
        return "Anotado, mestre.";
      }
      return null;
    },
  };
}
