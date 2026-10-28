# Edge Functions reference

The five Supabase Edge Functions (Deno) hold the keys the browser must never have: four are the only place the app calls an AI provider, and the fifth, `invite-user` (Sprint 15), sends invitations with the service role. The browser calls them with the user's session; they read and write the database with the service role where members cannot, and they hold the provider keys ([decision 0005](../decisions/0005-where-the-ai-runs.md)). How they fit into the whole system is in [ARCHITECTURE.md](../ARCHITECTURE.md).

| Function | What it does | Called from |
|---|---|---|
| [`process-questions`](../../supabase/functions/process-questions/index.ts) | Matches, checks, gates and drafts a batch of up to ten saved questions, and saves the results | `processInBatches` in [`src/lib/sessions.ts`](../../src/lib/sessions.ts), used by [`src/RFIWorkspace.tsx`](../../src/RFIWorkspace.tsx) |
| [`extract-questions`](../../supabase/functions/extract-questions/index.ts) | Finds the questions in a Word document's text blocks; saves nothing | `extractFromWord` in [`src/lib/wordExtraction.ts`](../../src/lib/wordExtraction.ts), used by [`src/RFIWorkspace.tsx`](../../src/RFIWorkspace.tsx) |
| [`embed`](../../supabase/functions/embed/index.ts) | Returns embedding vectors for up to 128 texts | Nothing in `src/` or `eval/` calls it; only the CI job below does |
| [`embed-entries`](../../supabase/functions/embed-entries/index.ts) | Embeds knowledge-base entries that have no vector from the configured model | `indexNewEntries` in [`src/lib/knowledgeBase.ts`](../../src/lib/knowledgeBase.ts), used by [`src/App.tsx`](../../src/App.tsx) and [`src/RFIWorkspace.tsx`](../../src/RFIWorkspace.tsx) |
| [`invite-user`](../../supabase/functions/invite-user/index.ts) | An admin invites someone by email; they join as a member (Sprint 15) | `inviteSomeone` in [`src/lib/invite.ts`](../../src/lib/invite.ts), used by [`src/UserManagement.tsx`](../../src/UserManagement.tsx) |

No function calls another; the browser calls each one through `supabase.functions.invoke`.

## What every function shares

All four are wrapped by `serve` and `requireUser` in [`_shared/http.ts`](../../supabase/functions/_shared/http.ts).

**Method.** `OPTIONS` gets `204` with the CORS headers and no body. Any method other than `POST` gets `405` with `{ "error": "Use POST" }`.

**Authentication.** `requireUser` takes the `Authorization` header, builds a Supabase client with `SUPABASE_URL` and `SUPABASE_ANON_KEY` that forwards it, and calls `auth.getUser` with the bearer token. If that fails or returns no user, the function answers `401` with `{ "error": "Sign in first" }`. The comment in `http.ts` notes that the gateway already rejects requests with no JWT (`supabase/config.toml` has no per-function setting), but the public anon key is itself a JWT, so the user is checked here too; a call with only the anon key gets `401` from this check. A gateway refusal has the gateway's own body, not this one.

**Authorisation.** No function checks a role (owner, admin or member) in its own code. What a caller may do is decided by row-level security where a function reads as the caller (`process-questions` reads the questions and matches the knowledge base as the caller), and by the daily caps and monthly budget, which are per user and per organisation. Writes the caller could not make themselves (scores, drafts, vectors, usage) use a second client built with `SUPABASE_SERVICE_ROLE_KEY`.

**CORS.** `APP_ORIGIN` is a comma-separated list of allowed browser origins (default `http://localhost:5173,http://127.0.0.1:5173`). Every response, including errors, carries `Access-Control-Allow-Origin` set to the request's `Origin` if it is in the list, otherwise to the first origin in the list; `Access-Control-Allow-Methods: POST, OPTIONS`; `Access-Control-Allow-Headers: Authorization, Content-Type, apikey, x-client-info`; and `Vary: Origin`. The function does not refuse a request from another origin: the browser does, by not letting the page read the reply. Calls from outside a browser are not affected.

**Errors.** Errors are JSON, `{ "error": "<message>" }`. An `HttpError` ([`_shared/errors.ts`](../../supabase/functions/_shared/errors.ts)) or an `EmbeddingError` ([`_shared/embeddings.ts`](../../supabase/functions/_shared/embeddings.ts)) is returned with its own status and message, which are written to be safe to show. Anything else is logged with `console.error` and returned as `500` with `{ "error": "Unexpected error" }`. A body that is not JSON is read as `null` and fails validation with `400`.

**Caps and budget.** Every function that spends calls `reserveQuota` ([`_shared/usage.ts`](../../supabase/functions/_shared/usage.ts)) before it calls any provider. That calls the database function `reserve_quota(p_user, p_kind, p_n, p_size)`, defined last in [`20261025130000_sprint5_review_fixes.sql`](../../supabase/migrations/20261025130000_sprint5_review_fixes.sql), which:

