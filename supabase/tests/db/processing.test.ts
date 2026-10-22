// Sprint 2, story S2-2a: scoring and gating are written only server-side, and bulk approval
// is enforced in the database. Test numbers refer to docs/refinement/sprint-2.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

let admin: TestUser;
let owner: TestUser;
let member: TestUser;
let session: string;
let orphanSession: string;

const one = async <T>(sql: string, params: unknown[] = []) => (await asSuperuser<T & object>(sql, params)).rows[0];

/** A processed question, as the Edge Function would leave it. */
async function question(s: string, opts: { confidence?: number | null; gate?: string | null } = {}): Promise<string> {
  const conf = opts.confidence === undefined ? 0.9 : opts.confidence;
  return (await one<{ id: string }>(
    `INSERT INTO rfi_questions (session_id, position, question, confidence, gate, processed_at)
     VALUES ($1, 0, 'Q', $2, $3, now()) RETURNING id`, [s, conf, opts.gate ?? null])).id;
}

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  owner = await createUser();
  member = await createUser();
  const opp = (await one<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('R', $1, $1) RETURNING id`, [owner.id])).id;
  session = (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('r.xlsx', 'in_progress', 0, $1) RETURNING id`, [opp])).id;
  orphanSession = (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count) VALUES ('o.xlsx', 'in_progress', 0) RETURNING id`)).id;
});
afterAll(closePool);

describe('1. members cannot write scores, gates or drafts; the service role can', () => {
  it.each([
    ['confidence', 'confidence = 1'],
    ['gate', 'gate = NULL'],
    ['generated_answer', `generated_answer = 'We are certified.'`],
    ['answerability', 'answerability = 3'],
    ['sources_json', `sources_json = '[]'`],
    ['question', `question = 'rewritten'`],
  ])('a member cannot update %s', async (_c, set) => {
    const id = await question(session, { gate: 'pricing' });
    await refused(as(member, (q) => q(`UPDATE rfi_questions SET ${set} WHERE id = $1`, [id])));
  });

  it('a member can insert a question, but not with a score or gate', async () => {
    await as(member, async (q) => {
      const r = await q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 1, 'New?') RETURNING id`, [session]);
      expect(r.rowCount).toBe(1);
    });
    await refused(as(member, (q) =>
      q(`INSERT INTO rfi_questions (session_id, position, question, confidence) VALUES ($1, 1, 'New?', 1)`, [session])));
    await refused(as(member, (q) =>
      q(`INSERT INTO rfi_questions (session_id, position, question, status) VALUES ($1, 1, 'New?', 'accepted')`, [session])));
  });

  it('the service role can write every processing column', async () => {
    const id = await question(session, { confidence: null });
    await asServiceRole(async (q) => {
      const r = await q(
        `UPDATE rfi_questions SET confidence = 0.8, gate = 'legal', gate_reason = 'liability', answerability = 2.5, verdict = 'yes',
           language = 'en', embedding_model = 'voyage-4', judge_model = 'claude-haiku-5-5', draft_model = 'claude-haiku-5-5',
           prompt_version = 'draft-1', calibration_set = 's', draft_kind = 'generated', processing_note = NULL,
           generated_answer = 'We ...', processed_at = now() WHERE id = $1`, [id]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('a member can read the processing columns (responses are team-readable)', async () => {
    const id = await question(session, { gate: 'legal' });
    const r = await as(member, (q) => q<{ gate: string }>(`SELECT gate, confidence, draft_kind FROM rfi_questions WHERE id = $1`, [id]));
    expect(r.rows[0].gate).toBe('legal');
  });

  it('values outside the agreed sets are refused', async () => {
    const id = await question(session);
    await refused(asServiceRole((q) => q(`UPDATE rfi_questions SET gate = 'cheap' WHERE id = $1`, [id])));
    await refused(asServiceRole((q) => q(`UPDATE rfi_questions SET draft_kind = 'guess' WHERE id = $1`, [id])));
  });
});

describe('2. bulk_accept never accepts gated or uncalibrated questions', () => {
  it.each([0, 0.5, 0.8])('at threshold %s', async (threshold) => {
    const fresh = (await one<{ id: string }>(
      `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id)
       SELECT 'b.xlsx', 'in_progress', 0, opportunity_id FROM rfi_sessions WHERE id = $1 RETURNING id`, [session])).id;
    const ok = await question(fresh, { confidence: 0.95 });
    const low = await question(fresh, { confidence: 0.4 });
    const gated = await Promise.all(['pricing', 'legal', 'unchecked', 'translation'].map((g) => question(fresh, { confidence: 0.99, gate: g })));
    const uncalibrated = await question(fresh, { confidence: null });

    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Record<string, number> }>(`SELECT bulk_accept($1, $2)`, [fresh, threshold]);
      const res = r.rows[0].bulk_accept;
      expect(res.heldGated).toBe(4);
      expect(res.heldUncalibrated).toBe(1);
      const st = await q<{ id: string; status: string }>(`SELECT id, status FROM rfi_questions WHERE session_id = $1`, [fresh]);
      const status = Object.fromEntries(st.rows.map((x) => [x.id, x.status]));
      expect(status[ok]).toBe('accepted');
      expect(status[low]).toBe(threshold <= 0.4 ? 'accepted' : 'pending');
      for (const g of gated) expect(status[g]).toBe('pending');
      expect(status[uncalibrated]).toBe('pending');
    });
  });

  it('refuses a threshold outside 0 to 1', async () => {
    await refused(as(owner, (q) => q(`SELECT bulk_accept($1, 1.5)`, [session])));
  });
});

