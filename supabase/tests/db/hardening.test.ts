// Findings from the independent security review of Sprint 0 (22 October 2026),
// plus role-matrix rows that had no test. Each finding is numbered as in the review.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';

let admin: TestUser;
let admin2: TestUser;
let owner: TestUser;
let member: TestUser;
let other: TestUser;
let victimOpp: string;
let victimSession: string;
let memberOpp: string;
let memberSession: string;
let assignmentForMember: string;

const one = async <T>(sql: string, params: unknown[] = []) => (await asSuperuser<T & object>(sql, params)).rows[0];

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  admin2 = await createUser({ admin: true });
  owner = await createUser();
  member = await createUser();
  other = await createUser();

  victimOpp = (await one<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Victim', $1, $1) RETURNING id`, [owner.id])).id;
  victimSession = (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('v.xlsx', 'in_progress', 1, $1) RETURNING id`, [victimOpp])).id;
  memberOpp = (await one<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Mine', $1, $1) RETURNING id`, [member.id])).id;
  memberSession = (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('m.xlsx', 'in_progress', 1, $1) RETURNING id`, [memberOpp])).id;
  assignmentForMember = (await one<{ id: string }>(
    `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text)
     VALUES ('q-1', $1, $2, $3, $4, 'Original question') RETURNING id`, [victimSession, victimOpp, member.id, owner.id])).id;
});
afterAll(closePool);

describe('finding 1: assignments stay on their own response', () => {
  it('an owner cannot move their assignment onto another response', async () => {
    await as(member, async (q) => {
      const r = await q<{ id: string }>(
        `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by)
         VALUES ('q9', $1, $2, $3, $3) RETURNING id`, [memberSession, memberOpp, member.id]);
      await refused(q(`UPDATE question_assignments SET opportunity_id = $2 WHERE id = $1`, [r.rows[0].id, victimOpp]));
    });
  });

  it("an owner cannot create an assignment that points at another response's session", async () => {
    await refused(as(member, (q) =>
      q(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by)
         VALUES ('q9', $1, $2, $3, $3)`, [victimSession, memberOpp, member.id])));
  });
});

describe('finding 2: assignees change only the work, not its history', () => {
  it('the assignee can update status, answer and notes', async () => {
    const r = await as(member, (q) =>
      q(`UPDATE question_assignments SET status = 'answered', answer_text = 'Yes.', notes = 'Checked', updated_at = now()
         WHERE id = $1`, [assignmentForMember]));
    expect(r.rowCount).toBe(1);
  });

  it.each([
    ['assigned_by', `assigned_by = '00000000-0000-0000-0000-000000000000'`],
    ['session_id', 'session_id = NULL'],
    ['question_text', `question_text = 'rewritten'`],
    ['created_at', `created_at = '2000-01-01'`],
    ['assigned_to', 'assigned_to = assigned_by'],
  ])('the assignee cannot change %s', async (_col, set) => {
    await refused(as(member, (q) => q(`UPDATE question_assignments SET ${set} WHERE id = $1`, [assignmentForMember])));
  });
});

describe('finding 3: at least one admin always remains', () => {
  it('two admins removing each other at the same moment cannot leave zero admins', async () => {
    const pool = getPool();
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    const begin = async (c: typeof c1, u: TestUser) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })]);
    };
    try {
      // Only admin and admin2 are admins in this file.
      await begin(c1, admin);
      await begin(c2, admin2);
      await c1.query('SELECT set_user_admin($1, false)', [admin2.id]);
      const second = c2.query('SELECT set_user_admin($1, false)', [admin.id]).then(() => 'ok', (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300)); // let the second call reach the lock
      await c1.query('COMMIT');
      expect(await second).toMatch(/at least one admin|only an admin/i);
      await c2.query('ROLLBACK');
      const n = await one<{ n: string }>(`SELECT count(*) AS n FROM user_profiles WHERE is_admin`);
      expect(Number(n.n)).toBeGreaterThanOrEqual(1);
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await c2.query('ROLLBACK').catch(() => undefined);
      c1.release();
      c2.release();
      await asSuperuser('UPDATE user_profiles SET is_admin = true WHERE id = ANY($1)', [[admin.id, admin2.id]]);
    }
  });

  it('removing admin rights normally works and is logged', async () => {
    await as(admin, async (q) => {
      await q('SELECT set_user_admin($1, false)', [admin2.id]);
      const log = await q<{ action: string }>(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id DESC LIMIT 1`, [admin2.id]);
      expect(log.rows[0].action).toBe('user.admin_removed');
    });
  });
});

describe('finding 4: nothing is callable by anonymous visitors by default', () => {
  it('functions created later are not executable by anon', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
      const r = await client.query(`SELECT has_function_privilege('anon', 'public.future_fn()', 'EXECUTE') AS ok`);
      expect(r.rows[0].ok).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it.each(['set_updated_at()', 'handle_new_user()', 'set_user_admin(uuid, boolean)', 'is_admin()', 'import_kb_entries(jsonb, kb_origin, text)'])(
    'anon cannot execute %s',
    async (fn) => {
      const r = await one<{ ok: boolean }>(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS ok`);
      expect(r.ok).toBe(false);
    },
  );
});

