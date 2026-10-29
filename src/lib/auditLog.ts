/**
 * Sprint 11 (S11-9, F-53; Rory, Q5): the audit log for admins, in plain words. The database writes
 * it (only admins can read it); this reads the most recent entries and says what each one records.
 * Details are shown as text, never as HTML.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  actorName: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
}

/** The filter groups on the screen, and the actions in each. */
export const AUDIT_GROUPS: Record<string, { label: string; actions: string[] }> = {
  exports: { label: 'Exports and changes after export', actions: ['response.exported', 'question.changed_after_export'] },
  responses: { label: 'Archives and deletions', actions: ['response.archived', 'response.deleted'] },
  knowledge: { label: 'Knowledge-base reviews and changes', actions: ['kb.reviewed', 'kb.confirmed', 'kb.changed', 'kb.deleted', 'kb.retired', 'kb.restored'] },
  holds: { label: 'Questions held and released', actions: ['question.held', 'question.released'] },
  settings: { label: 'Settings and prices', actions: ['settings.changed', 'prices.changed'] },
  people: { label: 'Admin rights and invitations', actions: ['user.admin_granted', 'user.admin_removed', 'user.invited'] },
  demo: { label: 'Demo resets', actions: ['demo.reset'] },
};

export const AUDIT_LIMIT = 200;

export async function loadAuditLog(client: SupabaseClient, group: string | null): Promise<AuditRow[]> {
  let query = client.from('audit_log')
    .select('id, at, action, target_id, details, actor_profile:user_profiles(display_name)')
    .order('at', { ascending: false })
    .limit(AUDIT_LIMIT);
  if (group && AUDIT_GROUPS[group]) query = query.in('action', AUDIT_GROUPS[group].actions);
  const { data, error } = await query;
  if (error) {
    // Security review, Sprint 11 (low 5): the database's message stays in the console.
    console.error('audit_log read failed', error);
    throw new Error('The audit log could not be read. Try again, or check that you are still an admin.');
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const profile = r.actor_profile as { display_name?: string } | { display_name?: string }[] | null;
    const name = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name;
    return {
      id: Number(r.id), at: String(r.at), action: String(r.action),
      actorName: name ?? null, targetId: (r.target_id as string | null) ?? null,
      details: (r.details as Record<string, unknown>) ?? {},
    };
  });
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Which settings or price fields changed, as "field: before to after". */
function changes(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  return keys.length ? keys.map((k) => `${k.replace(/_/g, ' ')}: ${str(b[k]) || 'none'} to ${str(a[k]) || 'none'}`).join('; ') : 'no values changed';
}

/** What one entry records, in a sentence. Unknown actions are shown by name, never hidden. */
export function describeAudit(r: Pick<AuditRow, 'action' | 'details'> & { targetId?: string | null }, names: Map<string, string> = new Map()): string {
  const d = r.details;
  switch (r.action) {
    case 'response.exported': {
      const learned = ['added', 'superseded', 'proposed', 'translated', 'confirmed'].filter((k) => d[k]).map((k) => `${d[k]} ${k}`).join(', ');
      return `${d.re_export === true ? 'Recorded the export again after changes' : 'Recorded the export'}: ${str(d.accepted) || 0} approved, ${str(d.skipped) || 0} not answered${learned ? `; learned ${learned}` : ''}.`;
    }
    case 'question.changed_after_export':
      return `Changed a question after its export was recorded: ${d.answer_changed ? 'the answer' : 'the decision'}${d.status_from !== d.status_to ? ` (${str(d.status_from)} to ${str(d.status_to)})` : ''}.`;
    case 'demo.reset':
      return `Reset the demo: ${str(d.entries)} knowledge-base entries and ${str(d.responses)} responses loaded again; all other responses and entries removed.`;
    case 'user.invited':
      return `Invited ${names.get(str(r.targetId)) ?? 'someone not in the team list loaded at sign-in (new since then, or deleted)'} as a member.`;
    case 'response.archived':
      return `Archived a response as ${str(d.outcome)}.`;
    case 'response.deleted':
      return `Deleted the response "${str(d.name)}" (${str(d.questions)} questions). Reason: ${str(d.reason)}`;
    case 'kb.reviewed':
      return `Reviewed ${str(d.ref)}${d.edited ? ', with corrections' : ''}${d.replaced ? `, replacing ${str(d.replaced)}` : ''}.`;
    case 'kb.confirmed':
      return `Confirmed ${Array.isArray(d.refs) ? (d.refs as unknown[]).join(', ') : str(d.refs)} as still correct, by exporting an unedited draft that cited ${Array.isArray(d.refs) && d.refs.length === 1 ? 'it' : 'them'}.`;
    case 'kb.changed':
      return `Changed ${str(d.ref)} directly: ${changes(d.before, d.after)}.`;
    case 'kb.deleted':
      return `Deleted ${str(d.ref)} ("${str(d.question)}").`;
    // Sprint 18 (S18-3): retiring, and declining a proposed change, with the reason.
    case 'kb.retired':
      return d.declined
        ? `Declined ${str(d.ref)}, a proposed change to ${str(d.proposal_for)}. Reason: ${str(d.reason)}`
        : `Retired ${str(d.ref)}. Reason: ${str(d.reason)}`;
    case 'kb.restored':
      return `Restored ${str(d.ref)}, retired earlier (${str(d.reason)}).`;
    case 'question.held':
      return `Held a question from bulk approval (${str(d.to ?? d.gate)}).`;
    case 'question.released':
      return `Released a question held for ${str(d.from)}, after the entries it cites were reviewed.`;
    case 'settings.changed':
      return `Changed the limits: ${changes(d.before, d.after)}.`;
    case 'prices.changed': {
      const row = (d.after ?? d.before ?? {}) as Record<string, unknown>;
      const what = `${str(row.provider)} ${str(row.model)}`.trim();
      if (d.operation === 'insert') return `Added a price for ${what}.`;
      if (d.operation === 'delete') return `Removed the price for ${what}.`;
      return `Changed the price for ${what}: ${changes(d.before, d.after)}.`;
    }
    case 'user.admin_granted':
      return `Gave ${names.get(str(r.targetId)) ?? 'someone'} admin rights.`;
    case 'user.admin_removed':
      return `Removed admin rights from ${names.get(str(r.targetId)) ?? 'someone'}.`;
    default:
      return `${r.action}.`;
  }
}
