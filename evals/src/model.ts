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
}

export interface ModelResponse {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  /** The raw blocks, passed back unchanged on the next call of a tool loop. */
  content: Anthropic.ContentBlockParam[];
  usage: { input: number; output: number };
  latencyMs: number;
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** USD per million tokens. Haiku 5.5 bills more once a prompt passes 100K tokens. */
export const PRICES: Record<string, { input: number; output: number; longAbove?: number; longInput?: number; longOutput?: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longAbove: 100_000, longInput: 0.5, longOutput: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function costOf(model: string, usage: { input: number; output: number }): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for ${model}; add it to PRICES in evals/src/model.ts`);
  const long = p.longAbove !== undefined && usage.input > p.longAbove;
  return (usage.input * (long ? p.longInput! : p.input) + usage.output * (long ? p.longOutput! : p.output)) / 1e6;
}

export class AnthropicModel implements ModelClient {
  private client = new Anthropic();

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.tools ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: { type: req.toolChoice } } : {}),
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    });
    if (res.stop_reason === "refusal") throw new Error(`${req.model} declined the request`);
    if (res.stop_reason === "max_tokens") throw new Error(`${req.model} ran out of output tokens (${req.maxTokens}) before answering`);
    return {
      text: res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim(),
      toolCalls: res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [])),
      content: res.content as Anthropic.ContentBlockParam[],
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      latencyMs: Date.now() - started,
    };
  }
}