- takes a lock for the organisation's budget and a row lock on the caller's `ai_quota` row for today (`current_date` in the database);
- allows at most the request, the caller's remaining daily cap for that kind, and what the monthly budget still covers;
- adds the allowed units to today's count and, if any were allowed, inserts an `ai_reservations` row holding their estimated cost against the budget;
- returns `{ allowed, reason, reservation }`, where `reason` is `daily_questions`, `daily_embed`, `daily_extract` or `monthly_budget` when less than the request was allowed.

`reserveQuota` turns that into errors: `503` with `{ "error": "Usage could not be checked, so nothing was processed. Try again shortly." }` if the call fails or returns something unreadable (fail closed), and `429` with the plain message from `quotaMessage` when nothing at all was allowed. The four messages say which limit was reached and that an admin can raise it under Governance, Usage and limits.

| Setting (`ai_settings`, changed by an admin) | Default | Used for |
|---|---|---|
| `daily_question_cap` | 300 | `process-questions`, per user per day |
| `daily_embed_cap` | 5000 | `embed` and `embed-entries`, texts per user per day |
| `daily_extract_cap` | 20 | `extract-questions`, documents per user per day |
| `monthly_budget_gbp` | 10 | All functions, for the whole organisation |
| `gbp_per_usd` | 1.00 | Converts the budget to dollars, the currency prices are in |
| `est_usd_per_question` | 0.002 | Reserved per question |
| `est_usd_per_embed_text` | 0.0001 | Reserved per text embedded |
| `est_usd_per_extract_kchar` | 0.0005 | Reserved per 1,000 characters of a document (at least one) |

The month's committed spend (`month_committed_usd()`) is the recorded `ai_usage.cost_usd` this month plus the estimates in unsettled reservations this month. Units added to the daily count are not given back afterwards, even if fewer calls were made.

**Recording usage.** Each provider call is wrapped (`meteredClaude`, `meteredEmbedder`, `meteredFetch` in `usage.ts`) so that a successful call adds a row (`kind`, `provider`, `model`, `input_tokens`, `output_tokens`) to a list. A failed call adds nothing. In a `finally` block, so calls made before an error are recorded too, `finishUsage` inserts the rows into `ai_usage` with the user, the function name and the session (if any), then calls `settle_reservation` for each reservation, which deletes it. If the insert fails, the reservations are kept, so their estimates go on counting against the budget. With no rows to record, the reservations are settled straight away. After a successful record it runs `purge_old_usage` (Sprint 11), which applies the 13-month retention; a failed purge is logged and changes nothing else.

