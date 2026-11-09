/**
 * Sprint 26 (S26-1, F-73): a response holds at most 2,000 questions, so it can be marked as sent in one
 * go within the hosted database's time limit (2,000 questions sent in about half of it on staging;
 * Rory, 9 November). The database enforces it (migration 20261113110000_response_size_limit.sql); the
 * page checks first, so a file that will not fit is refused before anything is uploaded, in the same
 * words.
 */
export const MAX_RESPONSE_QUESTIONS = 2000;

const n = (x: number) => x.toLocaleString('en-GB');

/** Why a file of `adding` questions cannot join a response that already holds `existing`, or null. */
export function responseTooLarge(existing: number, adding: number): string | null {
  const total = existing + adding;
  if (total <= MAX_RESPONSE_QUESTIONS) return null;
  return `This response would have ${n(total)} questions; a response can have at most ${n(MAX_RESPONSE_QUESTIONS)}, so that it can be marked as sent in one go. Put the rest in a new response.`;
}
