// Sprint 25 (S25-2, F-74): the per-file functions out of the API. Test numbers refer to
// docs/refinement/sprint-25.md. A response is sent, and bulk-approved, only as a whole (Sprint 24, Q3):
// record_export and bulk_accept stay for the whole-response functions and the demo loaders, which run
// as the database owner, and no signed-in user, visitor or the service role may call them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let owner: TestUser;
let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Owner (S25)' });
  member = await createUser({ name: 'Member (S25)' });
  admin = await createUser({ admin: true, name: 'Admin (S25)' });
});
afterAll(closePool);

async function oneFile(name: string) {
  const r = await response(owner.id, { name });
  const s = await session(r);
  await question(s, { text: `The only question of ${name}?` });
  await asSuperuser(`UPDATE rfi_sessions SET question_count = 1 WHERE id = $1`, [s]);
  return { r, s };
}

const PER_FILE = [`record_export($1)`, `bulk_accept($1, 0.8)`];

describe('S25-2 1: the per-file functions are refused to every caller through the API', () => {
  it('the owner, an admin, a member, a signed-out visitor and the service role are each refused', async () => {
    const { s } = await oneFile('Matrix (S25 1)');
    for (const fn of PER_FILE) {
      for (const [who, run] of [
        ['owner', (sql: string) => as(owner, (q) => q(sql, [s]))],
        ['admin', (sql: string) => as(admin, (q) => q(sql, [s]))],
        ['member', (sql: string) => as(member, (q) => q(sql, [s]))],
        ['visitor', (sql: string) => as(null, (q) => q(sql, [s]))],
        ['service role', (sql: string) => asServiceRole((q) => q(sql, [s]))],
      ] as const) {
        expect(await refused(run(`SELECT ${fn}`)), `${who}: ${fn}`).toMatch(/permission denied for function/);
      }
    }
  });

  it('no API role holds EXECUTE on either function, directly or through PUBLIC', async () => {
    for (const fn of ['public.record_export(uuid)', 'public.bulk_accept(uuid, numeric)']) {
      for (const role of ['authenticated', 'anon', 'service_role']) {
        const r = await one<{ ok: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn]);
        expect(r.ok, `${role} on ${fn}`).toBe(false);
      }
    }
  });
});

describe('S25-2 2: the whole-response functions still work for the owner and an admin', () => {
  it('bulk approval and marking as sent, through the definer functions that call the per-file ones', async () => {
    for (const who of [owner, admin]) {
      const { r, s } = await oneFile(`Whole (S25 2, ${who.id.slice(0, 4)})`);
      const out = await as(who, async (q) => {
        const bulk = (await q<{ r: Record<string, number> }>(`SELECT bulk_accept_response($1, 0) AS r`, [r])).rows[0].r;
        const sent = (await q<{ r: Record<string, number> }>(`SELECT record_response_export($1) AS r`, [r])).rows[0].r;
        const file = (await q<{ exported_at: string | null }>(`SELECT exported_at FROM rfi_sessions WHERE id = $1`, [s])).rows[0];
        const resp = (await q<{ exported_at: string | null }>(`SELECT exported_at FROM opportunities WHERE id = $1`, [r])).rows[0];
        return { bulk, sent, file, resp };
      });
      expect(out.bulk.accepted).toBe(1);
      expect(out.sent.accepted).toBe(1);
      expect(out.file.exported_at).not.toBeNull();
      expect(out.resp.exported_at).not.toBeNull();
    }
  });
});
