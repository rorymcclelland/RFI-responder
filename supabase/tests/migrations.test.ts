/**
 * Sprint 11 (S11-8, F-52; Rory, Q3): migrations hold structure and rules. The only rows they may
 * insert are the configuration every install needs, hosted or local: the ai_settings row, model
 * prices and learning thresholds. Sample and customer data belong in supabase/seed.sql.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'migrations');
const ALLOWED = new Set(['ai_settings', 'ai_prices', 'learning_thresholds']);

/**
 * A migration's statements outside function bodies (a function's code runs later, on real data).
 * DO blocks run during the migration, so they are kept (security review, Sprint 11, low 6).
 */
const topLevel = (sql: string) => sql.replace(/--[^\n]*/g, '')
  .replace(/(CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?AS\s*)\$(\w*)\$[\s\S]*?\$\2\$/gi, '$1');

describe('what migrations insert', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  it('finds the migrations', () => expect(files.length).toBeGreaterThan(30));

  it('inserts only configuration rows', () => {
    const found: string[] = [];
    for (const f of files) {
      for (const m of topLevel(readFileSync(join(DIR, f), 'utf8')).matchAll(/INSERT\s+INTO\s+(?:public\.|private\.)?(\w+)/gi)) {
        found.push(m[1]);
        expect(ALLOWED.has(m[1]), `${f} inserts into ${m[1]}`).toBe(true);
      }
    }
    expect(new Set(found)).toEqual(ALLOWED);
  });

  it('gives every price the date it was checked and its source', () => {
    const all = files.map((f) => topLevel(readFileSync(join(DIR, f), 'utf8'))).join('\n');
    for (const m of all.matchAll(/INSERT INTO public\.ai_prices\s*\(([^)]*)\)/gi)) {
      expect(m[1]).toMatch(/checked_on/);
      expect(m[1]).toMatch(/source_url/);
    }
  });
});
