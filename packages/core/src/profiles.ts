// Per-model settings. Defaults are starting points; the evals sweep them per model.

export interface Profile {
  name: string;
  /** Total packet size in tokens, rules and registers included. */
  packetTokens: number;
  /** Recent turns of the current session that ride along raw, outside the packet. */
  rawTurns: number;
  /** Size cap for one retrieved unit of history. */
  segmentTokens: number;
  /** How many of the model's own latest answers go in the registers. */
  recentAnswers: number;
  /** Whether a per-turn gate can skip retrieval for messages that need none, like "thanks". */
  gate: boolean;
  /** The fixed "this is a best guess" line. Tested on and off per model. */
  trustNote: boolean;
}

export const PROFILES = {
  claude: {
    name: "claude",
    packetTokens: 8000,
    rawTurns: 6,
    segmentTokens: 1200,
    recentAnswers: 2,
    gate: true,
    trustNote: true,
  },
  smallLocal: {
    name: "small-local",
    packetTokens: 3000,
    rawTurns: 2,
    segmentTokens: 600,
    recentAnswers: 1,
    gate: true,
    trustNote: true,
  },
} satisfies Record<string, Profile>;
