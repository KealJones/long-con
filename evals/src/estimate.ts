// A stand-in model that answers instantly and bills what a real call would, so a dry run of the
// real harness gives a cost estimate before any money is spent.

import { estimateTokens } from "@long-con/core";
import type { ModelClient, ModelRequest, ModelResponse } from "./model.ts";

// Rough output sizes, thinking included. Deliberately on the high side.
const OUTPUT: Record<ModelRequest["purpose"], number> = { reader: 800, summarizer: 2500, judge: 150 };

export class EstimatingModel implements ModelClient {
  /** True: the reader uses every search it's allowed, so the estimate is a ceiling. False: it never searches. */
  searches: boolean;
  constructor(searches = true) {
    this.searches = searches;
  }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const input = estimateTokens(req.system + JSON.stringify(req.messages) + (req.tools ? JSON.stringify(req.tools) : ""));
    if (this.searches && req.tools && req.toolChoice !== "none") {
      const tool = { id: "estimate", name: req.tools[0]!.name, input: { query: lastUserText(req) } };
      return { text: "", toolCalls: [tool], content: [{ type: "tool_use", ...tool }], usage: { input, output: 100 }, latencyMs: 0 };
    }
    // A summary of realistic length, so later summarizer calls are sized right.
    // A summary as long as it's asked to be, so later folds are sized and billed as a real run's.
    // The last match: the instruction follows the chats, which could contain the same words.
    const asked = Number([...JSON.stringify(req.messages).matchAll(/at most (\d+) words/g)].at(-1)?.[1] ?? 0);
    const text = req.purpose === "summarizer" ? "summary ".repeat(asked) : req.purpose === "judge" ? "yes" : "estimate";
    const output = req.purpose === "summarizer" ? Math.max(OUTPUT.summarizer, Math.round(asked * 1.4)) : OUTPUT[req.purpose];
    return { text, toolCalls: [], content: [{ type: "text", text }], usage: { input, output }, latencyMs: 0 };
  }
}

/** The question, which ends the last plain user message in every arm, so every search has a real query and bills real results. */
function lastUserText(req: ModelRequest): string {
  // packet-tools puts the question in a text block after a tool_result, so block contents count too.
  const texts = req.messages.filter((m) => m.role === "user").flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((b) => (b.type === "text" ? [b.text] : []))));
  return (texts.at(-1) ?? "").slice(-500);
}
