// Sprint 4: cost controls and governance. Test numbers refer to docs/refinement/sprint-4.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';
import { question, response, session } from './fixtures';

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

describe('S4-2 bulk approval and delete markers cannot be forged (F-24)', () => {
  it('1. setting app.bulk_threshold by hand does not allow a multi-row accept', async () => {
    const s = await session(await response(owner.id));
    await question(s);
    await question(s);
    await refused(as(owner, async (q) => {
      await q(`SELECT set_config('app.bulk_threshold', '0.8', true)`);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1`, [s]);
    }));
  });

  it('2. setting app.deleting_response by hand does not allow changing an archived response', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s);
    await asSuperuser(`UPDATE opportunities SET exported_at = now(), archived_at = now(), outcome = 'won' WHERE id = $1`, [opp]);
    await refused(as(admin, async (q) => {
      await q(`SELECT set_config('app.deleting_response', $1, true)`, [opp]);
      await q(`UPDATE rfi_questions SET final_answer = 'Rewritten' WHERE id = $1`, [id]);
    }));
  });

  it('3. bulk_accept and delete_response still work, and bulk approvals record the threshold', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    await question(s);
    await question(s);
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept.accepted).toBe(2);
      const a = await q<{ kind: string; threshold: string }>(`SELECT kind, threshold FROM approvals WHERE session_id = $1`, [s]);
      expect(a.rows).toEqual([{ kind: 'bulk', threshold: '0.8' }, { kind: 'bulk', threshold: '0.8' }]);
    });
    await as(admin, async (q) => {
      await q(`SELECT delete_response($1, 'Created in error for a test')`, [opp]);
      expect((await q(`SELECT 1 FROM opportunities WHERE id = $1`, [opp])).rowCount).toBe(0);
    });
  });

  it('4. members cannot read or write the private operations table', async () => {
    await refused(as(member, (q) => q(`SELECT * FROM private.operations`)));
    await refused(as(member, (q) => q(`INSERT INTO private.operations (kind, value) VALUES ('bulk', '0')`)));
  });

  it('5. after bulk_accept returns, the same transaction is no longer treated as bulk', async () => {
    const s = await session(await response(owner.id));
    await question(s, { confidence: 0.9 });
    await question(s, { confidence: 0.5 });
    await question(s, { confidence: 0.5 });
    await refused(as(owner, async (q) => {
      await q(`SELECT bulk_accept($1, 0.8)`, [s]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1 AND status = 'pending'`, [s]);
    }));
  });
});

// Reserves as the service role (as the Edge Functions do) and commits, so parallel calls really race.
type Reservation = { allowed: number; reason: string | null };
async function reserve(user: TestUser, kind: 'questions' | 'embed', n: number): Promise<Reservation> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE service_role');
    const r = await c.query<{ r: Reservation }>(`SELECT reserve_quota($1, $2, $3) AS r`, [user.id, kind, n]);
    await c.query('COMMIT');
    return r.rows[0].r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

