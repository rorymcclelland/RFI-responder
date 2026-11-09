// Sprint 24 (S24-1, U-11): one response, sent as a whole. Test numbers refer to
// docs/refinement/sprint-24.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let owner: TestUser;
let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Owner (S24)' });
  member = await createUser({ name: 'Member (S24)' });
  admin = await createUser({ admin: true, name: 'Admin (S24)' });
});
afterAll(closePool);

/** A response with two files, each with the questions given (default: one bulk-eligible question each). */
async function twoFiles(name: string, perFile: Parameters<typeof question>[1][][] = [[{}], [{}]]) {
  const r = await response(owner.id, { name });
  const files: string[] = [];
  const questions: string[][] = [];
  for (const qs of perFile) {
    const s = await session(r);
    files.push(s);
    const ids: string[] = [];
    for (const [i, o] of qs.entries()) ids.push(await question(s, { text: `Question ${i} in ${s} (${name})?`, ...o }));
    questions.push(ids);
  }
  return { r, files, questions };
}

const decideAll = (r: string) => asSuperuser(
  `UPDATE rfi_questions SET status = 'accepted', final_answer = coalesce(final_answer, generated_answer)
    WHERE session_id IN (SELECT id FROM rfi_sessions WHERE opportunity_id = $1) AND status = 'pending'`, [r]);
const sentAt = async (r: string) => (await one<{ exported_at: string | null }>(`SELECT exported_at FROM opportunities WHERE id = $1`, [r])).exported_at;
const stage = async (r: string) => (await one<{ stage: string }>(`SELECT stage FROM response_overview WHERE id = $1`, [r])).stage;

describe('S24-1 3: bulk approval across every file of a response', () => {
  it('takes the eligible questions of every file, holds the rest, and counts the whole response', async () => {
    const { r, questions } = await twoFiles('Bulk (S24 3)', [
      [{}, { gate: 'pricing', draftKind: 'person_required' }],
      [{}, { confidence: 0.5 }, { verdict: 'partly' }],
    ]);
    const result = await as(owner, async (q) => {
      const res = (await q<{ r: Record<string, number> }>(`SELECT bulk_accept_response($1, 0.8) AS r`, [r])).rows[0].r;
      const status = (await q<{ id: string; status: string }>(
        `SELECT id, status FROM rfi_questions WHERE id = ANY($1)`, [questions.flat()])).rows;
      return { res, status: Object.fromEntries(status.map((s) => [s.id, s.status])) };
    });
    expect(result.res).toMatchObject({ accepted: 2, heldGated: 1, belowThreshold: 1, heldPartly: 1 });
    expect(result.status[questions[0][0]]).toBe('accepted');
    expect(result.status[questions[1][0]]).toBe('accepted');
    for (const id of [questions[0][1], questions[1][1], questions[1][2]]) expect(result.status[id]).toBe('pending');
  });

  it('records each acceptance as bulk, with its threshold, as bulk_accept does', async () => {
    const { r, questions } = await twoFiles('Bulk record (S24 3)');
    const kinds = await as(owner, async (q) => {
      await q(`SELECT bulk_accept_response($1, 0.8)`, [r]);
      return (await q<{ kind: string; threshold: string }>(`SELECT kind, threshold FROM approvals WHERE question_id = ANY($1)`, [questions.flat()])).rows;
    });
    expect(kinds).toHaveLength(2);
    expect(kinds.every((k) => k.kind === 'bulk' && Number(k.threshold) === 0.8)).toBe(true);
  });
});

