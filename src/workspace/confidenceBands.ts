/**
 * The confidence bands in the review filter. Since Sprint 17 (S17-1) they match the bulk buttons
 * (High at least 80%, Medium at least 60%), as docs/GLOSSARY.md says.
 */
export type ConfidenceGroup = 'all' | 'high' | 'medium' | 'low' | 'uncalibrated';

export const CONF_GROUPS: { key: ConfidenceGroup; label: string; min: number; max: number; dot: string }[] = [
  { key: 'high',   label: 'High ≥80%',    min: 0.80, max: 1.01, dot: 'bg-emerald-500' },
  { key: 'medium', label: 'Medium 60–80%', min: 0.60, max: 0.80, dot: 'bg-amber-400' },
  { key: 'low',    label: 'Low <60%',      min: 0,    max: 0.60, dot: 'bg-coral-500' },
  { key: 'uncalibrated', label: 'Not calibrated', min: NaN, max: NaN, dot: 'bg-ink-300' },
];

export function inGroup(confidence: number | null, g: { key: ConfidenceGroup; min: number; max: number }): boolean {
  if (g.key === 'uncalibrated') return confidence === null;
  return confidence !== null && confidence >= g.min && confidence < g.max;
}
