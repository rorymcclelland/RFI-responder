# Sample data (synthetic)

Everything in this folder is **synthetic demo data**, generated for the prototype. None of it comes from a real company's questionnaire, policies or customers (project rule 2).

| File | What it is | Use |
|---|---|---|
| `security-qa.csv` | 100 security questions with answers, tags and an invented policy name as the source | Import into the knowledge base (Knowledge base > Bulk upload) |
| `security-qa-ja.csv` | 30 of those entries in Japanese, numbered as their English originals. Written by Claude: machine translations, not reviewed by a native reader | The language evaluation (`npm run eval:languages`) |
| `checks/` | Small files for the hand checks in `docs/testing/` (four questions, two in Japanese; three knowledge-base rows to import) | Uploaded in a test pack's steps |
| `sample-questions.csv` | 40 security questions without answers, as a customer might send them | Upload into a response to see drafting and review |
| `demo-plan.json` | Four fictional responses, one per stage (new, in review, exported, archived), with their questions and what happens to them | `npm run demo:record` processes them with the real pipeline into `supabase/demo-recording.json`; `npm run demo:seed` writes them and `security-qa.csv` into `supabase/seed.sql` |
