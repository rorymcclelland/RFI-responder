// Sprint 21 (S21-3): the set-up script and the sign-in settings check, with the command lines and the
// Management API replaced. Test numbers refer to docs/refinement/sprint-21.md.
import { describe, expect, it } from 'vitest';
import { keyKind, keysFrom, kindProblem, plan, refProblem, setup, type Run } from './setup-secrets';
import { authDifferences, checkAuth, expectedAuth } from './deploy-check';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', role, ref: 'x' })).toString('base64url')}.c2lnbmF0dXJlLW5vdC1jaGVja2Vk`;
const ANON = jwt('anon');
const SERVICE = jwt('service_role');
const STAGING = 'dfkjqxxgozaffdqetqul';
const LIVE = 'mnlbqsnekdzvmkxvjiti';
const TYPED = 'typed-secret-value-0123456789';

/** The command lines, replaced: answers from a table, and every call recorded. */
function fakeRun(o: { stagingRef?: string; keys?: { name: string; api_key: string }[]; ghFails?: boolean } = {}) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: Run = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (cmd === 'gh' && args[0] === 'variable') {
      return { status: 0, stdout: args[2] === 'STAGING_PROJECT_REF' ? `${o.stagingRef ?? STAGING}\n` : `${LIVE}\n`, stderr: '' };
    }
    if (cmd === 'npx') return { status: 0, stdout: JSON.stringify(o.keys ?? [{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SERVICE }]), stderr: '' };
    if (cmd === 'gh' && args[0] === 'secret') return { status: o.ghFails ? 1 : 0, stdout: '', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}
const collect = () => { const lines: string[] = []; return { lines, log: (s: string) => { lines.push(s); } }; };
const secretSets = (calls: ReturnType<typeof fakeRun>['calls']) => calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'secret');

