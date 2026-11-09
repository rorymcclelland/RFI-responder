// Rory, 9 November 2026: each case on the review page opens to show how to check it again.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPRINTS } from '../e2e/cases';
import { captions, reproduce, testNames } from './reproduce';

const SPEC = `test('First thing', async ({ browser }) => {
  checks('S1 1');
  await caption(page, 'Opens the page');
  await caption(page, \`Counts \${n} things\`);
});

test('Second thing', async () => {
  await caption(page, 'Not this one');
});`;

describe('how to check a case again', () => {
  it('a browser test: the command for that one test, and its captions in order', () => {
    const r = reproduce({ id: 'S1 1', story: 'S1', title: 't', how: { kind: 'browser' } }, [{ title: 'First thing', file: 'sprint-1.spec.ts' }],
      (p) => (p === 'e2e/sprint-1.spec.ts' ? SPEC : null));
    expect(r.commands).toEqual(['npm run test:e2e -- e2e/sprint-1.spec.ts -g "^First thing$"']);
    expect(r.steps).toEqual(['Opens the page', 'Counts … things']);
    expect(captions(SPEC, 'Second thing')).toEqual(['Not this one']);
  });

  it('a check in CI: the named file, narrowed to the tests carrying the case id', () => {
    const src = `describe('S9-1 2: something', () => { it('does it', () => {}); });\ndescribe('S9-1 3: other', () => {});`;
    const r = reproduce({ id: 'S9-1 2', story: 'S9-1', title: 't', how: { kind: 'ci', by: 'supabase/tests/db/sprint9.test.ts and scripts/x.test.ts' } }, [],
      (p) => (p.endsWith('sprint9.test.ts') ? src : p.endsWith('x.test.ts') ? 'it("unrelated", () => {})' : null));
    expect(r.commands).toEqual(['npm run test:db -- supabase/tests/db/sprint9.test.ts -t "S9-1 2"', 'npm test -- scripts/x.test.ts']);
    expect(r.steps).toEqual(['sprint9.test.ts: S9-1 2: something', 'x.test.ts: the whole file (no test in it names S9-1 2).']);
    expect(testNames(src)).toEqual(['S9-1 2: something', 'does it', 'S9-1 3: other']);
  });

  it('a check in CI that names no test file says what it is', () => {
    const r = reproduce({ id: 'S1 2', story: 'S1', title: 't', how: { kind: 'ci', by: 'the e2e job runs npm run screenshots' } }, []);
    expect(r).toEqual({ commands: [], steps: [], note: 'the e2e job runs npm run screenshots' });
  });

  it('by hand: the written steps, or why it is by hand', () => {
    expect(reproduce({ id: 'S1 3', story: 'S1', title: 't', how: { kind: 'hand', why: 'needs a person' }, steps: ['Do this'] }, []).steps).toEqual(['Do this']);
    expect(reproduce({ id: 'S1 3', story: 'S1', title: 't', how: { kind: 'hand', why: 'needs a person' } }, []).note).toBe('needs a person');
  });

  it('every test file a case names exists, and every Sprint 26 case by hand has steps', () => {
    for (const s of SPRINTS) for (const c of s.cases) {
      if (c.how.kind !== 'ci') continue;
      for (const f of c.how.by.match(/(?:src|scripts|supabase\/tests|docs|e2e)\/[\w./-]+\.test\.ts/g) ?? []) {
        expect(reproduce(c, []).commands.some((x) => x.includes(f)), `${c.id}: ${f}`).toBe(true);
        expect(existsSync(f), `${c.id} names ${f}`).toBe(true);
      }
    }
    const s26 = SPRINTS.find((s) => s.sprint === 26)!;
    for (const c of s26.cases.filter((x) => x.how.kind === 'hand')) expect(c.steps?.length, c.id).toBeGreaterThan(0);
  });
});
