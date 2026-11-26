Review of c1393b1..d8eb763. `npm test`: all 73 pass. `npx tsc -p .`: clean. I made no edits and called no APIs.

**Claimed fixes**
- **R5-M1: Fixed.** The summary is now asked for 0.25×compactAt words, which is 7,500 words (about 10K tokens) on the claude profile, under the 16K cap. Summarizer calls set no effort/thinking, so nothing else eats into the cap. There's a test for it.
- **R5-M2: Fixed.** The stand-in summary is now as long as asked (the old 2,500 cap is gone) and is billed at max(2500, 1.4×asked) tokens. The estimate's judge now replies "yes", so the new judge check doesn't turn every estimate into errors. There's a test for the floor and ceiling.
- **R5-L1: Fixed.** cli.ts:165 refuses before anything runs when maxToolRounds > 0. No test covers this.
- **R5-L2: Fixed for the default out dir.** `git check-ignore` confirms `evals/results/smoke/*/pending/` matches, and no pending files are tracked. A custom `--out` path isn't covered (low).
- **R5-L3: Fixed.** isOutage covers 401/402/403/408/429/499 and ≥500. Tests cover 401 and 408. Timeouts on the SDK side are still caught by the `APIConnection*` name check.
- **R5-L4: Fixed.** judge.ts:48 throws a BilledError. answerOne (run.ts:68) pushes the judge call with its cost, marks the answer as an error rather than an outage, and keeps the reader's answer. All committed subagent judge answers start with yes or no, so replays don't break.
- **Outage averages: Fixed.** Every per-question average now divides by the scored answers only. totalCost still sums every answer, and contextTokens uses scored answers without errors. There's a test for it.

**New problems:** none high or medium.

**One low one, partly older:** estimate.ts:24 takes the *first* "at most N words" in the whole message JSON. A LongMemEval chat inside `pending` that contains that phrase would set the stand-in summary's length. Before this commit the 2,500 cap bounded the damage; now nothing does. Taking the last match would fix it.

Not checked: real API behaviour, and whether 403 can also mean a content/permission refusal that should count as a wrong answer instead of an outage.
