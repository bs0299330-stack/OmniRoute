#!/usr/bin/env node
// Alfred — voice assistant web server. Zero dependencies (Node >= 22).
// Serves the web UI and proxies chat to OmniRoute so the API key never reaches the browser.
//
//   node contrib/alfred/server.mjs        → http://127.0.0.1:20140
//
// Settings come from the environment, plus contrib/alfred/alfred.env when it exists.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChatRequest,
  buildTtsRequest,
  createSseParser,
  isAuthorized,
  loadConfig,
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
};

async function serveStatic(res, [file, type]) {
  const body = await readFile(join(HERE, "public", file));
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function omniHeaders() {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  };
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

  const tts = buildTtsRequest(config, check.text, check.voice);
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const timer = setTimeout(() => controller.abort(), 30000);
  let upstream;
  try {
    upstream = await fetch(tts.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(tts.apiKey ? { authorization: `Bearer ${tts.apiKey}` } : {}),
      },
      body: JSON.stringify(tts.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (!controller.signal.aborted) console.error("[alfred] TTS unreachable:", err?.message);
    return sendJson(res, 502, { error: "Não consegui gerar a voz." });
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    console.error("[alfred] TTS HTTP", upstream.status, await upstream.text().catch(() => ""));
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

  let upstream;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: omniHeaders(),
      body: JSON.stringify(buildChatRequest(config, check.messages)),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("[alfred] OmniRoute unreachable:", err?.message);
    return sendJson(res, 502, {
      error: "Não consegui falar com o OmniRoute. Ele está rodando?",
    });
  }

  if (!upstream.ok || !upstream.body) {
    console.error("[alfred] OmniRoute HTTP", upstream.status, await upstream.text().catch(() => ""));
    return sendJson(res, 502, { error: `O OmniRoute respondeu com erro (${upstream.status}).` });
  }

  // Re-emit only the text deltas as a minimal SSE stream for the browser.
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const parse = createSseParser();
  const decoder = new TextDecoder();
  try {
    for await (const chunk of upstream.body) {
      const { deltas } = parse(decoder.decode(chunk, { stream: true }));
      for (const text of deltas) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error("[alfred] stream error:", err?.message);
      res.write(`data: ${JSON.stringify({ error: "A resposta foi interrompida." })}\n\n`);
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
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        model: config.model,
        auth: !!config.accessToken,
        tts: config.ttsProvider
          ? { provider: config.ttsProvider, voice: config.ttsVoice, voices: ttsVoices(config) }
          : null,
      });
    }
    if (url.pathname.startsWith("/api/") && !isAuthorized(config, req.headers.authorization)) {
      return sendJson(res, 401, { error: "Token de acesso inválido." });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "POST" && url.pathname === "/api/tts") return await handleTts(req, res);
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

async function checkOmniRoute() {
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
    console.warn("      A página abre mesmo assim, mas as perguntas vão falhar até ele subir.");
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
  console.log(`   cérebro: ${config.baseUrl} (modelo "${config.model}")`);
  console.log(
    config.ttsProvider
      ? `   voz de IA: ${config.ttsProvider === "openai" ? "OpenAI" : "OmniRoute"} ${config.ttsModel} (voz "${config.ttsVoice}")`
      : "   voz: a do navegador (defina OPENAI_API_KEY para a voz de IA)"
  );
  if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.accessToken) {
    console.warn("   ⚠️  Exposto na rede sem ALFRED_TOKEN — defina um token de acesso.");
  }
  checkOmniRoute();
});
