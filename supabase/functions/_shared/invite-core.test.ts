// Sprint 15, S15-5 (F-3): admins invite people from the app. Test numbers: docs/refinement/sprint-15.md.
import { describe, expect, it, vi } from 'vitest';
import { MAX_INVITES_PER_DAY, inviteUser, validateInvite, type InviteDeps } from './invite-core';

const ADMIN = 'admin-1';
const ORIGIN = 'https://rfi-responder.vercel.app';

function deps(over: Partial<InviteDeps> = {}): InviteDeps & { sent: unknown[]; audited: unknown[] } {
  const sent: unknown[] = [];
  const audited: unknown[] = [];
  return {
    sent, audited,
    isAdmin: vi.fn(async () => true),
    invitesToday: vi.fn(async () => 0),
    sendInvite: vi.fn(async (email: string, displayName: string | null, redirectTo: string) => { sent.push({ email, displayName, redirectTo }); return { outcome: 'sent' as const, userId: 'new-user' }; }),
    audit: vi.fn(async (actor: string, invited: string) => { audited.push({ actor, invited }); }),
    ...over,
  };
}

describe('validateInvite (test 3)', () => {
  it('trims and lower-cases the address, and trims the name', () => {
    expect(validateInvite({ email: '  New.Reviewer@Example.COM ', displayName: ' Ana Lima ' })).toEqual({ email: 'new.reviewer@example.com', displayName: 'Ana Lima' });
    expect(validateInvite({ email: 'a@b.co' })).toEqual({ email: 'a@b.co', displayName: null });
    expect(validateInvite({ email: 'a@b.co', displayName: '   ' })).toEqual({ email: 'a@b.co', displayName: null });
  });

  it.each([
    ['no body', null],
    ['no address', {}],
    ['an empty address', { email: '' }],
    ['not an address', { email: 'reviewer' }],
    ['no domain dot', { email: 'a@b' }],
    ['two at signs', { email: 'a@b@c.com' }],
    ['a space inside', { email: 'a b@c.com' }],
    ['a line break', { email: 'a@b.com\nBcc: x@y.com' }],
    ['a control character', { email: 'a\u0007@b.com' }],
    ['over 254 characters', { email: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }],
    ['a local part over 64', { email: `${'a'.repeat(65)}@b.com` }],
    ['an address that is not text', { email: 42 }],
    ['a name over 100 characters', { email: 'a@b.co', displayName: 'n'.repeat(101) }],
    ['a name with a line break', { email: 'a@b.co', displayName: 'Ana\nLima' }],
    ['a name that is not text', { email: 'a@b.co', displayName: ['x'] }],
  ])('refuses %s with status 400', (_label, body) => {
    expect(() => validateInvite(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('inviteUser', () => {
  it('1. sends one invitation, with the name, the app as the link, and an audit row naming the admin', async () => {
    const d = deps();
    const r = await inviteUser(d, ADMIN, { email: 'New.Reviewer@example.com', displayName: 'Ana Lima' }, ORIGIN);
    expect(r).toEqual({ message: 'Invitation sent to new.reviewer@example.com. They join as a member.' });
    expect(d.sent).toEqual([{ email: 'new.reviewer@example.com', displayName: 'Ana Lima', redirectTo: ORIGIN }]);
    // By account id only: deleting the person later leaves no address in the log.
    expect(d.audited).toEqual([{ actor: ADMIN, invited: 'new-user' }]);
  });

  it('2. refuses a member with 403, before anything else', async () => {
    const d = deps({ isAdmin: vi.fn(async () => false) });
    await expect(inviteUser(d, 'member-1', { email: 'a@b.co' }, ORIGIN)).rejects.toMatchObject({ status: 403 });
    expect(d.invitesToday).not.toHaveBeenCalled();
    expect(d.sent).toEqual([]);
  });

  it('4. an address that already has an account: a plain message, no audit row', async () => {
    const d = deps({ sendInvite: vi.fn(async () => ({ outcome: 'exists' as const })) });
    await expect(inviteUser(d, ADMIN, { email: 'a@b.co' }, ORIGIN)).rejects.toMatchObject({ status: 409, message: 'a@b.co already has an account. Nothing was sent.' });
    expect(d.audited).toEqual([]);
  });

  it(`5. the ${MAX_INVITES_PER_DAY + 1}st invitation of the day is refused with 429, before sending`, async () => {
    expect(MAX_INVITES_PER_DAY).toBe(20);
    const d = deps({ invitesToday: vi.fn(async () => MAX_INVITES_PER_DAY) });
    await expect(inviteUser(d, ADMIN, { email: 'a@b.co' }, ORIGIN)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/20 invitations a day/) });
    expect(d.sent).toEqual([]);
    expect(d.invitesToday).toHaveBeenCalledWith(ADMIN);
    const ok = deps({ invitesToday: vi.fn(async () => MAX_INVITES_PER_DAY - 1) });
    await expect(inviteUser(ok, ADMIN, { email: 'a@b.co' }, ORIGIN)).resolves.toBeTruthy();
  });

  it('6. the email limit or the mail provider failing: a plain message and no audit row', async () => {
    for (const [outcome, status, text] of [['rate_limited', 429, /too many emails/i], ['failed', 502, /not sent/]] as const) {
      const d = deps({ sendInvite: vi.fn(async () => ({ outcome })) });
      await expect(inviteUser(d, ADMIN, { email: 'a@b.co' }, ORIGIN)).rejects.toMatchObject({ status, message: expect.stringMatching(text) });
      expect(d.audited).toEqual([]);
    }
  });

  it('7. ignores anything else in the request: the person is always a member', async () => {
    const d = deps();
    await inviteUser(d, ADMIN, { email: 'a@b.co', is_admin: true, data: { is_admin: true }, redirectTo: 'https://evil.example' }, ORIGIN);
    expect(d.sendInvite).toHaveBeenCalledWith('a@b.co', null, ORIGIN);
  });

  it('bad input is refused before the admin check costs a database call', async () => {
    const d = deps();
    await expect(inviteUser(d, ADMIN, { email: 'nope' }, ORIGIN)).rejects.toMatchObject({ status: 400 });
    expect(d.isAdmin).not.toHaveBeenCalled();
  });

  it('says so when the invitation went but its audit row could not be written', async () => {
    const d = deps({ audit: vi.fn(async () => { throw new Error('db down'); }) });
    expect(await inviteUser(d, ADMIN, { email: 'a@b.co' }, ORIGIN)).toEqual({ message: 'Invitation sent to a@b.co, but it could not be recorded in the audit log. Tell whoever runs the installation.' });
  });
});
