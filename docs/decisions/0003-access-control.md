# 0003 Access control and the role matrix

Date: 22 October 2026. Status: agreed with Rory (invite-only; any member may add to the knowledge base; response owner per response; hard delete for admins only).

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
| Add to the knowledge base (import, add back, manual) | yes | yes | yes |
| Edit or delete a knowledge-base entry | yes | no | no |
| Edit own name, title, department, expertise | yes | yes | yes |
| Edit another user's details | yes | no | no |
| Grant or remove admin rights (`set_user_admin`, audited, last admin protected) | yes | no | no |
| Invite users | yes, from the Supabase dashboard or CLI for now | no | no |
| Anonymous visitors | no access to any table | | |

Sessions and questions remain team-shared (any member adds and updates); Sprint 3's readiness workflow tightens this. Privileged changes are written to `audit_log`, which only admins can read and only `SECURITY DEFINER` functions can write.

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
