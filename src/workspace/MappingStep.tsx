/** Step 2: choose which column holds the questions. */
import { CheckCircle2, ChevronDown, Sparkles } from 'lucide-react';

export default function MappingStep({ fileName, rowCount, headers, questionCol, onChange, onBack, onRun }: {
  fileName: string;
  rowCount: number;
  headers: string[];
  questionCol: string;
  onChange: (col: string) => void;
  onBack: () => void;
  onRun: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h2 className="text-2xl font-black text-ink-900 tracking-tight">Map Your Columns</h2>
        <p className="text-sm text-ink-500 mt-1.5 font-medium">Tell us which column contains the questions.</p>
      </div>

      <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
        <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-emerald-800">
          <strong>{fileName}</strong>: {rowCount} rows, {headers.length} columns
        </span>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label htmlFor="question-column" className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">
            Question column<span className="text-coral-500 ml-0.5">*</span>
          </label>
          <div className="relative">
            <select id="question-column" value={questionCol} onChange={(e) => onChange(e.target.value)} className="input appearance-none pr-9">
              <option value="">Not mapped</option>
              {headers.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <p className="section-label mb-2.5">Detected columns</p>
          <div className="flex flex-wrap gap-2">
            {headers.map((h) => (
              <button
                key={h}
                onClick={() => onChange(h)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                  h === questionCol ? 'bg-ink-900 border-ink-900 text-white' : 'bg-white border-ink-200 text-ink-500 hover:border-ink-400 hover:text-ink-800'
                }`}
              >{h}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost">Back</button>
        <button onClick={onRun} disabled={!questionCol} className="btn-primary disabled:opacity-40">
          <Sparkles size={16} /> Match and draft
        </button>
      </div>
    </div>
  );
}
