// Sprint 18: each answer's story, and asking the knowledge base. Test numbers refer to docs/refinement/sprint-18.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

const ROOT = join(__dirname, '../../..');
let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

describe('S18-1 entry numbers past KB-9999 (BUG-42)', () => {
  it('1 and 4. the demo keeps every number, starting at KB-0001', async () => {
    await asSuperuser(readFileSync(join(ROOT, 'supabase/demo-hosted.sql'), 'utf8'));
    const r = await one<{ min: string; max: string; n: number; bad: number }>(
      `SELECT min(ref) AS min, max(ref) AS max, count(*)::int AS n,
              count(*) FILTER (WHERE ref <> 'KB-' || lpad(seq::text, 4, '0'))::int AS bad FROM kb_entries`);
    expect(r).toMatchObject({ min: 'KB-0001', bad: 0 });
    expect(r.n).toBeGreaterThan(100);
  });

  it('2. KB-9999 is followed by KB-10000, and both are saved', async () => {
    await asSuperuser(`SELECT setval(pg_get_serial_sequence('public.kb_entries', 'seq'), 9998)`);
    const add = (q: string) => one<{ ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ($1, 'Yes.', '{}', 'manual', $2) RETURNING ref`, [q, admin.id]);
    expect((await add('Numbering 9999 (S18-1)?')).ref).toBe('KB-9999');
    expect((await add('Numbering 10000 (S18-1)?')).ref).toBe('KB-10000');
    expect((await add('Numbering 10001 (S18-1)?')).ref).toBe('KB-10001');
    expect(await as(member, async (q) => (await q(`SELECT count(*)::int AS n FROM kb_entries WHERE ref IN ('KB-9999', 'KB-10000')`)).rows[0].n)).toBe(2);
  });

  it('the number stays unique and generated: nobody can set it', async () => {
    const { rows } = await asSuperuser(`SELECT is_generated, generation_expression FROM information_schema.columns WHERE table_name = 'kb_entries' AND column_name = 'ref'`);
    expect(rows[0].is_generated).toBe('ALWAYS');
    const u = await asSuperuser(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'kb_entries' AND indexdef ILIKE '%UNIQUE%(ref)%'`);
    expect(u.rows[0].n).toBe(1);
  });
});

type Detail = {
  entry: { ref: string; state: string; due: string; replacedBy: string | null; proposalFor: string | null; translatedFrom: string[] | null };
  proposal: { ref: string } | null;
  replaced: { ref: string }[];
  translations: { ref: string }[];
  used: { response: string; question: string; status: string; edited: boolean; outcome: string | null }[];
  usedCount: number;
  history: { action: string; actor: string | null; details: Record<string, unknown> }[];
};
const detail = (u: TestUser | null, ref: string, q?: (sql: string, p?: unknown[]) => Promise<{ rows: { d: Detail }[] }>) =>
  q ? q(`SELECT public.entry_detail($1) AS d`, [ref]).then((r) => r.rows[0].d)
    : as(u, async (qq) => (await qq(`SELECT public.entry_detail($1) AS d`, [ref])).rows[0].d as Detail);

