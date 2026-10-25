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
  // The reason usually names the entry itself; then the entry is not repeated in front of it.
  const ref = checker.bestRef && !checker.reason?.startsWith(checker.bestRef) ? checker.bestRef : null;
  const detail = [ref, checker.reason].filter(Boolean).join(': ') || null;
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


/**
 * A question with no draft carries a placeholder where a draft would be ("Insufficient evidence: ...",
 * or the pricing note). It needs an answer written by a person before it can be accepted; the database
 * refuses it otherwise (security review, Sprint 7, finding 3).
 */
export function needsWrittenAnswer(q: { draftKind: string | null; generatedAnswer: string | null; finalAnswer: string | null }): boolean {
  if (q.draftKind !== 'insufficient_evidence' && q.draftKind !== 'person_required') return false;
  const written = (q.finalAnswer ?? '').trim();
  return written === '' || written === (q.generatedAnswer ?? '').trim();
}

/**
 * Why a pending, drafted, ungated question is left out of bulk approval because of its checker
 * verdict (Sprint 7, S7-1; shown on the card since the Sprint 7 security review). Null when the
 * verdict does not hold it; gates and missing confidence have their own labels on the card.
 */
export function bulkHoldReason(q: {
  status: string; gate: string | null; draftKind: string | null;
  checker: { verdict: string | null }; provenance: { judgeModel: string | null };
}): string | null {
  if (q.status !== 'pending' || q.gate !== null || (q.draftKind !== 'generated' && q.draftKind !== 'assembled')) return null;
  const why = q.checker.verdict === 'partly' ? 'the checker said the entries answer it only in part'
    : q.checker.verdict === 'no' ? 'the checker said the entries do not answer it'
    : q.checker.verdict === null && q.provenance.judgeModel !== null ? 'the checker gave a score but no verdict'
    : null;
  return why && `Not included in bulk approval: ${why}. Accept it on its own if the draft is right.`;
}
