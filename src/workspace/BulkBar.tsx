/**
 * Bulk approval (project rule 4, story S2-2a). The database decides what is approved: only the
 * response owner or an admin may approve in bulk, and pricing, legal, unchecked, translated and
 * uncalibrated questions are always held back for individual review.
 */
import { ArrowRight, Download } from 'lucide-react';

export default function BulkBar({ canApprove, eligible, held, showFinish, onBulk, onFinish }: {
  canApprove: boolean;
  /** Pending questions bulk approval could include. */
  eligible: number;
  /** Pending questions it never will (gated or uncalibrated). */
  held: number;
  showFinish: boolean;
  onBulk: (threshold: number) => void;
  onFinish: () => void;
}) {
  const disabledWhy = !canApprove
    ? 'Only the response owner or an admin can approve questions in bulk'
    : eligible === 0
      ? 'No pending question has calibrated confidence and no gate'
      : null;
  const button = (threshold: number, label: string, cls: string) => (
    <button
      onClick={() => onBulk(threshold)}
      disabled={disabledWhy !== null}
      title={disabledWhy ?? `Accept pending drafts with calibrated confidence of ${Math.round(threshold * 100)}% or more`}
      className={`text-xs font-bold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >{label}</button>
  );
  return (
    <div className="p-4 bg-white rounded-2xl border border-ink-100 shadow-card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="section-label mr-1">Bulk accept:</span>
        {button(0.8, 'High ≥80%', 'bg-ink-900 text-white hover:bg-ink-700')}
        {button(0.6, 'Medium ≥60%', 'bg-ink-100 text-ink-700 hover:bg-ink-200')}
        {button(0, 'All eligible', 'border border-ink-200 text-ink-600 hover:bg-ink-50')}
        <div className="ml-auto">
          {showFinish && (
            <button onClick={onFinish} className="btn-primary text-xs py-2">
              <Download size={14} /> Review Complete <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
      {held > 0 && (
        <p className="text-xs text-ink-500 font-medium">
          {held} pending question{held !== 1 ? 's are' : ' is'} never included in bulk approval (pricing, legal, translated, not fully checked, or without
          calibrated confidence) and must be accepted individually.
        </p>
      )}
    </div>
  );
}
