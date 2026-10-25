// Sprint 11. Test numbers refer to docs/refinement/sprint-11.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
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

describe('S11-7 admin changes all audited, assignments created as intended (F-49, F-50, F-51)', () => {
  it('a price change by an admin is audited with before and after; members still cannot change prices', async () => {
    await as(admin, async (q) => {
      await q(`UPDATE ai_prices SET input_usd_per_mtok = input_usd_per_mtok + 1 WHERE model = 'claude-haiku-5-5'`);
      const rows = (await q(`SELECT actor, details FROM audit_log WHERE action = 'prices.changed' AND actor = $1`, [admin.id])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].details).toMatchObject({ operation: 'update' });
      expect((rows[0].details as { before: { model: string } }).before.model).toBe('claude-haiku-5-5');
    });
    await as(member, async (q) => {
      const r = await q(`UPDATE ai_prices SET input_usd_per_mtok = 0 RETURNING model`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('an admin cannot mark an entry replaced directly (only review_entry and record_export do)', async () => {
    const a = await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Old S11-7?', 'Old.', '{}', 'seed') RETURNING id`);
    const b = await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('New S11-7?', 'New.', '{}', 'seed') RETURNING id`);
    await refused(as(admin, (q) => q(`UPDATE kb_entries SET superseded_by = $1 WHERE id = $2`, [b.id, a.id])));
    await as(admin, (q) => q(`UPDATE kb_entries SET tags = '{checked}' WHERE id = $1`, [a.id]));
  });

  it('contributors cannot change once the response is archived', async () => {
    const opp = await response(owner.id);
    await asSuperuser(`INSERT INTO opportunity_contributors (opportunity_id, user_id) VALUES ($1, $2)`, [opp, member.id]);
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [opp]);
    await refused(as(owner, (q) => q(`DELETE FROM opportunity_contributors WHERE opportunity_id = $1`, [opp])));
    await refused(as(owner, (q) => q(`INSERT INTO opportunity_contributors (opportunity_id, user_id) VALUES ($1, $2)`, [opp, assignee.id])));
  });

  it('an owner\'s new assignment starts pending, now, with the question\'s own text, whatever was sent', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s, { text: 'The real question (S11-7)?' });
    await as(owner, async (q) => {
      const r = await q(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text, status, notes, completed_at, created_at)
                         VALUES ($1, $2, $3, $4, $5, 'Something else', 'approved', 'Forged', now(), '2020-01-01') RETURNING status, question_text, notes, completed_at, created_at`,
        [id, s, opp, assignee.id, owner.id]);
      expect(r.rows[0]).toMatchObject({ status: 'pending', question_text: 'The real question (S11-7)?', notes: '', completed_at: null });
      expect(new Date(r.rows[0].created_at as string).getFullYear()).toBeGreaterThan(2025);
    });
    // Someone else as the assigner is still refused (existing rule).
    await refused(as(owner, (q) => q(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text)
                                      VALUES ($1, $2, $3, $4, $5, 'q')`, [id, s, opp, assignee.id, admin.id])));
  });

  it('a new user still gets a profile, and every public function has an empty search path', async () => {
    const u = await createUser({ name: 'New person S11-7' });
    expect((await one<{ n: string }>(`SELECT count(*)::text AS n FROM user_profiles WHERE id = $1`, [u.id])).n).toBe('1');
    const bad = (await asSuperuser<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef
          AND NOT coalesce(p.proconfig @> ARRAY['search_path=""'], false)`)).rows.map((r) => r.proname);
    expect(bad).toEqual([]);
  });
});

describe('S11-10 who skipped a question is recorded (F-54)', () => {
  it('1 and 2. skipping records who and when; restoring clears them; neither can be set through the API', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s);
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]);
      let r = (await q(`SELECT skipped_by, skipped_at FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(r.skipped_by).toBe(owner.id);
      expect(r.skipped_at).not.toBeNull();
      await q(`UPDATE rfi_questions SET status = 'pending' WHERE id = $1`, [id]);
      r = (await q(`SELECT skipped_by, skipped_at FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(r).toEqual({ skipped_by: null, skipped_at: null });
    });
    await refused(as(owner, (q) => q(`UPDATE rfi_questions SET skipped_by = $1 WHERE id = $2`, [admin.id, id])));
  });

  it('a skipped question keeps who skipped it when its answer is changed', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s);
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]);
      await q(`UPDATE rfi_questions SET final_answer = 'Note.' WHERE id = $1`, [id]);
      expect((await q(`SELECT skipped_by FROM rfi_questions WHERE id = $1`, [id])).rows[0].skipped_by).toBe(owner.id);
    });
  });
});

