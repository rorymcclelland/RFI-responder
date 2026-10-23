/**
 * Confidence as shown to reviewers (F-17). Calibration is fitted on a small synthetic set, so
 * its top bin can be all-correct; that is not certainty, and the screen never says "100%".
 */
export function formatConfidence(c: number | null): string | null {
  if (c === null) return null;
  if (c >= 0.99) return '99%+';
  return `${Math.min(98, Math.round(c * 100))}%`;
}

export type CheckerVerdict = 'yes' | 'partly' | 'no';

/**
 * The answerability checker as shown on the card (Sprint 6, S6-3). Null when no checker ran;
 * "Not available" when it ran and failed (never shown as a "no"). The detail is plain text and is
 * rendered by React, never as HTML.
 */
export function checkerSummary(
  checker: { verdict: CheckerVerdict | null; bestRef: string | null; reason: string | null },
  judgeModel: string | null,
  confidence: number | null,
): { label: string; detail: string | null } | null {
  if (!checker.verdict) {
    // A reranker scores without a verdict; only a check that left no confidence has failed.
    return judgeModel && confidence === null ? { label: 'Not available', detail: null } : null;
  }
  const label = { yes: 'Yes', partly: 'Partly', no: 'No' }[checker.verdict];
  if (checker.verdict === 'no' && !checker.reason) {
    // Before Sprint 6 a reply that could not be read was stored as "no", with no reason.
    return { label, detail: 'No reason recorded. Before 24 October 2026 a check that could not be read was recorded as No.' };
  }
  const detail = [checker.bestRef, checker.reason].filter(Boolean).join(': ') || null;
  return { label, detail };
}

/** How an approval was made, for the card (Sprint 6, F-30). "All eligible" bulk approval has threshold 0. */
export function approvalLabel(a: { kind: 'individual' | 'bulk'; threshold: number | null }): string {
  if (a.kind !== 'bulk') return '';
  if (a.threshold === null) return 'bulk';
  if (a.threshold <= 0) return 'bulk, all eligible';
  return `bulk at ${Math.round(a.threshold * 100)}%`;
}

type Named = { displayName: string } | null | undefined;

/** Who an assignment is from and to, depending on the list (Sprint 6, F-31). */
export function assignmentPeople(tab: 'mine' | 'sent' | 'all', a: { assignedByProfile?: Named; assignedToProfile?: Named }): string {
  const by = `by ${a.assignedByProfile?.displayName ?? 'a colleague'}`;
  const to = `to ${a.assignedToProfile?.displayName ?? 'a colleague'}`;
  return tab === 'mine' ? by : tab === 'sent' ? to : `${by}, ${to}`;
}

