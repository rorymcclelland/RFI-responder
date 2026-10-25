import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/retrieval.ts'],
      exclude: ['**/*.test.ts', 'src/lib/supabase.ts', 'src/lib/database.types.ts'],
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: { name: 'unit', include: ['src/**/*.test.ts', 'eval/**/*.test.ts', 'supabase/functions/**/*.test.ts', 'supabase/tests/*.test.ts', 'docs/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' },
      },
      {
        // Needs a Postgres superuser connection in DB_TEST_URL; see supabase/tests/db/harness.ts.
        test: {
          name: 'db',
          include: ['supabase/tests/db/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
