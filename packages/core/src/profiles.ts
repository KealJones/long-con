// Per-model settings. Defaults are starting points; the evals sweep them per model.

import type { KeyDenoise } from "./segments.ts";
import type { Stemmer } from "./text.ts";

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
  /** Unit gate (gate.ts): units whose probability of holding evidence is under this stay out. 0 turns it off. */
  unitGate: number;
  /** Gate weights; the shipped UNIT_WEIGHTS when absent. Evals pass cross-validated folds here. */
  unitWeights?: readonly number[];
  /**
   * Pointer tier (P15): units the unit gate lets in with a probability under this come in as a one-line pointer (date,
   * opening words, a search_history query that brings the unit back) instead of whole. Needs a search tool. 0 turns it off.
   */
  pointerGate: number;
  /** Most pointers in one packet; medium units past it stay out. */
  maxPointers: number;
  /** How search stems words (see text.ts). minScore depends on it: a stemmer that matches more words lifts every score. */
  stemmer: Stemmer;
  /** P26: denoise mode (segments.ts) for the text the absolute score and the gate judge; ranking keeps the full text. */
  gateKey?: KeyDenoise;
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
  /** The model2vec model the embedding gate was tuned with; the caller loads it and passes `embed` to buildPacket. */
  embedModel?: string;
  /** Which cosine the embedding gate uses when the caller passes an embedder: the whole unit's, or its best turn's. Absent: off. */
  embedSim?: "segment" | "maxsim";
  /** Embedding veto: a unit the gate kept stays out when its cosine to the message is under this. 0 or absent: off. */
  embedFloor?: number;
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
    // P15 sweep on dev: units under 0.004 shrink to pointers, at most 3 (one per search round); whole all-evidence loses
    // a question, but every question stays readable through its pointers, with 12% fewer tokens. The FI cut on every tier
    // comes from the cap dropping medium units; with no cap FI matches the unit gate alone.
    pointerGate: 0.004,
    maxPointers: 3,
    // Porter matched more wrong units at every bar that kept recall (P17 sweep), so claude keeps the suffix stripper.
    stemmer: "suffix",
    // P26 on the gate only: the bar and the gate judge units with stock assistant sentences dropped, at the full text's
    // length; ranking keeps the full text. Same recall, fewer tokens, fewer false inclusions on every tier. Without
    // "fulllen" the shorter keys scored higher and tier 2 gained a unit. The bar stays (0.18 loses a question, 0.16 adds FI).
    gateKey: "boilerplate+fulllen+matched",
    // Embedding veto (evals/loop/embed-gate.ts dev sweep): a gate-kept unit whose best turn's cosine to the message is
    // under 0.25 stays out. Every recall row holds, about 21% fewer tokens, 33-52% fewer false inclusions per tier; 0.3
    // loses two questions. potion-base-8M beat potion-retrieval-32M here (32M lost a preference question above 0.09).
    // Only applies when the caller passes `embed`; without one, packets are unchanged.
    embedModel: "potion-base-8M",
    embedSim: "maxsim",
    embedFloor: 0.25,
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
    // Off. Recorded option (P15 dev sweep): 0.05 with no cap halves packet tokens (1,425 -> 752) at the same false
    // inclusions, but whole all-evidence falls 66.0 -> 46.8% (63.8% readable in one search), a bet that a 1.7B model runs
    // the pointer search. Not taken until a reader run shows it does. Any cap cost more readable recall than it saved.
    pointerGate: 0,
    maxPointers: Infinity,
    // P17 sweep, with the tally and unit gates on: Porter stemming finds two more dev questions at bars 0.20 to 0.24 and
    // the bar cuts false inclusions; only 0.25 adds none on any tier (+1 question, 6% fewer tokens). 0.25 is the cliff
    // (0.26 untested, 0.24 keeps a second question but adds tier-3 FI), and 7 of 47 answerable packets come back empty.
    // Two-word queries where one word never matches ("concerts ... this year") come back empty at this bar.
    minScore: 0.25,
    stemmer: "porter",
    // No gateKey: at 0.25 it added tokens and tier-3 false inclusions, and 0.26 loses a question (P26 gate-key sweep).
    // Embedding veto, as on claude but with potion-retrieval-32M: 0.2 holds every recall row with 10% fewer tokens and
    // 47-66% fewer false inclusions per tier; 0.22 loses two questions. potion-base-8M needed 0.35 and lost a turn there.
    embedModel: "potion-retrieval-32M",
    embedSim: "maxsim",
    embedFloor: 0.2,
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
