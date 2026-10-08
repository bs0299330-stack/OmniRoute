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
  const call = buildChatCall(config, "openai", history);
  assert.equal(call.url, OPENAI_CHAT_URL);
  assert.equal(call.apiKey, "sk-test");
  assert.equal(call.body.model, "gpt-4.1-mini");
  assert.equal(call.body.stream, true);
  const omni = buildChatCall(loadConfig({ OMNIROUTE_API_KEY: "omni" }), "omniroute", history);
  assert.equal(omni.url, "http://localhost:20128/v1/chat/completions");
  assert.equal(omni.apiKey, "omni");
});

test("Claude Code command: no tools, streaming, persona in args only off Windows", () => {
  const config = loadConfig({});
  const posix = buildClaudeCommand(config, "linux");
  assert.equal(posix.shell, false);
  assert.deepEqual(posix.args.slice(0, 8), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--tools",
    "",
  ]);
  assert.ok(posix.args.includes("--system-prompt"));

  const win = buildClaudeCommand(config, "win32");
  assert.equal(win.shell, true);
  assert.equal(win.personaInArgs, false);
  assert.ok(!win.args.includes("--system-prompt"), "nothing free-form reaches cmd.exe");
  for (const arg of win.args) assert.match(arg, /^[\w\-:".]*$/);
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
