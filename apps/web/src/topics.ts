// What the user talks about most, as plain words, for the sidebar.
// shortcut: word counts over the user's turns; swap for core's multi-label topics once they exist.

import { contentWords, type Session } from "@long-con/core";

export function topics(history: Session[], limit = 24): { word: string; count: number }[] {
  // Counted by stem so "dog" and "dogs" add up, shown as the form used most.
  const byStem = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const s of history)
    for (const t of s.turns) {
      if (t.role !== "user") continue;
      for (const raw of t.content.toLowerCase().match(/[a-z][a-z0-9']{2,}/g) ?? []) {
        const stem = contentWords(raw)[0];
        if (!stem) continue;
        const entry = byStem.get(stem) ?? { count: 0, forms: new Map() };
        entry.count++;
        entry.forms.set(raw, (entry.forms.get(raw) ?? 0) + 1);
        byStem.set(stem, entry);
      }
    }
  return [...byStem.values()]
    .map(({ count, forms }) => ({ word: [...forms].sort((a, b) => b[1] - a[1])[0]![0], count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/** "Today", "Yesterday", or "Wed, Nov 25" for a session id like "2026/11/25 (Wed)". */
export function dayName(id: string, now = new Date()): string {
  const m = id.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return id;
  const day = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(day.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}
