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
export const MAX_TTS_CHARS = 1000;

// Voice direction for TTS models that accept `instructions` (e.g. OpenAI gpt-4o-mini-tts).
// An original butler character, not an imitation of any real actor's voice.
export const DEFAULT_TTS_INSTRUCTIONS = [
  "Fale em português do Brasil como um mordomo inglês experiente e refinado: voz grave,",
  "calma e acolhedora, ritmo pausado, dicção impecável e um toque de ironia gentil.",
].join(" ");

function parseNumber(value, fallback, min, max) {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

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
    // Neural voice through OmniRoute /v1/audio/speech — off unless a model is set.
    ttsModel: env.ALFRED_TTS_MODEL || "",
    ttsVoice: env.ALFRED_TTS_VOICE || "onyx",
    ttsSpeed: parseNumber(env.ALFRED_TTS_SPEED, 1, 0.25, 4),
    ttsInstructions: env.ALFRED_TTS_INSTRUCTIONS || DEFAULT_TTS_INSTRUCTIONS,
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

/** Validates `{ text }` for /api/tts. */
export function validateTtsBody(body) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "Campo 'text' é obrigatório." };
  if (text.length > MAX_TTS_CHARS) {
    return { ok: false, error: `Texto longo demais (máx. ${MAX_TTS_CHARS} caracteres).` };
  }
  return { ok: true, text };
}

export function buildTtsRequest(config, text) {
  return {
    model: config.ttsModel,
    input: text,
    voice: config.ttsVoice,
    response_format: "mp3",
    speed: config.ttsSpeed,
    instructions: config.ttsInstructions,
  };
}

export function isAuthorized(config, headerValue) {
  if (!config.accessToken) return true;
  return headerValue === `Bearer ${config.accessToken}`;
}
