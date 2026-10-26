# Sprint 13 refinement: finishing the language work

Refined 26 October 2026, after Rory chose at the Sprint 12 review to "finish the language work". Candidates from that review: F-58 (the translation label in exports), F-59 (calibration across languages), F-60 (Japanese keyword matching) and F-61 (import duplicates by language).

## What refinement found

- **F-58 is wider than the label.** The export removes the reference list with a pattern that matches any bracketed "[References: …]" anywhere in an answer (`stripKbReferences` in `src/exportUtils.ts`), so an approver's own bracketed text could be cut from what goes to the customer. This is the same pattern the Sprint 12 security review found in learning (L1). The translation label is not removed at all.
- **F-59 needs no new API calls.** Every check behind the language report is cached on Rory's PC, and copied here for the Sprint 12 close. The language report keeps only the calibrated confidence, though, not the raw score the calibration fits on, so the report must save the score too. It can then be rerun from the cache with no new calls.
- **The variant doubles each question.** A question appears once against the English knowledge base and once against the variant. If the two copies land in different folds, cross-validation is optimistic, so folds must keep both copies of a question together.
- **F-59 is not a spike.** Whatever the refit shows, the story ends in a decision Rory has already set (Q2): adopt the new table if every bar holds, otherwise keep the current one and record the residual.
- **F-60 matters only without vectors.** Keyword matching runs when a question or entry has no vector, which the app now holds from bulk approval (S11-2). Japanese has no spaces, so it needs a different tokeniser (for example trigrams), and how well trigrams handle kana and kanji in this database's locale is unknown. Recommended out of this sprint (Q4).
- **F-61 is a one-line rule change.** The import's duplicate key should match the database's unique index: the question and its language.

## Stories

### S13-1 Exports send only the answer. S

**The job.** The customer receives the answer a person approved, without the app's notes. The provenance still records that a draft was translated.

**What changes.**
- `src/exportUtils.ts` removes the reference list and the translation label only as the app writes them, and only at the end of an answer, using the same rule as `private.learnable_text`.
- The Provenance sheet (Excel), the provenance section (Word) and the provenance columns (CSV) gain a **Translation** field: "drafted from English entries", "drafted from Japanese entries", or empty. It is taken from the stored gate and the label in the draft.
- The guide's export section is updated.

**Test cases.**
1. A translated draft accepted unedited exports without the label and the reference list. Provenance says "drafted from English entries".
2. An English draft exports without its reference list, as before.
3. An approver's own bracketed text ("[References: on request]" mid-answer, or "[Translated from our parent company's policy]") is kept.
4. An answer edited so the label is no longer at the end keeps the text the person wrote. Provenance still records the translation, from the gate.
5. A Japanese draft from Japanese entries (gate `japanese`) has an empty Translation field.
6. Every export format (Excel, CSV, Word) carries the field.

**Boundaries.** Rule 7 (provenance): the record of translation moves to provenance and is never lost. Rule 1: the guide says exactly what is removed.

### S13-2 Import duplicates are judged per language. S

**The job.** An import treats a row as a duplicate only when the same question already exists in the same language, as the database's own unique rule does since Sprint 12.

**What changes.** A migration redefines `import_kb_entries`. The duplicate key becomes the question key plus `public.text_language(question, answer)`, both within the file and against current entries. The admin guide line on duplicates is updated.

**Test cases.**
1. The same question twice in one file, both English: one imported, one counted as a duplicate (unchanged).
2. A question already in the knowledge base in English, imported with a Japanese answer: imported, as a Japanese entry.
3. The same Japanese question as an existing Japanese entry: a duplicate.
4. Hostile: a row that differs only in case and spacing is still a duplicate in its language.
5. The role matrix for `import_kb_entries` is unchanged (members and admins may import; anonymous may not).

### S13-3 Calibration across languages. M

**The job.** The confidence shown is right whether the matched entries are English or Japanese, and no near miss reaches the bulk line in either knowledge base.

