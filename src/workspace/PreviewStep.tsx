/**
 * Step 2 for Word documents (Sprint 5, S5-3): check and correct the questions that were found
 * before anything is saved or processed. Spreadsheets use MappingStep instead.
 */
import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Merge, Plus, Sparkles, Trash2 } from 'lucide-react';
import { addAfter, canMerge, edit, mergeWithNext, remove, validateDrafts, type Draft } from '../lib/questionDrafts';

export default function PreviewStep({ fileName, summary, ruleBased, drafts, onChange, onBack, onSave }: {
  fileName: string;
  summary: string;
  ruleBased: boolean;
  drafts: Draft[];
  onChange: (next: Draft[]) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const save = () => {
    const problem = validateDrafts(drafts);
    setError(problem ?? '');
    if (!problem) onSave();
  };
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h2 className="text-2xl font-black text-ink-900 tracking-tight">Check the questions</h2>
        <p className="text-sm text-ink-500 mt-1.5 font-medium">
          From <strong>{fileName}</strong>. Nothing is saved until you choose Save and match. Edit, remove or add questions; split parts can be joined again.
        </p>
      </div>

      <div role="status" className={`flex items-start gap-3 p-4 rounded-2xl border ${ruleBased ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
        {ruleBased ? <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> : <Sparkles size={16} className="flex-shrink-0 mt-0.5" />}
        <p className="text-sm font-semibold">{summary}</p>
      </div>

      <ol className="space-y-2">
        {drafts.map((d, i) => (
          <li key={d.key} className="card p-3">
            <div className="flex items-start gap-2">
              <span className="text-2xs font-bold text-ink-500 bg-ink-50 border border-ink-100 px-1.5 py-1 rounded min-w-[2.5rem] text-center mt-1">
                {d.number || i + 1}
              </span>
              <textarea
                aria-label={`Question ${i + 1}`}
                value={d.question}
                onChange={(e) => onChange(edit(drafts, i, e.target.value))}
                rows={Math.min(4, Math.max(1, Math.ceil(d.question.length / 90)))}
                className="input flex-1 text-sm"
              />
              <div className="flex flex-col gap-1">
                <button aria-label={`Remove question ${i + 1}`} title="Remove" onClick={() => onChange(remove(drafts, i))} className="btn-ghost p-1.5"><Trash2 size={13} /></button>
                <button aria-label={`Add a question after ${i + 1}`} title="Add a question after this one" onClick={() => onChange(addAfter(drafts, i))} className="btn-ghost p-1.5"><Plus size={13} /></button>
                {canMerge(drafts, i) && (
                  <button aria-label={`Join question ${i + 1} with the next part`} title="Join the parts into one question" onClick={() => onChange(mergeWithNext(drafts, i))} className="btn-ghost p-1.5"><Merge size={13} /></button>
                )}
              </div>
            </div>
            {d.fromBlock && (
              <button onClick={() => setOpen(open === d.key ? null : d.key)} className="text-2xs text-ink-400 mt-1 ml-12 flex items-center gap-1">
                {open === d.key ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Where it came from
              </button>
            )}
            {open === d.key && <p className="text-xs text-ink-500 ml-12 mt-1 whitespace-pre-wrap">{d.fromBlock}</p>}
          </li>
        ))}
      </ol>
      {drafts.length === 0 && <p className="text-sm text-ink-400">No questions. Add one below, or go back and choose another file.</p>}
      <button onClick={() => onChange(addAfter(drafts, drafts.length - 1))} className="btn-ghost text-sm"><Plus size={14} /> Add a question</button>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost">Back</button>
        <button onClick={save} className="btn-primary"><Sparkles size={16} /> Save and match {drafts.length} question{drafts.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  );
}
