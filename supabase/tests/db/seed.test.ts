// Sprint 0, story S0-6: the development seed loads on top of the migrations.
import { readFileSync } from 'node:fs';
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

  // Sprint 7 (S7-5): the 100 synthetic entries the evaluations use, in file order, so refs match.
  it('adds the 100 synthetic knowledge-base entries, reviewed, owned by the admin, numbered as in the CSV', async () => {
    const r = await asSuperuser<{ n: string; origins: string[]; owners: string; unreviewed: string; first: string }>(
      `SELECT count(*) AS n, array_agg(DISTINCT origin::text) AS origins, count(DISTINCT created_by) AS owners,
              count(*) FILTER (WHERE reviewed_at IS NULL) AS unreviewed,
              (SELECT question FROM kb_entries WHERE ref = 'KB-0001') AS first
         FROM kb_entries WHERE origin = 'seed' AND language = 'en'`,
    );
    expect(r.rows[0]).toEqual({ n: '100', origins: ['seed'], owners: '1', unreviewed: '0', first: 'How does your organization encrypt data at rest?' });
  });

  it('S12-5: then the 30 Japanese entries, KB-0101 onwards, each naming the entry it translates and waiting for review', async () => {
    const r = await asSuperuser<{ n: string; unreviewed: string; first: string; last: string; bad: string }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE reviewed_at IS NULL) AS unreviewed, min(ref) AS first, max(ref) AS last,
              count(*) FILTER (WHERE translated_from IS NULL
                OR NOT EXISTS (SELECT 1 FROM kb_entries o WHERE o.ref = ANY (kb_entries.translated_from) AND o.language = 'en')) AS bad
         FROM kb_entries WHERE language = 'ja'`,
    );
    expect(r.rows[0]).toEqual({ n: '30', unreviewed: '30', first: 'KB-0101', last: 'KB-0130', bad: '0' });
  });

  it('adds the demo responses in seed.sql, each owned by its creator', async () => {
    const seeded = (readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8').match(/^DO \$demo\$/gm) ?? []).length;
    expect(seeded).toBeGreaterThanOrEqual(1);
    const r = await asSuperuser<{ n: string }>(
      `SELECT count(*) AS n FROM opportunities WHERE owner_id = created_by AND owner_id IS NOT NULL`,
    );
    expect(Number(r.rows[0].n)).toBe(seeded);
  });

  it('can be loaded twice without duplicating anything', async () => {
    const before = await asSuperuser<{ users: string; kb: string; opps: string }>(
      `SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM kb_entries) AS kb,
              (SELECT count(*) FROM opportunities) AS opps`,
    );
    await asSuperuser(readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8'));
    const after = await asSuperuser<{ users: string; kb: string; opps: string }>(
      `SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM kb_entries) AS kb,
              (SELECT count(*) FROM opportunities) AS opps`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0].users).toBe('8');
  });
});
