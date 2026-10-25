# Sprint 8 refinement: honest figures

Refined 25 October 2026, for Rory's sign-off before building. Backlog: `docs/BACKLOG.md` (Sprint 8 proposed at the Sprint 7 review). The repository is public, so its figures are now read by people who were not here. This sprint makes each published figure say how sure it is, makes calibration less sensitive to single items (F-16), and finishes four small items from the Sprint 7 review. Project rule 1 governs: a figure claims no more than its sample supports.

## What refinement found

- **Most figures can get intervals without spending anything.** The evaluation scripts saved per-question results for retrieval, answerability, drafting, extraction and the red team (`docs/evals/*.json`). Calibration, consistency, gates and duplicates saved only Markdown, but each gives its counts ("0 of 33", "7 of 70"), which is enough for an interval on a proportion. Calibration error and AUROC need the per-question rows, which the answerability JSON has.
- **The evaluation set is 363 questions, split in half.** The calibration table is fitted on the 182-question `calibrate` split and checked on the 181-question `test` split. Only 17 and 16 near misses are in each half, which is why removing one item moved the result so much (F-16). Cross-validation uses every question for both fitting and checking.
- **Some figures are clustered.** Faithfulness is 305 claims from 46 drafts; claims in the same draft are not independent, so an interval treating them as 305 separate trials would be too narrow. Resampling whole drafts avoids that.
- **F-38 is explained.** On every sign-in the app indexes knowledge-base entries that have no vectors yet (`src/App.tsx`). After a reset that is all of them, so the first person to sign in (Priya, in the screenshot run) makes two embedding calls. That is real behaviour; what is missing is the wording, and the demo recording, which keeps Claude calls but not the pipeline's own embedding calls.
- **The demo's recorded confidences come from today's calibration table.** If S8-2 changes the table, the demo needs recording again, which S8-4 does anyway (F-37).

## Stories

### S8-1 Every published figure carries a 95% interval

**The job.** A reader of the evaluation summary can see how much each figure could move with a different sample of questions, so "0 of 33" is not read as "never".

**Before and after.** Today: `docs/evals/README.md` gives single figures ("0 of 33", "100 of 100"). After: each has a 95% interval beside it (for example "0 of 33 (0 to 10.4%)"), computed by a script from the saved results, with the method stated once at the top.

**What changes.** `eval/intervals.ts`: Wilson score intervals for proportions; a percentile bootstrap (2,000 resamples, fixed seed, so the figures repeat) for calibration error and AUROC, resampling questions; claim-level figures resampled by draft. `npm run eval:intervals` writes `docs/evals/intervals-<date>.md` from the existing reports, with no API calls. The summary table gains an interval column; the docs test checks each interval against the intervals report, the same way it checks the figures.

**Test cases.**
1. Wilson for 0 of 33, 100 of 100 and 7 of 70 matches published values to 0.1 points.
2. The bootstrap gives the same interval twice with the same seed, and contains the point estimate.
3. A clustered figure (claims in drafts) gives a wider interval than treating claims as independent.
4. A report with no per-question rows gets an interval only where it states counts; a figure with neither is listed as "no interval" rather than guessed.
5. The docs test fails when a summary interval differs from the report.

**Out of scope.** New evaluation runs; intervals on figures that are not in the summary.

**Boundaries.** No API calls, no data leaves the PC; the intervals report states that the sets are small, synthetic and unreviewed, so an interval measures sampling only, not how representative the questions are.

**Size.** M.

### S8-2 Calibration fitted and checked by cross-validation (F-16)

**The job.** The calibrated confidence, and the safety figure that rests on it (near misses at the 80% bulk line), no longer swing when one question is added or removed.

**Before and after.** Today: one fit on half the set, checked once on the other half. After: five-fold cross-validation over all 363 questions estimates calibration error and near misses at the bulk line, with the spread across folds; a leave-one-out check reports the largest change any single question makes; the app's table is fitted as Q2 decides.

**What changes.** `eval/calibration-fit.ts` (folds stratified by question kind, so each fold holds near misses), `eval/run-calibration.ts` (a cross-validation section and the leave-one-out check in the report), `supabase/functions/_shared/calibration-tables.ts` regenerated, the model card and risk register R-12 updated with the new figures.

