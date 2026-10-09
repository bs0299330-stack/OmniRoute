import test from "node:test";
import assert from "node:assert/strict";

import {
  OPENAI_CHAT_URL,
  buildChatCall,
  buildClaudeCommand,
  buildClaudePrompt,
  buildPhoneLink,
  buildTunnelArgs,
  extractTunnelUrl,
  isAuthorized,
  loadConfig,
  parseClaudeLine,
  soxRecordArgs,
} from "../../contrib/alfred/lib.mjs";
import { build, inlineModule } from "../../contrib/alfred/claude/build.mjs";

const history = [
  { role: "user", content: "Oi" },
  { role: "assistant", content: "Boa noite." },
  { role: "user", content: 'Que horas são? "agora" & já' },
];

test("brain defaults to auto and validates ALFRED_BRAIN", () => {
  assert.equal(loadConfig({}).brain, "auto");
  assert.equal(loadConfig({ ALFRED_BRAIN: "claude" }).brain, "claude");
  assert.equal(loadConfig({ ALFRED_BRAIN: "rm -rf" }).brain, "auto");
  assert.equal(loadConfig({ ALFRED_CLAUDE_MODEL: "sonnet" }).claudeModel, "sonnet");
  assert.equal(loadConfig({ ALFRED_CLAUDE_MODEL: "x & calc" }).claudeModel, "", "unsafe model ignored");
});

test("OpenAI brain targets the OpenAI API with its own model and key", () => {
  const config = loadConfig({ OPENAI_API_KEY: "sk-test", ALFRED_OPENAI_MODEL: "gpt-4.1-mini" });
  const call = buildChatCall(loadConfig({ OPENAI_API_KEY: "sk-test", ALFRED_OPENAI_MODEL: "gpt-4.1-mini", ALFRED_WEB: "off" }), "openai", history);
  assert.equal(call.url, OPENAI_CHAT_URL);
  assert.equal(call.apiKey, "sk-test");
  assert.equal(call.body.model, "gpt-4.1-mini");
  assert.equal(call.body.web_search_options, undefined);
  const web = buildChatCall(config, "openai", history);
  assert.equal(web.body.model, "gpt-5-search-api");
  assert.equal(web.body.web_search_options.user_location.approximate.country, "BR");
  assert.equal(web.body.temperature, undefined, "search models reject temperature");
  assert.match(web.body.messages[0].content, /acesso à internet/);
  assert.equal(call.body.stream, true);
  const omni = buildChatCall(loadConfig({ OMNIROUTE_API_KEY: "omni" }), "omniroute", history);
  assert.equal(omni.url, "http://localhost:20128/v1/chat/completions");
  assert.equal(omni.apiKey, "omni");
  assert.doesNotMatch(omni.body.messages[0].content, /acesso à internet/, "plain models do not claim web access");
  const sonar = buildChatCall(loadConfig({ ALFRED_MODEL: "perplexity/sonar" }), "omniroute", history);
  assert.match(sonar.body.messages[0].content, /acesso à internet/);
});

test("Claude Code command: only the web tools, pre-approved; persona in args only off Windows", () => {
  const config = loadConfig({});
  const posix = buildClaudeCommand(config, "linux");
  assert.equal(posix.shell, false);
  assert.deepEqual(posix.args.slice(0, 10), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--tools",
    "WebSearch,WebFetch",
    "--allowedTools",
    "WebSearch,WebFetch",
  ]);
  const persona = posix.args[posix.args.indexOf("--system-prompt") + 1];
  assert.match(persona, /acesso à internet/);
  const searchOnly = buildClaudeCommand(loadConfig({ ALFRED_WEB: "search" }), "linux");
  assert.equal(searchOnly.args[searchOnly.args.indexOf("--tools") + 1], "WebSearch");
  const off = buildClaudeCommand(loadConfig({ ALFRED_WEB: "off" }), "linux");
  assert.equal(off.args[off.args.indexOf("--tools") + 1], "");
  assert.ok(!off.args.includes("--allowedTools"));
  assert.doesNotMatch(off.args[off.args.indexOf("--system-prompt") + 1], /acesso à internet/);

  const win = buildClaudeCommand(config, "win32");
  assert.equal(win.shell, true);
  assert.equal(win.personaInArgs, false);
  assert.ok(!win.args.includes("--system-prompt"), "nothing free-form reaches cmd.exe");
  for (const arg of win.args) assert.match(arg, /^("[\w,]*"|[\w\-:.]*)$/, arg);
  assert.equal(win.args[win.args.indexOf("--tools") + 1], '"WebSearch,WebFetch"');
});