**Pricing.** A trigger on `ai_usage` (`price_usage`, in [`20261024110000_usage_and_caps.sql`](../../supabase/migrations/20261024110000_usage_and_caps.sql)) sets `cost_usd` from `ai_prices` by provider and model: input tokens times the input price plus output tokens times the output price, per million tokens. Rows from `ollama` cost 0. A model with no price row is stored with `cost_usd` NULL, and the governance page names it (`usage_report`'s `unpricedModels`, Sprint 11). Migrations add prices for `anthropic` `claude-haiku-5-5` and `claude-sonnet-5-5`, and `voyage` `voyage-4`, `rerank-2.5` and (Sprint 11) `rerank-3`, each with the date checked and its source; admins can change them, and every change is audited. The model priced is the name the provider reports in its reply (Claude) or the configured name (Voyage, Ollama). Voyage embeddings record the provider's token count; Ollama reports none, so its tokens are estimated as characters divided by four. Voyage rerank records `usage.total_tokens` from the reply.

## process-questions

**Purpose.** Story S2-2a. Scores, gates and drafts a batch of saved questions and writes the results to `rfi_questions` with the service role, because members cannot write those columns (migration [`20261023100000_server_side_processing.sql`](../../supabase/migrations/20261023100000_server_side_processing.sql)). The app sends a session's questions ten at a time; at a `429` it stops sending further batches and reports the rest as not processed.

**Authorisation.** The questions are read as the caller, so row-level security decides which they may process. The current `SELECT` policy on `rfi_questions` lets every signed-in user read every question (sessions and questions are team-shared, [decision 0003](../decisions/0003-access-control.md)), so in practice any signed-in user can process any pending question. There is no owner or admin check in the function.

**Request.** `POST` with a JSON body, checked by `validateProcessRequest` in [`_shared/process-core.ts`](../../supabase/functions/_shared/process-core.ts):

| Field | Type | Rule | Error (`400`) |
|---|---|---|---|
| `sessionId` | string | A UUID | `sessionId must be a UUID` |
| `questionIds` | string[] | 1 to 10 items (`MAX_BATCH`) | `questionIds must list 1 to 10 questions` |
| `questionIds[]` | string | Each a UUID | `questionIds must be UUIDs` |

Duplicate ids are removed after the checks.

**Response.** `200` with:

```json
{ "processed": [ ... ], "limit": "message or null" }
```

`limit` is the quota message when the caps let through fewer questions than were sent, otherwise `null`. If every question was already processed, the function returns early with `{ "processed": [...] }` and no `limit` field. Each entry in `processed` is one of:

| Shape | When |
|---|---|
| `{ id, saved: true, gate, draftKind, confidence, note }` | Processed and written. `gate` is `pricing`, `legal`, `unchecked`, `translation`, `japanese`, `unreviewed_source`, `stale_source`, `unindexed_entries` or `null`; `draftKind` is `generated`, `assembled`, `insufficient_evidence` or `person_required`; `confidence` is the calibrated confidence (three decimal places) or `null`; `note` is the processing note or `null` |
| `{ id, saved: false, gate, draftKind, confidence, note }` | Processed, but the database update returned an error |
| `{ id, saved: true, skipped: true }` | Already processed or no longer pending, so not processed again; or another call wrote it first |
| `{ id, saved: false, note }` | Held back by the cap or budget; `note` is the same message as `limit` |

**Errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | See the request table | Validation |
| `400` | `Some questions are not in this session` | Fewer rows came back than ids were sent: an id is not in the session, or row-level security hid it |
| `401` | `Sign in first` | No signed-in user |
| `429` | A `quotaMessage` | The cap or budget allowed none of the pending questions |
| `500` | `Could not read the questions` | The read as the caller failed |
| `503` | `Usage could not be checked, so nothing was processed. Try again shortly.` | `reserve_quota` failed |
| `500` | `Unexpected error` | Anything else thrown |

Provider failures and unreadable model replies do not produce an error status: each is handled per question and described in its `note` (see below). The CI job checks that a batch still returns `200` with every provider failing.

**Steps.**

1. Authenticate, validate, and read `id, question, status, processed_at` for the ids in the session, as the caller.
2. Skip questions with `processed_at` set or `status` other than `pending`, so a question is processed once (reprocessing could reroll a gate or replace an accepted draft). If none remain, return.
3. Reserve the remaining questions (`reserve_quota`, kind `questions`). Questions beyond `allowed` are held and returned unprocessed.
   - **Index first** (Sprint 11, `indexBeforeMatching` in [`_shared/embed-core.ts`](../../supabase/functions/_shared/embed-core.ts)): entries with no vector from the configured model are indexed, at most two batches of 64, each reserved against the caller's indexing cap; refusal or failure is not an error. The number still missing (counted up to 500) is passed on.
4. Run `processQuestions` ([`_shared/process-core.ts`](../../supabase/functions/_shared/process-core.ts)) on the allowed questions, at most three at a time:
   - **Embed** all the batch's questions in one call, as queries. If no provider is configured, or the call fails, matching uses keywords only and the note says so.
   - **Match** each question with the database function `match_kb_entries` (as the caller, `match_count` 5, with the vector and model name when there is one). A failure leaves no matches and adds a note.
   - **Select sources** (`selectDraftSources`, [`_shared/sources.ts`](../../supabase/functions/_shared/sources.ts)): with vectors, the best entry and any within 0.05 similarity of it, at most three; keyword-only, the top two keyword matches.
   - **Gate and check answerability**, in parallel. The gate (`gateQuestion`, [`_shared/gates.ts`](../../supabase/functions/_shared/gates.ts)) runs English and Japanese rules and a Claude classifier; a question is `pricing` or `legal` if either fires (pricing wins); `unchecked` if the classifier could not be asked and the rules found nothing; a classifier reply unreadable twice counts as `legal`. The answerability check ([`_shared/answerability.ts`](../../supabase/functions/_shared/answerability.ts)) runs only with a vector and at least one source: the Claude judge (verdict `yes`, `partly` or `no`, retried once after an unreadable reply) or a Voyage reranker. With no checker configured, the top similarity is used instead. A failed or twice-unreadable check gives no calibrated confidence and a note; it is never treated as `no`.
   - **Calibrate** (`calibratedConfidence`, [`_shared/calibration.ts`](../../supabase/functions/_shared/calibration.ts)) with the table in [`_shared/calibration-tables.ts`](../../supabase/functions/_shared/calibration-tables.ts) for the method: the embedding model alone, or `<embedding model> + <checker model>`. Tables exist for `voyage-4`, `bge-m3`, `qwen3-embedding:0.6b`, `voyage-4 + claude-haiku-5-5` and `qwen3-embedding:0.6b + claude-haiku-5-5`. No table means no confidence, and a note.
   - **Language gates** (Sprint 12, after drafting). A question's language is Japanese if at least a fifth of it is kana or kanji, after NFKC folding (`textLanguage` in `_shared/sources.ts`, the database's rule for entries). If the entries the draft cites (or, with no draft, the matched entries) include one in the other language, the question is gated `translation` and a generated draft carries a label naming the direction; a draft written in the other language whatever it cites is gated `translation` too (security review, M1); a Japanese question answered only from Japanese entries is gated `japanese`. Earlier gates (pricing, legal, unchecked) are kept. A language gate is never released, so when the cited entries also need review, that is added to its reason rather than replacing it.
   - **Draft.** Pricing: no draft, fixed text, kind `person_required`. No sources: kind `insufficient_evidence`. Confidence below 0.3 (`NO_MATCH_FLOOR`): kind `insufficient_evidence`, sources kept. Otherwise, if a drafter is configured and there is a vector, `draftGrounded` ([`_shared/drafting.ts`](../../supabase/functions/_shared/drafting.ts)) asks Claude for an answer from the sources only. Without a drafter or a vector, or if the drafting call throws, the draft is assembled from the sources' own sentences (`draftAnswer`, [`_shared/assemble.ts`](../../supabase/functions/_shared/assemble.ts)), kind `assembled`.
   - **Code checks on a generated draft** (`checkDraft`): it must cite at least one entry, cite only entries it was given, contain no figure, number word, Japanese numeral figure or digit from another script that is not in its cited entries, contain no link or email address not in them, and contain no trace of the system prompt. A draft that fails, or an unreadable reply, becomes `insufficient_evidence` with the reason in the text and the note. A Japanese draft is labelled as translated.
   - **Review gates.** If there is still no gate and the draft cites entries, `entry_review_status` (service role) is read for them: an unreviewed entry gives `unreviewed_source`; a replaced or overdue entry gives `stale_source`; if the status cannot be read, `unchecked`.
   - **Incomplete index** (Sprint 11). When a question was matched by meaning while entries were still missing a vector, the note says how many were not searched and, if it has no gate yet, it gets `unindexed_entries`.
