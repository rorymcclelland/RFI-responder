# Sprint 1 refinement: real retrieval and calibrated confidence

Refined 22 October 2026, after the Sprint 0 review. Status: **all seven stories Ready, Sprint 1** (answers agreed 22 October 2026, recorded at the end).

## Goal and how we will know

Find the right knowledge-base entry **by meaning**, including from a Japanese question, and make **confidence mean what it says**. Judged on an evaluation set, not by eye:

- **Retrieval:** recall@5 (the right entry is among the five shown) and MRR (how high it ranks), for English paraphrases and for Japanese questions against English entries.
- **Calibration:** among questions scored around 80%, the top entry is right about 80% of the time (expected calibration error, and a reliability chart).
- **Abstention:** questions the knowledge base cannot answer score low and say "no good match".

## Constraints found during refinement

- The build workspace **cannot reach Voyage's API**, and Ollama runs only on Rory's PC. The model comparison and calibration therefore run **on Rory's PC**, with one command. Code is built and unit-tested here with the providers mocked.
- **pgvector installs here**, so database tests cover vector search. CI's database job moves to the `pgvector/pgvector:pg16` image; the real-Supabase job already has it.
- **All three candidate models produce 1,024-dimension vectors** by default (voyage-4, bge-m3, qwen3-embedding:0.6b), so one `vector(1024)` column fits all of them. Each vector records which model made it.

## Stories

### S1-1 Evaluation set (M)

**The job.** A fixed, versioned set of questions with known right answers, so every retrieval and confidence change is measured, not guessed.

