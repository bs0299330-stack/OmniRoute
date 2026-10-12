// Alfred — controls the Windows PC by voice: open sites and programs, volume and music, shut
// down. Commands are recognised from the user's own words against a fixed list (the brain never
// runs anything, so no web page or answer can make Alfred act on the PC), and only fixed commands
// run, with no shell: user words only ever end up URL-encoded inside an https:// address.

import { spawn } from "node:child_process";

// ---------- What can be opened ----------

const SITES = {
  youtube: ["YouTube", "https://www.youtube.com/"],
  gmail: ["o Gmail", "https://mail.google.com/"],
  email: ["o Gmail", "https://mail.google.com/"],
  google: ["o Google", "https://www.google.com/"],
  netflix: ["a Netflix", "https://www.netflix.com/"],
  spotify: ["o Spotify", "https://open.spotify.com/"],
};

// Program name → what Windows' Start-Process gets (all constants).
const PROGRAMS = {
  calculadora: ["a calculadora", "calc.exe"],
  "bloco de notas": ["o bloco de notas", "notepad.exe"],
  word: ["o Word", "winword"],
  excel: ["o Excel", "excel"],
  powerpoint: ["o PowerPoint", "powerpnt"],
  paint: ["o Paint", "mspaint.exe"],
  explorador: ["o explorador de arquivos", "explorer.exe"],
  arquivos: ["o explorador de arquivos", "explorer.exe"],
  "meus arquivos": ["o explorador de arquivos", "explorer.exe"],
  configuracoes: ["as configurações", "ms-settings:"],
  "gerenciador de tarefas": ["o gerenciador de tarefas", "taskmgr.exe"],
  chrome: ["o Chrome", "chrome"],
  edge: ["o Edge", "msedge"],
};

// Media keys (Windows virtual-key codes sent by WScript.Shell.SendKeys).
const KEYS = { up: 175, down: 174, mute: 173, playpause: 179, next: 176, prev: 177 };

// ---------- Understanding the request (pure, unit-tested) ----------

const plain = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.!?,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const WAKE = /^(?:(?:ei|ok|ola|oi)\s+)?alfredo?\s+/;
const POLITE = /^(?:por favor|pode|voce pode|da pra|consegue)\s+/;
const QUESTION = /^(?:o que|que|como|por que|porque|quando|qual|quais|quem|onde|sera|voce sabe|e se|se eu)\b/;
const NUMBERS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90,
};
const number = (words) => {
  if (/^\d+$/.test(words)) return Number(words);
  let total = 0;
  for (const w of words.split(/\s+e\s+/)) {
    if (!(w in NUMBERS)) return NaN;
    total += NUMBERS[w];
  }
  return total;
};
const NUM = "\\d+|[a-z]+(?:\\s+e\\s+[a-z]+)?";

/**
 * The delay in "daqui a 30 minutos", "em uma hora e meia", "daqui a 1h", "às 22 horas" → seconds;
 * 0 when no time was said; null when a time was said but not understood (Alfred then asks).
 */
export function parseDelay(text, now = new Date()) {
  const t = plain(text);
  const at = t.match(/\bas\s+(\d{1,2})(?:\s*(?:h|horas?))?(?:\s*e?\s*(\d{1,2})(?:\s*min(?:utos?)?)?)?\b/);
  if (at && Number(at[1]) < 24 && Number(at[2] ?? 0) < 60) {
    const when = new Date(now);
    when.setHours(Number(at[1]), Number(at[2] ?? 0), 0, 0);
    if (when <= now) when.setDate(when.getDate() + 1);
    return Math.round((when - now) / 1000);
  }
  if (/\bmeia hora\b/.test(t) && !/\bhoras?\s+e\s+meia\b/.test(t)) return 30 * 60;
  const m = t.match(new RegExp(`(?:daqui a?|em|dentro de)\\s+(${NUM})\\s*(minutos?|min|horas?|h)\\b(\\s+e\\s+meia)?`));
  if (m) {
    const n = number(m[1]);
    if (Number.isFinite(n)) {
      const seconds = m[2].startsWith("h") ? n * 3600 + (m[3] ? 1800 : 0) : n * 60;
      return Math.min(seconds, 24 * 3600);
    }
  }
  return /\b(daqui|dentro de|mais tarde|depois|minutos?|horas?|as \d)\b/.test(t) ? null : 0;
}

