import { describe, expect, it } from 'vitest';
import { answerSource, ANSWER_HEADING } from './answerLabel';

describe('answerSource (Sprint 3 review: no claims about checks on text a person wrote)', () => {
  it('an unedited draft is the draft', () => {
    expect(answerSource({ generatedAnswer: 'We use MFA.', finalAnswer: 'We use MFA.' })).toBe('draft');
  });
  it('whitespace alone is not an edit', () => {
    expect(answerSource({ generatedAnswer: 'We use MFA.', finalAnswer: ' We use MFA.\n' })).toBe('draft');
  });
  it('a changed draft is edited, and is not labelled as the proposed response', () => {
    const s = answerSource({ generatedAnswer: 'We use MFA.', finalAnswer: 'We use FIDO2 MFA.' });
    expect(s).toBe('edited');
    expect(ANSWER_HEADING[s]).not.toMatch(/Proposed/);
  });
  it('an answer where no draft was offered (pricing, no evidence) is written by a person', () => {
    expect(answerSource({ generatedAnswer: '', finalAnswer: 'Quoted separately.' })).toBe('person');
  });
  it('no draft and no answer yet is still the (empty) proposed response', () => {
    expect(answerSource({ generatedAnswer: '', finalAnswer: '' })).toBe('draft');
  });
});
