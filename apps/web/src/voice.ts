// Voice calls: the browser's speech recognition listens, Kokoro (a small voice model, run in the browser) speaks,
// and talking over a reply stops it. The pure helpers at the top are what the tests check.

/** Kokoro voices worth offering, best first; "builtin" is the browser's own voice. */
export const VOICES: Record<string, string> = {
  af_heart: "Heart (US)",
  af_bella: "Bella (US)",
  af_nicole: "Nicole (US, soft)",
  am_michael: "Michael (US)",
  am_fenrir: "Fenrir (US)",
  bf_emma: "Emma (UK)",
  bm_george: "George (UK)",
  builtin: "This device's own voice (no download)",
};

/** Markdown and links read badly out loud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[*_`#>~]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentences, so the first one can play while the next is made. Tiny ones join the next. */
export function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && out.at(-1)!.split(" ").length < 4) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

/**
 * The note that goes on the user's next message when they talked over a reply. The reply itself stays whole in the
 * history, so "pick up where you left off" has both what was meant and where it stopped. `fraction` is how far into
 * sentence `done` the playback got.
 */
export function interruptNote(parts: string[], done: number, fraction: number): string {
  const words = (parts[done] ?? "").split(" ");
  const partial = words.slice(0, Math.floor(words.length * Math.min(1, Math.max(0, fraction)))).join(" ");
  const heard = [...parts.slice(0, done), partial].filter(Boolean).join(" ").split(" ");
  if (!heard[0]) return "[The user interrupted your last reply before any of it was read aloud. None of it was heard.]";
  const tail = heard.length > 15 ? `…${heard.slice(-15).join(" ")}` : heard.join(" ");
  return `[The user interrupted while your last reply was being read aloud. They heard up to: "${tail}". The rest wasn't heard.]`;
}

// ---- Browser side ----

type Kokoro = {
  generate(text: string, o: { voice: string }): Promise<{ audio: Float32Array; sampling_rate: number }>;
  /** Drops speech that's queued but not started. */
  cancel(): void;
};
let kokoro: Promise<Kokoro | null> | undefined;
/** Why Kokoro didn't load, so the page can say why it fell back to the built-in voice. */
export let voiceError = "";

// Tilde (a WebGPU engine built for iPhone Safari) runs Kokoro-82M on the GPU, ~4x faster than real time on an iPhone 16 Pro.
// kokoro-js crashed Safari's GPU there and was slower than real time on WebAssembly.
const TILDE = "https://cdn.jsdelivr.net/gh/KealJones/tilde@ab7fe77/src/index.js";
const GGUF = "https://huggingface.co/ggml-org/Kokoro-82M-GGUF/resolve/main/";
type TildeKokoro = { speak(phonemes: string, o: { voice: string }): Promise<Float32Array> };
type TildeLib = {
  loadKokoro(backbone: string, mmproj: string, o: { onProgress: (p: { loaded: number; total: number }) => void }): Promise<TildeKokoro>;
  trimSilence(pcm: Float32Array): Float32Array;
  SPEECH_RATE: number;
};

/** Loads once per page; the model files stay in the browser's cache after the first time. */
export function loadKokoro(onProgress: (pct: number) => void): Promise<Kokoro | null> {
  return (kokoro ??= (async () => {
    try {
      if (!(navigator as { gpu?: unknown }).gpu) throw new Error("this browser has no WebGPU");
      const [t, { phonemize }] = await Promise.all([import(/* @vite-ignore */ TILDE) as Promise<TildeLib>, import("./phonemize.js")]);
      const k = await t.loadKokoro(GGUF + "Kokoro-82M-F32.gguf", GGUF + "mmproj-Kokoro-82M-F16.gguf", {
        onProgress: (p) => onProgress(Math.round((100 * p.loaded) / p.total)),
      });
      // One sentence at a time on the GPU; cancel() bumps the epoch so queued sentences are dropped.
      let tail: Promise<unknown> = Promise.resolve(), epoch = 0;
      return {
        generate(text, o) {
          const mine = epoch;
          const job = tail.then(async () => {
            if (mine !== epoch) throw new Error("cancelled");
            // shortcut: one call takes 510 phonemes; longer sentences are cut, as kokoro-js did.
            const ph = (await phonemize(text, o.voice.startsWith("b") ? "b" : "a")).slice(0, 510);
            return { audio: t.trimSilence(await k.speak(ph, { voice: o.voice })), sampling_rate: t.SPEECH_RATE };
          });
          tail = job.catch(() => {});
          return job;
        },
        cancel: () => void epoch++,
      } satisfies Kokoro;
    } catch (err) {
      voiceError = err instanceof Error ? err.message : String(err);
      console.warn("Kokoro didn't load, using the built-in voice:", voiceError);
      return null;
    }
  })());
}

