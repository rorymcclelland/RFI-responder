# Sprint 25 review

Local run: build `5194d29` on sprint-25, 2026-11-06T12:06:48Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42214407338).
Staging run: build `e6d8b92` on sprint-25, 2026-11-06T11:53:18Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42211802480).

## Sprint 25: The live app only after its database, and the Sprint 24 review's follow-ups

### S25-1 The live app only after its database

What visitors see on the live demo always matches its database: new screens go live only after the deploy is approved and the migrations they need are in.

| Case | What was checked | Result |
|---|---|---|
| S25-1 1 | A push to main builds no deployment on Vercel (scripts/deploy-order.test.ts (vercel.json); Vercel's list of deployments after the merge, read with the connector, is added at the close) | Checked in CI |
| S25-1 2 | With the deploy waiting for approval, the live demo still serves the previous commit (pending: read with the connector while the first production run after the merge waits for Rory's approval) | By hand |
| S25-1 3 | After approval: migrations and functions, then live moves, then Vercel builds it, and the check finds the commit served (pending: the first production run after the merge, from its log; the order itself is checked in CI by scripts/deploy-order.test.ts) | By hand |
| S25-1 4 | If a migration or function step fails, live does not move and the live demo keeps the previous app (scripts/deploy-order.test.ts (the live step comes after them and runs only if every earlier step succeeded; seen failing with always() and with the steps swapped); Sprint 23 showed a failing migration stops the run) | Checked in CI |
| S25-1 5 | The live demo keeps its production settings and address (checked with the Vercel connector on 6 November: the live demo's variables are on Production with no branch attached; the address is checked again after the switch) | By hand |
| S25-1 6 | DEPLOYING.md and the risk register say what happens, and how to roll back (read by the independent QA and security reviews (Sprint 25); CI checks only that the docs' links and paths hold (docs/docs.test.ts, docs/governance/governance.test.ts)) | By hand |

### S25-2 The per-file functions out of the API

A response is sent, and approved in bulk, only as a whole: the older one-file functions cannot be called to get round it.

| Case | What was checked | Result |
|---|---|---|
| S25-2 1 | An owner, an admin, a member, a visitor and the service role are each refused both per-file functions (supabase/tests/db/sprint25.test.ts) | Checked in CI |
| S25-2 2 | The whole-response functions still work, learn, close assignments and write the audit log (supabase/tests/db/sprint25.test.ts (owner and admin); sprint24.test.ts, unchanged (learning, the audit log); sprint5.test.ts and workflow.test.ts, moved to the whole-response function (closing assignments)) | Checked in CI |
| S25-2 3 | Every older test that called the per-file functions still proves what it proved (the full database suite: 76 calls in 12 files moved to the whole-response functions, none deleted (docs/refinement/sprint-25.md, While building)) | Checked in CI |
| S25-2 4 | The demo loaders still build the demo (supabase/tests/db/seed.test.ts and demo-seed.test.ts, and CI's local stack) | Checked in CI |
| S25-2 5 | The app calls neither function (src/lib/wholeResponse.test.ts) | Checked in CI |

### S25-3 Spike: sending a large response on the hosted database

We know how large a response can be marked as sent within the hosted database's time limit, and why it slows down.

| Case | What was checked | Result |
|---|---|---|
| S25-3 1 | The figures on staging and the cause are written down, with a recommended fix (docs/spikes/f73-sending-large-responses.md: staging Deploy run 42207780200 on the throwaway branch sprint-25-f73 (rolled back, nothing left), and the local profile) | By hand |

