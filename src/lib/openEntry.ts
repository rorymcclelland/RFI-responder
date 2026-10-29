/**
 * Sprint 18 (S18-2): open an answer's page from anywhere (a draft's sources, an ask's sources). The
 * app listens and switches to Knowledge at that answer, so the screens need not pass a callback down.
 */
export const OPEN_ENTRY_EVENT = 'rfi:open-entry';

export function openEntry(ref: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_ENTRY_EVENT, { detail: ref }));
}