5. Save each result with the service role, with `processed_at IS NULL` in the update so that two overlapping calls cannot both write a question. The columns written are `generated_answer`, `confidence`, `retrieval_score`, `sources_json`, `answerability`, `verdict`, `gate`, `gate_reason`, `language`, `embedding_model`, `judge_model`, `judge_best_ref`, `judge_reason`, `draft_model`, `prompt_version`, `calibration_set`, `draft_kind`, `cited_refs`, `processing_note` and `processed_at`. `prompt_version` is the drafting prompt's version (`DRAFT_PROMPT_VERSION`) when Claude drafted, otherwise `null`; the classifier's model and the judge's and classifier's prompt versions are not stored on the question (the classifier's model is in `ai_usage`).
6. In `finally`: record usage under the function name `process-questions` and the session id, and settle the reservation.

**Provider calls.**

| Call | Usage `kind` | Model | Configured by |
|---|---|---|---|
| Embedding (one per batch) | `embed` | `voyage-4` or `qwen3-embedding:0.6b` by default | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `VOYAGE_API_KEY`, `OLLAMA_URL` |
| Answerability judge (at most two per question) | `judge` | `claude-haiku-5-5` | `ANSWERABILITY_CHECKER`, `ANTHROPIC_API_KEY` |
| Answerability rerank (at most one per question) | `rerank` | The `rerank-...` value given | `ANSWERABILITY_CHECKER`, `VOYAGE_API_KEY` |
| Pricing and legal classifier (one or two per question) | `gate` | `claude-haiku-5-5` | `GATE_MODEL`, `ANTHROPIC_API_KEY` |
| Drafting (at most one per question) | `draft` | `claude-haiku-5-5` | `DRAFT_MODEL`, `ANTHROPIC_API_KEY` |

`ANSWERABILITY_CHECKER` (default `claude-haiku-5-5`): `none` means no checker; a value starting `rerank-` uses the Voyage reranker with that model (the scoring instruction is added only for `rerank-2.5` models); any other value is used as the Claude judge's model name. If the chosen checker's key is not set, every check fails (confidence `null`, with a note) rather than quietly falling back. Without `ANTHROPIC_API_KEY` there is no classifier (questions the rules do not gate are `unchecked`) and no drafter (drafts are assembled).

## extract-questions

**Purpose.** Story S5-2. The browser reads a `.docx` into text blocks ([`src/lib/wordDocument.ts`](../../src/lib/wordDocument.ts)) and sends only the blocks. Claude proposes which blocks hold questions; code keeps only what it can find in the document itself. Nothing is saved: the person checks the list in the preview and saves it.

**Request.** `POST` with `{ "blocks": Block[] }`, checked by `validateExtractRequest` in [`_shared/extraction.ts`](../../supabase/functions/_shared/extraction.ts). Every failure is `400`.

| Rule | Error |
|---|---|
| `blocks` is a non-empty array | `Send { blocks: [...] } from a Word document` |
| At most 20,000 blocks | `The document has too many blocks` |
| Each block: `id` matches `b` followed by 1 to 6 digits; `kind` is `paragraph`, `heading` or `cell`; `text` is a string, not blank, at most 20,000 characters; `number`, if present, a string of at most 20 characters | `A block in the request is not valid` |
| `text` plus `number` over all blocks at most 200,000 characters | `The document has more than 200,000 characters of text` |

`level`, `table`, `row` and `col` are kept when they are integers and dropped otherwise; any other field is dropped.

**Response.** `200` with:

| Field | Meaning |
|---|---|
| `questions` | In document order. Each has `question` (always the document's wording), `number` (the block's own list number, a part number built from it such as `3(a)`, or the reference in the first cell of a table row; empty if none), `blockIds`, `part` (true for one part of a split multi-part question) and `fromBlock` (the source block text, for the preview) |
| `dropped` | How many of Claude's suggestions were dropped because they could not be found in the document |
| `method` | `ai`, or `rules` when Claude was not used or failed |
| `model` | The model Claude reported, or `null` with rules |
| `promptVersion` | `EXTRACT_PROMPT_VERSION`, or `null` with rules |

**Errors.** `400` (validation), `401` (`Sign in first`), `429` (daily document limit or budget, from `reserveQuota`), `503` (usage could not be checked), `500` (`Unexpected error`). A Claude failure or an unreadable reply is not an error: the whole document falls back to the rules.

**Steps.**

1. Authenticate and validate.
2. Reserve one document (kind `extract`) with its size: the sum over blocks of text length, number length and 40, capped at 1,000,000. The database reserves `est_usd_per_extract_kchar` per 1,000 characters.
3. If `ANTHROPIC_API_KEY` is set, `extractQuestions` splits the blocks into chunks of about 30,000 characters, overlapping by up to three blocks (never more than a quarter of a chunk), and asks Claude for each chunk in turn (structured output, at most 8,000 reply tokens). Each suggestion is kept only if its blocks are in that chunk and next to each other (at most three) and its text matches, after folding spacing, quotes, dashes, case and a leading list number, a whole block, a whole sentence of one block (at least three words), or two or three whole adjacent blocks; or, for a part, the lead-in and one lettered part of a single block. Duplicates across chunks are kept once. If any chunk's call throws or its reply is unreadable, the result is the rules' result for the whole document.
4. Without a key, or after a failure, `rulesExtract` takes the cells (below the first row) of any table column whose first-row cell contains "question" or "requirement", and other non-heading blocks of at least eight characters that end in `?` or start with a request verb such as "Describe" or "Provide".
5. In `finally`: record usage (kind `extract`) under `extract-questions` with no session, and settle the reservation.

**Provider calls.** Claude, `EXTRACT_MODEL` (default `claude-haiku-5-5`), one call per chunk.

## embed

**Purpose.** Returns embedding vectors for a list of texts, keeping the provider key server-side. Nothing in the app calls it; question embedding happens inside `process-questions`, and entry embedding in `embed-entries`. It stays because CI uses it to test the function boundary: sign-in, limits and provider failures.

**Request.** `POST` with `{ "texts": string[], "kind": "query" | "document" }`, checked by `validateEmbedRequest` in [`_shared/embed-core.ts`](../../supabase/functions/_shared/embed-core.ts). Every failure is `400`.

| Rule | Error |
|---|---|
| `texts` is a non-empty array | `Send { texts: string[], kind: "query" \| "document" }` |
| At most 128 texts (`MAX_TEXTS`) | `At most 128 texts per request` |
| Every item a string | `Every text must be a string` |
| Each at most 8,000 characters (`MAX_CHARS`) | `Each text must be at most 8000 characters` |
| `kind` is `query` or `document` | `kind must be "query" or "document"` |

**Response.** `200` with `{ model, dimension, vectors }`: the model that produced the vectors, `1024` (`EMBEDDING_DIMENSION`), and one vector of 1,024 numbers per text, in input order.

**Errors.**

| Status | When |
|---|---|
| `400` | Validation |
| `401` | No signed-in user |
| `429` | The daily embedding cap or the budget would not allow all the texts. The reservation is all or nothing (Sprint 11), so a refused request uses none of the day's allowance. Or the provider rate-limiting (Voyage after its retries) |
| `502` | The provider rejected the credentials, returned another HTTP error, or returned the wrong number or length of vectors |
| `503` | The provider could not be reached; usage could not be checked; or `The embedding service is not configured.` (no `VOYAGE_API_KEY`, or an unknown `EMBEDDING_PROVIDER`; the detail is logged, Sprint 11) |
| `500` | `Unexpected error` |

**Steps.** Authenticate, validate, build the provider (`providerForRequest`), reserve all of `texts.length` or nothing (kind `embed`, `p_all`), refusing with `429` when nothing is allowed, embed with the configured provider, and in `finally` record usage under `embed` and settle the reservation.

## embed-entries

**Purpose.** Story S1-3. Embeds current knowledge-base entries whose vector is missing or came from a different model, so a model change leads to a re-embed rather than mixed vectors. Any signed-in user may call it, because it only fills gaps; it writes with the service role because members cannot write the vector columns (migration [`20261022150000_kb_vectors.sql`](../../supabase/migrations/20261022150000_kb_vectors.sql)). The app calls it after entries are added and treats a failure as "not indexed yet": the next call picks the entries up.

**Request.** `POST`. The body is not read; the app sends `{}`.

**Response.** `200` with:

| Field | Meaning |
|---|---|
| `embedded` | Entries embedded and saved in this call |
| `model` | The configured embedding model |
| `limited` | True if the cap or budget stopped the run early |
| `limit` | The quota message when `limited`, otherwise `null` |

**Errors.**

| Status | When |
|---|---|
| `401` | No signed-in user |
| `429` | The cap or budget was reached before any entry was embedded, with the message for the limit actually reached, the budget or the daily cap (Sprint 11) |
| `503` | Usage could not be checked; or `The embedding service is not configured.` |
| `429`, `502`, `503` | A provider failure in any batch (rate-limited, rejected or unreachable): the provider's status, with its message followed by how many entries were embedded before it and `run again to continue` |
| `500` | Reading or saving entries failed: `The knowledge base could not be read for indexing.` or `An index entry could not be saved.` The database's message is logged, not returned (Sprint 11, `serviceEntryStore` in [`_shared/entry-store.ts`](../../supabase/functions/_shared/entry-store.ts)); or `Unexpected error` |

**Steps.** `embedPendingEntries` in [`_shared/embed-core.ts`](../../supabase/functions/_shared/embed-core.ts) repeats, up to 40 batches of 64 (at most 2,560 entries per call):

1. Read up to 64 pending entries with `pending_embeddings(model, max_rows)` (service role): entries not superseded whose vector is missing or from another model.
2. Reserve them (kind `embed`). If fewer are allowed, embed only those and stop.
3. Embed each entry's question and answer together as a document, and save `embedding`, `embedding_model` and `embedded_at` for the whole batch in one call, `save_entry_vectors` (Sprint 16). Before, each entry was saved with its own request: on the live demo the run that re-indexed 128 entries after a reset, Voyage calls included, took 11.3 seconds. An entry deleted since it was read is skipped; a malformed or repeated one refuses the batch. In the app, a call made while one is still running joins it rather than starting a second run.
4. Stop when a batch is short, the cap is reached, or the batch limit is reached.

Each batch has its own reservation. In `finally`, usage is recorded under `embed-entries` with no session and every reservation is settled.

**Provider calls.** The configured embedding provider, `document` input type.

## invite-user

**Purpose.** Story S15-5 (F-3). An admin invites someone from the **Team** page instead of the Supabase dashboard. Inviting needs the service role, so it happens here. The person always joins as a member: an admin makes them an admin afterwards with `set_user_admin`, which is audited.

**Request.** `POST` with `{ "email": string, "displayName"?: string }`, checked by `validateInvite` in [`_shared/invite-core.ts`](../../supabase/functions/_shared/invite-core.ts). Anything else in the body is ignored. The address is trimmed and lower-cased, and must look like an address, with at most 254 characters (64 before the `@`), no control characters or line breaks, and not on a reserved domain that cannot receive mail (`.invalid`, `.test`, `.example`, `.localhost`); the name, optional, at most 100 characters, with none either. Every failure is `400`.

**Response.** `200` with `{ message }`: `Invitation sent to <address>. They join as a member.`, or, if the invitation went but its audit row could not be written, a message saying so.

**Errors.**

| Status | When |
|---|---|
| `400` | Validation |
| `401` | No signed-in user |
| `403` | The caller is not an admin |
| `409` | The address already has an account, confirmed or not; nothing is sent |
| `429` | The admin has sent 20 invitations today (UTC); or Supabase's email limit for the project was reached |
| `502` | The mail service did not take the invitation (the detail is logged) |
| `500` | `Unexpected error` |

**Steps.** Authenticate and validate. Then `reserve_invitation` (service role only), under a lock per admin: the caller must be an admin, the address must have no account at all (so the demo's fictional people and reviewers who have not yet accepted are never sent a fresh link), and the admin must have sent fewer than 20 today (UTC); it takes a slot. Then Supabase Auth's `inviteUserByEmail`, with the name as `display_name` and the first `APP_ORIGIN` as the link's destination; if nothing was sent, `release_invitation` gives the slot back. Last, the audit row `user.invited` with the admin as actor and the new account as target, and no address, so deleting the person later leaves no address in the log. A sent invitation keeps its slot even if the audit row fails, so the limit still holds. CORS limits which web pages can call it from a browser; the function itself requires a signed-in admin's token whatever the origin.

## Embedding and Claude clients

| Provider | Endpoint | Retries | Errors |
|---|---|---|---|
| Voyage embeddings ([`_shared/embeddings.ts`](../../supabase/functions/_shared/embeddings.ts)) | `https://api.voyageai.com/v1/embeddings`, asks for 1,024 dimensions | Up to 3 tries on `429`, honouring `Retry-After` or backing off from 1 second | Unreachable `503`; `429` after retries `429`; `401`/`403` `502`; other `502` |
| Ollama embeddings (same file) | `<OLLAMA_URL>/api/embed`; `qwen3-embedding` queries get a retrieval instruction prefix | None | Unreachable `503`; `429` `429`; `401`/`403` `502`; other `502` |
| Voyage rerank ([`_shared/answerability.ts`](../../supabase/functions/_shared/answerability.ts)) | `https://api.voyageai.com/v1/rerank` | Up to 3 tries on `429` | Treated as a failed check, never a function error |
| Claude ([`_shared/claude.ts`](../../supabase/functions/_shared/claude.ts)) | `https://api.anthropic.com/v1/messages`, `anthropic-version` `2026-10-21`, structured output with a JSON schema | Up to 3 tries on `429` and `529` | Unreachable `503`; busy `429`; `401`/`403` `502`; other `502`. A reply that did not end normally, or is not JSON, comes back as no data |

Error messages never include the key or the provider's response body. Every Claude system prompt has a canary string appended, which the drafting and note checks look for. Embedding vectors of the wrong number or length are rejected with `502`.

## Environment variables

Set locally in a `.env` file in `supabase/functions/` (ignored by git, copied from [`supabase/functions/.env.example`](../../supabase/functions/.env.example)) or as function secrets when hosted. Never in the app's `.env`, which is built into the browser bundle.

| Variable | Default | Read by | Notes |
|---|---|---|---|
| `SUPABASE_URL` | None | All five (`http.ts` and each `index.ts`) | Not in `.env.example`; the Supabase CLI and hosted platform supply it |
| `SUPABASE_ANON_KEY` | None | All five (`requireUser`) | As above |
| `SUPABASE_SERVICE_ROLE_KEY` | None | All five | As above. Secret |
| `APP_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | All five (`http.ts`); `invite-user` | Comma-separated allowed browser origins. `invite-user` sends the invitation's link to the first |
| `EMBEDDING_PROVIDER` | `voyage` | `process-questions`, `embed`, `embed-entries` | `voyage` or `ollama` |
| `EMBEDDING_MODEL` | `voyage-4` (Voyage), `qwen3-embedding:0.6b` (Ollama) | As above | |
| `VOYAGE_API_KEY` | None | As above, and `process-questions` for a `rerank-...` checker | Secret. Required for Voyage |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | As above | Ollama as seen from inside Docker |
| `ANTHROPIC_API_KEY` | None | `process-questions`, `extract-questions` | Secret. Without it: no classifier, judge or drafter; extraction uses the rules |
| `ANSWERABILITY_CHECKER` | `claude-haiku-5-5` | `process-questions` | See process-questions |
| `GATE_MODEL` | `claude-haiku-5-5` | `process-questions` | |
| `DRAFT_MODEL` | `claude-haiku-5-5` | `process-questions` | |
| `EXTRACT_MODEL` | `claude-haiku-5-5` | `extract-questions` | |

`OLLAMA_URL_HOST` in `.env.example` is read by the evaluation scripts, not by the functions. The caps, budget, cost estimates and prices are database settings (see "Caps and budget"), not environment variables.

## Shared modules

All in [`supabase/functions/_shared/`](../../supabase/functions/_shared/). Most are plain TypeScript with no Deno imports, so the evaluation scripts and Vitest use the same code.

| Module | What it holds |
|---|---|
| `http.ts` | `serve` (method, CORS, error handling), `requireUser`, `json`, `corsHeaders` |
| `errors.ts` | `HttpError`, an error with a status and a message safe to show |
| `usage.ts` | Metering wrappers, `reserveQuota`, `quotaMessage`, `recordUsage`, `finishUsage` |
| `embeddings.ts` | Voyage and Ollama providers, `providerFromEnv`, `EmbeddingError`, rate-limit retry, `EMBEDDING_DIMENSION` |
| `invite-core.ts` | `validateInvite` and `inviteUser`, the logic of `invite-user` (Sprint 15) |
| `embed-core.ts` | `validateEmbedRequest` and `embedPendingEntries`, the logic of `embed` and `embed-entries` |
| `claude.ts` | The Claude client for structured output, and the prompt canary |
| `process-core.ts` | `validateProcessRequest` and `processQuestions`, the batch pipeline |
| `sources.ts` | Which matches a draft is built from |
| `answerability.ts` | The Claude judge and Voyage rerank checkers |
| `calibration.ts` | Calibrated confidence from a table, and the 0.3 floor |
| `calibration-tables.ts` | Generated calibration tables (`npm run eval:calibrate`); not edited by hand |
| `gates.ts` | Pricing and legal rules and the classifier |
| `drafting.ts` | Grounded drafting and the code checks on drafts |
| `assemble.ts` | Assembled drafts and the fixed texts when there is no draft |
| `safe-text.ts` | `safeNote` (withholds model-written notes with links or prompt text; at most 300 characters) and the link pattern |
| `extraction.ts` | Word extraction: validation, chunking, the checks against the document, and the fallback rules |
| `duplicate-thresholds.json` | Learning thresholds from the evaluations; not read by the functions (the database holds them, tested in `supabase/tests/db/sprint6.test.ts`) |

## Tests

**Unit tests** (`npm test`, Vitest project `unit`), in `_shared/`:

| File | Covers |
|---|---|
| [`process-core.test.ts`](../../supabase/functions/_shared/process-core.test.ts) | The batch pipeline with fakes: normal run, near miss, pricing and legal gates, Japanese, every provider down in turn, no checker, no table, request validation, drafting checks, review gates |
| [`sprint6.test.ts`](../../supabase/functions/_shared/sprint6.test.ts) | Judge and classifier retries after unreadable replies, usage rows per attempt, replaced entries |
| [`sprint2-modules.test.ts`](../../supabase/functions/_shared/sprint2-modules.test.ts) | Claude client, gate rules and classifier, answerability checkers |
| [`extraction.test.ts`](../../supabase/functions/_shared/extraction.test.ts) | Extraction, validation limits, hostile documents, fallback rules |
| [`embed-core.test.ts`](../../supabase/functions/_shared/embed-core.test.ts) | `embed` validation; `embed-entries` batching, caps, failure part-way |
| [`embeddings.test.ts`](../../supabase/functions/_shared/embeddings.test.ts) | Voyage and Ollama providers, vector checks, `providerFromEnv`, rate-limit retry |
| [`usage.test.ts`](../../supabase/functions/_shared/usage.test.ts) | Metering, `reserveQuota` (`429`, `503`, size), `finishUsage` |
| [`invite-core.test.ts`](../../supabase/functions/_shared/invite-core.test.ts) | `invite-user`: validation and hostile input, admins only, the daily limit, an existing account, mail failures, the audit row by id only |
| [`calibration.test.ts`](../../supabase/functions/_shared/calibration.test.ts), [`sources.test.ts`](../../supabase/functions/_shared/sources.test.ts) | Calibration and source selection |

The `index.ts` files themselves have no unit tests; CI type-checks them with `deno check`.

**Client side:** [`src/lib/sessions.test.ts`](../../src/lib/sessions.test.ts) (`processInBatches`: batches of ten, progress, a `429` stopping later batches, held questions, the gateway's `503` when the functions server is not running) and [`src/lib/wordExtraction.test.ts`](../../src/lib/wordExtraction.test.ts) (`extractFromWord` passing on the server's reason), and [`src/lib/invite.test.ts`](../../src/lib/invite.test.ts) (`inviteSomeone` sending only the address and name, and passing on the server's reason). `indexNewEntries` has no unit test.

**Database** (`npm run test:db`): `reserve_quota`, pricing and `settle_reservation` in [`supabase/tests/db/sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) and [`supabase/tests/db/sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts); the columns only the service role may write in [`supabase/tests/db/processing.test.ts`](../../supabase/tests/db/processing.test.ts); `pending_embeddings` in [`supabase/tests/db/vectors.test.ts`](../../supabase/tests/db/vectors.test.ts); `match_kb_entries` in [`supabase/tests/db/hybrid.test.ts`](../../supabase/tests/db/hybrid.test.ts); `entry_review_status` in [`supabase/tests/db/sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts).

**CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), job `supabase`, step "Edge Functions refuse unsigned calls, enforce limits, and fail safely"). It starts the local stack, serves the functions with an unreachable Ollama and fake keys, and checks:

