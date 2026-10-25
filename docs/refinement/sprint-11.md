# Sprint 11 refinement: what reading the code turned up

Refined 25 October 2026, after Rory confirmed Sprint 11 ("please run sprint 11"). The items come from writing the Sprint 10 technical reference and from its accuracy review: F-42 to F-56 and BUG-33 in `docs/BACKLOG.md`. All are small, all are in code the reference now describes, and none waits on a spike. Each story's fix also corrects the guide or reference page that describes the old behaviour, so the documentation tests keep holding.

## What refinement found

- **One item changes the record of what was sent (F-42).** Recording an export marks the session exported, but nothing stops the owner, an admin or an assignee changing its questions afterwards. Changing an accepted answer reopens it, inside a session the overview calls exported. The archive already locks everything through a trigger (`refuse_if_archived`); the export does not.
- **One item makes matching silently incomplete (F-43).** A knowledge-base entry without a vector is never matched while the question has one. Indexing runs at sign-in and after an import, under the caller's daily indexing cap, so a busy day or a provider failure leaves entries invisible with no sign on the question.
- **One item makes local mode unusable for bulk approval (F-55).** The code's Ollama default is `bge-m3`, which has no calibration with the checker; decision 0006 chose `qwen3-embedding:0.6b`, which has one.
- **F-48 cannot be fixed by inventing prices.** Project rule 1: prices are copied from the provider's published page with the date checked, or the screen says the cost is unknown.
- **F-52 is a decision, not a fix.** The settings row, model prices and learning thresholds must exist on a fresh install, hosted or local, so they cannot move to `seed.sql` (which is local only). The rule needs rewording, or they need another home.

## Stories

### S11-1 A change after an export is recorded, and the export recorded again (F-42). L

**The job.** What the database says was sent is what was sent. Today an owner, admin or assignee can edit or re-decide a question after its export is recorded, and nothing records it: the session still says exported. Rory's answer (Q1): changes stay allowed, but they reopen the export, which must be recorded again, and both exports are in the audit log.

