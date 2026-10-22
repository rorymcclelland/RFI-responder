# 0006 Retrieval defaults: rank by meaning, voyage-4 hosted, qwen3-embedding locally

Date: 22 October 2026. Status: proposed at the Sprint 1 review, from measurements on Rory's PC.

**Evidence.** `docs/evals/retrieval-2026-10-22.md` and `docs/evals/calibration-2026-10-22.md`, on evaluation set 2026-10-22.1 (330 synthetic items, all unreviewed; Japanese are machine translations of the original questions, so Japanese results show that crossing languages works, not that Japanese rewording does).

| Model | EN recall@5 | JA recall@5 | Calibration error | Unanswerable below floor | Answerable below floor |
|---|---|---|---|---|---|
| keyword (previous app) | 60.5% | 13.0% | n/a | n/a | n/a |
| voyage-4 | 99.5% | 100% | 0.017 | 86.7% | 0.7% |
| qwen3-embedding:0.6b | 98.0% | 100% | 0.089 | 86.7% | 0.0% |
| bge-m3 | 95.0% | 100% | 0.063 | 73.3% | 10.7% |

**Decisions.**
1. **Rank by meaning** whenever a query vector exists; keywords only as the fallback. Equal-weight fusion lowered English recall@5 by about 20 points for every model.
2. **Hosted default: voyage-4.** Best English recall and the best-calibrated confidence.
3. **Local default: qwen3-embedding:0.6b.** Meets every bar; bge-m3 misses the abstention bar.
4. Calibration tables for all three models ship with the app (`src/lib/calibration/`), so switching provider keeps calibrated confidence.

**Caveats.** About 165 test items per model, so calibration error has noticeable sampling noise. The knowledge base is 100 short synthetic entries; real ones will be longer and messier. Re-run `npm run eval:retrieval` and `npm run eval:calibrate` whenever the model, the knowledge base's shape or the evaluation set changes.
