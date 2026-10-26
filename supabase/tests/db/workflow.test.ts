// Sprint 3: workflow and the learning loop. Test numbers refer to docs/refinement/sprint-3.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

let admin: TestUser;
let owner: TestUser;
let member: TestUser;
let expert: TestUser;

const one = async <T>(sql: string, params: unknown[] = []) => (await asSuperuser<T & object>(sql, params)).rows[0];

async function response(opts: { due?: string | null; name?: string } = {}): Promise<string> {
  return (await one<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id, due_date) VALUES ($1, $2, $2, $3::date) RETURNING id`,
    [opts.name ?? 'Response', owner.id, opts.due ?? null])).id;
}
async function session(opp: string): Promise<string> {
  return (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('s.xlsx', 'in_progress', 0, $1) RETURNING id`, [opp])).id;
}
/** A processed question. `sources` are [ref, similarity]; the draft is the generated answer unless `final` differs. */
async function question(s: string, o: {
  status?: string; gate?: string | null; language?: string; confidence?: number; verdict?: string;
  generated?: string; final?: string | null; sources?: [string, number][]; text?: string; kind?: string; bestRef?: string | null;
} = {}): Promise<string> {
  const generated = o.generated ?? 'We encrypt data at rest with AES-256.';
  return (await one<{ id: string }>(
    `INSERT INTO rfi_questions (session_id, position, question, generated_answer, final_answer, confidence, status, gate, language,
       verdict, sources_json, embedding_model, judge_model, draft_model, prompt_version, calibration_set, draft_kind, processed_at, judge_best_ref)
     VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'voyage-4', 'claude-haiku-5-5', 'claude-haiku-5-5', 'draft-1', 'set 1', $11, now(), $12)
     RETURNING id`,
    [s, o.text ?? 'How is data encrypted at rest?', generated, o.final === undefined ? null : o.final, o.confidence ?? 0.9,
      o.status ?? 'pending', o.gate ?? null, o.language ?? 'en', o.verdict ?? 'yes',
      JSON.stringify((o.sources ?? []).map(([id, score]) => ({ id, score }))), o.kind ?? 'generated',
      o.bestRef === undefined ? o.sources?.[0]?.[0] ?? null : o.bestRef])).id;
}
async function entry(question: string, answer: string, tags: string[] = ['encryption'], createdBy: string | null = null): Promise<{ id: string; ref: string }> {
  return one<{ id: string; ref: string }>(
    `INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ($1, $2, $3, 'seed', $4) RETURNING id, ref`,
    [question, answer, tags, createdBy]);
}
const overview = async (id: string) =>
  (await as(member, (q) => q<Record<string, unknown>>(`SELECT * FROM response_overview WHERE id = $1`, [id]))).rows[0];

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  owner = await createUser();
  member = await createUser();
  expert = await createUser({ name: 'Ada Expert' });
});
afterAll(closePool);