test("Claude prompt carries the history and the new message (user text only via stdin)", () => {
  const config = loadConfig({ ALFRED_USER_NAME: "Bruce" });
  const withPersona = buildClaudePrompt(config, history, { personaInArgs: false });
  assert.match(withPersona, /Você é Alfred/);
  assert.match(withPersona, /Bruce/);
  assert.match(withPersona, /Usuário: Oi\nAlfred: Boa noite\./);
  assert.match(withPersona, /Nova mensagem do usuário: Que horas são\? "agora" & já/);
  const bare = buildClaudePrompt(config, history, { personaInArgs: true });
  assert.doesNotMatch(bare, /Você é Alfred/);
});

test("parseClaudeLine reads text deltas, the result and ignores the rest", () => {
  const delta = JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Pois não" } },
  });
  assert.deepEqual(parseClaudeLine(delta), { text: "Pois não" });
  assert.deepEqual(parseClaudeLine('{"type":"result","subtype":"success","is_error":false}'), { done: true });
  assert.ok(parseClaudeLine('{"type":"result","subtype":"error_during_execution","is_error":true}').error);
  assert.equal(parseClaudeLine('{"type":"system","subtype":"init"}'), null);
  assert.equal(parseClaudeLine("not json"), null);
});

test("sox records mono 16 kHz and stops on silence", () => {
  const args = soxRecordArgs("/tmp/x.wav");
  assert.deepEqual(args.slice(0, 2), ["-q", "-d"]);
  assert.ok(args.includes("/tmp/x.wav"));
  assert.ok(args.includes("silence"));
  assert.deepEqual(args.slice(-3), ["trim", "0", "60"]);
});

test("artifact build inlines the stylesheet and modules", () => {
  const files = {
    "hud.css": ".a{color:red}",
    "voice.mjs": "export const A = 1;\nexport function b() { return A; }\nconst hidden = 2;",
    "hud.mjs": "export const C = 3;",
  };
  const html = [
    "<title>T</title>",
    '<link rel="stylesheet" href="hud.css" />',
    '<script type="module">',
    '  import { A, b } from "./voice.mjs";',
    '  import { C } from "./hud.mjs";',
    "  console.log(A, b(), C);",
    "</script>",
  ].join("\n");
  const out = build(html, (file) => files[file]);
  assert.match(out, /<style>\n\.a\{color:red\}\n<\/style>/);
  assert.match(out, /const \{ A, b \} = __voice;/);
  assert.match(out, /return \{ A, b \};/);
  assert.doesNotMatch(out, /from "\.\//);
  assert.doesNotMatch(out, /^export /m);
  assert.throws(() => inlineModule("x", 'import y from "./y.mjs";'));
});

test("phone tunnel: cloudflared quick tunnel, URL parsing and token in the fragment", () => {
  assert.deepEqual(buildTunnelArgs(20140), ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:20140"]);
  const log = "2026-10-08T21:50:01Z INF |  https://brave-alfred-1234.trycloudflare.com  |";
  assert.equal(extractTunnelUrl(log), "https://brave-alfred-1234.trycloudflare.com");
  assert.equal(extractTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com..."), null);
  assert.equal(
    buildPhoneLink("https://x.trycloudflare.com", "a+b/c"),
    "https://x.trycloudflare.com/#token=a%2Bb%2Fc"
  );
});

test("isAuthorized compares the bearer token exactly", () => {
  const config = loadConfig({ ALFRED_TOKEN: "s3cret" });
  assert.equal(isAuthorized(config, "Bearer s3cret"), true);
  assert.equal(isAuthorized(config, "Bearer s3cre"), false);
  assert.equal(isAuthorized(config, "Bearer s3cretX"), false);
  assert.equal(isAuthorized(config, undefined), false);
});

test("Windows installer downloads every Alfred file", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const root = "contrib/alfred";
  const listed = [
    ...readFileSync(join(root, "windows/instalar.ps1"), "utf8")
      .split("$Files = @(")[1]
      .split(")")[0]
      .matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(root, path).replaceAll("\\", "/")];
    });
  const expected = walk(root)
    .filter((f) => !f.startsWith("claude/dist/") && !f.startsWith(".") && f !== "alfred.env")
    .sort();
  assert.deepEqual([...listed].sort(), expected);
});

