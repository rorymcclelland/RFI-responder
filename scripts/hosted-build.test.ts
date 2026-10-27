// Sprint 14, S14-3: ready to host (test numbers from docs/refinement/sprint-14.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forbiddenIn } from './check-bundle';
import { hostedBuildProblems } from './hosted-build';

const ROOT = join(__dirname, '..');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
  buildCommand: string; rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[];
};
const header = (key: string) => vercel.headers.flatMap((h) => h.headers).find((h) => h.key === key)?.value ?? '';

describe('S14-3 the hosted build', () => {
  it('1. refuses a local, missing or malformed Supabase address, and a missing or secret key', () => {
    expect(hostedBuildProblems({})).toEqual(expect.arrayContaining([expect.stringMatching(/VITE_SUPABASE_URL is not set/), expect.stringMatching(/VITE_SUPABASE_ANON_KEY is not set/)]));
    for (const url of ['https://127.0.0.2', 'https://0.0.0.0', 'https://localhost.', 'https://host.docker.internal', 'https://10.0.0.5', 'https://example.com', 'https://abcdefgh.supabase.co', 'http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost', 'http://abc.supabase.co', 'not a url', 'https://user:pw@abc.supabase.co']) {
      expect(hostedBuildProblems({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'eyJ.anon' }), url).not.toEqual([]);
    }
    const ok = 'https://abcdefghijklmnopqrst.supabase.co';
    expect(hostedBuildProblems({ VITE_SUPABASE_URL: ok, VITE_SUPABASE_ANON_KEY: 'sb_secret_x' })).toEqual([expect.stringMatching(/secret/)]);
    expect(hostedBuildProblems({ VITE_SUPABASE_URL: ok, VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' })).toEqual([]);
  });

  it('1. the host builds with the check; a local build does not need it', () => {
    expect(vercel.buildCommand).toBe('npm run build:hosted');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:hosted']).toMatch(/hosted-build\.ts && vite build && tsx scripts\/check-bundle\.ts/);
    expect(pkg.scripts.build).toBe('vite build');
  });

  it('2. sends the security headers, with a policy naming only the app, Supabase and the font host', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
    const csp = header('Content-Security-Policy');
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|\*(?!\.supabase\.co)/);
    const hosts = [...csp.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map((m) => m[0]).sort();
    expect(hosts).toEqual(['https://*.supabase.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  });

  it('security review, L6: the host installs with one exact npm version', () => {
    expect((vercel as unknown as { installCommand: string }).installCommand).toMatch(/^npx -y npm@\d+\.\d+\.\d+ ci$/);
  });

  it('3. every path serves the app, so invitation and reset links load it', () => {
    expect(vercel.rewrites).toEqual([{ source: '/((?!assets/).*)', destination: '/index.html' }]);
    // Security review, L4: a missing chunk is a 404, not the page (with nosniff it would fail as a script).
    const re = new RegExp(`^${vercel.rewrites[0].source.replace('(?!assets/)', '(?!assets/)')}$`);
    expect(re.test('/invite/deep/link')).toBe(true);
    expect(re.test('/assets/App-missing.js')).toBe(false);
  });
});

describe('Sprint 14 security review (M2)', () => {
  it('the app reads only the two settings it needs, so no other VITE_ value is built in', () => {
    for (const f of ['src/main.tsx', 'src/lib/supabase.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/readConfig\(import\.meta\.env\)/);
      expect([...src.matchAll(/import\.meta\.env\.(\w+)/g)].map((m) => m[1]).every((k) => k === 'VITE_SUPABASE_URL' || k === 'VITE_SUPABASE_ANON_KEY'), f).toBe(true);
    }
  });

  it('the bundle check finds keys and provider details, and passes an ordinary bundle', () => {
    expect(forbiddenIn('const k="sk-ant-api03-PROBEPROBEPROBE"')).toEqual(['an Anthropic key']);
    expect(forbiddenIn('fetch("https://api.voyageai.com/v1")')).toEqual(['a provider host or setting']);
    expect(forbiddenIn('sb_secret_abcdefghijk')).toEqual(['a secret key']);
    expect(forbiddenIn('createClient("https://abcdefghijklmnopqrst.supabase.co","sb_publishable_x")')).toEqual([]);
  });
});

describe('S14-7 the keep-alive workflow', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/keepalive.yml'), 'utf8');
  it('runs once a day and on demand, with no repository permissions', () => {
    expect(wf).toMatch(/schedule:\n\s+- cron: '\d+ \d+ \* \* \*'/);
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/^permissions: \{\}$/m);
  });
  it('calls only public.keepalive, with the anon key, and refuses a secret key or a non-Supabase address', () => {
    expect([...wf.matchAll(/\$URL\/rest\/v1\/[\w/]+/g)].map((m) => m[0])).toEqual(['$URL/rest/v1/rpc/keepalive']);
    expect(wf).toMatch(/sb_secret_\*\) echo "::error::/);
    expect(wf).toMatch(/\^https:\/\/\[a-z0-9\]\{20\}\\\.supabase\\\.co\$/);
    expect(wf).not.toMatch(/service_role|SERVICE_ROLE/);
  });
  it('passes, saying so, until the owner has set it up', () => {
    expect(wf).toMatch(/nothing to ping\."\n\s+exit 0/);
  });
});
