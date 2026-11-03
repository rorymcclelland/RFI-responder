# Glossary

The words RFI Respond uses on screen, in the guide and in the introduction, one for each thing (Sprint 17, S17-1). The database, the code and the technical docs keep their own names (`opportunities`, `rfi_sessions`, `status = 'accepted'`); this page is about what people read. `docs/glossary.test.ts` fails if a retired word appears in the app's visible text, the guide or the introduction.

| Say | Meaning | Not |
|---|---|---|
| **response** | One customer questionnaire and everything done to answer it: its questions, files, decisions and export. Shown under **Responses** | opportunity, workspace, RFI (as a name for it) |
| **file** | A spreadsheet or Word document whose questions were added to a response. A response can have several | session, RFI session, upload (as a noun) |
| **question** | One question from the customer, with its draft and decision | |
| **knowledge base**, **Knowledge** | The organisation's approved answers that drafts are written from; **Knowledge** in the menu | KB (entry numbers keep their `KB-` prefix) |
| **entry** | One answer in the knowledge base, with its number (`KB-0042`) | |
| **draft** | The answer the app proposes for a question, from knowledge-base entries | |
| **approve**, **approved** | A person's decision that an answer is right to send | accept, accepted |
| **to do** | A question not yet decided | pending |
| **not answered**, **leave unanswered** | A question decided not to answer; exported as "Not answered" | skip, skipped |
| **owner** | The person responsible for a response | |
| **colleague**, **asked** | Someone the owner asked to answer or check a question, through an assignment | |
| **needs a person** | A question still to do that bulk approval never takes, with the one reason why (Sprint 22) | held, gated, blocked |
| **ready to approve** | A question still to do that nothing holds from bulk approval (Sprint 22) | eligible |
| **with experts** | The questions of a file asked of colleagues, and where each stands (Sprint 22) | assignments (as a place on the response) |

## Stages

| Of | Stages, in order |
|---|---|
| A response | **No questions yet**, **In progress**, **Ready to send**, **Sent**, **Changed since sent**, **Archived** (with **Won**, **Lost** or **Withdrawn**) |
| A question | **To do**, **Approved**, **Not answered** |
| An assignment | **Asked**, **Working on it**, **Answered**, **Approved**, **Closed** |
| A response's page (Sprint 22) | **Questions** (grouped as **Needs a person**, **Ready to approve**, **Approved**, **Not answered**), **With experts**, **Send** |

## Confidence bands

The same three bands on the question card and the bulk buttons: **High** at least 80%, **Medium** 60 to 80%, **Low** under 60%, and **Not calibrated** when no confidence could be measured.

## Sending

Since Sprint 21 (S21-1, U-6), downloading and marking as sent are separate: **Download** (Excel, CSV, Word) gives the files once every question is decided, and **Mark as sent** records that the response went to the customer, which is when the knowledge base learns and the assignments close. Say **Sent**, **mark as sent**, **Changed since sent**; not "Exported", "Record export" or "export recorded". "Export" stays for the downloaded files' format ("exported as Not answered").
