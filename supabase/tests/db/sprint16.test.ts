// Sprint 16. Test numbers refer to docs/refinement/sprint-16.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
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

  it('3. a missing entry, a repeated entry or a wrong-length vector saves nothing from the batch', async () => {
    const ids = await entries(2);
    const bad = [
      [{ id: ids[0], embedding: vector(0), model: 'voyage-4' }, { id: '00000000-0000-0000-0000-000000000000', embedding: vector(1), model: 'voyage-4' }],
      [{ id: ids[0], embedding: vector(0), model: 'voyage-4' }, { id: ids[0], embedding: vector(1), model: 'voyage-4' }],
      [{ id: ids[0], embedding: vector(0), model: 'voyage-4' }, { id: ids[1], embedding: vector(1, 3), model: 'voyage-4' }],
    ];
    for (const rows of bad) {
      await asServiceRole(async (q) => {
        await q('SAVEPOINT s');
        await refused(q(`SELECT public.save_entry_vectors($1::jsonb)`, [JSON.stringify(rows)]));
        await q('ROLLBACK TO SAVEPOINT s');
        const saved = await q(`SELECT count(*)::int AS n FROM kb_entries WHERE id = ANY($1) AND embedding IS NOT NULL`, [ids]);
        expect(saved.rows[0].n).toBe(0);
      });
    }
  });

  it('refuses a body that is not an array, or more than 128', async () => {
    await refused(asServiceRole((q) => q(`SELECT public.save_entry_vectors('{}'::jsonb)`)));
    const many = Array.from({ length: 129 }, () => ({ id: '00000000-0000-0000-0000-000000000000', embedding: [0], model: 'm' }));
    await refused(asServiceRole((q) => q(`SELECT public.save_entry_vectors($1::jsonb)`, [JSON.stringify(many)])));
  });

  it('4. only the service role may call it', async () => {
    const [id] = await entries(1);
    const rows = JSON.stringify([{ id, embedding: vector(0), model: 'voyage-4' }]);
    for (const u of [null, member, admin]) await refused(as(u, (q) => q(`SELECT public.save_entry_vectors($1::jsonb)`, [rows])));
  });
});
