# Sprint 9 refinement: the last bulk-approval gaps

Refined 25 October 2026, for Rory's sign-off before building. Backlog: `docs/BACKLOG.md` (Sprint 9 proposed at the Sprint 8 review). The bulk-approval rule holds with the checker configured; this sprint makes it hold in every configuration, settles two items the data now answers, and (if Rory agrees) tests the one safety figure that has never been tested against failure.

## What refinement found

- **F-40 is real and has no safe threshold.** With no checker configured, confidence comes from similarity alone. Cross-validated, near misses at or above the bulk line: 4 of 33 at 80%, 3 at 90%, and still 1 at 95% (`docs/evals/calibration-2026-10-25.json`). No threshold gets similarity-only confidence to zero near misses, so the only rule that meets the Sprint 8 bar is to hold these questions from bulk approval.
- **F-41's premise does not hold on the data.** Of 267 "yes" verdicts (voyage-4 + checker), the 6 with similarity below 0.40 were all right; 5 of the 18 wrong ones are between 0.40 and 0.45 (23% wrong, the highest rate of any band), and the rest are spread above (7 of 160 above 0.55); none was a near miss or an unanswerable question. A floor at 0.40 would hold right answers only; a floor at 0.45 would hold 28 questions, 23 of them right (82%, close to the 85% the app gives them). The 85% given to a weak "yes" is the pooled rate of its step (Sprint 8 bands: 34 questions), which the tooltip now shows. *(Corrected after the security review: the first version said the wrong ones were spread across every band and that a floor would catch none.)*
- **F-35 cannot be improved by moving the threshold.** A sweep over the saved answerability results reproduces the published figure (0.55: 1.9% wrong supersessions, 53.0% of real duplicates caught) and shows the trade-off is fixed: 0.50 catches 70.3% but makes 3.6% wrong; 0.45 catches 82.3% at 4.7%. Requiring "yes" rather than "yes or partly" does not help (0.55: 1.9%, 51.0%). Every setting that catches more breaks the 2% bar. A missed duplicate adds an entry beside the old one; a wrong supersession replaces a good entry, so the bar is the right way round.
- **F-19 is the one published safety figure never tested against failure.** Faithfulness is "100% of 305 claims", judged by a model that has only ever seen faithful drafts (9 of 9 agreed with Rory's review in Sprint 2). Nobody knows whether it would catch an unfaithful one.

## Stories

### S9-1 Questions calibrated on similarity alone are never bulk-approved (F-40)

**The job.** In a set-up with no checker, bulk approval cannot accept a near miss, because it accepts nothing on similarity alone.

**Before and after.** Today: with no checker configured, a drafted question at 80% or more on similarity alone is approved in bulk (5 of 33 near misses reach 80% in sample). After: bulk approval needs the checker's "yes" in every configuration; without a checker, every question is accepted one at a time, and the card and bulk bar say why.

**What changes.** A migration: `bulk_accept` accepts only `verdict = 'yes'`, and counts similarity-only questions as `heldNoChecker`. `bulkEligible` in `src/workspace/questionRows.ts`, `bulkHoldReason` and `describeBulk` to match. README, architecture page, model card and risk register R-12: the "(or no checker configured)" exception removed.

**Test cases.**
1. Database: a drafted, ungated question at 90% with no verdict and no checker model is not accepted by `bulk_accept` and is counted as `heldNoChecker`.
2. Database: "yes" is still accepted; "partly", "no" and a reranker's score without a verdict are still held and counted as before.
3. Database: a similarity-only question can still be accepted individually by the owner.
4. Screen: `bulkEligible` is false for it; the card says "Not included in bulk approval: no checker is configured, so confidence comes from similarity alone."
5. The bulk summary names the count: "2 held because no checker is configured (accept them individually)".

**Out of scope.** Changing how similarity-only confidence is calibrated.

**Boundaries.** Tightens project rule 4 (human in the loop); no data, no API.

**Size.** S.

### S9-2 F-41 and F-35 decided on the evidence

**The job.** Two open items close with their evidence recorded, so the backlog and the risk register no longer carry worries the data does not support, and the residuals that remain are stated plainly.

**What changes.** `eval/run-duplicates.ts` gains a threshold sweep table (no API calls; the evidence above becomes reproducible). The model card and R-10, R-12 updated as Q2 and Q3 decide. If Q2 chooses a floor, it is added to `bulk_accept` with tests, as S9-1's.

**Test cases.** 1. The sweep reproduces the published row (0.55: 1.9%, 53.0%). 2. The docs tests pass on the updated pages. (Plus S9-1's pattern if Q2 chooses a floor.)

**Size.** S.

### S9-3 The faithfulness checker tested on unfaithful drafts (F-19, if Q4 agrees)

**The job.** Know whether the faithfulness judge catches a draft that says something its sources do not, so "100% of 305 claims" means something.

**What changes.** `eval/run-faithfulness-plants.ts`: takes faithful drafts from the Sprint 6 drafting run and plants one unsupported claim in each by fixed rules in code, not by a model (a changed figure, an added certification, a widened scope, a changed retention period), then runs the same judge prompt. Report `docs/evals/faithfulness-plants-<date>.md` with the catch rate and its 95% interval, and a row in the evaluations summary.

**Test cases.**
1. Each plant rule changes exactly one claim and the result differs from the source text (unit tests on the rules).
2. Unchanged drafts are included as controls; the report gives false alarms on them too.
3. Bar (Q5): at least 90% of planted claims caught, with the interval stated; a miss is reported, not adjusted.
4. The summary row and its interval are checked by the docs test like the others.

**Risks.** Planted errors written by rules may be easier to catch than real ones; the report says so.

**Size.** M (a run on Rory's PC: about 100 judge calls, a few pence).

## Not in this sprint

C-1 multilingual knowledge base stays top of the backlog (large; its own sprint). F-14 and F-15 need outside reviewers. F-20 needs a Voyage payment method.

## The sprint as a whole

Order: S9-1 (quick, standalone), S9-2, then S9-3 last (needs Rory's run). Sizes: two S and one M; about two days. No spike.

## Questions for Rory

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | F-40 | (a) Hold every similarity-only question from bulk approval: without a checker there is no bulk approval. (b) Allow similarity-only bulk approval at 95% or more (still 1 of 33 near misses). (c) Leave it, as a stated residual | (a): only (a) meets the Sprint 8 bar, and the app is meant to run with the checker |
| Q2 | F-41 | (a) Close it on the evidence: no floor. (b) A similarity floor of 0.45 for bulk approval (holds 28 "yes" questions, of which 23 were right). (c) A floor of 0.40 (holds 6, all right) | (a): a floor would hold right answers and catch no wrong ones on this data |
| Q3 | F-35 | (a) Accept the 53% catch rate as a residual; the sweep goes in the report. (b) Lower the threshold to 0.50 (70% caught, 3.6% wrong, breaking the 2% bar). (c) Keep it open | (a): every setting that catches more makes more wrong replacements, and a wrong replacement costs more than a duplicate |
| Q4 | F-19 in this sprint | (a) Yes, as S9-3. (b) No, keep the sprint to S9-1 and S9-2 | (a): it is the published figure least tested, and it fits the sprint's size |
| Q5 | F-19 bar (if Q4 is yes) | (a) At least 90% of planted claims caught. (b) At least 95%. (c) Report only | (a): a clear bar that a small set can show, with the interval beside it |

## Answers (Rory, 25 October 2026)

| # | Answer |
|---|---|
| Q1 | Never bulk-approve a question calibrated on similarity alone: without a checker there is no bulk approval |
| Q2 | F-41 closed on the evidence: no similarity floor |
| Q3 | F-35 accepted as a residual (53% of real duplicates caught at 0.55, 1.9% wrong); the sweep goes in the duplicates report |
| Q4 | F-19 joins the sprint as S9-3 |
| Q5 | Bar for S9-3: at least 90% of planted claims caught, with the 95% interval stated |

All three stories are Ready.

## Changes during the build (for the review)

- **S9-3's plant rules differ from the refinement.** Built: changed frequency (only ever more frequent), changed figure (exact figures only: not a bound such as "within 4 hours", not either end of a range, not 1), added certification, absolute claim. "Widened scope" was dropped (no fixed rule makes a scope wider without risking a claim the sources still support) and "changed retention period" is covered by "changed figure". The script is `eval/run-plants.ts`.
- **Japanese drafts are not planted in**: the plants are English sentences, and a plant after the translation note would be skipped by the judge (security review, finding 1).
- **The unchanged drafts are judged again** in the run's own cache, so false alarms are measured rather than 0 by construction (finding 2).
- **The bar is checked for each rule as well as overall**, and each rule has its own interval (finding 3): two rules are the same sentence added to every draft, so the overall figure alone would say more than was tested. This is stricter than Q5's "at least 90% of planted claims"; Rory can return it to overall only.
