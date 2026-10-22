# RFI Respond — Job Stories

Job stories follow the format: **When** [situation], **I want to** [motivation], **so I can** [outcome].

---

## 1. Authentication

**1.1** When I arrive at the app for the first time, I want to register an account with my name, email, and password, so I can access my team's shared workspace.

**1.2** When I return to the app, I want to sign in with my email and password, so I can pick up where I left off without re-entering my details each session.

**1.3** When I forget my password, I want to request a reset link via email, so I can regain access without contacting an administrator.

**1.4** When I am done working, I want to sign out with a single click, so I can leave a shared machine without exposing my account.

---

## 2. Opportunities

**2.1** When a new RFI or security questionnaire arrives from a prospect, I want to create an Opportunity with a name and initial status, so I can organise all related sessions and progress in one place.

**2.2** When I look at the Opportunities dashboard, I want to see a count of New, In Progress, Won, and Lost opportunities at a glance, so I can quickly assess the overall pipeline health.

**2.3** When I want to focus on a specific stage of the pipeline, I want to click a status tile to filter the list to only those opportunities, so I do not have to scroll past irrelevant items.

**2.4** When a deal changes stage, I want to update an opportunity's status via a dropdown on the card, so the pipeline reflects reality without leaving the dashboard.

**2.5** When a client name changes or I made a typo, I want to rename an opportunity inline by clicking the pencil icon, so I can correct it without a separate settings page.

**2.6** When I need to find a specific opportunity among many, I want to search by name and filter by status, so I can navigate to the right workspace in seconds.

**2.7** When a deal is lost or an opportunity was created in error, I want to delete it from the dashboard with a two-step confirmation, so I avoid accidental data loss while keeping the list clean.

**2.8** When I open an opportunity card, I want to see which team members have contributed to it via their avatar stack, so I know who is already involved before I assign more work.

**2.9** When I open an existing opportunity that already has sessions, I want to be taken straight into that session's review or export state, so I do not have to re-upload files I have already processed.

---

## 3. Knowledge Base

**3.1** When I am setting up the tool for the first time, I want to bulk-import existing Q&A pairs from a CSV or spreadsheet, so I do not have to enter hundreds of entries manually.

**3.2** *(Wording looks ahead to Sprint 2; until then drafts are assembled from matching entries, not generated.)* When I want to verify what the AI is drawing on, I want to open the Knowledge Base modal and browse or search all entries, so I can confirm coverage before running a new session.

**3.3** When I finish reviewing an RFI, I want to add accepted answers back into the Knowledge Base in one click, so future RFIs on similar topics benefit from the work already done.

**3.4** When I import Q&A pairs, I want to see them tagged by source (e.g. "RFI: filename"), so I can trace where each piece of knowledge came from.

---

## 4. RFI Session — Upload

**4.1** When I receive a spreadsheet of RFI questions from a prospect, I want to drag and drop the file onto the workspace, so I can start processing without navigating a complex file dialog.

**4.2** When I upload a file, I want the system to parse and preview row counts and column names, so I can confirm the file was read correctly before committing to a run.

**4.3** When my spreadsheet has non-obvious column names, I want to pick which column contains the questions from a list of detected headers, so the AI matches the right text rather than an ID or category field.

**4.4** When a previous session exists for this opportunity, I want to see it in a list below the upload zone, so I can resume it rather than starting a duplicate run.

---

## 5. RFI Session — Processing

**5.1** When I trigger a KB lookup run, I want to see a progress bar and per-question status message, so I know the system is working and roughly how long it will take.

**5.2** When processing completes, I want the workspace to advance automatically to the review step, so I am not left staring at a blank screen waiting to click.

---

## 6. RFI Session — Review

**6.1** When I reach the review step, I want to see all questions sorted from lowest to highest AI confidence, so the items most in need of my attention are at the top.

**6.2** When I review a question, I want to see the AI-generated draft answer, the confidence percentage, and the KB sources it drew from, so I can judge whether the answer needs editing or can be accepted as-is.

**6.3** When an AI draft is accurate enough, I want to accept it with a single click, so I can move through high-confidence responses quickly.

**6.4** When an AI draft needs adjusting, I want to edit the answer text inline before accepting, so the final exported response reflects my expertise rather than a raw AI suggestion.

**6.5** When a question falls outside the scope of our KB, I want to skip it without accepting, so I can focus on what remains and flag it for manual follow-up.

**6.6** When I skip a question in error, I want to undo the skip and return it to pending, so I do not lose work.

**6.7** When I want to quickly approve a batch of responses I trust, I want to bulk-accept all questions above a confidence threshold (≥80%, ≥60%, or all pending), so I do not have to click through each individually.

**6.8** When I want to focus on questions that need my attention, I want to filter the list by status (pending / accepted / skipped) and by confidence band (high / medium / low), so I can work through them in a prioritised order.