type Recognition = EventTarget & {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const Recognizer = (globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
export const canCall = !!Recognizer && !!navigator.mediaDevices?.getUserMedia;
export const canDictate = !!Recognizer;

/** Dictation into the box: shows what's heard so far, until stopped or the browser ends it. Returns stop. */
export function dictate(onText: (text: string) => void, onEnd: () => void): () => void {
  const rec = new Recognizer!();
  rec.lang = navigator.language;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => onText(Array.from(e.results, (r) => r[0]!.transcript).join(""));
  rec.onerror = () => onEnd();
  rec.onend = onEnd;
  rec.start();
  return () => rec.stop();
}

export type CallState = "loading" | "listening" | "thinking" | "speaking";
export interface CallOptions {
  voice: () => string;
  /** Sends what was said; returns the reply, or null if it failed. */
  ask: (text: string) => Promise<string | null>;
  /** The reply was talked over: this note goes on the next message. */
  interrupted: (note: string) => void;
  /** Speaking finished, cut off or not. */
  spoken: () => void;
  heard: (text: string) => void;
  state: (s: CallState, note?: string) => void;
}

const SILENCE_MS = 1200;
// Talking over a reply: this loud (RMS, after echo cancellation) for this long. The phone's own speaker shouldn't reach it.
const BARGE_LEVEL = 0.05;
const BARGE_MS = 300;

/** Starts a call. Must run inside the tap, so iPhone lets audio play. Returns the hang-up function. */
export function startCall(opts: CallOptions): () => void {
  stopReading();
  const stop = new AbortController();
  const signal = stop.signal;
  const audio = new AudioContext();
  void audio.resume();
  speechSynthesis.speak(new SpeechSynthesisUtterance("")); // unlocks the built-in voice on iPhone
  let tooSlow = false;

  void (async () => {
    // One mic stream for the whole call, echo-cancelled, only used to notice talking over a reply.
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    signal.addEventListener("abort", () => mic.getTracks().forEach((t) => t.stop()));
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(mic).connect(analyser);
    if (opts.voice() !== "builtin") {
      opts.state("loading", "loading the voice, about 90 MB the first time");
      await loadKokoro((pct) => opts.state("loading", `loading the voice, ${pct}%`));
    }
    while (!signal.aborted) {
      opts.state("listening", voiceError && opts.voice() !== "builtin" ? "(Kokoro didn't load, using this device's voice)" : undefined);
      const text = await listen(signal, opts.heard);
      if (!text || signal.aborted) continue;
      opts.state("thinking");
      const reply = await opts.ask(text);
      if (!reply || signal.aborted) continue;
      opts.state("speaking");
      // A voice that fails mid-reply hands over to the built-in one for the rest of the call.
      await speak(reply, analyser, signal).catch((err) => {
        console.warn(err);
        tooSlow = true;
      });
      opts.spoken();
    }
  })().catch((err) => {
    if (!signal.aborted) opts.state("listening", err instanceof Error && err.name === "NotAllowedError" ? "the mic is blocked, allow it in the browser's settings" : String(err));
  });

  /** Plays the reply sentence by sentence, making the next while one plays, until done or talked over. */
  async function speak(reply: string, analyser: AnalyserNode, signal: AbortSignal) {
    const parts = sentences(speakable(reply));
    const tts = opts.voice() === "builtin" || tooSlow ? null : await loadKokoro(() => {});
    const barge = new AbortController();
    const off = () => barge.abort();
    signal.addEventListener("abort", off);
    const watching = watchForTalk(analyser, barge);
    let next = tts ? timed(tts.generate(parts[0]!, { voice: opts.voice() })) : null;
    try {
      for (let i = 0; i < parts.length; i++) {
        let played: number;
        if (tts && next && !tooSlow) {
          const { value, ms } = await next;
          const seconds = value.audio.length / value.sampling_rate;
          // Taking over twice as long to make as to play means long gaps; the built-in voice takes over for the rest of the call.
          if (ms / 1000 > seconds * 2) tooSlow = true;
          next = i + 1 < parts.length ? timed(tts.generate(parts[i + 1]!, { voice: opts.voice() })) : null;
          played = await play(audio, value, barge.signal);
        } else played = await say(parts[i]!, barge.signal);
        if (played < 1) {
          if (!signal.aborted) opts.interrupted(interruptNote(parts, i, played));
          return;
        }
      }
    } finally {
      barge.abort();
      await watching;
      signal.removeEventListener("abort", off);
    }
  }

  /** Aborts `barge` (which stops what's playing) when talking is heard; resolves once `barge` is aborted either way. */
  function watchForTalk(analyser: AnalyserNode, barge: AbortController): Promise<void> {
    const data = new Float32Array(analyser.fftSize);
    let loudSince = 0;
    return new Promise((resolve) => {
      const tick = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((a, x) => a + x * x, 0) / data.length);
        const now = performance.now();
        if (rms < BARGE_LEVEL) loudSince = 0;
        else if (!loudSince) loudSince = now;
        else if (now - loudSince > BARGE_MS) barge.abort();
      }, 30);
      barge.signal.addEventListener("abort", () => (clearInterval(tick), resolve()), { once: true });
    });
  }

  function play(ctx: AudioContext, a: { audio: Float32Array; sampling_rate: number }, cut: AbortSignal): Promise<number> {
    return new Promise((resolve) => {
      const buffer = ctx.createBuffer(1, a.audio.length, a.sampling_rate);
      buffer.copyToChannel(a.audio as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const start = ctx.currentTime;
      const end = (fraction: number) => {
        src.onended = null;
        try { src.stop(); } catch {}
        resolve(fraction);
      };
      src.onended = () => end(1);
      if (cut.aborted) return end(0);
      cut.addEventListener("abort", () => end((ctx.currentTime - start) / buffer.duration), { once: true });
      src.start();
    });
  }

  function say(text: string, cut: AbortSignal): Promise<number> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const start = performance.now();
      const guess = text.split(" ").length * 330; // ~180 words a minute
      const end = (fraction: number) => {
        u.onend = null;
        speechSynthesis.cancel();
        resolve(fraction);
      };
      u.onend = () => end(1);
      u.onerror = () => end(1);
      if (cut.aborted) return end(0);
      cut.addEventListener("abort", () => end(Math.min(0.99, (performance.now() - start) / guess)), { once: true });
      speechSynthesis.speak(u);
    });
  }

  return () => {
    stop.abort();
    speechSynthesis.cancel();
    void audio.close();
  };
}

