# Sprint 19 refinement: questions for you, and Home

Refined 29 October 2026: the third slice of option B from the Sprint 16 UX spike (`docs/ux/sprint-16-ux-spike.md`). It holds U-3 ("Questions for you": a contributor answers, approves or hands back an assigned question on one screen) and U-4 (Home, with "Needs you" and "What we know", where everyone lands). U-10 goes with it. The order of slices is the one set in the spike report. The mockups are the Question and Main boards in the design "RFI Respond: jobs-first mockups".

## What refinement found

- **A contributor cannot answer from their inbox today.** An assignment (`question_assignments`) has its own stages (Asked, Working on it, Answered, Approved, Closed) and its own copy of the question and answer, taken when it was assigned. The question is decided in the response's workspace, which the inbox does not link to. **Mark as approved** changes the assignment, not the question.
- **The rules already allow the contributor to decide.** `access.can_decide_question` lets an assignee approve, edit or leave unanswered the question they were assigned, exactly as the owner can, and the database enforces it. So "Questions for you" needs no new write access: it puts the existing actions on one screen.
- **What the contributor needs to see is readable, but not in one query.** The live question (its draft, confidence, checker, sources and holds) is in `rfi_questions`, which every member can read. The assignment is readable by its assignee, its assigner and the response's owner. `question_assignments.question_id` is text, not a foreign key, so the two cannot be joined through the API. One invoker function can return "my assignments, with their questions as they are now", under the caller's own rights.
- **The owner never sees a colleague's answer where they decide.** `answer_text` is shown only in the inbox. The owner's question card shows the assignee's notes in a banner, but not their answer, and there is no "use their answer".
- **Nobody lands on what needs them.** Everyone lands on **Responses**. What needs a person is spread over Responses (at risk, overdue), Assignments (asked, answered) and Knowledge or Governance (entries waiting for review). All of it is readable today; Home composes it.
- **Opening a response at a question is missing.** The workspace opens its most recent file; a question in an earlier file has to be found by hand. Home and "Questions for you" both need to open a response at one question. This is a small, separate piece (S19-2).
- **Two ideas from the spike need a decision** (Q3 and Q4): whether a contributor's answer goes into the knowledge base straight away, and whether members may suggest changes to an answer (put off at Sprint 18, Q3).

## Stories

### S19-1 Questions for you. M (U-3)

**The job.** A colleague asked to answer or check a question does it on one screen and gets back to their work. Done when the owner has what they needed.

**Before and after.**
- Today: the inbox, then the response, then the right file, then the question. About 13 steps on three screens, and **Mark as approved** that does not approve.
- After: **Assignments** opens "Questions for you": each question assigned to you, as it is now, with the response's name, due date and owner, the draft, its confidence, the checker's verdict and the answers it drew on (each opening its page under Knowledge). Under it, an answer box filled with the current draft. The question can also be opened in the response itself (S19-2).

**What changes.**
- **Data:** an invoker function, `public.my_assignments()`, returns the caller's open assignments in two groups:
  - **to me:** where I am the assignee;
  - **from me:** where I assigned it or own the response; used by Home (S19-3).

  Each row has the assignment (stage, notes, the answer sent, who and when) and its live question (text, draft, final answer, status, confidence, verdict and reason, gate and reason, cited and matched entries, language), with the response's name, due date and owner. Closed assignments, and those on archived responses, are left out.
- **What the contributor can do** (Q1, Q2). Every action is the existing rule and the existing write:
  - **Approve**: approves the question with the text in the box (as **Approve** or **Save & approve** on the question card do), and moves the assignment to Approved.
  - **Send to the owner**: saves the text in the box as the assignment's answer and moves it to Answered; the question stays to do, for the owner.
  - **Hand back**: asks for a note ("I am not the right person", "ask the legal team"), saves it and moves the assignment to Answered with no answer, so the owner sees it was handed back.
  - **Notes** stay as today.
- **For the owner** (on the question card, in the workspace): an assignment with an answer shows "<Name> answered:" and the answer, with **Use their answer**, which puts it in the edit box to approve. A handed-back one shows "<Name> handed this back:" and the note.
- **The inbox's old controls** (**Start working on it**, **Mark as answered**, **Mark as approved**) go. Opening a question moves its assignment from Asked to Working on it. **Sent** and, for admins, **All** stay, as lists.

