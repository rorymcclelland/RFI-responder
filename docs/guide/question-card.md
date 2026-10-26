# The question card

Every question in a response has a card. This page explains each thing on it. Choose a card's heading to open or close it.

## The heading

- The dot and the bar show the confidence: green for **High** (80% or more), amber for **Medium** (40% to 80%), red for **Low** (under 40%), grey for **Not calibrated**. The bar reads `n/c` when there is no calibrated confidence.
- The number is the question's place in the upload (the list itself is in review order); a small grey label beside it is the customer's own number for the question, kept in the export.
- Badges say why the question is reviewed one at a time (below), and **Not processed yet** if matching and drafting have not run.
- **Accepted**, **Accepted (edited)** or **Accepted (written by a person)**, with who accepted it and when, and "bulk at 80%" or similar if it was approved in bulk. **Skipped**, with who skipped it and when, if it was skipped.
- **Assigned** (or how many are assigned) if colleagues have been asked to look at it.

## Confidence and similarity

**Confidence** is the measured chance that the knowledge base answers the question with the top entry. It comes from how closely the question matched and from the checker's verdict, calibrated on a test set of synthetic questions whose right answers are known. Hover over the information icon to see the test set and, when the app has one, how many test questions scored like this one and how many of them had the right entry, with a 95% interval. The test set is small, so the top of the scale is shown as 99%+, never as certain.

**Not calibrated** means one of these: matching fell back to keywords, the checker could not run, or there is no calibration for the models in use. A question without calibrated confidence is never approved in bulk.

**Similarity** is how close the question is to the best-matching entry (or the keyword score, when matching fell back to keywords). It is not a probability, and a high similarity does not mean the entry answers the question; that is what the checker is for.

A **Low confidence** warning appears on pending questions under 40%: the knowledge base probably does not answer them.

## Checker

Whether the matched entries actually answer the question, as judged by a language model:

- **Yes**: they answer it.
- **Partly**: they answer some of it. The draft may leave part of the question unanswered, so it is never approved in bulk.
- **No**: they do not answer it.
- **Not available**: the check failed, so the question is not calibrated.

The reason follows the verdict, usually naming the entry it relied on. Questions checked before 24 October 2026 may show **No** with no reason: before then, a reply that could not be read was recorded as No.

When the verdict keeps a question out of bulk approval, a line under it says so, for example "Not included in bulk approval: the checker said the entries answer it only in part". Accept it on its own if the draft is right.

## Why a question is reviewed one at a time

These badges mean a question is never approved in bulk. Hover over the badge, or read **Held back from bulk approval** lower on the card, for the reason in full.

| Badge | Why |
|---|---|
| Pricing: a person answers | It asks about price, cost or commercial terms. No draft is written, and the answer is never learned automatically. |
| Legal: review individually | It touches contract terms, liability, indemnity, warranties and similar. A draft may be written, but a person checks it. |
| Not fully checked | The pricing and legal classifier could not run, so only simple rules were applied; or the review status of the cited entries could not be read. |
| Translated draft | The question and the entries the draft is written from are in different languages, English and Japanese, either way round. The draft carries a label saying which way it was translated. |
| Japanese: review individually | A Japanese question answered from Japanese entries. Nothing is translated, but the app's Japanese has not yet been checked by a native reader, so these are reviewed one at a time. |
| Cites an unreviewed entry | The draft relies on a knowledge-base entry an admin has not reviewed yet. |
| Cites an entry overdue for review | The draft relies on an entry overdue for its periodic review, or one that has since been replaced. |
| Some entries not searched | Some knowledge-base entries were not yet indexed when the question was matched, so the best match may have been missed (the processing could not index them first, for example because of your daily limit). |

Pricing and legal questions are found two ways, by rules (words such as "price" or "indemnity") and by a language model, and a question is held if either finds it.

## KB Sources

The best-matching entries, up to three, which the draft is written from, each with its number and its similarity to the question. Choose one to read it in full.

## The answer

The box's heading says who wrote what is in it:

- **Proposed Response**: the system's draft. The tooltip says how it was made:
  - written by a language model from the matched entries only, citing them; every citation, figure, link and email address was checked against the entries before it was offered;
  - or assembled from sentences of the matched entries, with references, when no drafting model is configured, drafting failed, or matching fell back to keywords. Nothing was generated.
- **Answer (edited by a person)**: someone changed the draft. The checks applied to the draft, not to the edits.
- **Answer (written by a person)**: there was no draft, so someone wrote the answer and no automatic checks apply.

### When there is no draft

The box explains why instead:

- "Pricing question: a person answers this."
- "No matching knowledge-base entry was found for this question."
- "No confident match in the knowledge base": the closest entries are listed under KB Sources, but the confidence is under 30%, so they probably do not answer it.
- The drafting model judged that the entries do not answer the question.

A note under the answer says when a draft was written but not offered, for example because it cited an entry it was not given, or contained a figure that is not in its sources. In each case choose **Write an answer**.

### How it was produced

The small line at the bottom names the models: which matched the question, which checked the entries, and which drafted the answer, with the version of the drafting prompt. The export records how each answer was produced and, for a model's draft, the drafting model and prompt version.

## Notes under the answer

Amber notes report anything that did not go as planned while the question was processed: the checker or drafting was unavailable, the checker's reply could not be read, or there is no calibration for the models in use. They explain why a question is not calibrated or has an assembled draft rather than a generated one.

## Expert Assignment

See [Running a response](running-a-response.md#asking-a-colleague). Each suggested person shows the reasons: the cited entries they wrote, answers they approved that drew on the same entries, or expertise tags matching the cited entries' tags. Up to five people are suggested. **No history or expertise match** means there is no reason to suggest them, but they can still be assigned.

## Actions

See [Running a response](running-a-response.md#deciding-one-question). If you are not the response's owner, an admin or someone the question is assigned to, the card says so and shows no actions: you can read it but not decide it.
