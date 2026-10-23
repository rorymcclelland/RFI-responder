# Governance pack

What RFI Respond does with AI, how it was measured, what can go wrong, which control answers each risk, and how data is handled. Written 23 October 2026 (Sprint 4, story S4-5) for anyone assessing the tool: an interviewer, an auditor, a future maintainer.

Every claim here points at code, a test or an evaluation report in this repository, and three automated tests keep the pack honest (`governance.test.ts`, run with the unit tests):

1. every control in the risk register names test files that exist;
2. every evaluation figure in the model card appears in the report it cites;
3. every provider claim has a source link and the date it was checked.

Controls that are planned rather than built are labelled **planned**. Nothing here is legal advice.

| Document | What it covers |
|---|---|
| [Model card](MODEL-CARD.md) | Each model's job, versions, measured performance, limits and what it must not be used for |
| [Risk register](RISK-REGISTER.md) | Risks, likelihood and impact, controls with the tests that prove them, residuals, owners |
| [Data handling and retention](DATA-HANDLING.md) | What data exists, where, who can see it, what goes to which provider, how long it is kept |
| [Providers](PROVIDERS.md) | Provider terms on training and retention, prices, spend limits, all with sources and dates |
| [Frameworks](FRAMEWORKS.md) | Light mapping to NIST AI RMF 1.0 and the EU AI Act's transparency duties |

Related decisions: [0003 access control](../decisions/0003-access-control.md), [0005 where the AI runs](../decisions/0005-where-the-ai-runs.md), [0006 retrieval defaults](../decisions/0006-retrieval-defaults.md), [0007 answerability and drafting defaults](../decisions/0007-answerability-and-drafting-defaults.md).