/** What the user asked the PC to do: `{ type, … }` or null (then the brain answers). */
export function parseCommand(text) {
  const raw = String(text ?? "");
  // Questions and stories ("desligar o computador faz mal?", "minha mãe desliga o computador")
  // are for the brain: only orders, said at the start of the sentence, act on the PC.
  if (raw.includes("?")) return null;
  const t = plain(raw).replace(WAKE, "").replace(POLITE, "");
  if (!t || QUESTION.test(t)) return null;

  // shutting down (always confirmed first) and cancelling it
  if (/^(?:cancela(?:r)?\s+(?:o\s+)?(?:desligamento|reinicio)|nao\s+(?:desliga|reinicia)(?:\s+(?:o\s+|a\s+)?(?:pc|computador|maquina))?$)/.test(t)) {
    return { type: "cancel" };
  }
  // "desliga o PC", "desliga o computador daqui a 30 minutos"; "desligar o computador faz mal"
  // is not an order: after "o computador" only a time (or "por favor") may follow
  const off = t.match(
    /^(deslig[ae]r?|reinici[ae]r?)\s+(?:o\s+|a\s+|meu\s+|minha\s+)?(?:pc|computador|maquina)((?:\s+(?:agora|ja|por favor|pra mim|(?:daqui|em|dentro de|as|mais tarde|depois)\b.*))*)$/
  );
  if (off) return { type: "shutdown", restart: off[1].startsWith("reinici"), delay: parseDelay(t) };

  // volume and music
  if (/^(?:aumenta|aumentar|sobe|subir)\s+(?:um pouco\s+)?(?:o\s+)?(?:volume|som)\b|^(?:volume|som)\s+mais alto$/.test(t)) {
    return { type: "key", key: "up", times: 5 };
  }
  if (/^(?:abaixa|abaixar|diminui|diminuir|baixa|baixar)\s+(?:um pouco\s+)?(?:o\s+)?(?:volume|som)\b|^(?:volume|som)\s+mais baixo$/.test(t)) {
    return { type: "key", key: "down", times: 5 };
  }
  if (/^(?:sem som|tira o som|desliga o som|muta|mutar|silencia|silenciar|volta o som)$/.test(t)) return { type: "key", key: "mute", times: 1 };
  if (/^(?:pausa|pausar|despausa|continua|retoma|solta|toca de novo)\s+(?:a\s+|o\s+)?(?:musica|video|som)$|^(?:pausa|play)$/.test(t)) {
    return { type: "key", key: "playpause", times: 1 };
  }
  if (/^(?:proxima|passa\s+(?:a|essa)|pula\s+(?:a|essa))(?:\s+(?:musica|faixa))?$/.test(t) && t !== "passa a" && t !== "pula a") {
    return { type: "key", key: "next", times: 1 };
  }
  if (/^(?:musica anterior|faixa anterior|volta\s+(?:a|uma)\s+musica)$/.test(t)) return { type: "key", key: "prev", times: 1 };

  // searching: "pesquisa receita de bolo no google", "toca jazz no youtube" — the words keep
  // their accents ("pão de queijo"), they only go into the search address
  const words = raw
    .toLowerCase()
    .replace(/[.!,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:ei|ok|olá|ola|oi)\s+)?alfredo?\s+/, "")
    .replace(/^(?:por favor|pode|você pode|voce pode)\s+/, "");
  const search = words.match(/^(?:pesquis[ae]r?|procur[ae]r?|busca[r]?|toca|coloca|p[oõ]e)\s+(?:por\s+)?(.+?)\s+no\s+(google|youtube)$/);
  if (search) return { type: "search", query: search[1], where: search[2] };

  // opening: "abre o youtube", "abre a calculadora", "entra no gmail"
  const open = t.match(/^(abr[ae]r?|abre pra mim|entra no|entra na|entrar no|vai no|vai na|inicia|liga)\s+(?:o |a |os |as )?(?:meu |minha )?(.+?)(?:\s+(?:por favor|pra mim|agora|ai))*$/);
  if (open) {
    const name = open[2].trim();
    const site = Object.keys(SITES).find((k) => name === k || name === `site do ${k}`);
    if (site) return { type: "site", key: site };
    const program = Object.keys(PROGRAMS).find((k) => name === k || name.startsWith(`${k} `));
    if (program) return { type: "program", key: program };
    // anything else is looked up on Google, but only after "abre" ("liga pra minha mãe",
    // "vai na padaria" are not things to open)
    if (!/^abr/.test(open[1]) || /^(pc|computador|maquina|volume|som|musica|luz|porta|janela)\b/.test(name)) return null;
    const query = words.match(/^(?:abr[ae]r?|abre pra mim)\s+(?:o |a |os |as )?(.+?)(?:\s+(?:por favor|pra mim|agora|aí|ai))*$/)?.[1];
    return { type: "search", query: query || name, where: "google" };
  }
  return null;
}

