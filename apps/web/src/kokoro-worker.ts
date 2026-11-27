// Kokoro makes speech here, off the page's thread, so the page keeps answering taps (Pause, Stop, barge-in) while it works.

import { env, KokoroTTS } from "kokoro-js";

type In = { type: "load" } | { type: "cancel" } | { type: "generate"; id: number; text: string; voice: string };
const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let tts: Promise<KokoroTTS> | undefined;
const queue: Extract<In, { type: "generate" }>[] = [];
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  for (let job; (job = queue.shift()); ) {
    try {
      const a = await (await tts!).generate(job.text, { voice: job.voice as never });
      const audio = a.audio as Float32Array;
      post({ type: "audio", id: job.id, audio, rate: a.sampling_rate }, [audio.buffer]);
    } catch (err) {
      post({ type: "failed", id: job.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  busy = false;
}

self.onmessage = async ({ data: m }: MessageEvent<In>) => {
  if (m.type === "cancel") queue.length = 0;
  if (m.type === "generate") (queue.push(m), void pump());
  if (m.type !== "load") return;
  // The bundler copies ONNX Runtime's .wasm but not the .mjs loader it imports next to it, so both come from the CDN.
  env.wasmPaths = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/";
  // q8 on WASM: ~90 MB and runs everywhere, iPhone included. WebGPU needs the 326 MB fp32 model, too big for a phone tab.
  tts ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx")) post({ type: "progress", pct: Math.round(p.progress ?? 0) });
    },
  } as never);
  try {
    await tts;
    post({ type: "ready" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
