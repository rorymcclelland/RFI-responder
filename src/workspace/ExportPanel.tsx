/**
 * Sprint 21 (S21-1, U-6): sending a response. Once every question is decided the owner can download
 * the answers at any time; marking the response as sent is a separate step, which says beforehand what
 * it will do (record who and when, teach the knowledge base, close the assignments). Downloads hold
 * only decided answers, so every answer in a file has a named person's decision behind it (rule 4, Q1).
 */
import { useState } from 'react';
import { CheckCircle2, Download, FileDown, FileText, Send, Sheet, Upload } from 'lucide-react';
import { exportCSV, exportExcel, exportWord } from '../exportUtils';
import type { RFIQuestion } from '../types';

export default function ExportPanel({ questions, fileName, acceptedCount, skippedCount, learning, names, sentAt, changed, preview, saving = false, trial = false, onMarkSent, onStartNew }: {
  questions: RFIQuestion[];
  /** Approvers' names for the provenance record (Sprint 7, F-27). */
  names: Map<string, string>;
  fileName: string;
  acceptedCount: number;
  skippedCount: number;
  /** Sprint 23 (S23-1): a visitor's try, from which nothing is ever learned. */
  trial?: boolean;
  /** What learning did when the response was last marked as sent (S3-4); empty otherwise. */
  learning: string;
  /** When the response was last marked as sent, or null. */
  sentAt: string | null;
  /** An answer or decision changed after it was marked as sent. */
  changed: boolean;
  /** What marking as sent will do, for the confirmation. */
  preview: { written: number; drafts: number; pricing: number; openAssignments: number };
  /** A decision is still being saved: downloads wait, so a file holds only what the database has (rule 4). */
  saving?: boolean;
  /** Absent when the person cannot mark it as sent (not the owner or an admin, or archived). */
  onMarkSent?: () => Promise<void>;
  /** Absent for an archived response, which takes no new uploads. */
  onStartNew?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsMarking = !sentAt || changed;
  const when = sentAt ? new Date(sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <section aria-label="Send the response" className="card overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-5 border-b border-ink-100 bg-ink-50">
        <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center">
          {sentAt && !changed ? <CheckCircle2 size={18} className="text-white" /> : <Download size={18} className="text-white" />}
        </div>
        <div>
          <h3 className="font-bold text-ink-900">{!sentAt ? 'Ready to send' : changed ? 'Changed since sent' : `Sent on ${when}`}</h3>
          <p className="text-xs text-ink-500 font-medium">
            {acceptedCount} answered{skippedCount ? `, ${skippedCount} marked "Not answered"` : ''}
          </p>
        </div>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <p className="section-label mb-1">Download</p>
          <p className="text-xs text-ink-500 mb-4">Downloading does not mark the response as sent. Each file records how every answer was produced (drafted by a model, edited or written by a person) and who approved it: on a Provenance sheet in Excel, at the end of the Word file, and in columns in CSV.</p>
          <div className="flex flex-wrap gap-3">
            <button disabled={saving} onClick={() => exportExcel(questions, fileName, names)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-emerald-300 text-emerald-700 rounded-2xl hover:bg-emerald-50 transition-colors shadow-card disabled:opacity-40">
              <Sheet size={18} /> Excel (.xlsx)
            </button>
            <button disabled={saving} onClick={() => exportCSV(questions, fileName, names)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-ink-200 text-ink-700 rounded-2xl hover:bg-ink-50 transition-colors shadow-card disabled:opacity-40">
              <FileText size={18} /> CSV (.csv)
            </button>
            <button disabled={saving} onClick={() => exportWord(questions, fileName, names)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-sky-300 text-sky-700 rounded-2xl hover:bg-sky-50 transition-colors shadow-card disabled:opacity-40">
              <FileDown size={18} /> Word (.doc)
            </button>
          </div>
          {saving && <p className="text-xs text-ink-500 mt-2" role="status">Saving a change; the downloads are ready again once it is saved.</p>}
        </div>

        {onMarkSent && needsMarking && (
          <div className="border-t border-ink-100 pt-5 space-y-3">
            <p className="section-label">Mark as sent</p>
            {!confirming ? (
              <>
                <p className="text-xs text-ink-500">When the answers have gone to the customer, mark the response as sent. You can download them again at any time.</p>
                <button disabled={saving} onClick={() => setConfirming(true)} className="btn-primary text-sm disabled:opacity-40"><Send size={15} /> Mark as sent</button>
              </>
            ) : (
              <div role="group" aria-label="Confirm marking as sent" className="rounded-2xl border border-ink-200 p-4 space-y-3">
                <p className="text-sm font-bold text-ink-800">Marking this response as sent will:</p>
                <ul className="text-sm text-ink-700 list-disc pl-5 space-y-1">
                  <li>record that it was sent, with your name and the time, in the audit log;</li>
                  {trial ? (
                    <li>teach the knowledge base nothing: this is a try, so its answers are never learned and the entries its drafts came from are not confirmed;</li>
                  ) : (
                  <li>
                    give the knowledge base the approved answers{sentAt ? ' changed since it was last marked as sent' : ''}: {plural(preview.written, 'answer', 'answers')} edited or written by a person, which can become new entries or proposed changes, and {plural(preview.drafts, 'draft', 'drafts')} approved as written, which can confirm the entries they came from{preview.pricing ? `; ${plural(preview.pricing, 'pricing answer', 'pricing answers')}, never learned` : ''}.
                    {' '}What each becomes is decided when you confirm, and shown here afterwards; anything learned from someone other than an admin waits for an admin&apos;s review;
                  </li>
                  )}
                  <li>{preview.openAssignments ? `close the ${plural(preview.openAssignments, 'open assignment', 'open assignments')} on it.` : 'close any assignment on it (none is open now).'}</li>
                </ul>
                <div className="flex gap-2">
                  <button disabled={busy} className="btn-primary text-sm disabled:opacity-40"
                    onClick={async () => { setBusy(true); try { await onMarkSent(); setConfirming(false); } finally { setBusy(false); } }}>
                    <Send size={15} /> {busy ? 'Marking as sent…' : 'Confirm: mark as sent'}
                  </button>
                  <button disabled={busy} onClick={() => setConfirming(false)} className="btn-ghost text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {sentAt && (
          <div className="border-t border-ink-100 pt-5">
            <p className="section-label mb-3">Knowledge base</p>
            <div className="flex items-start gap-2.5 text-sm text-ink-700 font-medium">
              <CheckCircle2 size={17} className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <span>{trial ? 'Nothing was learned: this is a try.' : learning || 'The knowledge base learned from this response when it was marked as sent.'}</span>
            </div>
            <p className="text-xs text-ink-400 mt-2 font-medium">
              {trial ? 'A try never teaches the knowledge base, so what you write here stays here.'
                : 'Edited and person-written answers become entries, with this response recorded as their source. Pricing answers are never learned.'}
            </p>
          </div>
        )}

        {onStartNew && (
          <div className="border-t border-ink-100 pt-4">
            <button onClick={onStartNew} className="btn-ghost text-sm">
              <Upload size={15} /> Add another file
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
