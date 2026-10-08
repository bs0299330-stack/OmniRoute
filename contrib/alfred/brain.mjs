// Alfred — the "brain": streams a reply from OmniRoute, OpenAI or Claude Code.
// Shared by server.mjs (the web page) and cli.mjs (the terminal).

import { spawn } from "node:child_process";
import {
  OPENAI_CHAT_URL,
  buildChatCall,
  buildClaudeCommand,
  buildClaudePrompt,
  claudeCandidates,
  createSseParser,
  parseClaudeLine,
} from "./lib.mjs";

export const BRAIN_LABELS = { omniroute: "OmniRoute", openai: "OpenAI", claude: "Claude" };
export const FIRST_TOKEN_TIMEOUT_MS = 90_000;

// Technical logs go to stderr for the server; the terminal Alfred sets ALFRED_QUIET=1.
const log = (...args) => {
  if (process.env.ALFRED_QUIET !== "1") console.error(...args);
};

/** An error whose message is safe to show to the user; `detail` keeps the raw cause for diagnostics. */
export class BrainError extends Error {
  constructor(message, detail = "") {
    super(message);
    this.detail = String(detail).replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

const LOGIN_HINT = "O Claude Code não está logado: abra o terminal, rode `claude` e faça o login (precisa de plano Pro ou Max).";

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

/** Runs `<bin> --version`; resolves the version line or null. */
function claudeVersion(config, bin) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["--version"], {
        shell: buildClaudeCommand(config, process.platform, bin).shell,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim().split(/\r?\n/)[0] || "?" : null);
    });
  });
}

let claudeLookup = null;
/** Finds a working Claude Code: `{ bin, version }` or null. Memoized per process. */
export function findClaude(config) {
  claudeLookup ??= (async () => {
    for (const bin of claudeCandidates(config)) {
      const version = await claudeVersion(config, bin);
      if (version) return { bin, version };
    }
    return null;
  })();
  return claudeLookup;
}

/**
 * Resolves "auto": OmniRoute if it answers, else OpenAI with a key, else Claude Code if
 * installed. `found` is false when nothing is available (the brain then falls back to OmniRoute
 * and every question fails with a hint).
 */
export async function detectBrainInfo(config) {
  if (config.brain !== "auto") return { brain: config.brain, found: true };
  if (await omnirouteAnswers(config)) return { brain: "omniroute", found: true };
  if (config.openaiKey) return { brain: "openai", found: true };
  if (await findClaude(config)) return { brain: "claude", found: true };
  return { brain: "omniroute", found: false };
}

