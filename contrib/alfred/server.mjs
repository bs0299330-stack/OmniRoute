#!/usr/bin/env node
// Alfred — voice assistant web server. Zero dependencies (Node >= 22).
// Serves the web UI and proxies chat to OmniRoute so the API key never reaches the browser.
//
//   node contrib/alfred/server.mjs        → http://127.0.0.1:20140
//
// Settings come from the environment, plus contrib/alfred/alfred.env when it exists.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_LABELS, BrainError, detectBrainInfo, keepLocalWarm, streamReply } from "./brain.mjs";
import { briefing } from "./weblite.mjs";
import {
  ELEVENLABS_FALLBACK_MODEL,
  buildPhoneLink,
  buildTtsRequest,
  buildTunnelArgs,
  extractTunnelUrl,
  isAuthorized,
  loadConfig,
  statusLabel,
  ttsLabel,
  ttsVoices,
  validateChatBody,
  validateTtsBody,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 512 * 1024;
const ENV_FILE = join(HERE, "alfred.env");
// Variables already set in the shell win over the file (loadEnvFile never overrides).
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const config = loadConfig();
// --tunel: publish the server on an https link for the phone (mic needs https). The API then
// always requires a token; one is generated for this run when ALFRED_TOKEN is not set.
const wantTunnel = process.argv.includes("--tunel") || process.env.ALFRED_TUNNEL === "1";
let generatedToken = false;
if (wantTunnel && !config.accessToken) {
  config.accessToken = randomBytes(18).toString("base64url");
  generatedToken = true;
}
let brain = null; // resolved at startup ("auto" → the first brain that answers)
let brainReady = null;

let brainFound = true;

let stopWarm = null;

function getBrain() {
  brainReady ??= detectBrainInfo(config).then((info) => {
    brainFound = info.found;
    // The local AI stays loaded, so answers never wait for the model to load.
    if (info.found && info.brain === "local") stopWarm ??= keepLocalWarm(config);
    return (brain = info.brain);
  });
  return brainReady;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/voice.mjs": ["voice.mjs", "text/javascript; charset=utf-8"],
  "/hud.mjs": ["hud.mjs", "text/javascript; charset=utf-8"],
  "/clap.mjs": ["clap.mjs", "text/javascript; charset=utf-8"],
  "/hud.css": ["hud.css", "text/css; charset=utf-8"],
};

async function serveStatic(res, [file, type], cache = "no-store") {
  const body = await readFile(join(HERE, "public", file));
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  res.end(body);
}

// Alfred's recorded fixed phrases (public/frases/*.mp3). Only plain names, so a request can
// never reach a file outside that folder.
const PHRASE_FILE = /^\/frases\/([a-z0-9-]{1,40})\.mp3$/;

async function servePhrase(res, name) {
  try {
    return await serveStatic(res, [`frases/${name}.mp3`, "audio/mpeg"], "public, max-age=86400");
  } catch {
    return sendJson(res, 404, { error: "Frase não encontrada." });
  }
}

async function handleTts(req, res) {
  if (!config.ttsProvider) {
    return sendJson(res, 404, { error: "Voz de IA desligada (defina OPENAI_API_KEY ou ALFRED_TTS_MODEL)." });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "JSON inválido ou grande demais." });
  }
  const check = validateTtsBody(body, config);
  if (!check.ok) return sendJson(res, 400, { error: check.error });

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const timer = setTimeout(() => controller.abort(), 30000);
  const call = (model) => {
    const tts = buildTtsRequest(config, check.text, check.voice, "mp3", model);
    return fetch(tts.url, { method: "POST", headers: tts.headers, body: JSON.stringify(tts.body), signal: controller.signal });
  };
  let upstream;
  try {
    upstream = await call(config.ttsModel);
    // The account may not offer the default ElevenLabs model yet: switch to the fallback for good.
    if (!upstream.ok && config.ttsProvider === "elevenlabs" && config.ttsModel !== ELEVENLABS_FALLBACK_MODEL) {
      const detail = await upstream.text().catch(() => "");
      if ([400, 404, 422].includes(upstream.status) && /model/i.test(detail)) {
        console.warn(`[alfred] ElevenLabs recusou o modelo ${config.ttsModel}; usando ${ELEVENLABS_FALLBACK_MODEL}.`);
        config.ttsModel = ELEVENLABS_FALLBACK_MODEL;
        upstream = await call(config.ttsModel);
      } else {
        upstream = new Response(detail, { status: upstream.status });
      }
    }
  } catch (err) {
    clearTimeout(timer);
    if (!controller.signal.aborted) console.error("[alfred] TTS unreachable:", err?.message);
    return sendJson(res, 502, { error: "Não consegui gerar a voz." });
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    const detail = await upstream.text().catch(() => "");
    console.error("[alfred] TTS HTTP", upstream.status, detail.slice(0, 500));
    const hint = ttsFailureHint(upstream.status, detail);
    if (hint) console.error(`   ⚠️  ${hint}`);
    // A refused key, plan or credits will not fix itself: turn the AI voice off until Alfred is
    // opened again, so the window shows this once instead of once per sentence.
    if ([401, 402, 403].includes(upstream.status) || hint) {
      console.error("   A voz de IA foi desligada até reabrir o Alfred; ele fala com a voz do navegador.");
      config.ttsProvider = "";
    }
    return sendJson(res, 502, { error: `A voz de IA falhou (${upstream.status}).` });
  }
  res.writeHead(200, {
    "content-type": upstream.headers.get("content-type") || "audio/mpeg",
    "cache-control": "no-store",
  });
  try {
    for await (const chunk of upstream.body) res.write(chunk);
  } catch (err) {
    if (!controller.signal.aborted) console.error("[alfred] TTS stream error:", err?.message);
  } finally {
    clearTimeout(timer);
    res.end();
  }
}

