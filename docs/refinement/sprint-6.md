# Sprint 6 refinement: checker reliability

Refined 23 October 2026, for Rory's sign-off before building. Backlog: `docs/BACKLOG.md` (Sprint 6 proposed at the Sprint 5 review). Builds on decision 0007 (answerability and drafting defaults), the Sprint 5 consistency report and the Sprint 4 review gates.

## What refinement found

The Sprint 5 review decided to run the checker three times and take the majority (F-22, folded into F-18). Reading the cached evaluation runs changed the picture:

- **About 30% of the checker's replies were unreadable**, and the code counts an unreadable reply as "no". In the consistency run, 268 of 905 replies had a "no" with no reason and no chosen entry; in the answerability run used for calibration, 168 of 523.
- **The likely cause is the reply limit.** The checker may write at most 300 tokens; the consistency run averaged 228 output tokens a reply, and the written reasons run to the 300-character trim in the code (median 281). A reply that hits the limit is cut off, fails to parse, and becomes "no". The stop reason was not recorded, so this is a strong inference, not yet a measurement; S6-1 records it.
- **Setting the unreadable replies aside, 2 of 181 questions changed verdict across the five runs, not 42.** So most of the 23.2% was this bug, not the checker changing its mind. It likely explains F-18 too: calibration learned that "no" is right only about 25% of the time, because many "no"s were cut-off replies to answerable questions, hence "no 75%".
- **Majority of three alone would not have fixed it.** Simulated from the five cached runs, three runs with a majority would still change verdict for about 13.3% of questions (and five runs about 10.6%), at three times the checker's cost.
- The gate classifier has the same pattern at a lower rate (1 of 170 replies unreadable, limit 200 tokens); it already fails safe (gated as legal).
- The evaluation caches are keyed by input text only, not by prompt version or reply limit, so a changed prompt would silently reuse old answers.
- F-9 (failed saves) was fixed in Sprint 1 (`85b39b4`) but never marked done. One gap remains: a save that row-level security refuses affects no rows and returns no error, so it looks saved.

So the sprint fixes the cause first, then measures; majority of three becomes a fallback only if the measurement misses the bar.

## Stories

### S6-1 The checker's replies are never cut off, and never silently become "no" (F-22, F-18)

**The job.** Every checker reply is complete and readable; when one is not, the question is treated as unchecked, not as "no". We know it worked when the re-run reports 0 cut-off replies.

**Before and after.** Before: about one reply in three is cut off and scored "no", confidence is calibrated on those, and a refused question shows "no 75%". After: replies fit their limit, the stop reason is recorded, an unreadable reply is retried once, and if still unreadable the question has no calibrated confidence (held from bulk, with a note), as when the checker is down.

**What changes.** `answerability.ts`: reply limit 300 to 1,024 tokens; the prompt asks for a one-sentence reason (under 40 words); new prompt version `judge-2026-10-24.1`; an unreadable reply retried once, then thrown as a failed check. `gates.ts`: limit 200 to 512, one retry before the existing fail-safe. `claude.ts`: unchanged (already returns the stop reason). Usage records stay as they are; each retry is recorded and priced. Evaluation caches keyed by prompt version and limit, and unreadable replies are not cached. Evaluation reports count unreadable replies by stop reason.

**Test cases.**
1. A reply with stop reason `max_tokens` is retried once; a good second reply is used.
2. Two unreadable replies in a row: the check fails, the question has no calibrated confidence, a note says the check was unreadable, and it is never bulk-approved (existing database rule for uncalibrated questions).
3. A readable "no" is still a "no" (no retry).
4. Text that is not JSON, and a refusal stop reason, behave like test 2.
5. The gate classifier: one unreadable reply then a good one uses the good one; two unreadable still gate as legal.
6. Hostile: a question asking the checker to write a very long reason still produces a readable reply within the limit (red-team item added).
7. The cache key changes when the prompt version or the limit changes; an unreadable reply is not written to the cache.
8. Each retry is a recorded, priced call and counts against the reservation (usage test).

**Out of scope.** Majority of three (see below). Changing what the checker judges.

**Boundaries.** Rule 1: the card and model card say "unchecked" when a check failed, never "no". Rule 3: server-side only. Caps: a retry costs one more call; the per-question reserve ($0.002) already covers it (measured $0.0001).

**Size.** S.

### S6-2 Recalibrate and re-measure (F-18, F-22 evidence)