describe('S3-1 the overview', () => {
  it('1. the stage follows the work', async () => {
    const opp = await response();
    expect((await overview(opp)).stage).toBe('new');
    const s = await session(opp);
    const q1 = await question(s);
    expect((await overview(opp)).stage).toBe('in_review');
    await asSuperuser(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [q1]);
    expect((await overview(opp)).stage).toBe('ready');
    await as(owner, (q) => q(`SELECT record_export($1)`, [s]));
    // record_export ran in a rolled-back transaction; set the date directly to check the stage.
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [opp]);
    expect((await overview(opp)).stage).toBe('exported');
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'won' WHERE id = $1`, [opp]);
    expect((await overview(opp)).stage).toBe('archived');
  });

  it('2. progress counts match the questions', async () => {
    const opp = await response();
    const s = await session(opp);
    await question(s, { status: 'accepted' });
    await question(s, { status: 'skipped' });
    await question(s);
    await question(s, { gate: 'pricing' });
    expect(await overview(opp)).toMatchObject({ total: 4, accepted: 1, skipped: 1, pending: 2, decided: 2, gated_pending: 1 });
  });

  it('3. overdue and at risk, and neither once exported', async () => {
    const late = await response({ due: '2020-01-01' });
    expect(await overview(late)).toMatchObject({ overdue: true, at_risk: false });
    // Due tomorrow, with an undecided pricing question: at risk whatever day it is.
    const soon = await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id, due_date) VALUES ('Soon', $1, $1, current_date + 1) RETURNING id`, [owner.id]);
    const s = await session(soon.id);
    for (let i = 0; i < 4; i++) await question(s, { status: 'accepted' });
    await question(s, { gate: 'pricing' });
    expect(await overview(soon.id)).toMatchObject({ overdue: false, at_risk: true });
    // Due in a month, nothing decided: not at risk yet.
    const later = await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id, due_date) VALUES ('Later', $1, $1, current_date + 30) RETURNING id`, [owner.id]);
    await question(await session(later.id));
    expect(await overview(later.id)).toMatchObject({ at_risk: false });
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [late]);
    expect(await overview(late)).toMatchObject({ overdue: false, at_risk: false });
  });

  it('4. members read the overview; only owner or admin change the due date; anonymous sees nothing', async () => {
    const opp = await response();
    expect(await overview(opp)).toBeTruthy();
    expect((await as(member, (q) => q(`UPDATE opportunities SET due_date = '2030-01-01' WHERE id = $1`, [opp]))).rowCount).toBe(0);
    for (const u of [owner, admin]) {
      expect((await as(u, (q) => q(`UPDATE opportunities SET due_date = '2030-01-01' WHERE id = $1`, [opp]))).rowCount).toBe(1);
    }
    await refused(as(owner, (q) => q(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [opp])));
    await refused(as(owner, (q) => q(`UPDATE opportunities SET outcome = 'won' WHERE id = $1`, [opp])));
    await refused(as(null, (q) => q(`SELECT * FROM response_overview`)));
  });
});

describe('S3-2 recorded approvals and the readiness gate', () => {
  it('1. an individual acceptance records the person and kind; bulk records each question with the threshold', async () => {
    const opp = await response();
    const s = await session(opp);
    const a = await question(s);
    const b = await question(s, { confidence: 0.95 });
    const c = await question(s, { confidence: 0.85 });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [a]);
      await q(`SELECT bulk_accept($1, 0.8)`, [s]);
      const r = await q<{ question_id: string; kind: string; threshold: string | null; decided_by: string }>(
        `SELECT question_id, kind, threshold, decided_by FROM approvals WHERE session_id = $1 ORDER BY id`, [s]);
      expect(r.rows.map((x) => [x.question_id, x.kind, x.threshold === null ? null : Number(x.threshold)])).toEqual([
        [a, 'individual', null], [b, 'bulk', 0.8], [c, 'bulk', 0.8],
      ]);
      expect(r.rows.every((x) => x.decided_by === owner.id)).toBe(true);
    });
  });

  it('2. the record keeps the answer and models as approved', async () => {
    const opp = await response();
    const s = await session(opp);
    const a = await question(s, { final: 'Our edited answer.' });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [a]);
      await q(`UPDATE rfi_questions SET final_answer = 'Changed later.' WHERE id = $1`, [a]);
      const r = await q<Record<string, string>>(`SELECT final_answer, judge_model, draft_model, prompt_version, calibration_set FROM approvals WHERE question_id = $1`, [a]);
      expect(r.rows[0]).toEqual({ final_answer: 'Our edited answer.', judge_model: 'claude-haiku-5-5', draft_model: 'claude-haiku-5-5', prompt_version: 'draft-1', calibration_set: 'set 1' });
      expect((await q<{ status: string }>(`SELECT status FROM rfi_questions WHERE id = $1`, [a])).rows[0].status).toBe('pending');
    });
  });

  it('3. nobody writes approvals directly; anonymous cannot read them', async () => {
    const opp = await response();
    const s = await session(opp);
    const a = await question(s);
    await refused(as(admin, (q) => q(`INSERT INTO approvals (question_id, session_id, kind) VALUES ($1, $2, 'individual')`, [a, s])));
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [a]);
    await refused(as(admin, (q) => q(`UPDATE approvals SET kind = 'bulk' WHERE question_id = $1`, [a])));
    await refused(as(admin, (q) => q(`DELETE FROM approvals WHERE question_id = $1`, [a])));
    await refused(as(null, (q) => q(`SELECT * FROM approvals`)));
  });

  it('4. record_export refuses while anything is pending, and for a member who is not the owner', async () => {
    const opp = await response();
    const s = await session(opp);
    await question(s, { status: 'accepted' });
    const p = await question(s);
    expect(await refused(as(owner, (q) => q(`SELECT record_export($1)`, [s])))).toMatch(/1 question\(s\) are still pending/);
    await asSuperuser(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [p]);
    await refused(as(member, (q) => q(`SELECT record_export($1)`, [s])));
    await as(owner, async (q) => {
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export).toMatchObject({ accepted: 1, skipped: 1 });
      // 5. The export is in the audit log, and the session is completed.
      const log = await q(`SELECT 1 FROM audit_log WHERE action = 'response.exported' AND target_id = $1`, [s]);
      expect(log.rowCount).toBe(0); // members and owners cannot read the audit log
      const st = await q<{ status: string; exported_at: string }>(`SELECT status, exported_at FROM rfi_sessions WHERE id = $1`, [s]);
      expect(st.rows[0].status).toBe('completed');
      expect(st.rows[0].exported_at).not.toBeNull();
    });
  });

  it('5. a recorded export is in the audit log with its counts (as an admin sees it)', async () => {
    const opp = await response();
    const s = await session(opp);
    await question(s, { status: 'accepted' });
    await as(admin, async (q) => {
      await q(`SELECT record_export($1)`, [s]);
      const log = await q<{ details: { accepted: number } }>(`SELECT details FROM audit_log WHERE action = 'response.exported' AND target_id = $1`, [s]);
      expect(log.rows[0].details.accepted).toBe(1);
    });
  });
});

describe('S3-3 archive, outcome and admin-only delete', () => {
  it('1. the owner archives an exported response; it becomes read-only', async () => {
    const opp = await response();
    const s = await session(opp);
    const a = await question(s);
    await asSuperuser(`UPDATE opportunities SET exported_at = now() WHERE id = $1`, [opp]);
    await as(owner, async (q) => {
      await q(`SELECT archive_response($1, 'won')`, [opp]);
      expect((await q<{ stage: string; outcome: string }>(`SELECT stage, outcome FROM response_overview WHERE id = $1`, [opp])).rows[0])
        .toMatchObject({ stage: 'archived', outcome: 'won' });
      await refused(q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [a]));
      await refused(q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 9, 'Late?')`, [s]));
      await refused(q(`UPDATE opportunities SET name = 'Renamed' WHERE id = $1`, [opp]));
    });
  });

  it('2. archiving before export is refused unless the outcome is withdrawn', async () => {
    const opp = await response();
    await refused(as(owner, (q) => q(`SELECT archive_response($1, 'won')`, [opp])));
    await as(owner, (q) => q(`SELECT archive_response($1, 'withdrawn')`, [opp]));
  });

  it('3. a member cannot archive; an unknown outcome is refused', async () => {
    const opp = await response();
    await refused(as(member, (q) => q(`SELECT archive_response($1, 'withdrawn')`, [opp])));
    await refused(as(owner, (q) => q(`SELECT archive_response($1, 'cancelled')`, [opp])));
  });

  it('4. an admin can delete an archived response created in error, with its sessions and questions', async () => {
    const opp = await response();
    const s = await session(opp);
    await question(s);
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [opp]);
    await as(admin, async (q) => {
      await q(`SELECT delete_response($1, 'Duplicate created by mistake')`, [opp]);
      expect((await q('SELECT 1 FROM rfi_sessions WHERE id = $1', [s])).rowCount).toBe(0);
    });
  });
});

