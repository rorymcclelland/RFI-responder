# Sprint 13 test pack: finishing the language work

**Local test data only.** The account below exists only in the local seed (`supabase/seed.sql`) on your PC. Nothing here is a real credential.

Branch `sprint-13`, commit `b4d2dbf` or later. About 15 minutes. No API keys are used beyond the usual ones for processing; the calibration story needs nothing from you (it was measured from the cached checks of your Sprint 12 run).

## Before you start

1. Start **Docker Desktop** and wait until it says it is running.
2. In `C:\Code\rfi-responder`, in three PowerShell windows:
   1. `npx supabase db reset`. This applies the Sprint 13 migration and reloads the seed.
   2. `npx supabase functions serve`, left running.
   3. `npm run dev`, left running. Open http://127.0.0.1:5173.
3. The two files you upload are in the repository:
   - `sample-data\checks\sprint-13-questions.csv`: the four questions from the Sprint 12 check (Q1 and Q2 in Japanese).
   - `sample-data\checks\sprint-13-import.csv`: three knowledge-base rows.

All cases use one account:

| User | Email | Password | Role |
|---|---|---|---|
| Sarah Chen | sarah.chen@example.com | LocalDev2026pw | Admin |

## Test cases

### 1. Process and answer the four questions

**Flow**

1. Sign in as Sarah.
2. On **Opportunities**, choose **New Opportunity**, name it `Sprint 13 check`, and choose **Create**.
3. Upload `sprint-13-questions.csv`, keep the `Question` column, and choose **Match and draft**. Wait for it to finish.
4. Open Q2 (通信中のデータは…) and check its draft ends with "[Translated from English knowledge-base entries. …]".
5. Open Q4 (How quickly are critical vulnerabilities fixed?), choose **Edit First**, and add this sentence in the middle of the answer: `Details are available [References: on request] under NDA.` Then **Save & Accept**.
6. **Accept** the other three. If one has no draft, choose **Write an answer**, write a line, then **Save & Accept**.
7. Choose **Record export**.

**Expected outcome**

- All four questions are processed and accepted, and the export is recorded.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. The Excel export sends only the answer (S13-1, tests 1, 2, 3 and 6)

**Flow**

1. Choose **Excel (.xlsx)** and open the file.
2. Read the **RFI Responses** sheet, then the **Provenance** sheet.

**Expected outcome**

- On **RFI Responses**, no answer contains "[References:" followed by KB numbers, and none contains "[Translated from".
- Q4's answer still contains your sentence "Details are available [References: on request] under NDA." unchanged.
- **Provenance** has a last column, **Translation**: Q2's row reads "drafted from English entries". Q1's is empty (a Japanese answer from a Japanese entry is not a translation). Q3 and Q4 are empty unless their draft was marked **Translated draft**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. CSV and Word carry the same (S13-1, test 6)

**Flow**

1. Choose **CSV (.csv)** and open it.
2. Choose **Word (.doc)** and open it.

**Expected outcome**

- The CSV's last column is `translation`, with "drafted from English entries" on Q2's row; no answer carries the label or a KB reference list.
- In the Word file, the table under "How each answer was produced" has a **Translation** column with the same value for Q2, and the answers carry no label or KB reference list.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Import duplicates are judged per language (S13-2, tests 1 to 3)

**Flow**

1. On the overview, open **KB**, choose **Import Q&A**, and choose `sprint-13-import.csv`.
2. Map the question column to `Question` and the answer column to `Answer`, choose **Preview Import**, then **Import 3 Entries**.
3. Search the knowledge base for `encrypt data at rest`.

**Expected outcome**

- The message reads "1 entry added to the knowledge base; 2 duplicates skipped."
- The search shows the original English entry, KB-0001, and a new entry with the same English question but a Japanese answer, marked **Japanese**.
- No second copy of KB-0101 (保存データは…) and no second English copy of KB-0001.

**Result:** ☐ Pass ☐ Fail. Notes:

## When you have finished

Reply "all good", or give the numbers of any failed cases, with a screenshot of what you saw. Then I close the sprint: backlog, risk register, refinement, README, the merge to main, and the project docs.
