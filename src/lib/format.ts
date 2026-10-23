/**
 * Confidence as shown to reviewers (F-17). Calibration is fitted on a small synthetic set, so
 * its top bin can be all-correct; that is not certainty, and the screen never says "100%".
 */
export function formatConfidence(c: number | null): string | null {
  if (c === null) return null;
  if (c >= 0.99) return '99%+';
  return `${Math.min(98, Math.round(c * 100))}%`;
}
