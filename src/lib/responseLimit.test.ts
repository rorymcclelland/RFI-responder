// Sprint 26 (S26-1 9): the page's check matches the database's (supabase/tests/db/sprint26.test.ts).
import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_QUESTIONS, responseTooLarge } from './responseLimit';

describe('responseTooLarge (S26-1)', () => {
  it('accepts a file that brings the response exactly to the limit, and refuses one question more', () => {
    expect(MAX_RESPONSE_QUESTIONS).toBe(2000);
    expect(responseTooLarge(1500, 500)).toBeNull();
    expect(responseTooLarge(0, 2000)).toBeNull();
    expect(responseTooLarge(1500, 501)).toBe('This response would have 2,001 questions; a response can have at most 2,000, so that it can be marked as sent in one go. Put the rest in a new response.');
  });

  it('says the database\'s words, numbers written with commas', () => {
    expect(responseTooLarge(0, 100000)).toMatch(/^This response would have 100,000 questions; a response can have at most 2,000/);
  });
});
