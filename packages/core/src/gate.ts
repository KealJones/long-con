// Unit gate (backlog P03): a small logistic model gives each candidate unit a probability that it holds evidence, from
// numbers the search already has. Units under the profile's threshold stay out. Weights are fitted offline on the dev
// slice by evals/loop/fit-gate.ts and pasted here; nothing trains at run time.

/** Feature names in the order the weights use. Every one comes from the history and the message alone. */
export const UNIT_FEATURES = [
  "absolute", // the unit's best BM25 score as a share of the most any unit could score on the query
  "topAbsolute", // the best unit's absolute score for this query (P02's bar, as a feature)
  "relative", // the unit's score as a share of the top score in either ranking
  "rankAll", // 1 / (1 + rank) in the all-words ranking, 0 when absent
  "rankUser", // 1 / (1 + rank) in the user-words ranking, 0 when absent
  "agreement", // overlap of the two rankings' top 5, over 5
  "idfCoverage", // IDF of the matched query words over IDF of all query words
  "matchedShare", // matched query words over query words
  "logLength", // log of the unit's indexed word count
  "logQueryLength", // log of 1 + the query's distinct content words
] as const;

/** Intercept, then one weight per feature, on raw (unscaled) features. */
// Fitted on all 1,394 dev probes (36,950 candidates, 76 evidence); leave-one-type-out AUROC 0.943 (0.873 on answerable).
export const UNIT_WEIGHTS: readonly number[] = [-7.9989, 3.0009, 1.3122, 0.1471, 1.0944, 2.2369, 1.5608, 1.2703, 0.5443, -0.2486, 0.9476];

export function unitProbability(features: readonly number[], weights: readonly number[] = UNIT_WEIGHTS): number {
  let z = weights[0]!;
  for (let i = 0; i < features.length; i++) z += weights[i + 1]! * features[i]!;
  return 1 / (1 + Math.exp(-z));
}
