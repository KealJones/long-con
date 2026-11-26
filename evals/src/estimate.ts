// A stand-in model that answers instantly and bills what a real call would, so a dry run of the
// real harness gives a cost estimate before any money is spent.

import { estimateTokens } from "@long-con/core";
import type { ModelClient, ModelRequest, ModelResponse } from "./model.ts";

// Rough output sizes, thinking included. Deliberately on the high side.
const OUTPUT: Record<ModelRequest["purpose"], number> = { reader: 800, summarizer: 2500, judge: 150 };

export class EstimatingModel implements ModelClient {
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const input = estimateTokens(req.system + JSON.stringify(req.messages) + (req.tools ? JSON.stringify(req.tools) : ""));
    // Assume the reader searches once whenever it can, the costly case.
    const searched = req.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
    if (req.tools && !searched) {
      const tool = { id: "estimate", name: req.tools[0]!.name, input: { query: lastUserText(req) } };
      return { text: "", toolCalls: [tool], content: [{ type: "tool_use", ...tool }], usage: { input, output: 100 }, latencyMs: 0 };
    }
    // A summary of realistic length, so later summarizer calls are sized right.
    const text = req.purpose === "summarizer" ? "summary ".repeat(OUTPUT.summarizer) : "estimate";
    return { text, toolCalls: [], content: [{ type: "text", text }], usage: { input, output: OUTPUT[req.purpose] }, latencyMs: 0 };
  }
}

function lastUserText(req: ModelRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  return typeof last?.content === "string" ? last.content : "";
}
