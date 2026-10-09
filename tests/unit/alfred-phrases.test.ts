import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PHRASES, createSpeaker, greetingFor } from "../../contrib/alfred/public/voice.mjs";

const PUBLIC = "contrib/alfred/public";

test("every fixed phrase has a line, and every recording belongs to a phrase", () => {
  const files = Object.values(PHRASES)
    .map((p) => p.file)
    .filter(Boolean);
  for (const [name, p] of Object.entries(PHRASES)) {
    assert.ok(p.text.trim().length > 0, `${name} has no text`);
    if (p.file) {
      assert.match(p.file, /^frases\/[a-z0-9-]+\.mp3$/, `${name}: the server only serves frases/<name>.mp3`);
      assert.ok(existsSync(join(PUBLIC, p.file)), `${name}: missing ${p.file}`);
    }
  }
  const onDisk = readdirSync(join(PUBLIC, "frases")).map((f) => `frases/${f}`);
  assert.deepEqual([...onDisk].sort(), [...files].sort());
});

test("greetingFor picks bom dia / boa tarde / boa noite by the hour", () => {
  const at = (h: number) => greetingFor(new Date(2026, 9, 9, h, 30));
  assert.equal(at(4), "boaNoite");
  assert.equal(at(5), "bomDia");
  assert.equal(at(11), "bomDia");
  assert.equal(at(12), "boaTarde");
  assert.equal(at(17), "boaTarde");
  assert.equal(at(18), "boaNoite");
  assert.equal(at(23), "boaNoite");
});

// A tiny stand-in for the browser: a speechSynthesis queue and <audio> elements that log events.
function fakeBrowser() {
  const events: string[] = [];
  class Utterance {
    text: string;
    lang = "";
    voice = null;
    rate = 1;
    pitch = 1;
    volume = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    queue: [] as Utterance[],
    speak(u: Utterance) {
      this.queue.push(u);
      this.pending = true;
      this.pump();
    },
    pump() {
      if (this.speaking) return;
      const u = this.queue.shift();
      this.pending = this.queue.length > 0;
      if (!u) return;
      this.speaking = true;
      events.push("speak:" + u.text);
      setTimeout(() => {
        if (!this.speaking) return; // cancelled
        this.speaking = false;
        u.onend?.();
        this.pump();
      }, 30);
    },
    cancel() {
      this.queue = [];
      this.speaking = false;
      this.pending = false;
    },
    resume() {},
    getVoices: () => [],
    addEventListener() {},
  };
  class FakeAudio {
    src: string;
    onended: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(src: string) {
      this.src = src;
    }
    play() {
      events.push("play:" + this.src);
      if (this.src.includes("missing")) setTimeout(() => this.onerror?.(), 5);
      else setTimeout(() => this.onended?.(), 40);
      return Promise.resolve();
    }
    pause() {
      events.push("pause:" + this.src);
      this.onpause?.();
    }
  }
  const g = globalThis as Record<string, unknown>;
  g.window = { speechSynthesis: synth };
  g.SpeechSynthesisUtterance = Utterance;
  g.Audio = FakeAudio;
  const restore = () => {
    delete g.window;
    delete g.SpeechSynthesisUtterance;
    delete g.Audio;
  };
  return { events, restore };
}

async function idle(speaker: { speaking: boolean }) {
  const started = Date.now();
  while (speaker.speaking) {
    if (Date.now() - started > 5000) throw new Error("speaker never went idle");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("a recorded phrase plays in order: after earlier speech, before later speech", async () => {
  const { events, restore } = fakeBrowser();
  try {
    const changes: boolean[] = [];
    const speaker = createSpeaker({ getSettings: () => ({ engine: "browser" }), onAudio: () => events.push("analyse") });
    speaker.onChange((on: boolean) => changes.push(on));
    speaker.say("Primeira frase.");
    speaker.playClip("frases/bom-dia.mp3", "Bom dia, senhor.");
    speaker.say("Depois do áudio.");
    assert.equal(speaker.speaking, true);
    await idle(speaker);
    assert.deepEqual(events, [
      "speak:Primeira frase.",
      "analyse", // the globe follows the recording
      "play:frases/bom-dia.mp3",
      "speak:Depois do áudio.",
    ]);
    assert.deepEqual(changes, [true, false], "one continuous 'speaking' period, so the mic stays closed");
  } finally {
    restore();
  }
});

test("a recording that cannot play is spoken by the normal voice instead", async () => {
  const { events, restore } = fakeBrowser();
  try {
    const speaker = createSpeaker({ getSettings: () => ({ engine: "browser" }) });
    speaker.playClip("frases/missing.mp3", "Pois não, senhor?");
    await idle(speaker);
    assert.deepEqual(events, ["play:frases/missing.mp3", "speak:Pois não, senhor?"]);
  } finally {
    restore();
  }
});

test("cancel stops a recording and later speech does not wait for it", async () => {
  const { events, restore } = fakeBrowser();
  try {
    const speaker = createSpeaker({ getSettings: () => ({ engine: "browser" }) });
    speaker.playClip("frases/momento.mp3", "Um momento.");
    await new Promise((r) => setTimeout(r, 10));
    speaker.cancel();
    assert.equal(speaker.speaking, false);
    speaker.say("Nova resposta.");
    await idle(speaker);
    assert.deepEqual(events, ["play:frases/momento.mp3", "pause:frases/momento.mp3", "speak:Nova resposta."]);
  } finally {
    restore();
  }
});

test("the server serves the recordings and nothing outside public/frases", async () => {
  const { spawn } = await import("node:child_process");
  const port = 30000 + (process.pid % 20000);
  const child = spawn(process.execPath, ["contrib/alfred/server.mjs"], {
    env: { ...process.env, ALFRED_PORT: String(port), ALFRED_BRAIN: "gemini", GEMINI_API_KEY: "test", ALFRED_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not start")), 10_000);
      child.stdout.on("data", (d) => {
        if (String(d).includes(`:${port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error("server exited " + code)));
    });
    const base = `http://127.0.0.1:${port}`;
    const ok = await fetch(`${base}/frases/bom-dia.mp3`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "audio/mpeg");
    const body = Buffer.from(await ok.arrayBuffer());
    assert.ok(body.equals(readFileSync(join(PUBLIC, "frases/bom-dia.mp3"))));
    for (const path of ["/frases/nao-existe.mp3", "/frases/..%2fserver.mjs", "/frases/%2e%2e/server.mjs", "/frases/BOM-DIA.mp3"]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 404, path);
      await res.arrayBuffer();
    }
  } finally {
    child.kill();
  }
});
