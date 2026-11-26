// Per-model settings. Defaults are starting points; the evals sweep them per model.

export interface Profile {
  name: string;
  /** The model's whole context window in tokens: prompt, packet, recent turns, tool results and answer. */
  contextWindow: number;
  /** History size in tokens before packets replace the plain chat. Below it the model gets the whole chat. */
  switchAt: number;
  /** Ceiling on the packet, rules and registers included. A ceiling, not a target: see minConfidence. */
  packetTokens: number;
  /**
   * Retrieved units scoring below this share of the best match stay out, even with budget left,
   * so the packet is the smallest one that still has what's needed. 0 always fills to the ceiling.
   */
  minConfidence: number;
  /** Recent turns of the current session that ride along raw, outside the packet. */
  rawTurns: number;
  /** Hard cap on one retrieved unit. A longer turn is split at paragraph breaks. */
  segmentTokens: number;
  /** How many of the model's own latest answers in this chat go in the registers. */
  recentAnswers: number;
  /** Whether a per-turn gate can skip retrieval for messages that need none, like "thanks". */
  gate: boolean;
  /** The fixed "this is a best guess" line. Tested on and off per model. */
  trustNote: boolean;
  /** Searches the model may run per turn. 0 gives it no search tool. */
  maxToolRounds: number;
  /** Units one search returns. */
  searchResults: number;
  /** Room kept for the model's answer, thinking included. */
  answerTokens: number;
  /** The compaction baseline folds history into a summary once the transcript passes this. */
  compactAt: number;
}

export const PROFILES = {
  claude: {
    name: "claude",
    // shortcut: 200K is the common Claude window; set per model once the reader ladder runs other Claude models.
    contextWindow: 200_000,
    // Packets only save money once history passes roughly 80-100K tokens, given prompt caching.
    switchAt: 80_000,
    packetTokens: 8000,
    minConfidence: 0.3,
    rawTurns: 6,
    // Small units beat whole exchanges at every budget on the dev slice (evals/results). 400 keeps a short
    // question and answer together; smaller still scored a little higher on a benchmark whose facts sit in user turns.
    segmentTokens: 400,
    recentAnswers: 2,
    gate: true,
    trustNote: true,
    maxToolRounds: 3,
    searchResults: 3,
    answerTokens: 4000,
    compactAt: 30_000,
  },
  // LFM3 1.7B in the browser, with about 6K tokens of context to spend.
  smallLocal: {
    name: "small-local",
    contextWindow: 6000,
    // Small models fall apart on long context, so packets take over almost at once.
    switchAt: 2500,
    packetTokens: 2500,
    minConfidence: 0.3,
    rawTurns: 2,
    segmentTokens: 400,
    recentAnswers: 1,
    gate: true,
    trustNote: true,
    maxToolRounds: 1,
    searchResults: 1,
    answerTokens: 600,
    compactAt: 2500,
  },
} satisfies Record<string, Profile>;

export const profileByName = (name: string): Profile | undefined => Object.values(PROFILES).find((p) => p.name === name);
