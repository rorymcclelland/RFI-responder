/**
 * A response's stage, outcome and due date in the words people see (Sprint 17 glossary; Sprint 21
 * Sent and Changed since sent). Shared by the Responses page's cards and, since Sprint 22 (S22-1),
 * the response's own header.
 */
import type { ResponseOutcome, ResponseStage } from '../types';

export const STAGE: Record<ResponseStage, { label: string; pill: string; accent: string }> = {
  new:       { label: 'No questions yet',       pill: 'bg-sky-50 text-sky-700 border-sky-200',             accent: 'border-l-sky-300' },
  in_review: { label: 'In progress', pill: 'bg-amber-50 text-amber-700 border-amber-200',       accent: 'border-l-amber-300' },
  ready:     { label: 'Ready to send',     pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', accent: 'border-l-emerald-400' },
  exported:  { label: 'Sent',  pill: 'bg-ink-900 text-white border-ink-900',              accent: 'border-l-ink-700' },
  // Sprint 11 (S11-1): answers changed after the export was recorded; record it again.
  changed:   { label: 'Changed since sent', pill: 'bg-amber-50 text-amber-800 border-amber-300', accent: 'border-l-amber-400' },
  archived:  { label: 'Archived',  pill: 'bg-ink-50 text-ink-500 border-ink-200',             accent: 'border-l-ink-200' },
};
export const OUTCOME_LABEL: Record<ResponseOutcome, string> = { won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn' };

export const formatDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
