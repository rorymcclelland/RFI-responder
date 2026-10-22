/**
 * Model-written notes (a classifier's reason, a drafter's "what is missing") are shown to
 * reviewers, so they get the same treatment as drafts: no links, no addresses, no prompt text,
 * and a length limit. Anything suspicious is replaced, not repaired (security review, Sprint 2).
 */
import { PROMPT_CANARY } from './claude.ts';

/** Links with or without a scheme, protocol-relative links, bare domains and email addresses. */
export const LINK_PATTERN = /(?:https?:)?\/\/\S+|\bwww\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?/gi;

export function safeNote(text: string, max = 300): string {
  const t = text.normalize('NFKC').replace(/\p{Cf}/gu, '').trim();
  if (t.includes(PROMPT_CANARY) || (t.match(LINK_PATTERN) ?? []).length > 0) return 'The explanation was withheld because it contained a link or unexpected text.';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