- `embed` with no JWT: `401`; with only the anon key: `401`;
- `embed` signed in with 129 texts: `400`; signed in with one text and the unreachable provider: `503`;
- `embed-entries` with the unreachable provider: `503`;
- no response contains the fake key;
- `process-questions` with no JWT: `401`; with 11 ids: `400`;
- a member cannot set `confidence` through the API;
- `process-questions` on a pricing question and a security question returns `200` with every provider failing: the pricing question `person_required` and gated `pricing` by the rules alone, the other gated `unchecked`.

`extract-questions` is not called by CI.

## Running locally

From the README:

```bash
npm run db:start                     # local Supabase stack
cp supabase/functions/.env.example supabase/functions/.env   # then add the keys
npm run db:reset                     # migrations and the synthetic seed
npx supabase functions serve         # the Edge Functions, in a second window
npm run dev                          # http://127.0.0.1:5173
```

The default `APP_ORIGIN` already allows the Vite development server. Without `ANTHROPIC_API_KEY` the functions still run with the fallbacks described above (rules gate, assembled drafts, rules extraction); without a reachable embedding provider, matching uses keywords only. With `EMBEDDING_PROVIDER=ollama`, Ollama must be reachable from inside Docker at `OLLAMA_URL`. If the functions server is not running, the app says so (the gateway's `503`). To type-check the functions as CI does: `deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`.
