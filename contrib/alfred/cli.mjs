#!/usr/bin/env node
// Alfred no terminal — conversa por texto, fala com a voz de IA e (com o sox instalado) ouve pelo
// microfone. Zero dependências (Node >= 22).
//
//   node contrib/alfred/cli.mjs                  conversa por texto (+ voz, se configurada)
//   node contrib/alfred/cli.mjs --conversa       mãos livres: ouve, responde, ouve de novo
//   node contrib/alfred/cli.mjs --cerebro=claude usa o Claude Code como cérebro
//
// Lê contrib/alfred/alfred.env, como o servidor.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BRAIN_LABELS, BrainError, checkBrains, detectBrainInfo, streamReply } from "./brain.mjs";
import {
  LINUX_PLAYERS,
  OPENAI_STT_URL,
  WINDOWS_PLAYER_SCRIPT,
  buildTtsRequest,
  loadConfig,
  soxRecordArgs,
  statusLabel,
} from "./lib.mjs";
import { CHUNKING, createChunker, isStopPhrase } from "./public/voice.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(HERE, "alfred.env");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
if (option("cerebro")) process.env.ALFRED_BRAIN = option("cerebro");

const config = loadConfig();
if (!flag("debug")) process.env.ALFRED_QUIET = "1"; // --debug mostra os logs técnicos

// ---------- Cores ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const cyan = paint("38;5;250"); // graphite
const glow = paint("1;38;5;220"); // the yellow accent
const green = paint("38;5;114");
const dim = paint("2");
const red = paint("38;5;203");

function hasCommand(cmd, versionArg = "--version") {
  try {
    const r = spawnSync(cmd, [versionArg], { stdio: "ignore", timeout: 5000 });
    return !r.error;
  } catch {
    return false;
  }
}

// ---------- Voz ----------
class Voice {
  constructor() {
    this.player = this.findPlayer();
    this.enabled = !!config.ttsProvider && !!this.player && !flag("sem-voz");
    this.generation = 0;
    this.chain = Promise.resolve();
    this.child = null;
    this.ps = null;
    this.counter = 0;
  }

  findPlayer() {
    if (process.platform === "win32") return { kind: "powershell" };
    if (process.platform === "darwin") return hasCommand("afplay", "-h") ? { kind: "spawn", cmd: "afplay", args: [] } : null;
    for (const [cmd, args] of LINUX_PLAYERS) {
      if (hasCommand(cmd, cmd === "ffplay" ? "-version" : "--version")) return { kind: "spawn", cmd, args };
    }
    return null;
  }

