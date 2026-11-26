// Per-model settings. Defaults are starting points; the evals sweep them per model.

import type { Stemmer } from "./text.ts";

export type BarCeiling = "all" | "filler" | "unseen";

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
  /**
   * Absolute bar: when no unit's BM25 score reaches this share of the most any unit could score on the query, the
   * packet retrieves nothing. minConfidence is relative, so without this the best weak match always gets in. 0 turns it off.
   */
  minScore: number;
  /** Which query words the absolute bar is judged on (packet.ts barTerms). "all" when absent. */
  barCeiling?: BarCeiling;
  /** Unit gate (gate.ts): units whose probability of holding evidence is under this stay out. 0 turns it off. */
  unitGate: number;
  /** Gate weights; the shipped UNIT_WEIGHTS when absent. Evals pass cross-validated folds here. */
  unitWeights?: readonly number[];
  /** How search stems words (see text.ts). minScore depends on it: a stemmer that matches more words lifts every score. */
  stemmer: Stemmer;
  /** Recent turns of the current session that ride along raw, outside the packet. */
  rawTurns: number;
  /** Hard cap on one retrieved unit. A longer turn is split at paragraph breaks. */
  segmentTokens: number;
  /** Most pieces a counting question brings in (tally mode, see tally.ts). 0 turns tally mode off. */
  tallyPieces: number;
  /**
   * Tally gate: a piece comes in only when some segment holding its turn reaches this unit-gate probability (gate.ts),
   * so counting questions face the same bar as whole segments. 0 turns it off.
   */
  tallyGate: number;
  /** Evals only: judge pieces by a logistic over all of TALLY_FEATURES with these weights instead (fit-tally-gate.ts). */
  tallyWeights?: readonly number[];
  /**
   * Interest notes (notes.ts) come in when they cover at least this share of the message's IDF weight, and only
   * when the absolute bar already let history in. 0 turns notes off.
   */
  noteCoverage: number;
  /** How many of the model's own latest answers in this chat go in the registers. */
  recentAnswers: number;
  /** Whether a per-turn gate can skip retrieval for messages that need none, like "thanks". */
  gate: boolean;
  /** The fixed "this is a best guess" line. Tested on and off per model. */
  trustNote: boolean;
  /** The standing-rules register in the packet's head. On unless set false; the eval's packet-norules arm turns it off. */
  standingRules?: boolean;
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
    // Highest bar with no all-evidence loss on the dev slice; 0.18 drops a question (P02 sweep).
    minScore: 0.17,
    // Highest unit-gate threshold with no all-evidence loss in leave-one-type-out CV; 0.004 loses one question for half the FI (P03 sweep).
    unitGate: 0.002,
    // Porter matched more wrong units at every bar that kept recall (P17 sweep), so claude keeps the suffix stripper.
    stemmer: "suffix",
    rawTurns: 6,
    // Small units beat whole exchanges at every budget on the dev slice (evals/results). 400 keeps a short
    // question and answer together; smaller still scored a little higher on a benchmark whose facts sit in user turns.
    segmentTokens: 400,
    tallyPieces: Infinity,
    // The unit gate's own threshold, so no new tuned number (fit-tally-gate.ts sweep: any higher bar loses a multi-session question).
    tallyGate: 0.002,
    noteCoverage: 0.5,
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
    // CV sweep: one question for about half the false inclusions; 0.013 loses three. Keeps minScore, which the gate doesn't replace.
    unitGate: 0.01,
    // P17 sweep, with the tally and unit gates on: Porter stemming finds two more dev questions at bars 0.20 to 0.24 and
    // the bar cuts false inclusions; only 0.25 adds none on any tier (+1 question, 6% fewer tokens). 0.25 is the cliff
    // (0.24 keeps a second question but adds tier-3 FI). Then the bar was judged without time and filler words, which
    // fills "how many days ago..." packets; at 0.25 that added false inclusions on tiers 1t-3, and 0.27 is the bar that
    // holds all-evidence with 5% fewer tokens and a third fewer tier-1 FI (tier 2 +1 unit in 50 prompts; filler sweep).
    // Applied to counting and "how long ago" questions only (barFor), 0.27 still adds that tier-2 unit.
    // Claude keeps "all": every filler setting lost a question there, since "past three months" can be the evidence.
    minScore: 0.27,
    barCeiling: "filler",
    stemmer: "porter",
    rawTurns: 2,
    segmentTokens: 400,
    // Ungated, every cap that kept its recall gain added wrong pieces (P06). Behind the tally gate it holds recall with
    // fewer tokens and fewer false inclusions (fit-tally-gate.ts sweep).
    tallyPieces: Infinity,
    tallyGate: 0.01,
    noteCoverage: 0.5,
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