describe('finding 5: sessions stay with their response', () => {
  it('a member cannot move a session onto another response', async () => {
    await refused(as(other, (q) => q(`UPDATE rfi_sessions SET opportunity_id = $2 WHERE id = $1`, [victimSession, memberOpp])));
  });

  it('a member can run a session and add its questions (team-shared until Sprint 3)', async () => {
    await as(other, async (q) => {
      const s = await q<{ id: string }>(
        `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('o.xlsx', 'in_progress', 1, $1) RETURNING id`, [victimOpp]);
      // From Sprint 2 (S2-2a) members insert only the question; scores are written server-side.
      const qn = await q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 0, 'Q?')`, [s.rows[0].id]);
      expect(qn.rowCount).toBe(1);
      const read = await q('SELECT 1 FROM rfi_questions WHERE session_id = $1', [s.rows[0].id]);
      expect(read.rowCount).toBe(1);
    });
  });
});

describe('finding 6: knowledge-base imports are bounded', () => {
  it('an import of more than 2,000 entries is refused', async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ question: `Q${i}?`, answer: 'A.', tags: [], source: '' }));
    await refused(as(member, (q) =>
      q(`SELECT import_kb_entries($1::jsonb, 'import', 'big.csv')`, [JSON.stringify(entries)])));
  });
});

describe('finding 7: members hold only the privileges the API needs', () => {
  it.each(['rfi_questions', 'question_assignments', 'opportunities', 'kb_entries', 'user_profiles'])(
    'a member cannot TRUNCATE %s',
    async (table) => {
      await refused(as(member, (q) => q(`TRUNCATE ${table} CASCADE`)));
    },
  );
});

describe('role-matrix rows that had no test', () => {
  it('the owner can add and remove contributors; a non-owner cannot', async () => {
    await as(owner, async (q) => {
      expect((await q(`INSERT INTO opportunity_contributors (opportunity_id, user_id) VALUES ($1, $2)`, [victimOpp, other.id])).rowCount).toBe(1);
      expect((await q(`DELETE FROM opportunity_contributors WHERE opportunity_id = $1 AND user_id = $2`, [victimOpp, other.id])).rowCount).toBe(1);
    });
    await refused(as(other, (q) => q(`INSERT INTO opportunity_contributors (opportunity_id, user_id) VALUES ($1, $2)`, [victimOpp, other.id])));
  });

  it('an admin can edit and hand over any response', async () => {
    const r = await as(admin, (q) => q(`UPDATE opportunities SET name = 'Admin edit', owner_id = $2 WHERE id = $1`, [victimOpp, other.id]));
    expect(r.rowCount).toBe(1);
  });

  it('the owner can remove an assignment; the assignee cannot', async () => {
    expect((await as(member, (q) => q('DELETE FROM question_assignments WHERE id = $1', [assignmentForMember]))).rowCount).toBe(0);
    expect((await as(owner, (q) => q('DELETE FROM question_assignments WHERE id = $1', [assignmentForMember]))).rowCount).toBe(1);
  });

  it('a member can edit their own expertise tags', async () => {
    const r = await as(member, (q) => q(`UPDATE user_profiles SET expertise_tags = '{encryption,GDPR}' WHERE id = $1`, [member.id]));
    expect(r.rowCount).toBe(1);
  });

  it('an anonymous visitor cannot call set_user_admin', async () => {
    await refused(as(null, (q) => q('SELECT set_user_admin($1, true)', [member.id])));
  });
});