describe('S24-1 4, 5 and 6: marking the whole response as sent', () => {
  it('4. refused while any question in any file is to do, and nothing is recorded', async () => {
    const { r, files } = await twoFiles('Not yet (S24 4)');
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = generated_answer WHERE session_id = $1`, [files[0]]);
    expect(await refused(as(owner, (q) => q(`SELECT record_response_export($1)`, [r])))).toMatch(/1 question\(s\) in this response are still to do/);
    const marked = await asSuperuser(`SELECT count(*)::int AS n FROM rfi_sessions WHERE opportunity_id = $1 AND exported_at IS NOT NULL`, [r]);
    expect(marked.rows[0].n).toBe(0);
  });

  it('4. once every question is decided, records every file and the response, and teaches the knowledge base once', async () => {
    const { r, files } = await twoFiles('Whole (S24 4)', [[{}], [{}]]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Written by a person (S24 4) ' || id WHERE session_id = ANY($1)`, [files]);
    // As an admin, who may read the audit log in the same transaction (an owner's export is the same call).
    const out = await as(admin, async (q) => {
      const res = (await q<{ r: Record<string, number> }>(`SELECT record_response_export($1) AS r`, [r])).rows[0].r;
      const sessions = (await q<{ exported_at: string | null }>(`SELECT exported_at FROM rfi_sessions WHERE opportunity_id = $1`, [r])).rows;
      const opp = (await q<{ exported_at: string | null }>(`SELECT exported_at FROM opportunities WHERE id = $1`, [r])).rows[0];
      const audits = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'response.exported' AND target_id = ANY($1)`, [files])).rows[0].n;
      return { res, sessions, opp, audits };
    });
    expect(out.res).toMatchObject({ files: 2, accepted: 2, skipped: 0, added: 2 });
    expect(out.sessions.every((s) => s.exported_at)).toBe(true);
    expect(out.opp.exported_at).toBeTruthy();
    expect(out.audits).toBe(2);
  });

  it('4. by the owner too: one entry learned for each answer, from this response, and none twice (QA review, L2)', async () => {
    const { r, files } = await twoFiles('Owner sends (S24 4)', [[{}], [{}]]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Written by the owner (S24 4) ' || id WHERE session_id = ANY($1)`, [files]);
    const entries = await as(owner, async (q) => {
      await q(`SELECT record_response_export($1)`, [r]);
      // Marking it again with nothing changed is refused, so nothing is learned twice.
      await q(`SAVEPOINT again`);
      await q(`SELECT record_response_export($1)`, [r]).catch(() => q(`ROLLBACK TO SAVEPOINT again`));
      return (await q<{ n: number }>(`SELECT count(*)::int AS n FROM kb_entries WHERE origin_ref LIKE $1`, [`response:${r}/%`])).rows[0].n;
    });
    expect(entries).toBe(2);
  });

  it('4. all or nothing: a file the database refuses leaves every file unsent', async () => {
    const { r, files } = await twoFiles('Refused file (S24 4)');
    await decideAll(r);
    // The second file's export is refused (a trigger standing in for any refusal inside record_export).
    await asSuperuser(`CREATE OR REPLACE FUNCTION pg_temp_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${files[1]}' AND NEW.exported_at IS NOT NULL THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $$`);
    await asSuperuser(`CREATE TRIGGER s24_refuse BEFORE UPDATE ON rfi_sessions FOR EACH ROW EXECUTE FUNCTION pg_temp_refuse()`);
    try {
      expect(await refused(as(owner, (q) => q(`SELECT record_response_export($1)`, [r])))).toMatch(/refused for the test/);
    } finally {
      await asSuperuser(`DROP TRIGGER s24_refuse ON rfi_sessions; DROP FUNCTION pg_temp_refuse()`);
    }
    const marked = await asSuperuser(`SELECT count(*)::int AS n FROM rfi_sessions WHERE opportunity_id = $1 AND exported_at IS NOT NULL`, [r]);
    expect(marked.rows[0].n).toBe(0);
    expect(await sentAt(r)).toBeNull();
  });

  it('5. a response is never Sent while one of its files is unsent, however the file was recorded', async () => {
    const { r, files } = await twoFiles('Half sent (S24 5)');
    await decideAll(r);
    // The first file recorded on its own (as the app did before Sprint 24), then the response's mark.
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE id = $1`, [files[0]]);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [r]);
    expect(await sentAt(r)).toBeNull();
    expect(await stage(r)).not.toBe('exported');
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE id = $1`, [files[1]]);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [r]);
    expect(await sentAt(r)).toBeTruthy();
  });

  it('6. a change after sending is recorded again: only the changed file is recorded, and only once nothing is to do', async () => {
    const { r, files, questions } = await twoFiles('Changed (S24 6)');
    await decideAll(r);
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE opportunity_id = $1`, [r]);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [r]);
    // An answer changes in the second file (the Sprint 11 trigger marks the file as changed).
    await asSuperuser(`UPDATE rfi_questions SET final_answer = 'Changed after sending (S24 6).' WHERE id = $1`, [questions[1][0]]);
    const changed = await asSuperuser(`SELECT id FROM rfi_sessions WHERE opportunity_id = $1 AND changed_since_export_at IS NOT NULL`, [r]);
    expect(changed.rows.map((x) => x.id)).toEqual([files[1]]);
    const res = await as(owner, async (q) => (await q<{ r: Record<string, number> }>(`SELECT record_response_export($1) AS r`, [r])).rows[0].r);
    expect(res).toMatchObject({ files: 1, accepted: 2 });
  });

  it('6. with nothing changed since it was sent, marking it again is refused with the reason', async () => {
    const { r } = await twoFiles('Unchanged (S24 6)');
    await decideAll(r);
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE opportunity_id = $1`, [r]);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [r]);
    expect(await refused(as(owner, (q) => q(`SELECT record_response_export($1)`, [r])))).toMatch(/Nothing has changed since/);
  });

  it('a response with no file is not sent', async () => {
    const r = await response(owner.id, { name: 'Empty (S24)' });
    expect(await refused(as(owner, (q) => q(`SELECT record_response_export($1)`, [r])))).toMatch(/no file to send/);
  });
});

