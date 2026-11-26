// Plain BM25. The keyword half of the planned hybrid search; the embedding half comes later.

export interface Hit<T> {
  item: T;
  score: number;
  matched: string[];
}

export class Bm25<T> {
  private docs: { item: T; tf: Map<string, number>; length: number }[] = [];
  private df = new Map<string, number>();
  private totalLength = 0;

  private k1 = 1.2;
  private b = 0.75;

  add(item: T, words: string[]): void {
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.docs.push({ item, tf, length: words.length });
    this.totalLength += words.length;
  }

  search(query: string[], limit = Infinity): Hit<T>[] {
    const n = this.docs.length;
    if (n === 0) return [];
    const avg = this.totalLength / n || 1;
    const terms = [...new Set(query)];
    const hits: Hit<T>[] = [];
    for (const doc of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const t of terms) {
        const f = doc.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t)!;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * doc.length) / avg));
        matched.push(t);
      }
      if (score > 0) hits.push({ item: doc.item, score, matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}
