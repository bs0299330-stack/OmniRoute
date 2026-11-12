// Alfred — contacts, phone calls and WhatsApp, answered by Alfred himself:
//   "o número da minha mãe é 69 99912-3456", "qual é o número do João?",
//   "liga pra minha mãe", "manda no WhatsApp pro João que eu chego às 8".
// Numbers are kept in contatos.json next to Alfred, only on this PC; they never go to the brain
// (the AI). Alfred never calls or sends by himself: the reply carries a button ("Ligar para sua
// mãe", "Enviar no WhatsApp") that the page shows and the user taps.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const MAX_CONTACTS = 200;

/** Lowercase without accents, character for character, so positions match the original text. */
const flat = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[À-ÿ]/g, (c) => c.normalize("NFD")[0]);

const WAKE = /^\s*(?:(?:ei|ok|ola|oi)\s+)?alfredo?\b[\s,.]*/;
const POLITE = /^\s*(?:por favor|pode|voce pode|da pra|consegue)\s+/;
const NUMBER = "(\\+?\\(?\\d[\\d\\s().-]{6,}\\d)";
const WHO = "((?:minha|meu|minhas|meus|a|o)?\\s*[a-z][a-z' -]{0,40}?)";

const SAVE = new RegExp(
  `^\\s*(?:(?:salva|salve|anota|anote|guarda|guarde|grava|grave|registra|registre)\\s+)?(?:o\\s+)?(?:numero|telefone|celular|contato|zap|whatsapp)\\s+(?:de|do|da|dos|das)\\s+${WHO}\\s*(?:e|eh|:|,|=|-)?\\s*${NUMBER}\\s*$`
);
const ASK = new RegExp(
  `\\b(?:qual|me (?:fala|diz|diga|passa))\\s+(?:e\\s+)?(?:o\\s+)?(?:numero|telefone|celular|contato)\\s+(?:de|do|da)\\s+${WHO}\\s*$`
);
const FORGET = new RegExp(
  `^\\s*(?:esquece|esqueca|apaga|apague|tira|remove|remova)\\s+(?:o\\s+)?(?:numero|telefone|celular|contato)\\s+(?:de|do|da)\\s+${WHO}\\s*$`
);
const LIST =
  /\b(?:quais (?:sao )?(?:os )?(?:meus )?contatos|que contatos|lista (?:os |de )?contatos)\b/;
const CALL = new RegExp(
  `^\\s*(?:liga|ligue|ligar|telefona|telefone|faz uma ligacao|faca uma ligacao)\\s+(?:para|pra|pro|pa)\\s+(?:o numero\\s+)?(?:${NUMBER}|${WHO})\\s*$`
);
const WHATSAPP = new RegExp(
  `^\\s*(?:manda|mande|envia|envie|escreve|escreva)\\s+(?:uma\\s+)?(?:mensagem|msg|recado|zap)?\\s*(?:(?:no|pelo|via)\\s+(?:whatsapp|zap)\\s+)?(?:para|pra|pro|ao|a)\\s+${WHO}(?:\\s+(?:no|pelo|via)\\s+(?:whatsapp|zap))?(?:\\s+(?:dizendo que|falando que|dizendo|falando|que)\\s+|\\s*:\\s*)(.+)$`
);
const OPEN_CHAT = new RegExp(
  `^\\s*(?:abre|abra|abrir)\\s+(?:o\\s+)?(?:whatsapp|zap)\\s+(?:de|do|da)\\s+${WHO}\\s*$`
);

// "o número de série do notebook é…", "o número da conta é…": not a person
const NOT_A_CONTACT =
  /\b(?:serie|cpf|rg|cnh|conta|pedido|protocolo|cartao|placa|cep|senha|notebook|computador|celular|casa|apartamento|sapato|roupa|boleto)\b/;
// Emergency numbers are always known.
const EMERGENCY = [
  [/^(?:o\s+)?samu$|^(?:a\s+)?ambulancia$/, "o SAMU", "192"],
  [/^(?:os?\s+)?bombeiros?$/, "os bombeiros", "193"],
  [/^(?:a\s+)?policia(?: militar)?$|^(?:o\s+)?190$/, "a polícia", "190"],
  [/^(?:a\s+)?defesa civil$/, "a Defesa Civil", "199"],
];

