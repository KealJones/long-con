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

  /** length overrides the document length BM25 normalizes by (a denoised key judged at its full text's length). */
  add(item: T, words: string[], length = words.length): void {
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.docs.push({ item, tf, length });
    this.totalLength += length;
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
        score += (this.idf(t) * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * doc.length) / avg));
        matched.push(t);
      }
      if (score > 0) hits.push({ item: doc.item, score, matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}

/**
 * BM25F (Robertson, Zaragoza & Taylor 2004): each field's term frequency is length-normalized with its own b, weighted,
 * and summed before one saturation, so a word said in a heavy field counts for more than the same word elsewhere.
 * IDF is over whole documents. The ceiling matches Bm25's, so score ÷ ceiling stays absolute.
 */
export class Bm25F<T> {
  private docs: { item: T; tf: Map<string, number>[]; length: number[] }[] = [];
  private df = new Map<string, number>();
  private totals: number[];
  private k1 = 1.2;
  private weights: readonly number[];
  private b: readonly number[];

  constructor(weights: readonly number[], b: readonly number[]) {
    this.weights = weights;
    this.b = b;
    this.totals = weights.map(() => 0);
  }

  /** One word list per field, in the order of the weights. */
  add(item: T, fields: string[][]): void {
    const tf = fields.map((words) => {
      const m = new Map<string, number>();
      for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
      return m;
    });
    for (const w of new Set(fields.flat())) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.docs.push({ item, tf, length: fields.map((f) => f.length) });
    fields.forEach((f, i) => (this.totals[i]! += f.length));
  }

  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  ceiling(query: string[]): number {
    return [...new Set(query)].reduce((sum, t) => sum + this.idf(t) * (this.k1 + 1), 0);
  }

  search(query: string[], limit = Infinity): Hit<T>[] {
    const n = this.docs.length;
    if (n === 0) return [];
    const avg = this.totals.map((t) => t / n || 1);
    const terms = [...new Set(query)];
    const hits: Hit<T>[] = [];
    for (const doc of this.docs) {
      const norm = doc.length.map((len, i) => 1 - this.b[i]! + (this.b[i]! * len) / avg[i]!);
      let score = 0;
      const matched: string[] = [];
      for (const t of terms) {
        let tf = 0;
        doc.tf.forEach((m, i) => (tf += (this.weights[i]! * (m.get(t) ?? 0)) / norm[i]!));
        if (!tf) continue;
        score += (this.idf(t) * tf * (this.k1 + 1)) / (tf + this.k1);
        matched.push(t);
      }
      if (score > 0) hits.push({ item: doc.item, score, matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}
