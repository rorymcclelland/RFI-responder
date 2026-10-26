# Sprint 12 refinement: a multilingual knowledge base (C-1)

Refined 26 October 2026, after Rory chose C-1 at the Sprint 11 review ("Let's do this please"). The candidate, from 22 October: knowledge captured in any supported language is usable in all of them; a question in one language retrieves answers held in another; drafts are written in the language of the incoming RFI; each entry keeps its original language; translated answers are marked as such and need human review before being learned; retrieval and drafting are evaluated per language pair. Languages: English and Japanese to start.

## What refinement found

- **Half of C-1 already works, in one direction.** Since Sprint 1, a Japanese question finds English entries (voyage-4, Japanese-to-English recall@5 100.0% on machine-translated items). Since Sprint 2, it gets a Japanese draft written from them, labelled as translated, and held from bulk approval by the `translation` gate until a native reader has checked the Japanese evaluation items (F-14).
- **The other half does not exist.** The knowledge base has no idea of language: an entry has no language field, nothing shows it, and every learned entry is assumed English. A Japanese entry could be imported today, but the app would treat it as English.
- **"Translated" is decided by the question alone.** The code calls any Japanese question's draft "translated from English knowledge-base entries" and gates it; an English question answered from a Japanese entry would be neither labelled nor gated. Once Japanese entries exist, translation has to be decided by comparing the question's language with its sources'.
- **Japanese answers are never learned** (`not_learned_japanese`), so the knowledge base cannot grow in Japanese. C-1 asks for them to be learned, with translated ones reviewed by a person first.
- **Learning could cross languages.** A learned answer replaces an entry with the same question, or a near-duplicate above the similarity threshold. Cross-language similarity is lower (about 0.5 for right matches in Sprint 1, below the 0.55 threshold), so this is unlikely, but nothing forbids it; it should be forbidden.
- **The evaluation has only one pair.** Retrieval and the checker were measured for English and Japanese questions against English entries. There are no Japanese entries to measure English-to-Japanese or Japanese-to-Japanese, and no native reader (F-14), so new Japanese items will again be machine translations, labelled unreviewed.
- **No spike is needed.** The design does not wait on a measurement: whatever the evaluation shows, translated answers stay out of bulk approval. The evaluation decides only what the guide and the evaluations page may say.

## Stories

### S12-1 Every entry knows its language. M

**The job.** An admin can see, and the app can use, the language an entry is written in.

**What changes.** A migration adds `kb_entries.language` (`en` or `ja`), set by the database from the entry's text (Japanese if the question, or a fifth of the answer, is in Japanese script), never by the request, so it cannot be forged. The knowledge-base list, the review cards and **KB Sources** on the question card show a small language label for Japanese entries. Imports accept Japanese entries. The duplicate rule for imports (the same question, ignoring case and spacing) is unchanged; a Japanese and an English entry are different questions.

**Test cases.**
1. An entry with an English question and answer is `en`; one with a Japanese question is `ja`; an English question with a mostly Japanese answer is `ja`; an English answer that mentions one Japanese name stays `en`.
2. The language follows an edit (a correction through review).
3. Hostile: a member cannot set or change `language` directly.
4. The label shows on Japanese entries in the list, the review card and KB Sources, and nowhere for English ones.

### S12-2 "Translated" means the answer crosses languages. M

**The job.** A draft is labelled and gated as translated when, and only when, its question's language differs from the language of an entry it was written from, in either direction.

**What changes.** `process-core` compares the question's language with the cited entries' languages (read with the entries). A draft written across languages gets the `translation` gate and a label naming the direction ("Translated from English knowledge-base entries" or "from Japanese ..."); the drafting prompt says which. A Japanese question answered only from Japanese entries is not translated (Q2 decides whether it is still held). Learning, the card and the guide use the same rule.

**Test cases.**
1. Japanese question, English sources: translated, labelled "from English", gated (as today).
2. English question, Japanese source: translated, labelled "from Japanese", gated.
3. Japanese question, Japanese sources: not translated; held or not as Q2 decides.
4. English question, English sources: unchanged.
5. Mixed sources: translated if any cited source is in the other language.
6. Hostile: a Japanese entry that tells the drafter to drop the label or to answer in another language changes nothing (added to the red-team set).
7. The figure checks still hold for Japanese drafts from Japanese entries (full-width digits, kanji numerals).

### S12-3 Japanese answers are learned, translated ones reviewed first. M

**The job.** The knowledge base grows in Japanese as it does in English, and nothing translated is trusted without a person's review.

