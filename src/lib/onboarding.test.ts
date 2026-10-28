import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { INTRO_STEPS, loadOnboardedAt, markOnboarded, PROFILE_COLUMNS, shouldShowIntroduction, stepsFor } from './onboarding';
import { findPage, GUIDE_FILES, SCREENSHOTS } from './guide';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.|onboarding\.ts$/.test(e.name) ? [p] : [];
  });
}
// The app's labels, leaving out this module so a step cannot vouch for itself.
const SRC = sourceFiles(join(__dirname, '..')).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('the introduction (S10-6)', () => {
  it('shows members the common and response steps, and admins the admin step as well', () => {
    const member = stepsFor(false).map((s) => s.id);
    const admin = stepsFor(true).map((s) => s.id);
    expect(member).toEqual(['purpose', 'overview', 'upload', 'drafts', 'review', 'assign', 'export', 'knowledge', 'help']);
    expect(admin).toEqual(['purpose', 'overview', 'upload', 'drafts', 'review', 'assign', 'export', 'knowledge', 'admin', 'help']);
  });

  it('is shown until it has been finished or skipped once', () => {
    expect(shouldShowIntroduction({ onboardedAt: null })).toBe(true);
    expect(shouldShowIntroduction({})).toBe(true);
    expect(shouldShowIntroduction({ onboardedAt: '2026-10-25T10:00:00Z' })).toBe(false);
    expect(shouldShowIntroduction(null)).toBe(false);
  });

  it('names only labels the app shows', () => {
    for (const step of INTRO_STEPS) {
      for (const [, label] of step.body.join(' ').matchAll(/\*\*([^*]+)\*\*/g)) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`).test(SRC), `${step.id}: **${label}**`).toBe(true);
      }
    }
  });

  it('links to guide pages and headings that exist, and shows screenshots that exist', () => {
    for (const step of INTRO_STEPS) {
      expect(GUIDE_FILES, step.id).toContain(step.guide.page);
      if (step.guide.anchor) expect(findPage(step.guide.page).blocks.some((b) => b.kind === 'heading' && b.id === step.guide.anchor), `${step.id}: #${step.guide.anchor}`).toBe(true);
      if (step.image) expect(SCREENSHOTS[step.image], `${step.id}: ${step.image}`).toBeTruthy();
      expect(step.image === null || step.imageAlt.length > 0, step.id).toBe(true);
    }
  });

  it('keeps the house style: British spelling, no em dashes', () => {
    const text = JSON.stringify(INTRO_STEPS);
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(organization|color|behavior|analyze|center|prioritize|catalog)\b/i);
  });

  it('records that it was seen, and tolerates a failure (it is shown again next time)', async () => {
    const ok = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    expect(await markOnboarded(ok as never)).toBe(true);
    expect(ok.rpc).toHaveBeenCalledWith('mark_onboarded');
    expect(await markOnboarded({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'no' } }) } as never)).toBe(false);
    expect(await markOnboarded({ rpc: vi.fn().mockRejectedValue(new Error('offline')) } as never)).toBe(false);
  });

  it('reads its own record through my_onboarded_at, and does not open on a failed read', async () => {
    expect(await loadOnboardedAt({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) } as never)).toBeNull();
    expect(await loadOnboardedAt({ rpc: vi.fn().mockResolvedValue({ data: '2026-10-25T10:00:00Z', error: null }) } as never)).toBe('2026-10-25T10:00:00Z');
    expect(await loadOnboardedAt({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'no' } }) } as never)).toBeUndefined();
    expect(await loadOnboardedAt({ rpc: vi.fn().mockRejectedValue(new Error('offline')) } as never)).toBeUndefined();
  });
});

describe('reading profiles (security review, Sprint 10, L3)', () => {
  it('asks only for the columns members may read, which are the ones the migration grants', () => {
    const migration = readFileSync(join(__dirname, '../../supabase/migrations/20261029110000_onboarding_private.sql'), 'utf8');
    const granted = migration.match(/GRANT SELECT \(([^)]+)\)/)![1].split(',').map((c) => c.trim());
    expect(PROFILE_COLUMNS.split(',').map((c) => c.trim())).toEqual(granted);
    expect(granted).not.toContain('onboarded_at');
    expect(SRC).not.toMatch(/from\('user_profiles'\)\.select\('\*'\)/);
  });
});