describe('S4-1 usage recorded and capped (F-21)', () => {
  it('1. a usage row is priced from ai_prices, in dollars, at the recorded rate', async () => {
    await asServiceRole(async (q) => {
      const r = await q<{ cost_usd: string }>(
        `INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens, output_tokens)
         VALUES ($1, 'process-questions', 'draft', 'anthropic', 'claude-haiku-5-5', 2000000, 1000000) RETURNING cost_usd`, [owner.id]);
      // $0.10 per million input, $0.50 per million output (checked 23 October 2026).
      expect(Number(r.rows[0].cost_usd)).toBeCloseTo(0.7, 6);
      const e = await q<{ cost_usd: string }>(
        `INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens)
         VALUES ($1, 'embed', 'embed', 'voyage', 'voyage-4', 1000000) RETURNING cost_usd`, [owner.id]);
      expect(Number(e.rows[0].cost_usd)).toBeCloseTo(0.06, 6);
      const local = await q<{ cost_usd: string }>(
        `INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens)
         VALUES ($1, 'embed', 'embed', 'ollama', 'qwen3-embedding:0.6b', 1000) RETURNING cost_usd`, [owner.id]);
      expect(Number(local.rows[0].cost_usd)).toBe(0);
    });
  });

  it('2. a user at the daily question cap is refused; another user is not', async () => {
    const heavy = await createUser();
    const other = await createUser();
    expect(await reserve(heavy, 'questions', 300)).toEqual({ allowed: 300, reason: null });
    expect(await reserve(heavy, 'questions', 1)).toEqual({ allowed: 0, reason: 'daily_questions' });
    expect(await reserve(other, 'questions', 10)).toEqual({ allowed: 10, reason: null });
  });

  it('3. at the monthly budget everyone is refused; at the alert share admins are warned', async () => {
    const spender = await createUser();
    const bystander = await createUser();
    // £10 budget at 1.00 GBP per USD: $8.50 spent is past the 80% alert, $10 is the budget.
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens, cost_usd)
                       VALUES ($1, 'process-questions', 'draft', 'anthropic', 'claude-haiku-5-5', 1, 8.5)`, [spender.id]);
    const warn = await as(admin, (q) => q<{ usage_status: { alert: boolean; exhausted: boolean } }>(`SELECT usage_status()`));
    expect(warn.rows[0].usage_status).toMatchObject({ alert: true, exhausted: false });
    const quiet = await as(bystander, (q) => q<{ usage_status: Record<string, unknown> }>(`SELECT usage_status()`));
    expect(quiet.rows[0].usage_status.spentGbp).toBeNull();
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens, cost_usd)
                       VALUES ($1, 'process-questions', 'draft', 'anthropic', 'claude-haiku-5-5', 1, 1.5)`, [spender.id]);
    expect(await reserve(bystander, 'questions', 5)).toEqual({ allowed: 0, reason: 'monthly_budget' });
    await asSuperuser(`DELETE FROM ai_usage WHERE user_id = $1`, [spender.id]);
  });

  it('4. a request that would cross the cap is cut at the cap', async () => {
    const u = await createUser();
    await reserve(u, 'questions', 295);
    expect(await reserve(u, 'questions', 10)).toEqual({ allowed: 5, reason: 'daily_questions' });
  });

  it('5. embedding has its own daily cap', async () => {
    const u = await createUser();
    expect(await reserve(u, 'embed', 5000)).toEqual({ allowed: 5000, reason: null });
    expect(await reserve(u, 'embed', 1)).toEqual({ allowed: 0, reason: 'daily_embed' });
    expect((await reserve(u, 'questions', 1)).allowed).toBe(1);
  });

  it('7. members cannot write usage, prices, settings or quotas, or reserve; they read only their own usage', async () => {
    await refused(as(member, (q) => q(`INSERT INTO ai_usage (user_id, function, kind, provider, model) VALUES ($1, 'x', 'draft', 'anthropic', 'm')`, [member.id])));
    // Row-level security filters a member's update to no rows.
    expect((await as(member, (q) => q(`UPDATE ai_prices SET input_usd_per_mtok = 0`))).rowCount).toBe(0);
    expect((await as(member, (q) => q(`UPDATE ai_settings SET daily_question_cap = 100000`))).rowCount).toBe(0);
    await refused(as(member, (q) => q(`INSERT INTO ai_prices (provider, model, input_usd_per_mtok, checked_on, source_url) VALUES ('x', 'y', 0, current_date, 'z')`)));
    await refused(as(member, (q) => q(`SELECT reserve_quota($1, 'questions', 1)`, [member.id])));
    await refused(as(member, (q) => q(`INSERT INTO ai_quota (user_id, day, questions) VALUES ($1, current_date, -1000)`, [member.id])));
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model) VALUES ($1, 'x', 'draft', 'anthropic', 'claude-haiku-5-5')`, [owner.id]);
    const seen = await as(member, (q) => q(`SELECT 1 FROM ai_usage WHERE user_id <> $1`, [member.id]));
    expect(seen.rowCount).toBe(0);
    for (const t of ['ai_usage', 'ai_prices', 'ai_settings', 'ai_quota']) {
      await refused(as(null, (q) => q(`SELECT * FROM ${t}`)));
    }
  });

  it('7b. an admin can change the caps and prices, and read everyone\'s usage', async () => {
    await as(admin, async (q) => {
      expect((await q(`UPDATE ai_settings SET daily_question_cap = 400`)).rowCount).toBe(1);
      expect((await q(`UPDATE ai_prices SET checked_on = current_date WHERE model = 'voyage-4'`)).rowCount).toBe(1);
      expect((await q(`SELECT 1 FROM ai_usage WHERE user_id = $1`, [owner.id])).rowCount).toBeGreaterThan(0);
      const r = await q<{ usage_report: { byUser: unknown[]; byModel: unknown[] } }>(`SELECT usage_report()`);
      expect(r.rows[0].usage_report.byModel.length).toBeGreaterThan(0);
    });
    await refused(as(member, (q) => q(`SELECT usage_report()`)));
  });

  it('8. fifty parallel reservations cannot exceed the cap', async () => {
    const u = await createUser();
    const results = await Promise.all(Array.from({ length: 50 }, () => reserve(u, 'questions', 10)));
    expect(results.reduce((n, r) => n + r.allowed, 0)).toBe(300);
  });
});