**Test cases.**
1. Every question is checked exactly once across the five folds, and each fold holds near misses from both splits.
2. The folds repeat with the same seed.
3. A planted fit where one question flips the near-miss result is caught by the leave-one-out check.
4. The bars hold, or the miss is reported for Rory to decide: calibration error at most 0.1, and near misses at or above 80% at most 1 (Q3 sets where this is measured).
5. Existing calibration tests still pass on the regenerated table.

**Out of scope.** A larger evaluation set (F-14, F-15 stay in the backlog: they need outside reviewers).

**Boundaries.** No API calls (the answerability scores are already saved). If the table changes, confidence on questions processed later changes; questions already processed keep the confidence recorded at the time.

**Size.** M.

### S8-3 The confidence tooltip gives the range

**The job.** A person reading "89%" on a card can see how precise that figure is, without crowding the card.

**What changes.** The tooltip on the confidence figure adds one line from the calibration report, for example: "Of evaluation questions scored like this, between 84% and 97% had the right entry (95% interval, 120 questions)." Bins come from S8-2's fit and are generated into the calibration tables.

**Test cases.** 1. Each table bin has its interval and count. 2. The tooltip shows the bin's interval for a given confidence. 3. No table, or an uncalibrated question, shows no range.

**Size.** S. Depends on S8-2.

### S8-4 Demo data shows the "partly" hold, and its usage is complete (F-37, F-38)

**The job.** A fresh install shows a question held from bulk approval because the checker said "partly", and the governance page's figures match what the demo run cost.

**What changes.** `sample-data/demo-plan.json`: two questions added to Bluefin from the evaluation set that the checker judged "partly" at or above 80% in the Sprint 6 run. `eval/record-demo.ts` also records the pipeline's embedding calls. A database test requires at least one pending "partly" question at or above 80% in Bluefin; if a run does not give one (the checker varies, 7.2%), the recorder says so and the run is repeated. The README's screenshot note says the first sign-in after a reset indexes the knowledge base (two embedding calls). Rory records the demo again, resets, and retakes the screenshots.

**Test cases.**
1. The recording has a pending "partly" question at or above 80% in Bluefin, and the card shows the hold reason.
2. The recording's usage includes embedding calls, and the seed inserts them.
3. A recording without the "partly" case fails the test with a message saying to record again.
4. After reset and first sign-in, the governance figures equal the seed's usage plus the indexing calls, as the README says.

**Size.** M (plus Rory's run: a few pence).

### S8-5 Two small fixes (F-36, F-39)

**What changes.** The Excel export's title property is the response's file name (F-36). The screenshot script also refuses a Supabase address in `.env` that is not local (F-39).

**Test cases.** 1. The workbook's title is set and escaped. 2. The script refuses a hosted Supabase address before signing in.

**Size.** S.

## Not in this sprint

C-1 multilingual knowledge base ranks next. F-35, F-19, F-14 and F-15, F-20, F-34, F-8, F-2, F-3 and F-4 stay ranked in the backlog.

## The sprint as a whole

Order: S8-5 (quick, standalone), S8-1, S8-2, S8-3 (needs S8-2), then S8-4 last (needs the new table, then Rory's recording and screenshots). Sizes: two S, three M; about three to four days. No spike.

## Questions for Rory

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | Interval method | (a) Wilson intervals for proportions; bootstrap for calibration error and AUROC; clustered figures resampled by draft. (b) Bootstrap for everything | (a): standard, exact enough for small counts, and repeatable |
| Q2 | The app's calibration table | (a) Estimate by cross-validation, then fit the table on all 363 questions. (b) Keep fitting on the calibrate half; cross-validation in the report only | (a): twice the data in the table, and the cross-validated figures say honestly how it performs |
| Q3 | Bar for stability | (a) Near misses at or above 80%: at most 1 in every fold, and no single question moves the total by more than 1. (b) Report only, no bar | (a): the safety figure is the one that matters, and it was the one that swung |
| Q4 | Showing the range in the app | (a) In the confidence tooltip only. (b) On the card beside the figure. (c) Not in the app, reports only | (a): the card stays readable, and the range is one hover away |
| Q5 | A larger evaluation set | (a) Not this sprint; F-14 and F-15 stay (they need outside reviewers). (b) Generate more items with Claude now | (a): more unreviewed items written by Claude would narrow the intervals without making the set more representative |
