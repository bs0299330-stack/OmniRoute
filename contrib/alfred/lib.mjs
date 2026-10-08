// Alfred — pure helpers (config, prompt building, validation, SSE parsing).
// Kept free of I/O so they can be unit-tested without a server or network.

export const DEFAULT_SYSTEM_PROMPT = [
  "Você é Alfred, um mordomo e assistente virtual pessoal: educado, prestativo, discreto",
  "e com um leve humor britânico. Responda sempre em português do Brasil, a menos que o",
  "usuário fale em outro idioma. Suas respostas são lidas em voz alta, então seja",
  "conciso (de 1 a 4 frases, salvo quando pedirem detalhes), evite markdown, listas",
  "longas, emojis e blocos de código, e nunca invente fatos — diga quando não souber.",
].join(" ");

// 20130 is taken by the 9Router embedded service and the Kiro MITM proxy.
export const DEFAULT_PORT = 20140;
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8000;

function parsePort(value, fallback) {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

export function loadConfig(env = process.env) {
  const baseUrl = (env.OMNIROUTE_URL || "http://localhost:20128/v1").replace(/\/+$/, "");
  return {
    host: env.ALFRED_HOST || "127.0.0.1",
    port: parsePort(env.ALFRED_PORT, DEFAULT_PORT),
    baseUrl,
    apiKey: env.OMNIROUTE_API_KEY || "",
    model: env.ALFRED_MODEL || "auto",
    accessToken: env.ALFRED_TOKEN || "",
    userName: env.ALFRED_USER_NAME || "",
    systemPrompt: env.ALFRED_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
  };
}

export function buildSystemPrompt(config, now = new Date()) {
  const when = now.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  const parts = [config.systemPrompt, `Data e hora atuais: ${when}.`];
  if (config.userName) parts.push(`O nome do seu patrão é ${config.userName}.`);
  return parts.join(" ");
}

/**
 * Validates the browser payload `{ messages: [{ role, content }] }`.
 * Returns `{ ok: true, messages }` (trimmed to the most recent history) or `{ ok: false, error }`.
 */
export function validateChatBody(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    return { ok: false, error: "Campo 'messages' (array) é obrigatório." };
  }
  if (body.messages.length === 0) {
    return { ok: false, error: "'messages' não pode ser vazio." };
  }
  const messages = [];
  for (const msg of body.messages) {
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) {
      return { ok: false, error: "Cada mensagem precisa de role 'user' ou 'assistant'." };
    }
    if (typeof msg.content !== "string" || msg.content.trim() === "") {
      return { ok: false, error: "Cada mensagem precisa de 'content' em texto." };
    }
    messages.push({ role: msg.role, content: msg.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  if (messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "A última mensagem deve ser do usuário." };
  }
  return { ok: true, messages: messages.slice(-MAX_HISTORY_MESSAGES) };
}

export function buildChatRequest(config, messages, now = new Date()) {
  return {
    model: config.model,
    stream: true,
    messages: [{ role: "system", content: buildSystemPrompt(config, now) }, ...messages],
  };
}

/**
 * Incremental parser for OpenAI-style SSE (`data: {...}` lines).
 * Feed raw text chunks; returns the text deltas found and whether `[DONE]` was seen.
 */
export function createSseParser() {
  let buffer = "";
  return function feed(chunk) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const deltas = [];
    let done = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        continue;
      }
      try {
        const json = JSON.parse(data);
        const text = json?.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) deltas.push(text);
      } catch {
        // Ignore keep-alive comments or partial/non-JSON lines.
      }
    }
    return { deltas, done };
  };
}

export function isAuthorized(config, headerValue) {
  if (!config.accessToken) return true;
  return headerValue === `Bearer ${config.accessToken}`;
}
