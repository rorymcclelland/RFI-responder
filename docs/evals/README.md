# Evaluations

What has been measured, on what, and the latest figure for each measure. A test (`docs/docs.test.ts`) checks that every figure below is the figure in its own row and column of the report it cites, so a figure cannot be changed here without the report agreeing.

**Read every figure as an estimate on small synthetic sets.** The evaluation set (version 2026-10-22.3) has 363 questions written by Claude from the synthetic knowledge base: paraphrases, machine translations into Japanese, unanswerable questions and near misses (questions on a topic the knowledge base covers that ask for something it does not hold). Nobody outside the project has reviewed them, and calibration moved noticeably when one item was removed (backlog F-16). The scripts are in [`eval/`](../../eval/), with instructions in [`eval/README.md`](../../eval/README.md).

| Measure | Figure | Report |
|---|---|---|
| Retrieval, English recall@5 (voyage-4) | 99.5% | `docs/evals/retrieval-2026-10-22.md` |
| Retrieval, Japanese-to-English recall@5 (voyage-4) | 100.0% | `docs/evals/retrieval-2026-10-22.md` |
| Checker, separating near misses from answerable questions (AUROC, voyage-4 + checker) | 0.997 | `docs/evals/answerability-2026-10-23.md` |
| Checker replies unreadable after one retry | 0 of 363 | `docs/evals/answerability-2026-10-23.md` |
| Calibration error, voyage-4 + checker (test split) | 0.014 | `docs/evals/calibration-2026-10-23.md` |
| Near misses at or above the 80% bulk line | 0 of 33 | `docs/evals/calibration-2026-10-23.md` |
| Checker verdict changed across five runs (test split) | 7.2% | `docs/evals/consistency-2026-10-23-sprint6.md` |
| Questions whose confidence crossed the 80% bulk line across five runs | 1.7% | `docs/evals/consistency-2026-10-23-sprint6.md` |
| Pricing and legal questions gated (rules and classifier) | 100 of 100 (100.0%) | `docs/evals/gates-2026-10-23.md` |
| Lookalike questions wrongly gated | 7 of 70 (10.0%) | `docs/evals/gates-2026-10-23.md` |
| Faithfulness of drafts (claims supported by the cited entries) | 100.0% of 305 claims | `docs/evals/drafting-2026-10-23-sprint6.md` |
| Right entry cited | 93.9% | `docs/evals/drafting-2026-10-23-sprint6.md` |
| Near misses given no draft | 100.0% | `docs/evals/drafting-2026-10-23-sprint6.md` |
| Wrong supersessions at the learning threshold (voyage-4, 0.55) | 1.9% | `docs/evals/duplicates-2026-10-23-2.md` |
| Word extraction recall, synthetic documents | 100.0% | `docs/evals/extraction-2026-10-23.md` |
| Word extraction precision, synthetic documents | 100.0% | `docs/evals/extraction-2026-10-23.md` |
| Red-team Word documents that changed the result | 0 of 4 | `docs/evals/extraction-2026-10-23.md` |

**Prompt injection.** In the Sprint 6 red team ([`redteam-2026-10-23-sprint6.md`](redteam-2026-10-23-sprint6.md)), 2 of 37 injections were flagged as scored. After the review narrowed the check to drafts that could be sent (a change made after seeing the result, and recorded as such), 1 remains: a near miss whose checker verdict an instruction raised from "no" to "partly". The drafter refused it, and since Sprint 7 a "partly" verdict is never bulk-approved.

**Older reports** are kept beside the newer ones; a report never overwrites another. The Sprint 6 checker fix (about a third of the checker's replies had been cut off and counted as "no") changed every figure that depends on the checker, so reports dated before 23 October 2026 describe the earlier behaviour.

## What each evaluation answers

| Evaluation | Question | Command |
|---|---|---|
| Retrieval | Does the right entry come back in the top five? | `npm run eval:retrieval` |
| Answerability | Can the checker tell "the entries answer this" from "the entries are only on the same topic"? | `npm run eval:answerability` |
| Calibration | When the app says 80%, is it right about 80% of the time? Do near misses ever reach the bulk line? | `npm run eval:calibrate` |
| Consistency | Does the checker give the same verdict when asked again? | `npm run eval:consistency` |
| Gates | Are pricing and legal questions always caught, and how many lookalikes are caught by mistake? | `npm run eval:gates` |
| Drafting | Are drafts faithful to their sources, citing the right entry, and absent when nothing answers the question? | `npm run eval:drafting` |
| Red team | Can text in a question or an entry change a decision, leak the prompt or plant a claim? | `npm run eval:redteam` |
| Duplicates | At what similarity may a learned answer replace an entry, keeping wrong replacements at 2% or below? | `npm run eval:duplicates` |
| Word extraction | Are the questions in a Word document found, word for word, and can planted text change that? | `npm run eval:extraction` |
