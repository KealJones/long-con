// The model behind each arm. Real runs go through the Anthropic SDK; tests and cost estimates swap in
// a stand-in with the same shape, so every arm runs the same code either way.

import Anthropic from "@anthropic-ai/sdk";

export interface ModelRequest {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  /** "none" keeps the tools defined (earlier tool turns need them) but lets the model only answer. */
  toolChoice?: "auto" | "none";
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** What the call is for, so costs and the estimate can be broken down. */
  purpose: "reader" | "summarizer" | "judge";
  /** Repeat number. The API ignores it (runs vary anyway); the subagent backend keys answers by it. */
  seed?: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  /** The raw blocks, passed back unchanged on the next call of a tool loop. */
  content: Anthropic.ContentBlockParam[];
  usage: { input: number; output: number };
  latencyMs: number;
}

/** A call that was billed but gave no usable answer. Carries its usage so the cost isn't lost. */
export class BilledError extends Error {
  usage: { input: number; output: number };
  latencyMs: number;
  constructor(message: string, usage: { input: number; output: number }, latencyMs: number) {
    super(message);
    this.usage = usage;
    this.latencyMs = latencyMs;
  }
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

// Prices live in core, so the evals, the CLI and the web chat bill the same way.
export { costOf, PRICES } from "@beep/core";

export class AnthropicModel implements ModelClient {
  // Retries rate limits and overloads with backoff, so they don't turn into wrong answers.
  private client: Pick<Anthropic, "messages">;
  constructor(client: Pick<Anthropic, "messages"> = new Anthropic({ maxRetries: 10 })) {
    this.client = client;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.tools ? { tools: req.tools } : {}),
      // One search per round, so the estimate's ceiling and the Searches column hold.
      ...(req.toolChoice ? { tool_choice: req.toolChoice === "auto" ? { type: "auto", disable_parallel_tool_use: true } : { type: req.toolChoice } } : {}),
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    });
    const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
    if (res.stop_reason === "refusal") throw new BilledError(`${req.model} declined the request`, usage, Date.now() - started);
    if (res.stop_reason === "max_tokens") throw new BilledError(`${req.model} ran out of output tokens (${req.maxTokens}) before answering`, usage, Date.now() - started);
    return {
      text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim(),
      toolCalls: res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [])),
      content: res.content as Anthropic.ContentBlockParam[],
      usage,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * A rate limit, overload, server error, timeout, refused key or lost connection that outlasted the retries: the API's failure, not the
 * model's answer, so it's left out of accuracy and reported apart instead of scored as wrong.
 */
export function isOutage(err: unknown): boolean {
  const { status, name } = (err ?? {}) as { status?: number; name?: string };
  // 401-403: the key was refused or ran out of credit; 408 and 499: the request timed out or was dropped.
  return [401, 402, 403, 408, 429, 499].includes(status ?? 0) || (status ?? 0) >= 500 || /^APIConnection/.test(name ?? "");
}
