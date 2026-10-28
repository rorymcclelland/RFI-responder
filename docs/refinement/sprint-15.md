# Sprint 15 refinement: polishing the live demo

Refined 27 October 2026, after Rory asked to "run sprint 15", the sprint proposed at the Sprint 14 review: BUG-36 (search by entry number), F-63 (a more elegant demo reset), F-64 (policy helpers callable through the API) and F-65 (`auth.uid()` evaluated per row). At refinement Rory added F-3, an invite screen (Q4). The live project gets the changes at the close.

## What refinement found

- **BUG-36 is one filter.** The knowledge-base modal (`KBModal` in `src/App.tsx`) filters on question, answer and tags. The entry number is already on each entry (`KnowledgeEntry.id` holds the `KB-` reference), so nothing in the database changes.
- **F-64 cannot be fixed by revoking alone.** Access policies run with the caller's rights, so a signed-in user must be able to execute the helpers the policies call. Revoking execute would break every policy that uses them. The fix is to move the six helpers to a schema of their own that the API does not expose, keeping execute for signed-in users. Policies refer to functions by identity, so they follow the move unchanged; but 16 functions call the helpers by name in their bodies (`public.is_admin()` and so on), and those must be rewritten to the new name in the same migration.
- **F-65 has a dead policy in it.** Of the nine policies flagged, one ("Authenticated users can update sessions", from the prototype) can never apply: signed-in users have had no update right on `rfi_sessions` since Sprint 3. It is dropped rather than tuned. The other eight are rewritten with `(select auth.uid())`, which Postgres evaluates once per query.
- **F-63 must not put demo data in a migration** (project rule: migrations hold configuration only). The migration therefore adds an empty place to keep the demo, and the reset function. The demo data stays in the generated `supabase/demo-hosted.sql`, which, when run, also stores its own reload script there. A project where no demo was loaded (a local install, or a real deployment) has nothing to reset and refuses.
- **F-63 has one unknown that tests settle.** Loading the demo in the SQL Editor runs with no signed-in user, but a button runs with an admin signed in, and some triggers behave differently for an admin (for example, entries an admin adds are marked reviewed). The function clears the signed-in identity for the reload and restores it for the audit row. A test compares the state after the button with the state after the SQL Editor script, table by table.

## Stories

### S15-1 Search the knowledge base by entry number. S (BUG-36)

**The job.** A reviewer who sees "KB-0101" cited in a draft can find that entry by typing its number.

**Before and after.** Today searching `KB-0101` finds nothing. After, `KB-0101`, `kb-101`, `kb0101` or `101` find KB-0101, alongside any entry whose text contains what was typed.

**What changes.** A pure function `entryMatches(entry, query)` in `src/lib/knowledgeBase.ts`, used by `KBModal`; the placeholder becomes "Search numbers, questions, answers, tags…"; the guide's knowledge-base section says numbers can be searched.

**Test cases.**
1. `KB-0101`, `kb-0101`, `KB0101`, `kb 101` and `0101` each find KB-0101 and not KB-0010 or KB-1010.
2. `101` finds KB-0101 and also any entry whose question, answer or tags contain "101".
3. Text searches work as before (question, answer, tags; case-insensitive).
4. Edge: an empty or spaces-only query shows every entry; `KB-` alone matches nothing by number (only text containing "kb-").
5. Hostile: regular-expression characters (`.*`, `(`, `[`) are treated as text, and a very long query does not throw.

### S15-2 Policies check the signed-in user once per query. S (F-65)

**The job.** The eight policies that call `auth.uid()` per row call it once per query, and the prototype's dead update policy on sessions is gone, so Supabase's performance advisor has nothing to flag for these.

**What changes.** A migration that `ALTER POLICY`s the eight (same rules, `(select auth.uid())`) and drops "Authenticated users can update sessions". DATA-MODEL notes the pattern for new policies.

**Test cases.**
1. A test lists every policy in `public` and fails if any calls `auth.uid()` outside `(select auth.uid())`.
2. The whole role-matrix suite (`supabase/tests/db/`) passes unchanged: same rows visible, same writes refused.
3. A signed-in member still cannot update a session directly (the dropped policy changed nothing).

### S15-3 The policy helpers are no longer callable through the API. M (F-64)

