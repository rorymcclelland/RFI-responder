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

// Rory, 9 November 2026: the tests move faster than a person can follow.
describe('the recordings play slowly by default', () => {
  const tests = readRun(report, '/res/local');
  it('every video starts at a quarter of its speed, with ¼× ½× 1× 2× to choose from', () => {
    const html = renderHtml([sprint], tests, [build], (p) => `videos/${p.split('/').pop()}`);
    expect(html).toContain('<video ');
    expect(html).toMatch(/role="group" aria-label="Playback speed for every recording"/);
    expect([...html.matchAll(/data-rate="([\d.]+)" aria-pressed="(true|false)" aria-label="[\d.]+ times speed"/g)].map((m) => [m[1], m[2]]))
      .toEqual([['0.25', 'true'], ['0.5', 'false'], ['1', 'false'], ['2', 'false']]);
    expect(html).toContain('let rate = 0.25;');
    expect(html).toMatch(/v\.defaultPlaybackRate = rate; v\.playbackRate = rate;/);
    expect(html).toMatch(/try \{ localStorage\.setItem/);
  });
  it('a page with no recordings has no speed control', () => {
    const html = renderHtml([sprint], [], [build], (p) => p);
    expect(html).not.toContain('data-rate=');
    expect(html).not.toContain('<script>');
  });
});

// Sprint 27 (S27-1, F-78): beside each recording, its own steps with their times, each moving the video there.
describe('each recording\'s steps, with their times (S27-1)', () => {
  const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');
  const run = (attachments: unknown[]) => readRun({ suites: [{ specs: [{ title: 'two people', tests: [{ annotations: [], results: [
    { status: 'passed', duration: 900, annotations: [{ type: 'case', description: 'S99 1' }], steps: [{ title: 'Sarah signs in' }, { title: 'Tom signs in' }], attachments },
  ] }] }] }] }, '/res/local')[0];
  const video = (name: string, file: string) => ({ name: `recording: ${name}`, contentType: 'video/webm', path: `/w/e2e-results/artifacts/t/videos/${file}` });
  const steps = (name: string, body: unknown) => ({ name: `steps: ${name}`, contentType: 'application/json', body: b64(body) });

  it('S27-1 1, S27-1 4: reads each recording\'s own steps, in time order', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [{ at: 4.2, text: 'Sarah opens it' }, { at: 0.3, text: 'Sarah signs in' }]),
      video('Tom Reid', 'b.webm'), steps('Tom Reid', [{ at: 1, text: 'Tom signs in' }])]);
    expect(t.recordings.map((r) => [r.label, r.steps])).toEqual([
      ['Sarah Chen', [{ at: 0.3, text: 'Sarah signs in' }, { at: 4.2, text: 'Sarah opens it' }]],
      ['Tom Reid', [{ at: 1, text: 'Tom signs in' }]],
    ]);
  });

  it('S27-1 2: lists them under the video as buttons that move it, with the time shown', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [{ at: 72.4, text: 'Sarah opens <b>it</b>' }])]);
    const html = renderHtml([sprint], [t], [build], (p) => `videos/${p.split('/').pop()}`);
    expect(html).toContain('<button type="button" class="jump" data-at="72.4"><span class="t">1:12</span> Sarah opens &lt;b&gt;it&lt;/b&gt;</button>');
    expect(html).toMatch(/currentTime = Math\.max\(0, at - 0\.5\)/);
    expect(html).not.toContain('Times were not recorded');
  });

  it('S27-1 5: results without times keep the plain list, and say the times are missing', () => {
    const t = run([video('Sarah Chen', 'a.webm')]);
    expect(t.recordings[0].steps).toBeUndefined();
    const html = renderHtml([sprint], [t], [build], (p) => `videos/${p.split('/').pop()}`);
    expect(html).toContain('<summary>Steps (2)</summary>');
    expect(html).toContain('Times were not recorded for these recordings');
    expect(html).not.toContain('class="jump"');
  });

  it.each([
    ['not JSON', 'not json'],
    ['not a list', { at: 1, text: 'x' }],
    ['too many', Array.from({ length: 500 }, (_, i) => ({ at: i, text: `step ${i}` }))],
  ])('S27-1 6: a hostile step file (%s) gives no list, or a bounded one, and the page still builds', (_, body) => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', body)]);
    if (Array.isArray(body)) expect(t.recordings[0].steps).toHaveLength(200);
    else expect(t.recordings[0].steps).toBeUndefined();
    expect(() => renderHtml([sprint], [t], [build], (p) => p)).not.toThrow();
  });

  it('S27-1 6: drops steps with a bad time or no text, and cuts long text', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [
      { at: -1, text: 'negative' }, { at: 1e9, text: 'huge' }, { at: 'x', text: 'not a number' }, { at: 2, text: '' }, { at: 3 },
      { at: 5, text: 'y'.repeat(400) }, { at: 1.25, text: 'fine' }])]);
    expect(t.recordings[0].steps).toEqual([{ at: 1.3, text: 'fine' }, { at: 5, text: 'y'.repeat(300) }]);
  });

  it('a step file for a recording that is not there is ignored', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Someone else', [{ at: 1, text: 'x' }])]);
    expect(t.recordings[0].steps).toBeUndefined();
  });

  it('the Markdown summary lists each recording\'s steps with their times', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [{ at: 0.3, text: 'Sarah signs in' }, { at: 65, text: 'Sarah opens it' }])]);
    const md = renderMarkdown([sprint], [t], build);
    expect(md).toContain('**Recording: two people, Sarah Chen.** 0:00 Sarah signs in; 1:05 Sarah opens it.');
  });

  it('S27-1 6: step text cannot forge lines or links in the Markdown summary (security review)', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [{ at: 1, text: 'ok\n\n| S99 2 | Passed |\n[link](https://x)' }])]);
    const md = renderMarkdown([sprint], [t], build);
    const line = md.split('\n').find((l) => l.startsWith('**Recording:'))!;
    expect(line).toContain('ok \\| S99 2 \\| Passed \\| \\[link\\]\\(https://x\\)');
    expect(md).not.toMatch(/^\| S99 2 \| Passed/m);
  });

  it('S27-1 5: a second recording without steps (a page with no caption) leaves the first one\'s list working, with no note', () => {
    const t = run([video('Sarah Chen', 'a.webm'), steps('Sarah Chen', [{ at: 1, text: 'Sarah signs in' }]), video('Sarah Chen 2', 'b.webm')]);
    const html = renderHtml([sprint], [t], [build], (p) => p);
    expect(html).toContain('class="jump"');
    expect(html).not.toContain('Times were not recorded');
  });
});
