# 0003 Access control and the role matrix

Date: 22 October 2026, extended 23 October (Sprint 2: bulk approval and server-side scoring). Status: agreed with Rory (invite-only; any member may add to the knowledge base; response owner per response; hard delete for admins only).

**Context.** The review found that any signed-in user could make themselves an admin, anyone could sign up, responses without a recorded creator were editable by everyone, and seed users shared one password in a migration.

**Decision.** One organisation per deployment, three roles. The *response owner* is per response (`opportunities.owner_id`, defaulting to the creator), not a global role.

| Action | Admin | Response owner | Member |
|---|---|---|---|
| Read responses, sessions, questions, knowledge base | yes | yes | yes |
| Create a response (and own it), run a session | yes | yes | yes |
| Edit a response, hand it to a new owner | yes | yes | no |
| Permanently delete a response (created in error only) | yes | no | no |
| Assign questions on a response; add or remove contributors | yes | yes | no |
| Update an assignment | yes | yes | assignee only |
| Accept, edit or skip one question (including a gated one) | yes | yes | yes |
| Approve several questions at once (`bulk_accept`, or any update accepting more than one); never includes gated or uncalibrated questions | yes | yes | no |
| Write confidence, gates, drafts or processing details | no: the `process-questions` function, as the service role | no | no |
| Add to the knowledge base (import, add back, manual) | yes | yes | yes |
| Edit or delete a knowledge-base entry | yes | no | no |
| Edit own name, title, department, expertise | yes | yes | yes |
| Edit another user's details | yes | no | no |
| Grant or remove admin rights (`set_user_admin`, audited, last admin protected) | yes | no | no |
| Invite users | yes, from the Supabase dashboard or CLI for now | no | no |
| Anonymous visitors | no access to any table | | |

Sessions and questions remain team-shared: any member adds questions and records review decisions; Sprint 3's readiness workflow tightens this. From Sprint 2 (`20261023100000_server_side_processing.sql`, tested in `supabase/tests/db/processing.test.ts`), members may insert only a question's text and update only its status and final answer, and the database refuses any update that accepts more than one question unless it comes from the response owner or an admin and contains no gated or uncalibrated question. A member could still accept questions one statement at a time; each of those is an individual decision, which is what rule 4 asks for. Privileged changes are written to `audit_log`, which only admins can read and only `SECURITY DEFINER` functions can write.

**How it is enforced and tested.** Row-level security plus column-level grants (so `is_admin`, `created_by` and similar cannot be changed through the API), in `supabase/migrations/20261022120000_access_control.sql` and `..._knowledge_base.sql`. Every row of the table has a test in `supabase/tests/db/`. Sign-up is off in `supabase/config.toml`, and CI checks against the real Supabase stack that sign-up is refused.

**Notes.**
- The seed-users migration was emptied (kept for sequence) and its users moved to the dev-only `supabase/seed.sql`, since only the retired Bolt project ever ran it.
- The Bolt migration titled "enable HIBP password protection" is a no-op: leaked-password protection is a hosted Auth setting, not SQL. Turn it on in the hosted project (Sprint 5 checklist).
- An in-app invite screen needs a server-side function with the service key; logged in the backlog.

## Independent review (22 October 2026)

A separate reviewer, given the code but not the reasoning, probed the database as members and anonymous visitors. It confirmed that admin rights cannot be self-granted, anonymous visitors reach nothing, and the `SECURITY DEFINER` functions are safe, and found seven gaps, all now fixed in `20261022140000_access_control_hardening.sql` and tested in `supabase/tests/db/hardening.test.ts`:

1. An owner could move an assignment onto another response; assignments are now tied to their response's session by a trigger, and only the work columns (status, answer, notes, completion) can change.
2. An assignee could rewrite an assignment's history (assigner, question text, dates); fixed by the same column grants.
3. Two admins removing each other simultaneously could leave none; `set_user_admin` now locks admin rows first.
4. Functions created later would have been executable by anonymous visitors; the global default grant to PUBLIC is revoked.
5. Any member could move a session onto another response; only status and counts can change now.
6. Imports were unbounded; capped at 2,000 entries, matching the upload limit.
7. Members held TRUNCATE (which ignores row-level security) and similar privileges; revoked.