describe('S18-2 one answer and its history (K-2)', () => {
  let a: { id: string; ref: string };
  let opp: string;
  beforeAll(async () => {
    a = await entry({ question: 'Do you encrypt backups (S18-2)?', answer: 'Yes, with AES-256.', createdBy: admin.id, origin: 'manual' });
    opp = await response(member.id, { name: 'Bluefin (S18-2)' });
    const s = await session(opp);
    await question(s, { text: 'Are backups encrypted?', sources: [a.ref], cited: [a.ref] });
    const accepted = await question(s, { text: 'Backup encryption?', sources: [a.ref], cited: [a.ref], final: 'Yes, always.' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [accepted]);
    await question(s, { text: 'Not citing it', sources: [], cited: [] });
    // Approved unedited: final_answer left empty, as the app does.
    const unedited = await question(s, { text: 'Backups encrypted, unedited?', sources: [a.ref], cited: [a.ref] });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [unedited]);
  });

  it('1. shows its use in every response that cited it, matching a direct count', async () => {
    const d = await detail(member, a.ref);
    expect(d.entry).toMatchObject({ ref: a.ref, state: 'reviewed' });
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM rfi_questions WHERE cited_refs @> ARRAY[$1]`, [a.ref]);
    expect(d.usedCount).toBe(n.n);
    expect(d.used).toHaveLength(3);
    expect(d.used.find((u) => u.question === 'Backups encrypted, unedited?')).toMatchObject({ status: 'accepted', edited: false });
    expect(d.used.find((u) => u.question === 'Backup encryption?')).toMatchObject({ response: 'Bluefin (S18-2)', status: 'accepted', edited: true });
    expect(d.used.find((u) => u.question === 'Are backups encrypted?')).toMatchObject({ status: 'pending', edited: false });
  });

  it('1. shows a proposed change waiting beside it, and the proposal names what it would change', async () => {
    const p = await one<{ ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of)
       VALUES ('Do you encrypt backups (S18-2)?', 'Yes, AES-256, keys rotated yearly.', '{}', 'RFI response: Bluefin (S18-2)', 'response',
               'response:x/session:y/question:z', $1, $2) RETURNING ref`, [member.id, a.id]);
    expect((await detail(member, a.ref)).proposal).toMatchObject({ ref: p.ref });
    expect((await detail(member, p.ref)).entry).toMatchObject({ state: 'proposal', proposalFor: a.ref });
    await asSuperuser(`DELETE FROM kb_entries WHERE ref = $1`, [p.ref]);
  });

  it('2. a correction shows in the history with the earlier text; marking it still correct moves the review date on', async () => {
    await as(admin, async (q) => {
      const before = (await detail(null, a.ref, q)).entry.due;
      await q(`SELECT public.review_entry($1, NULL, 'Yes, with AES-256 and yearly key rotation.')`, [a.id]);
      let d = await detail(null, a.ref, q);
      const reviewed = d.history.filter((h) => h.action === 'kb.reviewed');
      expect(reviewed.at(-1)).toMatchObject({ actor: admin.id, details: { edited: true, previous: { answer: 'Yes, with AES-256.' } } });
      await q(`SELECT public.review_entry($1)`, [a.id]);
      d = await detail(null, a.ref, q);
      expect(d.history.filter((h) => h.action === 'kb.reviewed').at(-1)?.details).toMatchObject({ edited: false });
      expect(new Date(d.entry.due).getTime()).toBeGreaterThan(new Date(before).getTime());
    });
  });

  it('2. a change of tags or source and a confirmation by an export show in the history', async () => {
    await as(admin, async (q) => {
      await q(`UPDATE kb_entries SET tags = '{backup}' WHERE id = $1`, [a.id]);
      const qid = (await q(`SELECT id FROM rfi_questions WHERE question = 'Backup encryption?'`)).rows[0].id;
      await asSuperuser(`INSERT INTO audit_log (actor, action, target_id, details) VALUES ($1, 'kb.confirmed', $2, $3)`,
        [admin.id, qid, JSON.stringify({ refs: [a.ref], approver: admin.id })]);
      const d = await detail(null, a.ref, q);
      expect(d.history.find((h) => h.action === 'kb.changed')?.details).toMatchObject({ after: { tags: ['backup'] } });
      expect(d.history.find((h) => h.action === 'kb.confirmed')?.details).toEqual({ response: 'Bluefin (S18-2)', question: 'Backup encryption?' });
    });
  });

  it('3. a replaced entry names what replaced it, and the new one what it replaced', async () => {
    const old = await entry({ question: 'Old backup question (S18-2)?', createdBy: admin.id });
    const nu = await entry({ question: 'New backup question (S18-2)?', createdBy: admin.id });
    await asSuperuser(`UPDATE kb_entries SET superseded_by = $1 WHERE id = $2`, [nu.id, old.id]);
    expect((await detail(member, old.ref)).entry).toMatchObject({ state: 'replaced', replacedBy: nu.ref });
    expect((await detail(member, nu.ref)).replaced).toEqual([{ ref: old.ref, question: 'Old backup question (S18-2)?' }]);
  });

  it('4. a translation names its original, and the original lists it', async () => {
    const t = await one<{ ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, origin, created_by, translated_from) VALUES ('バックアップを暗号化していますか（S18-2）？', 'はい、AES-256 で暗号化しています。', '{}', 'seed', NULL, $1) RETURNING ref`, [[a.ref]]);
    expect((await detail(member, t.ref)).entry).toMatchObject({ translatedFrom: [a.ref], state: 'translation' });
    expect((await detail(member, a.ref)).translations).toEqual([expect.objectContaining({ ref: t.ref, language: 'ja' })]);
  });

  it('5. a member and an admin see the same page; anonymous visitors and the service role get nothing', async () => {
    expect(await detail(member, a.ref)).toEqual(await detail(admin, a.ref));
    await refused(detail(null, a.ref));
    expect(await refused(asServiceRole((q) => q(`SELECT public.entry_detail($1)`, [a.ref])))).toMatch(/permission denied/);
    // The audit log itself stays admin-only: a member reads no rows of it.
    expect(await as(member, async (q) => (await q(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n)).toBe(0);
    // The page's actions stay an admin's: the database refuses a member however they are asked.
    await refused(as(member, (q) => q(`SELECT public.review_entry($1)`, [a.id])));
    await refused(as(member, (q) => q(`UPDATE kb_entries SET tags = '{x}' WHERE id = $1`, [a.id]).then((r) => { if (!r.rowCount) throw new Error('no rows'); })));
    // The helper is not in the API's schema, and an anonymous caller cannot use it.
    await refused(as(null, (q) => q(`SELECT * FROM access.entry_events($1)`, [a.id])));
    const def = await one<{ definer: boolean; config: string[] }>(`SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname = 'entry_detail'`);
    expect(def).toEqual({ definer: false, config: ['search_path=""'] });
  });

  it('5. the history holds only that entry\'s own knowledge-base events', async () => {
    await asSuperuser(`INSERT INTO audit_log (actor, action, target_id, details) VALUES
        ($1, 'settings.changed', $2, $3),
        ($1, 'user.admin_granted', $2, $3),
        ($1, 'kb.reviewed', gen_random_uuid(), $3)`, [admin.id, a.id, JSON.stringify({ ref: a.ref, refs: [a.ref] })]);
    // A confirmation that names its number from before it existed (the demo's numbers restart at a reset).
    await asSuperuser(`INSERT INTO audit_log (at, actor, action, target_id, details) VALUES (now() - interval '10 years', $1, 'kb.confirmed', gen_random_uuid(), $2)`,
      [admin.id, JSON.stringify({ refs: [a.ref] })]);
    const d = await detail(member, a.ref);
    expect(d.history.every((h) => h.action.startsWith('kb.'))).toBe(true);
    const ids = await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'kb.%' AND target_id = $1`, [a.id]);
    expect(d.history.filter((h) => h.action !== 'kb.confirmed')).toHaveLength(ids.n);
  });

  it('6. an unknown or malformed number gives nothing', async () => {
    for (const r of ['KB-99999', 'nonsense', '', "KB-0001'; DROP TABLE kb_entries; --"]) expect(await detail(member, r)).toBeNull();
    expect(await detail(member, a.ref.toLowerCase())).not.toBeNull();
  });

  it('8. an answer cited by 5,000 questions returns quickly', async () => {
    const s = await session(opp);
    await asSuperuser(`INSERT INTO rfi_questions (session_id, position, question, cited_refs) SELECT $1, g, 'Q' || g, ARRAY[$2] FROM generate_series(1, 5000) g`, [s, a.ref]);
    const t = Date.now();
    const d = await detail(member, a.ref);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(d.usedCount).toBeGreaterThanOrEqual(5000);
    expect(d.used).toHaveLength(100);
  }, 60000);
});