// The whole reply must be a yes: "pode deixar", "claro que não" and "isso é sério?" are not.
const YES = /^(?:sim|pode|pode sim|confirmo|confirma|isso|isso mesmo|claro|claro que sim|tenho certeza|com certeza|pode desligar|pode reiniciar)(?:\s+(?:sim|pode|mestre|alfred|alfredo|por favor))*$/;

// ---------- Doing it ----------

function run(command, args, spawnImpl) {
  try {
    const child = spawnImpl(command, args, { stdio: "ignore", windowsHide: true, detached: true });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

const openUrl = (url, spawnImpl) => run("explorer.exe", [url], spawnImpl); // default browser, no shell
const startProgram = (target, spawnImpl) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${target}'`], spawnImpl);
const pressKey = (code, times, spawnImpl) =>
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$s = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $s.SendKeys([char]${code}) }`,
    ],
    spawnImpl
  );

function spokenDelay(seconds) {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? "uma hora" : `${h} horas`;
  const minutes = m === 1 ? "um minuto" : `${m} minutos`;
  if (!h) return minutes;
  if (!m) return hours;
  return m === 30 ? `${hours} e meia` : `${hours} e ${minutes}`;
}

/**
 * Keeps the one pending confirmation ("desliga o PC" → "tem certeza?") and turns the user's words
 * into an action. `handle(text)` returns Alfred's spoken reply, or null when the words are not a
 * PC command (the brain answers instead).
 */
export function createPcControl({ platform = process.platform, spawnImpl = spawn, now = () => Date.now() } = {}) {
  let pending = null; // { command, until }

  function execute(cmd) {
    if (cmd.type === "site") {
      const [name, url] = SITES[cmd.key];
      return openUrl(url, spawnImpl) ? `Abrindo ${name}, mestre.` : `Não consegui abrir ${name}, mestre.`;
    }
    if (cmd.type === "program") {
      const [name, target] = PROGRAMS[cmd.key];
      return startProgram(target, spawnImpl) ? `Abrindo ${name}, mestre.` : `Não consegui abrir ${name}, mestre.`;
    }
    if (cmd.type === "search") {
      const url =
        cmd.where === "youtube"
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(cmd.query)}`
          : `https://www.google.com/search?q=${encodeURIComponent(cmd.query)}`;
      return openUrl(url, spawnImpl)
        ? `Procurando ${cmd.query} no ${cmd.where === "youtube" ? "YouTube" : "Google"}, mestre.`
        : "Não consegui abrir o navegador, mestre.";
    }
    if (cmd.type === "key") {
      const said = { up: "Aumentando o volume.", down: "Abaixando o volume.", mute: "Pronto.", playpause: "Pronto.", next: "Próxima.", prev: "Voltando." };
      return pressKey(KEYS[cmd.key], cmd.times, spawnImpl) ? said[cmd.key] : "Não consegui mexer no som, mestre.";
    }
    if (cmd.type === "cancel") {
      run("shutdown.exe", ["/a"], spawnImpl);
      return "Desligamento cancelado, mestre.";
    }
    if (cmd.type === "shutdown") {
      // a minute of grace even when "now" was asked, so "cancela o desligamento" still works
      const seconds = Math.max(60, cmd.delay);
      run("shutdown.exe", [cmd.restart ? "/r" : "/s", "/t", String(seconds)], spawnImpl);
      const what = cmd.restart ? "Reiniciando" : "Desligando";
      return `${what} o computador em ${spokenDelay(seconds)}, mestre. Se mudar de ideia, diga: cancela o desligamento.`;
    }
    return null;
  }

  return {
    handle(text) {
      const waiting = pending && pending.until > now() ? pending : null;
      pending = null;
      if (waiting) {
        const reply = plain(text).replace(WAKE, "");
        if (YES.test(reply)) return execute(waiting.command);
        if (/^(?:nao|deixa|pode deixar|esquece|cancela|melhor nao|agora nao)\b/.test(reply)) return "Tudo bem, mestre. Não vou desligar.";
        // anything else: the shutdown is dropped and the words are handled as usual below
      }
      const cmd = parseCommand(text);
      if (!cmd) return null;
      if (platform !== "win32") return "Por enquanto só consigo mexer no computador quando ele é Windows, mestre.";
      if (cmd.type === "shutdown" && cmd.delay === null) {
        return "Não entendi para quando, mestre. Diga, por exemplo: desliga o computador daqui a 30 minutos.";
      }
      if (cmd.type === "shutdown") {
        pending = { command: cmd, until: now() + 30_000 };
        const what = cmd.restart ? "reiniciar" : "desligar";
        const when = cmd.delay ? ` daqui a ${spokenDelay(cmd.delay)}` : "";
        return `Tem certeza que quer ${what} o computador${when}, mestre? Diga sim para confirmar.`;
      }
      return execute(cmd);
    },
  };
}