**What changes.** `record_export` learns Japanese answers instead of skipping them (`not_learned_japanese` goes, except where Q3 decides otherwise). Each learned entry gets the language of its answer. An answer accepted from a translated draft, edited or not, is learned as a new entry marked `translated_from` (the refs it was translated from), and starts unreviewed until an admin reviews it (Q3: whoever approved it). A learned answer replaces only an entry in the same language. **Entries to review** shows "Translated from KB-0001 (English)". Pricing answers are still never learned.

**Test cases.**
1. A Japanese answer written by a person is learned as a Japanese entry, by the usual rules (an admin's is reviewed; anyone else's waits).
2. A translated draft accepted unedited, and one edited, are each learned as an unreviewed entry with `translated_from`, whoever approved (as Q3 decides).
3. A Japanese answer never replaces an English entry, and an English answer never replaces a Japanese one, however similar.
4. A Japanese pricing answer is not learned.
5. The review card names the entries it was translated from and their language; approving it makes it a reviewed Japanese entry.
6. Re-exporting (Sprint 11) learns a corrected Japanese answer by the same rules.

### S12-4 Japanese entries to measure against, and the measurements. M

**The job.** Know how well the app does for each language pair, and say only that.

**What changes.**
- `sample-data/security-qa-ja.csv`: 30 of the 100 synthetic entries written in Japanese, by Claude, labelled machine-translated and unreviewed (the README says so).
- The retrieval evaluation gains a Japanese corpus variant, in which those 30 entries are replaced by their Japanese versions. English and Japanese questions about them then measure English-to-Japanese and Japanese-to-Japanese recall@5, beside the existing pairs.
- The checker and calibration are run on the same variant, so near misses are measured across languages too.
- One run on Rory's PC (Voyage and Anthropic keys), with reports and 95% intervals. The evaluations page gains one row per new pair.

**Test cases.**
1. The Japanese file has 30 entries, each matching an English entry by number, each detected as `ja`.
2. The evaluation set builder produces the new pairs, with no item whose right answer is missing from the corpus variant.
3. The report gives recall@5 per pair with intervals, and the docs test ties each new figure to its report.
4. The bars (Q4) are met, or the shortfall is reported and recorded as a residual. A shortfall is never hidden.

### S12-5 Japanese entries in the demo, and the guide. S

The seed's knowledge base gains the 30 Japanese entries (KB-0101 onwards, after the English ones, so the recorded demo drafts keep their references). The guide explains languages, translated drafts and how translated answers are learned and reviewed; the introduction's draft step mentions languages in a line. **Test cases.** 1. `npm run demo:seed` adds them without changing any existing reference. 2. The guide tests pass with the new labels.

## Not in this sprint

Languages beyond English and Japanese. A native reader's review of the Japanese items (F-14, which needs a person). Calibrating separately per language pair (only if the evaluation shows the pooled calibration does not hold across languages, as a later item). A language picker in the app (Q1).

## Boundaries

- **Rule 1, honesty:** every new figure comes from a report and states that the Japanese items are machine translations, unreviewed. The label on a draft says which way it was translated.
- **Rule 2, synthetic data:** the Japanese entries are written for this project, from the synthetic English ones.
- **Rule 4, human in the loop:** translated drafts stay out of bulk approval; translated answers are reviewed before they are trusted as knowledge.
- **Rule 7, provenance:** each entry records its language, and a translated one the entries it was translated from.

## Questions for Rory (answered 26 October 2026: every recommendation agreed)

| | Question | Recommended |
|---|---|---|
| Q1 | How is an entry's language decided? | Detected from its text by the database (English or Japanese only); no picker, so it cannot be set wrongly by hand **Rory: agreed** |
| Q2 | A Japanese question answered only from Japanese entries (not translated): held from bulk approval? | Yes, held, until a native reader has checked the Japanese items (F-14): the drafter's Japanese is unverified either way **Rory: agreed** |
| Q3 | A translated answer, when an admin approved it: learned as reviewed, or waiting for review anyway? | Waiting for review anyway: approving an answer to send is not the same as approving a translation as knowledge for every future response **Rory: agreed** |
| Q4 | Bars for the new pairs | Recall@5 at least 0.80 for English-to-Japanese and Japanese-to-Japanese (Sprint 1's bar for Japanese), and no near miss at or above the 80% bulk line, as now **Rory: agreed** |
| Q5 | Japanese entries in the demo data | Yes, 30, after the English ones; you run `npm run demo:seed` and a reset, with no API calls **Rory: agreed** |

## The sprint as a whole

Order: S12-1, S12-2, S12-3 (each builds on the one before), S12-4 (needs S12-1 for the language of the new entries), S12-5. Sizes: four M and one S, about four days, then the independent security review, Rory's evaluation run and check on his PC, and the close.
