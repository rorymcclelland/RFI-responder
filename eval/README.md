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

## Word questionnaires (`word-set.ts`, Sprint 5)

Synthetic Word documents built in code with the `docx` package (a development dependency): six layouts, two documents each, about 240 known questions taken from the paraphrases above and the request and multi-part lists in the file, plus four red-team copies with an instruction planted in body text, a table cell, a heading and tiny white text. The table layouts head their question column "Item", so the rule-based fallback alone finds only about half the questions (51.9% recall when checked on 23 October). `word-set.test.ts` reads every document as the app does and checks every known question is there.

```bash
npm run eval:extraction     # extraction against the known questions, and the red team
npm run eval:consistency    # F-22: the checker run five times on the test split
```

Both need `ANTHROPIC_API_KEY` in `supabase/functions/.env`; the consistency run also needs the voyage-4 vectors cached by `npm run eval:retrieval`. Answers are cached in `eval/.cache/`, so reruns cost nothing.
