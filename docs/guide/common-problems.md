# Common problems

## Signing in

### I have no account

There is no sign-up; ask an admin to invite you ([Administering RFI Respond](admin.md#inviting-someone)).

### The reset email has not arrived

Check spam. On a local install no email is sent: the Supabase command line tool catches it, and it can be read in the local mail viewer (usually `http://127.0.0.1:54324`).

## Uploading a file

The app says what is wrong with a file it will not open. The usual reasons:

| Message begins | What to do |
|---|---|
| Old Excel files (.xls) are not supported | Open it in Excel and save it as .xlsx. |
| This is the older Word format (.doc) | Open it in Word and save it as .docx. |
| Documents with macros are not accepted | Save a copy as .docx without macros. |
| The file is too large | The limit is 5 MB. Split the file, or remove images. |
| The file has more than 2000 rows | Split it into smaller files. |
| The CSV file is not valid UTF-8 text | Save it again as "CSV UTF-8" from Excel. |
| The Excel file could not be read | It may be damaged or protected by a password. Remove the password and save it again. |
| The document has more than 200,000 characters of text | Split it into smaller files. |

### The wrong column was picked as the questions

Choose the right one under **Map Your Columns** before **Match and draft**.

### Questions are missing from a Word document, or split in two

In **Check the questions**, add the missing ones and use **Join the parts into one question**. If the screen says simple rules were used because the AI service was unavailable, check the whole list: rules can miss questions.

## Matching and drafting

### Processing stopped with a limit message

Each person has daily limits, and the organisation has a monthly budget. The message says which was reached. Wait until tomorrow (limits reset at midnight UTC), or ask an admin to raise the limit under **Governance**, **Usage and limits**. The questions not yet processed are kept.

### Questions show "Not processed yet"

A batch failed or was stopped by a limit, or the response was started in an earlier version of the app. Choose **Process now** on the banner above the list.

### A question has no draft

That is deliberate when the knowledge base does not answer it, or it is about pricing. [The question card](question-card.md#when-there-is-no-draft) says which. Choose **Write an answer**.

### Many questions are "Not calibrated"

The checker was unavailable while they were processed, or matching fell back to keywords (meaning-based search is unavailable, for example because an AI key is missing). The notes on each card say which. They can still be accepted one at a time.

### A message says meaning-based search is unavailable

Some knowledge-base entries could not be indexed. They are indexed before questions are next matched, as far as the daily limit allows; a question matched while some are still missing says so (**Some entries not searched**) and is not approved in bulk. If it keeps happening, tell whoever runs the installation: the AI provider's key or limit, or your daily indexing limit, is the usual cause.

## Review and approval

### Bulk approval accepted fewer than I expected

The message after it says why each group was held: below the threshold, pricing, legal or translated, citing an unreviewed or overdue entry, partly answered, or not calibrated. Those must be accepted one at a time. See [Approving in bulk](running-a-response.md#approving-in-bulk).

### The bulk buttons are greyed out, or there is no Accept

Only the response's owner or an admin can approve in bulk; others see the bar with its buttons greyed out (hover for why), and **Record export** is shown only to the owner and admins. Only they, and people the question is assigned to, can decide a question; everyone else can read it.

### I cannot accept a question with no draft

Write its answer first; a placeholder is not an answer.

### Record export is not available

Every question must be accepted or skipped first; hover over the button to see how many are still pending.

### I cannot archive a response as Won or Lost

Record the export first. A response never sent can only be **Withdrawn**.

### An archived response cannot be changed

That is deliberate: it is the record of what was sent.

## Assignments

### My change to an assignment was not saved

The inbox says why, for example when the response has been exported and its assignments closed. The list reloads to show what was saved.

### Nobody is suggested for a question

Suggestions come from who wrote the entries matched to the question, who approved (one at a time) answers drawn from them, and expertise tags that match those entries' tags. Anyone can still be assigned.

## The knowledge base

### An import skipped rows

Rows without a question or an answer are skipped, and so are questions already in the knowledge base (ignoring case and spacing), including repeats within the same file.

### My entry says "Not yet reviewed"

Entries added by members wait for an admin's review. They can be used for drafts as soon as they are indexed, but a draft that cites one is not approved in bulk until it is reviewed.

## Still stuck

Ask an admin. An admin can check usage and limits under **Governance**, and whoever runs the installation can read the Edge Function logs ([Development](../technical/DEVELOPMENT.md#logs)).
