import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_HISTORY_MESSAGES,
  buildChatRequest,
  createSseParser,
  isAuthorized,
  loadConfig,
  validateChatBody,
} from "../../contrib/alfred/lib.mjs";

test("loadConfig applies defaults", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 20140);
  assert.equal(config.baseUrl, "http://localhost:20128/v1");
  assert.equal(config.model, "auto");
  assert.equal(config.systemPrompt, DEFAULT_SYSTEM_PROMPT);
});

test("loadConfig reads env, strips trailing slash and rejects bad ports", () => {
  const config = loadConfig({
    OMNIROUTE_URL: "http://box:1234/v1///",
    ALFRED_PORT: "99999",
    ALFRED_MODEL: "auto/fast",
  });
  assert.equal(config.baseUrl, "http://box:1234/v1");
  assert.equal(config.port, 20140);
  assert.equal(config.model, "auto/fast");
  assert.equal(loadConfig({ ALFRED_PORT: "8080" }).port, 8080);
});

test("validateChatBody rejects malformed payloads", () => {
  assert.equal(validateChatBody(null).ok, false);
  assert.equal(validateChatBody({ messages: [] }).ok, false);
  assert.equal(validateChatBody({ messages: [{ role: "system", content: "x" }] }).ok, false);
  assert.equal(validateChatBody({ messages: [{ role: "user", content: "  " }] }).ok, false);
  assert.equal(
    validateChatBody({
      messages: [
        { role: "user", content: "oi" },
        { role: "assistant", content: "olá" },
      ],
    }).ok,
    false
  );
});

test("validateChatBody trims history to the most recent messages", () => {
  const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
  messages.push({ role: "user", content: "última" });
  const result = validateChatBody({ messages });
  assert.equal(result.ok, true);
  assert.equal(result.messages.length, MAX_HISTORY_MESSAGES);
  assert.equal(result.messages.at(-1).content, "última");
});

test("buildChatRequest prepends the system prompt with date and user name", () => {
  const config = loadConfig({ ALFRED_USER_NAME: "Bruce" });
  const req = buildChatRequest(config, [{ role: "user", content: "oi" }], new Date(2026, 0, 1));
  assert.equal(req.model, "auto");
  assert.equal(req.stream, true);
  assert.equal(req.messages[0].role, "system");
  assert.match(req.messages[0].content, /Alfred/);
  assert.match(req.messages[0].content, /Bruce/);
  assert.match(req.messages[0].content, /2026/);
  assert.deepEqual(req.messages[1], { role: "user", content: "oi" });
});

test("createSseParser handles deltas split across chunks and [DONE]", () => {
  const feed = createSseParser();
  const a = feed('data: {"choices":[{"delta":{"content":"Bom "}}]}\n\ndata: {"choi');
  assert.deepEqual(a, { deltas: ["Bom "], done: false });
  const b = feed('ces":[{"delta":{"content":"dia"}}]}\n\n: keep-alive\ndata: [DONE]\n\n');
  assert.deepEqual(b, { deltas: ["dia"], done: true });
});

test("isAuthorized only enforces when a token is configured", () => {
  assert.equal(isAuthorized(loadConfig({}), undefined), true);
  const config = loadConfig({ ALFRED_TOKEN: "s3cret" });
  assert.equal(isAuthorized(config, undefined), false);
  assert.equal(isAuthorized(config, "Bearer nope"), false);
  assert.equal(isAuthorized(config, "Bearer s3cret"), true);
});

test("AI voice: off by default, OpenAI direct when OPENAI_API_KEY is set", async () => {
  const { buildTtsRequest, validateTtsBody, ttsVoices, MAX_TTS_CHARS, DEFAULT_TTS_INSTRUCTIONS, OPENAI_TTS_URL } =
    await import("../../contrib/alfred/lib.mjs");

  assert.equal(loadConfig({}).ttsProvider, "");
  assert.equal(loadConfig({ ALFRED_TTS_PROVIDER: "openai" }).ttsProvider, "", "no key → off");

  const config = loadConfig({ OPENAI_API_KEY: "sk-test", OMNIROUTE_API_KEY: "omni" });
  assert.equal(config.ttsProvider, "openai");
  assert.equal(config.ttsModel, "gpt-4o-mini-tts");
  assert.equal(config.ttsVoice, "onyx");
  assert.ok(ttsVoices(config).includes("cedar"));

  const req = buildTtsRequest(config, "Pois não.", "ash");
  assert.equal(req.url, OPENAI_TTS_URL);
  assert.equal(req.headers.authorization, "Bearer sk-test");
  assert.deepEqual(req.body, {
    model: "gpt-4o-mini-tts",
    input: "Pois não.",
    voice: "ash",
    response_format: "mp3",
    instructions: DEFAULT_TTS_INSTRUCTIONS,
  });

  assert.equal(validateTtsBody({}, config).ok, false);
  assert.equal(validateTtsBody({ text: "x".repeat(MAX_TTS_CHARS + 1) }, config).ok, false);
  assert.deepEqual(validateTtsBody({ text: "  Olá  ", voice: "echo" }, config), {
    ok: true,
    text: "Olá",
    voice: "echo",
  });
  assert.equal(validateTtsBody({ text: "Olá", voice: "../../etc" }, config).voice, "onyx");
});