  async synthesize(text) {
    const tts = buildTtsRequest(config, text, config.ttsVoice, "wav");
    const res = await fetch(tts.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tts.apiKey}` },
      body: JSON.stringify(tts.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = join(await tempDir(), `fala-${process.pid}-${this.counter++}.wav`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }

  powershell() {
    if (this.ps && this.ps.exitCode === null) return this.ps;
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PLAYER_SCRIPT], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    ps.stdout.setEncoding("utf8");
    ps.stdin.on("error", () => {});
    ps.waiters = [];
    let buf = "";
    ps.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        buf = buf.slice(i + 1);
        ps.waiters.shift()?.();
      }
    });
    ps.on("exit", () => ps.waiters.splice(0).forEach((done) => done()));
    this.ps = ps;
    return ps;
  }

  play(file) {
    return new Promise((done) => {
      if (this.player.kind === "powershell") {
        const ps = this.powershell();
        ps.waiters.push(done);
        ps.stdin.write(file + "\n");
        return;
      }
      const child = spawn(this.player.cmd, [...this.player.args, file], { stdio: "ignore" });
      this.child = child;
      child.on("error", done);
      child.on("exit", () => {
        this.child = null;
        done();
      });
    });
  }

  /** Queue one chunk: it is synthesized right away, played after the previous one. */
  say(text) {
    if (!this.enabled || !text) return;
    const gen = this.generation;
    const audio = this.synthesize(text);
    audio.catch(() => {});
    this.chain = this.chain.then(async () => {
      if (gen !== this.generation) return;
      let file;
      try {
        file = await audio;
      } catch (err) {
        if (gen === this.generation) console.log(dim(`\n  (a voz de IA falhou: ${err.message})`));
        return;
      }
      if (gen === this.generation) await this.play(file);
      rm(file, { force: true }).catch(() => {});
    });
  }

  cancel() {
    this.generation++;
    this.chain = Promise.resolve();
    this.child?.kill();
    if (this.ps) {
      this.ps.kill(); // a fresh player starts on the next sentence
      this.ps = null;
    }
  }

  idle() {
    return this.chain;
  }
}

// ---------- Ouvido (microfone) ----------
class Ears {
  constructor() {
    this.hasSox = hasCommand("sox");
    this.stt = config.openaiKey
      ? { url: OPENAI_STT_URL, apiKey: config.openaiKey, model: config.sttModel || "gpt-4o-mini-transcribe" }
      : config.sttModel
        ? { url: `${config.baseUrl}/audio/transcriptions`, apiKey: config.apiKey, model: config.sttModel }
        : null;
    this.available = this.hasSox && !!this.stt;
    this.child = null;
  }

  whyNot() {
    const site = "Para conversar por voz sem configurar nada, use o site (iniciar-alfred.cmd) e clique no 🎙.";
    if (!this.stt) return `o microfone do terminal precisa de OPENAI_API_KEY para transcrever. ${site}`;
    return `o microfone do terminal precisa do sox (winget install ChrisBagwell.SoX). ${site}`;
  }

  record(file) {
    return new Promise((resolve) => {
      const child = spawn("sox", soxRecordArgs(file), { stdio: ["ignore", "ignore", "pipe"] });
      this.child = child;
      let err = "";
      child.stderr.on("data", (d) => (err = (err + d).slice(-500)));
      child.on("error", () => resolve(false));
      child.on("exit", (code) => {
        this.child = null;
        resolve(code === 0 || existsSync(file));
        if (code && err.trim()) console.log(dim(`  (sox: ${err.trim().split("\n").pop()})`));
      });
    });
  }

  async transcribe(file) {
    const form = new FormData();
    form.append("file", new Blob([await readFile(file)], { type: "audio/wav" }), "fala.wav");
    form.append("model", this.stt.model);
    form.append("language", "pt");
    const res = await fetch(this.stt.url, {
      method: "POST",
      headers: this.stt.apiKey ? { authorization: `Bearer ${this.stt.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`transcrição falhou (HTTP ${res.status})`);
    const data = await res.json();
    return String(data.text ?? "").trim();
  }

  /** Records one phrase (stops on silence) and returns its text ("" if nothing was said). */
  async listen() {
    const file = join(await tempDir(), `ouvido-${process.pid}-${Date.now()}.wav`);
    process.stdout.write(cyan("  ◉ ouvindo… ") + dim("(fale; eu paro quando você fizer silêncio)\n"));
    try {
      if (!(await this.record(file))) return "";
      return await this.transcribe(file);
    } finally {
      rm(file, { force: true }).catch(() => {});
    }
  }

  cancel() {
    this.child?.kill();
  }
}

let tmp = null;
async function tempDir() {
  tmp ??= await mkdtemp(join(tmpdir(), "alfred-"));
  return tmp;
}

// ---------- Conversa ----------
const voice = new Voice();
const ears = new Ears();
let brain = "omniroute";
let brainFound = true;
let messages = [];
let controller = null;
let conversation = false;

async function ask(text) {
  if (!brainFound) {
    console.log(red("\n  O Alfred está sem cérebro para responder.") + " Veja as opções acima ou digite /diagnostico.\n");
    return;
  }
  voice.cancel();
  messages.push({ role: "user", content: text });
  messages = messages.slice(-40);
  controller = new AbortController();
  const chunker = createChunker(CHUNKING.neural);
  process.stdout.write(glow("\n  ALFRED › "));
  const thinking = startThinking();
  let full = "";
  try {
    for await (const delta of streamReply(config, brain, messages, { signal: controller.signal })) {
      if (typeof delta !== "string") {
        thinking.label(statusLabel(delta.status)); // 🔎 pesquisando na internet…
        continue;
      }
      thinking.stop();
      full += delta;
      process.stdout.write(delta);
      for (const piece of chunker.push(delta)) voice.say(piece);
    }
    for (const piece of chunker.flush()) voice.say(piece);
    process.stdout.write("\n\n");
    if (full) messages.push({ role: "assistant", content: full });
    else messages.pop();
  } catch (err) {
    thinking.stop();
    messages.pop();
    if (controller.signal.aborted) {
      process.stdout.write(dim(" (interrompido)\n\n"));
      return;
    }
    const message = err instanceof BrainError ? err.message : "O cérebro do Alfred falhou.";
    if (!(err instanceof BrainError)) console.error(err);
    process.stdout.write(red(message) + "\n\n");
  } finally {
    thinking.stop();
    controller = null;
  }
}

