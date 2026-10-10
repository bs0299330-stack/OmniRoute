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
const NUMBERS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };

/** "daqui a 30 minutos", "em uma hora", "daqui meia hora" → seconds, or 0 when no delay was said. */
export function parseDelay(text) {
  const t = plain(text);
  if (/meia hora/.test(t)) return 30 * 60;
  const m = t.match(/(?:daqui a?|em|dentro de)\s+(\d+|[a-z]+)\s+(minutos?|horas?)/);
  if (!m) return 0;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]] ?? 0;
  const seconds = m[2].startsWith("hora") ? n * 3600 : n * 60;
  return Math.min(seconds, 24 * 3600);
}

/** What the user asked the PC to do: `{ type, … }` or null (then the brain answers). */
export function parseCommand(text) {
  const t = plain(text).replace(WAKE, "");
  if (!t) return null;

  // shutting down (always confirmed first) and cancelling it
  if (/cancela(r)? (o )?desligamento|nao (desliga|reinicia)|cancela(r)? (o )?reinicio/.test(t)) return { type: "cancel" };
  if (/\b(deslig[ae]r?|desliga)\b.*\b(pc|computador|maquina)\b/.test(t)) return { type: "shutdown", restart: false, delay: parseDelay(t) };
  if (/\breinici[ae]r?\b.*\b(pc|computador|maquina)\b/.test(t)) return { type: "shutdown", restart: true, delay: parseDelay(t) };

  // volume and music
  if (/(aumenta|sobe|aumentar|mais alto).{0,12}(volume|som)|(volume|som).{0,6}mais alto/.test(t)) return { type: "key", key: "up", times: 5 };
  if (/(abaixa|diminui|baixa|abaixar|diminuir|mais baixo).{0,12}(volume|som)|(volume|som).{0,6}mais baixo/.test(t)) {
    return { type: "key", key: "down", times: 5 };
  }
  if (/\b(sem som|tira o som|desliga o som|muta|mutar|silencia|silenciar|volta o som)\b/.test(t)) return { type: "key", key: "mute", times: 1 };
  if (/(pausa|pausar|despausa|continua|retoma|solta|toca de novo).{0,6}(a |o )?(musica|video|som)|^(pausa|play)$/.test(t)) {
    return { type: "key", key: "playpause", times: 1 };
  }
  if (/(proxima|passa (a|essa)|pula (a|essa)) (musica|faixa)|proxima$/.test(t)) return { type: "key", key: "next", times: 1 };
  if (/(musica anterior|volta (a|uma) musica|faixa anterior)/.test(t)) return { type: "key", key: "prev", times: 1 };

  // searching: "pesquisa receita de bolo no google", "toca jazz no youtube"
  const search = t.match(/^(?:pesquis[ae]r?|procur[ae]r?|busca[r]?|toca|coloca|poe)\s+(?:por\s+)?(.+?)\s+no\s+(google|youtube)$/);
  if (search) return { type: "search", query: search[1], where: search[2] };

  // opening: "abre o youtube", "abre a calculadora", "entra no gmail"
  const open = t.match(/^(?:abr[ae]r?|abre pra mim|entra no|entra na|entrar no|vai no|vai na|inicia|liga)\s+(?:o |a |os |as )?(.+)$/);
  if (open) {
    const name = open[1].trim();
    const site = Object.keys(SITES).find((k) => name === k || name === `site do ${k}` || name === `${k} pra mim`);
    if (site) return { type: "site", key: site };
    const program = Object.keys(PROGRAMS).find((k) => name === k || name.startsWith(`${k} `));
    if (program) return { type: "program", key: program };
    if (/^(pc|computador|maquina|volume|som|musica|luz)/.test(name)) return null; // not something to open
    return { type: "search", query: name, where: "google" }; // anything else: look it up on Google
  }
  return null;
}

const YES = /^(sim|pode|pode sim|confirmo|confirma|isso|claro|tenho certeza|com certeza|pode desligar|pode reiniciar)\b/;

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
  if (seconds % 3600 === 0) return seconds === 3600 ? "uma hora" : `${seconds / 3600} horas`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "um minuto" : `${minutes} minutos`;
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
        if (YES.test(plain(text).replace(WAKE, ""))) return execute(waiting.command);
        const other = parseCommand(text);
        if (!other) return "Tudo bem, mestre. Não vou desligar.";
        // a different command: forget the shutdown and carry on with the new one below
      }
      const cmd = parseCommand(text);
      if (!cmd) return null;
      if (platform !== "win32") return "Por enquanto só consigo mexer no computador quando ele é Windows, mestre.";
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