test("Claude Code lookup: PATH first, then the native installer's claude.exe (run without cmd.exe)", async () => {
  const { claudeCandidates } = await import("../../contrib/alfred/lib.mjs");
  const config = loadConfig({});
  assert.deepEqual(claudeCandidates(config, "win32", { USERPROFILE: "C:\\Users\\Ana" }), [
    "claude",
    "C:\\Users\\Ana\\.local\\bin\\claude.exe",
  ]);
  assert.deepEqual(claudeCandidates(config, "linux", { HOME: "/home/ana" }), ["claude", "/home/ana/.local/bin/claude"]);
  assert.deepEqual(claudeCandidates(loadConfig({ ALFRED_CLAUDE_BIN: "/opt/c" }), "linux", {}), ["/opt/c"]);
  const exe = buildClaudeCommand(config, "win32", "C:\\Users\\Ana\\.local\\bin\\claude.exe");
  assert.equal(exe.shell, false);
  assert.equal(exe.personaInArgs, true);
  assert.equal(exe.args[exe.args.indexOf("--tools") + 1], "WebSearch,WebFetch");
  const exeOff = buildClaudeCommand(loadConfig({ ALFRED_WEB: "off" }), "win32", "C:\\x\\claude.exe");
  assert.equal(exeOff.args[exeOff.args.indexOf("--tools") + 1], "", "empty --tools value passed directly");
});

test("parseClaudeLine keeps the error detail (e.g. not logged in)", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" });
  assert.deepEqual(parseClaudeLine(line), {
    error: "O Claude Code não conseguiu responder.",
    detail: "Invalid API key · Please run /login",
  });
});

test("streamReply gives up with a clear message when the brain never answers", async () => {
  const { createServer } = await import("node:http");
  const { streamReply, BrainError } = await import("../../contrib/alfred/brain.mjs");
  const hanging = createServer(() => {}); // accepts the request and never answers
  await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", () => resolve()));
  const { port } = hanging.address() as { port: number };
  process.env.ALFRED_QUIET = "1";
  const config = loadConfig({ OMNIROUTE_URL: `http://127.0.0.1:${port}/v1` });
  const started = Date.now();
  try {
    await assert.rejects(
      async () => {
        for await (const _ of streamReply(config, "omniroute", [{ role: "user", content: "oi" }], { idleMs: 300 })) {
          // no text expected
        }
      },
      (err: unknown) => err instanceof BrainError && /sem responder/.test((err as Error).message)
    );
    assert.ok(Date.now() - started < 5000);
  } finally {
    hanging.closeAllConnections();
    hanging.close();
  }
});

