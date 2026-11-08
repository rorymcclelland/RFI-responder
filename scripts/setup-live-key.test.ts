// Sprint 26 (S26-2, F-77): the script that protects live and main and makes the deploy key, with the
// command lines and the key pair replaced. Test numbers refer to docs/refinement/sprint-26.md.
import { describe, expect, it } from 'vitest';
import { KEY_TITLE, SECRET, otherWriteKeys, rulesets, setup, type MakeKey } from './setup-live-key';
import { REPO, type Run } from './setup-secrets';

// Built at run time, so no key-shaped text sits in the repository (GitHub's push protection).
const PRIVATE = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----\nfake', 'private', 'material\n-----END OPENSSH PRIVATE KEY-----\n'].join(' ');
const PUBLIC = 'ssh-ed25519 AAAAfakepublic rfi';
const fakeKey: MakeKey = (_run, use) => use({ privateKey: PRIVATE, publicKey: PUBLIC });

function fakeRun(o: { keys?: { id: number; title: string; read_only: boolean }[]; rulesets?: { id: number; name: string }[]; secretFails?: boolean } = {}) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: Run = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    const path = args.find((a) => a.startsWith('repos/')) ?? '';
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
    if (cmd === 'gh' && args[0] === 'secret') return { status: o.secretFails ? 1 : 0, stdout: '', stderr: '' };
    if (cmd === 'gh' && method === 'GET' && path.endsWith('/keys')) return { status: 0, stdout: JSON.stringify(o.keys ?? []), stderr: '' };
    if (cmd === 'gh' && method === 'GET' && path.endsWith('/rulesets')) return { status: 0, stdout: JSON.stringify(o.rulesets ?? []), stderr: '' };
    if (cmd === 'gh' && method === 'POST' && path.endsWith('/keys')) return { status: 0, stdout: '{"id":77}', stderr: '' };
    if (cmd === 'gh') return { status: 0, stdout: '{}', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}
const collect = () => { const lines: string[] = []; return { lines, log: (s: string) => { lines.push(s); } }; };
const writes = (calls: ReturnType<typeof fakeRun>['calls']) => calls.filter((c) => c.args[0] === 'secret' || (c.args.includes('-X')));

describe('setup-live-key (S26-2)', () => {
  it('the live ruleset refuses updates, force pushes and deletion, except a deploy key and the admins', () => {
    const live = rulesets().find((r) => r.conditions.ref_name.include.includes('refs/heads/live'))!;
    expect(live.rules.map((r) => r.type).sort()).toEqual(['deletion', 'non_fast_forward', 'update']);
    expect(live.bypass_actors.map((b) => b.actor_type).sort()).toEqual(['DeployKey', 'RepositoryRole']);
    expect(live.enforcement).toBe('active');
  });

  it('the main ruleset refuses force pushes and deletion, for everyone, and leaves fast-forwards alone (Q4)', () => {
    const main = rulesets().find((r) => r.conditions.ref_name.include.includes('refs/heads/main'))!;
    expect(main.rules.map((r) => r.type).sort()).toEqual(['deletion', 'non_fast_forward']);
    expect(main.bypass_actors).toEqual([]);
  });

  it('a dry run says what it would do and changes nothing', async () => {
    const { run, calls } = fakeRun();
    const { lines, log } = collect();
    expect(await setup(false, run, fakeKey, log)).toBe(0);
    expect(writes(calls)).toEqual([]);
    expect(lines.join('\n')).toMatch(/would be made[\s\S]*Nothing was changed/);
  });

  it('applies: both rulesets, the key added, its private half stored through standard input only', async () => {
    const { run, calls } = fakeRun();
    const { lines, log } = collect();
    expect(await setup(true, run, fakeKey, log)).toBe(0);
    expect(calls.filter((c) => c.args.includes('POST') && c.args.some((a) => a.endsWith('/rulesets')))).toHaveLength(2);
    const added = calls.find((c) => c.args.includes('POST') && c.args.some((a) => a.endsWith('/keys')))!;
    expect(JSON.parse(added.input!)).toMatchObject({ key: PUBLIC, read_only: false });
    const secret = calls.find((c) => c.args[0] === 'secret')!;
    expect(secret.args).toEqual(['secret', 'set', SECRET, '--env', 'production', '--repo', REPO]);
    expect(secret.input).toBe(PRIVATE);
    // The private key is nowhere but that one standard input.
    expect(calls.filter((c) => c !== secret).some((c) => c.args.join(' ').includes('PRIVATE') || (c.input ?? '').includes('PRIVATE'))).toBe(false);
    expect(lines.join('\n')).not.toContain('PRIVATE');
  });

  it('refuses when another deploy key can write, since a ruleset lets every deploy key through', async () => {
    const { run, calls } = fakeRun({ keys: [{ id: 1, title: 'An old CI key', read_only: false }] });
    const { lines, log } = collect();
    expect(await setup(true, run, fakeKey, log)).toBe(1);
    expect(writes(calls)).toEqual([]);
    expect(lines.join('\n')).toMatch(/Refusing: 1 other deploy key/);
    expect(otherWriteKeys([{ id: 2, title: 'Read only', read_only: true }])).toEqual([]);
  });

  it('running it again changes the key: the new one is stored, then the earlier one removed', async () => {
    const { run, calls } = fakeRun({ keys: [{ id: 9, title: `${KEY_TITLE} (2026-11-08)`, read_only: false }], rulesets: [{ id: 3, name: 'live: only the approved deploy' }] });
    expect(await setup(true, run, fakeKey, collect().log)).toBe(0);
    const order = calls.map((c) => (c.args[0] === 'secret' ? 'secret' : c.args.includes('DELETE') ? `delete ${c.args.find((a) => a.startsWith('repos/'))}` : ''));
    expect(order.indexOf('secret')).toBeLessThan(order.indexOf(`delete repos/${REPO}/keys/9`));
    expect(calls.some((c) => c.args.includes('PUT') && c.args.includes(`repos/${REPO}/rulesets/3`))).toBe(true);
  });

  it('if the secret cannot be stored, the new key is removed again and nothing else changes', async () => {
    const { run, calls } = fakeRun({ secretFails: true, keys: [{ id: 9, title: `${KEY_TITLE} (old)`, read_only: false }] });
    const { lines, log } = collect();
    expect(await setup(true, run, fakeKey, log)).toBe(1);
    expect(calls.some((c) => c.args.includes('DELETE') && c.args.includes(`repos/${REPO}/keys/77`))).toBe(true);
    expect(calls.some((c) => c.args.includes('DELETE') && c.args.includes(`repos/${REPO}/keys/9`))).toBe(false);
    expect(lines.join('\n')).toMatch(/nothing was changed/);
  });
});
