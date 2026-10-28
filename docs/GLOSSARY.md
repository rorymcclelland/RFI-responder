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

## Stages

| Of | Stages, in order |
|---|---|
| A response | **No questions yet**, **In progress**, **Ready to send**, **Exported**, **Changed since export**, **Archived** (with **Won**, **Lost** or **Withdrawn**) |
| A question | **To do**, **Approved**, **Not answered** |
| An assignment | **Asked**, **Working on it**, **Answered**, **Approved**, **Closed** |

## Confidence bands

The same three bands in the filter and on the bulk buttons: **High** at least 80%, **Medium** 60 to 80%, **Low** under 60%, and **Not calibrated** when no confidence could be measured.

## Export words

"Export", **Record export** and **Exported** stay until downloading and marking a response as sent are separated (U-6, planned for Sprint 20).
