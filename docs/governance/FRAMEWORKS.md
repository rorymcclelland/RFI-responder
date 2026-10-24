# Frameworks

A light mapping, written 23 October 2026, to show where the controls sit against two common references. It is not a conformity assessment and not legal advice; an organisation deploying the tool would take its own advice.

## NIST AI Risk Management Framework 1.0

The framework organises AI risk work into four functions ([NIST AI RMF 1.0, January 2023](https://www.nist.gov/itl/ai-risk-management-framework); see also the Generative AI Profile, [NIST AI 600-1, July 2024](https://doi.org/10.6028/NIST.AI.600-1)).

| Function | What it asks | Where it is in RFI Respond |
|---|---|---|
| Govern | Policies, roles, accountability, a culture of managing risk | Project rules and the backlog (`docs/BACKLOG.md`); recorded decisions (`docs/decisions/`); a named owner for every risk ([risk register](RISK-REGISTER.md)); an independent security review each sprint; every approval, export, archive, deletion, review and setting change in the audit log |
| Map | Understand the context, the intended use and who could be harmed | [Product brief](../PRODUCT.md) (users, workflow, non-goals); the model card's "must not be used for"; the risk register's likelihood and impact |
| Measure | Test and track performance, trustworthiness and risk | Evaluation sets and reports (`docs/evals/`): retrieval, answerability, calibration, gates, drafting faithfulness, red team, near-duplicate threshold; database tests for every row of the role matrix; usage recorded per call |
| Manage | Act on the risks: prioritise, respond, monitor | Gates that keep pricing, legal, unchecked, translated and weakly sourced questions out of bulk approval; review of member entries and overdue entries; cost caps; residuals accepted by name at sprint reviews; follow-ups ranked in the backlog |

## EU AI Act (Regulation (EU) 2024/1689)

Status as checked: the AI Digital Omnibus entered into force on 27 July 2026 ([Usercentrics, updated 31 July 2026](https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/)). It moved the high-risk obligations to 2 December 2027 (Annex III) and 2 August 2028 (Annex I). Most Article 50 transparency duties still apply from 2 August 2026; providers of generative systems already on the market before that date have until 2 December 2026 for machine-readable marking under Article 50(2) ([Jones Walker, 16 July 2026](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html)). Regulation text: [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj).

An organisation that builds and runs this tool for itself would likely be both the **provider** of the AI system and its **deployer**. Drafting answers to procurement questionnaires is not among the Annex III high-risk uses.

| Duty | Applies? | Where it stands |
|---|---|---|
| AI literacy for staff (Article 4, since February 2025) | Yes, for the deploying organisation | The interface says what each figure means and who wrote each answer; the model card describes limits. Training staff is the organisation's job |
| Telling people they are interacting with an AI system (Article 50(1)) | Not directly: staff use it as a drafting tool and are told so; customers receive answers a person approved | Drafts are labelled as written by a language model; edited answers say a person edited them (Sprint 3 review) |
| Marking AI-generated text in a machine-readable way (Article 50(2), providers) | Possibly. The drafter generates text, and the exception for assistive editing tools may not cover it; whether marking is needed for an internal tool whose output a person approves and sends as the organisation's own answer is not settled here | Inside the app every answer records whether a model drafted it, which model and prompt, and who approved it. Since Sprint 7 (F-27) every exported file carries that record in machine-readable form: Excel document properties (`ai-generated: yes, partially or no`) and a Provenance sheet, Word `<meta>` tags and a table at the end, and an `answer_origin` column in CSV. Whether this meets Article 50(2) for this tool is not settled here |
| Disclosing AI-generated text published to inform the public (Article 50) | No: answers go to one customer, not the public, and a person holds editorial responsibility | |
| High-risk obligations (Chapter III) | No (not an Annex III use) | |