/** A plain explanation for the black window when the AI voice fails. */
function ttsFailureHint(status, detail) {
  if (config.ttsProvider !== "elevenlabs") return "";
  if (/quota|credit/i.test(detail)) return "Acabaram os créditos do ElevenLabs neste mês. As respostas saem na voz do navegador.";
  if (status === 402 || /paid|subscription|upgrade|library voice|free users/i.test(detail)) {
    return "O ElevenLabs só libera a voz do Fabio (Voice Library) em plano pago. Assine o Starter em elevenlabs.io.";
  }
  if (status === 401 || status === 403) {
    return "O ElevenLabs recusou a chave (ELEVENLABS_API_KEY). Confira se copiou a chave inteira e se ela tem acesso a Text to Speech.";
  }
  return "";
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "JSON inválido ou grande demais." });
  }
  const check = validateChatBody(body);
  if (!check.ok) return sendJson(res, 400, { error: check.error });

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const current = await getBrain();
  if (!brainFound) {
    brainReady = null; // procura de novo na próxima pergunta (ex.: o Claude Code acabou de ser instalado)
    return sendJson(res, 503, {
      error:
        "O Alfred está sem cérebro. Grátis e sem chave: rode o instalador de novo e escolha a opção 1 (IA no seu PC). Ou crie uma chave do Gemini em aistudio.google.com/apikey e coloque em GEMINI_API_KEY no alfred.env. Ou instale o Claude Code (irm https://claude.ai/install.ps1 | iex e depois rode claude para entrar), ou coloque OPENAI_API_KEY no alfred.env. O diagnostico.cmd testa tudo.",
    });
  }
  const stream = streamReply(config, current, check.messages, { signal: controller.signal });
  let first;
  try {
    first = await stream.next();
  } catch (err) {
    // With "auto", look for a brain again next time (e.g. OmniRoute was stopped).
    if (config.brain === "auto") brainReady = null;
    if (!(err instanceof BrainError)) console.error("[alfred] brain error:", err);
    const message = err instanceof BrainError ? err.message : "O cérebro do Alfred falhou.";
    return sendJson(res, 502, { error: message });
  }

  // Re-emit text deltas (and "Pesquisando…" statuses) as a minimal SSE stream for the browser.
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  try {
    for (let step = first; !step.done; step = await stream.next()) {
      const piece = step.value;
      const event = typeof piece === "string" ? { text: piece } : { status: statusLabel(piece.status) };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error("[alfred] stream error:", err?.message);
      const message = err instanceof BrainError ? err.message : "A resposta foi interrompida.";
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    }
  } finally {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && STATIC_FILES[url.pathname]) {
      return await serveStatic(res, STATIC_FILES[url.pathname]);
    }
    const phrase = req.method === "GET" ? PHRASE_FILE.exec(url.pathname) : null;
    if (phrase) return await servePhrase(res, phrase[1]);
    if (req.method === "GET" && url.pathname === "/api/health") {
      await getBrain();
      return sendJson(res, 200, {
        ok: true,
        brain: brain && brainFound ? BRAIN_LABELS[brain] : null,
        brainFound,
        model: { claude: "Claude Code", openai: config.openaiModel, gemini: config.geminiModel, local: config.localModel }[brain] ?? config.model,
        auth: !!config.accessToken,
        tts: config.ttsProvider
          ? { provider: config.ttsProvider, voice: config.ttsVoice, voices: ttsVoices(config), label: ttsLabel(config) }
          : null,
      });
    }
    if (url.pathname.startsWith("/api/") && !isAuthorized(config, req.headers.authorization)) {
      return sendJson(res, 401, { error: "Token de acesso inválido." });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "POST" && url.pathname === "/api/tts") return await handleTts(req, res);
    if (req.method === "GET" && url.pathname === "/api/briefing") {
      // The "bom dia" spoken when Alfred starts: day, time, weather in ALFRED_CITY and headlines.
      return sendJson(res, 200, { text: await briefing({ city: config.city }) });
    }
    sendJson(res, 404, { error: "Não encontrado." });
  } catch (err) {
    console.error("[alfred] unexpected error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Erro interno." });
    else res.end();
  }
});

