// Alfred — the "brain": streams a reply from OmniRoute, OpenAI or Claude Code.
// Shared by server.mjs (the web page) and cli.mjs (the terminal).

import { spawn } from "node:child_process";
import {
  buildChatCall,
  buildClaudeCommand,
  buildClaudePrompt,
  createSseParser,
  parseClaudeLine,
} from "./lib.mjs";

export const BRAIN_LABELS = { omniroute: "OmniRoute", openai: "OpenAI", claude: "Claude" };

/** An error whose message is safe to show to the user. */
export class BrainError extends Error {}

async function omnirouteAnswers(config) {
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function claudeAnswers(config) {
  return new Promise((resolve) => {
    try {
      const child = spawn(config.claudeBin, ["--version"], {
        shell: process.platform === "win32",
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 8000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Resolves "auto": OmniRoute if it answers, else OpenAI with a key, else Claude Code if installed. */
export async function detectBrain(config) {
  if (config.brain !== "auto") return config.brain;
  if (await omnirouteAnswers(config)) return "omniroute";
  if (config.openaiKey) return "openai";
  if (await claudeAnswers(config)) return "claude";
  return "omniroute";
}

async function* streamChatCompletions(config, brain, messages, signal) {
  const call = buildChatCall(config, brain, messages);
  let res;
  try {
    res = await fetch(call.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(call.apiKey ? { authorization: `Bearer ${call.apiKey}` } : {}),
      },
      body: JSON.stringify(call.body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    console.error(`[alfred] ${brain} unreachable:`, err?.message);
    throw new BrainError(
      brain === "openai"
        ? "Não consegui falar com a OpenAI. Confira a internet."
        : "Não consegui falar com o OmniRoute. Ele está rodando?"
    );
  }
  if (!res.ok || !res.body) {
    console.error(`[alfred] ${brain} HTTP`, res.status, await res.text().catch(() => ""));
    if (res.status === 401 || res.status === 403) {
      throw new BrainError(
        brain === "openai" ? "A OpenAI recusou a chave (OPENAI_API_KEY)." : "O OmniRoute recusou a chave (OMNIROUTE_API_KEY)."
      );
    }
    throw new BrainError(`${BRAIN_LABELS[brain]} respondeu com erro (${res.status}).`);
  }
  const parse = createSseParser();
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const { deltas, done } = parse(decoder.decode(chunk, { stream: true }));
    for (const text of deltas) yield text;
    if (done) return;
  }
}

async function* streamClaude(config, messages, signal) {
  const cmd = buildClaudeCommand(config);
  const prompt = buildClaudePrompt(config, messages, { personaInArgs: cmd.personaInArgs });
  let child;
  try {
    child = spawn(cmd.command, cmd.args, {
      shell: cmd.shell,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new BrainError("Não encontrei o Claude Code (comando `claude`).");
  }
  const onAbort = () => child.kill();
  signal?.addEventListener("abort", onAbort, { once: true });

  let spawnError = null;
  let stderr = "";
  child.on("error", (err) => (spawnError = err));
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  const exited = new Promise((resolve) => child.on("close", resolve));
  child.stdout.setEncoding("utf8"); // keeps multi-byte characters intact across chunks
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);

  let buffer = "";
  let gotText = false;
  try {
    for await (const chunk of child.stdout) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseClaudeLine(line);
        if (!event) continue;
        if (event.error) throw new BrainError(event.error);
        if (event.text) {
          gotText = true;
          yield event.text;
        }
      }
    }
    const code = await exited;
    if (signal?.aborted) return;
    if (spawnError) throw new BrainError("Não encontrei o Claude Code (comando `claude`).");
    if (!gotText) {
      console.error("[alfred] claude exited", code, stderr.trim());
      throw new BrainError(
        /log ?in|auth|credential/i.test(stderr)
          ? "O Claude Code não está logado. Rode `claude` uma vez no terminal para entrar."
          : "O Claude Code não respondeu."
      );
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null) child.kill();
  }
}

/** Streams Alfred's reply as text deltas. Throws BrainError with a user-safe message. */
export function streamReply(config, brain, messages, { signal } = {}) {
  if (brain === "claude") return streamClaude(config, messages, signal);
  return streamChatCompletions(config, brain, messages, signal);
}
