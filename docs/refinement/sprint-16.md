# Sprint 16 refinement: the last rough edges, and a UX spike

Refined 28 October 2026, after Rory asked for a sprint to "wrap those remaining bugs up", with the independent review, and "a spike on a rethink of the UX": the screens today mirror the data model (responses, sessions, questions, assignments, entries) rather than the jobs people come to do, so a user needs to understand how the entities relate before they can start.

## What refinement found

- **BUG-40 is mostly the re-index after a reset, not the save.** The live logs for Rory's entry (28 October, 20:49) show the save itself was quick; the form then waited for `embed-entries`, which ran for 11.3 seconds and wrote 128 vectors one request at a time. The SQL reset at 20:39 had reloaded the entries without vectors, so adding one entry indexed the whole knowledge base. Two fixes follow: the form confirms the save at once and indexes afterwards, and `embed-entries` saves each batch's vectors in one database call instead of one per entry.
- **BUG-39 has a second gap.** The response screen starts on the upload step and switches to the questions only after the sessions load, so for a moment it looks empty. The same load also ignores a failed read, which would leave the upload screen showing for a response that has questions.
- **BUG-38 is the modal centring itself.** The knowledge-base modal sits in a box centred on the screen whose height follows its content, so each keystroke that narrows the list shrinks the box and moves the search box. Fixing the box's top and height stops the movement.
- **The spike's starting evidence is in the repository.** `docs/JOB_STORIES.md` was written for the prototype and is organised by screen (Opportunities, Knowledge Base, Session upload, Review, Assignments inbox, Export), which is the pattern Rory describes. `docs/PRODUCT.md` has the real roles (response owner, contributor, admin) and a seven-step workflow (ingest, draft, score and gate, route, assemble, learn), which is closer to jobs.
- **A spike never shares a sprint with what depends on it** (Rory, 16 October). The spike ends in a recommendation and outline stories; any redesign is refined and built from Sprint 17 at the earliest.

## Stories

### S16-1 A response shows that it is loading. S (BUG-39)

**The job.** Someone opening a response with questions never sees a screen that suggests it has none.

