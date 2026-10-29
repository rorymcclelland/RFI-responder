// Sprint 0, story S0-4: the import summary the user sees (tests 1, 3 and 4).
import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }));
const { describeImport } = await import('./knowledgeBase');

describe('describeImport', () => {
  it('reports a clean import', () => {
    expect(describeImport({ inserted: 100, duplicates: 0, invalid: 0 })).toBe('100 entries added to the knowledge base.');
  });

  it('reports duplicates on a repeated import', () => {
    expect(describeImport({ inserted: 0, duplicates: 100, invalid: 0 })).toBe(
      '0 entries added to the knowledge base; 100 duplicates left out.',
    );
  });

  it('reports skipped invalid rows, with singulars', () => {
    expect(describeImport({ inserted: 1, duplicates: 1, invalid: 1 })).toBe(
      '1 entry added to the knowledge base; 1 duplicate left out; 1 row without a question or answer left out.',
    );
  });
});

// Sprint 15, story S15-1 (BUG-36): searching by entry number.
describe('entryMatches', async () => {
  const { entryMatches } = await import('./knowledgeBase');
  const e = (id: string, question = 'Do you encrypt data?', answer = 'Yes.', tags: string[] = []) => ({ id, question, answer, tags });
  const kb0101 = e('KB-0101');
  const kb0010 = e('KB-0010');
  const kb1010 = e('KB-1010');
  const text101 = e('KB-0002', 'Is room 101 locked?', 'Always.', ['physical']);

  it('finds an entry by its number, with or without the prefix and leading zeros (test 1)', () => {
    for (const q of ['KB-0101', 'kb-0101', 'KB0101', 'kb 101', '0101', ' 101 ']) {
      expect(entryMatches(kb0101, q), q).toBe(true);
      expect(entryMatches(kb0010, q), q).toBe(false);
      expect(entryMatches(kb1010, q), q).toBe(false);
    }
  });

  // Sprint 18 (S18-1, BUG-42, test 3): numbers past KB-9999.
  it('finds KB-10000 by its number, and 1000 does not find it', () => {
    const kb10000 = e('KB-10000');
    const kb1000 = e('KB-1000');
    for (const q of ['KB-10000', '10000', 'kb10000']) expect(entryMatches(kb10000, q), q).toBe(true);
    expect(entryMatches(kb10000, '1000')).toBe(false);
    expect(entryMatches(kb1000, '1000')).toBe(true);
    expect(entryMatches(kb1000, '10000')).toBe(false);
  });

  it('a bare number also finds text containing it (test 2)', () => {
    expect(entryMatches(text101, '101')).toBe(true);
    expect(entryMatches(text101, 'KB-0101')).toBe(false);
  });

  it('searches question, answer and tags as before, ignoring case (test 3)', () => {
    expect(entryMatches(text101, 'ROOM')).toBe(true);
    expect(entryMatches(text101, 'always')).toBe(true);
    expect(entryMatches(text101, 'Physical')).toBe(true);
    expect(entryMatches(text101, 'firewall')).toBe(false);
  });

  it('an empty query matches everything; "KB-" alone matches no number (test 4)', () => {
    expect(entryMatches(kb0101, '')).toBe(true);
    expect(entryMatches(kb0101, '   ')).toBe(true);
    expect(entryMatches(kb0101, 'KB-')).toBe(false);
    expect(entryMatches(e('KB-0003', 'What is KB-style search?'), 'kb-')).toBe(true);
  });

  it('treats pattern characters as text and survives a long query (test 5)', () => {
    expect(entryMatches(kb0101, '.*')).toBe(false);
    expect(entryMatches(e('KB-0004', 'Costs (in GBP) [approx]'), '(in GBP) [')).toBe(true);
    expect(entryMatches(kb0101, '9'.repeat(10_000))).toBe(false);
    expect(entryMatches(kb0101, 'x'.repeat(100_000))).toBe(false);
  });
});

// Sprint 16, S16-2 (BUG-40): adding an entry is confirmed at once; indexing runs afterwards.
describe('confirmThenIndex', async () => {
  const { confirmThenIndex } = await import('./knowledgeBase');

  it('1. confirms before indexing finishes', async () => {
    let finish: (v: { ok: true; embedded: number }) => void = () => undefined;
    const index = vi.fn(() => new Promise<{ ok: true; embedded: number }>((r) => { finish = r; }));
    const later = vi.fn();
    const message = confirmThenIndex({ ref: 'KB-0133', reviewed: true }, index, later);
    expect(message).toBe('KB-0133 added.');
    expect(index).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    finish({ ok: true, embedded: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(later).not.toHaveBeenCalled();
  });

  it('says when a member\'s entry waits for review', () => {
    expect(confirmThenIndex({ ref: 'KB-0134', reviewed: false }, async () => ({ ok: true, embedded: 1 }), () => undefined))
      .toBe('KB-0134 added. An admin will review it; until then, drafts that cite it are not bulk-approved.');
  });

  it('2. an indexing failure afterwards is reported separately; the entry stays saved', async () => {
    const later = vi.fn();
    confirmThenIndex({ ref: 'KB-0135', reviewed: true }, async () => ({ ok: false, reason: 'Daily limit reached' }), later);
    await new Promise((r) => setTimeout(r, 0));
    expect(later).toHaveBeenCalledWith('KB-0135 is saved but could not be indexed yet (Daily limit reached), so it is indexed before the next questions are matched, if your daily limit allows.');
    const thrown = vi.fn();
    confirmThenIndex({ ref: 'KB-0136', reviewed: true }, async () => { throw new Error('offline'); }, thrown);
    await new Promise((r) => setTimeout(r, 0));
    expect(thrown).toHaveBeenCalledWith(expect.stringMatching(/KB-0136 is saved but could not be indexed yet \(offline\)/));
  });
});

// Sprint 16 security review (M2): overlapping calls share one run, so entries are not indexed (and paid for) twice.
describe('indexNewEntries', async () => {
  const { indexNewEntries } = await import('./knowledgeBase');
  it('joins a run in progress, and starts a new one after it finishes', async () => {
    let finish: (v: unknown) => void = () => undefined;
    invoke.mockReset();
    invoke.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const a = indexNewEntries();
    const b = indexNewEntries();
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ data: { embedded: 3 }, error: null });
    expect(await a).toEqual({ ok: true, embedded: 3 });
    expect(await b).toEqual({ ok: true, embedded: 3 });
    invoke.mockResolvedValueOnce({ data: { embedded: 0 }, error: null });
    expect(await indexNewEntries()).toEqual({ ok: true, embedded: 0 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

