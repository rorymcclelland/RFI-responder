import { describe, expect, it } from 'vitest';
import { insideRoot, readRun, renderHtml, renderMarkdown, verdict, type Build, type RunTest } from './demo-page';
import { SPRINTS, type SprintCases } from '../e2e/cases';

const build: Build = { sha: 'abcdef1234567', run: 'https://github.com/x/y/actions/runs/1', target: 'local', branch: 'sprint-20', at: '2026-11-02T15:00:00Z' };
const sprint: SprintCases = {
  sprint: 99, title: 'Test', stories: [{ id: 'S99-1', title: 'A story', forTheUser: 'Something changes.' }],
  cases: [
    { id: 'S99 1', story: 'S99-1', title: 'Checked in a browser', how: { kind: 'browser' } },
    { id: 'S99 2', story: 'S99-1', title: 'Also in a browser, but no test names it', how: { kind: 'browser' } },
    { id: 'S99 3', story: 'S99-1', title: 'Checked elsewhere', how: { kind: 'ci', by: 'a unit test' } },
    { id: 'S99 4', story: 'S99-1', title: 'Needs a person', how: { kind: 'hand', why: 'Rory watches' } },
  ],
};
const report = {
  suites: [{ specs: [
    { title: 'first', tests: [{ annotations: [], results: [
      { status: 'failed', duration: 1000, annotations: [{ type: 'case', description: 'S99 1' }], attachments: [], errors: [{ message: 'Boom\nmore' }], steps: [] },
      { status: 'passed', duration: 900, annotations: [{ type: 'case', description: 'S99 1' }], steps: [{ title: 'Sarah signs in' }],
        attachments: [{ name: 'recording: Sarah Chen', contentType: 'video/webm', path: '/home/runner/work/r/r/e2e-results/artifacts/t/videos/a.webm' }] },
    ] }] },
  ] }],
};

describe('the demo page (Sprint 20, S20-4)', () => {
  const tests = readRun(report, '/res/local');

  it('reads a run, and a test that failed once is failed even if a re-run passed (test case 2)', () => {
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ title: 'first', status: 'failed', cases: ['S99 1'], steps: ['Sarah signs in'] });
    expect(tests[0].recordings).toEqual([{ label: 'Sarah Chen', path: '/res/local/artifacts/t/videos/a.webm' }]);
  });

  it('lists every agreed case; one with no test is not checked (test case 1)', () => {
    expect(sprint.cases.map((c) => verdict(c, tests).state)).toEqual(['failed', 'unchecked', 'ci', 'hand']);
    const html = renderHtml([sprint], tests, build, (p) => `videos/${p.split('/').pop()}`);
    for (const c of sprint.cases) expect(html).toContain(c.id);
    expect(html).toContain('<span class="chip unchecked">Not checked</span>');
    expect(html).toContain('src="videos/a.webm"');
  });

  it('gives Passed or Failed only from a browser test that ran (test case 4)', () => {
    const passing: RunTest[] = [{ ...tests[0], status: 'passed' }];
    expect(verdict(sprint.cases[0], passing).state).toBe('passed');
    expect(verdict(sprint.cases[2], passing).state).toBe('ci');
    expect(verdict(sprint.cases[3], passing).state).toBe('hand');
    expect(verdict(sprint.cases[1], passing).state).toBe('unchecked');
    expect(renderMarkdown([sprint], passing, build)).toContain('| S99 4 | Needs a person (Rory watches) | By hand |');
  });

  it('says what each run used, and names both runs', () => {
    const html = renderHtml([sprint], tests, [build, { ...build, target: 'staging', sha: 'fedcba9876543' }], (p) => p);
    expect(html).toContain('every AI provider switched off');
    expect(html).toContain('hosted staging site');
    expect(html).toContain('fedcba9');
  });

  it('a test skipped on a target says nothing about its case there', () => {
    const skipped = { suites: [{ specs: [{ title: 'third person', tests: [{ annotations: [], results: [{ status: 'skipped', annotations: [{ type: 'case', description: 'S99 1' }], attachments: [] }] }] }] }] };
    expect(readRun(skipped, '/res/staging', 'staging')).toEqual([]);
  });

  it('every agreed case has an id unique in its sprint, and a story that exists', () => {
    for (const s of SPRINTS) {
      expect(new Set(s.cases.map((c) => c.id)).size).toBe(s.cases.length);
      for (const c of s.cases) expect(s.stories.map((st) => st.id)).toContain(c.story);
    }
  });

  it('copies only .webm files inside the results folder (security review, L6)', () => {
    expect(insideRoot('/res/local', 'artifacts/t/a.webm')).toBe('/res/local/artifacts/t/a.webm');
    expect(insideRoot('/res/local', '../../../root/.config/gh/hosts.yml')).toBeNull();
    expect(insideRoot('/res/local', 'artifacts/../../x.webm')).toBeNull();
    expect(insideRoot('/res/local', 'artifacts/t/a.zip')).toBeNull();
  });
});
