// Sprint 9. Test numbers refer to docs/refinement/sprint-9.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, type TestUser } from './harness';
import { question, response, session } from './fixtures';

let owner: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser();
});
afterAll(closePool);

type Bulk = { accepted: number; heldPartly: number; heldNoVerdict: number; heldNoChecker: number };
const status = async (q: (sql: string, p?: unknown[]) => Promise<{ rows: { status: string }[] }>, id: string) =>
  (await q(`SELECT status FROM rfi_questions WHERE id = $1`, [id])).rows[0].status;

describe('S9-1 questions calibrated on similarity alone are never bulk-approved (F-40)', () => {
  it('1 and 2. similarity only is held and counted; yes accepted; partly, no and a reranker held as before', async () => {
    const s = await session(await response(owner.id));
    const simOnly = await question(s, { verdict: null, judgeModel: null, confidence: 0.9, text: 'Similarity only (S9-1)?' });
    const yes = await question(s, { verdict: 'yes', confidence: 0.9, text: 'Yes (S9-1)?' });
    const partly = await question(s, { verdict: 'partly', confidence: 0.9, text: 'Partly (S9-1)?' });
    const no = await question(s, { verdict: 'no', confidence: 0.9, text: 'No (S9-1)?' });
    const reranker = await question(s, { verdict: null, judgeModel: 'rerank-2.5', confidence: 0.9, text: 'Reranker (S9-1)?' });
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 1, heldPartly: 2, heldNoVerdict: 1, heldNoChecker: 1 });
      expect(await Promise.all([simOnly, yes, partly, no, reranker].map((id) => status(q, id)))).toEqual(['pending', 'accepted', 'pending', 'pending', 'pending']);
    });
  });

  it('3. a similarity-only question can still be accepted on its own by the owner', async () => {
    const s = await session(await response(owner.id));
    const simOnly = await question(s, { verdict: null, judgeModel: null, confidence: 0.9, text: 'Similarity only, individually (S9-1 t3)?' });
    await as(owner, async (q) => {
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [simOnly]);
      expect(await status(q, simOnly)).toBe('accepted');
    });
  });

  it('"All eligible" (threshold 0) holds it too', async () => {
    const s = await session(await response(owner.id));
    await question(s, { verdict: null, judgeModel: null, confidence: 0.2, text: 'Similarity only, low (S9-1)?' });
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk }>(`SELECT bulk_accept($1, 0)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 0, heldNoChecker: 1 });
    });
  });
});

describe('security review, Sprint 9: a drafted "yes" the server never processed is never bulk-approved', () => {
  it('is held as uncalibrated, not accepted', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s, { verdict: 'yes', confidence: 0.95, text: 'Never processed (S9 review)?' });
    await asSuperuser(`UPDATE rfi_questions SET processed_at = NULL WHERE id = $1`, [id]);
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: Bulk & { heldUncalibrated: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept).toMatchObject({ accepted: 0, heldUncalibrated: 1 });
      expect(await status(q, id)).toBe('pending');
    });
  });
});