function lanUrls(port) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => `http://${net.address}:${port}`);
}

async function announceBrain() {
  const found = await getBrain();
  if (!brainFound) {
    console.warn("   ⚠️  Nenhum cérebro funcionando: o site abre, mas não vai responder.");
    console.warn("      1) IA no seu PC (grátis, sem chave): rode o instalador de novo e escolha a opção 1.");
    console.warn("      2) Gemini (grátis): chave em aistudio.google.com/apikey → GEMINI_API_KEY no alfred.env.");
    console.warn("      3) Claude: no PowerShell, irm https://claude.ai/install.ps1 | iex — depois rode `claude` e entre.");
    console.warn("      4) OpenAI: OPENAI_API_KEY no alfred.env.   5) OmniRoute: deixe-o ligado.");
    console.warn("      Para testar tudo: windows\\diagnostico.cmd (ou node cli.mjs --diagnostico).");
    return;
  }
  const detail = {
    omniroute: `OmniRoute em ${config.baseUrl} (modelo "${config.model}")`,
    local: `IA do PC pelo Ollama (modelo "${config.localModel}", grátis, sem internet)`,
    gemini: `Gemini do Google (modelo "${config.geminiModel}", plano grátis, sem internet)`,
    openai: `OpenAI (modelo "${config.openaiModel}")`,
    claude: "Claude, pelo Claude Code instalado neste PC",
  }[found];
  console.log(`   cérebro: ${detail}${config.brain === "auto" ? " — escolhido automaticamente" : ""}`);
  if (found === "omniroute") {
    try {
      const res = await fetch(`${config.baseUrl}/models`, {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) console.log("   ✅ OmniRoute respondendo.");
      else if (res.status === 401 || res.status === 403) {
        console.warn(`   ⚠️  OmniRoute recusou a chave (HTTP ${res.status}) — confira OMNIROUTE_API_KEY.`);
      } else console.warn(`   ⚠️  OmniRoute respondeu HTTP ${res.status} em ${config.baseUrl}/models.`);
    } catch {
      console.warn(`   ⚠️  OmniRoute não respondeu em ${config.baseUrl} — ele está rodando?`);
      console.warn("      Sem ele, use a IA do PC (ALFRED_BRAIN=local), GEMINI_API_KEY (grátis), ALFRED_BRAIN=claude (Claude Code) ou OPENAI_API_KEY.");
    }
  }
}

function startTunnel() {
  const bin = process.env.ALFRED_CLOUDFLARED_BIN || "cloudflared";
  let child;
  try {
    child = spawn(bin, buildTunnelArgs(config.port), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch {
    child = null;
  }
  const missing = () => {
    console.warn("   ⚠️  Não encontrei o cloudflared, que cria o link para o celular. Instale e rode de novo:");
    console.warn("      Windows: winget install Cloudflare.cloudflared · Mac: brew install cloudflared");
    console.warn("      Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  };
  if (!child) return missing();
  let announced = false;
  const watch = (data) => {
    const url = extractTunnelUrl(data);
    if (!url || announced) return;
    announced = true;
    console.log("\n📱 Para falar com o Alfred pelo celular (com microfone), abra este link:");
    console.log(`   ${buildPhoneLink(url, config.accessToken)}`);
    console.log("   O link já leva a senha. Não compartilhe: quem tiver o link fala com o seu Alfred.");
    if (generatedToken) console.log("   (senha gerada só para esta execução — defina ALFRED_TOKEN para fixar uma)\n");
  };
  child.stdout.on("data", watch);
  child.stderr.on("data", watch);
  child.on("error", missing);
  child.on("exit", (code) => {
    if (announced) console.warn(`   ⚠️  O link do celular caiu (cloudflared saiu com código ${code}).`);
  });
  const stop = () => child.exitCode === null && child.kill();
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
  }
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ A porta ${config.port} já está em uso. Use outra: ALFRED_PORT=20141`);
  } else if (err.code === "EACCES" || err.code === "EADDRNOTAVAIL") {
    console.error(`❌ Não consegui escutar em ${config.host}:${config.port} (${err.code}).`);
  } else {
    console.error("❌ Falha ao iniciar o Alfred:", err.message);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const exposed = config.host === "0.0.0.0" || config.host === "::";
  const local = `http://${exposed ? "localhost" : config.host}:${config.port}`;
  console.log(`🎩 Alfred às suas ordens em ${local}`);
  if (exposed) {
    for (const url of lanUrls(config.port)) console.log(`   na rede: ${url}`);
  }
  console.log(
    config.ttsProvider
      ? `   voz de IA: ${ttsLabel(config)} — modelo ${config.ttsModel}`
      : "   voz: a do navegador (defina ELEVENLABS_API_KEY ou OPENAI_API_KEY para a voz de IA)"
  );
  if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.accessToken) {
    console.warn("   ⚠️  Exposto na rede sem ALFRED_TOKEN — defina um token de acesso.");
  }
  announceBrain();
  if (wantTunnel) startTunnel();
});
