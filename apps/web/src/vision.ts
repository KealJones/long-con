// The ask_image tool for models that can't see (core's ASK_IMAGE_TOOL): SmolVLM-256M answers questions about an
// attached image, in the browser. Loads on first use, then stays in the browser's cache.

import type { ImageRef } from "@long-con/core";

/** The smallest SmolVLM: about 180 MB with these dtypes, small enough for a phone tab. 500M is ~2.5x the download. */
export const VISION_MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";
const DTYPES = { embed_tokens: "q8", vision_encoder: "q4", decoder_model_merged: "q4" } as const;

export type AskImage = (image: Blob, question: string) => Promise<string>;

let loaded: Promise<AskImage> | undefined;
// One generate at a time: two at once on the same model session can clash.
let queue: Promise<unknown> = Promise.resolve();

/** Loads once per page. WebGPU when the device has it, WASM otherwise. A failed load is retried on the next call. */
export function loadVision(onProgress?: (pct: number) => void): Promise<AskImage> {
  return (loaded ??= (async () => {
    const { AutoProcessor, AutoModelForVision2Seq, RawImage, env } = await import("@huggingface/transformers");
    // The bundler copies ONNX Runtime's .wasm but not the .mjs loader next to it, so both come from the CDN (as in voice).
    env.backends.onnx.wasm!.wasmPaths = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/";
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const device = (await gpu?.requestAdapter().catch(() => null)) ? "webgpu" : "wasm";
    const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx")) onProgress?.(Math.round(p.progress ?? 0));
    };
    const processor = await AutoProcessor.from_pretrained(VISION_MODEL, {});
    const model = await AutoModelForVision2Seq.from_pretrained(VISION_MODEL, { dtype: DTYPES, device, progress_callback });

    return (image: Blob, question: string) => {
      const run = queue.then(async () => {
        const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: question }] }];
        const text = processor.apply_chat_template(messages as never, { add_generation_prompt: true });
        const inputs = await processor(text, [await RawImage.fromBlob(image)], { do_image_splitting: false });
        const out = (await model.generate({ ...inputs, max_new_tokens: 200 })) as { slice(...a: unknown[]): unknown };
        const [answer] = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]) as never, { skip_special_tokens: true });
        return String(answer ?? "");
      });
      queue = run.catch(() => {});
      return run;
    };
  })().catch((err) => {
    loaded = undefined;
    throw err;
  }));
}

/** Attached images by id. The "+" button fills this; ToolContext.images carries it to the tool. */
export type AttachedImages = ReadonlyMap<string, { ref: ImageRef; blob: Blob }>;

export interface ToolAnswer {
  text: string;
  isError: boolean;
}

/** Runs one ask_image call. Bad input and failures come back as an error result for the model, never a throw. */
export async function runAskImage(
  input: Record<string, unknown>,
  images: AttachedImages,
  ask: () => Promise<AskImage> = loadVision,
): Promise<ToolAnswer> {
  const { image_id, question } = input;
  if (typeof question !== "string" || !question.trim()) return { text: "ask_image needs a question.", isError: true };
  const image = typeof image_id === "string" ? images.get(image_id) : undefined;
  if (!image) return { text: `No attached image with id ${JSON.stringify(image_id)}. Attached: ${[...images.keys()].join(", ") || "none"}.`, isError: true };
  try {
    const answer = (await (await ask())(image.blob, question)).trim();
    return answer ? { text: answer, isError: false } : { text: "The vision model gave no answer.", isError: true };
  } catch (err) {
    return { text: `The vision model failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
