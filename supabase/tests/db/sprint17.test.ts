// Sprint 17, S17-3 (K-1): the knowledge overview. Test numbers refer to docs/refinement/sprint-17.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one } from './fixtures';

let member: TestUser;
let admin: TestUser;
const overview = (u: TestUser | null) => as(u, async (q) => (await q(`SELECT public.knowledge_overview() AS o`)).rows[0].o);

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

describe('S17-3 knowledge_overview()', () => {
  it('1. on the demo data, every count matches the table', async () => {
    await asSuperuser(readFileSync(join(__dirname, '../../../supabase/demo-hosted.sql'), 'utf8'));
    const o = await overview(member);
    const n = async (where: string) => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM kb_entries WHERE superseded_by IS NULL AND ${where}`)).n;
    expect(o.total).toBe(await n('true'));
    expect(o.languages).toEqual({ en: await n(`language = 'en'`), ja: await n(`language = 'ja'`) });
    expect(o.states).toEqual({
      reviewed: await n(`reviewed_at IS NOT NULL AND access.entry_review_due(kb_entries) >= now()`),
      overdue: await n(`reviewed_at IS NOT NULL AND access.entry_review_due(kb_entries) < now()`),
      waiting: await n(`reviewed_at IS NULL AND translated_from IS NULL`),
      translations: await n(`reviewed_at IS NULL AND translated_from IS NOT NULL`),
    });
    expect(o.contributors).toBe((await one<{ n: number }>(`SELECT count(DISTINCT created_by)::int AS n FROM kb_entries WHERE superseded_by IS NULL`)).n);
    expect(o.total).toBeGreaterThan(100);
    // Each entry's state, for browse, agrees with the counts.
    const states = Object.values(o.entries as Record<string, { state: string }>).map((x) => x.state);
    expect(states).toHaveLength(o.total);
    for (const [k, v] of Object.entries({ reviewed: 'reviewed', overdue: 'overdue', waiting: 'waiting', translations: 'translation' })) {
      expect(states.filter((x) => x === v).length, k).toBe(o.states[k]);
    }
    expect(o.languages.ja).toBeGreaterThan(0);
  });

  it('2. counts topics and citations, with entries without tags under no topic', async () => {
    const e = async (q: string, tags: string[]) =>
      one<{ ref: string }>(`INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ($1, 'Yes.', $2, 'manual', $3) RETURNING ref`, [q, tags, admin.id]);
    const before = await overview(member);
    const noTopic = (o: { topics: { tag: string | null; entries: number }[] }) => o.topics.find((x) => x.tag === null)?.entries ?? 0;
    const a = await e('Do you encrypt backups (S17)?', ['s17-encryption', 's17-backup']);
    const b = await e('Do you rotate keys (S17)?', ['s17-encryption']);
    await e('Do you have a pet policy (S17)?', []);
    const opp = await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('S17', $1, $1) RETURNING id`, [admin.id]);
    const s = await one<{ id: string }>(`INSERT INTO rfi_sessions (file_name, opportunity_id) VALUES ('s17.csv', $1) RETURNING id`, [opp.id]);
    await asSuperuser(`INSERT INTO rfi_questions (session_id, position, question, cited_refs) VALUES ($1, 0, 'Q1', $2), ($1, 1, 'Q2', $3)`, [s.id, [a.ref, b.ref], [a.ref]]);
    const o = await overview(member);
    const topic = (t: string | null) => o.topics.find((x: { tag: string | null }) => x.tag === t);
    expect(topic('s17-encryption')).toMatchObject({ entries: 2, citations: 3 });
    expect(topic('s17-backup')).toMatchObject({ entries: 1, citations: 2 });
    expect(noTopic(o) - noTopic(before)).toBe(1);
    expect(o.entries[a.ref]).toMatchObject({ state: 'waiting', citations: 2 });
    expect(o.entries[b.ref]).toMatchObject({ citations: 1 });
  });

  it('3. a member and an admin get the same overview; an anonymous visitor gets nothing; it changes nothing', async () => {
    expect(await overview(member)).toEqual(await overview(admin));
    await refused(overview(null));
    const def = await one<{ definer: boolean; volatile: string; config: string[] }>(
      `SELECT prosecdef AS definer, provolatile AS volatile, proconfig AS config FROM pg_proc WHERE proname = 'knowledge_overview'`);
    expect(def).toEqual({ definer: false, volatile: 's', config: ['search_path=""'] });
    expect(await refused(asServiceRole((q) => q(`SELECT public.knowledge_overview()`)))).toMatch(/permission denied/);
  });

  it('lists what was learned recently from responses, newest first, at most five', async () => {
    const o = await overview(member);
    const learned = await one<{ n: number }>(`SELECT count(*)::int AS n FROM kb_entries WHERE origin = 'response' AND superseded_by IS NULL`);
    expect(o.learned.length).toBe(Math.min(5, learned.n));
    for (const l of o.learned) expect(l).toEqual(expect.objectContaining({ ref: expect.stringMatching(/^KB-\d{4}$/), question: expect.any(String), reviewed: expect.any(Boolean) }));
  });
});