describe('3. only the response owner or an admin can approve in bulk', () => {
  it('a member who is not the owner is refused', async () => {
    await question(session);
    await refused(as(member, (q) => q(`SELECT bulk_accept($1, 0.8)`, [session])));
  });

  it('the owner and an admin can', async () => {
    await question(session);
    for (const u of [owner, admin]) {
      const r = await as(u, (q) => q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [session]));
      expect(r.rows[0].bulk_accept.accepted).toBeGreaterThanOrEqual(1);
    }
  });

  it('a session with no response can only be bulk-approved by an admin', async () => {
    await question(orphanSession);
    await refused(as(owner, (q) => q(`SELECT bulk_accept($1, 0.8)`, [orphanSession])));
    const r = await as(admin, (q) => q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [orphanSession]));
    expect(r.rows[0].bulk_accept.accepted).toBeGreaterThanOrEqual(1);
  });

  it('anonymous visitors cannot call it', async () => {
    await refused(as(null, (q) => q(`SELECT bulk_accept($1, 0.8)`, [session])));
  });
});

describe('the rules hold for direct updates too, not only through bulk_accept', () => {
  it('a member cannot accept several questions in one statement', async () => {
    const a = await question(session);
    const b = await question(session);
    await refused(as(member, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [a, b])));
  });

  it('even the owner cannot accept a gated question as part of a bulk update', async () => {
    const a = await question(session);
    const b = await question(session, { gate: 'pricing' });
    const msg = await refused(as(owner, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [a, b])));
    expect(msg).toMatch(/individually/);
  });

  it('the owner can accept several calibrated, ungated questions in one statement', async () => {
    const a = await question(session);
    const b = await question(session);
    const r = await as(owner, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [a, b]));
    expect(r.rowCount).toBe(2);
  });
});

describe('4. a person can still accept a gated question individually', () => {
  it.each(['pricing', 'legal', 'unchecked', 'translation'])('a member accepts one %s question with an edited answer', async (gate) => {
    const id = await question(session, { gate, confidence: null });
    const r = await as(member, (q) =>
      q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Answered by a person.' WHERE id = $1`, [id]));
    expect(r.rowCount).toBe(1);
  });
});

describe('security review findings (Sprint 2)', () => {
  /** A question as the browser left it before Sprint 2: confidence written by a user, never processed. */
  async function legacyQuestion(s: string): Promise<string> {
    return (await one<{ id: string }>(
      `INSERT INTO rfi_questions (session_id, position, question, confidence) VALUES ($1, 0, 'Old', 0.99) RETURNING id`, [s])).id;
  }

  it('finding 1: bulk approval never includes questions the server has not processed', async () => {
    const fresh = (await one<{ id: string }>(
      `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id)
       SELECT 'l.xlsx', 'in_progress', 0, opportunity_id FROM rfi_sessions WHERE id = $1 RETURNING id`, [session])).id;
    const old = await legacyQuestion(fresh);
    const ok = await question(fresh);
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: { accepted: number; heldUncalibrated: number } }>(`SELECT bulk_accept($1, 0)`, [fresh]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 1, heldUncalibrated: 1 });
    });
    await refused(as(owner, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [old, ok])));
  });

  it('finding 3: a member cannot rewrite several answers, or undo several approvals, at once', async () => {
    const a = await question(session);
    const b = await question(session);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [a, b]);
    await refused(as(member, (q) => q(`UPDATE rfi_questions SET final_answer = 'We charge nothing' WHERE id IN ($1, $2)`, [a, b])));
    await refused(as(member, (q) => q(`UPDATE rfi_questions SET status = 'pending' WHERE id IN ($1, $2)`, [a, b])));
  });

  it('finding 3: changing an accepted answer reopens it for a fresh decision', async () => {
    const id = await question(session, { gate: 'pricing' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Priced by a person.' WHERE id = $1`, [id]);
    await as(member, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'We charge nothing' WHERE id = $1`, [id]);
      const r = await q<{ status: string }>(`SELECT status FROM rfi_questions WHERE id = $1`, [id]);
      expect(r.rows[0].status).toBe('pending');
      // A person can then accept the revised answer individually.
      expect((await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id])).rowCount).toBe(1);
    });
  });

  it('finding 3: accepted_count is computed by the database, and members cannot write it', async () => {
    const fresh = (await one<{ id: string }>(
      `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id)
       SELECT 'c.xlsx', 'in_progress', 0, opportunity_id FROM rfi_sessions WHERE id = $1 RETURNING id`, [session])).id;
    await question(fresh);
    await question(fresh);
    await refused(as(member, (q) => q(`UPDATE rfi_sessions SET accepted_count = 999 WHERE id = $1`, [fresh])));
    await as(owner, async (q) => {
      await q(`SELECT bulk_accept($1, 0)`, [fresh]);
      const r = await q<{ accepted_count: number }>(`SELECT accepted_count FROM rfi_sessions WHERE id = $1`, [fresh]);
      expect(r.rows[0].accepted_count).toBe(2);
    });
  });

  it('finding 6: members cannot delete questions or sessions', async () => {
    const id = await question(session);
    await refused(as(member, (q) => q(`DELETE FROM rfi_questions WHERE id = $1`, [id])));
    await refused(as(owner, (q) => q(`DELETE FROM rfi_sessions WHERE id = $1`, [session])));
  });

  it('finding 6: a forged role claim does not switch the bulk check off', async () => {
    const a = await question(session);
    const b = await question(session, { gate: 'legal' });
    const pool = (await import('./harness')).getPool();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'x' })]);
      await refused(c.query(`UPDATE rfi_questions SET status = 'accepted' WHERE id IN ($1, $2)`, [a, b]));
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});