describe('S24-1 8 (Q4): no file is added to a sent response', () => {
  it('refuses a new file, and moving a file into it, for owner and admin alike; an unsent response takes one', async () => {
    const r = await response(owner.id, { name: 'Sent, closed (S24 8)' });
    const s = await session(r);
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE id = $1`, [s]);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [r]);
    for (const u of [owner, admin]) {
      expect(await refused(as(u, (q) => q(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('late.csv', 1, $1)`, [r]))))
        .toMatch(/marked as sent, so no file can be added/);
    }
    const other = await response(owner.id, { name: 'Elsewhere (S24 8)' });
    const loose = await session(other);
    expect(await refused(asSuperuser(`UPDATE rfi_sessions SET opportunity_id = $1 WHERE id = $2`, [r, loose]))).toMatch(/no file can be added/);
    const open = await response(owner.id, { name: 'Open (S24 8)' });
    expect(await as(owner, async (q) => (await q(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('ok.csv', 1, $1) RETURNING id`, [open])).rowCount)).toBe(1);
  });
});

describe('S24-1 10: the role matrix for the two new functions', () => {
  it('the owner and an admin may; another member, the service role and a signed-out caller may not', async () => {
    const { r } = await twoFiles('Matrix (S24 10)');
    await decideAll(r);
    for (const fn of [`bulk_accept_response($1, 0.8)`, `record_response_export($1)`]) {
      expect(await as(owner, async (q) => (await q(`SELECT ${fn}`, [r])).rowCount)).toBe(1);
      expect(await as(admin, async (q) => (await q(`SELECT ${fn}`, [r])).rowCount)).toBe(1);
      expect(await refused(as(member, (q) => q(`SELECT ${fn}`, [r])))).toMatch(/Only the response owner or an admin/);
      expect(await refused(asServiceRole((q) => q(`SELECT ${fn}`, [r])))).toMatch(/Only the response owner or an admin|permission denied/);
      expect(await refused(as(null, (q) => q(`SELECT ${fn}`, [r])))).toMatch(/permission denied/);
    }
  });

  it('the helper functions are not callable through the API', async () => {
    for (const fn of [`private.add_counts('{}', '{}')`, `private.sent_when_every_file_is()`, `private.no_file_once_sent()`]) {
      expect(await refused(as(owner, (q) => q(`SELECT ${fn}`)))).toMatch(/permission denied|trigger functions can only be called/);
    }
  });

  it('adds counts as numbers, and leaves other values alone', async () => {
    const r = await one<{ r: Record<string, unknown> }>(`SELECT private.add_counts('{"a": 1, "b": 2}', '{"a": 3, "c": 4, "re_export": true}') AS r`);
    expect(r.r).toEqual({ a: 4, b: 2, c: 4 });
  });
});

describe('Sprint 24 security review', () => {
  /** Two connections as the owner, each in its own open transaction, for the races. */
  async function connection(u: TestUser) {
    const c = await getPool().connect();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated', email: u.email })]);
    return c;
  }

  it('M1: a file added while the response is being marked as sent is refused once the export commits', async () => {
    const { r } = await twoFiles('Race (S24 M1)');
    await decideAll(r);
    const sending = await connection(owner);
    const adding = await connection(admin);
    try {
      await sending.query(`SELECT record_response_export($1)`, [r]);
      // The insert waits for the export, then sees it.
      const late = adding.query(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('late.xlsx', 1, $1)`, [r]);
      await new Promise((res) => setTimeout(res, 200));
      await sending.query('COMMIT');
      expect(await refused(late)).toMatch(/marked as sent, so no file can be added/);
    } finally {
      await adding.query('ROLLBACK').catch(() => undefined);
      adding.release();
      sending.release();
    }
    expect(await stage(r)).toBe('exported');
    const unsent = await asSuperuser(`SELECT count(*)::int AS n FROM rfi_sessions WHERE opportunity_id = $1 AND exported_at IS NULL`, [r]);
    expect(unsent.rows[0].n).toBe(0);
  });

  it('M2 (a): no question is added to a sent file', async () => {
    const { r, files } = await twoFiles('Sent file (S24 M2)');
    await decideAll(r);
    // Sprint 26: the file states room for more, so the refusal is the one for a sent file.
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now(), question_count = question_count + 5 WHERE opportunity_id = $1`, [r]);
    expect(await refused(as(owner, (q) => q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 9, 'Late question (S24 M2)?')`, [files[0]]))))
      .toMatch(/marked as sent, so no question can be added/);
  });

  it('M2 (b): a file still being added (fewer questions saved than it has) is not sent', async () => {
    const { r, files } = await twoFiles('Uploading (S24 M2)');
    await decideAll(r);
    await asSuperuser(`UPDATE rfi_sessions SET file_name = 'half-saved.xlsx', question_count = 40 WHERE id = $1`, [files[1]]);
    expect(await refused(as(owner, (q) => q(`SELECT record_response_export($1)`, [r])))).toMatch(/The file half-saved\.xlsx is still being added/);
  });

  it('every file sent but the response not marked: marking it as sent marks it (not refused for good)', async () => {
    const { r } = await twoFiles('Stuck (S24 info)');
    await decideAll(r);
    await asSuperuser(`ALTER TABLE opportunities DISABLE TRIGGER opportunities_sent_when_every_file_is`);
    await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE opportunity_id = $1`, [r]);
    await asSuperuser(`ALTER TABLE opportunities ENABLE TRIGGER opportunities_sent_when_every_file_is`);
    expect(await sentAt(r)).toBeNull();
    const res = await as(owner, async (q) => {
      const x = (await q<{ r: Record<string, number> }>(`SELECT record_response_export($1) AS r`, [r])).rows[0].r;
      const opp = (await q<{ exported_at: string | null }>(`SELECT exported_at FROM opportunities WHERE id = $1`, [r])).rows[0];
      return { x, opp };
    });
    expect(res.x).toMatchObject({ files: 0 });
    expect(res.opp.exported_at).toBeTruthy();
  });

  it('bulk approval checks its threshold and counts zero for a response with no file', async () => {
    const r = await response(owner.id, { name: 'No files (S24 info)' });
    expect(await refused(as(owner, (q) => q(`SELECT bulk_accept_response($1, 2)`, [r])))).toMatch(/between 0 and 1/);
    const res = await as(owner, async (q) => (await q<{ r: Record<string, number> }>(`SELECT bulk_accept_response($1, 0.8) AS r`, [r])).rows[0].r);
    expect(res).toMatchObject({ accepted: 0, heldGated: 0, belowThreshold: 0 });
  });
});