test("AI voice through OmniRoute uses its key and speed for tts-1 models", async () => {
  const { buildTtsRequest, ttsVoices } = await import("../../contrib/alfred/lib.mjs");
  const config = loadConfig({
    OMNIROUTE_URL: "http://box:20128/v1",
    OMNIROUTE_API_KEY: "omni",
    ALFRED_TTS_MODEL: "openai/tts-1-hd",
    ALFRED_TTS_SPEED: "1.1",
  });
  assert.equal(config.ttsProvider, "omniroute");
  assert.deepEqual(ttsVoices(config), []);
  const req = buildTtsRequest(config, "Olá");
  assert.equal(req.url, "http://box:20128/v1/audio/speech");
  assert.equal(req.headers.authorization, "Bearer omni");
  assert.equal(req.body.speed, 1.1);
  assert.equal(req.body.instructions, undefined);
  assert.equal(loadConfig({ ALFRED_TTS_PROVIDER: "omniroute" }).ttsProvider, "", "no model → off");
});

test("ElevenLabs voice: the Fabio voice by default, preferred over OpenAI, key in xi-api-key", async () => {
  const { buildTtsRequest, ttsLabel, ttsVoices, validateTtsBody, ELEVENLABS_DEFAULT_VOICE } = await import(
    "../../contrib/alfred/lib.mjs"
  );
  const config = loadConfig({ ELEVENLABS_API_KEY: "sk_eleven", OPENAI_API_KEY: "sk-openai" });
  assert.equal(config.ttsProvider, "elevenlabs");
  assert.equal(config.ttsVoice, ELEVENLABS_DEFAULT_VOICE);
  assert.equal(config.ttsModel, "eleven_v4_turbo");
  assert.equal(ttsLabel(config), "Fabio (ElevenLabs)");
  assert.deepEqual(ttsVoices(config), [], "only the configured voice");
  assert.equal(validateTtsBody({ text: "Oi", voice: "onyx" }, config).voice, ELEVENLABS_DEFAULT_VOICE);
  const req = buildTtsRequest(config, "Pois não, senhor.");
  assert.equal(req.url, `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE}?output_format=mp3_44100_128`);
  assert.equal(req.headers["xi-api-key"], "sk_eleven");
  assert.equal(req.headers.authorization, undefined, "the ElevenLabs key never goes to another header");
  assert.equal(req.body.text, "Pois não, senhor.");
  assert.equal(req.body.model_id, "eleven_v4_turbo");
  assert.equal(req.pcmRate, 0);
  const wav = buildTtsRequest(config, "Oi", undefined, "wav", "eleven_flash_v2_5");
  assert.match(wav.url, /output_format=pcm_24000$/, "WAV needs a higher plan: raw PCM, wrapped locally");
  assert.equal(wav.pcmRate, 24000);
  assert.equal(wav.body.model_id, "eleven_flash_v2_5");
  // forced OpenAI, odd values ignored
  assert.equal(loadConfig({ ELEVENLABS_API_KEY: "k", OPENAI_API_KEY: "o", ALFRED_TTS_PROVIDER: "openai" }).ttsProvider, "openai");
  assert.equal(loadConfig({ ALFRED_TTS_PROVIDER: "elevenlabs" }).ttsProvider, "", "no key → off");
  const odd = loadConfig({ ELEVENLABS_API_KEY: "k", ALFRED_ELEVENLABS_VOICE: "../x", ALFRED_ELEVENLABS_MODEL: "a b" });
  assert.equal(odd.ttsVoice, ELEVENLABS_DEFAULT_VOICE);
  assert.equal(odd.ttsModel, "eleven_v4_turbo");
  assert.equal(loadConfig({ ELEVENLABS_API_KEY: "k", ALFRED_TTS_SPEED: "3" }).ttsSpeed, 1, "ElevenLabs speed is 0.7–1.2");
});

test("pcmToWav writes a valid 16-bit mono WAV header", async () => {
  const { pcmToWav } = await import("../../contrib/alfred/lib.mjs");
  const wav = pcmToWav(Buffer.alloc(480), 24000);
  assert.equal(wav.length, 44 + 480);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 480);
});
