# Sprint 23 refinement: Try it, the main path end to end, and a failing migration on staging

Refined 4 November 2026, as proposed at the Sprint 22 review: U-8 (**Try it** for demo visitors), F-66 (the main path as one browser test) and F-68 (a migration that fails, tried on staging).

## What refinement found

- **Visitors are members.** A hiring manager or prospective customer is invited as a member (spike job 10: "I have five minutes"). Members may already create responses they own and upload a file to them, so **Try it** can follow the ordinary path rather than add a copying mechanism: a response, a questionnaire, processing, review, download.
- **There is no sample questionnaire to give them.** `sample-data/sample-questions.csv` is a knowledge-base import (question, tags, source), not a customer's questionnaire, and the demo's responses come from `sample-data/demo-plan.json` through the seed. A visitor has no file of their own to upload.
- **Learning from a visitor's copy would reach everyone.** Marking a response as sent gives the knowledge base the approved answers that people edited or wrote. On a demo open to visitors, that is the poisoning risk (R-03): a visitor's own wording would become shared knowledge. Gaps (Sprint 21) would also count a try's unanswered questions.
- **Every signed-in person reads every response.** Several visitors' tries would all appear on everyone's Responses and Home.
- **A demo reset removes every response** (`reset_demo`, Sprint 15), so tries disappear at the next reset.
- **The main path has never run as one test.** Signing in, adding a response, uploading, reviewing, assigning, approving, downloading and marking as sent are each tested, in different files, on different demo responses. F-66 has been in the backlog since Sprint 20.
- **A failing migration has never been seen on staging.** The deploy's stop on failure has been seen for a refused token and a failed build (Sprint 20). Whether a migration that fails half-way leaves anything behind on the hosted database has not been tried.

## Stories

### S23-1 Try it with a sample questionnaire. L (U-8)

**The job.** A visitor with five minutes sees the product work on a questionnaire of their own: drafted with the real AI, the holds and their reasons, approving in bulk, and a download, without being able to change anything others rely on.

**Before and after.**
- Today: a visitor reads the demo's responses, which others have already worked on, and has nothing of their own to try.
- After (Q1 a): Home and Responses offer **Try it with a sample questionnaire**. It makes the visitor's own response, named for the sample and for them, loads a synthetic questionnaire of about twelve questions shipped with the app, and drafts it with the AI, as an upload does. The visitor works through it on the response page as an owner: **Needs a person** (a pricing question, a legal one, one the knowledge base cannot answer), **Ready to approve**, bulk approval, download, and **Mark as sent**, which records it and learns nothing (Q3).

**What changes.**
- A synthetic sample questionnaire in `sample-data/try-it-questionnaire.csv` (a fictional company), bundled by the build.
- `opportunities.trial`, set when the response is made by **Try it** and never changed afterwards (column grants). The database refuses to learn from a try when it is marked as sent, and `knowledge_gaps()` leaves tries out.
- **Try it** on Home and Responses; a try's header says it is a try and that nothing is learned from it; the lists show a person their own tries and none of anyone else's (Q2), and admins see them all.
- At most one open try per person (Q4): **Try it** opens your try if you have one, and **Start a new try** archives it first.
- Role-matrix tests for the column and the changed functions (decision 0003); the guide and the introduction.

**Test cases.**
1. A member chooses **Try it**: a response they own, named for the sample and for them, is made with the sample's questions, which are drafted (locally with the fallback; on staging with the real AI, Q5) (browser).
2. The try is grouped as any response is: the pricing question under **Needs a person** with its reason, the drafts the knowledge base answers under **Ready to approve**; bulk approval and download work (browser).
3. **Mark as sent** on a try records it, and nothing is learned: no entry is added or proposed, the confirmation says so, and the knowledge base is unchanged (database, browser).
4. A try's questions are never gaps (database).
5. Another member sees no one else's try on Responses or Home; an admin sees all, marked as tries (browser; database for the access rule left as it is).
6. **Try it** again opens your open try; **Start a new try** archives it and makes another (browser).
7. A member cannot turn an ordinary response into a try, or a try into an ordinary response, after it is made; nor make a try for someone else (database, every row of the role matrix).
8. A try is held to the daily limits and the monthly budget as any processing is; when a limit stops it, **Try it** says which (database for the limit, browser for the message).
9. At phone width **Try it** and the try's page fit (browser, phone).
10. The guide and the introduction describe **Try it** as it is; the glossary names it (CI).

**Out of scope.** Deleting tries (admins delete, as for any response; a demo reset removes them all); a try made from the visitor's own file (an ordinary upload already does that); signing up without an invitation.

**Boundaries.** R-03 and rule 7: a try never learns, enforced by the database, not only hidden on the screen. R-07: a try spends within the existing caps and budget, and the sample is small. Rule 1: the page says a try is a try and that nothing is learned from it; the sample questionnaire's company is fictional, and its questions are written for the demo. Synthetic data only.

### S23-2 The main path as one browser test. M (F-66)

**The job.** Each build proves that the whole job still works end to end, not only its parts.

