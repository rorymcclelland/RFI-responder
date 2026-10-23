// Sprint 0, story S0-5: access control, tested against the database itself.
// Test numbers refer to docs/refinement/sprint-0.md (S0-5).
// The role matrix being tested is in docs/decisions/0003-access-control.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

let admin: TestUser;
let owner: TestUser;
let member: TestUser;
let other: TestUser;
let oppId: string;
let sessionId: string;

let usersAfterMigrations = -1;

beforeAll(async () => {
  await buildDatabase();
  const n = await asSuperuser<{ n: string }>('SELECT count(*) AS n FROM auth.users');
  usersAfterMigrations = Number(n.rows[0].n);
  admin = await createUser({ admin: true, name: 'Admin' });
  owner = await createUser({ name: 'Owner' });
  member = await createUser({ name: 'Member' });
  other = await createUser({ name: 'Other' });

  const o = await asSuperuser<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Acme RFI', $1, $1) RETURNING id`,
    [owner.id],
  );
  oppId = o.rows[0].id;
  const s = await asSuperuser<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('acme.xlsx', 'in_progress', 1, $1) RETURNING id`,
    [oppId],
  );
  sessionId = s.rows[0].id;
});

afterAll(closePool);

describe('profiles', () => {
  it('1. a member can update their own display name', async () => {
    const n = await as(member, (q) =>
      q(`UPDATE user_profiles SET display_name = 'New name' WHERE id = $1`, [member.id]),
    );
    expect(n.rowCount).toBe(1);
  });

  it('2. a member cannot make themselves an admin', async () => {
    await refused(as(member, (q) => q(`UPDATE user_profiles SET is_admin = true WHERE id = $1`, [member.id])));
  });

  it('3. a member cannot create a profile row with is_admin = true', async () => {
    const stranger = await createUser();
    await asSuperuser('DELETE FROM user_profiles WHERE id = $1', [stranger.id]);
    await refused(
      as(stranger, (q) =>
        q(`INSERT INTO user_profiles (id, display_name, is_admin) VALUES ($1, 'x', true)`, [stranger.id]),
      ),
    );
  });

  it("4. a member cannot update another user's profile", async () => {
    const n = await as(member, (q) =>
      q(`UPDATE user_profiles SET display_name = 'Hacked' WHERE id = $1`, [other.id]),
    );
    expect(n.rowCount).toBe(0);
  });

  it("an admin can update another user's details", async () => {
    const n = await as(admin, (q) =>
      q(`UPDATE user_profiles SET job_title = 'Security Lead' WHERE id = $1`, [other.id]),
    );
    expect(n.rowCount).toBe(1);
  });

  it('5. an admin can promote a member through set_user_admin, and it is logged', async () => {
    await as(admin, async (q) => {
      await q('SELECT set_user_admin($1, true)', [member.id]);
      const p = await q<{ is_admin: boolean }>('SELECT is_admin FROM user_profiles WHERE id = $1', [member.id]);
      expect(p.rows[0].is_admin).toBe(true);
      const log = await q<{ action: string; actor: string }>(
        `SELECT action, actor FROM audit_log WHERE target_id = $1`,
        [member.id],
      );
      expect(log.rows).toEqual([{ action: 'user.admin_granted', actor: admin.id }]);
    });
  });

  it('6. a member cannot call set_user_admin', async () => {
    await refused(as(member, (q) => q('SELECT set_user_admin($1, true)', [member.id])));
  });

  it('the last admin cannot remove their own admin rights', async () => {
    await refused(as(admin, (q) => q('SELECT set_user_admin($1, false)', [admin.id])));
  });

  it('members cannot read or write the audit log', async () => {
    const r = await as(member, (q) => q('SELECT * FROM audit_log'));
    expect(r.rowCount).toBe(0);
    await refused(
      as(member, (q) => q(`INSERT INTO audit_log (actor, action) VALUES ($1, 'fake')`, [member.id])),
    );
  });
});

describe('opportunities (responses)', () => {
  it('a new opportunity is owned by its creator', async () => {
    await as(member, async (q) => {
      const r = await q<{ owner_id: string }>(
        `INSERT INTO opportunities (name, created_by) VALUES ('Mine', $1) RETURNING owner_id`,
        [member.id],
      );
      expect(r.rows[0].owner_id).toBe(member.id);
    });
  });

  it('a member cannot create an opportunity on behalf of someone else', async () => {
    await refused(
      as(member, (q) =>
        q(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Spoof', $1, $1)`, [other.id]),
      ),
    );
  });

  it('7. only an admin can permanently delete an opportunity', async () => {
    const r = await asSuperuser<{ id: string }>(
      `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Created in error', $1, $1) RETURNING id`,
      [owner.id],
    );
    const id = r.rows[0].id;
    // Sprint 3 (S3-3): nobody deletes directly; an admin uses delete_response with a reason, logged.
    for (const u of [owner, member, admin]) await refused(as(u, (q) => q('DELETE FROM opportunities WHERE id = $1', [id])));
    await refused(as(owner, (q) => q(`SELECT delete_response($1, 'Created in error by mistake')`, [id])));
    await refused(as(admin, (q) => q(`SELECT delete_response($1, 'oops')`, [id])));
    await as(admin, async (q) => {
      await q(`SELECT delete_response($1, 'Created in error by mistake')`, [id]);
      expect((await q('SELECT 1 FROM opportunities WHERE id = $1', [id])).rowCount).toBe(0);
      const log = await q<{ details: { reason: string } }>(`SELECT details FROM audit_log WHERE action = 'response.deleted' AND target_id = $1`, [id]);
      expect(log.rows[0].details.reason).toBe('Created in error by mistake');
    });
  });

  it('12. the owner can edit and hand over their opportunity; a non-owner cannot', async () => {
    expect(
      (await as(owner, (q) => q(`UPDATE opportunities SET name = 'Renamed', owner_id = $2 WHERE id = $1`, [oppId, member.id]))).rowCount,
    ).toBe(1);
    expect((await as(member, (q) => q(`UPDATE opportunities SET name = 'Nope' WHERE id = $1`, [oppId]))).rowCount).toBe(0);
  });

  it('an opportunity with no recorded creator is no longer editable by everyone', async () => {
    const r = await asSuperuser<{ id: string }>(`INSERT INTO opportunities (name) VALUES ('Legacy') RETURNING id`);
    const id = r.rows[0].id;
    expect((await as(member, (q) => q(`UPDATE opportunities SET name = 'x' WHERE id = $1`, [id]))).rowCount).toBe(0);
  });

  it('every signed-in member can read opportunities', async () => {
    const r = await as(other, (q) => q('SELECT id FROM opportunities WHERE id = $1', [oppId]));
    expect(r.rowCount).toBe(1);
  });
});

