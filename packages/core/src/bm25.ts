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

  /** Rarity of a word in this index. A word in no unit gets the highest value. */
  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** The most any unit could score on these words (every word matched, at saturation), so score ÷ ceiling is absolute. */
  ceiling(query: string[]): number {
    return [...new Set(query)].reduce((sum, t) => sum + this.idf(t) * (this.k1 + 1), 0);
  }

  /**
   * With `alt`, a query word a unit lacks can be stood in for by one of its alternatives (expand.ts), scored at `weight`
   * with the lower of the two IDFs, so a stand-in never counts for more than the word itself. It is reported as the word.
   */
  search(query: string[], limit = Infinity, alt?: { of: Map<string, string[]>; weight: number }): Hit<T>[] {
    const n = this.docs.length;
    if (n === 0) return [];
    const avg = this.totalLength / n || 1;
    const terms = [...new Set(query)];
    const hits: Hit<T>[] = [];
    for (const doc of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const t of terms) {
        const idf = this.idf(t);
        let f = doc.tf.get(t);
        let w = idf;
        if (!f && alt) {
          for (const m of alt.of.get(t) ?? []) {
            const g = doc.tf.get(m);
            if (g && g > (f ?? 0)) [f, w] = [g, alt.weight * Math.min(idf, this.idf(m))];
          }
        }
        if (!f) continue;
        score += (w * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * doc.length) / avg));
        matched.push(t);
      }
      if (score > 0) hits.push({ item: doc.item, score, matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}
