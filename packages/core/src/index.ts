// @long-con/core: the engine every front end shares.
export type { Session, Turn, TurnRef } from "./chat.ts";
export { buildPacket, searchHistory, searchUnits, HISTORY_NOTICE, TRUST_NOTE, type Packet, type PacketSegment, type BuildPacketInput } from "./packet.ts";
export { assemblePrompt, type AssembledPrompt, type PromptParts } from "./prompt.ts";
export { PROFILES, profileByName, type Profile } from "./profiles.ts";
export { Bm25, type Hit } from "./bm25.ts";
export { splitIntoSegments, splitTurn, type Segment } from "./segments.ts";
export { contentWords, estimateTokens } from "./text.ts";
export type { Resolution } from "./resolver.ts";
export { SymbolIndex, indexSource, identifiersIn, lookupSymbols, type SymbolDef, type SymbolKind, type SymbolLookup, type SymbolBudget, type SourceFile } from "./symbols.ts";
export { UNIT_FEATURES, UNIT_WEIGHTS, unitProbability } from "./gate.ts";
