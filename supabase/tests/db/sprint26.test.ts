// Sprint 26 (S26-1, F-73): sending a large response within the hosted time limit. Test numbers refer
// to docs/refinement/sprint-26.md. The Sprint 25 spike (docs/spikes/f73-sending-large-responses.md)
// found two costs that grow faster than the number of questions: the approved count recounted after
// every update of a question, whatever changed, and the cited entries' tags found by scanning the
// knowledge base. These tests pin what both do, so the faster versions change only how long they take.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let owner: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Owner (S26)' });
  admin = await createUser({ admin: true, name: 'Admin (S26)' });
});
afterAll(closePool);

async function fileOf(n: number, name: string) {
  const r = await response(owner.id, { name });
  const s = await session(r);
  const qs: string[] = [];
  for (let i = 0; i < n; i++) qs.push(await question(s, { text: `${name} question ${i}?` }));
  await asSuperuser(`UPDATE rfi_sessions SET question_count = $2 WHERE id = $1`, [s, n]);
  return { r, s, qs };
}
const count = async (s: string) => (await one<{ c: number }>(`SELECT accepted_count AS c FROM rfi_sessions WHERE id = $1`, [s])).c;

describe('S26-1 1: the approved count is right after every kind of change', () => {
  it('approving, un-approving, several in one statement, and an update that changes no status', async () => {
    const { s, qs } = await fileOf(4, 'Count (S26 1)');
    expect(await count(s)).toBe(0);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes.' WHERE id = $1`, [qs[0]]);
    expect(await count(s)).toBe(1);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes.' WHERE id = ANY($1)`, [qs.slice(1, 3)]);
    expect(await count(s)).toBe(3);
    // One statement that approves one and un-approves another: the number does not change, and stays right.
    await asSuperuser(
      `UPDATE rfi_questions SET status = CASE WHEN id = $1 THEN 'pending' ELSE 'accepted' END,
                                final_answer = CASE WHEN id = $1 THEN NULL ELSE 'Yes.' END
        WHERE id = ANY($2)`, [qs[0], [qs[0], qs[3]]]);
    expect(await count(s)).toBe(3);
    await asSuperuser(`UPDATE rfi_questions SET status = 'pending', final_answer = NULL WHERE id = $1`, [qs[1]]);
    expect(await count(s)).toBe(2);
    await asSuperuser(`UPDATE rfi_questions SET language = 'en' WHERE session_id = $1`, [s]);
    expect(await count(s)).toBe(2);
  });

  it('a statement touching two files counts each file on its own', async () => {
    const a = await fileOf(2, 'Two files A (S26 1)');
    const b = await fileOf(3, 'Two files B (S26 1)');
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes.' WHERE id = ANY($1)`, [[...a.qs, b.qs[0]]]);
    expect([await count(a.s), await count(b.s)]).toEqual([2, 1]);
  });
});

describe('S26-1 2: an update that changes no question\'s status recounts nothing', () => {
  it('a count set wrong on purpose stays wrong until a status changes, then is put right', async () => {
    const { s, qs } = await fileOf(3, 'No recount (S26 2)');
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes.' WHERE id = $1`, [qs[0]]);
    await asSuperuser(`UPDATE rfi_sessions SET accepted_count = 99 WHERE id = $1`, [s]);
    await asSuperuser(`UPDATE rfi_questions SET learned_at = now() WHERE session_id = $1`, [s]);
    expect(await count(s)).toBe(99);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes.' WHERE id = $1`, [qs[1]]);
    expect(await count(s)).toBe(2);
  });
});