/** "pensando… 3s" while waiting for the first words, so a slow brain never looks frozen. */
function startThinking() {
  if (!process.stdout.isTTY) return { stop() {}, label() {} };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const started = Date.now();
  let i = 0;
  let shown = "";
  let what = "pensando…";
  const draw = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const text = `${frames[i++ % frames.length]} ${what} ${secs}s`.slice(0, 70);
    process.stdout.write("\b".repeat(shown.length) + dim(text));
    shown = text;
  };
  draw();
  const timer = setInterval(draw, 120);
  return {
    label(text) {
      what = `🔎 ${text}`;
    },
    stop() {
      clearInterval(timer);
      if (shown) {
        process.stdout.write("\b".repeat(shown.length) + " ".repeat(shown.length) + "\b".repeat(shown.length));
        shown = "";
      }
    },
  };
}

async function listenOnce() {
  if (!ears.available) {
    console.log(dim("  Microfone indisponível: " + ears.whyNot()));
    return "";
  }
  voice.cancel();
  try {
    const text = await ears.listen();
    if (text) console.log(cyan("  VOCÊ  › ") + text);
    else console.log(dim("  (não ouvi nada)"));
    return text;
  } catch (err) {
    console.log(red(`  ${err.message}`));
    return "";
  }
}

async function conversationLoop() {
  if (!ears.available) {
    console.log(dim("  Modo conversa indisponível: " + ears.whyNot()));
    return;
  }
  conversation = true;
  console.log(dim("  Modo conversa: fale à vontade. Diga “tchau” ou aperte Ctrl+C para voltar ao teclado.\n"));
  let silent = 0;
  while (conversation) {
    const text = await listenOnce();
    if (!conversation) break;
    if (!text) {
      if (++silent >= 2) break;
      continue;
    }
    silent = 0;
    if (isStopPhrase(text)) {
      voice.say("Às suas ordens, senhor.");
      await voice.idle();
      break;
    }
    await ask(text);
    await voice.idle();
  }
  conversation = false;
  console.log(dim("  (modo conversa encerrado)\n"));
}

const HELP = `
  Escreva e aperte Enter para falar com o Alfred. Comandos:
    ${cyan("Enter vazio")}  ouvir uma frase pelo microfone
    ${cyan("/conversa")}    mãos livres: ouve, responde e ouve de novo
    ${cyan("/voz")}         liga/desliga a voz
    ${cyan("/nova")}        começa uma conversa nova
    ${cyan("/diagnostico")} testa o cérebro, a voz e o microfone e diz o que falta
    ${cyan("/sair")}        sai (ou Ctrl+C duas vezes)
`;

function banner() {
  const line = cyan("  ─────────────────────────────────────────────");
  console.log(`\n${line}\n${glow("   ◢◤  A L F R E D")}  ${dim("· assistente pessoal")}\n${line}`);
  const vozInfo = voice.enabled
    ? `IA (${config.ttsProvider === "openai" ? "OpenAI" : "OmniRoute"} · ${config.ttsVoice})`
    : config.ttsProvider
      ? "sem player de áudio"
      : "desligada (defina OPENAI_API_KEY)";
  console.log(dim(`   cérebro  ${BRAIN_LABELS[brain]}`));
  console.log(dim(`   voz      ${vozInfo}`));
  console.log(dim(`   ouvido   ${ears.available ? "microfone pronto (Enter vazio)" : "indisponível — " + ears.whyNot()}`));
  console.log(dim("   /ajuda para os comandos\n"));
  if (!brainFound) {
    console.log(red("   ⚠  Nenhum cérebro está funcionando, então o Alfred não consegue responder."));
    console.log("      Escolha UMA opção (depois feche e abra o Alfred):");
    console.log(`      ${glow("1.")} Claude (se você tem plano Pro ou Max): no PowerShell rode`);
    console.log(`         ${cyan("irm https://claude.ai/install.ps1 | iex")}`);
    console.log("         feche e abra o terminal, rode " + cyan("claude") + " e faça o login.");
    console.log(`      ${glow("2.")} OpenAI: coloque sua chave em OPENAI_API_KEY no arquivo alfred.env.`);
    console.log(`      ${glow("3.")} OmniRoute: deixe o OmniRoute ligado.`);
    console.log(dim("      Digite /diagnostico para testar tudo.\n"));
  }
}

