/**
 * Bulk approval (project rule 4, story S2-2a). The database decides what is approved: only the
 * response owner or an admin may approve in bulk, and pricing, legal, unchecked, translated and
 * uncalibrated questions are always held back for individual review.
 */
import { ArrowRight, Download } from 'lucide-react';

export default function BulkBar({ canApprove, eligible, held, showFinish, finishBlockedBy, onBulk, onFinish }: {
  canApprove: boolean;
  /** Pending questions bulk approval could include. */
  eligible: number;
  /** Pending questions it never will (gated or uncalibrated). */
  held: number;
  showFinish: boolean;
  /** Why the export cannot be recorded yet, or null when every question is decided (S3-2). */
  finishBlockedBy: string | null;
  onBulk: (threshold: number) => void;
  onFinish: () => void;
}) {
  const disabledWhy = !canApprove
    ? 'Only the response owner or an admin can approve questions in bulk'
    : eligible === 0
      ? 'No question is still to do'
      : null;
  const button = (threshold: number, label: string, cls: string) => (
    <button
      onClick={() => onBulk(threshold)}
      disabled={disabledWhy !== null}
      title={disabledWhy ?? `Approve the drafts still to do with calibrated confidence of ${Math.round(threshold * 100)}% or more`}
      className={`text-xs font-bold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >{label}</button>
  );
  return (
    <div className="p-4 bg-white rounded-2xl border border-ink-100 shadow-card space-y-2">
      {/* Sprint 17 (Rory's check): the buttons share one row, Record export at the right, and every
          reason is a line of text below them, so nothing wraps into the middle of the row. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="section-label mr-1">Approve in bulk:</span>
        {button(0.8, 'High ≥80%', 'bg-ink-900 text-white hover:bg-ink-700')}
        {button(0.6, 'Medium ≥60%', 'bg-ink-100 text-ink-700 hover:bg-ink-200')}
        {button(0, 'All eligible', 'border border-ink-200 text-ink-600 hover:bg-ink-50')}
        {showFinish && (
          <button onClick={onFinish} disabled={finishBlockedBy !== null} title={finishBlockedBy ?? 'Record the export: the knowledge base then learns from this response'}
            className="btn-primary text-xs py-2 ml-auto disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} /> Record export <ArrowRight size={13} />
          </button>
        )}
      </div>
      {disabledWhy && held === 0 && <p className="text-xs text-ink-500 font-medium">{disabledWhy}.</p>}
      {showFinish && finishBlockedBy && <p className="text-xs text-ink-500 font-medium">{finishBlockedBy}</p>}
      {held > 0 && (
        <p className="text-xs text-ink-500 font-medium">
          {held} question{held !== 1 ? 's' : ''} to do {held !== 1 ? 'are' : 'is'} never included in bulk approval (pricing, legal, translated or Japanese, not fully checked, matched before every entry was indexed, citing an unreviewed, overdue or replaced entry, judged
          only partly answered or not answered by the checker, or not checked by one, without calibrated confidence, or with no draft) and must be approved one at a time.
        </p>
      )}
    </div>
  );
}
