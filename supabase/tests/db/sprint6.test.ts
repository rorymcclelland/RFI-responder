// Sprint 6: checker reliability. Test numbers refer to docs/refinement/sprint-6.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let admin: TestUser;
let owner: TestUser;
let member: TestUser;

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  owner = await createUser();
  member = await createUser();
});
afterAll(closePool);

describe('S6-3 the checker\'s reason is written by the server only', () => {
  it('1. no signed-in user can write judge_reason; the service role can, and members can read it', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s);
    for (const u of [member, owner, admin]) {
      await refused(as(u, (q) => q(`UPDATE rfi_questions SET judge_reason = 'planted' WHERE id = $1`, [id])));
    }
    await refused(as(owner, (q) => q(`INSERT INTO rfi_questions (session_id, position, question, judge_reason) VALUES ($1, 1, 'q', 'planted')`, [s])));
    // as() and asServiceRole() roll back, so the write is checked inside it and then made for real.
    const w = await asServiceRole((q) => q(`UPDATE rfi_questions SET judge_reason = 'KB-0001 names it.' WHERE id = $1`, [id]));
    expect(w.rowCount).toBe(1);
    await asSuperuser(`UPDATE rfi_questions SET judge_reason = 'KB-0001 names it.' WHERE id = $1`, [id]);
    const r = await as(member, (q) => q<{ judge_reason: string }>(`SELECT judge_reason FROM rfi_questions WHERE id = $1`, [id]));
    expect(r.rows[0].judge_reason).toBe('KB-0001 names it.');
  });

  it('a reason longer than 300 characters is refused', async () => {
    const id = await question(await session(await response(owner.id)));
    await refused(asServiceRole((q) => q(`UPDATE rfi_questions SET judge_reason = repeat('a', 301) WHERE id = $1`, [id])));
    expect((await one<{ n: string }>(`SELECT count(*) AS n FROM rfi_questions WHERE id = $1 AND judge_reason IS NULL`, [id])).n).toBe('1');
  });
});

