# Providers

Checked 23 October 2026 (Sprint 4) and rechecked 24 October 2026 (Sprint 7). Rechecked at every sprint close; a change goes into the risk register (R-11) and `ai_prices`.

On 24 October the Anthropic terms were read on the page itself. The Anthropic and Voyage pricing and FAQ pages could not be fetched from the build environment, so the prices were compared with secondary sources instead ([TechEnclave, 10 October 2026](https://techenclave.com/news/items/claude-haiku-5-5-launches-with-0-10-input-pricing-for-shorter-prompts); [CostBench](https://www.costbench.com/software/embedding-apis/voyage-ai/)), which agree with the figures below; check the official pages before relying on them.

## Terms on training and retention

| Provider | Claim | Source | Checked |
|---|---|---|---|
| Anthropic | The commercial terms (effective 17 June 2025) say Anthropic "may not train models on Customer Content from Services"; customer content includes inputs and outputs | https://www.anthropic.com/legal/commercial-terms | 2026-10-24 |
| Anthropic | The commercial terms do not themselves set a retention period; processing is under a separate Data Processing Addendum | https://www.anthropic.com/legal/commercial-terms | 2026-10-23 |
| Voyage AI | Customers can opt out of Voyage storing and using API data for future training, which gives zero-day retention; the opt-out is a slider under `Organization`, `Terms of Service` in the dashboard, and needs an admin with a payment method on file | https://docs.voyageai.com/docs/faq | 2026-10-23 |
| Voyage AI | The FAQ does not state the default; treat it as opted in until the opt-out is switched on (risk R-11, planned control) | https://docs.voyageai.com/docs/faq | 2026-10-23 |
| Voyage AI (through MongoDB Atlas) | When Voyage models are used through MongoDB Atlas, data collection for model training is a per-organisation setting in Atlas | https://www.mongodb.com/docs/voyageai/management/model-training-data/ | 2026-10-23 |

## Prices

Stored in `ai_prices` (shown on the Governance page), in US dollars per million tokens, as published:

| Provider | Claim | Source | Checked |
|---|---|---|---|
| Anthropic | Claude Haiku 5.5: $0.10 input (prompts up to 100,000 tokens), $0.50 output | https://platform.claude.com/docs/en/about-claude/pricing | 2026-10-23 |
| Anthropic | Claude Sonnet 5.5: $2 input, $10 output | https://platform.claude.com/docs/en/about-claude/pricing | 2026-10-23 |
| Voyage AI | voyage-4: $0.06; the first 200 million tokens free per account | https://docs.voyageai.com/docs/pricing | 2026-10-23 |
| Voyage AI | rerank-2.5: $0.05 (the page is inconsistent on a free allowance) | https://docs.voyageai.com/docs/pricing | 2026-10-23 |

The app prices every prompt at the lower Haiku input rate; its prompts are a few thousand tokens, far below 100,000. The free Voyage allowance is not deducted, so estimates err high.

## Spend limits

The app's own caps (S4-1) stop processing at 300 questions per person per day and £10 a month by default. Set a spending limit in each provider's console as well, so a bug in the app cannot spend past it.
