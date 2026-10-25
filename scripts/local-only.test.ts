// Sprint 8, S8-5 test 2 (F-39): the screenshot script signs in only to a local app and a local Supabase.
import { describe, expect, it } from 'vitest';
import { isLocalUrl, supabaseUrlFromEnv } from './local-only';

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