**What changes.** `eval/retrieval-set.json`, generated in this session by Claude and checked in:
- For each of the 100 synthetic entries in `sample-data/security-qa.csv`: two English paraphrases (different wording, same need) and one Japanese version.
- About 30 security-flavoured questions the knowledge base **cannot** answer (for abstention and calibration).
- Each item: `id`, `text`, `language` (`en` or `ja`), `kind` (`paraphrase`, `translation`, `unanswerable`), `gold` (the entry's question text, empty for unanswerable), `review` (`unreviewed` for all Japanese until a native reader checks them), `split` (`calibrate` or `test`, split by entry so no entry appears in both).
- `eval/README.md`: how the set was made, the review status, and that it is synthetic.
- Japanese items are checked by translating them back to English and comparing; mismatches are rewritten. They stay labelled unreviewed (decision at the Sprint 0 review).

**Test cases.**
1. 200 English paraphrases, 100 Japanese, at least 30 unanswerable; every `gold` matches a question in the CSV exactly.
2. No paraphrase repeats its gold question word for word (normalised comparison).
3. No entry has items in both splits.
4. A validation test (Vitest) enforces 1 to 3 on every change to the file.

**Out of scope.** Japanese entries in the knowledge base (C-1, later).

**Boundaries.** Rule 2: synthetic only. Rule 1: Japanese marked unreviewed wherever results are reported.

### S1-2 Embedding provider and Edge Function (M)

**The job.** One way to turn text into vectors, whichever provider is configured, with the key never reaching the browser.

**What changes.**
- `supabase/functions/_shared/embeddings.ts`: an `EmbeddingProvider` interface (`embed(texts, kind: 'query' | 'document')`) with `voyage` and `ollama` implementations. Pure TypeScript, unit-tested with `fetch` mocked.
- `supabase/functions/embed/index.ts`: accepts `{ texts, kind }` from signed-in users only; limits of 128 texts and 8,000 characters each; returns `{ model, dimension, vectors }`. Provider, model and key come from function secrets (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `VOYAGE_API_KEY`, `OLLAMA_URL`).
- `supabase/functions/.env.example`; the real `.env` is ignored by git.
- CORS limited to the app's origin, not `*` (unlike the old Bolt functions).

**Test cases.**
1. Voyage provider sends `input_type: "query"` or `"document"` and the model name, and returns vectors in input order.
2. Ollama provider calls `/api/embed` with the model and returns vectors in order.
3. A vector of the wrong length is rejected (protects the 1,024 column).
4. Failure: provider returns 401, 429 or 500; the function returns a clear error, never the key or the provider's raw body.
5. Hostile: no JWT gives 401; 129 texts or one of 8,001 characters gives 400; the key never appears in any response (asserted).
6. The browser bundle contains no provider key or provider URL (build check).

**Boundaries.** Rule 3 (secrets server-side). Rule 6 (untrusted input sizes).

### S1-3 Vectors in the knowledge base (M)

**The job.** Every current entry has a vector from the configured model, kept up to date as entries are added.

**What changes.**
- Migration: `create extension vector`; `kb_entries.embedding vector(1024)`, `embedding_model text`, `embedded_at timestamptz`; HNSW index for cosine distance. Members cannot write these columns (column grants); only the service role can.
- `supabase/functions/embed-entries`: embeds current entries whose `embedding_model` differs from the configured model (or is empty), in batches; callable by signed-in users (it only fills gaps); returns counts.
- The app calls it after an import or add-back, and quietly on sign-in to fill any gaps (existing entries, or every entry after a model change). (Changed during the build from a separate `kb:reembed` command: simpler, and nothing to remember.)

**Test cases.**
1. Database: a member cannot set `embedding` or `embedding_model` directly; the service role can.
2. After import, every new entry gets a vector and the model name; existing entries are untouched.
3. Changing the model, then re-embedding, replaces every vector and model name; no entry is left with a mix.
4. Failure: the provider is down; the import still succeeds and entries are marked unembedded, retried next time.
5. Anonymous visitors cannot call `embed-entries`.

**Dependencies.** S1-2.

### S1-4 Model comparison (M)

**The job.** Choose the embedding model by measurement on our own data.

**What changes.** `npm run eval:retrieval` (a Node script in `eval/`), run on Rory's PC:
- Embeds the 100 entries and the evaluation set with each candidate, calling Voyage and Ollama directly (an offline measurement, not through the app).
- Candidates: the current keyword method (baseline), `voyage-4`, `bge-m3`, `qwen3-embedding:0.6b`.
- Reports recall@1, recall@5 and MRR for English paraphrases and Japanese-to-English, plus how often unanswerable questions score above typical answerable ones. Writes `docs/evals/retrieval-<date>.md` and `.json`.
- Caches vectors on disk, so reruns cost nothing.

**Test cases.**
1. Metric functions unit-tested on hand-made rankings (recall@k, MRR, edge cases with ties and empty results).
2. The keyword baseline runs here, with no network, and its numbers are recorded as the floor.
3. A run with a missing key or Ollama not running skips that candidate with a clear message instead of failing the whole run.
4. The report states the evaluation set version and that Japanese items are unreviewed.

**Decision rule (proposed).** Choose the model with the best Japanese-to-English recall@5, provided its English recall@5 is within 0.02 of the best English score. Hosted default and local default are chosen separately.

**Dependencies.** S1-1. Rory runs the command once Voyage's key and the two Ollama models are on his PC.

### S1-5 Hybrid retrieval in the app (M)

**The job.** The app finds entries by meaning and by keywords together, server-side.

**What changes.**
- Migration: generated `tsvector` column on `kb_entries` (English configuration) with a GIN index; database function `match_kb_entries(query_embedding, query_text, match_count)` that ranks by vector similarity and by keyword rank and fuses them with reciprocal rank fusion (k = 60). Returns entries, both scores, the fused rank, and the embedding model. `SECURITY INVOKER`, so row-level security applies.
- The workspace embeds all questions in one call to `embed`, then matches each; drafting keeps using `draftAnswer` on the returned sources.
- If embedding is unavailable, matching falls back to keywords only, and the screen says "keyword match only" with no calibrated confidence.
- The in-browser keyword index (`retrieval.ts`) is retired once the fallback exists.

**Test cases.**
1. Database: an exact question ranks its own entry first; a paraphrase with no shared keywords still finds it through the vector (using fixed test vectors).
2. Fusion: an entry ranked high by both beats one ranked high by only one.
3. Results respect row-level security (anonymous: refused).
4. Fallback: with `embed` failing, the 40 sample questions still get keyword drafts, labelled as such.
5. End to end on Rory's PC: the 40 sample questions, recall checked against the evaluation set's English items (manual spot check in the browser).

**Dependencies.** S1-3. The model choice from S1-4 is configuration, not code.

### S1-6 Calibrated confidence (M, folds in F-12)

**The job.** "80%" means the top entry is right about 80% of the time, so bulk approval above a threshold is a reasonable decision (rule 4).

**What changes.**
- `npm run eval:calibrate` fits a monotonic mapping (isotonic regression) from the top match's vector similarity to the observed chance it is right, on the `calibrate` split, and checks it on the `test` split. Output: `src/lib/calibration/<model>.json` (score breakpoints to probabilities), a reliability chart, and the expected calibration error, in `docs/evals/`.
- The app converts the top similarity to confidence with the mapping for the model that made the vectors. Unknown model: no calibrated confidence shown.
- A **"no good match"** floor: below it, the draft says no confident match and the question goes to a person.
- The confidence tooltip states what the number means and which evaluation set and model it was calibrated on.

**Test cases.**
1. The mapping is monotonic and stays within 0 to 1; interpolation between breakpoints is unit-tested.
2. On the test split, expected calibration error at most 0.10 (proposed bar).
3. Unanswerable questions: at least 80% score below the floor (proposed bar).
4. Unknown model or keyword-only fallback: confidence shows "not calibrated", and bulk accept by threshold is disabled.
5. The 40 sample questions no longer score 33 of 40 at 80% or more without evidence (F-12): reported, not forced.

**Dependencies.** S1-4 (needs the chosen model's scores) and S1-5.

### F-9 Report failed saves (S)

**What changes.** Single accept, edit, skip and the question inserts check for errors and show them, as bulk accept now does. A failed save reverts the screen.

**Test cases.** 1. A rejected update shows an error and the question returns to its previous state. 2. A failed insert of a session's questions is reported, not silently dropped.

## The sprint as a whole

**Order.** S1-1 and S1-2 first (independent); then S1-3; S1-4 (Rory's run) and S1-5 in parallel; S1-6 last; F-9 any time.

**Size.** Six medium, one small: similar to Sprint 0.

**Spike check.** No spike. S1-4 is a measurement whose method is fixed; S1-5 and S1-6 do not change shape whichever model wins (the model is configuration, and calibration is fitted per model).

**Hand-offs to Rory.** Voyage API key; `ollama pull bge-m3` and `ollama pull qwen3-embedding:0.6b`; running `npm run eval:retrieval` and `npm run eval:calibrate` on his PC.

## Questions for Rory

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | How should evaluation results get from your PC to me? | (a) Give me read access to `C:\Code\rfi-responder` so I can read the reports directly. (b) You commit and push them | (a): fewer steps for you |
| Q2 | Which local models to compare? | (a) `bge-m3` and `qwen3-embedding:0.6b` (both 1,024-dimension, small downloads). (b) Also `qwen3-embedding:8b`, cut down to 1,024 dimensions | (a): (b) can follow if the small ones disappoint |
| Q3 | The bars: English recall@5, Japanese recall@5, calibration error, abstention | (a) 0.90, 0.80, at most 0.10, 80% of unanswerable below the floor. (b) Set them after seeing the first results | (a), revisited at the review if the data says otherwise |
| Q4 | What does the evaluation knowledge base contain? | (a) Only the 100 synthetic entries, one right answer each. (b) Also the 8 seed entries, which overlap some of them | (a): overlaps make "right answer" ambiguous; they are a Sprint 3 problem (F-11) |

## Answers and changes (22 October 2026)

| # | Answer | Effect |
|---|---|---|
| Q1 | Folder access to `C:\Code\rfi-responder` | Claude reads evaluation reports directly; Rory only runs the commands |
| Q2 | `bge-m3` and `qwen3-embedding:0.6b` | S1-4 as written |
| Q3 | Bars agreed: English recall@5 0.90, Japanese recall@5 0.80, calibration error at most 0.10, 80% of unanswerable below the floor | S1-4 and S1-6 test cases as written; revisited at the review if the data says otherwise |
| Q4 | Evaluation knowledge base is the 100 synthetic entries only | S1-1 and S1-4 as written |

All seven stories: **Ready, Sprint 1**.

## Changes during the build (22 October 2026)

| Story | Change | Why |
|---|---|---|
| S1-3 | No separate `kb:reembed` command: the app fills gaps after imports and quietly on sign-in | Simpler, and covers model changes automatically |
| S1-5 | Rank by meaning whenever a query vector exists; keywords only as the fallback. Migration `20261022170000_vector_first_retrieval.sql` replaces equal-weight fusion | The first comparison (`docs/evals/retrieval-2026-10-22.md`) showed fusion lowered English recall@5 from 98.0% to 78.5% (qwen3-embedding:0.6b) and from 95.0% to 79.5% (bge-m3) |
| S1-2 | The Voyage provider waits and retries when rate-limited (Retry-After, else exponential back-off); the comparison uses smaller batches and patient retries | The first run skipped voyage-4: accounts without a payment method get only a few requests a minute |
| S1-3 | Extension functions granted explicitly to signed-in users and the server | The Sprint 0 hardening stopped new functions being executable by default, which included pgvector's own |
| S1-1, S1-6 | 34 near misses added to the evaluation set (set 2026-10-22.2); calibration counts them as wrong and both reports show them separately, with a bulk-approval check (near misses and wrong top entries at or above 80%) | In the app, questions the knowledge base cannot answer (mean time to detect, DSARs) scored 85%; the original unanswerable set held only off-topic questions |
| S1-6 | Abstention bar not met by any model once near misses are included (voyage-4: 35.3% of near misses below the floor). Floor kept at 0.3; an answerability check moves to Sprint 2 (decision 0006) | Similarity alone cannot tell "answers it" from "same topic"; a higher floor would send 8 to 12% of answerable questions to a person and still miss a third of near misses |
| S1-1 | Note: Japanese items translate the original question rather than reword it | Their 100% recall@5 shows crossing languages works, not that Japanese rewording does; reworded, reviewed Japanese items are a follow-up |
