// Assembles what the model is sent, in the fixed order that keeps the cached prefix stable:
// system prompt and tools, then the packet, then the recent turns, then the new message.

import type { Turn } from "./chat.ts";

export interface PromptParts {
  system: string;
  packet: string;
  recentTurns: Turn[];
  message: string;
}

export interface AssembledPrompt {
  system: string;
  messages: Turn[];
}

export function assemblePrompt({ system, packet, recentTurns, message }: PromptParts): AssembledPrompt {
  // Back-to-back turns from the same role are fine: the API joins them into one.
  return {
    system,
    messages: [{ role: "user", content: `<packet>\n${packet}\n</packet>` }, ...recentTurns, { role: "user", content: message }],
  };
}
