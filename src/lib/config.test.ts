// Sprint 0, story S0-6, test 3: missing settings are reported, not a blank screen.
import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

describe('readConfig', () => {
  it('accepts both settings', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'key' })).toEqual({
      ok: true, supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'key',
    });
  });

  it('names every missing or blank setting', () => {
    expect(readConfig({ VITE_SUPABASE_URL: '  ' })).toEqual({
      ok: false, missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
  });
});

describe('project rule 3: no secret key in the browser (Sprint 2 end-to-end run)', () => {
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ iss: 'supabase-demo', role })).replace(/=+$/, '')}.y`;

  it('refuses a service-role key, with a message saying which key to use', () => {
    const r = readConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/service-role/);
  });

  it('refuses a new-style secret key', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }).ok).toBe(false);
  });

  it('accepts the anon key and a new-style publishable key', () => {
    expect(readConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: jwt('anon') }).ok).toBe(true);
    expect(readConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }).ok).toBe(true);
  });
});
