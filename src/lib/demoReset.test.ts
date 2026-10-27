// Sprint 15, S15-4 (F-63): resetting the demo from the governance page. Test numbers: docs/refinement/sprint-15.md.
import { describe, expect, it, vi } from 'vitest';
import { RESET_PHRASE, isConfirmed, loadDemoStatus, resetDemo } from './demoReset';

describe('isConfirmed', () => {
  it('needs the phrase exactly (test 3)', () => {
    expect(RESET_PHRASE).toBe('reset the demo');
    expect(isConfirmed('reset the demo')).toBe(true);
    for (const t of ['', 'Reset the demo', 'reset the demo ', ' reset the demo', 'reset demo']) expect(isConfirmed(t), t).toBe(false);
  });
});

describe('loadDemoStatus', () => {
  it('says whether a demo is loaded, and when it was last reset', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { loaded: true, stored_at: '2026-10-27T10:00:00Z', last_reset_at: null }, error: null });
    expect(await loadDemoStatus({ rpc } as never)).toEqual({ loaded: true, lastResetAt: null });
    expect(rpc).toHaveBeenCalledWith('demo_status');
  });

  it('treats a failure as no demo, so the section stays hidden (test 3)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Only an admin can see the demo\'s status' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loadDemoStatus({ rpc } as never)).toEqual({ loaded: false, lastResetAt: null });
    spy.mockRestore();
  });
});

describe('resetDemo', () => {
  it('sends the phrase and reports what was loaded (test 1)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { entries: 132, responses: 4 }, error: null });
    expect(await resetDemo({ rpc } as never, 'reset the demo')).toBe('The demo is reset: 132 knowledge-base entries and 4 responses. The reset is in the audit log.');
    expect(rpc).toHaveBeenCalledWith('reset_demo', { p_confirm: 'reset the demo' });
  });

  it('refuses without calling the database when the phrase is not exact (test 3)', async () => {
    const rpc = vi.fn();
    await expect(resetDemo({ rpc } as never, 'Reset the demo')).rejects.toThrow(/Type "reset the demo"/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes on the database\'s own plain refusals, and hides anything else (test 3)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const message of ['Only an admin can reset the demo', 'No demo is loaded in this installation, so there is nothing to reset']) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });
      await expect(resetDemo({ rpc } as never, RESET_PHRASE)).rejects.toThrow(message);
    }
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'relation "x" does not exist' } });
    await expect(resetDemo({ rpc } as never, RESET_PHRASE)).rejects.toThrow('The demo may not have been reset. Check Last reset (reload the page), then try again if it has not changed.');
    spy.mockRestore();
  });
});
