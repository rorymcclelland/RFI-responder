/**
 * BulkUploadModal — imports Q&A pairs directly into the Knowledge Base.
 * Expects a spreadsheet with at minimum a "question" and "answer" column.
 * This is the KB-building tool; for answering a new RFI use RFIWorkspace.
 */

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from 'react';
import { parseSpreadsheet, SpreadsheetError, type Row } from './lib/spreadsheet';
import {
  X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2,
  ChevronDown, Trash2, Eye, EyeOff,
} from 'lucide-react';
import { KnowledgeEntry } from './types';

// ─── Column aliases ───────────────────────────────────────────────────────────

const ALIASES: Record<'question' | 'answer' | 'tags' | 'source', string[]> = {
  question: ['question', 'q', 'query', 'prompt', 'topic'],
  answer:   ['answer', 'a', 'response', 'reply', 'text', 'content'],
  tags:     ['tags', 'tag', 'category', 'categories', 'labels', 'keywords'],
  source:   ['source', 'reference', 'ref', 'document', 'policy'],
};

function detectCol(headers: string[], field: keyof typeof ALIASES) {
  const low = headers.map((h) => h.toLowerCase().trim());
  for (const alias of ALIASES[field]) {
    const i = low.findIndex((h) => h === alias || h.startsWith(alias));
    if (i !== -1) return headers[i];
  }
  return '';
}

