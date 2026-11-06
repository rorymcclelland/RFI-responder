# Spike F-73: sending a large response on the hosted database

Sprint 25, S25-3, 6 November 2026. Time-boxed to half a day. It changes no product code.

## The question

Can a response of realistic size be marked as sent on the hosted database within its time limit, and if not, why does the time grow faster than the number of questions?

## The answer

Not at the largest sizes an upload allows. On staging, marking a response of two files of 2,000 questions as sent takes about 10.5 seconds, and three files of 2,000 about 16 seconds; signed-in users have an 8-second limit, so both would be refused. One file of 500 takes 1.3 seconds and four files of 500 about 4 seconds, inside the limit. Bulk approval stays inside it at every size measured (6.3 seconds at 6,000 questions).

The time grows faster than the number of questions because of two things in marking as sent, neither of them the duplicate lookup refinement suspected:

1. **Every update to a question recounts its file.** A trigger from Sprint 3 (`rfi_questions_accepted_count`) runs after every `UPDATE` of questions and recounts the file's approved questions, whatever the update changed. Marking as sent updates each question once, one at a time, to record what was learned, so a file of *n* questions is recounted *n* times over *n* rows. That grows with the square of the file's size.
2. **The tag lookup reads the whole knowledge base.** For each answer learned, the tags of its cited entries are found with `ref IN (subquery)`, which Postgres runs as a scan of every entry rather than through the unique index on `ref`. Each answer learned also adds an entry, so the scan grows as the sending goes on.

## The figures

### The time limit

Read on staging and on the live demo, 6 November (read-only): signed-in users (`authenticated`) and the API's own role (`authenticator`) have `statement_timeout = 8s`; visitors (`anon`) 3 seconds; the service role none (the server's default, 120 seconds). The two projects are the same.

### On staging

The hosted staging database (Supabase Free plan, London), 6 November, Deploy run 42207780200 on the throwaway branch `sprint-25-f73`. Each size was loaded with synthetic questions and timed as a signed-in owner (who is not an admin) without the 8-second limit, so the full time is measured, inside one transaction that was then rolled back: staging kept nothing (checked after each run). Each question cites a reviewed entry from staging's knowledge base (134 current entries). Two runs per size.

| Files × questions | Questions | Mark as sent (s) | Bulk approval (s) |
|---|---|---|---|
| 1 × 500 | 500 | 1.3, 1.3 | 0.7, 0.6 |
| 4 × 500 | 2,000 | 4.3, 4.0 | 2.3, 2.0 |
| 2 × 2,000 | 4,000 | **10.4, 10.8** | 3.7, 4.0 |
| 3 × 2,000 | 6,000 | **16.0, 16.6** | 6.4, 6.2 |

Bold: over the 8-second limit, so refused in the app.

### Locally, and what grows

On the local test database (Postgres 16), 6 November, with 3,000 reviewed entries in the knowledge base (`F73_KB=3000`), sending was about 1.2 to 1.9 times faster than on staging at the same sizes (0.8 against 1.3 seconds at 1 × 500; 3.6 against 4.2 at 4 × 500; 8.7 against 16.3 at 3 × 2,000). Statement statistics (`pg_stat_statements`, counting the statements inside the functions) for one file of 3,000 questions, 4.7 seconds in all:

| Statement | Calls | Time |
|---|---|---|
| Recording what each question learned (`UPDATE rfi_questions ... learned_at`), including the trigger it fires | 3,000 | 2.4 s |
| of which the trigger's recount of the file (`UPDATE rfi_sessions SET accepted_count = (SELECT count(*) ...)`) | 3,000 | 1.6 s |
| The tags of the cited entries (`ref IN (subquery)`, a scan of the knowledge base) | 3,000 | 0.9 s |
| The new entry (`INSERT INTO kb_entries`) | 3,000 | 0.5 s |
| The duplicate lookup refinement suspected | 3,000 | 0.02 s |

The two candidate fixes, tried on the local test database only (`F73_PATCH=1` in [`scripts/spikes/f73-profile.ts`](../../scripts/spikes/f73-profile.ts)):

- the trigger recounts only the files whose number of approved questions the statement changed, found from its old and new rows counted separately (a first version that joined the old and new rows made bulk approval four times slower, so it was dropped), and still recounts exactly from the table;
- the tag lookup uses `ref = ANY (ARRAY(...))`, which uses the unique index.

| Files × questions | Send now (s) | Send with both fixes (s) | Bulk now (s) | Bulk with both fixes (s) |
|---|---|---|---|---|
| 1 × 500 | 0.8 | 0.4 | 0.2 | 0.2 |
| 4 × 500 | 3.6 | 1.7 | 0.7 | 0.7 |
| 2 × 2,000 | 5.7 | 3.5 | 1.4 | 1.4 |
| 3 × 2,000 | 8.7 | 5.5 | 2.3 | 2.3 |

With both, sending grows in a straight line, about 0.9 ms a question locally, and the QA review's own run reproduced it (0.42, 1.6, 3.4 and 5.3 seconds). Without the fixes, runs varied more: at 2 × 2,000, 5.7 seconds in the run above, 9.4 in an earlier one and 7.9 in the QA review's.

## What this does not show

- The fixes were not measured on staging, and were not run against the database tests. If staging is 1.2 to 1.9 times slower, as above, sending with both fixes would take about 1.1 to 1.7 ms a question there, so a response of roughly 4,500 to 7,000 questions would reach 8 seconds. That is an estimate from these figures, not a measurement, and the fix must be measured on staging before any limit is set.
- The synthetic questions each cite one entry and learn as new entries. Real answers that replace or propose replacements, or cite several entries, do a little more work each.
- Staging's knowledge base is small (134 entries). The tag lookup's cost grows with the knowledge base, so a larger one would be slower before the fix and unchanged after it.

## Recommendation, for Sprint 26

1. **Fix both causes** (a migration: the trigger and the tag lookup), with the database tests for the approved count when statuses change, move between files, or do not change, and measure again on staging with this spike's script.
2. **Then decide a limit from the measured figures:** refuse, at upload, a response whose questions would take more than about half the time limit to send, and say why, rather than letting **Mark as sent** fail after the work is done. Sending in steps would break the rule that a response is sent as a whole, all or nothing (Sprint 24, Q3), so it is not recommended.

To refine at the spike's close with Rory: the limit's size and where it is checked (on upload, per response), and whether bulk approval needs a limit of its own (at 6,000 questions it took 6.3 seconds on staging, close to the limit).

## How to run it again

- Locally: `DB_TEST_URL=postgres://... npx tsx scripts/spikes/f73-profile.ts 1x500,4x500,2x2000,3x2000` (add `F73_PATCH=1` for the fixes, `F73_KB=3000` for the knowledge base's size); [`scripts/spikes/f73-statements.ts`](../../scripts/spikes/f73-statements.ts) lists the statements by time, with `pg_stat_statements` preloaded and `pg_stat_statements.track = 'all'`.
- On staging: [`scripts/spikes/f73-hosted.sql`](../../scripts/spikes/f73-hosted.sql), run by the Deploy workflow of a throwaway branch named `sprint-*` (the staging environment's secrets are available only there). It loads, times and rolls back, and prints `left_behind=0`.
