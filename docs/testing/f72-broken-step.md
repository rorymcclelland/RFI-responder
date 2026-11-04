# F-72: the main path test, seen failing on a broken step (Sprint 24, S24-3)

Run 4 November 2026, as agreed at the Sprint 24 refinement (Q5: CI only, no staging).

**The break.** On the throwaway branch `f72-broken-step` (commit `e5ad969`, never merged), the colleague's **Approve** in **Questions for you** returned before saving anything (`approveAssigned` in `src/lib/myAssignments.ts`), with no error shown: the quietest way a step can break.

**The run.** [CI run 41919882875](https://github.com/rorymcclelland/RFI-responder/actions/runs/41919882875), on the branch's local stack. The database tests and the migrations passed; the unit tests and the browser tests failed.

## S24-3 1: the main path test fails at the colleague's step, naming it

The main path test (`e2e/sprint-23-main-path.spec.ts`) failed at step 3, the colleague answering and approving, and went no further:

```
Locator: getByRole('complementary', { name: 'The question' }).getByText(/Approved/).first()
Expected: visible
  63 |   await panel.getByRole('button', { name: 'Approve', exact: true }).click();
> 64 |   await expect(panel.getByText(/Approved/).first()).toBeVisible();
```

The run's log names the test, the line and the step's own check, with a screenshot of the colleague's panel. Nothing after the break was reached, so no later step passed on a question the colleague never approved.

## S24-3 2: what else failed

Every other failure uses the same step, or the data it should have left:

| Failed | Why |
|---|---|
| `e2e/sprint-19.spec.ts` "Approve, and when the owner was quicker" | The same **Approve** in **Questions for you** |
| `e2e/sprint-21.spec.ts` "Gaps: …" | It expects the phishing question approved by a colleague in the Sprint 19 test to show "Answered, learned when sent"; the break left it "Not answered yet" |
| `src/lib/myAssignments.test.ts`, 3 tests | The unit tests of `approveAssigned` itself: no database call, and no refusal where one is expected |

The other 30 browser tests passed.

## S24-3 3: the break never reaches `main`

The branch was never merged; `main` does not contain `e5ad969`. The branch is Rory's to delete (the workspace cannot delete branches).
