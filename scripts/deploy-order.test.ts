// Sprint 25 (S25-1, F-75): the live app is published only after its database.
// Reads the Deploy workflow and vercel.json as text (no YAML library in the project) and checks the
// order the refinement agreed: a push to main builds nothing on Vercel; the production job, after
// approval, applies the migrations and functions, then moves the branch "live" (Vercel's production
// branch), then checks the deploy; and "live" moves only if everything before it succeeded.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { git?: { deploymentEnabled?: Record<string, boolean> } };

type Step = { name: string; text: string };

/** The text of one job: from "  <job>:" to the next job at the same indent, or the end. */
function jobText(yaml: string, job: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

/** The job's steps in order, each with its name (or the action it uses) and its whole text. */
function steps(job: string): Step[] {
  const lines = job.split('\n');
  const at = lines.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (at < 0) return [];
  const out: Step[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.join('\n');
    const name = /^\s*(?:- )?name:\s*(.+)$/m.exec(text)?.[1] ?? /^\s*(?:- )?uses:\s*(.+)$/m.exec(text)?.[1] ?? '';
    out.push({ name: name.trim(), text });
  };
  for (const l of lines.slice(at + 1)) {
    if (/^ {6}- /.test(l)) { flush(); cur = [l]; }
    else if (cur && (/^ {8}/.test(l) || l.trim() === '' || /^ {6}#/.test(l))) cur.push(l);
    else if (/^ {0,5}\S/.test(l)) break;
  }
  flush();
  return out;
}

const production = jobText(workflow, 'production');
const prodSteps = steps(production);
const index = (re: RegExp) => prodSteps.findIndex((s) => re.test(s.name));

describe('the live app only after its database (S25-1)', () => {
  it('a push to main builds nothing on Vercel, and live does (test case 1)', () => {
    const enabled = vercel.git?.deploymentEnabled ?? {};
    expect(enabled.main).toBe(false);
    expect(enabled.live).not.toBe(false);
    expect(enabled['sprint-*']).toBe(false);
  });

  it('reads the production job and its steps', () => {
    expect(production).toContain('environment: production');
    expect(prodSteps.length).toBeGreaterThan(5);
  });

  it('moves live after the migrations and functions, and before the check (test case 3)', () => {
    const migrations = index(/^Migrations and Edge Functions to the live demo$/);
    const live = index(/^Move the live branch to this commit$/);
    const check = index(/^Check the deploy/);
    expect(migrations).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(migrations);
    expect(check).toBeGreaterThan(live);
    const signIn = index(/^Sign-in settings match the repository$/);
    expect(signIn).toBeGreaterThan(-1);
    expect(signIn).toBeLessThan(live);
  });

  it('moves live to the deployed commit, with the workflow\'s own token', () => {
    const step = prodSteps[index(/^Move the live branch to this commit$/)];
    expect(step.text).toContain('"${GITHUB_SHA}:refs/heads/live"');
    expect(step.text).toContain('TOKEN: ${{ github.token }}');
    expect(step.text).not.toMatch(/secrets\./);
    expect(production).toMatch(/permissions:\n\s+contents: write\n/);
  });

  it('live only moves forward: not forced, and nothing deploys unless the commit is live or later (security review, M2)', () => {
    const step = prodSteps[index(/^Move the live branch to this commit$/)];
    expect(step.text).toMatch(/git push "https/);
    expect(step.text).not.toMatch(/push (-f|--force)/);
    const ready = prodSteps[index(/^Is the deploy set up/)];
    expect(ready.text).toContain('compare/live...${GITHUB_SHA}');
    expect(ready.text).toMatch(/!= ahead \] && \[ "\$order" != identical/);
    expect(index(/^Is the deploy set up/)).toBeLessThan(index(/^Migrations and Edge Functions to the live demo$/));
  });

  it('the job runs for the branch main only, and its checkout keeps no token (security review, L1 and M1)', () => {
    expect(production).toContain("if: github.ref == 'refs/heads/main'");
    const checkout = prodSteps.find((s) => s.name.startsWith('actions/checkout'));
    expect(checkout?.text).toMatch(/persist-credentials: false/);
  });

  it('live moves only when every step before it succeeded (test case 4)', () => {
    const live = index(/^Move the live branch to this commit$/);
    const step = prodSteps[live];
    // A step's "if" without a status function runs only after every earlier step succeeded.
    expect(step.text).toMatch(/if: steps\.ready\.outputs\.ok == 'true'\s*$/m);
    expect(step.text).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)|success\(\) \|\|/);
    for (const earlier of prodSteps.slice(0, live)) {
      expect(earlier.text, earlier.name).not.toMatch(/continue-on-error|always\(\)|failure\(\)/);
    }
    // The steps that must succeed first run exactly when live may move (a skipped step would count as
    // a success), and nothing in them hides a failure (QA review, M1: both mutations passed before).
    for (const name of [/^Sign-in settings match the repository$/, /^Migrations and Edge Functions to the live demo$/]) {
      const s = prodSteps[index(name)];
      expect(s.text, s.name).toMatch(/if: steps\.ready\.outputs\.ok == 'true'\s*$/m);
      expect(s.text, s.name).not.toMatch(/\|\|\s*(true|:|exit 0)|set \+e|;\s*true\b/);
    }
  });

  it('nothing else in the workflow moves live', () => {
    const pushes = workflow.match(/refs\/heads\/live\b/g) ?? [];
    expect(pushes).toHaveLength(1);
    expect(jobText(workflow, 'staging')).not.toContain('refs/heads/live');
  });

  it('the readers find nothing in a job that is not there', () => {
    expect(jobText(workflow, 'nonesuch')).toBe('');
    expect(steps('  x:\n    runs-on: y\n')).toEqual([]);
  });
});
