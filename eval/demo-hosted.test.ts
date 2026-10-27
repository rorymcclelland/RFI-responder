// Sprint 14, S14-2: demo data a hosted project can load (test numbers from docs/refinement/sprint-14.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, demoUsersFromSeed, hostedDemoSql, hostedResetSql } from './demo-hosted';
import { ROOT } from './lib';

const seed = readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8');
const hosted = readFileSync(join(ROOT, 'supabase/demo-hosted.sql'), 'utf8');
const reset = readFileSync(join(ROOT, 'supabase/demo-hosted-reset.sql'), 'utf8');

describe('S14-2 hosted demo data', () => {
  it('the committed files are what the generator writes from the committed seed', () => {
    expect(hosted).toBe(hostedDemoSql(seed));
    expect(reset).toBe(hostedResetSql(seed));
  });

  it('1. contains no password, no development password, no sign-in identity and no @example.com address', () => {
    for (const f of [hosted, reset]) {
      expect(f).not.toMatch(/LocalDev|crypt\(|gen_salt\(|auth\.identities|@example\.com\b/);
      expect(f).toMatch(/banned_until/);
    }
  });

  it('keeps the same people, knowledge base and responses as the local seed', () => {
    expect(demoUsersFromSeed(seed)).toHaveLength(8);
    // Twice: the load itself, then the same load kept as the reload script (Sprint 15, S15-4).
    expect(hosted.match(/'sample-data\/security-qa(-ja)?\.csv'/g)).toHaveLength(4);
    for (const name of [...seed.matchAll(/WHERE name = '([^']+)'/g)].map((m) => m[1])) expect(hosted).toContain(name);
  });

  it('the reset removes responses and entries only, inside one transaction', () => {
    expect(reset).toMatch(/^BEGIN;$/m);
    expect(reset).toMatch(/^TRUNCATE public\.opportunities, public\.kb_entries RESTART IDENTITY CASCADE;$/m);
    expect(reset).toMatch(/^COMMIT;$/m);
    expect(reset).not.toMatch(/TRUNCATE[^;]*(audit_log|user_profiles|auth\.users|ai_settings|ai_usage)/);
  });

  it('4. refuses anything that would let someone sign in as a fictional person', () => {
    expect(() => check("crypt('x', gen_salt('bf'))")).toThrow(/password/);
    expect(() => check("'LocalDev2026pw'")).toThrow(/password/);
    expect(() => check('sarah.chen@example.com')).toThrow(/example\.com/);
    expect(() => check('INSERT INTO auth.identities')).toThrow(/identities/);
  });
});

describe('S15-4 the demo keeps its own reload script', () => {
  const stored = (f: string) => f.match(/\$demo_reload\$\n([\s\S]*?)\n\$demo_reload\$/)?.[1];
  it('both files store exactly the load they run', () => {
    const load = stored(hosted);
    expect(load).toBeTruthy();
    expect(hosted).toContain(`${load}\n\n-- Keep this load`);
    expect(stored(reset)).toBe(load);
  });

  it('the store is skipped, not failed, on a database without the Sprint 15 migration', () => {
    expect(hosted).toMatch(/IF to_regclass\('private\.demo_reload'\) IS NULL THEN[\s\S]*?RETURN;/);
  });
});
