// Sprint 8, S8-5 test 2 (F-39): the screenshot script signs in only to a local app and a local Supabase.
import { describe, expect, it } from 'vitest';
import { allowedRequest, isLocalUrl, supabaseUrlFromEnv, supabaseUrlsFromEnv } from './local-only';

describe('S8-5 test 2 (F-39)', () => {
  it.each([
    ['http://localhost:5173', true], ['http://127.0.0.1:54321', true], ['http://localhost:54321/', true],
    ['https://abcd.supabase.co', false], ['http://localhost.evil.com:54321', false], ['http://localhost@evil.com', false],
    ['http://127.0.0.1.nip.io', false], ['', false],
  ])('%s is local: %s', (url, local) => expect(isLocalUrl(url)).toBe(local));

  it('reads the Supabase address from .env text, ignoring comments and quotes', () => {
    expect(supabaseUrlFromEnv('# x\nVITE_SUPABASE_URL="http://127.0.0.1:54321"\nVITE_SUPABASE_ANON_KEY=k\n')).toBe('http://127.0.0.1:54321');
    expect(supabaseUrlFromEnv('VITE_SUPABASE_URL=https://abcd.supabase.co\r\n')).toBe('https://abcd.supabase.co');
    expect(supabaseUrlFromEnv('OTHER=1')).toBeNull();
  });
});

describe('security review, Sprint 8: the Supabase check cannot be sidestepped', () => {
  it('reads every VITE_SUPABASE_URL in a file, so a later duplicate is seen', () => {
    expect(supabaseUrlsFromEnv('VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_URL=https://abcd.supabase.co\n'))
      .toEqual(['http://127.0.0.1:54321', 'https://abcd.supabase.co']);
  });
  it('lets the browser reach only this machine, and the fonts the app loads', () => {
    expect(allowedRequest('http://127.0.0.1:54321/auth/v1/token')).toBe(true);
    expect(allowedRequest('http://localhost:5173/src/main.tsx')).toBe(true);
    expect(allowedRequest('https://fonts.googleapis.com/css2?family=Inter')).toBe(true);
    expect(allowedRequest('https://fonts.gstatic.com/s/inter/v1.woff2')).toBe(true);
    expect(allowedRequest('https://abcd.supabase.co/auth/v1/token')).toBe(false);
    expect(allowedRequest('https://fonts.googleapis.com.evil.com/x')).toBe(false);
    expect(allowedRequest('data:image/png;base64,AAAA')).toBe(true);
  });
});