**What changes.**
- `eval/run-languages.ts` saves the raw score with each row, and is rerun from the cache. The report says it made 0 new calls.
- `eval/run-calibration.ts` gains the language variant's checks as a second set of rows, ids suffixed `@ja-corpus`. Folds group a question's two copies together. The fit is pooled over both.
- The report gives every existing bar (Sprint 1, 2 and 8) on the pooled set, plus, per corpus and per language pair: near misses at or above 80%, and calibration error.
- **Adopt only if every bar holds (Q2).** If so, the new table goes into `calibration-tables.ts`, and the summary figures, intervals, model card and risk register are updated from the new reports. If not, the current table stays, the report records the shortfall, and F-59 stays open as a residual.

**Test cases.**
1. The two copies of a question are always in the same fold. With a fixed seed the folds are stable.
2. Rows from the variant carry their own ids, so no row overwrites another.
3. The adoption check refuses a table that misses any bar, using synthetic rows that miss each bar in turn.
4. Rerunning the language report from the cache makes no API call; the report states the count.
5. If adopted: the docs test ties every changed figure to its report, and the n003 near miss is re-scored with the new table.

**Boundaries.** Rule 1: figures come only from reports; the report states that the variant reuses the same questions, so the pooled set is not twice as much evidence. Rule 4: bulk approval rules are unchanged whatever the table says.

## Not in this sprint

- F-60, Japanese keyword matching: unknown fit in this database's locale; it matters only without vectors, which are already held from bulk approval (Q4).
- F-14, a native reader's review: needs a person.

## The sprint as a whole

Order: S13-1 and S13-2 (independent, small), then S13-3. Sizes: two S and one M, about two days, then the security review, a test pack for Rory's check (an export with a translated answer, and an import), and the close. No API keys are needed unless the language report must be rebuilt on Rory's PC.

## Questions for Rory (answered 26 October 2026: every recommendation agreed)

| | Question | Recommended |
|---|---|---|
| Q1 | The translation label in exports | Removed from the exported answer; the translation is recorded in the provenance instead **Rory: agreed** |
| Q2 | When to adopt a calibration refitted across both knowledge bases | Only if every existing bar holds on the pooled set and no near miss reaches 80% in either knowledge base; otherwise keep the current table and record the residual **Rory: agreed** |
| Q3 | Import duplicates | The same question counts as a duplicate only in the same language **Rory: agreed** |
| Q4 | F-60, Japanese keyword matching | Not in this sprint; it matters only when vectors are missing, and those questions are already held **Rory: agreed** |

## Security review (26 October 2026)

An independent review of `main..sprint-13` found no high issue, one medium and six low; all are fixed, each with a test where code changed.

| | Finding | Fix |
|---|---|---|
| M1 | A translated draft held for a legal or unchecked reason (which takes precedence over the translation gate) lost its label in the export with nothing in the provenance | The Translation field is decided from the drafter's label whatever the gate, and from the translation gate for a draft with no label |
| L1 | The evaluations page compared different populations (0.104 on 60 questions with the current table, 0.044 on 254 with the pooled one) and quoted n003 at 81%, its score with the current table | The calibration report gives each language pair like for like (English-to-Japanese: 0.104 current, 0.096 pooled, out of fold) and n003's score under each table (86.5% pooled, out of fold); the page cites those |
| L2 | A person-written answer to a question gated as translated was recorded as a translated draft | Only drafts are recorded as translations |
| L3 | Text written after the label kept the label in the export, and with both labels only one was removed | The label, the app's own exact sentence, is removed wherever it is; the reference list still only at the end |
| L4 | The adoption check passed a measure that was not a number | Such a measure fails; the bars are shared by the report and the check |
| L5 | The "no keys, no calls" note printed when only one key was missing, and embedding calls were not counted | The note needs both keys absent; embedding calls are counted |
| L6 | If a pooled table were ever adopted, intervals would treat a question's two copies as independent | Intervals resample questions and count a near miss once |

**Left for the backlog (F-62).** The import trims only spaces from a question, so a tab or line break at either end (possible only by calling the database directly; the app trims cells) makes a different key; two imports at the same moment can collide on the unique index and roll back. Both predate this sprint.

## Review and close (26 October 2026)

All three stories done. S13-3 ended as the rule agreed (Q2) foresaw: the fit across both knowledge bases missed the near-miss bar, so it was not adopted and F-59 stays as a residual. Rory ran the test pack (`docs/testing/sprint-13-test-pack.md`); all four cases passed. New backlog row: F-62. Test counts at the close: 887 unit, 288 database.
