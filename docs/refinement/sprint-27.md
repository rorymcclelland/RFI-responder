# Sprint 27 refinement: recordings you can step through, the workflows off Node.js 20, and two import edge cases

Refined 9 November 2026, as proposed at the Sprint 26 review: F-78 (a list of steps beside each recording that jumps to that moment), F-80 (the GitHub Actions that still target Node.js 20) and F-62 (the knowledge-base import's whitespace and collision edge cases).

## What refinement found

- **Each caption is already a step in the results** (`caption()` in `e2e/support.ts` wraps it in `test.step`), and the demo page already lists a test's steps under its recordings in a folded **Steps** list. What it lacks is *when* each step happened in each recording. Playwright's report gives each step's clock time, but not the time its video started; a recording starts when its page is created, which the report does not record. So the tests themselves must note, for each caption, how far into that page's recording it appeared.
- **A test can record several sessions** (two people, or a phone and a desk), each its own video. A caption is drawn in one page, so its time belongs to that page's recording only.
- **The recordings play at ¼× by default** (Sprint 26). A video's time is the same whatever the playback speed, so a jump lands on the same moment at any speed.
- **Seven `uses:` lines are on old releases.** Read on 9 November from the actions' own repositories:

  | Action | We use | Runs on | Current release | Runs on |
  |---|---|---|---|---|
  | `actions/setup-node` | v4 (CI 3, deploy 2) | Node.js 20 | v7.1.0 (7 October 2026) | Node.js 24 |
  | `actions/upload-artifact` | v4 (CI 1) | Node.js 20 | v7.0.2 (7 October 2026) | Node.js 24 |
  | `supabase/setup-cli` | v1 (CI 2, deploy 2) | Node.js 20 | v3.2.0 (2 November 2026) | composite: `actions/setup-node` v7.1.0 and `oven-sh/setup-bun` v2.2.0, both pinned by commit |
  | `actions/checkout` | v5 | Node.js 24 | v7.0.1 | Node.js 24 |
  | `denoland/setup-deno` | v2 | Node.js 24 | v2.0.5 | Node.js 24 |

  Every one is referenced by a movable tag (`@v4`), not a commit: whoever controls the tag decides what runs, including in the production job that holds the deploy key and the database password.
- **The Supabase CLI cannot come from npm in the deploy jobs:** they install with `npm ci --ignore-scripts` (Sprint 26 security review), and the `supabase` package fetches its program in an install script. So `supabase/setup-cli` stays; the CLI version stays pinned at 2.121.0 (moving to CLI v3 is a separate change).
- **`setup-node` from v5 caches by default and warns** that workflows holding secrets should turn caching off. We set `cache: npm` explicitly, in the production job too. A run on `main` can only restore caches made on `main`, and `npm ci` checks every package against the lockfile's hashes, so the risk is small, but the production job gains nothing from a cache except about 20 seconds.
- **F-62, read again.** `import_kb_entries` cleans each question with `btrim()`, which removes spaces only. The entry's key (`question_key`, a generated column) folds every run of whitespace to one space after that, so a question starting with a tab gets a key starting with a space, and is not matched to the same question without the tab. The app trims cells first (`src/lib/spreadsheet.ts`), so only a direct database call can do this. And two imports at the same moment holding the same new question both pass the duplicate check, and the second fails on the unique index, rolling back its whole file with a database error.
- **Editing and learning clean text the same way** (`btrim` in `review_entry`, and in the learning step of `record_export`), so they share the tab problem; both already catch the unique index and say so.

## Stories

### S27-1 A list of steps beside each recording that jumps to that moment. M (F-78)

**The job.** On the review page, Rory can see what a recording is about to show and go straight to any step of it, rather than watching from the start at ¼× to find the moment he wants.

**Before and after.**
- Today: each test shows its recordings, and a folded **Steps** list of its captions with no link to the videos.
- After: under each recording, its own numbered steps, each with the time it appears (for example "0:12 Sarah Chen opens the response"); choosing one moves that video to just before the step and plays it at the chosen speed. Steps with no recorded time (results from before this change) keep today's plain list, and the page says the times are missing.

**What changes.**
- `e2e/support.ts`: `newSession` notes when each page in the session is created; `caption()` notes the caption's time in that page's recording (seconds from the page's creation), and the `recordings` fixture attaches each recording's steps beside its video, as a small JSON file (`steps: <label>`).
- `scripts/demo-page.ts`: reads each recording's steps, checks them (numbers within the video's length, at most 200, text at most 300 characters, anything else dropped), and lists them under the video as buttons; a small script moves the video and plays it. The Markdown summary lists the same steps with their times.
- `scripts/demo-page.test.ts`: the new list, the fallback, and hostile step files.
- The sprint-close skill already says not to show such a list until the times are recorded; it will need no change.

**Test cases.**
1. Each recording's steps are its captions, in order, with times that rise (unit: `demo-page.ts` from a sample results folder; browser: a test's attached steps match its captions).
2. Choosing a step moves its video to that moment (within a second) and plays it; the speed stays as chosen (browser check of the built page, local).
3. A step's time matches the recording: the frame at that time shows its caption (by hand, at the demo: three steps from three tests, checked with frames taken by ffmpeg; recorded in the case list).
4. In a test with two sessions, each recording lists only the captions drawn in its own page (unit and browser: a two-person test).
5. Results without step times (Sprint 26's) give today's plain list, and the page says the times are missing; nothing claims a time it does not have (unit).
6. A hostile step file (text with markup, a negative or huge time, thousands of steps, not JSON) is shown as plain text, clamped or dropped, and the page still builds (unit).
7. At phone width the lists do not make the page scroll sideways, and each step can be chosen with the keyboard (browser check of the built page).
8. The tests take no longer than before, apart from writing one small file per recording (CI: the run's time compared with Sprint 26's).

**Out of scope.** Changing the captions themselves; steps for checks that are not browser tests; a timeline drawn over the video.

**Boundaries.** Rule 1: a time is shown only when the test recorded it. The page's script only moves a video; the step text is escaped like everything else on the page. Synthetic data only, as before.

**Risks and unknowns.** How closely a page's creation time matches the first frame of its video is not documented; case 3 checks it. If it is out by more than a second, the jump goes half a second early (and that margin is the setting to change). Not a spike: the build tries it first, and the fallback is the list without jumps.

**Size.** M (about a day).

### S27-2 The workflows on current actions, each pinned to a commit. S (F-80)

**The job.** CI, staging and the production deploy run on actions their makers still support, with no Node.js 20 warning, and each action is fixed to the exact code that was checked, so nobody else can change what runs in the job that holds the deploy key.

**Before and after.**
- Today: three actions target Node.js 20, which GitHub forces onto Node.js 24 with a warning on every run, and every action is named by a tag that can be moved.
- After: every `uses:` names a full commit, with the release in a comment (`actions/setup-node@949feb2… # v7.1.0`); none targets Node.js 20; the production job does not use the npm cache (Q2); a test fails if any action is named by a tag or branch.

**What changes.**
- `.github/workflows/ci.yml` and `deploy.yml`: the seventeen `uses:` lines, each pinned to the commit of the release in the table above (Q1), checked against the action's repository at the build.
- The production job: `package-manager-cache: false` and no `cache: npm` (Q2).
- `scripts/deploy-order.test.ts`, or a new `scripts/workflows.test.ts`: every `uses:` in every workflow is a 40-character commit with a version comment; the production job uses no cache.
- `DEPLOYING.md`: how to move an action to a newer release (read its notes, take the release's commit, run CI and staging).

**Test cases.**
1. Every `uses:` in every workflow is pinned to a full commit with its release in a comment (CI: the new test, seen failing on today's workflows).
2. CI on the sprint branch runs green with no Node.js 20 warning (CI: the run's annotations, read at the build).
3. Staging deploys and its browser tests pass on the new actions (the staging run).
4. The production job runs with the new actions, the npm cache off, and its token still read-only (CI: the order test; by hand: the first production run after the merge).
5. The Supabase CLI is still 2.121.0 in every job (CI: the test reads the `version:` lines; the run logs show it).

**Out of scope.** Moving to Supabase CLI v3; automatic update pull requests (Dependabot); the Ubuntu 26 image change (already in use).

**Boundaries.** No secret or permission changes. The production job's new actions run only after Rory's approval, as now.

**Risks and unknowns.** `supabase/setup-cli` v3 now downloads Bun to install the CLI; if that fails on the runners, v2.1.2 (24 September, the same structure) is the fallback, and v1 the last resort. `setup-node` v7 removed a dummy npm token we do not use.

**Size.** S (half a day).

### S27-3 The import cleans every kind of whitespace, and two imports at once both finish. S (F-62)

**The job.** A question imported with a tab or a line break at either end is matched to the same question without it, and two imports at the same moment that share a new question both finish, the second counting it as a duplicate, instead of one failing with a database error.

**Before and after.**
- Today: only through a direct database call (the app trims cells), a question with a tab at one end is stored with it and is not matched to the same question without it; two simultaneous imports of the same new question make the second fail and roll back its whole file.
- After: whitespace of every kind is removed from both ends of an imported, edited or learned question and answer, so the key matches; the second import skips the shared question as a duplicate and keeps the rest of its file.

**What changes.**
- A migration: a function that removes whitespace of every kind from both ends of a text (`private.clean_text`, in the schema the API cannot reach), used by `import_kb_entries`, `review_entry` and the learning step of `record_export` in place of `btrim`; the import's insert skips a question that another import has just added (`ON CONFLICT ... DO NOTHING` on the unique index), counting it with the duplicates.
- Before it changes anything, the migration checks that no existing entry would change; on the live demo and staging there are none expected (synthetic data, all entered through the app), and it refuses with the count if there are (Q3).
- No change to the app.

**Test cases.**
1. A question imported with a tab, a line break or a carriage return at either end is stored without it, and matched as a duplicate of the same question already held (database; seen failing first).
2. The same for editing an entry and for an answer learned from a response (database).
3. Two imports at once, on two connections, sharing a new question: both finish; the question is held once; the second reports it as a duplicate; the rest of both files is imported (database; seen failing first).
4. Whitespace inside a question is unchanged, and Japanese text with a full-width space at either end behaves as today (database).
5. Imports by every role do what they did before (database: the knowledge-base and hardening suites, unchanged; decision 0003).
6. `clean_text` cannot be called through the API (database: the Sprint 15 check of callable functions).

**Out of scope.** Other import problems; cleaning other columns; a full-width space at either end (the app keeps it today; Q3 leaves it).

**Boundaries.** Hostile input: this closes a path open only to direct database calls. Decision 0003: no access change; the new function is not exposed. Migrations insert no rows.

**Risks and unknowns.** Replacing `import_kb_entries`, `review_entry` and `record_export` means copying their current versions from the database, as in Sprint 26, and changing only the cleaning.

**Size.** S (half a day).

## The sprint as a whole

Order: S27-2 first (small, and every later push runs on it), then S27-3, then S27-1, whose demo page is this sprint's own review. About two days.

**Hand checks for Rory.** None beyond the demo: S27-1's case 3 is checked by Claude from the recordings and recorded in the case list, and S27-2's case 4 is read from the production run you approve.

## Questions for Rory

- **Q1 Which releases.** (a) The current release of each action, pinned to its commit, as in the table (recommended: all support Node.js 24, and pinning means a later change to the tag cannot reach us); (b) the oldest release of each that runs on Node.js 24, to change as little as possible.
- **Q2 The npm cache in the production job.** (a) Off: the job that holds the deploy key and the database password builds from the lockfile alone, as `setup-node`'s makers advise, at a cost of about 20 seconds (recommended); (b) kept, as now.
- **Q3 Existing entries the cleaning would change.** (a) The migration refuses, saying how many, and nothing changes until we decide (recommended: none are expected, and if any exist the fix is to look at them, not to guess); (b) the migration cleans them, skipping any that would then clash with another entry.

## Rory's answers (9 November 2026)

- **Q1:** (a). The current release of each action, pinned to its commit.
- **Q2:** (a). No npm cache in the production job.
- **Q3:** (a). The migration refuses, saying how many entries the cleaning would change.

S27-1, S27-2 and S27-3 are Ready, Sprint 27.
