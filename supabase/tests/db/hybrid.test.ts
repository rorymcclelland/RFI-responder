// Sprint 1, story S1-5: hybrid retrieval in the database (test numbers from docs/refinement/sprint-1.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

let member: TestUser;
/** A unit vector pointing mostly along `hot`, with a little of `also` mixed in. */
const vec = (hot: number, also = -1, mix = 0) =>
  `[${Array.from({ length: 1024 }, (_, i) => (i === hot ? 1 : i === also ? mix : 0)).join(',')}]`;

async function addEntry(question: string, answer: string, v: string | null, model = 'test-model') {
  await asSuperuser(
    `INSERT INTO kb_entries (question, answer, origin, embedding, embedding_model) VALUES ($1, $2, 'manual', $3, $4)`,
    [question, answer, v, v ? model : null],
  );
}

type Row = { question: string; similarity: number | null; keyword_rank: number | null; fused_score: number; embedding_model: string | null };
const match = (user: TestUser | null, v: string | null, text: string, model: string | null = 'test-model', n = 5) =>
  as(user, (q) => q<Row>(`SELECT * FROM match_kb_entries($1, $2, $3, $4)`, [v, text, n, model]));

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  await addEntry('How do you encrypt data at rest?', 'All stored data uses AES-256 encryption.', vec(0));
  await addEntry('What is your incident response process?', 'Incidents are triaged within one hour.', vec(1));
  await addEntry('How often do you run penetration tests?', 'Annual external penetration tests.', vec(2));
  await addEntry('Describe your backup strategy.', 'Daily encrypted backups kept for 30 days.', vec(3, 0, 0.3));
  await addEntry('An entry from another model', 'Vectors from bge-m3.', vec(0), 'other-model');
});
afterAll(closePool);

describe('match_kb_entries (S1-5)', () => {
  it('1. an exact question ranks its own entry first', async () => {
    const r = await match(member, vec(1), 'What is your incident response process?');
    expect(r.rows[0].question).toBe('What is your incident response process?');
  });

  it('1. a reworded question with no shared keywords still finds its entry through the vector', async () => {
    const r = await match(member, vec(0), 'Is information protected when sitting on disks?');
    expect(r.rows[0].question).toBe('How do you encrypt data at rest?');
    expect(r.rows[0].keyword_rank).toBeNull();
    expect(r.rows[0].similarity).toBeCloseTo(1, 5);
  });

  it('2. an entry ranked high by both methods beats one ranked high by only one', async () => {
    // By meaning: "encrypt at rest" first, "backup strategy" second.
    // By keywords: only "backup strategy" mentions daily backups.
    // Fused: backup = 1/62 + 1/61 beats encrypt = 1/61 alone.
    const r = await match(member, vec(0, 3, 0.2), 'daily backups');
    const order = r.rows.map((x) => x.question);
    expect(order[0]).toBe('Describe your backup strategy.');
  });

  it('never compares vectors from a different model', async () => {
    const r = await match(member, vec(0), 'zzz', 'test-model', 10);
    expect(r.rows.map((x) => x.question)).not.toContain('An entry from another model');
    expect(r.rows.every((x) => x.embedding_model === 'test-model')).toBe(true);
  });

  it('4. with no query vector it falls back to keywords only', async () => {
    const r = await match(member, null, 'penetration tests', null);
    expect(r.rows[0].question).toBe('How often do you run penetration tests?');
    expect(r.rows.every((x) => x.similarity === null)).toBe(true);
  });

  it('returns at most 20 rows whatever is asked for', async () => {
    const r = await match(member, vec(0), 'data', 'test-model', 500);
    expect(r.rowCount).toBeLessThanOrEqual(20);
  });

  it('3. anonymous visitors are refused', async () => {
    await refused(match(null, vec(0), 'encrypt'));
  });
});
