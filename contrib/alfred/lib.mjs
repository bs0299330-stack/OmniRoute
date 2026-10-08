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

// Voice direction for TTS models that accept `instructions` (OpenAI gpt-4o-mini-tts).
// An original butler character, not an imitation of any real actor's voice.
export const DEFAULT_TTS_INSTRUCTIONS = [
  "Personagem: um mordomo experiente e refinado, de meia-idade.",
  "Voz: masculina, grave, calma e acolhedora.",
  "Ritmo: fluido e pausado, sem pressa, com pausas naturais nas vírgulas.",
  "Tom: cordial e confiante, com um toque de ironia gentil.",
  "Pronúncia: português do Brasil com sotaque brasileiro natural e dicção clara.",
].join(" ");

export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
// Voices accepted by OpenAI TTS; marin/cedar are the newest, gpt-4o-mini-tts only.
export const OPENAI_TTS_VOICES = Object.freeze([
  "onyx",
  "ash",
  "echo",
  "fable",
  "ballad",
  "sage",
  "verse",
  "cedar",
  "marin",
  "alloy",
  "coral",
  "nova",
  "shimmer",
]);

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
    ...resolveTts(env),
  };
}

/**
 * AI voice: "openai" (direct, OPENAI_API_KEY) or "omniroute" (/v1/audio/speech with
 * ALFRED_TTS_MODEL). Picked automatically unless ALFRED_TTS_PROVIDER says otherwise; "" = off.
 */
export function resolveTts(env = process.env) {
  const openaiKey = env.OPENAI_API_KEY || "";
  let provider = (env.ALFRED_TTS_PROVIDER || "").toLowerCase();
  if (!["openai", "omniroute", "off"].includes(provider)) {
    provider = openaiKey ? "openai" : env.ALFRED_TTS_MODEL ? "omniroute" : "";
  }
  if (provider === "off" || (provider === "openai" && !openaiKey)) provider = "";
  if (provider === "omniroute" && !env.ALFRED_TTS_MODEL) provider = "";
  const model = env.ALFRED_TTS_MODEL || (provider === "openai" ? "gpt-4o-mini-tts" : "");
  return {
    ttsProvider: provider,
    ttsModel: provider ? model : "",
    ttsVoice: env.ALFRED_TTS_VOICE || "onyx",
    ttsSpeed: parseNumber(env.ALFRED_TTS_SPEED, 1, 0.25, 4),
    ttsInstructions: env.ALFRED_TTS_INSTRUCTIONS || DEFAULT_TTS_INSTRUCTIONS,
    openaiKey,
  };
}

/** Voices the page may pick from (empty list = only the configured voice). */
export function ttsVoices(config) {
  if (config.ttsProvider !== "openai") return [];
  const voices = [...OPENAI_TTS_VOICES];
  if (!voices.includes(config.ttsVoice)) voices.unshift(config.ttsVoice);
  return voices;
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

/** Validates `{ text, voice? }` for /api/tts; an unknown voice falls back to the configured one. */
export function validateTtsBody(body, config) {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "Campo 'text' é obrigatório." };
  if (text.length > MAX_TTS_CHARS) {
    return { ok: false, error: `Texto longo demais (máx. ${MAX_TTS_CHARS} caracteres).` };
  }
  const voice = ttsVoices(config).includes(body?.voice) ? body.voice : config.ttsVoice;
  return { ok: true, text, voice };
}

/** URL, headers and body for one TTS call. */
export function buildTtsRequest(config, text, voice = config.ttsVoice) {
  const steerable = /gpt-4o.*tts/i.test(config.ttsModel);
  const body = {
    model: config.ttsModel,
    input: text,
    voice,
    response_format: "mp3",
    // gpt-4o-mini-tts takes its pace from `instructions`; tts-1/tts-1-hd take `speed`.
    ...(steerable ? { instructions: config.ttsInstructions } : { speed: config.ttsSpeed }),
  };
  if (config.ttsProvider === "openai") {
    return { url: OPENAI_TTS_URL, apiKey: config.openaiKey, body };
  }
  return { url: `${config.baseUrl}/audio/speech`, apiKey: config.apiKey, body };
}

export function isAuthorized(config, headerValue) {
  if (!config.accessToken) return true;
  return headerValue === `Bearer ${config.accessToken}`;
}
