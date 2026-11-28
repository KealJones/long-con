// A reader backend that runs on a Claude plan instead of an API key. The harness runs as usual, but each
// model call it hasn't seen is written to a pending folder and counted as not answered yet. Subagents
// answer the pending files; their answers go in the answers folder, keyed by the same hash, and the next
// pass picks them up. The harness's prompts are byte for byte an API run's, but the subagent also reads its own system
// prompt, its model is whatever the orchestrating session spawns (the reader and judge names only key the files), and
// nothing stops it reading other files. Results are anecdotes for checking the pipeline, not measurements.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient, ModelRequest, ModelResponse } from "./model.ts";
import { estimateTokens } from "@beep/core";

export class Pending extends Error {
  name = "Pending";
}

export class SubagentModel implements ModelClient {
  dir: string;
  constructor(dir: string) {
    this.dir = dir;
    // Each pass rewrites what it still needs, so stale prompts from earlier runs never pile up.
    rmSync(join(dir, "pending"), { recursive: true, force: true });
    mkdirSync(join(dir, "pending"), { recursive: true });
    mkdirSync(join(dir, "answers"), { recursive: true });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    if (req.tools && req.toolChoice !== "none") throw new Error("The subagent backend can't run tools; use --no-tools.");
    const prompt = render(req);
    const key = `${req.purpose}-${createHash("sha256").update(req.model + prompt + (req.seed ? `#${req.seed}` : "")).digest("hex").slice(0, 16)}`;
    const answer = join(this.dir, "answers", `${key}.txt`);
    if (!existsSync(answer)) {
      writeFileSync(join(this.dir, "pending", `${key}.txt`), prompt);
      throw new Pending(`waiting on ${key}`);
    }
    const text = readFileSync(answer, "utf8").trim();
    // Estimated, not billed: a subagent's real usage includes its own system prompt.
    return { text, toolCalls: [], content: [{ type: "text", text }], usage: { input: estimateTokens(prompt), output: estimateTokens(text) }, latencyMs: 0 };
  }
}

/** The request as one plain document a subagent reads: the system prompt, then each message in order. */
function render(req: ModelRequest): string {
  const body = req.messages.map((m) => `[${m.role}]\n${typeof m.content === "string" ? m.content : m.content.map(block).join("\n\n")}`).join("\n\n");
  return `[system]\n${req.system}\n\n${body}\n`;
}

/** Tool calls as plain lines (packet-tools sends one with --no-tools), so a subagent reads them as a transcript, not JSON. */
function block(b: Exclude<ModelRequest["messages"][number]["content"], string>[number]): string {
  if (b.type === "text") return b.text;
  if (b.type === "tool_use") return `(called ${b.name} with ${JSON.stringify(b.input)})`;
  if (b.type === "tool_result") return `(tool result)\n${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}`;
  return JSON.stringify(b);
}
