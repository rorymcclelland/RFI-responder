// Sprint 4, S4-1: the admin's view of usage and caps.
import { describe, expect, it, vi } from 'vitest';
import { formatGbp, loadUsageStatus, saveSettings, validateSettings } from './usage';

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
  it('accepts sensible values', () => {
    expect(validateSettings({ daily_question_cap: 400, monthly_budget_gbp: 25, alert_share: 0.8, gbp_per_usd: 0.79, review_interval_months: 12 })).toBeNull();
  });
  it.each([
    [{ daily_question_cap: -1 }, /whole number/],
    [{ daily_question_cap: 1.5 }, /whole number/],
    [{ monthly_budget_gbp: Number.NaN }, /budget/],
    [{ alert_share: 0 }, /warning point/],
    [{ alert_share: 1.2 }, /warning point/],
    [{ gbp_per_usd: 0 }, /exchange rate/],
    [{ review_interval_months: 0 }, /review interval/],
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
