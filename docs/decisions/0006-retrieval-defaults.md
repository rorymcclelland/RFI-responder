# 0006 Retrieval defaults: rank by meaning, voyage-4 hosted, qwen3-embedding locally

Date: 22 October 2026. Status: proposed for the Sprint 1 review, from measurements on Rory's PC. Revised the same day after near-miss questions were added to the evaluation set.

**Evidence.** `docs/evals/retrieval-2026-10-22.md` and `docs/evals/calibration-2026-10-22.md`, on evaluation set 2026-10-22.2: 364 synthetic items, all unreviewed. Japanese items are machine translations of the original questions, so Japanese results show that crossing languages works, not that Japanese rewording does. The set has two kinds of unanswerable question: 30 off-topic and 34 near misses (security questions the knowledge base does not answer, such as mean time to detect or FedRAMP).

| Model | EN recall@5 | JA recall@5 | Calibration error | Unanswerable below floor | of which near misses | Answerable below floor | Near misses at or above 80% |
|---|---|---|---|---|---|---|---|
| keyword (previous app) | 60.5% | 13.0% | n/a | n/a | n/a | n/a | n/a |
| voyage-4 | 99.5% | 100% | 0.036 | 62.5% | 35.3% | 2.0% | 1 of 34 |
| qwen3-embedding:0.6b | 98.0% | 100% | 0.096 | 62.5% | 41.2% | 0.0% | 6 of 34 |
| bge-m3 | 95.0% | 100% | 0.072 | 71.9% | 70.6% | 10.7% | 2 of 34 |

**No model meets the abstention bar once near misses are included.** On the first set (off-topic questions only) voyage-4 and qwen3 both did, with 86.7%. A near miss is on the right topic, so its top match is genuinely similar; the similarity of the best entry cannot tell "this entry answers it" from "this entry is about the same thing". Two checks on Rory's PC confirmed this is not a tuning problem:
- Other signals from the same scores separate near misses worse than the top similarity does (voyage-4 AUROC: top similarity 0.892, gap to the second entry 0.795, gap to the mean of the top ten 0.852).
- A floor chosen to catch 80% of unanswerable questions would send 8.3% of answerable questions to a person with voyage-4 (12.0% of English ones), and still catch only 68% of near misses.

The gate that matters most for safety holds better: with voyage-4 only one near miss ("Which SIEM product do you use?", 95%) reaches the 80% bulk-approval line, and 7 of the 166 questions at or above it have the wrong top entry, in line with the calibration.

**Decisions.**
1. **Rank by meaning** whenever a query vector exists; keywords only as the fallback. Equal-weight fusion lowered English recall@5 by about 20 points for every model.
2. **Hosted default: voyage-4.** Best English recall and the best-calibrated confidence.
3. **Local default: qwen3-embedding:0.6b, to be confirmed at the Sprint 1 review.** Best local recall and calibration, but 6 of 34 near misses reach the bulk-approval line against bge-m3's 2.
4. Calibration tables for all three models ship with the app (`src/lib/calibration/`), so switching provider keeps calibrated confidence.
5. **Keep the no-match floor at 0.3 and record the abstention bar as not met** (agreed with Rory, 22 October). Raising it would send many answerable questions to a person and still miss a third of near misses. The fix belongs in Sprint 2: a check of whether the matched entry actually answers the question, measured on the same near misses.

**Caveats.** About 165 test items per model, so calibration error has noticeable sampling noise. The knowledge base is 100 short synthetic entries; real ones will be longer and messier. Re-run `npm run eval:retrieval` and `npm run eval:calibrate` whenever the model, the knowledge base's shape or the evaluation set changes.