test("Claude stream parser reports web searches and page reads", async () => {
  const { createClaudeStreamParser, statusLabel } = await import("../../contrib/alfred/lib.mjs");
  const feed = createClaudeStreamParser();
  const ev = (event: object) => JSON.stringify({ type: "stream_event", event });
  assert.equal(feed(ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "WebSearch", input: {} } })), null);
  assert.equal(feed(ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query": "cotação ' } })), null);
  feed(ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'do dólar hoje"}' } }));
  const search = feed(ev({ type: "content_block_stop", index: 0 }));
  assert.deepEqual(search, { status: { tool: "search", detail: "cotação do dólar hoje" } });
  assert.equal(statusLabel(search.status), "Pesquisando: cotação do dólar hoje");
  feed(ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "WebFetch", input: {} } }));
  feed(ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"url":"https://www.g1.globo.com/economia","prompt":"x"}' } }));
  const read = feed(ev({ type: "content_block_stop", index: 1 }));
  assert.equal(statusLabel(read.status), "Lendo g1.globo.com");
  assert.deepEqual(feed(ev({ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Segundo o G1" } })), {
    text: "Segundo o G1",
  });
  assert.equal(feed(ev({ type: "content_block_stop", index: 2 })), null, "a text block stop is not a status");
});

test("Gemini brain: free key, OpenAI-compatible endpoint, no web, quick thinking", async () => {
  const { GEMINI_BASE_URL } = await import("../../contrib/alfred/lib.mjs");
  assert.equal(loadConfig({ ALFRED_BRAIN: "gemini" }).brain, "gemini");
  assert.equal(loadConfig({ GOOGLE_API_KEY: "g" }).geminiKey, "g", "GOOGLE_API_KEY also works");
  const call = buildChatCall(loadConfig({ GEMINI_API_KEY: "AIza-test" }), "gemini", history);
  assert.equal(call.url, `${GEMINI_BASE_URL}/chat/completions`);
  assert.equal(call.apiKey, "AIza-test");
  assert.equal(call.body.model, "gemini-flash-latest");
  assert.equal(call.body.reasoning_effort, "low");
  assert.equal(call.body.stream, true);
  assert.equal(call.body.web_search_options, undefined);
  assert.doesNotMatch(call.body.messages[0].content, /Você tem acesso à internet/);
  assert.match(call.body.messages[0].content, /não tem acesso à internet/);
  assert.equal(buildChatCall(loadConfig({ ALFRED_GEMINI_MODEL: "gemini-3.8-flash" }), "gemini", history).body.model, "gemini-3.8-flash");
});

test("auto brain prefers the free Gemini over OpenAI and Claude when OmniRoute is off", async () => {
  const { detectBrainInfo } = await import("../../contrib/alfred/brain.mjs");
  // nothing listens on the discard port, so neither OmniRoute nor a local Ollama answers
  const off = { OMNIROUTE_URL: "http://127.0.0.1:9/v1", ALFRED_LOCAL_URL: "http://127.0.0.1:9/v1" };
  assert.deepEqual(await detectBrainInfo(loadConfig({ ...off, GEMINI_API_KEY: "g", OPENAI_API_KEY: "sk" })), {
    brain: "gemini",
    found: true,
  });
  assert.equal((await detectBrainInfo(loadConfig({ ...off, OPENAI_API_KEY: "sk" }))).brain, "openai");
  assert.equal((await detectBrainInfo(loadConfig({ ...off, ALFRED_BRAIN: "claude", GEMINI_API_KEY: "g" }))).brain, "claude");
});