describe('S3-4 learning at export', () => {
  async function exportOne(opts: Parameters<typeof question>[1]) {
    const opp = await response({ name: 'Learning test' });
    const s = await session(opp);
    const id = await question(s, { status: 'pending', ...opts });
    return { opp, s, id };
  }
  const accept = (q: (sql: string, p?: unknown[]) => Promise<unknown>, id: string) =>
    q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);

  it('1. an edited answer becomes an entry with provenance, and supersedes its near-duplicate', async () => {
    const old = await entry('How do you encrypt data at rest? (S3-4 t1)', 'AES-128.');
    const { opp, s, id } = await exportOne({ final: 'We encrypt data at rest with AES-256 and rotate keys yearly.', sources: [[old.ref, 0.72]], verdict: 'yes' });
    // From the Sprint 4 security review only an admin's approval supersedes at once; an owner's
    // becomes a proposed replacement (supabase/tests/db/sprint4.test.ts).
    await as(admin, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'We encrypt data at rest with AES-256 and rotate keys yearly.' WHERE id = $1`, [id]);
      await accept(q, id);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export.superseded).toBe(1);
      const learned = await q<Record<string, unknown>>(
        `SELECT k.origin, k.origin_ref, k.created_by, k.tags, k.answer FROM rfi_questions x JOIN kb_entries k ON k.id = x.learned_entry_id WHERE x.id = $1`, [id]);
      expect(learned.rows[0]).toMatchObject({
        origin: 'response', origin_ref: `response:${opp}/session:${s}/question:${id}`, created_by: admin.id,
        tags: ['encryption'], answer: 'We encrypt data at rest with AES-256 and rotate keys yearly.',
      });
      const o = await q<{ superseded_by: string | null }>(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [old.id]);
      expect(o.rows[0].superseded_by).not.toBeNull();
      // 7. The superseded entry is kept for history, but no longer matched.
      const m = await q<{ ref: string }>(`SELECT ref FROM match_kb_entries(NULL, 'encrypt data rest S3-4 t1', 5, NULL)`);
      expect(m.rows.map((x) => x.ref)).not.toContain(old.ref);
    });
  });

  it('2. a non-duplicate edited answer is added beside the existing entries', async () => {
    const old = await entry('What is your backup policy? (S3-4 t2)', 'Daily backups.', ['backup']);
    const { s, id } = await exportOne({ text: 'Do you test restores? (S3-4 t2)', final: 'Restores are tested quarterly.', sources: [[old.ref, 0.2]], verdict: 'partly' });
    await as(owner, async (q) => {
      await accept(q, id);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export.added).toBe(1);
      expect((await q<{ superseded_by: string | null }>(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [old.id])).rows[0].superseded_by).toBeNull();
    });
  });

  it('a judge "no" stops supersession even above the threshold', async () => {
    const old = await entry('Which SIEM do you use? (S3-4 judge)', 'A centralised SIEM.', ['logging']);
    const { s, id } = await exportOne({ text: 'Which SIEM product do you use? (S3-4 judge)', final: 'We use Splunk.', sources: [[old.ref, 0.9]], verdict: 'no' });
    await as(owner, async (q) => {
      await accept(q, id);
      expect((await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s])).rows[0].record_export.added).toBe(1);
    });
  });

  it('3. an unedited draft adds nothing and confirms the entries it came from', async () => {
    const old = await entry('MFA? (S3-4 t3)', 'MFA everywhere.', ['mfa']);
    const { s, id } = await exportOne({ sources: [[old.ref, 0.8]] });
    // From Sprint 4 (F-25) only cited entries are confirmed; processing records them in cited_refs.
    await asSuperuser(`UPDATE rfi_questions SET cited_refs = $2 WHERE id = $1`, [id, [old.ref]]);
    await as(owner, async (q) => {
      await accept(q, id);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export).toMatchObject({ confirmed: 1 });
      expect(r.rows[0].record_export.added).toBeUndefined();
      expect((await q<{ last_reviewed_at: string | null }>(`SELECT last_reviewed_at FROM kb_entries WHERE id = $1`, [old.id])).rows[0].last_reviewed_at).not.toBeNull();
    });
  });

  // Sprint 12 (S12-3, C-1): Japanese answers are now learned; pricing answers still never are.
  it('4. pricing answers are never learned; legal and (since Sprint 12) Japanese answers are', async () => {
    const opp = await response();
    const s = await session(opp);
    const pricing = await question(s, { text: 'What is the price? (t4)', gate: 'pricing', final: '£10 per seat.', kind: 'person_required', confidence: 0.1 });
    const ja = await question(s, { text: '価格は？(t4)', gate: 'translation', language: 'ja', final: '回答' });
    const legal = await question(s, { text: 'Liability cap? (t4)', gate: 'legal', final: 'Capped at fees paid.' });
    await as(owner, async (q) => {
      for (const id of [pricing, ja, legal]) await accept(q, id);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      // Sprint 12 security review (M3): a draft gated as translated is learned as a translation.
      expect(r.rows[0].record_export).toMatchObject({ not_learned_pricing: 1, added: 1, translated: 1 });
      expect((await q(`SELECT 1 FROM kb_entries WHERE question = 'What is the price? (t4)'`)).rowCount).toBe(0);
      expect((await q(`SELECT language FROM kb_entries WHERE question = '価格は？(t4)'`)).rows[0].language).toBe('ja');
    });
  });

  it('5. recording the same export twice does not learn twice', async () => {
    const { s, id } = await exportOne({ text: 'Twice? (t5)', final: 'Once only.' });
    await as(owner, async (q) => {
      await accept(q, id);
      await q(`SELECT record_export($1)`, [s]);
      const again = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(again.rows[0].record_export.added).toBeUndefined();
      expect((await q(`SELECT 1 FROM kb_entries WHERE question = 'Twice? (t5)'`)).rowCount).toBe(1);
    });
  });

  it('the same question asked again supersedes the old entry rather than failing', async () => {
    const old = await entry('Same question? (dup key)', 'Old answer.');
    const { s, id } = await exportOne({ text: 'same   QUESTION? (dup key)', final: 'New answer.', sources: [[old.ref, 0.1]], verdict: 'no' });
    await as(admin, async (q) => {
      await accept(q, id);
      expect((await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s])).rows[0].record_export.superseded).toBe(1);
    });
    // An owner's approval of the same question is proposed beside it instead (Sprint 4 review).
    await as(owner, async (q) => {
      await accept(q, id);
      expect((await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s])).rows[0].record_export.proposed).toBe(1);
    });
  });
});

describe('S3-5 who may decide a question (F-7)', () => {
  it('1 and 2. owner, admin and an assignee may decide; another member may not', async () => {
    const opp = await response();
    const s = await session(opp);
    const id = await question(s);
    for (const u of [owner, admin]) {
      expect((await as(u, (q) => q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]))).rowCount).toBe(1);
    }
    expect((await as(member, (q) => q(`UPDATE rfi_questions SET status = 'skipped' WHERE id = $1`, [id]))).rowCount).toBe(0);
    await asSuperuser(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by) VALUES ($1, $2, $3, $4, $5)`,
      [id, s, opp, member.id, owner.id]);
    expect((await as(member, (q) => q(`UPDATE rfi_questions SET final_answer = 'Mine.' WHERE id = $1`, [id]))).rowCount).toBe(1);
  });
});