async function diagnose() {
  const mark = (ok) => (ok ? green("✔") : red("✘"));
  console.log(glow("\n  DIAGNÓSTICO DO ALFRED\n"));
  console.log(`  ${mark(true)} Node.js ${process.versions.node}`);
  console.log(dim("    Testando os cérebros (o Claude pode levar até 1 minuto)…"));
  const brains = await checkBrains(config);
  for (const [name, check] of Object.entries(brains)) {
    console.log(`  ${mark(check.ok)} Cérebro ${BRAIN_LABELS[name]}: ${check.detail}`);
    if (!check.ok && check.fix) console.log(dim(`      → ${check.fix}`));
    if (!check.ok && check.raw) console.log(dim(`      Mensagem do ${BRAIN_LABELS[name]}: ${check.raw}`));
  }
  const working = Object.entries(brains).filter(([, c]) => c.ok).map(([n]) => BRAIN_LABELS[n]);
  console.log(
    working.length
      ? `    ${green("Cérebro disponível:")} ${working.join(", ")}`
      : `    ${red("Nenhum cérebro funcionando — resolva pelo menos um dos itens acima.")}`
  );
  console.log(
    `  ${mark(voice.enabled)} Voz de IA: ${
      voice.enabled ? `${config.ttsVoice} (${config.ttsProvider})` : config.ttsProvider ? "sem player de áudio" : "desligada"
    }`
  );
  if (!config.ttsProvider) console.log(dim("      → Opcional: OPENAI_API_KEY no alfred.env liga a voz de IA."));
  console.log(`  ${mark(ears.available)} Microfone no terminal: ${ears.available ? "pronto" : "indisponível"}`);
  if (!ears.available) console.log(dim(`      → Opcional: ${ears.whyNot()}`));
  const tunnel = hasCommand("cloudflared");
  console.log(`  ${mark(tunnel)} Link para o celular (cloudflared): ${tunnel ? "instalado" : "não instalado"}`);
  if (!tunnel) console.log(dim("      → Opcional: winget install Cloudflare.cloudflared"));
  console.log("");
  return working.length > 0;
}

async function main() {
  if (flag("diagnostico")) {
    const ok = await diagnose();
    process.exit(ok ? 0 : 1);
  }
  ({ brain, found: brainFound } = await detectBrainInfo(config));
  banner();

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: cyan("  VOCÊ  › ") });
  const queue = [];
  let busy = false;
  let quit = false; // /sair: leave now
  let inputEnded = false; // Ctrl+D or end of a pipe: answer what is queued, then leave
  let lastSigint = 0;

  async function finish() {
    voice.cancel();
    console.log(dim("\n  Até logo, senhor.\n"));
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
  }

  async function handle(text) {
    if (text === "/sair") return (quit = true);
    if (text === "/ajuda") return console.log(HELP);
    if (text === "/nova") {
      voice.cancel();
      messages = [];
      return console.log(dim("  Conversa nova.\n"));
    }
    if (text === "/voz") {
      if (!config.ttsProvider) return console.log(dim("  Defina OPENAI_API_KEY no alfred.env para a voz de IA.\n"));
      voice.enabled = !voice.enabled && !!voice.player;
      if (!voice.enabled) voice.cancel();
      return console.log(dim(`  Voz ${voice.enabled ? "ligada" : "desligada"}.\n`));
    }
    if (text === "/conversa") return conversationLoop();
    if (text === "/diagnostico") {
      await diagnose();
      ({ brain, found: brainFound } = await detectBrainInfo(config));
      return;
    }
    if (!text) {
      const heard = await listenOnce();
      if (heard) await ask(heard);
      return;
    }
    await ask(text);
  }

  // Lines typed (or piped) while Alfred is answering wait their turn.
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length && !quit) await handle(queue.shift());
    busy = false;
    if (quit || inputEnded) {
      await voice.idle();
      return finish();
    }
    rl.prompt();
  }

  rl.on("SIGINT", () => {
    if (conversation || controller) {
      conversation = false;
      ears.cancel();
      controller?.abort();
      voice.cancel();
      return;
    }
    if (Date.now() - lastSigint < 1500) return finish();
    lastSigint = Date.now();
    voice.cancel();
    console.log(dim("\n  (Ctrl+C de novo para sair)"));
    rl.prompt();
  });
  rl.on("line", (line) => {
    queue.push(line.trim());
    pump();
  });
  rl.on("close", () => {
    inputEnded = true;
    if (!busy) pump();
  });

  if (flag("conversa")) queue.push("/conversa");
  if (queue.length) pump();
  else rl.prompt();
}

main();
