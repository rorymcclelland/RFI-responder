# Data model and access

What RFI Respond keeps in its database, and who may read or change it. This page describes the state after every migration in [`supabase/migrations/`](../../supabase/migrations/) has run, up to and including [`20261029100000_onboarding.sql`](../../supabase/migrations/20261029100000_onboarding.sql). The reasons behind the rules are in [decision 0003](../decisions/0003-access-control.md) and the [architecture page](../ARCHITECTURE.md).

## Where the rules live

- **Every access rule is in the migrations**, applied in file-name order: row-level security (RLS) policies, table and column grants, triggers and functions.
- **The browser holds only the public anon key and the signed-in person's session.** It reaches the database through the Supabase API (PostgREST) as the `authenticated` role, with the person's id available to SQL as `auth.uid()`. Anything the API can do with that key is limited by the rules below, so they hold even when someone calls the API directly.
- **The Edge Functions use the service role** (`service_role`) for writes a person must not make (scores, gates, drafts, usage). Its key never leaves the server ([decision 0005](../decisions/0005-where-the-ai-runs.md)).
- **The rules are tested** in [`supabase/tests/db/`](../../supabase/tests/db/), which run each statement as a real user would (`SET ROLE authenticated` with JWT claims) against Postgres and the shim in [`supabase/tests/shim/supabase-shim.sql`](../../supabase/tests/shim/supabase-shim.sql). See [`harness.ts`](../../supabase/tests/db/harness.ts).
- **Assumed:** members reach the database only through the API. A direct database connection as `authenticated` can set its own JWT claims and so its own `auth.uid()`; direct connections are for administrators only (decision 0003).

## Roles

| Role | Who | How the database knows |
|---|---|---|
| Anonymous (`anon`) | Anyone with the anon key and no session | The `anon` database role. It holds no privilege on any table, view or function in `public`, and no access to `private`. |
| Member | Any signed-in person (accounts are invite-only) | The `authenticated` role with `auth.uid()` set |
| Admin | A member whose profile has `is_admin = true` | `access.is_admin()`, which reads the caller's `user_profiles` row. Granted and removed only through `set_user_admin` |
| Response owner | The member in `opportunities.owner_id` for that response (defaults to its creator) | `is_response_owner(response id)` |
| Assignee | The member in `question_assignments.assigned_to` | Checked in the assignment policies and in `can_decide_question` |
| Service role | The Edge Functions, server side | The `service_role` database role. It bypasses RLS and holds every privilege on the `public` tables, but **triggers still run** for it. Functions that check `is_admin()` or `auth.uid()` refuse it, since it has no user id. |

Owner, assignee and admin are not exclusive: an admin who owns a response passes both checks.

**How to read the access lines below.** "Read" is SELECT, "Insert", "Update" and "Delete" are the matching commands. A column list means the role holds a grant on those columns only. "None" means the role has no privilege or no policy allows it (the API returns an error or changes no rows). Anonymous visitors have no access to any table, so they are not repeated per table. The service role can do everything on every `public` table except what a trigger refuses, so per table only its usual writes and the triggers that bind it are noted. Where a trigger is "not applied" to a role, the same exemption covers the database owner (`postgres`), and so also the `SECURITY DEFINER` functions it owns, such as `record_export`.

## Tables

Sixteen tables: fifteen in `public` and one in `private`.

### `public.user_profiles`

One row per account: the person's name and details, and whether they are an admin.

Created in [`20260430160006_user_profiles_and_assignments.sql`](../../supabase/migrations/20260430160006_user_profiles_and_assignments.sql); access rules last changed in [`20261022120000_access_control.sql`](../../supabase/migrations/20261022120000_access_control.sql); `onboarded_at` added in [`20261029100000_onboarding.sql`](../../supabase/migrations/20261029100000_onboarding.sql), and reading made column by column in [`20261029110000_onboarding_private.sql`](../../supabase/migrations/20261029110000_onboarding_private.sql).

| Column | Meaning |
|---|---|
| `id` | The account's id in `auth.users` (deleting the account deletes the profile, their contributor and assignment rows, and the record of what they skipped, also on archived responses) |
| `display_name`, `job_title`, `department` | Shown in the app |
| `expertise_tags` | Used by `suggest_experts` to suggest people for a question |
| `is_admin` | Admin rights. Changed only by `set_user_admin` |
| `onboarded_at` | When the person finished or skipped the introduction. Set only by `mark_onboarded`, for the caller's own row, once; read only by its owner, through `my_onboarded_at` |

