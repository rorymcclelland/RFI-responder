# Evaluations

## Retrieval evaluation set (`retrieval-set.json`)

Synthetic, like everything in this repo. Built on 22 October 2026 from the 100 synthetic entries in `sample-data/security-qa.csv`:

| Kind | Count | What it tests |
|---|---|---|
| English paraphrases | 200 (two per entry) | Finding the right entry when the wording differs; written to avoid the original's key words where natural |
| Japanese versions | 100 (one per entry) | Finding an English entry from a Japanese question |
| Unanswerable | 30 (25 English, 5 Japanese) | Commercial and company questions the security knowledge base cannot answer; used for abstention and calibration |

Each item has a `gold` answer (the entry's question text), a `split` (`calibrate` or `test`, alternating by entry so no entry is in both) and a `review` status.

**Review status: all items unreviewed.** They were written by Claude (an AI model) in the build session, not by people. The Japanese items are machine translations and need checking by a Japanese reader before any Japanese result is quoted as more than indicative (agreed at the Sprint 0 review). Results reported from this set say so.

To change the set, edit `source/*.json` and run `node eval/build-retrieval-set.mjs`. `retrieval-set.test.ts` checks its structure on every test run.
