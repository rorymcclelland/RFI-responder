// Sprint 4, S4-3: adding entries by hand and the admin review queue.
import { describe, expect, it, vi } from 'vitest';
import { addEntry, describeOrigin, loadEntriesToReview, loadOverdueEntries, parseTags, reviewEntry, validateEntry } from './entryReview';

const entry = { question: 'Do you use MFA?', answer: 'Yes, for all staff.', tags: ['MFA'], source: 'Policy v2' };

describe('validateEntry', () => {
  it('accepts a normal entry', () => expect(validateEntry(entry)).toBeNull());
  it.each([
    [{ ...entry, question: '  ' }, /question/],
    [{ ...entry, answer: '' }, /answer/],
    [{ ...entry, answer: 'x'.repeat(20001) }, /too long/],
    [{ ...entry, source: 'x'.repeat(501) }, /source/],
  ])('refuses %#', (e, message) => expect(validateEntry(e)).toMatch(message));
});

describe('parseTags', () => {
  it('splits on commas, trims and drops blanks and repeats', () => {
    expect(parseTags(' MFA, identity,,MFA ')).toEqual(['MFA', 'identity']);
  });
});

describe('addEntry', () => {
  const client = (result: unknown) => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(result) }) }));
    return { c: { from: () => ({ insert }) } as never, insert };
  };
  it('inserts as manual, trimmed, and reports whether it starts reviewed', async () => {
    const { c, insert } = client({ data: { ref: 'KB-0200', reviewed_at: null }, error: null });
    expect(await addEntry(c, { ...entry, question: ' Do you use MFA? ' })).toEqual({ ref: 'KB-0200', reviewed: false });
    expect(insert).toHaveBeenCalledWith({ question: 'Do you use MFA?', answer: 'Yes, for all staff.', tags: ['MFA'], source: 'Policy v2', origin: 'manual' });
  });
  it('explains a duplicate question', async () => {
    const { c } = client({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(addEntry(c, entry)).rejects.toThrow(/already exists/);
  });
  it('does not send an invalid entry', async () => {
    const { c, insert } = client({ data: null, error: null });
    await expect(addEntry(c, { ...entry, answer: '' })).rejects.toThrow(/answer/);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('the review queue', () => {
  it('loads unreviewed current entries with who added them', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'e1', ref: 'KB-0201', question: 'Q', answer: 'A', tags: null, source: '', origin: 'import', origin_ref: 'answers.csv',
        created_at: '2026-10-24T09:00:00Z', added_by: { display_name: 'Tom Richardson' } }],
      error: null,
    });
    const is2 = vi.fn(() => ({ order }));
    const is1 = vi.fn(() => ({ is: is2 }));
    const select = vi.fn(() => ({ is: is1 }));
    const c = { from: () => ({ select }) } as never;
    const [e] = await loadEntriesToReview(c);
    // The entry a proposal would replace is embedded by column name (a self-reference).
    expect(select.mock.calls[0]).toEqual([expect.stringContaining('replaces:proposed_replacement_of(ref, answer)')]);
    expect(is1).toHaveBeenCalledWith('reviewed_at', null);
    expect(is2).toHaveBeenCalledWith('superseded_by', null);
    expect(e).toMatchObject({ ref: 'KB-0201', addedBy: 'Tom Richardson', tags: [] });
    expect(describeOrigin(e)).toBe('Imported by Tom Richardson from answers.csv');
  });

  it('reviews through review_entry, with or without edits, and reports a refusal', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await reviewEntry({ rpc } as never, 'e1');
    expect(rpc).toHaveBeenCalledWith('review_entry', { p_entry: 'e1', p_question: null, p_answer: null });
    await reviewEntry({ rpc } as never, 'e1', { answer: 'Corrected.' });
    expect(rpc).toHaveBeenLastCalledWith('review_entry', { p_entry: 'e1', p_question: null, p_answer: 'Corrected.' });
    const refusing = vi.fn().mockResolvedValue({ error: { message: 'Only an admin can review knowledge-base entries' } });
    await expect(reviewEntry({ rpc: refusing } as never, 'e1')).rejects.toThrow(/not saved: Only an admin/);
  });

  it('says plainly where a learned entry came from', () => {
    expect(describeOrigin({ origin: 'response', originRef: 'response:x', addedBy: 'Maya Patel' }))
      .toMatch(/approved by Maya Patel, who is not an admin/);
  });
});

describe('the overdue report (S4-4)', () => {
  it('reads overdue_entries with the due date and recent citations', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'e9', ref: 'KB-0009', question: 'Q', answer: 'A', tags: ['x'], source: 'Policy', origin: 'seed', origin_ref: null,
        added_by: null, created_at: '2025-01-01T00:00:00Z', last_reviewed_at: null, review_due: '2026-01-01T00:00:00Z', recent_citations: '3' }],
      error: null,
    });
    const [e] = await loadOverdueEntries({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith('overdue_entries');
    expect(e).toMatchObject({ ref: 'KB-0009', dueSince: '2026-01-01T00:00:00Z', recentCitations: 3, addedBy: null });
    expect(describeOrigin(e)).toBe('Seed data');
  });
  it('reports a refusal', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Only an admin can see the overdue-entries report' } });
    await expect(loadOverdueEntries({ rpc } as never)).rejects.toThrow(/could not be read: Only an admin/);
  });
});

describe('describeOrigin for a translation (Sprint 12, S12-3 test 5)', () => {
  it('names what it was translated from and its language, whoever approved it', () => {
    expect(describeOrigin({ origin: 'response', originRef: null, addedBy: 'Sarah Chen', translatedFrom: ['KB-0001'], language: 'ja' }))
      .toBe('Translated from KB-0001 (English) in a response; answer approved by Sarah Chen. A translation is reviewed before it is trusted, whoever approved it');
    expect(describeOrigin({ origin: 'response', originRef: null, addedBy: 'Priya Sharma' })).toMatch(/who is not an admin/);
  });
});

