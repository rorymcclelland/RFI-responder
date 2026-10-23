/** Step 5: the export is recorded; download the response and see what the knowledge base learned. */
import { CheckCircle2, Download, FileDown, FileText, Sheet, Upload } from 'lucide-react';
import { exportCSV, exportExcel, exportWord } from '../exportUtils';
import type { RFIQuestion } from '../types';

export default function ExportPanel({ questions, fileName, acceptedCount, skippedCount, learning, onStartNew }: {
  questions: RFIQuestion[];
  fileName: string;
  acceptedCount: number;
  skippedCount: number;
  /** What learning at export did (S3-4); empty for an export recorded earlier. */
  learning: string;
  onStartNew: () => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 px-6 py-5 border-b border-ink-100 bg-ink-50">
        <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center">
          <Download size={18} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-ink-900">Export recorded</h3>
          <p className="text-xs text-ink-500 font-medium">
            {acceptedCount} answered{skippedCount ? `, ${skippedCount} marked "Not answered"` : ''}
          </p>
        </div>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <p className="section-label mb-3">Knowledge Base</p>
          <div className="flex items-start gap-2.5 text-sm text-ink-700 font-medium">
            <CheckCircle2 size={17} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>{learning || 'The knowledge base learned from this response when its export was recorded.'}</span>
          </div>
          <p className="text-xs text-ink-400 mt-2 font-medium">
            Edited and person-written answers become entries, with this response recorded as their source. Pricing answers are never learned.
          </p>
        </div>

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