describe('S11-2 a question matched against an incomplete index (F-43)', () => {
  it('3. is held from bulk approval, can be accepted on its own, and is learned at export', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s, { gate: 'unindexed_entries', confidence: 0.95, text: `Incomplete index ${Math.random()}?` });
    await as(owner, async (q) => {
      const r = (await q(`SELECT bulk_accept($1, 0.8) AS b`, [s])).rows[0].b as { accepted: number; heldGated: number };
      expect(r).toMatchObject({ accepted: 0, heldGated: 1 });
      await q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Checked by a person.' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      expect((await q(`SELECT learn_outcome FROM rfi_questions WHERE id = $1`, [id])).rows[0].learn_outcome).toBe('added');
    });
  });
});

describe('S11-4 a refused embedding request uses none of the day (F-44)', () => {
  it('1. all or nothing: over the remaining cap, nothing is reserved and the count is unchanged', async () => {
    const u = await createUser();
    await asSuperuser(`UPDATE ai_settings SET daily_embed_cap = 5`);
    try {
      await asServiceRole(async (q) => {
        const r = (await q(`SELECT reserve_quota($1, 'embed', 8, NULL, true) AS r`, [u.id])).rows[0].r as { allowed: number; reason: string; reservation: string | null };
        expect(r).toMatchObject({ allowed: 0, reason: 'daily_embed', reservation: null });
        const used = (await q(`SELECT embed_texts FROM ai_quota WHERE user_id = $1 AND day = current_date`, [u.id])).rows[0];
        expect(used.embed_texts).toBe(0);
        // The partial behaviour stays the default for batches.
        const partial = (await q(`SELECT reserve_quota($1, 'embed', 8) AS r`, [u.id])).rows[0].r as { allowed: number };
        expect(partial.allowed).toBe(5);
      });
    } finally {
      await asSuperuser(`UPDATE ai_settings SET daily_embed_cap = 5000`);
    }
  });
});

