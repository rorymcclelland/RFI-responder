/**
 * Sprint 20 (S20-1, S20-2): refuses a run that points anywhere it must not (support.ts), before any
 * browser opens. On staging the demo data is reset first by CI (scripts/e2e-staging-users.ts), so every
 * run starts from the same data, as a local run does after `npx supabase db reset`.
 */
import { targetProblem } from './support';

export default function globalSetup() {
  const problem = targetProblem();
  if (problem) throw new Error(problem);
}