- **Member:** read every profile's other columns (reading is granted column by column, so `SELECT *` is refused); update own row, columns `display_name`, `job_title`, `department`, `expertise_tags`, `updated_at`; no insert or delete.
- **Admin:** as a member, and update the same columns on any profile. `is_admin` and `onboarded_at` cannot be written directly by anyone through the API.
- **Rows are created** by the `on_auth_user_created` trigger on `auth.users` (`handle_new_user`), which copies the display name from the sign-up metadata or the email's local part.

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts) (profiles), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint10.test.ts`](../../supabase/tests/db/sprint10.test.ts) (`onboarded_at`), [`seed.test.ts`](../../supabase/tests/db/seed.test.ts).

### `public.opportunities`

One row per response (an RFI being answered). The UI calls these responses.

Created in [`20260430154332_add_opportunities_table.sql`](../../supabase/migrations/20260430154332_add_opportunities_table.sql); access rules last changed in [`20261023150000_sprint3_review_fixes.sql`](../../supabase/migrations/20261023150000_sprint3_review_fixes.sql).

| Column | Meaning |
|---|---|
| `name`, `due_date` | Set by the creator; editable by the owner or an admin |
| `created_by`, `owner_id` | Both default to the caller and must equal the caller on insert. `owner_id` can be handed to another person later, never set empty |
| `exported_at` | Set by `record_export` |
| `archived_at`, `outcome` | Set by `archive_response`. `outcome` is `won`, `lost` or `withdrawn` |

- **Member:** read every response; insert columns `name`, `due_date` only (so they become creator and owner); no update unless owner; no delete.
- **Owner:** update own responses, columns `name`, `due_date`, `owner_id`, `updated_at`.
- **Admin:** update any response, same columns. No direct delete for anyone through the API: `delete_response` is the only route.
- **Triggers:** `opportunities_archived` refuses any update to an archived response for every role, the service role included, except the database owner (`postgres` or `supabase_admin`). `opportunities_updated_at` stamps `updated_at`.

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts) (opportunities), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-3 archive), [`processing.test.ts`](../../supabase/tests/db/processing.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`sprint11.test.ts`](../../supabase/tests/db/sprint11.test.ts).

### `public.opportunity_contributors`

People listed as contributors on a response. No policy on another table refers to it, so being a contributor grants no extra rights.

Created in [`20260430162241_add_user_profile_fields_and_contributors.sql`](../../supabase/migrations/20260430162241_add_user_profile_fields_and_contributors.sql); access rules last changed in [`20261022120000_access_control.sql`](../../supabase/migrations/20261022120000_access_control.sql).

Columns: `opportunity_id`, `user_id` (unique together), `added_at`.

- **Member:** read all; no insert, update or delete.
- **Owner and admin:** insert and delete contributors on the response. No role can update a row through the API (there is no update policy).
- **Trigger:** `opportunity_contributors_archived` (`refuse_if_archived`): nothing changes once the response is archived (Sprint 11).

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) (role-matrix rows).

### `public.rfi_sessions`

One uploaded file (spreadsheet or Word document) within a response.

Created in [`20260430145610_create_rfi_workflow_tables.sql`](../../supabase/migrations/20260430145610_create_rfi_workflow_tables.sql); access rules last changed in [`20261103100000_policies_check_user_once.sql`](../../supabase/migrations/20261103100000_policies_check_user_once.sql), which dropped the prototype's update policy (no member has had an update grant since Sprint 3).

| Column | Meaning |
|---|---|
| `opportunity_id` | The response it belongs to |
| `file_name`, `question_count` | As supplied on insert |
| `accepted_count` | Recomputed by the `rfi_questions_accepted_count` trigger after any update to its questions |
| `status` | `in_progress`, or `completed` once `record_export` runs; back to `in_progress` when an answer changes after the export |
| `exported_at` | Set by `record_export` |
| `changed_since_export_at` | Set when a person changes a question's answer or decision after the export is recorded; cleared when `record_export` runs again (Sprint 11) |

- **Member:** read all; no insert unless owner; no update; no delete.
- **Owner:** insert a session on own response, columns `file_name`, `question_count`, `opportunity_id`.
- **Admin:** insert on any response (or with no response). No role updates or deletes sessions through the API: `record_export`, the accepted-count trigger and `delete_response` change them.
- **Trigger:** `rfi_sessions_archived` refuses insert, update and delete when the response is archived, except inside `delete_response`.

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) (finding 5), [`processing.test.ts`](../../supabase/tests/db/processing.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`sprint11.test.ts`](../../supabase/tests/db/sprint11.test.ts).

### `public.rfi_questions`

One question from an uploaded file, with its draft, scores, gate, decision and what was learned from it.

Created in [`20260430145610_create_rfi_workflow_tables.sql`](../../supabase/migrations/20260430145610_create_rfi_workflow_tables.sql); access rules last changed in [`20261027110000_sprint7_review_fixes.sql`](../../supabase/migrations/20261027110000_sprint7_review_fixes.sql).

| Columns | Written by | Meaning |
|---|---|---|
| `session_id`, `position`, `question` | Owner or admin, on insert | The question text is limited to 5,000 characters (a `NOT VALID` check, so it binds new and changed rows) |
| `customer_ref` | Owner or admin, on insert only | The customer's own numbering: at most 20 characters of letters, digits, spaces, `.`, `(`, `)` and `-` (`NOT VALID` check, as above) |
| `status` | Owner, admin or assignee | `pending`, `accepted` or `skipped` |
| `final_answer` | Owner, admin or assignee | The answer that will be exported |
| `generated_answer`, `draft_kind` | Service role | The draft, and how it was made: `generated`, `assembled`, `insufficient_evidence` (no draft, a placeholder) or `person_required` (pricing, a placeholder) |
| `confidence`, `retrieval_score`, `answerability`, `calibration_set` | Service role | Calibrated confidence (0 to 1) and the raw scores behind it |
| `verdict`, `judge_reason`, `judge_best_ref` | Service role | The checker's verdict (`yes`, `partly`, `no`), its reason (at most 300 characters) and the entry it judged best |
| `gate`, `gate_reason` | Service role; source gates also by `bulk_accept` and the entry-review trigger | Why the question is never bulk-approved: `pricing`, `legal`, `translation` (the draft crosses languages, either way), `japanese` (Japanese from Japanese entries, Sprint 12), `unchecked`, `unreviewed_source`, `stale_source`, `unindexed_entries` (Sprint 11) |
| `language` | Service role | `en` or `ja` |
| `sources_json`, `cited_refs` | Service role | The matched entries with scores, and the entry refs the draft cites |
| `embedding_model`, `judge_model`, `draft_model`, `prompt_version` | Service role | Provenance of the draft |
| `processing_note`, `processed_at` | Service role | A note for the reviewer, and when the server processed the question (bulk approval requires it) |
| `skipped_by`, `skipped_at` | The `record_skip` trigger, from the status change | Who skipped the question and when; cleared on restore (Sprint 11) |
| `learned_at`, `learn_outcome`, `learned_entry_id` | `record_export` | What the knowledge base learned: `added`, `superseded`, `proposed`, `confirmed`, `translated` (Sprint 12: learned as a translation, waiting for review), `not_confirmed_source`, `not_learned_pricing`, `not_learned_empty`, `not_learned_unchecked`; `not_learned_japanese` only on exports recorded before Sprint 12 |

- **Member:** read all; no insert, update or delete unless owner, admin or assignee.
- **Owner:** insert questions into sessions of own response (columns `session_id`, `position`, `question`, `customer_ref`); update `status` and `final_answer` on own response's questions.
- **Assignee:** update `status` and `final_answer` of a question they are assigned, where the assignment's session and response match the question's (`can_decide_question`). The assignment's status is not checked.
- **Admin:** insert into any session; update `status` and `final_answer` of any question.
- **Nobody** deletes questions through the API; they go when their session is deleted (`delete_response`).
- **Service role:** writes every processing column (`process-questions`).

Triggers that enforce behaviour:

- `rfi_questions_archived` (`refuse_if_archived`): no insert, update or delete once the response is archived, except inside `delete_response`. Binds the service role too.
- `refuse_unwritten_placeholder` (`private.refuse_unwritten_placeholder`): a question whose `draft_kind` is `insufficient_evidence` or `person_required` cannot be accepted until `final_answer` is non-blank and differs from the placeholder in `generated_answer`. Binds every role.
- `rfi_questions_reopen_changed_answer` (`reopen_changed_answer`): changing `final_answer` on an accepted question sets it back to `pending`, so the new text needs its own approval. Not applied to the service role.
- `rfi_questions_record_approval` (`record_approval`): each move to `accepted` writes a row to `approvals`, marked `bulk` with its threshold when inside `bulk_accept`, otherwise `individual`.
- `rfi_questions_bulk_acceptance` (`check_bulk_acceptance`, per statement): when one statement changes the status or answer of more than one question, it must touch one session only and come from the owner or an admin; accepting more than one question is allowed only inside `bulk_accept`, and never includes a question that is gated, unprocessed, uncalibrated or without a `generated` or `assembled` draft. Not applied to the service role.
- `rfi_questions_accepted_count` (`refresh_accepted_count`): recomputes `rfi_sessions.accepted_count`.

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`processing.test.ts`](../../supabase/tests/db/processing.test.ts) (server-only columns, bulk rules, reopening, accepted count), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-5 who may decide), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) (`customer_ref`), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) (`judge_reason`, gate release), [`sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts) (placeholders), [`sprint9.test.ts`](../../supabase/tests/db/sprint9.test.ts), [`demo-seed.test.ts`](../../supabase/tests/db/demo-seed.test.ts).