describe('S11-6 unpriced usage is named, and the rerankers are priced (F-48)', () => {
  it('1. a call to a model with no price is counted and named in the report', async () => {
    const u = await createUser();
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens) VALUES ($1, 'process-questions', 'judge', 'anthropic', 'claude-unknown-9', 10)`, [u.id]);
    await as(admin, async (q) => {
      const r = (await q(`SELECT usage_report() AS r`)).rows[0].r as { unpricedCalls: number; unpricedModels: string[] };
      expect(r.unpricedCalls).toBeGreaterThanOrEqual(1);
      expect(r.unpricedModels).toContain('anthropic claude-unknown-9');
    });
  });

  it('2. every model a default or documented setting can choose has a price', async () => {
    const rows = (await asSuperuser<{ k: string }>(`SELECT provider || ' ' || model AS k FROM ai_prices`)).rows.map((r) => r.k);
    for (const m of ['anthropic claude-haiku-5-5', 'voyage voyage-4', 'voyage rerank-2.5', 'voyage rerank-3']) expect(rows, m).toContain(m);
  });
});

describe('S11-9 the audit-log screen reads what admins may read (F-53)', () => {
  it('1. an admin reads the log with who did each thing; a member reads nothing', async () => {
    await asSuperuser(`INSERT INTO audit_log (actor, action, details) VALUES ($1, 'response.archived', '{"outcome":"won"}')`, [owner.id]);
    await as(admin, async (q) => {
      const r = await q(`SELECT a.action, p.display_name FROM audit_log a LEFT JOIN user_profiles p ON p.id = a.actor ORDER BY a.at DESC LIMIT 200`);
      expect(r.rows.length).toBeGreaterThan(0);
    });
    await as(member, async (q) => {
      expect((await q(`SELECT * FROM audit_log`)).rows).toHaveLength(0);
    });
  });
});

describe('Sprint 11 security review', () => {
  it('M2 and M3: deleting an account forgets who skipped, and works even on an archived response', async () => {
    const skipper = await createUser();
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s);
    await asSuperuser(`INSERT INTO opportunity_contributors (opportunity_id, user_id) VALUES ($1, $2)`, [opp, skipper.id]);
    await asSuperuser(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text)
                       VALUES ($1, $2, $3, $4, $5, 'q')`, [id, s, opp, skipper.id, owner.id]);
    await as(skipper, (q) => q(`SELECT 1`));
    await asSuperuser(`UPDATE rfi_questions SET status = 'skipped', skipped_by = $1, skipped_at = now() WHERE id = $2`, [skipper.id, id]);
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [opp]);
    await asSuperuser(`DELETE FROM auth.users WHERE id = $1`, [skipper.id]);
    const row = await one<{ skipped_by: string | null; skipped_at: string | null; status: string }>(`SELECT skipped_by, skipped_at, status FROM rfi_questions WHERE id = $1`, [id]);
    expect(row.skipped_by).toBeNull();
    expect(row.status).toBe('skipped');
    expect((await one<{ n: string }>(`SELECT count(*)::text AS n FROM opportunity_contributors WHERE opportunity_id = $1`, [opp])).n).toBe('0');
    // The archive still refuses every other change.
    await refused(asSuperuser(`UPDATE rfi_questions SET final_answer = 'x' WHERE id = $1`, [id]));
  });

  it('low 1: the audit row records the final status when an accepted answer is changed (it reopens)', async () => {
    const { s, id } = await exported();
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'Corrected.' WHERE id = $1`, [id]);
      const { audit } = await asWritten(q as Q, s, id);
      expect(audit[0].details).toMatchObject({ status_from: 'accepted', status_to: 'pending' });
    });
  });

  it('low 2: re-accepting an unchanged answer after a change learns nothing new on re-export', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s, { text: `Unchanged relearn ${Math.random()}?` });
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'The answer, edited.' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      const first = (await q(`SELECT learned_entry_id FROM rfi_questions WHERE id = $1`, [id])).rows[0].learned_entry_id;
      await q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      await q(`SELECT record_export($1)`, [s]);
      const after = (await q(`SELECT learned_entry_id, learn_outcome, learned_at FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(after.learned_entry_id).toBe(first);
      expect(after.learn_outcome).toBe('added');
      expect(after.learned_at).not.toBeNull();
      const entries = (await q(`SELECT count(*)::int AS n FROM kb_entries WHERE origin_ref LIKE $1`, [`%question:${id}`])).rows[0].n;
      expect(entries).toBe(1);
    });
  });

  it('low 4: an admin deleting an entry or changing its tags is audited', async () => {
    const e = await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES ('Audited change S11?', 'A.', '{}', 'seed') RETURNING id`);
    await as(admin, async (q) => {
      await q(`UPDATE kb_entries SET tags = '{new}' WHERE id = $1`, [e.id]);
      await q(`DELETE FROM kb_entries WHERE id = $1`, [e.id]);
      const actions = (await q(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`, [e.id])).rows.map((r) => r.action);
      expect(actions).toEqual(['kb.changed', 'kb.deleted']);
    });
  });
});