**Test cases.**
1. **Data:**
   - `my_assignments()` returns my assignments with each question as it is now. After the owner edits the draft, the next read shows the new text, not the copy taken at assignment.
   - It leaves out closed assignments and those on archived responses.
2. **Role matrix (database):**
   - The assignee sees theirs under "to me"; the assigner and the response's owner see it under "from me".
   - Another member sees neither; an anonymous visitor and the service role get nothing.
   - No row shows a question from a response the caller cannot read.
3. **Approve** as the assignee approves the question (status, final answer, approval recorded as an individual approval by the assignee) and moves the assignment to Approved; the question then shows as approved in the response.
4. **Send to the owner** leaves the question to do, saves the answer on the assignment and moves it to Answered. The owner's card shows "<Name> answered:" with **Use their answer**; using it and approving records the owner as approver.
5. **Hand back** without a note is refused (5 to 500 characters, as for retiring); with one, the assignment is Answered with no answer, and the owner sees the note.
6. A question the owner has already decided shows as decided, with no answer box; an assignment closed by an export no longer appears.
7. A pricing question shows "A person must answer pricing questions" and an empty box: the contributor writes the answer, and approving it works as on the card.
8. **Hostile:** answer and note text with markup are shown as text. An answer over 20,000 characters is refused, as on the card.
9. Unit tests on the pure functions that word each state and choose the actions shown.

**Out of scope.**
- Notifications by email.
- Assigning from this screen; the owner still assigns from the question card.
- A contributor's answer going to the knowledge base before export (Q3).

**Boundaries.**
- Decision 0003: no new write access. The function reads under the caller's rights and gets a test for every row of the role matrix.
- Rule 1: "Approve" says it approves the question for the owner, and the guide says so.

**Size.** M (about a day and a half).

### S19-2 Open a response at a question. S

**The job.** From anywhere (Home, "Questions for you", an answer's page), open the response at that question, in whichever file it is in.

**What changes.**
- The workspace can be opened with a question: it loads that question's file, not the most recent one, scrolls to the question and opens its card.
- App state carries the request, as Sprint 18's opening of an answer's page does, and clears it once used.

**Test cases.**
1. A question in an earlier file opens in that file, scrolled to and expanded.
2. A question that no longer exists (its file deleted) opens the response as usual and says it could not be found.
3. Opening a response normally afterwards opens its most recent file, as now (the request does not stick).

**Size.** S.

### S19-3 Home. M (U-4)

**The job.** Everyone lands on what needs them today, across responses, assignments and the knowledge base, without knowing which page holds it.

**What changes.**
- **Home** is the first item in the menu and the page everyone lands on after signing in (Q5). It has three parts.
- **Needs you**, each item a sentence with one way in:
  - **Questions for you:** assigned to you and not yet answered, by due date. Opens the question (S19-1).
  - **Answered by colleagues:** on your responses (or ones you assigned), answered or handed back and not yet decided. Opens the question in the response (S19-2).
  - **Your responses at risk or overdue:** with the reason. Opens the response.
  - **For admins:** answers waiting for review, translations to check, proposed changes and overdue answers, as one line with counts. Opens Knowledge with that filter.
  - **When nothing needs you:** it says so.
- **Your responses:** the ones you own that are in progress, with stage and due date.
- **What we know:** the knowledge overview's headline (answers, languages, reviewed and waiting) and **Ask it a question**, leading to Knowledge.
- **Data:** `my_assignments()` (S19-1), the responses overview the Responses page already reads, and `knowledge_overview()`. A pure function, `needsYou(...)`, builds and orders the list and is unit tested.

**Test cases.**
1. **Ordering (unit, `needsYou`):** questions for you by due date, then answers from colleagues, then responses at risk or overdue, then the admin line. An admin sees the admin line; a member never does.
2. A question decided since it was assigned, or an assignment closed, is not listed.
3. "Nothing needs you" when every list is empty.
4. **Hosted demo data:** James sees the Bluefin question Priya assigned him, under questions for you. Priya sees nothing answered yet. An admin sees the 30 translations to check (on the hosted demo, you).
5. Every link opens the right place: the question, the response at the question, or Knowledge with the filter.
6. At phone width the parts stack and nothing scrolls sideways (in the test pack).

**Out of scope.**
- Notifications.
- A combined activity feed.
- Changing **Responses**, which stays as it is.

**Size.** M.

### S19-4 Guide, introduction and screenshots for these screens. S (U-10)

- The specialists' guide is rewritten around "Questions for you". Getting started gains Home.
- The introduction's overview step becomes Home.
- The screenshot script photographs Home and "Questions for you", and retakes the answer's page (Sprint 18's scroll fix). Rory retakes the screenshots at the close.