### `public.question_assignments`

A question handed to a specialist, with their answer and notes.

Created in [`20260430160006_user_profiles_and_assignments.sql`](../../supabase/migrations/20260430160006_user_profiles_and_assignments.sql); access rules last changed in [`20261025130000_sprint5_review_fixes.sql`](../../supabase/migrations/20261025130000_sprint5_review_fixes.sql).

| Column | Meaning |
|---|---|
| `question_id` | The question's id, stored as text; must be the id of a question in `session_id` |
| `session_id`, `opportunity_id` | Must match each other and the question; `opportunity_id` may be null only for a session with no response |
| `assigned_to`, `assigned_by` | The assignee, and the person who assigned it (must be the caller on insert) |
| `question_text` | A copy of the question at the time |
| `status` | `pending`, `in_review`, `answered`, `approved` or `closed` |
| `answer_text`, `notes`, `completed_at` | The assignee's work |

- **Member:** read only assignments where they are the assignee or the assigner; no insert, update or delete otherwise.
- **Assignee:** read; update `status`, `answer_text`, `notes`, `completed_at`, `updated_at`.
- **Owner:** read all on own response; insert (as `assigned_by`), update the same columns, delete.
- **Admin:** as the owner, on any response.

Triggers that enforce behaviour:

- `question_assignments_session_matches` (`check_assignment_session`): the session must belong to `opportunity_id`.
- `question_assignments_question_matches` (`check_assignment_question`): a session is required and `question_id` must be a question in it.
- `question_assignments_guard_closed` (`guard_closed_assignments`): only `record_export` closes assignments; a closed assignment cannot be changed or deleted. Not applied to the service role.
- `question_assignments_archived` (`refuse_if_archived`): nothing changes once the response is archived, except inside `delete_response`.
- `question_assignments_normalise` (`normalise_new_assignment`, Sprint 11): a signed-in user's new assignment starts `pending`, with no notes or completion date, dated now, and with the question's own text, whatever was sent.

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts) (question assignments), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) (findings 1 and 2), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (Sprint 3 security review findings), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) (F-26, closed assignments), [`processing.test.ts`](../../supabase/tests/db/processing.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts).

### `public.approvals`

The record of every acceptance: who, when, how (individual or bulk) and on what evidence.

Created and access rules set in [`20261023130000_workflow_and_learning.sql`](../../supabase/migrations/20261023130000_workflow_and_learning.sql).

Columns: `question_id`, `session_id`, `opportunity_id`, `decided_by`, `kind` (`individual` or `bulk`), `threshold` (bulk only), and a snapshot of `confidence`, `gate`, `final_answer` (or the draft if no final answer), `judge_model`, `draft_model`, `prompt_version`, `calibration_set`, with `decided_at`.

- **Member:** read all; no insert, update or delete.
- **Admin:** the same as a member.
- **Service role:** read and insert; since Sprint 14 it cannot update, delete or truncate approvals ([`20261102100000`](../../supabase/migrations/20261102100000_audit_log_append_only.sql)).
- **Written only** by the `rfi_questions_record_approval` trigger. `record_export` reads the latest `decided_by` to decide whose approval a learned answer carries.

Tests: [`processing.test.ts`](../../supabase/tests/db/processing.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-2), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`demo-seed.test.ts`](../../supabase/tests/db/demo-seed.test.ts).

### `public.kb_entries`

The knowledge base: question and answer pairs that drafts are made from, with provenance, review state and embeddings.

Created in [`20261022130000_knowledge_base.sql`](../../supabase/migrations/20261022130000_knowledge_base.sql); access rules last changed in [`20261026120000_sprint6_review_fixes.sql`](../../supabase/migrations/20261026120000_sprint6_review_fixes.sql).