describe('found while building: bulk-approved drafts are confirmed, not treated as empty', () => {
  it('a question accepted in bulk (final_answer left null) confirms its entry', async () => {
    const old = await entry('Bulk confirm? (bulk)', 'Yes.', ['bulk']);
    const opp = await response();
    const s = await session(opp);
    await question(s, { confidence: 0.95, sources: [[old.ref, 0.8]] });
    await as(owner, async (q) => {
      await q(`SELECT bulk_accept($1, 0.8)`, [s]);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export).toMatchObject({ confirmed: 1, accepted: 1 });
    });
  });
});

describe('S3-6 expert suggestions', () => {
  it('1 to 4. history outranks tags, tags alone still count, ties are stable, and no match gives none', async () => {
    const tagged = await createUser({ name: 'Bea Tagged' });
    const tagged2 = await createUser({ name: 'Al Tagged' });
    await asSuperuser(`UPDATE user_profiles SET expertise_tags = '{Firewalls}' WHERE id = ANY ($1)`, [[tagged.id, tagged2.id]]);
    const written = await entry('Firewall rules? (S3-6)', 'Reviewed quarterly.', ['firewalls'], expert.id);
    const opp = await response();
    const s = await session(opp);
    const id = await question(s, { sources: [[written.ref, 0.8]] });
    // The expert also approved an earlier answer drawn from the same entry.
    const earlier = await question(s, { sources: [[written.ref, 0.7]] });
    await asSuperuser(
      `INSERT INTO approvals (question_id, session_id, opportunity_id, decided_by, kind) VALUES ($1, $2, $3, $4, 'individual')`,
      [earlier, s, opp, expert.id]);
    const r = await as(member, (q) => q<{ display_name: string; score: number; reasons: string[] }>(`SELECT * FROM suggest_experts($1)`, [id]));
    expect(r.rows.map((x) => x.display_name)).toEqual(['Ada Expert', 'Al Tagged', 'Bea Tagged']);
    expect(r.rows[0].reasons).toEqual([`wrote ${written.ref}`, 'approved 1 answer drawn from the same entries']);
    expect(r.rows[1].reasons).toEqual(['expertise: firewalls']);

    const unrelated = await question(s, { sources: [] });
    expect((await as(member, (q) => q(`SELECT * FROM suggest_experts($1)`, [unrelated]))).rowCount).toBe(0);
  });

  it('5. only signed-in members can ask', async () => {
    const opp = await response();
    const id = await question(await session(opp));
    await refused(as(null, (q) => q(`SELECT * FROM suggest_experts($1)`, [id])));
  });
});