**The job.** The six helpers the access rules use (`is_admin`, `is_response_owner`, `can_decide_question`, `response_of_session`, `current_operation`, `entry_review_due`) can no longer be called as API endpoints, and the access rules work exactly as before.

**What changes.** One migration: a schema `access`, not exposed by the API, with usage and execute for signed-in users and the service role only; the six functions moved into it; the 16 functions that call them rewritten to the new names (generated from their current definitions inside the migration, so nothing else in them changes, and checked by a test). DATA-MODEL, decision 0003 and the "Callable by anyone" list updated.

**Test cases.**
1. None of the six exists in `public`; each exists in `access`, is `SECURITY DEFINER` with an empty search path, and is executable by `authenticated` and `service_role` only (not `anon`, not `PUBLIC`).
2. No function in `public` or `private` refers to `public.<helper>` any more.
3. The whole role-matrix suite passes unchanged, including bulk approval, export, archiving, entry review and usage.
4. Hostile: a signed-in member calling `rpc('is_admin')` through the API is refused (the function is not found), shown with the API's own route in a unit test of the client call.
5. An anonymous visitor still sees nothing and changes nothing.
6. After the live update, Supabase's security advisor no longer lists the six (checked at the close).

### S15-4 Reset the demo from the app. M (F-63)

**The job.** An admin resets the hosted demo from the governance page, without the Supabase SQL Editor, and the reset is in the audit log.

**Before and after.** Today Rory pastes `supabase/demo-hosted-reset.sql` into the SQL Editor. After, **Governance** has a **Demo** section (shown only where a demo is loaded) with the date of the last reset and a **Reset the demo** button, confirmed by typing a phrase.

