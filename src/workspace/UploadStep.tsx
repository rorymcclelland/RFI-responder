/** Step 1: upload a questions file, or reopen an earlier session. */
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileDown, FileSpreadsheet, RefreshCw, Sparkles, Upload } from 'lucide-react';
import type { RFISession } from '../types';

function SessionRow({ session: s, onLoad }: { session: RFISession; onLoad: (s: RFISession) => void }) {
  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover transition-all">
      <div className="w-10 h-10 rounded-xl bg-ink-50 flex items-center justify-center flex-shrink-0">
        <FileSpreadsheet size={18} className="text-ink-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink-800 truncate">{s.fileName}</p>
        <p className="text-xs text-ink-400 font-medium">
          {new Date(s.createdAt).toLocaleDateString()} · {s.questionCount} questions
          {s.status === 'completed' && ` · ${s.acceptedCount} approved`}
        </p>
      </div>
      <span className={`status-pill flex-shrink-0 ${
        s.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}>
        {s.status === 'completed' ? 'Done' : 'In progress'}
      </span>
      <button onClick={() => onLoad(s)} className="btn-ghost text-xs py-2 flex-shrink-0">
        {s.status === 'completed' ? 'View' : 'Resume'} <ArrowRight size={12} />
      </button>
    </div>
  );
}

function SessionList({ title, note, sessions, onLoad, onRefresh }: {
  title: string; note?: string; sessions: RFISession[]; onLoad: (s: RFISession) => void; onRefresh?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Clock size={16} className="text-ink-400" />
        <p className="text-sm font-bold text-ink-700">{title}</p>
        {note && <span className="text-2xs text-ink-400 font-medium bg-ink-100 px-2 py-0.5 rounded-full">{note}</span>}
        {onRefresh && (
          <button onClick={onRefresh} aria-label="Refresh the list of files" className="ml-auto w-7 h-7 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors">
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <div className="space-y-2">
        {sessions.map((s) => <SessionRow key={s.id} session={s} onLoad={onLoad} />)}
      </div>
    </div>
  );
}

export default function UploadStep({ opportunityName, error, pastSessions, onFile, onLoadSession, onRefresh, uploadNote = null }: {
  /** Sprint 17 (S17-2): set when this person cannot add a file: the drop zone is replaced by this line. */
  uploadNote?: string | null;
  opportunityName: string;
  error: string;
  pastSessions: RFISession[];
  onFile: (file: File) => void;
  onLoadSession: (s: RFISession) => void;
  onRefresh: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      <div>
        <h2 className="text-3xl font-black text-ink-900 tracking-tight">{uploadNote === null ? 'Add the questions' : pastSessions.length > 0 ? 'Files in this response' : 'No questions yet'}</h2>
        {uploadNote === null && (
          <p className="text-ink-500 mt-2 text-sm font-medium max-w-lg">
            Upload questions for <strong className="text-ink-700">{opportunityName}</strong>. Each question is matched against the knowledge base,
            checked for pricing and legal terms, and drafted from the matching entries for you to review.
          </p>
        )}
      </div>

      {uploadNote === null ? (
        <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInput.current?.click()}
        className={`border-2 border-dashed rounded-3xl p-14 text-center cursor-pointer transition-all duration-200 ${
          dragOver ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-400 hover:bg-white'
        }`}
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-colors ${dragOver ? 'bg-ink-900' : 'bg-ink-100'}`}>
          <Upload size={28} className={dragOver ? 'text-white' : 'text-ink-500'} />
        </div>
        <p className="text-lg font-black text-ink-800 mb-1">{dragOver ? 'Drop to upload' : 'Drag & drop your questions file'}</p>
        <p className="text-sm text-ink-400 font-medium">or click to browse</p>
        <div className="flex justify-center gap-2 mt-5">
          {['.csv', '.xlsx', '.docx'].map((e) => (
            <span key={e} className="text-xs bg-white border border-ink-200 text-ink-500 px-3 py-1.5 rounded-full font-bold shadow-card">{e}</span>
          ))}
        </div>
        <input ref={fileInput} type="file" accept=".csv,.xlsx,.docx" onChange={handleFileChange} className="hidden" />
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: '1', icon: <Upload size={18} />, title: 'Upload', desc: 'CSV, Excel or Word' },
          { n: '2', icon: <Sparkles size={18} />, title: 'Match and draft', desc: 'From the knowledge base' },
          { n: '3', icon: <CheckCircle2 size={18} />, title: 'Review', desc: 'Approve, edit or leave unanswered' },
          { n: '4', icon: <FileDown size={18} />, title: 'Export', desc: 'Excel, CSV or Word' },
        ].map((s) => (
          <div key={s.n} className="bg-white rounded-2xl border border-ink-100 shadow-card p-4 text-center hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-ink-900 text-white flex items-center justify-center mx-auto mb-3">{s.icon}</div>
            <p className="text-sm font-bold text-ink-800">{s.title}</p>
            <p className="text-xs text-ink-400 mt-0.5 font-medium">{s.desc}</p>
          </div>
        ))}
      </div>

        </>
      ) : (
        <p role="status" className="text-sm text-ink-600 font-medium bg-white border border-ink-100 rounded-2xl px-5 py-4 shadow-card">{uploadNote}</p>
      )}

      {/* Sprint 17 (S17-1): files not linked to any response are no longer listed in every response. */}
      {pastSessions.length > 0 && (
        <div className="space-y-6">
          <SessionList title="Files in this response" sessions={pastSessions} onLoad={onLoadSession} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}
