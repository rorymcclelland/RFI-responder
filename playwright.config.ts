/**
 * Sprint 20 (S20-1): browser acceptance tests. `npm run test:e2e` runs them against the local app and
 * the local Supabase stack (started with `npx supabase start`, loaded with `npx supabase db reset`);
 * CI does the same on every push, and against staging after a staging deploy (E2E_TARGET=staging).
 *
 * One worker, in file order: the tests share one database, as people share one app. No retries (Q4 of
 * the refinement): a test that fails once is reported as failed, never hidden by a pass on a re-run.
 */
import { defineConfig } from '@playwright/test';

const staging = process.env.E2E_TARGET === 'staging';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e-results/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e-results/results.json' }],
    ['html', { outputFolder: 'e2e-results/report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    screenshot: 'on',
    trace: 'retain-on-failure',
    // A little slower than a machine would go, so the recordings can be followed (S20-4).
    launchOptions: { slowMo: Number(process.env.E2E_SLOW_MO ?? 150) },
  },
  globalSetup: './e2e/global-setup.ts',
  webServer: staging || process.env.E2E_NO_SERVER ? undefined : {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