**What changes.** One browser test, `e2e/sprint-23-main-path.spec.ts` (so it runs after the earlier sprints' tests), run in CI (Q5): an owner signs in, adds a response, uploads a questionnaire file (the same synthetic sample), maps its columns and drafts it; assigns a question to a colleague, who answers it; approves the rest (in bulk and one at a time); downloads the Excel file and checks it holds the approved answers; marks the response as sent; and sees the answer the colleague wrote learned in the knowledge base.

**Test cases.**
1. Every step above passes in one run, in order, on a response the test made (browser, locally).
2. The downloaded file holds every approved answer and nothing for questions left unanswered (browser, reading the file).
3. The colleague's answer is in the knowledge base after **Mark as sent**, with the response named as its source (browser).
4. The test fails, naming the step, if any step does not complete (by construction: each step waits for its own result; checked once by breaking a step on a branch, not merged).

**Out of scope.** The real AI (S23-1 is staging's real-AI step).

### S23-3 A migration that fails, tried on staging. S (F-68)

**The job.** We know what a deploy does when a migration fails on the hosted database, before it happens for real on the live demo.

**What changes.** A throwaway branch, `sprint-23-f68`, with one migration that creates a table and then fails (Q6). The Deploy run on it, and what staging holds afterwards, are recorded in `DEPLOYING.md`. The branch is deleted and never merged.

**Test cases.**
1. The Deploy run stops at the failing migration, names it, and runs no later step (no functions, no tests, staging's app not moved) (the run's log).
2. The table the migration created first is not on staging afterwards: the migration was all or nothing (a read-only query on staging).
3. The next ordinary staging run (the Sprint 23 branch) passes, with the migrations it expects (the run).
4. The failing migration never reaches `main` (the branch is deleted; `main`'s migrations unchanged).

**Boundaries.** Staging only; the live demo is never touched. The read-only query uses the Supabase connector in read-only use.

## The sprint as a whole

Order: S23-3 first (small, stands alone, and staging must be ordinary again before the others' staging runs), then S23-1, then S23-2, which reuses S23-1's sample questionnaire. About three days. No spike.

**Hand checks for Rory.** None planned. Reloading the live demo with the Sprint 22 Bluefin data stays his choice at the close.

## Questions for Rory

- **Q1 What a try holds.** (a) A synthetic sample questionnaire of about twelve questions shipped with the app, drafted with the real AI within the limits (recommended: the visitor sees drafting, holds and confidence happen; a few pence a try); (b) a copy of Bluefin with its stored drafts (no AI, instant, but nothing is seen being drafted).
- **Q2 Who sees a try in the lists.** (a) The visitor sees their own; admins see all, marked as tries; other members see none in Responses or Home, though the access rule is unchanged (every member may still open a response they are sent a link to) (recommended: clean lists without a new access rule); (b) everyone sees every try, as for any response; (c) a new access rule: only the visitor and admins may read a try (needs row-level security changes and their tests).
- **Q3 Marking a try as sent.** (a) Allowed: it records the try as sent and learns nothing from it, enforced by the database; its questions are never gaps (recommended: the visitor sees the whole journey, and the shared knowledge base is safe); (b) not offered for a try.
- **Q4 How many tries.** (a) One open try per person: **Try it** opens it, and **Start a new try** archives it first (recommended: bounds the spend and keeps the lists short); (b) any number, within the daily limits.
- **Q5 Where the real AI runs.** (a) Each staging run drafts one try with the real AI (about twelve questions, a few pence) as well as asking its one question (Sprints 21 and 22), so staging checks what a visitor sees; the main path runs locally only, with the providers off (recommended: this changes Sprint 20's one real-AI step a run to two, for a few pence more); (b) keep one real-AI step: tries are drafted with the fallback on staging, and the real drafting a visitor sees is checked only on the live demo, by hand.
- **Q6 How to try the failing migration.** (a) On a throwaway branch on staging: a migration that creates a table and then fails; the run must stop there and leave no table, and the branch is deleted (recommended: it is the hosted database we need to know about); (b) only in CI, against a local Postgres.

## Rory's answers (4 November 2026)

- **Q1:** (a). A synthetic sample questionnaire shipped with the app, drafted with the real AI within the limits.
- **Q2:** (a). The lists show a person their own tries, and admins all of them; the access rule is unchanged.
- **Q3:** (a). **Mark as sent** is offered on a try, records it and learns nothing, enforced by the database; a try's questions are never gaps.
- **Q4:** (a). One open try per person; **Start a new try** archives it first.
- **Q5:** (a). Each staging run drafts one try with the real AI as well as asking its one question: two real-AI steps a run, changing Sprint 20's one.
- **Q6:** (a). On a throwaway staging branch, deleted and never merged.

- **Q7 (4 November 2026, at the QA review):** the main path also runs on staging with the real AI. Locally there is no checker, so nothing is ready to approve in bulk and no answer can be learned (each is held as not fully checked); two of S23-2's agreed steps could only be shown on staging. A third real-AI step a staging run, about twelve questions. (When CI first failed on this, the case was rewritten to fit the code rather than brought to Rory; the QA review caught it, and the agreed case was put back.)

All three stories are Ready, Sprint 23.
