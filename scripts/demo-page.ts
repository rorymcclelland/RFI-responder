/**
 * Sprint 20 (S20-4): the sprint demo page. Reads a browser test run's results (fetched from the
 * branch e2e-results/<target>/<branch>, scripts/publish-e2e-results.sh) and the agreed cases
 * (e2e/cases.ts), and writes one HTML page per review with the recordings beside it, plus a Markdown
 * summary for docs/testing/.
 *
 *   tsx scripts/demo-page.ts --results <folder>[,<folder>] --sprints 19,20 --out <folder> [--markdown <file>]
 *
 * Rule 1: a case takes "passed" or "failed" only from a browser test that ran and named it; anything
 * else is shown as checked another way (with how), by hand (with why), or not checked, in red.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { SPRINTS, type Case, type SprintCases } from '../e2e/cases';

export interface RunTest {
  title: string;
  /** Where it ran: local (CI's own stack) or staging. */
  target?: string;
  /** The test used the real AI models (Sprint 20, Q2). */
  realAi?: boolean;
  status: 'passed' | 'failed';
  durationMs: number;
  cases: string[];
  steps: string[];
  recordings: { label: string; path: string }[];
  error?: string;
}
export interface Build { sha: string; run: string; target: string; branch: string; at: string }

type Result = Record<string, unknown>;

/**
 * A recording's path under the results folder, or null if it would leave it or is not a .webm file
 * (security review, L6): the page copies these files, so a crafted report must not reach others.
 */
export function insideRoot(root: string, rel: string): string | null {
  const base = resolve(root);
  const full = resolve(base, rel);
  return full.startsWith(base + sep) && full.endsWith('.webm') ? full : null;
}

