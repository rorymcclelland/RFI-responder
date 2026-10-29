// Sprint 18, S18-2 (K-2): an answer's page. Test numbers: docs/refinement/sprint-18.md.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { describeEvent, describeUse, normaliseRef, saveEntryEdits } = await import('./entryDetail');

const names = new Map([['u1', 'Sarah Chen']]);
const ev = (action: string, details: Record<string, unknown> | null = {}, actor: string | null = 'u1') => ({ at: '2026-10-29T10:00:00Z', action, actor, details });

describe('describeEvent (test 2)', () => {
  it('says what happened, and by whom', () => {
    expect(describeEvent(ev('kb.reviewed', { edited: true, previous: { answer: 'Old.' } }), names)).toBe('Corrected and reviewed by Sarah Chen');
    expect(describeEvent(ev('kb.reviewed', { edited: false }), names)).toBe('Reviewed by Sarah Chen: correct as it stands');
    expect(describeEvent(ev('kb.reviewed', { edited: false, replaced: 'KB-0015' }), names)).toBe('Reviewed by Sarah Chen, replacing KB-0015');
    expect(describeEvent(ev('kb.changed', { before: { tags: ['a'], source: 'P1' }, after: { tags: ['a', 'b'], source: 'P2' } }), names))
      .toBe('Sarah Chen changed the topics from a to a, b, and the source from P1 to P2');
    expect(describeEvent(ev('kb.confirmed', { response: 'Bluefin', question: 'Backups?' }), names)).toBe('Confirmed by use: approved unedited in Bluefin (“Backups?”)');
    expect(describeEvent(ev('kb.retired', { reason: 'The certificate lapsed.' }), names)).toBe('Retired by Sarah Chen: The certificate lapsed.');
    expect(describeEvent(ev('kb.restored'), names)).toBe('Restored by Sarah Chen');
    expect(describeEvent(ev('kb.reviewed', {}, 'gone'), names)).toBe('Reviewed by a former team member: correct as it stands');
  });

  it('7. copes with odd details, and never interprets them', () => {
    expect(describeEvent(ev('kb.changed', null), names)).toBe('Sarah Chen saved it without changes');
    expect(describeEvent(ev('kb.confirmed', { response: 42, question: ['<b>x</b>'] }), names)).toBe('Confirmed by use: approved unedited in a response');
    expect(describeEvent(ev('kb.retired', { reason: '<script>alert(1)</script>' }), names)).toBe('Retired by Sarah Chen: <script>alert(1)</script>');
    expect(describeEvent(ev('kb.something_new'), names)).toBe('Recorded by Sarah Chen (kb.something_new)');
  });
});

describe('describeUse', () => {
  const u = (o: Record<string, unknown>) => ({ status: 'accepted', edited: false, outcome: null, exportedAt: null, archivedAt: null, ...o }) as never;
  it('says how the answer was used, and how the response ended', () => {
    expect(describeUse(u({ outcome: 'won', exportedAt: 'x', archivedAt: 'x' }))).toBe('approved as drafted; the response is won');
    expect(describeUse(u({ edited: true }))).toBe('approved after editing; the response is in progress');
    expect(describeUse(u({ status: 'skipped', exportedAt: 'x' }))).toBe('not answered; the response is exported');
    expect(describeUse(u({ status: 'pending', archivedAt: 'x', outcome: 'withdrawn' }))).toBe('still to do; the response is withdrawn');
  });
});

describe('normaliseRef (test 6)', () => {
  it('turns any typed form into the stored number, and refuses anything else', () => {
    expect(normaliseRef('101')).toBe('KB-0101');
    expect(normaliseRef('kb-0101')).toBe('KB-0101');
    expect(normaliseRef('KB 10000')).toBe('KB-10000');
    for (const bad of ['', 'KB-', 'nonsense', '0', '-1', '1.5', "1'; DROP TABLE x; --", '9'.repeat(30)]) expect(normaliseRef(bad), bad).toBeNull();
  });
});