| Column | Meaning |
|---|---|
| `ref` | Generated from `seq` (`KB-` and a number): how drafts cite an entry |
| `question`, `answer`, `tags`, `source` | The content. Question at most 5,000 characters, answer at most 20,000, source at most 500 |
| `question_key` | Generated: the question lower-cased with spaces collapsed. Unique, with `language`, among current entries that are not proposals: the same question may have one current entry in English and one in Japanese (Sprint 12, [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql)) |
| `origin` | `seed`, `manual`, `import` or `response` (learned at export) |
| `origin_ref` | Provenance: the import's file name (`import_kb_entries`) or the response, session and question it was learned from (`record_export`). No signed-in user can write it directly |
| `created_by` | The person who added it, or whose approval it was learned from |
| `reviewed_at`, `reviewed_by` | Set by an admin's review. On insert, a trigger sets them only when `created_by` is an admin; a member's entry, and any entry with `translated_from`, starts unreviewed |
| `last_reviewed_at` | Last confirmed: by `review_entry`, or by an export that used the entry unedited (see `record_export`) |
| `language` | `en` or `ja`, generated by the database from the text (Japanese if at least a fifth of the question, or of the answer, is kana or kanji, counting characters other than spaces after NFKC folding; the same rule as `text_language` and the Edge Functions' `textLanguage`); nobody can set it (Sprint 12, [`20261031100000`](../../supabase/migrations/20261031100000_entry_language.sql)) |
| `translated_from` | The refs of the entries a learned answer was translated from, set by `record_export` when the accepted draft crossed languages. Such an entry starts unreviewed, whoever approved the answer (Sprint 12, [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql)) |
| `superseded_by` | The newer entry that replaced this one. A replaced entry is never matched again and counts as out of date in citations |
| `proposed_replacement_of` | A learned answer from a non-admin approval, waiting beside the entry it would replace until an admin reviews it |
| `embedding`, `embedding_model`, `embedded_at` | Written by the `embed-entries` Edge Function (service role); cleared by `review_entry` when it edits the text |
| `search_text` | Generated full-text index of question and answer |

Review due date: `entry_review_due` gives `last_reviewed_at` (or `reviewed_at`, or `created_at`) plus `ai_settings.review_interval_months`.

- **Member:** read all; insert columns `question`, `answer`, `tags`, `source`, `origin` with `origin` `import` or `manual` and `created_by` the caller (the default); no update or delete. `import_kb_entries` is the bulk route.
- **Admin:** as a member; update columns `source`, `tags`, `updated_at`; delete entries. Question, answer, review dates and `superseded_by` change only through `review_entry` and `record_export` (Sprint 11).
- **Service role:** writes embeddings.

Triggers that enforce behaviour:

- `kb_entries_review_on_insert` (`set_entry_review_on_insert`): for a signed-in caller, clears any supplied review and marks the entry reviewed only if `created_by` is an admin and the entry has no `translated_from`. With no user id (the service role, or a direct connection), the supplied review is kept, and a `seed` entry without one counts as reviewed when created.
- `kb_entries_release_held_questions` (`private.on_entry_reviewed`): when an entry is reviewed or confirmed, re-checks the source gate of pending questions citing it in open responses (`private.release_source_gates`), releasing or updating it and logging `question.released` or `question.held`. Accepted and skipped questions, exported sessions and archived responses are left alone.
- `kb_entries_set_updated_at` (`set_updated_at`): stamps `updated_at`.

Tests: [`knowledge-base.test.ts`](../../supabase/tests/db/knowledge-base.test.ts) (access, role matrix), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-3 member-added entries, S4-4 review dates), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) (release, direct-write refusals), [`sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts) (replaced entries), [`vectors.test.ts`](../../supabase/tests/db/vectors.test.ts), [`hybrid.test.ts`](../../supabase/tests/db/hybrid.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`seed.test.ts`](../../supabase/tests/db/seed.test.ts).

### `public.learning_thresholds`

For each embedding model, the similarity at or above which a learned answer may replace a near-duplicate entry, and the evaluation set it came from.

Created and access rules set in [`20261023130000_workflow_and_learning.sql`](../../supabase/migrations/20261023130000_workflow_and_learning.sql); values last changed in [`20261026130000_learning_thresholds_sprint6.sql`](../../supabase/migrations/20261026130000_learning_thresholds_sprint6.sql).

Columns: `embedding_model`, `threshold` (0 to 1), `evaluation_set`.

- **Member and admin:** read; no insert, update or delete. Rows are written by migrations. Read by `record_export`.

Tests: [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) (S6-2).

### `public.audit_log`

Privileged and consequential changes.

Created and access rules set in [`20261022120000_access_control.sql`](../../supabase/migrations/20261022120000_access_control.sql).

Columns: `at`, `actor`, `action`, `target_id`, `details`, and since Sprint 14 `actor_ref`: the same id as `actor`, with no link to the profile, so it survives the profile's deletion (when `actor` becomes NULL) and shows that one person did those things without naming them. `at` is always the time of insertion. The actions written today: `user.admin_granted`, `user.admin_removed`, `response.archived`, `response.deleted`, `response.exported`, `kb.reviewed`, `kb.confirmed`, `question.held`, `question.released`, `settings.changed`, and since Sprint 11 `question.changed_after_export`, `prices.changed`, `kb.changed` and `kb.deleted`. Admins read it on the governance page's **Audit log** tab ([`src/lib/auditLog.ts`](../../src/lib/auditLog.ts), whose test fails if an action has no wording).

- **Member:** no access.
- **Admin:** read; no insert, update or delete.
- **Service role** (the Edge Functions): read and insert only; since Sprint 14 it cannot update, delete or truncate the log, nor the approvals ([`20261102100000`](../../supabase/migrations/20261102100000_audit_log_append_only.sql), F-57).
- **Written only** by `SECURITY DEFINER` functions and triggers (`set_user_admin`, `archive_response`, `delete_response`, `record_export`, `review_entry`, `bulk_accept`, `private.release_source_gates`, `stamp_settings_change`, `note_change_after_export`, `audit_price_change`).

Tests: [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`sprint14.test.ts`](../../supabase/tests/db/sprint14.test.ts).

### `public.ai_settings`

One row of organisation settings for AI use and review.

Created in [`20261024110000_usage_and_caps.sql`](../../supabase/migrations/20261024110000_usage_and_caps.sql); access rules last changed in [`20261025130000_sprint5_review_fixes.sql`](../../supabase/migrations/20261025130000_sprint5_review_fixes.sql).

Columns: `id` (always `true`, so there is one row); daily caps per person `daily_question_cap`, `daily_embed_cap`, `daily_extract_cap`; `monthly_budget_gbp`, `alert_share` (share of the budget that raises the alert), `gbp_per_usd`; the estimates used to reserve spend before a call, `est_usd_per_question`, `est_usd_per_embed_text`, `est_usd_per_extract_kchar`; `review_interval_months` (1 to 60); `updated_at`, `updated_by`.

- **Member:** read; no insert, update or delete.
- **Admin:** update every column above except `id`, `updated_at` and `updated_by`; no insert or delete.
- **Trigger:** `ai_settings_stamp` (`stamp_settings_change`) stamps `updated_at` and `updated_by` and writes `settings.changed` to the audit log with the values before and after.

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-1), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts). No test checks the `settings.changed` audit row.

### `public.ai_prices`

Provider prices used to cost each call.

Created and access rules set in [`20261024110000_usage_and_caps.sql`](../../supabase/migrations/20261024110000_usage_and_caps.sql).

Columns: `provider`, `model` (together the key), `input_usd_per_mtok`, `output_usd_per_mtok`, `checked_on`, `source_url`.

- **Member:** read; no insert, update or delete.
- **Admin:** read, insert, update and delete. Every change is written to the audit log as `prices.changed`, with the row before and after (`audit_price_change`, Sprint 11).

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-1).

### `public.ai_usage`

One row per call to an AI provider.

Created and access rules set in [`20261024110000_usage_and_caps.sql`](../../supabase/migrations/20261024110000_usage_and_caps.sql).

Columns: `user_id`, `session_id`, `function` (the Edge Function), `kind` (`judge`, `gate`, `draft`, `embed`, `rerank`, `extract`), `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `at`.

- **Member:** read own rows only; no insert, update or delete.
- **Admin:** read every row; no insert, update or delete.
- **Service role:** inserts (the Edge Functions record usage).
- **Trigger:** `ai_usage_price` (`price_usage`) sets `cost_usd` from `ai_prices`, ignoring any cost the caller supplied unless the insert comes from a direct superuser connection. Calls to `ollama` cost 0; a model with no price is left unpriced (`NULL`).
- Retention: `purge_old_usage` removes rows older than 13 months.

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-1), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts), [`demo-seed.test.ts`](../../supabase/tests/db/demo-seed.test.ts).

### `public.ai_quota`

Each person's use per day, counted against the daily caps.

Created and access rules set in [`20261024110000_usage_and_caps.sql`](../../supabase/migrations/20261024110000_usage_and_caps.sql).

Columns: `user_id`, `day` (together the key), `questions`, `embed_texts`, `extract_docs`.

