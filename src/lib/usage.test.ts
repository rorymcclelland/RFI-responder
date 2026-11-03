// Sprint 4, S4-1: the admin's view of usage and caps.
import { describe, expect, it, vi } from 'vitest';
import { formatGbp, loadUsageAdmin, loadUsageStatus, saveSettings, spendByUse, validateSettings } from './usage';

describe('loadUsageStatus', () => {
  it('reads the caller\'s position; members get no spend figure', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { questionsToday: 12, questionCap: 300, embedToday: 0, embedCap: 5000, budgetGbp: 10, spentGbp: null, alert: false, exhausted: false },
      error: null,
    });
    const s = await loadUsageStatus({ rpc } as never);
    expect(s).toMatchObject({ questionsToday: 12, questionCap: 300, spentGbp: null, alert: false });
  });
  it('says so when it cannot read usage', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Sign in first' } });
    await expect(loadUsageStatus({ rpc } as never)).rejects.toThrow(/Usage could not be read: Sign in first/);
  });
});

describe('validateSettings', () => {
  it('checks the reserve per knowledge-base text (Sprint 11, F-54)', () => {
    expect(validateSettings({ est_usd_per_embed_text: 0.0001 })).toBeNull();
    expect(validateSettings({ est_usd_per_embed_text: 0 })).toMatch(/knowledge-base text/);
  });

  it('accepts sensible values', () => {
    expect(validateSettings({ daily_question_cap: 400, monthly_budget_gbp: 25, alert_share: 0.8, gbp_per_usd: 0.79, review_interval_months: 12, daily_extract_cap: 20, est_usd_per_extract_kchar: 0.0005 })).toBeNull();
  });
  it.each([
    [{ daily_question_cap: -1 }, /whole number/],
    [{ daily_question_cap: 1.5 }, /whole number/],
    [{ monthly_budget_gbp: Number.NaN }, /budget/],
    [{ alert_share: 0 }, /warning point/],
    [{ alert_share: 1.2 }, /warning point/],
    [{ gbp_per_usd: 0 }, /exchange rate/],
    [{ review_interval_months: 0 }, /review interval/],
    [{ est_usd_per_question: 0 }, /reserve per question/],
    [{ daily_extract_cap: -1 }, /daily document limit/],
    [{ daily_extract_cap: 2.5 }, /daily document limit/],
    [{ est_usd_per_extract_kchar: 0 }, /reserve per 1,000 characters/],
  ])('refuses %o', (change, message) => {
    expect(validateSettings(change)).toMatch(message);
  });
});

describe('saveSettings', () => {
  const client = (rows: unknown[], error: unknown = null) => ({
    from: () => ({ update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: rows, error }) }) }) }),
  });
  it('saves', async () => {
    await expect(saveSettings(client([{ id: true }]) as never, { daily_question_cap: 400 })).resolves.toBeUndefined();
  });
  it('says when nothing changed because the user is not an admin (row-level security returns no rows)', async () => {
    await expect(saveSettings(client([]) as never, { daily_question_cap: 400 })).rejects.toThrow(/only an admin/);
  });
  it('does not send invalid values', async () => {
    await expect(saveSettings(client([{ id: true }]) as never, { alert_share: 2 })).rejects.toThrow(/warning point/);
  });
});

describe('formatGbp', () => {
  it('shows small sums to four places and larger ones to two', () => {
    expect(formatGbp(0.0123)).toBe('£0.0123');
    expect(formatGbp(8.5)).toBe('£8.50');
  });
});

describe('S22-2 spend by use', () => {
  it('2. gives each function its plain name, an unknown one its own, the most spent first', () => {
    const uses = spendByUse([
      { function: 'process-questions', calls: 4, spentGbp: 0.03 },
      { function: 'ask-knowledge', calls: 3, spentGbp: 0.01 },
      { function: 'embed', calls: 2, spentGbp: 0.001 },
      { function: 'embed-entries', calls: 1, spentGbp: 0.002 },
      { function: 'extract-questions', calls: 1, spentGbp: 0.004 },
      { function: 'a-new-function', calls: 1, spentGbp: 0 },
    ]);
    expect(uses.map((u) => u.label)).toEqual([
      'Processing responses', 'Asking the knowledge base', 'Reading Word documents', 'Indexing knowledge-base entries', 'a-new-function']);
    // Both indexing functions are one use, added together.
    expect(uses.find((u) => u.label === 'Indexing knowledge-base entries')).toMatchObject({ calls: 3 });
    expect(uses.find((u) => u.label === 'Indexing knowledge-base entries')!.spentGbp).toBeCloseTo(0.003, 6);
    expect(uses.reduce((t, u) => t + u.spentGbp, 0)).toBeCloseTo(0.047, 6);
  });

  it('2. markup in an unknown function name stays text', () => {
    expect(spendByUse([{ function: '<b>x</b>', calls: 1, spentGbp: 0 }])[0].label).toBe('<b>x</b>');
  });

  it('reads byFunction from the report, and an older report without it as none', async () => {
    const report = (extra: object) => ({ byUser: [], byModel: [], unpricedCalls: 0, unpricedModels: [], ...extra });
    const client = (r: object) => ({
      rpc: async () => ({ data: r, error: null }),
      from: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }), order: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    });
    const a = await loadUsageAdmin(client(report({ byFunction: [{ function: 'ask-knowledge', calls: '2', spentGbp: '0.0100' }] })) as never);
    expect(a.report.byFunction).toEqual([{ function: 'ask-knowledge', calls: 2, spentGbp: 0.01 }]);
    const b = await loadUsageAdmin(client(report({})) as never);
    expect(b.report.byFunction).toEqual([]);
  });
});
