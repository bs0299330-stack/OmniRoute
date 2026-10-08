#!/usr/bin/env node
// Alfred — voice assistant web server. Zero dependencies (Node >= 22).
// Serves the web UI and proxies chat to OmniRoute so the API key never reaches the browser.
//
//   node contrib/alfred/server.mjs        → http://127.0.0.1:20130

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChatRequest,
  createSseParser,
  isAuthorized,
  loadConfig,
  validateChatBody,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 512 * 1024;
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

async function serveIndex(res) {
  const html = await readFile(join(HERE, "public", "index.html"));
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
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
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
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
    if (req.method === "GET" && url.pathname === "/") return await serveIndex(res);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, model: config.model, auth: !!config.accessToken });
    }
    if (url.pathname.startsWith("/api/") && !isAuthorized(config, req.headers.authorization)) {
      return sendJson(res, 401, { error: "Token de acesso inválido." });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    sendJson(res, 404, { error: "Não encontrado." });
  } catch (err) {
    console.error("[alfred] unexpected error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Erro interno." });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`🎩 Alfred às suas ordens em http://${config.host}:${config.port}`);
  console.log(`   cérebro: ${config.baseUrl} (modelo "${config.model}")`);
  if (config.host !== "127.0.0.1" && !config.accessToken) {
    console.warn("   ⚠️  Exposto na rede sem ALFRED_TOKEN — defina um token de acesso.");
  }
});
