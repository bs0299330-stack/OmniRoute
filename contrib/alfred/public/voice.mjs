// Alfred — voice engine shared by the local page (public/index.html) and the Claude artifact
// (claude/index.html). The pure helpers (cleanForSpeech, createChunker, rankVoices,
// matchWakeWord) are unit-tested in Node; createSpeaker/createEarcons only run in a browser.

/** Alfred's default delivery: a little slower and deeper than the voice's natural pitch. */
export const VOICE_DEFAULTS = Object.freeze({ voiceURI: "", rate: 0.95, pitch: 0.85, engine: "browser" });

export const VOICE_TEST_LINE = "Pois não, senhor. Alfred às suas ordens. Em que posso ser útil hoje?";

// "Sr." / "Dr." / "etc." must not end a sentence.
const ABBREVIATION_END = /(?:^|[\s(])(?:sr|sra|srta|dr|dra|prof|profa|av|etc|ex|obs|pág|pag|vs|aprox|tel|n[º°o])\.$/i;
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g;
const SOFT_BREAK = /[,;:](?=\s)/g;

/** Strips what should not be read aloud: markdown, links, emoji, code. */
export function cleanForSpeech(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " o link ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns a token stream into speakable chunks: whole sentences, an early first chunk at a
 * comma (so Alfred starts talking sooner) and long sentences split at a pause or a space.
 * Short chunks also dodge Chrome's habit of cutting off utterances longer than ~15 s.
 */
export function createChunker({ firstMin = 28, max = 170 } = {}) {
  let buf = "";
  let emitted = 0;

  function take(n) {
    const piece = buf.slice(0, n);
    buf = buf.slice(n);
    return piece;
  }

  function next() {
    SENTENCE_END.lastIndex = 0;
    let m;
    while ((m = SENTENCE_END.exec(buf))) {
      const end = m.index + m[0].length;
      if (m[0][0] === "." && ABBREVIATION_END.test(buf.slice(0, m.index + 1))) continue;
      return take(end);
    }
    if (emitted === 0) {
      SOFT_BREAK.lastIndex = 0;
      while ((m = SOFT_BREAK.exec(buf))) {
        if (m.index >= firstMin) return take(m.index + 1);
      }
    }
    if (buf.length > max) {
      const head = buf.slice(0, max);
      let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "));
      if (cut < max / 3) cut = head.lastIndexOf(" ");
      return take(cut > 0 ? cut + 1 : max);
    }
    return null;
  }

  function collect(raw, out) {
    const text = cleanForSpeech(raw);
    if (text) {
      out.push(text);
      emitted++;
    }
  }

  return {
    /** Feed streamed text; returns the chunks that are ready to speak. */
    push(delta) {
      buf += delta;
      const out = [];
      let piece;
      while ((piece = next()) !== null) collect(piece, out);
      return out;
    },
    /** End of the answer: returns whatever is left. */
    flush() {
      const out = [];
      collect(buf, out);
      buf = "";
      return out;
    },
    reset() {
      buf = "";
      emitted = 0;
    },
  };
}

const NATURAL_HINT = /natural|neural|online|premium|enhanced|wavenet|studio/i;
// Male pt-BR voices shipped by Edge/Windows, macOS, Android and Chrome — Alfred is a butler.
const MALE_HINT =
  /antonio|ant[oô]nio|daniel|felipe|donato|f[aá]bio|humberto|j[uú]lio|nicolau|val[eé]rio|thiago|ricardo|male|masculin/i;

export function scoreVoice(voice, lang = "pt-BR") {
  const voiceLang = String(voice?.lang ?? "").replace("_", "-").toLowerCase();
  const wanted = lang.toLowerCase();
  let score;
  if (voiceLang === wanted) score = 100;
  else if (voiceLang.startsWith(wanted.slice(0, 2))) score = 60;
  else return -1;
  const name = String(voice.name ?? "");
  if (NATURAL_HINT.test(name)) score += 40;
  if (/google/i.test(name)) score += 25;
  if (MALE_HINT.test(name)) score += 20;
  if (voice.localService === false) score += 5;
  return score;
}

/** Portuguese voices, best first (natural > Google > male > the rest). */
export function rankVoices(voices, lang = "pt-BR") {
  return [...(voices ?? [])]
    .map((voice) => ({ voice, score: scoreVoice(voice, lang) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.voice);
}

// pt-BR recognisers often hear "Alfredo" or "Álfred".
const WAKE_WORD =
  /(?:^|[\s,.!?])(?:(?:ei|ok|olá|ola|oi|e aí)[\s,]+)?(?:alfred|alfredo|álfred|alfrede|alfredi|alfrê)(?=$|[\s,.!?])[\s,.!?]*(.*)$/i;

/** `null` when the wake word was not said; otherwise `{ command }` (may be empty). */
export function matchWakeWord(transcript) {
  const m = String(transcript ?? "").match(WAKE_WORD);
  return m ? { command: m[1].trim() } : null;
}

/**
 * Speech output. Two engines:
 * - "browser": the Web Speech API queue (works everywhere, no setup).
 * - "neural": `fetchNeural(text) => Promise<Blob>` (e.g. OmniRoute /v1/audio/speech). Each
 *   chunk is fetched as soon as it is queued, so the next one is ready while the current plays.
 *   A failed chunk falls back to the browser voice.
 */
export function createSpeaker({ getSettings, fetchNeural = null, onError = () => {} } = {}) {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  const settings = () => ({ ...VOICE_DEFAULTS, ...(getSettings ? getSettings() : {}) });
  let voices = [];
  let pending = 0;
  let generation = 0;
  let chain = Promise.resolve();
  let currentAudio = null;
  let watchdog = null;
  const changeListeners = new Set();
  const voiceListeners = new Set();

  function loadVoices() {
    try {
      voices = synth ? synth.getVoices() : [];
    } catch {
      voices = [];
    }
    for (const fn of voiceListeners) fn(rankVoices(voices));
  }
  if (synth) {
    loadVoices();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  function setPending(delta) {
    const was = pending > 0;
    pending = Math.max(0, pending + delta);
    const now = pending > 0;
    if (was !== now) for (const fn of changeListeners) fn(now);
    if (now && !watchdog && synth) {
      // Chrome sometimes leaves the queue paused; nudge it while we expect speech.
      watchdog = setInterval(() => {
        if (synth.paused) synth.resume();
      }, 4000);
    } else if (!now && watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }

  function pickVoice(s) {
    if (s.voiceURI) {
      const chosen = voices.find((v) => v.voiceURI === s.voiceURI);
      if (chosen) return chosen;
    }
    return rankVoices(voices)[0] ?? null;
  }

  function utter(text, onDone) {
    const s = settings();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(s);
    u.lang = voice?.lang ?? "pt-BR";
    if (voice) u.voice = voice;
    u.rate = s.rate;
    u.pitch = s.pitch;
    u.onend = onDone;
    u.onerror = onDone;
    if (synth.paused) synth.resume();
    synth.speak(u);
  }

  function sayBrowser(text, gen) {
    if (!synth) return;
    setPending(1);
    try {
      utter(text, () => gen === generation && setPending(-1));
    } catch {
      setPending(-1);
    }
  }

  function sayNeural(text, gen) {
    setPending(1);
    const audio = fetchNeural(text);
    audio.catch(() => {}); // handled below, in order
    chain = chain
      .then(async () => {
        if (gen !== generation) return;
        let url;
        try {
          url = URL.createObjectURL(await audio);
        } catch (err) {
          onError(err);
          if (synth && gen === generation) {
            await new Promise((done) => {
              try {
                utter(text, done);
              } catch {
                done();
              }
            });
          }
          return;
        }
        if (gen === generation) {
          await new Promise((done) => {
            const player = new Audio(url);
            currentAudio = player;
            player.onended = done;
            player.onerror = done;
            player.play().catch(done);
          });
          currentAudio = null;
        }
        URL.revokeObjectURL(url);
      })
      .finally(() => gen === generation && setPending(-1));
  }

  return {
    /** Queue one chunk (from createChunker). */
    say(text) {
      const clean = cleanForSpeech(text);
      if (!clean) return;
      if (settings().engine === "neural" && fetchNeural) sayNeural(clean, generation);
      else sayBrowser(clean, generation);
    },
    /** Speak a whole text, chunked. */
    sayAll(text) {
      const chunker = createChunker();
      for (const piece of [...chunker.push(text + " "), ...chunker.flush()]) this.say(piece);
    },
    /** Stop now and drop the queue. */
    cancel() {
      generation++;
      try {
        synth?.cancel();
      } catch {}
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      chain = Promise.resolve();
      setPending(-pending);
    },
    get speaking() {
      return pending > 0;
    },
    get available() {
      return !!synth || !!fetchNeural;
    },
    /** iOS/Safari only speak after a gesture: call this from the first click or key press. */
    unlock() {
      if (!synth) return;
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        synth.speak(u);
      } catch {}
    },
    voices: () => rankVoices(voices),
    onChange(fn) {
      changeListeners.add(fn);
    },
    onVoices(fn) {
      voiceListeners.add(fn);
      fn(rankVoices(voices));
    },
  };
}

/** Soft cues: "listen" (rising) when the mic opens, "done" (falling) when it closes. */
export function createEarcons() {
  let ctx = null;
  function play(from, to) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx ??= new AudioCtx();
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      osc.type = "sine";
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch {}
  }
  return {
    listen: () => play(660, 990),
    done: () => play(880, 520),
  };
}
