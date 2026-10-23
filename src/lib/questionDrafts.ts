/**
 * The list of questions found in a Word document, as the person checks and corrects it before
 * saving (Sprint 5, S5-3). Pure functions, so the preview's behaviour is unit-tested.
 */

/** What the extract-questions Edge Function returns (supabase/functions/_shared/extraction.ts). */
export interface ExtractionResult {
  questions: { question: string; number: string; blockIds: string[]; part: boolean; fromBlock: string }[];
  dropped: number;
  method: 'ai' | 'rules';
  model: string | null;
  promptVersion: string | null;
}

export interface Draft {
  key: string;
  question: string;
  /** The customer's own number ("3.2.", "4(a)"); empty when there is none. */
  number: string;
  part: boolean;
  fromBlock: string;
}

let counter = 0;
const key = () => `d${++counter}`;

export const fromExtraction = (r: ExtractionResult): Draft[] =>
  r.questions.map((q) => ({ key: key(), question: q.question, number: q.number, part: q.part, fromBlock: q.fromBlock }));

export const edit = (list: Draft[], i: number, question: string) => list.map((d, k) => (k === i ? { ...d, question } : d));
export const remove = (list: Draft[], i: number) => list.filter((_, k) => k !== i);
export const addAfter = (list: Draft[], i: number, question = '') =>
  [...list.slice(0, i + 1), { key: key(), question, number: '', part: false, fromBlock: '' }, ...list.slice(i + 1)];

/** Two neighbouring parts of the same multi-part question can be joined again. */
export const canMerge = (list: Draft[], i: number) =>
  i >= 0 && i + 1 < list.length && list[i].part && list[i + 1].part && list[i].fromBlock !== '' && list[i].fromBlock === list[i + 1].fromBlock;

const LEADING_NUMBER = /^\s*(\(?[a-z]{1,2}\)|\(?\d+(\.\d+)*[.)]?|[a-z]{1,2}\d+[.)]?|[ivx]{1,5}[.)])\s+/i;

/** Joins a part with the next one (and any further parts of the same question) into the question as written. */
export function mergeWithNext(list: Draft[], i: number): Draft[] {
  if (!canMerge(list, i)) return list;
  let end = i + 1;
  while (canMerge(list, end)) end++;
  const merged: Draft = {
    key: key(),
    question: list[i].fromBlock.replace(LEADING_NUMBER, '').replace(/\s+/g, ' ').trim(),
    number: list[i].number.replace(/\s*\(?[a-z]{1,3}\)$/i, ''),
    part: false,
    fromBlock: list[i].fromBlock,
  };
  return [...list.slice(0, i), merged, ...list.slice(end + 1)];
}

/** Refuses what the database would refuse, with a message the person can act on. */
export function validateDrafts(list: Draft[]): string | null {
  if (list.length === 0) return 'There are no questions to save. Add one, or go back and choose another file.';
  for (const [i, d] of list.entries()) {
    if (d.question.trim().length === 0) return `Question ${i + 1} is empty.`;
    if (d.question.trim().length > 5000) return `Question ${i + 1} is longer than 5,000 characters.`;
  }
  return null;
}

export const toInsertRows = (list: Draft[]) =>
  list.map((d, position) => ({ position, question: d.question.trim(), customerRef: d.number.trim().slice(0, 20) || null }));

export function describeExtraction(r: Pick<ExtractionResult, 'method' | 'dropped' | 'questions'>): string {
  const n = r.questions.length;
  const found = `Found ${n} question${n === 1 ? '' : 's'}`;
  if (r.method === 'rules') {
    return `${found} by simple rules, not AI (the AI service was unavailable). Check the list carefully: rules miss questions without a question mark.`;
  }
  const dropped = r.dropped > 0
    ? ` ${r.dropped} suggestion${r.dropped === 1 ? ' was' : 's were'} not found in the document and ${r.dropped === 1 ? 'was' : 'were'} left out.`
    : '';
  return `${found} with AI. Each is a whole sentence or lettered part, word for word as it appears in the document.${dropped}`;
}
