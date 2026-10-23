// Sprint 5: Word ingestion and judge consistency. Test numbers refer to docs/refinement/sprint-5.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

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

describe('F-29 a realistic reserve per question', () => {
  it('1. a fresh database reserves $0.002 per question', async () => {
    const s = await one<{ est_usd_per_question: string }>(`SELECT est_usd_per_question FROM ai_settings`);
    expect(Number(s.est_usd_per_question)).toBe(0.002);
    await asServiceRole(async (q) => {
      const r = await q<{ r: { reservation: string } }>(`SELECT reserve_quota($1, 'questions', 10) AS r`, [owner.id]);
      const est = await q<{ est_usd: string }>(`SELECT est_usd FROM ai_reservations WHERE id = $1`, [r.rows[0].r.reservation]);
      expect(Number(est.rows[0].est_usd)).toBeCloseTo(0.02, 6);
    });
  });

  it('3. the usage report gives the measured average cost per processed question this month', async () => {
    const s = await session(await response(owner.id));
    await question(s);
    await question(s);
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model, cost_usd) VALUES
      ($1, 'process-questions', 'draft', 'anthropic', 'claude-haiku-5-5', 0.0006), ($1, 'process-questions', 'judge', 'anthropic', 'claude-haiku-5-5', 0.0004),
      ($1, 'embed-entries', 'embed', 'voyage', 'voyage-4', 0.5)`, [owner.id]);
    const r = await as(admin, (q) => q<{ usage_report: { avgUsdPerQuestion: number | null; questionsProcessed: number } }>(`SELECT usage_report()`));
    const { avgUsdPerQuestion, questionsProcessed } = r.rows[0].usage_report;
    expect(questionsProcessed).toBeGreaterThanOrEqual(2);
    // Only processing costs count (not indexing), divided by questions processed this month.
    expect(Number(avgUsdPerQuestion)).toBeCloseTo(0.001 / questionsProcessed, 8);
    await asSuperuser(`DELETE FROM ai_usage WHERE user_id = $1`, [owner.id]);
  });
});

describe('F-26 close assignments at export', () => {
  async function exportable() {
    const opp = await response(owner.id);
    const s = await session(opp);
    const q1 = await question(s, { text: 'One (F-26)?' });
    const q2 = await question(s, { text: 'Two (F-26)?' });
    const expert = await createUser();
    const open = await one<{ id: string }>(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, status)
      VALUES ($1, $2, $3, $4, $5, 'in_review') RETURNING id`, [q1, s, opp, expert.id, owner.id]);
    const done = await one<{ id: string }>(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, status)
      VALUES ($1, $2, $3, $4, $5, 'answered') RETURNING id`, [q2, s, opp, expert.id, owner.id]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'skipped' WHERE session_id = $1`, [s]);
    return { opp, s, open: open.id, done: done.id, expert };
  }

  it('1 and 2. export closes open assignments, leaves finished ones, and the overview stops counting them', async () => {
    const { opp, s, open, done } = await exportable();
    await as(owner, async (q) => {
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export.assignments_closed).toBe(1);
      const st = await q<{ id: string; status: string; completed_at: string | null }>(`SELECT id, status, completed_at FROM question_assignments WHERE session_id = $1`, [s]);
      const byId = Object.fromEntries(st.rows.map((x) => [x.id, x]));
      expect(byId[open]).toMatchObject({ status: 'closed' });
      expect(byId[open].completed_at).not.toBeNull();
      expect(byId[done].status).toBe('answered');
      const ov = await q<{ open_assignments: number }>(`SELECT open_assignments FROM response_overview WHERE id = $1`, [opp]);
      expect(ov.rows[0].open_assignments).toBe(0);
    });
  });

  it('3. nobody but the export can close an assignment, or reopen a closed one', async () => {
    const { s, open, expert } = await exportable();
    await refused(as(expert, (q) => q(`UPDATE question_assignments SET status = 'closed' WHERE id = $1`, [open])));
    await refused(as(owner, (q) => q(`UPDATE question_assignments SET status = 'closed' WHERE id = $1`, [open])));
    // Someone with no part in the response does not even reach the row.
    expect((await as(member, (q) => q(`UPDATE question_assignments SET status = 'closed' WHERE id = $1`, [open]))).rowCount).toBe(0);
    await asSuperuser(`UPDATE question_assignments SET status = 'closed' WHERE id = $1`, [open]);
    await refused(as(expert, (q) => q(`UPDATE question_assignments SET status = 'in_review' WHERE id = $1`, [open])));
    void s;
  });
});

describe('S5-2 extraction inside the caps', () => {
  const reserve = (user: TestUser, n: number) =>
    asServiceRole((q) => q<{ r: { allowed: number; reason: string | null; reservation: string | null } }>(`SELECT reserve_quota($1, 'extract', $2) AS r`, [user.id, n]))
      .then((r) => r.rows[0].r);

  it('6. twenty documents a day per person; the twenty-first is refused', async () => {
    const u = await createUser();
    await asSuperuser(`INSERT INTO ai_quota (user_id, day, extract_docs) VALUES ($1, current_date, 20)`, [u.id]);
    expect(await reserve(u, 1)).toMatchObject({ allowed: 0, reason: 'daily_extract' });
    const fresh = await createUser();
    const ok = await reserve(fresh, 1);
    expect(ok.allowed).toBe(1);
  });

  it('a document reserves an estimated cost against the budget', async () => {
    const u = await createUser();
    await asServiceRole(async (q) => {
      const r = await q<{ r: { reservation: string } }>(`SELECT reserve_quota($1, 'extract', 1) AS r`, [u.id]);
      const est = await q<{ kind: string; est_usd: string }>(`SELECT kind, est_usd FROM ai_reservations WHERE id = $1`, [r.rows[0].r.reservation]);
      expect(est.rows[0].kind).toBe('extract');
      expect(Number(est.rows[0].est_usd)).toBeCloseTo(0.02, 6);
      await q(`INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens) VALUES ($1, 'extract-questions', 'extract', 'anthropic', 'claude-haiku-5-5', 10)`, [u.id]);
    });
  });

  it('members see their own extraction allowance', async () => {
    const r = await as(member, (q) => q<{ usage_status: { extractToday: number; extractCap: number } }>(`SELECT usage_status()`));
    expect(r.rows[0].usage_status).toMatchObject({ extractToday: 0, extractCap: 20 });
    await refused(as(member, (q) => q(`SELECT reserve_quota($1, 'extract', 1)`, [member.id])));
  });
});

describe('S5-3 the customer\'s own numbering is kept', () => {
  it('the owner saves a question with its number; a long number is refused; nobody changes it afterwards', async () => {
    const s = await session(await response(owner.id));
    await as(owner, async (q) => {
      const r = await q<{ customer_ref: string }>(`INSERT INTO rfi_questions (session_id, position, question, customer_ref) VALUES ($1, 0, 'Q?', '3(a)') RETURNING customer_ref`, [s]);
      expect(r.rows[0].customer_ref).toBe('3(a)');
    });
    await refused(as(owner, (q) => q(`INSERT INTO rfi_questions (session_id, position, question, customer_ref) VALUES ($1, 0, 'Q?', $2)`, [s, 'x'.repeat(21)])));
    const id = await question(s);
    await refused(as(owner, (q) => q(`UPDATE rfi_questions SET customer_ref = '9' WHERE id = $1`, [id])));
  });
});
