// Sprint 4: cost controls and governance. Test numbers refer to docs/refinement/sprint-4.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let admin: TestUser;
let owner: TestUser;
let member: TestUser;

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  owner = await createUser();
  member = await createUser();
});
afterAll(closePool);

describe('S4-2 bulk approval and delete markers cannot be forged (F-24)', () => {
  it('1. setting app.bulk_threshold by hand does not allow a multi-row accept', async () => {
    const s = await session(await response(owner.id));
    await question(s);
    await question(s);
    await refused(as(owner, async (q) => {
      await q(`SELECT set_config('app.bulk_threshold', '0.8', true)`);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1`, [s]);
    }));
  });

  it('2. setting app.deleting_response by hand does not allow changing an archived response', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    const id = await question(s);
    await asSuperuser(`UPDATE opportunities SET exported_at = now(), archived_at = now(), outcome = 'won' WHERE id = $1`, [opp]);
    await refused(as(admin, async (q) => {
      await q(`SELECT set_config('app.deleting_response', $1, true)`, [opp]);
      await q(`UPDATE rfi_questions SET final_answer = 'Rewritten' WHERE id = $1`, [id]);
    }));
  });

  it('3. bulk_accept and delete_response still work, and bulk approvals record the threshold', async () => {
    const opp = await response(owner.id);
    const s = await session(opp);
    await question(s);
    await question(s);
    await as(owner, async (q) => {
      const r = await q<{ bulk_accept: { accepted: number } }>(`SELECT bulk_accept($1, 0.8)`, [s]);
      expect(r.rows[0].bulk_accept.accepted).toBe(2);
      const a = await q<{ kind: string; threshold: string }>(`SELECT kind, threshold FROM approvals WHERE session_id = $1`, [s]);
      expect(a.rows).toEqual([{ kind: 'bulk', threshold: '0.8' }, { kind: 'bulk', threshold: '0.8' }]);
    });
    await as(admin, async (q) => {
      await q(`SELECT delete_response($1, 'Created in error for a test')`, [opp]);
      expect((await q(`SELECT 1 FROM opportunities WHERE id = $1`, [opp])).rowCount).toBe(0);
    });
  });

  it('4. members cannot read or write the private operations table', async () => {
    await refused(as(member, (q) => q(`SELECT * FROM private.operations`)));
    await refused(as(member, (q) => q(`INSERT INTO private.operations (kind, value) VALUES ('bulk', '0')`)));
  });

  it('5. after bulk_accept returns, the same transaction is no longer treated as bulk', async () => {
    const s = await session(await response(owner.id));
    await question(s, { confidence: 0.9 });
    await question(s, { confidence: 0.5 });
    await question(s, { confidence: 0.5 });
    await refused(as(owner, async (q) => {
      await q(`SELECT bulk_accept($1, 0.8)`, [s]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1 AND status = 'pending'`, [s]);
    }));
  });
});

void one;
