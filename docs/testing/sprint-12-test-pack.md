# Sprint 12 test pack: a multilingual knowledge base

**Local test data only.** The accounts below exist only in the local seed (`supabase/seed.sql`) on your PC. Nothing here is a real credential.

Branch `sprint-12`, commit `f4bd8c7` or later. About 20 minutes.

## Before you start

1. Start **Docker Desktop** and wait until it says it is running.
2. In `C:\Code\rfi-responder`, in three PowerShell windows:
   1. `npx supabase start` (if it is not running), then `npx supabase db reset`. This applies the three Sprint 12 migrations and loads the seed, with the 30 Japanese entries.
   2. `npx supabase functions serve`, left running. It needs the Voyage and Anthropic keys in `supabase/functions/.env`, as before.
   3. `npm run dev`, left running. Open http://127.0.0.1:5173.
3. Have `sprint12-check.csv` to hand (sent in the chat). It holds four questions:
   - Q1 保存データはどのように暗号化していますか？ (Japanese; a Japanese entry answers it)
   - Q2 通信中のデータはどのように保護していますか？ (Japanese; only an English entry answers it)
   - Q3 How is multi-factor authentication enforced for staff?
   - Q4 How quickly are critical vulnerabilities fixed?

All cases use one account:

| User | Email | Password | Role |
|---|---|---|---|
| Sarah Chen | sarah.chen@example.com | LocalDev2026pw | Admin |

Sarah is an admin on purpose: case 7 checks that an admin's approval does **not** make a translation trusted knowledge.

## Test cases

### 1. Japanese entries are labelled (S12-1, test 4)

**Flow**

1. Sign in as Sarah.
2. On the overview, open **KB**.
3. Search for `KB-0101`, then for `KB-0001`.

**Expected outcome**

- KB-0101 (保存データはどのように暗号化していますか？) shows a **Japanese** label.
- KB-0001 (the English entry on encrypting data at rest) has no language label.
- The knowledge base has 130 entries.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. Seeded translations wait for review (S12-5)

**Flow**

1. Open **Governance**, then the **Entries to review** tab.

**Expected outcome**

- The 30 Japanese entries (KB-0101 to KB-0130) are listed first, each marked **Japanese**.
- Each says "Machine translation of KB-00nn (English) in the demo data, from sample-data/security-qa-ja.csv. A translation is reviewed before it is trusted".
- KB-0101 says it is a translation of KB-0001.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. Upload and process the four questions

**Flow**

1. On **Opportunities**, choose **New Opportunity**, name it `Sprint 12 check`, and choose **Create**.
2. Drop `sprint12-check.csv` on the upload area.
3. In **Map Your Columns**, keep the `Question` column and choose **Match and draft**.
4. Wait for **Matching and drafting** to finish. The first run indexes all 130 entries, so it is slower than usual.

**Expected outcome**

- All four questions are processed, with no error message.
- None is left marked **Not processed yet**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Japanese from Japanese is held, and still says the entry needs review (S12-2 test 3; review fix L5)

**Flow**

1. Open Q1 (保存データは…).

**Expected outcome**

- The badge reads **Japanese: review individually**.
- The reason also says "Also: Cites KB-0101, not reviewed by an admin yet".
- The draft is in Japanese and has no "Translated from" label.
- **KB Sources** lists KB-0101 with the **Japanese** label.

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Japanese from English is translated and labelled (S12-2 test 1)

**Flow**

1. Open Q2 (通信中のデータは…).

**Expected outcome**

- The badge reads **Translated draft**.
- The reason starts "Japanese question, answered from English entries".
- The draft ends with "[Translated from English knowledge-base entries. A Japanese speaker should review it before it is sent.]".

**Result:** ☐ Pass ☐ Fail. Notes:

### 6. English questions and bulk approval (S12-2 tests 4 and 5)

**Flow**

1. Open Q3 and Q4 and note each badge, if any, and the entries under **KB Sources**.
2. Look at the bulk approval bar.

**Expected outcome**

- If a question cites only English entries, it behaves as before Sprint 12: either no badge, or the usual one for its confidence or checker verdict.
- If it cites a Japanese entry (KB-0101 onwards), it shows **Translated draft** and its draft ends with "[Translated from Japanese knowledge-base entries. …]".
- The bulk bar never counts Q1 or Q2 as eligible. Note which you saw for Q3 and Q4; either is correct.

**Result:** ☐ Pass ☐ Fail. Notes:

### 7. Translations are learned, but wait for review even when an admin approved them (S12-3 tests 2 and 5; review fix M2)

**Flow**

1. **Accept** each of the four questions as it is. For a question with no draft, choose **Write an answer**, type a short answer, then **Save & Accept**.
2. Choose **Record export** on the bulk bar.
3. Read the knowledge-base line in the panel that appears.
4. Open **Governance**, then **Entries to review**, and scroll to the bottom.

**Expected outcome**

- The knowledge-base line includes "1 proposed as replacements for existing entries, waiting for an admin to review". This is Q1: its answer is close to KB-0101, so it waits beside it rather than replacing it.
- The line also includes "1 added as translations of existing entries, waiting for an admin to review". This is Q2. It says 2 if Q3 or Q4 was translated in case 6.
- At the bottom of **Entries to review** are two new entries, both marked **Japanese**:
  - Q1's says "Translated from KB-0001 (English) in a response; answer approved by Sarah Chen. A translation is reviewed before it is trusted, whoever approved it", and shows that it would replace KB-0101.
  - Q2's says the same, naming its English entry.
- KB-0101 is still listed and still waiting: it was not replaced.

**Result:** ☐ Pass ☐ Fail. Notes:

### 8. Approving a translation makes it trusted (S12-3 test 5)

**Flow**

1. In **Entries to review**, choose **Approve** on the entry learned from Q2.
2. Open **KB** and search for the Q2 question.

**Expected outcome**

- The entry leaves **Entries to review**.
- In **KB** it shows the **Japanese** label and is no longer marked **Not yet reviewed**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 9. The introduction mentions languages (S12-5)

**Flow**

1. Open **Help**, choose **Show the introduction**, and go to the step **How a draft is made**.

**Expected outcome**

- It includes "Questions and entries can be in English or Japanese. A draft written from entries in the other language is labelled as translated, and is always reviewed one at a time."

**Result:** ☐ Pass ☐ Fail. Notes:

## When you have finished

Reply "all good", or give the numbers of any failed cases, with a screenshot of what you saw. Then I run the close: backlog, risk register, refinement, README, the merge to main, and the project docs.
