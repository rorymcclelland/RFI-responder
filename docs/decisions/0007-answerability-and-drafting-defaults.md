# 0007 Answerability, gates and drafting: Claude Haiku 5.5, checked in code

Date: 23 October 2026. Status: agreed at the Sprint 2 review.

**Context.** Sprint 1 showed that similarity alone cannot tell "this entry answers the question" from "this entry is on the same topic". Sprint 2 added an answerability check, pricing and legal gates and grounded drafting, all server-side (decision 0005's provider switch; decision 0003 for who may approve).

**Evidence.** In `docs/evals/` (synthetic sets, unreviewed; Japanese machine-translated):
- Answerability: the Claude Haiku 5.5 judge separates near misses from answerable questions better than similarity (AUROC 0.942 against 0.892 for voyage-4); with it no near miss reaches the 80% bulk line (0 of 33). Voyage's rerankers were not compared (Voyage rate limit; follow-up F-20).
- Gates: rules or classifier, gated if either fires: 100 of 100 pricing and legal questions gated, 12.9% of lookalikes. Rules alone caught 8 of 20 held-out questions, so they are a backstop, not the gate.
- Drafting with Haiku: 100% of 280 claims supported by cited entries, 100% of near misses refused, 89.8% of answerable questions cite the right entry. Sonnet 5.5 was not needed.
- Cost: an evaluation run of about 70 questions through the whole pipeline used about 240 calls and 240,000 tokens, which is cents at Haiku's prices (checked 22 October).

**Decisions.**
1. Defaults: `ANSWERABILITY_CHECKER`, `GATE_MODEL` and `DRAFT_MODEL` are `claude-haiku-5-5`, configurable per deployment.
2. Confidence is calibrated on the combination of embedding model and checker (`voyage-4 + claude-haiku-5-5`); a combination without a table gives no calibrated confidence, and a configured checker without a key fails closed.
3. Model output is never trusted on its own: drafts are checked in code (citations, figures, links, the prompt canary); unreadable output from the judge counts as "no", from the classifier as "legal", from the drafter as "insufficient evidence".
4. Bulk approval requires processing by the server, calibrated confidence, a draft, and no gate (pricing, legal, unchecked, translation); enforced in the database.

**Residuals accepted.** The floor bar is met by the pipeline (no draft for near misses), not by the score alone; right-entry citation one question short of 90%; one Japanese injection raised the judge's verdict, contained by the translation gate. Calibration on about 180 items is unstable (F-16).
