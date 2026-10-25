import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_GROUPS, describeAudit, loadAuditLog } from './auditLog';

const MIGRATIONS = join(__dirname, '../../supabase/migrations');
/** Every action a migration writes to the audit log. */
function actionsWritten(): Set<string> {
  const sql = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
  const found = new Set<string>();
  // The text after each insert into the log, up to where its values end; settings like 'app.*' are not actions.
  for (const m of sql.matchAll(/INSERT INTO public\.audit_log/g)) {
    const after = sql.slice(m.index!, m.index! + 400);
    for (const lit of after.matchAll(/'([a-z]+\.[a-z_]+)'/g)) if (!lit[1].startsWith('app.')) found.add(lit[1]);
  }
  return found;
}

describe('the audit-log screen (Sprint 11, S11-9)', () => {
  it('2. has plain words, and a filter group, for every kind of event the database writes', () => {
    const written = actionsWritten();
    expect(written.size).toBeGreaterThanOrEqual(12);
    const grouped = new Set(Object.values(AUDIT_GROUPS).flatMap((g) => g.actions));
    for (const a of written) {
      expect(describeAudit({ action: a, details: {} }), a).not.toBe(`${a}.`);
      expect(grouped, a).toContain(a);
    }
  });

  it('describes the details', () => {
    expect(describeAudit({ action: 'response.exported', details: { accepted: 5, skipped: 1, added: 2, re_export: true } }))
      .toBe('Recorded the export again after changes: 5 accepted, 1 skipped; learned 2 added.');
    expect(describeAudit({ action: 'settings.changed', details: { before: { monthly_budget_gbp: 10, alert_share: 0.8 }, after: { monthly_budget_gbp: 25, alert_share: 0.8 } } }))
      .toBe('Changed the limits: monthly budget gbp: 10 to 25.');
    expect(describeAudit({ action: 'user.admin_granted', details: {}, targetId: 'u1' }, new Map([['u1', 'Tom Richardson']])))
      .toBe('Gave Tom Richardson admin rights.');
    expect(describeAudit({ action: 'something.new', details: {} })).toBe('something.new.');
  });

  it('3. keeps text as text: markup in the details is returned as characters, for React to escape', () => {
    expect(describeAudit({ action: 'response.deleted', details: { name: '<img src=x onerror=alert(1)>', questions: 3, reason: '<script>' } }))
      .toContain('<img src=x onerror=alert(1)>');
  });

  it('1. reads the newest entries, filtered by group, and reports a refusal', async () => {
    const calls: unknown[][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['select', 'order', 'limit', 'in']) chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
    (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: [{ id: 1, at: '2026-10-25T10:00:00Z', action: 'response.archived', target_id: 'o1', details: { outcome: 'won' }, actor_profile: { display_name: 'Sarah Chen' } }], error: null });
    const rows = await loadAuditLog({ from: vi.fn(() => chain) } as never, 'responses');
    expect(rows[0]).toMatchObject({ actorName: 'Sarah Chen', action: 'response.archived' });
    expect(calls).toContainEqual(['in', 'action', ['response.archived', 'response.deleted']]);
    expect(calls).toContainEqual(['order', 'at', { ascending: false }]);

    const refusing: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'in']) refusing[m] = () => refusing;
    refusing.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'permission denied' } });
    await expect(loadAuditLog({ from: () => refusing } as never, null)).rejects.toThrow(/could not be read/);
  });
});