export async function detectBrain(config) {
  return (await detectBrainInfo(config)).brain;
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
    log(`[alfred] ${brain} unreachable:`, err?.message);
    throw new BrainError(
      brain === "openai"
        ? "Não consegui falar com a OpenAI. Confira a internet."
        : "Não consegui falar com o OmniRoute. Ele está rodando? Rode o diagnóstico para ver outras opções."
    );
  }
  if (!res.ok || !res.body) {
    log(`[alfred] ${brain} HTTP`, res.status, await res.text().catch(() => ""));
    if (res.status === 401 || res.status === 403) {
      throw new BrainError(
        brain === "openai" ? "A OpenAI recusou a chave (OPENAI_API_KEY)." : "O OmniRoute recusou a chave (OMNIROUTE_API_KEY)."
      );
    }
    if (res.status === 429) throw new BrainError(`${BRAIN_LABELS[brain]}: limite de uso ou sem crédito (HTTP 429).`);
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

function claudeFailure(detail) {
  if (/log ?in|auth|credential|api key|unauthori[sz]ed|oauth/i.test(detail)) return LOGIN_HINT;
  if (/credit|billing|quota|usage limit|rate limit/i.test(detail)) {
    return "O Claude Code atingiu o limite de uso do seu plano. Tente mais tarde.";
  }
  return "O Claude Code não respondeu. Rode o diagnóstico para ver o motivo.";
}

async function* streamClaude(config, messages, signal) {
  const found = await findClaude(config);
  if (!found) {
    throw new BrainError(
      "Não encontrei o Claude Code neste PC. Instale com: irm https://claude.ai/install.ps1 | iex (no PowerShell) e rode `claude` uma vez para entrar."
    );
  }
  const cmd = buildClaudeCommand(config, process.platform, found.bin);
  const prompt = buildClaudePrompt(config, messages, { personaInArgs: cmd.personaInArgs });
  let child;
  try {
    child = spawn(cmd.command, cmd.args, {
      shell: cmd.shell,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new BrainError("Não consegui abrir o Claude Code.");
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
        if (event.error) {
          log("[alfred] claude error:", event.detail || event.error);
          throw new BrainError(claudeFailure(`${event.detail ?? ""} ${stderr}`), event.detail || stderr);
        }
        if (event.text) {
          gotText = true;
          yield event.text;
        }
      }
    }
    const code = await exited;
    if (signal?.aborted) return;
    if (spawnError) throw new BrainError("Não consegui abrir o Claude Code.");
    if (!gotText) {
      log("[alfred] claude exited", code, stderr.trim());
      throw new BrainError(claudeFailure(stderr), stderr || `saiu com código ${code}`);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null) child.kill();
  }
}

/**
 * Streams Alfred's reply as text deltas. Throws BrainError with a user-safe message, including
 * when no text arrives within `firstTokenMs` (so a stuck brain never leaves the user waiting).
 */
export async function* streamReply(config, brain, messages, { signal, firstTokenMs = FIRST_TOKEN_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const forward = () => ctl.abort();
  if (signal?.aborted) return;
  signal?.addEventListener("abort", forward, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, firstTokenMs);
  const timeoutError = () =>
    new BrainError(
      `${BRAIN_LABELS[brain]} não respondeu em ${Math.round(firstTokenMs / 1000)} s. Rode o diagnóstico para ver o motivo.`
    );
  try {
    const inner =
      brain === "claude" ? streamClaude(config, messages, ctl.signal) : streamChatCompletions(config, brain, messages, ctl.signal);
    for await (const text of inner) {
      clearTimeout(timer);
      yield text;
    }
    if (timedOut) throw timeoutError();
  } catch (err) {
    if (timedOut) throw timeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

// ---------- Diagnóstico ----------

/** Checks each brain for real. Every entry: `{ ok, detail, fix? }`. */
export async function checkBrains(config, { deep = true } = {}) {
  const result = {};

  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    result.omniroute = res.ok
      ? { ok: true, detail: `respondendo em ${config.baseUrl}` }
      : {
          ok: false,
          detail: `respondeu HTTP ${res.status}`,
          fix: res.status === 401 || res.status === 403 ? "Coloque a chave do OmniRoute em OMNIROUTE_API_KEY." : undefined,
        };
  } catch {
    result.omniroute = { ok: false, detail: `não está rodando em ${config.baseUrl}`, fix: "Opcional: ligue o OmniRoute se quiser usá-lo." };
  }

  if (!config.openaiKey) {
    result.openai = { ok: false, detail: "sem chave", fix: "Opcional: coloque OPENAI_API_KEY no alfred.env (platform.openai.com → API keys)." };
  } else {
    try {
      const res = await fetch(OPENAI_CHAT_URL.replace("/chat/completions", "/models"), {
        headers: { authorization: `Bearer ${config.openaiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      result.openai = res.ok
        ? { ok: true, detail: "chave válida" }
        : { ok: false, detail: `a OpenAI recusou a chave (HTTP ${res.status})`, fix: "Confira a OPENAI_API_KEY e se há crédito na conta." };
    } catch {
      result.openai = { ok: false, detail: "sem resposta da OpenAI", fix: "Confira a internet." };
    }
  }

  const claude = await findClaude(config);
  if (!claude) {
    result.claude = {
      ok: false,
      detail: "Claude Code não encontrado",
      fix: "Instale no PowerShell: irm https://claude.ai/install.ps1 | iex — depois feche e abra o terminal e rode `claude` uma vez para entrar (plano Pro ou Max).",
    };
  } else if (!deep) {
    result.claude = { ok: true, detail: `${claude.version} (${claude.bin})` };
  } else {
    try {
      let text = "";
      for await (const delta of streamReply(config, "claude", [{ role: "user", content: "Responda apenas: ok" }], {
        firstTokenMs: 60_000,
      })) {
        text += delta;
      }
      result.claude = { ok: true, detail: `${claude.version} — respondeu "${text.trim().slice(0, 40)}"` };
    } catch (err) {
      result.claude = {
        ok: false,
        detail: `${claude.version} encontrado, mas não respondeu`,
        fix: err instanceof BrainError ? err.message : "Rode `claude` no terminal para ver o erro.",
        raw: err instanceof BrainError ? err.detail : String(err?.message ?? err),
      };
    }
  }
  return result;
}