describe('Sprint 3 security review findings', () => {
  it('1. a member cannot point an assignment at another response\'s question, and a forged one gives no rights', async () => {
    const victim = await response({ name: 'Victim' });
    const vs = await session(victim);
    const target = await question(vs);
    const mine = (await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Mine', $1, $1) RETURNING id`, [member.id])).id;
    await refused(as(member, (q) => q(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by) VALUES ($1, NULL, $2, $3, $3)`,
      [target, mine, member.id])));
    const ms = await session(mine);
    await refused(as(member, (q) => q(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by) VALUES ($1, $2, $3, $4, $4)`,
      [target, ms, mine, member.id])));
    // Even a row written around the checks (as the database owner) does not let them decide it.
    await asSuperuser(`ALTER TABLE question_assignments DISABLE TRIGGER question_assignments_question_matches`);
    await asSuperuser(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by) VALUES ($1, $2, $3, $4, $4)`,
      [target, ms, mine, member.id]);
    await asSuperuser(`ALTER TABLE question_assignments ENABLE TRIGGER question_assignments_question_matches`);
    expect((await as(member, (q) => q(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Poison' WHERE id = $1`, [target]))).rowCount).toBe(0);
  });

  // Sprint 12 (S12-3): Japanese text is no longer a reason not to learn.
  it('2. learning is an allow list: unprocessed and unchecked questions are not learned', async () => {
    const opp = await response();
    const s = await session(opp);
    const unprocessed = (await one<{ id: string }>(
      `INSERT INTO rfi_questions (session_id, position, question, final_answer, status) VALUES ($1, 0, 'Unprocessed? (r2)', 'Learn me', 'pending') RETURNING id`, [s])).id;
    const unchecked = await question(s, { text: 'What is the price per seat? (r2)', gate: 'unchecked', final: '£5.' });
    const jaText = await question(s, { text: '価格はいくらですか？(r2)', language: 'en', final: '5ポンド' });
    await as(owner, async (q) => {
      for (const id of [unprocessed, unchecked, jaText]) await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export).toMatchObject({ not_learned_unchecked: 2, added: 1 });
      expect(r.rows[0].record_export.not_learned_japanese).toBeUndefined();
    });
  });

  it('3. members cannot insert a response that is already archived or exported', async () => {
    await refused(as(member, (q) => q(`INSERT INTO opportunities (name, archived_at, outcome) VALUES ('Fake win', now(), 'won')`)));
    await refused(as(member, (q) => q(`INSERT INTO opportunities (name, exported_at) VALUES ('Fake', now())`)));
    const r = await as(member, (q) => q(`INSERT INTO opportunities (name, due_date) VALUES ('Real', current_date + 7) RETURNING id`));
    expect(r.rowCount).toBe(1);
  });

  it('4. members cannot set origin_ref directly; an import records its file name and cannot claim origin response', async () => {
    await refused(as(member, (q) => q(
      `INSERT INTO kb_entries (question, answer, origin, origin_ref) VALUES ('Forged? (r4)', 'x', 'manual', 'response:abc/session:def/question:ghi')`)));
    await as(member, async (q) => {
      await q(`SELECT import_kb_entries($1::jsonb, 'import', 'answers.csv')`, [JSON.stringify([{ question: 'Imported? (r4)', answer: 'Yes.', tags: [], source: 'Policy v1' }])]);
      const r = await q<{ origin_ref: string | null; origin: string }>(`SELECT origin_ref, origin FROM kb_entries WHERE question = 'Imported? (r4)'`);
      expect(r.rows[0]).toEqual({ origin_ref: 'answers.csv', origin: 'import' });
    });
    await refused(as(member, (q) => q(`SELECT import_kb_entries('[{"question":"x? (r4)","answer":"y"}]'::jsonb, 'response', 'r')`)));
  });

  it('5. a "yes" about another entry does not supersede the top source', async () => {
    const top = await entry('Top entry? (r5)', 'Top.', ['x']);
    const other = await entry('Other entry? (r5)', 'Other.', ['x']);
    const opp = await response();
    const s = await session(opp);
    const id = await question(s, { text: 'A question (r5)', final: 'Edited.', sources: [[top.ref, 0.9], [other.ref, 0.85]], verdict: 'yes', bestRef: other.ref });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
      const r = await q<{ record_export: Record<string, number> }>(`SELECT record_export($1)`, [s]);
      expect(r.rows[0].record_export.added).toBe(1);
      expect((await q<{ superseded_by: string | null }>(`SELECT superseded_by FROM kb_entries WHERE id = $1`, [top.id])).rows[0].superseded_by).toBeNull();
    });
  });
});
