// Sprint 6: checker reliability. Test numbers refer to docs/refinement/sprint-6.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
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

describe('S6-3 the checker\'s reason is written by the server only', () => {
  it('1. no signed-in user can write judge_reason; the service role can, and members can read it', async () => {
    const s = await session(await response(owner.id));
    const id = await question(s);
    for (const u of [member, owner, admin]) {
      await refused(as(u, (q) => q(`UPDATE rfi_questions SET judge_reason = 'planted' WHERE id = $1`, [id])));
    }
    await refused(as(owner, (q) => q(`INSERT INTO rfi_questions (session_id, position, question, judge_reason) VALUES ($1, 1, 'q', 'planted')`, [s])));
    // as() and asServiceRole() roll back, so the write is checked inside it and then made for real.
    const w = await asServiceRole((q) => q(`UPDATE rfi_questions SET judge_reason = 'KB-0001 names it.' WHERE id = $1`, [id]));
    expect(w.rowCount).toBe(1);
    await asSuperuser(`UPDATE rfi_questions SET judge_reason = 'KB-0001 names it.' WHERE id = $1`, [id]);
    const r = await as(member, (q) => q<{ judge_reason: string }>(`SELECT judge_reason FROM rfi_questions WHERE id = $1`, [id]));
    expect(r.rows[0].judge_reason).toBe('KB-0001 names it.');
  });

  it('a reason longer than 300 characters is refused', async () => {
    const id = await question(await session(await response(owner.id)));
    await refused(asServiceRole((q) => q(`UPDATE rfi_questions SET judge_reason = repeat('a', 301) WHERE id = $1`, [id])));
    expect((await one<{ n: string }>(`SELECT count(*) AS n FROM rfi_questions WHERE id = $1 AND judge_reason IS NULL`, [id])).n).toBe('1');
  });
});