async function timed<T>(p: Promise<T>) {
  const t = performance.now();
  const value = await p;
  return { value, ms: performance.now() - t };
}

/** Listens until a pause after some words. Resolves "" if nothing was said, so the caller listens again. */
function listen(signal: AbortSignal, heard: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve("");
    const rec = new Recognizer!();
    rec.lang = navigator.language;
    rec.continuous = true;
    rec.interimResults = true;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    rec.onresult = (e) => {
      text = Array.from(e.results, (r) => r[0]!.transcript).join(" ").replace(/\s+/g, " ").trim();
      heard(text);
      clearTimeout(timer);
      timer = setTimeout(() => rec.stop(), SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") reject(new Error("speech recognition is blocked; on iPhone, turn on Siri & Dictation"));
    };
    rec.onend = () => {
      clearTimeout(timer);
      resolve(text);
    };
    signal.addEventListener("abort", () => rec.abort(), { once: true });
    rec.start();
  });
}

// ---- Reading one message aloud ----

/**
 * Whether reading can start without stalling later: with `ready` seconds of speech made, `left` seconds still to make,
 * and `rate` seconds it takes to make one second, the rest must land before playback catches up (10% to spare).
 */
export const canStart = (ready: number, left: number, rate: number) => ready >= left * (rate - 1) * 1.1;

