import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_GROUPS, AUDIT_LIMIT, describeAudit, loadAuditLog, loadAuditPeople } from './auditLog';

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
      .toBe('Marked as sent again after changes: 5 approved, 1 not answered; learned 2 added.');
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
    const rpc = vi.fn(async () => ({ data: { rows: [{ id: 1, at: '2026-10-25T10:00:00Z', action: 'response.archived', actor: 'u1', actorName: 'Sarah Chen', targetId: 'o1', details: { outcome: 'won' } }], more: false }, error: null }));
    const found = await loadAuditLog({ rpc } as never, { group: 'responses' });
    expect(found.rows[0]).toMatchObject({ actorName: 'Sarah Chen', action: 'response.archived', actorId: 'u1', targetId: 'o1' });
    expect(found.more).toBe(false);
    expect(rpc).toHaveBeenCalledWith('audit_log_search', { p_actions: ['response.archived', 'response.deleted'], p_actor: null, p_response: null, p_limit: AUDIT_LIMIT });
    const refusing = { rpc: async () => ({ data: null, error: { message: 'permission denied' } }) };
    await expect(loadAuditLog(refusing as never, {})).rejects.toThrow(/could not be read/);
  });

  it('S22-2 3 to 5. filters by person and response together with the kind, and says when more match', async () => {
    const rpc = vi.fn(async () => ({ data: { rows: [], more: true }, error: null }));
    const found = await loadAuditLog({ rpc } as never, { group: 'holds', actor: 'u9', response: 'r9' });
    expect(rpc).toHaveBeenCalledWith('audit_log_search', { p_actions: ['question.held', 'question.released'], p_actor: 'u9', p_response: 'r9', p_limit: AUDIT_LIMIT });
    expect(found).toEqual({ rows: [], more: true });
    // An unknown group is no filter, never an empty list.
    await loadAuditLog({ rpc } as never, { group: 'nonsense' });
    expect(rpc).toHaveBeenLastCalledWith('audit_log_search', expect.objectContaining({ p_actions: null }));
  });

  it('S22-2 3. lists the people in the log, a deleted profile as Former user', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 'u1', name: 'Sarah Chen' }, { id: 'u2', name: null }], error: null }));
    expect(await loadAuditPeople({ rpc } as never)).toEqual([{ id: 'u1', name: 'Sarah Chen' }, { id: 'u2', name: 'Former user' }]);
    expect(rpc).toHaveBeenCalledWith('audit_log_people');
  });
});

describe('Sprint 15 audit entries', () => {
  it('describes a demo reset and an invitation (S15-4, S15-5)', () => {
    expect(describeAudit({ action: 'demo.reset', details: { entries: 132, responses: 4 } }))
      .toBe('Reset the demo: 132 knowledge-base entries and 4 responses loaded again; all other responses and entries removed.');
    expect(describeAudit({ action: 'user.invited', details: {}, targetId: 'u2' }, new Map([['u2', 'Ana Lima']]))).toBe('Invited Ana Lima as a member.');
    expect(describeAudit({ action: 'user.invited', details: {}, targetId: 'gone' })).toBe('Invited someone not in the team list loaded at sign-in (new since then, or deleted) as a member.');
    expect(AUDIT_GROUPS.people.actions).toContain('user.invited');
    expect(AUDIT_GROUPS.demo.actions).toEqual(['demo.reset']);
  });
});
