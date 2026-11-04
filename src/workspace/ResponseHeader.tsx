/**
 * Sprint 22 (S22-1, U-5): the response's header. Where it stands, in the words of its card on
 * Responses (name, owner, due date, Overdue or At risk, progress and stage, all from the database's
 * overview of the whole response), its files with the open one marked, and the three stages, each
 * with what it holds, to jump to. Text shows as text, never as markup.
 */
import { AlertTriangle, CalendarClock, FileText, Upload, User } from 'lucide-react';
import type { Opportunity, RFISession } from '../types';
import { OUTCOME_LABEL, STAGE, formatDate } from '../lib/stage';

export interface StageSummary { questions: string; experts: string; send: string }

export default function ResponseHeader({ name, response, readFailed = false, ownerName, files, openFileId, openFileName, onOpenFile, onAddFile, stages }: {
  name: string;
  /** The overview's row for this response; null until it is read. */
  response: Opportunity | null;
  /** The overview could not be read: say so, rather than showing no owner or no due date (security review). */
  readFailed?: boolean;
  ownerName: string | null;
  files: RFISession[];
  openFileId: string | null;
  openFileName: string;
  onOpenFile: (file: RFISession) => void;
  /** Only for those who may add a file. */
  onAddFile?: () => void;
  stages: StageSummary;
}) {
  const stage = response ? STAGE[response.stage] : null;
  const pct = response && response.total ? Math.round((response.decided / response.total) * 100) : 0;
  // The open file is always listed, even when it is older than the files read first.
  const listed = files.some((f) => f.id === openFileId) || !openFileId ? files
    : [{ id: openFileId, fileName: openFileName } as RFISession, ...files];
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <header aria-label="Response" className="bg-white rounded-2xl border border-ink-100 shadow-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <h1 className="text-xl sm:text-2xl font-black text-ink-900 tracking-tight break-words flex-1 min-w-[12rem]">{name}</h1>
        {stage && (
          <span className={`status-pill flex-shrink-0 ${stage.pill}`}>
            {stage.label}{response?.outcome ? `: ${OUTCOME_LABEL[response.outcome]}` : ''}
          </span>
        )}
      </div>

      {response?.trial && (
        <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
          <span className="font-bold">A try.</span> Work through it as you would a real response: nothing you do here is learned by the knowledge base. Other members do not see it in their lists of responses, though anyone signed in could open it from a link. Its questions cannot be assigned to colleagues.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500 font-medium">
        {(ownerName ?? response?.ownerName ?? (response ? 'No owner' : null)) && (
          <span className="flex items-center gap-1.5"><User size={12} aria-hidden="true" /> {ownerName ?? response?.ownerName ?? 'No owner'}</span>
        )}
        {response && (
          <span className="flex items-center gap-1.5">
            <CalendarClock size={12} aria-hidden="true" /> {response.dueDate ? `Due ${formatDate(response.dueDate)}` : 'No due date'}
          </span>
        )}
        {!response && readFailed && <span role="status" className="text-coral-600">This response&apos;s due date and progress could not be read. Reload the page to try again.</span>}
        {response?.overdue && <span className="status-pill bg-coral-50 text-coral-700 border-coral-200"><AlertTriangle size={11} aria-hidden="true" /> Overdue</span>}
        {response?.atRisk && <span className="status-pill bg-amber-50 text-amber-800 border-amber-200"><AlertTriangle size={11} aria-hidden="true" /> At risk</span>}
      </div>

      {response && (
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-ink-500 mb-1">
            <span>{response.decided} of {response.total} decided</span>
            {files.length > 1 && <span className="text-ink-400">across {files.length} files</span>}
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden" role="progressbar" aria-label="Questions decided"
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="section-label">Files</span>
        <ul aria-label="Files" className="contents">
          {listed.map((f) => (
            <li key={f.id} className="contents">
              {f.id === openFileId ? (
                <span aria-current="true" className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-900 bg-ink-50 border border-ink-200 rounded-lg px-2.5 py-1.5 max-w-full">
                  <FileText size={12} aria-hidden="true" className="flex-shrink-0" /> <span className="truncate">{f.fileName}</span> <span className="font-medium text-ink-500">(open)</span>
                </span>
              ) : (
                <button onClick={() => onOpenFile(f)} className="btn-ghost text-xs py-1.5 max-w-full">
                  <FileText size={12} aria-hidden="true" className="flex-shrink-0" /> <span className="truncate">{f.fileName}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        {onAddFile && (
          <button onClick={onAddFile} className="btn-ghost text-xs py-1.5">
            <Upload size={12} aria-hidden="true" /> Add a file
          </button>
        )}
      </div>

      <nav aria-label="Stages" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {([['stage-questions', 'Questions', stages.questions], ['stage-experts', 'With experts', stages.experts], ['stage-send', 'Send', stages.send]] as const).map(([id, label, what]) => (
          <button key={id} onClick={() => jump(id)}
            className="text-left rounded-xl border border-ink-100 bg-ink-50/60 hover:bg-ink-50 px-3 py-2 transition-colors">
            <span className="block text-xs font-black text-ink-900">{label}</span>
            <span className="block text-xs text-ink-500">{what}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}