const RELATIVE =
  /^(?:mae|pai|esposa|marido|mulher|filho|filha|irmao|irma|avo|vo|vovo|tio|tia|primo|prima|sogra|sogro|namorada|namorado|cunhado|cunhada|neto|neta|chefe|patrao|vizinho|vizinha|madrinha|padrinho)$/;

/**
 * Who, as Alfred keeps and says it: "minha mãe" → { key: "mae", name: "sua mãe" },
 * "o João" → { key: "joao", name: "João" }.
 */
export function contactName(said) {
  const raw = String(said ?? "")
    .trim()
    .replace(/[?!.,;:]+$/, "");
  const words = raw.replace(/^(?:minhas?|meus?|as?|os?)\s+/i, "");
  const key = flat(words).replace(/\s+/g, " ").trim();
  if (!key || key.length > 40 || key.split(" ").length > 3 || NOT_A_CONTACT.test(key)) return null;
  const possessive = /^(?:minha|meu|minhas|meus)\s/i.test(raw) || RELATIVE.test(key);
  if (possessive) {
    const fem =
      /^(?:minha|minhas)\s/i.test(raw) ||
      /a$/.test(key.split(" ")[0]) ||
      /^(?:mae|mulher|avo)$/.test(key);
    return { key, name: `${fem ? "sua" : "seu"} ${words.toLowerCase()}` };
  }
  return { key, name: words.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) };
}

/**
 * A Brazilian phone number as "+55DDDNNNNNNNN", or `{ needsDdd: true }` when it has no area code
 * and none is configured, or null when it is not a phone number.
 */
export function normalizePhone(text, ddd = "") {
  let digits = String(text ?? "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length >= 11) digits = digits.replace(/^0+/, ""); // 0 + DDD
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13))
    return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length === 8 || digits.length === 9)
    return ddd ? `+55${ddd}${digits}` : { needsDdd: true, digits };
  return null;
}

/** "+5569999123456" → "69, 99912, 3456" (said in groups, as people read a number). */
export function spokenPhone(e164) {
  const d = String(e164).replace(/^\+55/, "");
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  const cut = rest.length - 4;
  return `${ddd}, ${rest.slice(0, cut).split("").join(" ")}, ${rest.slice(cut).split("").join(" ")}`;
}

/** "+5569999123456" → "(69) 99912-3456", for the buttons. */
export function formatPhone(e164) {
  const d = String(e164).replace(/^\+55/, "");
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
}