- **Member and admin:** no access. A person sees their own counts through `usage_status`.
- **Service role:** written by `reserve_quota`. `purge_old_usage` removes rows older than seven days.

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts).

### `public.ai_reservations`

Estimated spend held against the monthly budget while a call is in flight.

Created and access rules set in [`20261024140000_sprint4_review_fixes.sql`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql).

Columns: `user_id`, `kind` (`questions`, `embed`, `extract`), `units`, `est_usd`, `created_at`.

- **Member and admin:** no access.
- **Service role:** inserted by `reserve_quota`, deleted by `settle_reservation` once the real usage is recorded. Counted in `month_committed_usd`. `purge_old_usage` removes rows from before the start of the previous month.

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts).

### `private.operations`

Markers that last one transaction: `bulk` (inside `bulk_accept`, with its threshold) and `deleting_response` (inside `delete_response`, with the response id). They tell the triggers which operation is running, and cannot be forged because no API role can reach the `private` schema.

Created and access rules set in [`20261024100000_unforgeable_markers.sql`](../../supabase/migrations/20261024100000_unforgeable_markers.sql).

Columns: `txid` (the transaction), `kind`, `value`.

- **Every API role (anonymous, member, admin, service role):** no access; the schema grants no usage. Written by `bulk_accept` and `delete_response`, which remove the row before returning; read through `current_operation`.

Tests: [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-2).

### `private.demo_reload`

The hosted demo's reload script, stored by `supabase/demo-hosted.sql` when the demo is loaded, so an admin can reset the demo from the governance page (Sprint 15, S15-4). One row at most; empty on an installation where no demo was loaded. Migrations hold no data, so the script is never in one.

Created in [`20261103120000_reset_demo.sql`](../../supabase/migrations/20261103120000_reset_demo.sql). Columns: `id` (always true), `script`, `stored_at`, `last_reset_at`.

- **Every API role (anonymous, member, admin, service role):** no access; no grant and no policy. Read only by `reset_demo` and `demo_status`, written by `reset_demo` (the reset date) and by the demo files in the SQL Editor.

Tests: [`sprint15.test.ts`](../../supabase/tests/db/sprint15.test.ts) (S15-4).

## Views

### `public.response_overview`

One row per response with its progress, used by the overview screen.

Created and access rules set in [`20261023130000_workflow_and_learning.sql`](../../supabase/migrations/20261023130000_workflow_and_learning.sql).

Columns: the response's `id`, `name`, `owner_id`, `owner_name`, `due_date`, `created_at`, `updated_at`, `exported_at`, `archived_at`, `outcome`; question counts `total`, `accepted`, `skipped`, `pending`, `decided`, and `gated_pending` (pending questions gated for pricing or legal); `open_assignments` (assignments `pending` or `in_review`); `working_days_left` (weekdays from tomorrow to the due date, empty when there is no due date or it has passed); `stage` (`archived`, `changed` when a session's answers changed after its export was recorded, `exported`, `new` with no questions, `ready` with none pending, otherwise `in_review`); `overdue`; `at_risk` (not exported or archived, and either three working days or fewer left with under 80% decided, or due within a day with gated questions pending).

- The view runs with the caller's rights (`security_invoker`), so the table rules above apply to it. Because members see only their own assignments, `open_assignments` counts only the assignments the caller can read.
- **Member:** read. The view cannot be written (it is not updatable).
- **Anonymous:** no access.

Tests: [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-1 the overview), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts), [`demo-seed.test.ts`](../../supabase/tests/db/demo-seed.test.ts).

## Functions

Every function below sets `search_path` to empty and names its tables in full, except `handle_new_user`, which sets it to `public`. Anonymous visitors can execute none of them except `keepalive()`, which returns 1 (Sprint 14): the default grant to `PUBLIC` is revoked ([`20261022140000_access_control_hardening.sql`](../../supabase/migrations/20261022140000_access_control_hardening.sql)). "Definer" means `SECURITY DEFINER`: the function runs with its owner's rights, so it must check the caller itself; "invoker" means it runs under the caller's rights and the table rules.

### Callable by anyone

| Function | What it does | Who may call | What it checks | Defined in | Tests |
|---|---|---|---|---|---|
| `keepalive()` | Returns 1. A scheduled GitHub workflow calls it four times a day, meant to keep a hosted Free project from being paused for inactivity (Sprint 14) | Anyone, signed in or not | Nothing: it takes no arguments and reads no table | [`20261102110000`](../../supabase/migrations/20261102110000_keepalive.sql) | [`sprint14.test.ts`](../../supabase/tests/db/sprint14.test.ts) |

### Callable by signed-in users

The service role may also execute each of these, but those that check `is_admin()` or `auth.uid()` refuse it.

