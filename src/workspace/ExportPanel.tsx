/** Step 5: add accepted answers to the knowledge base and download the response. */
import { CheckCircle2, Download, FileDown, FileText, Plus, Sheet, Upload } from 'lucide-react';
import { exportCSV, exportExcel, exportWord } from '../exportUtils';
import type { RFIQuestion } from '../types';

export default function ExportPanel({ questions, fileName, acceptedCount, kbAdded, onAddToKB, onStartNew }: {
  questions: RFIQuestion[];
  fileName: string;
  acceptedCount: number;
  kbAdded: boolean;
  onAddToKB: () => void;
  onStartNew: () => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-5 border-b border-ink-100 bg-ink-50">
        <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center">
          <Download size={18} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-ink-900">Export & Finalise</h3>
          <p className="text-xs text-ink-500 font-medium">{acceptedCount} accepted response{acceptedCount !== 1 ? 's' : ''} ready</p>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {/* Add to KB */}
        <div>
          <p className="section-label mb-3">Knowledge Base</p>
          {kbAdded ? (
            <div className="flex items-center gap-2.5 text-sm text-emerald-700 font-semibold">
              <CheckCircle2 size={17} className="text-emerald-500" />
              {acceptedCount} answer{acceptedCount !== 1 ? 's' : ''} added to Knowledge Base
            </div>
          ) : (
            <button onClick={onAddToKB} className="btn-primary">
              <Plus size={16} /> Add {acceptedCount} Answer{acceptedCount !== 1 ? 's' : ''} to KB
            </button>
          )}
          <p className="text-xs text-ink-400 mt-2 font-medium">Accepted answers will be available for future RFI matching.</p>
        </div>

        {/* Download buttons */}
        <div className="border-t border-ink-100 pt-5">
          <p className="section-label mb-4">Download as</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => exportExcel(questions, fileName)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-emerald-300 text-emerald-700 rounded-2xl hover:bg-emerald-50 transition-colors shadow-card">
              <Sheet size={18} /> Excel (.xlsx)
            </button>
            <button onClick={() => exportCSV(questions, fileName)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-ink-200 text-ink-700 rounded-2xl hover:bg-ink-50 transition-colors shadow-card">
              <FileText size={18} /> CSV (.csv)
            </button>
            <button onClick={() => exportWord(questions, fileName)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-sky-300 text-sky-700 rounded-2xl hover:bg-sky-50 transition-colors shadow-card">
              <FileDown size={18} /> Word (.doc)
            </button>
          </div>
        </div>

        <div className="border-t border-ink-100 pt-4">
          <button onClick={onStartNew} className="btn-ghost text-sm">
            <Upload size={15} /> Start New RFI
          </button>
        </div>
      </div>
    </div>
  );
}
