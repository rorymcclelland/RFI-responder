// Sprint 1, story S1-3: vectors in the knowledge base.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';

let member: TestUser;
let entryId: string;
const vector = (hot: number) => `[${Array.from({ length: 1024 }, (_, i) => (i === hot ? 1 : 0)).join(',')}]`;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  const r = await asSuperuser<{ id: string }>(
    `INSERT INTO kb_entries (question, answer, origin, created_by) VALUES ('Do you use MFA?', 'Yes.', 'manual', $1) RETURNING id`,
    [member.id],
  );
  entryId = r.rows[0].id;
});
afterAll(closePool);

async function asServiceRole<T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rowCount: number | null }>) => Promise<T>) {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE service_role');
    return await fn((sql, p) => c.query(sql, p));
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

describe('kb_entries vectors (S1-3)', () => {
  it('1. a member cannot write a vector or its model name', async () => {
    await refused(as(member, (q) => q(`UPDATE kb_entries SET embedding = $2 WHERE id = $1`, [entryId, vector(0)])));
    await refused(as(member, (q) => q(`UPDATE kb_entries SET embedding_model = 'x' WHERE id = $1`, [entryId])));
    await refused(as(member, (q) =>
      q(`INSERT INTO kb_entries (question, answer, origin, embedding) VALUES ('Q?', 'A.', 'manual', $1)`, [vector(1)])));
  });

  it('1. the service role (Edge Functions) can', async () => {
    const r = await asServiceRole((q) =>
      q(`UPDATE kb_entries SET embedding = $2, embedding_model = 'voyage-4', embedded_at = now() WHERE id = $1`, [entryId, vector(0)]));
    expect(r.rowCount).toBe(1);
  });

  it('only 1,024-dimension vectors fit', async () => {
    await refused(asServiceRole((q) => q(`UPDATE kb_entries SET embedding = '[1,2,3]' WHERE id = $1`, [entryId])));
  });

  it('pending_embeddings lists current entries whose vector is missing or from another model', async () => {
    await asServiceRole(async (q) => {
      await q(`UPDATE kb_entries SET embedding = $2, embedding_model = 'voyage-4' WHERE id = $1`, [entryId, vector(0)]);
      const same = await q(`SELECT * FROM pending_embeddings('voyage-4', 10)`);
      const other = await q(`SELECT * FROM pending_embeddings('bge-m3', 10)`);
      expect(same.rowCount).toBe(0);
      expect(other.rowCount).toBe(1);
    });
  });

  it('5. members and anonymous visitors cannot call pending_embeddings', async () => {
    await refused(as(member, (q) => q(`SELECT * FROM pending_embeddings('voyage-4', 10)`)));
    await refused(as(null, (q) => q(`SELECT * FROM pending_embeddings('voyage-4', 10)`)));
  });

  it('signed-in members can use vector functions; anonymous visitors cannot', async () => {
    const m = await as(member, (q) => q(`SELECT '[1,0]'::extensions.vector <=> '[0,1]'::extensions.vector AS d`));
    expect(m.rowCount).toBe(1);
    await refused(as(null, (q) => q(`SELECT '[1,0]'::extensions.vector <=> '[0,1]'::extensions.vector`)));
  });

  it('a vector index exists for cosine distance', async () => {
    const r = await asSuperuser<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename = 'kb_entries' AND indexdef ILIKE '%hnsw%'`);
    expect(r.rows[0]?.indexdef).toMatch(/vector_cosine_ops/);
  });
});