function parseTags(raw: unknown): string[] {
  const str = String(raw ?? '').trim();
  return str ? str.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ColMap = { question: string; answer: string; tags: string; source: string };
type Stage  = 'upload' | 'map' | 'preview';

interface ParsedRow {
  rowNum: number;
  question: string;
  answer: string;
  tags: string[];
  source: string;
  error?: string;
  selected: boolean;
  showAnswer: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Select({ label, value, options, onChange, required }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">— not mapped —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  onImport: (entries: Omit<KnowledgeEntry, 'id'>[]) => void;
  onClose: () => void;
}

export default function BulkUploadModal({ onImport, onClose }: Props) {
  const [stage, setStage]       = useState<Stage>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders]   = useState<string[]>([]);
  const [colMap, setColMap]     = useState<ColMap>({ question: '', answer: '', tags: '', source: '' });
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [error, setError]       = useState('');
  const fileInput               = useRef<HTMLInputElement>(null);
  const rawRef                  = useRef<Row[]>([]);

  // ── File parsing ────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setError('');
    try {
      const { headers: hdrs, rows } = await parseSpreadsheet(file);
      rawRef.current = rows;
      setFileName(file.name);
      setHeaders(hdrs);
      setColMap({
        question: detectCol(hdrs, 'question'),
        answer:   detectCol(hdrs, 'answer'),
        tags:     detectCol(hdrs, 'tags'),
        source:   detectCol(hdrs, 'source'),
      });
      setStage('map');
    } catch (err) {
      setError(err instanceof SpreadsheetError ? err.message : 'The file could not be read.');
    }
  }, []);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  // ── Build preview rows ──────────────────────────────────────────────────

  const buildPreview = () => {
    const built: ParsedRow[] = rawRef.current.map((row, i) => {
      const q = colMap.question ? String(row[colMap.question] ?? '').trim() : '';
      const a = colMap.answer   ? String(row[colMap.answer]   ?? '').trim() : '';
      const t = parseTags(colMap.tags ? row[colMap.tags] : '');
      const s = colMap.source   ? String(row[colMap.source]   ?? '').trim() : '';
      let err: string | undefined;
      if (!q) err = 'Missing question';
      else if (!a) err = 'Missing answer';
      return { rowNum: i + 2, question: q, answer: a, tags: t, source: s, error: err, selected: !err, showAnswer: false };
    });
    setRows(built);
    setStage('preview');
  };

  const toggleSelected = (i: number) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, selected: !r.selected } : r));
  const toggleAll = () => {
    const valid  = rows.filter((r) => !r.error);
    const allSel = valid.every((r) => r.selected);
    setRows((prev) => prev.map((r) => r.error ? r : { ...r, selected: !allSel }));
  };
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  const handleImport = () => {
    const toAdd = rows.filter((r) => r.selected && !r.error).map((r) => ({
      question: r.question, answer: r.answer,
      tags: r.tags, source: r.source || undefined,
    }));
    onImport(toAdd);
  };

  const validRows    = rows.filter((r) => !r.error);
  const selectedRows = validRows.filter((r) => r.selected);
  const canMap       = !!colMap.question && !!colMap.answer;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet size={16} className="text-teal-600" />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Import to Knowledge Base</h3>
              <p className="text-xs text-slate-500">Upload a Q&amp;A spreadsheet to add entries directly to the KB</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        {/* Stage indicator */}
        <div className="flex items-center gap-1 px-6 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          {(['upload', 'map', 'preview'] as Stage[]).map((s, i) => {
            const order = ['upload', 'map', 'preview'] as Stage[];
            const done = order.indexOf(stage) > i;
            const active = stage === s;
            return (
              <div key={s} className="flex items-center">
                <span className={`text-xs px-2 py-1 rounded-lg font-medium capitalize flex items-center gap-1.5 ${
                  active ? 'text-teal-700 bg-teal-50' : done ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold ${
                    active ? 'bg-teal-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
                  }`}>{done ? '✓' : i + 1}</span>
                  {s === 'upload' ? 'Upload' : s === 'map' ? 'Map' : 'Preview'}
                </span>
                {i < 2 && <div className={`w-5 h-px mx-0.5 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Upload */}
          {stage === 'upload' && (
            <div className="p-6 space-y-4">
              <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop} onClick={() => fileInput.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? 'border-teal-400 bg-teal-50' : 'border-slate-300 hover:border-teal-300 hover:bg-slate-50'
                }`}>
                <Upload size={26} className={`mx-auto mb-3 ${dragOver ? 'text-teal-500' : 'text-slate-400'}`} />
                <p className="text-sm font-semibold text-slate-700">Drag & drop or click to upload</p>
                <p className="text-xs text-slate-500 mt-1">CSV or Excel with question + answer columns</p>
                <input ref={fileInput} type="file" accept=".csv,.xlsx" onChange={handleChange} className="hidden" />
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  <AlertTriangle size={12} className="flex-shrink-0" />{error}
                </div>
              )}
            </div>
          )}

          {/* Map */}
          {stage === 'map' && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2 p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-700">
                <CheckCircle2 size={13} className="flex-shrink-0" />
                <span><strong>{fileName}</strong> — {rawRef.current.length} rows, {headers.length} columns</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select label="Question column" value={colMap.question} options={headers}
                  onChange={(v) => setColMap((p) => ({ ...p, question: v }))} required />
                <Select label="Answer column" value={colMap.answer} options={headers}
                  onChange={(v) => setColMap((p) => ({ ...p, answer: v }))} required />
                <Select label="Tags column (optional)" value={colMap.tags} options={headers}
                  onChange={(v) => setColMap((p) => ({ ...p, tags: v }))} />
                <Select label="Source column (optional)" value={colMap.source} options={headers}
                  onChange={(v) => setColMap((p) => ({ ...p, source: v }))} />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {headers.map((h) => {
                    const mapped = Object.values(colMap).includes(h);
                    return (
                      <span key={h} className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                        mapped ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}>{h}</span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Preview */}
          {stage === 'preview' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">{validRows.length} valid rows</span>
                {rows.length - validRows.length > 0 && (
                  <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded-full">{rows.length - validRows.length} errors</span>
                )}
                <span className="text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1 rounded-full ml-auto">{selectedRows.length} selected</span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2.5 text-left w-8">
                        <input type="checkbox" onChange={toggleAll}
                          checked={validRows.length > 0 && validRows.every((r) => r.selected)}
                          className="accent-teal-600" />
                      </th>
                      <th className="px-2 py-2.5 text-left font-semibold text-slate-600 w-8">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Question</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-8"></th>
                      <th className="px-3 py-2.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, i) => (
                      <>
                        <tr key={i} className={row.error ? 'bg-red-50 opacity-60' : 'hover:bg-slate-50'}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" checked={row.selected} disabled={!!row.error}
                              onChange={() => toggleSelected(i)} className="accent-teal-600" />
                          </td>
                          <td className="px-2 py-2.5 text-slate-400 font-mono">{row.rowNum}</td>
                          <td className="px-3 py-2.5">
                            {row.error
                              ? <span className="text-red-600 flex items-center gap-1"><AlertTriangle size={11} />{row.error}</span>
                              : <span className="text-slate-700 line-clamp-2">{row.question}</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            {!row.error && (
                              <button onClick={() => setRows((prev) => prev.map((r, j) => j === i ? { ...r, showAnswer: !r.showAnswer } : r))}
                                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
                                {row.showAnswer ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => removeRow(i)} className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-400 transition-colors">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                        {row.showAnswer && !row.error && (
                          <tr key={`${i}-ans`} className="bg-slate-50">
                            <td />
                            <td />
                            <td colSpan={3} className="px-3 pb-3 pt-1 text-xs text-slate-600 leading-relaxed">
                              <em className="text-slate-400 font-medium not-italic">Answer: </em>{row.answer}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <button
            onClick={() => { if (stage === 'map') setStage('upload'); else if (stage === 'preview') setStage('map'); else onClose(); }}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-white transition-colors">
            {stage === 'upload' ? 'Cancel' : 'Back'}
          </button>

          {stage === 'map' && (
            <button onClick={buildPreview} disabled={!canMap}
              className="px-5 py-2 text-sm font-semibold bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-colors">
              Preview Import
            </button>
          )}
          {stage === 'preview' && (
            <button onClick={handleImport} disabled={selectedRows.length === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors">
              <CheckCircle2 size={14} /> Import {selectedRows.length} {selectedRows.length === 1 ? 'Entry' : 'Entries'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
