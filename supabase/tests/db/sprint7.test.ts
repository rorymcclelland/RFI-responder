// Sprint 7. Test numbers refer to docs/refinement/sprint-7.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, type TestUser } from './harness';
import { entry, question, response, session } from './fixtures';

let owner: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser();
});
afterAll(closePool);

type Bulk = { accepted: number; heldPartly: number };
const statuses = async (q: (sql: string, p?: unknown[]) => Promise<{ rows: { id: string; status: string }[] }>, s: string) =>
  new Map((await q(`SELECT id, status FROM rfi_questions WHERE session_id = $1`, [s])).rows.map((r) => [r.id, r.status]));

describe('S7-1 bulk approval needs a "yes" verdict (F-33)', () => {
  it('1, 2 and 3: yes accepted; partly and no held and counted (similarity only: since Sprint 9 held too, see sprint9.test.ts)', async () => {
    const s = await session(await response(owner.id));
    const yes = await question(s, { verdict: 'yes', confidence: 0.85, text: 'Yes (S7-1)?' });
    const partly = await question(s, { verdict: 'partly', confidence: 0.875, text: 'Partly (S7-1)?' });
    const no = await question(s, { verdict: 'no', confidence: 0.9, text: 'No with a draft (S7-1)?' });
    const simOnly = await question(s, { verdict: null, judgeModel: null, confidence: 0.9, text: 'Similarity only (S7-1)?' });
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 1, heldPartly: 2 });
      const st = await statuses(q, s);
      expect([st.get(yes), st.get(partly), st.get(no), st.get(simOnly)]).toEqual(['accepted', 'pending', 'pending', 'pending']);
    });
  });

  it('5. a "partly" question can still be accepted on its own', async () => {
    const s = await session(await response(owner.id));
    const partly = await question(s, { verdict: 'partly', confidence: 0.875, text: 'Partly, individually (S7-1 t5)?' });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [partly]);
      expect((await statuses(q, s)).get(partly)).toBe('accepted');
    });
  });

  it('6. "All eligible" (threshold 0) follows the same rule', async () => {
    const s = await session(await response(owner.id));
    await question(s, { verdict: 'partly', confidence: 0.5, text: 'Partly, low (S7-1 t6)?' });
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 0, heldPartly: 1 });
    });
  });
  it('7 (security review, Sprint 7). a checker that gives a score but no verdict (a reranker) is held, not treated as no checker', async () => {
    const s = await session(await response(owner.id));
    const scored = await question(s, { verdict: null, judgeModel: 'rerank-2.5', confidence: 0.9, text: 'Reranker, no verdict (S7 review)?' });
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk & { heldNoVerdict: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 0, heldPartly: 0, heldNoVerdict: 1 });
      expect((await statuses(q, s)).get(scored)).toBe('pending');
    });
  });
});

describe('S7-2 a draft citing a replaced entry is held from bulk (F-32)', () => {
  const replace = async (oldId: string, newId: string) =>
    asSuperuser(`UPDATE kb_entries SET superseded_by = $2 WHERE id = $1`, [oldId, newId]);

  it('1. a pending question citing an entry that is then replaced is held at bulk approval, naming the replacement', async () => {
    const old = await entry({ question: 'Replaced (S7-2 t1)?' });
    const s = await session(await response(owner.id));
    const id = await question(s, { cited: [old.ref], text: 'Cites the replaced one (S7-2 t1)?' });
    const fresh = await entry({ question: 'Replacement (S7-2 t1)?' });
    await replace(old.id, fresh.id);
    await as(owner, async (q) => {
      expect((await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0.8)`, [s])).rows[0].bulk_accept.accepted).toBe(0);
      const g = (await q<{ gate: string; gate_reason: string }>(`SELECT gate, gate_reason FROM rfi_questions WHERE id = $1`, [id])).rows[0];
      expect(g.gate).toBe('stale_source');
      expect(g.gate_reason).toBe(`Cites ${old.ref} (replaced by ${fresh.ref}), so it is reviewed individually.`);
    });
  });

  it('2. processing sees a replaced entry as replaced (entry_review_status)', async () => {
    const old = await entry({ question: 'Replaced for processing (S7-2 t2)?' });
    const fresh = await entry({ question: 'Its replacement (S7-2 t2)?' });
    await replace(old.id, fresh.id);
    const r = await asSuperuser<{ ref: string; reviewed: boolean; overdue_since: string | null; replaced_by: string | null }>(
      `SELECT * FROM entry_review_status(ARRAY[$1, $2])`, [old.ref, fresh.ref]);
    const byRef = new Map(r.rows.map((x) => [x.ref, x]));
    expect(byRef.get(old.ref)!.replaced_by).toBe(fresh.ref);
    expect(byRef.get(fresh.ref)!.replaced_by).toBeNull();
  });

  it('3 and 4. current entries are unaffected; accepted questions are not changed', async () => {
    const current = await entry({ question: 'Current (S7-2 t3)?' });
    const old = await entry({ question: 'Replaced after acceptance (S7-2 t4)?' });
    const s = await session(await response(owner.id));
    const ok = await question(s, { cited: [current.ref], text: 'Cites current (S7-2 t3)?' });
    const done = await question(s, { cited: [old.ref], text: 'Already accepted (S7-2 t4)?' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [done]);
    await replace(old.id, (await entry({ question: 'Newer (S7-2 t4)?' })).id);
    await as(owner, async (q) => {
      expect((await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0.8)`, [s])).rows[0].bulk_accept.accepted).toBe(1);
      const g = await q<{ id: string; gate: string | null }>(`SELECT id, gate FROM rfi_questions WHERE id = ANY($1)`, [[ok, done]]);
      expect(g.rows.every((x) => x.gate === null)).toBe(true);
    });
  });
});

describe('Security review, Sprint 7 (finding 3): a placeholder is never accepted as an answer', () => {
  const placeholder = 'Insufficient evidence: the matched knowledge-base entries do not answer this question. It needs an answer written by a person.';

  it('1. accepting an unedited "insufficient evidence" or pricing placeholder is refused, by the owner and by an admin', async () => {
    const admin = await createUser({ admin: true });
    const s = await session(await response(owner.id));
    const none = await question(s, { draftKind: 'insufficient_evidence', generated: placeholder, final: placeholder, text: 'Placeholder (review 3 t1)?' });
    const price = await question(s, { draftKind: 'person_required', gate: 'pricing', generated: 'Pricing: a person answers.', final: null, text: 'Price (review 3 t1)?' });
    for (const user of [owner, admin]) {
      for (const id of [none, price]) {
        await expect(as(user, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]))).rejects.toThrow(/written by a person/);
      }
    }
  });

  it('2. once a person has written an answer, it can be accepted; a model draft accepted unedited is unaffected', async () => {
    const s = await session(await response(owner.id));
    const none = await question(s, { draftKind: 'insufficient_evidence', generated: placeholder, final: placeholder, text: 'Placeholder, then written (review 3 t2)?' });
    const drafted = await question(s, { text: 'Drafted (review 3 t2)?' });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'We hold ISO 27001 certification.' WHERE id = $1`, [none]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [none]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [drafted]);
      const st = await statuses(q, s);
      expect([st.get(none), st.get(drafted)]).toEqual(['accepted', 'accepted']);
    });
  });
});