**6.9** When I need to find a specific question, I want to search by question text or answer content, so I can locate it without scrolling through the full list.

**6.10** When many questions have low AI confidence, I want to see a summary alert telling me how many need careful editing, so I do not accidentally accept poor answers.

**6.11** When all pending questions have been actioned, I want to click "Review Complete" to lock in the results and move to the export step, so the session is formally closed and the status is updated in the database.

---

## 7. RFI Session — Expert Assignment

**7.1** When a question requires specialist knowledge I do not have, I want to assign it to a specific team member from a user picker, so the right expert provides or approves the answer.

**7.2** When recommending an expert, I want to see each person's expertise tags and job title alongside their name, so I can choose the most relevant person rather than guessing.

**7.3** When I want to assign a question to multiple reviewers, I want to add more than one assignee to the same question, so it can receive input from several specialists.

**7.4** When an assignment was made in error, I want to remove an assignee from a question, so the wrong person does not receive a misleading workload.

**7.5** When team members have submitted answers or notes on assigned questions, I want to see a "Ready for review" banner at the top of the session, so I know expert input is waiting for my approval.

**7.6** When I click an item in the "Ready for review" banner, I want the page to scroll to the relevant question and expand it, so I can review the expert's input in context.

---

## 8. Assignments Inbox

**8.1** When a question is assigned to me, I want it to appear in my Assignments inbox, so I have a central place to see all the work waiting for me across all opportunities.

**8.2** When I open an assignment, I want to see the question text, the AI-proposed answer, and any existing notes, so I have full context before writing my response.

**8.3** When I start work on an assignment, I want to advance its status from Pending → In Review → Answered, so my manager can see my progress without chasing me.

**8.4** When I have finished an assignment and an admin approves it, I want the status to update to Approved across all copies of that assignment, so the whole team knows the question is resolved.

**8.5** When I want to leave a comment or caveat alongside my answer, I want to add free-text notes to an assignment, so the reviewer understands my reasoning or any caveats.

**8.6** When I submitted notes previously, I want to edit them later, so I can refine my thinking as the review conversation evolves.

**8.7** When I manage a team, I want to see a "Sent" tab of all assignments I created, so I can track whether experts have actioned the work I routed to them.

**8.8** When I am an administrator, I want an "All" tab that shows every assignment across the team, so I can monitor workload distribution and spot bottlenecks.

**8.9** When I want to focus on a particular stage, I want to filter my inbox by assignment status (Pending, In Review, Answered, Approved), so I can clear completed work from view.

**8.10** When I arrive at the Assignments page, I want to see a count of how many items are pending and in review for me, so I can immediately gauge my backlog.

---

## 9. Export

**9.1** When a session is complete, I want to download the accepted answers as an Excel file, so I can send a formatted response to the prospect.

**9.2** When a prospect requires a specific file format, I want the option to export as CSV or as a Word (.doc) file, so I can match their submission requirements without manual reformatting.

**9.3** When I have exported results, I want to add the accepted answers to the Knowledge Base in one click, so future RFIs benefit from the work done in this session.

**9.4** When I want to review individual answers after export, I want to collapse and expand the question list, so I can refer to specific responses without scrolling through all of them.

**9.5** When I finish one RFI, I want a clear "Start New RFI" action within the same opportunity, so I can upload a revised or supplementary questionnaire without navigating away.

---

## 10. Team Management

**10.1** When I join the team, I want to set my job title, department, and expertise tags, so colleagues know what questions to route to me.

**10.2** When I want to find someone with a specific skill, I want to filter the Team list by specialism tag or department, so I can identify the right reviewer without emailing around.

**10.3** When I need to update my profile, I want to edit my name, title, department, and tags from a slide-in drawer, so the change does not require an admin and takes effect immediately.

**10.4** When I am an admin and need to grant or revoke admin rights, I want a toggle on each user's edit drawer, so I can manage access without touching the database directly.

**10.5** When I manage a team, I want to see every member's expertise tags colour-coded by category (compliance, encryption, identity, etc.), so I can quickly scan the team's capability coverage.

**10.6** When adding expertise tags, I want autocomplete suggestions drawn from a standard security taxonomy, so tags remain consistent across the team and are useful for matching.

---

## 11. Navigation & Global

**11.1** When I am working inside an opportunity, I want a breadcrumb in the header showing my path back to Opportunities, so I can navigate without relying on the browser back button.

**11.2** When I add KB entries or take an important action, I want a brief toast notification to confirm success, so I have confidence the action was saved.

**11.3** When I want to check the Knowledge Base while reviewing an RFI, I want to open it from the header without leaving the workspace, so I can cross-reference without losing my place.

**11.4** When I am on a small screen, I want a hamburger menu to collapse the navigation, so the interface remains usable on mobile or tablet devices.
