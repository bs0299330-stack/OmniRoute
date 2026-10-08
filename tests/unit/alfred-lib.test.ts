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
  assert.equal(req.apiKey, "sk-test");
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
  assert.equal(req.apiKey, "omni");
  assert.equal(req.body.speed, 1.1);
  assert.equal(req.body.instructions, undefined);
  assert.equal(loadConfig({ ALFRED_TTS_PROVIDER: "omniroute" }).ttsProvider, "", "no model → off");
});