**What changes.**
- Migration: `private.demo_reload` (one row: the reload script and when it was stored; no grants to anyone), `public.demo_status()` (admins: whether a demo is loaded and when it was last reset) and `public.reset_demo(p_confirm text)` (admins only; refuses without the exact phrase, or with no demo loaded; runs the stored reload as the owner with no signed-in identity; writes an audit row `demo.reset` in the admin's name; one reset at a time).
- `eval/demo-hosted.ts`: `demo-hosted.sql` also stores the reload script; the SQL reset file stays as a fallback.
- `src/GovernanceAdmin.tsx`: the Demo section; the guide and the go-live pack's "To reset the demo".

**Test cases.**
1. An admin with the phrase: responses and entries return to the demo's, including removing a reviewer's response and entry; accounts, roles, limits, real people's usage and the audit log are kept; one `demo.reset` audit row names the admin.
2. The state after `reset_demo` equals the state after running `demo-hosted-reset.sql` as the owner (counts and key columns of every demo table, including which entries are reviewed).
3. Refused: a member; an anonymous visitor; an admin with a wrong or missing phrase; a project with no demo loaded (`demo_status` says none, and the section is hidden).
4. Twice in a row gives the same state, and the demo's recorded usage is not counted twice.
5. Hostile: no role but the owner can read or write `private.demo_reload`; the phrase is compared exactly, so SQL in it does nothing.
6. The button shows "Resetting…" while it runs, then a confirmation beside it, and the open views reload.

**Boundaries.** Synthetic data only: the reload script comes from the generated demo file, never a migration. Rule 1: the guide says exactly what is kept and what goes. The next sign-in re-indexes the entries (a few pence, inside the daily limit), as today.

### S15-5 Admins invite people from the app. M (F-3)

**The job.** An admin invites a reviewer from **Users**, without the Supabase dashboard; the invitation is in the audit log.

**Before and after.** Today Rory opens Supabase, **Authentication**, **Users**, **Invite user**. After, **Users** has an **Invite someone** form (email address, optional name). The person gets the same invitation email (from Resend on the hosted demo) and joins as a member; an admin can then make them an admin with the existing control.

**What changes.**
- A new Edge Function `invite-user` (decision 0005: the service key stays server-side). Signed-in admins only, checked with `user_is_admin`; the address is trimmed, lower-cased and validated; Supabase's `inviteUserByEmail` sends the invitation with `APP_ORIGIN` as the link's destination; an audit row `user.invited` names the admin and the address; at most 20 invitations per admin per day, counted from the audit log.
- The logic in a testable core (`_shared/invite-core.ts`) with the Supabase calls passed in, as the other functions do.
- `src/UserManagement.tsx`: the form, a "Sending…" state and a result message beside the button. The guide's admin section, DEPLOYING (deploy the new function) and the function list in DEVELOPMENT.

**Test cases.**
1. An admin invites `new.reviewer@example.com`: the invitation is sent once, with the name passed as the display name, an audit row `user.invited` names the admin, and the person appears under **Users** as a member.
2. Refused: a member (403); an anonymous caller (401). A web page on another origin cannot read the answer (CORS, as for the other functions); that is the browser's protection, and the function itself requires a signed-in admin's token whatever the origin.
3. Refused before anything is sent: an empty, malformed or overlong address (over 254 characters), a name over 100 characters, an address with a line break or control character.
4. An address that already has an account: a plain message ("already has an account"), nothing sent, no audit row.
5. The 21st invitation by one admin in a day is refused (429) with a plain message; another admin is unaffected.
6. Supabase's email limit or SMTP failure: a plain message saying the invitation was not sent, and no audit row.
7. Hostile: extra fields in the request (for example `is_admin: true` or `data`) are ignored; the person is always a member.

**Out of scope.** Resending or withdrawing an invitation (Supabase still does both); showing who has not yet accepted.

**Boundaries.** Rule 1: the guide says the person joins as a member and that the email comes from the project's mail settings. Personal data: the address goes to Supabase and the SMTP provider, as invitations from the dashboard already do (DATA-HANDLING unchanged except naming the screen).

### S15-6 Update the live demo. S

**The job.** The live project and app have this sprint's changes. Rory runs `npx supabase db push` and `npx supabase functions deploy invite-user`, then the new `supabase/demo-hosted-reset.sql` once in the SQL Editor (to store the reload script); Vercel deploys `main` by itself. Claude checks the advisors and the live functions read-only, then sends the test pack.

## The sprint as a whole

Order: S15-1 and S15-2 (independent, small), then S15-3 (its migration rewrites function bodies, so it goes before S15-4 adds new ones that call the helpers), then S15-4 and S15-5, then S15-6 with the test pack and the close. Sizes: three S and three M: about three days, then the security review. No spike: the one unknown in S15-4 is settled by its test case 2. No API keys needed.

## Questions for Rory (answered 27 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | How the demo is reset (F-63) | A button for admins on the governance page, confirmed by typing a phrase **Rory: agreed** |
| Q2 | What a reset keeps | As today: accounts, roles, limits, real people's usage and the audit log kept; every response and entry, including reviewers', replaced by the demo's **Rory: agreed** |
| Q3 | What a number search matches (BUG-36) | The number with or without `KB-` and leading zeros, as well as any text match **Rory: agreed** |
| Q4 | Anything else this sprint | No: keep it short; F-3 (an invite screen) stays next in line **Rory: add the invite screen (S15-5)** |
| Q5 | Who an invitation makes the person | Always a member; an admin promotes them afterwards with the existing, audited control **Rory: agreed** |
| Q6 | How many invitations an admin may send a day | 20, well under the SMTP provider's daily limit **Rory: agreed** |

## Security review (27 October 2026)

An independent review of `main..sprint-15` found no high issue, two medium and seven low, with five for information; all are fixed, each with a test where code changed. It compared the database before and after the sprint: apart from the rename, every policy, function body and execute right is unchanged.

| | Finding | Fix |
|---|---|---|
| M1 | The draft test pack said the review's findings were fixed before the review had run | The pack states only what was checked, written after the fixes |
| M2 | Supabase re-invites an account that exists but is unconfirmed, so an admin could send a fresh sign-in link for a fictional demo person (unconfirmed, at `.invalid`) or re-invite a pending reviewer, with another audit row | Before anything is sent, `reserve_invitation` refuses an address with any account, confirmed or not; reserved domains (`.invalid`, `.test`, `.example`, `.localhost`) are refused outright. CI invites an existing account (409) and a fictional address (400) |
| L3 | Parallel invitations could all pass the daily count | Slots are reserved under a lock per admin before sending, and given back if nothing is sent; a test fires eight at once against a limit of five |
| L4 | An invitation whose audit row failed was neither recorded nor counted, while the guide said every one is recorded | It keeps its slot, so it still counts; the message says the record is missing; the guide says so |
| L5 | `auth.uid()` also reads the older `request.jwt.claim.sub`, which the reset left in place, so the reload could have run as the admin | Both settings are cleared during the reload and restored after; a test sets the older one |
| L6 | "Everyone's accounts are kept" was too broad: the reload puts the fictional people back; and a real account at `.invalid` would lose its usage on every reset | The page and guide say real people's accounts are kept and the fictional people are put back; `.invalid` addresses cannot be invited |
| L7 | Two audit descriptions misled: "everything else removed", and "account since deleted" for someone invited since sign-in | "All other responses and entries removed"; "not in the team list loaded at sign-in (new since then, or deleted)" |
| L8 | "Nothing has changed" after any unexpected error, though a lost connection can hide a reset that happened | "The demo may not have been reset. Check Last reset" |
| L9 | The SQL reset did not take the button's lock; a reset during processing makes that run fail | Both take the same lock; the page and guide say not to reset while questions are processing |
| I10 | Functions added to `access` later would be executable by everyone by default | Default privileges revoke it; tested |
| I11 | The rename check would miss quoted names | The test matches quoted names too |
| I12 | The refinement called CORS a server refusal | Reworded: CORS protects in the browser; the function requires an admin's token whatever the origin |
| I13 | The invitation link falls back to localhost if `APP_ORIGIN` is not set | The live update checks it is set |
| I14 | After a reset, older audit entries that name an entry number refer to the entry that had it before | Said in the guide |

## What building found

- **The Sprint 14 SQL reset would have renumbered the knowledge base** (BUG-37). Emptying `kb_entries` does not restart its numbering, so after a reset the demo's entries would have been KB-0135 onwards, while the demo responses cite KB-0001 to KB-0132 by number. The live demo had never been reset, so nothing was affected. Both the SQL reset and the button now restart the numbering, and a test checks the entries come back as KB-0001 to KB-0132 with the first Japanese entry at KB-0101.
- **S15-3 test case 4** (calling a helper through the API is refused) cannot be shown without the API, which the database tests do not run; it moved to CI, which calls `rpc/is_admin` on the local stack and expects a 404, and to the live check (S15-6).
- **S15-5 records invitations by account id only.** Writing the address into the append-only audit log would keep it after the person was deleted, against DATA-HANDLING; the row names the new account instead, and the audit screen shows their current name. The page is called **Team** in the app, not **Users**.
- **S15-5 is also checked in CI:** `invite-user` refuses the anon key (401), a malformed address (400) and a member (403) on the local stack.

## Hosted check (28 October 2026)

Rory updated the live demo and ran the test pack. Cases 1, 2, 4 and 5 passed. Case 3 found two problems with the reset from the app, both fixed before the close:

- **BUG-41: every reset from the app failed on the live project** with "UPDATE requires a WHERE clause". Supabase's API runs each request with `pg_safeupdate`, which refuses an UPDATE or DELETE with no WHERE clause, even inside a function; the local test database does not load it, so every test passed. The step recording the reset date had none, so the whole reset rolled back and nothing changed. Fixed in `20261103140000_reset_demo_where.sql`, and a database test now fails if any function has an UPDATE or DELETE without a WHERE clause.
- **The confirmation looked frozen.** With only part of the phrase typed, the button stayed unavailable with no explanation. A line under the box now says what is missing, the label asks for the whole phrase, and an unavailable button looks unavailable.

Rory then reset the demo from the app (21:06, back to 132 entries and four responses; Claude checked it live). Rory also raised three points for the backlog: the knowledge-base modal changes size and moves as the search narrows (BUG-38); a response looks empty while its questions load (BUG-39); and saving a knowledge-base entry took about 10 seconds (BUG-40).

## Review and close (28 October 2026)

All six stories done, with F-3 added at refinement. Security review: no high, two medium, seven low, five for information, all fixed. Hosted check: all five cases passed once BUG-41 was fixed. New backlog rows: BUG-38, BUG-39 and BUG-40; BUG-37 and BUG-41 found and fixed in the sprint. Test counts at the close: 965 unit, 325 database.