export type ReadState = "loading" | "playing" | "paused" | "done";
export interface Reader {
  pause(): void;
  resume(): void;
  restart(): void;
  stop(): void;
}
let reading: Reader | null = null;
export const stopReading = () => reading?.stop();

/** Reads one message with the call's voice. Must run inside the tap. Starting another stops this one. */
export function readAloud(text: string, voice: string, state: (s: ReadState) => void): Reader {
  stopReading();
  const parts = sentences(speakable(text));
  const ctx = new AudioContext();
  void ctx.resume();
  const builtin = voice === "builtin";
  // Made once, so pause and restart don't make them again.
  const made: Promise<AudioBuffer | null>[] = [];
  const make = (i: number) =>
    (made[i] ??= loadKokoro(() => {}).then(async (tts) => {
      if (!tts) return null;
      const a = await tts.generate(parts[i]!, { voice });
      const b = ctx.createBuffer(1, a.audio.length, a.sampling_rate);
      b.copyToChannel(a.audio as Float32Array<ArrayBuffer>, 0);
      return b;
    }));
  let run = 0;
  let src: AudioBufferSourceNode | null = null;

  async function go(me: number) {
    state(builtin ? "playing" : "loading");
    // Queue every sentence now, so the voice never sits idle while one plays (that idling was the gap between sentences).
    if (!builtin) parts.forEach((_, i) => void make(i).catch(() => {}));
    // A phone can make speech slower than it plays it, so hold off until the rest will be ready in time.
    if (!builtin && (await loadKokoro(() => {}))) {
      const t0 = performance.now();
      const total = parts.join("").length;
      for (let i = 0, ready = 0, chars = 0; i < parts.length && me === run; i++) {
        const b = await make(i).catch(() => null);
        if (!b) break;
        ready += b.duration;
        chars += parts[i]!.length;
        if (canStart(ready, ((total - chars) / chars) * ready, (performance.now() - t0) / 1000 / ready)) break;
      }
    }
    for (let i = 0; i < parts.length && me === run; i++) {
      const buffer = builtin ? null : await make(i).catch(() => null);
      if (me !== run) return;
      if (ctx.state !== "suspended") state("playing");
      await new Promise<void>((done) => {
        if (buffer) {
          src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.onended = () => done();
          src.start();
        } else {
          const u = new SpeechSynthesisUtterance(parts[i]!);
          u.onend = u.onerror = () => done();
          speechSynthesis.speak(u);
        }
      });
    }
    if (me === run) {
      state("done");
      if (reading === reader) reading = null;
    }
  }
  const halt = () => {
    run++;
    if (src) (src.onended = null), src.stop();
    src = null;
    speechSynthesis.cancel();
  };
  const reader: Reader = {
    pause: () => (speechSynthesis.pause(), void ctx.suspend(), state("paused")),
    resume: () => (speechSynthesis.resume(), void ctx.resume(), state("playing")),
    restart: () => (halt(), void ctx.resume(), void go(run)),
    stop: () => {
      halt();
      if (!builtin) void loadKokoro(() => {}).then((tts) => tts?.cancel());
      void ctx.close();
      if (reading === reader) reading = null;
      state("done");
    },
  };
  reading = reader;
  void go(run);
  return reader;
}
