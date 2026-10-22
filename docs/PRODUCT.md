# RFI Respond: product brief

Agreed with Rory McClelland, 22 October 2026. This is the reference for every backlog decision; where a story and this brief disagree, the brief wins until it is changed here.

## The problem

Organisations that sell through formal procurement answer requests for information (RFIs) and requests for quotation (RFQs) again and again. Most questions have been answered before, but the answers sit in old documents and in people's heads. Each response is slow to assemble, the quality depends on who happens to work on it, and what one team learns is not reused by the next.

## The product

An internal tool for one organisation that turns its past answers into an **institutional knowledge base** and uses it to draft, route and assemble responses. Every response it helps produce makes the knowledge base more complete, so first drafts get better over time.

## Success

1. **Faster:** less time from receiving an RFI or RFQ to sending a complete response.
2. **Better:** more accurate, more consistent answers, with every answer traceable to its source.
3. **Compounding:** the share of questions answered well on the first draft rises as the knowledge base grows.

Candidate measures (made concrete in Sprint 1 and 2 evaluations): time to a complete first draft; share of drafts approved unedited; calibration (answers scored at 80% are right about 80% of the time); knowledge-base coverage of new questions; zero answers that state something their sources do not support.

## Users

| Role | Who | What they do |
|---|---|---|
| **Response owner** | Whoever is responsible for sending a given response (per response, not a global role) | Uploads the questions, sets the confidence threshold, bulk-approves above it, assigns the rest, checks readiness, exports and sends |
| **Contributor** | Subject experts across the organisation | Review and correct the drafts assigned to them, mark them ready, add knowledge |
| **Admin** | One or two people | Invite users, manage roles, hard-delete records created in error |

Anyone can be the owner of one response and a contributor on another.

## The workflow

1. **Ingest.** Questions arrive as a spreadsheet or Word document (first), later as PDF or text pasted from an email. They are extracted and normalised into one list.
2. **Draft.** Each question is answered from the knowledge base, with its sources cited.
3. **Score and gate.** Each draft gets a confidence score reflecting how well the knowledge base covers the question. The owner can approve everything above a chosen threshold in one action; that is a named human decision, recorded with the threshold and time.
4. **Never auto-approved:** pricing questions and legal or contractual commitments are detected and always go to a person, whatever their score. Pricing answers are also never learned automatically, because prices go stale.
5. **Route.** Questions below the threshold go to a recommended colleague, based on their stated expertise and the kinds of questions they have answered before. They review, correct and mark each one ready.
6. **Assemble.** The owner sees progress per question. Export is available once every question is ready.
7. **Learn.** On export, the final answers are added to the knowledge base with their provenance (which response, who, when). A refined answer supersedes its older near-duplicate rather than sitting beside it. Anyone can also add knowledge by hand at any time; it goes in immediately, tagged as manual.

## Overview of responses

Several responses are normally in flight at once. An overview shows every response with its owner, due date, progress (questions ready out of total) and stage, and flags those overdue or at risk. Completed responses are **archived, never deleted**, and kept as a record of what was sent, with the outcome (won or lost) recorded. Only an admin can permanently delete a response, and only one created in error; the deletion is logged.

## The knowledge base

The heart of the product. Every entry records who added it, from where (manual, import, or a named response), when, which entry it superseded, and when it was last reviewed. Because it learns automatically, it is also the main governance risk: it can learn mistakes, stale facts and contradictions, and it is the obvious target for deliberately bad answers. Provenance, versioning, review dates and the never-learn rule for pricing are the controls.

## Scope and non-goals

- **One organisation per deployment.** No multi-tenancy.
- **A portfolio demonstration built as if for a real organisation.** Synthetic data only; no real company's questionnaires, policies or customers.
- **Not a CRM.** Outcome (won or lost) is recorded for the record and later as a learning signal, but pipeline management stays elsewhere.
- **The tool never sends anything to a customer.** The owner exports and sends.

## Decisions log

| Date | Decision |
|---|---|
| 22 Oct 2026 | Internal tool for one organisation; RFIs and RFQs; success is faster and better responses |
| 22 Oct 2026 | Invite-only access; any member can add to the knowledge base; deletion of KB entries admin-only |
| 22 Oct 2026 | Pricing and legal or contractual questions never auto-approved; pricing never auto-learned |
| 22 Oct 2026 | Learning happens at export; manual additions immediate and tagged |
| 22 Oct 2026 | Spreadsheet and Word ingestion first; PDF and pasted text later |
| 22 Oct 2026 | Overview of in-flight responses with due dates; archive, never delete (admin hard delete for errors only); outcome recorded |