const waLink = (e164, text = "") =>
  `https://wa.me/${e164.replace(/^\+/, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

/** Opens (or creates) the contacts file; `handle(said)` answers or returns null. */
export function openContacts(file, { ddd = "" } = {}) {
  let data = { contacts: {} };
  if (file && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.contacts && typeof parsed.contacts === "object")
        data = { contacts: parsed.contacts };
    } catch {}
  }
  const save = () => {
    if (!file) return;
    const body = JSON.stringify(data, null, 2);
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, body);
      try {
        renameSync(tmp, file);
      } catch {
        writeFileSync(file, body);
      }
    } catch (err) {
      console.error(
        `[alfred] Não consegui salvar os contatos em ${file}: ${err?.code || err?.message}`
      );
    }
  };
  let waitingDdd = null; // { who, digits } while Alfred asks for the area code

  const find = (who) => {
    const c = contactName(who);
    return c ? { ...c, phone: data.contacts[c.key]?.phone ?? "" } : null;
  };
  const unknown = (who) =>
    `Não tenho o número de ${who.name}, mestre. Diga, por exemplo: o número de ${who.name.replace(/^(?:sua|seu)\s/, "")} é 69 99999-9999.`;

  function store(who, phone) {
    if (!data.contacts[who.key] && Object.keys(data.contacts).length >= MAX_CONTACTS)
      return "Já há contatos demais, mestre: apague algum antes.";
    data.contacts[who.key] = { name: who.name, phone };
    save();
    return `Anotado, mestre: o número de ${who.name} é ${spokenPhone(phone)}.`;
  }

  return {
    /** Answers a request about contacts, calls or WhatsApp: a string, `{ text, action }` or null. */
    handle(said) {
      const raw = String(said ?? "");
      let t = flat(raw).replace(/[?!]/g, " ");
      for (const re of [WAKE, POLITE]) {
        const m = t.match(re);
        if (m) t = " ".repeat(m[0].length) + t.slice(m[0].length);
      }
      // the words as said (with capitals and accents): same positions as in `t`
      const slice = (m, group) => {
        const start = m.index + m[0].indexOf(m[group]);
        return raw.slice(start, start + m[group].length);
      };

      if (waitingDdd) {
        const ask = waitingDdd;
        waitingDdd = null;
        const ddd_ = t.match(/\b(\d{2})\b/)?.[1];
        if (ddd_) return store(ask.who, `+55${ddd_}${ask.digits}`);
      }

      const saved = t.match(SAVE);
      if (saved) {
        const who = contactName(slice(saved, 1));
        const phone = normalizePhone(saved[2], ddd);
        if (!who || !phone) return null;
        if (phone.needsDdd) {
          waitingDdd = { who, digits: phone.digits };
          return `Qual é o DDD do número de ${who.name}, mestre?`;
        }
        return store(who, phone);
      }
      const asked = t.match(ASK);
      if (asked) {
        const who = find(slice(asked, 1));
        if (!who) return null;
        return who.phone
          ? `O número de ${who.name} é ${spokenPhone(who.phone)}, mestre.`
          : unknown(who);
      }
      const forgot = t.match(FORGET);
      if (forgot) {
        const who = find(slice(forgot, 1));
        if (!who) return null;
        if (!who.phone) return unknown(who);
        delete data.contacts[who.key];
        save();
        return `Pronto, mestre: apaguei o número de ${who.name}.`;
      }
      if (LIST.test(t)) {
        const names = Object.values(data.contacts).map((c) => c.name);
        if (!names.length) return "Ainda não tenho nenhum número guardado, mestre.";
        return `Tenho ${names.length === 1 ? "o número de" : "os números de"} ${names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0]}, mestre.`;
      }

      const call = t.match(CALL);
      if (call) {
        if (call[1]) {
          const phone = normalizePhone(call[1], ddd);
          if (!phone || phone.needsDdd) return "Preciso do número com o DDD, mestre.";
          return {
            text: "É só tocar em Ligar, mestre.",
            action: {
              kind: "call",
              label: `Ligar para ${formatPhone(phone)}`,
              url: `tel:${phone}`,
            },
          };
        }
        const emergency = EMERGENCY.find(([re]) => re.test(flat(call[2]).trim()));
        if (emergency) {
          const [, name, number] = emergency;
          return {
            text: `É só tocar em Ligar, mestre, e eu chamo ${name}: ${number.split("").join(" ")}.`,
            action: {
              kind: "call",
              label: `Ligar para ${name.replace(/^(?:o|a|os)\s/, "")} (${number})`,
              url: `tel:${number}`,
            },
          };
        }
        const who = find(slice(call, 2));
        if (!who) return null;
        if (!who.phone) return unknown(who);
        return {
          text: `É só tocar em Ligar, mestre, e eu chamo ${who.name}.`,
          action: { kind: "call", label: `Ligar para ${who.name}`, url: `tel:${who.phone}` },
        };
      }
      const wa = t.match(WHATSAPP);
      if (wa) {
        const who = find(slice(wa, 1));
        const message = slice(wa, 2)
          .trim()
          .replace(/[.!]+$/, "");
        if (!who || !message) return null;
        if (!who.phone) return unknown(who);
        const text = message.charAt(0).toUpperCase() + message.slice(1);
        return {
          text: `Escrevi para ${who.name}: ${text}${/[.!?…]$/.test(text) ? "" : "."} É só tocar em Enviar no WhatsApp, mestre.`,
          action: {
            kind: "whatsapp",
            label: `Enviar no WhatsApp para ${who.name}`,
            url: waLink(who.phone, text),
          },
        };
      }
      const chat = t.match(OPEN_CHAT);
      if (chat) {
        const who = find(slice(chat, 1));
        if (!who) return null;
        if (!who.phone) return unknown(who);
        return {
          text: `Aqui está a conversa com ${who.name}, mestre.`,
          action: { kind: "whatsapp", label: `WhatsApp de ${who.name}`, url: waLink(who.phone) },
        };
      }
      return null;
    },

    /** The saved contacts, `{ key: { name, phone } }` (for tests). */
    get contacts() {
      return structuredClone(data.contacts);
    },
  };
}