describe('S6-4 reviewing an entry releases questions held for it (F-28)', () => {
  const longAgo = new Date(Date.now() - 600 * 864e5).toISOString();
  const gateOf = (q: (sql: string, p?: unknown[]) => Promise<{ rows: { gate: string | null; gate_reason: string | null }[] }>, id: string) =>
    q(`SELECT gate, gate_reason FROM rfi_questions WHERE id = $1`, [id]).then((r) => r.rows[0]);

  it('1. one unreviewed entry: the admin reviews it, the hold clears, bulk approval includes the question, and it is logged (8)', async () => {
    const e = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const s = await session(await response(owner.id));
    const id = await question(s, { gate: 'unreviewed_source', sources: [e.ref], cited: [e.ref], text: 'Held for one entry (S6-4 t1)?' });
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1)`, [e.id]);
      expect(await gateOf(q, id)).toEqual({ gate: null, gate_reason: null });
      const logged = await q<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE action = 'question.released' AND target_id = $1`, [id]);
      expect(logged.rows[0].n).toBe('1');
      const r = await q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept.accepted).toBe(1);
    });
  });

  it('2. two unreviewed entries, one reviewed: still held, naming the other', async () => {
    const a = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const b = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const id = await question(await session(await response(owner.id)), { gate: 'unreviewed_source', cited: [a.ref, b.ref], text: 'Held for two (S6-4 t2)?' });
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1)`, [a.id]);
      const g = await gateOf(q, id);
      expect(g.gate).toBe('unreviewed_source');
      expect(g.gate_reason).toContain(b.ref);
      expect(g.gate_reason).not.toContain(a.ref);
    });
  });

  it('3. one unreviewed and one overdue: reviewing the first leaves it held as overdue', async () => {
    const a = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const old = await entry({ createdAt: longAgo });
    const id = await question(await session(await response(owner.id)), { gate: 'unreviewed_source', cited: [a.ref, old.ref], text: 'Held for both (S6-4 t3)?' });
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1)`, [a.id]);
      const g = await gateOf(q, id);
      expect(g.gate).toBe('stale_source');
      expect(g.gate_reason).toContain(`${old.ref} (overdue for review since`);
    });
  });

  it('4 and 5. accepted or skipped questions, and questions in exported or archived responses, are not changed', async () => {
    const e = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const s = await session(await response(owner.id));
    const accepted = await question(s, { gate: 'unreviewed_source', cited: [e.ref], text: 'Accepted (S6-4 t4)?' });
    const skipped = await question(s, { gate: 'unreviewed_source', cited: [e.ref], text: 'Skipped (S6-4 t4)?' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [accepted]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [skipped]);
    const exported = await session(await response(owner.id));
    const inExported = await question(exported, { gate: 'unreviewed_source', cited: [e.ref], text: 'Exported (S6-4 t5)?' });
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE id = $1`, [exported]);
    const archivedOpp = await response(owner.id);
    const inArchived = await question(await session(archivedOpp), { gate: 'unreviewed_source', cited: [e.ref], text: 'Archived (S6-4 t5)?' });
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'won' WHERE id = $1`, [archivedOpp]);
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1)`, [e.id]);
      for (const id of [accepted, skipped, inExported, inArchived]) expect((await gateOf(q, id)).gate).toBe('unreviewed_source');
    });
  });

  it('other gates (pricing, legal, translation, unchecked) are never touched', async () => {
    const e = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    const id = await question(await session(await response(owner.id)), { gate: 'legal', cited: [e.ref], text: 'Legal (S6-4)?' });
    await as(admin, async (q) => {
      await q(`SELECT review_entry($1)`, [e.id]);
      expect((await gateOf(q, id)).gate).toBe('legal');
    });
  });

  it('6. an entry falls overdue after processing: bulk approval holds the question and says why', async () => {
    const e = await entry({ question: 'Falls overdue (S6-4 t6)?' });
    const s = await session(await response(owner.id));
    const id = await question(s, { cited: [e.ref], text: 'Processed while current (S6-4 t6)?' });
    await asSuperuser(`UPDATE kb_entries SET last_reviewed_at = $2, reviewed_at = $2, created_at = $2 WHERE id = $1`, [e.id, longAgo]);
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: { accepted: number; heldGated: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 0, heldGated: 1 });
      const g = await gateOf(q, id);
      expect(g.gate).toBe('stale_source');
      expect(g.gate_reason).toContain(e.ref);
    });
  });

  it('6b. an entry made unreviewed after processing (a proposal reverted) is held too; current entries are not', async () => {
    const e = await entry({ question: 'Becomes unreviewed (S6-4 t6b)?' });
    const fine = await entry({ question: 'Stays reviewed (S6-4 t6b)?' });
    const s = await session(await response(owner.id));
    const held = await question(s, { cited: [e.ref], text: 'Cites the changed one (S6-4 t6b)?' });
    const ok = await question(s, { cited: [fine.ref], text: 'Cites the current one (S6-4 t6b)?' });
    await asSuperuser(`UPDATE kb_entries SET reviewed_at = NULL WHERE id = $1`, [e.id]);
    await as(owner, async (q) => {
      expect((await q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [s])).rows[0].bulk_accept.accepted).toBe(1);
      const st = await q<{ id: string; status: string }>(`SELECT id, status FROM rfi_questions WHERE session_id = $1`, [s]);
      expect(st.rows).toEqual(expect.arrayContaining([{ id: held, status: 'pending' }, { id: ok, status: 'accepted' }]));
    });
  });

  it('7. nobody but the database can run the recheck; a member cannot review an entry', async () => {
    const e = await entry({ origin: 'manual', createdBy: member.id, reviewed: false });
    await refused(as(member, (q) => q(`SELECT review_entry($1)`, [e.id])));
    for (const u of [member, owner, admin]) {
      await refused(as(u, (q) => q(`SELECT private.release_source_gates(ARRAY[$1])`, [e.ref])));
    }
  });
});
