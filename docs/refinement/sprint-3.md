# Sprint 3 refinement: workflow and the learning loop

Refined 23 October 2026, for Rory's sign-off before building. Backlog: `docs/BACKLOG.md`. Builds on decisions 0003 (role matrix), 0006 and 0007, and the product brief's workflow (steps 3, 5, 6 and 7) and overview sections.

## Goal and how we will know

An owner can see every response in flight, take one from upload to a recorded export, and archive it with its outcome; and the knowledge base learns from what was actually sent, with provenance, without learning pricing or piling up near-duplicates.

- Every approval, individual or bulk, is recorded with who, when, the threshold and the models behind the draft.
- Export is recorded only when every question is decided, and that is when learning happens.
- Responses are archived, never deleted, except by an admin, with a reason, logged.
- Learning adds edited answers as new entries, supersedes near-duplicates, and never learns pricing.

## What refinement found

1. **The response "status" is set by hand** (new, in progress, won, lost). The brief wants a stage that follows the work (drafting, in review, ready, exported, archived) and a separate outcome. The manual field is replaced by a computed stage plus `due_date`, `exported_at`, `archived_at` and `outcome`; existing won and lost responses become archived with that outcome.
2. **Export happens in the browser.** The file is built client-side, so the database cannot stop a determined user saving a file. What it can enforce is the *recorded* export: `record_export()` refuses unless every question is decided, and only a recorded export triggers learning and moves the stage on. The screen offers the download only after recording. This is stated honestly in the UI and the docs.
3. **Approvals leave no trace today** beyond the status. Rule 4 says a bulk approval counts because it is a recorded decision, so an `approvals` table is written by a trigger whenever a question becomes accepted, capturing who, whether it was bulk (and the threshold), the confidence, the gate, the final answer and the models and prompt version. `bulk_accept()` marks its own approvals as bulk.
4. **Learning needs the question's similarity to its entry**, which Sprint 2 already stores (`sources_json`, `retrieval_score`, `verdict`), so supersession can be decided in the database without a new embedding call. The threshold is measured on the Sprint 1 evaluation set (paraphrases against their own entry versus other entries), so no spike is needed.
5. **"Learning" an unedited draft adds nothing**: the answer is already the entry's text. Proposed: an accepted draft that was not edited only refreshes the cited entries' `last_reviewed_at` (a confirmation, which Sprint 4's stale-entry report will use); an edited or person-written answer becomes a new entry.
6. **F-7 changes a Sprint 2 rule.** Today any member can accept a single question. With F-7, only the response owner, an admin, or someone the question is assigned to can decide it (Q4).

## Stories

### S3-1 Overview of responses in flight (M)

**The job.** The owner and the team see every response with its owner, due date, stage and progress, and which are overdue or at risk.

**What changes.**
- Migration: `opportunities` gains `due_date date`, `exported_at`, `archived_at`, `outcome` (`won`, `lost`, `withdrawn`); the manual `status` is dropped after migrating won and lost to archived with that outcome. Column grants: owner or admin may set `name`, `due_date`, `owner_id`; `exported_at`, `archived_at` and `outcome` only through the functions in S3-2 and S3-3.
- View `response_overview` (security invoker): per response, owner, due date, questions total, decided (accepted or skipped), accepted, pending, gated pending, open assignments, stage (`new`, `in review`, `ready`, `exported`, `archived`), `overdue` and `at_risk` (rule in Q1).
- Dashboard: a table or cards from the view, sorted by due date, filters by stage, owner and "mine"; archived responses in their own tab.

**Test cases.**
1. Stage follows the work: no session is `new`; questions pending is `in review`; all decided is `ready`; recorded export is `exported`; archived is `archived`.
2. Progress counts match the questions (accepted, skipped, pending, gated pending).
3. Overdue: due date in the past and not exported. At risk: per Q1. Neither for exported or archived responses.
4. A member can read the overview; only owner or admin can change the due date (database test for each role).
5. Migration: existing won and lost responses become archived with that outcome; new and in progress keep their sessions and become `new` or `in review`.

### S3-2 Recorded approvals and the readiness gate (M)

**The job.** Every decision is on record, and a response can be marked exported only when every question has been decided.

**What changes.**
- Migration: table `approvals` (question, session, response, decided_by, `kind` individual or bulk, threshold, confidence, gate, final answer, judge model, draft model, prompt version, calibration set, decided_at). Written only by a `SECURITY DEFINER` trigger on `rfi_questions` when status becomes `accepted`; members can read it; nobody can update or delete it.
- `bulk_accept()` sets a transaction-local marker so the trigger records `kind = bulk` and the threshold.
- Function `record_export(session)`: owner or admin; refuses if any question is pending; sets `exported_at` on the session and response; writes `audit_log`; runs learning (S3-4); returns a summary. Re-export after edits is allowed and recorded again.
- Workspace: "Review complete" becomes "Record export" with a readiness summary (accepted, skipped, pending); downloads appear after recording. Each question card shows "Approved by Sarah Chen, 23 Oct, bulk at 80%".

**Test cases.**
1. Individual accept records one approval with the user and `kind = individual`; bulk records one per question with `kind = bulk` and the threshold.
2. The approval captures the final answer and the models and prompt version at that moment; changing the answer later does not change the record (and reopens the question, Sprint 2).
3. Members cannot insert, update or delete approvals directly; anonymous cannot read them.
4. `record_export` refuses while any question is pending, and for a member who is not owner or admin.
5. A recorded export is in `audit_log` with the counts.

### S3-3 Archive, outcome and admin-only delete (S)

**The job.** Finished responses are kept as a record with their outcome; deletion is only for mistakes, by an admin, with a reason.

**What changes.**
- `archive_response(id, outcome)`: owner or admin; only after a recorded export (or with outcome `withdrawn`, for a response abandoned before export). Archived responses are read-only: a trigger refuses changes to their sessions, questions and assignments.
- `delete_response(id, reason)`: admin only, reason of at least 10 characters, written to `audit_log` with the response name and counts before deletion. Direct `DELETE` on `opportunities` is revoked.
- Dashboard: Archive (with outcome) for owners and admins; Delete only for admins, asking for the reason.

**Test cases.**
1. Owner archives an exported response as won; it moves to the archived tab and its questions can no longer be changed.
2. Archiving before export is refused unless the outcome is `withdrawn`.
3. A member cannot archive; only an admin can delete, and only with a reason; the deletion is in `audit_log`.
4. Direct `DELETE FROM opportunities` is refused for everyone but the database owner.

### S3-4 Learning at export (M, plus S3-4b)

**The job.** What was actually sent improves the knowledge base, with provenance, without learning pricing or duplicating entries.

**What changes** (inside `record_export`, rules per Q3):
- For each accepted question in the session:
  - pricing (and, per Q3, legal and Japanese): not learned; counted in the summary;
  - unedited draft (`final_answer` equals `generated_answer`): no new entry; the cited entries get `last_reviewed_at = now()`;
  - edited or person-written answer: a new entry, `origin = response`, `origin_ref` set by the system to the response, session and question (F-6), `created_by` the person who approved it, tags from the cited entries; if its top match was a near-duplicate (similarity at or above the threshold from S3-4b, and the judge said yes or partly), the old entry is superseded (kept, linked, no longer used for matching).
- After export the app asks `embed-entries` to embed the new entries (as for imports).
- Workspace export panel: the manual "Add to KB" button is removed; the summary says what was learned, confirmed, superseded and not learned (and why).

**S3-4b Near-duplicate threshold (S).** `npm run eval:duplicates` on Rory's PC: from the cached Sprint 1 vectors, the similarity of each paraphrase to its own entry versus its best other entry; choose the threshold that keeps wrong supersessions at or below 2% (proposed) and report what share of real duplicates it catches. Written to `docs/evals/` and the threshold into the migration.

**Test cases.**
1. An edited answer becomes a new entry with origin, origin_ref, created_by and tags; the near-duplicate it refines is superseded and no longer returned by `match_kb_entries`.
2. A non-duplicate edited answer is added without superseding anything.
3. An unedited accepted draft adds nothing and refreshes `last_reviewed_at` on its cited entries.
4. Pricing answers are never learned, whoever approved them; the summary says so. Legal and Japanese per Q3.
5. Recording the same export twice does not learn twice.
6. `origin_ref` cannot be set by a member on manual entries to impersonate a response (F-6: the column grant is removed from members; manual entries get `origin_ref = null`).
7. Superseded entries remain readable with their history.

### S3-5 Who may decide a question (F-7) (S)

Only the response owner, an admin, or a person the question is assigned to may change a question's status or final answer. Policy on `rfi_questions` update; assignees see their questions as today.

**Test cases.** 1. Owner, admin and assignee can accept, edit and skip. 2. Another member cannot (refused, and the screen hides the buttons with a reason). 3. Bulk rules from Sprint 2 unchanged.

### S3-6 Expert suggestions from answer history (M)

**The job.** "Assign for review" suggests the people most likely to know, from what they have answered before as well as their stated expertise.

**What changes.** A database function `suggest_experts(question)` scores each user: stated expertise tags matching the cited entries' tags; entries they wrote that the question cites; approvals they made on questions citing the same entries. Returns the top five with a plain reason ("wrote KB-0012; approved 3 similar answers; tags: encryption"). The card shows the reasons.

**Test cases.** 1. A user who wrote the cited entry ranks above one with only a matching tag. 2. A user with no history but matching tags still appears. 3. Ties broken by name, stable. 4. No suggestions gives the existing "no matching expertise" message. 5. Only signed-in members can call it.

### F-17 No "100%" (S)

Confidence of 99% or more is shown as "99%+"; the tooltip explains that the evaluation set is small. Test: 1.0 and 0.995 show "99%+"; 0.98 shows "98%".

### F-23 New upload from the review screen (S)

A "New upload" button on the review screen returns to the upload step for the same response. Test: the button opens the upload step; the previous session stays listed.

## The sprint as a whole

**Order.** S3-4b first (a measurement on Rory's PC, independent); F-17 and F-23 (quick wins); S3-1 migration and overview; S3-2 (approvals, readiness, `record_export`); S3-5 (same policies); S3-4 (learning inside `record_export`); S3-3; S3-6 (uses approvals and provenance).

**Size.** Four medium (S3-1, S3-2, S3-4, S3-6) and five small: a little larger than Sprint 2. If it runs long, S3-6 returns to the backlog first.

**Spike check.** No spike. The near-duplicate threshold is a measurement with a fixed method (S3-4b), and S3-4 takes whatever value it gives.

**Boundaries.** Rule 4 (recorded decisions), rule 5 (least privilege: new functions are owner- or admin-only, members lose the right to set `origin_ref`), rule 7 (provenance on every learned entry; pricing never learned), synthetic data only. The honest limit of a browser-side export is stated in the UI.

**Out of scope.** Word ingestion (Sprint 4); reviewing member-added entries and the stale-entry report (Sprint 4, which will use `last_reviewed_at`); notifications or email; a Japanese knowledge base (C-1).

## Questions for Rory

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | When is a response "at risk"? | (a) Due within 3 working days and less than 80% of questions decided, or any gated question undecided within 1 day of the due date. (b) Owner sets it by hand | (a) |
| Q2 | Can a response be exported with skipped questions? | (a) Yes: skipped counts as decided and is exported as "Not answered"; only pending blocks export. (b) Every question must be accepted | (a): some RFI questions do not apply |
| Q3 | What is learned at export? | (a) Edited and person-written answers, except pricing, legal and Japanese; unedited drafts only confirm their entries. (b) As (a) but legal answers are learned too. (c) Everything except pricing | (a): legal answers are often contract-specific, and Japanese waits for C-1 |
| Q4 | Who may decide a question (F-7)? | (a) Owner, admin, and anyone it is assigned to. (b) Any member, as now | (a) |

## Answers (23 October 2026)

| # | Answer |
|---|---|
| Q1 | Rule-based: due within 3 working days with under 80% decided, or a pricing or legal question undecided within 1 day of the due date |
| Q2 | Skipped questions count as decided and are exported as "Not answered"; only pending questions block export |
| Q3 | Learn edited and person-written answers **including legal ones**, but never pricing and not Japanese (until C-1); unedited drafts only confirm their entries |
| Q4 | Only the response owner, an admin, or an assignee may decide a question |

S3-4 test case 4 now reads: pricing and Japanese answers are never learned; legal answers are learned like any other, with provenance. All nine items are Ready, Sprint 3.
