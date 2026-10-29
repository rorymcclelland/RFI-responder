// Sprint 18: each answer's story, and asking the knowledge base. Test numbers refer to docs/refinement/sprint-18.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';
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

describe('S18-3 retire an answer, or decline a proposed change (K-2)', () => {
  const retire = (u: TestUser | null, id: string, reason: string | null = 'The certificate lapsed in 2026.') =>
    as(u, (q) => q(`SELECT public.retire_entry($1, $2)`, [id, reason]));
  const commitRetire = async (id: string, reason = 'The certificate lapsed in 2026.') => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: admin.id, role: 'authenticated' }), admin.id]);
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT public.retire_entry($1, $2)`, [id, reason]);
      await c.query('COMMIT');
    } finally { c.release(); }
  };
  const matched = async (text: string) => (await as(member, (q) => q(`SELECT ref FROM match_kb_entries(NULL, $1, 20, NULL)`, [text]))).rows.map((r) => r.ref as string);

  it('1. retiring records who, when and why (audited), and the answer is no longer matched', async () => {
    const e = await entry({ question: 'Are you certified to the zebracorn standard (S18-3)?', answer: 'Yes, zebracorn certified.', createdBy: admin.id });
    expect(await matched('zebracorn standard')).toContain(e.ref);
    await commitRetire(e.id);
    expect(await matched('zebracorn standard')).not.toContain(e.ref);
    const r = await one<{ retired_by: string; retired_reason: string; at: boolean }>(`SELECT retired_by, retired_reason, retired_at IS NOT NULL AS at FROM kb_entries WHERE id = $1`, [e.id]);
    expect(r).toEqual({ retired_by: admin.id, retired_reason: 'The certificate lapsed in 2026.', at: true });
    const a = await one<{ details: Record<string, unknown>; actor: string }>(`SELECT details, actor FROM audit_log WHERE action = 'kb.retired' AND target_id = $1`, [e.id]);
    expect(a).toMatchObject({ actor: admin.id, details: { ref: e.ref, reason: 'The certificate lapsed in 2026.', declined: false } });
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM pending_embeddings('voyage-4', 500) WHERE id = $1`, [e.id])).n).toBe(0);
    const d = await detail(member, e.ref);
    expect(d.entry).toMatchObject({ state: 'retired', retiredReason: 'The certificate lapsed in 2026.' });
    expect(d.history.at(-1)).toMatchObject({ action: 'kb.retired' });
  });

  it('2. a pending question citing it is held, saying why; an approved one is left alone', async () => {
    const e = await entry({ question: 'Retired and cited (S18-3)?', createdBy: admin.id });
    const s = await session(await response(admin.id));
    const pending = await question(s, { cited: [e.ref], sources: [e.ref], text: 'Pending, citing it (S18-3)?' });
    const done = await question(s, { cited: [e.ref], sources: [e.ref], text: 'Approved, citing it (S18-3)?' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [done]);
    await commitRetire(e.id);
    const g = await asSuperuser<{ id: string; gate: string | null; gate_reason: string | null }>(`SELECT id, gate, gate_reason FROM rfi_questions WHERE id = ANY($1)`, [[pending, done]]);
    const by = new Map(g.rows.map((r) => [r.id, r]));
    expect(by.get(pending)).toMatchObject({ gate: 'stale_source', gate_reason: `Cites ${e.ref} (retired), so it is reviewed individually.` });
    expect(by.get(done)!.gate).toBeNull();
    // Bulk approval leaves it, whatever the stored gate says.
    await asSuperuser(`UPDATE rfi_questions SET gate = NULL, gate_reason = NULL WHERE id = $1`, [pending]);
    await as(admin, async (q) => {
      await q(`SELECT bulk_accept($1, 0)`, [s]);
      expect((await q(`SELECT status FROM rfi_questions WHERE id = $1`, [pending])).rows[0].status).toBe('pending');
    });
  });

  it('3. an export close to a retired answer adds a new entry; it never confirms or replaces the retired one', async () => {
    const e = await entry({ question: 'Which SIEM do you use (S18-3)?', answer: 'We use SIEM-A.', createdBy: admin.id });
    await commitRetire(e.id, 'We moved to another SIEM.');
    const s = await session(await response(admin.id));
    const qid = await question(s, { cited: [e.ref], sources: [e.ref], text: 'What SIEM do you run (S18-3)?', final: 'We use SIEM-B now.' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', judge_best_ref = $2, sources_json = $3 WHERE id = $1`,
      [qid, e.ref, JSON.stringify([{ id: e.ref, score: 0.99 }])]);
    // The same question as the retired one, approved unedited, would confirm it if it were current.
    const same = await question(s, { cited: [e.ref], sources: [e.ref], text: 'Which SIEM do you use (S18-3)?' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', judge_best_ref = $2 WHERE id = $1`, [same, e.ref]);
    await as(admin, async (q) => {
      await q(`SELECT record_export($1)`, [s]);
      const k = (await q(`SELECT superseded_by, last_reviewed_at FROM kb_entries WHERE id = $1`, [e.id])).rows[0];
      expect(k).toEqual({ superseded_by: null, last_reviewed_at: null });
      const out = (await q(`SELECT learn_outcome FROM rfi_questions WHERE id = $1`, [qid])).rows[0].learn_outcome;
      expect(out).toBe('added');
    });
  });

  it('4. its question is free for a new answer; restoring then is refused with the reason, and without a clash restore brings it back', async () => {
    const e = await entry({ question: 'Do you have an office in Leeds (S18-3)?', answer: 'Yes, in Leeds.', createdBy: admin.id });
    await commitRetire(e.id, 'The Leeds office closed.');
    await as(admin, async (q) => {
      await q(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Do you have an office in Leeds (S18-3)?', 'No, it closed.', '{}', 'manual')`);
      expect(await refused(q(`SELECT public.restore_entry($1)`, [e.id]))).toMatch(/Another current answer now has this question/);
    });
    await as(admin, async (q) => {
      await q(`SELECT public.restore_entry($1)`, [e.id]);
      expect((await q(`SELECT ref FROM match_kb_entries(NULL, 'office in Leeds', 20, NULL)`)).rows.map((r) => r.ref)).toContain(e.ref);
      const a = (await q(`SELECT details FROM audit_log WHERE action = 'kb.restored' AND target_id = $1`, [e.id])).rows;
      expect(a).toHaveLength(1);
      expect((await q(`SELECT retired_at FROM kb_entries WHERE id = $1`, [e.id])).rows[0].retired_at).toBeNull();
    });
  });

  it('4. restoring releases the questions held only because they cited it', async () => {
    const e = await entry({ question: 'Restored and cited (S18-3)?', createdBy: admin.id });
    const s = await session(await response(admin.id));
    const pending = await question(s, { cited: [e.ref], sources: [e.ref], text: 'Held then released (S18-3)?' });
    await commitRetire(e.id);
    await as(admin, async (q) => {
      await q(`SELECT public.restore_entry($1)`, [e.id]);
      expect((await q(`SELECT gate FROM rfi_questions WHERE id = $1`, [pending])).rows[0].gate).toBeNull();
    });
  });

  it('5. retiring a proposal declines it: its entry shows no proposal, and the proposal says Retired with the reason', async () => {
    const target = await entry({ question: 'Do you patch monthly (S18-3)?', createdBy: admin.id });
    const p = await one<{ id: string; ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of)
       VALUES ('Do you patch monthly (S18-3)?', 'Weekly now.', '{}', 'RFI response: R', 'response', 'response:x/session:y/question:z', $1, $2) RETURNING id, ref`,
      [member.id, target.id]);
    expect((await detail(member, target.ref)).proposal).toMatchObject({ ref: p.ref });
    await commitRetire(p.id, 'We still patch monthly.');
    expect((await detail(member, target.ref)).proposal).toBeNull();
    expect((await detail(member, p.ref)).entry).toMatchObject({ state: 'retired', retiredReason: 'We still patch monthly.', proposalFor: target.ref });
    const a = await one<{ details: Record<string, unknown> }>(`SELECT details FROM audit_log WHERE action = 'kb.retired' AND target_id = $1`, [p.id]);
    expect(a.details).toMatchObject({ declined: true, proposal_for: target.ref });
    await refused(as(admin, (q) => q(`SELECT public.review_entry($1)`, [p.id])));
    const o = await as(member, async (q) => (await q(`SELECT public.knowledge_overview() AS o`)).rows[0].o);
    expect(o.learned.some((l: { ref: string }) => l.ref === p.ref)).toBe(false);
  });

  it('6. role matrix: only an admin retires or restores, and nobody sets the columns directly', async () => {
    const e = await entry({ question: 'Role matrix (S18-3)?', createdBy: admin.id });
    expect(await refused(retire(member, e.id))).toMatch(/Only an admin/);
    await refused(retire(null, e.id));
    expect(await refused(asServiceRole((q) => q(`SELECT public.retire_entry($1, 'Service role tries.')`, [e.id])))).toMatch(/permission denied/);
    for (const u of [member, admin]) {
      await refused(as(u, (q) => q(`UPDATE kb_entries SET retired_at = now(), retired_reason = 'Directly set.' WHERE id = $1`, [e.id])));
      await refused(as(u, (q) => q(`UPDATE kb_entries SET retired_reason = 'Directly set.' WHERE id = $1`, [e.id])));
    }
    await retire(admin, e.id);
    await commitRetire(e.id);
    expect(await refused(as(member, (q) => q(`SELECT public.restore_entry($1)`, [e.id])))).toMatch(/Only an admin/);
    await refused(asServiceRole((q) => q(`SELECT public.restore_entry($1)`, [e.id])));
    const defs = await asSuperuser<{ name: string; definer: boolean; config: string[] }>(
      `SELECT proname AS name, prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname IN ('retire_entry', 'restore_entry')`);
    for (const d of defs.rows) expect(d).toMatchObject({ definer: true, config: ['search_path=""'] });
  });

  it('7. a missing or short reason, an already retired answer and a replaced one are refused', async () => {
    const e = await entry({ question: 'Refusals (S18-3)?', createdBy: admin.id });
    for (const r of [null, '', '    ', 'no', 'x'.repeat(501)]) expect(await refused(retire(admin, e.id, r))).toMatch(/5 to 500 characters/);
    await commitRetire(e.id);
    expect(await refused(retire(admin, e.id))).toMatch(/already retired/);
    const old = await entry({ question: 'Replaced (S18-3)?', createdBy: admin.id });
    const nu = await entry({ question: 'Replacement (S18-3)?', createdBy: admin.id });
    await asSuperuser(`UPDATE kb_entries SET superseded_by = $1 WHERE id = $2`, [nu.id, old.id]);
    expect(await refused(retire(admin, old.id))).toMatch(/replaced by a newer one/);
    expect(await refused(retire(admin, '00000000-0000-0000-0000-000000000000'))).toMatch(/No such entry/);
  });

  it('8. the overview and its counts leave retired answers out, and list them as retired for the filter', async () => {
    const before = await as(member, async (q) => (await q(`SELECT public.knowledge_overview() AS o`)).rows[0].o);
    const e = await entry({ question: 'Overview counts (S18-3)?', createdBy: admin.id });
    const mid = await as(member, async (q) => (await q(`SELECT public.knowledge_overview() AS o`)).rows[0].o);
    expect(mid.total).toBe(before.total + 1);
    await commitRetire(e.id);
    const after = await as(member, async (q) => (await q(`SELECT public.knowledge_overview() AS o`)).rows[0].o);
    expect(after.total).toBe(before.total);
    expect(after.states.retired).toBe(before.states.retired + 1);
    expect(after.entries[e.ref]).toMatchObject({ state: 'retired' });
    expect(after.states.reviewed).toBe(before.states.reviewed);
  });

  it('every UPDATE in the new functions has a WHERE clause (pg_safeupdate)', async () => {
    const { rows } = await asSuperuser<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname IN ('retire_entry', 'restore_entry')`);
    for (const r of rows) for (const stmt of r.src.split(/;/).filter((x) => /\bUPDATE\b/i.test(x))) expect(stmt).toMatch(/\bWHERE\b/i);
  });
});

// Sprint 18 security review: the findings, each with a test that fails without its fix.
describe('Sprint 18 security review', () => {
  const asAdminCommit = async (sql: string, params: unknown[] = []) => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: admin.id, role: 'authenticated' }), admin.id]);
      await c.query('SET LOCAL ROLE authenticated');
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r;
    } finally { c.release(); }
  };

  it('M1. an export that approves a draft citing a retired answer never records it as confirmed', async () => {
    const gone = await entry({ question: 'Retired then cited (review M1)?', createdBy: admin.id });
    const kept = await entry({ question: 'Still current (review M1)?', createdBy: admin.id });
    const s = await session(await response(admin.id));
    const both = await question(s, { cited: [gone.ref, kept.ref], sources: [gone.ref, kept.ref], text: 'Cites both (review M1)?' });
    const only = await question(s, { cited: [gone.ref], sources: [gone.ref], text: 'Cites only the retired one (review M1)?' });
    await asAdminCommit(`SELECT public.retire_entry($1, 'Withdrawn for the review M1 test.')`, [gone.id]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', gate = NULL, gate_reason = NULL WHERE id = ANY($1)`, [[both, only]]);
    await asAdminCommit(`SELECT record_export($1)`, [s]);
    const out = await asSuperuser<{ id: string; learn_outcome: string }>(`SELECT id, learn_outcome FROM rfi_questions WHERE id = ANY($1)`, [[both, only]]);
    const by = new Map(out.rows.map((r) => [r.id, r.learn_outcome]));
    expect(by.get(both)).toBe('confirmed');
    expect(by.get(only)).toBe('not_confirmed_source');
    const logged = await asSuperuser<{ refs: string[] }>(`SELECT details->'refs' AS refs FROM audit_log WHERE action = 'kb.confirmed' AND target_id = ANY($1)`, [[both, only]]);
    expect(logged.rows.map((r) => r.refs)).toEqual([[kept.ref]]);
    const d = await detail(member, gone.ref);
    expect(d.history.some((h) => h.action === 'kb.confirmed')).toBe(false);
    expect((await detail(member, kept.ref)).history.some((h) => h.action === 'kb.confirmed')).toBe(true);
  });

  it('M2. process-questions is told a cited entry is retired', async () => {
    const e = await entry({ question: 'Status retired (review M2)?', createdBy: admin.id });
    await asAdminCommit(`SELECT public.retire_entry($1, 'Retired for the review M2 test.')`, [e.id]);
    const r = await asServiceRole((q) => q(`SELECT * FROM entry_review_status($1)`, [[e.ref]]));
    expect(r.rows[0]).toMatchObject({ ref: e.ref, reviewed: true, retired: true, replaced_by: null });
  });

  it('M2. a retired answer\'s question can be imported again, and the overdue report leaves it out', async () => {
    const longAgo = new Date(Date.now() - 900 * 864e5).toISOString();
    const e = await entry({ question: 'Import me again (review M2)?', createdBy: admin.id, createdAt: longAgo });
    const overdue = async () => (await as(admin, (q) => q(`SELECT ref FROM overdue_entries()`))).rows.map((r) => r.ref as string);
    expect(await overdue()).toContain(e.ref);
    await asAdminCommit(`SELECT public.retire_entry($1, 'Retired for the review M2 test.')`, [e.id]);
    expect(await overdue()).not.toContain(e.ref);
    const r = await as(member, (q) => q(`SELECT import_kb_entries($1::jsonb, 'import', 'again.csv') AS r`,
      [JSON.stringify([{ question: 'Import me again (review M2)?', answer: 'Yes, again.', tags: [], source: '' }])]));
    expect(r.rows[0].r).toMatchObject({ inserted: 1, duplicates: 0 });
  });

  it('M2. matching by meaning never returns a retired answer either', async () => {
    const dims = (await one<{ d: number }>(`SELECT atttypmod AS d FROM pg_attribute WHERE attrelid = 'kb_entries'::regclass AND attname = 'embedding'`)).d;
    const vec = `[${Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
    const e = await entry({ question: 'Vector match (review M2)?', createdBy: admin.id });
    await asSuperuser(`UPDATE kb_entries SET embedding = $1, embedding_model = 'review-model' WHERE id = $2`, [vec, e.id]);
    const byMeaning = async () => (await as(member, (q) => q(`SELECT ref FROM match_kb_entries($1, '', 20, 'review-model')`, [vec]))).rows.map((r) => r.ref as string);
    expect(await byMeaning()).toContain(e.ref);
    await asAdminCommit(`SELECT public.retire_entry($1, 'Retired for the review M2 test.')`, [e.id]);
    expect(await byMeaning()).not.toContain(e.ref);
  });

  it('L3. retiring an answer declines the changes proposed for it; approving one for a retired answer is refused', async () => {
    const target = await entry({ question: 'Proposal for a retired answer (review L3)?', createdBy: admin.id });
    const p = await one<{ id: string; ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of)
       VALUES ('Proposal for a retired answer (review L3)?', 'Changed.', '{}', 'RFI response: R', 'response', 'response:x/session:y/question:z', $1, $2) RETURNING id, ref`,
      [member.id, target.id]);
    // Even if a proposal were left waiting, approving it could not bring the retired answer back.
    await asSuperuser(`UPDATE kb_entries SET retired_at = now(), retired_reason = 'Set directly for the test.' WHERE id = $1`, [target.id]);
    expect(await refused(as(admin, (q) => q(`SELECT public.review_entry($1)`, [p.id])))).toMatch(/proposed for is retired/);
    await asSuperuser(`UPDATE kb_entries SET retired_at = NULL, retired_reason = NULL WHERE id = $1`, [target.id]);
    await asAdminCommit(`SELECT public.retire_entry($1, 'The answer is withdrawn.')`, [target.id]);
    const r = await one<{ retired: boolean; reason: string }>(`SELECT retired_at IS NOT NULL AS retired, retired_reason AS reason FROM kb_entries WHERE id = $1`, [p.id]);
    expect(r).toEqual({ retired: true, reason: `Declined because ${target.ref} was retired: The answer is withdrawn.` });
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'kb.retired' AND target_id = $1 AND (details->>'declined')::boolean`, [p.id])).n).toBe(1);
  });

  it('L5. a long history keeps its newest events', async () => {
    const e = await entry({ question: 'Long history (review L5)?', createdBy: admin.id });
    await asSuperuser(`INSERT INTO audit_log (at, actor, action, target_id, details)
      SELECT now() + (g || ' seconds')::interval, $1, 'kb.changed', $2, '{}'::jsonb FROM generate_series(1, 600) g`, [admin.id, e.id]);
    await asSuperuser(`INSERT INTO audit_log (at, actor, action, target_id, details) VALUES (now() + interval '1 hour', $1, 'kb.retired', $2, '{"reason":"Last of all."}')`, [admin.id, e.id]);
    const d = await detail(member, e.ref);
    expect(d.history).toHaveLength(500);
    expect(d.history.at(-1)).toMatchObject({ action: 'kb.retired' });
  });

  it('role matrix: restore_entry refuses an anonymous visitor; entry_events refuses the service role', async () => {
    const e = await entry({ question: 'Matrix gaps (review)?', createdBy: admin.id });
    await refused(as(null, (q) => q(`SELECT public.restore_entry($1)`, [e.id])));
    await refused(asServiceRole((q) => q(`SELECT * FROM access.entry_events($1)`, [e.id])));
    // A member calling the helper directly gets only that entry's knowledge-base events, as through the page.
    const r = await as(member, (q) => q(`SELECT action FROM access.entry_events($1)`, [e.id]));
    expect(r.rows.every((x) => String(x.action).startsWith('kb.'))).toBe(true);
  });
});
