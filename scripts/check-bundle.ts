/**
 * Sprint 14 security review (M2): after a hosted build, the bundle is searched for anything that must
 * never reach a browser: provider hosts and keys, the service role, a secret key. The same patterns CI
 * checks, run where the hosted build happens (Vercel), so a key pasted into the host's settings with a
 * VITE_ prefix stops the deployment rather than being published.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN: [string, RegExp][] = [
  ['a provider host or setting', /voyageai|VOYAGE_API_KEY|ANTHROPIC_API_KEY|:11434|anthropic\.com/],
  ['an Anthropic key', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['a Voyage key', /\bpa-[A-Za-z0-9_-]{30,}/],
  ['the service role', /c2VydmljZV9yb2xl|"role":"service_role"/],
  ['a secret key', /sb_secret_[A-Za-z0-9_-]{8,}/],
];

/** What a file's text contains that must not be published. */
export function forbiddenIn(text: string): string[] {
  return FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

if (process.argv[1]?.endsWith('check-bundle.ts')) {
  const found = files(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')).flatMap((f) => forbiddenIn(readFileSync(f, 'utf8')).map((w) => `${f}: ${w}`));
  if (found.length) {
    console.error(`The built app contains what must never reach a browser:\n${found.map((x) => `- ${x}`).join('\n')}`);
    process.exit(1);
  }
}
