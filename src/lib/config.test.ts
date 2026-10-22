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