describe('saveEntryEdits', () => {
  const current = { id: 'e1', question: 'Q?', answer: 'A.', tags: ['a'], source: 'P1' };
  const client = () => {
    const calls: string[] = [];
    return {
      calls,
      from: () => ({ update: (v: unknown) => ({ eq: async () => { calls.push(`update ${JSON.stringify(v)}`); return { error: null }; } }) }),
      rpc: async (name: string, args: Record<string, unknown>) => { calls.push(`${name} ${args.p_answer}`); return { error: null }; },
    };
  };
  it('updates topics and source directly, and reviews a change of text', async () => {
    let c = client();
    expect(await saveEntryEdits(c as never, current, { question: 'Q?', answer: 'A.', tags: 'a, b', source: 'P1' })).toEqual({ reviewed: false, changed: true });
    expect(c.calls).toEqual(['update {"tags":["a","b"],"source":"P1"}']);
    c = client();
    expect(await saveEntryEdits(c as never, current, { question: 'Q?', answer: 'A, corrected.', tags: 'a', source: 'P1' })).toEqual({ reviewed: true, changed: false });
    expect(c.calls).toEqual(['review_entry A, corrected.']);
  });
  it('refuses an empty answer before calling anything', async () => {
    const c = client();
    await expect(saveEntryEdits(c as never, current, { question: 'Q?', answer: ' ', tags: '', source: '' })).rejects.toThrow();
    expect(c.calls).toEqual([]);
  });
});

describe('retiring (S18-3, test 7)', async () => {
  const { retireReasonProblem, retireEntry } = await import('./entryDetail');
  it('asks for a reason of 5 to 500 characters, as the database does', () => {
    for (const r of ['', '    ', 'no', 'abcd']) expect(retireReasonProblem(r), r).toMatch(/at least 5/);
    expect(retireReasonProblem('x'.repeat(501))).toMatch(/500/);
    expect(retireReasonProblem('  The office closed.  ')).toBeNull();
  });
  it('sends the trimmed reason, and refuses a short one without calling the database', async () => {
    const calls: unknown[] = [];
    const client = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { error: null }; } };
    await expect(retireEntry(client as never, 'e1', 'no')).rejects.toThrow();
    await retireEntry(client as never, 'e1', '  The office closed. ');
    expect(calls).toEqual([['retire_entry', { p_entry: 'e1', p_reason: 'The office closed.' }]]);
  });
});

describe('correctionBefore (security review, L6)', async () => {
  const { correctionBefore } = await import('./entryDetail');
  const d = (history: unknown[]) => ({ entry: { question: 'Q now?', answer: 'A now.' }, history }) as never;
  const rev = (previous: Record<string, string>) => ({ at: 'x', action: 'kb.reviewed', actor: null, details: { edited: true, previous } });
  it('shows only the part a correction changed', () => {
    expect(correctionBefore(d([rev({ question: 'Q now?', answer: 'A then.' })]), 0)).toEqual({ answer: 'A then.' });
    expect(correctionBefore(d([rev({ question: 'Q then?', answer: 'A now.' })]), 0)).toEqual({ question: 'Q then?' });
  });
  it('compares each correction with the next one, not with today', () => {
    const h = [rev({ question: 'Q now?', answer: 'A first.' }), rev({ question: 'Q now?', answer: 'A second.' })];
    expect(correctionBefore(d(h), 0)).toEqual({ answer: 'A first.' });
    expect(correctionBefore(d(h), 1)).toEqual({ answer: 'A second.' });
  });
  it('gives nothing for other events or an unchanged review', () => {
    expect(correctionBefore(d([{ at: 'x', action: 'kb.changed', actor: null, details: {} }]), 0)).toBeNull();
    expect(correctionBefore(d([{ at: 'x', action: 'kb.reviewed', actor: null, details: { edited: false, previous: null } }]), 0)).toBeNull();
  });
});
