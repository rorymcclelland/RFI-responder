// Sprint 5, S5-3: checking and correcting the questions found in a Word document before saving.
import { describe, expect, it } from 'vitest';
import { addAfter, canMerge, describeExtraction, edit, fromExtraction, mergeWithNext, remove, toInsertRows, validateDrafts, type ExtractionResult } from './questionDrafts';

const result: ExtractionResult = {
  method: 'ai', dropped: 2, model: 'claude-haiku-5-5', promptVersion: 'extract-2026-10-23.1',
  questions: [
    { question: 'Do you encrypt data at rest?', number: '1.', blockIds: ['b3'], part: false, fromBlock: 'Do you encrypt data at rest?' },
    { question: 'Describe your backup policy', number: '3(a)', blockIds: ['b5'], part: true, fromBlock: 'Describe (a) your backup policy and (b) how often you test restores.' },
    { question: 'Describe how often you test restores', number: '3(b)', blockIds: ['b5'], part: true, fromBlock: 'Describe (a) your backup policy and (b) how often you test restores.' },
  ],
};

describe('question drafts (S5-3)', () => {
  it('1. removing one and adding one saves exactly the edited list, in order, with the customer\'s numbers', () => {
    let list = fromExtraction(result);
    list = remove(list, 0);
    list = addAfter(list, 1, 'Who approves access?');
    list = edit(list, 0, 'Describe your backup policy in full');
    expect(toInsertRows(list)).toEqual([
      { position: 0, question: 'Describe your backup policy in full', customerRef: '3(a)' },
      { position: 1, question: 'Describe how often you test restores', customerRef: '3(b)' },
      { position: 2, question: 'Who approves access?', customerRef: null },
    ]);
  });

  it('2. an empty list cannot be saved', () => {
    expect(validateDrafts([])).toMatch(/no questions/);
    expect(validateDrafts(edit(fromExtraction(result), 0, '   '))).toMatch(/Question 1 is empty/);
  });

  it('3. a question over 5,000 characters is refused', () => {
    expect(validateDrafts(edit(fromExtraction(result), 1, 'x'.repeat(5001)))).toMatch(/Question 2 is longer than 5,000 characters/);
  });

  it('4. split parts can be merged back into the question as the document has it', () => {
    const list = fromExtraction(result);
    expect(canMerge(list, 0)).toBe(false);
    expect(canMerge(list, 1)).toBe(true);
    const merged = mergeWithNext(list, 1);
    expect(merged.map((d) => [d.number, d.question, d.part])).toEqual([
      ['1.', 'Do you encrypt data at rest?', false],
      ['3', 'Describe (a) your backup policy and (b) how often you test restores.', false],
    ]);
  });

  it('5 and 6. the summary says how the questions were found and what was left out', () => {
    expect(describeExtraction(result)).toBe('Found 3 questions with AI, each checked against the document. 2 suggestions were not found in the document and were left out.');
    expect(describeExtraction({ ...result, method: 'rules', dropped: 0 })).toBe(
      'Found 3 questions by simple rules, not AI (the AI service was unavailable). Check the list carefully: rules miss questions without a question mark.');
  });
});
