/**
 * Sprint 19 (S19-2): open a response at one question, in whichever file it is in, from anywhere
 * (Home, questions for you). The app listens, as it does for an answer's page (openEntry).
 */
export const OPEN_QUESTION_EVENT = 'rfi:open-question';

export interface QuestionTarget { responseId: string; sessionId: string; questionId: string }

export function openQuestion(target: QuestionTarget): void {
  window.dispatchEvent(new CustomEvent<QuestionTarget>(OPEN_QUESTION_EVENT, { detail: target }));
}
