// Sprint 16. Test numbers refer to docs/refinement/sprint-16.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one } from './fixtures';

let member: TestUser;
let admin: TestUser;
const vector = (seed: number, dims = 1024) => Array.from({ length: dims }, (_, i) => ((i + seed) % 7) / 7);

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

async function entries(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ($1, 'Yes.', '{}', 'manual', $2) RETURNING id`, [`S16-2 entry ${i} ${Math.random()}?`, admin.id])).id);
  }
  return ids;
}

describe('S16-2 vectors are saved a batch at a time (BUG-40)', () => {
  it('3. the service role saves 64 vectors in one call', async () => {
    const ids = await entries(64);
    await asServiceRole(async (q) => {
      const rows = ids.map((id, i) => ({ id, embedding: vector(i), model: 'voyage-4' }));
      expect((await q(`SELECT public.save_entry_vectors($1::jsonb) AS n`, [JSON.stringify(rows)])).rows[0].n).toBe(64);
      const saved = await q(`SELECT count(*)::int AS n FROM kb_entries WHERE id = ANY($1) AND embedding_model = 'voyage-4' AND embedding IS NOT NULL AND embedded_at IS NOT NULL`, [ids]);
      expect(saved.rows[0].n).toBe(64);
    });
  });

  // Refusals rely on statement atomicity: a refused call changes nothing, so each is checked in a
  // separate transaction from the one it ran in (security review, finding 8).
  const savedCount = (ids: string[]) => asServiceRole(async (q) =>
    (await q(`SELECT count(*)::int AS n FROM kb_entries WHERE id = ANY($1) AND embedding IS NOT NULL`, [ids])).rows[0].n);

  it('3. a repeated entry, a wrong-length vector, or a missing vector or model refuses the batch', async () => {
    const ids = await entries(2);
    const v = (id: string, seed = 0) => ({ id, embedding: vector(seed), model: 'voyage-4' });
    const bad: unknown[][] = [
      [v(ids[0]), v(ids[0], 1)],
      [v(ids[0]), { id: ids[1], embedding: vector(1, 3), model: 'voyage-4' }],
      [v(ids[0]), { id: ids[1], model: 'voyage-4' }],
      [v(ids[0]), { id: ids[1], embedding: null, model: 'voyage-4' }],
      [v(ids[0]), { id: ids[1], embedding: vector(1) }],
      [v(ids[0]), { id: ids[1], embedding: vector(1), model: 5 }],
      [v(ids[0]), { id: ids[1], embedding: vector(1), model: ' ' }],
      [v(ids[0]), 'not an object'],
    ];
    for (const rows of bad) {
      // Run as the owner, outside a rolled-back transaction, so a call that wrongly succeeded would stay
      // saved and the count below would see it. The checks inside do not depend on who calls.
      await refused(asSuperuser(`SELECT public.save_entry_vectors($1::jsonb)`, [JSON.stringify(rows)]));
      expect(await savedCount(ids)).toBe(0);
    }
  });

  it('3. an entry deleted since it was read is skipped; the rest are saved', async () => {
    const ids = await entries(2);
    const rows = [{ id: ids[0], embedding: vector(0), model: 'voyage-4' }, { id: '00000000-0000-0000-0000-000000000000', embedding: vector(1), model: 'voyage-4' }];
    await asServiceRole(async (q) => {
      expect((await q(`SELECT public.save_entry_vectors($1::jsonb) AS n`, [JSON.stringify(rows)])).rows[0].n).toBe(1);
    });
  });

  it('refuses a body that is not an array, or more than 128', async () => {
    await refused(asServiceRole((q) => q(`SELECT public.save_entry_vectors('{}'::jsonb)`)));
    const many = Array.from({ length: 129 }, () => ({ id: '00000000-0000-0000-0000-000000000000', embedding: [0], model: 'm' }));
    await refused(asServiceRole((q) => q(`SELECT public.save_entry_vectors($1::jsonb)`, [JSON.stringify(many)])));
  });

  it('4. only the service role may call it', async () => {
    const [id] = await entries(1);
    const rows = JSON.stringify([{ id, embedding: vector(0), model: 'voyage-4' }]);
    for (const u of [null, member, admin]) {
      expect(await refused(as(u, (q) => q(`SELECT public.save_entry_vectors($1::jsonb)`, [rows])))).toMatch(/permission denied for function/);
    }
  });
});
