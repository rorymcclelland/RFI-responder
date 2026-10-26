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

## Japanese entries and the language pairs (`languages.ts`, Sprint 12)

`sample-data/security-qa-ja.csv` holds 30 of the 100 synthetic entries (every third, from entry 1) written in Japanese by Claude: machine translations, unreviewed, keeping every figure of the English original. In the Japanese corpus variant those 30 entries replace their English originals, so the same evaluation set measures four pairs: English and Japanese questions against English entries, and against Japanese ones (English-to-Japanese, 60 questions; Japanese-to-Japanese, 30).

```bash
npm run eval:languages      # recall@5 per pair, and the checker with the app's calibration on the variant
```

Needs `VOYAGE_API_KEY` and `ANTHROPIC_API_KEY` in `supabase/functions/.env`, and the question vectors cached by `npm run eval:retrieval`. The bars (Sprint 12, Q4) are recall@5 of at least 80% for English-to-Japanese and Japanese-to-Japanese, and no near miss at or above the 80% bulk line; the report says plainly when one is not met. `languages.test.ts` checks the Japanese entries and the variant on every test run. Since Sprint 13 the run can be rebuilt from the cache with no keys set, and `npm run eval:calibrate` also fits the app's method on both knowledge bases together (each question's two copies in one fold), adopting that table only if every bar holds.

## Word questionnaires (`word-set.ts`, Sprint 5)

Synthetic Word documents built in code with the `docx` package (a development dependency): six layouts, two documents each, about 240 known questions taken from the paraphrases above and the request and multi-part lists in the file, plus four red-team copies with an instruction planted in body text, a table cell, a heading and tiny white text. The table layouts head their question column "Item", so the rule-based fallback alone finds only about half the questions (51.9% recall when checked on 23 October). `word-set.test.ts` reads every document as the app does and checks every known question is there.

```bash
npm run eval:extraction     # extraction against the known questions, and the red team
npm run eval:consistency    # F-22: the checker run five times on the test split
```

Both need `ANTHROPIC_API_KEY` in `supabase/functions/.env`; the consistency run also needs the voyage-4 vectors cached by `npm run eval:retrieval`. Answers are cached in `eval/.cache/`, so reruns cost nothing.