**What changes.** A migration adds `rfi_sessions.changed_since_export_at`. A trigger on `rfi_questions` notices a person changing the status or answer of a question in an exported session (not `record_export`'s own writes): it sets `changed_since_export_at`, writes `question.changed_after_export` to the audit log (who, which question, what changed), and clears the question's learning record, so its corrected answer is learned when the export is recorded again (an admin's replaces the entry learned before; anyone else's becomes a proposal, as now). `record_export` can be run again; it clears `changed_since_export_at` and its audit row says it is a re-export. The overview shows the response as **Changed since export** until then, and it cannot be archived as won or lost meanwhile. The workspace says what changed and offers **Record export** again. Guide and data model updated.

**Test cases.**
1. Owner, admin and assignee changing an exported question's answer or status each mark the session changed and write an audit row naming them; nothing else about the export is lost.
2. `record_export`'s own learning writes do not mark the session changed.
3. Recording the export again clears the mark, learns the corrected answer (an admin's replaces the first learned entry; a member's becomes a proposal), and writes a second `response.exported` row marked as a re-export.
4. Archiving as won or lost is refused while the session is changed since export; withdrawn still works.
5. A question in a session never exported changes as before, with no audit row.
6. Hostile: a member who may not decide the question still cannot change it (existing rules), and nobody can set or clear `changed_since_export_at` directly.
7. The overview stage and the workspace banner follow the mark.

### S11-2 No question is matched against an incomplete index without saying so (F-43). M

**The job.** A question is matched against every current entry, or the reviewer is told it was not.

**What changes.** `process-questions` first indexes entries that have no vector for the configured model (up to two batches of 64 per call, changed from one while building to cover a typical import, reserved against the caller's indexing cap and the budget, as `embed-entries` does). If any remain unindexed, each question in the batch carries a note ("N knowledge-base entries were not yet indexed and were not searched") and is held from bulk approval (Q2). The app's messages and the guide say so.

**Test cases.** 1. With every entry indexed, nothing changes (no extra calls, no note). 2. With a few unindexed entries, they are indexed before matching and can be matched. 3. When indexing is refused (cap or budget) or fails, questions are still processed, carry the note, and are not bulk-approved. 4. The extra indexing is counted in usage under the caller. 5. Hostile: an entry whose text is an instruction is indexed like any other and gains no influence (existing red-team checks).

**Question for Rory (Q2).** When entries are still unindexed: **Recommended: note it on the question and hold it from bulk approval** (the match may have missed the right entry). Alternative: note only.

### S11-3 Local mode is calibrated (F-55). S

The Ollama default becomes `qwen3-embedding:0.6b`, as decision 0006 chose; `.env.example` and the configuration reference say so. **Test cases.** 1. With `EMBEDDING_PROVIDER=ollama` and no model set, the model is `qwen3-embedding:0.6b`. 2. That model with the default checker has a calibration table (a test fails if a default combination has none). 3. `bge-m3` still works when set explicitly, uncalibrated, as documented.

### S11-4 Edge Function limits and errors say what happened (F-44, F-45, F-46). S

`embed` reserves all or nothing, so a refused request uses none of the day's allowance. `embed-entries` reports the limit that was actually reached (budget or daily cap) and never returns database error text (it is logged instead). A missing Voyage key or unknown provider returns 503 "The embedding service is not configured", not 500. `embed` stays: CI uses it to test the function boundary, and the reference says so. **Test cases.** 1. A request over the remaining cap is refused and the cap is unchanged. 2. Budget reached before the first batch gives the budget message. 3. A database failure gives a general message and no SQL text. 4. Missing key gives 503 with that message, and no key text.

### S11-5 Old usage is deleted on schedule (F-47). S

`purge_old_usage()` (13 months) runs each time usage is recorded, which is cheap (an indexed delete of nothing, most days) and needs no scheduler that the local shim and CI would lack. **Test cases.** 1. A usage row 14 months old is gone after the next recorded call; one 12 months old stays. 2. A purge failure does not lose the new usage row.

### S11-6 Unpriced usage is visible, and the rerankers are priced (F-48). S

Governance shows "N calls with no price" with the models, instead of counting them as free. Prices for `rerank-2.5` and `rerank-3` are added from Voyage's published pricing page with the date checked (Q4). **Test cases.** 1. A usage row for a model with no price shows in the unpriced count. 2. Every model a default or documented setting can choose has a price row, or is listed as unpriced on screen.

### S11-7 Admin changes are all audited, and assignments created as intended (F-49, F-50, F-51). S

Changes to `ai_prices` write `prices.changed` to the audit log. `kb_entries.superseded_by` can no longer be set directly by an admin (only by `review_entry` and `record_export`). Archiving locks `opportunity_contributors`. Owners insert assignments through column grants (question, session, assignee), with status, dates, assigner and question text set by the database. `handle_new_user` gets an empty `search_path`. **Test cases.** One database test per row of the role matrix for each change: price change audited; direct `superseded_by` update refused for an admin; contributor change on an archived response refused; an owner's insert with a status, dates or someone else as assigner refused or overwritten; a new user's profile still created.

### S11-8 Configuration rows in migrations (F-52). S

A decision recorded in `CLAUDE.md`, `docs/BACKLOG.md` rule 2 and decision 0004 (Q3). **Recommended: allow configuration that the app needs on every install (the settings row, model prices, learning thresholds) in migrations, dated and with its source; sample or customer data stays out.** A test checks that migrations insert only into those three tables.

### S11-9 An audit-log screen for admins (F-53). M

A fourth governance tab, **Audit log**: the most recent 200 entries, newest first, filterable by kind (exports, archives, deletions, reviews, settings, admin changes), each with who, when, what and the details in plain words. Read-only; admins only (already the database rule). **Test cases.** 1. A member cannot read the log (existing rule, retested through the screen's query). 2. Each kind of event the database writes has a plain-words line (a test lists the kinds written by migrations and fails on one with no wording). 3. Details are shown as text, never HTML. Q5.

### S11-10 The governance page has every setting, and skips are recorded (F-54). S

`est_usd_per_embed_text` joins the limits form. Skipping or restoring a question records who and when (two columns, set by a trigger), shown on the card ("Skipped by Priya Sharma, 25 Oct") and in the export's provenance. **Test cases.** 1. The setting saves and is audited. 2. Skip records who and when; restore clears them; neither can be forged through the API. 3. The export shows who skipped. Q6.

### S11-11 Small fixes (F-56, BUG-33). S

The development server listens on `127.0.0.1`, matching the README and Supabase's `site_url`. The workspace breadcrumb keeps the response name readable beside Help (truncated with the full name on hover, never one letter). **Test cases.** 1. The layout check passes at 768 px and the breadcrumb shows at least the first word at 1,280 px (screenshot run). 2. `npm run dev` answers on `http://127.0.0.1:5173`.

## Boundaries

- **Project rule 1:** each fix updates the guide or reference that describes the behaviour; the documentation tests run on every change. No invented prices (S11-6).
- **Rule 4, human in the loop:** S11-1 records every change made after an export and asks for the export to be recorded again; S11-2 holds a question matched against an incomplete index.
- **Rule 5, least privilege:** S11-7 narrows grants; every change has role-matrix tests (decision 0003).
- **Rule 2, synthetic data:** S11-8 rewords it without weakening it.

## Review

**Security review** (a separate agent, given the code but not the reasoning): no high findings; three medium and eight low, all fixed before the end-to-end check.

- **M1.** A question matched against an incomplete index that also cited an unreviewed entry got the source gate, which a review later releases, so it could reach bulk approval. The incomplete-index gate is now checked first, since nothing releases it.
- **M2.** The skip trigger undid the foreign key's clean-up when a person's account was deleted, leaving their id behind. Only a signed-in user's change now keeps the earlier value.
- **M3.** Deleting an account failed if the person had contributed to, been assigned on, or skipped a question in an archived response (the archive lock refused the database's own clean-up). The lock now lets exactly that clean-up through.
- **Low.**
  1. The audit row recorded the status before a changed accepted answer was reopened; the trigger now runs after the reopening one.
  2. Re-accepting an unchanged answer after a change learned it again (a copy, or a fresh confirmation); now a re-export learns only answers that changed.
  3. An unknown count of unindexed entries was reported as "1"; it now says it is unknown.
  4. "Nobody can change" the audit log overstated it (the service role can), and an admin's direct deletion of an entry, or change to its tags or source, was not audited; both corrected.
  5. The audit screen showed the database's error text, and a deleted user's entries as "The system"; corrected.
  6. The migration test also stripped `DO` blocks, which run during a migration; it now strips only function bodies.
  7. This page said one batch is indexed before matching; it is two.
  8. The purge's date filter on reservations had no index; added.

**Deviation recorded.** The S11-2 commit message says `embed-entries` uses the shared entry store; that change landed in the next commit (S11-4).

## Questions for Rory (answered 25 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | After an export, how is a mistake corrected? | Recommended: lock it. **Rory: allow changes; they reopen the export, which is recorded again, with both in the audit log** |
| Q2 | Entries still unindexed when a question is matched | Note it on the question and hold it from bulk approval **Rory: agreed** |
| Q3 | Configuration rows in migrations | Allow the settings, prices and thresholds, dated and sourced; sample data stays out **Rory: agreed** |
| Q4 | Rerank prices | Copy them from Voyage's pricing page with the date checked, and show unpriced usage on screen **Rory: agreed** |
| Q5 | The audit-log screen | Include it in this sprint **Rory: agreed** |
| Q6 | Recording who skipped a question | Include it in this sprint **Rory: agreed** |

## The sprint as a whole

Order: quick wins first (S11-3, S11-11, S11-8, S11-5), then the database stories (S11-1, S11-7, S11-10), then S11-2, S11-4, S11-6, S11-9. Sizes: one L, three M and seven S, about four days. No spike. Then the independent security review, Rory's check on his PC, and the close.
