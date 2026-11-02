# 0008 Claude as the QA team: browser tests, staging, and a demo to sign off

Date: 2 November 2026. Status: agreed at the Sprint 20 refinement (Rory, Q1 to Q4).

**Context.** Until Sprint 19, each sprint ended with a test pack that Rory ran by hand on the hosted demo, about 40 to 60 minutes a sprint. Each pack ran once, so nothing re-checked an earlier sprint's flows when later work changed the screens around them. Both of Sprint 18's live failures were deployment slips (a migration that failed only on the hosted push, and a function not deployed), not faults in the code. Rory asked to work as he had with a QA team: they test, then demonstrate the working functionality at the end of the sprint, and he signs off the business value.

**Decision.**
1. **Refinement is unchanged:** Rory agrees each sprint's test cases before anything is built. That is where his judgement of quality goes in.
2. **The agreed cases become browser tests** ([`e2e/`](../../e2e)), written before the code, run on every push in CI against the real Supabase stack with the AI providers off, and kept: every later sprint re-runs them. One worker, no retries, so a test that fails once is reported as failed.
3. **A separate reviewer** (an agent that did not build the code) checks the tests against the agreed cases and adds edge cases, beside the security review.
4. **Staging** is a second Supabase project with the app at one Vercel address. A push to a sprint branch deploys there by itself, checks the deploy, and runs the browser tests there with test people made for the run; one step per run uses the real AI model (Q2).
5. **The live demo** is deployed by the same workflow when `main` moves, after Rory approves it in GitHub (Q1).
6. **The sprint review is a demo page** (Q3): each story with what changed for the user, its recordings, and every agreed case with its result. A case takes Passed or Failed only from a browser test that ran; anything else says how it was checked, or shows as not checked. Rory watches it and signs off, or raises points.
7. **Hand checks remain** for what cannot be automated (judgement of wording and look, which the demo covers) and for stories flagged high risk at refinement; they come as a test pack, as before.

**Consequences.**
- Rory's time per sprint becomes the refinement, the demo page and a short look at the live demo.
- Writing and keeping the browser tests costs build time each sprint; a flaky test is fixed or removed in the sprint it appears, never left.
- The tests check what was thought of. The demo stays a human review, so Rory judges whether it is the right thing, not only whether it works.
- Claude never signs in to a hosted site: staging sign-ins happen only in CI code, with a password made for the run that nobody sees.
- Sprint 19 is the first sprint signed off this way (Q4).
