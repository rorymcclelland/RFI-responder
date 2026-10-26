// Sprint 14, S14-3: ready to host (test numbers from docs/refinement/sprint-14.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostedBuildProblems } from './hosted-build';

const ROOT = join(__dirname, '..');
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
  buildCommand: string; rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[];
};
const header = (key: string) => vercel.headers.flatMap((h) => h.headers).find((h) => h.key === key)?.value ?? '';

describe('S14-3 the hosted build', () => {
  it('1. refuses a local, missing or malformed Supabase address, and a missing or secret key', () => {
    expect(hostedBuildProblems({})).toEqual(expect.arrayContaining([expect.stringMatching(/VITE_SUPABASE_URL is not set/), expect.stringMatching(/VITE_SUPABASE_ANON_KEY is not set/)]));
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost', 'http://abc.supabase.co', 'not a url', 'https://user:pw@abc.supabase.co']) {
      expect(hostedBuildProblems({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'eyJ.anon' }), url).not.toEqual([]);
    }
    expect(hostedBuildProblems({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_secret_x' })).toEqual([expect.stringMatching(/secret/)]);
    expect(hostedBuildProblems({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' })).toEqual([]);
  });

  it('1. the host builds with the check; a local build does not need it', () => {
    expect(vercel.buildCommand).toBe('npm run build:hosted');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:hosted']).toMatch(/hosted-build\.ts && vite build/);
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

  it('3. every path serves the app, so invitation and reset links load it', () => {
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });
});
