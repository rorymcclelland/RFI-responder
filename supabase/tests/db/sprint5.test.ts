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
