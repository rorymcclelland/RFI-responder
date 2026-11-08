// Sprint 26 (S26-1, F-73): sending a large response within the hosted time limit. Test numbers refer
// to docs/refinement/sprint-26.md. The Sprint 25 spike (docs/spikes/f73-sending-large-responses.md)
// found two costs that grow faster than the number of questions: the approved count recounted after
// every update of a question, whatever changed, and the cited entries' tags found by scanning the
// knowledge base. These tests pin what both do, so the faster versions change only how long they take.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let owner: TestUser;

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Owner (S26)' });
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
