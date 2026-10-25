// Sprint 11. Test numbers refer to docs/refinement/sprint-11.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let owner: TestUser;
let admin: TestUser;
let assignee: TestUser;
let member: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser();
  admin = await createUser({ admin: true });
  assignee = await createUser();
  member = await createUser();
});
afterAll(closePool);

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** A response with one session holding one accepted question, already exported. */
async function exported(opts: { text?: string } = {}) {
  const opp = await response(owner.id);
  const s = await session(opp);
  const id = await question(s, { text: opts.text ?? `Exported question ${Math.random()}?` });
  await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = generated_answer WHERE id = $1`, [id]);
  await asSuperuser(`UPDATE rfi_sessions SET status = 'completed', exported_at = now() WHERE id = $1`, [s]);
  await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [opp]);
  return { opp, s, id };
}

/** Inside an `as` block: drop back to the superuser to read what the change wrote. */
async function asWritten(q: Q, s: string, id: string) {
  await q('RESET ROLE');
  const sess = (await q(`SELECT changed_since_export_at, status FROM rfi_sessions WHERE id = $1`, [s])).rows[0];
  const audit = (await q(`SELECT actor, details FROM audit_log WHERE action = 'question.changed_after_export' AND target_id = $1`, [id])).rows;
  return { sess, audit };
}

describe('S11-1 a change after an export is recorded, and the export recorded again (F-42)', () => {
  it('1. the owner, an admin and an assignee may change it; each change marks the session and is audited with who', async () => {
    for (const who of [owner, admin, assignee]) {
      const { opp, s, id } = await exported();
      if (who === assignee) {
        await asSuperuser(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text, status)
                           VALUES ($1, $2, $3, $4, $5, 'q', 'closed')`, [id, s, opp, assignee.id, owner.id]);
      }
      await as(who, async (q) => {
        await q(`UPDATE rfi_questions SET final_answer = 'Corrected after sending.' WHERE id = $1`, [id]);
        const { sess, audit } = await asWritten(q as Q, s, id);
        expect(sess.changed_since_export_at).not.toBeNull();
        expect(sess.status).toBe('in_progress');
        expect(audit).toHaveLength(1);
        expect(audit[0].actor).toBe(who.id);
        expect(audit[0].details).toMatchObject({ answer_changed: true, status_from: 'accepted' });
      });
    }
  });

  it('a change of decision (skipping an exported question) counts too', async () => {
    const { s, id } = await exported();
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]);
      const { sess, audit } = await asWritten(q as Q, s, id);
      expect(sess.changed_since_export_at).not.toBeNull();
      expect(audit[0].details).toMatchObject({ status_from: 'accepted', status_to: 'skipped', answer_changed: false });
    });
  });

  it('2 and 3. recording the export does not mark it changed; recording it again after a change clears the mark and learns the correction', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s, { text: `Re-export question ${Math.random()}?` });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'First answer, edited.' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      let row = (await q(`SELECT changed_since_export_at, exported_at FROM rfi_sessions WHERE id = $1`, [s])).rows[0];
      expect(row.exported_at).not.toBeNull();
      expect(row.changed_since_export_at).toBeNull();
      const first = (await q(`SELECT learned_entry_id, learn_outcome FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(first.learn_outcome).toBe('added');

      // Changing an accepted answer reopens it (Sprint 2), so it is accepted again, as Save & Accept does.
      await q(`UPDATE rfi_questions SET final_answer = 'Second answer, corrected.' WHERE id = $1`, [id]);
      expect((await q(`SELECT learned_at FROM rfi_questions WHERE id = $1`, [id])).rows[0].learned_at).toBeNull();
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      row = (await q(`SELECT changed_since_export_at, status FROM rfi_sessions WHERE id = $1`, [s])).rows[0];
      expect(row.changed_since_export_at).toBeNull();
      expect(row.status).toBe('completed');
      // An admin's corrected answer replaces the entry learned the first time.
      const second = (await q(`SELECT learned_entry_id, learn_outcome FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(second.learn_outcome).toBe('superseded');
      const old = (await q(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [first.learned_entry_id])).rows[0];
      expect(old.superseded_by).toBe(second.learned_entry_id);
      const exports = (await q(`SELECT details->>'re_export' AS re FROM audit_log WHERE action = 'response.exported' AND target_id = $1 ORDER BY at`, [s])).rows;
      expect(exports.map((e) => e.re)).toEqual(['false', 'true']);
    });
  });

  it('3. a member owner\'s corrected answer becomes a proposal beside the entry learned before', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s, { text: `Member re-export ${Math.random()}?` });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'First, edited.' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      await q(`UPDATE rfi_questions SET final_answer = 'Second, corrected.' WHERE id = $1`, [id]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      expect((await q(`SELECT learn_outcome FROM rfi_questions WHERE id = $1`, [id])).rows[0].learn_outcome).toBe('proposed');
    });
  });

  it('4. archiving as won or lost waits for the export to be recorded again; withdrawn does not', async () => {
    const { opp, id } = await exported();
    await asSuperuser(`UPDATE rfi_questions SET final_answer = 'Changed.' WHERE id = $1`, [id]);
    for (const outcome of ['won', 'lost']) {
      expect(await refused(as(owner, (q) => q(`SELECT archive_response($1, $2)`, [opp, outcome])))).toMatch(/record the export again/);
    }
    await as(owner, (q) => q(`SELECT archive_response($1, 'withdrawn')`, [opp]));
  });

  it('5. a change in a session never exported is not marked or audited', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s);
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      const { sess, audit } = await asWritten(q as Q, s, id);
      expect(sess.changed_since_export_at).toBeNull();
      expect(audit).toHaveLength(0);
    });
  });

  it('6. nobody sets or clears the mark directly, and a member who may not decide still cannot change the question', async () => {
    const { s, id } = await exported();
    for (const who of [owner, admin]) {
      await refused(as(who, (q) => q(`UPDATE rfi_sessions SET changed_since_export_at = now() WHERE id = $1`, [s])));
    }
    await as(member, async (q) => {
      const r = await q(`UPDATE rfi_questions SET final_answer = 'Not mine.' WHERE id = $1 RETURNING id`, [id]);
      expect(r.rows).toHaveLength(0);
    });
    expect((await one<{ c: string | null }>(`SELECT changed_since_export_at AS c FROM rfi_sessions WHERE id = $1`, [s])).c).toBeNull();
  });

  it('7. the overview shows the response as changed until the export is recorded again', async () => {
    const { opp, id } = await exported();
    await as(owner, async (q) => {
      expect((await q(`SELECT stage FROM response_overview WHERE id = $1`, [opp])).rows[0].stage).toBe('exported');
      await q(`UPDATE rfi_questions SET final_answer = 'Changed.' WHERE id = $1`, [id]);
      expect((await q(`SELECT stage FROM response_overview WHERE id = $1`, [opp])).rows[0].stage).toBe('changed');
    });
  });
});
