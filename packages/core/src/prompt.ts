// Assembles what the model is sent, in the fixed order that keeps the cached prefix stable:
// system prompt and tools, then the packet, then the recent turns, then the new message.

import type { Turn } from "./chat.ts";
import { buildPacket, type BuildPacketInput, type Packet } from "./packet.ts";

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

/** A packet that found nothing older is only its one-line notice. */
export const packetEmpty = (text: string) => !text.includes("\n");

/** The search tool's definition, the same in every entry point; searchHistory runs it. */
export const SEARCH_TOOL = {
  name: "search_history",
  description: "Search all past chats with the user. Returns the best-matching passages with their dates.",
  input_schema: { type: "object" as const, properties: { query: { type: "string", description: "What to look for" } }, required: ["query"] },
};

export interface MessagePromptInput extends BuildPacketInput {
  system: string;
  /** The text the model gets for the message, when it isn't the message itself (the evals add the question's date). */
  sendAs?: string;
  /** A note added to the end of the packet, like the web chat's list of open side threads. */
  note?: string;
}

/**
 * One message's prompt, the same code for every entry point: build the packet, leave it out when it found nothing
 * older, then the recent turns and the message. `sent` is the packet text the model saw ("" for none).
 */
export function messagePrompt({ system, sendAs, note, ...input }: MessagePromptInput): { packet: Packet; sent: string; prompt: AssembledPrompt } {
  const packet = buildPacket(input);
  const sent = [packetEmpty(packet.text) ? "" : packet.text, note ?? ""].filter(Boolean).join("\n\n");
  const prompt = assemblePrompt({ system, packet: sent, recentTurns: packet.recentTurns, message: sendAs ?? input.message });
  if (!sent) prompt.messages.shift();
  return { packet, sent, prompt };
}
