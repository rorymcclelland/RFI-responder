# Model card

RFI Respond drafts answers to procurement questionnaires (RFIs and RFQs) from an organisation's own knowledge base, for a person to review. It never sends anything to a customer. All evaluation data is synthetic.

## Models and their jobs

| Job | Hosted mode (default) | Local mode | Where it runs | Version recorded with each result |
|---|---|---|---|---|
| Find matching entries (embedding) | voyage-4 | qwen3-embedding:0.6b (Ollama) | Edge Function `process-questions`, `embed`, `embed-entries` | `rfi_questions.embedding_model`, `kb_entries.embedding_model` |
| Check whether the entries answer the question (judge) | claude-haiku-5-5 | claude-haiku-5-5 | `process-questions` | `judge_model` |
| Flag pricing and legal questions (gate classifier, alongside rules) | claude-haiku-5-5 | claude-haiku-5-5 | `process-questions` | `gate_reason` |
| Draft the answer from the entries | claude-haiku-5-5 | claude-haiku-5-5 | `process-questions` | `draft_model`, `prompt_version` |
| Find the questions in an uploaded Word document | claude-haiku-5-5 (rules if it fails) | claude-haiku-5-5 (rules if it fails) | `extract-questions` | returned to the preview with the prompt version |

Choices and reasons: decisions [0005](../decisions/0005-where-the-ai-runs.md), [0006](../decisions/0006-retrieval-defaults.md) and [0007](../decisions/0007-answerability-and-drafting-defaults.md). Prompts carry a version (`draft-2026-10-23.1`, `judge-2026-10-22.1`, `extract-2026-10-23.2`); every processed question stores the models, the prompt version and the calibration set behind its confidence.

## What the output is

- **A draft written only from the matched entries**, citing them. Code then rejects a draft that cites an entry it was not given, or contains a figure, link or email address not in its sources (`supabase/functions/_shared/drafting.ts`). When the entries do not answer the question there is no draft ("insufficient evidence").
- **A calibrated confidence**: the measured chance, on the evaluation set, that the knowledge base answers the question with the top entry. Shown as "99%+" at the top, never as certainty.
- **A gate**, when the question must be decided by a person: pricing, legal, unchecked, translated, or citing an entry that is unreviewed or overdue for review. Gated questions are never bulk-approved.

## Measured performance

From the reports in `docs/evals/` (evaluation set 2026-10-22.3, synthetic; Japanese items machine-translated and unreviewed). Each figure below is checked against its report by a test.

| Measure | Figure | Report |
|---|---|---|
| Retrieval, English recall@5 (voyage-4) | 99.5% | `docs/evals/retrieval-2026-10-22.md` |
| Retrieval, Japanese-to-English recall@5 (voyage-4) | 100.0% | `docs/evals/retrieval-2026-10-22.md` |
| Judge, separating near misses from answerable questions (AUROC, voyage-4 + judge) | 0.942 | `docs/evals/answerability-2026-10-22.md` |
| Calibration error, voyage-4 + judge (test split) | 0.041 | `docs/evals/calibration-2026-10-22.md` |
| Near misses at or above the 80% bulk line, voyage-4 + judge | 0 of 33 | `docs/evals/calibration-2026-10-22.md` |
| Pricing and legal questions gated (rules and classifier) | 100 of 100 (100.0%) | `docs/evals/gates-2026-10-22.md` |
| Lookalike questions wrongly gated | 9 of 70 (12.9%) | `docs/evals/gates-2026-10-22.md` |
| Faithfulness of drafts | 100.0% of 280 claims | `docs/evals/drafting-2026-10-23.md` |
| Right entry cited | 89.8% | `docs/evals/drafting-2026-10-23.md` |
| Near misses given no draft | 100.0% | `docs/evals/drafting-2026-10-23.md` |
| Prompt injections that changed a decision | 1 of 35 | `docs/evals/redteam-2026-10-23.md` |
| Wrong supersessions at the learning threshold (voyage-4) | 1.9% | `docs/evals/duplicates-2026-10-23.md` |
| Word extraction recall, synthetic documents | 100.0% | `docs/evals/extraction-2026-10-23.md` |
| Word extraction precision, synthetic documents | 100.0% | `docs/evals/extraction-2026-10-23.md` |
| Red-team Word documents that changed the result | 0 of 4 | `docs/evals/extraction-2026-10-23.md` |
| Checker verdict changed across five runs (test split) | 23.2% | `docs/evals/consistency-2026-10-23.md` |
| Questions whose confidence crossed the 80% bulk line across five runs | 22.1% | `docs/evals/consistency-2026-10-23.md` |

## Known limits

- **Small, synthetic sets.** About 180 items per calibration split; figures moved noticeably when one item was removed (F-16). Treat them as estimates.
- **Three accepted residuals from Sprint 2:** by score alone 56% of near misses fall below the no-draft floor (the drafter refuses all of them); the right entry is cited 89.8% of the time (bar 90%, every miss is a refusal); one of 35 injections changed the judge's verdict, contained by the translation gate.
- **The judge sometimes says "no" to answerable questions** (F-18), so a question can show a middling confidence beside a refusal.
- **Japanese** evaluation items are machine translations nobody has checked (F-14); Japanese drafts are labelled and always reviewed individually.
- **The faithfulness judge** has only been checked on faithful drafts (F-19).
- **The judge is not consistent across repeated runs** (F-22): over five runs its verdict changed for 23.2% of test questions, every one an answerable question moving between "yes" and "no"; no near miss changed. Sprint 6 takes the majority of three runs (folded into F-18).
- **Word extraction** is measured on 12 synthetic documents in six layouts and 4 red-team copies; real questionnaires are messier. A question split across non-adjacent paragraphs is missed, and can be added in the preview.

## Must not be used for

- Sending answers to customers without a person's decision: every answer is accepted by a named person, individually or in a recorded bulk approval.
- Pricing: never drafted, never learned.
- Legal or contractual commitments without individual review.
- Real customer data in this repository: synthetic data only (project rule 2).