describe('setup-secrets (S21-3)', () => {
  it('3. a dry run lists every secret it would set, by name and place, and sets nothing', async () => {
    const { run, calls } = fakeRun();
    const out = collect();
    expect(await setup('staging', false, run, async () => { throw new Error('a dry run asks for nothing'); }, out.log)).toBe(0);
    expect(secretSets(calls)).toEqual([]);
    const text = out.lines.join('\n');
    for (const s of plan('staging')) expect(text).toContain(s.name);
    expect(text).toMatch(/STAGING_SUPABASE_ANON_KEY \(repository secret\)/);
    expect(text).toMatch(/STAGING_SERVICE_ROLE_KEY \(environment staging\): from the project's service key/);
    expect(text).toContain('Nothing was changed.');
  });

  it('3. production asks for its token and password only, and writes them to its own environment', async () => {
    const { run, calls } = fakeRun();
    expect(plan('production').map((s) => [s.name, s.scope])).toEqual([['SUPABASE_ACCESS_TOKEN', 'production'], ['PRODUCTION_DB_PASSWORD', 'production']]);
    expect(await setup('production', true, run, async () => TYPED, collect().log)).toBe(0);
    expect(secretSets(calls).map((c) => c.args)).toEqual([
      ['secret', 'set', 'SUPABASE_ACCESS_TOKEN', '--env', 'production'],
      ['secret', 'set', 'PRODUCTION_DB_PASSWORD', '--env', 'production'],
    ]);
    expect(calls.some((c) => c.cmd === 'npx')).toBe(false);
  });

  it('sets each value through standard input, never on a command line; Enter leaves a secret as it is', async () => {
    const { run, calls } = fakeRun();
    const answers = [TYPED, '', TYPED];
    expect(await setup('staging', true, run, async () => answers.shift()!, collect().log)).toBe(0);
    const sets = secretSets(calls);
    expect(sets.map((c) => [c.args[2], c.args.includes('--env') ? c.args[4] : 'repository'])).toEqual([
      ['STAGING_SUPABASE_ANON_KEY', 'staging'], ['STAGING_SUPABASE_ANON_KEY', 'repository'], ['STAGING_SERVICE_ROLE_KEY', 'staging'],
      ['SUPABASE_ACCESS_TOKEN', 'staging'], ['VERCEL_BYPASS_SECRET', 'staging'],
    ]);
    expect(sets.map((c) => c.input)).toEqual([ANON, ANON, SERVICE, TYPED, TYPED]);
    for (const c of calls) for (const v of [ANON, SERVICE, TYPED]) expect(c.args.join(' ')).not.toContain(v);
  });

  it('4. refuses a key whose kind does not match its secret (the Sprint 20 slip)', async () => {
    expect(keyKind(ANON)).toBe('anon');
    expect(keyKind(SERVICE)).toBe('service_role');
    expect(keyKind('sb_publishable_abc')).toBe('anon');
    expect(keyKind('sb_secret_abc')).toBe('service_role');
    expect(keyKind('not a key')).toBeNull();
    expect(kindProblem('STAGING_SUPABASE_ANON_KEY', 'anon', SERVICE)).toMatch(/is a secret service key, and STAGING_SUPABASE_ANON_KEY needs the public anon key/);
    expect(kindProblem('STAGING_SUPABASE_ANON_KEY', 'anon', ANON)).toBeNull();
    // The command line's list with the two keys the wrong way round: nothing is set.
    const { run, calls } = fakeRun({ keys: [{ name: 'anon', api_key: SERVICE }, { name: 'service_role', api_key: ANON }] });
    const out = collect();
    expect(await setup('staging', true, run, async () => '', out.log)).toBe(1);
    expect(secretSets(calls)).toEqual([]);
    expect(out.lines.join('\n')).toMatch(/Refusing STAGING_SERVICE_ROLE_KEY/);
  });

  it('4. refuses the live demo\'s project for staging secrets', async () => {
    expect(refProblem('staging', LIVE, LIVE)).toMatch(/live demo's project/);
    expect(refProblem('staging', '', LIVE)).toMatch(/missing/);
    expect(refProblem('production', LIVE, LIVE)).toBeNull();
    const { run, calls } = fakeRun({ stagingRef: LIVE });
    expect(await setup('staging', true, run, async () => TYPED, collect().log)).toBe(1);
    expect(calls.filter((c) => c.cmd !== 'gh' || c.args[0] !== 'variable')).toEqual([]);
  });

  it('reads the keys from the Supabase command line\'s list', () => {
    expect(keysFrom(JSON.stringify([{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SERVICE }, { name: 'other', api_key: 'x' }])))
      .toEqual({ anon: ANON, service_role: SERVICE });
  });

  it('5. prints no key or typed value, in a dry run or when setting', async () => {
    for (const apply of [false, true]) {
      const out = collect();
      await setup('staging', apply, fakeRun().run, async () => TYPED, out.log);
      await setup('production', apply, fakeRun().run, async () => TYPED, out.log);
      const text = out.lines.join('\n');
      for (const v of [ANON, SERVICE, TYPED, ANON.split('.')[1], SERVICE.split('.')[2]]) expect(text).not.toContain(v);
    }
  });
});

describe('sign-in settings checked on every deploy (S21-3)', () => {
  // Built at run time, so no token-shaped text is in the repository (GitHub's push protection).
  const TOKEN = ['sbp', 'test'.repeat(10)].join('_');
  const staging = expectedAuth('staging');
  const api = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const asApi = (s: typeof staging) => ({ ...s, uri_allow_list: s.uri_allow_list.join(','), mailer_autoconfirm: false });

  it('the repository holds both environments, sign-ups off, each at its own address', () => {
    const live = expectedAuth('production');
    expect(staging.disable_signup && live.disable_signup).toBe(true);
    expect(staging.site_url).not.toBe(live.site_url);
    for (const e of [staging, live]) expect(e.uri_allow_list.every((u) => u.startsWith(e.site_url))).toBe(true);
  });

  it('1. matching settings pass, whatever their order or the API\'s other fields', async () => {
    expect(authDifferences(staging, asApi(staging))).toEqual([]);
    expect(authDifferences(staging, { ...asApi(staging), site_url: `${staging.site_url}/` })).toEqual([]);
    expect(await checkAuth('staging', STAGING, TOKEN, api(asApi(staging)), () => undefined)).toEqual([]);
  });

  it('2. sign-ups turned on fail the deploy, and say what to change', () => {
    expect(authDifferences(staging, { ...asApi(staging), disable_signup: false })).toEqual([
      'New sign-ups are allowed; the repository says off. Turn off "Allow new users to sign up" (Authentication, Sign In / Providers).',
    ]);
  });

  it('names a wrong site address, and redirect addresses missing or extra', () => {
    const d = authDifferences(staging, { ...asApi(staging), site_url: 'http://localhost:3000', uri_allow_list: 'https://evil.example/**' });
    expect(d).toHaveLength(3);
    expect(d[0]).toMatch(/site address is "http:\/\/localhost:3000"/);
    expect(d[1]).toMatch(/missing: https:\/\/rfi-responder-staging\.vercel\.app\/\*\*/);
    expect(d[2]).toMatch(/not in the repository: https:\/\/evil\.example\/\*\*/);
  });

  it('a token without Auth Config: Read says how to fix it', async () => {
    expect(await checkAuth('production', LIVE, TOKEN, api({ message: 'forbidden' }, 403), () => undefined))
      .toEqual(['The production access token cannot read the sign-in settings (403). Make it again with Auth Config: Read added (docs/DEPLOYING.md, "Rotating the keys").']);
  });

  it('5. prints the three settings, never the token', async () => {
    const lines: string[] = [];
    const problems = await checkAuth('staging', STAGING, TOKEN, api({ ...asApi(staging), disable_signup: false }), (s) => lines.push(s));
    expect(lines.join('\n')).toMatch(/sign-ups on; site https:\/\/rfi-responder-staging\.vercel\.app/);
    expect([...lines, ...problems].join('\n')).not.toContain(TOKEN);
  });
});
