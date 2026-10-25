import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkPurpose, MIN_PASSWORD_LENGTH, passwordProblem } from './passwordLink';

describe('linkPurpose (BUG-30)', () => {
  it('recognises invitation and reset links, and nothing else', () => {
    expect(linkPurpose('#access_token=x&refresh_token=y&type=invite')).toBe('invite');
    expect(linkPurpose('#access_token=x&type=recovery')).toBe('recovery');
    expect(linkPurpose('#access_token=x&type=magiclink')).toBeNull();
    expect(linkPurpose('')).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('follows the rules Supabase enforces', () => {
    expect(passwordProblem('short1', 'short1')).toMatch(/12 characters/);
    expect(passwordProblem('onlylettersherex', 'onlylettersherex')).toMatch(/digit/);
    expect(passwordProblem('letters12345678', 'letters12345679')).toMatch(/do not match/);
    expect(passwordProblem('letters12345678', 'letters12345678')).toBeNull();
  });
  it('matches supabase/config.toml', () => {
    const config = readFileSync(join(__dirname, '../../supabase/config.toml'), 'utf8');
    expect(config).toMatch(new RegExp(`minimum_password_length = ${MIN_PASSWORD_LENGTH}\\b`));
    expect(config).toContain('password_requirements = "letters_digits"');
  });
});
