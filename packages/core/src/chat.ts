// The minimal chat shape the packet builder reads.
// This is not the append-only log format: that gets designed and reviewed by hand before code depends on it.
// Any log can be turned into this shape, so the builder doesn't care where history lives.

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  id: string;
  /** When the session happened, as the source wrote it. Shown to the model next to retrieved history. */
  date?: string;
  turns: Turn[];
}

/** A stable pointer to one turn. */
export interface TurnRef {
  sessionId: string;
  turn: number;
}
