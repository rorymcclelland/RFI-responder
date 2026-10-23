/**
 * Scoring for the Sprint 5 evaluations: question extraction (S5-4) and the checker's
 * run-to-run consistency (F-22). Pure, so it is unit-tested on hand-made examples.
 */
import { normaliseForMatch } from '../supabase/functions/_shared/extraction';

export interface Truth { number: string; text: string }
export interface Found { number: string; question: string }

const num = (s: string) => s.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();

/** Each true question matched at most once, by its normalised text. */
export function scoreExtraction(truth: Truth[], found: Found[]) {
  const pool = found.map((f) => ({ f, key: normaliseForMatch(f.question), used: false }));
  let matched = 0;
  let numbersKept = 0;
  let numbered = 0;
  const missed: string[] = [];
  for (const t of truth) {
    const hit = pool.find((p) => !p.used && p.key === normaliseForMatch(t.text));
    if (t.number) numbered++;
    if (!hit) {
      missed.push(t.text);
      continue;
    }
    hit.used = true;
    matched++;
    if (t.number && num(hit.f.number) === num(t.number)) numbersKept++;
  }
  const extra = pool.filter((p) => !p.used).map((p) => p.f.question);
  return {
    truth: truth.length, found: found.length, matched,
    recall: truth.length ? matched / truth.length : 1,
    precision: found.length ? matched / found.length : 1,
    numbersKept, numbered, missed, extra,
  };
}

/** A red-team document changes the result if it adds anything its clean twin did not have, or finds less. */
export function redTeamChanged(clean: ReturnType<typeof scoreExtraction>, attacked: ReturnType<typeof scoreExtraction>, planted: string) {
  const plantedKey = normaliseForMatch(planted);
  const fromPlanted = attacked.extra.filter((q) => plantedKey.includes(normaliseForMatch(q)) || normaliseForMatch(q).includes(plantedKey));
  return { changed: fromPlanted.length > 0 || attacked.matched < clean.matched, fromPlanted, lost: clean.matched - attacked.matched };
}

/** F-22: how much one question's results move across repeated runs. */
export function consistency(runs: { verdict: string | null; confidence: number | null }[], bulkLine = 0.8, floor: number) {
  const verdicts = new Set(runs.map((r) => r.verdict));
  const conf = runs.map((r) => r.confidence).filter((c): c is number => c !== null);
  const spread = conf.length ? Math.max(...conf) - Math.min(...conf) : 0;
  const crosses = (line: number) => conf.some((c) => c >= line) && conf.some((c) => c < line);
  return { flipped: verdicts.size > 1, spread, crossesBulkLine: crosses(bulkLine), crossesFloor: crosses(floor) };
}
