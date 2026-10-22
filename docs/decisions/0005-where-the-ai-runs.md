# 0005 Where the AI runs (spike S0-9)

Date: 22 October 2026. Status: **agreed** at the Sprint 0 review (22 October 2026): option C, provider switch; Rory provides Voyage and Anthropic keys; Japanese test questions machine-translated and labelled unreviewed. Time box: half a day.

## Question

Sprints 1 and 2 need an embedding model (to find knowledge-base entries that mean the same as a question) and a drafting model (to write a grounded answer from them). Where they run decides the architecture, the privacy story, the cost and whether a hosted demo is possible. From 22 October the choice must also handle **English and Japanese** (backlog candidate C-1): a question in one language must find an answer stored in the other.

## What was checked

- **Supabase's built-in model is out.** Edge Functions can run `gte-small` with no external service, but Supabase's own documentation says it "exclusively caters to English texts" and truncates at 512 tokens. It fails the multilingual criterion.
- **Local models through Ollama.** Supabase Edge Functions can call a self-managed Ollama server (`AI_INFERENCE_API_HOST`). Ollama offers `qwen3-embedding` (0.6B, 4B, 8B; "100+ languages", cross-lingual retrieval; the 8B model ranked first on the MTEB multilingual leaderboard in June 2025) and `bge-m3` (a widely used multilingual baseline). Rory's PC (RTX 5080, Ollama installed) can run either.
- **Hosted embeddings.** Voyage AI's `voyage-4` is general-purpose and multilingual, listed at about $0.06 per million input tokens with a 32K context. Other hosted multilingual options exist (for example OpenAI's and Cohere's); Voyage is the one Anthropic's documentation points to for embeddings.
- **Drafting.** Claude, through the Anthropic API, called from an Edge Function so the key never reaches the browser. It writes Japanese as well as English. A local model through Ollama is possible but drafting quality, especially for faithful citation, is the part most likely to suffer.
- **pgvector** is available on hosted Supabase and in the local Supabase stack, so embeddings can live in `kb_entries` beside the text.

This workspace cannot download model weights, so no live English–Japanese test was possible in the spike. That test becomes the first task of Sprint 1, on the evaluation set Sprint 1 builds anyway.

## Options

| | A. All local (Ollama) | B. All hosted (Voyage + Claude) | C. Provider switch, hosted by default |
|---|---|---|---|
| Privacy | Nothing leaves Rory's PC | Synthetic RFI text goes to two providers | Either, per deployment |
| Japanese | qwen3-embedding / bge-m3 claim it; to be measured | voyage-4 claims it; Claude drafts it | Measured for both |
| Hosted demo | Not possible: a hosted app cannot reach Ollama on Rory's PC | Yes | Yes (hosted mode) |
| Cost per typical RFI (40 questions) | Electricity | Embeddings: a fraction of a cent. Drafting: roughly 80K input and 10K output tokens, a few pence on a Haiku-class model (exact prices confirmed in Sprint 2) | As B, or zero in local mode |
| Set-up effort | Ollama on the machine running Supabase | Two API keys as Edge Function secrets | One more small interface (~half a day) |
| Interview story | Strong privacy story, weak demo | Easy demo, standard story | Shows the trade-off was designed for, as in Job Scout |

## Recommendation

**Option C.** All AI calls go through Supabase Edge Functions behind two small interfaces (`embed(texts)` and `draft(question, sources)`), selected by configuration:

- **Hosted mode (default, used for the demo):** Voyage embeddings and Claude drafting.
- **Local mode:** Ollama embeddings (and optionally drafting) when the stack runs on Rory's PC, for the privacy story.

Store the embedding model's name and dimension with each vector, so switching models triggers a re-embed rather than silently mixing vectors from different models.

**Pick the embedding model by measurement, not by leaderboard.** At the start of Sprint 1, run `voyage-4`, `qwen3-embedding` and `bge-m3` over the Sprint 1 evaluation set: English questions against English entries, and Japanese questions against English entries. Report recall@5 and MRR, and choose the best one that meets the bar.

## What it needs from Rory

1. Agreement to option C.
2. API keys for Voyage and Anthropic before Sprint 1 and 2 respectively (spend expected to be pennies; only synthetic data is sent).
3. For local mode and the bake-off: running one script on his PC against Ollama, since this workspace cannot download models.

## Sources

- Supabase, Running AI models in Edge Functions: https://supabase.com/docs/guides/functions/ai-models
- Ollama library, qwen3-embedding: https://registry.ollama.ai/library/qwen3-embedding
- OpenRouter listing, voyage-4: https://openrouter.ai/voyageai/voyage-4
