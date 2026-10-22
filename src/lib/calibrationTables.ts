/** Calibration tables fitted by `npm run eval:calibrate`, loaded at build time (Vite). */
import type { CalibrationTable } from './calibration';

const loaded = import.meta.glob<CalibrationTable>('./calibration/*.json', { eager: true, import: 'default' });

export const CALIBRATION_TABLES: Record<string, CalibrationTable> = Object.fromEntries(
  Object.values(loaded).map((t) => [t.model, t]),
);