## The sprint as a whole

**Order:**
1. S19-1's function first, then S19-2, since both screens open questions.
2. The rest of S19-1, then S19-3.
3. S19-4.
4. The independent security review, the live update (one migration; no Edge Function changes), the test pack and the close.

**Sizes:** one M and a half, one S, one M, one S: about three and a half days.

**No spike:** nothing depends on an unknown.

## Questions for Rory (answered 29 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | May a contributor approve the question themselves, or only send their answer to the owner? | **Both, as the rules already allow.** **Approve** decides it, as they can today on the question card; **Send to the owner** leaves the decision to the owner. The owner sees which happened **Rory: agreed** |
| Q2 | How does a contributor say "not me"? | **Hand back, with a required note**, using the existing Answered stage with no answer; no new stage, so nothing in the data changes **Rory: agreed** |
| Q3 | Should a contributor's answer go into the knowledge base straight away (the spike's idea)? | **Not yet.** Learning stays at **Record export**, after the owner's decision, with its checks; revisit with U-6 (Sprint 20), which makes sending explicit **Rory: agreed** |
| Q4 | Member suggestions to an answer (put off at Sprint 18, Q3)? | **Still later**, beside K-4's gaps (Sprint 20): a suggestion is a new kind of proposal, and it fits there **Rory: agreed** |
| Q5 | Home as everyone's landing page? | **Yes**, first in the menu; **Responses** stays as it is, one click away **Rory: agreed** |
| Q6 | Screenshots | **You retake them at the close**, as in Sprints 17 and 18 **Rory: agreed** |

## Security review (29 October 2026)

An independent review of `main..sprint-19` found no high issue, three medium and six low; all are fixed. It confirmed that `my_assignments()` reads only what the caller may read, refuses anonymous visitors and the service role, and names every type with its schema, and that the contributor's actions rely only on rules the database enforces.

| | Finding | Fix |
|---|---|---|
| M1 | Approving from a screen opened before the owner decided reopened the question and overwrote the owner's decision | Both writes apply only while the question is still to do; otherwise nothing changes and the contributor is told. Tested in the database and in unit tests |
| M2 | Contributors could no longer add notes, the panel called shared notes "Your notes", and handing back replaced the owner's note | **Add Notes** and **Edit Notes** on the question; the notes are shared with the owner; the hand-back reason is added to them, never replacing them; the guide says so |
| M3 | The role test could not tell the assigner from the owner | A fixture where an admin assigns on someone else's response: both see it under "from me", another member does not |
| L1 | "<Name> answered:" could show the copy taken when the question was assigned (assignments marked answered before this sprint) | The card says "<Name> marked it answered, with this answer:", which is true of either |
| L2 | The limits on an assignment's answer and notes were only on the screen | The database refuses an answer over 20,000 characters and notes over 2,000 (new and changed rows); the 5-character minimum for a hand-back stays on the screen, as the guide implies |
| L3 | `my_assignments()` scanned every assignment an admin can read | It filters to the caller's own rows first; 5,000 others' assignments are tested |
| L4 | A focus not used before leaving the response stuck, and one notice named the wrong file | A focus is dropped when its response is left; the two cases each have their own wording |
| L5 | A bulk-approved question showed "Left unanswered." under Decided | It shows the approved answer, or "Left unanswered." only when it was |
| L6 | The admin line opened Governance, not Knowledge; an empty hand-back note read oddly; an approved assignment reopened since was labelled "Asked" | The admin line opens Knowledge filtered to what waits for review; "no note"; "You approved it, but it has been reopened since" |