describe('S26-1 4: the tags learned from a sent answer are the cited entries\' tags, as before', () => {
  it('an answer citing several entries, one citing an entry with no tags, and one citing none', async () => {
    const a = await entry({ question: 'Tagged A (S26 4)?' });
    const b = await entry({ question: 'Tagged B (S26 4)?' });
    const bare = await entry({ question: 'No tags (S26 4)?' });
    await asSuperuser(`UPDATE kb_entries SET tags = ARRAY['security', 'iso'] WHERE id = $1`, [a.id]);
    await asSuperuser(`UPDATE kb_entries SET tags = ARRAY['iso', 'hosting'] WHERE id = $1`, [b.id]);
    const r = await response(owner.id, { name: 'Tags (S26 4)' });
    const s = await session(r);
    const several = await question(s, { text: 'Which standards do you hold for hosting (S26 4)?', sources: [a.ref, b.ref], cited: [a.ref, b.ref], final: 'ISO 27001.' });
    const untagged = await question(s, { text: 'Is there an untagged source (S26 4)?', sources: [bare.ref], cited: [bare.ref], final: 'Yes.' });
    const none = await question(s, { text: 'Is anything cited at all (S26 4)?', sources: [], cited: [], final: 'No.' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1`, [s]);
    await asSuperuser(`UPDATE rfi_sessions SET question_count = 3 WHERE id = $1`, [s]);
    // as() rolls its transaction back at the end, so what was learned is read inside it.
    const learned = await as(owner, async (q) => {
      await q(`SELECT record_response_export($1)`, [r]);
      return (await q<{ id: string; outcome: string; tags: string[] | null }>(
        `SELECT q.id, q.learn_outcome AS outcome, k.tags FROM rfi_questions q LEFT JOIN kb_entries k ON k.id = q.learned_entry_id
          WHERE q.session_id = $1`, [s])).rows;
    });
    const of = (id: string) => learned.find((x) => x.id === id)!;
    expect(learned.map((x) => x.outcome).every((o) => ['added', 'proposed', 'superseded'].includes(o))).toBe(true);
    expect([...(of(several).tags ?? [])].sort()).toEqual(['hosting', 'iso', 'security']);
    expect(of(untagged).tags).toEqual([]);
    expect(of(none).tags).toEqual([]);
  });
});

// S26-1, the limit (Rory, 9 November): at most 2,000 questions a response, which staging sends in about
// half the 8-second limit after the fix; enforced by the database when a file is added or its count changed.
const addFile = (u: TestUser, r: string | null, n: number, name = 'more.xlsx') =>
  as(u, (q) => q(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ($1, $2, $3) RETURNING id`, [name, n, r]));

describe('S26-1 6: a file that would take a response past 2,000 questions is refused, with the reason', () => {
  it('for the owner and an admin: past the limit refused, saying the size and the limit; exactly to it accepted', async () => {
    for (const u of [owner, admin]) {
      const r = await response(owner.id, { name: `Limit (S26 6, ${u === owner ? 'owner' : 'admin'})` });
      await asSuperuser(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('first.xlsx', 1500, $1)`, [r]);
      const msg = await refused(addFile(u, r, 501));
      expect(msg).toMatch(/This response would have 2,001 questions; a response can have at most 2,000/);
      expect(msg).toMatch(/new response/);
      await expect(addFile(u, r, 500)).resolves.toBeTruthy();
    }
  });

  it('raising a file\'s count past the limit is refused too, whoever does it', async () => {
    const r = await response(owner.id, { name: 'Raise (S26 6)' });
    const s = (await one<{ id: string }>(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('a.xlsx', 1000, $1) RETURNING id`, [r])).id;
    await one(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('b.xlsx', 1000, $1) RETURNING id`, [r]);
    expect(await refused(asSuperuser(`UPDATE rfi_sessions SET question_count = 1001 WHERE id = $1`, [s]))).toMatch(/at most 2,000/);
    await expect(asSuperuser(`UPDATE rfi_sessions SET question_count = 999 WHERE id = $1`, [s])).resolves.toBeTruthy();
  });

  it('moving a file into a response is checked against that response', async () => {
    const full = await response(owner.id, { name: 'Full (S26 6)' });
    await one(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('big.xlsx', 2000, $1) RETURNING id`, [full]);
    const other = await response(owner.id, { name: 'Other (S26 6)' });
    const s = (await one<{ id: string }>(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('one.xlsx', 1, $1) RETURNING id`, [other])).id;
    expect(await refused(asSuperuser(`UPDATE rfi_sessions SET opportunity_id = $2 WHERE id = $1`, [s, full]))).toMatch(/2,001 questions/);
  });
});

describe('S26-1 7: a file of more than 2,000 questions is refused, whatever the app sends', () => {
  it('in a response or with none, for the owner and an admin', async () => {
    for (const u of [owner, admin]) {
      const r = await response(owner.id, { name: `Huge (S26 7, ${u === owner ? 'owner' : 'admin'})` });
      expect(await refused(addFile(u, r, 100000))).toMatch(/100,000 questions; a response can have at most 2,000/);
    }
    expect(await refused(addFile(admin, null, 2001))).toMatch(/A file can have at most 2,000 questions/);
    await expect(addFile(admin, null, 2000)).resolves.toBeTruthy();
  });

  it('a negative count is refused', async () => {
    const r = await response(owner.id, { name: 'Negative (S26 7)' });
    expect(await refused(addFile(owner, r, -5))).toBeTruthy();
  });
});

describe('S26-1 8: two files added at once cannot together pass the limit', () => {
  async function connection(u: TestUser) {
    const c = await getPool().connect();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated', email: u.email })]);
    return c;
  }
  it('the second waits for the first, then sees it and is refused', async () => {
    const r = await response(owner.id, { name: 'Race (S26 8)' });
    await one(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('base.xlsx', 500, $1) RETURNING id`, [r]);
    const a = await connection(owner);
    const b = await connection(admin);
    try {
      await a.query(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('a.xlsx', 1000, $1)`, [r]);
      const late = b.query(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('b.xlsx', 1000, $1)`, [r]);
      await new Promise((res) => setTimeout(res, 200));
      await a.query('COMMIT');
      expect(await refused(late)).toMatch(/2,500 questions/);
    } finally {
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
    const total = await one<{ n: number }>(`SELECT sum(question_count)::int AS n FROM rfi_sessions WHERE opportunity_id = $1`, [r]);
    expect(total.n).toBe(1500);
  });

  it('(QA review) two files added while another statement reads the response do not deadlock', async () => {
    // Sprint 24's trigger reads the response FOR SHARE; if the limit's FOR UPDATE came after it, two
    // inserts that each held the share lock would wait for each other ("deadlock detected").
    const r = await response(owner.id, { name: 'No deadlock (S26 QA)' });
    const a = await connection(owner);
    const b = await connection(admin);
    try {
      await a.query(`SELECT 1 FROM opportunities WHERE id = $1 FOR SHARE`, [r]);
      const second = b.query(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('b.xlsx', 10, $1)`, [r]);
      await new Promise((res) => setTimeout(res, 200));
      await a.query(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('a.xlsx', 10, $1)`, [r]);
      await a.query('COMMIT');
      await second;
      await b.query('COMMIT');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
    const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM rfi_sessions WHERE opportunity_id = $1`, [r]);
    expect(total.n).toBe(2);
  });
});

describe('S26-1 7 (security review, M1): a file cannot hold more questions than it said it would', () => {
  it('through the API, a question beyond the file\'s count is refused, for the owner and an admin', async () => {
    for (const u of [owner, admin]) {
      const r = await response(owner.id, { name: `Declared one (S26 M1, ${u === owner ? 'owner' : 'admin'})` });
      const out = await as(u, async (q) => {
        const f = (await q<{ id: string }>(`INSERT INTO rfi_sessions (file_name, question_count, opportunity_id) VALUES ('one.xlsx', 2, $1) RETURNING id`, [r])).rows[0].id;
        await q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 0, 'First (S26 M1)?'), ($1, 1, 'Second (S26 M1)?')`, [f]);
        await q('SAVEPOINT more');
        const third = await q(`INSERT INTO rfi_questions (session_id, position, question) VALUES ($1, 2, 'Third (S26 M1)?')`, [f]).then(() => 'added', (e: Error) => e.message);
        await q('ROLLBACK TO SAVEPOINT more');
        const many = await q(`INSERT INTO rfi_questions (session_id, position, question) SELECT $1, g, 'Many ' || g || '?' FROM generate_series(10, 3009) g`, [f]).then(() => 'added', (e: Error) => e.message);
        return { third, many };
      });
      expect(out.third).toMatch(/This file said it had 2 questions, and holds them all, so no more can be added/);
      expect(out.many).toMatch(/so no more can be added/);
    }
  });
});