| Function | What it does | Who may call | What it checks | Defined in | Tests |
|---|---|---|---|---|---|
| `archive_response(p_response, p_outcome)` | Archives a response with its outcome; from then on it and its sessions, questions and assignments are read-only | Owner or admin | Outcome is `won`, `lost` or `withdrawn`; not already archived; `won` or `lost` only after the export is recorded, and not while a session has changed since. Audited (`response.archived`). Definer | [`20261030100000`](../../supabase/migrations/20261030100000_changes_after_export.sql) | [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint11.test.ts`](../../supabase/tests/db/sprint11.test.ts) |
| `bulk_accept(p_session, p_min_confidence)` | Accepts, in one decision, every pending question in the session that has no gate, was processed by the server, has a `generated` or `assembled` draft, confidence at or above the threshold and the verdict `yes`. First re-checks the cited entries and holds any question whose sources became unreviewed, overdue or replaced (`question.held`). Returns how many were accepted and why the rest were held | Owner of the session's response, or admin | Threshold between 0 and 1. Approvals are recorded as `bulk` with the threshold. Definer | [`20261028100000`](../../supabase/migrations/20261028100000_bulk_needs_a_checker.sql) | [`processing.test.ts`](../../supabase/tests/db/processing.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts), [`sprint9.test.ts`](../../supabase/tests/db/sprint9.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) |
| `delete_response(p_response, p_reason)` | Permanently deletes a response created in error, with its sessions and everything under them | Admin | A reason of at least 10 characters. Audited (`response.deleted`) with the name, owner and counts. Works on archived responses. Definer | [`20261024100000`](../../supabase/migrations/20261024100000_unforgeable_markers.sql) | [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) |
| `record_export(p_session)` | Records that the session's answers were exported: learns from accepted answers (below), marks the session `completed` and the response exported, closes open assignments, and audits `response.exported`. Can run again after answers change: it learns only the changed answers, clears `changed_since_export_at`, and its audit row has `re_export: true` | Owner of the session's response, or admin | Refuses while any question is pending. Definer | [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql) | [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`knowledge-base.test.ts`](../../supabase/tests/db/knowledge-base.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts), [`sprint12.test.ts`](../../supabase/tests/db/sprint12.test.ts) |
| `import_kb_entries(entries, entry_origin, entry_origin_ref)` | Adds up to 2,000 entries from a JSON array, skipping invalid ones and duplicates (the same question in the same language, within the file and against current entries; by language since Sprint 13). Returns counts inserted, duplicate and invalid | Any member | Signed in; origin `import` or `manual`; records the caller as `created_by` and the file name (trimmed, at most 255 characters) as `origin_ref`. Definer | [`20261101100000`](../../supabase/migrations/20261101100000_import_duplicates_by_language.sql) | [`knowledge-base.test.ts`](../../supabase/tests/db/knowledge-base.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts), [`sprint12.test.ts`](../../supabase/tests/db/sprint12.test.ts) |
| `review_entry(p_entry, p_question, p_answer)` | Reviews an entry, optionally correcting its question or answer: sets `reviewed_at`, `reviewed_by` and `last_reviewed_at`; clears the embedding if the text changed; for a proposal, replaces the entry it proposed to replace. Audited (`kb.reviewed`, with the previous text when edited) | Admin | Refuses an entry already replaced, and a question that clashes with another current entry. Definer | [`20261024140000`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql) | [`knowledge-base.test.ts`](../../supabase/tests/db/knowledge-base.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) |
| `demo_status()` | Whether a demo is loaded, and when it was last reset; the governance page shows its **Demo** tab only when one is | Admin | Definer | [`20261103120000`](../../supabase/migrations/20261103120000_reset_demo.sql) | [`sprint15.test.ts`](../../supabase/tests/db/sprint15.test.ts) |
| `reset_demo(p_confirm)` | Removes every response and knowledge-base entry and loads the stored demo again, with entry numbers from KB-0001; keeps accounts, roles, settings, real people's usage and the audit log; replaces the demo's recorded usage. Returns the counts loaded | Admin | The phrase `reset the demo` exactly; a demo is loaded; one reset at a time. Runs the reload with nobody signed in, as the SQL Editor does. Audited (`demo.reset`). Definer | [`20261103120000`](../../supabase/migrations/20261103120000_reset_demo.sql) | [`sprint15.test.ts`](../../supabase/tests/db/sprint15.test.ts) |
| `overdue_entries()` | Current entries past their review date, oldest first, with how often each was cited in the last 90 days | Admin | Definer | [`20261024130000`](../../supabase/migrations/20261024130000_review_dates.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |
| `set_user_admin(target, make_admin)` | Grants or removes admin rights | Admin | Locks the admin rows first; refuses to remove the last admin. Audited. Definer | [`20261022140000`](../../supabase/migrations/20261022140000_access_control_hardening.sql) | [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) |
| `mark_onboarded()` | Records that the caller finished or skipped the introduction | Any member | Signed in; sets only the caller's own `onboarded_at`, and only the first time. Definer | [`20261029100000`](../../supabase/migrations/20261029100000_onboarding.sql) | [`sprint10.test.ts`](../../supabase/tests/db/sprint10.test.ts) |
| `my_onboarded_at()` | Returns when the caller finished or skipped the introduction, or null | Any member | Signed in; reads only the caller's own row. Definer | [`20261029110000`](../../supabase/migrations/20261029110000_onboarding_private.sql) | [`sprint10.test.ts`](../../supabase/tests/db/sprint10.test.ts) |
| `usage_status()` | The caller's use today against each daily cap, the monthly budget, and whether the alert share or the budget is reached; spend figures for admins only | Any member | Signed in. Definer | [`20261025110000`](../../supabase/migrations/20261025110000_extraction_caps.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) |
| `usage_report()` | This month's spend by person and by model, unpriced calls, questions processed and the average cost per question | Admin | Definer | [`20261025100000`](../../supabase/migrations/20261025100000_reserve_and_assignments.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) |
| `suggest_experts(p_question)` | Up to five people to assign a question to, scored on having written the entries matched to it (`sources_json`), having approved, one at a time, answers drawn from the same entries, and expertise tags matching those entries' tags, with the reasons | Any member | Invoker: reads under the caller's rights | [`20261023140000`](../../supabase/migrations/20261023140000_suggest_experts.sql) | [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-6) |
| `match_kb_entries(query_embedding, query_text, match_count, model_name)` | Finds current (not replaced) entries for a question: by vector similarity for the given model when a vector is given, otherwise by keywords (English word stems, so keyword matching does little for Japanese); at most 20. Each row carries the entry's `language` (Sprint 12) | Any member; `process-questions` calls it with the caller's session | Invoker | [`20261031110000`](../../supabase/migrations/20261031110000_match_language.sql) | [`hybrid.test.ts`](../../supabase/tests/db/hybrid.test.ts), [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) |

**What `record_export` learns**, for each accepted question not learned before (the outcome is stored in `learn_outcome`):

- Not learned: a pricing gate (`not_learned_pricing`); never processed by the server, or a gate other than legal, `translation`, `japanese`, `unreviewed_source`, `stale_source` or `unindexed_entries` (`not_learned_unchecked`); an empty answer (`not_learned_empty`). Japanese answers are learned like English ones (Sprint 12); the learned answer leaves out the reference list and the translation label, exactly as the app writes them and only at the end (`private.learnable_text`).
- Each learned entry gets the language of its own text, and replaces or is proposed against only an entry in the same language.
- A translated draft, edited or not, confirms nothing. Translated is decided against the question's language, as when it was processed (security review, M2 and M3): the draft was gated `translation`, a cited entry is in the other language, or a cited entry is itself an unreviewed translation. It is learned as a new entry, unreviewed whoever approved it, with `translated_from` set to the cited refs in the other language and, for a cited unreviewed translation, the refs that one was translated from (so a machine translation never becomes reviewed knowledge by being cited): `translated` when nothing in its language matches, otherwise `proposed`, never a direct replacement.
- An unedited `generated` or `assembled` draft confirms the entries it cites (`last_reviewed_at`, audited `kb.confirmed`). If the approver was not an admin and a cited entry is unreviewed, overdue or replaced, nothing is confirmed (`not_confirmed_source`).
- Anything else becomes a new entry with origin `response` and its provenance in `origin_ref`. If it matches a current entry (same question, or a near duplicate: the top match at or above the model's learning threshold, verdict `yes` or `partly`, and the checker's best entry is that same entry), an admin's approval replaces that entry at once (`superseded`) and anyone else's becomes a proposal for an admin to review (`proposed`). With no match it is `added`.
- The approver is whoever made the latest approval of that question, or the caller if there is none. A learned entry starts reviewed only when the approver is an admin.

### Helpers in the `access` schema

The access rules call these, so signed-in users and the service role may execute them, but the API does not expose the `access` schema, so nobody can call them as endpoints (Sprint 15, F-64; [`20261103110000`](../../supabase/migrations/20261103110000_policy_helpers_out_of_api.sql), which also renamed every call to them; tests in [`sprint15.test.ts`](../../supabase/tests/db/sprint15.test.ts)). Anonymous visitors have no use of the schema.

| Function | What it does | Who may call | What it checks | Defined in | Tests |
|---|---|---|---|---|---|
| `access.entry_review_due(e)` | An entry's review due date (see `kb_entries`) | Any member | Definer, reads only `ai_settings` | [`20261024120000`](../../supabase/migrations/20261024120000_entry_review.sql) | Not named in a test; exercised through `overdue_entries` and the source gates in [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) and [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) |
| `access.is_admin()` | Whether the caller is an admin | Any member (used in policies) | Definer | [`20261022120000`](../../supabase/migrations/20261022120000_access_control.sql) | [`access.test.ts`](../../supabase/tests/db/access.test.ts), [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) |
| `access.is_response_owner(opportunity)` | Whether the caller owns the response | Any member (used in policies) | Definer | [`20261022120000`](../../supabase/migrations/20261022120000_access_control.sql) | Not named in a test; exercised by every owner row in [`access.test.ts`](../../supabase/tests/db/access.test.ts) and [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) |
| `access.can_decide_question(p_question)` | Whether the caller may change a question's status or answer: admin, owner of its response, or assignee with an assignment in the question's own session and response | Any member (used in the `rfi_questions` update policy) | Definer | [`20261023150000`](../../supabase/migrations/20261023150000_sprint3_review_fixes.sql) | Not named in a test; exercised in [`workflow.test.ts`](../../supabase/tests/db/workflow.test.ts) (S3-5 and Sprint 3 security review findings) |
| `access.response_of_session(p_session)` | The response a session belongs to | Any member (used in the `rfi_questions` insert policy) | Definer | [`20261023130000`](../../supabase/migrations/20261023130000_workflow_and_learning.sql) | Not named in a test; exercised by the question-insert tests in [`hardening.test.ts`](../../supabase/tests/db/hardening.test.ts) |
| `access.current_operation(p_kind)` | The value of a marker in `private.operations` for the current transaction only | Any member (read by triggers running as the caller) | Definer | [`20261024100000`](../../supabase/migrations/20261024100000_unforgeable_markers.sql) | Not named in a test; exercised in [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) (S4-2) |

### Service role only

Members and admins cannot execute these.

| Function | What it does | Used by | Defined in | Tests |
|---|---|---|---|---|
| `reserve_quota(p_user, p_kind, p_n, p_size)` | Reserves up to `p_n` units of `questions`, `embed` or `extract` for a person, limited by their daily cap and by the monthly budget less spend and open reservations; records the reservation. Returns how many are allowed, the reason for any shortfall and the reservation id | Edge Functions (`supabase/functions/_shared/usage.ts`) | [`20261025130000`](../../supabase/migrations/20261025130000_sprint5_review_fixes.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint5.test.ts`](../../supabase/tests/db/sprint5.test.ts) |
| `settle_reservation(p_reservation)` | Deletes a reservation once real usage is recorded | Edge Functions (`usage.ts`) | [`20261024140000`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |
| `entry_review_status(p_refs)` | For each cited ref: reviewed or not, overdue since when, and the entry that replaced it | `process-questions`, to set source gates | [`20261027100000`](../../supabase/migrations/20261027100000_bulk_needs_yes_and_replaced_entries.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts), [`sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts) |
| `pending_embeddings(model, max_rows)` | Current entries with no embedding for the model, at most 500 | `embed-entries` | [`20261022150000`](../../supabase/migrations/20261022150000_kb_vectors.sql) | [`vectors.test.ts`](../../supabase/tests/db/vectors.test.ts) |
| `purge_old_usage()` | Deletes usage older than 13 months, daily counts older than seven days and reservations from before the previous month | `finishUsage` in the Edge Functions, after every recorded call (Sprint 11) | [`20261024140000`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql) | [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |
| `month_committed_usd()` | This month's recorded cost plus open reservations, in dollars | `reserve_quota`, `usage_status` | [`20261024140000`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql) | Not named in a test; exercised through `reserve_quota` and `usage_status` in [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |
| `month_spend_gbp()` | This month's recorded cost in pounds | `usage_status` | [`20261024110000`](../../supabase/migrations/20261024110000_usage_and_caps.sql) | Not named in a test; exercised through `usage_status` in [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |
| `text_language(p_question, p_answer)` | The language rule of `kb_entries.language` (`en` or `ja`), for text not yet in the table | `record_export`, `import_kb_entries` (Sprint 13) | [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql) | [`sprint12.test.ts`](../../supabase/tests/db/sprint12.test.ts) |
| `user_is_admin(p_user)` | Whether a given person is an admin | `record_export`, `set_entry_review_on_insert` | [`20261024120000`](../../supabase/migrations/20261024120000_entry_review.sql) | Not named in a test; exercised by the learned-entry review tests in [`sprint4.test.ts`](../../supabase/tests/db/sprint4.test.ts) |

### Trigger functions

Run only by the triggers named in the table sections; they cannot be called directly.

| Function | Trigger | Defined in |
|---|---|---|
| `note_change_after_export` | `rfi_questions_zz_change_after_export` (named to run after the trigger that reopens a changed accepted answer), before a change of `status` or `final_answer`: in an exported session, marks it changed since export, audits `question.changed_after_export` (who, from and to, whether the answer changed) and clears `learned_at`, so `record_export` considers it again and learns it only if the answer changed | [`20261030100000`](../../supabase/migrations/20261030100000_changes_after_export.sql) |
| `record_skip` | `rfi_questions_record_skip`, before insert or update: sets `skipped_by` and `skipped_at` when a question is skipped, clears them on restore, and ignores any value sent | [`20261030120000`](../../supabase/migrations/20261030120000_who_skipped.sql) |
| `audit_entry_change` | `kb_entries_audit_direct`, after a signed-in user deletes an entry or changes its tags or source: audits `kb.deleted` or `kb.changed` | [`20261030160000`](../../supabase/migrations/20261030160000_sprint11_review_fixes.sql) |
| `audit_price_change` | `ai_prices_audit`: audits every change of a price | [`20261030110000`](../../supabase/migrations/20261030110000_sprint11_access.sql) |
| `normalise_new_assignment` | `question_assignments_normalise`, before insert by a signed-in user | [`20261030110000`](../../supabase/migrations/20261030110000_sprint11_access.sql) |
| `handle_new_user` | `on_auth_user_created` on `auth.users`: creates the profile (empty `search_path` since Sprint 11) | [`20260430160006`](../../supabase/migrations/20260430160006_user_profiles_and_assignments.sql) |
| `set_updated_at` | `opportunities_updated_at`, `kb_entries_set_updated_at` | [`20260430172201`](../../supabase/migrations/20260430172201_fix_security_issues.sql) |
| `refuse_archived_response_edit` | `opportunities_archived` | [`20261023130000`](../../supabase/migrations/20261023130000_workflow_and_learning.sql) |
| `refuse_if_archived` | `rfi_sessions_archived`, `rfi_questions_archived`, `question_assignments_archived`, `opportunity_contributors_archived`: refuses changes to an archived response, except `delete_response`'s and the database's own clean-up when a person's account is deleted (their contributor and assignment rows, and who skipped a question) | [`20261030160000`](../../supabase/migrations/20261030160000_sprint11_review_fixes.sql) |
| `check_bulk_acceptance` | `rfi_questions_bulk_acceptance` | [`20261024100000`](../../supabase/migrations/20261024100000_unforgeable_markers.sql) |
| `record_approval` | `rfi_questions_record_approval` | [`20261024100000`](../../supabase/migrations/20261024100000_unforgeable_markers.sql) |
| `reopen_changed_answer` | `rfi_questions_reopen_changed_answer` | [`20261023110000`](../../supabase/migrations/20261023110000_review_fixes.sql) |
| `refresh_accepted_count` | `rfi_questions_accepted_count` | [`20261023110000`](../../supabase/migrations/20261023110000_review_fixes.sql) |
| `check_assignment_session` | `question_assignments_session_matches` | [`20261022140000`](../../supabase/migrations/20261022140000_access_control_hardening.sql) |
| `check_assignment_question` | `question_assignments_question_matches` | [`20261023150000`](../../supabase/migrations/20261023150000_sprint3_review_fixes.sql) |
| `guard_closed_assignments` | `question_assignments_guard_closed` | [`20261025130000`](../../supabase/migrations/20261025130000_sprint5_review_fixes.sql) |
| `private.stamp_audit_row` | `audit_log_stamp`: every new audit row is dated now, whatever it claims, and `actor_ref` copies `actor` (Sprint 14) | [`20261102100000`](../../supabase/migrations/20261102100000_audit_log_append_only.sql) |
| `set_entry_review_on_insert` | `kb_entries_review_on_insert` | [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql) |
| `stamp_settings_change` | `ai_settings_stamp` | [`20261024110000`](../../supabase/migrations/20261024110000_usage_and_caps.sql) |
| `price_usage` | `ai_usage_price` | [`20261024140000`](../../supabase/migrations/20261024140000_sprint4_review_fixes.sql) |

### Helpers in the `private` schema

No API role can reach the `private` schema, so these run only from the definer functions and triggers that use them.

| Function | What it does | Defined in |
|---|---|---|
| `private.learnable_text(p)` | An answer without the notes the app adds to a draft: the translation label (exactly the two labels in `drafting.ts`) and the reference list (`[References: KB-0001, ...]`), each only at the very end; spaces and line breaks trimmed at both ends. Used by `record_export` | [`20261031130000`](../../supabase/migrations/20261031130000_learning_across_languages.sql) |
| `private.source_gate(p_refs)` | Given cited refs, returns `unreviewed_source` if any is unreviewed or unknown, else `stale_source` if any is overdue or replaced, else no gate; with a reason naming the entries. Used by `bulk_accept`, `record_export` and `private.release_source_gates` | [`20261027100000`](../../supabase/migrations/20261027100000_bulk_needs_yes_and_replaced_entries.sql) |
| `private.release_source_gates(p_refs)` | Re-checks the source gate of pending questions citing these refs in open responses, and logs each change | [`20261026120000`](../../supabase/migrations/20261026120000_sprint6_review_fixes.sql) |
| `private.on_entry_reviewed()` | Trigger function for `kb_entries_release_held_questions` | [`20261026110000`](../../supabase/migrations/20261026110000_release_held_questions.sql) |
| `private.refuse_unwritten_placeholder()` | Trigger function refusing to accept an unwritten placeholder | [`20261027110000`](../../supabase/migrations/20261027110000_sprint7_review_fixes.sql) |

Tests: [`sprint6.test.ts`](../../supabase/tests/db/sprint6.test.ts) (release and hold), [`sprint7.test.ts`](../../supabase/tests/db/sprint7.test.ts) (replaced entries, placeholders).

## Things that look odd but do nothing

Left over from earlier migrations; none of them grants access, but they can mislead a reader of the catalogue.

- Members hold a table-level update grant on `opportunity_contributors`, but there is no update policy, so an update changes no rows.
- Members hold insert, update and delete grants on the `response_overview` view (from Supabase's default grants), but the view is not updatable, so every write fails.
- The `ai_usage` insert policy for `service_role` has no effect, since the service role bypasses RLS.

## Adding a table

From [decision 0003](../decisions/0003-access-control.md) and the project rules:

1. **Write a new migration** with the table in `public` (or `private` if no API role should ever reach it). No data rows: synthetic data goes in `supabase/seed.sql`.
2. **Turn on row-level security** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
3. **Set the grants explicitly.** Supabase's default privileges give `authenticated` select, insert, update and delete on every new table in `public` (anonymous visitors' defaults are revoked by [`20261022120000_access_control.sql`](../../supabase/migrations/20261022120000_access_control.sql), and members' truncate, trigger and references by [`20261022140000_access_control_hardening.sql`](../../supabase/migrations/20261022140000_access_control_hardening.sql)). Revoke what members must not do, then grant insert and update on named columns only. Columns the server or a function sets (ids of who did something, dates, scores, flags) get no grant.
4. **Write a policy for each command members need**, `TO authenticated`, using `(select auth.uid())` (evaluated once per query rather than once per row; a test checks every policy, Sprint 15), `access.is_admin()` and `access.is_response_owner()`. A new helper for policies goes in the `access` schema, not `public`, so it is not an API endpoint. Give an insert policy a check that the row is the caller's.
5. **Route privileged writes through a function**: `SECURITY DEFINER`, `SET search_path = ''`, check the caller inside it, `REVOKE ALL ... FROM PUBLIC, anon`, then `GRANT EXECUTE` to the roles that need it. Write to `audit_log` for privileged changes.
6. **Decide whether archived responses lock it**, if its rows belong to a response (`refuse_if_archived` does this for sessions, questions and assignments).
7. **Test every row of the role matrix** in `supabase/tests/db/`, with the helpers in [`harness.ts`](../../supabase/tests/db/harness.ts): anonymous refused, member, owner, assignee where it applies, admin, and the service role (`asServiceRole`). Test refusals with `refused`, and test that a column without a grant cannot be written.
8. **Update the role matrix** in decision 0003 and this page.