**What changes.** `src/RFIWorkspace.tsx` starts in a `loading` step, showing "Loading the questions…" (and the response's name), until its sessions and questions are read; a failed read shows a plain error with **Try again**, never the upload step. The upload step appears only for a response with no sessions.

**Test cases.**
1. A response with sessions shows the loading state, then its questions; the upload step never appears in between.
2. A response with no sessions goes from loading to the upload step.
3. A failed read of sessions or of questions shows the error and **Try again**, which retries; the upload step is not shown.
4. Leaving the response while it loads does not show the old response's questions on the next one (results for a response no longer open are ignored).

### S16-2 Adding an entry is confirmed at once. S (BUG-40)

**The job.** Adding a knowledge-base entry takes about as long as saving it; indexing happens afterwards.

**What changes.**
- `AddEntryForm` (`src/App.tsx`): after the save, the form closes with "KB-0133 added." straight away, and indexing runs in the background; if it fails, a second message says the entry is not yet indexed, as today.
- `embed-entries` (`_shared/entry-store.ts`): each batch's vectors are saved with one database call (a service-role function taking the batch), instead of one request per entry.

**Test cases.**
1. The confirmation appears before indexing finishes (the indexing call is still pending when it shows).
2. An indexing failure afterwards shows the "not yet indexed" message; the entry stays saved.
3. A batch of 64 vectors is saved in one call; a vector for an entry that no longer exists, or of the wrong length, is refused and saves nothing from that batch.
4. Only the service role may call the batch function (role matrix).
5. Measured on the live demo after a reset: indexing all 132 entries takes at most a third of the 11.3 seconds measured (the figure goes into the review either way, rule 1).

### S16-3 The knowledge-base modal stays still while you search. S (BUG-38)

**The job.** Typing a search narrows the list without moving the box or the search field.

**What changes.** The modal is anchored near the top of the screen with a fixed height (the list scrolls inside it), so it does not move as the list shrinks or grows.

**Test cases.**
1. The search field is in the same place (to the pixel) with every entry shown, with three, and with none ("No entries match your search").
2. On a phone-width screen the modal fills the screen and the list scrolls inside it.
3. Opening an entry's answer, or the add-entry form, does not move the search field.

### S16-4 Spike: designing around jobs, not entities. Time-boxed to two days (Rory, Q3)

**The question.** How should RFI Respond be organised so each kind of user starts from their problem ("a questionnaire has arrived", "I have been asked to answer something", "is our knowledge base healthy?") and is led through it, without needing to know how responses, sessions, questions, assignments and entries relate? Is a reshuffle of the current screens enough, or does it need a different structure?

**What the spike does.**
1. **Jobs, per role.** Rewrite the job stories as jobs to be done for the response owner, the contributor (subject expert), the admin, and a first-time reviewer of the hosted demo, with what success looks like for each.
2. **Walk each job through the live demo**, as that role, recording every step, every screen, and every concept the user must understand to get through (for example "a response has sessions"), with screenshots. An independent agent does the same walk without seeing this analysis, so the findings are not just the builder's view of its own work.
3. **Where the model leaks into the interface**: the places where the user has to think in entities rather than in their task.
4. **Options**, from the least to the most change: tidy the current screens; reorganise navigation around jobs (a home that asks what you want to do, one task list per person); or restructure around one response's journey with the entities hidden. Each with what it would take, what it risks, and which job stories it serves.
5. **A recommendation**, with mockups of the main flows and outline stories for Sprint 17 onwards (not refined: they are refined at the spike's close).

**Out of scope.** Building any of it. Changes to the database or to who may do what.

**Done when** the report and mockups are delivered, Rory has chosen an option (or chosen none), and the stories that follow are in the backlog.

### S16-5 Independent review and the hosted check. S

The usual independent security and correctness review of the build stories, then the test pack for Rory on the hosted demo (S16-1 to S16-3), with the live app and project updated first.

## The sprint as a whole

Order: S16-1 to S16-3 (independent, small), the review, then the spike, so its walk-through sees the fixed app; the hosted check can run while the spike is written. Sizes: three S, one S review and check, one spike of two days: about three days. No API keys are needed beyond the demo's own (the re-index measurement uses a few pence of Voyage).

## Questions for Rory (answered 28 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | What the spike delivers | A written report, plus mockups of the main flows you can click through, as a design you can look at and comment on **Rory: agreed** |
| Q2 | Whose jobs it covers | The response owner, the contributor, the admin and a first-time reviewer of the demo **Rory: agreed** |
| Q3 | How long the spike runs | One day, time-boxed; what is unfinished is listed, not stretched **Rory: two days** |
| Q4 | Slow saving (BUG-40) | Confirm the save at once and save vectors in batches **Rory: agreed** |

## Security review (28 October 2026)

An independent review of `main..sprint-16` found no high issue, three medium and seven low; all are fixed, with a test where code changed.

| | Finding | Fix |
|---|---|---|
| M1 | A toast's timer could clear the next one: an indexing failure shown after "KB-0133 added." vanished within moments | Each toast clears the previous timer and gets its full time |
| M2 | With the save no longer waiting, two quick additions (or one during the sign-in run) started two indexing runs over the same entries, paying twice and possibly reporting a false failure | Calls in the app share the run in progress; tested. Two different people indexing at the same moment can still overlap, as before |
| M3 | Opening a past session by hand did not take the newest place in the load sequence, so a slower earlier open could win | A hand-opened session is always the newest load |
| L4 | A missing or null vector, or a missing or non-text model name, was accepted and could wipe a good vector | The batch is refused unless every element has an id, a vector array and a model name; tested |
| L5 | One entry deleted between reading and saving refused the whole batch, already paid for | A deleted entry is skipped; a malformed or repeated one still refuses the batch |
| L6 | After Try again succeeded, the earlier read error still showed | Cleared on success, and not set on the automatic path |
| L7 | The loading and error states could go unannounced, focus fell to the page after Try again, and the pulse ignored reduced motion | One live region stays mounted, focus moves to the message, the pulse is `motion-safe` |
| L8 | The batch tests' refusals were checked inside a rolled-back savepoint, and the role test accepted any error | Refusals are checked after a call that would have committed; the role test expects a permission error. S16-1's screen behaviour is checked by hand in the test pack, since nothing renders the workspace in tests |
| L9 | The docs said one update per entry took 11.3 seconds; that was the whole run, Voyage included, and batches are 64 | Reworded |
| L10 | A doc comment had moved onto the wrong declaration | Moved |

