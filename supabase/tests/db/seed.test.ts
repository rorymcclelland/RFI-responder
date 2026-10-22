// Sprint 0, story S0-6: the development seed loads on top of the migrations.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asSuperuser, buildDatabase, closePool } from './harness';

beforeAll(() => buildDatabase({ seed: true }));
afterAll(closePool);

describe('dev seed (supabase/seed.sql)', () => {
  it('creates the eight sample users with complete profiles', async () => {
    const r = await asSuperuser<{ display_name: string; job_title: string; tags: number }>(
      `SELECT display_name, job_title, cardinality(expertise_tags) AS tags FROM user_profiles ORDER BY display_name`,
    );
    expect(r.rowCount).toBe(8);
    for (const p of r.rows) {
      expect(p.job_title).not.toBe('');
      expect(p.tags).toBeGreaterThan(0);
    }
  });

  it('makes exactly one admin', async () => {
    const r = await asSuperuser<{ display_name: string }>(`SELECT display_name FROM user_profiles WHERE is_admin`);
    expect(r.rows.map((x) => x.display_name)).toEqual(['Sarah Chen']);
  });

  it('can be loaded twice without duplicating anything', async () => {
    const { readFileSync } = await import('node:fs');
    await asSuperuser(readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8'));
    const r = await asSuperuser<{ n: string }>('SELECT count(*) AS n FROM auth.users');
    expect(Number(r.rows[0].n)).toBe(8);
  });
});