/** The tests in a Playwright JSON report, flattened. A test is failed if any attempt failed. */
export function readRun(report: Result, root: string, target?: string): RunTest[] {
  const out: RunTest[] = [];
  const walk = (suite: Result) => {
    for (const spec of (suite.specs as Result[] | undefined) ?? []) {
      for (const t of (spec.tests as Result[] | undefined) ?? []) {
        const results = (t.results as Result[] | undefined) ?? [];
        // A test that did not run here (skipped on this target) says nothing about the case.
        if (!results.length || results.every((r) => r.status === 'skipped')) continue;
        const annotations = [...((t.annotations as Result[]) ?? []), ...results.flatMap((r) => (r.annotations as Result[]) ?? [])];
        const last = results[results.length - 1];
        const failed = results.some((r) => r.status !== 'passed' && r.status !== 'skipped');
        const recordings = ((last.attachments as Result[]) ?? [])
          .filter((a) => a.contentType === 'video/webm' && typeof a.path === 'string')
          .map((a) => ({ label: String(a.name).replace(/^recording: /, ''), path: insideRoot(root, String(a.path).replace(/^.*?e2e-results\//, '')) }))
          .filter((r): r is { label: string; path: string } => r.path !== null);
        const err = ((last.errors as Result[]) ?? [])[0] as Result | undefined;
        out.push({
          title: String(spec.title),
          ...(target ? { target } : {}),
          ...(annotations.some((a) => a.type === 'real-ai') ? { realAi: true } : {}),
          status: failed ? 'failed' : 'passed',
          durationMs: Number(last.duration ?? 0),
          cases: [...new Set(annotations.filter((a) => a.type === 'case').map((a) => String(a.description)))],
          steps: ((last.steps as Result[]) ?? []).map((s) => String(s.title)).filter((s) => !/^(Before|After) Hooks$/.test(s)),
          recordings,
          ...(err ? { error: String(err.message ?? '').split('\n')[0].slice(0, 300) } : {}),
        });
      }
    }
    for (const child of (suite.suites as Result[] | undefined) ?? []) walk(child);
  };
  for (const s of (report.suites as Result[] | undefined) ?? []) walk(s);
  return out;
}

export type Verdict =
  | { state: 'passed' | 'failed'; tests: RunTest[] }
  | { state: 'ci'; by: string }
  | { state: 'hand'; why: string }
  | { state: 'unchecked' };

export function verdict(c: Case, tests: RunTest[]): Verdict {
  if (c.how.kind === 'ci') return { state: 'ci', by: c.how.by };
  if (c.how.kind === 'hand') return { state: 'hand', why: c.how.why };
  if (c.how.kind === 'suite') {
    if (!tests.length) return { state: 'unchecked' };
    return { state: tests.every((t) => t.status === 'passed') ? 'passed' : 'failed', tests: [] };
  }
  const mine = tests.filter((t) => t.cases.includes(c.id));
  if (!mine.length) return { state: 'unchecked' };
  return { state: mine.every((t) => t.status === 'passed') ? 'passed' : 'failed', tests: mine };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const LABEL: Record<Verdict['state'], string> = { passed: 'Passed', failed: 'Failed', ci: 'Checked in CI', hand: 'By hand', unchecked: 'Not checked' };
const detail = (v: Verdict) => (v.state === 'ci' ? v.by : v.state === 'hand' ? v.why : v.state === 'unchecked' ? 'No test names this case, and no other check is recorded.' : v.tests.map((t) => t.title).join('; '));

/** The page. Videos are referenced as videos/<file>, copied there by `writeDemo`. */
export function renderHtml(sprints: SprintCases[], tests: RunTest[], buildOrBuilds: Build | Build[], video: (path: string) => string): string {
  const builds = Array.isArray(buildOrBuilds) ? buildOrBuilds : [buildOrBuilds];
  const all = sprints.flatMap((s) => s.cases.map((c) => verdict(c, tests)));
  const count = (st: Verdict['state']) => all.filter((v) => v.state === st).length;
  const shown = new Set<RunTest>();
  const body = sprints.map((s) => {
    const stories = s.stories.map((st) => {
      const cases = s.cases.filter((c) => c.story === st.id);
      const rows = cases.map((c) => {
        const v = verdict(c, tests);
        return `<tr><td class="id">${esc(c.id)}</td><td>${esc(c.title)}<div class="how">${esc(detail(v))}</div></td><td><span class="chip ${v.state}">${LABEL[v.state]}</span></td></tr>`;
      }).join('');
      // One set of recordings per test: from the first run given (staging, when it ran there).
      const own = tests.filter((t, i) => !shown.has(t) && t.cases.some((id) => cases.some((c) => c.id === id))
        && !tests.slice(0, i).some((u) => u.title === t.title));
      own.forEach((t) => shown.add(t));
      const clips = own.map((t) => `<figure class="clip"><figcaption><strong>${esc(t.title)}</strong>${t.target ? ` <span class="dur">(${esc(t.target)})</span>` : ''}${t.realAi ? ' <span class="chip hand">Real AI model</span>' : ''} <span class="chip ${t.status}">${t.status === 'passed' ? 'Passed' : 'Failed'}</span> <span class="dur">${(t.durationMs / 1000).toFixed(1)} s</span></figcaption>`
        + (t.error ? `<p class="err">${esc(t.error)}</p>` : '')
        + `<div class="vids">${t.recordings.map((r) => `<div class="vid"><video src="${esc(video(r.path))}" controls preload="metadata" muted playsinline></video><span>${esc(r.label)}</span></div>`).join('')}</div>`
        + (t.steps.length ? `<details><summary>Steps (${t.steps.length})</summary><ol>${t.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : '')
        + '</figure>').join('');
      return `<section class="story"><h3><span class="sid">${esc(st.id)}</span> ${esc(st.title)}</h3><p class="for">${esc(st.forTheUser)}</p>`
        + (rows ? `<div class="tbl"><table><thead><tr><th>Case</th><th>What was checked</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>` : '')
        + clips + '</section>';
    }).join('');
    return `<section class="sprint"><h2>Sprint ${s.sprint}: ${esc(s.title)}</h2>${stories}</section>`;
  }).join('');
  const aiNote: Record<string, string> = {
    staging: 'The staging run used the hosted staging site, with its real sign-in, database and functions; a test marked Real AI model asked one question with the real models, and no other step used AI.',
    local: 'The local run used the real Supabase stack in CI with every AI provider switched off, so drafts and answers are the fallback ones, the same on every run.',
  };
  const ai = builds.map((b) => aiNote[b.target] ?? '').filter(Boolean).join(' ');
  const title = `Sprint ${sprints.map((s) => s.sprint).join(' and ')} review`;
  return `<title>${esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;800&family=JetBrains+Mono:wght@500&display=swap">
<style>
/* A review sheet: one column of stories, each with its agreed cases and the recordings that prove them. */
:root { --bg:#f6f7f9; --panel:#ffffff; --ink:#18212b; --muted:#5b6672; --line:#dde2e8; --accent:#1f5f8b;
  --ok:#1e7a4c; --ok-bg:#e3f4ea; --bad:#b3261e; --bad-bg:#fbe5e3; --warn:#8a5a00; --warn-bg:#fdf0d5; --info:#3d4f63; --info-bg:#e8edf3;
  --sans:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#11161c; --panel:#181f27; --ink:#e7ecf1; --muted:#9aa6b2; --line:#2a3440; --accent:#7fb7e0;
  --ok:#7fd1a3; --ok-bg:#16301f; --bad:#ff9a90; --bad-bg:#3a1a17; --warn:#f0c46b; --warn-bg:#352a12; --info:#b9c6d4; --info-bg:#222c37; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#11161c; --panel:#181f27; --ink:#e7ecf1; --muted:#9aa6b2; --line:#2a3440; --accent:#7fb7e0;
  --ok:#7fd1a3; --ok-bg:#16301f; --bad:#ff9a90; --bad-bg:#3a1a17; --warn:#f0c46b; --warn-bg:#352a12; --info:#b9c6d4; --info-bg:#222c37; color-scheme: dark; }
body { background:var(--bg); color:var(--ink); font:16px/1.55 var(--sans); }
main { max-width:960px; margin:0 auto; padding-block:32px 64px; padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)); display:grid; gap:28px; }
h1 { font-weight:800; font-size:clamp(1.6rem, 4vw, 2.2rem); margin:0; text-wrap:balance; letter-spacing:-0.01em; }
h2 { font-weight:800; font-size:1.35rem; margin:0 0 4px; text-wrap:balance; }
h3 { font-weight:600; font-size:1.1rem; margin:0; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
.sid, .id { font-family:var(--mono); font-size:.82rem; color:var(--accent); white-space:nowrap; }
.meta { color:var(--muted); font-size:.92rem; margin:6px 0 0; }
.meta a { color:var(--accent); }
.tally { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
.note { background:var(--info-bg); color:var(--info); border-radius:8px; padding:10px 14px; font-size:.92rem; margin:14px 0 0; max-width:70ch; }
.sprint { display:grid; gap:18px; }
.story { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; display:grid; gap:12px; min-width:0; }
.for { margin:0; color:var(--muted); max-width:70ch; }
.tbl { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:.94rem; }
th { text-align:left; font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:6px 8px; border-bottom:1px solid var(--line); }
td { padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
tr:last-child td { border-bottom:0; }
.how { color:var(--muted); font-size:.84rem; margin-top:2px; }
.chip { display:inline-block; font-size:.78rem; font-weight:600; border-radius:999px; padding:2px 10px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.chip.passed { background:var(--ok-bg); color:var(--ok); } .chip.failed, .chip.unchecked { background:var(--bad-bg); color:var(--bad); }
.chip.hand { background:var(--warn-bg); color:var(--warn); } .chip.ci { background:var(--info-bg); color:var(--info); }
.clip { margin:0; border-top:1px solid var(--line); padding-top:12px; display:grid; gap:8px; }
.clip figcaption { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.dur { color:var(--muted); font-size:.84rem; font-variant-numeric:tabular-nums; }
.err { margin:0; color:var(--bad); font-family:var(--mono); font-size:.8rem; overflow-wrap:anywhere; }
.vids { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; }
.vid { display:grid; gap:4px; min-width:0; } .vid span { font-size:.82rem; color:var(--muted); }
video { width:100%; max-width:100%; border-radius:8px; border:1px solid var(--line); background:var(--bg); }
details summary { cursor:pointer; color:var(--accent); font-size:.9rem; }
details ol { margin:6px 0 0; padding-left:22px; color:var(--muted); font-size:.9rem; }
a:focus-visible, summary:focus-visible, video:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
</style>
<main>
<header>
<h1>${esc(title)}</h1>
${builds.map((b) => `<p class="meta">${esc(b.target === 'staging' ? 'Staging' : 'Local')} run: build <span class="id">${esc(b.sha.slice(0, 7))}</span> on ${esc(b.branch)}, ${esc(b.at.replace('T', ' ').replace(/:\d\dZ$/, ' UTC'))}. <a href="${esc(b.run)}">The CI run</a>.</p>`).join('')}
<div class="tally">${(['passed', 'failed', 'unchecked', 'ci', 'hand'] as const).filter((st) => count(st)).map((st) => `<span class="chip ${st}">${count(st)} ${LABEL[st].toLowerCase()}</span>`).join('')}</div>
<p class="note">${esc(ai)} A result of Passed or Failed comes only from browser tests that ran in these builds, and a case passes only if it passed in every run that tested it; Checked in CI and By hand say how else a case is covered.</p>
</header>
${body}
</main>`;
}

/** The same, as Markdown, without the recordings. */
export function renderMarkdown(sprints: SprintCases[], tests: RunTest[], buildOrBuilds: Build | Build[]): string {
  const builds = Array.isArray(buildOrBuilds) ? buildOrBuilds : [buildOrBuilds];
  const lines = [`# Sprint ${sprints.map((s) => s.sprint).join(' and ')} review`, '',
    ...builds.map((b) => `${b.target === 'staging' ? 'Staging' : 'Local'} run: build \`${b.sha.slice(0, 7)}\` on ${b.branch}, ${b.at}. [The CI run](${b.run}).`), ''];
  for (const s of sprints) {
    lines.push(`## Sprint ${s.sprint}: ${s.title}`, '');
    for (const st of s.stories) {
      lines.push(`### ${st.id} ${st.title}`, '', st.forTheUser, '');
      const cases = s.cases.filter((c) => c.story === st.id);
      if (cases.length) {
        lines.push('| Case | What was checked | Result |', '|---|---|---|');
        for (const c of cases) {
          const v = verdict(c, tests);
          lines.push(`| ${c.id} | ${c.title} (${detail(v).replace(/\|/g, '/')}) | ${LABEL[v.state]} |`);
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const dir = arg('results');
  const out = arg('out');
  const which = (arg('sprints') ?? '').split(',').map(Number).filter(Boolean);
  if (!dir || !out || !which.length) throw new Error('Usage: --results <folder>[,<folder>] --sprints 19,20 --out <folder> [--markdown <file>]');
  const builds: Build[] = [];
  const tests: RunTest[] = [];
  for (const d of dir.split(',')) {
    const build = JSON.parse(readFileSync(join(d, 'build.json'), 'utf8')) as Build;
    builds.push(build);
    const report = join(d, build.target, 'results.json');
    if (existsSync(report)) tests.push(...readRun(JSON.parse(readFileSync(report, 'utf8')), join(d, build.target), build.target));
  }
  const sprints = SPRINTS.filter((s) => which.includes(s.sprint));
  mkdirSync(join(out, 'videos'), { recursive: true });
  const names = new Map<string, string>();
  const video = (path: string) => {
    if (!names.has(path)) names.set(path, `videos/${names.size + 1}-${basename(path)}`);
    return names.get(path)!;
  };
  writeFileSync(join(out, 'index.html'), renderHtml(sprints, tests, builds, video));
  for (const [from, to] of names) if (existsSync(from)) copyFileSync(from, join(out, to));
  const md = arg('markdown');
  if (md) writeFileSync(md, renderMarkdown(sprints, tests, builds) + '\n');
  console.log(`Wrote ${join(out, 'index.html')} with ${names.size} recordings from ${tests.length} tests.`);
}

if (process.argv[1]?.endsWith('demo-page.ts')) main();