Still accepted until Sprint 3: questions within a session are team-editable, and `kb_entries.origin_ref` is free text.

## Independent review, Sprint 2 (23 October 2026)

A second reviewer, given the code but not the reasoning, probed the Sprint 2 changes as a member who does not own the response and as an anonymous visitor. It confirmed the column rights, that a member cannot approve in bulk by any route it tried (multi-row updates, writable CTEs, `INSERT ... ON CONFLICT`, `bulk_accept`), that an owner cannot include a gated question, that questions from another session cannot be processed, and that no key or provider error reaches a response. It found six gaps, fixed in `20261023110000_review_fixes.sql` and the function code, each with a test (`supabase/tests/db/processing.test.ts`, `supabase/functions/_shared/*.test.ts`):

1. Questions scored in the browser before Sprint 2 could be bulk-approved on user-written confidence; bulk approval now also requires `processed_at`, which only the server sets.
2. Any member could reprocess a question until a classifier gate cleared; each question is now processed once (pending and never processed), and the save itself re-checks this.
3. Accepted answers could be rewritten or approvals undone in bulk; any statement changing more than one question's status or answer now needs the owner or an admin, changing an accepted answer reopens it, and `accepted_count` is computed by the database.
4. The draft checks missed numbers in words or other scripts, digits excused by "annually" anywhere in the text, ref-shaped numbers and links without a scheme; all now rejected, and model-written notes are withheld if they contain links.
5. Zero-width and look-alike characters defeated the rules, and half-width katakana avoided the translation gate; text is now normalised first.
6. Members held DELETE on questions and sessions (no policy allowed it, but it was one policy away), now revoked; the bulk check decides by the database role in use, so a forged claim cannot switch it off.

Residuals accepted for now: a member can still accept questions one statement at a time (each is an individual decision); any member can add knowledge-base entries, so the draft checks trust the cited entries' own figures and links (Sprint 4's governance pack adds review of member-added entries); there is no per-user rate limit on processing (Sprint 4's cost caps).

## Independent review, Sprint 3 (23 October 2026)

A third reviewer, given the code but not the reasoning, probed the Sprint 3 workflow (decision rights, recording an export, learning, archive and delete) as a member who does not own the response. It confirmed that only `bulk_accept` can approve more than one question, that direct deletes are refused, that `delete_response` needs an admin and a reason, and that archived responses cannot be changed. It found five gaps, fixed in `20261023150000_sprint3_review_fixes.sql`, each with a test (`supabase/tests/db/workflow.test.ts`, "Sprint 3 security review findings", plus updated tests in `access.test.ts`, `hardening.test.ts` and `processing.test.ts`):

1. A member could assign themselves on their own response with the id of another response's question, and then decide that question. An assignment must now name a question in its own session (trigger), and `can_decide_question` counts an assignment only when its session and response match the question's.
2. Learning worked from a block list, so questions never processed or never gate-checked could be learned. It is now an allow list: only questions the server processed, in English, with no gate other than legal (`not_learned_unchecked` records the rest).
3. Members could create responses already archived or exported, and add sessions and questions to other people's responses. New responses take only a name and due date; only the owner or an admin adds sessions and questions.
4. Members could still write `kb_entries.origin_ref` directly. Only `import_kb_entries` (the file name, with origin import or manual) and `record_export` (learned entries) set it now; `import_kb_entries` became a checked `SECURITY DEFINER` function to allow this.
5. Supersession trusted any "yes" verdict, even when the judge meant a different entry. The server now records the judge's best entry (`judge_best_ref`), and learning supersedes the top entry only when they match.

Residual accepted: the transaction settings `app.bulk_threshold` and `app.deleting_response` can be set by anyone with a direct SQL connection. Members only reach the database through the API, which cannot set them, so this is recorded rather than fixed. The "Still accepted until Sprint 3" items from the first review are now closed (questions are owner-editable, `origin_ref` is system-set).
