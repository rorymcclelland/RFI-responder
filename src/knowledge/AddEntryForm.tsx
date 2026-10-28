/** Adding one entry by hand (moved from the knowledge-base pop-up to the knowledge page, Sprint 17). */
import { useState } from 'react';
import { addEntry, parseTags } from '../lib/entryReview';
import { confirmThenIndex, indexNewEntries } from '../lib/knowledgeBase';
import { supabase } from '../lib/supabase';

export default function AddEntryForm({ onDone, onCancel, onIndexFailed }: { onDone: (message: string) => void; onCancel: () => void; onIndexFailed: (message: string) => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const r = await addEntry(supabase, { question, answer, tags: parseTags(tags), source });
      // Sprint 16 (S16-2, BUG-40): the save is confirmed at once; indexing runs afterwards.
      onDone(confirmThenIndex(r, indexNewEntries, onIndexFailed));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 border border-ink-100 rounded-2xl p-4 bg-ink-50">
      <p className="text-sm font-bold text-ink-800">Add an entry</p>
      <textarea className="input min-h-[60px]" placeholder="The question it answers" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question" />
      <textarea className="input min-h-[100px]" placeholder="The answer" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
      <div className="grid sm:grid-cols-2 gap-2">
        <input className="input" placeholder="Tags, separated by commas" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
        <input className="input" placeholder="Source (policy, document)" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" />
      </div>
      {error && <p className="text-xs text-coral-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Add entry'}</button>
      </div>
    </div>
  );
}
