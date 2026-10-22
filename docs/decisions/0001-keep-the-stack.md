# 0001 Keep React, Vite and Supabase

Date: 22 October 2026. Status: agreed.

**Context.** The prototype was generated with Bolt.new: React 18 with TypeScript, Vite, Tailwind, and Supabase (Postgres, auth, row-level security). The upgrade could have started again on another stack.

**Decision.** Keep it. The stack is mainstream and suits the job: Postgres row-level security is a good fit for the role matrix (0003), pgvector covers retrieval (0005), and Edge Functions keep AI keys server-side. Rewriting would spend the time on plumbing instead of the product.

**Consequences.** Large Bolt-generated components (`RFIWorkspace.tsx`, 870 lines) stay for now and are split when Sprint 2 rewrites the drafting path. `.bolt/` is removed.
