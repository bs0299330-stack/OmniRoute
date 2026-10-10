// Alfred — "bata duas palmas" activation. Browser-only listener + a pure detector (unit-tested).
//
// The detector looks for a double clap: two short, loud transients 0.15–0.8 s apart, with quiet
// before the first one and nothing right after the second. Speech and music stay loud for longer
// than a clap, and typing produces runs of clicks, so both are rejected.

export const SENSITIVITY = Object.freeze({
  // minimum peak (0..1) and how far above the room's background level a clap must be
  baixa: { minPeak: 0.35, ratio: 14 },
  media: { minPeak: 0.2, ratio: 9 },
  alta: { minPeak: 0.1, ratio: 6 },
});

const MAX_CLAP_S = 0.12; // a clap rings out quickly
const LONG_SOUND_S = 0.25; // anything loud for longer is not a clap
const GAP_MIN_S = 0.15;
const GAP_MAX_S = 0.8;
const QUIET_BEFORE_S = 0.45; // no other bang just before the first clap
const QUIET_AFTER_S = 0.35; // and none right after the second (typing, a third clap…)
const REFRACTORY_S = 1.5;

/** Feed it blocks of samples (Float32Array, -1..1); it returns an event or null. */
export class ClapDetector {
  constructor(sampleRate, { sensitivity = "media" } = {}) {
    this.sampleRate = sampleRate;
    this.muted = false;
    this.setSensitivity(sensitivity);
    this.background = 0.01;
    this.samples = 0;
    this.inTransient = false;
    this.onsetAt = 0;
    this.peak = 0;
    this.lastOnsetAt = -1e9;
    this.firstClapAt = null;
    this.pendingDouble = null;
    this.refractoryUntil = 0;
  }

  setSensitivity(name) {
    const preset = SENSITIVITY[name] ?? SENSITIVITY.media;
    this.minPeak = preset.minPeak;
    this.ratio = preset.ratio;
  }

  push(block) {
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < block.length; i++) {
      const v = block[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / block.length);
    const now = this.samples / this.sampleRate;
    this.samples += block.length;

    // A double clap is confirmed only after a short quiet period following the second clap.
    if (this.pendingDouble !== null && now - this.pendingDouble >= QUIET_AFTER_S && !this.inTransient) {
      const at = this.pendingDouble;
      this.pendingDouble = null;
      this.firstClapAt = null;
      this.refractoryUntil = now + REFRACTORY_S;
      if (!this.muted) return { type: "double", at };
    }

    if (!this.inTransient) {
      const loud = peak >= this.minPeak && peak >= this.background * this.ratio;
      if (loud && now >= this.refractoryUntil) {
        this.inTransient = true;
        this.onsetAt = now;
        this.peak = peak;
        // Any bang while a double clap waits for confirmation means it was not a clean double.
        if (this.pendingDouble !== null) {
          this.pendingDouble = null;
          this.firstClapAt = null;
        }
      } else {
        this.background += (rms - this.background) * 0.02; // adapts only between sounds
        if (this.background < 0.002) this.background = 0.002;
      }
      return null;
    }

    this.peak = Math.max(this.peak, peak);
    const duration = now - this.onsetAt;
    if (rms < this.peak * 0.12 || peak < this.peak * 0.25) {
      this.inTransient = false;
      const quietBefore = this.onsetAt - this.lastOnsetAt >= QUIET_BEFORE_S;
      this.lastOnsetAt = this.onsetAt;
      if (duration > MAX_CLAP_S) {
        this.firstClapAt = null;
        return null;
      }
      const gap = this.firstClapAt === null ? null : this.onsetAt - this.firstClapAt;
      if (gap !== null && gap >= GAP_MIN_S && gap <= GAP_MAX_S) {
        this.pendingDouble = this.onsetAt;
        return null;
      }
      this.firstClapAt = quietBefore ? this.onsetAt : null;
      return this.firstClapAt === null ? null : { type: "clap", at: this.onsetAt };
    }
    if (duration > LONG_SOUND_S) {
      // speech, music, a door: not a clap; forget any half-made pair
      this.inTransient = false;
      this.lastOnsetAt = this.onsetAt;
      this.firstClapAt = null;
      this.pendingDouble = null;
    }
    return null;
  }
}

// The AudioWorklet runs the same detector on the audio thread, so it keeps listening when the
// tab is in the background. Its source is built from the class above.
const WORKLET_SOURCE = `
const SENSITIVITY = ${JSON.stringify(SENSITIVITY)};
const MAX_CLAP_S = ${MAX_CLAP_S}, LONG_SOUND_S = ${LONG_SOUND_S}, GAP_MIN_S = ${GAP_MIN_S}, GAP_MAX_S = ${GAP_MAX_S};
const QUIET_BEFORE_S = ${QUIET_BEFORE_S}, QUIET_AFTER_S = ${QUIET_AFTER_S}, REFRACTORY_S = ${REFRACTORY_S};
${ClapDetector.toString()}
class AlfredClapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.detector = new ClapDetector(sampleRate, options.processorOptions || {});
    this.port.onmessage = (e) => {
      if (e.data.sensitivity) this.detector.setSensitivity(e.data.sensitivity);
      if ("muted" in e.data) this.detector.muted = !!e.data.muted;
    };
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      const event = this.detector.push(channel);
      if (event) this.port.postMessage(event);
    }
    return true;
  }
}
registerProcessor("alfred-claps", AlfredClapProcessor);
`;

/**
 * Opens the microphone and listens for a double clap.
 * Resolves `{ stop, setMuted, setSensitivity, resume, running }`; rejects with
 * `{ code: "unsupported" | "denied" | "no-mic" }`.
 */
export async function startClapListener({ onDoubleClap, sensitivity = "media" }) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AudioCtx || !window.AudioWorkletNode) {
    throw { code: "unsupported" };
  }
  let stream;
  try {
    // Noise suppression and auto gain would flatten exactly the transient we look for.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    throw { code: err?.name === "NotFoundError" ? "no-mic" : "denied" };
  }
  const ctx = new AudioCtx();
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "alfred-claps", { processorOptions: { sensitivity } });
  const silent = ctx.createGain();
  silent.gain.value = 0; // keeps the node in the rendered graph without making any sound
  source.connect(node).connect(silent).connect(ctx.destination);
  node.port.onmessage = (e) => {
    if (e.data?.type === "double") onDoubleClap();
  };
  return {
    get running() {
      return ctx.state === "running";
    },
    resume: () => ctx.resume(),
    setMuted: (muted) => node.port.postMessage({ muted }),
    setSensitivity: (name) => node.port.postMessage({ sensitivity: name }),
    stop() {
      for (const track of stream.getTracks()) track.stop();
      ctx.close();
    },
  };
}
