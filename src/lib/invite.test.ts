// Sprint 15, S15-5 (F-3): the client side of inviting someone. Test numbers: docs/refinement/sprint-15.md.
import { describe, expect, it, vi } from 'vitest';
import { inviteSomeone } from './invite';

describe('inviteSomeone', () => {
  it('sends only the address and the name, and passes on the server\'s message (test 1, 7)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { message: 'Invitation sent to a@b.co. They join as a member.' }, error: null });
    expect(await inviteSomeone({ functions: { invoke } } as never, ' a@b.co ', ' Ana ')).toBe('Invitation sent to a@b.co. They join as a member.');
    expect(invoke).toHaveBeenCalledWith('invite-user', { body: { email: 'a@b.co', displayName: 'Ana' } });
  });

  it('leaves out an empty name', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { message: 'ok' }, error: null });
    await inviteSomeone({ functions: { invoke } } as never, 'a@b.co', '  ');
    expect(invoke).toHaveBeenCalledWith('invite-user', { body: { email: 'a@b.co' } });
  });

  it('shows the server\'s plain refusal (tests 2, 4, 5, 6)', async () => {
    const context = new Response(JSON.stringify({ error: 'a@b.co already has an account. Nothing was sent.' }), { status: 409 });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context } });
    await expect(inviteSomeone({ functions: { invoke } } as never, 'a@b.co', '')).rejects.toThrow('a@b.co already has an account. Nothing was sent.');
  });

  it('refuses an empty address without calling the server', async () => {
    const invoke = vi.fn();
    await expect(inviteSomeone({ functions: { invoke } } as never, '  ', '')).rejects.toThrow(/email address/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