test("Gemini brain streams text and explains the free-tier limit and a bad key", async () => {
  const { createServer } = await import("node:http");
  const { streamReply, BrainError } = await import("../../contrib/alfred/brain.mjs");
  const seen: { auth?: string; body?: { model: string } }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      const key = req.headers.authorization;
      if (key === "Bearer limit") {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
      }
      if (key === "Bearer bad") {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end('{"error":{"message":"API key not valid. Please pass a valid API key."}}');
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Boa noite, "}}]}\n\n');
      res.end('data: {"choices":[{"delta":{"content":"senhor."}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  process.env.ALFRED_QUIET = "1";
  const configFor = (key: string) => loadConfig({ GEMINI_API_KEY: key, ALFRED_GEMINI_URL: `http://127.0.0.1:${port}/` });
  const collect = async (key: string) => {
    let text = "";
    for await (const piece of streamReply(configFor(key), "gemini", [{ role: "user", content: "oi" }])) text += piece;
    return text;
  };
  try {
    assert.equal(await collect("good"), "Boa noite, senhor.");
    assert.equal(seen[0].auth, "Bearer good");
    assert.equal(seen[0].body?.model, "gemini-flash-latest");
    await assert.rejects(collect("limit"), (err: unknown) => err instanceof BrainError && /limite grátis/.test((err as Error).message));
    await assert.rejects(collect("bad"), (err: unknown) => err instanceof BrainError && /GEMINI_API_KEY/.test((err as Error).message));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("local brain: Ollama on this PC, no key, Gemma 3 by default", async () => {
  assert.equal(loadConfig({ ALFRED_BRAIN: "local" }).brain, "local");
  const call = buildChatCall(loadConfig({}), "local", history);
  assert.equal(call.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(call.apiKey, "", "no key is ever sent");
  assert.equal(call.body.model, "gemma3:4b");
  assert.equal(call.body.stream, true);
  assert.match(call.body.messages[0].content, /não tem acesso à internet/);
  const custom = loadConfig({ ALFRED_LOCAL_MODEL: "gemma3:1b", ALFRED_LOCAL_URL: "http://127.0.0.1:9999/v1/" });
  assert.equal(buildChatCall(custom, "local", history).url, "http://127.0.0.1:9999/v1/chat/completions");
  assert.equal(buildChatCall(custom, "local", history).body.model, "gemma3:1b");
});

test("local brain: auto picks a running Ollama; clear messages when it is off or lacks the model", async () => {
  const { createServer } = await import("node:http");
  const { detectBrainInfo, streamReply, checkBrains, BrainError } = await import("../../contrib/alfred/brain.mjs");
  let hasModel = true;
  const ollama = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: hasModel ? [{ id: "gemma3:4b" }] : [] }));
    }
    if (!hasModel) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"error":{"message":"model \\"gemma3:4b\\" not found, try pulling it first"}}');
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"Às ordens."}}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", () => resolve()));
  const { port } = ollama.address() as { port: number };
  process.env.ALFRED_QUIET = "1";
  const env = { OMNIROUTE_URL: "http://127.0.0.1:9/v1", ALFRED_LOCAL_URL: `http://127.0.0.1:${port}/v1` };
  const config = loadConfig({ ...env, GEMINI_API_KEY: "g" });
  const collect = async (c = config) => {
    let text = "";
    for await (const piece of streamReply(c, "local", [{ role: "user", content: "oi" }])) text += piece;
    return text;
  };
  try {
    assert.equal((await detectBrainInfo(config)).brain, "local", "free local AI before any keyed brain");
    assert.equal(await collect(), "Às ordens.");
    assert.equal((await checkBrains(config, { deep: false })).local.ok, true);
    hasModel = false;
    await assert.rejects(collect(), (err: unknown) => err instanceof BrainError && /ollama pull gemma3:4b/.test((err as Error).message));
    const check = (await checkBrains(config, { deep: false })).local;
    assert.equal(check.ok, false);
    assert.match(check.fix ?? "", /ollama pull gemma3:4b/);
  } finally {
    ollama.closeAllConnections();
    ollama.close();
  }
  const off = loadConfig({ ...env, ALFRED_LOCAL_URL: "http://127.0.0.1:9/v1" });
  await assert.rejects(collect(off), (err: unknown) => err instanceof BrainError && /Abra o Ollama/.test((err as Error).message));
  assert.equal((await detectBrainInfo(loadConfig({ ...env, ALFRED_LOCAL_URL: "http://127.0.0.1:9/v1", GEMINI_API_KEY: "g" }))).brain, "gemini");
});