**The job.** Confidence is refitted on readable verdicts, and every figure that depends on the checker is measured again, so the figures published in Sprint 7 are sound.

**What changes.** Re-run, in this order: answerability, calibration (tables regenerated into `calibration-tables.ts`), consistency (five runs), drafting (the no-draft floor depends on confidence), gates (the classifier's limit changed), red team. The model card, risk register and README updated from the new reports; superseded reports kept.

**Bars (proposed; Q3).**
- Unreadable replies after retry: 0 in every run.
- Consistency over five runs: verdict changed for at most 5% of test questions, and at most 5% crossed the 80% bulk line.
- Near misses at or above the 80% bulk line: still 0 of 33 (at most 1).
- Gates: still 100 of 100 pricing and legal questions gated.
- Prompt injections that changed a decision: at most 1 of 35, as before.
- AUROC and calibration error reported, no bar (expected to improve).

**Test cases.** 1. The calibration fit refuses unreadable verdicts as input (unit test). 2. The consistency report states unreadable replies by stop reason. 3. Every figure in the model card matches its report (existing governance test). 4. If a bar is missed, the report says so and the item stays open; nothing is rounded into a pass.

**If the consistency bar is missed.** Majority of three becomes a story for the next sprint, refined at this sprint's close (it depends on this measurement, so it cannot share the sprint).

**Cost.** Roughly 3,000 checker calls across the runs, under $1 at the recorded prices.

**Size.** M (mostly run time on Rory's PC).

### S6-3 Show the checker's verdict and reason on the card (F-18)

**The job.** A reviewer sees why the confidence is what it is: "Checker: partly. KB-0012 covers cloud monitoring but not the named regions."

**What changes.** New column `rfi_questions.judge_reason` (written by the server only; column grants and RLS tests for every row of the role matrix, per decision 0003), trimmed to 300 characters and passed through `safe-text`. The card's confidence panel shows the verdict, the entry the checker chose and its reason; "unchecked" when the check failed.

**Test cases.** 1. A member cannot write `judge_reason` (database test). 2. A reason with markup is shown as text (React escaping; unit test). 3. A failed check shows "Checker: not available" and no verdict. 4. Old questions without a reason show the verdict only.

**Size.** S.

### S6-4 Recheck held questions when an entry is reviewed (F-28)

**The job.** When an admin reviews an entry, questions waiting on it are released from the review hold straight away, without reprocessing.

**Before and after.** Before: a question gated "cites an unreviewed entry" stays held after the entry is reviewed, until it is processed again. After: reviewing or confirming an entry recomputes the gate of pending questions that cite it, in responses not yet exported; and bulk approval checks the cited entries' status live, so an entry that falls overdue after processing also holds its questions (Q4).

**Test cases.** 1. A pending question citing one unreviewed entry: the admin reviews it, the gate clears, bulk approval includes it. 2. Citing two unreviewed entries, one reviewed: still gated. 3. Citing one unreviewed and one overdue: reviewing the first leaves it gated as stale. 4. An accepted or skipped question is not changed. 5. A question in an exported or archived response is not changed. 6. An entry falls overdue after processing: bulk approval leaves its questions out. 7. A member cannot trigger the recheck for an entry they cannot review (only `review_entry`, admin only, does it). 8. Each cleared gate is logged.

**Size.** M.

### S6-5 A refused save is reported (F-9 remainder)

**What changes.** `saveQuestionPatch` asks for the updated rows back and reports "Your change was not saved: you cannot change this question" when none came back; the card rolls back as it does for an error.

**Test cases.** 1. Zero rows returned: error shown, card rolled back. 2. An error: as today. 3. One row: saved.

**Size.** S.

### S6-6 Bulk approvals say how they were made (F-30)

**What changes.** A card accepted by "All eligible" reads "bulk, all eligible", not "bulk at 0%"; a threshold reads "bulk at 80%" as now.

**Test cases.** 1. Threshold 0 shows "bulk, all eligible". 2. Threshold 0.8 shows "bulk at 80%". 3. Individual approvals unchanged.

**Size.** S.

### S6-7 The Sent list names who each question went to (F-31)

**What changes.** In Assignments, Sent, each row shows "to Maya Patel"; My Inbox keeps "by".

**Test cases.** 1. Sent shows the assignee. 2. My Inbox shows who assigned it. 3. An assignee whose profile cannot be read shows "to a colleague".

**Size.** S.

### Planned only if needed: majority of three runs

Planned for Sprint 7 only if S6-2 misses the consistency bar; refined at the Sprint 6 close. Simulated from the cached runs, it would cut the 23.2% to about 13.3% on its own, so it is a fallback, not the fix.

## The sprint as a whole

Order: S6-1, then S6-2 (needs S6-1; runs on Rory's PC); S6-3 to S6-7 are independent and fit around the runs. Sizes: four S, two M (S6-2, S6-4), about three to four days. No spike: S6-2 is a measurement against agreed bars, and the only story that would depend on it is held out of the sprint.

## Questions for Rory

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | F-22 approach, given the finding | (a) Fix the cut-offs and measure; majority of three only if the bar is missed. (b) Do majority of three as well, regardless | (a): the cause is a bug; tripling the checker's cost would hide it, not fix it |
| Q2 | An unreadable checker reply after one retry | (a) Treated as a failed check: no calibrated confidence, held from bulk, note shown. (b) Keep counting it as "no" | (a): honest, and still safe |
| Q3 | Consistency bar | (a) At most 5% verdict changes and 5% crossing the bulk line. (b) At most 2% | (a): 2 of 181 (1.1%) changed in the cached runs once cut-offs are set aside, so 5% leaves room for noise on a small set |
| Q4 | F-28 | (a) Recompute on review and check live at bulk approval. (b) Recompute on review only | (a): also catches entries that fall overdue after processing |

## Answers (Rory, 23 October 2026)

| # | Answer |
|---|---|
| Q1 | Fix the cut-offs and measure; majority of three only in Sprint 7 if the bar is missed. This replaces the Sprint 5 review's decision to do majority of three |
| Q2 | An unreadable reply after one retry is a failed check: no calibrated confidence, held from bulk, note shown |
| Q3 | At most 5% of test questions change verdict over five runs, and at most 5% cross the 80% bulk line |
| Q4 | Recompute on review, and check cited entries live at bulk approval |

All seven stories are Ready.

## Independent security review (24 October 2026)

A reviewer given the code but not the reasoning found one serious issue and nine smaller ones; all are fixed with tests (`supabase/tests/db/sprint6.test.ts`, `supabase/functions/_shared/sprint6.test.ts`, `src/lib/sprint6.test.ts`, `eval/sprint6.test.ts`; migration `20261026120000_sprint6_review_fixes.sql`):

1. **An owner could release other owners' held questions by exporting.** A question processed before its entry fell overdue had no gate, so exporting it confirmed the overdue entry, and the new release trigger then cleared holds in other responses. An owner's export now confirms an entry only if it is reviewed and current at that moment; otherwise only an admin's approval does.
2. **Admins could write an entry's text and review date directly**, skipping `review_entry` and its log. Those column grants are removed for every signed-in user.
3. **The card said "Not available" for a reranker's score**, which has no verdict but is calibrated; and old "no" verdicts, about a third of them cut-off replies, showed as plain "No". Now "Not available" means no confidence, and a "no" with no reason says it may predate the fix.
4. **Trimming a reason could split an emoji**, leaving text the database rejects. Trimmed by character now.
5. **An edit saved but not accepted was reported as "not saved"** and rolled back on screen. It now says the answer was saved but not accepted, and reloads.
6. **The duplicates evaluation counted unreadable checks as wrong matches.** They are left out.
7. **The gate evaluation cached the fail-safe and counted it as a catch.** The cache follows the reply limit, the fail-safe is not cached, and unreadable answers are counted separately.
8. **The answerability cost line missed retries.** It counts every reply.
9. **The release had no index and no lock order.** `cited_refs` is indexed, and the questions are locked in id order.
10. **Repeated or blank cited refs read oddly.** Each is named once; a blank ref reads "an unknown entry" and still holds.

Held, per the reviewer: no signed-in user can write `judge_reason` or a gate or call the private functions; the release only touches the two review gates, and only pending questions in open sessions; bulk approval only adds holds; the judge stops after two replies and never turns an unreadable reply into a verdict; links and the canary are withheld from reasons; model text is rendered as text.

Residuals, recorded rather than fixed: if an admin reviews an entry while a question citing it is being processed, the question can be saved held and stays held until the entry is reviewed or confirmed again (fails safe). A reviewed entry that has since been replaced still counts as current for a draft that cites it (behaviour from Sprint 4; backlog item at the close).

