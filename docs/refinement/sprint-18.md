# Sprint 18 refinement: each answer's story, and asking the knowledge base a question

Refined 29 October 2026, the second slice of option B from the Sprint 16 UX spike (`docs/ux/sprint-16-ux-spike.md`). It holds K-2, one answer and its history; K-3, ask it a question; and BUG-42, entry numbers past 9,999, which joins because K-2 changes how entries are changed anyway. The order of slices is the one set in the spike report (Claude, at Rory's request). The mockups are Knowledge screens 7 to 10 in the design "RFI Respond: jobs-first mockups".

## What refinement found

- **Most of an answer's story is already recorded, and members can read most of it.**
  - Where an answer was used: `rfi_questions.cited_refs`, with the question's status and its response's stage and outcome.
  - What it replaced and what replaced it: `superseded_by`.
  - A proposed change waiting beside it: `proposed_replacement_of`.
  - Its translations: `translated_from`.
  - Confirmations by use: `learn_outcome = 'confirmed'`.
  - Every signed-in person can read all of these today.
  - **The rest is in the audit log, which only admins can read**: reviews (with the text before a correction), changes of tags or source, and confirmations by an admin. Showing it on the answer's page to everyone is a change of access (Q1).
- **"Mark as still correct" and "Edit" exist, but only as an admin's review under Governance.** `review_entry` marks an answer reviewed and confirmed, and optionally corrects its question or answer. An admin can also change tags and source directly. Members cannot change an entry at all, by design (decision 0003), and K-2 keeps that (Q3).
- **Nothing retires an answer, and a proposed change cannot be declined.** An admin can only delete an entry outright: the database allows it, audited, but the app has no button for it. Deleting loses the link from the responses that cited it. A proposed change learned from a response can be approved under Governance, but never declined, so it waits for ever. Retiring with a reason fills both gaps: retiring a proposal is declining it.
- **Retiring touches every place that means "the current answer".** Eighteen migrations' worth of functions treat `superseded_by IS NULL` as current, including:
  - matching;
  - learning at export, including the near-duplicate check;
  - the source gate that holds drafts citing a replaced entry;
  - the unique question index;
  - the overview and browse.

  A retired answer must drop out of all of them, so this is the riskiest part of the sprint and gets its own story (S18-3) and its own tests across the pipeline.
- **Asking a question can reuse the whole pipeline unchanged.** `processQuestions` (matching, the answerability checker, the pricing and legal gates, drafting, calibration and the source gates) takes a question's text and returns the draft and its provenance without writing anything. A new Edge Function can call it for one question and return the result, reserving against the person's daily question cap and the monthly budget, and recording its cost in `ai_usage` like processing does. No new model, prompt or calibration, so the evaluation figures still hold.
- **BUG-42 needs the entry number's column rebuilt.** `ref` is generated as `'KB-' || lpad(seq::text, 4, '0')`, and Postgres 16 cannot change a generated column's expression in place, so the column is dropped and added again with the new expression, keeping every existing number. Nothing in the code expects exactly four digits: search by number already accepts any length.

## Stories

### S18-1 Entry numbers past KB-9999. S (BUG-42)

**The job.** A knowledge base that grows past 9,999 answers keeps numbering them, rather than refusing the 10,000th.

**Before and after.** Today entry 10,000 would be numbered KB-1000, clash with the real KB-1000 and be refused. After: KB-9999 is followed by KB-10000.

**What changes.**
- A migration rebuilds `kb_entries.ref` as `'KB-' || CASE WHEN seq < 10000 THEN lpad(seq::text, 4, '0') ELSE seq::text END`, with its unique index. The SQL functions that use `ref` are unaffected, since they read the column by name.
- Every existing number is unchanged.

**Test cases.**
1. Every existing entry keeps its number (compared before and after on the demo data).
2. Entries with sequence 9,999 and 10,000 are numbered KB-9999 and KB-10000, and both are saved.
3. Search finds KB-10000 by `KB-10000` and by `10000`, and `1000` finds KB-1000, not KB-10000.
4. The demo reset still numbers from KB-0001.

**Out of scope.** Renumbering anything. **Boundaries.** None touched. **Size.** S.

### S18-2 One answer and its history. M (K-2, part 1)

**The job.** Anyone can open an answer and see why it can be trusted: where it came from, who checked it and when, where it has been used and with what outcome, what it replaced, and what is waiting to change it. An admin can mark it still correct or correct it there, without going to Governance.

**Before and after.** Today the browse view shows an answer's text, topics, source and origin. Its history is spread over Governance, the audit log and each response. After: choosing an answer opens its own page, **Knowledge / All answers / KB-0015**, with all of it.

**What changes.**
- **The answer's page** (from browse, from **Learned recently**, from a draft's sources, and from the overview's tiles):
  - the answer, with its state, language, topics and source;
  - **Next review** date;
  - **A proposed change** waiting beside it, with the response it came from;
  - **Where it has been used**: each response that cited it, the question, whether the answer was approved, edited or not answered, and the response's stage and outcome (Won, Lost);
  - **History**, oldest first: added, imported or learned (with what it replaced), reviewed (with the earlier text if it was corrected), tags or source changed, confirmed by an admin or by an export that used it unedited, replaced (by which entry);
  - **Other languages**: the translations made from it, or the entries it was translated from.
- **For an admin, on the page:**
  - **Mark as still correct**: a review with no changes, setting its next review date.
  - **Edit**: corrects the question or answer as a review, or changes the tags or source.
  - **Approve the change**, for a proposal.

  These all use the existing database functions, audited as now.
- **Data:** one invoker function, `public.entry_detail(p_ref)`, returning the answer, its usage, its chain of replacements and its translations under the caller's own rights. Its history events come from a definer helper in the `private` schema, limited to that entry's `kb.*` events (Q1). Named by the people's display names, as everywhere else in the app.
- **Browse:** choosing an answer opens its page. On a wide screen the page shows beside the list as now; on a phone it replaces the list, with **Back to the list**.

**Test cases.**
1. On the demo data, KB-0015's page shows the proposed change KB-0132 from Larkspur Health (fictional), its use in each response that cited it (matching a direct count), and its history in order.
2. After an admin corrects an answer, its history shows the review with the earlier text; after **Mark as still correct**, it shows the confirmation and the next review date moves on by the review interval.
3. A replaced entry's page says what replaced it and links there; the new entry's history says what it replaced.
4. A translation's page names the entries it was translated from; the original's page lists the translation.
5. **Role matrix:**
   - a member and an admin see the same page;
   - a member is not offered **Mark as still correct**, **Edit** or **Approve the change**, and the database still refuses them;
   - an anonymous visitor and the service role get nothing;
   - the history shows only `kb.*` events for that entry, never other audit events, even when an event's details name the entry.
6. An entry that does not exist, or a malformed number, says "No answer KB-… in the knowledge base".
7. **Hostile:** answer text with markup, and a history event with odd details, are shown as text.
8. **Cost:** an answer cited by 5,000 questions returns within the same limit as the overview (1.5 s in the test).

**Out of scope.**
- Members proposing a change themselves (Q3).
- Comparing two versions side by side; showing the earlier text is enough.

**Boundaries.**
- Decision 0003: no new write access, and a test for every row of the role matrix.
- Q1 widens who can read an entry's own history.
- Rule 1: the page shows only what is recorded. "Confirmed by use" appears only where an export recorded it.

**Size.** M (about a day and a half).

### S18-3 Retire an answer, or decline a proposed change, with a reason. M (K-2, part 2)

**The job.** An admin can take an answer out of use when it stops being true (a withdrawn certificate, a closed office), saying why, without losing where it was used. Retiring a proposed change declines it.

**Before and after.** Today the only way out is deleting the entry, which the app does not offer, and proposals cannot be declined. After: **Retire** on the answer's page asks for a reason. The answer stops being matched, drafted from or learned onto. It stays readable, marked **Retired**, with its reason and full history. **Restore** brings it back (Q2).

**What changes.**
- **Columns** `retired_at`, `retired_by` and `retired_reason` on `kb_entries`. The reason is required, 5 to 500 characters.
- **Admin-only functions**, both definer and audited (`kb.retired`, `kb.restored`):
  - `retire_entry(p_entry, p_reason)`;
  - `restore_entry(p_entry)`. It refuses if a current entry now has the same question in the same language.
- **"Current" excludes retired answers everywhere**, each change tested:
  - matching (`match_kb_entries`) and indexing;
  - learning at export (a near-duplicate of a retired answer becomes a new entry, never a confirmation of the retired one);
  - the source gate: a draft citing a retired answer is held and says so, as for a replaced one;
  - the unique question index;
  - the overview, browse and its counts.
- **Browse:** a **Retired** state, unticked by default.
- **Retiring a proposal** removes it from the entry it would have changed. That entry is untouched.

**Test cases.**
1. Retiring an answer with a reason records who, when and why (audited), and the answer is no longer matched for a question it used to answer best.
2. A pending question whose draft cites it is held from bulk approval with the reason "cites a retired entry"; an approved one is left alone.
3. Recording an export whose answer is close to a retired answer adds a new entry; it never confirms or replaces the retired one.
4. A new answer with the retired one's question can be added; restoring the retired one is then refused with the reason. Without a clash, restore brings it back into matching (audited).
5. Retiring a proposal declines it: the entry it would have changed shows no proposal, and the proposal's page says **Declined** with the reason.
6. **Role matrix:**
   - a member cannot retire or restore, and cannot set the columns directly;
   - an admin can;
   - the service role and an anonymous visitor cannot;
   - every function keeps `search_path ''`, and every UPDATE has a WHERE clause (the pg_safeupdate test).
7. A missing or too-short reason, an already retired answer, and a replaced answer are each refused with a message.
8. The overview's counts and browse leave retired answers out, and the **Retired** filter shows them.

**Out of scope.** Deleting from the app: retiring replaces it, and the database's delete stays for an admin in Supabase.

**Boundaries.**
- Rule 1: a retired answer is never presented as current.
- R-04 (stale facts) and R-10 (learning) in the risk register gain a control.

**Risks.** Missing one "current" check would let a retired answer back into drafts. That is why each place has its own test.

**Size.** M (about a day and a half).

### S18-4 Ask it a question. M (K-3)

**The job.** Anyone signed in can type a question as a customer would and see the answer the knowledge base would draft, with its confidence, the checker's verdict and the answers behind it, before any questionnaire arrives. For a visitor it is the shortest demonstration of the value; for an owner, a way to judge whether to trust it.

**Before and after.** Today the only way to see a draft is to create a response and upload a file. After: **Ask it a question** on the knowledge page gives a draft in a few seconds.

**What changes.**
- **A new Edge Function, `ask-knowledge`:**
  - signed in only; one question of at most 2,000 characters;
  - reserves one question against the caller's daily question cap and the monthly budget;
  - indexes unindexed entries first, as processing does;
  - runs `processQuestions` unchanged and returns the draft, confidence, verdict and reason, the gate and its reason, and the cited and matched entries;
  - records its cost in `ai_usage` (function `ask-knowledge`);
  - saves nothing else (Q4).
- **On the knowledge page**, a question box on the overview and in browse. The result shows:
  - the draft;
  - the confidence band;
  - the checker's **Yes**, **Partly** or **No** with its reason;
  - the gate in words (pricing: "A person must answer pricing questions; none is drafted.");
  - the answers it drew on, each linking to its page.

  It says plainly that nothing was saved and that a response would also go through a person's approval.
- **Japanese:** a question in Japanese is answered by the same rules as in a response, including the translation and Japanese gates.
- **Limits:** past the daily cap or the budget, the box says so, with the same wording as processing; its cost is recorded under its own function name in `ai_usage` and counts in the governance page's spend for the month (built: the page shows spend in total, not by function).

**Test cases.**
1. Unit, on the function's core: a question returns the draft and its provenance; nothing is written to `rfi_questions`.
2. A pricing question returns no draft and the pricing gate, and costs no drafting call.
3. With the cap reached, the function refuses with the limit message and spends nothing; with the budget reached, likewise.
4. An empty question, one over 2,000 characters, or a body that is not a question is refused (400); no key or an anonymous caller is refused (401).
5. Usage is recorded in `ai_usage`, under the caller, even when a provider fails part way.
6. On the local stack (CI), a call with the seed user returns a draft citing a seed entry.
7. **Hostile:** a question containing instructions to the model gets the same treatment as in a response (R-05), and the result is shown as text.
8. In the app, the result's sources link to their answers' pages; the confidence shown uses the same bands as the response screen.

**Out of scope.**
- Saving the questions asked or a history of asks (Q4).
- Turning an ask into a response or a knowledge-base entry; that is K-4's gaps, in Sprint 20.

**Boundaries.**
- Decision 0005: the call goes through an Edge Function, and no key reaches the browser.
- R-07: metered and capped before any provider is called.
- R-05: the same prompts and code as processing.
- Rule 1: the confidence shown is the calibrated one, with the same caveats as in a response.

**Dependencies.** Links to S18-2's answer page. **Risks.** A cold function start adds a few seconds; the box shows that it is working. **Size.** M.

### S18-5 Guide, introduction and screenshots for these screens. S (U-10)

The guide's knowledge section gains the answer's page, retiring and asking. The introduction's knowledge step mentions asking. The screenshot script adds the answer's page and an ask; Rory retakes the screenshots at the close, as in Sprint 17.

## The sprint as a whole

**Order:**
1. S18-1 first: small, and it rebuilds a column the later stories read.
2. S18-2, then S18-3, which builds on its page.
3. S18-4.
4. S18-5.
5. Then the independent security review, the live update, the test pack and the close.

**Live update:**
- three migrations;
- one new Edge Function to deploy (`ask-knowledge`);
- the app deploys itself.

**Sizes:** two S and three M, about four days, against Sprint 17's two. If that is too much, S18-3 (retiring) moves to Sprint 20 beside K-4's gaps (Q5).

**No spike:** nothing here depends on an unknown.

## Questions for Rory (answered 29 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | Should every signed-in person see an answer's history (its reviews, corrections and confirmations), which today only admins see in the audit log? | **Yes, for that entry's own knowledge-base events only.** The history is the proof the knowledge can be trusted, and members can already read the entry and every response; the rest of the audit log stays admin-only **Rory: agreed** |
| Q2 | Retiring: soft, with a reason and a way back, or delete? | **Retire with a reason, admin only, and Restore, both audited.** Nothing is lost, where it was used stays linked, and declining a proposal works the same way **Rory: agreed** |
| Q3 | Should a member be able to suggest a change to an answer? | **Not this sprint.** Members still cannot change entries (decision 0003); a suggestion would be a new kind of proposal, better decided with U-3's contributor screen in Sprint 19 **Rory: agreed** |
| Q4 | Keep the questions people ask? | **No: nothing is saved but the cost.** It keeps the feature simple and private; K-4's gaps come from responses **Rory: agreed** |
| Q5 | Sprint size: about four days with retiring, or about two and a half without it | **Keep all five.** Retiring is what makes an answer's page complete, and it closes the gap that proposals can never be declined **Rory: agreed** |

## Security review (29 October 2026)

An independent review of `main..sprint-18` found no high issue, two medium and six low; all are fixed or, for one, accepted and recorded. It confirmed that:
- an answer's history exposes only that entry's own knowledge-base events;
- retiring and restoring are admin-only, audited and safe under `pg_safeupdate`;
- every redefined function kept its grants;
- no check of what is current misses retired answers;
- asking is capped before any provider is called;
- moving the pipeline's set-up into `pipeline-env.ts` left `process-questions` unchanged.

| | Finding | Fix |
|---|---|---|
| M1 | An admin's export of a draft citing a retired (or replaced) answer recorded that answer as "confirmed by use": the review date was rightly left alone, but the audit row named every cited entry, so the retired answer's history said it was confirmed | `record_export` names only the entries it actually confirmed. A draft whose every cited entry is retired or replaced confirms nothing (`not_confirmed_source`). Tested, history included |
| M2 | Agreed cases without a test that could fail: the cap, usage recorded after a provider failure, nothing written by an ask, an assembled draft in CI, the `retired` flag process-questions reads, re-importing a retired answer's question, the overdue report, and matching by meaning | Each now has a database test or a CI assertion. CI sets the daily cap to 0 and checks the 429, its message, and that nothing is spent. Usage after a failure is covered by the unit tests of `finishUsage`: in CI every provider fails and a failed call is not billed, so there is nothing to count |
| L1 | After opening an answer from a draft's sources, every later visit to Knowledge reopened that answer | The request is cleared once used |
| L2 | "Approved by X, who is not an admin" could be untrue (an admin's translated answer also becomes a proposal), on the answer's page and under Governance | The clause is removed from both |
| L3 | Changes proposed for a retired answer kept waiting, and approving one would have replaced the retired answer | Retiring an answer declines the changes proposed for it (audited), and approving a change for a retired answer is refused. Tested |
| L4 | The service role can set the retired columns directly | Accepted: the service key is server-only, as for every other column it writes (decision 0005) |
| L5 | A history longer than 500 events dropped its newest | The newest 500 are kept, shown oldest first. Tested |
| L6 | "Nothing is saved" while an ask may index unindexed entries; the usage banner did not refresh after an ask; a correction of only the question showed the unchanged answer as "Before" | "Nothing about your question is saved"; the banner refreshes; a correction shows only what it changed, compared with the next version (tested). The guide also says when **Restore** is refused |
