# Sprint 25 review

Local run: build `5194d29` on sprint-25, 2026-11-06T12:06:48Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42214407338).
Staging run: build `e6d8b92` on sprint-25, 2026-11-06T11:53:18Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42211802480).

## Sprint 25: The live app only after its database, and the Sprint 24 review's follow-ups

**Running the checks yourself: once.** In PowerShell, in C:\Code\rfi-responder, on the sprint's branch: npm install -g npm@11, then npm ci. For browser tests, once: npx playwright install chromium.

**Running the checks yourself: database and browser tests.** Start Docker Desktop, then npx supabase start (the local Supabase stack). For database tests, point them at its database: $env:DB_TEST_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'. They make, and drop, their own database called rfi_test there. For browser tests, reset the demo data first: npm run db:reset (the tests change it). Playwright starts the app itself.

### S25-1 The live app only after its database

What visitors see on the live demo always matches its database: new screens go live only after the deploy is approved and the migrations they need are in.

| Case | What was checked | Result |
|---|---|---|
| S25-1 1 | A push to main builds no deployment on Vercel (scripts/deploy-order.test.ts (vercel.json); on 7 November Vercel built nothing for the pushes of main (70c182c, 31dde04), read with the connector) | Checked in CI |
| S25-1 2 | With the deploy waiting for approval, the live demo still serves the previous commit (read with the connector on 7 November while Deploy run 42264207268 waited: the live demo kept b5a41bd) | By hand |
| S25-1 3 | After approval: migrations and functions, then live moves, then Vercel builds it, and the check finds the commit served (Deploy run 42385184404 (7 November): functions, then live moved b5a41bd..31dde04, then the check found 31dde04 served; the first run, 42264207268, stopped at moving live and left the previous app; the order is checked in CI by scripts/deploy-order.test.ts) | By hand |
| S25-1 4 | If a migration or function step fails, live does not move and the live demo keeps the previous app (scripts/deploy-order.test.ts (the live step comes after them and runs only if every earlier step succeeded; seen failing with always() and with the steps swapped); Sprint 23 showed a failing migration stops the run) | Checked in CI |
| S25-1 5 | The live demo keeps its production settings and address (checked with the Vercel connector: on 6 November the live demo's variables are on Production with no branch attached; on 7 November its production build came from live and is served at rfi-responder.vercel.app) | By hand |
| S25-1 6 | DEPLOYING.md and the risk register say what happens, and how to roll back (read by the independent QA and security reviews (Sprint 25); CI checks only that the docs' links and paths hold (docs/docs.test.ts, docs/governance/governance.test.ts)) | By hand |

**S25-1 1, how to check it again.**

```
npm test -- scripts/deploy-order.test.ts
```
1. deploy-order.test.ts: the whole file (no test in it names S25-1 1).

**S25-1 2, how to check it again.**

read with the connector on 7 November while Deploy run 42264207268 waited: the live demo kept b5a41bd

**S25-1 3, how to check it again.**

Deploy run 42385184404 (7 November): functions, then live moved b5a41bd..31dde04, then the check found 31dde04 served; the first run, 42264207268, stopped at moving live and left the previous app; the order is checked in CI by scripts/deploy-order.test.ts

**S25-1 4, how to check it again.**

```
npm test -- scripts/deploy-order.test.ts
```
1. deploy-order.test.ts: the whole file (no test in it names S25-1 4).

**S25-1 5, how to check it again.**

checked with the Vercel connector: on 6 November the live demo's variables are on Production with no branch attached; on 7 November its production build came from live and is served at rfi-responder.vercel.app

**S25-1 6, how to check it again.**

read by the independent QA and security reviews (Sprint 25); CI checks only that the docs' links and paths hold (docs/docs.test.ts, docs/governance/governance.test.ts)

### S25-2 The per-file functions out of the API

A response is sent, and approved in bulk, only as a whole: the older one-file functions cannot be called to get round it.

| Case | What was checked | Result |
|---|---|---|
| S25-2 1 | An owner, an admin, a member, a visitor and the service role are each refused both per-file functions (supabase/tests/db/sprint25.test.ts) | Checked in CI |
| S25-2 2 | The whole-response functions still work, learn, close assignments and write the audit log (supabase/tests/db/sprint25.test.ts (owner and admin); sprint24.test.ts, unchanged (learning, the audit log); sprint5.test.ts and workflow.test.ts, moved to the whole-response function (closing assignments)) | Checked in CI |
| S25-2 3 | Every older test that called the per-file functions still proves what it proved (the full database suite: 76 calls in 12 files moved to the whole-response functions, none deleted (docs/refinement/sprint-25.md, While building)) | Checked in CI |
| S25-2 4 | The demo loaders still build the demo (supabase/tests/db/seed.test.ts and demo-seed.test.ts, and CI's local stack) | Checked in CI |
| S25-2 5 | The app calls neither function (src/lib/wholeResponse.test.ts) | Checked in CI |

**S25-2 1, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint25.test.ts -t "S25-2 1"
```
1. sprint25.test.ts: S25-2 1: the per-file functions are refused to every caller through the API
2. sprint25.test.ts: S25-2 1: whatever their signature (security review, I2)

**S25-2 2, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint25.test.ts -t "S25-2 2"
```
1. sprint25.test.ts: S25-2 2: the whole-response functions still work for the owner and an admin

**S25-2 3, how to check it again.**

the full database suite: 76 calls in 12 files moved to the whole-response functions, none deleted (docs/refinement/sprint-25.md, While building)

**S25-2 4, how to check it again.**

```
npm run test:db -- supabase/tests/db/seed.test.ts
```
1. seed.test.ts: the whole file (no test in it names S25-2 4).

**S25-2 5, how to check it again.**

```
npm test -- src/lib/wholeResponse.test.ts -t "S25-2 5"
```
1. wholeResponse.test.ts: the app calls no per-file function (S25-2 5)

### S25-3 Spike: sending a large response on the hosted database

We know how large a response can be marked as sent within the hosted database's time limit, and why it slows down.

| Case | What was checked | Result |
|---|---|---|
| S25-3 1 | The figures on staging and the cause are written down, with a recommended fix (docs/spikes/f73-sending-large-responses.md: staging Deploy run 42207780200 on the throwaway branch sprint-25-f73 (rolled back, nothing left), and the local profile) | By hand |

**S25-3 1, how to check it again.**

docs/spikes/f73-sending-large-responses.md: staging Deploy run 42207780200 on the throwaway branch sprint-25-f73 (rolled back, nothing left), and the local profile