describe('question assignments', () => {
  const insertAssignment = (by: TestUser, to: TestUser) => (q: Parameters<Parameters<typeof as>[1]>[0]) =>
    q(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text)
       VALUES ('q-1', $1, $2, $3, $4, 'Do you use MFA?') RETURNING id`,
      [sessionId, oppId, to.id, by.id],
    );

  it('13. the owner can assign a question on their response; a non-owner member cannot', async () => {
    const r = await as(owner, insertAssignment(owner, member));
    expect(r.rowCount).toBe(1);
    await refused(as(other, insertAssignment(other, member)));
  });

  it('an admin can assign a question on any response', async () => {
    const r = await as(admin, insertAssignment(admin, member));
    expect(r.rowCount).toBe(1);
  });

  it('8. only the assignee, the owner or an admin can update an assignment', async () => {
    const r = await asSuperuser<{ id: string }>(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text)
       VALUES ('q-2', $1, $2, $3, $4, 'Q?') RETURNING id`,
      [sessionId, oppId, member.id, owner.id],
    );
    const id = r.rows[0].id;
    const upd = (u: TestUser) => as(u, (q) => q(`UPDATE question_assignments SET status = 'in_review' WHERE id = $1`, [id]));
    expect((await upd(member)).rowCount).toBe(1);
    expect((await upd(owner)).rowCount).toBe(1);
    expect((await upd(admin)).rowCount).toBe(1);
    expect((await upd(other)).rowCount).toBe(0);
  });
});

describe('anonymous visitors', () => {
  it.each(['opportunities', 'rfi_sessions', 'rfi_questions', 'user_profiles', 'question_assignments', 'opportunity_contributors', 'audit_log'])(
    '9. cannot read %s at all',
    async (table) => {
      const reason = await refused(as(null, (q) => q(`SELECT * FROM ${table}`)));
      expect(reason).toMatch(/permission denied/);
    },
  );

  it('cannot write anything', async () => {
    await refused(as(null, (q) => q(`INSERT INTO opportunities (name) VALUES ('anon')`)));
  });
});

describe('migrations', () => {
  it('11. a fresh migration run creates no users', () => {
    expect(usersAfterMigrations).toBe(0);
  });
});
